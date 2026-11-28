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
  // Anything but a course code: /search/, which finds courses by what they're about.
  location.href = code ? `/${code}/` : `/search/?q=${encodeURIComponent(v)}`;
}
const searchLink = (q) => `<li class="more"><a href="/search/?q=${encodeURIComponent(q)}">Search what courses are about: “${esc(q)}” →</a></li>`;

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
    const q = box.value.trim();
    const topic = q.length >= 3 && !normalizeCode(q);
    if (!rows.length) {
      list.innerHTML = `<li class="empty">No course matches “${esc(q)}”. Try a subject like “math” or a title word like “calculus”.</li>${topic ? searchLink(q) : ''}`;
      return;
    }
    list.innerHTML = (near ? `<li class="empty">No ${esc(fmt(normalizeCode(box.value)?.toUpperCase() ?? box.value.trim()))}. Nearest:</li>` : '') + rows
      .map(([code, title, old], i) => `<li><a id="r${i}" role="option" href="/${code.toLowerCase()}/" aria-selected="${i === active}"><span class="cc">${esc(fmt(code))}</span><span>${esc(title)}${old ? ' <span class="t">· no longer offered</span>' : ''}</span></a></li>`)
      .join('') + (topic && !near ? searchLink(q) : '');
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

// The timetable planner: the header's "Timetable" link shows how many courses are in the plan, and a course
// page's button adds the course to it without leaving the page (site/timetable/plans.js keeps the plans).
import(`/timetable/plans.js${new URL(import.meta.url).search}`)
  .then((Plans) => {
    Plans.paintCount();
    const box = document.querySelector('.plan-add');
    if (box && Plans.readPlans()) planButton(box, Plans);
    addEventListener('storage', (e) => {
      if (e.key !== 'uwloo.plans') return;
      Plans.paintCount();
      if (box) box.repaint?.();
    });
    // Back from the planner (the page may come from the browser's back-forward cache).
    addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      Plans.paintCount();
      box?.repaint?.();
    });
  })
  .catch(() => {});

function planButton(box, Plans) {
  const code = box.dataset.code;
  const name = box.dataset.name;
  const terms = JSON.parse(box.dataset.plan);
  const ctl = box.querySelector('.plan-ctl');
  const note = box.querySelector('.plan-note');
  let term = null;
  let quiet = 0;
  const open = (t, label) => `<a class="plan-open" href="/timetable/?t=${t}">${label}</a>`;
  box.repaint = (focus = false) => {
    const all = Plans.readPlans();
    if (!all) return;
    term = Plans.chooseTerm(all, terms);
    let t = terms.find((x) => x.term === term);
    let codes = Plans.codesOf(all.terms[term]);
    // Nothing planned yet and the course isn't in that term: offer the term it is in.
    if (!t?.has && !codes.length) {
      const other = [...terms].reverse().find((x) => x.has);
      if (other) {
        t = other;
        term = other.term;
        codes = Plans.codesOf(all.terms[term]);
      }
    }
    const n = codes.length;
    const so = n ? open(term, `${n} course${n === 1 ? '' : 's'} so far →`) : '';
    let html;
    if (codes.includes(code)) {
      html = `<button type="button" class="plan-btn" aria-pressed="true">✓ In your ${esc(t.name)} timetable</button>${open(term, 'See timetables →')}`;
    } else if (!t.has) {
      const other = [...terms].reverse().find((x) => x.has);
      html = `<span class="plan-no">Not scheduled in ${esc(t.name)}</span>${other ? `<a class="plan-open" href="/timetable/?t=${other.term}&amp;c=${code}">Plan ${esc(other.name)} with ${esc(name)} →</a>` : ''}`;
    } else if (n >= 8) {
      html = `<span class="plan-no">Your ${esc(t.name)} timetable has 8 courses, the most it takes</span>${open(term, 'Open it →')}`;
    } else {
      html = `<button type="button" class="plan-btn" aria-pressed="false">+ Add to ${esc(t.name)} timetable</button>${so}`;
    }
    ctl.innerHTML = html;
    if (focus) ctl.querySelector('.plan-btn')?.focus();
  };
  box.addEventListener('click', (e) => {
    if (!e.target.closest('.plan-btn')) return;
    const all = Plans.readPlans();
    if (!all || !term) return;
    const t = terms.find((x) => x.term === term);
    const codes = Plans.toggleCourse(all, term, code);
    if (!codes || !Plans.writePlans(all)) return;
    const n = codes.length;
    note.textContent = codes.includes(code)
      ? `Added. ${n} course${n === 1 ? '' : 's'} in your ${t.name} timetable.`
      : `Taken out of your ${t.name} timetable.`;
    clearTimeout(quiet);
    quiet = setTimeout(() => (note.textContent = ''), 6000);
    Plans.paintCount(all);
    box.repaint(true);
  });
  box.repaint();
}

// Pathways (the degree planner) keeps its grid in this browser. Pages use it to say what's yours: a course's page
// where the course is in your grid, a plan's page whether it's one of your plans and which of its courses you have
// (✓), and lists of plans ("Counts toward", a subject's plans, /programs) which ones you picked.
function pathwaysGrid() {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem('uwloo.pathways') ?? 'null');
  } catch {}
  if (s?.v !== 1 || !Array.isArray(s.rows) || !/^\d{4}$/.test(String(s.start))) return null;
  const SEASON = { 1: 'Winter', 5: 'Spring', 9: 'Fall' };
  const where = new Map(); // code → "3A, Fall 2028"
  let t = String(s.start);
  let n = 0;
  for (const r of s.rows) {
    const level = r.k === 's' ? `${Math.floor(n / 2) + 1}${n % 2 ? 'B' : 'A'}` : r.k === 'c' ? 'work term' : '';
    for (const c of r.c ?? []) if (c && !where.has(c)) where.set(c, `${level ? `${level}, ` : ''}${SEASON[t.slice(-1)]} ${1900 + Number(t.slice(0, 3))}`);
    if (r.k === 's') n++;
    const y = Number(t.slice(0, 3));
    const se = Number(t.slice(-1));
    t = se === 9 ? `${y + 1}1` : `${y}${se + 4}`;
  }
  return { where, plans: new Set(s.plans ?? []) };
}
function markPathways() {
  const pw = pathwaysGrid();
  for (const el of document.querySelectorAll('.pw-yours, .pw-mark')) el.remove();
  for (const a of document.querySelectorAll('a.in-grid')) {
    a.classList.remove('in-grid');
    a.removeAttribute('title');
  }
  if (!pw || (!pw.where.size && !pw.plans.size)) return;
  const tie = document.querySelector('.deg-tie[data-code]');
  if (tie) {
    const at = pw.where.get(tie.dataset.code);
    tie.classList.toggle('in', Boolean(at));
    tie.querySelector('a').textContent = at ? `✓ In your degree plan: ${at}` : `Plan your degree with ${fmt(tie.dataset.code)}`;
  }
  for (const a of document.querySelectorAll('main li > a[href^="/programs/"]')) {
    if (pw.plans.has(a.getAttribute('href').split('/')[2])) a.insertAdjacentHTML('afterend', ' <span class="pw-yours">yours</span>');
  }
  const link = document.querySelector('.plan-link a[href^="/pathways/#add="]');
  if (link) {
    const yours = pw.plans.has(decodeURIComponent(link.getAttribute('href').slice(15)));
    link.textContent = yours ? 'See it in your Pathways grid' : 'Map it out term by term in Pathways';
    if (yours) link.insertAdjacentHTML('beforebegin', '<span class="pw-mark pw-yours">One of your plans</span> ');
  }
  let n = 0;
  const seen = new Set();
  for (const a of document.querySelectorAll('main a.cc[href]')) {
    if (a.getAttribute('href') === location.pathname) continue;
    const code = a.getAttribute('href').replace(/\//g, '').toUpperCase();
    const at = pw.where.get(code);
    if (!at) continue;
    a.classList.add('in-grid');
    a.title = `In your degree plan: ${at}`;
    if (!seen.has(code)) {
      seen.add(code);
      n++;
    }
  }
  if (link && n) link.closest('.plan-link').insertAdjacentHTML('afterend', `<p class="pw-mark t">✓ marks the ${n === 1 ? 'course' : `${n} courses`} here in your Pathways grid.</p>`);
}
markPathways();
addEventListener('storage', (e) => e.key === 'uwloo.pathways' && markPathways());
addEventListener('pageshow', (e) => e.persisted && markPathways());
