// uwloo.ca/search: courses by what they're about. Index files: scripts/lib/search.mjs; ranking: rank.js;
// words: text.js. The query is in the address (?q=), so a search can be shared or bookmarked.
import { fold, shardOf, stem, STOP } from '/search/text.js';
import { like, loadVec, queryTerms, rank, respell } from '/search/rank.js';
import { normalizeCode } from '/route.js';

const root = document.getElementById('search');
const V = root.dataset.v;
const form = root.querySelector('form');
const box = document.getElementById('sx-q');
const out = document.getElementById('sx-out');
const sugg = document.getElementById('sx-sugg');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (code) => code.replace(/^([A-Z]+)(\d)/, '$1 $2');
const json = (path) => fetch(`/search/${path}?v=${V}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status}`))));

let docs = null;
let vec = null;
let vocab = null;
const shards = new Map(); // i → Promise of the shard
const snippets = new Map(); // subject → Promise of {code: [description, links]}
const shard = (i) => {
  if (!shards.has(i)) shards.set(i, json(`t/${i}.json`).catch(() => ({})));
  return shards.get(i);
};
const snippetsFor = (subject) => {
  if (!snippets.has(subject)) snippets.set(subject, json(`s/${subject}.json`).catch(() => ({})));
  return snippets.get(subject);
};
const docsReady = json('docs.json').then((d) => (docs = d));
// LSA vectors: what courses are about. Results come without them first, then re-rank when they're in.
const vecReady = json('vec.json')
  .then((v) => (vec = loadVec(v)))
  .catch(() => null);
const vocabReady = () => (vocab ??= json('vocab.json').catch(() => []));

const EXAMPLES = ['dynamic programming', 'fourier series', 'game theory', 'machine learning', 'latin', 'thermodynamics', 'shakespeare', 'climate change', 'stochastic calculus', 'jazz'];
const WHERE = [
  [1, 'title'],
  [2, 'subject'],
  [4, 'description'],
  [8, 'course websites'],
  [16, 'r/uwaterloo'],
];

let shown = 20;
let last = null; // {q, res, qt}
let run = 0;

/** A course's text with the query's words marked: each word stemmed and compared. */
function mark(text, stems) {
  return esc(text).replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g, (w) => {
    const parts = fold(w).split(/[^a-z0-9]+/).filter(Boolean);
    return parts.some((p) => !STOP.has(p) && stems.has(stem(p))) ? `<mark>${w}</mark>` : w;
  });
}
/** The sentence or two of a description with the most of the query's words. */
function snippet(text, stems) {
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]*(\s|$)/g) ?? [text];
  const count = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w && stems.has(stem(w))).length;
  let best = 0;
  sentences.forEach((s, i) => {
    if (count(s) > count(sentences[best])) best = i;
  });
  let pick = sentences[best].trim();
  if (pick.length < 120 && sentences[best + 1]) pick += ` ${sentences[best + 1].trim()}`;
  return `${best > 0 ? '… ' : ''}${mark(pick.length > 300 ? `${pick.slice(0, 300).replace(/\s+\S*$/, '')}…` : pick, stems)}`;
}

function resultHtml(x, k, snips, stems) {
  const i = x.i;
  const codes = [i, ...x.also];
  const code = docs.codes[i];
  const subj = docs.subjects[docs.subj[i]];
  const f = docs.flags[i];
  const [desc, links] = snips.get(code) ?? ['', []];
  const where = WHERE.filter(([m]) => x.mask & m).map(([, w]) => w);
  const linkHits = links.filter(([t]) => fold(t).split(/[^a-z0-9]+/).some((w) => w && stems.has(stem(w)))).slice(0, 2);
  const why = where.length ? `Matched in its ${where.join(', ').replace(/, ([^,]+)$/, ' and $1')}` : last?.asCode ? 'Covers much the same ground' : 'About related ideas, though it doesn’t use the words';
  const meta = [subj[1] && subj[1] !== subj[0] ? subj[1] : '', f & 2 ? 'graduate' : f & 4 ? '' : 'undergraduate', f & 4 ? 'no longer offered' : ''].filter(Boolean).join(' · ');
  const also = x.also.length ? ` <span class="sx-also">also ${x.also.map((j) => `<a href="/${docs.codes[j].toLowerCase()}/">${esc(fmt(docs.codes[j]))}</a>`).join(', ')}</span>` : '';
  return `<li class="sx-r${f & 4 ? ' old' : ''}" style="--k:${k}">
<h2><a href="/${code.toLowerCase()}/"><span class="sx-code">${esc(fmt(code))}</span> ${mark(docs.titles[i], stems)}</a>${also}</h2>
<p class="sx-meta">${esc(meta)}${codes.length > 1 ? ` · ${codes.length} courses` : ''}</p>
${desc ? `<p class="sx-snip">${snippet(desc, stems)}</p>` : ''}
${linkHits.length ? `<ul class="sx-links">${linkHits.map(([t, u]) => `<li><a href="${esc(u)}" rel="noopener">${mark(t, stems)}</a> <span class="t">${esc(u.startsWith('/') ? 'uwloo' : new URL(u).hostname.replace(/^www\./, ''))}</span></li>`).join('')}</ul>` : ''}
<p class="sx-why t">${esc(why)}${x.mask & 16 ? ` · <a href="/${code.toLowerCase()}/#reddit-h">what r/uwaterloo says</a>` : ''}</p>
</li>`;
}

async function search(q, { push = false } = {}) {
  const id = ++run;
  q = q.trim();
  const url = q ? `/search/?q=${encodeURIComponent(q)}` : '/search/';
  if (push && location.pathname + location.search !== url) history.pushState(null, '', url);
  document.title = q ? `${q} · Search courses | uwloo` : 'Search courses by topic | uwloo';
  if (!q) {
    out.innerHTML = `<p class="sx-try">Try ${EXAMPLES.map((e) => `<a href="/search/?q=${encodeURIComponent(e)}" data-q="${esc(e)}">${esc(e)}</a>`).join(' · ')}</p>`;
    last = null;
    return;
  }
  out.setAttribute('aria-busy', 'true');
  await docsReady;
  // A course code goes straight to its page, with anything about it below.
  const code = normalizeCode(q)?.toUpperCase();
  const direct = code && docs.codes.includes(code) ? code : null;
  let qt = queryTerms(q);
  // Words the index doesn't have: the nearest one it does, by spelling.
  const missing = [];
  const fetchAll = async (t) => new Map(await Promise.all([...t.words, ...t.pairs].map(async (x) => [x.t, (await shard(shardOf(x.t)))[x.t]])));
  let entries = await fetchAll(qt);
  let fixed = null;
  if (qt.words.some((w) => !entries.get(w.t))) {
    const voc = await vocabReady();
    let changed = false;
    const words = q.split(/\s+/).map((w) => {
      const f = fold(w).replace(/[^a-z0-9]/g, '');
      if (!f || STOP.has(f) || entries.get(stem(f))) return w;
      const alt = respell(f, voc);
      if (!alt) {
        missing.push(w);
        return w;
      }
      changed = true;
      return alt[0];
    });
    if (changed) {
      fixed = words.join(' ');
      qt = queryTerms(fixed);
      entries = await fetchAll(qt);
    }
  }
  if (id !== run) return;
  // A course code: the courses most like it, by what they cover.
  const asCode = direct && !qt.words.some((w) => entries.get(w.t)?.d < 200);
  const res = asCode && vec ? like(docs.codes.indexOf(direct), docs, vec) : rank(qt, entries, docs, vec, { limit: 200 });
  last = { q, res, qt, entries, direct, fixed, missing, asCode };
  await draw(id);
}

async function draw(id) {
  const { q, res, qt, direct, fixed, missing, asCode } = last;
  const stems = new Set([...qt.words.map((w) => w.t)]);
  const rows = res.results.slice(0, shown);
  const snips = new Map();
  await Promise.all([...new Set(rows.map((x) => docs.subjects[docs.subj[x.i]][0]))].map(async (s) => Object.entries(await snippetsFor(s)).forEach(([c, v]) => snips.set(c, v))));
  if (id !== run) return;
  const parts = [];
  if (direct) parts.push(`<p class="sx-direct"><a href="/${direct.toLowerCase()}/">Go to <b>${esc(fmt(direct))}</b> ${esc(docs.titles[docs.codes.indexOf(direct)])} →</a></p>`);
  if (fixed) parts.push(`<p class="sx-fix">Showing results for <a href="/search/?q=${encodeURIComponent(fixed)}" data-q="${esc(fixed)}"><b>${esc(fixed)}</b></a>. <span class="t">No course uses “${esc(q)}” as written.</span></p>`);
  else if (missing.length && !res.results.length) parts.push(`<p class="sx-fix">No course mentions “${esc(missing.join(' '))}”.</p>`);
  if (res.related.length) parts.push(`<div class="sx-rel"><span class="t">Related</span> ${res.related.map(([s]) => `<a href="/search/?q=${encodeURIComponent(s)}" data-q="${esc(s)}">${esc(s)}</a>`).join('')}</div>`);
  if (res.subjects.length > 1 || (res.subjects.length === 1 && res.subjects[0][1] > 0.5)) parts.push(`<div class="sx-subj"><span class="t">Mostly in</span> ${res.subjects.map(([[s, name]]) => `<a href="/${s.toLowerCase()}/">${esc(name && name !== s ? `${name} (${s})` : s)}</a>`).join('')}</div>`);
  if (!res.all && res.results.length) parts.push(`<p class="sx-note t">No course has all of those words; these have some of them, or are about something close.</p>`);
  if (!res.results.length) parts.push(`<p class="sx-none">Nothing found. Try fewer words, a broader idea, or ${EXAMPLES.slice(0, 3).map((e) => `<a href="/search/?q=${encodeURIComponent(e)}" data-q="${esc(e)}">${esc(e)}</a>`).join(', ')}.</p>`);
  else parts.push(`<p class="sx-count t">${asCode ? `Courses like ${esc(fmt(direct))}, by what they cover` : `${res.total > 200 ? 'More than 200' : res.total} ${res.total === 1 ? 'course' : 'courses'}${vec ? '' : ' (still loading what courses are about)'}`}</p><ol class="sx-list">${rows.map((x, k) => resultHtml(x, k, snips, stems)).join('')}</ol>${res.results.length > shown ? `<p><button type="button" class="sx-more" data-more>Show more</button></p>` : ''}`);
  out.innerHTML = parts.join('');
  out.removeAttribute('aria-busy');
}

// Suggestions: ideas that start with what's typed ("machine l" → machine learning), then words that finish it.
let picks = [];
let active = -1;
async function suggest() {
  const raw = box.value;
  const t = fold(raw).replace(/\s+/g, ' ').trimStart();
  if (t.length < 2 || normalizeCode(raw)) return closeSugg();
  await vecReady;
  const voc = await vocabReady();
  const head = t.replace(/\S*$/, '');
  const tail = /\S*$/.exec(t)[0];
  const seen = new Set();
  picks = [];
  for (const [s] of vec?.concepts ?? []) {
    if (s.startsWith(t) && s !== t.trim() && !seen.has(s)) {
      seen.add(s);
      picks.push(s);
      if (picks.length >= 5) break;
    }
  }
  if (tail.length >= 2)
    for (const [s] of voc) {
      const full = `${head}${s}`;
      if (s.startsWith(tail) && s !== tail && !seen.has(full)) {
        seen.add(full);
        picks.push(full);
        if (picks.length >= 8) break;
      }
    }
  if (box.value !== raw) return;
  active = -1;
  sugg.innerHTML = picks.map((p, i) => `<li role="option" id="sx-o${i}" data-pick="${esc(p)}" aria-selected="false">${esc(p)}</li>`).join('');
  sugg.hidden = !picks.length;
  box.setAttribute('aria-expanded', String(!!picks.length));
}
function closeSugg() {
  picks = [];
  sugg.hidden = true;
  sugg.innerHTML = '';
  box.setAttribute('aria-expanded', 'false');
  box.removeAttribute('aria-activedescendant');
}

let timer = 0;
box.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(suggest, 90);
});
box.addEventListener('keydown', (e) => {
  if (!picks.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + picks.length + 1) % (picks.length + 1);
    if (active === picks.length) active = -1;
    [...sugg.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) box.setAttribute('aria-activedescendant', `sx-o${active}`);
    else box.removeAttribute('aria-activedescendant');
  } else if (e.key === 'Escape') closeSugg();
  else if (e.key === 'Enter' && active >= 0) {
    e.preventDefault();
    box.value = picks[active];
    closeSugg();
    shown = 20;
    search(box.value, { push: true });
  }
});
box.addEventListener('blur', () => setTimeout(closeSugg, 150));
sugg.addEventListener('mousedown', (e) => {
  const li = e.target.closest('[data-pick]');
  if (!li) return;
  e.preventDefault();
  box.value = li.dataset.pick;
  closeSugg();
  shown = 20;
  search(box.value, { push: true });
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  closeSugg();
  shown = 20;
  search(box.value, { push: true });
});
out.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-q]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    box.value = a.dataset.q;
    shown = 20;
    search(box.value, { push: true });
    window.scrollTo({ top: 0 });
    return;
  }
  if (e.target.closest('[data-more]') && last) {
    shown += 20;
    draw(run);
  }
});
window.addEventListener('popstate', () => {
  box.value = new URLSearchParams(location.search).get('q') ?? '';
  shown = 20;
  search(box.value);
});
// When what courses are about arrives, the results take it in.
vecReady.then(() => {
  if (last) search(last.q);
});

box.value = new URLSearchParams(location.search).get('q') ?? '';
search(box.value).catch((err) => {
  out.innerHTML = `<p class="sx-none">Search couldn’t load (${esc(err.message)}). Reload the page to try again.</p>`;
});
if (!box.value) box.focus();
