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
const P = data.programs;
const bySlug = new Map(P.map((p) => [p.s, p]));
const cant = new Map(P.map((p) => [p.s, new Set(p.cant ?? [])]));
const equiv = new Map(Object.entries(C).filter(([, c]) => c[6]?.length).map(([k, c]) => [k, c[6]]));
const SLOTS = 7; // columns: 5 is a usual load, 6 an overload, 7 heavy
const NORMAL = 5;
const KEY = 'uwloo.pathways';
const TYPE_ORDER = ['Major', 'Minor', 'Specialization', 'Option', 'Diploma', 'Certificate', 'Degree Requirements'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (c) => String(c).replace(/^([A-Z]+)(\d)/, '$1 $2');
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
state.plans = state.plans.filter((s) => bySlug.has(s));
for (const r of state.rows) r.c = (r.c ?? []).slice(0, SLOTS);
if (hash.startsWith('add=')) {
  const s = decodeURIComponent(hash.slice(4));
  if (bySlug.has(s) && !state.plans.includes(s)) state.plans.push(s);
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
  state.rows.forEach((r, i) => {
    if (r.k !== 's') return;
    for (const code of r.c) if (code) {
      planned.set(code, { units: C[code]?.[1] ?? 0.5, row: i });
      count.set(code, (count.get(code) ?? 0) + 1);
    }
  });
  const plans = state.plans.map((s) => bySlug.get(s));
  const planCtx = plans.map((p) => ({ code: p.c, faculty: p.f, name: p.n }));
  const ticked = new Set(state.ticked);
  const evals = plans.map((p) => E.evaluate(p, planned, { ticked, courses: C }));
  const before = new Set();
  const flags = state.rows.map(() => []);
  state.rows.forEach((r, i) => {
    if (r.k !== 's') return;
    const same = new Set(r.c.filter(Boolean));
    const season = E.seasonOf(termOf(i));
    r.c.forEach((code, j) => {
      if (!code) return;
      const c = C[code];
      const issues = [];
      if (!c) issues.push(['bad', 'Not in the current calendar']);
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
      evals.forEach((ev, k) => {
        if (ev.rows.some((x) => x.kind === 'not' && x.bad.includes(code))) issues.push(['warn', `Can’t count toward ${plans[k].n}`]);
        if (ev.rows.some((x) => x.kind === 'max' && x.over && x.got.includes(code))) issues.push(['warn', `Over the limit ${plans[k].n} sets for one of its lists`]);
      });
      const dots = evals.map((ev, k) => (ev.used.has(code) ? k : -1)).filter((k) => k >= 0);
      flags[i][j] = { code, issues, dots };
    });
    for (const code of same) before.add(code);
  });
  A = { lv, planned, plans, evals, flags };
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
  const seqs = [];
  const deg = degreeFor(A.plans);
  for (const p of [...A.plans, ...(deg ? [deg] : [])]) for (const [k, sq] of (p.seq ?? []).entries()) seqs.push({ id: `${p.s}:${k}`, label: `${/^\d+$/.test(sq.label) ? `Sequence ${sq.label}` : sq.label} (${p.n.replace(/ Degree Requirements.*/, '')})` });
  return `<div class="pw-bar">
  <label>Starts <select id="pw-start">${starts.map((t) => `<option value="${t}"${t === state.start ? ' selected' : ''}>${esc(E.termName(t))}</option>`).join('')}</select></label>
  <label>Terms <select id="pw-seq"><option value="">Keep my rows</option><option value="regular">Regular: Fall and Winter, Spring off</option><option value="all">Every term</option>${seqs.map((s) => `<option value="${esc(s.id)}">Co-op ${esc(s.label)}</option>`).join('')}</select></label>
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
  const deg = degreeFor(A.plans);
  return `<div class="pw-plans"><ul>${chips}</ul>
<form class="pw-addplan" id="pw-addplan" autocomplete="off"><label class="vh" for="pw-pq">Add a plan</label><input id="pw-pq" placeholder="${A.plans.length ? 'Add a minor, option, specialization…' : 'Add your major, minors, options…'}" role="combobox" aria-expanded="false" aria-controls="pw-psugg" spellcheck="false"><ul id="pw-psugg" class="pw-sugg" role="listbox" hidden></ul></form>
${deg ? `<p class="pw-hint">Add the <button type="button" class="pw-linkbtn" data-plan="${esc(deg.s)}">${esc(deg.n)}</button> too, for the degree’s own rules.</p>` : ''}
${warns.map((w) => `<p class="pw-warn">${w}</p>`).join('')}</div>`;
}

/** Units the whole degree takes: from its degree requirements (15.0 for a three-year general BA, else the most). */
function degreeTotal() {
  const deg = A.plans.find((p) => p.t === 'Degree Requirements') ?? degreeFor(A.plans);
  const tt = deg?.tt;
  if (!tt?.length) return null;
  const major = A.plans.find((p) => p.t === 'Major');
  return /Three-Year General/i.test(major?.n ?? '') ? tt[0] : tt.at(-1);
}

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
        const worst = f?.issues.some((x) => x[0] === 'bad') ? 'bad' : f?.issues.some((x) => x[0] === 'warn') ? 'warn' : f?.issues.length ? 'check' : '';
        const dots = f?.dots.map((k) => `<i class="d${k % 8}"></i>`).join('') ?? '';
        const tip = f ? [C[code]?.[0], ...f.issues.map((x) => x[1])].filter(Boolean).join(' · ') : '';
        return `<td class="pw-c${j >= NORMAL ? ' pw-extra' : ''}${worst ? ` ${worst}` : ''}"><input class="pw-in" data-r="${i}" data-c="${j}" value="${esc(code ? fmt(code) : '')}" aria-label="${esc(`${E.termName(term)} course ${j + 1}`)}" title="${esc(tip)}" spellcheck="false" autocomplete="off">${dots ? `<span class="pw-dots" aria-hidden="true">${dots}</span>` : ''}</td>`;
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
  const counts = A.evals.map((ev, k) => (ev.used.has(code) ? `<li><i class="pw-dot d${k % 8}"></i>${esc(A.plans[k].n)}</li>` : '')).join('');
  const issues = f?.issues.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('') ?? '';
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
      fit = `<p>About <b>${plural(toPlan, 'more course')}</b> to place, <b>${extra} more</b> than fit at ${NORMAL} a term. That’s ${plural(Math.ceil(extra / NORMAL), 'extra term')}, or a 6th course in ${plural(extra, 'term')}${extra > study.length ? ' (more overloads than you have terms)' : ''}.</p>`;
    }
  }
  const unitLine = degreeUnits ? `<p>${units(plannedU)} of ${units(degreeUnits)} units planned.</p>` : `<p>${plural(plannedN, 'course')} planned, ${units(plannedU)} units.</p>`;
  const summary = `<section class="pw-box"><h2>Your degree</h2>${unitLine}<p>${plural(study.length, 'study term')}${over ? `, ${plural(over, 'with an overload', 'with overloads')}` : ''}.</p>${fit}${gaps ? `<p class="t">Counted from requirements that name courses; ones in words that the grid can’t check are ticked by hand below.</p>` : ''}</section>`;
  const checklists = A.plans.map((p, k) => checklistHtml(p, A.evals[k], k)).join('');
  return `${summary}${checklists}${directionsShell()}`;
}

function chip(code, state_) {
  return `<button type="button" class="pw-chip ${state_}" data-add="${esc(code)}" title="${esc(`${C[code]?.[0] ?? ''}${state_ === 'no' ? ' · click to add it to the grid' : ''}`)}">${esc(fmt(code))}</button>`;
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

/** "ECON 351" / "econ351" / "Econ351 - Labour…" → "ECON351", or '' */
function parseCode(text) {
  const m = /([A-Za-z]{2,8})\s*(\d{3}[A-Za-z]?)/.exec(String(text));
  return m ? `${m[1]}${m[2]}`.toUpperCase() : '';
}

function setCell(r, c, code) {
  if (pending?.r === r && pending?.c === c) pending = null;
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
  const hits = [...codes.filter((k) => k.startsWith(q)), ...(q.length > 2 ? codes.filter((k) => !k.startsWith(q) && words.every((w) => C[k][0].toLowerCase().includes(w))) : [])].slice(0, 8);
  if (!hits.length || (hits.length === 1 && hits[0] === q)) return;
  const el = document.createElement('ul');
  el.className = 'pw-sugg pw-csugg';
  el.setAttribute('role', 'listbox');
  el.innerHTML = hits.map((k, i) => `<li role="option" data-code="${k}" aria-selected="${i === 0}"><b>${esc(fmt(k))}</b> <span>${esc(C[k][0])}</span></li>`).join('');
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
  const cells = lines.map((l) => (l.includes('\t') ? l.split('\t') : [...l.matchAll(/[A-Za-z]{2,8}\s*\d{3}[A-Za-z]?/g)].map((m) => m[0])));
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
      const j = state.rows[at].c.indexOf(code);
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
    render();
    return;
  }
  const pl = t.closest('[data-plan]');
  if (pl) {
    if (!state.plans.includes(pl.dataset.plan)) state.plans.push(pl.dataset.plan);
    const pq = document.getElementById('pw-pq');
    if (pq) pq.value = '';
    render();
    return;
  }
  const kindBtn = t.closest('[data-kind]');
  if (kindBtn) {
    const row = state.rows[Number(kindBtn.dataset.kind)];
    row.k = { s: 'c', c: 'o', o: 's' }[row.k];
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
  if (act === 'addrow') {
    state.rows.push({ k: 's', c: [] });
    render();
  } else if (act === 'droprow') {
    state.rows.pop();
    render();
  } else if (act === 'reset') {
    const plans = state.plans;
    state = blank();
    state.plans = plans;
    selected = null;
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
app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'pw-start') {
    state.start = t.value;
    render();
  } else if (t.id === 'pw-seq' && t.value) {
    resequence(t.value);
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

/** A new pattern of terms; each study term keeps its courses in order. */
function resequence(value) {
  const studies = state.rows.filter((r) => r.k === 's').map((r) => r.c);
  let kinds;
  if (value === 'regular' || value === 'all') {
    kinds = [];
    let t = state.start;
    let n = 0;
    while (n < Math.max(8, studies.length)) {
      const k = value === 'all' || E.seasonOf(t) !== 'S' ? 's' : 'o';
      kinds.push(k);
      if (k === 's') n++;
      t = E.nextTerm(t);
    }
  } else {
    const [slug, k] = value.split(':');
    const sq = bySlug.get(slug)?.seq?.[Number(k)];
    if (!sq) return;
    kinds = sq.terms.map((x) => (/^\d[AB]$/.test(x) ? 's' : x === 'WT' ? 'c' : 'o'));
    const lead = { F: '9', W: '1', S: '5' }[sq.start] ?? '9';
    if (!state.start.endsWith(lead)) state.start = `${state.start.slice(0, 3)}${lead}`;
    let extra = studies.length - kinds.filter((x) => x === 's').length;
    while (extra-- > 0) kinds.push('s');
  }
  let s = 0;
  state.rows = kinds.map((k) => ({ k, c: k === 's' ? studies[s++] ?? [] : [] }));
}

// Plans: search and add.
function planSuggest(input) {
  const list = document.getElementById('pw-psugg');
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? P.filter((p) => !state.plans.includes(p.s) && words.every((w) => `${p.n} ${p.t} ${p.fi}`.toLowerCase().includes(w))).sort((a, b) => TYPE_ORDER.indexOf(a.t) - TYPE_ORDER.indexOf(b.t) || a.n.localeCompare(b.n)).slice(0, 10) : [];
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

render();
