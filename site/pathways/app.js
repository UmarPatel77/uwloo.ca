// uwloo.ca/pathways: a degree, term by term, in a grid you type into like a spreadsheet.
// Rules: engine.js. Data: /pathways/data.json (scripts/lib/pathways.mjs). Saved in this browser, and in the
// link (#…) when shared.
const root = document.getElementById('pathways');
const V = root.dataset.v;
const app = document.getElementById('pw-app');
const E = await import(`/pathways/engine.js?v=${V}`);
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
// Programs come from the calendar of the year someone started (2024–25 on); the current one is in data.json.
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
      sets.set(y, (await (await fetch(`${info.file}?v=${V}`)).json()).programs);
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
const shareable = (s) => ({ ...s, rows: s.rows.map(({ g, stash, ...r }) => r) });

let state = null;
const hash = location.hash.slice(1);
const fromHash = hash && !hash.startsWith('add=') ? decode(hash) : null;
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
  app.innerHTML = `${barHtml()}${plansHtml()}<div class="pw-main"><div class="pw-left">${gridHtml()}<div class="pw-detail" id="pw-detail" aria-live="polite">${detailHtml()}</div></div><aside class="pw-side">${sideHtml()}</aside></div>`;
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
    .map((p, k) => `<li class="pw-plan d${k % 8}"><a href="/programs/${esc(p.s)}/">${esc(p.n)}</a><span class="t">${esc(p.t)}</span><button type="button" data-unplan="${esc(p.s)}" aria-label="Remove ${esc(p.n)}">×</button></li>`)
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
${A.plans.length ? '<p class="pw-acts"><button type="button" class="pw-fillbtn" data-act="fill">Fill in courses…</button> <button type="button" class="pw-findbtn" data-act="find">Find courses…</button></p>' : ''}
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
  const major = plans.find((p) => p.t === 'Major');
  const deg = major && /\((Bachelor of [A-Za-z ]+?)\s*-/.exec(major.n)?.[1];
  if (!deg) return null;
  const hits = P.filter((p) => p.t === 'Degree Requirements' && p.n.startsWith(deg));
  return hits.find((p) => p.n.includes(major.f.replace('Faculty of ', ''))) ?? hits[0] ?? null;
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

/** The course card under the grid: what it needs, what it opens up, what it counts toward, and its grade. */
function detailHtml() {
  const code = selected && state.rows[selected.r]?.c[selected.c];
  if (!code) return '';
  const c = C[code];
  const f = A.flags[selected.r]?.[selected.c];
  const key = A.keys[selected.r]?.[selected.c];
  const g = gradeAt(selected.r, selected.c);
  const counts = A.evals.map((ev, k) => (key != null && ev.used.has(key) ? `<li><i class="pw-dot d${k % 8}"></i>${esc(A.plans[k].n)}</li>` : '')).join('');
  const issues = f?.issues.filter(([k]) => k !== 'ph').map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('') ?? '';
  const term = E.termName(termOf(selected.r));
  if (E.isPlaceholder(code))
    return `<div class="pw-dcard"><h3>${esc(fmt(code))} <span class="t">placeholder · ${esc(term)}</span></h3><p>For ${esc(phText(code))}. Type the course here once you pick it; until then it holds the slot and counts toward requirements described in words.</p>${issues ? `<ul class="pw-issues">${issues}</ul>` : ''}
${counts ? `<p class="t">Counts toward:</p><ul class="pw-counts">${counts}</ul>` : ''}</div>`;
  const sn = c?.[5] ?? [0, 0, 0];
  const seasons = ['Fall', 'Winter', 'Spring'].map((x, k) => `<span class="pw-season${sn[k] ? '' : ' none'}" title="${esc(`${x}: ${plural(sn[k], 'term')} with sections in the last 4 years`)}">${x}<b>${sn[k]}</b></span>`).join('');
  const pre = reqText(c?.[2]);
  const co = reqText(c?.[3]);
  const anti = (c?.[4] || []).map(fmt).join(', ');
  // What it opens up: courses in your grid, ones your plans still need, then the rest.
  const leads = leadsTo(code);
  const need = neededNow();
  const inGrid = leads.filter((k) => A.planned.has(k));
  const forPlans = leads.filter((k) => !A.planned.has(k) && need.has(k));
  const rest = leads.filter((k) => !A.planned.has(k) && !need.has(k) && !C[k]?.[7]);
  const leadChips = (list, st, max) => `${list.slice(0, max).map((k) => chip(k, st)).join('')}${list.length > max ? ` <span class="t">and ${list.length - max} more</span>` : ''}`;
  const leadsHtml = leads.length
    ? `<div class="pw-leads"><p class="t">Leads to ${plural(leads.length, 'course')}${leads.length > 3 ? ` · <a href="/${code.toLowerCase()}/#leads-h">all of them</a>` : ''}</p>${inGrid.length ? `<p><span class="pw-lead">In your grid</span>${leadChips(inGrid, 'ok', 12)}</p>` : ''}${forPlans.length ? `<p><span class="pw-lead">For your plans</span>${leadChips(forPlans, 'no', 12)}</p>` : ''}${rest.length ? `<p><span class="pw-lead">${inGrid.length || forPlans.length ? 'Others' : 'Courses'}</span>${leadChips(rest, 'no', 10)}</p>` : ''}</div>`
    : '';
  const gradeBox = `<label class="pw-grade">Grade <input id="pw-grade" value="${esc(g ?? '')}" placeholder="e.g. 85 or CR" spellcheck="false" autocomplete="off" inputmode="text" size="7" aria-describedby="pw-gnote"></label><span class="t" id="pw-gnote">${g == null ? 'Once you have it. Kept in this browser only, never in shared links.' : failed(g) ? 'Doesn’t count toward requirements.' : notYet(g) ? 'Counts once the final grade is in.' : 'Counts toward your averages.'}</span>`;
  return `<div class="pw-dcard"><h3><a href="/${code.toLowerCase()}/">${esc(fmt(code))}</a> ${esc(c?.[0] ?? '')} <span class="t">${c ? `${units(c[1])} units · ` : ''}${esc(term)}</span></h3>
<div class="pw-dmeta"><span class="pw-seasons" aria-label="Terms with sections in the last 4 years">${seasons}</span>${gradeBox}</div>
${pre || co || anti ? `<dl class="pw-reqs">${pre ? `<dt>Prerequisites</dt><dd>${esc(pre)}</dd>` : ''}${co ? `<dt>Corequisites</dt><dd>${esc(co)}</dd>` : ''}${anti ? `<dt>Antirequisites</dt><dd>${esc(anti)}</dd>` : ''}</dl>` : ''}
${issues ? `<ul class="pw-issues">${issues}</ul>` : g != null ? '' : '<p class="t">No problems found: prerequisites are in earlier terms and it runs in this season.</p>'}
${counts ? `<p class="t">Counts toward:</p><ul class="pw-counts">${counts}</ul>` : A.plans.length && key != null ? '<p class="t">Doesn’t count toward a specific requirement of your plans (it may still be an elective).</p>' : ''}
${leadsHtml}</div>`;
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
  return `${summary}${checklists}${directionsShell()}`;
}

function chip(code, state_) {
  const title = E.isPlaceholder(E.baseCode(code)) ? `Placeholder for ${phText(code)}` : C[code]?.[0] ?? '';
  return `<button type="button" class="pw-chip ${state_}${E.isPlaceholder(E.baseCode(code)) ? ' ph' : ''}" data-add="${esc(code)}" title="${esc(`${title}${state_ === 'no' ? ' · click to add it to the grid' : ''}`)}">${esc(fmt(code))}</button>`;
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
  return `<details class="pw-box pw-check" open><summary><i class="pw-dot d${k % 8}"></i><b>${esc(p.n)}</b><span class="pw-prog"><span style="width:${done}%"></span></span><span class="t">${ev.have} of ${ev.need}${ev.unknown ? '+' : ''}</span></summary>${tu}${rows || '<p class="t">The calendar lists no courses by name for this one; see its page.</p>'}${averagesHtml(p, k)}<p class="t"><a href="/programs/${esc(p.s)}/">All of its rules</a></p></details>`;
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

// ---------------- directions: what's still open ----------------

function directionsShell() {
  const study = state.rows.map((r, i) => ({ r, i })).filter((x) => x.r.k === 's');
  const types = TYPE_ORDER.filter((t) => t !== 'Degree Requirements' && P.some((p) => p.t === t));
  return `<section class="pw-box pw-dir"><h2>Still open</h2>
<p><label>With what’s planned through <select id="pw-cut"><option value="-1"${state.cut === -1 ? ' selected' : ''}>the whole grid</option>${study.map((x) => `<option value="${x.i}"${state.cut === x.i ? ' selected' : ''}>${esc(A.lv[x.i])} (${esc(E.termName(termOf(x.i)))})</option>`).join('')}</select></label></p>
<div class="pw-tabs" role="group" aria-label="Kind of program">${types.map((t) => `<button type="button" data-dir="${t}" aria-pressed="${state.dir === t}">${t === 'Specialization' ? 'Specializations' : `${t}s`}</button>`).join('')}</div>
<ol class="pw-dirlist" id="pw-dirlist"><li class="t">Working it out…</li></ol></section>`;
}

let dirTimer = 0;
let dirAll = false;
function scheduleDirections() {
  clearTimeout(dirTimer);
  dirTimer = setTimeout(renderDirections, 120);
}
function renderDirections() {
  const list = document.getElementById('pw-dirlist');
  if (!list) return;
  const planned = new Map();
  state.rows.forEach((r, i) => {
    if (!hasCells(r) || (state.cut >= 0 && i > state.cut)) return;
    r.c.forEach((code, j) => {
      if (code && A.keys[i]?.[j] !== null) planned.set(code, { units: C[code]?.[1] ?? 0.5 });
    });
  });
  const majors = A.plans.filter((p) => p.t === 'Major').map((p) => p.s);
  // Ones open to your majors first; specializations for other majors after; ones that can't combine last.
  const forOthers = (p) => Boolean(p.open?.length && !p.open.some((s) => majors.includes(s)));
  const every = E.directions(P, planned, { chosen: state.plans, cant, courses: C, types: [state.dir] })
    .map((x, i) => ({ ...x, i, other: forOthers(x.p) }))
    .sort((a, b) => (a.blocked.length > 0) - (b.blocked.length > 0) || a.other - b.other || a.i - b.i);
  const res = dirAll ? every : every.slice(0, 12);
  list.innerHTML = res.length
    ? res
        .map(({ p, need, have, left, unknown, blocked }) => {
          const notFor = forOthers(p);
          const note = blocked.length ? `<span class="pw-no">can’t go with ${esc(bySlug.get(blocked[0])?.n ?? '')}</span>` : notFor ? `<span class="t">for ${esc(p.open.map((s) => bySlug.get(s)?.fi).filter(Boolean).slice(0, 2).join(', '))} majors</span>` : '';
          return `<li class="${blocked.length ? 'blocked' : ''}"><a href="/programs/${esc(p.s)}/">${esc(p.n)}</a> <span class="pw-left">${left ? `${left} to go` : 'all listed courses planned'}</span> <span class="t">${have} of ${need}${unknown ? '+' : ''}</span> ${note} ${blocked.length ? '' : `<button type="button" class="pw-linkbtn" data-plan="${esc(p.s)}">Add</button>`}</li>`;
        })
        .join('')
    : '<li class="t">Nothing of this kind lists courses by name.</li>';
  if (every.length > 12) list.insertAdjacentHTML('beforeend', `<li class="pw-allbtn"><button type="button" class="pw-linkbtn" data-act="dirall">${dirAll ? 'Show fewer' : `Show all ${every.length}`}</button></li>`);
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
  if (!selected || selected.r !== r || selected.c !== c) {
    selected = { r, c };
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
    if (A.planned.has(code)) {
      const at = A.planned.get(code).row;
      const j = A.keys[at].indexOf(code);
      selected = { r: at, c: j };
      render();
      focusCell(at, j);
      return;
    }
    const at = place(code);
    selected = at;
    render();
    app.querySelector(`.pw-in[data-r="${at.r}"][data-c="${at.c}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  const un = t.closest('[data-unplan]');
  if (un) {
    state.plans = state.plans.filter((s) => s !== un.dataset.unplan);
    if (offer === un.dataset.unplan) offer = null;
    render();
    return;
  }
  const kindChip = t.closest('[data-ptype]');
  if (kindChip) {
    planType = kindChip.dataset.ptype === planType ? '' : kindChip.dataset.ptype;
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
  const pl = t.closest('[data-plan]');
  if (pl) {
    const fromList = Boolean(pl.closest('#pw-psugg'));
    addPlan(pl.dataset.plan);
    if (fromList) document.getElementById('pw-pq')?.focus({ preventScroll: true });
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
  const dir = t.closest('[data-dir]');
  if (dir) {
    state.dir = dir.dataset.dir;
    render();
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

let fill = null; // {slugs: Set, choice: Map key → Set, load, from, ph, last}
const dlg = document.createElement('dialog');
dlg.className = 'pw-fill';
dlg.setAttribute('aria-labelledby', 'pw-fill-h');
root.append(dlg);
const PLAN_ORDER = { 'Degree Requirements': 0, Major: 1, Specialization: 2, Option: 3, Minor: 4, Diploma: 5, Certificate: 6 };
const studyRows = () => state.rows.map((r, i) => (r.k === 's' ? i : -1)).filter((i) => i >= 0);

function openFill(only = null) {
  const study = studyRows();
  // Courses go in from this term on: what's in earlier terms is what's been taken.
  const now = study.find((i) => Number(termOf(i)) >= Number(data.term)) ?? study[0] ?? 0;
  // A major's degree requirements (first-year math for a BMath, the communication requirement…) come along
  // unless unticked, and are added to the plans.
  const deg = degreeFor(A.plans);
  const extraOn = Boolean(deg) && (!only || bySlug.get(only)?.t === 'Major');
  fill = { slugs: new Set(only ? [only] : state.plans), choice: new Map(), load: NORMAL, from: now, ph: true, extra: deg?.s ?? null, extraOn, skip: new Set(), more: 0 };
  offer = null;
  render();
  renderFill();
  if (!dlg.open) dlg.showModal();
  (dlg.querySelector('.pw-opt') ?? dlg.querySelector('[data-fill="add"]'))?.focus();
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
  // Terms the dialog adds at the end (only when the courses are added).
  const all = [...state.rows, ...Array.from({ length: fill.more }, () => ({ k: 's', c: [] }))];
  const rows = all.map((r, i) => ({ kind: KIND[r.k], season: E.seasonOf(termOf(i)), codes: r.c }));
  const planCtx = A.plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const res = E.arrange(rows, want, { courses: C, load: fill.load, max: SLOTS, from: fill.from, equiv, plans: planCtx });
  return { plans, must: [...must.values()], picks, words, want, res, rows, lv: E.levels(rows) };
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
  const noRoom = F.res.left.length
    ? `<div class="pw-warn"><p>No room at ${fill.load} a term for ${plural(F.res.left.length, 'course')}: ${F.res.left.map(fmt).join(', ')}.</p><p>${fill.load < SLOTS ? `<button type="button" class="pw-linkbtn" data-fill="load+">Allow ${fill.load + 1} a term</button> or ` : ''}<button type="button" class="pw-linkbtn" data-fill="more">add a term</button></p></div>`
    : fill.more
      ? `<p class="t">${plural(fill.more, 'term')} added at the end. <button type="button" class="pw-linkbtn" data-fill="less">Remove ${fill.more === 1 ? 'it' : 'one'}</button></p>`
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
<div class="pw-fillhead"><h2 id="pw-fill-h">Fill in courses</h2><p class="t">From the ${esc(labelOf(calYear))} calendar, for a start in ${esc(E.termName(state.start))}. Nothing changes until you add them.</p><button type="button" class="pw-x" data-fill="close" aria-label="Close">×</button></div>
${plansBox}
<div class="pw-fillbody">
<section class="pw-fillpicks" aria-label="Choices">${empty ? '<p>Everything these plans name is already in your grid.</p>' : ''}${F.picks.length ? `<h3>Choose <span class="t">${open ? `${open} of ${F.picks.length} still open; ones you skip stay in the checklist` : 'all picked'}</span></h3>${F.picks.map(pickCard).join('')}` : ''}${F.words.length ? `<h3>Described in words</h3>${F.words.map(wordsCard).join('')}` : ''}${musts}</section>
<section class="pw-fillprev" aria-label="Where they’d go"><h3>Where they’d go</h3>${past}${coop}<table class="pw-prev"><tbody>${prev}</tbody></table>${noRoom}</section>
</div>
<div class="pw-fillfoot"><div class="pw-fillopts"><label>From <select data-fill="from">${study.map((i) => `<option value="${i}"${i === fill.from ? ' selected' : ''}>${esc(A.lv[i])} (${esc(E.termName(termOf(i)))})</option>`).join('')}</select></label><label>Up to <select data-fill="load">${[4, 5, 6, 7].map((x) => `<option${x === fill.load ? ' selected' : ''}>${x}</option>`).join('')}</select> a term</label><label><input type="checkbox" data-fill="ph"${fill.ph ? ' checked' : ''}> Placeholders</label></div><div class="pw-fillbtns"><button type="button" data-fill="close">Cancel</button><button type="button" class="pw-primary" data-fill="add"${n ? '' : ' disabled'}>Add ${plural(n, 'course')}</button></div></div>
</div>`;
  const picksEl = dlg.querySelector('.pw-fillpicks');
  if (picksEl) picksEl.scrollTop = scroll;
  if (active) dlg.querySelector(active)?.focus({ preventScroll: true });
}
const selectorOf = (el) => {
  for (const a of ['data-pick', 'data-word', 'data-fill', 'data-fplan', 'data-fextra', 'data-unpick', 'data-skip']) {
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
  for (let x = 0; x < fill.more; x++) state.rows.push({ k: 's', c: [] });
  for (const { code, row } of F.res.placed) {
    const r = state.rows[row];
    const j = Array.from({ length: slotsOf(r) }, (_, k) => k).find((k) => !r.c[k]);
    if (j != null) setCell(row, j, code);
  }
  undo = { rows: before, plans: plansBefore, n: F.res.placed.length, names: F.plans.map((p) => p.n) };
  dlg.close();
  render();
}

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
<div class="pw-fillhead"><h2 id="pw-find-h">Find courses</h2><p class="t">Courses that would count toward what your plans still need. Add puts one in your grid, in its year, after its prerequisites, in a term it runs.</p><button type="button" class="pw-x" data-fclose aria-label="Close">×</button></div>
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
  const tokens = E.planTokens(q);
  const pool = P.filter((p) => !state.plans.includes(p.s) && (!planType || p.t === planType));
  // Specializations and options open to your majors first ("Finance Specialization" for Math/CPA).
  const other = (p) => (p.open?.length && !p.open.some((s) => state.plans.includes(s)) ? 1 : 0);
  // Then majors before minors…, Honours before Joint Honours and general degrees, and shorter names first
  // (Economics Minor before Economic Policy Minor).
  const degree = (p) => (/Joint Honours/.test(p.n) ? 1 : /Four-Year General/.test(p.n) ? 2 : /Three-Year General/.test(p.n) ? 3 : 0);
  const order = (a, b) => other(a) - other(b) || TYPE_ORDER.indexOf(a.t) - TYPE_ORDER.indexOf(b.t) || degree(a) - degree(b) || E.planWords(a).name.length - E.planWords(b).name.length || a.n.localeCompare(b.n);
  if (!tokens.length) return planType ? pool.sort(order) : [];
  return pool
    .map((p) => [p, E.planScore(p, tokens)])
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
function planSuggest(input) {
  const list = document.getElementById('pw-psugg');
  const typed = input.value.trim();
  const hits = planHits(input.value);
  const shown = typed ? hits.slice(0, MAX_SUGG) : hits;
  planActive = 0;
  const faculty = (p) => (p.f ? ` · ${p.f.replace(/^Facult(y|ies) of /, '')}` : '');
  list.innerHTML =
    shown.map((p, i) => `<li role="option" id="pw-po${i}" data-plan="${esc(p.s)}" aria-selected="${i === 0}"><b>${esc(p.n)}</b> <span>${esc(p.t)}${esc(faculty(p))}</span></li>`).join('') +
    (typed && hits.length > MAX_SUGG ? `<li class="pw-smore" aria-hidden="true">${hits.length - MAX_SUGG} more: keep typing${planType ? '' : ', or pick a kind below'}</li>` : '') +
    (typed && !hits.length ? `<li class="pw-smore" aria-hidden="true">No ${planType ? PLAN_KINDS[planType].toLowerCase() : 'plans'} match “${esc(typed)}”</li>` : '');
  list.hidden = !list.children.length;
  input.setAttribute('aria-expanded', String(shown.length > 0));
  if (shown.length) input.setAttribute('aria-activedescendant', 'pw-po0');
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
    const items = [...list.querySelectorAll('li[data-plan]')];
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
  const li = e.target.closest('#pw-psugg li[data-plan]');
  if (!li || li.getAttribute('aria-selected') === 'true') return;
  const items = [...document.querySelectorAll('#pw-psugg li[data-plan]')];
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
render();
