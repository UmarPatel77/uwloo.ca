// r/uwaterloo discussions on course pages. Used by the build (first entries, in the page) and in the
// browser ("Show all", from /reddit/{code}.json), so both render the same markup.
// Entries come from tools/reddit/index_dump.py: verbatim excerpts, never reworded.

const R = 'https://www.reddit.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function termOf(t) {
  const d = new Date(t * 1000);
  const m = d.getUTCMonth();
  return `${m < 4 ? 'Winter' : m < 8 ? 'Spring' : 'Fall'} ${d.getUTCFullYear()}`;
}

const day = (t) => {
  const d = new Date(t * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const plural = (n, w) => `${n.toLocaleString('en-CA')} ${w}${n === 1 ? '' : 's'}`;
const user = (name) => (name ? `<a class="rd-user" href="${R}/user/${encodeURIComponent(name)}/">u/${esc(name)}</a>` : '<span class="rd-user">[deleted]</span>');
const postUrl = (e) => `${R}/r/uwaterloo/comments/${e.post}/`;
const commentUrl = (e, id, context) => `${R}/r/uwaterloo/comments/${e.post}/_/${id}/${context ? `?context=${context}` : ''}`;

/** Where "View on Reddit" goes: the thread starter's branch (post + every reply above the mention). */
export function threadUrl(e) {
  if (e.starter) return commentUrl(e, e.starter);
  if (e.comment) return commentUrl(e, e.comment, 3);
  return postUrl(e);
}

function removeUrl(e, code, repo) {
  const ids = [e.comment && `comment ${e.comment}`, e.starter && `thread starter ${e.starter}`, `post ${e.post}`].filter(Boolean);
  const title = `Remove Reddit quote ${e.comment ?? e.post} (${code})`;
  const body = `Please remove this from uwloo.ca:\n${threadUrl(e)}\n\nIds: ${ids.join(', ')}\n\nWhich part (the post, the thread starter, the reply, or all of it)?\n`;
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/**
 * Mentions grouped by thread, newest activity first. A thread holds the post (marked as a hit when
 * the post itself names the course) and each reply that does, under the comment that started its branch.
 */
/** One mention on its own (a thread of one). */
export function entryHtml(e, code, opts) {
  return threadHtml(groupThreads([e])[0], code, opts);
}

export function groupThreads(entries) {
  const byPost = new Map();
  for (const e of entries) {
    let th = byPost.get(e.post);
    if (!th) {
      th = { post: e.post, title: e.title, score: e.score, n: e.n, t: e.t, hit: false, post_text: null, post_author: null, branches: new Map() };
      byPost.set(e.post, th);
    }
    th.t = Math.max(th.t, e.t);
    if (e.post_text && !th.post_text) th.post_text = e.post_text;
    if (e.in === 'post') {
      th.hit = true;
      th.post_text = e.post_text ?? th.post_text;
      th.post_author = e.post_author ?? null;
      continue;
    }
    // A branch is rooted at its top-level comment. When that comment names the course itself, it's
    // shown once, as a hit, instead of as both the starter and a reply.
    const key = e.starter ?? e.comment;
    let br = th.branches.get(key);
    if (!br) {
      br = { starter: null, root: null, replies: [] };
      th.branches.set(key, br);
    }
    if (!e.starter) br.root = e;
    else {
      br.starter ??= { id: e.starter, author: e.starter_author, text: e.starter_text };
      br.replies.push(e);
    }
  }
  const out = [...byPost.values()];
  for (const th of out) {
    th.branches = [...th.branches.values()];
    for (const br of th.branches) br.replies.sort((a, b) => a.t - b.t);
    const first = (br) => (br.root ?? br.replies[0]).t;
    th.branches.sort((a, b) => first(a) - first(b));
  }
  return out.sort((a, b) => b.t - a.t);
}

const quote = (author, text, cls) =>
  `<p class="rd-q ${cls}">${user(author)}: ${text === '[deleted]' ? '<span class="t">[deleted]</span>' : `“${esc(text)}”`}</p>`;

/** One thread card. */
export function threadHtml(th, code, { repo = 'UmarPatel77/uwloo.ca' } = {}) {
  const parts = [];
  if (th.post_text) {
    // The post's author is credited when the post itself names the course; otherwise it's context only.
    parts.push(th.hit ? quote(th.post_author, th.post_text, 'rd-post rd-hit') : `<p class="rd-q rd-post">“${esc(th.post_text)}”</p>`);
  }
  const links = [];
  for (const br of th.branches) {
    if (br.root) {
      parts.push(quote(br.root.author, br.root.text, 'rd-hit'));
      links.push(br.root);
    } else if (br.starter) parts.push(quote(br.starter.author, br.starter.text, 'rd-starter'));
    for (const r of br.replies) {
      parts.push(quote(r.author, r.text, 'rd-hit rd-deep'));
      links.push(r);
    }
  }
  const view = links.length ? threadUrl(links[0]) : `${R}/r/uwaterloo/comments/${th.post}/`;
  const remove = removeUrl(links[0] ?? { post: th.post }, code, repo);
  return `<article class="rd">
  <p class="rd-head"><time datetime="${new Date(th.t * 1000).toISOString().slice(0, 10)}">${day(th.t)}</time> <a href="${R}/r/uwaterloo/comments/${th.post}/">${esc(th.title)}</a> <span class="t">${plural(th.score, 'point')}, ${plural(th.n, 'comment')}</span></p>
  ${parts.join('\n  ')}
  <p class="entry-links"><a href="${view}">View on Reddit</a><a href="${remove}">Remove this</a></p>
</article>`;
}

/** Threads under term headings (by latest activity), newest first. `limit` caps the number of threads. */
export function listHtml(entries, code, opts = {}) {
  const threads = groupThreads(entries).slice(0, opts.limit ?? Infinity);
  let out = '';
  let term = null;
  for (const th of threads) {
    const t = termOf(th.t);
    if (t !== term) {
      out += `<h3 class="rd-term">${t}</h3>`;
      term = t;
    }
    out += threadHtml(th, code, opts);
  }
  return out;
}

// In the browser: "Show all" loads the rest.
if (typeof document !== 'undefined') {
  const btn = document.getElementById('reddit-more');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      try {
        const res = await fetch(btn.dataset.src);
        if (!res.ok) throw new Error(res.status);
        const all = await res.json();
        document.getElementById('reddit-list').innerHTML = listHtml(all, btn.dataset.code, { repo: btn.dataset.repo });
        btn.remove();
      } catch {
        btn.disabled = false;
        btn.textContent = 'Couldn’t load them. Try again';
      }
    });
  }
}
