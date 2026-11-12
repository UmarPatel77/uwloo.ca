// UW Flow's ratings and comments on course pages (uwloo.ca/cs135): how many students liked a course and found
// it easy and useful, and a few of their comments, quoted with a link back to UW Flow for the rest.
//
// From UW Flow's public GraphQL API, the one its own site uses (uwflow.com/graphql; its robots.txt allows
// everything; schema from github.com/UWFlow/uwflow). The build fetches it at most once a week, in pages,
// and keeps it in .cache/uwflow/. If UW Flow can't be reached, the last copy is used; with no copy, the
// section is left out. UWFLOW=off skips it.
//
// Comments are quoted without their authors' names. data/uwflow/removed.txt lists comments (review ids)
// people asked to take down; the build drops them.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { esc, fmtCode, slug } from './requisites.mjs';

const ENDPOINT = process.env.UWFLOW_GRAPHQL ?? 'https://uwflow.com/graphql';
export const CACHE = '.cache/uwflow/flow.json';
const MAX_AGE_DAYS = Number(process.env.UWFLOW_MAX_AGE_DAYS ?? 7);
const PAGE = 1000;
const MAX_PAGES = 400; // a ceiling, far above UW Flow's size, so a misbehaving API can't loop forever
const KEEP = 5; // comments kept per course
const CLIP = 700; // characters shown of a long comment
const UA = 'uwloo (+https://uwloo.ca)';
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ratings: every course, `liked` is the share who liked it; `easy` and `useful` are averages on 0 to 1.
const RATINGS = `query ($limit: Int, $offset: Int) {
  course(order_by: { id: asc }, limit: $limit, offset: $offset) {
    code
    rating { liked easy useful filled_count comment_count }
  }
}`;
// Comments: every review with a course comment, with its upvotes ("helpful").
const REVIEWS = `query ($limit: Int, $offset: Int) {
  review(order_by: { id: asc }, limit: $limit, offset: $offset, where: { course_comment: { _is_null: false } }) {
    id
    created_at
    liked
    course_easy
    course_useful
    course_comment
    course { code }
    course_review_rating { upvote_count }
  }
}`;

async function gql(query, variables, fetchImpl) {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message ?? 'GraphQL error');
  return body.data;
}

async function pages(query, key, fetchImpl, pause) {
  const out = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const rows = (await gql(query, { limit: PAGE, offset: i * PAGE }, fetchImpl))?.[key] ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    await sleep(pause);
  }
  return out;
}

const code = (c) => String(c ?? '').replace(/\s+/g, '').toUpperCase();
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** API rows → {CS135: {liked, easy, useful, ratings, comments, top: [up to KEEP comments, most helpful first]}} */
export function shape(courses, reviews) {
  const out = {};
  for (const c of courses ?? []) {
    const r = c.rating;
    if (!c.code || !r || !(r.filled_count > 0 || r.comment_count > 0)) continue;
    out[code(c.code)] = { liked: r.liked ?? null, easy: r.easy ?? null, useful: r.useful ?? null, ratings: r.filled_count ?? 0, comments: r.comment_count ?? 0, top: [] };
  }
  const by = new Map();
  for (const r of reviews ?? []) {
    const k = code(r.course?.code);
    const text = clean(r.course_comment);
    if (!out[k] || !text) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ id: r.id, date: String(r.created_at ?? '').slice(0, 10), liked: r.liked ?? null, easy: r.course_easy ?? null, useful: r.course_useful ?? null, up: r.course_review_rating?.upvote_count ?? 0, text });
  }
  for (const [k, list] of by) {
    list.sort((a, b) => b.up - a.up || b.date.localeCompare(a.date) || b.id - a.id);
    out[k].top = list.slice(0, KEEP);
  }
  return out;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Review ids people asked to take down (data/uwflow/removed.txt, one per line, # comments). */
export async function loadRemovals(path = 'data/uwflow/removed.txt') {
  const text = await readFile(path, 'utf8').catch(() => '');
  return new Set(text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter((l) => /^\d+$/.test(l)).map(Number));
}

/**
 * {courses: {CS135: …}, fetchedAt} or null. Fresh enough (a week) → the cache; else fetch, falling back to the
 * cache if UW Flow fails.
 */
export async function loadFlow({ fetchImpl = fetch, path = CACHE, now = Date.now(), pause = 400, log = console, enabled = process.env.UWFLOW !== 'off', removedPath } = {}) {
  if (!enabled) return null;
  const hit = await readJson(path);
  let data = hit;
  if (!hit || now - Date.parse(hit.fetchedAt) > MAX_AGE_DAYS * DAY) {
    try {
      const courses = await pages(RATINGS, 'course', fetchImpl, pause);
      const reviews = await pages(REVIEWS, 'review', fetchImpl, pause);
      data = { fetchedAt: new Date(now).toISOString(), courses: shape(courses, reviews) };
      await mkdir(path.replace(/\/[^/]+$/, ''), { recursive: true });
      await writeFile(`${path}.part`, JSON.stringify(data));
      await rename(`${path}.part`, path);
      log.log(`UW Flow: ${Object.keys(data.courses).length} courses rated, ${reviews.length} comments read`);
    } catch (err) {
      log.warn(`! UW Flow: ${err.message}${hit ? `; using the copy from ${hit.fetchedAt.slice(0, 10)}` : '; leaving it out'}`);
    }
  } else {
    log.log(`UW Flow: ${Object.keys(hit.courses).length} courses rated (cached ${hit.fetchedAt.slice(0, 10)})`);
  }
  if (!data) return null;
  const removed = await loadRemovals(removedPath);
  if (removed.size) for (const f of Object.values(data.courses)) f.top = f.top.filter((t) => !removed.has(t.id));
  return data;
}

// ---------------- the section ----------------

const pct = (x) => (x == null ? null : `${Math.round(x * 100)}%`);
const n = (k, w) => `${k.toLocaleString('en-CA')} ${w}${k === 1 ? '' : 's'}`;
const month = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

function clip(text) {
  if (text.length <= CLIP) return esc(text);
  const cut = text.slice(0, CLIP).replace(/\s+\S*$/, '');
  return `${esc(cut)}…`;
}

function removeUrl(t, c, repo) {
  const title = `Remove UW Flow comment ${t.id} (${fmtCode(c)})`;
  const body = `Please remove this UW Flow comment from uwloo.ca/${slug(c)}/:\n\nReview id: ${t.id}\n\n> ${t.text.slice(0, 200)}\n`;
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** "Reviewed on UW Flow": ratings, then the most helpful comments. Folds like the r/uwaterloo section. */
export function flowSection(c, f, { repo }) {
  if (!f || !(f.ratings > 0 || f.top.length)) return '';
  const url = `https://uwflow.com/course/${slug(c)}`;
  const stats = [
    [pct(f.liked), 'liked it'],
    [pct(f.easy), 'easy'],
    [pct(f.useful), 'useful'],
  ].filter(([v]) => v);
  const counts = [f.ratings && n(f.ratings, 'rating'), f.comments && n(f.comments, 'comment')].filter(Boolean).join(' and ');
  const items = f.top
    .map((t) => {
      const bits = [month(t.date), t.liked === 1 ? 'liked it' : t.liked === 0 ? 'didn’t like it' : null, t.up ? `${t.up} found this helpful` : null].filter(Boolean).join(' · ');
      return `<li><p class="rd-q flow-q">${clip(t.text).replace(/\n+/g, '<br>')}</p>
  <p class="entry-links"><span class="t">${esc(bits)}</span><a href="${url}">On UW Flow</a><a href="${removeUrl(t, c, repo)}">Remove this</a></p></li>`;
    })
    .join('\n');
  return `<section class="uwflow" aria-labelledby="flow-h"><details class="rd-fold" data-fold="uwflow" open>
  <summary><h2 id="flow-h">Reviewed on UW Flow</h2></summary>
  ${stats.length ? `<p class="flow-stats">${stats.map(([v, w]) => `<span><b>${v}</b> ${w}</span>`).join('')}</p>` : ''}
  <p class="t">${counts ? `From ${counts} on UW Flow. ` : ''}${f.top.length ? 'The most helpful comments, quoted as written, without names. ' : ''}<a href="${url}">Read them all on UW Flow</a>.</p>
  ${items ? `<ul class="flow-list">${items}</ul>` : ''}
</details></section>`;
}
