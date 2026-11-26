// Ranking for uwloo.ca/search, apart from fetching and drawing so it runs in Node's tests too.
// A query's terms (site/search/text.js) score each course by:
//   BM25 weights where a term appears (title, subject, description, course websites, r/uwaterloo), scaled by
//   how many of the query's words a course has, so "fourier series" ranks courses with both first;
//   plus how near the course is to the query in LSA space (search/vec.json): what it's about, said or not.
// Related ideas are the terms nearest the query there; subjects, where the results gather.

import { terms } from './text.js';

export const PAIR = 1.6; // a pair of words in order counts more than the two words apart
export const SEM = 0.6; // nearness in LSA space, against the best BM25 score (1)
const SEM_FLOOR = 0.3; // nearer than this before it counts

/** The parts of a query: its words (stems) and pairs, each once. */
export function queryTerms(q) {
  const words = [];
  const pairs = [];
  for (const x of terms(q, { surfaces: true })) {
    const list = x.t.includes(' ') ? pairs : words;
    if (!list.some((y) => y.t === x.t)) list.push(x);
  }
  return { words, pairs };
}

const ungap = (g) => {
  const out = new Array(g.length);
  let x = 0;
  for (let i = 0; i < g.length; i++) out[i] = x += g[i];
  return out;
};
/** base64 → signed bytes. */
export function bytes(b64) {
  const bin = atob(b64);
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}
/** vec.json, decoded once: {dims, docs: Int8Array, concepts, cvec: Int8Array}. */
export const loadVec = (v) => ({ dims: v.dims, docs: bytes(v.docs), concepts: v.concepts, cvec: bytes(v.cvec) });

/** The query as one LSA vector: its terms' vectors, rarer terms weighing more. null if none has one. */
export function queryVector({ words, pairs }, entries, n, dims) {
  const q = new Float64Array(dims);
  let any = false;
  for (const [x, k] of [...words.map((w) => [w, 1]), ...pairs.map((p) => [p, PAIR])]) {
    const e = entries.get(x.t);
    if (!e?.v) continue;
    const v = (e.vb ??= bytes(e.v));
    const idf = Math.log(1 + (n - e.d + 0.5) / (e.d + 0.5));
    for (let c = 0; c < dims; c++) q[c] += (k * idf * v[c]) / 127;
    any = true;
  }
  if (!any) return null;
  const len = Math.hypot(...q) || 1;
  return q.map((x) => x / len);
}
/** How good an idea is to offer, besides being near: specific (a term in twenty courses beats one in two
 *  hundred) and in calendars' own words more than on r/uwaterloo (so not a professor's name). */
const fit = ([, , df, said = df], n) => (0.5 + 0.5 * Math.min(1, Math.log(n / df) / Math.log(n / 20))) * (0.55 + 0.45 * Math.min(1, said / df / 0.8));
const near = (q, M, i, dims) => {
  let s = 0;
  for (let c = 0; c < dims; c++) s += q[c] * M[i * dims + c];
  return s / 127;
};

/** Every course's score for a query (BM25 by where its words are, plus nearness in LSA space): {out, q, known}. */
function scoreAll({ words, pairs }, entries, docs, vec) {
  const score = new Map();
  const get = (i) => {
    let e = score.get(i);
    if (!e) {
      e = { i, lex: 0, sem: 0, mask: 0, hits: new Set() };
      score.set(i, e);
    }
    return e;
  };
  const add = (t, weight, word) => {
    const e = entries.get(t);
    if (!e) return;
    ungap(e.p).forEach((i, k) => {
      const x = get(i);
      x.lex += (weight * e.w[k]) / 20;
      x.mask |= e.m[k];
      if (word) x.hits.add(t);
    });
  };
  for (const w of words) add(w.t, 1, true);
  for (const p of pairs) add(p.t, PAIR, false);
  const known = words.filter((w) => entries.get(w.t));
  // All of the query's words, or most: a course with half of them ranks well below.
  for (const x of score.values()) {
    const cover = known.length ? x.hits.size / known.length : 1;
    x.lex *= 0.35 + 0.65 * cover * cover;
  }
  const top = Math.max(1e-9, ...[...score.values()].map((x) => x.lex));
  // The query's vector, moved toward the courses that match it best by their words (pseudo-relevance
  // feedback): a word too rare for LSA ("backpropagation") still finds what's near CS 479 Neural Networks.
  let q = vec ? queryVector({ words, pairs }, entries, docs.n, vec.dims) : null;
  if (vec) {
    const best = [...score.values()].sort((a, b) => b.lex - a.lex).slice(0, 5).filter((x) => x.lex >= top * 0.5);
    if (best.length) {
      const m = q ? [...q] : new Array(vec.dims).fill(0);
      const k = q ? 0.5 / best.length : 1 / best.length;
      for (const x of best) for (let c = 0; c < vec.dims; c++) m[c] += (k * (x.lex / top) * vec.docs[x.i * vec.dims + c]) / 127;
      const len = Math.hypot(...m) || 1;
      q = m.map((x) => x / len);
    }
  }
  if (q)
    for (let i = 0; i < docs.n; i++) {
      const s = near(q, vec.docs, i, vec.dims);
      if (s > SEM_FLOOR) get(i).sem = (s - SEM_FLOOR) / (1 - SEM_FLOOR);
    }
  const out = [];
  for (const x of score.values()) {
    const flags = docs.flags[x.i];
    const prior = flags & 4 ? 0.5 : flags & 2 ? 0.9 : 1;
    x.score = (x.lex / top + SEM * x.sem) * prior;
    if (x.score > 0.02) out.push(x);
  }
  out.sort((a, b) => b.score - a.score || a.i - b.i);
  return { out, q, known };
}

/**
 * How well each course fits a query, 0 to 1 (the best is 1), for Pathways' goals: Map code → fit, courses with
 * any fit at all. Same scores as rank, every course, cross-listed ones each under its own code.
 */
export function relevance(qt, entries, docs, vec = null) {
  const { out } = scoreAll(qt, entries, docs, vec);
  const top = Math.max(1e-9, ...out.map((x) => x.score));
  return new Map(out.map((x) => [docs.codes[x.i], x.score / top]));
}

/**
 * Scores courses for a query. entries: term → its postings entry ({p, w, m, d, v}) or undefined. docs: docs.json;
 * vec: loadVec(vec.json), or null while it loads.
 * → {results: [{i, score, lex, sem, mask, hits}], related: [[shown, term]], subjects: [[[code, name], share]], total}
 */
export function rank({ words, pairs }, entries, docs, vec = null, { limit = 40 } = {}) {
  const { out, q, known } = scoreAll({ words, pairs }, entries, docs, vec);
  // Related ideas: the terms nearest the query, not ones it already has.
  const asked = new Set([...words, ...pairs].map((x) => x.t));
  const related = [];
  if (q) {
    const cand = [];
    for (let i = 0; i < vec.concepts.length; i++) {
      const t = vec.concepts[i][1];
      if (asked.has(t) || t.split(' ').every((w) => asked.has(w))) continue;
      const s = near(q, vec.cvec, i, vec.dims);
      if (s > 0.45) cand.push([s * fit(vec.concepts[i], docs.n), i]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    for (const [, i] of cand) {
      const [shown, t] = vec.concepts[i];
      // Not two forms of one idea: "network" after "neural network".
      if (related.some(([, r]) => r.split(' ').includes(t) || t.split(' ').includes(r))) continue;
      related.push([shown, t]);
      if (related.length >= 10) break;
    }
  }
  // Subjects the top results gather in.
  const subj = new Map();
  for (const x of out.slice(0, 50)) subj.set(docs.subj[x.i], (subj.get(docs.subj[x.i]) ?? 0) + x.score);
  const total = [...subj.values()].reduce((a, b) => a + b, 0) || 1;
  const subjects = [...subj].sort((a, b) => b[1] - a[1]).filter(([, v]) => v / total >= 0.12).slice(0, 4).map(([s, v]) => [docs.subjects[s], v / total]);
  // One row for courses with the same title (cross-listed ones, AE 115 / ENVE 115 Linear Algebra, the
  // eight Music Ensembles): the best one leads, the others ride along.
  const rows = [];
  const byTitle = new Map();
  for (const x of out) {
    const key = docs.titles[x.i].toLowerCase();
    const lead = byTitle.get(key);
    if (lead) {
      lead.also.push(x.i);
      lead.mask |= x.mask;
      continue;
    }
    x.also = [];
    byTitle.set(key, x);
    rows.push(x);
  }
  // The row's course: an undergraduate one before a graduate one, a current one before an old one.
  const kind = (i) => (docs.flags[i] & 4 ? 2 : docs.flags[i] & 2 ? 1 : 0);
  for (const x of rows) {
    const best = [x.i, ...x.also].reduce((a, b) => (kind(b) < kind(a) ? b : a));
    if (best !== x.i) x.also = [x.i, ...x.also.filter((j) => j !== best)];
    x.i = best;
  }
  // Whether any course has every word asked for.
  const all = known.length < 2 || out.some((x) => x.hits.size === known.length);
  return { results: rows.slice(0, limit), related, subjects, total: rows.length, all };
}

/** Courses nearest one course in LSA space, and the ideas nearest it: "courses like CS 341". */
export function like(i, docs, vec, { limit = 20 } = {}) {
  const q = Array.from(vec.docs.slice(i * vec.dims, (i + 1) * vec.dims), (x) => x / 127);
  const len = Math.hypot(...q) || 1;
  const v = q.map((x) => x / len);
  const out = [];
  for (let j = 0; j < docs.n; j++) {
    if (j === i || docs.flags[j] & 4) continue;
    const s = near(v, vec.docs, j, vec.dims);
    if (s > 0.5) out.push({ i: j, score: s, lex: 0, sem: s, mask: 0, hits: new Set(), also: [] });
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set([docs.titles[i].toLowerCase()]);
  const rows = out.filter((x) => !seen.has(docs.titles[x.i].toLowerCase()) && seen.add(docs.titles[x.i].toLowerCase())).slice(0, limit);
  const related = [];
  const cand = [];
  for (let k = 0; k < vec.concepts.length; k++) {
    const s = near(v, vec.cvec, k, vec.dims);
    if (s > 0.45) cand.push([s * fit(vec.concepts[k], docs.n), k]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  for (const [, k] of cand) {
    const [shown, t] = vec.concepts[k];
    if (related.some(([, r]) => r.split(' ').includes(t) || t.split(' ').includes(r))) continue;
    related.push([shown, t]);
    if (related.length >= 10) break;
  }
  return { results: rows, related, subjects: [], total: rows.length, all: true };
}

/** Edit distance up to a limit (for spelling fixes). */
export function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** A word the index doesn't have → the commonest one a letter or two away, or null. vocab: [[shown, term, df]] */
export function respell(word, vocab) {
  const max = word.length <= 4 ? 0 : word.length <= 7 ? 1 : 2;
  if (!max) return null;
  for (const v of vocab) if (v[0] !== word && within(word, v[0], max)) return v;
  return null;
}
