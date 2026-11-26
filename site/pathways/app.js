// uwloo.ca/pathways: a degree, term by term, in a grid you type into like a spreadsheet.
// Rules: engine.js. Data: /pathways/data.json (scripts/lib/pathways.mjs). Saved in this browser, and in the
// link (#…) when shared.
const root = document.getElementById('pathways');
const V = root.dataset.v;
const app = document.getElementById('pw-app');
const E = await import(`/pathways/engine.js?v=${V}`);
const { goalQuery } = await import(`/pathways/goals.js?v=${V}`);
let data;
try {
  data = await (await fetch(`/pathways/data.json?v=${V}`)).json();
} catch {
  app.innerHTML = '<p class="pl-msg">Couldn’t load the calendar. Reload the page to try again.</p>';
  throw new Error('no data');
}
const C = data.courses;
/** Subject → faculty ('mat', 'art'…), for "a course from another faculty" and faculty averages. */
const SF = data.sf ?? {};
// Programs come from the calendar of the year someone started (2021–22 on); the current one is in data.json. The
// years before 2024–25 are read from the archived calendars, with the courses they name that this one doesn't have.
let P;
let bySlug;
let cant;
let calYear = data.year;
const sets = new Map([[data.year, data.programs]]);
function useSet(list) {
  P = list;
  bySlug = new Map(P.map((p) => [p.s, p]));
  cant = new Map(P.map((p) => [p.s, new Set(p.cant ?? [])]));
}
useSet(data.programs);
const yearList = data.years ?? [];
const years = yearList.map((y) => y.year).sort((a, b) => a - b);
/** The calendar year whose rules apply to someone starting in a given Fall. */
const yearFor = (y) => years.filter((x) => x <= y).at(-1) ?? years[0] ?? data.year;
async function loadYear() {
  const y = yearFor(startYear());
  if (!sets.has(y)) {
    const info = yearList.find((x) => x.year === y);
    try {
      const got = await (await fetch(`${info.file}?v=${V}`)).json();
      for (const [code, row] of Object.entries(got.courses ?? {})) C[code] ??= row;
      sets.set(y, got.programs);
    } catch {
      sets.set(y, data.programs);
    }
  }
  useSet(sets.get(y));
  calYear = sets.get(y) === data.programs ? data.year : y;
}
const labelOf = (y) => yearList.find((x) => x.year === y)?.label ?? data.cat;
const equiv = new Map(Object.entries(C).filter(([, c]) => c[6]?.length).map(([k, c]) => [k, c[6]]));
const SLOTS = 7; // columns: 5 is a usual load, 6 an overload, 7 heavy
let NORMAL = 5; // a usual load; a term-by-term major (engineering) can set more, from its calendar terms
const KEY = 'uwloo.pathways';
const TYPE_ORDER = ['Major', 'Minor', 'Specialization', 'Option', 'Diploma', 'Certificate', 'Degree Requirements'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (c) => {
  const b = E.baseCode(c);
  return b === 'ELECTIVE' ? 'Elective' : b.replace(/^([A-Z]+?)(\d|XXX$)/, '$1 $2');
};
/** What a course still needs, list by list: "one of MATH 128, MATH 138; MATH 136". */
const needsText = (w) => (w.groups?.length ? w.groups.map((g) => (g.length > 1 ? `one of ${g.map(fmt).join(', ')}` : fmt(g[0]))).join('; ') : w.codes.map(fmt).join(' or '));
/** "PMATH4XX" → "any PMATH course at the 400 level"; "ECONXXX" → "any ECON course"; "ELECTIVE" → "an elective…". */
const phText = (c) => {
  const b = E.baseCode(c);
  if (b === 'ELECTIVE') return 'an elective: any course that fits your plans';
  const m = /^([A-Z]+?)(\d|X)XX$/.exec(b);
  return m[2] === 'X' ? `any ${m[1]} course` : `any ${m[1]} course at the ${m[2]}00 level`;
};
const COUNTING = 'https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/policy/BkBW5tFVT';

// Grades: a number (0–100) or a mark like CR or WD, kept with the cell (row.g[column]) in this browser only;
// shared links leave them out. From the calendar's Grades page: below 50 doesn't pass; CR and AEG give credit
// but no average; DNW, FTC, NMR and WF count as 32 in averages, as does any grade below 32; NCR, WD and MM count
// in none. Averages weigh each course by its units, and every attempt counts (a failed course and its retake).
const WT_SLOTS = E.WT_SLOTS; // courses on a work term: PD courses, work-term reports, an online course
const NO_CREDIT = { NCR: 'no credit', WD: 'withdrew', WF: 'withdrew, failing', DNW: 'did not write the exam', FTC: 'failed to complete', NMR: 'no mark reported' };
const NOT_YET = { INC: 'incomplete', IP: 'in progress', MM: 'missing mark', UR: 'under review' };
const AS_32 = new Set(['DNW', 'FTC', 'NMR', 'WF']);
const numeric = (g) => typeof g === 'number' && Number.isFinite(g);
const failed = (g) => (numeric(g) ? g < 50 : typeof g === 'string' && Object.hasOwn(NO_CREDIT, g));
const notYet = (g) => typeof g === 'string' && Object.hasOwn(NOT_YET, g);
/** A grade's value in an average: below 32 counts as 32; CR, WD and the like count in none (null). */
const avgValue = (g) => (numeric(g) ? Math.max(32, g) : AS_32.has(g) ? 32 : null);
/** "85", "85%", "(85)", "CR" → 85 / 'CR'; '' → null; anything else → undefined. */
function parseGrade(text) {
  const t = String(text ?? '').trim().replace(/^[(\[:\-–—\s]+|[)\]\s]+$/g, '');
  if (!t) return null;
  const m = /^(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(t);
  if (m && Number(m[1]) <= 100) return Number(m[1]);
  if (/^(CR|NCR|WD|WF|INC|AEG|DNW|FTC|IP|NMR|MM|UR)$/i.test(t)) return t.toUpperCase();
  return undefined;
}
/** Why an attempt doesn't count, in words. */
const gradeNote = (g) =>
  numeric(g)
    ? `${g}%: below 50, so no credit. It still counts in your averages${g < 32 ? ' (as 32)' : ''}; plan a retake or another course.`
    : failed(g)
      ? `${g} (${NO_CREDIT[g]}): no credit${AS_32.has(g) ? ', and it counts as 32 in averages' : ''}. Plan a retake or another course.`
      : `${g} (${NOT_YET[g]}): counts once a final grade is in.`;
/** Unit-weighted average of attempts [{v, u}] (v: avgValue): {avg, n, u}, or null with none. */
function average(list) {
  let sum = 0;
  let u = 0;
  let n = 0;
  for (const x of list) {
    if (x.v == null || !x.u) continue;
    sum += x.v * x.u;
    u += x.u;
    n++;
  }
  return u ? { avg: sum / u, n, u } : null;
}
const pct = (a) => (Math.round(a * 10) / 10).toFixed(1);
/** "CS 135 85" → {code: 'CS135', grade: 85}. */
function parseCell(text) {
  const t = String(text ?? '');
  const code = parseCode(t);
  if (!code) return { code: '', grade: null };
  const m = /\b(?:PD|COOP|WKRPT)\s*\d{1,3}\b/i.exec(t) ?? /([A-Za-z]{2,8})\s*(\d{3}[A-Za-z]?|[\dxX][xX]{2})/.exec(t) ?? /elec(?:tive)?s?/i.exec(t);
  const rest = m ? t.slice(m.index + m[0].length) : '';
  return { code, grade: parseGrade(rest) ?? null };
}
const gradeAt = (r, c) => state.rows[r]?.g?.[c] ?? null;
/** What a cell shows while you edit it: the code, then its grade. */
const cellText = (r, c) => {
  const code = state.rows[r]?.c[c];
  if (!code) return '';
  const g = gradeAt(r, c);
  return g == null ? fmt(code) : `${fmt(code)} ${g}`;
};
const hasCells = (row) => row?.k === 's' || row?.k === 'c';
/** Cells a row has: a study term's seven, a work term's two, none when off. */
const slotsOf = (row) => (row?.k === 's' ? SLOTS : row?.k === 'c' ? WT_SLOTS : 0);
const norm = (q) => String(q ?? '').replace(/[\s_.-]+/g, '').toUpperCase();
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const units = (n) => (Math.round(n * 100) / 100).toFixed(n % 1 ? (n * 4) % 2 ? 2 : 1 : 1);
const $ = (s, el = document) => el.querySelector(s);

// ---------------- state ----------------

const KIND = { s: 'study', c: 'coop', o: 'off' };
const fallOf = (term) => {
  const t = String(term);
  return t.endsWith('9') ? t : `${Number(t.slice(0, 3)) - 1}9`;
};
function freshRows(start, years = 4) {
  const rows = [];
  let t = start;
  for (let i = 0; i < years * 3; i++) {
    rows.push({ k: E.seasonOf(t) === 'S' ? 'o' : 's', c: [] });
    t = E.nextTerm(t);
  }
  return rows;
}
const blank = () => ({ v: 1, wt: 1, start: fallOf(data.term), rows: freshRows(fallOf(data.term)), plans: [], ticked: [], cut: -1, dir: 'Minor' });

function decode(text) {
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/')))));
    return s && s.v === 1 && Array.isArray(s.rows) ? s : null;
  } catch {
    return null;
  }
}
const encode = (s) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** What a shared link carries: the plan, without your grades or courses set aside on a term of another kind. */
const shareable = ({ explore, exorder, exview, exfac, ...s }) => ({ ...s, rows: s.rows.map(({ g, stash, ...r }) => r) });

let state = null;
const hash = location.hash.slice(1);
const fromHash = hash && !/^(?:add|show|course)=|^(?:browse|grad)$/.test(hash) ? decode(hash) : null;
if (fromHash) state = fromHash;
else {
  try {
    state = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {}
  if (!state || state.v !== 1) state = blank();
}
// Work terms have cells of their own (PD courses, an online course). Before, courses on a work or off term were a
// study term's, hidden while it wasn't one: they wait in the row's stash until it's a study term again.
if (!state.wt) {
  for (const r of state.rows)
    if (r.k !== 's' && r.c?.some(Boolean)) {
      r.stash = { s: { c: r.c } };
      r.c = [];
    }
  state.wt = 1;
}
for (const r of state.rows) r.c = (r.c ?? []).slice(0, slotsOf(r));
let offer = null; // a plan just added: offer to fill in its courses
let pendingAdopt = null; // a plan from the link (#add=…), adopted once everything's ready
let undo = null; // {rows, n, names}: the grid before the last fill-in
// Switching partway (out of co-op after a few work terms, into it, honours to general): Terms applies from the
// term picked under "from"; the terms before it stay as they are.
let seqFrom = 0;
// The calendar year (May to April) a start term falls in: Winter 2027 is in 2026–27.
const startYear = () => 1900 + Number(String(state.start).slice(0, 3)) - (String(state.start).endsWith('1') ? 1 : 0);
await loadYear();
if (hash.startsWith('add=')) {
  const s = decodeURIComponent(hash.slice(4));
  if (bySlug.has(s) && !state.plans.includes(s)) {
    state.plans.push(s);
    pendingAdopt = s;
  }
}
// From a program page's "Pick from its courses": the plan's panel, open in the list, without taking the plan.
let pendingShow = null;
if (hash.startsWith('show=')) {
  const s = decodeURIComponent(hash.slice(5));
  if (bySlug.has(s)) pendingShow = s;
}
// From a course's page ("Plan it in your degree"): its card under the grid, in it or ready to put in.
const courseHash = (h) => (/^course=/.test(h) ? decodeURIComponent(h.slice(7)).toUpperCase().replace(/[^A-Z0-9]/g, '') : null);
const pendingCourse = courseHash(hash);
function showCourse(code) {
  const at = A.planned.get(code);
  shutCard = false;
  // Drawing again puts focus back in the cell it was in, which would pick that cell's course instead.
  if (document.activeElement?.closest?.('.pw-in')) document.activeElement.blur();
  if (at) {
    selected = { r: at.row, c: A.keys[at.row].indexOf(code) };
    peek = null;
  } else {
    selected = null;
    peek = code;
  }
  render();
  revealCard(at ? at.row : null);
  document.querySelector('#pw-detail .pw-dcard h3 a')?.focus({ preventScroll: true });
}
// From /programs: the list of every plan; from /programs/grad/, its Graduate view.
const pendingBrowse = hash === 'browse' ? 'all' : hash === 'grad' ? 'grad' : null;
// The same links followed with Pathways already open.
addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  const code = courseHash(h);
  if (code) {
    history.replaceState(null, '', location.pathname);
    analyze();
    return showCourse(code);
  }
  const s = decodeURIComponent(h.replace(/^(?:show|add)=/, ''));
  if (!/^(?:show|add)=/.test(h) || !bySlug.has(s)) return;
  history.replaceState(null, '', location.pathname);
  if (h.startsWith('add=')) addPlan(s);
  else openPanel(s);
});
if (hash) history.replaceState(null, '', location.pathname);

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

const termOf = (i) => {
  let t = state.start;
  for (let k = 0; k < i; k++) t = E.nextTerm(t);
  return t;
};

// ---------------- analysis ----------------

let A = null; // the latest analysis
function analyze() {
  const lv = E.levels(state.rows.map((r) => ({ kind: KIND[r.k] })));
  // On a work term, prerequisites go by the last study term before it.
  const lvAt = lv.map((l, i) => l ?? lv.slice(0, i).filter(Boolean).at(-1) ?? '1A');
  const planned = new Map();
  const count = new Map();
  // Each cell's key in planned: its code, "PMATH4XX#2" for a second placeholder of the same kind, or null for an
  // attempt that doesn't count (failed, withdrawn, incomplete).
  const keys = state.rows.map(() => []);
  state.rows.forEach((r, i) => {
    if (!hasCells(r)) return;
    r.c.forEach((code, j) => {
      if (!code) return;
      const g = r.g?.[j];
      if (E.isPlaceholder(code)) keys[i][j] = E.addPlanned(planned, code, { units: 0.5, row: i });
      else if (failed(g) || notYet(g)) keys[i][j] = null;
      else {
        planned.set(code, { units: C[code]?.[1] ?? 0.5, row: i });
        keys[i][j] = code;
        count.set(code, (count.get(code) ?? 0) + 1);
      }
    });
  });
  const plans = state.plans.map((s) => bySlug.get(s)).filter(Boolean);
  const absent = state.plans.filter((s) => !bySlug.has(s));
  NORMAL = Math.min(SLOTS, Math.max(5, ...plans.filter((p) => p.t === 'Major').map((p) => p.ld ?? 5)));
  const planCtx = plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const ticked = new Set(state.ticked);
  // A course counts toward two academic plans at most (Counting of Courses): engine.js's evaluateAll. Each plan
  // is read as it applies next to the others (BMath's List A isn't for Math/CPA).
  const asPicked = plans.map((p) => E.forPlans(p, plans));
  const { evals, capped, avail } = E.evaluateAll(asPicked, planned, { ticked, courses: C, faculty: SF });
  const before = new Set();
  // The latest grade in each course from earlier terms, for prerequisites like "a minimum grade of 60% in CS136".
  const gradesBefore = new Map();
  const flags = state.rows.map(() => []);
  state.rows.forEach((r, i) => {
    if (!hasCells(r)) return;
    const same = new Set(r.c.filter((code, j) => code && keys[i][j] !== null));
    const season = E.seasonOf(termOf(i));
    r.c.forEach((code, j) => {
      if (!code) return;
      const c = C[code];
      const key = keys[i][j];
      const g = r.g?.[j] ?? null;
      // A grade means it's been taken: prerequisites and seasons are behind it.
      const taken = g != null;
      const issues = [];
      if (key === null) issues.push([notYet(g) ? 'warn' : 'bad', gradeNote(g)]);
      if (E.isPlaceholder(code)) issues.push(['ph', `A placeholder for ${phText(code)}. Type the course here once you pick it.`]);
      else if (!c) issues.push([taken ? 'check' : 'bad', taken ? 'Not in the current calendar: check how it counts' : 'Not in the current calendar']);
      else {
        if (c[7]) issues.push([taken ? 'check' : 'bad', taken ? 'No longer in the calendar: check how it counts' : 'No longer in the calendar']);
        const ctx = { level: lvAt[i], plans: planCtx, equiv, grades: gradesBefore };
        const pre = taken || !c[2] ? true : E.holds(c[2], before, ctx);
        if (pre === false) {
          const w = E.why(c[2], before, ctx);
          const low = w.low?.map((x) => `${x.need}% in ${fmt(x.code)} (you have ${x.got})`) ?? [];
          const lowSet = new Set(w.low?.map((x) => x.code));
          const short = { ...w, groups: (w.groups ?? []).filter((gr) => !gr.every((x) => lowSet.has(x))), codes: w.codes.filter((x) => !lowSet.has(x)) };
          const parts = [short.codes.length ? `${needsText(short)} in an earlier term` : '', low.length ? `at least ${low.join(', ')}` : '', w.level ? `level ${w.level} or higher (this is ${lvAt[i]})` : '', w.plans.length ? `enrolled in ${w.plans.join(' or ')}` : ''].filter(Boolean);
          issues.push(['bad', `Prerequisites: needs ${parts.join('; ') || 'more than is planned before it'}`]);
        } else if (pre === null) issues.push(['check', 'Check the prerequisites: they name a plan the grid can’t confirm']);
        if (!taken && c[3] && E.holds(c[3], new Set([...before, ...same]), ctx) === false) issues.push(['bad', `Corequisites not met: ${E.missing(c[3], new Set([...before, ...same]), ctx).map(fmt).join(', ')}`]);
        const sn = c[5];
        const total = sn[0] + sn[1] + sn[2];
        const name = { F: 'Fall', W: 'Winter', S: 'Spring' }[season];
        if (taken) {
          // taken: nothing to warn about the season
        } else if (total && !sn['FWS'.indexOf(season)]) issues.push(['warn', `Hasn’t run in ${name} lately (last 4 years: Fall ${sn[0]}, Winter ${sn[1]}, Spring ${sn[2]})`]);
        else if (!total) issues.push(['warn', 'No sections in the last 4 years']);
        const anti = [...planned.keys()].filter((o) => o !== code && ((c[4] || []).includes(o) || (C[o]?.[4] || []).includes(code)));
        if (key !== null && anti.length) issues.push(['bad', `Antirequisite with ${anti.map(fmt).join(', ')}: only one counts`]);
        if (key !== null && count.get(code) > 1) issues.push(['warn', 'Planned more than once']);
        if (r.k === 'c' && !E.WORK_COURSE.test(code) && !taken) issues.push(['check', 'On a work term: check that it’s offered online that term and that your faculty allows a course while you work']);
      }
      if (capped.has(key)) issues.push(['warn', `Already counts toward two plans, so not toward ${capped.get(key).join(' or ')} (a course counts toward two plans at most)`]);
      evals.forEach((ev, k) => {
        if (key === null) return;
        if (ev.rows.some((x) => x.kind === 'not' && x.bad.includes(code))) issues.push(['warn', `Can’t count toward ${plans[k].n}`]);
        if (ev.rows.some((x) => x.kind === 'max' && x.over && x.got.includes(code))) issues.push(['warn', `Over the limit ${plans[k].n} sets for one of its lists`]);
      });
      const dots = evals.map((ev, k) => (key !== null && ev.used.has(key) ? k : -1)).filter((k) => k >= 0);
      flags[i][j] = { code, issues, dots };
    });
    for (const code of same) before.add(code);
    r.c.forEach((code, j) => {
      const g = r.g?.[j];
      if (code && numeric(g) && keys[i][j] !== null) gradesBefore.set(code, g);
    });
  });
  // Every graded attempt, for averages.
  const graded = [];
  state.rows.forEach((r, i) => {
    if (!hasCells(r)) return;
    r.c.forEach((code, j) => {
      const g = r.g?.[j];
      // PD courses, work-term reports and work terms aren't in averages.
      if (code && g != null && !E.isPlaceholder(code) && !E.WORK_COURSE.test(code)) graded.push({ code, g, v: avgValue(g), u: C[code]?.[1] ?? 0.5, row: i });
    });
  });
  A = { lv, lvAt, planned, plans, asPicked, avail, evals, flags, capped, absent, keys, graded, pools: null, needed: null };
  return A;
}
const subjectOf = (code) => /^[A-Z]+/.exec(code)?.[0] ?? '';
const inRange = (code, [subj, lo, hi]) => {
  const m = /^([A-Z]+)(\d{3})/.exec(code);
  return Boolean(m && m[1] === subj && Number(m[2]) >= lo && Number(m[2]) <= hi);
};
/** Graded attempts a program's minimum average covers, and its average: {avg, n, u} or null; for terms, the
 *  lowest term average with its row. */
function averageFor(a, p, k) {
  const g = A.graded;
  if (a.k === 'overall') return average(g);
  if (a.k === 'subj') return average(g.filter((x) => a.subj.includes(subjectOf(x.code))));
  if (a.k === 'fac') return average(g.filter((x) => SF[subjectOf(x.code)] === a.fac));
  if (a.k === 'codes') {
    const hit = g.filter((x) => a.c.includes(x.code) || a.rg.some((rg) => inRange(x.code, rg)));
    const res = average(hit);
    return res && res.n >= (a.n ?? 1) ? res : null;
  }
  if (a.k === 'plan') {
    // The courses that count toward the plan, every attempt at them.
    const used = new Set([...(A.evals[k]?.used ?? [])].map(E.baseCode));
    return average(g.filter((x) => used.has(x.code)));
  }
  if (a.k === 'term') {
    let low = null;
    for (const i of new Set(g.map((x) => x.row))) {
      if (state.rows[i]?.k !== 's') continue;
      const t = average(g.filter((x) => x.row === i));
      if (t && (!low || t.avg < low.avg)) low = { ...t, row: i };
    }
    return low;
  }
  return null;
}
/** Each plan's open requirements and the courses that could still meet them (engine.js's pools). */
function poolsNow() {
  A.pools ??= A.asPicked.map((p, k) => E.pools(p, A.planned, { courses: C, equiv, avail: A.avail[k], faculty: SF }));
  return A.pools;
}
/** Courses that would count toward something still open: code → [{k, key, label, where}]. */
function neededNow() {
  if (A.needed) return A.needed;
  const m = new Map();
  poolsNow().forEach((list, k) => {
    for (const pl of list) for (const c of pl.codes) m.set(c, [...(m.get(c) ?? []), { ...pl, k }]);
  });
  return (A.needed = m);
}

// ---------------- rendering ----------------

// The cell someone is typing in and hasn't entered yet: its text survives a redraw.
let pending = null;
function render() {
  analyze();
  const focus = document.activeElement?.closest?.('[data-r]');
  const keep = focus ? { r: focus.dataset.r, c: focus.dataset.c, sel: [focus.selectionStart, focus.selectionEnd], value: focus.value } : null;
  const pq = document.activeElement?.id === 'pw-pq' ? { value: document.activeElement.value, sel: document.activeElement.selectionStart } : null;
  app.innerHTML = `${barHtml()}${plansHtml()}<div class="pw-main"><div class="pw-left">${gridHtml()}<div class="pw-detail" id="pw-detail" aria-live="polite">${detailHtml()}</div></div><aside class="pw-side">${sideHtml()}</aside></div>${exploreShell()}`;
  if (keep) {
    const el = app.querySelector(`[data-r="${keep.r}"][data-c="${keep.c}"]`);
    if (el) {
      if (pending && String(pending.r) === keep.r && String(pending.c) === keep.c) el.value = keep.value;
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(...keep.sel);
      } catch {}
    }
  }
  if (pq) {
    const el = document.getElementById('pw-pq');
    el.value = pq.value;
    el.focus({ preventScroll: true });
    el.setSelectionRange(pq.sel, pq.sel);
    planSuggest(el);
  }
  save();
  scheduleDirections();
}

function barHtml() {
  const starts = [];
  for (let y = Number(data.term.slice(0, 3)) - 6; y <= Number(data.term.slice(0, 3)) + 1; y++) starts.push(`${y}9`);
  // Each major's co-op sequences, from the calendar's study/work charts.
  const groups = A.plans.filter((p) => p.t === 'Major' && p.seq?.length).map((p) => ({ p, opts: p.seq.map((_, k) => ({ id: `${p.s}:${k}`, label: seqLabel(p.s, k) })) }));
  const values = ['regular', 'all', ...groups.flatMap((g) => g.opts.map((o) => o.id))];
  const cur = currentPattern(values);
  const reg = patternFor('regular', seqFrom);
  const regLen = lengthOf(reg.start, reg.kinds);
  const short = (n) => n.replace(/\s*\(.*$/, '');
  return `<div class="pw-bar">
  <label>Starts <select id="pw-start">${starts.map((t) => `<option value="${t}"${t === state.start ? ' selected' : ''}>${esc(E.termName(t))}</option>`).join('')}</select></label>
  <span class="pw-cal t" title="Requirements follow the calendar of the year you started">${esc(labelOf(calYear))} rules${calYear > startYear() ? ' (the earliest here)' : calYear < startYear() ? ' (the newest here)' : ''}</span>
  <label>Terms <select id="pw-seq">${cur ? '' : '<option value="" selected>Your own terms</option>'}<option value="regular"${cur === 'regular' ? ' selected' : ''}>Regular: Fall and Winter, Spring off · ${esc(yearsText(regLen.terms))}</option><option value="all"${cur === 'all' ? ' selected' : ''}>Every term, no breaks</option>${groups.map((g) => `<optgroup label="Co-op: ${esc(short(g.p.n))}">${g.opts.map((o) => `<option value="${esc(o.id)}"${cur === o.id ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
  <label class="pw-from" title="Switching partway (out of co-op, into it, honours to general): terms before this stay as they are">from <select id="pw-from"><option value="0">the start</option>${state.rows.map((_, i) => (i ? `<option value="${i}"${seqFrom === i ? ' selected' : ''}>${esc(E.termName(termOf(i)))}${A.lv[i] ? ` (${A.lv[i]})` : ''}</option>` : '')).join('')}</select></label>
  <span class="pw-tools"><button type="button" data-act="tsv">Copy as a table</button><button type="button" data-act="link">Copy link</button><button type="button" data-act="print">Print or PDF</button><button type="button" data-act="reset">Start over</button><span class="t" id="pw-done" role="status"></span></span>
</div>`;
}

function plansHtml() {
  const chips = A.plans
    .map((p, k) => {
      const { name, kind } = E.planParts(p);
      return `<li class="pw-plan d${k % 8}" title="${esc(p.n)}"><a href="/programs/${esc(p.s)}/">${esc(name)}</a><span class="t">${esc(kind)}</span><button type="button" data-unplan="${esc(p.s)}" aria-label="Remove ${esc(p.n)}">×</button></li>`;
    })
    .join('');
  const warns = [];
  for (let a = 0; a < A.plans.length; a++)
    for (let b = a + 1; b < A.plans.length; b++) {
      const x = A.plans[a];
      const y = A.plans[b];
      if (cant.get(x.s)?.has(y.s) || cant.get(y.s)?.has(x.s)) warns.push(`<strong>${esc(x.n)}</strong> can’t be combined with <strong>${esc(y.n)}</strong>. <a href="/programs/combinations/">The calendar’s rules</a>`);
    }
  const majors = A.plans.filter((p) => p.t === 'Major').map((p) => p.s);
  for (const p of A.plans) if (p.open?.length && majors.length && !p.open.some((s) => majors.includes(s))) warns.push(`<strong>${esc(p.n)}</strong> is for students in ${p.open.map((s) => bySlug.get(s)?.n).filter(Boolean).slice(0, 4).map(esc).join('; ')}.`);
  const joint = A.plans.filter((p) => p.t === 'Major' && /Joint Honours/.test(p.n));
  if (joint.length && majors.length === 1) warns.push(`<strong>${esc(joint[0].n)}</strong> is half of a degree: it goes with a second major (another joint honours plan, or a major it’s listed with).`);
  for (const s of A.absent) warns.push(`<strong>${esc([...sets.values()].flat().find((p) => p.s === s)?.n ?? s)}</strong> isn’t in the ${esc(labelOf(calYear))} calendar by that name. <button type="button" class="pw-linkbtn" data-unplan="${esc(s)}">Remove it</button>`);
  const notes = [];
  // No faculty caps the number of minors; the limit is that a course counts toward two plans at most.
  const academic = A.plans.filter((p) => p.t !== 'Degree Requirements');
  if (academic.length >= 3) {
    const kinds = TYPE_ORDER.map((t) => [t, academic.filter((p) => p.t === t).length]).filter(([, n]) => n);
    const list = kinds.map(([t, n]) => plural(n, t.toLowerCase(), t === 'Specialization' ? 'specializations' : `${t.toLowerCase()}s`)).join(', ');
    notes.push(`${list.replace(/^./, (x) => x.toUpperCase())}. The calendar sets no limit on how many plans, but a course counts toward two of them at most (one required by a major and its specialization counts once), so each plan past two mostly needs courses of its own.${A.capped.size ? ` <b>${plural(A.capped.size, 'course')}</b> in your grid already ${A.capped.size === 1 ? 'counts' : 'count'} twice.` : ''} <a href="${COUNTING}" rel="noopener">Counting of Courses</a>`);
  }
  const deg = degreeFor(A.plans);
  const offered = offer && A.plans.find((p) => p.s === offer);
  // Co-op: the sequence it took (co-op-only majors), or its sequences to pick from.
  let coop = '';
  if (offered?.t === 'Major' && offered.seq?.length) {
    const named = (k) => (offered.seq[k].label === 'Co-op' ? 'co-op sequence' : `co-op ${offered.seq[k].label}`);
    if (coopNote?.slug === offered.s) coop = ` <span>Your terms follow its ${esc(named(coopNote.k))} (${esc(seqLabel(offered.s, coopNote.k).split(' · ')[1] ?? '')})${offered.seq.length > 1 ? '; the others are under <b>Terms</b>' : ''}.</span>`;
    else {
      const opts = offered.seq.slice(0, 4).map((sq, k) => {
        const p = patternFor(`${offered.s}:${k}`);
        return `<button type="button" class="pw-linkbtn" data-seq="${esc(offered.s)}:${k}">${esc(sq.label === 'Co-op' ? 'Use its co-op sequence' : sq.label)}</button> (${esc(yearsText(lengthOf(p.start, p.kinds).terms))})`;
      });
      coop = ` <span>Co-op? ${opts.join(', ')}${offered.seq.length > 4 ? ', more under <b>Terms</b>' : ''}</span>`;
    }
  }
  return `<div class="pw-plans"><ul>${chips}</ul>
<form class="pw-addplan" id="pw-addplan" autocomplete="off">${kindChips()}<label class="vh" for="pw-pq">Add a plan</label><div class="pw-pqbox"><input id="pw-pq" placeholder="${esc(planType ? `Search ${PLAN_KINDS[planType].toLowerCase()}, or pick from the list` : A.plans.length ? 'Add a minor, option, specialization… (math/cpa, cs, afm)' : 'Add your major, minors, options… (math/cpa, cs, afm)')}" role="combobox" aria-expanded="false" aria-controls="pw-psugg" aria-autocomplete="list" spellcheck="false"><ul id="pw-psugg" class="pw-sugg" role="listbox" hidden></ul></div></form>
<p class="pw-stilltease"><button type="button" class="pw-linkbtn" data-act="still">Still open ↓</button> <span class="t" id="pw-extease">${esc(exTease || 'every plan by faculty and field, with what goes with yours')}</span></p>
${A.plans.length ? '<p class="pw-acts"><button type="button" class="pw-fillbtn" data-act="fill">Fill in courses…</button> <button type="button" class="pw-findbtn pw-bestbtn" data-act="best" title="Picks the courses that count toward the most of your plans, so you take the fewest, and adds terms (5A, 5B…) if they don’t fit">Optimal plan…</button> <button type="button" class="pw-findbtn" data-act="find">Find courses…</button></p>' : ''}
${undo ? `<p class="pw-offer" role="status"><span>Added ${plural(undo.n, 'course')} from ${undo.names.length > 2 ? `${undo.names.length} plans` : esc(undo.names.join(' and '))}.</span> <button type="button" class="pw-linkbtn" data-act="undo">Undo</button></p>` : offered ? `<p class="pw-offer" role="status"><span>Added <b>${esc(offered.n)}</b>.</span>${coop} <button type="button" class="pw-fillbtn" data-act="fill" data-only="${esc(offered.s)}">Fill in its courses</button> <button type="button" class="pw-linkbtn" data-act="nooffer">Not now</button></p>` : ''}
${deg ? `<p class="pw-hint">Add the <button type="button" class="pw-linkbtn" data-plan="${esc(deg.s)}">${esc(deg.n)}</button> too, for the degree’s own rules.</p>` : ''}
${notes.map((w) => `<p class="pw-hint">${w}</p>`).join('')}
${warns.map((w) => `<p class="pw-warn">${w}</p>`).join('')}</div>`;
}

/** Units the whole degree takes: from its degree requirements (15.0 for a three-year general BA, else the most). */
function degreeTotalOf(plans) {
  const deg = plans.find((p) => p.t === 'Degree Requirements') ?? degreeFor(plans);
  const tt = deg?.tt;
  if (!tt?.length) return null;
  const major = plans.find((p) => p.t === 'Major');
  return /Three-Year General/i.test(major?.n ?? '') ? tt[0] : tt.at(-1);
}
const degreeTotal = () => degreeTotalOf(A.plans);

/** The degree requirements a chosen major belongs to, if not already chosen. */
function degreeFor(plans) {
  if (plans.some((p) => p.t === 'Degree Requirements')) return null;
  // The first major that names its degree ("Economics (Bachelor of Arts - Honours)"; Arts and Business doesn't).
  for (const major of plans.filter((p) => p.t === 'Major')) {
    const deg = /\((Bachelor of [A-Za-z ]+?)\s*-/.exec(major.n)?.[1];
    if (!deg) continue;
    const hits = P.filter((p) => p.t === 'Degree Requirements' && p.n.startsWith(deg));
    const hit = hits.find((p) => p.n.includes(major.f.replace('Faculty of ', ''))) ?? hits[0];
    if (hit) return hit;
  }
  return null;
}

function cellHtml(r, i, j, term) {
  const code = r.c[j] ?? '';
  const f = A.flags[i]?.[j];
  const g = code ? r.g?.[j] ?? null : null;
  const ph = Boolean(code) && E.isPlaceholder(code);
  const real = f?.issues.filter((x) => x[0] !== 'ph') ?? [];
  const worst = real.some((x) => x[0] === 'bad') ? 'bad' : real.some((x) => x[0] === 'warn') ? 'warn' : real.length ? 'check' : '';
  const dots = f?.dots.map((k) => `<i class="d${k % 8}"></i>`).join('') ?? '';
  const tip = f ? [ph ? '' : C[code]?.[0], g != null ? `Grade: ${g}` : '', ...f.issues.map((x) => x[1])].filter(Boolean).join(' · ') : '';
  const badge = g != null ? `<span class="pw-gr${failed(g) ? ' fail' : notYet(g) ? ' wait' : ''}" aria-hidden="true">${esc(String(g))}</span>` : '';
  const label = `${E.termName(term)} ${r.k === 'c' ? 'work term ' : ''}course ${j + 1}${g != null ? `, grade ${g}` : ''}`;
  return `<td class="pw-c${r.k === 's' && j >= NORMAL ? ' pw-extra' : ''}${worst ? ` ${worst}` : ''}${ph ? ' ph' : ''}${badge ? ' graded' : ''}"><input class="pw-in" data-r="${i}" data-c="${j}" value="${esc(code ? fmt(code) : '')}" aria-label="${esc(label)}" title="${esc(tip)}" spellcheck="false" autocomplete="off">${dots ? `<span class="pw-dots" aria-hidden="true">${dots}</span>` : ''}${badge}</td>`;
}

function gridHtml() {
  const head = `<tr><th scope="col">Term</th><th scope="col" class="pw-lv">Level</th>${Array.from({ length: SLOTS }, (_, j) => `<th scope="col" class="${j >= NORMAL ? 'pw-extra' : ''}">${j + 1}</th>`).join('')}<th scope="col">Load</th></tr>`;
  const body = state.rows
    .map((r, i) => {
      const term = termOf(i);
      const label = r.k === 's' ? A.lv[i] : r.k === 'c' ? 'WT' : 'Off';
      const next = { s: 'co-op', c: 'off', o: 'study' }[r.k];
      const kind = `<button type="button" class="pw-kind ${r.k}" data-kind="${i}" aria-label="${esc(`${E.termName(term)}: ${{ s: `study term ${A.lv[i]}`, c: 'co-op work term', o: 'off' }[r.k]}. Make it ${next}`)}" title="Click to make it ${next}">${esc(label)}</button>`;
      const n = r.c.filter(Boolean).length;
      const u = r.c.filter(Boolean).reduce((sum, c) => sum + (C[c]?.[1] ?? 0.5), 0);
      const avg = average(A.graded.filter((x) => x.row === i));
      const avgHtml = avg ? `<span class="pw-tavg" title="Term average, over ${plural(avg.n, 'graded course')}">${pct(avg.avg)}</span>` : '';
      if (r.k === 'o') return `<tr class="pw-row off"><th scope="row">${esc(E.termName(term))}</th><td class="pw-lv">${kind}</td><td colspan="${SLOTS}" class="pw-note">Off</td><td></td></tr>`;
      if (r.k === 'c') {
        // A work term: PD courses, a work-term report, or an online course.
        const cells = Array.from({ length: WT_SLOTS }, (_, j) => cellHtml(r, i, j, term)).join('');
        return `<tr class="pw-row coop"><th scope="row">${esc(E.termName(term))}</th><td class="pw-lv">${kind}</td>${cells}<td colspan="${SLOTS - WT_SLOTS}" class="pw-note">Co-op work term<span class="t"> · PD courses, a work-term report, or an online course</span></td><td class="pw-load">${n ? `${n}${avgHtml}` : ''}</td></tr>`;
      }
      const cells = Array.from({ length: SLOTS }, (_, j) => cellHtml(r, i, j, term)).join('');
      const load = n > NORMAL ? (n > NORMAL + 1 ? 'heavy' : 'over') : '';
      return `<tr class="pw-row"><th scope="row">${esc(E.termName(term))}</th><td class="pw-lv">${kind}</td>${cells}<td class="pw-load ${load}">${n ? `${n} <span class="t">· ${units(u)}u</span>${avgHtml}${load ? `<small>${load === 'heavy' ? 'heavy' : 'overload'}</small>` : ''}` : ''}</td></tr>`;
    })
    .join('');
  return `<div class="pw-gridwrap"><table class="pw-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
<div class="pw-rowtools"><button type="button" data-act="addrow">+ Add a term</button>${state.rows.length > 1 ? '<button type="button" data-act="droprow">Remove the last term</button>' : ''}<span class="t">Type a course code into any cell, and a grade after it once you have one (“CS 135 85”, “ECON 101 CR”). Enter goes down, arrows move, and a pasted list fills down the column.</span></div>`;
}

let selected = null; // {r, c}
let shutCard = false; // the card closed with ×, until a cell or a course is picked again

/** A requisite tree in words: "CS 136 (60% or higher); one of MATH 135, MATH 145; Enrolled in …". */
function reqText(nodes) {
  const part = (n) => {
    if (n.g) {
      const inner = n.i.map(part).filter(Boolean);
      if (!inner.length) return '';
      if (n.g === 'n') return `${n.n > 1 ? n.n : 'one'} of: ${inner.join(' · ')}`;
      return inner.length > 1 ? `(${inner.join('; ')})` : inner[0];
    }
    if (n.r) {
      const list = n.c.map(fmt);
      const mg = n.mg ? ` (${n.mg}% or higher)` : '';
      if (n.r === 'not') return `not ${list.join(' or ')}`;
      if (n.r === 'n') return list.length === 1 ? `${list[0]}${mg}` : `${n.n > 1 ? n.n : 'one'} of ${list.join(', ')}${mg}`;
      return `${list.join(list.length === 2 ? ' and ' : ', ')}${mg}`;
    }
    return n.t ?? '';
  };
  // One "all of" group at the top is the list itself.
  const top = Array.isArray(nodes) && nodes.length === 1 && nodes[0].g === 'all' ? nodes[0].i : Array.isArray(nodes) ? nodes : [];
  return top.map(part).filter(Boolean).join('; ');
}

// Courses that name a course in their prerequisites: code → [codes] (the course pages' "Leads to").
let LEADS = null;
function leadsTo(code) {
  if (!LEADS) {
    LEADS = new Map();
    const walk = (nodes, out) => {
      for (const n of Array.isArray(nodes) ? nodes : []) {
        if (n.r && n.r !== 'not') for (const x of n.c) out.add(x);
        if (n.i) walk(n.i, out);
      }
    };
    for (const [k, c] of Object.entries(C)) {
      if (c[7]) continue;
      const names = new Set();
      walk(c[2], names);
      for (const x of names) LEADS.set(x, [...(LEADS.get(x) ?? []), k]);
    }
  }
  return [...new Set([code, ...(equiv.get(code) ?? [])].flatMap((x) => LEADS.get(x) ?? []))].filter((k) => k !== code);
}

// ---------------- the course card ----------------
// Under the grid, a course in context: what it is (the calendar's words, read from its page), what it needs and
// whether your grid has it, what it counts toward (your plans, then every other plan that names it or whose rules in
// words it fits), what it leads to and which of those can't be taken without it, and its life at Waterloo: how often
// it runs and how full, who teaches it, what r/uwaterloo says, where it's been written about. For a course in the
// grid (a cell, a checklist), or one that isn't yet (a link from its page, #course=CODE, or one just taken out).
let peek = null; // a course on the card that isn't in the grid
const cardMore = new Set(); // "code|kind": every plan of that kind shown, not just the first few

/** A plan's name without its kind, for a chip under a heading of that kind: "Economics · BA Honours", "Finance · Economics". */
function planLabel(p) {
  const { name, kind, of } = E.planParts(p);
  if (p.t === 'Major') return `${name} · ${kind}`;
  if (p.t === 'Specialization' && of) return `${name} · ${of}`;
  if (p.t === 'Degree Requirements' && of) return `${name} (${of})`;
  return name;
}

/** Every plan this calendar year names a course in, and how: code → Map(plan → [roles]) (course pages' "Counts toward"). */
let NAMED = null;
function namedIn(codes) {
  if (NAMED?.P !== P) {
    const map = new Map();
    const role = (n, choice) => {
      if (n.r === 'all' || (n.r === 'n' && (n.n ?? 1) >= n.c.length)) return choice ? 'One of the options' : 'Required';
      if (n.r === 'n') return `Choose ${n.n ?? 1} of ${n.c.length}`;
      if (n.r === 'max') return n.n ? `At most ${n.n} from a list` : 'On a list';
      if (n.r === 'not') return 'Can’t count';
      if (n.r === 'any') return 'On the list';
      return 'Listed';
    };
    const label = (h, r) => (!h || /^Required Courses$/i.test(h) ? r : r === 'On the list' || r === 'Listed' ? h : `${h}: ${r}`);
    for (const p of P) {
      const add = (c, r) => {
        if (!map.has(c)) map.set(c, new Map());
        const m = map.get(c);
        if (!m.has(p)) m.set(p, []);
        if (!m.get(p).includes(r)) m.get(p).push(r);
      };
      const walk = (nodes, h, choice) => {
        for (const n of nodes ?? []) {
          if (n.g) walk(n.i, h, choice || n.g === 'n');
          else if (n.r && n.c) for (const c of n.c) add(c, label(h, role(n, choice)));
        }
      };
      const sec = (s, outer) => {
        const h = s.h || outer;
        walk(s.r, h, false);
        for (const l of s.l ?? []) sec(l, h);
      };
      for (const s of p.req ?? []) sec(s, '');
    }
    NAMED = { P, map };
  }
  const out = new Map();
  for (const c of codes) for (const [p, roles] of NAMED.map.get(c) ?? []) out.set(p, [...new Set([...(out.get(p) ?? []), ...roles])]);
  return out;
}

/** Plans whose rules in words a course fits ("1.5 units of ECON courses at the 300-level"): plan → the rule. */
let WORDY = null;
function wordsFit(codes) {
  if (WORDY?.P !== P) {
    const rules = [];
    for (const p of P) {
      const walk = (nodes) => {
        for (const n of nodes ?? []) {
          if (n.g) walk(n.i);
          else if (!n.r && !n.info && (n.subj?.length || n.rg?.length)) rules.push({ p, n });
        }
      };
      const sec = (s) => {
        walk(s.r);
        for (const l of s.l ?? []) sec(l);
      };
      for (const s of p.req ?? []) sec(s);
    }
    WORDY = { P, rules };
  }
  const out = new Map();
  for (const code of codes) {
    const m = /^([A-Z]+)(\d{3})/.exec(code);
    if (!m) continue;
    const subj = m[1];
    const num = Number(m[2]);
    for (const { p, n } of WORDY.rules) {
      if (out.has(p) || (n.no ?? []).includes(code) || (n.nos ?? []).includes(subj)) continue;
      if (n.rg ? n.rg.some(([s, lo, hi]) => s === subj && num >= lo && num <= hi) : n.subj.includes(subj) && (!n.min || num >= n.min * 100)) out.set(p, n.t);
    }
  }
  return out;
}

/** Can a course not be taken without one of these (every way through its prerequisites goes through them)? */
const dropNot = (nodes) => (Array.isArray(nodes) ? nodes : []).filter((n) => n.r !== 'not').map((n) => (n.g ? { ...n, i: dropNot(n.i) } : n));
const needsOnly = (k, gone) => E.holds(dropNot(C[k]?.[2]), { has: (c) => !gone.has(c) }, { equiv }) === false;

// The course's own page (/econ201/), read for what Pathways doesn't carry: the description, the terms it ran and how
// full, who taught it, r/uwaterloo, links found around the web, the first calendar that lists it. Once per course.
const PAGES = new Map(); // code → info, false (no page), null (couldn't load it), or a promise while it loads
function pageInfo(code) {
  if (!PAGES.has(code)) {
    PAGES.set(
      code,
      fetch(`/${code.toLowerCase()}/`)
        .then((r) => (r.ok ? r.text() : r.status === 404 ? false : null))
        .then((html) => (html ? readCoursePage(html) : html))
        .catch(() => null)
        .then((info) => {
          PAGES.set(code, info);
          return info;
        }),
    );
  }
  return PAGES.get(code);
}
function readCoursePage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const q = (s) => doc.querySelector(s);
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Only web and same-site addresses go back into the card.
  const link = (a) => (a && /^(?:https?:\/\/|\/(?!\/))/.test(a.getAttribute('href') ?? '') ? { text: txt(a), href: a.getAttribute('href') } : null);
  // The latest term it ran, and how full its lectures were (or whatever it has, if no lectures).
  const ran = [...doc.querySelectorAll('.ogrid a.og.on')].map((a) => ({ t: (a.getAttribute('href') ?? '').slice(2), title: a.title })).filter((x) => /^\d{4}$/.test(x.t)).sort((a, b) => b.t - a.t);
  let seats = null;
  if (ran[0]) {
    const rows = [...doc.querySelectorAll(`[id="t${ran[0].t}"] table.sec tbody tr`)];
    const lec = rows.filter((r) => /^LEC\b/.test(txt(r.querySelector('th'))));
    let got = 0;
    let cap = 0;
    for (const r of lec.length ? lec : rows) {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(txt(r.querySelector('td')));
      if (m) {
        got += Number(m[1]);
        cap += Number(m[2]);
      }
    }
    if (cap) seats = { got, cap };
  }
  // "Taught by A (21) · B (20) · … and 27 more": the first three, and how many in all.
  const by = q('.og-by');
  let taught = null;
  if (by) {
    const t = txt(by).replace(/^Taught by\s*/, '');
    const more = Number(/and (\d+) more$/.exec(t)?.[1] ?? 0);
    const names = t.replace(/\s*and \d+ more$/, '').split(' · ').filter(Boolean);
    taught = { top: names.slice(0, 3), n: names.length + more };
  }
  const redditNote = txt(q('.reddit p.t'));
  const reddit = redditNote ? redditNote.replace(/\s*Quoted word for word.*$/, '') : '';
  const threads = [...doc.querySelectorAll('#reddit-list .rd-head')].slice(0, 3).map((h) => ({ when: txt(h.querySelector('time')), ...link(h.querySelector('a')) })).filter((x) => x.href);
  const web = [...doc.querySelectorAll('.resources ul.found > li')].slice(0, 3).map((li) => ({ ...link(li.querySelector('a.found-title')), kind: txt(li.querySelector('.t')).split(' · ')[0] })).filter((x) => x.href);
  const years = [...doc.querySelectorAll('ul.versions a, .ver-old summary')].map((a) => /\b(\d{4})–(\d{2})\b/.exec(txt(a))).filter(Boolean).map((m) => `${m[1]}–${m[2]}`).sort();
  const subject = [...doc.querySelectorAll('.course-head .facts > div')].find((d) => txt(d.querySelector('dt')) === 'Subject')?.querySelector('a');
  const flow = link([...doc.querySelectorAll('ul.out a')].find((a) => /UW Flow/i.test(txt(a))));
  return {
    desc: txt(q('article.course > p.desc')),
    ran: txt(q('.og-sum')),
    last: ran[0] ? { title: ran[0].title, seats } : null,
    taught,
    reddit,
    redditAt: q('#reddit-h') ? '#reddit-h' : '',
    threads,
    web,
    since: years[0] ?? '',
    subject: link(subject),
    timetable: link(q('.plan-add a.plan-btn')),
    flow: flow?.href ?? '',
  };
}

/** The course card's part from its page: what it's about and its life at Waterloo. */
function pagePart(code) {
  const info = PAGES.get(code);
  const page = `/${code.toLowerCase()}/`;
  if (info === undefined || info instanceof Promise) return `<p class="t pw-dwait">Reading <a href="${page}">its page</a>…</p>`;
  if (info === false) return '<p class="t">uwloo has no page for it: it isn’t in a current calendar.</p>';
  if (!info) return `<p class="t"><a href="${page}">Its page</a> has the calendar’s description, when it ran, and what people say about it.</p>`;
  const life = [];
  if (info.ran) life.push(`<li>${esc(info.ran)}${info.last ? ` <span class="t">Latest: ${esc(info.last.title)}${info.last.seats ? `, ${info.last.seats.got.toLocaleString('en-CA')} of ${info.last.seats.cap.toLocaleString('en-CA')} seats taken` : ''}.</span>` : ''}</li>`);
  if (info.taught?.top.length) life.push(`<li>Taught by ${info.taught.n > info.taught.top.length ? `${info.taught.n} people; most often ` : ''}${esc(info.taught.top.join(', '))}.</li>`);
  if (info.reddit) life.push(`<li>On r/uwaterloo: ${esc(info.reddit)}${info.threads.length ? ` <span class="t">Lately:</span> ${info.threads.map((x) => `<a href="${esc(x.href)}">${esc(x.text)}</a> <span class="t">(${esc(x.when)})</span>`).join(' · ')}` : ''} <a href="${page}${info.redditAt}">Read them</a></li>`);
  if (info.web.length) life.push(`<li>Around the web: ${info.web.map((x) => `<a href="${esc(x.href)}">${esc(x.text)}</a>${x.kind ? ` <span class="t">(${esc(x.kind.toLowerCase())})</span>` : ''}`).join(' · ')}</li>`);
  if (info.since) life.push(`<li>In the calendar since ${info.since === '1995–96' ? 'at least ' : ''}${esc(info.since)}.</li>`);
  const links = [
    `<a href="${page}">Its page</a>`,
    info.subject && `<a href="${esc(info.subject.href)}">Every ${esc(info.subject.text)} course</a>`,
    info.timetable && `<a href="${esc(info.timetable.href)}">${esc(info.timetable.text)}</a>`,
    info.flow && `<a href="${esc(info.flow)}">Ratings on UW Flow</a>`,
  ].filter(Boolean);
  return `${info.desc && !/^About [A-Z]+ ?\d+\w*\.?$/.test(info.desc) ? `<p class="pw-ddesc">${esc(info.desc)}</p>` : ''}${life.length ? `<ul class="pw-dlife">${life.join('')}</ul>` : ''}<p class="pw-dlinks">${links.join(' <span aria-hidden="true">·</span> ')}</p>`;
}

/** What a course counts toward: your plans (and how), then every other plan that names it or whose rules in words it fits. */
function countsPart(code, key) {
  const codes = [code, ...(equiv.get(code) ?? [])];
  const named = namedIn(codes);
  const fits = wordsFit(codes);
  const mine = A.plans.map((p, k) => {
    const roles = named.get(p) ?? [];
    const barred = roles.some((r) => /Can’t count/.test(r));
    const used = key != null && A.evals[k]?.used.has(key);
    const how = barred ? roles.filter((r) => /Can’t count/.test(r)).join('; ') : roles.length ? roles.join('; ') : fits.has(p) ? `fits “${fits.get(p)}”` : used ? 'a rule in words' : '';
    if (!used && !how) return '';
    const note = key == null || used || barred ? '' : ' · not counted toward it now';
    return `<li${barred ? ' class="no"' : ''}><i class="pw-dot d${k % 8}"></i>${esc(planLabel(p))} <span class="t">${esc(how)}${note}</span></li>`;
  });
  const yours = mine.filter(Boolean).join('');
  const chip = (p, why) => {
    const no = state.plans.filter((c) => cant.get(p.s)?.has(c) || cant.get(c)?.has(p.s));
    const who = E.whoFor(p, myMajors());
    const tag = no.length ? ' <small class="pw-ftag">not with yours</small>' : who.tag ? ` <small class="pw-ftag">${esc(who.tag)}</small>` : '';
    const note = no.length ? `can’t go with ${E.planParts(bySlug.get(no[0])).name}` : who.why;
    return `<button type="button" class="pw-fc${no.length || !who.ok ? ' no' : ''}" data-pshow="${esc(p.s)}" title="${esc(`${p.n}: ${why}${note ? ` · ${note}` : ''}`)}">${esc(planLabel(p))}${tag}</button>`;
  };
  const group = (list, kind, why, where) => {
    const all = cardMore.has(`${code}|${where}|${kind}`);
    const shown = all ? list : list.slice(0, 8);
    return `<p class="pw-dkind" data-kind="${esc(kind)}"><span class="pw-lead">${esc(kind === 'Degree Requirements' ? 'Degrees' : `${kind === 'Specialization' ? 'Specializations' : `${kind}s`}`)} ${list.length}</span><span class="pw-dchips">${shown.map((p) => chip(p, why(p))).join('')}${list.length > shown.length ? `<button type="button" class="pw-linkbtn" data-dmore="${esc(kind)}">${list.length - shown.length} more</button>` : ''}</span></p>`;
  };
  const others = (map, why, where) =>
    TYPE_ORDER.map((t) => [t, [...map.keys()].filter((p) => p.t === t && !state.plans.includes(p.s)).sort((a, b) => planLabel(a).localeCompare(planLabel(b)))])
      .filter(([, list]) => list.length)
      .map(([t, list]) => group(list, t, why, where))
      .join('');
  const countsToo = new Map([...named].filter(([, roles]) => roles.some((r) => !/Can’t count/.test(r))));
  const byName = others(countsToo, (p) => countsToo.get(p).join('; '), 'n');
  const inWords = new Map([...fits].filter(([p]) => !countsToo.has(p)));
  const byWords = others(inWords, (p) => inWords.get(p), 'w');
  const nOthers = (m) => [...m.keys()].filter((p) => !state.plans.includes(p.s)).length;
  return `<div class="pw-dcounts"><h4>Counts toward</h4>
${yours ? `<ul class="pw-counts">${yours}</ul>` : A.plans.length ? `<p class="t">None of your plans ${key != null ? 'counts it toward a requirement (it can still be an elective)' : 'names it or has a rule it fits; it’d be an elective'}.</p>` : ''}
${byName ? `<div class="pw-dnamed"><p class="t">${A.plans.length ? 'Other plans' : 'Plans'} that name it (${nOthers(countsToo)}); tap one for its courses:</p>${byName}</div>` : ''}
${byWords ? `<details class="pw-dwords"${byName ? '' : ' open'}><summary>Rules in words it fits: ${plural(nOthers(inWords), 'more plan')}</summary>${byWords}</details>` : ''}
${!yours && !byName && !byWords ? '<p class="t">No plan in this calendar names it; it counts as an elective.</p>' : ''}</div>`;
}

/** What a course leads to: in your grid, for your plans, the rest; the ones that can't be taken without it marked. */
function leadsPart(code) {
  const gone = new Set([code, ...(equiv.get(code) ?? [])]);
  const num = (k) => Number(/\d+/.exec(k)?.[0] ?? 0);
  const only = new Set();
  const leads = leadsTo(code).filter((k) => {
    if (C[k]?.[7] && !A.planned.has(k)) return false;
    if (needsOnly(k, gone)) only.add(k);
    return true;
  });
  if (!leads.length) return `<div class="pw-leads"><h4>Leads to</h4><p class="t">No course names it as a prerequisite.</p></div>`;
  leads.sort((a, b) => only.has(b) - only.has(a) || num(a) - num(b) || a.localeCompare(b));
  const need = neededNow();
  const inGrid = leads.filter((k) => A.planned.has(k));
  const forPlans = leads.filter((k) => !A.planned.has(k) && need.has(k));
  const rest = leads.filter((k) => !A.planned.has(k) && !need.has(k));
  const lead = (k, st) => chip(k, st, only.has(k) ? { cls: 'only', why: `can’t be taken without ${fmt(code)}` } : null);
  const line = (label, list, st, max) => (list.length ? `<p class="pw-dkind"><span class="pw-lead">${label}</span><span class="pw-dchips">${list.slice(0, max).map((k) => lead(k, st)).join('')}${list.length > max ? ` <a class="t" href="/${code.toLowerCase()}/#leads-h">and ${list.length - max} more</a>` : ''}</span></p>` : '');
  const n = leads.length;
  const onlyText = !only.size ? '' : only.size === n ? (n === 1 ? ', and <b class="pw-onlykey">can’t be taken without it</b>' : `; <b class="pw-onlykey">none of them can be taken without it</b>`) : `; the <b class="pw-onlykey">${only.size === 1 ? 'one underlined' : `${only.size} underlined`}</b> can’t be taken without it`;
  return `<div class="pw-leads"><h4>Leads to</h4><p class="t">${plural(n, 'course')} ${n === 1 ? 'lists' : 'list'} it as a prerequisite${onlyText}.</p>
${line('In your grid', inGrid, 'ok', 16)}${line('For your plans', forPlans, 'no', 12)}${line(inGrid.length || forPlans.length ? 'Others' : 'Courses', rest, 'no', 12)}</div>`;
}

/** The course card: the selected cell's course, or one shown without being in the grid (peek). */
function detailHtml() {
  if (shutCard) return '';
  const inCell = selected && state.rows[selected.r]?.c[selected.c];
  if (inCell) peek = null; // looking at a course in the grid now
  const code = inCell || peek;
  if (!code) return '';
  const c = C[code];
  const at = inCell ? selected : null;
  const f = at ? A.flags[at.r]?.[at.c] : null;
  const key = at ? A.keys[at.r]?.[at.c] : null;
  const g = at ? gradeAt(at.r, at.c) : null;
  const issues = f?.issues.filter(([k]) => k !== 'ph').map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('') ?? '';
  const where = at ? `${state.rows[at.r].k === 's' ? `${A.lv[at.r]} · ` : ''}${E.termName(termOf(at.r))}` : 'not in your grid';
  const close = `<button type="button" class="pw-pdx" data-dclose aria-label="Close ${esc(fmt(code))}">×</button>`;
  if (E.isPlaceholder(code)) {
    const counts = A.evals.map((ev, k) => (key != null && ev.used.has(key) ? `<li><i class="pw-dot d${k % 8}"></i>${esc(A.plans[k].n)}</li>` : '')).join('');
    return `<div class="pw-dcard"><div class="pw-dhead"><h3>${esc(fmt(code))} <span class="t">placeholder · ${esc(where)}</span></h3>${close}</div><p>For ${esc(phText(code))}. Type the course here once you pick it; until then it holds the slot and counts toward requirements described in words.</p>${issues ? `<ul class="pw-issues">${issues}</ul>` : ''}
${counts ? `<p class="t">Counts toward:</p><ul class="pw-counts">${counts}</ul>` : ''}</div>`;
  }
  const sn = c?.[5] ?? [0, 0, 0];
  const seasons = ['Fall', 'Winter', 'Spring'].map((x, k) => `<span class="pw-season${sn[k] ? '' : ' none'}" title="${esc(`${x}: ${plural(sn[k], 'term')} with sections in the last 4 years`)}">${x}<b>${sn[k]}</b></span>`).join('');
  const pre = reqText(c?.[2]);
  const co = reqText(c?.[3]);
  const anti = (c?.[4] || []).map(fmt).join(', ');
  const cross = (c?.[6] || []).map(fmt).join(', ');
  // Not in the grid: does the grid have what it needs?
  let status = '';
  if (at) status = issues ? `<ul class="pw-issues">${issues}</ul>` : g != null ? '' : '<p class="t pw-ok">No problems found: its prerequisites are in earlier terms and it runs in this season.</p>';
  else if (c) {
    const miss = E.missing(dropNot(c[2]), new Set(A.planned.keys()), { equiv });
    const clash = (c[4] || []).filter((x) => A.planned.has(x));
    status = `${miss.length ? `<p class="pw-dkind pw-dneed"><span class="pw-lead">Needs first</span><span class="pw-dchips">${miss.slice(0, 8).map((k) => chip(k, 'no')).join('')}</span></p>` : pre ? '<p class="t pw-ok">Your grid has what it needs first.</p>' : ''}${clash.length ? `<p class="pw-no">Your grid has ${clash.map(fmt).join(', ')}: you can’t get credit for both.</p>` : ''}`;
  } else status = `<p class="t">Not in the ${esc(data.cat)} Undergraduate Calendar${calYear !== data.year ? ' or the one your plans follow' : ''}; its page may say why.</p>`;
  const gradeBox = at
    ? `<div class="pw-dmeta"><label class="pw-grade">Grade <input id="pw-grade" value="${esc(g ?? '')}" placeholder="e.g. 85 or CR" spellcheck="false" autocomplete="off" inputmode="text" size="7" aria-describedby="pw-gnote"></label><span class="t" id="pw-gnote">${g == null ? 'Once you have it. Kept in this browser only, never in shared links.' : failed(g) ? 'Doesn’t count toward requirements.' : notYet(g) ? 'Counts once the final grade is in.' : 'Counts toward your averages.'}</span></div>`
    : '';
  // Not in the grid: into the empty cell you picked, or wherever it fits (after what it needs, in a term it runs).
  const into = !at && selected && hasCells(state.rows[selected.r] ?? {}) && !state.rows[selected.r]?.c[selected.c] ? selected : null;
  const acts = at
    ? `<button type="button" class="pw-linkbtn" data-dout>Take it out</button>`
    : `<button type="button" class="pw-dput" data-add="${esc(code)}">${into ? `Put it in ${esc(state.rows[into.r].k === 's' ? `${A.lv[into.r]}, ${E.termName(termOf(into.r))}` : E.termName(termOf(into.r)))}` : 'Put it in your grid'}</button>${into ? '' : ' <span class="t">or pick an empty cell first</span>'}`;
  // Its page's part arrives once read (the first time; it's kept after that).
  if (!PAGES.has(code))
    pageInfo(code).then(() => {
      const box = document.getElementById('pw-dpage');
      if (box?.dataset.code === code) box.innerHTML = pagePart(code);
    });
  return `<div class="pw-dcard" data-code="${esc(code)}"><div class="pw-dhead"><h3><a href="/${code.toLowerCase()}/">${esc(fmt(code))}</a> ${esc(c?.[0] ?? '')}</h3>${close}
<p class="pw-dsub">${c ? `${units(c[1])} units · ` : ''}<b>${esc(where)}</b> <span class="pw-seasons" aria-label="Terms with sections in the last 4 years">${seasons}</span> ${acts}</p></div>
<div class="pw-dcols"><div class="pw-dmain">
<div id="pw-dpage" data-code="${esc(code)}">${pagePart(code)}</div>
${pre || co || anti || cross ? `<dl class="pw-reqs">${pre ? `<dt>Prerequisites</dt><dd>${esc(pre)}</dd>` : ''}${co ? `<dt>Corequisites</dt><dd>${esc(co)}</dd>` : ''}${anti ? `<dt>Antirequisites</dt><dd>${esc(anti)}</dd>` : ''}${cross ? `<dt>Cross-listed</dt><dd>${esc(cross)}</dd>` : ''}</dl>` : ''}
${status}${gradeBox}</div>
<div class="pw-dside">${c ? countsPart(code, key) : ''}${c ? leadsPart(code) : ''}</div></div></div>`;
}

/**
 * Do something that draws the page again, keeping the open plan panel in Still open where it was on screen. (The page
 * is drawn from scratch, so the browser can't hold its place; a plan added above, or a line under Still open's bar,
 * would push the panel down under your pointer.)
 */
function steady(fn) {
  const top = () => document.getElementById('pw-pd')?.getBoundingClientRect().top;
  const before = top();
  fn();
  const after = top();
  // Only while you're looking at it (removing a plan at the top shouldn't scroll the page to keep a panel below still).
  if (before != null && after != null && before < innerHeight && before > -innerHeight && Math.abs(after - before) > 1) scrollBy(0, after - before);
}

/** Bring the card into view under the grid, with the course's row too when both fit. */
function revealCard(r = null) {
  const card = document.getElementById('pw-detail');
  if (!card?.firstElementChild) return;
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const hint = app.querySelector('.pw-rowtools');
  const from = top(hint ?? card) - 12;
  const end = top(card) + card.offsetHeight + 12;
  const row = r != null ? app.querySelector(`.pw-in[data-r="${r}"]`)?.closest('tr') : null;
  const y = row && end - (top(row) - 12) <= innerHeight ? top(row) - 12 : from;
  scrollTo({ top: Math.max(0, y), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function sideHtml() {
  const plannedN = A.planned.size;
  // PD courses and work-term reports give no academic credit: not in the degree's units.
  const plannedU = [...A.planned].reduce((s, [k, x]) => s + (E.WORK_COURSE.test(k) ? 0 : x.units), 0);
  const study = state.rows.map((r, i) => ({ r, i })).filter((x) => x.r.k === 's');
  const loads = study.map((x) => x.r.c.filter(Boolean).length);
  const over = loads.filter((n) => n > NORMAL).length;
  const gaps = A.evals.reduce((s, ev) => s + Math.max(0, ev.need - ev.have), 0);
  const degreeUnits = degreeTotal();
  const byUnits = degreeUnits ? Math.max(0, Math.round((degreeUnits - plannedU) / 0.5)) : 0;
  const toPlan = Math.max(gaps, byUnits);
  const free = study.reduce((s, x) => s + Math.max(0, NORMAL - x.r.c.filter(Boolean).length), 0);
  let fit = '';
  if (A.plans.length) {
    if (!toPlan) fit = `<p class="pw-ok">Everything your plans list by name is in the grid.</p>`;
    else if (toPlan <= free) fit = `<p>About <b>${plural(toPlan, 'more course')}</b> to place. They fit in your ${plural(study.length, 'study term')} at ${NORMAL} a term (${plural(free, 'open slot')}).</p>`;
    else {
      const extra = toPlan - free;
      fit = `<p>About <b>${plural(toPlan, 'more course')}</b> to place, <b>${extra} more</b> than fit at ${NORMAL} a term. That’s ${plural(Math.ceil(extra / NORMAL), 'extra term')}${NORMAL < SLOTS ? `, or ${NORMAL + 1} courses in ${plural(extra, 'term')}${extra > study.length ? ' (more overloads than you have terms)' : ''}` : ''}.</p>`;
    }
  }
  const unitLine = degreeUnits ? `<p>${units(plannedU)} of ${units(degreeUnits)} units planned.</p>` : `<p>${plural(plannedN, 'course')} planned, ${units(plannedU)} units.</p>`;
  const len = lengthOf(state.start, state.rows.map((r) => r.k));
  const span = len.terms ? ` ${esc(E.termName(state.start))} to ${esc(E.termName(len.end))}: <b>${esc(yearsText(len.terms))}</b>.` : '';
  const all = average(A.graded);
  const avgLine = all ? `<p>Cumulative average <b>${pct(all.avg)}</b> <span class="t">over ${plural(all.n, 'graded course')}${A.graded.some((x) => x.v == null) ? ' (CR and the like aren’t in it)' : ''}</span></p>` : '';
  const summary = `<section class="pw-box"><h2>Your degree</h2>${unitLine}${avgLine}<p>${plural(study.length, 'study term')}${len.work ? ` and ${plural(len.work, 'work term')}` : ''}${over ? `, ${plural(over, 'with an overload', 'with overloads')}` : ''}.${span}</p>${fit}${gaps ? `<p class="t">Counted from requirements that name courses; ones in words that the grid can’t check are ticked by hand below.</p>` : ''}</section>`;
  const checklists = A.plans.map((p, k) => checklistHtml(p, A.evals[k], k)).join('');
  return `${summary}${checklists}`;
}

function chip(code, state_, mark = null) {
  const title = E.isPlaceholder(E.baseCode(code)) ? `Placeholder for ${phText(code)}` : C[code]?.[0] ?? '';
  return `<button type="button" class="pw-chip ${state_}${E.isPlaceholder(E.baseCode(code)) ? ' ph' : ''}${mark ? ` ${mark.cls}` : ''}" data-add="${esc(code)}" title="${esc(`${title}${mark ? ` · ${mark.why}` : ''}${state_ === 'no' ? ' · click to put it in the grid' : state_ === 'ok' ? ' · in your grid' : ''}`)}">${esc(fmt(code))}</button>`;
}

function checklistHtml(p, ev, k) {
  const done = ev.need ? Math.round((ev.have / ev.need) * 100) : 0;
  const open = new Map(poolsNow()[k].map((pl) => [pl.key, pl]));
  const browse = (row) => {
    const pl = open.get(row.key);
    return pl ? ` <button type="button" class="pw-linkbtn pw-browse" data-find="${k}|${esc(row.key)}">Browse ${pl.codes.length}</button>` : '';
  };
  const rows = ev.rows
    .map((row) => {
      const pad = `style="--d:${row.depth}"`;
      const st = (code) => (row.got?.includes(code) ? 'ok' : A.planned.has(code) ? 'el' : 'no');
      const codes = (list, max = 24) => {
        const shown = list.slice(0, max).map((c) => chip(c, st(c))).join('');
        return list.length > max ? `${shown}<details class="pw-more"><summary>${list.length - max} more</summary>${list.slice(max).map((c) => chip(c, st(c))).join('')}</details>` : shown;
      };
      if (row.kind === 'heading') return row.text ? `<h4 ${pad}>${esc(row.text)}${row.need ? ` <span class="t">${row.have} of ${row.need}</span>` : ''}</h4>` : '';
      if (row.kind === 'group') return `<p class="pw-g" ${pad}>${esc(row.text)}${row.need ? ` <span class="t">${row.have} of ${row.need}</span>` : ''}${browse(row)}</p>`;
      if (row.kind === 'all' || row.kind === 'n') return `<div class="pw-r ${row.got.length >= row.want ? 'done' : ''}" ${pad}><span class="pw-lead">${row.kind === 'all' ? (row.codes.length > 1 ? 'All of' : 'Required') : `${row.want} of`}</span>${codes(row.codes)}${row.kind === 'n' ? browse(row) : ''}</div>`;
      if (row.kind === 'list') return `<div class="pw-r" ${pad}><span class="pw-lead">Choose from</span>${codes(row.codes, 16)}</div>`;
      if (row.kind === 'not') return `<div class="pw-r ${row.bad.length ? 'bad' : ''}" ${pad}><span class="pw-lead">Can’t count</span>${row.codes.map((c) => chip(c, A.planned.has(c) ? 'bad' : 'no')).join('')}</div>`;
      if (row.kind === 'max') return `<div class="pw-r ${row.over ? 'bad' : ''}" ${pad}><span class="pw-lead">At most ${esc(row.n)} of</span>${codes(row.codes, 12)}</div>`;
      if (row.kind === 'units' || row.kind === 'count') {
        const done = row.kind === 'units' ? row.sum >= row.units - 1e-9 : row.got.length >= row.want;
        const prog = row.kind === 'units' ? `${units(row.sum)} of ${units(row.units)} units` : `${row.got.length} of ${row.want}`;
        return `<div class="pw-r ${done ? 'done' : ''}" ${pad}><p>${esc(row.text)} <span class="t">${prog}</span>${browse(row)}</p>${row.got.map((c) => chip(c, 'ok')).join('')}</div>`;
      }
      if (row.kind === 'info') return `<p class="pw-info" ${pad}>${esc(row.text)}</p>`;
      return `<label class="pw-r pw-tick ${row.done ? 'done' : ''}" ${pad}><input type="checkbox" data-tick="${esc(row.tick)}"${row.done ? ' checked' : ''}> ${esc(row.text)}</label>`;
    })
    .join('');
  const tu = p.tu ? `<p class="t">The calendar asks for ${units(p.tu)} units in all.</p>` : '';
  return `<details class="pw-box pw-check" open><summary><i class="pw-dot d${k % 8}"></i><b>${esc(p.n)}</b><span class="pw-prog"><span style="width:${done}%"></span></span><span class="t">${ev.have} of ${ev.need}${ev.unknown ? '+' : ''}</span></summary>${tu}${rows || '<p class="t">The calendar lists no courses by name for this one; see its page.</p>'}${averagesHtml(p, k)}<p class="t">${p.src ? `<a href="${esc(p.src)}" rel="noopener">All of its rules</a>, in the ${esc(labelOf(calYear))} calendar` : `<a href="/programs/${esc(p.s)}/">All of its rules</a>`}</p></details>`;
}

/** A plan's minimum averages against the grades in the grid, and the degree's limit on failed courses. */
function averagesHtml(p, k) {
  const lines = (p.avg ?? []).map((a) => {
    // Without a map of subjects to faculties (Open Data), a faculty's average is one to check by hand.
    if (a.k === 'hand' || (a.k === 'fac' && !Object.keys(SF).length)) return `<li class="hand"><span>${esc(a.t)}</span> <span class="t">check by hand</span></li>`;
    const got = averageFor(a, p, k);
    const cap = (x) => x.replace(/^./, (y) => y.toUpperCase());
    const lead = a.label ? `${cap(a.label)} average: ` : '';
    const FAC = { mat: 'Math', art: 'Arts', sci: 'Science', eng: 'Engineering', env: 'Environment', hea: 'Health' };
    const name =
      a.k === 'overall' ? 'Cumulative overall average'
      : a.k === 'term' ? 'Each term’s average'
      : a.k === 'plan' ? `${cap(a.label ?? 'plan')} average`
      : a.k === 'subj' ? `${lead}${a.subj.join(', ')} courses`
      : a.k === 'fac' ? `${lead}${FAC[a.fac] ?? ''} courses`
      : a.label ? `${cap(a.label)} average` : 'Average over its listed courses';
    const ok = got ? got.avg >= a.min - 1e-9 : null;
    const yours = got ? `${a.k === 'term' ? `lowest ${pct(got.avg)} (${esc(E.termName(termOf(got.row)))})` : `yours ${pct(got.avg)}`} <span class="t">over ${plural(got.n, 'course')}</span>` : a.k === 'codes' && a.n ? `<span class="t">applies from ${a.n} of its courses</span>` : '<span class="t">no grades yet</span>';
    return `<li class="${ok === true ? 'ok' : ok === false ? 'bad' : ''}" title="${esc(a.t)}"><span>${esc(name)}: at least ${pct(a.min)}%</span> ${yours}</li>`;
  });
  if (p.fx != null) {
    const fails = A.graded.filter((x) => failed(x.g) && x.g !== 'WD' && !/^(PD|COOP)\d/.test(x.code));
    const u = fails.reduce((sum, x) => sum + x.u, 0);
    lines.push(`<li class="${u > p.fx + 1e-9 ? 'bad' : fails.length ? '' : 'ok'}"><span>Failed courses: at most ${units(p.fx)} units (not counting COOP and PD)</span> <span class="t">${fails.length ? `${units(u)} so far` : 'none'}${p.ua != null ? `; unusable attempts at most ${units(p.ua)} units` : ''}</span></li>`);
  }
  return lines.length ? `<div class="pw-avgs"><h4>Averages</h4><ul>${lines.join('')}</ul></div>` : '';
}

// ---------------- browsing every plan: what's still open ----------------
// Every plan laid out by faculty and field, the way the calendar's lists of academic plans had them (a field's
// majors, minor, diplomas and specializations in one row), with what goes with your plans first: a major's
// specializations, the majors Arts and Business is taken with. Or every plan of one kind, by faculty or closest
// first, with how much of each the grid already covers and the courses it names one tap from the grid.

let exOpen = null; // {s, row}: the plan whose panel is open, and the row of the list it opened under
const exAll = new Set(); // rules in the open panel showing every course that fits, not the first few
let exCache = { key: '', html: '' }; // the list as last drawn, for drawing the page again without a blank
let exFrom = null; // {code, s, r}: a plan's panel opened from the course card, for "Back to CS 135"
const exView = () => state.exview ?? 'all'; // 'all' (by field) or a kind of plan
const exKey = () => `${exView()}|${state.dir}|${state.exorder ?? 'fac'}|${state.exfac ?? ''}|${dirAll}`;
const OTHER = 'Other plans';
let laidOut = null; // every plan by faculty and field, for the year's plans, and each plan's group
function layout() {
  if (laidOut?.P !== P) {
    const rows = E.byField(P);
    const group = new Map(rows.flatMap((g) => g.rows.flatMap((r) => r.plans.map((p) => [p.s, g.group || OTHER]))));
    laidOut = { P, rows, group };
  }
  return laidOut;
}
const byField = () => layout().rows;
let entryCache = null;
/** What the list is narrowed to: every plan, one faculty's, or an entry program's ({entry: {majors, has}}). */
function exFilter() {
  const f = state.exfac ?? '';
  if (!f.startsWith('entry:')) return { fac: f };
  const name = f.slice(6);
  if (entryCache?.P !== P || entryCache.name !== name) entryCache = { P, name, entry: E.entryProgram(name, P) };
  return entryCache.entry ? { name, entry: entryCache.entry } : { fac: '' };
}
/** The majors you've picked, for who a plan is open to. */
const myMajors = () => state.plans.map((s) => bySlug.get(s)).filter((p) => p?.t === 'Major');
const facKey = (p) => layout().group.get(p.s) ?? (E.facultyOf(p).group || OTHER);
const facName = (g) => (g === OTHER ? g : /\band\b/.test(g) ? `Faculties of ${g}` : `Faculty of ${g}`);
let exLast = null; // {code, r, c}: a course just put in the grid from the list
let exTease = ''; // the closed list's summary as last worked out, for drawing the page again
let dirAll = false;

function exploreShell() {
  const study = state.rows.map((r, i) => ({ r, i })).filter((x) => x.r.k === 's');
  const types = TYPE_ORDER.filter((t) => t !== 'Degree Requirements' && P.some((p) => p.t === t));
  const word = (t) => (t === 'Specialization' ? 'Specializations' : `${t}s`);
  const view = exView();
  const facs = [...new Set(byField().map((g) => g.group || OTHER))];
  return `<section class="pw-explore" id="pw-explore" aria-labelledby="pw-still-h">
<div class="pw-stillbar"><h2 id="pw-still-h">Still open</h2> <span class="t">Every plan, by faculty and field: what goes with yours, how much of each your grid covers, and each one’s courses one tap from your grid.</span>
<div class="pw-exbar"><div class="pw-tabs" role="group" aria-label="Show"><button type="button" data-dir="all" aria-pressed="${view === 'all'}">All, by field</button>${types.map((t) => `<button type="button" data-dir="${t}" aria-pressed="${view === t}">${word(t)}</button>`).join('')}<button type="button" data-dir="grad" aria-pressed="${view === 'grad'}">Graduate</button></div>
<label>Show <select id="pw-exfac"><option value="">All faculties</option><optgroup label="One faculty">${facs.map((g) => `<option value="${esc(g)}"${state.exfac === g ? ' selected' : ''}>${esc(g)}</option>`).join('')}</optgroup><optgroup label="A first-year entry program">${E.ENTRY_PROGRAMS.map((e) => `<option value="entry:${esc(e.name)}"${state.exfac === `entry:${e.name}` ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup></select></label>
<span class="pw-exopts" id="pw-exopts"${view === 'all' || view === 'grad' ? ' hidden' : ''}><label>Order <select id="pw-exorder"><option value="fac"${state.exorder !== 'near' ? ' selected' : ''}>by faculty</option><option value="near"${state.exorder === 'near' ? ' selected' : ''}>closest first</option></select></label>
<label>Counting <select id="pw-cut"><option value="-1"${state.cut === -1 ? ' selected' : ''}>the whole grid</option>${study.map((x) => `<option value="${x.i}"${state.cut === x.i ? ' selected' : ''}>through ${esc(A.lv[x.i])} (${esc(E.termName(termOf(x.i)))})</option>`).join('')}</select></label></span></div>
<p class="pw-exlast" id="pw-exlast" role="status"></p></div>
<div class="pw-exlist" id="pw-dirlist" tabindex="-1">${exCache.key === exKey() ? exCache.html : '<p class="t">Working it out…</p>'}</div>
<p class="t pw-exfoot">Tap a plan for its courses: add the plan, or put any of its courses in your grid without taking it (electives from a minor). Majors, Minors and the rest show how much of each your grid covers; Graduate has every master’s, PhD and diploma. Each plan’s page has all its rules; <a href="/programs/">every plan, by faculty</a>, <a href="/programs/grad/">graduate programs</a>.</p></section>`;
}

// ---------------- graduate programs ----------------
// The Graduate Calendar's master's, PhDs and diplomas (/pathways/grad.json, from scripts/lib/gradprograms.mjs),
// loaded the first time someone opens Graduate: by faculty and field like the rest, each one's study options,
// courses and milestones in its panel, and the ones in your majors' fields first.
let GRAD = null;
let gradPromise = null;
function loadGrad() {
  gradPromise ??= fetch(`/pathways/grad.json?v=${V}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((g) => (GRAD = g?.list ? g : { list: [], ct: {}, cat: '', failed: true }));
  return gradPromise;
}
const GRAD_ORDER = ["Master's", 'PhD', 'Graduate Diploma'];
const gradLabel = (g, field = g.fi) => `${g.d}${g.su && g.su !== field ? ` in ${g.su}` : ''}${g.v ? ` · ${g.v}` : ''}`;
function gradChip(g, label, row) {
  const s = `g:${g.s}`;
  const open = exOpen?.s === s && exOpen.row === row;
  const tag = g.k?.includes('Co-operative') && !/co-op/i.test(label) ? ' <small class="pw-ftag">co-op</small>' : '';
  return `<button type="button" class="pw-fc" data-exopen="${esc(s)}" aria-expanded="${open}" title="${esc(g.n)}">${esc(label)}${tag}</button>`;
}
function gradPanel(g, key) {
  const facts = [g.o?.length && `Study options: ${g.o.join(', ')}`, g.k?.length && g.k.join(', '), g.adm?.length && `admits in ${g.adm.join(', ')}`, g.reg?.length && g.reg.join(' or ').toLowerCase(), g.del?.length && g.del.join(' and ').toLowerCase()].filter(Boolean);
  const course = (c) => `<li><span class="pw-pdc"><a href="/${esc(c.toLowerCase())}/">${esc(fmt(c))}</a> ${esc(GRAD.ct[c] || C[c]?.[0] || '')}</span></li>`;
  const parts = (g.req ?? []).map((r, i) => {
    const codes = r.c ?? [];
    const shown = exAll.has(`g:${g.s}|${i}`) ? codes : codes.slice(0, SHORT_LIST);
    return `<div class="pw-pdrule"><p class="pw-pdlab">${esc(r.h)}${codes.length ? ` <span class="t">${plural(codes.length, 'course')} named</span>` : ''}</p>${shown.length ? `<ul class="pw-pdlist" id="pw-pdl${i}">${shown.map(course).join('')}</ul>` : ''}${codes.length > shown.length ? `<p class="pw-pdmore"><button type="button" class="pw-linkbtn" data-pdall="${i}" data-pdi="${i}">All ${codes.length}</button></p>` : ''}${r.t ? `<p class="pw-pdw">${esc(r.t)}</p>` : ''}${r.m ? `<p class="pw-pdw"><b>Milestones:</b> ${esc(r.m)}</p>` : ''}</div>`;
  });
  return `<div class="pw-pd" id="pw-pd" data-row="${esc(key)}" role="region" aria-label="${esc(g.n)}">
<div class="pw-pdhead"><p><b>${esc(g.n)}</b> <span class="t">${esc(g.t)}${g.u ? ` · ${esc(g.u)}` : ''}</span></p><p class="pw-pdacts"><a href="/programs/grad/${esc(g.s)}/">Its page</a> <button type="button" class="pw-pdx" data-exclose aria-label="Close ${esc(g.n)}">×</button></p></div>
${g.notice ? `<p class="pw-pdnote"><span class="pw-no">${esc(g.notice)}</span></p>` : ''}
${facts.length ? `<p class="pw-pdprog">${esc(facts.join(' · '))}.</p>` : ''}
${parts.join('')}
<p class="t pw-pdfoot">From the ${esc(GRAD.cat)} Graduate Calendar. Its page has admission requirements, research areas and the rest.</p></div>`;
}
/** Every graduate program by faculty and field; the ones in your majors' fields first (accelerated ones on top). */
function gradHtml() {
  const { fac } = exFilter();
  if (!GRAD.list.length) return `<p class="t">${GRAD.failed ? 'The graduate programs didn’t load. <a href="/programs/grad/">Every graduate program</a>' : 'No graduate programs here.'}</p>`;
  const order = (a, b) => /^Accelerated/.test(b.d) - /^Accelerated/.test(a.d) || GRAD_ORDER.indexOf(a.t) - GRAD_ORDER.indexOf(b.t) || gradLabel(a).localeCompare(gradLabel(b));
  const panelIn = (key, list) => {
    if (exOpen?.row !== key || !exOpen.s.startsWith('g:')) return '';
    const g = list.find((x) => `g:${x.s}` === exOpen.s);
    return g ? gradPanel(g, key) : '';
  };
  const row = (key, head, note, list, field) => `<div class="pw-frow" data-row="${esc(key)}"><span class="pw-fname">${esc(head)}</span><span class="pw-fchips">${note ? `<span class="pw-fnote">${esc(note)}</span>` : ''}${list.map((g) => gradChip(g, gradLabel(g, field), key)).join('')}</span></div>${panelIn(key, list)}`;
  const parts = [];
  const mine = myMajors()
    .map((m) => {
      const { name, kind } = E.planParts(m);
      const list = GRAD.list.filter((g) => g.fi === m.fi || g.su === m.fi || g.su === name).sort(order);
      return list.length ? row(`gmine:${m.s}`, `${name} · ${kind}`, `${plural(list.length, 'graduate program')} in its field${list.some((g) => /^Accelerated/.test(g.d)) ? ', the accelerated one taken in your last undergraduate year' : ''}`, list, '') : '';
    })
    .filter(Boolean);
  if (mine.length) parts.push(`<section class="pw-exgroup pw-exwith"><h3>For your majors</h3>${mine.join('')}</section>`);
  const groups = new Map();
  for (const g of GRAD.list) {
    const grp = E.facultyOf(g).group || OTHER;
    if (fac && !fac.startsWith('entry:') && grp !== fac) continue;
    if (!groups.has(grp)) groups.set(grp, new Map());
    const fields = groups.get(grp);
    if (!fields.has(g.fi)) fields.set(g.fi, []);
    fields.get(g.fi).push(g);
  }
  for (const [grp, fields] of [...groups].sort((a, b) => E.facultyRank(a[0] === OTHER ? '' : a[0]) - E.facultyRank(b[0] === OTHER ? '' : b[0]) || a[0].localeCompare(b[0]))) {
    const n = [...fields.values()].reduce((k, xs) => k + xs.length, 0);
    parts.push(`<section class="pw-exgroup"><h3>${esc(facName(grp))} <span class="t">${plural(n, 'graduate program')}</span></h3>${[...fields]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([field, list]) => row(`g|${grp}|${field}`, field, '', list.sort(order), field))
      .join('')}</section>`);
  }
  return parts.join('') || '<p class="t">No graduate programs here.</p>';
}

/**
 * What goes with the plans you've picked, for the top of the list: a major's specializations, the majors Arts and
 * Business is taken with, the majors a specialization is for. Each: {key, head, note, plans, label(plan), tease}.
 */
function withYourPlans() {
  const out = [];
  for (const c of state.plans.map((s) => bySlug.get(s)).filter(Boolean)) {
    const { name, kind } = E.planParts(c);
    const head = c.t === 'Major' ? `${name} · ${kind}` : `${name} ${c.t.toLowerCase()}`;
    const named = (q) => {
      const x = E.planParts(q);
      return q.t === 'Major' && x.kind !== 'BA Honours' ? `${x.name} · ${x.kind}` : x.name;
    };
    const tw = E.takenWith(c, P);
    if (tw && !tw.plans.some((q) => state.plans.includes(q.s))) {
      const tease = c.fi === 'Arts and Business' ? `${name}: pick from ${tw.plans.length} Arts honours majors` : tw.plans.length ? `${name} is for ${tw.plans.length === 1 ? named(tw.plans[0]) : `${tw.plans.length} majors`}` : '';
      out.push({ key: `${c.s}:with`, head, note: tw.text, plans: tw.plans, label: named, tease });
    }
    if (c.t !== 'Major') continue;
    // The options its degree can take (an option lists the degrees it's for: an engineering major's thirteen).
    const opts = E.optionsFor(c, P).sort((a, b) => E.planParts(a).name.localeCompare(E.planParts(b).name));
    if (opts.length && !out.some((w) => w.opts && w.plans.length === opts.length && w.plans.every((q, i) => q === opts[i]))) {
      const picked = opts.some((q) => state.plans.includes(q.s));
      out.push({ key: `${c.s}:opt`, opts: true, head, note: `${opts.length === 1 ? 'An option' : `${opts.length} options`} for its degree (${kind.split(' ')[0]})`, plans: opts, label: (q) => E.planParts(q).name, tease: picked ? '' : `${plural(opts.length, 'option')} for ${name}` });
    }
    // Its specializations (the calendar lists which majors each is open to), yours among them ticked.
    const xs = E.openTo(c, P)
      .filter((q) => q.t === 'Specialization')
      .sort((a, b) => E.planParts(a).name.localeCompare(E.planParts(b).name));
    if (!xs.length) continue;
    const picked = xs.some((q) => state.plans.includes(q.s));
    out.push({ key: `${c.s}:spec`, head, note: xs.length === 1 ? 'Its specialization' : `Its ${xs.length} specializations`, plans: xs, label: (q) => E.planParts(q).name, tease: picked ? '' : `${plural(xs.length, 'specialization')} for ${name}` });
  }
  return out;
}
/** A plan's chip in the list: tap to add it; yours, or ones that can't go with yours, say so. */
/**
 * A plan's chip in the list: tap to open its panel (its courses, Add). Yours are ticked; ones that can't go with
 * yours, or that the calendar keeps for other students, are struck out, and their panels say why.
 */
function planChip(p, label, row) {
  const open = exOpen?.s === p.s && exOpen.row === row;
  const mine = state.plans.includes(p.s);
  const no = mine ? [] : state.plans.filter((c) => cant.get(p.s)?.has(c) || cant.get(c)?.has(p.s));
  // Who it's for, as the calendar says: "Math students only", "paused".
  const who = E.whoFor(p, myMajors());
  const tag = who.tag && !mine ? ` <small class="pw-ftag">${esc(who.tag)}</small>` : '';
  const cls = mine ? ' got' : no.length || !who.ok ? ' no' : '';
  const why = mine ? 'one of your plans' : no.length ? `can’t go with ${E.planParts(bySlug.get(no[0])).name}` : who.why;
  return `<button type="button" class="pw-fc${cls}" data-exopen="${esc(p.s)}" aria-expanded="${open}" title="${esc(p.n)}${why ? `: ${esc(why)}` : ''}">${esc(label)}${mine ? ' ✓' : ''}${tag}</button>`;
}
/** A plan's name in its field's row: "BA Honours" in Economics, "Literature · BA Honours" in English. */
function fieldLabel(p, field) {
  const { name, kind } = E.planParts(p);
  if (p.t === 'Specialization' || p.t === 'Option') return name;
  if (p.t === 'Major') {
    if (name === field) return kind;
    if (/Double Degree$/.test(name)) return `Double degree · ${kind}`;
    return `${name.startsWith(`${field} - `) ? name.slice(field.length + 3) : name} · ${kind}`;
  }
  return name === field ? p.t : `${name} ${p.t.toLowerCase()}`;
}
/** Every plan by faculty and field, what goes with yours first. */
function allHtml(withYours) {
  const { fac, name, entry } = exFilter();
  const parts = [];
  if (entry) parts.push(`<p class="pw-exnote"><b>${esc(name)}</b> is an entry program: first-years in it choose one of these ${entry.majors.length} majors (shown with their minors and specializations), as Waterloo’s <a href="https://uwaterloo.ca/future-students/programs/majors-and-entry-programs">majors and entry programs</a> list them.</p>`);
  if (withYours.length)
    parts.push(
      `<section class="pw-exgroup pw-exwith"><h3>With your plans</h3>${withYours
        .map((w) => `<div class="pw-frow" data-row="${esc(w.key)}"><span class="pw-fname">${esc(w.head)}</span><span class="pw-fchips"><span class="pw-fnote">${esc(w.note)}${w.plans.length ? '' : '.'}</span>${w.plans.map((q) => planChip(q, w.label(q), w.key)).join('')}</span></div>${panelAfter(w.key, w.plans)}`)
        .join('')}</section>`,
    );
  for (const { group, rows: all } of byField()) {
    const g = group || OTHER;
    if (fac && g !== fac) continue;
    const rows = entry ? all.map((r) => ({ ...r, plans: r.plans.filter(entry.has) })).filter((r) => r.plans.some((p) => p.t === 'Major')) : all;
    if (!rows.length) continue;
    const n = rows.reduce((k, r) => k + r.plans.length, 0);
    parts.push(
      `<section class="pw-exgroup"><h3>${esc(facName(g))} <span class="t">${plural(n, 'plan')}</span></h3>${rows
        .map((r) => {
          const main = r.plans.filter((p) => p.t !== 'Specialization');
          const specs = r.plans.filter((p) => p.t === 'Specialization');
          const arbus = main.find((p) => p.t === 'Major' && p.fi === 'Arts and Business');
          const key = `${g}|${r.field}`;
          return `<div class="pw-frow" data-row="${esc(key)}"><span class="pw-fname">${esc(r.field)}${r.college ? ` <span class="pw-col">${esc(r.college)}</span>` : ''}</span><span class="pw-fchips">${main.map((p) => planChip(p, fieldLabel(p, r.field), key)).join('')}${specs.length ? `<span class="pw-flab">${specs.length === 1 ? 'Specialization' : 'Specializations'}</span>${specs.map((p) => planChip(p, fieldLabel(p, r.field), key)).join('')}` : ''}${arbus ? `<span class="pw-fnote">with a Faculty of Arts honours major</span>` : ''}</span></div>${panelAfter(key, r.plans)}`;
        })
        .join('')}</section>`,
    );
  }
  return parts.join('') || '<p class="t">No plans here.</p>';
}

let dirTimer = 0;
function scheduleDirections() {
  clearTimeout(dirTimer);
  dirTimer = setTimeout(renderDirections, 120);
}
/** What the grid has (through the term picked under Counting). */
function exPlanned() {
  const planned = new Map();
  state.rows.forEach((r, i) => {
    if (!hasCells(r) || (state.cut >= 0 && i > state.cut)) return;
    r.c.forEach((code, j) => {
      if (code && A.keys[i]?.[j] !== null) planned.set(code, { units: C[code]?.[1] ?? 0.5 });
    });
  });
  return planned;
}
// ---------------- a plan's panel ----------------
// Any plan, from any chip or row of the list: what it still asks for, rule by rule, with each course's title,
// when it runs and what it needs first, one tap from the grid (without taking the plan: electives from a minor);
// the courses that fit a rule in words ("2.0 units of ECON at the 200-level or above") too, and their subject's
// page for the rest; Add, and the plan's page.
const SHORT_LIST = 8;
/** The row a plan's panel opens under when nothing else says which: its field's, in its faculty. */
const rowOf = (p) => `${facKey(p)}|${E.fieldOf(p)}`;
/** The panel, after the row it was opened from, when that row has the plan. */
function panelAfter(key, plans) {
  if (exOpen?.row !== key) return '';
  const p = plans.find((q) => q.s === exOpen.s);
  return p ? planPanel(p, key) : '';
}
/** When a course ran lately: F W S, each lit for a term it ran in in the last 4 years. */
const runsHtml = (c) => {
  const x = C[c]?.[5];
  return `<span class="pw-ss">${['F', 'W', 'S'].map((t, i) => `<abbr class="${x?.[i] ? 'on' : ''}" title="${esc(`${SEASONS[t]}: ${x?.[i] ? `ran in ${x[i]} of the last 4 years` : 'not lately'}`)}">${t}</abbr>`).join('')}</span>`;
};
const ranLately = (c) => Boolean(C[c]?.[5]?.some((n) => n > 0));
function planPanel(p, key) {
  const planned = A.planned;
  const have = new Set(planned.keys());
  const plansCtx = A.plans.map((q) => ({ code: q.c, faculty: q.f, name: q.n }));
  const mine = state.plans.includes(p.s);
  const { name, kind } = E.planParts(p);
  const { college } = E.facultyOf(p);
  const ev = E.evaluate(p, planned, { courses: C, faculty: SF });
  const no = mine ? [] : state.plans.filter((c) => cant.get(p.s)?.has(c) || cant.get(c)?.has(p.s));
  const who = E.whoFor(p, myMajors());
  const tw = E.takenWith(p, P);
  const kindWord = p.t === 'Degree Requirements' ? 'degree requirements' : p.t.toLowerCase();
  const notes = [
    no.length && `<span class="pw-no">Can’t go with ${esc(no.map((c) => E.planParts(bySlug.get(c)).name).join(', '))}.</span>`,
    who.why && `<span${who.ok ? '' : ' class="pw-no"'}>${esc(who.why)}</span>`,
    tw && `<span>${esc(tw.text)}${tw.plans.length ? `: ${tw.plans.slice(0, 4).map((q) => esc(E.planParts(q).name + (q.t === 'Major' ? ` (${E.planParts(q).kind})` : ''))).join(', ')}${tw.plans.length > 4 ? ` and ${tw.plans.length - 4} more` : ''}` : ''}.</span>`,
  ].filter(Boolean);
  const course = (c) => {
    const x = C[c] ?? [];
    let need = '';
    if (x[2]?.length && E.holds(x[2], have, { plans: plansCtx, equiv }) === false) {
      const w = E.why(x[2], have, { plans: plansCtx, equiv });
      if (w.codes.length) need = ` <span class="pw-pdneed">needs ${esc(needsText(w))}</span>`;
    }
    return `<li><button type="button" class="pw-pdadd" data-exadd="${esc(c)}" title="Put ${esc(fmt(c))} in your grid: in its year, after its prerequisites, in a term it runs" aria-label="Put ${esc(fmt(c))} in your grid">+</button><span class="pw-pdc"><a href="/${esc(c.toLowerCase())}/">${esc(fmt(c))}</a> ${esc(x[0] ?? '')}</span> ${runsHtml(c)}${need}</li>`;
  };
  // In the grid already: the courses it names that are planned.
  const got = [...new Set(ev.rows.flatMap((r) => r.got ?? []).map((k) => E.baseCode(k)))].filter((c) => C[c]);
  const pools = E.pools(p, planned, { courses: C, equiv, faculty: SF });
  const above = new Set();
  const rules = pools.map((pl, i) => {
    // A rule in words lists what else fits: the courses named by the rules above it are there already.
    const listed = pl.kind === 'words' ? pl.codes.filter((c) => !above.has(c)) : pl.codes;
    for (const c of pl.codes) above.add(c);
    // Long lists: the ones that ran lately first, in the calendar's order otherwise.
    const codes = listed.length > SHORT_LIST ? [...listed].sort((a, b) => ranLately(b) - ranLately(a)) : listed;
    const all = exAll.has(`${p.s}|${pl.key}`);
    const shown = all ? codes : codes.slice(0, SHORT_LIST);
    const subjects = pl.kind === 'words' ? [...new Set(pl.codes.map((c) => /^[A-Z]+/.exec(c)?.[0]).filter(Boolean))] : [];
    if (!codes.length && !subjects.length) return '';
    const label = pl.kind === 'words' ? pl.label.replace(/^Complete /, '') : pl.label;
    return `<div class="pw-pdrule"><p class="pw-pdlab">${esc(label)} <span class="t">${pl.left} more${pl.where && pl.where !== 'Required Courses' ? ` · ${esc(pl.where)}` : ''}${pl.kind === 'words' ? ` · ${plural(pl.codes.length, 'course fits', 'courses fit')}${codes.length < pl.codes.length ? `, ${codes.length} besides the ones above` : ''}` : ''}</span></p><ul class="pw-pdlist" id="pw-pdl${i}">${shown.map(course).join('')}</ul>${codes.length > shown.length || subjects.length ? `<p class="pw-pdmore">${codes.length > shown.length ? `<button type="button" class="pw-linkbtn" data-pdall="${esc(pl.key)}" data-pdi="${i}">All ${codes.length}</button>` : ''}${subjects.length && subjects.length <= 3 ? `${codes.length > shown.length ? ' · ' : ''}${subjects.map((sj) => `<a href="/${esc(sj.toLowerCase())}/">every ${esc(sj)} course</a>`).join(', ')}` : ''}</p>` : ''}</div>`;
  });
  // Rules in words the grid can't list courses for ("1.0 unit from the Faculty of Arts").
  const words = [];
  const walk = (nodes) => nodes.forEach((n) => (n.g ? walk(n.i) : !n.r && n.t && !n.info && !n.subj && !n.rg && !n.pl && (n.u || n.nc || n.lv || n.en) && words.push(n.t)));
  const sec = (x) => (walk(x.r), x.l.forEach(sec));
  p.req.forEach(sec);
  const progress = ev.need ? `${ev.have} of ${ev.need}${ev.unknown ? '+' : ''} courses it names are in your grid${ev.need > ev.have ? ` · ${ev.need - ev.have} to go` : ' · all planned'}` : 'It names no courses: its rules are in words';
  const acts = mine
    ? `<span class="pw-fc got">One of your plans ✓</span> <button type="button" class="pw-linkbtn" data-unplan="${esc(p.s)}">Remove</button>`
    : no.length || !who.ok
      ? ''
      : `<button type="button" class="pw-pdaddplan" data-plan="${esc(p.s)}">Add this ${esc(kindWord)}</button>`;
  return `<div class="pw-pd" id="pw-pd" data-row="${esc(key)}" role="region" aria-label="${esc(p.n)}">
<div class="pw-pdhead"><p><b>${esc(name)}</b> <span class="t">${esc(p.t === 'Major' ? kind : p.t)}${p.f ? ` · ${esc(p.f.replace(/^Facult(?:y|ies) of /, ''))}` : ''}${college ? ` (${esc(college)})` : ''}</span></p><p class="pw-pdacts">${exFrom?.s === p.s && exFrom.code ? `<button type="button" class="pw-linkbtn" data-dback>↑ Back to ${esc(fmt(exFrom.code))}</button> ` : ''}${acts}${acts ? ' ' : ''}<a href="/programs/${esc(p.s)}/">Its page</a> <button type="button" class="pw-pdx" data-exclose aria-label="Close ${esc(name)}">×</button></p></div>
${notes.length ? `<p class="pw-pdnote">${notes.join(' ')}</p>` : ''}
<p class="pw-pdprog">${esc(progress)}.${got.length ? ` In your grid: ${got.map((c) => `<span class="pw-exc got">${esc(fmt(c))} ✓</span>`).join(' ')}` : ''}</p>
${rules.join('')}
${words.length ? `<ul class="pw-pdwords">${[...new Set(words)].slice(0, 5).map((w) => `<li>${esc(w.replace(/^Complete /, ''))}</li>`).join('')}</ul>` : ''}
${!rules.length && !words.length && ev.need && ev.have >= ev.need ? '<p class="t">Everything it names is in your grid.</p>' : ''}
<p class="t pw-pdfoot">+ puts a course in your grid without taking the plan: electives toward it. <a href="/programs/${esc(p.s)}/">Its page</a> has every rule.</p>
</div>`;
}
/** The list open, scrolled to: from /programs, or Find courses (with a view: minors, closest first). */
function openBrowse({ view = null, order = null } = {}) {
  if (view) state.exview = view;
  if (TYPE_ORDER.includes(view)) state.dir = view;
  if (order) state.exorder = order;
  dirAll = false;
  render();
  clearTimeout(dirTimer);
  renderDirections();
  const box = document.getElementById('pw-explore');
  box?.scrollIntoView({ block: 'start' });
  box?.querySelector('[data-dir][aria-pressed="true"]')?.focus({ preventScroll: true });
}
/** Open a plan's panel in the list (from a program page's link): the list open, by field, scrolled to it. */
function openPanel(s) {
  const p = bySlug.get(s);
  if (!p) return render();
  state.exview = 'all';
  state.exfac = '';
  exOpen = { s, row: rowOf(p) };
  render();
  clearTimeout(dirTimer);
  renderDirections();
  const pd = document.getElementById('pw-pd');
  pd?.scrollIntoView({ block: 'start' });
  pd?.querySelector('a, button')?.focus({ preventScroll: true });
}
function renderDirections() {
  const box = document.getElementById('pw-explore');
  const list = document.getElementById('pw-dirlist');
  if (!box || !list) return;
  const view = exView();
  const { fac, entry } = exFilter();
  for (const b of box.querySelectorAll('[data-dir]')) b.setAttribute('aria-pressed', String(b.dataset.dir === view));
  const opts = document.getElementById('pw-exopts');
  if (opts) opts.hidden = view === 'all' || view === 'grad';
  const withYours = withYourPlans();
  if (exLast && state.rows[exLast.r]?.c[exLast.c] !== exLast.code) exLast = null; // moved or taken out since
  const last = document.getElementById('pw-exlast');
  if (last) last.innerHTML = exLast ? `<b>${esc(fmt(exLast.code))}</b> is in ${esc(A.lv[exLast.r] ?? '')} (${esc(E.termName(termOf(exLast.r)))}). <button type="button" class="pw-linkbtn" data-exundo>Undo</button>` : '';
  // The list keeps its place while the grid changes (and is drawn again from this until the numbers are redone).
  const show = (html) => {
    const top = list.scrollTop;
    const a = document.activeElement;
    const at = a && list.contains(a) ? a.closest('[data-row]')?.dataset.row : null;
    const what = at && ['exadd', 'exopen', 'plan', 'pdall', 'unplan'].find((k) => a.dataset[k] != null);
    list.innerHTML = html;
    list.scrollTop = top;
    if (what) list.querySelector(`[data-row="${CSS.escape(at)}"] [data-${what}="${CSS.escape(a.dataset[what])}"]`)?.focus({ preventScroll: true });
    exCache = { key: exKey(), html };
  };
  const teaser = document.getElementById('pw-extease');
  const tease = { set textContent(text) { exTease = text; if (teaser) teaser.textContent = text; } };
  // Closed, the summary still says what goes with your plans: what someone would come looking for.
  const teaseYours = withYours.map((w) => w.tease).filter(Boolean);
  if (view === 'grad') {
    if (!GRAD) {
      tease.textContent = 'every master’s, PhD and graduate diploma, by faculty and field';
      show('<p class="t">Loading the graduate programs…</p>');
      loadGrad().then(() => exView() === 'grad' && renderDirections());
      return;
    }
    tease.textContent = teaseYours.length ? `With your plans: ${teaseYours.slice(0, 2).join(' · ')}` : `${plural(GRAD.list.length, 'graduate program')} in the ${GRAD.cat} Graduate Calendar, by faculty and field`;
    return show(gradHtml());
  }
  if (view === 'all') {
    tease.textContent = teaseYours.length ? `With your plans: ${teaseYours.slice(0, 2).join(' · ')}` : `${P.filter((p) => p.t !== 'Degree Requirements').length} plans by faculty and field: every major, minor, specialization, option and diploma`;
    show(allHtml(withYours));
    return;
  }
  const planned = exPlanned();
  const majors = A.plans.filter((p) => p.t === 'Major').map((p) => p.s);
  // Ones open to your majors first; specializations for other majors after; ones that can't combine last.
  const forOthers = (p) => Boolean(p.open?.length && !p.open.some((s) => majors.includes(s)));
  const inFac = (p) => (entry ? entry.has(p) : !fac || facKey(p) === fac);
  const mine = myMajors();
  const found = E.directions(P.filter(inFac), planned, { chosen: state.plans, cant, courses: C, types: [view] });
  // Every one, with ones whose rules are all in words (no courses to count) after.
  const inWords = P.filter((p) => p.t === view && inFac(p) && !state.plans.includes(p.s) && !found.some((x) => x.p === p)).map((p) => ({ p, need: 0, have: 0, left: 0, unknown: true, blocked: state.plans.filter((c) => cant.get(p.s)?.has(c) || cant.get(c)?.has(p.s)) }));
  const every = [...found, ...inWords]
    .map((x, i) => ({ ...x, i, other: forOthers(x.p), who: E.whoFor(x.p, mine) }))
    .map((x) => ({ ...x, shut: x.blocked.length > 0 || !x.who.ok }))
    .sort((a, b) => a.shut - b.shut || a.other - b.other || a.i - b.i);
  // Closed, the summary still says which are closest: what someone would come looking for.
  const kinds = view === 'Specialization' ? 'specializations' : `${view.toLowerCase()}s`;
  const near = every.filter((x) => !x.shut && !x.other && x.have > 0 && x.need).slice(0, 2);
  tease.textContent = teaseYours.length ? `With your plans: ${teaseYours.slice(0, 2).join(' · ')}` : near.length ? `${every.length} ${kinds}; closest: ${near.map((x) => `${E.planParts(x.p).name} (${x.left ? `${x.left} to go` : 'done'})`).join(', ')}` : `${every.length} ${kinds} by faculty, with how much of each your grid already covers`;
  const row = ({ p, need, have, left, unknown, blocked, other, who, shut }) => {
    const { name, kind, of } = E.planParts(p);
    const { college } = E.facultyOf(p);
    const open = exOpen?.s === p.s && exOpen.row === p.s;
    const sub = p.t === 'Major' ? kind : of ? `(${of})` : '';
    // A specialization says whose it is; other plans only open to some majors say which.
    const note = blocked.length ? `<span class="pw-no">can’t go with ${esc(E.planParts(bySlug.get(blocked[0])).name)}</span>` : !who.ok ? `<span class="pw-no" title="${esc(who.why)}">${esc(who.tag)}</span>` : who.tag ? `<small class="pw-ftag" title="${esc(who.why)}">${esc(who.tag)}</small>` : other && p.t !== 'Specialization' ? `<span class="t">for ${esc(p.open.map((s) => bySlug.get(s)?.fi).filter(Boolean).slice(0, 2).join(', '))} majors</span>` : '';
    const share = need ? Math.round((100 * have) / need) : 0;
    const prog = need ? `<span class="pw-exprog" title="${have} of ${need}${unknown ? '+' : ''} courses it names"><span class="pw-exmeter" style="--f:${share}%"></span>${left ? `${left} to go` : 'all planned'}</span>` : '<span class="pw-exprog t">rules in words</span>';
    return `<li data-row="${esc(p.s)}"${shut ? ' class="blocked"' : other ? ' class="other"' : ''}><div class="pw-exrow"><span class="pw-exname"><a href="/programs/${esc(p.s)}/" title="${esc(p.n)}">${esc(name)}</a>${sub ? ` <span class="t">${esc(sub)}</span>` : ''}${college ? ` <span class="pw-col">${esc(college)}</span>` : ''}</span> ${prog}${note ? ` ${note}` : ''} <span class="pw-exacts"><button type="button" class="pw-linkbtn" data-exopen="${esc(p.s)}" aria-expanded="${open}">${open ? 'Hide' : 'Courses'}</button>${shut ? '' : ` <button type="button" class="pw-linkbtn" data-plan="${esc(p.s)}">Add</button>`}</span></div>${open ? planPanel(p, p.s) : ''}</li>`;
  };
  if (!every.length) return show(`<p class="t">No ${kinds} ${fac ? `in ${esc(facName(fac))}` : 'here'}.</p>`);
  if (state.exorder === 'near') {
    const shown = dirAll ? every : every.slice(0, 20);
    return show(`<ol class="pw-exitems">${shown.map(row).join('')}</ol>${every.length > 20 ? `<p><button type="button" class="pw-linkbtn" data-act="dirall">${dirAll ? 'Show fewer' : `Show all ${every.length}`}</button></p>` : ''}`);
  }
  // By faculty, A to Z in each, the way the calendar listed its academic plans: ones for your majors first, ones
  // that can't go with your plans last.
  const groups = new Map();
  for (const x of every) {
    const g = facKey(x.p);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  }
  show([...groups]
    .sort((a, b) => E.facultyRank(a[0] === OTHER ? '' : a[0]) - E.facultyRank(b[0] === OTHER ? '' : b[0]) || a[0].localeCompare(b[0]))
    .map(([g, xs]) => `<section class="pw-exgroup"><h3>${esc(facName(g))} <span class="t">${xs.length}</span></h3><ul class="pw-exitems">${xs
      .sort((a, b) => a.shut - b.shut || a.other - b.other || E.planParts(a.p).name.localeCompare(E.planParts(b.p).name) || a.p.n.localeCompare(b.p.n))
      .map(row)
      .join('')}</ul></section>`)
    .join(''));
}

// ---------------- editing ----------------

/** "ECON 351" / "econ351" / "Econ351 - Labour…" → "ECON351"; "pmath 4xx" → "PMATH4XX"; "elective" → "ELECTIVE"; or '' */
function parseCode(text) {
  const t = String(text).trim();
  if (/^(?:free\s+)?elec(?:tive)?s?$/i.test(t)) return 'ELECTIVE';
  const ph = /^([A-Za-z]{2,8}?)\s*([0-9xX])\s*[xX]{2}$/.exec(t);
  if (ph) return `${ph[1]}${ph[2]}XX`.toUpperCase();
  // PD courses and work-term reports have shorter numbers: PD 1, PD 20, WKRPT 200, COOP 3.
  const w = /\b(PD|COOP|WKRPT)\s*(\d{1,3})\b/i.exec(t);
  if (w) return `${w[1]}${w[2]}`.toUpperCase();
  const m = /([A-Za-z]{2,8})\s*(\d{3}[A-Za-z]?)/.exec(t);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : '';
}

/** Puts a course in a cell. grade: a grade to keep with it, null to clear it, or left out (kept unless the
 *  course changes). */
function setCell(r, c, code, grade) {
  if (pending?.r === r && pending?.c === c) pending = null;
  undo = null;
  const row = state.rows[r];
  if (!hasCells(row)) return;
  while (row.c.length <= c) row.c.push('');
  if (row.c[c] !== code && row.g) delete row.g[c];
  row.c[c] = code;
  if (grade !== undefined) {
    row.g ??= {};
    if (grade == null || !code) delete row.g[c];
    else row.g[c] = grade;
  }
  while (row.c.length && !row.c.at(-1)) {
    if (row.g) delete row.g[row.c.length - 1];
    row.c.pop();
  }
  if (row.g && !Object.keys(row.g).length) delete row.g;
}

/** The next row up or down with a cell in column c (a work term has two). */
function studyRowsFrom(r, dir, c = 0) {
  for (let i = r + dir; i >= 0 && i < state.rows.length; i += dir) if (slotsOf(state.rows[i]) > c) return i;
  return null;
}
function focusCell(r, c) {
  const el = app.querySelector(`.pw-in[data-r="${r}"][data-c="${Math.min(c, Math.max(0, slotsOf(state.rows[r]) - 1))}"]`);
  if (el) {
    el.focus();
    el.select();
  }
}

/**
 * Where a course picked from a checklist or Find courses goes: the empty cell you're on, else (from this term on)
 * a term in its year after its prerequisites, in a season it runs, with room (engine.js's arrange).
 */
function place(code) {
  const from = selected && !state.rows[selected.r]?.c[selected.c] ? selected : null;
  if (from) {
    setCell(from.r, from.c, code);
    return { r: from.r, c: from.c };
  }
  const study = state.rows.map((r, i) => (r.k === 's' ? i : -1)).filter((i) => i >= 0);
  const now = study.find((i) => Number(termOf(i)) >= Number(data.term)) ?? study[0] ?? 0;
  const rows = state.rows.map((r, i) => ({ kind: KIND[r.k], season: E.seasonOf(termOf(i)), codes: r.c }));
  const plans = A.plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const at = E.arrange(rows, [{ code }], { courses: C, load: NORMAL, max: SLOTS, from: now, equiv, plans }).placed[0]?.row;
  if (at != null) {
    const j = Array.from({ length: slotsOf(state.rows[at]) }, (_, k) => k).find((k) => !state.rows[at].c[k]);
    setCell(at, j, code);
    return { r: at, c: j };
  }
  state.rows.push({ k: 's', c: [code] });
  return { r: state.rows.length - 1, c: 0 };
}

// Suggestions under the cell being typed in.
let sugg = null;
function closeSugg() {
  sugg?.el.remove();
  sugg = null;
}
function showSugg(input) {
  const q = norm(input.value);
  closeSugg();
  if (!q || q.length < 2) return;
  const words = input.value.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const codes = Object.keys(C).filter((k) => !C[k][7]);
  // A placeholder for a subject ("PMATH 4XX") or an elective, after the courses.
  const phs = [];
  const sm = /^([A-Z]{2,8}?)(\d)?$/.exec(q);
  if (sm && codes.some((k) => k.startsWith(sm[1]) && /\d/.test(k[sm[1].length]))) phs.push(sm[2] ? `${sm[1]}${sm[2]}XX` : `${sm[1]}XXX`);
  if (q.length >= 3 && 'ELECTIVE'.startsWith(q)) phs.push('ELECTIVE');
  const need = neededNow();
  const found = [...codes.filter((k) => k.startsWith(q)), ...(q.length > 2 ? codes.filter((k) => !k.startsWith(q) && words.every((w) => C[k][0].toLowerCase().includes(w))) : [])].sort((a, b) => need.has(b) - need.has(a));
  const hits = [...found.slice(0, 8 - phs.length), ...phs];
  if (!hits.length || (hits.length === 1 && hits[0] === q)) return;
  const el = document.createElement('ul');
  el.className = 'pw-sugg pw-csugg';
  el.setAttribute('role', 'listbox');
  const meets = (k) => {
    const n = need.get(k);
    return n ? `<i class="pw-dot d${n[0].k % 8}" title="${esc(`Counts toward ${A.plans[n[0].k].n}: ${poolLabel(n[0])}`)}"></i>` : '';
  };
  el.innerHTML = hits.map((k, i) => `<li role="option" data-code="${k}" aria-selected="${i === 0}"><b>${esc(fmt(k))}</b> <span>${esc(E.isPlaceholder(k) ? `Placeholder: ${phText(k)}` : C[k][0])}</span>${meets(k)}</li>`).join('');
  const box = input.getBoundingClientRect();
  const host = app.getBoundingClientRect();
  el.style.left = `${box.left - host.left}px`;
  el.style.top = `${box.bottom - host.top + 2}px`;
  app.append(el);
  sugg = { el, hits, active: 0, input };
  el.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-code]');
    if (!li) return;
    e.preventDefault();
    commit(input, li.dataset.code, 1);
  });
}

function commit(input, code = null, move = 0) {
  const r = Number(input.dataset.r);
  const c = Number(input.dataset.c);
  // A course picked from the suggestions keeps a grade typed after it.
  const cell = code != null ? { code, grade: code ? parseCell(input.value).grade : null } : parseCell(input.value);
  closeSugg();
  setCell(r, c, cell.code, cell.grade);
  selected = { r, c };
  render();
  if (move) {
    const next = studyRowsFrom(r, move, c);
    if (next != null) focusCell(next, c);
  }
}

app.addEventListener('focusin', (e) => {
  const input = e.target.closest('.pw-in');
  if (!input) return;
  const r = Number(input.dataset.r);
  const c = Number(input.dataset.c);
  // While you edit a cell it shows its grade too ("CS 135 85"), to change or clear.
  const text = cellText(r, c);
  if (input.value !== text && (!pending || pending.r !== r || pending.c !== c)) input.value = text;
  if (!selected || selected.r !== r || selected.c !== c || shutCard) {
    selected = { r, c };
    shutCard = false;
    const d = document.getElementById('pw-detail');
    if (d) d.innerHTML = detailHtml();
  }
});
app.addEventListener('input', (e) => {
  const input = e.target.closest('.pw-in');
  if (input) {
    pending = { r: Number(input.dataset.r), c: Number(input.dataset.c) };
    showSugg(input);
  }
  const pq = e.target.closest('#pw-pq');
  if (pq) planSuggest(pq);
});
app.addEventListener('keydown', (e) => {
  const input = e.target.closest('.pw-in');
  if (!input) return;
  const r = Number(input.dataset.r);
  const c = Number(input.dataset.c);
  if (sugg && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    sugg.active = (sugg.active + (e.key === 'ArrowDown' ? 1 : -1) + sugg.hits.length) % sugg.hits.length;
    [...sugg.el.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === sugg.active)));
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    commit(input, sugg ? sugg.hits[sugg.active] : null, e.shiftKey ? -1 : 1);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const back = e.shiftKey;
    let nr = r;
    let nc = c + (back ? -1 : 1);
    if (nc >= slotsOf(state.rows[r]) || nc < 0) {
      const next = studyRowsFrom(r, back ? -1 : 1);
      if (next != null) {
        nr = next;
        nc = back ? slotsOf(state.rows[next]) - 1 : 0;
      } else nc = c;
    }
    commit(input, sugg ? sugg.hits[sugg.active] : null, 0);
    focusCell(nr, nc);
  } else if (e.key === 'Escape') {
    closeSugg();
    input.value = cellText(r, c);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = studyRowsFrom(r, e.key === 'ArrowDown' ? 1 : -1, c);
    if (input.value !== cellText(r, c)) commit(input, null, 0);
    if (next != null) focusCell(next, c);
  } else if ((e.key === 'ArrowRight' && input.selectionStart === input.value.length) || (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0)) {
    const nc = c + (e.key === 'ArrowRight' ? 1 : -1);
    if (nc >= 0 && nc < slotsOf(state.rows[r])) {
      e.preventDefault();
      if (input.value !== cellText(r, c)) commit(input, null, 0);
      focusCell(r, nc);
    }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && input.selectionStart === 0 && input.selectionEnd === input.value.length && input.value) {
    e.preventDefault();
    commit(input, '', 0);
    focusCell(r, c);
  }
});
app.addEventListener('focusout', (e) => {
  const input = e.target.closest('.pw-in');
  if (!input) return;
  setTimeout(() => {
    if (!input.isConnected) return;
    const r = Number(input.dataset.r);
    const c = Number(input.dataset.c);
    const now = cellText(r, c);
    if (input.value !== now) commit(input, null, 0);
    else {
      if (sugg?.input === input) closeSugg();
      // Out of the cell: the code again, its grade in the badge.
      const code = state.rows[r]?.c[c];
      if (document.activeElement !== input) input.value = code ? fmt(code) : '';
    }
  }, 120);
});
// Paste: several codes fill down the column (one per line) and across (tabs), like a spreadsheet. A grade right
// after a code comes along ("CS 135 85", "ECON 101 (CR)"); a table copied from here goes back in too.
const CODE_IN = /\b(?:PD|COOP|WKRPT)\s*\d{1,3}\b|[A-Za-z]{2,8}\s*(?:\d{3}[A-Za-z]?|[\dxX][xX]{2}\b)|\belectives?\b/gi;
function cellsOfLine(line) {
  if (line.includes('\t')) {
    const parts = line.split('\t');
    // "Fall 2027 · 2A · CS 240 (85)…" from Copy as a table: the courses start after the term and level.
    const lead = /^(Fall|Winter|Spring) \d{4}$/.test(parts[0]?.trim() ?? '') ? 2 : 0;
    return parts.slice(lead).map((x) => parseCell(x));
  }
  const hits = [...line.matchAll(CODE_IN)];
  return hits.map((m, k) => {
    const rest = line.slice(m.index + m[0].length, hits[k + 1]?.index ?? line.length);
    return { code: parseCode(m[0]), grade: parseGrade(rest) ?? null };
  });
}
app.addEventListener('paste', (e) => {
  const input = e.target.closest('.pw-in');
  if (!input) return;
  const text = e.clipboardData?.getData('text') ?? '';
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^Term\tLevel\t/.test(l));
  const cells = lines.map(cellsOfLine);
  if (lines.length <= 1 && (cells[0]?.length ?? 0) <= 1 && !cells[0]?.[0]?.grade) return;
  e.preventDefault();
  let r = Number(input.dataset.r);
  const c0 = Number(input.dataset.c);
  for (const [k, line] of cells.entries()) {
    if (k > 0) {
      const next = studyRowsFrom(r, 1, c0);
      if (next == null) {
        state.rows.push({ k: 's', c: [] });
        r = state.rows.length - 1;
      } else r = next;
    }
    line.forEach((cell, j) => {
      if (c0 + j < slotsOf(state.rows[r])) setCell(r, c0 + j, cell.code, cell.code ? cell.grade : null);
    });
  }
  render();
});

// Buttons, chips and selects.
app.addEventListener('click', async (e) => {
  const t = e.target;
  const add = t.closest('[data-add]');
  if (add) {
    const code = add.dataset.add;
    peek = null;
    shutCard = false;
    if (A.planned.has(code)) {
      const at = A.planned.get(code).row;
      const j = A.keys[at].indexOf(code);
      selected = { r: at, c: j };
      render();
      app.querySelector(`.pw-in[data-r="${at}"][data-c="${j}"]`)?.focus({ preventScroll: true });
      revealCard(at);
      return;
    }
    const at = place(code);
    selected = at;
    render();
    app.querySelector(`.pw-in[data-r="${at.r}"][data-c="${at.c}"]`)?.focus({ preventScroll: true });
    revealCard(at.r);
    return;
  }
  // The course card: close it, take its course out (it stays on the card, to put back), every plan of a kind.
  if (t.closest('[data-dclose]')) {
    const r = selected?.r;
    peek = null;
    shutCard = true;
    const d = document.getElementById('pw-detail');
    if (d) d.innerHTML = '';
    if (r != null) app.querySelector(`.pw-in[data-r="${r}"]`)?.closest('tr')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (t.closest('[data-dout]') && selected) {
    const code = state.rows[selected.r]?.c[selected.c];
    if (code) {
      setCell(selected.r, selected.c, '', null);
      render();
      peek = code;
      const d = document.getElementById('pw-detail');
      if (d) d.innerHTML = detailHtml();
      document.querySelector('#pw-detail [data-add]')?.focus({ preventScroll: true });
    }
    return;
  }
  const dmore = t.closest('[data-dmore]');
  if (dmore) {
    const code = dmore.closest('.pw-dcard')?.dataset.code;
    const kind = dmore.dataset.dmore;
    const inWords = Boolean(dmore.closest('.pw-dwords'));
    const n = dmore.closest('.pw-dkind')?.querySelectorAll('[data-pshow]').length ?? 0;
    cardMore.add(`${code}|${inWords ? 'w' : 'n'}|${kind}`);
    const d = document.getElementById('pw-detail');
    if (d) d.innerHTML = detailHtml();
    document.querySelectorAll(`#pw-detail ${inWords ? '.pw-dwords' : '.pw-dnamed'} .pw-dkind[data-kind="${CSS.escape(kind)}"] [data-pshow]`)[n]?.focus({ preventScroll: true });
    return;
  }
  // A plan from the card: its panel in Still open, with a way back up to the course.
  const pshow = t.closest('[data-pshow]');
  if (pshow) {
    exFrom = { code: pshow.closest('.pw-dcard')?.dataset.code ?? '', s: pshow.dataset.pshow, r: selected?.r ?? null };
    openPanel(pshow.dataset.pshow);
    return;
  }
  if (t.closest('[data-dback]') && exFrom) {
    const r = exFrom.r;
    exFrom = null;
    clearTimeout(dirTimer);
    renderDirections();
    revealCard(r);
    document.querySelector('#pw-detail .pw-dcard h3 a')?.focus({ preventScroll: true });
    return;
  }
  const un = t.closest('[data-unplan]');
  if (un) {
    const inPanel = Boolean(un.closest('#pw-pd'));
    steady(() => {
      state.plans = state.plans.filter((s) => s !== un.dataset.unplan);
      if (offer === un.dataset.unplan) offer = null;
      render();
      if (inPanel) {
        clearTimeout(dirTimer);
        renderDirections();
      }
    });
    if (inPanel) {
      document.querySelector('#pw-pd [data-plan], #pw-pd [data-exclose]')?.focus({ preventScroll: true });
    }
    return;
  }
  const kindChip = t.closest('[data-ptype]');
  if (kindChip) {
    planType = kindChip.dataset.ptype === planType ? '' : kindChip.dataset.ptype;
    if (planType !== 'Degree Requirements') state.exview = planType || 'all';
    if (planType && planType !== 'Degree Requirements') state.dir = planType;
    const typed = document.getElementById('pw-pq')?.value ?? '';
    render();
    const pq = document.getElementById('pw-pq');
    if (pq) {
      pq.value = typed;
      pq.focus({ preventScroll: true });
      if (planType || typed.trim()) planSuggest(pq);
    }
    return;
  }
  if (t.closest('[data-act="still"]')) {
    const box = document.getElementById('pw-explore');
    box?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    box?.querySelector('[data-dir][aria-pressed="true"]')?.focus({ preventScroll: true });
    return;
  }
  const ent = t.closest('#pw-psugg [data-entry]');
  if (ent) {
    openEntry(ent.dataset.entry);
    return;
  }
  const pl = t.closest('[data-plan]');
  if (pl) {
    const fromList = Boolean(pl.closest('#pw-psugg'));
    const inPanel = pl.closest('#pw-dirlist') ? (pl.closest('[data-row]')?.dataset.row ?? '') : null;
    if (inPanel == null) addPlan(pl.dataset.plan);
    if (fromList) document.getElementById('pw-pq')?.focus({ preventScroll: true });
    if (inPanel != null) {
      steady(() => {
        addPlan(pl.dataset.plan);
        clearTimeout(dirTimer);
        renderDirections();
      });
      const list = document.getElementById('pw-dirlist');
      (document.querySelector('#pw-pd [data-unplan]') ?? list?.querySelector(`[data-row="${CSS.escape(inPanel)}"] button`) ?? list)?.focus({ preventScroll: true });
    }
    return;
  }
  const fb = t.closest('[data-find]');
  if (fb) {
    openFind(fb.dataset.find);
    return;
  }
  const seqBtn = t.closest('[data-seq]');
  if (seqBtn) {
    const [slug, k] = seqBtn.dataset.seq.split(':');
    resequence(seqBtn.dataset.seq);
    coopNote = { slug, k: Number(k) };
    render();
    return;
  }
  const kindBtn = t.closest('[data-kind]');
  if (kindBtn) {
    const row = state.rows[Number(kindBtn.dataset.kind)];
    const next = { s: 'c', c: 'o', o: 's' }[row.k];
    // Each kind keeps its own courses: a study term's wait while it's a work term, and come back with it.
    row.stash ??= {};
    if (row.c.some(Boolean)) row.stash[row.k] = { c: row.c, ...(row.g ? { g: row.g } : {}) };
    const back = row.stash[next];
    delete row.stash[next];
    row.c = back?.c ?? [];
    if (back?.g) row.g = back.g;
    else delete row.g;
    if (!Object.keys(row.stash).length) delete row.stash;
    row.k = next;
    if (selected?.r === Number(kindBtn.dataset.kind)) selected = null;
    undo = null;
    render();
    app.querySelector(`[data-kind="${kindBtn.dataset.kind}"]`)?.focus();
    return;
  }
  const more = t.closest('[data-act="dirall"]');
  if (more) {
    dirAll = !dirAll;
    renderDirections();
    return;
  }
  // A plan's panel: open it under the row it was tapped in (again to close), close it, show every course that fits.
  const op = t.closest('[data-exopen]');
  if (op) {
    const s = op.dataset.exopen;
    const row = op.closest('[data-row]')?.dataset.row ?? s;
    exOpen = exOpen?.s === s && exOpen.row === row ? null : { s, row };
    clearTimeout(dirTimer);
    renderDirections();
    const list = document.getElementById('pw-dirlist');
    list?.querySelector(`[data-row="${CSS.escape(row)}"] [data-exopen="${CSS.escape(s)}"]`)?.focus({ preventScroll: true });
    if (exOpen) document.getElementById('pw-pd')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (t.closest('[data-exclose]') && exOpen) {
    const { s, row } = exOpen;
    exOpen = null;
    exFrom = null;
    clearTimeout(dirTimer);
    renderDirections();
    document.querySelector(`#pw-dirlist [data-row="${CSS.escape(row)}"] [data-exopen="${CSS.escape(s)}"]`)?.focus({ preventScroll: true });
    return;
  }
  const pdall = t.closest('[data-pdall]');
  if (pdall && exOpen) {
    exAll.add(`${exOpen.s}|${pdall.dataset.pdall}`);
    const i = pdall.dataset.pdi;
    clearTimeout(dirTimer);
    renderDirections();
    document.querySelector(`#pw-pdl${i} li:nth-child(${SHORT_LIST + 1}) :is(a, button)`)?.focus({ preventScroll: true });
    return;
  }
  const exadd = t.closest('[data-exadd]');
  if (exadd) {
    const code = exadd.dataset.exadd;
    const plan = exadd.closest('[data-row]')?.dataset.row ?? '';
    steady(() => {
      exLast = { ...place(code), code, plan };
      render();
      clearTimeout(dirTimer);
      renderDirections();
    });
    // On to the panel's next course (or Undo, if that was the last it lists).
    (document.querySelector('#pw-pd [data-exadd]') ?? document.querySelector('[data-exundo]'))?.focus({ preventScroll: true });
    return;
  }
  if (t.closest('[data-exundo]') && exLast) {
    const { r, c, code } = exLast;
    steady(() => {
      if (state.rows[r]?.c[c] === code) setCell(r, c, '');
      exLast = null;
      render();
      clearTimeout(dirTimer);
      renderDirections();
    });
    document.querySelector(`#pw-pd [data-exadd="${CSS.escape(code)}"]`)?.focus({ preventScroll: true });
    return;
  }
  const dir = t.closest('[data-dir]');
  if (dir) {
    state.exview = dir.dataset.dir;
    if (TYPE_ORDER.includes(dir.dataset.dir)) state.dir = dir.dataset.dir;
    dirAll = false;
    const list = document.getElementById('pw-dirlist');
    if (list) list.scrollTop = 0;
    renderDirections();
    save();
    return;
  }
  const act = t.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const done = (msg) => {
    const el = document.getElementById('pw-done');
    if (el) el.textContent = msg;
    setTimeout(() => {
      if (el?.isConnected) el.textContent = '';
    }, 5000);
  };
  if (act === 'fill') {
    openFill(t.closest('[data-act]').dataset.only ?? null);
  } else if (act === 'best') {
    openFill(null, { auto: true });
  } else if (act === 'find') {
    openFind();
  } else if (act === 'nooffer') {
    offer = null;
    render();
  } else if (act === 'undo' && undo) {
    state.rows = undo.rows;
    state.plans = undo.plans;
    undo = null;
    selected = null;
    render();
  } else if (act === 'addrow') {
    state.rows.push({ k: 's', c: [] });
    undo = null;
    render();
  } else if (act === 'droprow') {
    state.rows.pop();
    undo = null;
    render();
  } else if (act === 'reset') {
    const plans = state.plans;
    state = blank();
    state.plans = plans;
    selected = null;
    undo = null;
    render();
  } else if (act === 'link') {
    const url = `${location.origin}${location.pathname}#${encode(shareable(state))}`;
    done((await copy(url)) ? 'Link copied.' : 'Couldn’t copy.');
  } else if (act === 'print') {
    window.print();
  } else if (act === 'tsv') {
    const lines = [['Term', 'Level', ...Array.from({ length: SLOTS }, (_, j) => `Course ${j + 1}`)].join('\t')];
    state.rows.forEach((r, i) => lines.push([E.termName(termOf(i)), r.k === 's' ? A.lv[i] : { c: 'Work term', o: 'Off' }[r.k], ...r.c.map((c, j) => (c ? `${fmt(c)}${r.g?.[j] != null ? ` (${r.g[j]})` : ''}` : ''))].join('\t')));
    done((await copy(lines.join('\n'))) ? 'Copied: paste it into Excel or Google Sheets.' : 'Couldn’t copy.');
  }
});
app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'pw-start') {
    state.start = t.value;
    undo = null;
    // Requirements follow the calendar of the year someone started.
    await loadYear();
    render();
  } else if (t.id === 'pw-seq' && t.value) {
    resequence(t.value, seqFrom);
    undo = null;
    render();
  } else if (t.id === 'pw-from') {
    seqFrom = Number(t.value);
    render();
    document.getElementById('pw-seq')?.focus();
  } else if (t.id === 'pw-grade' && selected) {
    const g = parseGrade(t.value);
    const code = state.rows[selected.r]?.c[selected.c];
    if (!code || g === undefined) {
      t.setAttribute('aria-invalid', 'true');
      document.getElementById('pw-gnote').textContent = 'A grade is a number from 0 to 100, or a mark like CR, NCR, WD, INC or AEG.';
      return;
    }
    setCell(selected.r, selected.c, code, g);
    render();
  } else if (t.id === 'pw-cut') {
    state.cut = Number(t.value);
    renderDirections();
    save();
  } else if (t.id === 'pw-exfac') {
    state.exfac = t.value;
    dirAll = false;
    document.getElementById('pw-dirlist').scrollTop = 0;
    renderDirections();
    save();
  } else if (t.id === 'pw-exorder') {
    state.exorder = t.value;
    dirAll = false;
    renderDirections();
    save();
  } else if (t.matches('[data-tick]')) {
    const k = t.dataset.tick;
    state.ticked = t.checked ? [...new Set([...state.ticked, k])] : state.ticked.filter((x) => x !== k);
    render();
  }
});

// ---------------- terms: regular, every term, or a co-op sequence ----------------

const THIRD = ['', '⅓', '⅔'];
/** 13 terms → "4⅓ years". */
const yearsText = (n) => `${Math.floor(n / 3) || ''}${THIRD[n % 3]} ${n === 3 ? 'year' : 'years'}`.trim();
/** How long a pattern of terms runs: through its last study or work term, plus the summer after a Winter end. */
function lengthOf(start, kinds) {
  let last = -1;
  kinds.forEach((k, i) => {
    if (k !== 'o') last = i;
  });
  if (last < 0) return { terms: 0, end: start, study: 0, work: 0 };
  let end = start;
  for (let i = 0; i < last; i++) end = E.nextTerm(end);
  return { terms: last + 1 + (E.seasonOf(end) === 'W' ? 1 : 0), end, study: kinds.filter((k) => k === 's').length, work: kinds.filter((k) => k === 'c').length };
}
/** Study terms a regular degree takes: six for a three-year general major, else eight. */
const regularStudy = () => (A?.plans.some((p) => p.t === 'Major' && /Three-Year General/.test(p.n)) ? 6 : 8);
/** Study terms in use: through the last one with courses. */
function usedStudy() {
  let n = 0;
  let used = 0;
  for (const r of state.rows) {
    if (r.k !== 's') continue;
    n++;
    if (r.c.some(Boolean)) used = n;
  }
  return used;
}
/** What a Terms choice makes: {start, kinds} for the whole grid. "regular", "all", or "slug:k" for a co-op
 *  sequence; from: the row it starts at (a sequence joined partway carries on after the study terms done). */
function patternFor(value, from = 0) {
  const head = state.rows.slice(0, from).map((r) => r.k);
  const done = head.filter((k) => k === 's').length;
  const base = from ? termOf(from) : state.start;
  const want = Math.max(usedStudy(), value === 'all' ? 8 : regularStudy());
  const extend = (t0, kinds, every) => {
    let t = t0;
    for (const k of kinds) t = E.nextTerm(t);
    let n = done + kinds.filter((k) => k === 's').length;
    while (n < want) {
      const k = every || E.seasonOf(t) !== 'S' ? 's' : 'o';
      kinds.push(k);
      if (k === 's') n++;
      t = E.nextTerm(t);
    }
    return kinds;
  };
  if (value === 'regular' || value === 'all') return { start: state.start, kinds: [...head, ...extend(base, [], value === 'all')] };
  const [slug, k] = String(value).split(':');
  const sq = bySlug.get(slug)?.seq?.[Number(k)];
  if (!sq) return null;
  let kinds = sq.terms.map((x) => (/^\d[AB]$/.test(x) ? 's' : x === 'WT' ? 'c' : 'o'));
  let start = state.start;
  if (from) {
    // Joining partway: the rest of the chart, after as many study terms as are done.
    let at = 0;
    for (let n = 0; at < kinds.length && n < done; at++) if (kinds[at] === 's') n++;
    kinds = kinds.slice(at);
  } else {
    // A sequence that starts in Winter (Pharmacy) starts the first Winter from your start on.
    for (let i = 0; i < 2 && E.seasonOf(start) !== (sq.start || 'F'); i++) start = E.nextTerm(start);
  }
  // A chart that stops early (Math/Teaching after 2A) carries on as a regular degree; study terms with courses
  // past the end of a sequence are kept at the end.
  return { start, kinds: [...head, ...(sq.cut ? extend(base, kinds, false) : [...kinds, ...extraStudy(kinds, done)])] };
}
/** Study terms to add after a sequence so no planned courses are lost. */
function extraStudy(kinds, done = 0) {
  const have = done + kinds.filter((k) => k === 's').length;
  return Array.from({ length: Math.max(0, usedStudy() - have) }, () => 's');
}
const trimOff = (kinds) => {
  const out = [...kinds];
  while (out.length && out.at(-1) === 'o') out.pop();
  return out.join('');
};
/** The Terms choice the grid matches now, or ''. */
function currentPattern(values, from = seqFrom) {
  const now = trimOff(state.rows.map((r) => r.k));
  return (
    values.find((v) => {
      const p = patternFor(v, from);
      return p && p.start === state.start && trimOff(p.kinds) === now;
    }) ?? ''
  );
}
/** A new pattern of terms from a row on; each study term keeps its courses and grades in order (1A's stay in 1A),
 *  and each work term its own. Work-term courses with no work term left (switching out of co-op) go where they fit. */
function resequence(value, from = 0) {
  const p = patternFor(value, from);
  if (!p) return;
  const rest = state.rows.slice(from);
  const take = (r) => ({ c: r.c, ...(r.g ? { g: r.g } : {}) });
  const studies = rest.filter((r) => r.k === 's').map(take);
  const works = rest.filter((r) => r.k === 'c' && r.c.some(Boolean)).map(take);
  if (!from) state.start = p.start;
  let s = 0;
  let w = 0;
  const made = p.kinds.slice(from).map((k) => {
    const x = k === 's' ? studies[s++] : k === 'c' ? works[w++] : null;
    return { k, c: x?.c ?? [], ...(x?.g ? { g: x.g } : {}) };
  });
  state.rows = [...state.rows.slice(0, from), ...made];
  selected = null;
  for (const x of works.slice(w))
    x.c.forEach((code, j) => {
      if (!code) return;
      const at = place(code);
      if (x.g?.[j] != null) setCell(at.r, at.c, code, x.g[j]);
    });
  seqFrom = Math.min(seqFrom, state.rows.length - 1);
  undo = null;
}
/** A co-op sequence in a few words: "Sequence 1 · 4⅓ years, 5 work terms". */
function seqLabel(slug, k) {
  const sq = bySlug.get(slug)?.seq?.[k];
  const p = patternFor(`${slug}:${k}`, seqFrom);
  if (!sq || !p) return '';
  const len = lengthOf(p.start, p.kinds);
  return `${sq.label} · ${sq.cut ? 'charted to 2A, then regular' : `${yearsText(len.terms)}, ${plural(len.work, 'work term')}`}${sq.start !== 'F' ? `, starts in ${{ W: 'Winter', S: 'Spring' }[sq.start]}` : ''}`;
}
/** A major just picked: co-op only (engineering, AFM) takes its first sequence when the grid is still empty
 *  and regular; otherwise the banner offers its sequences. */
let coopNote = null;
function adopt(slug) {
  offer = slug;
  coopNote = null;
  const p = bySlug.get(slug);
  if (p?.t !== 'Major' || !p.seq?.length) return;
  const empty = !state.rows.some((r) => r.c.some(Boolean));
  if (p.co && !p.re && empty && currentPattern(['regular'], 0) === 'regular') {
    resequence(`${slug}:0`);
    coopNote = { slug, k: 0 };
  }
}

// ---------------- filling in plans ----------------
// "Fill in courses…": every course a plan requires by name goes in its year (or the term a term-by-term
// program gives), after its prerequisites; choices ("MATH 135 or MATH 145") are buttons to click; courses
// described in words go in as placeholders (PMATH 4XX) unless picked. Nothing changes until "Add".

let fill = null; // {slugs: Set, choice: Map key → Set, load, from, ph, last, auto, grow, drop: Set}
// Terms "Optimal plan" may add after the grid's last (5A, 5B… up to 7B in an eight-term degree).
const GROW_MAX = 6;

// ---------------- goals ----------------
// "Aim it at a goal": how well each course fits what someone wants from their degree (goals.js turns a career
// into topics), scored by the course search's index (site/search/: its words' postings and LSA vectors), which is
// fetched the first time a goal is used.
const SX = { mods: null, docs: null, vec: null, shards: new Map() };
const sxJson = (path) => fetch(`/search/${path}?v=${V}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status}`))));
async function goalFit(query) {
  SX.mods ??= Promise.all([import('/search/rank.js'), import('/search/text.js')]);
  const [R, T] = await SX.mods;
  SX.docs ??= sxJson('docs.json');
  SX.vec ??= sxJson('vec.json')
    .then((v) => R.loadVec(v))
    .catch(() => null);
  const qt = R.queryTerms(query);
  const terms = [...qt.words, ...qt.pairs];
  const shard = (i) => {
    if (!SX.shards.has(i)) SX.shards.set(i, sxJson(`t/${i}.json`).catch(() => ({})));
    return SX.shards.get(i);
  };
  const got = await Promise.all(terms.map((x) => shard(T.shardOf(x.t))));
  const [docs, vec] = await Promise.all([SX.docs, SX.vec]);
  return R.relevance(qt, new Map(terms.map((x, k) => [x.t, got[k][x.t]])), docs, vec);
}
const GOAL_EXAMPLES = ['software engineering', 'data science', 'law school', 'medical school', 'Latin and Greek', 'theory and proofs', 'hands-on projects'];
/** Aim the Optimal plan at a goal (or none, with ''): its courses' fit loads, then the picks follow it. */
function setGoal(text, { focus = true } = {}) {
  const g = goalQuery(text);
  // Kept with the plan, for the next time.
  state.goal = text.trim();
  save();
  Object.assign(fill, { goal: text.trim(), goalQ: g, rel: null, relQ: g.query, relErr: false, relBusy: !!g.query, best: null });
  renderFill(focus && text.trim() ? '#pw-goal' : null);
  if (!g.query) return;
  goalFit(g.query)
    .then((rel) => {
      if (!fill || fill.relQ !== g.query) return;
      Object.assign(fill, { rel, relBusy: false, best: null });
      renderFill();
    })
    .catch(() => {
      if (!fill || fill.relQ !== g.query) return;
      Object.assign(fill, { relBusy: false, relErr: true });
      renderFill();
    });
}
/** Minors, options, specializations, diplomas and certificates whose courses fit the goal, that go with the plans
 *  picked: the four that fit best, by their six best-fitting courses. */
function goalPlans() {
  if (!fill?.rel) return [];
  const chosen = new Set(state.plans);
  const blocked = new Set(A.plans.flatMap((p) => p.cant ?? []));
  const majors = A.plans.filter((p) => p.t === 'Major');
  const faculties = new Set(majors.map((p) => p.f));
  // Courses by subject, for plans that ask for units of a few subjects ("4.0 units of CLAS, GRK, or LAT").
  const bySubject = new Map();
  for (const c of Object.keys(C)) {
    if (C[c][7]) continue;
    const subj = /^[A-Z]+/.exec(c)?.[0];
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj).push(c);
  }
  const out = [];
  for (const p of P) {
    if (!['Minor', 'Option', 'Specialization', 'Diploma', 'Certificate'].includes(p.t) || chosen.has(p.s) || blocked.has(p.s) || (p.cant ?? []).some((x) => chosen.has(x))) continue;
    // A specialization is for the majors it names; an option, for its faculty's majors (Engineering's for
    // engineering students); engineering's plans for engineering students.
    if (p.t === 'Specialization' && !(p.open ?? []).some((x) => majors.some((m) => m.s === x))) continue;
    if ((p.t === 'Option' || /Engineering/.test(p.f ?? '')) && majors.length && !faculties.has(p.f)) continue;
    const codes = new Set();
    const walk = (nodes) =>
      nodes.forEach((n) => {
        n.c?.forEach((c) => codes.add(c));
        if (n.subj && n.subj.length <= 3) for (const x of n.subj) for (const c of bySubject.get(x) ?? []) codes.add(c);
        if (n.i) walk(n.i);
      });
    const sec = (x) => (walk(x.r), x.l.forEach(sec));
    p.req.forEach(sec);
    const fits = [...codes].map((c) => fill.rel.get(c) ?? 0).sort((a, b) => b - a);
    if (fits.filter((x) => x >= 0.2).length < 3) continue;
    out.push({ p, score: fits.slice(0, 6).reduce((a, b) => a + b, 0) / 6 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}
const dlg = document.createElement('dialog');
dlg.className = 'pw-fill';
dlg.setAttribute('aria-labelledby', 'pw-fill-h');
root.append(dlg);
const PLAN_ORDER = { 'Degree Requirements': 0, Major: 1, Specialization: 2, Option: 3, Minor: 4, Diploma: 5, Certificate: 6 };
const studyRows = () => state.rows.map((r, i) => (r.k === 's' ? i : -1)).filter((i) => i >= 0);

function openFill(only = null, { auto = false } = {}) {
  const study = studyRows();
  // Courses go in from this term on: what's in earlier terms is what's been taken.
  const now = study.find((i) => Number(termOf(i)) >= Number(data.term)) ?? study[0] ?? 0;
  // A major's degree requirements (first-year math for a BMath, the communication requirement…) come along
  // unless unticked, and are added to the plans.
  const deg = degreeFor(A.plans);
  const extraOn = Boolean(deg) && (!only || bySlug.get(only)?.t === 'Major');
  fill = { slugs: new Set(only ? [only] : state.plans), choice: new Map(), load: NORMAL, from: now, ph: true, extra: deg?.s ?? null, extraOn, skip: new Set(), more: 0, auto, grow: auto, drop: new Set(), goal: '', goalQ: null, rel: null, relQ: '', relBusy: false, relErr: false };
  offer = null;
  render();
  renderFill();
  if (!dlg.open) dlg.showModal();
  (dlg.querySelector('.pw-opt') ?? dlg.querySelector('[data-fill="add"]'))?.focus();
  // The goal it was aimed at last time.
  if (auto && state.goal) setGoal(state.goal, { focus: false });
}

/** What filling in would add, plan by plan (each sees what the ones before it add), and where it goes. */
function fillPlan() {
  const have = new Map(A.planned);
  const extra = fill.extra && fill.extraOn ? bySlug.get(fill.extra) : null;
  const plans = [...A.plans.filter((p) => fill.slugs.has(p.s)), ...(extra ? [extra] : [])].sort((a, b) => (PLAN_ORDER[a.t] ?? 9) - (PLAN_ORDER[b.t] ?? 9));
  const must = new Map();
  const picks = [];
  const words = [];
  const bySig = new Map();
  const want = [];
  const totals = [];
  const take = (code, at) => {
    if (!E.isPlaceholder(code) && have.has(code)) return;
    E.addPlanned(have, code, { units: C[code]?.[1] ?? 0.5 });
    want.push({ code, at });
  };
  const everyPlan = [...A.plans, ...(extra ? [extra] : [])];
  const asPicked = A.plans.map((x) => E.forPlans(x, everyPlan));
  const planCtx = A.plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  // "Optimal plan": every plan's required courses, then the courses that count toward the most of them (engine.js's
  // optimize), before any choice is asked; what's left is asked as usual or goes in as placeholders.
  const auto = [];
  if (fill.auto) {
    for (const plan of plans) {
      const k = A.plans.indexOf(plan);
      const p = E.forPlans(plan, everyPlan);
      const { avail } = E.evaluateAll(asPicked, have, { courses: C, faculty: SF });
      for (const m of E.fillItems(p, have, { courses: C, equiv, avail: avail[k], faculty: SF }).must) {
        if (must.has(m.code)) continue;
        must.set(m.code, { ...m, from: p.n });
        take(m.code, m.at);
      }
    }
    const progs = plans.map((x) => E.forPlans(x, everyPlan));
    // With a goal: picks lean toward it, and the degree's free electives come from it.
    const goal = fill.rel;
    const degreeUnits = goal && plans.some((p) => p.t === 'Major' || p.t === 'Degree Requirements') ? degreeTotalOf(everyPlan) : null;
    const sig = JSON.stringify([plans.map((x) => x.s), [...have.keys()].sort(), [...fill.drop].sort(), goal ? fill.relQ : '', degreeUnits]);
    if (fill.best?.sig !== sig) fill.best = { sig, add: E.optimize(progs, have, { courses: C, equiv, faculty: SF, ctx: { plans: planCtx }, exclude: fill.drop, complete: [...must.keys()], goal, total: degreeUnits }) };
    for (const a of fill.best.add) {
      if (have.has(a.code)) continue;
      take(a.code, null);
      auto.push({ ...a, names: a.plans.map((k) => progs[k].n) });
    }
  }
  for (const plan of plans) {
    const k = A.plans.indexOf(plan);
    const p = E.forPlans(plan, everyPlan);
    const { avail } = E.evaluateAll(asPicked, have, { courses: C, faculty: SF });
    const it = E.fillItems(p, have, { courses: C, equiv, avail: avail[k], faculty: SF });
    for (const m of it.must) {
      if (must.has(m.code)) continue;
      must.set(m.code, { ...m, from: p.n });
      take(m.code, m.at);
    }
    // A term-by-term program's "approved electives" are slots in its terms; what its lists ask for (technical
    // electives, an ethics course) fills those slots, latest terms first, rather than adding courses.
    const isSlot = (w) => w.at && w.ph === 'ELECTIVE';
    const slots = it.words.filter(isSlot).flatMap((w) => Array(w.count).fill(w.at)).reverse();
    const filled = new Map();
    const slotFor = (at) => {
      if (at || !slots.length) return at;
      const t = slots.shift();
      filled.set(t, (filled.get(t) ?? 0) + 1);
      return t;
    };
    for (const pk of it.picks) {
      // The same choice from two plans ("MATH 135 or MATH 145") is asked once.
      const sig = `${pk.n}/${pk.options.map((o) => o.codes?.join('+') ?? o.ph).sort().join(',')}`;
      if (bySig.has(sig)) {
        bySig.get(sig).from.push(p.n);
        continue;
      }
      const item = { ...pk, key: `${p.s}|${pk.key}`, from: [p.n] };
      bySig.set(sig, item);
      picks.push(item);
      for (const i of fill.choice.get(item.key) ?? []) {
        const o = pk.options[i];
        if (o?.codes) for (const c of o.codes) take(c, slotFor(pk.at));
        else if (o && fill.ph) for (let x = 0; x < o.count; x++) take(o.ph, slotFor(pk.at));
      }
    }
    const addWords = (w, n = w.count, slot = false) => {
      const item = { ...w, key: `${p.s}|${w.key}`, from: [p.n], filled: w.count - n };
      words.push(item);
      const chosen = [...(fill.choice.get(item.key) ?? [])].filter((c) => !have.has(c)).slice(0, n);
      for (const c of chosen) take(c, slot ? w.at : slotFor(w.at));
      if (fill.ph && !fill.skip.has(item.key)) for (let x = chosen.length; x < n; x++) take(w.ph, slot ? w.at : slotFor(w.at));
    };
    for (const w of it.words) if (w.key !== 'total' && !isSlot(w)) addWords(w);
    // Each term's slots, less what the lists filled.
    for (const w of it.words.filter(isSlot)) {
      const used = Math.min(w.count, filled.get(w.at) ?? 0);
      filled.set(w.at, (filled.get(w.at) ?? 0) - used);
      addWords(w, w.count - used, true);
    }
    totals.push(() => {
      // A whole degree's electives come last: the other plans' courses count toward them first.
      const again = E.fillItems(p, have, { courses: C, equiv, faculty: SF });
      for (const w of again.words) if (w.key === 'total') addWords(w);
    });
  }
  for (const t of totals) t();
  // Electives up to the degree's total, after everything else, when the degree itself is being filled in.
  const total = plans.some((p) => p.t === 'Major' || p.t === 'Degree Requirements') ? degreeTotalOf([...A.plans, ...(extra ? [extra] : [])]) : null;
  if (total) {
    const sum = [...have].reduce((t, [k, x]) => t + (E.WORK_COURSE.test(k) ? 0 : x.units ?? 0.5), 0);
    const count = Math.max(0, Math.round((total - sum) / 0.5));
    if (count) {
      const item = { key: 'degree|total', count, ph: 'ELECTIVE', text: `Electives, for the ${units(total)} units the degree takes`, at: null, cands: [], from: ['Your degree'] };
      words.push(item);
      if (fill.ph && !fill.skip.has(item.key)) for (let x = 0; x < count; x++) take('ELECTIVE', null);
    }
  }
  // Terms the dialog adds at the end (only when the courses are added): as many as it takes when "add terms if
  // needed" is on (5A, 5B…), else the ones asked for.
  const place = (more) => {
    const all = [...state.rows, ...Array.from({ length: more }, () => ({ k: 's', c: [] }))];
    const rows = all.map((r, i) => ({ kind: KIND[r.k], season: E.seasonOf(termOf(i)), codes: r.c }));
    return { rows, res: E.arrange(rows, want, { courses: C, load: fill.load, max: SLOTS, from: fill.from, equiv, plans: planCtx, early: fill.grow }) };
  };
  let more = fill.grow ? 0 : fill.more;
  let { rows, res } = place(more);
  while (fill.grow && res.left.length && more < GROW_MAX) ({ rows, res } = place(++more));
  return { plans, must: [...must.values()], picks, words, want, res, rows, lv: E.levels(rows), auto, more };
}

function renderFill(focus = null) {
  if (!fill) return;
  const active = focus ?? (dlg.contains(document.activeElement) ? selectorOf(document.activeElement) : null);
  const scroll = dlg.querySelector('.pw-fillpicks')?.scrollTop ?? 0;
  const F = (fill.last = fillPlan());
  const study = studyRows();
  const mustSet = new Set(F.must.map((m) => m.code));
  const title = (c) => (E.isPlaceholder(c) ? `Placeholder for ${phText(c)}` : C[c]?.[0] ?? '');
  const at = (x) => (x.at ? ` <span class="pw-at" title="The calendar puts it in ${esc(x.at)}">${esc(x.at)}</span>` : '');
  const from = (x) => `<span class="t">${esc(x.from.map((n) => n.replace(/ \((Bachelor|Joint)[^)]*\)$/, '')).join(' · '))}</span>`;
  const pickCard = (item) => {
    const sel = fill.choice.get(item.key) ?? new Set();
    const many = item.options.length > 4;
    const opts = item.options
      .map((o, i) => {
        // A choice in words ("Complete 1 additional course from List 1") shows its words when space is short.
        const label = o.codes ? o.codes.map(fmt).join(' + ') : many ? o.text.replace(/^Complete\s+/i, '').replace(/\.$/, '') : `${o.count > 1 ? `${o.count} × ` : ''}${fmt(o.ph)}`;
        const sub = o.codes ? o.codes.map((c) => C[c]?.[0] ?? (c in C ? '' : 'not in the current calendar')).filter(Boolean).join(' + ') : o.text;
        return `<button type="button" class="pw-opt${o.ph ? ' ph' : ''}" data-pick="${esc(item.key)}" data-opt="${i}" aria-pressed="${sel.has(i)}"${many ? ` title="${esc(sub)}"` : ''}><b>${esc(label)}</b>${many ? '' : `<span>${esc(sub)}</span>`}</button>`;
      })
      .join('');
    const done = sel.size >= item.n;
    return `<div class="pw-pick${done ? ' done' : ''}"><p class="pw-pickq"><b>${item.n === 1 ? 'Pick one' : `Pick ${item.n}`}</b>${at(item)} ${from(item)}${sel.size ? ` <button type="button" class="pw-linkbtn" data-unpick="${esc(item.key)}">Clear</button>` : ''}</p><div class="pw-opts${many ? ' many' : ''}">${opts}</div></div>`;
  };
  const wordsCard = (item) => {
    const sel = fill.choice.get(item.key) ?? new Set();
    const cands = item.cands.filter((c) => !mustSet.has(c));
    const count = item.count - (item.filled ?? 0);
    const left = count - [...sel].length;
    const skipped = fill.skip.has(item.key);
    const head = `<p class="pw-pickq"><b>${count} × ${esc(fmt(item.ph))}</b>${item.filled ? ` <span class="t">(${item.filled} of ${item.count} used by the lists above)</span>` : ''}${at(item)} ${from(item)}${sel.size ? ` <button type="button" class="pw-linkbtn" data-unpick="${esc(item.key)}">Clear</button>` : ''}${fill.ph ? ` <button type="button" class="pw-linkbtn" data-skip="${esc(item.key)}">${skipped ? 'Add placeholders' : 'Skip'}</button>` : ''}</p><p class="pw-pickt">${esc(item.text)}</p>`;
    const how = !count ? '' : skipped || !fill.ph ? (cands.length ? `<p class="t">Pick ${count === 1 ? 'one' : `up to ${count}`}${skipped ? ', or leave it for later' : ''}:</p>` : `<p class="t">Left for later.</p>`) : cands.length ? `<p class="t">${left > 0 ? `${plural(left, 'placeholder')} go${left === 1 ? 'es' : ''} in for now, or pick:` : 'Picked.'}</p>` : '';
    const chips = cands.map((c) => `<button type="button" class="pw-opt" data-word="${esc(item.key)}" data-code="${esc(c)}" aria-pressed="${sel.has(c)}" title="${esc(title(c))}"><b>${esc(fmt(c))}</b></button>`).join('');
    return `<div class="pw-pick words${left <= 0 || (fill.ph && !skipped) ? ' done' : ''}${skipped ? ' skipped' : ''}">${head}${how}${chips ? `<div class="pw-opts many">${chips}</div>` : ''}</div>`;
  };
  const open = F.picks.filter((x) => (fill.choice.get(x.key)?.size ?? 0) < x.n).length;
  const added = new Map();
  for (const x of F.res.placed) added.set(x.row, [...(added.get(x.row) ?? []), x.code]);
  const prev = F.rows
    .map((r, i) => (r.kind === 'study' ? i : -1))
    .filter((i) => i >= 0)
    .map((i) => {
      const old = (F.rows[i].codes ?? []).filter(Boolean);
      const neu = added.get(i) ?? [];
      if (i < fill.from && !old.length) return '';
      const n = old.length + neu.length;
      return `<tr${i < fill.from ? ' class="past"' : i >= state.rows.length ? ' class="extra"' : ''}><th scope="row">${esc(F.lv[i])} <span class="t">${esc(E.termName(termOf(i)))}${i >= state.rows.length ? ' · new' : ''}</span></th><td>${old.map((c) => `<span class="pw-old" title="${esc(title(c))}">${esc(fmt(c))}</span>`).join('')}${neu.map((c) => `<span class="pw-new${E.isPlaceholder(c) ? ' ph' : ''}" title="${esc(title(c))}">${esc(fmt(c))}</span>`).join('')}</td><td class="pw-n${n > NORMAL ? ' over' : ''}">${n || ''}</td></tr>`;
    })
    .join('');
  const n = F.res.placed.length;
  const newLv = F.lv.slice(state.rows.length).filter(Boolean);
  const noRoom = F.res.left.length
    ? `<div class="pw-warn"><p>No room at ${fill.load} a term for ${plural(F.res.left.length, 'course')}: ${F.res.left.map(fmt).join(', ')}${fill.grow ? `, even with ${plural(F.more, 'more term')}` : ''}.</p><p>${fill.load < SLOTS ? `<button type="button" class="pw-linkbtn" data-fill="load+">Allow ${fill.load + 1} a term</button>${fill.grow ? '' : ' or '}` : ''}${fill.grow ? '' : '<button type="button" class="pw-linkbtn" data-fill="more">add a term</button>'}</p></div>`
    : F.more
      ? `<p class="t">${plural(F.more, 'term')} added at the end (${esc(newLv.join(', '))})${fill.grow ? ` so everything fits at ${fill.load} a term${fill.load < SLOTS ? `; <button type="button" class="pw-linkbtn" data-fill="load+">allow ${fill.load + 1} a term</button> to finish sooner` : ''}` : ''}.${fill.grow ? '' : ` <button type="button" class="pw-linkbtn" data-fill="less">Remove ${fill.more === 1 ? 'it' : 'one'}</button>`}</p>`
      : '';
  // "Optimal plan": the courses it picked, what each counts toward, and how far that goes.
  const shared = F.auto.filter((a) => a.names.filter((nm) => !/Degree Requirements/.test(nm)).length > 1).length;
  const short = (nm) => nm.replace(/\s*\((Bachelor|Joint)[^)]*\)$/, '').replace(/ Degree Requirements.*$/, ' degree');
  const goalTag = (a) => (fill.rel && a.goal >= 0.35 ? ' <span class="pw-goaltag">fits your goal</span>' : '');
  const autoRow = (a) => `<li><span class="pw-old" title="${esc(title(a.code))}">${esc(fmt(a.code))}</span> <span class="pw-autot">${esc(C[a.code]?.[0] ?? '')}${goalTag(a)}</span> <button type="button" class="pw-drop" data-drop="${esc(a.code)}" aria-label="Don’t pick ${esc(fmt(a.code))}" title="Don’t pick it (another takes its place)">×</button> <span class="t">${a.for ? `for ${esc(fmt(a.for))}’s prerequisites${a.names.length ? '; ' : ''}` : !a.names.length && fill.rel ? 'an elective toward your goal' : ''}${esc(a.names.map(short).join(' · '))}</span></li>`;
  const fits = goalPlans();
  const goalBox = fill.auto
    ? `<form class="pw-goal" data-goalform><label for="pw-goal">Aim it at a goal <span class="t">(optional): a career, a field, or a textbook’s contents</span></label><div class="pw-goalrow"><input id="pw-goal" type="text" value="${esc(fill.goal)}" placeholder="software engineering, classics professor, machine learning…" autocomplete="off" spellcheck="false"><button type="submit" class="pw-fillbtn">Aim</button>${fill.goal ? '<button type="button" class="pw-linkbtn" data-goal="">Clear</button>' : ''}</div>${
        !fill.goal
          ? `<p class="t">Try ${GOAL_EXAMPLES.map((x) => `<button type="button" class="pw-linkbtn" data-goal="${esc(x)}">${esc(x)}</button>`).join(', ')}. Without one, it goes for the fewest courses.</p>`
          : fill.relBusy
            ? '<p class="t" role="status">Finding the courses that fit…</p>'
            : fill.relErr
              ? '<p class="t" role="status">Couldn’t load the course search. Try again in a moment.</p>'
              : `<p class="t" role="status">Looking for ${esc(fill.goalQ.query.length > 170 ? `${fill.goalQ.query.slice(0, 170).replace(/[,\s]+\S*$/, '')}…` : fill.goalQ.query)}${fill.goalQ.names.length ? ` (for “${esc(fill.goal)}”: change the words to steer it)` : ''}. Picks lean toward these, and free electives come from them.</p>${fits.length ? `<p class="t">Plans that fit it: ${fits.map(({ p }) => `<button type="button" class="pw-linkbtn" data-goalplan="${esc(p.s)}" title="Add it to your plans">+ ${esc(p.n)}</button>`).join(', ')}</p>` : ''}`
      }</form>`
    : '';
  const autoBox = fill.auto
    ? `${goalBox}<div class="pw-auto"><h3>${fill.rel ? 'Picked for your goal' : 'Picked for the fewest courses'} <span class="t">${F.auto.length ? `${plural(F.auto.length, 'course')}${shared ? `, ${shared} counting toward two of your plans` : ''}` : 'nothing more to pick'}</span></h3>${F.auto.length ? `<ul class="pw-autolist">${F.auto.map(autoRow).join('')}</ul>` : ''}${fill.drop.size ? `<p class="t">Not picking ${[...fill.drop].map((c) => `<button type="button" class="pw-linkbtn" data-undrop="${esc(c)}" title="Let it be picked again">${esc(fmt(c))}</button>`).join(', ')}.</p>` : ''}</div>`
    : '';
  // Co-op terms first, so courses land in study terms.
  const coopMajor = F.plans.find((p) => p.t === 'Major' && p.seq?.length);
  const coop = coopMajor && !state.rows.some((r) => r.k === 'c') ? `<p class="pw-hint">Doing co-op? <button type="button" class="pw-linkbtn" data-fseq="${esc(coopMajor.s)}:0">Use ${esc(seqLabel(coopMajor.s, 0))}</button>${coopMajor.seq.length > 1 ? ', or pick another under <b>Terms</b>,' : ''} so courses land in study terms.</p>` : '';
  // Starting before this term: what's typed in earlier terms counts as taken.
  const first = study[0];
  const past = fill.from > first && !study.some((i) => i < fill.from && state.rows[i].c.some(Boolean)) ? `<p class="pw-hint">Terms before ${esc(A.lv[fill.from])} are empty. Type in what you’ve taken so it counts, or <button type="button" class="pw-linkbtn" data-fill="from0">fill from ${esc(A.lv[first])}</button>.</p>` : '';
  const extraBox = fill.extra ? `<label><input type="checkbox" data-fextra${fill.extraOn ? ' checked' : ''}> <span>${esc(bySlug.get(fill.extra)?.n ?? '')} <span class="t">(adds it to your plans)</span></span></label>` : '';
  const plansBox = A.plans.length > 1 || extraBox ? `<fieldset class="pw-fplans"><legend>Plans</legend>${A.plans.map((p, k) => `<label><input type="checkbox" data-fplan="${esc(p.s)}"${fill.slugs.has(p.s) ? ' checked' : ''}> <i class="pw-dot d${k % 8}"></i>${esc(p.n)}</label>`).join('')}${extraBox}</fieldset>` : '';
  const musts = F.must.length ? `<details class="pw-musts"><summary>${plural(F.must.length, 'course')} required by name go in as they are</summary><p>${F.must.map((m) => `<span class="pw-old" title="${esc(title(m.code))}">${esc(fmt(m.code))}</span>`).join('')}</p></details>` : '';
  const empty = !F.must.length && !F.picks.length && !F.words.length;
  dlg.innerHTML = `<div class="pw-fillin">
<div class="pw-fillhead"><h2 id="pw-fill-h">${fill.auto ? 'Optimal plan' : 'Fill in courses'}</h2><p class="t">${fill.auto ? (fill.rel ? 'Courses that complete these plans and fit your goal, with their prerequisites, in terms that fit your load; one that counts toward two plans still counts for more. ' : 'The fewest courses that complete these plans: where one course can count toward two of them (the most the calendar allows), it’s picked over two that count once, with its prerequisites, in terms that fit your load. ') : ''}From the ${esc(labelOf(calYear))} calendar, for a start in ${esc(E.termName(state.start))}. Nothing changes until you add them.</p><button type="button" class="pw-x" data-fill="close" aria-label="Close">×</button></div>
${plansBox}
<div class="pw-fillbody">
<section class="pw-fillpicks" aria-label="Choices">${autoBox}${empty && !F.auto.length ? '<p>Everything these plans name is already in your grid.</p>' : ''}${F.picks.length ? `<h3>Choose <span class="t">${open ? `${open} of ${F.picks.length} still open; ones you skip stay in the checklist` : 'all picked'}</span></h3>${F.picks.map(pickCard).join('')}` : ''}${F.words.length ? `<h3>Described in words</h3>${F.words.map(wordsCard).join('')}` : ''}${musts}</section>
<section class="pw-fillprev" aria-label="Where they’d go"><h3>Where they’d go</h3>${past}${coop}<table class="pw-prev"><tbody>${prev}</tbody></table>${noRoom}</section>
</div>
<div class="pw-fillfoot"><div class="pw-fillopts"><label>From <select data-fill="from">${study.map((i) => `<option value="${i}"${i === fill.from ? ' selected' : ''}>${esc(A.lv[i])} (${esc(E.termName(termOf(i)))})</option>`).join('')}</select></label><label>Up to <select data-fill="load">${[4, 5, 6, 7].map((x) => `<option${x === fill.load ? ' selected' : ''}>${x}</option>`).join('')}</select> a term</label><label><input type="checkbox" data-fill="ph"${fill.ph ? ' checked' : ''}> Placeholders</label><label title="Pick the choices and courses described in words that count toward the most of your plans"><input type="checkbox" data-fill="auto"${fill.auto ? ' checked' : ''}> Pick for me</label><label title="Add terms after your last (5A, 5B…) when everything doesn’t fit"><input type="checkbox" data-fill="grow"${fill.grow ? ' checked' : ''}> Add terms if needed</label></div><div class="pw-fillbtns"><button type="button" data-fill="close">Cancel</button><button type="button" class="pw-primary" data-fill="add"${n ? '' : ' disabled'}>Add ${plural(n, 'course')}</button></div></div>
</div>`;
  const picksEl = dlg.querySelector('.pw-fillpicks');
  if (picksEl) picksEl.scrollTop = scroll;
  if (active) dlg.querySelector(active)?.focus({ preventScroll: true });
}
const selectorOf = (el) => {
  for (const a of ['data-pick', 'data-word', 'data-fill', 'data-fplan', 'data-fextra', 'data-unpick', 'data-skip', 'data-undrop', 'data-goalplan']) {
    if (!el.hasAttribute?.(a)) continue;
    const extra = a === 'data-pick' ? `[data-opt="${el.dataset.opt}"]` : a === 'data-word' ? `[data-code="${CSS.escape(el.dataset.code)}"]` : '';
    return `[${a}="${CSS.escape(el.getAttribute(a))}"]${extra}`;
  }
  return null;
};

function applyFill() {
  const F = fill.last;
  if (!F?.res.placed.length) return;
  const before = JSON.parse(JSON.stringify(state.rows));
  const plansBefore = [...state.plans];
  if (fill.extra && fill.extraOn && !state.plans.includes(fill.extra)) state.plans.push(fill.extra);
  for (let x = 0; x < F.more; x++) state.rows.push({ k: 's', c: [] });
  for (const { code, row } of F.res.placed) {
    const r = state.rows[row];
    const j = Array.from({ length: slotsOf(r) }, (_, k) => k).find((k) => !r.c[k]);
    if (j != null) setCell(row, j, code);
  }
  undo = { rows: before, plans: plansBefore, n: F.res.placed.length, names: F.plans.map((p) => p.n) };
  dlg.close();
  render();
}

dlg.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-goalform]')) return;
  e.preventDefault();
  setGoal(e.target.querySelector('#pw-goal').value);
});
dlg.addEventListener('click', (e) => {
  const t = e.target;
  if (t === dlg) return dlg.close(); // the backdrop
  const pick = t.closest('[data-pick]');
  if (pick) {
    const key = pick.dataset.pick;
    const i = Number(pick.dataset.opt);
    const item = fill.last.picks.find((x) => x.key === key);
    const sel = new Set(fill.choice.get(key) ?? []);
    if (sel.has(i)) sel.delete(i);
    else {
      if (item.n === 1) sel.clear();
      else if (sel.size >= item.n) sel.delete(sel.values().next().value);
      sel.add(i);
    }
    fill.choice.set(key, sel);
    return renderFill(selectorOf(pick));
  }
  const word = t.closest('[data-word]');
  if (word) {
    const key = word.dataset.word;
    const item = fill.last.words.find((x) => x.key === key);
    const sel = new Set(fill.choice.get(key) ?? []);
    const c = word.dataset.code;
    const max = item.count - (item.filled ?? 0);
    if (sel.has(c)) sel.delete(c);
    else if (max > 0) {
      if (sel.size >= max) sel.delete(sel.values().next().value);
      sel.add(c);
    }
    fill.choice.set(key, sel);
    return renderFill(selectorOf(word));
  }
  const aim = t.closest('[data-goal]');
  if (aim) {
    setGoal(aim.dataset.goal);
    return;
  }
  const gp = t.closest('[data-goalplan]');
  if (gp) {
    addPlan(gp.dataset.goalplan);
    fill.slugs.add(gp.dataset.goalplan);
    fill.best = null;
    return renderFill();
  }
  const drop = t.closest('[data-drop]');
  if (drop) {
    fill.drop.add(drop.dataset.drop);
    return renderFill('.pw-autolist [data-drop]');
  }
  const undrop = t.closest('[data-undrop]');
  if (undrop) {
    fill.drop.delete(undrop.dataset.undrop);
    return renderFill();
  }
  const un = t.closest('[data-unpick]');
  if (un) {
    fill.choice.delete(un.dataset.unpick);
    return renderFill();
  }
  const fseq = t.closest('[data-fseq]');
  if (fseq) {
    resequence(fseq.dataset.fseq);
    render();
    const study = studyRows();
    fill.from = study.find((i) => Number(termOf(i)) >= Number(data.term)) ?? study[0] ?? 0;
    return renderFill('[data-fill="add"]');
  }
  const sk = t.closest('[data-skip]');
  if (sk) {
    const k = sk.dataset.skip;
    if (fill.skip.has(k)) fill.skip.delete(k);
    else fill.skip.add(k);
    return renderFill(selectorOf(sk));
  }
  const act = t.closest('[data-fill]')?.dataset.fill;
  if (act === 'close') dlg.close();
  else if (act === 'add') applyFill();
  else if (act === 'from0') {
    fill.from = studyRows()[0] ?? 0;
    renderFill('[data-fill="from"]');
  } else if (act === 'load+') {
    fill.load = Math.min(SLOTS, fill.load + 1);
    renderFill('[data-fill="load"]');
  } else if (act === 'more' || act === 'less') {
    fill.more = Math.max(0, fill.more + (act === 'more' ? 1 : -1));
    renderFill('[data-fill="add"]');
  }
});
dlg.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-fplan]')) {
    if (t.checked) fill.slugs.add(t.dataset.fplan);
    else fill.slugs.delete(t.dataset.fplan);
  } else if (t.matches('[data-fextra]')) fill.extraOn = t.checked;
  else if (t.dataset.fill === 'load') fill.load = Number(t.value);
  else if (t.dataset.fill === 'from') fill.from = Number(t.value);
  else if (t.dataset.fill === 'ph') fill.ph = t.checked;
  else if (t.dataset.fill === 'auto') fill.auto = t.checked;
  else if (t.dataset.fill === 'grow') fill.grow = t.checked;
  else return;
  renderFill(selectorOf(t));
});
dlg.addEventListener('close', () => {
  fill = null;
  dlg.innerHTML = '';
  app.querySelector('.pw-fillbtn')?.focus({ preventScroll: true });
});

// ---------------- finding courses for what's still open ----------------
// "Find courses…", or Browse beside a requirement: the courses that would count toward what your plans still
// need, which requirements each would meet (two plans at once comes first), when it runs, and whether its
// prerequisites are in your plan. Add puts it in your grid.

let find = null; // {req: 'all' | 'k|key', level, season, recent, prereq, multi, q, shown, last}
const dlgFind = document.createElement('dialog');
dlgFind.className = 'pw-fill pw-find';
dlgFind.setAttribute('aria-labelledby', 'pw-find-h');
root.append(dlgFind);
const SEASONS = { F: 'Fall', W: 'Winter', S: 'Spring' };

function openFind(req = 'all') {
  find = { req, level: '', season: '', recent: true, prereq: false, multi: false, q: '', shown: 60, last: null };
  dlgFind.innerHTML = `<div class="pw-fillin">
<div class="pw-fillhead"><h2 id="pw-find-h">Find courses</h2><p class="t">Courses that would count toward what your plans still need. Add puts one in your grid, in its year, after its prerequisites, in a term it runs. Free electives left? <button type="button" class="pw-linkbtn" data-fminors>See the minors your grid is closest to</button>, and pick from their courses.</p><button type="button" class="pw-x" data-fclose aria-label="Close">×</button></div>
<div class="pw-ffilters">
<label class="pw-freq">For <select id="pw-freq"></select></label>
<label>Level <select id="pw-flevel"><option value="">Any</option><option value="1">100</option><option value="2">200</option><option value="3">300</option><option value="4">400 and up</option></select></label>
<label>Runs in <select id="pw-fseason"><option value="">Any term</option><option value="F">Fall</option><option value="W">Winter</option><option value="S">Spring</option></select></label>
<label class="pw-fsearch"><span class="vh">Search</span><input id="pw-fq" type="search" placeholder="Search codes and titles" spellcheck="false" autocomplete="off"></label>
<label><input type="checkbox" id="pw-frecent" checked> Ran in the last 4 years</label>
<label><input type="checkbox" id="pw-fpre"> Prerequisites in my plan</label>
${A.plans.length > 1 ? '<label><input type="checkbox" id="pw-fmulti"> Counts toward 2+ of my plans</label>' : ''}
</div>
<p class="pw-fstatus" role="status"></p>
<div class="pw-fres" id="pw-fres"></div>
</div>`;
  renderFind();
  if (!dlgFind.open) dlgFind.showModal();
  dlgFind.querySelector(req === 'all' ? '#pw-fq' : '#pw-freq')?.focus();
}

/** The courses the filters leave, most useful first. */
function findList() {
  const needed = neededNow();
  const [k, key] = find.req === 'all' ? [] : find.req.split('|');
  const codes = find.req === 'all' ? [...needed.keys()] : poolsNow()[Number(k)]?.find((pl) => pl.key === key)?.codes ?? [];
  const have = new Set(A.planned.keys());
  const plans = A.plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const words = find.q.toLowerCase().split(/\s+/).filter(Boolean);
  const plansOf = (c) => new Set((needed.get(c) ?? []).map((x) => x.k)).size;
  return codes
    .filter((c) => {
      const x = C[c];
      if (!x || (find.recent && !(x[5]?.[0] + x[5]?.[1] + x[5]?.[2]))) return false;
      const lvl = Number(/\d/.exec(c)?.[0]);
      if (find.level && (find.level === '4' ? lvl < 4 : lvl !== Number(find.level))) return false;
      if (find.season && !x[5]?.['FWS'.indexOf(find.season)]) return false;
      if (words.length && !words.every((w) => `${c} ${fmt(c)} ${x[0]}`.toLowerCase().includes(w))) return false;
      if (find.multi && plansOf(c) < 2) return false;
      if (find.prereq && x[2]?.length && E.holds(x[2], have, { plans, equiv }) === false) return false;
      return true;
    })
    .sort((a, b) => plansOf(b) - plansOf(a) || (needed.get(b)?.length ?? 0) - (needed.get(a)?.length ?? 0) || a.localeCompare(b, 'en', { numeric: true }));
}

/** A requirement in a few words: "1 of MATH 237, MATH 247", "Required: MATH 235", or its own words. */
function poolLabel(pl) {
  if (pl.kind === 'words') return pl.label;
  const list = `${pl.codes.slice(0, 4).map(fmt).join(', ')}${pl.codes.length > 4 ? ', …' : ''}`;
  return pl.kind === 'required' ? `Required: ${list}` : `${pl.label.replace(/ of these( options)?$/, '')} of ${list}`;
}
function renderFind() {
  if (!find) return;
  const pools = poolsNow();
  const needed = neededNow();
  const short = (t, n = 70) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const placeOf = (pl) => (pl.where && pl.where !== 'Required Courses' ? ` (${short(pl.where, 34)})` : '');
  const sel = dlgFind.querySelector('#pw-freq');
  sel.innerHTML = `<option value="all">Everything still open (${needed.size})</option>${A.plans.map((p, k) => (pools[k].length ? `<optgroup label="${esc(p.n.replace(/\s*\(.*$/, ''))}">${pools[k].map((pl) => `<option value="${k}|${esc(pl.key)}">${esc(short(poolLabel(pl), 64))}${esc(placeOf(pl))} · ${pl.left} more</option>`).join('')}</optgroup>` : '')).join('')}`;
  if (![...sel.options].some((o) => o.value === find.req)) find.req = 'all';
  sel.value = find.req;
  const list = findList();
  const have = new Set(A.planned.keys());
  const plans = A.plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const row = (c) => {
    const x = C[c];
    const runs = ['F', 'W', 'S'].map((s, i) => `<abbr class="${x[5]?.[i] ? 'on' : ''}" title="${esc(`${SEASONS[s]}: ${x[5]?.[i] ? `ran in ${x[5][i]} of the last 4 years` : 'not lately'}`)}">${s}</abbr>`).join('');
    let pre = '';
    if (x[2]?.length) {
      const ok = E.holds(x[2], have, { plans, equiv });
      if (ok === false) {
        const w = E.why(x[2], have, { plans, equiv });
        pre = `<span class="no">Needs ${esc([w.codes.length ? needsText(w) : '', w.plans.length ? `enrolled in ${w.plans.join(' or ')}` : ''].filter(Boolean).join('; ') || 'more than is planned')}</span>`;
      } else pre = ok ? '<span class="ok">Prerequisites in your plan</span>' : '<span>Check its prerequisites</span>';
      const lv = levelIn(x[2]);
      if (lv) pre += ` <span class="t">· from level ${esc(lv)}</span>`;
    }
    const anti = [...have].filter((o) => (x[4] || []).includes(o) || (C[o]?.[4] || []).includes(c));
    const counts = (needed.get(c) ?? []).map((n) => `<span><i class="pw-dot d${n.k % 8}"></i>${esc(A.plans[n.k].n.replace(/\s*\(.*$/, ''))}: ${esc(short(poolLabel(n), 56))}${esc(placeOf(n))}</span>`).join('');
    return `<li class="pw-fr"><button type="button" class="pw-add" data-fadd="${esc(c)}" aria-label="Add ${esc(fmt(c))} to your grid">Add</button><div><p class="pw-ft"><a href="/${c.toLowerCase()}/" target="_blank" rel="noopener"><b>${esc(fmt(c))}</b></a> ${esc(x[0])} <span class="t">${units(x[1])}</span></p><p class="pw-fmeta"><span class="pw-ss">${runs}</span>${pre ? ` ${pre}` : ''}${anti.length ? ` <span class="no">Antirequisite with ${anti.map(fmt).join(', ')}</span>` : ''}</p><p class="pw-fcounts">${counts}</p></div></li>`;
  };
  const shown = list.slice(0, find.shown);
  dlgFind.querySelector('#pw-fres').innerHTML = list.length
    ? `<p class="t">${plural(list.length, 'course')}${find.req === 'all' ? ', the ones that count toward the most of your plans first' : ''}.</p><ul class="pw-flist">${shown.map(row).join('')}</ul>${list.length > shown.length ? `<p><button type="button" class="pw-linkbtn" data-fmore>Show ${Math.min(60, list.length - shown.length)} more</button></p>` : ''}`
    : `<p class="pw-fnone">${needed.size ? 'Nothing matches these filters.' : 'Nothing’s open: your plans’ named requirements are all in your grid.'}</p>`;
  const st = dlgFind.querySelector('.pw-fstatus');
  st.innerHTML = find.last ? `Added <b>${esc(fmt(find.last.code))}</b> to ${esc(A.lv[find.last.r] ?? '')} (${esc(E.termName(termOf(find.last.r)))}). <button type="button" class="pw-linkbtn" data-fundo>Undo</button>` : '';
}
/** The level a course's requisites ask for ("Students must be in level 3A or higher"), if any. */
function levelIn(nodes) {
  let best = null;
  const walk = (list) => {
    for (const n of Array.isArray(list) ? list : []) {
      if (n.g) walk(n.i);
      if (n.lv && (!best || n.lv > best)) best = n.lv;
    }
  };
  walk(nodes);
  return best;
}

dlgFind.addEventListener('click', (e) => {
  const t = e.target;
  if (t === dlgFind || t.closest('[data-fclose]')) return dlgFind.close();
  // Electives toward a minor: the list of minors, closest first, where each one's courses are a tap away.
  if (t.closest('[data-fminors]')) {
    // After the dialog's own close (which puts focus back on Find courses…), so focus lands on the list.
    dlgFind.addEventListener('close', () => openBrowse({ view: 'Minor', order: 'near' }), { once: true });
    return dlgFind.close();
  }
  const add = t.closest('[data-fadd]');
  if (add) {
    const code = add.dataset.fadd;
    const at = place(code);
    find.last = { ...at, code };
    render();
    renderFind();
    dlgFind.querySelector('.pw-add')?.focus({ preventScroll: true });
    return;
  }
  if (t.closest('[data-fundo]') && find.last) {
    const { r, c } = find.last;
    setCell(r, c, '');
    find.last = null;
    render();
    return renderFind();
  }
  if (t.closest('[data-fmore]')) {
    find.shown += 60;
    return renderFind();
  }
});
dlgFind.addEventListener('input', (e) => {
  if (e.target.id !== 'pw-fq') return;
  find.q = e.target.value;
  find.shown = 60;
  renderFind();
});
dlgFind.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'pw-freq') find.req = t.value;
  else if (t.id === 'pw-flevel') find.level = t.value;
  else if (t.id === 'pw-fseason') find.season = t.value;
  else if (t.id === 'pw-frecent') find.recent = t.checked;
  else if (t.id === 'pw-fpre') find.prereq = t.checked;
  else if (t.id === 'pw-fmulti') find.multi = t.checked;
  else return;
  find.shown = 60;
  renderFind();
});
dlgFind.addEventListener('close', () => {
  find = null;
  dlgFind.innerHTML = '';
  app.querySelector('.pw-findbtn')?.focus({ preventScroll: true });
});

// Plans: search and add. The box finds plans the way people say them (engine.js's planScore: "math/cpa", "cs",
// "afm", "syde"); the chips above it narrow the list to one kind of plan, and list them all with nothing typed.
// Up and down move through the list, Enter adds the one picked.
const PLAN_KINDS = { Major: 'Majors', Minor: 'Minors', Specialization: 'Specializations', Option: 'Options', Diploma: 'Diplomas', Certificate: 'Certificates', 'Degree Requirements': 'Degree requirements' };
let planType = ''; // a kind of plan the chips narrow the list to, or ''
let planActive = 0; // the suggestion Enter adds
/** Plans for what's typed, best first; with a kind picked and nothing typed, every plan of that kind. */
function planHits(q) {
  const queries = E.planQueries(q);
  const tokens = queries[0];
  const pool = P.filter((p) => !state.plans.includes(p.s) && (!planType || p.t === planType));
  // Specializations and options open to your majors first ("Finance Specialization" for Math/CPA).
  const other = (p) => (p.open?.length && !p.open.some((s) => state.plans.includes(s)) ? 1 : 0);
  // Then majors before minors…, Honours before Joint Honours and general degrees, and shorter names first
  // (Economics Minor before Economic Policy Minor).
  const degree = (p) => (/Joint Honours/.test(p.n) ? 1 : /Four-Year General/.test(p.n) ? 2 : /Three-Year General/.test(p.n) ? 3 : 0);
  const order = (a, b) => other(a) - other(b) || TYPE_ORDER.indexOf(a.t) - TYPE_ORDER.indexOf(b.t) || degree(a) - degree(b) || E.planWords(a).name.length - E.planWords(b).name.length || a.n.localeCompare(b.n);
  if (!tokens.length) return planType ? pool.sort(order) : [];
  return pool
    .map((p) => [p, E.planBest(p, queries)])
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1] || order(a[0], b[0]))
    .map(([p]) => p);
}
function kindChips() {
  const left = (t) => P.filter((p) => p.t === t && !state.plans.includes(p.s)).length;
  const kinds = Object.keys(PLAN_KINDS).filter((t) => P.some((p) => p.t === t));
  return `<div class="pw-ptypes" role="group" aria-label="Show one kind of plan"><button type="button" data-ptype="" aria-pressed="${!planType}">All</button>${kinds.map((t) => `<button type="button" data-ptype="${esc(t)}" aria-pressed="${planType === t}">${esc(PLAN_KINDS[t])} <span>${left(t)}</span></button>`).join('')}</div>`;
}
const MAX_SUGG = 12;
/** Entry programs whose name the words typed start ("life sci", "phys", "honours arts"). */
function entryHits(typed) {
  const words = E.planTokens(typed);
  if (!words.length || typed.trim().length < 3 || planType) return [];
  return E.ENTRY_PROGRAMS.filter((e) => {
    const names = E.planTokens(e.name);
    return words.every((w) => names.some((n) => n.startsWith(w)));
  });
}
function planSuggest(input) {
  const list = document.getElementById('pw-psugg');
  const typed = input.value.trim();
  const hits = planHits(input.value);
  const shown = typed ? hits.slice(0, MAX_SUGG) : hits;
  const entries = entryHits(typed);
  planActive = 0;
  const faculty = (p) => (p.f ? ` · ${p.f.replace(/^Facult(y|ies) of /, '')}` : '');
  // An entry program first-years apply to ("Life Sciences") isn't a plan: it opens its majors in the list below.
  const entryRows = entries.map((e, i) => `<li role="option" id="pw-po${i}" data-entry="${esc(e.name)}" aria-selected="${i === 0}"><b>${esc(e.name)}</b> <span>Entry program · see its ${E.entryProgram(e.name, P)?.majors.length ?? 0} majors</span></li>`);
  list.innerHTML =
    entryRows.join('') +
    shown.map((p, i) => `<li role="option" id="pw-po${i + entries.length}" data-plan="${esc(p.s)}" aria-selected="${i + entries.length === 0}"><b>${esc(p.n)}</b> <span>${esc(p.t)}${esc(faculty(p))}</span></li>`).join('') +
    (typed && hits.length > MAX_SUGG ? `<li class="pw-smore" aria-hidden="true">${hits.length - MAX_SUGG} more: keep typing${planType ? '' : ', or pick a kind below'}</li>` : '') +
    (typed && !hits.length && !entries.length ? `<li class="pw-smore" aria-hidden="true">No ${planType ? PLAN_KINDS[planType].toLowerCase() : 'plans'} match “${esc(typed)}”</li>` : '');
  list.hidden = !list.children.length;
  input.setAttribute('aria-expanded', String(shown.length + entries.length > 0));
  if (shown.length + entries.length) input.setAttribute('aria-activedescendant', 'pw-po0');
  else input.removeAttribute('aria-activedescendant');
}
function closePlanSugg() {
  const list = document.getElementById('pw-psugg');
  const input = document.getElementById('pw-pq');
  if (!list || list.hidden) return;
  list.hidden = true;
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
}
/** An entry program's majors, in the list under the plan box. */
function openEntry(name) {
  state.exfac = `entry:${name}`;
  state.exview = 'all';
  dirAll = false;
  closePlanSugg();
  const pq = document.getElementById('pw-pq');
  if (pq) pq.value = '';
  render();
  clearTimeout(dirTimer);
  renderDirections();
  document.getElementById('pw-explore')?.scrollIntoView({ block: 'start' });
  document.getElementById('pw-dirlist')?.focus({ preventScroll: true });
}
function addPlan(slug) {
  if (!state.plans.includes(slug)) {
    state.plans.push(slug);
    analyze();
    adopt(slug);
  }
  const pq = document.getElementById('pw-pq');
  if (pq) pq.value = '';
  render();
}
app.addEventListener('submit', (e) => {
  if (e.target.id !== 'pw-addplan') return;
  e.preventDefault();
  const list = document.getElementById('pw-psugg');
  if (list?.hidden) planSuggest(document.getElementById('pw-pq'));
  const pick = list?.querySelector('li[aria-selected="true"]') ?? list?.querySelector('li[data-plan]');
  if (pick?.dataset.entry) {
    openEntry(pick.dataset.entry);
    return;
  }
  if (pick) {
    addPlan(pick.dataset.plan);
    document.getElementById('pw-pq')?.focus();
  }
});
// Up and down move through the suggestions, Enter adds the one picked, Escape closes them.
app.addEventListener('keydown', (e) => {
  if (e.target.id !== 'pw-pq') return;
  const list = document.getElementById('pw-psugg');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (list.hidden) {
      if (e.key === 'ArrowDown' && (e.target.value.trim() || planType)) {
        e.preventDefault();
        planSuggest(e.target);
      }
      return;
    }
    const items = [...list.querySelectorAll('li[data-plan], li[data-entry]')];
    if (!items.length) return;
    e.preventDefault();
    planActive = (planActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === planActive)));
    items[planActive].scrollIntoView({ block: 'nearest' });
    e.target.setAttribute('aria-activedescendant', items[planActive].id);
  } else if (e.key === 'Escape') {
    if (!list.hidden) {
      e.preventDefault();
      closePlanSugg();
    }
  }
});
// The pointer picks too; pressing on the list keeps the box focused, so the click lands.
app.addEventListener('mousemove', (e) => {
  const li = e.target.closest('#pw-psugg li[data-plan], #pw-psugg li[data-entry]');
  if (!li || li.getAttribute('aria-selected') === 'true') return;
  const items = [...document.querySelectorAll('#pw-psugg li[data-plan], #pw-psugg li[data-entry]')];
  planActive = items.indexOf(li);
  items.forEach((x) => x.setAttribute('aria-selected', String(x === li)));
  document.getElementById('pw-pq')?.setAttribute('aria-activedescendant', li.id);
});
app.addEventListener('mousedown', (e) => {
  if (e.target.closest('#pw-psugg')) e.preventDefault();
});
app.addEventListener('focusin', (e) => {
  if (e.target.id === 'pw-pq' && (planType || e.target.value.trim())) planSuggest(e.target);
});
app.addEventListener('focusout', (e) => {
  if (e.target.id !== 'pw-pq') return;
  setTimeout(() => {
    if (document.activeElement?.id !== 'pw-pq' && !document.activeElement?.closest?.('.pw-ptypes')) closePlanSugg();
  }, 120);
});

// Printing (or saving as PDF): every checklist open, the way it looks on screen otherwise.
let closed = [];
window.addEventListener('beforeprint', () => {
  closed = [...app.querySelectorAll('details:not([open])')];
  for (const d of closed) d.open = true;
});
window.addEventListener('afterprint', () => {
  for (const d of closed) d.open = false;
  closed = [];
});

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

analyze();
if (pendingAdopt) adopt(pendingAdopt);
if (pendingShow) openPanel(pendingShow);
else if (pendingBrowse) openBrowse({ view: pendingBrowse });
else if (pendingCourse) showCourse(pendingCourse);
else render();
