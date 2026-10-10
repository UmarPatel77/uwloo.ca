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
  return `<section class="reddit" aria-labelledby="reddit-h">
  <h2 id="reddit-h">Discussed on r/uwaterloo</h2>
  <p class="t">${n === 1 ? 'One post or comment' : `${n.toLocaleString('en-CA')} posts and comments`} in ${s(threads, 'thread')} ${n === 1 ? 'mentions' : 'mention'} ${fmtCode(code)}, ${monthYear(first)} to ${monthYear(through)}. Quoted word for word, newest first; each reply sits under the post and the comment that started its branch. <a href="${search}">Search r/uwaterloo for newer posts</a>.</p>
  <div id="reddit-list">${listHtml(entries, code, { repo, limit: SHOWN })}</div>
  ${threads > SHOWN ? `<button type="button" id="reddit-more" class="more" data-src="/reddit/${slug}.json" data-code="${code}" data-repo="${repo}">Show all ${s(threads, 'thread')}</button>
  <script type="module" src="/reddit.js?v=${version}"></script>` : ''}
</section>`;
}
