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
/** "PMATH4XX" → "any PMATH course at the 400 level"; "ECONXXX" → "any ECON course"; "ELECTIVE" → "an elective…". */
const phText = (c) => {
  const b = E.baseCode(c);
  if (b === 'ELECTIVE') return 'an elective: any course that fits your plans';
  const m = /^([A-Z]+?)(\d|X)XX$/.exec(b);
  return m[2] === 'X' ? `any ${m[1]} course` : `any ${m[1]} course at the ${m[2]}00 level`;
};
const COUNTING = 'https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/policy/BkBW5tFVT';
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
const blank = () => ({ v: 1, start: fallOf(data.term), rows: freshRows(fallOf(data.term)), plans: [], ticked: [], cut: -1, dir: 'Minor' });

function decode(text) {
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/')))));
    return s && s.v === 1 && Array.isArray(s.rows) ? s : null;
  } catch {
    return null;
  }
}
const encode = (s) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
for (const r of state.rows) r.c = (r.c ?? []).slice(0, SLOTS);
let offer = null; // a plan just added: offer to fill in its courses
let pendingAdopt = null; // a plan from the link (#add=…), adopted once everything's ready
let undo = null; // {rows, n, names}: the grid before the last fill-in
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
  const planned = new Map();
  const count = new Map();
  // Each cell's key in planned: its code, or "PMATH4XX#2" for a second placeholder of the same kind.
  const keys = state.rows.map(() => []);
  state.rows.forEach((r, i) => {
    if (r.k !== 's') return;
    r.c.forEach((code, j) => {
      if (!code) return;
      if (E.isPlaceholder(code)) keys[i][j] = E.addPlanned(planned, code, { units: 0.5, row: i });
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
  const { evals, capped } = E.evaluateAll(asPicked, planned, { ticked, courses: C });
  const before = new Set();
  const flags = state.rows.map(() => []);
  state.rows.forEach((r, i) => {
    if (r.k !== 's') return;
    const same = new Set(r.c.filter(Boolean));
    const season = E.seasonOf(termOf(i));
    r.c.forEach((code, j) => {
      if (!code) return;
      const c = C[code];
      const key = keys[i][j];
      const issues = [];
      if (E.isPlaceholder(code)) issues.push(['ph', `A placeholder for ${phText(code)}. Type the course here once you pick it.`]);
      else if (!c) issues.push(['bad', 'Not in the current calendar']);
      else {
        if (c[7]) issues.push(['bad', 'No longer in the calendar']);
        const ctx = { level: lv[i], plans: planCtx, equiv };
        const pre = c[2] ? E.holds(c[2], before, ctx) : true;
        if (pre === false) {
          const w = E.why(c[2], before, ctx);
          const parts = [w.codes.length ? `${w.codes.map(fmt).join(' or ')} in an earlier term` : '', w.level ? `level ${w.level} or higher (this is ${lv[i]})` : '', w.plans.length ? `enrolled in ${w.plans.join(' or ')}` : ''].filter(Boolean);
          issues.push(['bad', `Prerequisites: needs ${parts.join('; ') || 'more than is planned before it'}`]);
        } else if (pre === null) issues.push(['check', 'Check the prerequisites: they name a plan the grid can’t confirm']);
        if (c[3] && E.holds(c[3], new Set([...before, ...same]), ctx) === false) issues.push(['bad', `Corequisites not met: ${E.missing(c[3], new Set([...before, ...same]), ctx).map(fmt).join(', ')}`]);
        const s = c[5];
        const total = s[0] + s[1] + s[2];
        const name = { F: 'Fall', W: 'Winter', S: 'Spring' }[season];
        if (total && !s['FWS'.indexOf(season)]) issues.push(['warn', `Hasn’t run in ${name} lately (last 4 years: Fall ${s[0]}, Winter ${s[1]}, Spring ${s[2]})`]);
        else if (!total) issues.push(['warn', 'No sections in the last 4 years']);
        const anti = [...planned.keys()].filter((o) => o !== code && ((c[4] || []).includes(o) || (C[o]?.[4] || []).includes(code)));
        if (anti.length) issues.push(['bad', `Antirequisite with ${anti.map(fmt).join(', ')}: only one counts`]);
        if (count.get(code) > 1) issues.push(['warn', 'Planned more than once']);
      }
      if (capped.has(key)) issues.push(['warn', `Already counts toward two plans, so not toward ${capped.get(key).join(' or ')} (a course counts toward two plans at most)`]);
      evals.forEach((ev, k) => {
        if (ev.rows.some((x) => x.kind === 'not' && x.bad.includes(code))) issues.push(['warn', `Can’t count toward ${plans[k].n}`]);
        if (ev.rows.some((x) => x.kind === 'max' && x.over && x.got.includes(code))) issues.push(['warn', `Over the limit ${plans[k].n} sets for one of its lists`]);
      });
      const dots = evals.map((ev, k) => (ev.used.has(key) ? k : -1)).filter((k) => k >= 0);
      flags[i][j] = { code, issues, dots };
    });
    for (const code of same) before.add(code);
  });
  A = { lv, planned, plans, asPicked, evals, flags, capped, absent, keys };
  return A;
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
  const reg = patternFor('regular');
  const regLen = lengthOf(reg.start, reg.kinds);
  const short = (n) => n.replace(/\s*\(.*$/, '');
  return `<div class="pw-bar">
  <label>Starts <select id="pw-start">${starts.map((t) => `<option value="${t}"${t === state.start ? ' selected' : ''}>${esc(E.termName(t))}</option>`).join('')}</select></label>
  <span class="pw-cal t" title="Requirements follow the calendar of the year you started">${esc(labelOf(calYear))} rules${calYear > startYear() ? ' (the earliest here)' : calYear < startYear() ? ' (the newest here)' : ''}</span>
  <label>Terms <select id="pw-seq">${cur ? '' : '<option value="" selected>Your own terms</option>'}<option value="regular"${cur === 'regular' ? ' selected' : ''}>Regular: Fall and Winter, Spring off · ${esc(yearsText(regLen.terms))}</option><option value="all"${cur === 'all' ? ' selected' : ''}>Every term, no breaks</option>${groups.map((g) => `<optgroup label="Co-op: ${esc(short(g.p.n))}">${g.opts.map((o) => `<option value="${esc(o.id)}"${cur === o.id ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
  <span class="pw-tools"><button type="button" data-act="tsv">Copy as a table</button><button type="button" data-act="link">Copy link</button><button type="button" data-act="reset">Start over</button><span class="t" id="pw-done" role="status"></span></span>
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
<form class="pw-addplan" id="pw-addplan" autocomplete="off"><label class="vh" for="pw-pq">Add a plan</label><input id="pw-pq" placeholder="${A.plans.length ? 'Add a minor, option, specialization…' : 'Add your major, minors, options…'}" role="combobox" aria-expanded="false" aria-controls="pw-psugg" spellcheck="false"><ul id="pw-psugg" class="pw-sugg" role="listbox" hidden></ul></form>
${A.plans.length ? '<button type="button" class="pw-fillbtn" data-act="fill">Fill in courses…</button>' : ''}
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

function gridHtml() {
  const head = `<tr><th scope="col">Term</th><th scope="col" class="pw-lv">Level</th>${Array.from({ length: SLOTS }, (_, j) => `<th scope="col" class="${j >= NORMAL ? 'pw-extra' : ''}">${j + 1}</th>`).join('')}<th scope="col">Load</th></tr>`;
  const body = state.rows
    .map((r, i) => {
      const term = termOf(i);
      const label = r.k === 's' ? A.lv[i] : r.k === 'c' ? 'WT' : 'Off';
      const next = { s: 'co-op', c: 'off', o: 'study' }[r.k];
      const kind = `<button type="button" class="pw-kind ${r.k}" data-kind="${i}" aria-label="${esc(`${E.termName(term)}: ${{ s: `study term ${A.lv[i]}`, c: 'co-op work term', o: 'off' }[r.k]}. Make it ${next}`)}" title="Click to make it ${next}">${esc(label)}</button>`;
      if (r.k !== 's') return `<tr class="pw-row ${r.k === 'c' ? 'coop' : 'off'}"><th scope="row">${esc(E.termName(term))}</th><td class="pw-lv">${kind}</td><td colspan="${SLOTS}" class="pw-note">${r.k === 'c' ? 'Co-op work term' : 'Off'}</td><td></td></tr>`;
      const n = r.c.filter(Boolean).length;
      const u = r.c.filter(Boolean).reduce((s, c) => s + (C[c]?.[1] ?? 0.5), 0);
      const cells = Array.from({ length: SLOTS }, (_, j) => {
        const code = r.c[j] ?? '';
        const f = A.flags[i]?.[j];
        const ph = Boolean(code) && E.isPlaceholder(code);
        const real = f?.issues.filter((x) => x[0] !== 'ph') ?? [];
        const worst = real.some((x) => x[0] === 'bad') ? 'bad' : real.some((x) => x[0] === 'warn') ? 'warn' : real.length ? 'check' : '';
        const dots = f?.dots.map((k) => `<i class="d${k % 8}"></i>`).join('') ?? '';
        const tip = f ? [ph ? '' : C[code]?.[0], ...f.issues.map((x) => x[1])].filter(Boolean).join(' · ') : '';
        return `<td class="pw-c${j >= NORMAL ? ' pw-extra' : ''}${worst ? ` ${worst}` : ''}${ph ? ' ph' : ''}"><input class="pw-in" data-r="${i}" data-c="${j}" value="${esc(code ? fmt(code) : '')}" aria-label="${esc(`${E.termName(term)} course ${j + 1}`)}" title="${esc(tip)}" spellcheck="false" autocomplete="off">${dots ? `<span class="pw-dots" aria-hidden="true">${dots}</span>` : ''}</td>`;
      }).join('');
      const load = n > NORMAL ? (n > NORMAL + 1 ? 'heavy' : 'over') : '';
      return `<tr class="pw-row"><th scope="row">${esc(E.termName(term))}</th><td class="pw-lv">${kind}</td>${cells}<td class="pw-load ${load}">${n ? `${n} <span class="t">· ${units(u)}u</span>${load ? `<small>${load === 'heavy' ? 'heavy' : 'overload'}</small>` : ''}` : ''}</td></tr>`;
    })
    .join('');
  return `<div class="pw-gridwrap"><table class="pw-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
<div class="pw-rowtools"><button type="button" data-act="addrow">+ Add a term</button>${state.rows.length > 1 ? '<button type="button" data-act="droprow">Remove the last term</button>' : ''}<span class="t">Type a course code into any cell. Enter goes down, arrows move, and a pasted list fills down the column.</span></div>`;
}

let selected = null; // {r, c}
function detailHtml() {
  const code = selected && state.rows[selected.r]?.c[selected.c];
  if (!code) return '';
  const c = C[code];
  const f = A.flags[selected.r]?.[selected.c];
  const key = A.keys[selected.r]?.[selected.c];
  const counts = A.evals.map((ev, k) => (ev.used.has(key) ? `<li><i class="pw-dot d${k % 8}"></i>${esc(A.plans[k].n)}</li>` : '')).join('');
  const issues = f?.issues.filter(([k]) => k !== 'ph').map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('') ?? '';
  if (E.isPlaceholder(code))
    return `<div class="pw-dcard"><h3>${esc(fmt(code))} <span class="t">placeholder</span></h3><p>For ${esc(phText(code))}. Type the course here once you pick it; until then it holds the slot and counts toward requirements described in words.</p>${issues ? `<ul class="pw-issues">${issues}</ul>` : ''}
${counts ? `<p class="t">Counts toward:</p><ul class="pw-counts">${counts}</ul>` : ''}</div>`;
  return `<div class="pw-dcard"><h3><a href="/${code.toLowerCase()}/">${esc(fmt(code))}</a> ${esc(c?.[0] ?? '')} <span class="t">${c ? `${units(c[1])} units` : ''}</span></h3>
${issues ? `<ul class="pw-issues">${issues}</ul>` : '<p class="t">No problems found: prerequisites are in earlier terms and it runs in this season.</p>'}
${counts ? `<p class="t">Counts toward:</p><ul class="pw-counts">${counts}</ul>` : A.plans.length ? '<p class="t">Doesn’t count toward a specific requirement of your plans (it may still be an elective).</p>' : ''}</div>`;
}

function sideHtml() {
  const plannedN = A.planned.size;
  const plannedU = [...A.planned.values()].reduce((s, x) => s + x.units, 0);
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
  const summary = `<section class="pw-box"><h2>Your degree</h2>${unitLine}<p>${plural(study.length, 'study term')}${len.work ? ` and ${plural(len.work, 'work term')}` : ''}${over ? `, ${plural(over, 'with an overload', 'with overloads')}` : ''}.${span}</p>${fit}${gaps ? `<p class="t">Counted from requirements that name courses; ones in words that the grid can’t check are ticked by hand below.</p>` : ''}</section>`;
  const checklists = A.plans.map((p, k) => checklistHtml(p, A.evals[k], k)).join('');
  return `${summary}${checklists}${directionsShell()}`;
}

function chip(code, state_) {
  const title = E.isPlaceholder(E.baseCode(code)) ? `Placeholder for ${phText(code)}` : C[code]?.[0] ?? '';
  return `<button type="button" class="pw-chip ${state_}${E.isPlaceholder(E.baseCode(code)) ? ' ph' : ''}" data-add="${esc(code)}" title="${esc(`${title}${state_ === 'no' ? ' · click to add it to the grid' : ''}`)}">${esc(fmt(code))}</button>`;
}

function checklistHtml(p, ev, k) {
  const pct = ev.need ? Math.round((ev.have / ev.need) * 100) : 0;
  const rows = ev.rows
    .map((row) => {
      const pad = `style="--d:${row.depth}"`;
      const st = (code) => (row.got?.includes(code) ? 'ok' : A.planned.has(code) ? 'el' : 'no');
      const codes = (list, max = 24) => {
        const shown = list.slice(0, max).map((c) => chip(c, st(c))).join('');
        return list.length > max ? `${shown}<details class="pw-more"><summary>${list.length - max} more</summary>${list.slice(max).map((c) => chip(c, st(c))).join('')}</details>` : shown;
      };
      if (row.kind === 'heading') return row.text ? `<h4 ${pad}>${esc(row.text)}${row.need ? ` <span class="t">${row.have} of ${row.need}</span>` : ''}</h4>` : '';
      if (row.kind === 'group') return `<p class="pw-g" ${pad}>${esc(row.text)}${row.need ? ` <span class="t">${row.have} of ${row.need}</span>` : ''}</p>`;
      if (row.kind === 'all' || row.kind === 'n') return `<div class="pw-r ${row.got.length >= row.want ? 'done' : ''}" ${pad}><span class="pw-lead">${row.kind === 'all' ? (row.codes.length > 1 ? 'All of' : 'Required') : `${row.want} of`}</span>${codes(row.codes)}</div>`;
      if (row.kind === 'list') return `<div class="pw-r" ${pad}><span class="pw-lead">Choose from</span>${codes(row.codes, 16)}</div>`;
      if (row.kind === 'not') return `<div class="pw-r ${row.bad.length ? 'bad' : ''}" ${pad}><span class="pw-lead">Can’t count</span>${row.codes.map((c) => chip(c, A.planned.has(c) ? 'bad' : 'no')).join('')}</div>`;
      if (row.kind === 'max') return `<div class="pw-r ${row.over ? 'bad' : ''}" ${pad}><span class="pw-lead">At most ${esc(row.n)} of</span>${codes(row.codes, 12)}</div>`;
      if (row.kind === 'units' || row.kind === 'count') {
        const done = row.kind === 'units' ? row.sum >= row.units - 1e-9 : row.got.length >= row.want;
        const prog = row.kind === 'units' ? `${units(row.sum)} of ${units(row.units)} units` : `${row.got.length} of ${row.want}`;
        return `<div class="pw-r ${done ? 'done' : ''}" ${pad}><p>${esc(row.text)} <span class="t">${prog}</span></p>${row.got.map((c) => chip(c, 'ok')).join('')}</div>`;
      }
      if (row.kind === 'info') return `<p class="pw-info" ${pad}>${esc(row.text)}</p>`;
      return `<label class="pw-r pw-tick ${row.done ? 'done' : ''}" ${pad}><input type="checkbox" data-tick="${esc(row.tick)}"${row.done ? ' checked' : ''}> ${esc(row.text)}</label>`;
    })
    .join('');
  const tu = p.tu ? `<p class="t">The calendar asks for ${units(p.tu)} units in all.</p>` : '';
  return `<details class="pw-box pw-check" open><summary><i class="pw-dot d${k % 8}"></i><b>${esc(p.n)}</b><span class="pw-prog"><span style="width:${pct}%"></span></span><span class="t">${ev.have} of ${ev.need}${ev.unknown ? '+' : ''}</span></summary>${tu}${rows || '<p class="t">The calendar lists no courses by name for this one; see its page.</p>'}<p class="t"><a href="/programs/${esc(p.s)}/">All of its rules</a></p></details>`;
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
    if (r.k !== 's' || (state.cut >= 0 && i > state.cut)) return;
    for (const code of r.c) if (code) planned.set(code, { units: C[code]?.[1] ?? 0.5 });
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
  const m = /([A-Za-z]{2,8})\s*(\d{3}[A-Za-z]?)/.exec(t);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : '';
}

function setCell(r, c, code) {
  if (pending?.r === r && pending?.c === c) pending = null;
  undo = null;
  const row = state.rows[r];
  if (!row || row.k !== 's') return;
  while (row.c.length <= c) row.c.push('');
  row.c[c] = code;
  while (row.c.length && !row.c.at(-1)) row.c.pop();
}

function studyRowsFrom(r, dir) {
  for (let i = r + dir; i >= 0 && i < state.rows.length; i += dir) if (state.rows[i].k === 's') return i;
  return null;
}
function focusCell(r, c) {
  const el = app.querySelector(`.pw-in[data-r="${r}"][data-c="${c}"]`);
  if (el) {
    el.focus();
    el.select();
  }
}

/** Where a course clicked in a checklist should go: the earliest term its prerequisites allow, with room. */
function place(code) {
  const c = C[code];
  const before = new Set();
  const lv = A.lv;
  const planCtx = A.plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const from = selected && !state.rows[selected.r]?.c[selected.c] ? selected : null;
  if (from) {
    setCell(from.r, from.c, code);
    return { r: from.r, c: from.c };
  }
  for (let i = 0; i < state.rows.length; i++) {
    const r = state.rows[i];
    if (r.k !== 's') continue;
    const ok = !c?.[2] || E.holds(c[2], before, { level: lv[i], plans: planCtx, equiv }) !== false;
    const n = r.c.filter(Boolean).length;
    if (ok && n < NORMAL) {
      const j = Array.from({ length: SLOTS }, (_, k) => k).find((k) => !r.c[k]);
      setCell(i, j, code);
      return { r: i, c: j };
    }
    for (const x of r.c) if (x) before.add(x);
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
  const found = [...codes.filter((k) => k.startsWith(q)), ...(q.length > 2 ? codes.filter((k) => !k.startsWith(q) && words.every((w) => C[k][0].toLowerCase().includes(w))) : [])];
  const hits = [...found.slice(0, 8 - phs.length), ...phs];
  if (!hits.length || (hits.length === 1 && hits[0] === q)) return;
  const el = document.createElement('ul');
  el.className = 'pw-sugg pw-csugg';
  el.setAttribute('role', 'listbox');
  el.innerHTML = hits.map((k, i) => `<li role="option" data-code="${k}" aria-selected="${i === 0}"><b>${esc(fmt(k))}</b> <span>${esc(E.isPlaceholder(k) ? `Placeholder: ${phText(k)}` : C[k][0])}</span></li>`).join('');
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
  const value = code ?? parseCode(input.value);
  closeSugg();
  setCell(r, c, value);
  selected = { r, c };
  render();
  if (move) {
    const next = studyRowsFrom(r, move);
    if (next != null) focusCell(next, c);
  }
}

app.addEventListener('focusin', (e) => {
  const input = e.target.closest('.pw-in');
  if (!input) return;
  const r = Number(input.dataset.r);
  const c = Number(input.dataset.c);
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
    if (nc >= SLOTS || nc < 0) {
      const next = studyRowsFrom(r, back ? -1 : 1);
      if (next != null) {
        nr = next;
        nc = back ? SLOTS - 1 : 0;
      } else nc = c;
    }
    commit(input, sugg ? sugg.hits[sugg.active] : null, 0);
    focusCell(nr, nc);
  } else if (e.key === 'Escape') {
    closeSugg();
    input.value = state.rows[r].c[c] ? fmt(state.rows[r].c[c]) : '';
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = studyRowsFrom(r, e.key === 'ArrowDown' ? 1 : -1);
    if (input.value !== (state.rows[r].c[c] ? fmt(state.rows[r].c[c]) : '')) commit(input, null, 0);
    if (next != null) focusCell(next, c);
  } else if ((e.key === 'ArrowRight' && input.selectionStart === input.value.length) || (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0)) {
    const nc = c + (e.key === 'ArrowRight' ? 1 : -1);
    if (nc >= 0 && nc < SLOTS) {
      e.preventDefault();
      if (input.value !== (state.rows[r].c[c] ? fmt(state.rows[r].c[c]) : '')) commit(input, null, 0);
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
    const now = state.rows[r]?.c[c] ? fmt(state.rows[r].c[c]) : '';
    if (input.value !== now) commit(input, null, 0);
    else if (sugg?.input === input) closeSugg();
  }, 120);
});
// Paste: several codes fill down the column (one per line) and across (tabs), like a spreadsheet.
app.addEventListener('paste', (e) => {
  const input = e.target.closest('.pw-in');
  if (!input) return;
  const text = e.clipboardData?.getData('text') ?? '';
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const cells = lines.map((l) => (l.includes('\t') ? l.split('\t') : [...l.matchAll(/[A-Za-z]{2,8}\s*(?:\d{3}[A-Za-z]?|[\dxX][xX]{2}\b)|\belectives?\b/gi)].map((m) => m[0])));
  if (lines.length <= 1 && (cells[0]?.length ?? 0) <= 1) return;
  e.preventDefault();
  let r = Number(input.dataset.r);
  const c0 = Number(input.dataset.c);
  for (const [k, line] of cells.entries()) {
    if (k > 0) {
      const next = studyRowsFrom(r, 1);
      if (next == null) {
        state.rows.push({ k: 's', c: [] });
        r = state.rows.length - 1;
      } else r = next;
    }
    line.forEach((v, j) => {
      if (c0 + j < SLOTS) setCell(r, c0 + j, parseCode(v));
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
  const pl = t.closest('[data-plan]');
  if (pl) {
    if (!state.plans.includes(pl.dataset.plan)) {
      state.plans.push(pl.dataset.plan);
      analyze();
      adopt(pl.dataset.plan);
    }
    const pq = document.getElementById('pw-pq');
    if (pq) pq.value = '';
    render();
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
    row.k = { s: 'c', c: 'o', o: 's' }[row.k];
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
    const url = `${location.origin}${location.pathname}#${encode(state)}`;
    done((await copy(url)) ? 'Link copied.' : 'Couldn’t copy.');
  } else if (act === 'tsv') {
    const lines = [['Term', 'Level', ...Array.from({ length: SLOTS }, (_, j) => `Course ${j + 1}`)].join('\t')];
    state.rows.forEach((r, i) => lines.push([E.termName(termOf(i)), r.k === 's' ? A.lv[i] : KIND[r.k], ...(r.k === 's' ? r.c.map((c) => (c ? fmt(c) : '')) : [])].join('\t')));
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
    resequence(t.value);
    undo = null;
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
/** What a Terms choice makes: {start, kinds}. "regular", "all", or "slug:k" for a co-op sequence. */
function patternFor(value) {
  const want = Math.max(usedStudy(), value === 'all' ? 8 : regularStudy());
  const extend = (from, kinds, every) => {
    let t = from;
    for (const k of kinds) t = E.nextTerm(t);
    let n = kinds.filter((k) => k === 's').length;
    while (n < want) {
      const k = every || E.seasonOf(t) !== 'S' ? 's' : 'o';
      kinds.push(k);
      if (k === 's') n++;
      t = E.nextTerm(t);
    }
    return kinds;
  };
  if (value === 'regular' || value === 'all') return { start: state.start, kinds: extend(state.start, [], value === 'all') };
  const [slug, k] = String(value).split(':');
  const sq = bySlug.get(slug)?.seq?.[Number(k)];
  if (!sq) return null;
  // A sequence that starts in Winter (Pharmacy) starts the first Winter from your start on.
  let start = state.start;
  for (let i = 0; i < 2 && E.seasonOf(start) !== (sq.start || 'F'); i++) start = E.nextTerm(start);
  const kinds = sq.terms.map((x) => (/^\d[AB]$/.test(x) ? 's' : x === 'WT' ? 'c' : 'o'));
  // A chart that stops early (Math/Teaching after 2A) carries on as a regular degree; study terms with courses
  // past the end of a sequence are kept at the end.
  return { start, kinds: sq.cut ? extend(start, kinds, false) : [...kinds, ...extraStudy(kinds)] };
}
/** Study terms to add after a sequence so no planned courses are lost. */
function extraStudy(kinds) {
  const have = kinds.filter((k) => k === 's').length;
  return Array.from({ length: Math.max(0, usedStudy() - have) }, () => 's');
}
const trimOff = (kinds) => {
  const out = [...kinds];
  while (out.length && out.at(-1) === 'o') out.pop();
  return out.join('');
};
/** The Terms choice the grid matches now, or ''. */
function currentPattern(values) {
  const now = trimOff(state.rows.map((r) => r.k));
  return values.find((v) => {
    const p = patternFor(v);
    return p && p.start === state.start && trimOff(p.kinds) === now;
  }) ?? '';
}
/** A new pattern of terms; each study term keeps its courses in order (1A's stay in 1A). */
function resequence(value) {
  const p = patternFor(value);
  if (!p) return;
  const studies = state.rows.filter((r) => r.k === 's').map((r) => r.c);
  state.start = p.start;
  let s = 0;
  state.rows = p.kinds.map((k) => ({ k, c: k === 's' ? studies[s++] ?? [] : [] }));
  undo = null;
}
/** A co-op sequence in a few words: "Sequence 1 · 4⅓ years, 5 work terms". */
function seqLabel(slug, k) {
  const sq = bySlug.get(slug)?.seq?.[k];
  const p = patternFor(`${slug}:${k}`);
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
  if (p.co && !p.re && empty && currentPattern(['regular']) === 'regular') {
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
    const { avail } = E.evaluateAll(asPicked, have, { courses: C });
    const it = E.fillItems(p, have, { courses: C, equiv, avail: avail[k] });
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
      const again = E.fillItems(p, have, { courses: C, equiv });
      for (const w of again.words) if (w.key === 'total') addWords(w);
    });
  }
  for (const t of totals) t();
  // Electives up to the degree's total, after everything else, when the degree itself is being filled in.
  const total = plans.some((p) => p.t === 'Major' || p.t === 'Degree Requirements') ? degreeTotalOf([...A.plans, ...(extra ? [extra] : [])]) : null;
  if (total) {
    const sum = [...have.values()].reduce((t, x) => t + (x.units ?? 0.5), 0);
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
    const j = Array.from({ length: SLOTS }, (_, k) => k).find((k) => !r.c[k]);
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

// Plans: search and add.
function planSuggest(input) {
  const list = document.getElementById('pw-psugg');
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  // Names that start with what's typed first: "economics minor" is Economics Minor before Business Economics Minor.
  const q = words.join(' ');
  const rank = (p) => (p.n.toLowerCase().startsWith(q) ? 0 : p.n.toLowerCase().startsWith(words[0]) ? 1 : 2);
  // Then specializations and options open to your majors ("Finance Specialization" for Math/CPA).
  const other = (p) => (p.open?.length && !p.open.some((s) => state.plans.includes(s)) ? 1 : 0);
  const hits = words.length ? P.filter((p) => !state.plans.includes(p.s) && words.every((w) => `${p.n} ${p.t} ${p.fi}`.toLowerCase().includes(w))).sort((a, b) => rank(a) - rank(b) || other(a) - other(b) || TYPE_ORDER.indexOf(a.t) - TYPE_ORDER.indexOf(b.t) || a.n.localeCompare(b.n)).slice(0, 10) : [];
  list.innerHTML = hits.map((p, i) => `<li role="option" data-plan="${esc(p.s)}" aria-selected="${i === 0}"><b>${esc(p.n)}</b> <span>${esc(p.t)}</span></li>`).join('');
  list.hidden = !hits.length;
  input.setAttribute('aria-expanded', String(!!hits.length));
}
app.addEventListener('submit', (e) => {
  if (e.target.id !== 'pw-addplan') return;
  e.preventDefault();
  const first = document.querySelector('#pw-psugg li[data-plan]');
  if (first) {
    state.plans.push(first.dataset.plan);
    analyze();
    adopt(first.dataset.plan);
    document.getElementById('pw-pq').value = '';
    render();
    document.getElementById('pw-pq')?.focus();
  }
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
