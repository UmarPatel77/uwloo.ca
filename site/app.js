import { normalizeCode } from '/route.js';

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
  const render = () => {
    if (!box.value.trim()) {
      list.innerHTML = '';
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<li class="empty">No course matches “${esc(box.value.trim())}”. Try a subject like “math” or a title word like “calculus”.</li>`;
      return;
    }
    list.innerHTML = rows
      .map(([code, title], i) => `<li><a id="r${i}" role="option" href="/${code.toLowerCase()}/" aria-selected="${i === active}"><span class="cc">${esc(fmt(code))}</span><span>${esc(title)}</span></a></li>`)
      .join('');
  };
  const update = async () => {
    rows = search(box.value, await loadIndex());
    active = rows.length ? 0 : -1;
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
    const subject = /^[a-z]{2,8}/i.exec(miss.dataset.query)?.[0];
    if (!hits.length && subject) hits = search(subject, rows, 8); // cs999 → other CS courses
    if (hits.length) {
      miss.innerHTML = `<h2>Closest courses</h2><ul class="results">${hits
        .map(([code, title]) => `<li><a href="/${code.toLowerCase()}/"><span class="cc">${esc(fmt(code))}</span><span>${esc(title)}</span></a></li>`)
        .join('')}</ul>`;
    }
  });
}
