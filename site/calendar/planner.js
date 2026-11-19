// uwloo.ca/calendar: add up to 8 courses, see the timetables that fit, best first.
// Data: /calendar/{term}.json (scripts/lib/planner.mjs). Search: solve.js, in a worker (worker.js).
// Everything the person picks is in the address (?t=1271&c=CS136,MATH138…), so a timetable can be shared, and in
// this browser's saved plans, one per term (plans.js), which course pages add to.
const root = document.getElementById('planner');
const V = root.dataset.v;
const TERMS = JSON.parse(root.dataset.terms);
const S = await import(`/calendar/solve.js?v=${V}`);
const { run } = await import(`/calendar/run.js?v=${V}`);
const { icsFile } = await import(`/calendar/ics.js?v=${V}`);
const Plans = await import(`/calendar/plans.js?v=${V}`);

const MAX = 8;
const KEEP = 60;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtCode = (c) => String(c).replace(/^([A-Z]+)(\d)/, '$1 $2');
const slug = (c) => String(c).toLowerCase();
const norm = (q) => String(q ?? '').replace(/[\s_.-]+/g, '').toUpperCase();
const ap = (m) => (m < 720 ? 'am' : 'pm');
const t12 = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')}`;
const range = (s, e) => (ap(s) === ap(e) ? `${t12(s)}–${t12(e)} ${ap(e)}` : `${t12(s)} ${ap(s)}–${t12(e)} ${ap(e)}`);
const hourLabel = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1} ${ap(m)}`;
const fmtDate = (d, o = { month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { ...o, timeZone: 'UTC' });
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hm = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------- state, kept in the address ----------------

const DEFAULT_TERM = Plans.defaultTerm(TERMS) ?? root.dataset.default;
// Whether changes are saved to this browser's plans. A timetable opened from a link is shown as it is and saved
// only once the person changes something, so opening someone's link doesn't replace their own plan.
let persist = false;
const state = {
  term: DEFAULT_TERM,
  courses: [],
  prefs: { ...S.DEFAULTS, blocks: [], locks: [] },
  view: 0,
  edit: null, // picks after a swap, until the person picks a ranked timetable again
  result: null,
  built: [],
  data: null,
  blocking: false,
};

/** Courses and preferences from a planner address (or a saved plan, which is the same without t). */
function apply(src) {
  state.courses = [...new Set((src.get('c') ?? '').split(',').map(norm).filter((c) => /^[A-Z]{2,8}\d/.test(c)))].slice(0, MAX);
  const p = state.prefs;
  const num = (k) => (src.has(k) && Number.isFinite(Number(src.get(k))) ? Number(src.get(k)) : null);
  p.start = num('s');
  p.end = num('e');
  p.off = num('off') ?? 0;
  const f = src.has('f') ? src.get('f') : 'g';
  p.fewerDays = f.includes('d');
  p.compact = f.includes('g');
  p.lunch = f.includes('l');
  p.skipFull = !f.includes('x');
  p.blocks = (src.get('b') ?? '')
    .split('_')
    .map((b) => b.split('-').map(Number))
    .filter((b) => b.length === 3 && b.every(Number.isFinite) && b[2] > b[1])
    .map(([mask, s, e]) => ({ mask, s, e }));
  p.locks = (src.get('l') ?? '').split('_').map(Number).filter((n) => n > 0);
}

function load() {
  const q = new URLSearchParams(location.search);
  const linked = TERMS.some((t) => t.term === q.get('t')) ? q.get('t') : null;
  if (q.has('c')) {
    state.term = linked ?? DEFAULT_TERM;
    apply(q);
    return;
  }
  // /calendar/ or /calendar/?t=1271: the saved plan for that term (or the term being planned).
  const all = Plans.readPlans();
  state.term = linked ?? Plans.chooseTerm(all, TERMS) ?? DEFAULT_TERM;
  apply(new URLSearchParams(all?.terms[state.term] ?? ''));
  persist = true;
}

function save() {
  const p = state.prefs;
  const q = new URLSearchParams();
  if (state.courses.length) q.set('c', state.courses.join(','));
  if (p.start != null) q.set('s', p.start);
  if (p.end != null) q.set('e', p.end);
  if (p.off) q.set('off', p.off);
  const f = `${p.fewerDays ? 'd' : ''}${p.compact ? 'g' : ''}${p.lunch ? 'l' : ''}${p.skipFull ? '' : 'x'}`;
  if (f !== 'g') q.set('f', f);
  if (p.blocks.length) q.set('b', p.blocks.map((b) => `${b.mask}-${b.s}-${b.e}`).join('_'));
  if (p.locks.length) q.set('l', p.locks.join('_'));
  const qs = Plans.tidy(q);
  history.replaceState(null, '', `${location.pathname}?t=${state.term}${qs ? `&${qs}` : ''}`);
  if (!persist) return;
  const all = Plans.readPlans();
  if (!all) return;
  all.terms[state.term] = qs;
  all.last = state.term;
  Plans.writePlans(all);
  Plans.paintCount(all);
}

// ---------------- data and search ----------------

const files = new Map();
function termFile(term) {
  if (!files.has(term)) {
    const asOf = TERMS.find((t) => t.term === term)?.asOf ?? '';
    files.set(
      term,
      fetch(`/calendar/${term}.json?a=${encodeURIComponent(asOf)}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return files.get(term);
}

// The search runs in a worker so typing stays smooth. A newer request replaces one still running: the old worker
// is stopped and a fresh one started. Browsers without module workers search on the page instead.
let workerOk = true;
const waiting = new Map();
let seq = 0;
function makeWorker() {
  if (!workerOk) return null;
  let w;
  try {
    w = new Worker(`/calendar/worker.js?v=${V}`, { type: 'module' });
  } catch {
    workerOk = false;
    return null;
  }
  w.onmessage = ({ data }) => {
    const job = waiting.get(data.id);
    if (!job) return;
    waiting.delete(data.id);
    job.resolve({ id: data.id, result: data.error ? run(S, job.term, job.entries, job.prefs) : data.result });
  };
  w.onerror = (e) => {
    e.preventDefault?.();
    workerOk = false;
    worker = null;
    for (const [id, job] of waiting) job.resolve({ id, result: run(S, job.term, job.entries, job.prefs) });
    waiting.clear();
  };
  return w;
}
let worker = makeWorker();
function compute(term, entries, prefs) {
  const id = ++seq;
  if (worker && waiting.size) {
    worker.terminate();
    for (const job of waiting.values()) job.resolve({ id: -1 });
    waiting.clear();
    worker = makeWorker();
  }
  if (!worker) return Promise.resolve({ id, result: run(S, term, entries, prefs) });
  return new Promise((resolve) => {
    waiting.set(id, { resolve, term, entries, prefs });
    worker.postMessage({ id, term, entries, prefs });
  });
}

let timer = 0;
let busyTimer = 0;
function update({ keepView = false, initial = false } = {}) {
  if (!initial) persist = true;
  save();
  renderChips();
  clearTimeout(timer);
  timer = setTimeout(() => go(keepView), 80);
}

async function go(keepView) {
  let data;
  try {
    data = await termFile(state.term);
  } catch {
    state.data = null;
    $('pl-out').innerHTML = `<p class="pl-msg">Couldn’t load ${esc(termName(state.term))}’s class schedule. Reload the page to try again.</p>`;
    return;
  }
  state.data = data;
  renderChips();
  const codes = state.courses.filter((c) => data.c[c]);
  const entries = Object.fromEntries(codes.map((c) => [c, data.c[c]]));
  const term = { from: data.from, to: data.to };
  const prefs = JSON.parse(JSON.stringify(state.prefs));
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => root.classList.add('pl-busy-on'), 250);
  const { id, result } = await compute(term, entries, prefs);
  if (id !== seq) return;
  clearTimeout(busyTimer);
  root.classList.remove('pl-busy-on');
  state.built = Object.entries(entries).map(([code, entry]) => S.buildCourse(code, entry, term, prefs));
  state.result = result;
  if (!keepView) state.view = 0;
  state.view = Math.min(state.view, Math.max(0, result.schedules.length - 1));
  state.edit = null;
  renderOut();
}

const termName = (t) => TERMS.find((x) => x.term === t)?.name ?? t;
const colour = (code) => state.courses.indexOf(code) % 8;
const picksOf = (s) => s.picks.map(([ci, comp, oi]) => ({ code: state.built[ci].code, comp, opt: state.built[ci].opts[comp][oi] }));
const current = () => state.edit ?? (state.result?.schedules[state.view] ? picksOf(state.result.schedules[state.view]) : null);

// ---------------- adding courses ----------------

const box = $('pl-q');
const list = $('pl-sugg');
let hits = [];
let active = -1;

function suggest() {
  const q = norm(box.value);
  const data = state.data;
  if (!q || !data) {
    hits = [];
  } else {
    const words = box.value.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const codes = Object.keys(data.c).filter((c) => !state.courses.includes(c));
    const byCode = codes.filter((c) => c.startsWith(q));
    const byTitle = q.length > 2 ? codes.filter((c) => !c.startsWith(q) && words.every((w) => data.c[c][0].toLowerCase().includes(w))) : [];
    hits = [...byCode, ...byTitle].slice(0, 8);
  }
  active = hits.length ? 0 : -1;
  list.innerHTML = hits
    .map((c, i) => `<li id="pl-s${i}" role="option" aria-selected="${i === active}" data-code="${c}"><b>${esc(fmtCode(c))}</b> <span>${esc(data.c[c][0])}</span></li>`)
    .join('');
  list.hidden = !hits.length;
  box.setAttribute('aria-expanded', String(!!hits.length));
  box.setAttribute('aria-activedescendant', active >= 0 ? `pl-s${active}` : '');
}

function add(codes) {
  let added = 0;
  for (const c of codes) {
    if (state.courses.length >= MAX) break;
    if (!state.courses.includes(c)) {
      state.courses.push(c);
      added++;
    }
  }
  box.value = '';
  suggest();
  if (added) update();
}

box.addEventListener('input', suggest);
box.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!hits.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    box.setAttribute('aria-activedescendant', `pl-s${active}`);
  } else if (e.key === 'Escape') {
    list.hidden = true;
  } else if (e.key === 'Backspace' && !box.value && state.courses.length) {
    state.courses.pop();
    update();
  }
});
$('pl-add').addEventListener('submit', (e) => {
  e.preventDefault();
  // Several codes at once ("cs136 math138, stat230") are all added; one partial code takes the top match.
  const many = [...box.value.matchAll(/([a-z]{2,8})\s*(\d{3}[a-z]?)/gi)].map((m) => `${m[1]}${m[2]}`.toUpperCase());
  if (many.length > 1 || (many.length === 1 && !hits.length)) add(many);
  else if (hits[active]) add([hits[active]]);
});
list.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-code]');
  if (!li) return;
  e.preventDefault();
  add([li.dataset.code]);
  box.focus();
});
box.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 100));
box.addEventListener('focus', suggest);

function renderChips() {
  const data = state.data;
  const probs = new Map(state.result?.problems ?? []);
  const notes = new Map();
  for (const [c, n] of state.result?.notes ?? []) notes.set(c, n);
  $('pl-chips').innerHTML = state.courses
    .map((c) => {
      const entry = data?.c[c];
      const other = !entry && TERMS.find((t) => t.term !== state.term && files.get(t.term)?.done?.c[c]);
      const warn = !data ? '' : !entry ? `Not scheduled in ${termName(state.term)}${other ? `; it is in ${other.name}` : ''}` : probs.get(c)?.startsWith('blocked') ? `Every ${probs.get(c).split(':')[1]} is in a time you blocked off` : notes.get(c) ?? '';
      return `<li class="pl-chip c${colour(c)}${entry ? '' : ' off'}"><a href="/${slug(c)}/"><b>${esc(fmtCode(c))}</b>${entry ? ` <span>${esc(entry[0])}</span>` : ''}</a>${warn ? `<small>${esc(warn)}</small>` : ''}<button type="button" data-remove="${c}" aria-label="Remove ${esc(fmtCode(c))}">×</button></li>`;
    })
    .join('');
  const full = state.courses.length >= MAX;
  box.disabled = full;
  box.placeholder = full ? '8 courses: the most it takes' : state.courses.length ? 'Add another' : 'cs136, math138, …';
}
$('pl-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  state.courses = state.courses.filter((c) => c !== b.dataset.remove);
  update();
});

// ---------------- term and preferences ----------------

function syncControls() {
  for (const b of document.querySelectorAll('[data-term]')) b.setAttribute('aria-pressed', String(b.dataset.term === state.term));
  const p = state.prefs;
  $('pl-start').value = p.start ?? '';
  $('pl-end').value = p.end ?? '';
  for (const b of document.querySelectorAll('[data-off]')) b.setAttribute('aria-pressed', String(!!(p.off & Number(b.dataset.off))));
  $('pl-fewer').checked = p.fewerDays;
  $('pl-compact').checked = p.compact;
  $('pl-lunch').checked = p.lunch;
  $('pl-full').checked = p.skipFull;
  $('pl-blocks').innerHTML = p.blocks
    .map((b, i) => `<li>${esc(S.maskText(b.mask))} ${esc(range(b.s, b.e))} <button type="button" data-unblock="${i}" aria-label="Remove this busy time">×</button></li>`)
    .join('');
}
root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-term]');
  if (t && t.dataset.term !== state.term) {
    // The other term's own plan if there is one; otherwise these courses, tried in that term.
    const saved = Plans.readPlans()?.terms[t.dataset.term];
    state.term = t.dataset.term;
    if (saved && Plans.codesOf(saved).length) apply(new URLSearchParams(saved));
    else state.prefs.locks = [];
    termFile(state.term).then((d) => (files.get(state.term).done = d)).catch(() => {});
    syncControls();
    update();
  }
  const off = e.target.closest('[data-off]');
  if (off) {
    state.prefs.off ^= Number(off.dataset.off);
    syncControls();
    update();
  }
  const ub = e.target.closest('[data-unblock]');
  if (ub) {
    state.prefs.blocks.splice(Number(ub.dataset.unblock), 1);
    syncControls();
    update({ keepView: true });
  }
});
for (const [id, key, f] of [
  ['pl-start', 'start', (v) => (v === '' ? null : Number(v))],
  ['pl-end', 'end', (v) => (v === '' ? null : Number(v))],
  ['pl-fewer', 'fewerDays', null],
  ['pl-compact', 'compact', null],
  ['pl-lunch', 'lunch', null],
  ['pl-full', 'skipFull', null],
])
  $(id).addEventListener('change', (e) => {
    state.prefs[key] = f ? f(e.target.value) : e.target.checked;
    update();
  });
$('pl-busyform').addEventListener('submit', (e) => {
  e.preventDefault();
  const mask = Number($('pl-bday').value);
  const s = Number($('pl-bfrom').value);
  const end = Number($('pl-bto').value);
  if (end > s) {
    state.prefs.blocks.push({ mask, s, e: end });
    syncControls();
    update({ keepView: true });
  }
});

// ---------------- the timetable ----------------

function bounds(picks, blocks) {
  let lo = 8 * 60;
  let hi = 18 * 60;
  let days = 31;
  for (const pk of picks ?? [])
    for (const m of pk.opt.meets)
      if (!m.one) {
        lo = Math.min(lo, Math.floor(m.s / 60) * 60);
        hi = Math.max(hi, Math.ceil(m.e / 60) * 60);
        days |= m.mask;
      }
  for (const b of blocks ?? []) days |= b.mask;
  const shown = [0, 1, 2, 3, 4, 5, 6].filter((d) => days & (1 << d));
  return { lo, hi, shown };
}

function gridHtml(picks, { mini = false, blocks = [] } = {}) {
  const { lo, hi, shown } = bounds(picks, mini ? [] : blocks);
  const span = hi - lo;
  const cols = shown
    .map((d) => {
      const bit = 1 << d;
      const items = [];
      (picks ?? []).forEach((pk, k) => {
        for (const m of pk.opt.meets) {
          if (m.one || !(m.mask & bit)) continue;
          const weeks = weeksText(m);
          const label = `${fmtCode(pk.code)} ${pk.comp} ${pk.opt.section.sec}, ${range(m.s, m.e)}${weeks ? `, ${weeks}` : ''}`;
          items.push(
            mini
              ? `<i class="c${colour(pk.code)}" style="--s:${m.s};--e:${m.e}"></i>`
              : `<button type="button" class="pl-blk c${colour(pk.code)}" style="--s:${m.s};--e:${m.e}" data-pick="${k}" aria-label="${esc(label)}"><b>${esc(fmtCode(pk.code))}</b> <em>${esc(pk.comp)}</em><span>${esc(range(m.s, m.e))}</span>${weeks ? `<span>${esc(weeks)}</span>` : ''}</button>`,
          );
        }
      });
      if (!mini)
        blocks.forEach((b, i) => {
          if (b.mask & bit)
            items.push(`<div class="pl-busy" style="--s:${b.s};--e:${b.e}"><span>Busy</span><button type="button" data-unblock="${i}" aria-label="Remove busy time ${esc(S.maskText(b.mask))} ${esc(range(b.s, b.e))}">×</button></div>`);
        });
      return `<div class="pl-col" data-day="${d}">${mini ? '' : `<div class="pl-dh">${S.DAYS[d]}</div>`}<div class="pl-day">${items.join('')}</div></div>`;
    })
    .join('');
  const hours = [];
  for (let h = lo; h < hi; h += 60) hours.push(`<span style="--s:${h}">${hourLabel(h)}</span>`);
  return `<div class="pl-grid${mini ? ' mini' : ''}" style="--lo:${lo};--span:${span};--n:${shown.length}">${mini ? '' : `<div class="pl-hours" aria-hidden="true"><div class="pl-dh"></div><div class="pl-day">${hours.join('')}</div></div>`}${cols}</div>`;
}

function seatsText(s) {
  if (!Number.isFinite(s.cap)) return '<span class="t">—</span>';
  if (s.full) return `<span class="pl-full">Full</span> <span class="t">${s.enrl}/${s.cap}</span>`;
  return `${s.cap - s.enrl} left <span class="t">of ${s.cap}</span>`;
}
// Which weeks a class meets, when that isn't the whole term: "Jan 11–Feb 12", "5 dates, Jan 19–Mar 30", "Jan 19 only".
function weeksText(m) {
  if (m.dates) return m.dates.length === 1 ? `${fmtDate(m.dates[0])} only` : `${m.dates.length} dates, ${fmtDate(m.from)}–${fmtDate(m.to)}`;
  return m.from && m.to && (m.from !== state.data?.from || m.to !== state.data?.to) ? `${fmtDate(m.from)}–${fmtDate(m.to)}` : '';
}
const meetText = (m) => {
  if (m.one) return `${fmtDate(m.from, { weekday: 'short', month: 'short', day: 'numeric' })}, ${range(m.s, m.e)}`;
  const w = m.dates ? weeksText(m) : '';
  return `${S.maskText(m.mask)} ${range(m.s, m.e)}${w ? ` (${w})` : ''}`;
};
const optText = (o) => (o.meets.filter((m) => !m.one).map(meetText).join(', ') || (o.meets.length ? o.meets.map(meetText).join(', ') : 'Online or no set time'));

function tableHtml(picks) {
  const locks = new Set(state.prefs.locks);
  return picks
    .map((pk, k) => {
      const s = pk.opt.section;
      const alts = S.alternatives(state.built, picks, k);
      const same = pk.opt.sections.slice(1).map((x) => `${x.comp} ${x.sec}`);
      const select =
        alts.length > 1
          ? `<label class="vh" for="pl-sw${k}">Swap ${esc(fmtCode(pk.code))} ${esc(pk.comp)}</label><select id="pl-sw${k}" data-swap="${k}">${alts
              .map((a, j) => {
                const label = `${a.opt.section.comp} ${a.opt.section.sec} · ${optText(a.opt)}${a.clash ? ` · clashes with ${fmtCode(a.clash.code)} ${a.clash.comp}` : a.opt.full ? ' · full' : ''}`;
                return `<option value="${j}"${a.opt === pk.opt ? ' selected' : ''}${a.clash ? ' disabled' : ''}>${esc(label)}</option>`;
              })
              .join('')}</select>`
          : '<span class="t">Only choice</span>';
      const locked = locks.has(Number(s.cls));
      return `<tr id="pl-row${k}"><th scope="row"><span class="pl-dot c${colour(pk.code)}" aria-hidden="true"></span><a href="/${slug(pk.code)}/">${esc(fmtCode(pk.code))}</a></th><td>${esc(s.comp)} ${esc(s.sec)}${same.length ? `<br><small class="t">or ${esc(same.join(', '))}, same time</small>` : ''}</td><td class="pl-cls">${esc(s.cls ?? '')}</td><td>${esc(optText(pk.opt))}</td><td>${seatsText(s)}</td><td>${select}</td><td><button type="button" class="pl-lock" data-lock="${esc(s.cls ?? '')}" aria-pressed="${locked}" title="${locked ? 'Unlock: let other timetables change this' : 'Lock: keep this section in every timetable'}">${locked ? 'Locked' : 'Lock'}</button></td></tr>`;
    })
    .join('');
}

function summary(m) {
  const bits = [
    plural(m.days, 'day') + ' on campus',
    m.first != null ? `${t12(m.first)} ${ap(m.first)} to ${t12(m.last)} ${ap(m.last)}` : null,
    m.gaps ? `${hm(m.gaps)} between classes` : 'no gaps',
    m.full ? `${plural(m.full, 'full section')}` : null,
    m.overlaps ? (m.overlaps === 1 ? '1 test clashes' : `${m.overlaps} tests clash`) : null,
  ].filter(Boolean);
  return bits.map((b) => `<span>${esc(b)}</span>`).join('');
}

function renderOut() {
  const out = $('pl-out');
  const r = state.result;
  const data = state.data;
  const asOf = TERMS.find((t) => t.term === state.term)?.asOf;
  const stamp = asOf ? `Seats as of ${new Date(asOf).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })}, from UW Open Data (Quest can be a day or two ahead).` : '';
  if (!data) return;
  const blocks = state.prefs.blocks;
  if (!state.built.length) {
    out.innerHTML = `<p class="pl-msg">${state.courses.length ? `None of these is scheduled in ${esc(termName(state.term))}.` : `Add a course to start. ${esc(Object.keys(data.c).length.toLocaleString('en-CA'))} courses have ${esc(termName(state.term))} sections.`}</p>${gridHtml([], { blocks })}<p class="t pl-stamp">${esc(stamp)}</p>`;
    return;
  }
  const picks = current();
  if (!picks) {
    const why = r.why;
    const lines = [];
    if (r.problems.length) lines.push(...r.problems.map(([c, p]) => (p.startsWith('blocked') ? `${fmtCode(c)}: every ${p.split(':')[1]} is in a time you blocked off.` : `${fmtCode(c)} has no sections.`)));
    if (why?.pairs.length) lines.push(...why.pairs.map(([a, b]) => `${fmtCode(a)} and ${fmtCode(b)} can’t be taken together: every pairing of their sections overlaps.`));
    else if (why?.drop.length) lines.push(`These can’t all fit, though any two can. Leave out ${why.drop.map(fmtCode).join(' or ')} and the rest fit.`);
    else if (!r.complete) lines.push('Too many combinations to finish searching. Lock a section or two, or remove a course.');
    if (state.prefs.locks.length || blocks.length) lines.push('Locked sections and busy times count; unlocking or removing them may help.');
    out.innerHTML = `<div class="pl-none"><h2>Nothing fits</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>${gridHtml([], { blocks })}<p class="t pl-stamp">${esc(stamp)}</p>`;
    return;
  }
  const m = S.metrics(picks);
  const n = r.schedules.length;
  const scope = r.all ? (n === 1 ? 'The only timetable that fits.' : `All ${n} timetables that fit, best first.`) : r.complete ? `The best ${n} of the timetables that fit.` : `The best ${n} uwloo found before it stopped looking. Lock a section to narrow it down.`;
  const online = picks.filter((p) => !p.opt.meets.length);
  const others = r.schedules.slice(0, 12);
  out.innerHTML = `<div class="pl-nav">
  <button type="button" class="pl-arrow" data-go="-1" aria-label="Previous timetable"${state.edit || state.view > 0 ? '' : ' disabled'}>‹</button>
  <div class="pl-which" aria-live="polite">${state.edit ? `<b>Your edit</b> <button type="button" class="pl-link" data-go="0">back to #${state.view + 1}</button>` : `<b>Timetable ${state.view + 1}</b> <span class="t">of ${n}</span>`}</div>
  <button type="button" class="pl-arrow" data-go="1" aria-label="Next timetable"${!state.edit && state.view < n - 1 ? '' : ' disabled'}>›</button>
  <p class="pl-sum">${summary(m)}</p>
</div>
${gridHtml(picks, { blocks })}
${online.length ? `<p class="t pl-online">Online or no set time: ${online.map((p) => `${esc(fmtCode(p.code))} ${esc(p.comp)} ${esc(p.opt.section.sec)}`).join(', ')}</p>` : ''}
${m.tests.length ? `<div class="pl-tests"><h3>Tests</h3><ul>${m.tests.map((t) => `<li><span class="pl-dot c${colour(t.pick.code)}" aria-hidden="true"></span>${esc(fmtCode(t.pick.code))} ${esc(t.pick.comp)}: ${esc(meetText(t))}${t.over ? ` <span class="pl-warn">overlaps ${esc(fmtCode(t.over.code))} ${esc(t.over.comp)}</span>` : ''}</li>`).join('')}</ul>${m.overlaps ? '<p class="t">A test that overlaps a class or another test doesn’t stop you enrolling: ask the instructors about writing it at another time.</p>' : ''}</div>` : ''}
<div class="scroll"><table class="pl-table"><caption>Sections in this timetable. Swap one to try another, or lock it to keep it while you look at others.</caption><thead><tr><th scope="col">Course</th><th scope="col">Section</th><th scope="col">Class</th><th scope="col">When</th><th scope="col">Seats</th><th scope="col">Swap</th><th scope="col"><span class="vh">Lock</span></th></tr></thead><tbody>${tableHtml(picks)}</tbody></table></div>
<div class="pl-actions">
  <button type="button" data-act="copy">Copy class numbers</button>
  <button type="button" data-act="ics">Add to calendar (.ics)</button>
  <button type="button" data-act="link">Copy link</button>
  <span class="t" id="pl-done" role="status"></span>
</div>
<p class="t">${esc(scope)} In Quest, add the class numbers to your shopping cart; a lecture can bring its tutorial with it, so check what Quest picks. ${esc(stamp)}</p>
${others.length > 1 ? `<h3 class="pl-oh">Other good timetables</h3><ol class="pl-others">${others.map((s, i) => `<li><button type="button" data-view="${i}" aria-current="${!state.edit && i === state.view}" aria-label="Timetable ${i + 1}">${gridHtml(picksOf(s), { mini: true })}<span>#${i + 1} · ${esc(summaryShort(S.metrics(picksOf(s))))}</span></button></li>`).join('')}</ol>` : ''}`;
}
const summaryShort = (m) => [plural(m.days, 'day'), m.first != null ? `${t12(m.first)}–${t12(m.last)}` : null, m.gaps ? `${hm(m.gaps)} gaps` : 'no gaps'].filter(Boolean).join(' · ');

function show(i) {
  state.edit = null;
  state.view = Math.max(0, Math.min(i, (state.result?.schedules.length ?? 1) - 1));
  renderOut();
}

$('pl-out').addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]');
  if (go) return go.dataset.go === '0' ? show(state.view) : state.edit ? show(state.view) : show(state.view + Number(go.dataset.go));
  const v = e.target.closest('[data-view]');
  if (v) {
    show(Number(v.dataset.view));
    $('pl-out').scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  const blk = e.target.closest('[data-pick]');
  if (blk && !state.blocking) {
    const row = $(`pl-row${blk.dataset.pick}`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row?.classList.add('pl-flash');
    setTimeout(() => row?.classList.remove('pl-flash'), 1200);
    row?.querySelector('select')?.focus({ preventScroll: true });
    return;
  }
  const lock = e.target.closest('[data-lock]');
  if (lock && lock.dataset.lock) {
    const cls = Number(lock.dataset.lock);
    const locks = state.prefs.locks;
    state.prefs.locks = locks.includes(cls) ? locks.filter((x) => x !== cls) : [...locks, cls];
    update();
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) await action(act);
});
$('pl-out').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-swap]');
  if (!sel) return;
  const picks = current();
  const k = Number(sel.dataset.swap);
  const alt = S.alternatives(state.built, picks, k)[Number(sel.value)];
  if (!alt || alt.clash) return;
  state.edit = picks.map((p, i) => (i === k ? { ...p, opt: alt.opt } : p));
  renderOut();
  $(`pl-sw${k}`)?.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (!state.result?.schedules.length) return;
    e.preventDefault();
    show(state.edit ? state.view : state.view + (e.key === 'ArrowRight' ? 1 : -1));
  }
});

// ---------------- copy, calendar file, link ----------------

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

async function action(act) {
  const picks = current();
  const done = $('pl-done');
  if (!picks) return;
  if (act === 'copy') {
    const by = new Map();
    for (const p of picks) {
      if (!by.has(p.code)) by.set(p.code, []);
      by.get(p.code).push(`${p.opt.section.cls} (${p.comp} ${p.opt.section.sec})`);
    }
    const text = `${[...by].map(([c, l]) => `${fmtCode(c)}: ${l.join(', ')}`).join('\n')}\n\nAll: ${picks.map((p) => p.opt.section.cls).join(', ')}`;
    done.textContent = (await copy(text)) ? 'Class numbers copied.' : 'Couldn’t copy; select them in the table instead.';
  } else if (act === 'link') {
    done.textContent = (await copy(location.href)) ? 'Link copied.' : 'Couldn’t copy the link.';
  } else if (act === 'ics') {
    const { text, skipped } = icsFile(picks, termName(state.term), { dayBit: S.dayBit });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/calendar' })), download: `uwloo-${state.term}.ics` });
    document.body.append(a);
    a.click();
    a.remove();
    done.textContent = `Saved uwloo-${state.term}.ics: open it to add the classes to your calendar. It doesn’t skip holidays or reading week.${skipped ? ` ${skipped} meetings had no dates and were left out.` : ''}`;
  }
  setTimeout(() => (done.textContent = ''), 8000);
}

// ---------------- blocking off time on the grid ----------------

$('pl-blockmode').addEventListener('click', () => {
  state.blocking = !state.blocking;
  $('pl-blockmode').setAttribute('aria-pressed', String(state.blocking));
  root.classList.toggle('pl-blocking', state.blocking);
});
let drag = null;
$('pl-out').addEventListener('pointerdown', (e) => {
  if (!state.blocking || e.target.closest('a, select, .pl-busy button')) return;
  const day = e.target.closest('.pl-col .pl-day');
  if (!day) return;
  const grid = day.closest('.pl-grid');
  const lo = Number(grid.style.getPropertyValue('--lo'));
  const span = Number(grid.style.getPropertyValue('--span'));
  const at = (y) => {
    const r = day.getBoundingClientRect();
    return Math.round((lo + (Math.max(0, Math.min(r.height, y - r.top)) / r.height) * span) / 30) * 30;
  };
  const start = at(e.clientY);
  const preview = Object.assign(document.createElement('div'), { className: 'pl-busy pl-preview' });
  day.append(preview);
  drag = { day, at, start, end: start + 30, preview, bit: 1 << Number(day.parentElement.dataset.day) };
  const paint = () => {
    const [s, en] = [Math.min(drag.start, drag.end), Math.max(drag.start, drag.end)];
    preview.style.setProperty('--s', s);
    preview.style.setProperty('--e', Math.max(en, s + 30));
  };
  paint();
  day.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    drag.end = drag.at(ev.clientY);
    paint();
  };
  const touch = e.pointerType === 'touch';
  const up = () => {
    // On a phone, dragging the timetable is also how you scroll, so blocking stops after each busy time.
    if (touch) $('pl-blockmode').click();
    day.removeEventListener('pointermove', move);
    day.removeEventListener('pointerup', up);
    day.removeEventListener('pointercancel', up);
    const s = Math.min(drag.start, drag.end);
    const en = Math.max(Math.max(drag.start, drag.end), s + 30);
    const bit = drag.bit;
    drag = null;
    state.prefs.blocks.push({ mask: bit, s, e: en });
    preview.remove();
    syncControls();
    update({ keepView: true });
  };
  day.addEventListener('pointermove', move);
  day.addEventListener('pointerup', up);
  day.addEventListener('pointercancel', up);
  e.preventDefault();
});

// ---------------- start ----------------

load();
syncControls();
renderChips();
termFile(state.term)
  .then((d) => (files.get(state.term).done = d))
  .catch(() => {});
for (const t of TERMS) if (t.term !== state.term) termFile(t.term).then((d) => (files.get(t.term).done = d)).catch(() => {});
update({ initial: true });
root.classList.add('pl-ready');
