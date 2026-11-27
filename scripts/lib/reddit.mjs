// r/uwaterloo mentions for course pages. Data: data/reddit/{SUBJ}.json from tools/reddit/index_dump.py.
// data/reddit/removed.txt lists what people asked to take down; the build drops it before rendering.
import { readdir, readFile } from 'node:fs/promises';
import { groupThreads, listHtml } from '../../site/reddit.js';

const fmtCode = (code) => code.replace(/^([A-Z]+)([0-9])/, '$1 $2');
export const SHOWN = 12; // threads in the page; the rest load on "Show all"

/**
 * removed.txt, one per line: a Reddit id (abc123, t1_abc123, t3_xyz) or a username (u/name).
 * A removed comment drops its entries; a removed thread starter loses its quote; a removed post drops
 * every entry in that thread; a removed username drops their quotes everywhere.
 */
export function parseRemovals(text) {
  const ids = new Set();
  const users = new Set();
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const u = /^\/?u\/([A-Za-z0-9_-]+)$/.exec(line);
    if (u) users.add(u[1].toLowerCase());
    else ids.add(line.replace(/^t[13]_/, ''));
  }
  return { ids, users };
}

export function applyRemovals(entries, { ids, users }) {
  const gone = (id, author) => (id && ids.has(id)) || (author && users.has(author.toLowerCase()));
  const out = [];
  for (const e of entries) {
    if (ids.has(e.post) || (e.comment && gone(e.comment, e.author))) continue;
    if (e.in === 'post' && gone(null, e.post_author)) continue;
    const x = { ...e };
    if (x.post_text && gone(null, x.post_author)) delete x.post_text;
    if (x.starter && gone(x.starter, x.starter_author)) x.starter_text = '[deleted]';
    out.push(x);
  }
  return out;
}

/** Map code -> entries (newest first), removals applied. Empty map when there's no data. */
export async function loadReddit(dir = 'data/reddit') {
  const map = new Map();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => /^[A-Z]+\.json$/.test(f));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { map, meta: null };
  }
  let removals = { ids: new Set(), users: new Set() };
  try {
    removals = parseRemovals(await readFile(`${dir}/removed.txt`, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const f of files) {
    const codes = JSON.parse(await readFile(`${dir}/${f}`, 'utf8'));
    for (const [code, entries] of Object.entries(codes)) {
      const kept = applyRemovals(entries, removals);
      if (kept.length) map.set(code, kept);
    }
  }
  let meta = null;
  try {
    meta = JSON.parse(await readFile(`${dir}/_meta.json`, 'utf8'));
  } catch {}
  return { map, meta, removed: removals.ids.size + removals.users.size };
}

const OVERRIDE = /\boverr(?:ide|ides|iding|idden|ode)\b/i;

/**
 * Where students talk about overrides: for each course, how many of its posts and comments mention one, and the
 * threads to read first (ones whose title is about an override, then the newest). For Pathways' override box:
 * { CODE: [mentions, [[title, post id, time], …]] }. A course is kept when a thread's title is about an override,
 * or at least three mentions say the word (one passing "maybe you can override" isn't a pattern).
 */
export function overrideTalk(map, { threads = 2 } = {}) {
  const out = {};
  for (const [code, entries] of map) {
    const byPost = new Map();
    // A title that names this course too ("Override CS240 without CS245") is about it, not just near it.
    const num = /\d.*$/.exec(code)?.[0] ?? code;
    const named = new RegExp(`(?:^|[^0-9A-Za-z])${num}(?![0-9A-Za-z])|${code.slice(0, code.length - num.length)}\\s*${num}(?![0-9A-Za-z])`, 'i');
    let n = 0;
    for (const e of entries) {
      const titled = OVERRIDE.test(e.title ?? '');
      if (!titled && !OVERRIDE.test(e.text ?? '') && !(e.in === 'post' && OVERRIDE.test(e.post_text ?? ''))) continue;
      n++;
      const th = byPost.get(e.post) ?? { title: e.title ?? '', post: e.post, t: 0, titled, rank: (titled ? 2 : 0) + (named.test(e.title ?? '') ? 1 : 0), n: 0 };
      th.t = Math.max(th.t, e.t ?? 0);
      th.n++;
      byPost.set(e.post, th);
    }
    const list = [...byPost.values()].filter((x) => x.title);
    if (!list.some((x) => x.titled) && n < 3) continue;
    list.sort((a, b) => b.rank - a.rank || b.t - a.t);
    out[code] = [n, list.slice(0, threads).map((x) => [x.title, x.post, x.t])];
  }
  return out;
}

const monthYear = (t) => new Date(t * 1000).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The "Discussed on r/uwaterloo" section for one course page, or '' when nobody mentioned it. */
export function redditSection(code, entries, meta, { repo, slug, version = '' }) {
  if (!entries?.length) return '';
  const first = entries.at(-1).t;
  const through = meta?.through ?? entries[0].t;
  const search = `https://www.reddit.com/r/uwaterloo/search/?q=${encodeURIComponent(`"${fmtCode(code)}" OR ${code}`)}&restrict_sr=1&sort=new`;
  const n = entries.length;
  const threads = groupThreads(entries).length;
  const s = (k, w) => `${k.toLocaleString('en-CA')} ${w}${k === 1 ? '' : 's'}`;
  // Folds away from its heading; app.js remembers whether you last left it open or closed.
  return `<section class="reddit" aria-labelledby="reddit-h"><details class="rd-fold" data-fold="reddit" open>
  <summary><h2 id="reddit-h">Discussed on r/uwaterloo</h2></summary>
  <p class="t">${n === 1 ? 'One post or comment' : `${n.toLocaleString('en-CA')} posts and comments`} in ${s(threads, 'thread')} ${n === 1 ? 'mentions' : 'mention'} ${fmtCode(code)}, ${monthYear(first)} to ${monthYear(through)}. Quoted word for word, newest first; each reply sits under the post and the comment that started its branch. <a href="${search}">Search r/uwaterloo for newer posts</a>.</p>
  <div id="reddit-list">${listHtml(entries, code, { repo, limit: SHOWN })}</div>
  ${threads > SHOWN ? `<button type="button" id="reddit-more" class="more" data-src="/reddit/${slug}.json" data-code="${code}" data-repo="${repo}">Show all ${s(threads, 'thread')}</button>
  <script type="module" src="/reddit.js?v=${version}"></script>` : ''}
</details></section>`;
}
