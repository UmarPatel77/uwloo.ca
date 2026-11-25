// uwloo.ca/pathways: the rules, with no DOM, so the build's tests can run them too.
//
// Requirement trees (programs) and requisite trees (courses) share one compact shape, written by
// scripts/lib/pathways.mjs from the calendar's rules:
//   {g: 'all'|'n', n, i: [nodes]}                       a group ("Complete 1 of the following")
//   {r: 'all'|'n'|'any'|'max'|'not'|'list', n, c: [codes]} a rule over listed courses
//   {t: text, lv, en, u, nc, subj, rg, min, pl, fa}     words: a level ("3A"), a plan to be enrolled in, or units
//                                                        or courses from the section's lists, subjects or faculties
// A program's requirements are sections: {h: heading, u: units, r: [nodes], l: [sections]}.
// A course is [title, units, prereq, coreq, antireq codes, [Fall, Winter, Spring] terms run lately, cross-listed,
// gone]: gone is 1 when it isn't in the current calendar.

export const UNIT = 0.5; // a usual course, for turning units into a number of courses

// ---------------- placeholders ----------------

// A cell can hold a placeholder for a course not picked yet: "PMATH4XX" is a PMATH course at the 400 level,
// "ECONXXX" an ECON course at any level, "ELECTIVE" any course. They count toward requirements in words
// ("3 PMATH courses at the 400-level"; an elective toward ones the grid can't check by subject, like "from the
// Faculty of Arts"), never toward a course named by its code. In a Map of planned courses the second and
// later copies of one are keyed "PMATH4XX#2", "PMATH4XX#3"…
export const isPlaceholder = (code) => /^[A-Z]{2,8}(?:\dXX|XXX)$/.test(code) || code === 'ELECTIVE';
export const baseCode = (key) => String(key).replace(/#\d+$/, '');
/** Adds a placeholder (or a course) to a Map of planned courses under a free key. */
export function addPlanned(map, code, value = { units: UNIT }) {
  let key = code;
  for (let n = 2; isPlaceholder(code) && map.has(key); n++) key = `${code}#${n}`;
  map.set(key, value);
  return key;
}
/** Subject and number: ECON101 → [ECON, 101]; PMATH4XX → [PMATH, 450] (some 400-level course); ECONXXX → [ECON, null]. */
function numbered(key) {
  const c = baseCode(key);
  const m = /^([A-Z]+)(\d)(\d\d|XX)/.exec(c) ?? /^([A-Z]+)(X)(XX)$/.exec(c);
  if (!m) return null;
  if (m[2] === 'X') return [m[1], null];
  return [m[1], m[3] === 'XX' ? Number(m[2]) * 100 + 50 : Number(m[2] + m[3])];
}
/** A course's (or placeholder's) year: 1 for 100-level…; electives and any-level placeholders fit any year. */
export const yearOf = (code) => {
  const n = numbered(code);
  return n?.[1] != null ? Math.floor(n[1] / 100) : 1;
};

// ---------------- terms and levels ----------------

const SEASON = { 1: 'Winter', 5: 'Spring', 9: 'Fall' };
export const seasonOf = (term) => ({ 1: 'W', 5: 'S', 9: 'F' })[String(term).slice(-1)];
export const termName = (term) => `${SEASON[String(term).slice(-1)]} ${1900 + Number(String(term).slice(0, 3))}`;
export const nextTerm = (term) => {
  const y = Number(String(term).slice(0, 3));
  const s = Number(String(term).slice(-1));
  return s === 9 ? `${y + 1}1` : `${y}${s + 4}`;
};

/** Rows [{kind: 'study'|'coop'|'off'}] → each study row's level: 1A, 1B, 2A, … 4B, 5A… */
export function levels(rows) {
  let n = 0;
  return rows.map((r) => {
    if (r.kind !== 'study') return null;
    const l = `${Math.floor(n / 2) + 1}${n % 2 ? 'B' : 'A'}`;
    n++;
    return l;
  });
}
const levelRank = (l) => (l ? (Number(l.slice(0, -1)) - 1) * 2 + (l.endsWith('B') ? 1 : 0) : -1);

// ---------------- requisites ----------------

/**
 * Does a requisite tree hold? → true, false, or null (can't tell: "Enrolled in…" with no matching plan, or words).
 * have: codes counted as done (earlier terms; for corequisites, this term too). ctx: {level, plans, equiv}.
 */
export function holds(nodes, have, ctx = {}) {
  if (!nodes?.length) return true;
  return all(nodes.map((n) => holdsNode(n, have, ctx)));
}
const all = (vals) => (vals.includes(false) ? false : vals.includes(null) ? null : true);
const atLeast = (vals, n) => {
  const yes = vals.filter((v) => v === true).length;
  if (yes >= n) return true;
  return yes + vals.filter((v) => v === null).length >= n ? null : false;
};
const has = (have, code, ctx) => have.has(code) || (ctx.equiv?.get(code) ?? []).some((c) => have.has(c));
const lowGrade = (n, code, ctx) => Boolean(n.mg && ctx.grades?.has(code) && ctx.grades.get(code) < n.mg);

function holdsNode(n, have, ctx) {
  if (n.g) {
    const vals = n.i.map((c) => holdsNode(c, have, ctx));
    return n.g === 'n' ? atLeast(vals, n.n ?? 1) : all(vals);
  }
  if (n.r) {
    // "Earned a minimum grade of 60% in CS136": a grade below that doesn't count (no grade yet: assume it will).
    const hits = n.c.filter((c) => has(have, c, ctx) && !lowGrade(n, c, ctx)).length;
    if (n.r === 'all') return hits === n.c.length;
    if (n.r === 'n') return hits >= (n.n ?? 1);
    if (n.r === 'not') return hits === 0;
    return true; // any, max, list: nothing to fail
  }
  if (n.lv) return ctx.level ? levelRank(ctx.level) >= levelRank(n.lv) : null;
  if (n.en) return enrolled(n.en, ctx.plans ?? []);
  return null;
}

/** "Enrolled in H-Software Engineering" / "an Honours Mathematics program" against the plans someone picked. */
export function enrolled(text, plans) {
  if (!plans.length) return null;
  const t = text.toLowerCase();
  if (plans.some((p) => p.code && t.includes(p.code.toLowerCase()))) return true;
  const m = /\b(honours|joint honours)?\s*([a-z ]+?)\s+(program|plan|major|degree)s?\b/.exec(t.replace(/^an?\s+/, ''));
  if (m) {
    const word = m[2].trim();
    const faculty = plans.find((p) => (p.faculty ?? '').toLowerCase().includes(word) || (p.name ?? '').toLowerCase().includes(word));
    if (faculty && (!m[1] || /^(h|jh)-/i.test(faculty.code ?? ''))) return true;
  }
  return null;
}

/** Courses an antirequisite tree rules out. */
export const antiCodes = (nodes) => (Array.isArray(nodes) ? nodes : []).flatMap((n) => (n.g ? antiCodes(n.i) : n.r ? n.c : []));

/** Courses a requisite tree names that aren't done: what to add first. */
export const missing = (nodes, have, ctx = {}) => why(nodes, have, ctx).codes;

/** Why a requisite tree fails: {codes: courses to add, level: 'nX' needed, plans: ["H-Software Engineering"…]}. */
export function why(nodes, have, ctx = {}) {
  const codes = new Set();
  const groups = [];
  const low = [];
  let level = null;
  const plans = new Set();
  const walk = (list) => {
    for (const n of list ?? []) {
      if (holdsNode(n, have, ctx) !== false) continue;
      if (n.g) walk(n.i);
      else if (n.r && n.r !== 'not') {
        // Each unmet list on its own: "one of MATH 128, 138, 148" and "one of MATH 136, 146" are both needed.
        const miss = n.c.filter((c) => !has(have, c, ctx) || lowGrade(n, c, ctx));
        for (const c of miss) codes.add(c);
        if (miss.length) groups.push(n.r === 'all' ? miss.map((c) => [c]) : [miss]);
        for (const c of miss) if (lowGrade(n, c, ctx)) low.push({ code: c, need: n.mg, got: ctx.grades.get(c) });
      }
      if (n.lv && (!level || levelRank(n.lv) > levelRank(level))) level = n.lv;
      if (n.en) plans.add(n.en);
    }
  };
  walk(nodes);
  return { codes: [...codes], groups: groups.flat(), level, plans: [...plans], ...(low.length ? { low } : {}) };
}

// ---------------- programs ----------------

/**
 * How far a set of courses gets through a program. planned: Map code → {units}. ticked: Set of keys the person
 * marked done by hand (for requirements in words). → {need, have, rows: [...], used: Set, unknown}
 * need and have count courses (units ÷ 0.5); rows describe every requirement for the checklist; unknown is
 * true while a requirement in words isn't ticked (those aren't in need: they may not be a course).
 */
export function evaluate(program, planned, { ticked = new Set(), courses = {}, faculty = {} } = {}) {
  const used = new Set();
  const rows = [];
  // Trying a group's children one by one mustn't write rows: quiet > 0 while trying.
  let quiet = 0;
  const emit = (row) => {
    if (quiet) return -1;
    rows.push(row);
    return rows.length - 1;
  };
  const set = (at, need, have) => {
    if (at >= 0) Object.assign(rows[at], { need, have });
  };
  const unitsOf = (c) => courses[c]?.[1] ?? planned.get(c)?.units ?? UNIT;
  const take = (codes, limit = Infinity) => {
    const got = [];
    for (const c of codes) {
      if (got.length >= limit) break;
      if (planned.has(c) && !used.has(c)) got.push(c);
    }
    return got;
  };
  // overlay: a rule that only checks a total ("8.0 units at the 200-level or above") counts courses other rules
  // use, and uses none. perSubject: at most that many units from one subject ("no more than 1.0 unit in the
  // same discipline").
  const takeUnits = (codes, units, { overlay = false, perSubject = null } = {}) => {
    const got = [];
    let sum = 0;
    const bySubj = new Map();
    for (const c of codes) {
      if (sum >= units - 1e-9) break;
      if (!planned.has(c) || (!overlay && used.has(c))) continue;
      const subj = numbered(c)?.[0];
      if (perSubject && (bySubj.get(subj) ?? 0) + unitsOf(c) > perSubject + 1e-9) continue;
      bySubj.set(subj, (bySubj.get(subj) ?? 0) + unitsOf(c));
      got.push(c);
      sum += unitsOf(c);
    }
    return { got, sum };
  };
  // Any subject at a level, or courses from outside a faculty ("also any course taken in another faculty"). PD
  // courses, work-term reports and work terms give no academic credit, so they're in neither.
  const anyPool = (n) =>
    [...planned.keys()].filter((c) => {
      const num = numbered(c)?.[1];
      return !WORK_COURSE.test(c) && (!n.min || (num != null && num >= n.min * 100));
    });
  const otherFaculty = (fac) => [...planned.keys()].filter((c) => {
    const f = faculty[numbered(c)?.[0]];
    return f && f !== fac && !WORK_COURSE.test(c);
  });
  const subjectPool = (n) =>
    [...planned.keys()].filter((c) => {
      const m = numbered(c);
      if (!m) return false;
      const [subj, num] = m;
      if (n.rg) return num != null && n.rg.some(([s, lo, hi]) => s === subj && num >= lo && num <= hi);
      return n.subj.includes(subj) && (!n.min || (num != null && num >= n.min * 100));
    });
  const electives = () => [...planned.keys()].filter((c) => baseCode(c) === 'ELECTIVE');

  // One requirement node → {need, have, got, unknown}. Groups take their best children.
  const node = (n, key, depth, pool) => {
    if (n.g) {
      const kids = n.i.map((c, j) => ({ c, j }));
      if (n.g === 'n') {
        // Try each child on a copy, keep the n that are furthest along.
        quiet++;
        const trial = kids.map(({ c, j }) => {
          const saved = new Set(used);
          const r = node(c, `${key}.${j}`, depth + 1, pool);
          used.clear();
          for (const u of saved) used.add(u);
          return { c, j, r, gap: r.need - r.have };
        });
        quiet--;
        const pick = trial.sort((a, b) => a.gap - b.gap || b.r.have - a.r.have).slice(0, n.n ?? 1);
        let need = 0;
        let have = 0;
        let unknown = false;
        const at = emit({ key, depth, kind: 'group', text: `${n.n ?? 1} of the following` });
        for (const { c, j } of pick.sort((a, b) => a.j - b.j)) {
          const r = node(c, `${key}.${j}`, depth + 1, pool);
          need += r.need;
          have += r.have;
          unknown ||= r.unknown;
        }
        set(at, need, have);
        return { need, have, unknown };
      }
      const at = emit({ key, depth, kind: 'group', text: 'All of the following' });
      let need = 0;
      let have = 0;
      let unknown = false;
      for (const { c, j } of kids) {
        const r = node(c, `${key}.${j}`, depth + 1, pool);
        need += r.need;
        have += r.have;
        unknown ||= r.unknown;
      }
      set(at, need, have);
      return { need, have, unknown };
    }
    if (n.r) {
      if (n.r === 'all' || n.r === 'n') {
        const want = n.r === 'all' ? n.c.length : Math.max(1, Math.round(n.n ?? 1));
        const got = take(n.c, want);
        for (const c of got) used.add(c);
        emit({ key, depth, kind: n.r, want, got, codes: n.c, n: n.n });
        return { need: want, have: got.length, unknown: false };
      }
      if (n.r === 'not') {
        const bad = n.c.filter((c) => planned.has(c));
        emit({ key, depth, kind: 'not', codes: n.c, bad });
        return { need: 0, have: 0, unknown: false };
      }
      if (n.r === 'max') {
        const in_ = n.c.filter((c) => planned.has(c));
        emit({ key, depth, kind: 'max', codes: n.c, n: n.n, got: in_, over: in_.length > (n.n ?? Infinity) });
        return { need: 0, have: 0, unknown: false };
      }
      // any / list: the codes others draw on (a quantity in words picks from them).
      emit({ key, depth, kind: 'list', codes: n.c, got: n.c.filter((c) => planned.has(c)) });
      return { need: 0, have: 0, unknown: false };
    }
    // Words.
    if (n.info) {
      emit({ key, depth, kind: 'info', text: n.t });
      return { need: 0, have: 0, unknown: false };
    }
    if (n.u || n.nc) {
      let codes = n.any ? anyPool(n) : n.subj || n.rg ? subjectPool(n) : n.pl ? pool : null;
      if (n.of) codes = [...new Set([...(codes ?? []), ...otherFaculty(n.of)])];
      if (codes && (n.no || n.nos)) codes = codes.filter((c) => !(n.no ?? []).includes(baseCode(c)) && !(n.nos ?? []).includes(numbered(c)?.[0]));
      // Elective placeholders stand in for what the grid can't check by subject: "from the Faculty of Arts",
      // "approved electives", "from List 1". They go last, after real courses.
      if (n.fa || !(n.subj || n.rg)) {
        const w = electives();
        if (w.length) codes = [...(codes ?? []), ...w];
      }
      if (codes?.length || n.subj || n.rg || n.any) {
        if (n.u) {
          const { got, sum } = takeUnits(codes ?? [], n.u, { overlay: n.ov, perSubject: n.ms });
          if (!n.ov) for (const c of got) used.add(c);
          emit({ key, depth, kind: 'units', text: n.t, units: n.u, sum, got });
          return { need: Math.round(n.u / UNIT), have: Math.min(Math.round(n.u / UNIT), Math.round(sum / UNIT)), unknown: false };
        }
        const got = take(codes, n.nc);
        for (const c of got) used.add(c);
        emit({ key, depth, kind: 'count', text: n.t, want: n.nc, got });
        return { need: n.nc, have: got.length, unknown: false };
      }
    }
    // Words the grid can't check: ticked by hand, and not counted as courses.
    const done = ticked.has(`${program.s}:${key}`);
    emit({ key, depth, kind: 'text', text: n.t, done, tick: `${program.s}:${key}` });
    return { need: 0, have: 0, unknown: !done };
  };

  let need = 0;
  let have = 0;
  let unknown = false;
  const section = (s, key, depth) => {
    if (s.skip) return { need: 0, have: 0, unknown: false };
    const at = emit({ key, depth, kind: 'heading', text: s.h, units: s.u });
    // A section's lists ("Choose any of the following", List 1, List 2…) are what its words draw from.
    const pool = [];
    const gather = (sec) => {
      const walk = (ns) => {
        for (const x of ns ?? []) {
          if (x.r === 'any' || x.r === 'list') pool.push(...x.c);
          if (x.g) walk(x.i);
        }
      };
      walk(sec.r);
      for (const l of sec.l ?? []) gather(l);
    };
    gather(s);
    let sNeed = 0;
    let sHave = 0;
    // Required courses first, so a course counts where it must before it fills an elective.
    const order = (s.r ?? []).map((n, j) => ({ n, j })).sort((a, b) => rank(a.n) - rank(b.n));
    for (const { n, j } of order) {
      const r = node(n, `${key}.${j}`, depth + 1, pool);
      sNeed += r.need;
      sHave += r.have;
      unknown ||= r.unknown;
    }
    for (const [j, l] of (s.l ?? []).entries()) {
      const r = section(l, `${key}.l${j}`, depth + 1);
      sNeed += r.need;
      sHave += r.have;
    }
    set(at, sNeed, sHave);
    return { need: sNeed, have: sHave };
  };
  for (const [j, s] of (program.req ?? []).entries()) {
    const r = section(s, `s${j}`, 0);
    need += r.need;
    have += r.have;
  }
  // The program's total: "4.0 units of GSJ courses" can be counted; "4.0 units" alone only sets the size.
  if (program.tsub) {
    const subj = program.tsub.subj;
    const got = [...planned.keys()].filter((c) => subj.includes(numbered(c)?.[0]));
    const sum = got.reduce((s, c) => s + unitsOf(c), 0);
    emit({ key: 'total', depth: 0, kind: 'units', text: `A total of ${program.tsub.u} units of ${subj.join(', ')} courses`, units: program.tsub.u, sum, got });
    const tn = Math.round(program.tsub.u / UNIT);
    if (tn > need) {
      have = Math.max(have, Math.min(tn, Math.round(sum / UNIT)));
      need = tn;
    }
  } else if (program.tu && Math.round(program.tu / UNIT) > need) {
    const tn = Math.round(program.tu / UNIT);
    // A total of 15.0 units or more is the whole degree's ("Complete a total of 20.0 units"): any other planned
    // course counts toward what the named requirements leave, as an elective. It isn't a use of the course.
    if (program.tu >= DEGREE_UNITS) {
      const got = [...planned.keys()].filter((c) => !used.has(c)).slice(0, tn - need);
      emit({ key: 'total', depth: 0, kind: 'count', text: `Electives and other courses, for ${program.tu.toFixed(1)} units in all`, want: tn - need, got, free: true });
      have += got.length;
    }
    need = tn;
  }
  return { need, have, rows, used, unknown };
}
/**
 * A program as it applies next to the plans someone picked: a section that names exceptions ("with the
 * exceptions of Mathematical Studies and Mathematics/Chartered Professional Accountancy") becomes a note for
 * students in one of those majors. Sections keep their places, so ticked keys stay put.
 */
export function forPlans(program, plans) {
  const has = (secs) => (secs ?? []).some((s) => s.ex || s.only || has(s.l));
  if (!has(program.req)) return program;
  const majors = plans.filter((p) => p.t === 'Major');
  const key = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sameMajor = (p, name) => [p.fi, p.n.replace(/\s*\(.*$/, '')].some((x) => key(x) === key(name));
  // A section for some majors only: by kind of degree, by major, or for "all other" majors.
  const fits = (only) =>
    majors.some((p) => (!only.type || degreeType(p.n) === only.type) && (!only.major || sameMajor(p, only.major)) && !(only.other ?? []).some((nm) => sameMajor(p, nm)));
  const names = plans.filter((p) => p.t === 'Major').flatMap((p) => [p.fi, p.n.replace(/\s*\(.*$/, '')]).filter(Boolean);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const exempt = (ex) => names.find((nm) => new RegExp(`(?:^|,\\s*|\\s+and\\s+|\\s+or\\s+)${esc(nm)}(?=$|,|\\s+and\\s+|\\s+or\\s+)`, 'i').test(ex));
  let changed = false;
  const keep = (secs) =>
    (secs ?? []).map((s) => {
      if (s.only) {
        changed = true;
        if (!fits(s.only)) return { ...s, skip: 1 };
      }
      const who = s.ex && exempt(s.ex);
      if (who) changed = true;
      return who ? { h: s.h, r: [{ t: `Not required for ${who} students.`, info: 1 }], l: [] } : { ...s, l: keep(s.l) };
    });
  const req = keep(program.req);
  return changed ? { ...program, req } : program;
}

/** "Mathematics (Bachelor of Mathematics, Three-Year General)" → 'Three-Year General'; honours otherwise. */
export const degreeType = (name) => (/Three-Year General/i.test(name) ? 'Three-Year General' : /Four-Year General/i.test(name) ? 'Four-Year General' : 'Honours');

const DEGREE_UNITS = 15; // a three-year degree; a program total this big is the degree's
const rank = (n) => (n.r === 'all' ? 0 : n.g ? 1 : n.r === 'n' ? 2 : n.r === 'not' || n.r === 'max' ? 4 : n.t ? 3 : 5);

const PRIORITY = { Major: 0, Specialization: 1, Option: 2, Minor: 3, Diploma: 4, Certificate: 5 };

/**
 * Every plan's progress under the calendar's Counting of Courses rule: "A course used to meet the requirements
 * of an academic plan … may be counted toward a maximum of two academic plans", and one required by both a
 * major and a specialization is a single use. Plans take courses in order: majors, specializations, options,
 * minors, diplomas, certificates, then the order they were picked. Degree requirements aren't an academic plan,
 * so they always count. → {evals (in the plans' order), avail: the Map each plan was counted with,
 * capped: Map course → names of the plans it couldn't count toward}
 */
export function evaluateAll(plans, planned, opts = {}) {
  const evals = new Array(plans.length);
  const avail = new Array(plans.length);
  const uses = new Map();
  const capped = new Map();
  const order = plans.map((p, k) => ({ p, k })).sort((a, b) => (PRIORITY[a.p.t] ?? 9) - (PRIORITY[b.p.t] ?? 9) || a.k - b.k);
  for (const { p, k } of order) {
    const counted = p.t !== 'Degree Requirements';
    const spec = p.t === 'Specialization';
    const free = (c) => {
      const u = uses.get(c);
      return !u || u.n - (spec && u.major ? 1 : 0) < 2;
    };
    const mine = counted ? new Map([...planned].filter(([c]) => free(c))) : planned;
    const ev = evaluate(p, mine, opts);
    evals[k] = ev;
    avail[k] = mine;
    if (!counted) continue;
    for (const c of ev.used) {
      const u = uses.get(c) ?? { n: 0, major: false };
      if (!(spec && u.major)) u.n++;
      if (p.t === 'Major') u.major = true;
      uses.set(c, u);
    }
    if (mine.size < planned.size) {
      for (const c of evaluate(p, planned, opts).used) if (!mine.has(c)) capped.set(c, [...(capped.get(c) ?? []), p.n]);
    }
  }
  return { evals, avail, capped };
}

// ---------------- what a requirement draws from ----------------

const nodeCodes = (n) => (n.r && n.r !== 'not' ? n.c : n.i ? n.i.flatMap(nodeCodes) : []);
const sectionCodes = (s) => [...(s.r ?? []).flatMap(nodeCodes), ...(s.l ?? []).flatMap(sectionCodes)];
// A section's own lists ("Choose any of the following", "At most 2 of"), not the courses it requires.
const listy = (n) => (n.r === 'any' || n.r === 'list' || n.r === 'max' ? n.c : n.g ? n.i.flatMap(listy) : []);
/**
 * The courses a requirement in words draws from: "from List 1" (or "Lists 1 and 2") is those lists, wherever
 * they are in the program; "from the lists below" or "Technical Electives" is its own section's lists.
 */
function listPool(program, sec, text) {
  const names = [...String(text ?? '').matchAll(/\bLists?\s+([A-Z0-9]{1,3}(?:(?:,\s*|\s+(?:and|or)\s+)[A-Z0-9]{1,3}\b)*)/g)].flatMap((m) => m[1].split(/,\s*|\s+(?:and|or)\s+/)).map((x) => `list ${x.toLowerCase()}`);
  if (names.length) {
    const found = [];
    const walk = (secs) => {
      for (const x of secs ?? []) {
        const h = String(x.h ?? '').toLowerCase().trim();
        if (names.some((nm) => h === nm || h.startsWith(`${nm}:`) || h.startsWith(`${nm} `))) found.push(...sectionCodes(x));
        else walk(x.l);
      }
    };
    walk(program.req);
    if (found.length) return found;
  }
  // "Complete 1 approved elective" in a term's section isn't one of that term's required courses.
  return [...(sec.r ?? []).flatMap(listy), ...(sec.l ?? []).flatMap(sectionCodes)];
}
/** Catalog courses a requirement in words fits: subjects ("ECON courses at the 300-level"), or ranges. */
function fitting(n, courses) {
  return Object.keys(courses)
    .filter((c) => {
      if (courses[c][7]) return false;
      const [subj, num] = numbered(c) ?? [];
      if (n.rg) return n.rg.some(([s, lo, hi]) => s === subj && num >= lo && num <= hi);
      return n.subj.includes(subj) && (!n.min || num >= n.min * 100);
    })
    .sort((a, b) => numbered(a)[1] - numbered(b)[1] || a.localeCompare(b));
}
const recent = (x) => Boolean(x && !x[7] && x[5]?.[0] + x[5]?.[1] + x[5]?.[2]);

/**
 * What could still meet each of a program's open requirements, for finding electives: [{key, where, label,
 * left, codes, kind}]. where: the headings it's under ("Technical Electives List › List 1"); left: courses
 * still needed; codes: courses not planned yet that would count, from the list itself or, for words, every
 * course that fits ("2 ECON courses at the 300-level") or the lists it names ("from List 1"). Courses the
 * program says can't count are left out. kind: 'required', 'choice' or 'words'.
 */
export function pools(program, planned, { courses = {}, equiv, avail = planned, faculty = {} } = {}) {
  const ev = evaluate(program, avail, { courses, faculty });
  const row = new Map(ev.rows.map((r) => [r.key, r]));
  const inPlan = (c) => planned.has(c) || (equiv?.get(c) ?? []).some((x) => planned.has(x));
  const never = new Set();
  const nots = (ns) => {
    for (const n of ns ?? []) {
      if (n.r === 'not') for (const c of n.c) never.add(c);
      if (n.i) nots(n.i);
    }
  };
  const notSec = (x) => {
    nots(x.r);
    for (const l of x.l ?? []) notSec(l);
  };
  for (const x of program.req ?? []) notSec(x);
  const out = [];
  const push = (key, where, label, left, codes, kind) => {
    const list = [...new Set(codes)].filter((c) => !inPlan(c) && !never.has(c));
    if (list.length && left > 0) out.push({ key, where, label, left, codes: list, kind });
  };
  const leftOf = (r, n) => {
    if (!r) return n.nc ?? Math.round((n.u ?? 0) / UNIT);
    if (r.kind === 'count') return r.want - r.got.length;
    if (r.kind === 'units') return Math.ceil((r.units - r.sum) / UNIT - 1e-9);
    return r.done ? 0 : n.nc ?? Math.round((n.u ?? 0) / UNIT);
  };
  const node = (n, key, where, sec) => {
    if (n.g === 'all') return n.i.forEach((c, j) => node(c, `${key}.${j}`, where, sec));
    if (n.g === 'n') {
      const r = row.get(key);
      if (!(r && r.need && r.have >= r.need)) push(key, where, `${n.n ?? 1} of these options`, n.n ?? 1, n.i.flatMap(nodeCodes), 'choice');
      return;
    }
    if (n.r === 'all') {
      const got = row.get(key)?.got ?? [];
      const missing = n.c.filter((c) => !got.includes(c));
      return push(key, where, n.c.length > 1 ? 'All of these' : 'Required', missing.length, missing, 'required');
    }
    if (n.r === 'n') {
      const want = Math.max(1, Math.round(n.n ?? 1));
      const r = row.get(key);
      return push(key, where, `${want} of these`, want - (r ? r.got.length : n.c.filter(inPlan).length), n.c, 'choice');
    }
    if (n.r || n.info || n.ov || !(n.u || n.nc)) return;
    const k = leftOf(row.get(key), n);
    if (n.subj || n.rg) push(key, where, n.t, k, fitting(n, courses).filter((c) => !(n.no ?? []).includes(c) && !(n.nos ?? []).includes(numbered(c)?.[0])), 'words');
    else if (n.pl) push(key, where, n.t, k, listPool(program, sec, n.t), 'words');
  };
  const section = (x, key, path) => {
    if (x.skip) return;
    const where = [...path, x.h].filter(Boolean);
    (x.r ?? []).forEach((n, j) => node(n, `${key}.${j}`, where.join(' › '), x));
    (x.l ?? []).forEach((l, j) => section(l, `${key}.l${j}`, where));
  };
  (program.req ?? []).forEach((x, j) => section(x, `s${j}`, []));
  return out;
}

// ---------------- filling in a plan ----------------

/**
 * What filling in a program would add, given what's planned (and avail: the courses that can still count
 * toward it, from evaluateAll). Requirements already met are left out.
 * → {must: [{code, at}], picks: [{key, n, options, at}], words: [{key, count, ph, text, at, cands}]}
 *   must: a course it requires by name; at: '2B' when a term-by-term program gives the term.
 *   picks: n of the options, each {codes: [...]} (one course, or a few that go together) or {ph, count, text}.
 *   words: courses described in words, as placeholders (ph) until picked from cands, the courses that fit.
 */
export function fillItems(program, planned, { courses = {}, equiv, avail = planned, faculty = {} } = {}) {
  const ev = evaluate(program, avail, { courses, faculty });
  const row = new Map(ev.rows.map((r) => [r.key, r]));
  const out = { must: [], picks: [], words: [] };
  const inPlan = (c) => planned.has(c) || (equiv?.get(c) ?? []).some((x) => planned.has(x));
  const seen = new Set();
  // The subject a placeholder uses when words allow several: the one the program names most.
  const named = new Map();
  const count = (ns) => {
    for (const n of ns ?? []) {
      if (n.c) for (const c of n.c) named.set(numbered(c)?.[0], (named.get(numbered(c)?.[0]) ?? 0) + 1);
      if (n.i) count(n.i);
    }
  };
  const countSec = (s) => {
    count(s.r);
    for (const l of s.l ?? []) countSec(l);
  };
  for (const s of program.req ?? []) countSec(s);
  const phFor = (n) => {
    // Many subjects to choose from (a breadth requirement): an elective, not the first subject's placeholder.
    if (n.fa || !(n.subj || n.rg) || (n.subj?.length > 3 && !n.subj.some((x) => named.get(x)))) return 'ELECTIVE';
    if (n.rg) return `${n.rg[0][0]}${Math.floor(Math.min(...n.rg.map((r) => r[1])) / 100)}XX`;
    const subj = [...n.subj].sort((a, b) => (named.get(b) ?? 0) - (named.get(a) ?? 0) || n.subj.indexOf(a) - n.subj.indexOf(b))[0];
    return `${subj}${n.min ? `${n.min}XX` : 'XXX'}`;
  };
  // Courses to pick from instead of a placeholder: those that fit its subjects, or the lists it draws from.
  const cands = (n, sec) => {
    if (n.fa && !n.pl) return [];
    const from = n.subj || n.rg ? fitting(n, courses) : n.pl ? [...new Set(listPool(program, sec, n.t))] : [];
    return from.filter((c) => recent(courses[c]) && !inPlan(c));
  };
  const left = (r, n) => {
    if (!r) return n.nc ?? Math.round((n.u ?? 0) / UNIT);
    if (r.kind === 'count') return r.want - r.got.length;
    if (r.kind === 'units') return Math.ceil((r.units - r.sum) / UNIT - 1e-9);
    return r.done ? 0 : n.nc ?? Math.round((n.u ?? 0) / UNIT);
  };
  // One choice's options.
  const optionsOf = (n) => {
    if (n.r === 'all') return [{ codes: n.c }];
    if (n.r === 'n' && (n.n ?? 1) === 1) return n.c.map((c) => ({ codes: [c] }));
    if (n.r === 'list' || n.r === 'any') return n.c.map((c) => ({ codes: [c] }));
    if (n.g === 'n' && (n.n ?? 1) === 1) return n.i.flatMap(optionsOf);
    if (n.g === 'all' && n.i.every((x) => x.r === 'all')) return [{ codes: n.i.flatMap((x) => x.c) }];
    if (!n.r && !n.g && (n.u || n.nc) && !n.info) return [{ ph: phFor(n), count: n.nc ?? Math.round(n.u / UNIT), text: n.t }];
    return [];
  };
  const must = (c, at) => {
    if (inPlan(c) || seen.has(c)) return;
    seen.add(c);
    out.must.push({ code: c, at });
  };
  // A section's words like "Complete a total of 6 Technical Electives" sum up its lists; only what the lists
  // don't already ask for is extra.
  const listed = (s) => (s.l ?? []).reduce((sum, l) => sum + (l.r ?? []).reduce((t, n) => t + (n.r === 'n' ? n.n ?? 1 : n.r === 'all' ? n.c.length : 0), 0) + listed(l), 0);
  const node = (n, key, at, sec) => {
    if (n.g === 'all') return n.i.forEach((c, j) => node(c, `${key}.${j}`, at, sec));
    if (n.g === 'n') {
      const r = row.get(key);
      if (r && r.need && r.have >= r.need) return;
      const options = optionsOf({ ...n, n: 1 });
      if (!options.length) return;
      const done = options.filter((o) => o.codes?.every(inPlan)).length;
      if (done >= (n.n ?? 1)) return;
      out.picks.push({ key, n: (n.n ?? 1) - done, options: options.filter((o) => !o.codes?.every(inPlan)), at });
      return;
    }
    if (n.r === 'all') return n.c.forEach((c) => must(c, at));
    if (n.r === 'n') {
      const want = Math.max(1, Math.round(n.n ?? 1));
      // Counted from what can still count toward this program (a course already counted toward two other
      // plans doesn't), so another course from the list can take its place.
      const r = row.get(key);
      const got = r ? r.got.length : n.c.filter(inPlan).length;
      if (got >= want) return;
      if (want >= n.c.length) return n.c.forEach((c) => must(c, at));
      out.picks.push({ key, n: want - got, options: n.c.filter((c) => !inPlan(c)).map((c) => ({ codes: [c] })), at });
      return;
    }
    // A total over other courses ("8.0 units at the 200-level or above") isn't more courses to add.
    if (n.r || n.info || n.ov || !(n.u || n.nc)) return;
    let k = left(row.get(key), n);
    if (n.pl && !(n.subj || n.rg) && !at) k -= listed(sec);
    // "No more than 1.0 unit in the same discipline": placeholders take turns among its subjects.
    const phs = n.ms && n.subj?.length > 1 && n.subj.length <= 6 ? Array.from({ length: k }, (_, i) => `${n.subj[Math.floor((i * UNIT) / n.ms) % n.subj.length]}${n.min ? `${n.min}XX` : 'XXX'}`) : null;
    if (k > 0) out.words.push({ key, count: k, ph: phFor(n), ...(phs ? { phs } : {}), text: n.t, at, cands: cands(n, sec).filter((c) => !(n.no ?? []).includes(c) && !(n.nos ?? []).includes(numbered(c)?.[0])) });
  };
  const section = (s, key, at) => {
    if (s.skip) return;
    const here = /^(\d[AB])\s+Term\b/i.exec(s.h ?? '')?.[1]?.toUpperCase() ?? at;
    (s.r ?? []).forEach((n, j) => node(n, `${key}.${j}`, here, s));
    (s.l ?? []).forEach((l, j) => section(l, `${key}.l${j}`, here));
  };
  (program.req ?? []).forEach((s, j) => section(s, `s${j}`, null));
  const total = row.get('total');
  if (total?.free && total.want > total.got.length) out.words.push({ key: 'total', count: total.want - total.got.length, ph: 'ELECTIVE', text: total.text, at: null, cands: [] });
  return out;
}

export const WORK_COURSE = /^(PD|WKRPT|COOP)\d/;
export const WT_SLOTS = 2;

/**
 * Puts courses in a grid. Each goes in the earliest study term in its year or later (a 300-level course in
 * third year) that comes after its prerequisites, is in a season it has run in lately, and has fewer than
 * `load` courses; or in the term a term-by-term program names (up to `max`). Courses whose prerequisites
 * nothing planned can meet still go in their year, for the grid to flag.
 * rows: [{kind: 'study'|'coop'|'off', season: 'F'|'W'|'S', codes: [...]}]; want: [{code, at}]; from: the first
 * row to put courses in (earlier ones are done). → {placed: [{code, row}], left: [codes with no room]}
 */
export function arrange(rows, want, { courses = {}, load = 5, max = 7, from = 0, equiv, plans = [] } = {}) {
  const lv = levels(rows);
  const study = rows.map((r, i) => (r.kind === 'study' && i >= from ? i : -1)).filter((i) => i >= 0);
  // PD courses and work-term reports are taken on work terms (two courses there at most).
  const work = rows.map((r, i) => (r.kind === 'coop' && i >= from ? i : -1)).filter((i) => i >= 0);
  const cells = rows.map((r) => (r.kind !== 'off' ? (r.codes ?? []).filter(Boolean).map(baseCode) : []));
  const year = (i) => Number(lv[i]?.slice(0, -1));
  const last = Math.max(0, ...study.map(year));
  const target = (w) => {
    if (w.at) {
      const i = study.find((x) => lv[x] === w.at);
      if (i != null) return { i, exact: true };
    }
    const y = Math.min(Math.max(yearOf(w.code), 1), last);
    return { i: study.find((x) => year(x) >= y) ?? study.at(-1), exact: false };
  };
  const runs = (code, i) => {
    const s = courses[code]?.[5];
    if (!s || !(s[0] + s[1] + s[2])) return true;
    return s['FWS'.indexOf(rows[i].season)] > 0;
  };
  const before = (i) => new Set(cells.slice(0, i).flat());
  // Requisites nothing in the plan can meet (a prerequisite not picked yet) don't hold a course back: it
  // goes in its year, at the level its requisites name, and the grid flags it.
  const wanted = new Set(want.map((w) => w.code));
  const everything = new Set([...cells.flat(), ...wanted]);
  const meetable = (tree) => !tree?.length || holds(tree, everything, { plans, equiv }) !== false;
  const levelNeeded = (tree) => {
    let best = null;
    const walk = (ns) => {
      for (const n of Array.isArray(ns) ? ns : []) {
        if (n.g) walk(n.i);
        if (n.lv && levelRank(n.lv) > levelRank(best)) best = n.lv;
      }
    };
    walk(tree);
    return best;
  };
  const ok = (code, i) => {
    const c = courses[code];
    if (!runs(code, i)) return false;
    const ctx = { level: lv[i], plans, equiv };
    for (const [tree, have] of [
      [c?.[2], () => before(i)],
      [c?.[3], () => new Set([...before(i), ...cells[i]])],
    ]) {
      if (!tree?.length) continue;
      if (meetable(tree)) {
        if (holds(tree, have(), ctx) === false) return false;
      } else {
        const need = levelNeeded(tree);
        if (need && levelRank(lv[i]) < levelRank(need)) return false;
      }
    }
    return true;
  };
  // Prerequisites first (depth: how many of the wanted courses lead up to a course; a corequisite can be in
  // the same term), and among equals the ones more courses build on (height), so a long chain starts early.
  const pre = (code) => antiCodes(courses[code]?.[2]).filter((c) => wanted.has(c) && c !== code);
  const co = (code) => antiCodes(courses[code]?.[3]).filter((c) => wanted.has(c) && c !== code);
  const memo = (fn) => {
    const m = new Map();
    const go = (code, seen = new Set()) => {
      if (m.has(code)) return m.get(code);
      if (seen.has(code)) return 0;
      seen.add(code);
      const v = fn(code, (c) => go(c, seen));
      m.set(code, v);
      return v;
    };
    return go;
  };
  const depth = memo((code, d) => Math.max(0, ...pre(code).map((c) => 1 + d(c)), ...co(code).map(d)));
  const after = new Map();
  for (const c of wanted) for (const x of pre(c)) after.set(x, [...(after.get(x) ?? []), c]);
  const height = memo((code, h) => Math.max(0, ...(after.get(code) ?? []).map((c) => 1 + h(c))));
  const all = want.map((w, j) => ({ ...w, j, t: target(w) }));
  const sorted = all.filter((w) => w.t.i != null).sort((a, b) => a.t.i - b.t.i || depth(a.code) - depth(b.code) || height(b.code) - height(a.code) || a.j - b.j);
  const placed = [];
  const left = all.filter((w) => w.t.i == null).map((w) => w.code);
  const put = (w, i) => {
    cells[i].push(w.code);
    placed.push({ code: w.code, row: i });
  };
  // Terms a program names first, then real courses by year and prerequisites, then placeholders for a level
  // ("PMATH 4XX"), then electives in the room that's left. Each gets two strict passes (requisites, seasons,
  // load), then one that only keeps to the load.
  const generic = (c) => c === 'ELECTIVE' || /XXX$/.test(c);
  const loose = sorted.filter((w) => !w.t.exact);
  const phases = [sorted.filter((w) => w.t.exact), loose.filter((w) => !isPlaceholder(w.code)), loose.filter((w) => isPlaceholder(w.code) && !generic(w.code)), loose.filter((w) => generic(w.code))];
  for (let queue of phases) {
    for (const strict of [true, true, false]) {
      const next = [];
      for (const w of queue) {
        if (w.t.exact) {
          if (cells[w.t.i].length < max) put(w, w.t.i);
          else next.push({ ...w, t: { i: w.t.i, exact: false } });
          continue;
        }
        // One PD course (and one work-term report) a work term, in order.
        const kin = numbered(w.code)?.[0];
        const onWork = WORK_COURSE.test(w.code) && work.length;
        const i = onWork
          ? work.find((x) => cells[x].length < WT_SLOTS && !cells[x].some((c) => numbered(c)?.[0] === kin)) ?? work.find((x) => cells[x].length < WT_SLOTS)
          : study.find((x) => x >= w.t.i && cells[x].length < load && (!strict || ok(w.code, x)));
        if (i != null) put(w, i);
        else next.push(w);
      }
      queue = next;
    }
    left.push(...queue.map((w) => w.code));
  }
  return { placed, left };
}

/**
 * Programs still within reach: each one's courses still needed, given what's planned. programs: the data
 * file's list; chosen: slugs already picked; cant: slug → Set of slugs it can't go with.
 */
export function directions(programs, planned, { chosen = [], cant = new Map(), courses = {}, types = null } = {}) {
  const out = [];
  for (const p of programs) {
    if (chosen.includes(p.s) || (types && !types.includes(p.t))) continue;
    const r = evaluate(p, planned, { courses });
    if (!r.need) continue;
    const blocked = chosen.filter((c) => cant.get(p.s)?.has(c) || cant.get(c)?.has(p.s));
    out.push({ p, need: r.need, have: r.have, left: r.need - r.have, unknown: r.unknown, blocked });
  }
  return out.sort((a, b) => a.blocked.length - b.blocked.length || a.left - b.left || b.have - a.have || a.p.n.localeCompare(b.p.n));
}

/** Units total a program states ("Complete a total of 20.0 units"), if any. */
export const totalUnits = (p) => p.tu ?? null;
