import { nearby, normalizeCode } from '/route.js';

let index = null;
async function loadIndex() {
  if (!index) index = fetch('/search.json').then((r) => r.json()).catch(() => []);
  return index;
}

const fmt = (code) => code.replace(/^([A-Z]+)(\d)/, '$1 $2');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function search(q, rows, limit = 12) {
  const raw = q.trim().toLowerCase();
  if (!raw) return [];
  const compact = raw.replace(/[\s\-_.]+/g, '');
  const words = raw.split(/\s+/);
  const scored = [];
  for (const row of rows) {
    const code = row[0].toLowerCase();
    const title = row[1].toLowerCase();
    let s = -1;
    if (code === compact) s = 0;
    else if (code.startsWith(compact)) s = 1 + code.length / 100;
    else if (title.startsWith(raw)) s = 2;
    else if (title.includes(raw)) s = 3;
    else if (words.every((w) => title.includes(w) || code.startsWith(w))) s = 4;
    if (s >= 0 && row[2]) s += 0.5; // no longer offered: after current courses that match as well
    if (s >= 0) scored.push([s, row]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1][0].localeCompare(b[1][0], 'en', { numeric: true }));
  return scored.slice(0, limit).map((x) => x[1]);
}

function go(value) {
  const v = value.trim();
  if (!v) return;
  const code = normalizeCode(v);
  location.href = code ? `/${code}/` : `/?q=${encodeURIComponent(v)}`;
}

// Header jump box on every page. "/" focuses it.
const jump = document.querySelector('form.jump');
if (jump) {
  jump.addEventListener('submit', (e) => {
    e.preventDefault();
    go(jump.q.value);
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      (document.getElementById('home-q') ?? jump.q).focus();
    }
  });
}

// Home page search.
const box = document.getElementById('home-q');
const list = document.getElementById('results');
if (box && list) {
  let active = -1;
  let rows = [];
  let near = false; // rows are the nearest courses to a code that doesn't exist
  const render = () => {
    if (!box.value.trim()) {
      list.innerHTML = '';
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<li class="empty">No course matches “${esc(box.value.trim())}”. Try a subject like “math” or a title word like “calculus”.</li>`;
      return;
    }
    list.innerHTML = (near ? `<li class="empty">No ${esc(fmt(normalizeCode(box.value)?.toUpperCase() ?? box.value.trim()))}. Nearest:</li>` : '') + rows
      .map(([code, title, old], i) => `<li><a id="r${i}" role="option" href="/${code.toLowerCase()}/" aria-selected="${i === active}"><span class="cc">${esc(fmt(code))}</span><span>${esc(title)}${old ? ' <span class="t">· no longer offered</span>' : ''}</span></a></li>`)
      .join('');
  };
  const update = async () => {
    const idx = await loadIndex();
    rows = search(box.value, idx);
    near = !rows.length;
    if (near) rows = nearby(box.value, idx, 8);
    active = rows.length && !near ? 0 : -1; // Enter on a code that doesn't exist goes to its page, which says so
    render();
  };
  box.addEventListener('focus', loadIndex, { once: true });
  box.addEventListener('input', update);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      render();
    }
  });
  box.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && rows[active]) location.href = `/${rows[active][0].toLowerCase()}/`;
    else go(box.value);
  });
  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    box.value = q;
    update();
  }
}

// Not-found page: offer the closest courses.
const miss = document.getElementById('suggest');
if (miss?.dataset.query) {
  loadIndex().then((rows) => {
    let hits = search(miss.dataset.query, rows, 8);
    if (!hits.length) hits = nearby(miss.dataset.query, rows, 8); // cs421 → CS 420, 418, 431…
    const subject = /^[a-z]{2,8}/i.exec(miss.dataset.query)?.[0];
    if (!hits.length && subject) hits = search(subject, rows, 8);
    if (hits.length) {
      miss.innerHTML = `<h2>Closest courses</h2><ul class="results">${hits
        .map(([code, title, old]) => `<li><a href="/${code.toLowerCase()}/"><span class="cc">${esc(fmt(code))}</span><span>${esc(title)}${old ? ' <span class="t">· no longer offered</span>' : ''}</span></a></li>`)
        .join('')}</ul>`;
    }
  });
}

// Course page sections that fold (r/uwaterloo, UW Flow): each stays open or closed the way you last left
// it (this browser only).
for (const fold of document.querySelectorAll('details[data-fold]')) {
  const key = `uwloo.${fold.dataset.fold}`;
  try {
    if (localStorage.getItem(key) === 'closed') fold.open = false;
  } catch {}
  fold.addEventListener('toggle', () => {
    try {
      localStorage.setItem(key, fold.open ? 'open' : 'closed');
    } catch {}
  });
}
