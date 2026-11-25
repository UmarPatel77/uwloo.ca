// uwloo.ca/search: find courses by what they're about ("dynamic programming", "latin", "fourier"), not just
// by code or title. Built once per build from every course's title, its subject, its calendar descriptions
// (this year's and older ones), the course websites and files found for it, and what r/uwaterloo says about
// it. Runs in the browser with no server:
//
//   search/docs.json      every course: code, title, subject, a few flags
//   search/vocab.json     words with how many courses use them (spelling fixes, suggestions)
//   search/t/{0-127}.json postings, by term (site/search/text.js's shardOf): the courses a term is in, with
//                         BM25 weights and where it matched, and the term's LSA vector
//   search/vec.json       LSA vectors for every course and for terms to offer as related ideas
//   search/s/{SUBJ}.json  a description and links per course, for the results' snippets
//
// LSA (latent semantic analysis): a truncated SVD of the term × course matrix (randomized and seeded, so builds
// repeat), DIMS dimensions, as 8-bit numbers. A course that's about a topic without its words is near it there.

import { esc } from './requisites.mjs';
import { shell } from './render.mjs';
import { shardOf, terms } from '../../site/search/text.js';

// BM25F: each field's weight, and how much its length counts against it (a long r/uwaterloo thread doesn't
// make a course's description count for less).
const FIELDS = { title: 3, subject: 1.5, desc: 1, links: 0.8, reddit: 0.35 };
const LENGTH = { title: 0.3, subject: 0, desc: 0.6, links: 0.5, reddit: 0.75 };
const MASK = { title: 1, subject: 2, desc: 4, links: 8, reddit: 16 };
const REDDIT_CHARS = 12000; // per course, so the most-discussed courses don't drown the rest
const K1 = 1.2;
const POSTINGS = 120; // courses kept per term, the highest weights
const DIMS = 48;
const CONCEPTS = 5000; // terms the browser can offer as related ideas
// Words of the calendar's and r/uwaterloo's boilerplate: not an idea on their own or together ("honours plan",
// "resources page"), though fine in one ("integer programming").
const GENERIC = new Set(['honour', 'plan', 'program', 'major', 'minor', 'option', 'world', 'resourc', 'page', 'involv', 'project', 'onlin', 'requir', 'recommend', 'enrol', 'permiss', 'depart', 'faculti', 'consent', 'instructor', 'scs', 'cdn', 'http', 'www', 'ca', 'com', 'org', 'pdf', 'html']);

/** A seeded random number generator (mulberry32), so the SVD and the files it makes are the same each build. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  const u = rand() || 1e-12;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Orthonormal columns (modified Gram-Schmidt), in place. cols: Float64Array[] */
function orth(cols) {
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    for (let j = 0; j < i; j++) {
      const p = cols[j];
      let d = 0;
      for (let k = 0; k < c.length; k++) d += c[k] * p[k];
      for (let k = 0; k < c.length; k++) c[k] -= d * p[k];
    }
    let n = 0;
    for (let k = 0; k < c.length; k++) n += c[k] * c[k];
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < c.length; k++) c[k] /= n;
  }
  return cols;
}

/** Eigenvalues and eigenvectors of a small symmetric matrix (Jacobi), largest first. S: number[][] */
function eig(S) {
  const n = S.length;
  const a = S.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[y][y] - a[x][x]);
  return { values: order.map((i) => Math.max(0, a[i][i])), vectors: order.map((i) => v.map((row) => row[i])) };
}

/**
 * Rank-DIMS SVD of a sparse matrix given by rows: [{idx: Int32Array, val: Float32Array}] over nCols columns.
 * → {U: Float32Array rows×DIMS, V: Float32Array nCols×DIMS, sigma}
 */
function svd(rows, nCols, dims = DIMS, { power = 2, over = 16, seed = 1 } = {}) {
  const l = dims + over;
  const rand = rng(seed);
  const nRows = rows.length;
  const mulX = (M) => {
    // X · M: M is nCols × l (columns), the result nRows × l.
    const out = Array.from({ length: l }, () => new Float64Array(nRows));
    rows.forEach((r, t) => {
      for (let c = 0; c < l; c++) {
        const m = M[c];
        let s = 0;
        for (let k = 0; k < r.idx.length; k++) s += r.val[k] * m[r.idx[k]];
        out[c][t] = s;
      }
    });
    return out;
  };
  const mulXt = (M) => {
    // Xᵀ · M: M is nRows × l, the result nCols × l.
    const out = Array.from({ length: l }, () => new Float64Array(nCols));
    rows.forEach((r, t) => {
      for (let c = 0; c < l; c++) {
        const m = M[c][t];
        if (!m) continue;
        const o = out[c];
        for (let k = 0; k < r.idx.length; k++) o[r.idx[k]] += r.val[k] * m;
      }
    });
    return out;
  };
  let Y = mulX(Array.from({ length: l }, () => Float64Array.from({ length: nCols }, () => gaussian(rand))));
  for (let i = 0; i < power; i++) Y = mulX(orth(mulXt(orth(Y))));
  const Q = orth(Y);
  const Bt = mulXt(Q); // nCols × l: (Qᵀ X)ᵀ
  const S = Array.from({ length: l }, (_, a) => Array.from({ length: l }, (_, b) => {
    let s = 0;
    const x = Bt[a];
    const y = Bt[b];
    for (let d = 0; d < nCols; d++) s += x[d] * y[d];
    return s;
  }));
  const { values, vectors } = eig(S);
  const sigma = values.slice(0, dims).map(Math.sqrt);
  const U = new Float32Array(nRows * dims);
  const V = new Float32Array(nCols * dims);
  for (let c = 0; c < dims; c++) {
    const w = vectors[c];
    for (let t = 0; t < nRows; t++) {
      let s = 0;
      for (let a = 0; a < l; a++) s += Q[a][t] * w[a];
      U[t * dims + c] = s;
    }
    for (let d = 0; d < nCols; d++) {
      let s = 0;
      for (let a = 0; a < l; a++) s += Bt[a][d] * w[a];
      V[d * dims + c] = sigma[c] ? s / sigma[c] : 0;
    }
  }
  return { U, V, sigma };
}

/** Rows scaled by sigma, then to unit length: vectors to compare by cosine. */
function unitRows(M, n, sigma) {
  const dims = sigma.length;
  const out = new Float32Array(n * dims);
  for (let i = 0; i < n; i++) {
    let len = 0;
    for (let c = 0; c < dims; c++) {
      const x = M[i * dims + c] * sigma[c];
      out[i * dims + c] = x;
      len += x * x;
    }
    len = Math.sqrt(len) || 1;
    for (let c = 0; c < dims; c++) out[i * dims + c] /= len;
  }
  return out;
}

/** Ascending ids as gaps: [3, 10, 12] → [3, 7, 2]. */
const gaps = (ids) => ids.map((x, i) => (i ? x - ids[i - 1] : x));

/**
 * docs: [{code, title, subject, subjectName, flags, desc: [text], links: [{title, url}], reddit: [text]}]
 * → {files: [[path, content]], stats}
 */
export function searchIndex(docs) {
  const N = docs.length;
  const fieldOf = (d) => ({
    title: d.title,
    subject: d.subjectName && d.subjectName !== d.subject ? d.subjectName : '',
    desc: d.desc.join('\n'),
    links: d.links.map((l) => l.title).join('\n'),
    reddit: (() => {
      let out = '';
      for (const t of d.reddit) {
        if (out.length + t.length > REDDIT_CHARS) break;
        out += `${t}\n`;
      }
      return out;
    })(),
  });
  // Each field's length in words, for BM25F (a first pass that keeps only the counts, to spare memory).
  const lens = docs.map((d) => Object.fromEntries(Object.entries(fieldOf(d)).map(([name, text]) => [name, text ? terms(text, { pairs: false }).length : 0])));
  const avgLen = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, Math.max(1, lens.reduce((n, l) => n + l[f], 0) / Math.max(1, N))]));
  // Term frequencies per course, each field's normalized by its length and weighted, and where each term was.
  const tfs = [];
  const df = new Map();
  const said = new Map(); // courses whose own text (not r/uwaterloo) has a term
  const surf = new Map(); // term → Map surface → count: how a term is written, to show it
  docs.forEach((d, i) => {
    const tf = new Map();
    for (const [name, text] of Object.entries(fieldOf(d))) {
      if (!text) continue;
      const list = terms(text, { surfaces: true });
      const w = FIELDS[name] / (1 - LENGTH[name] + (LENGTH[name] * lens[i][name]) / avgLen[name]);
      for (const { t, s } of list) {
        const e = tf.get(t) ?? { tf: 0, m: 0 };
        e.tf += w;
        e.m |= MASK[name];
        tf.set(t, e);
        if (name !== 'reddit' || !surf.has(t)) {
          const m = surf.get(t) ?? new Map();
          if (m.size < 6 || m.has(s)) m.set(s, (m.get(s) ?? 0) + 1);
          surf.set(t, m);
        }
      }
    }
    for (const [t, e] of tf) {
      df.set(t, (df.get(t) ?? 0) + 1);
      if (e.m & ~MASK.reddit) said.set(t, (said.get(t) ?? 0) + 1);
    }
    tfs.push(tf);
  });
  // Terms worth keeping: in more than one course, or in a title, description or link (not a stray word in a
  // Reddit comment); word pairs in at least two courses.
  const keepTerm = (t, e) => {
    const n = df.get(t);
    const pair = t.includes(' ');
    if (pair) return n >= 3 || (n >= 2 && e.m & ~MASK.reddit);
    return n >= 2 || e.m & ~MASK.reddit;
  };
  const idf = (t) => Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
  const post = new Map(); // term → [[doc, weight, mask]]
  tfs.forEach((tf, i) => {
    for (const [t, e] of tf) {
      if (!keepTerm(t, e)) continue;
      const w = (idf(t) * e.tf * (K1 + 1)) / (e.tf + K1);
      if (!post.has(t)) post.set(t, []);
      post.get(t).push([i, w, e.m]);
    }
  });
  // LSA over terms in at least 3 courses and at most a quarter of them: a vector for each of those terms and for
  // each course, compared in the browser (a query's terms add up to one vector; courses and related ideas are
  // the nearest to it).
  const lsaTerms = [...post.keys()].filter((t) => df.get(t) >= 3 && df.get(t) <= N / 4);
  const rows = lsaTerms.map((t) => {
    const list = post.get(t);
    return { idx: Int32Array.from(list, (x) => x[0]), val: Float32Array.from(list, (x) => x[1]) };
  });
  const started = Date.now();
  const { U, V, sigma } = svd(rows, N, DIMS);
  const T = unitRows(U, lsaTerms.length, sigma);
  const D = unitRows(V, N, sigma);
  const lsaMs = Date.now() - started;
  const q8 = (M, i) => {
    const b = Buffer.alloc(DIMS);
    for (let c = 0; c < DIMS; c++) b.writeInt8(Math.max(-127, Math.min(127, Math.round(M[i * DIMS + c] * 127))), c);
    return b;
  };
  const lsaIndex = new Map(lsaTerms.map((t, i) => [t, i]));
  // How a term is written: its most common form.
  const shown = (t) => {
    const m = surf.get(t);
    return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : t;
  };
  // Postings files.
  const shards = Array.from({ length: 128 }, () => ({}));
  for (const [t, list] of post) {
    const top = list.sort((a, b) => b[1] - a[1]).slice(0, POSTINGS).sort((a, b) => a[0] - b[0]);
    const e = { p: gaps(top.map((x) => x[0])), w: top.map((x) => Math.round(x[1] * 20)), m: top.map((x) => x[2]), d: df.get(t) };
    if (lsaIndex.has(t)) e.v = q8(T, lsaIndex.get(t)).toString('base64');
    shards[shardOf(t)][t] = e;
  }
  // Related ideas to offer: terms in the calendar's own words (or a course website's) for a few courses but not
  // too many, single words and pairs, the commonest. Not Reddit's chatter ("study group", "3xx").
  const concepts = lsaTerms
    .filter((t) => (said.get(t) ?? 0) >= 3 && (said.get(t) / df.get(t) >= 0.4 || said.get(t) >= 15) && df.get(t) <= N / 12 && !/\d/.test(t) && !t.split(' ').every((w) => GENERIC.has(w)))
    .sort((a, b) => said.get(b) - said.get(a))
    .slice(0, CONCEPTS);
  const vec = {
    dims: DIMS,
    docs: Buffer.concat(Array.from({ length: N }, (_, i) => q8(D, i))).toString('base64'),
    concepts: concepts.map((t) => [shown(t), t, df.get(t), said.get(t)]),
    cvec: Buffer.concat(concepts.map((t) => q8(T, lsaIndex.get(t)))).toString('base64'),
  };
  // Every course, in order (ids in the postings are places in these lists).
  const subjects = [...new Set(docs.map((d) => d.subject))].sort();
  const subjectNames = Object.fromEntries(subjects.map((s) => [s, docs.find((d) => d.subject === s && d.subjectName)?.subjectName ?? s]));
  const si = new Map(subjects.map((s, i) => [s, i]));
  const docsFile = {
    v: 1,
    n: N,
    subjects: subjects.map((s) => [s, subjectNames[s]]),
    codes: docs.map((d) => d.code),
    titles: docs.map((d) => d.title),
    subj: docs.map((d) => si.get(d.subject)),
    flags: docs.map((d) => d.flags),
  };
  // Words to fix spelling against and to suggest: single words in three courses or more, commonest first.
  const vocab = [...post.keys()]
    .filter((t) => !t.includes(' ') && df.get(t) >= 3)
    .sort((a, b) => df.get(b) - df.get(a))
    .slice(0, 20000)
    .map((t) => [shown(t), t, df.get(t)]);
  // Snippets: each subject's descriptions and links.
  const bySubject = new Map();
  for (const d of docs) {
    if (!bySubject.has(d.subject)) bySubject.set(d.subject, {});
    const desc = d.desc[0] ?? '';
    bySubject.get(d.subject)[d.code] = [desc.length > 420 ? `${desc.slice(0, 420).replace(/\s+\S*$/, '')}…` : desc, d.links.slice(0, 6).map((l) => [l.title, l.url])];
  }
  const files = [
    ['search/docs.json', JSON.stringify(docsFile)],
    ['search/vec.json', JSON.stringify(vec)],
    ['search/vocab.json', JSON.stringify(vocab)],
    ...shards.map((s, i) => [`search/t/${i}.json`, JSON.stringify(s)]),
    ...[...bySubject].map(([s, m]) => [`search/s/${s}.json`, JSON.stringify(m)]),
  ];
  const bytes = files.reduce((n, [, c]) => n + c.length, 0);
  return { files, stats: { docs: N, terms: post.size, lsaTerms: lsaTerms.length, lsaMs, bytes } };
}

/**
 * The courses to search, from what the build has loaded: primary (code → {cat, course}), older calendars
 * ([cat]: older undergraduate years and Graduate Calendar terms), retired (code → {od, ga}), reddit (code →
 * mentions), and links (code → [{title, url}]).
 */
export function searchDocs({ primary, older = [], retired = new Map(), reddit = new Map(), links = new Map() }) {
  const docs = [];
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  // A thread about many courses at once (a megathread, a bot's announcement) says nothing about any one of them.
  const spread = new Map();
  for (const [code, list] of reddit) for (const m of list) for (const t of [m.title, m.text]) if (t) spread.set(clean(t), (spread.get(clean(t)) ?? new Set()).add(code));
  const redditText = (code) => {
    const seen = new Set();
    const out = [];
    for (const m of reddit.get(code) ?? []) {
      for (const t of [m.title, m.text]) {
        if ((spread.get(clean(t))?.size ?? 0) > 6) continue;
        const x = clean(t).replace(/^…\s*|\s*…$/g, '');
        if (x && !seen.has(x)) {
          seen.add(x);
          out.push(x);
        }
      }
    }
    return out;
  };
  const linkList = (code) => (links.get(code) ?? []).filter((l) => l.title && l.url).map((l) => ({ title: clean(l.title), url: l.url }));
  const olderDesc = (code, have) => {
    const out = [];
    for (const cat of older) {
      const c = cat.courses?.get(code);
      const d = clean(c?.description);
      if (d && d.length > 30 && !have.includes(d) && !out.includes(d)) out.push(d);
    }
    return out;
  };
  for (const [code, { cat, course }] of primary) {
    const desc = [clean(course.description)].filter((d) => d && !/^About [A-Z]+\d+[A-Z]?\.?$/.test(d));
    desc.push(...olderDesc(code, desc));
    docs.push({ code, title: clean(course.title), subject: course.subject, subjectName: clean(course.subjectName), flags: cat.level === 'grad' ? 2 : 1, desc, links: linkList(code), reddit: redditText(code) });
  }
  // Courses no longer offered, with a description from Open Data or an older Graduate Calendar.
  for (const [code, r] of retired) {
    if (primary.has(code)) continue;
    const title = clean(r.od?.title ?? r.ga?.latest?.title ?? '');
    const desc = [clean(r.od?.description ?? r.ga?.latest?.description)].filter(Boolean);
    desc.push(...olderDesc(code, desc));
    if (!title || !desc.length) continue;
    const subject = /^[A-Z]+/.exec(code)?.[0] ?? '';
    docs.push({ code, title, subject, subjectName: '', flags: 4, desc, links: linkList(code), reddit: redditText(code) });
  }
  docs.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  for (const d of docs) if (d.reddit.length) d.flags |= 8;
  // A subject's name from any of its courses that has one.
  const names = new Map();
  for (const d of docs) if (d.subjectName && d.subjectName !== d.subject) names.set(d.subject, d.subjectName);
  for (const d of docs) d.subjectName ||= names.get(d.subject) ?? '';
  return docs;
}

export function searchPage({ builtAt, version, count }) {
  const body = `<div class="sx" id="search" data-v="${esc(version)}">
<form class="sx-form" action="/search/" role="search">
  <label for="sx-q" class="sx-label">Search courses by what they’re about</label>
  <div class="sx-box"><input id="sx-q" name="q" type="search" placeholder="dynamic programming, latin, fourier series, game theory…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sx-sugg"><button type="submit">Search</button></div>
  <ul id="sx-sugg" class="sx-sugg" role="listbox" hidden></ul>
</form>
<p class="sx-lede t">${count.toLocaleString('en-CA')} Waterloo courses: their calendar descriptions, this year’s and older ones, the course websites and files found for them, and what r/uwaterloo says about them. Related ideas count too, so a search finds courses that cover a topic without naming it.</p>
<div id="sx-out" aria-live="polite"><noscript><p>Search needs JavaScript. <a href="/">Look up a course by its code</a> instead.</p></noscript></div>
</div>
<script type="module" src="/search/app.js?v=${esc(version)}"></script>`;
  return shell({
    title: 'Search courses by topic | uwloo',
    description: 'Search University of Waterloo courses by topic: calendar descriptions, course websites and r/uwaterloo, with related ideas.',
    path: '/search/',
    body,
    builtAt,
    version,
    head: `<link rel="stylesheet" href="/search/app.css?v=${esc(version)}">`,
  });
}
