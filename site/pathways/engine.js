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
// gone, antireq codes that count only once completed]: gone is 1 when it isn't in the current calendar.

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
 * have: codes counted as done (earlier terms; for corequisites, this term too). ctx: {level, plans, equiv, grades,
 * same}: same is the course's own term, for a prerequisite worded "Completed or concurrently enrolled in" (cc).
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

/** "Corequisite is for H-Kinesiology students only": is one of the plans that program? (Its name, with or without H-.) */
const onlyFor = (text, plans) => {
  const bare = (s) => String(s ?? '').toLowerCase().replace(/^(?:jh|h|\dg)-/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const want = bare(text);
  return plans.some((p) => bare(p.code) === want || bare(p.name) === want) || enrolled(text, plans) === true;
};

function holdsNode(n, have, ctx) {
  if (n.g) {
    // A group for one program's students alone: it asks nothing of anyone else. With no plans picked, there's no
    // telling whose it is.
    if (n.only) {
      const plans = ctx.plans ?? [];
      if (plans.length && !onlyFor(n.only, plans)) return true;
      const v = all(n.i.filter((c) => !c.only).map((c) => holdsNode(c, have, ctx)));
      return plans.length ? v : v === true ? true : null;
    }
    const vals = n.i.map((c) => holdsNode(c, have, ctx));
    return n.g === 'n' ? atLeast(vals, n.n ?? 1) : all(vals);
  }
  if (n.r) {
    const got = (c) => has(have, c, ctx) || Boolean(n.cc && ctx.same && has(ctx.same, c, ctx));
    // "Earned a minimum grade of 60% in CS136": a grade below that doesn't count (no grade yet: assume it will).
    const hits = n.c.filter((c) => got(c) && !lowGrade(n, c, ctx)).length;
    if (n.r === 'all') return hits === n.c.length;
    if (n.r === 'n') return hits >= (n.n ?? 1);
    if (n.r === 'not') return hits === 0;
    return true; // any, max, list: nothing to fail
  }
  if (n.lv) return ctx.level ? levelRank(ctx.level) >= levelRank(n.lv) : null;
  // "Students must be in level 1A": that level exactly.
  if (n.lx) return ctx.level ? ctx.level === n.lx : null;
  if (n.en) return enrolled(n.en, ctx.plans ?? []);
  return null;
}

/** "Enrolled in H-Software Engineering" / "an Honours Mathematics program" against the plans someone picked. */
export function enrolled(text, plans) {
  if (!plans.length) return null;
  const t = text.toLowerCase();
  if (plans.some((p) => p.code && t.includes(p.code.toLowerCase()))) return true;
  // "Enrolled in a program offered by Faculty of Engineering"
  const fac = /\bfaculty of ([a-z]+(?: [a-z]+)?)/.exec(t);
  if (fac && plans.some((p) => (p.faculty ?? '').toLowerCase().includes(`faculty of ${fac[1]}`))) return true;
  const m = /\b(honours|joint honours)?\s*([a-z ]+?)\s+(program|plan|major|degree)s?\b/.exec(t.replace(/^an?\s+/, ''));
  if (m) {
    const word = m[2].trim();
    const faculty = plans.find((p) => (p.faculty ?? '').toLowerCase().includes(word) || (p.name ?? '').toLowerCase().includes(word));
    if (faculty && (!m[1] || /^(h|jh)-/i.test(faculty.code ?? ''))) return true;
  }
  return null;
}

/** Courses a requisite tree asks for (not the ones a "Not completed…" rule inside it rules out). */
export const needCodes = (nodes) => (Array.isArray(nodes) ? nodes : []).flatMap((n) => (n.g ? needCodes(n.i) : n.r && n.r !== 'not' ? n.c : []));

/** Courses an antirequisite tree rules out. */
export const antiCodes = (nodes) => (Array.isArray(nodes) ? nodes : []).flatMap((n) => (n.g ? antiCodes(n.i) : n.r ? n.c : []));

/** Courses a requisite tree names that aren't done: what to add first. */
export const missing = (nodes, have, ctx = {}) => why(nodes, have, ctx).codes;

/** Why a requisite tree fails: {codes: courses to add, level: 'nX' or higher needed, exact: levels it must be in,
 *  plans: ["H-Software Engineering"…]}. */
export function why(nodes, have, ctx = {}) {
  const codes = new Set();
  const groups = [];
  const low = [];
  let level = null;
  const exact = new Set();
  const plans = new Set();
  const walk = (list) => {
    for (const n of list ?? []) {
      if (holdsNode(n, have, ctx) !== false) continue;
      if (n.g) walk(n.only ? n.i.filter((c) => !c.only) : n.i);
      else if (n.r && n.r !== 'not') {
        // Each unmet list on its own: "one of MATH 128, 138, 148" and "one of MATH 136, 146" are both needed.
        const got = (c) => has(have, c, ctx) || Boolean(n.cc && ctx.same && has(ctx.same, c, ctx));
        const miss = n.c.filter((c) => !got(c) || lowGrade(n, c, ctx));
        for (const c of miss) codes.add(c);
        if (miss.length) groups.push(n.r === 'all' ? miss.map((c) => [c]) : [miss]);
        for (const c of miss) if (lowGrade(n, c, ctx)) low.push({ code: c, need: n.mg, got: ctx.grades.get(c) });
      }
      if (n.lv && (!level || levelRank(n.lv) > levelRank(level))) level = n.lv;
      if (n.lx) exact.add(n.lx);
      if (n.en) plans.add(n.en);
    }
  };
  walk(nodes);
  return { codes: [...codes], groups: groups.flat(), level, plans: [...plans], ...(exact.size ? { exact: [...exact] } : {}), ...(low.length ? { low } : {}) };
}

// ---------------- overrides ----------------
// A planner can't know what an advisor or instructor has agreed to, so a course can be marked as an override (shown
// yellow): its requisites stop counting as problems, and it can count as another course, toward plans and as a
// prerequisite ("MATH 117 counts as MATH 137"). What follows is what the university's own pages say about them:
// what each kind is called, who decides, and where each faculty says to ask. Only the stable parts are here (the
// pages change their contacts and dates), each with its page.

export const OVERRIDE_SRC = 'https://uwaterloo.ca/registrar/registering-courses/enrolment-error-messages';
export const OVERRIDE_FORM = 'https://uwaterloo.ca/the-centre/forms-and-official-documents/forms-undergraduate-students/course-override-form';
export const OVERRIDE_SELECTION_FORM = 'https://uwaterloo.ca/forms/undergraduate-studies/course-selection-override';
/** Where each faculty says to ask about overrides into its courses (linked from the Registrar's page), by data.sf's keys. */
export const FACULTY_OVERRIDES = {
  art: { name: 'Arts', url: 'https://uwaterloo.ca/arts/undergraduate/student-support/course-selection/enrolment-problems-and-course-overrides' },
  eng: { name: 'Engineering', url: 'https://uwaterloo.ca/engineering/undergraduate-students/getting-support/course-selection-enrolment' },
  env: { name: 'Environment', url: 'https://uwaterloo.ca/environment/undergraduate/current-students/env-academic-advising' },
  hea: { name: 'Health', url: OVERRIDE_SRC },
  mat: { name: 'Mathematics', url: 'https://uwaterloo.ca/math/undergraduate-studies/academics/course-selection-enrolment' },
  sci: { name: 'Science', url: 'https://uwaterloo.ca/science-undergraduate-office/academic-information/course-enrolment-resources/enrolment-problems-and-course-overrides' },
};
/**
 * The Registrar's enrolment errors a degree plan can run into, by the kind of problem a cell (or a term) has:
 * what Quest says, and who can override it. (Class limits, reserved seats, consent and time conflicts are a term's
 * business, not a degree plan's.)
 */
export const OVERRIDE_KINDS = {
  pre: { error: 'Requisites have not been met', how: 'the Course Override Form’s “Override Requisites” (the Course Selection Override Form during course selection), approved by the department or instructor offering the course' },
  anti: { error: 'Requisites have not been met', how: 'your academic advisor: an antirequisite has no box on the form' },
  load: { error: 'Term maximum exceeded', how: 'your academic advisor or faculty, who can override the unit load' },
  wt: { error: '', how: 'your academic advisor, who can say what your faculty allows on a work term' },
};
/**
 * Who to ask about overriding a problem with a course: {error, how, faculty: {name, url}, note}. kind: 'pre' (its
 * prerequisites, corequisites, level or program), 'anti', 'load' or 'wt'; fac: its subject's faculty (data.sf).
 */
export function overrideHelp(kind, code = '', fac = '') {
  const k = OVERRIDE_KINDS[kind] ?? OVERRIDE_KINDS.pre;
  const subject = /^[A-Z]+/.exec(code)?.[0] ?? '';
  // "Normally, requisite and capacity overrides for math courses are not permitted" (the Math faculty's page).
  const note = subject === 'MATH' && kind === 'pre' ? 'The Faculty of Mathematics says requisite overrides for MATH courses aren’t normally given.' : '';
  return { ...k, faculty: FACULTY_OVERRIDES[fac] ?? null, note, src: OVERRIDE_SRC };
}

/**
 * Courses as the engine sees them with "counts as" overrides: each pair [x, y] (x counts as y) makes the two one
 * course under either code, the way a cross-listing does (courses[code][6]), so x meets a requirement or a
 * prerequisite that names y. A code that isn't in the calendar (a transfer credit, another university's course) gets
 * a bare entry, marked gone so nothing offers it. The same object back when there are no pairs.
 */
export function aliasCourses(courses, pairs) {
  if (!pairs?.length) return courses;
  const out = { ...courses };
  const add = (a, b) => {
    const c = out[a] ? [...out[a]] : ['', UNIT, 0, 0, 0, [0, 0, 0], [], 1];
    c[6] = [...new Set([...(c[6] || []), b])];
    out[a] = c;
  };
  for (const [x, y] of pairs) {
    if (!x || !y || x === y) continue;
    add(baseCode(x), y);
    add(y, x); // under its own key in the grid ("MATH1XX#2", a second placeholder)
  }
  return out;
}
// ---------------- a saved or shared plan ----------------

// A link is something people send each other, and what it carries ends up in the page. Every field is checked for
// shape before it's used, whether it came from a link or from the browser's storage; anything the grid itself
// wouldn't have written is dropped (a course code is letters and digits, a plan is a slug, a grade is 0–100 or one
// of the transcript's marks…).
const CODE_OK = /^[A-Z][A-Z0-9]{1,11}$/;
const SLUG_OK = /^[a-z0-9][a-z0-9-]{0,119}$/;
const TICK_OK = /^[a-z0-9-]{1,120}:[\w.:|-]{1,80}$/; // "french-minor:0.2.1": a plan and a rule's place in it
const GRADE_MARKS = new Set(['CR', 'NCR', 'WD', 'WF', 'INC', 'AEG', 'DNW', 'FTC', 'IP', 'NMR', 'MM', 'UR']);
const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const cleanCode = (x) => (typeof x === 'string' && CODE_OK.test(x) ? x : '');
const cleanGrade = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) || GRADE_MARKS.has(v);

/** One term's cells as the grid keeps them: {k, c, g?, o?, lo?, stash?}. */
function cleanRow(r, slots, kind = null) {
  const k = kind ?? (['s', 'c', 'o'].includes(r?.k) ? r.k : 's');
  const c = (Array.isArray(r?.c) ? r.c : []).slice(0, slots).map(cleanCode);
  while (c.length && !c.at(-1)) c.pop();
  const out = { k, c };
  const g = {};
  for (const [j, v] of Object.entries(isObj(r?.g) ? r.g : {})) if (/^\d$/.test(j) && c[j] && cleanGrade(v)) g[j] = v;
  if (Object.keys(g).length) out.g = g;
  const o = {};
  for (const [j, v] of Object.entries(isObj(r?.o) ? r.o : {})) {
    if (!/^\d$/.test(j) || !c[j] || !isObj(v)) continue;
    const a = cleanCode(v.a);
    if (v.w || a) o[j] = { ...(a ? { a } : {}), ...(v.w ? { w: 1 } : {}) };
  }
  if (Object.keys(o).length) out.o = o;
  if (r?.lo) out.lo = 1;
  // Courses set aside while the term is of another kind.
  if (kind == null && isObj(r?.stash)) {
    const stash = {};
    for (const key of ['s', 'c', 'o']) {
      if (!isObj(r.stash[key])) continue;
      const { k: _k, ...kept } = cleanRow(r.stash[key], slots, key);
      if (kept.c.length) stash[key] = kept;
    }
    if (Object.keys(stash).length) out.stash = stash;
  }
  return out;
}

/**
 * A saved or shared plan, checked field by field → the plan, or null when it isn't one. start is null when the
 * plan's isn't a term, and rows may be empty: the page fills those in. types: the kinds of plan a view can name.
 */
export function cleanState(s, { slots = 7, types = [] } = {}) {
  if (!isObj(s) || s.v !== 1 || !Array.isArray(s.rows)) return null;
  const text = (x, max = 120) => (typeof x === 'string' ? x.replace(/[<>"`]/g, '').slice(0, max) : '');
  const out = {
    v: 1,
    ...(s.wt ? { wt: 1 } : {}),
    start: /^\d{3}[159]$/.test(String(s.start)) ? String(s.start) : null,
    rows: s.rows.slice(0, 60).map((r) => cleanRow(r, slots)),
    plans: [...new Set((Array.isArray(s.plans) ? s.plans : []).filter((x) => typeof x === 'string' && SLUG_OK.test(x)))].slice(0, 24),
    ticked: (Array.isArray(s.ticked) ? s.ticked : []).filter((x) => typeof x === 'string' && TICK_OK.test(x)).slice(0, 2000),
    cut: Number.isInteger(s.cut) && s.cut >= -1 && s.cut < 60 ? s.cut : -1,
    dir: types.includes(s.dir) ? s.dir : 'Minor',
  };
  if (s.exview === 'all' || s.exview === 'grad' || types.includes(s.exview)) out.exview = s.exview;
  if (s.exorder === 'fac' || s.exorder === 'near') out.exorder = s.exorder;
  if (text(s.exfac)) out.exfac = text(s.exfac);
  if (text(s.goal, 200)) out.goal = text(s.goal, 200);
  if (s.live === 0) out.live = 0;
  return out;
}

// ---------------- antirequisites ----------------

// An antirequisite runs one way. FR 152's "Not completed nor concurrently enrolled in FR 192A" stops FR 152 once
// FR 192A is done or in the same term. It says nothing about taking FR 192A afterwards: only FR 192A's own list
// could rule that out, and it doesn't (FR 152 is its prerequisite). About a third of the calendar's antirequisite
// listings aren't returned by the other course. A course's [4] is every course its list names; [8] the ones under
// "Not completed any of the following", which stop it only once they're done (the same term is allowed).

/** Does a's antirequisite list name b, or a course cross-listed with b? */
export function antiLists(a, b, courses) {
  const list = courses[a]?.[4];
  if (!list || !list.length || a === b) return false;
  return list.includes(b) || (courses[b]?.[6] ?? []).some((x) => x !== a && list.includes(x));
}

/** Does `later` build on `earlier`: do its prerequisites name it, directly or through a course or two between? */
export function buildsOn(later, earlier, courses, depth = 3) {
  const seen = new Set();
  const go = (code, d) => {
    if (seen.has(code)) return false;
    seen.add(code);
    const names = needCodes(courses[code]?.[2]); // every course its prerequisites ask for
    if (names.some((x) => x === earlier || (courses[x]?.[6] ?? []).includes(earlier))) return true;
    return d > 1 && names.some((x) => go(x, d - 1));
  };
  return later !== earlier && go(later, depth);
}

/**
 * Taking `second` in a later term than `first`:
 *   'bad'    second lists first, so it can't be taken once first is done;
 *   'check'  only first lists second, and second doesn't build on first: the calendar allows this order, but the
 *            two overlap (AE 104 then CIVE 104), so whether both count is worth asking;
 *   ''       nothing to say, which includes the usual sequence (FR 152 then FR 192A, CS 116 then CS 136).
 */
export function antiAfter(first, second, courses) {
  if (antiLists(second, first, courses)) return 'bad';
  if (antiLists(first, second, courses) && !buildsOn(second, first, courses)) return 'check';
  return '';
}

/** In the same term: does a's list stop it alongside b? ("Not completed any of the following" doesn't.) */
export function antiWith(a, b, courses) {
  if (!antiLists(a, b, courses)) return false;
  const done = courses[a]?.[8];
  if (!done?.length) return true;
  const strict = courses[a][4].filter((x) => !done.includes(x));
  return strict.includes(b) || (courses[b]?.[6] ?? []).some((x) => x !== a && strict.includes(x));
}

/**
 * What antirequisites say about a course where it sits. before: the courses in earlier terms; same: its own term's.
 * → {after: the ones that stop it because they're done, with: the ones that stop it in the same term,
 *    check: earlier ones that list it without being listed back or built on}.
 */
export function antiIssues(code, before, same, courses) {
  const out = { after: [], with: [], check: [] };
  for (const x of before) {
    if (x === code) continue;
    const v = antiAfter(x, code, courses);
    if (v === 'bad') out.after.push(x);
    else if (v === 'check') out.check.push(x);
  }
  for (const x of same) if (x !== code && !before.has(x) && antiWith(code, x, courses)) out.with.push(x);
  return out;
}

/**
 * Would putting `code` in a term clash with a course already in the grid, either way round? where: -1 when the
 * other course is in an earlier term, 0 the same term, 1 a later one. The next course of a sequence doesn't.
 */
export function antiClash(code, other, where, courses) {
  if (where < 0) return antiAfter(other, code, courses) !== '';
  if (where > 0) return antiAfter(code, other, courses) !== '';
  return antiLists(code, other, courses) || antiLists(other, code, courses);
}

/** courses → Map code → the codes that stand for it (cross-listings, and "counts as" pairs from aliasCourses). */
export const equivOf = (courses) => new Map(Object.entries(courses).filter(([, c]) => c[6]?.length).map(([k, c]) => [k, c[6]]));

// Courses the calendar treats as overlapping: antirequisites, either way round ("MATH 117, antirequisite of MATH
// 137"). Where one is asked for and you have the other is where overrides and substitutions are usually sought.
// A sequence isn't an overlap: FR 152 lists FR 192A only because you can't go back down a level.
const overlapIndex = new WeakMap();
function overlapMap(courses) {
  if (!overlapIndex.has(courses)) {
    const m = new Map();
    const add = (a, b) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a).add(b);
    };
    for (const [k, c] of Object.entries(courses)) {
      for (const x of c[4] || []) {
        if (!(courses[x]?.[4] || []).includes(k) && (buildsOn(x, k, courses) || buildsOn(k, x, courses))) continue;
        add(k, x);
        add(x, k);
      }
    }
    overlapIndex.set(courses, m);
  }
  return overlapIndex.get(courses);
}
export const overlapsOf = (code, courses) => [...(overlapMap(courses).get(code) ?? [])];
export const overlap = (a, b, courses) => Boolean(overlapMap(courses).get(a)?.has(b));

/**
 * Where an override is usually sought: a course asked for (a prerequisite, a plan's requirement) that you don't have,
 * next to one you do have that overlaps it. wanted: codes asked for; have: codes you have (a Set or Map's keys).
 * → [{have, for}], each pair once.
 */
export function typicalFor(wanted, have, courses) {
  const mine = have instanceof Map ? [...have.keys()] : [...have];
  const out = [];
  for (const y of new Set(wanted)) {
    for (const x of overlapsOf(y, courses)) if (mine.includes(x) && !mine.includes(y)) out.push({ have: x, for: y });
  }
  return out;
}

// ---------------- what can go next ----------------

/**
 * What could go in a term, like the open nodes of a skill tree: courses not in the grid yet whose prerequisites the
 * terms before it meet, that run in its season, the most useful first. They come from what your plans still need
 * (need: Map code → [{k, kind, label}], kind 'required', 'choice' or 'words') and from what the courses before it
 * lead to (leads: code → codes that name it as a prerequisite).
 *   before: Set of codes in earlier terms; planned: Map of everything in the grid; season: 'F' | 'W' | 'S';
 *   year: the term's year (1 for 1A and 1B); fresh: codes from the study term just before, or just added.
 * → [{code, kind, k, label, opens: [needed courses it's a prerequisite of], by: [earlier courses it builds on],
 *     sure: false when a prerequisite names a plan the grid can't confirm}], best first.
 * Order: what a plan requires by name, then its choices, then courses that fit one of its rules in words, then
 * what the terms before have opened that no plan asks for; within each, the ones the term before just opened and
 * the ones that open the most of what's still needed, at the term's level.
 */
export function readyNow({ courses, planned, before, season, year = 1, level = null, plans = [], equiv, grades, need = new Map(), leads = () => [], fresh = new Set(), limit = 24, row = null }) {
  const idx = 'FWS'.indexOf(season);
  const ctx = { level, plans, equiv, grades };
  const inGrid = (c) => planned.has(c) || (equiv?.get(c) ?? []).some((x) => planned.has(x));
  const by = new Map();
  for (const b of before) {
    if (isPlaceholder(baseCode(b))) continue;
    for (const k of leads(b)) by.set(k, [...(by.get(k) ?? []), b]);
  }
  // Antirequisites, by order (row: this term's place in the grid): not a course that one before it stops, that
  // would stop a later one, or that merely overlaps one. The next course of a sequence stays (FR 192A after FR 152).
  const clashes = (code) => {
    for (const [x, at] of planned) {
      const where = before.has(x) ? -1 : row == null || at?.row == null ? 0 : Math.sign(at.row - row);
      if (antiClash(code, x, where, courses)) return true;
    }
    return false;
  };
  const KIND = { required: 3, choice: 2, words: 1 };
  // The regular version before the advanced one, the one meant for your faculty before another's ("Calculus 2
  // for Honours Mathematics" before "… for the Sciences"), and arranged courses (a thesis, a reading course) last.
  const homes = new Set(plans.map((p) => String(p.faculty ?? '').replace(/^Facult(?:y|ies) of /, '').split(/ (?:and|with) /)[0]));
  const fit = (title) => {
    const m = AUDIENCE.exec(title);
    return m && homes.size ? (homes.has(AUDIENCE_FACULTY[m[1].toLowerCase()]) ? 1 : -1) : 0;
  };
  const out = [];
  for (const code of new Set([...need.keys(), ...by.keys()])) {
    const c = courses[code];
    if (!c || c[7] || inGrid(code) || WORK_COURSE.test(code) || isPlaceholder(code)) continue;
    const sn = c[5] ?? [0, 0, 0];
    if (!(sn[0] + sn[1] + sn[2]) || (idx >= 0 && !sn[idx])) continue;
    if (clashes(code)) continue;
    const ok = holds(c[2], before, ctx);
    if (ok === false) continue;
    const wants = need.get(code) ?? [];
    const top = [...wants].sort((a, b) => (KIND[b.kind] ?? 0) - (KIND[a.kind] ?? 0))[0];
    const kind = top?.kind ?? '';
    const cy = yearOf(code);
    // A course well past the term's year with nothing asking for it by name isn't "next".
    if (kind !== 'required' && cy > year + 1) continue;
    const built = (by.get(code) ?? []).filter((b) => !isPlaceholder(b));
    const opens = leads(code).filter((k) => need.has(k) && !inGrid(k) && courses[k] && !courses[k][7]);
    const score =
      (kind === 'required' ? 100 : kind === 'choice' ? 60 : kind === 'words' ? 35 : 0) +
      (built.some((b) => fresh.has(b)) ? 18 : built.length ? 8 : 0) +
      8 * Math.min(opens.length, 5) -
      14 * Math.max(0, cy - year) -
      5 * Math.max(0, year - cy) -
      (ok === null ? 6 : 0) -
      (ADVANCED.test(c[0] ?? '') ? 30 : 0) -
      (ARRANGED.test(c[0] ?? '') ? 40 : 0) +
      10 * fit(c[0] ?? '');
    out.push({ code, kind, k: top?.k ?? null, label: top?.label ?? '', opens, by: built, sure: ok === true, score });
  }
  out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code, 'en', { numeric: true }));
  return out.slice(0, limit);
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
  // A cross-listed course is one course under each of its codes (courses[code][6]): SOC 327 in the grid meets
  // "LS 327" and counts as an LS course. keyOf: the code it's planned under.
  const aliases = (c) => courses[baseCode(c)]?.[6] ?? [];
  const keyOf = (c) => (planned.has(c) ? c : aliases(c).find((a) => planned.has(a)) ?? null);
  const take = (codes, limit = Infinity) => {
    const got = [];
    const keys = new Set();
    for (const c of codes) {
      if (got.length >= limit) break;
      const k = keyOf(c);
      if (k && !used.has(k) && !keys.has(k)) {
        got.push(c);
        keys.add(k);
      }
    }
    return got;
  };
  const markUsed = (got) => {
    for (const c of got) used.add(keyOf(c) ?? c);
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
      return !WORK_COURSE.test(c) && (!n.min || (num != null && num >= n.min * 100)) && (!n.max || (num != null && num < (n.max + 1) * 100));
    });
  const otherFaculty = (fac) => [...planned.keys()].filter((c) => {
    const f = faculty[numbered(c)?.[0]];
    return f && f !== fac && !WORK_COURSE.test(c);
  });
  // Lowest levels first, so a rule that takes any level ("1.0 unit of CS") leaves the 300- and 400-level courses
  // for one that needs them ("0.5 unit of CS at the 300-level"), whatever terms they're in.
  const subjectPool = (n) =>
    [...planned.keys()]
      .filter((c) =>
        [c, ...aliases(c)].some((x) => {
          const m = numbered(x);
          if (!m) return false;
          const [subj, num] = m;
          if (n.rg) return num != null && n.rg.some(([s, lo, hi]) => s === subj && num >= lo && num <= hi);
          // min: "at the 300-level or above"; max: "at the 100-level" names a level and none above it
          return n.subj.includes(subj) && (!n.min || (num != null && num >= n.min * 100)) && (!n.max || (num != null && num < (n.max + 1) * 100));
        }),
      )
      .sort((a, b) => (numbered(a)?.[1] ?? 999) - (numbered(b)?.[1] ?? 999));
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
        markUsed(got);
        emit({ key, depth, kind: n.r, want, got, codes: n.c, n: n.n });
        return { need: want, have: got.length, unknown: false };
      }
      if (n.r === 'not') {
        const bad = n.c.filter((c) => keyOf(c));
        emit({ key, depth, kind: 'not', codes: n.c, bad });
        return { need: 0, have: 0, unknown: false };
      }
      if (n.r === 'max') {
        const in_ = n.c.filter((c) => keyOf(c));
        emit({ key, depth, kind: 'max', codes: n.c, n: n.n, got: in_, over: in_.length > (n.n ?? Infinity) });
        return { need: 0, have: 0, unknown: false };
      }
      // any / list: the codes others draw on (a quantity in words picks from them).
      emit({ key, depth, kind: 'list', codes: n.c, got: n.c.filter((c) => keyOf(c)) });
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
        markUsed(got);
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
      return n.subj.includes(subj) && (!n.min || num >= n.min * 100) && (!n.max || num < (n.max + 1) * 100);
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
export function arrange(rows, want, { courses = {}, load = 5, max = 7, from = 0, equiv, plans = [], early = false } = {}) {
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
    // "Students must be in level 1A" (or 1A or 1B): the first of the levels it names.
    let exact = null;
    const walk = (ns) => {
      for (const n of Array.isArray(ns) ? ns : []) {
        if (n.g) walk(n.i);
        if (n.lv && levelRank(n.lv) > levelRank(best)) best = n.lv;
        if (n.lx && (!exact || levelRank(n.lx) < levelRank(exact))) exact = n.lx;
      }
    };
    walk(tree);
    if (exact && levelRank(exact) > levelRank(best)) best = exact;
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
  // load), then one that only keeps to the load; with early, what still has no room can go in an earlier year's
  // term when its requisites and season allow (a 200-level course in 1B rather than an extra term).
  const generic = (c) => c === 'ELECTIVE' || /XXX$/.test(c);
  const loose = sorted.filter((w) => !w.t.exact);
  const phases = [sorted.filter((w) => w.t.exact), loose.filter((w) => !isPlaceholder(w.code)), loose.filter((w) => isPlaceholder(w.code) && !generic(w.code)), loose.filter((w) => generic(w.code))];
  for (let queue of phases) {
    for (const strict of early ? [true, true, false, 'early'] : [true, true, false]) {
      const next = [];
      for (const w of queue) {
        if (strict === 'early') {
          // At most a year early, and only where its prerequisites are already in the terms before.
          const y = yearOf(w.code);
          const pre = courses[w.code]?.[2];
          const i = WORK_COURSE.test(w.code) ? null : study.find((x) => year(x) >= y - 1 && cells[x].length < load && ok(w.code, x) && (!pre?.length || holds(pre, before(x), { level: lv[x], plans, equiv }) !== false));
          if (i != null) put(w, i);
          else next.push(w);
          continue;
        }
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

// ---------------- the fewest courses ----------------

/**
 * Courses to add so a set of plans takes as few courses as it can. Each step takes the course that counts toward
 * the most plans still open (two academic plans at most, under Counting of Courses; one a major and its
 * specialization share is a single use; degree requirements always count), for what it costs: itself and the
 * prerequisites it still needs, picked the same way. Ties go to courses that have run lately, then to lower levels.
 * Requirements nothing in particular fits ("any course", "approved electives") are left for placeholders.
 * plans: programs as picked (forPlans); planned: Map code → {units}; ctx: {plans: [{code, faculty, name}]} for
 * "Enrolled in…" prerequisites; exclude: courses not to pick. Courses that aren't in this calendar, haven't run
 * lately (when others have) or clash with planned antirequisites aren't picked.
 * → [{code, plans: [indexes of the plans it counts toward], for: code it's a prerequisite of (if it is one)}]
 */
// Courses that need a supervisor or a placement first: picked only when nothing else will do.
const ARRANGED = /\b(independent stud|directed stud|special stud|reading course|honours (?:essay|thesis)|senior (?:honours|essay|thesis)|thesis|research project|practicum|internship|field (?:placement|course|work)|exchange)/i;

// Subjects a program keeps for its own students (engineering, pharmacy, optometry, architecture): not picked as
// electives for anyone whose plans don't name them.
const OWN_SUBJECTS = new Set(['AE', 'ARCH', 'BME', 'CHE', 'CIVE', 'ECE', 'ENVE', 'GENE', 'GEOE', 'ME', 'MSE', 'MTE', 'NE', 'SE', 'SYDE', 'TRON', 'PHARM', 'OPTOM']);
// Advanced and enriched versions need high marks or permission, and non-specialist ones are for students outside
// the subject: the regular one first, when both would do.
const ADVANCED = /\(Advanced Level\)|\bEnriched\b|\bNon-?Specialist\b|\bfor Non-(?:Majors|Math)/i;
// "Calculus 1 for Honours Mathematics", "… for the Sciences": who a course is for, against the plans' faculties.
const AUDIENCE = /\bfor (?:the )?(?:honours |life |physical )?(mathematics|math|sciences?|engineering|engineers|arts|environment|health)\b/i;
const AUDIENCE_FACULTY = { mathematics: 'Mathematics', math: 'Mathematics', sciences: 'Science', science: 'Science', engineering: 'Engineering', engineers: 'Engineering', arts: 'Arts', environment: 'Environment', health: 'Health' };

export function optimize(plans, planned, { courses = {}, equiv, faculty = {}, ctx = {}, exclude = new Set(), limit = 80, complete = [], goal = null, total = null } = {}) {
  const have = new Map(planned);
  const odd = (c) => ARRANGED.test(courses[c]?.[0] ?? '');
  const advanced = (c) => ADVANCED.test(courses[c]?.[0] ?? '');
  const homes = new Set(plans.map((p) => String(p.f ?? '').replace(/^Facult(?:y|ies) of /, '').split(/ (?:and|with) /)[0]));
  // 1 for a course meant for the plans' faculty, -1 for one meant for another, 0 for one that doesn't say.
  const fit = (c) => {
    const m = AUDIENCE.exec(courses[c]?.[0] ?? '');
    return m ? (homes.has(AUDIENCE_FACULTY[m[1].toLowerCase()]) ? 1 : -1) : 0;
  };
  // How well a course fits the goal, 0 to 1 (a cross-listed course, its best code); 0 without one.
  const rel = (c) => (goal ? Math.max(goal.get(c) ?? 0, ...(courses[c]?.[6] ?? []).map((x) => goal.get(x) ?? 0)) : 0);
  // With a goal, a course is worth what it counts toward times how well it fits: one that fits well and counts
  // once beats one that fits poorly and counts twice.
  const worth = (g, c) => (goal ? g * (0.25 + rel(c)) : g);
  const hctx = { ...ctx, equiv };
  const runs = (c) => {
    const s = courses[c]?.[5];
    return s ? s[0] + s[1] + s[2] : 0;
  };
  const anyRuns = Object.values(courses).some((x) => x?.[5] && x[5][0] + x[5][1] + x[5][2] > 0);
  const usable = (c, h) => {
    const x = courses[c];
    if (!x || x[7] || exclude.has(c) || isPlaceholder(c) || WORK_COURSE.test(c) || has(h, c, hctx)) return false;
    // Antirequisites: nothing a held course stops or overlaps. The next course of a sequence is fine (FR 192A when
    // FR 152 is held: only FR 152 lists the other, and FR 192A builds on it, so it lands after).
    for (const o of h.keys()) if (antiLists(c, o, courses) || (antiLists(o, c, courses) && !buildsOn(c, o, courses))) return false;
    return true;
  };
  // What a course still needs for its prerequisites, one course from each list it misses (the one that costs
  // least, counting its own prerequisites, two deep); null when nothing can meet them.
  const prereqs = (c, base, needed, depth = 0) => {
    const tree = courses[c]?.[2];
    if (!tree?.length || holds(tree, base, hctx) !== false) return [];
    if (depth > 2) return null;
    const h = new Map(base);
    const out = [];
    for (let round = 0; round < 3 && holds(tree, h, hctx) === false; round++) {
      const groups = why(tree, h, hctx).groups.filter((g) => !g.some((x) => has(h, x, hctx)));
      if (!groups.length) return null;
      for (const g of groups) {
        if (g.some((x) => has(h, x, hctx))) continue;
        let best = null;
        for (const x of g) {
          if (!usable(x, h)) continue;
          const sub = prereqs(x, h, needed, depth + 1);
          if (!sub) continue;
          // Its own prerequisites cost less when the plans ask for them anyway.
          const cost = sub.reduce((t, y) => t + (needed.has(y) ? 0.25 : 1), 0) + (needed.has(x) ? 0.5 : 1) + (runs(x) || !anyRuns ? 0 : 1) + (odd(x) ? 1.5 : 0) + (advanced(x) ? 0.5 : 0) - 0.2 * fit(x);
          if (!best || cost < best.cost) best = { cost, list: [...sub, x] };
        }
        if (!best) return null;
        for (const x of best.list) {
          if (h.has(x)) continue;
          addPlanned(h, x, { units: courses[x]?.[1] ?? UNIT });
          out.push(x);
        }
      }
    }
    return holds(tree, h, hctx) === false ? null : out;
  };
  const out = [];
  // Each course that would count toward something still open, and the plans it would count toward; a cross-listed
  // course meets what each of its codes would (SOC 327 is LS 327 too).
  const openNeeds = () => {
    const { avail } = evaluateAll(plans, have, { courses, faculty });
    const needed = new Map();
    plans.forEach((p, k) => {
      for (const pl of pools(p, have, { courses, equiv, avail: avail[k], faculty })) {
        for (const c of pl.codes) {
          for (const x of [c, ...(courses[c]?.[6] ?? [])]) {
            const ks = needed.get(x) ?? [];
            if (!ks.includes(k)) ks.push(k);
            needed.set(x, ks);
          }
        }
      }
    });
    return needed;
  };
  // The prerequisites of courses going in anyway (complete: a plan's required courses), picked as above.
  if (complete.length) {
    const needed = openNeeds();
    for (const c of complete) {
      const pre = prereqs(c, have, needed) ?? [];
      for (const p of pre) {
        addPlanned(have, p, { units: courses[p]?.[1] ?? UNIT });
        out.push({ code: p, plans: needed.get(p) ?? [], for: c });
      }
    }
  }
  for (let step = 0; step < limit; step++) {
    const needed = openNeeds();
    // Courses the planned ones build on (MATH 137 before MATH 138): among equals, the one the plans lead from.
    const leads = new Map();
    for (const c of have.keys()) for (const x of antiCodes(courses[baseCode(c)]?.[2])) leads.set(x, (leads.get(x) ?? 0) + 1);
    const gainOf = (ks) => {
      const deg = ks.filter((k) => plans[k].t === 'Degree Requirements').length;
      const pair = ks.some((k) => plans[k].t === 'Major') && ks.some((k) => plans[k].t === 'Specialization');
      return Math.min(ks.length - deg, pair ? 3 : 2) + deg;
    };
    const cands = [...needed]
      .map(([c, ks]) => ({ c, ks, gain: gainOf(ks), runs: Math.min(runs(c), 4), odd: odd(c) }))
      .filter((x) => x.gain > 0)
      .map((x) => ({ ...x, top: worth(x.gain, x.c) }))
      .sort((a, b) => b.top - a.top || a.odd - b.odd || yearOf(a.c) - yearOf(b.c) || b.runs - a.runs || (a.c < b.c ? -1 : 1));
    let best = null;
    let looked = 0;
    for (const x of cands) {
      // A course scores its gain at most, unless prerequisites that count too come with it: stop once nothing
      // left could beat the best by itself.
      if (best && x.top + 0.05 <= best.score && looked > 60) break;
      if (++looked > 600) break;
      if (!usable(x.c, have)) continue;
      const pre = prereqs(x.c, have, needed);
      if (!pre) continue;
      // The course and the prerequisites it brings, together: what they count toward for each course they cost.
      const gain = worth(x.gain, x.c) + pre.reduce((t, p) => t + (needed.has(p) ? worth(gainOf(needed.get(p)), p) : 0), 0);
      const cost = 1 + pre.length + (x.runs || !anyRuns ? 0 : 0.75) + (x.odd ? 1.5 : 0) + (advanced(x.c) ? 0.5 : 0);
      // Among equals: one meant for the plans' faculty, what the plans build on, then lower levels (fewer
      // prerequisites to come), then ones that run in more terms.
      const score = gain / cost + 0.02 * fit(x.c) + 0.01 * Math.min(leads.get(x.c) ?? 0, 4) - 0.003 * (yearOf(x.c) - 1) + 0.002 * x.runs;
      if (!best || score > best.score) best = { ...x, pre, score };
    }
    if (!best) break;
    for (const p of best.pre) {
      addPlanned(have, p, { units: courses[p]?.[1] ?? UNIT });
      out.push({ code: p, plans: needed.get(p) ?? [], for: best.c });
    }
    addPlanned(have, best.c, { units: courses[best.c]?.[1] ?? UNIT });
    out.push({ code: best.c, plans: best.ks });
  }
  // With a goal and the degree's total units: its free electives, from the courses that fit the goal best (with
  // up to two prerequisites each, which count as electives too), until the degree's units are reached.
  if (goal && total) {
    // The subjects the plans themselves name: a program's own courses are electives only for its students.
    const named = new Set();
    const walk = (nodes) => nodes.forEach((n) => (n.c?.forEach((c) => named.add(numbered(c)?.[0])), n.subj?.forEach((x) => named.add(x)), n.i && walk(n.i)));
    const sec = (x) => (walk(x.r), (x.l ?? []).forEach(sec));
    plans.forEach((p) => p.req.forEach(sec));
    const open = (c) => !OWN_SUBJECTS.has(numbered(c)?.[0]) || named.has(numbered(c)?.[0]);
    const unitsNow = () => [...have].reduce((t, [k, x]) => t + (WORK_COURSE.test(k) || isPlaceholder(k) ? 0 : (x.units ?? UNIT)), 0);
    const pool = [...goal].filter(([c, r]) => r >= 0.12 && courses[c]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 500).map(([c]) => c);
    const none = new Map();
    for (let step = 0; step < limit && unitsNow() < total - 1e-6; step++) {
      let best = null;
      for (const c of pool) {
        const r = rel(c);
        if (best && r + 0.02 <= best.score) break;
        if (!open(c) || !usable(c, have) || odd(c)) continue;
        const pre = prereqs(c, have, none);
        if (!pre || pre.length > 2) continue;
        const cost = 1 + pre.length + (runs(c) || !anyRuns ? 0 : 0.75) + (advanced(c) ? 0.5 : 0);
        const score = (r + pre.reduce((t, p) => t + rel(p), 0)) / cost;
        if (!best || score > best.score) best = { c, pre, score };
      }
      if (!best) break;
      for (const p of best.pre) {
        addPlanned(have, p, { units: courses[p]?.[1] ?? UNIT });
        out.push({ code: p, plans: [], for: best.c, goal: rel(p) });
      }
      addPlanned(have, best.c, { units: courses[best.c]?.[1] ?? UNIT });
      out.push({ code: best.c, plans: [], goal: rel(best.c) });
    }
  }
  if (goal) for (const x of out) x.goal ??= rel(x.code);
  return out;
}

/**
 * Programs still within reach: each one's courses still needed, given what's planned. programs: the data
 * file's list; chosen: slugs already picked; cant: slug → Set of slugs it can't go with.
 */
export function directions(programs, planned, { chosen = [], cant = new Map(), clash = null, courses = {}, types = null } = {}) {
  const out = [];
  for (const p of programs) {
    if (chosen.includes(p.s) || (types && !types.includes(p.t))) continue;
    const r = evaluate(p, planned, { courses });
    if (!r.need) continue;
    const blocked = chosen.filter((c) => (clash ? clash(p.s, c) : cant.get(p.s)?.has(c) || cant.get(c)?.has(p.s)));
    out.push({ p, need: r.need, have: r.have, left: r.need - r.have, unknown: r.unknown, blocked });
  }
  return out.sort((a, b) => a.blocked.length - b.blocked.length || a.left - b.left || b.have - a.have || a.p.n.localeCompare(b.p.n));
}

/** Units total a program states ("Complete a total of 20.0 units"), if any. */
export const totalUnits = (p) => p.tu ?? null;

// The usual short forms of the degrees majors lead to ("Computer Science" is a BCS or a BMath; Psychology a BA or a
// BSc). Ones without a well-known short form keep the name alone.
const DEGREES = {
  'Bachelor of Arts': 'BA',
  'Bachelor of Science': 'BSc',
  'Bachelor of Mathematics': 'BMath',
  'Bachelor of Applied Science': 'BASc',
  'Bachelor of Environmental Studies': 'BES',
  'Bachelor of Computer Science': 'BCS',
  'Bachelor of Accounting and Financial Management': 'BAFM',
  'Bachelor of Computing and Financial Management': 'BCFM',
  'Bachelor of Software Engineering': 'BSE',
  'Bachelor of Knowledge Integration': 'BKI',
  'Bachelor of Global Business and Digital Arts': 'BGBDA',
  'Bachelor of Architectural Studies': 'BAS',
  'Bachelor of Public Health': 'BPH',
  'Bachelor of Social Work': 'BSW',
  'Bachelor of Business Administration': 'BBA',
  'Doctor of Optometry': 'OD',
  'Doctor of Pharmacy': 'PharmD',
};
/**
 * A plan's short name and kind, for chips and lists, and what the calendar's name says it's of: "Computer Science"
 * · BCS Honours (of Bachelor of Computer Science), "Financial Markets" · Specialization (of Accounting and Financial
 * Management), "Economics" · Minor, "Business and Entrepreneurship" · Diploma. The calendar's whole name stays the
 * title.
 */
export function planParts(p) {
  if (!p) return { name: '', kind: '', of: '' };
  const n = String(p.n ?? '');
  const par = /\s*\(([^()]*)\)\s*$/.exec(n);
  const bare = par ? n.slice(0, par.index) : n;
  if (p.t === 'Major') {
    // "(Bachelor of Arts - Honours)", "(Joint Honours)", or two degrees: "(Bachelor of Arts - Three-Year General and
    // Bachelor of Social Work - Honours)", "(Bachelor of Business Administration and Bachelor of Mathematics - Honours)".
    const parts = (par?.[1] ?? '').split(/ and (?=Bachelor of |Doctor of )/).filter(Boolean);
    const degrees = [];
    const kind = parts
      .map((x) => {
        const m = /^(?:(.*?)\s*[-–,]\s*)?(Joint Honours.*|Honours|Four-Year General|Three-Year General)$/.exec(x);
        const degree = m ? (m[1] ?? '') : x;
        if (degree) degrees.push(degree);
        return [DEGREES[degree] ?? (parts.length > 1 ? degree : ''), m?.[2]].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join(' and ');
    return { name: bare || n, kind: kind || 'Major', of: degrees.join(' and ') };
  }
  if (p.t === 'Degree Requirements') return { name: bare.replace(/\s*Degree Requirements$/, '') || n, kind: 'Degree requirements', of: par?.[1] ?? '' };
  if (p.t === 'Specialization') return { name: bare.replace(/\s+Specialization$/, '') || n, kind: 'Specialization', of: par?.[1] ?? '' };
  const name = n.replace(/^(?:Diploma|Certificate) in /, '').replace(/\s+(?:Minor|Option|Diploma|Certificate)$/, '');
  return { name: name || n, kind: p.t, of: '' };
}

const COLLEGES = /(Renison|Conrad Grebel|St\. Jerome's|United)/;
/**
 * Where a plan sits, the way the calendar listed academic plans: "Faculty of Arts with Renison University College"
 * is Arts, at Renison; "Faculties of Engineering and Mathematics" a group of its own; none (EDGE) no group ('').
 */
export function facultyOf(p) {
  const f = String(p?.f ?? '');
  const college = new RegExp(`(?:with |^)${COLLEGES.source}`).exec(f)?.[1] ?? null;
  const one = /^Faculty of ([A-Za-z]+)/.exec(f)?.[1];
  if (one) return { group: one, college };
  const joint = /^Faculties of (.+)$/.exec(f)?.[1];
  if (joint) return { group: joint.replace(/,? and /g, ' and '), college: null };
  return { group: college ? 'Arts' : '', college };
}
/** Faculties in the calendar's order, then joint ones A to Z, then plans in none. */
export const FACULTY_ORDER = ['Arts', 'Engineering', 'Environment', 'Health', 'Mathematics', 'Science'];
export const facultyRank = (g) => (FACULTY_ORDER.includes(g) ? FACULTY_ORDER.indexOf(g) : g ? 50 : 99);

// ---------------- every plan, laid out ----------------

/** The row a plan sits in: its field ("Economics"), its faculty's options ("Options"), or its own name. */
export const fieldOf = (p) => (/^Options\b/.test(p?.fi ?? '') ? 'Options' : p?.fi || planParts(p).name);

const KIND_ORDER = { Major: 0, Minor: 1, Diploma: 2, Certificate: 3, Option: 4, Specialization: 5 };
const majorRank = (kind) => (/Joint/.test(kind) ? 1 : /Four-Year/.test(kind) ? 2 : /Three-Year/.test(kind) ? 3 : 0);
/**
 * Every plan laid out the way the calendar's lists of academic plans had them: by faculty, then field, A to Z. A
 * field's row has its majors (honours, joint, general), minor, diplomas and the specializations for its majors
 * ("Economics": two majors, a minor, four specializations); a faculty's options share a row. Degree requirements
 * aren't plans to pick. → [{group, rows: [{field, college, plans}]}]
 */
export function byField(programs) {
  // A plan an earlier calendar gave no faculty goes with its field's (Sustainability, AFM's specialization, in Arts).
  const fieldFaculty = new Map();
  for (const p of programs) if (p.f && p.fi && !fieldFaculty.has(p.fi)) fieldFaculty.set(p.fi, p.f);
  const groups = new Map();
  for (const p of programs) {
    if (p.t === 'Degree Requirements') continue;
    const { group } = facultyOf(p.f ? p : { ...p, f: fieldFaculty.get(p.fi) ?? '' });
    const field = fieldOf(p);
    if (!groups.has(group)) groups.set(group, new Map());
    const rows = groups.get(group);
    if (!rows.has(field)) rows.set(field, []);
    rows.get(field).push(p);
  }
  // The field's own majors first (honours, joint, general), then double degrees; minors, diplomas, specializations.
  const order = (field) => (a, b) => {
    const [pa, pb] = [planParts(a), planParts(b)];
    const majors = a.t === 'Major' && b.t === 'Major' ? (pa.name !== field) - (pb.name !== field) || majorRank(pa.kind) - majorRank(pb.kind) : 0;
    return (KIND_ORDER[a.t] ?? 9) - (KIND_ORDER[b.t] ?? 9) || majors || pa.name.localeCompare(pb.name) || a.n.localeCompare(b.n);
  };
  return [...groups]
    .sort((a, b) => facultyRank(a[0]) - facultyRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([group, rows]) => ({
      group,
      rows: [...rows]
        .sort((a, b) => (a[0] === 'Options') - (b[0] === 'Options') || a[0].localeCompare(b[0]))
        .map(([field, plans]) => {
          const colleges = new Set(plans.map((p) => facultyOf(p).college));
          return { field, college: colleges.size === 1 ? [...colleges][0] : null, plans: plans.sort(order(field)) };
        }),
    }));
}

/**
 * What a plan is taken with, as its rules say, and the plans that fit. Arts and Business: "Complete the
 * requirements for a Faculty of Arts honours major or Honours Liberal Studies" (any not in the invalid
 * combinations). A plan open only to some majors (a specialization, most options): one of those. A joint major
 * goes with another major too, but which ones differ by department (its page says), so it names none.
 * → {text, plans} or null.
 */
export function takenWith(p, programs) {
  if (!p) return null;
  const fits = (q) => q.s !== p.s && !(p.cant ?? []).includes(q.s) && !(q.cant ?? []).includes(p.s);
  if (p.t === 'Major' && p.fi === 'Arts and Business') {
    const plans = programs.filter((q) => q.t === 'Major' && fits(q) && facultyOf(q).group === 'Arts' && planParts(q).kind === 'BA Honours');
    return { text: 'Taken with a Faculty of Arts honours major or Honours Liberal Studies', plans };
  }
  if (p.t === 'Major' && /Joint Honours/.test(planParts(p).kind)) return { text: 'A joint major, taken with another major; its page says which', plans: [] };
  const plans = (p.open ?? []).map((s) => programs.find((q) => q.s === s)).filter(Boolean);
  return plans.length ? { text: plans.length === 1 ? 'For students in' : 'For students in one of', plans } : null;
}

/**
 * Graduate programs (grad.json's list) for what's typed into the plan box: "master", "phd", "doctor", "mmath cs",
 * "ma economics", "graduate diploma". Every word typed starts one of the program's words (its name, degree, subject,
 * field, unit, faculty, and what its kind is called: master's, masters, doctoral, doctorate, graduate, grad), best
 * first: the subject or field first, then master's, PhDs, diplomas. grad: whether what's typed asks for graduate
 * programs at all ("master", "phd", an MMath), so they can come before undergraduate plans.
 */
const GRAD_KIND_WORDS = {
  "Master's": ['master', 'masters', 'graduate', 'grad', 'postgraduate'],
  PhD: ['phd', 'doctor', 'doctoral', 'doctorate', 'graduate', 'grad', 'postgraduate'],
  'Graduate Diploma': ['diploma', 'graduate', 'grad', 'gdip', 'postgraduate'],
};
const gradIndex = new WeakMap();
const gradTokens = (text) => planTokens(String(text ?? '').replace(/[’']/g, ''));
function gradWords(g) {
  if (!gradIndex.has(g)) {
    // Like a plan's: the subjects most of its named courses are in ("cs" finds the MMath in Computer Science).
    const count = new Map();
    let n = 0;
    for (const r of g.req ?? []) {
      for (const c of r.c ?? []) {
        const sj = /^[A-Z]+/.exec(c)?.[0];
        if (!sj) continue;
        count.set(sj, (count.get(sj) ?? 0) + 1);
        n++;
      }
    }
    gradIndex.set(g, {
      subject: gradTokens(g.su || g.fi),
      name: gradTokens(g.n),
      other: [...new Set([...gradTokens(`${g.fi ?? ''} ${g.v ?? ''} ${g.u ?? ''} ${g.f ?? ''} ${g.d}`), ...(GRAD_KIND_WORDS[g.t] ?? []), ...(/accelerated/i.test(g.d) ? GRAD_KIND_WORDS["Master's"] : [])])],
      codes: [...count].filter(([, k]) => k >= 2 && k / n >= 0.25).map(([sj]) => sj.toLowerCase()),
    });
  }
  return gradIndex.get(g);
}
const GRAD_ASK = ['master', 'masters', 'phd', 'doctor', 'doctoral', 'doctorate', 'graduate', 'postgraduate', 'gdip', 'accelerated', 'grad'];
export function gradHits(list, text) {
  const words = gradTokens(text).filter((w) => !['program', 'programs', 'degree', 's'].includes(w));
  if (!words.length || !list?.length) return { hits: [], grad: false };
  // Asking for graduate programs: one of the words for them (or the start of one: "mast", "doc"), or a graduate
  // degree's letters ("mmath", "masc"; "ma" only with more words, since it starts "math" too).
  const degrees = new Set(list.map((g) => g.d.toLowerCase()));
  const grad = words.some((w) => GRAD_ASK.some((a) => a === w || (w.length >= 3 && a.startsWith(w))) || (degrees.has(w) && (w.length >= 3 || words.length > 1)));
  const KIND = ["Master's", 'PhD', 'Graduate Diploma'];
  const hits = list
    .map((g) => {
      const x = gradWords(g);
      let score = 0;
      for (const w of words) {
        const sub = wordMatch(w, x.subject).s;
        const oth = wordMatch(w, x.other).s;
        const best = Math.max(sub ? sub + 1 : 0, wordMatch(w, x.name).s, oth ? oth - 0.5 : 0, x.codes.includes(w) ? 3.5 : 0);
        if (best <= 0) return null;
        score += best;
      }
      return { g, score: score + (words.includes(g.d.toLowerCase()) ? 1 : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || KIND.indexOf(a.g.t) - KIND.indexOf(b.g.t) || /ccelerated/.test(a.g.d) - /ccelerated/.test(b.g.d) || a.g.n.localeCompare(b.g.n))
    .map((x) => x.g);
  return { hits, grad };
}

/**
 * The undergraduate plans that lead to a graduate program, from where Pathways starts: majors (then minors and
 * specializations) in its field, or named for its subject ("Economics" for an MA in Economics; "Statistics" for an
 * MMath in Statistics - Biostatistics). Its own field's honours majors first.
 */
export function gradLeads(g, programs) {
  const stem = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const keys = new Set([stem(g.fi), stem(g.su)].filter(Boolean));
  const hit = (p) => keys.has(stem(fieldOf(p))) || keys.has(stem(planParts(p).name));
  const order = ['Major', 'Specialization', 'Minor'];
  const rank = (p) => order.indexOf(p.t) * 10 + (/Joint Honours/.test(p.n) ? 1 : /General/.test(p.n) ? 2 : 0);
  return programs.filter((p) => order.includes(p.t) && hit(p)).sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n));
}

/** Plans open only to some majors that are open to this one: its specializations (the only plans that list majors). */
export const openTo = (major, programs) => programs.filter((q) => q.s !== major.s && q.open?.includes(major.s));

/**
 * What keeps two majors apart beyond the calendar's table (which data.json's cant has): two versions of one major
 * (Economics' BA Honours and its Four-Year General; Computer Science's BCS and BMath; English's Literature and its
 * Rhetoric), and two of the calendar's general rules: in a BA a general major with any other ("When pursuing a
 * Bachelor of Arts, students may combine two honours major academic plans only"), and "A stand-alone Bachelor of
 * Computer Science (BCS) academic plan with any Bachelor of Mathematics (BMath) academic plan (including Joint
 * Honours academic plans)". → why, in a few words, or ''. Majors from two faculties can still pair, as joint honours
 * plans or a concurrent degree, so a different degree alone isn't a reason.
 */
export function majorsClash(a, b, ctx = {}) {
  if (!a || !b || a.s === b.s || a.t !== 'Major' || b.t !== 'Major') return '';
  if (fieldOf(a) === fieldOf(b)) return `two versions of ${fieldOf(a)}`;
  const pa = planParts(a);
  const pb = planParts(b);
  const ba = (x) => x.of === 'Bachelor of Arts';
  if (ba(pa) && ba(pb) && (/General/.test(pa.kind) || /General/.test(pb.kind))) return 'a BA combines two honours majors only, not a general one';
  const bcs = (x) => x.of === 'Bachelor of Computer Science' && !/Joint/.test(x.kind);
  const bmath = (p, x) => x.of === 'Bachelor of Mathematics' || (!x.of && /Joint Honours/.test(p.n) && /Mathematics/.test(p.f ?? ''));
  if ((bcs(pa) && bmath(b, pb)) || (bcs(pb) && bmath(a, pa))) return 'a stand-alone BCS doesn’t combine with any BMath plan';
  // "A stand-alone BMath Joint Honours academic plan with any non-Mathematics Joint Honours academic plan."
  const jh = (p) => /Joint Honours/.test(p.n);
  const mathJH = (p, x) => jh(p) && bmath(p, x);
  const otherJH = (p) => jh(p) && !/Mathematics/.test(p.f ?? '');
  if ((mathJH(a, pa) && otherJH(b)) || (mathJH(b, pb) && otherJH(a))) return 'a BMath joint honours plan doesn’t combine with another faculty’s joint honours plan';
  // "Data Science (BMath or BCS) with any other Faculty of Mathematics Honours or Joint Honours academic plan, except
  // that the BCS (Data Science) can make up the BCS component of the Business Administration and Computer Science
  // double degree program."
  const ds = (p) => fieldOf(p) === 'Data Science';
  const mathHonours = (p, x) => /Mathematics/.test(p.f ?? '') && /Honours/.test(x.kind || p.n);
  for (const [p, x, q, y] of [
    [a, pa, b, pb],
    [b, pb, a, pa],
  ]) {
    if (ds(p) && mathHonours(q, y) && !(x.of === 'Bachelor of Computer Science' && /Business Administration and Computer Science/.test(q.n))) return 'Data Science doesn’t combine with another Faculty of Mathematics honours plan';
  }
  // "A stand-alone BCS Honours co-operative academic plan or BMath Honours co-operative academic plan with any
  // stand-alone regular Honours academic plan (including Joint Honours academic plans)": with work terms in the grid,
  // not with an honours plan that has no co-op.
  if (ctx.coop) {
    const coopMath = (x) => (x.of === 'Bachelor of Computer Science' || x.of === 'Bachelor of Mathematics') && /Honours/.test(x.kind) && !/Joint/.test(x.kind);
    const regularOnly = (p, x) => p.re && !p.co && /Honours/.test(x.kind || p.n);
    if ((coopMath(pa) && regularOnly(b, pb)) || (coopMath(pb) && regularOnly(a, pa))) return 'in co-op, a BCS or BMath honours plan doesn’t combine with an honours plan that has no co-op';
  }
  return '';
}

const OTHER_KINDS = ['Minor', 'Option', 'Diploma', 'Certificate'];
const subjectStem = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** The subject a plan is in: a major's or minor's field, an option's name ("Software Engineering Option": software engineering). */
const subjectOf = (p) => subjectStem(p.t === 'Option' || /^Options\b/.test(p.fi ?? '') ? planParts(p).name : p.fi || planParts(p).name);

/**
 * The calendar's general rules on combining credentials (above the table on its Invalid Credential Combinations
 * page; data.json's cant has the table): why two plans can't be taken together, or ''. Two majors as in
 * majorsClash; "two credentials with significant overlapping content": a minor, option, diploma or certificate in the
 * same subject as a major, a minor and a diploma in the same subject, two diplomas in the same language; a BAS
 * student and a Faculty of Engineering option that doesn't say it's for them; a BMSc student and a Faculty of Science
 * minor or option. ctx.coop: the grid has work terms.
 */
export function planClash(a, b, ctx = {}) {
  if (!a || !b || a.s === b.s) return '';
  const two = majorsClash(a, b, ctx);
  if (two) return two;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const px = planParts(x);
    if (x.t === 'Major' && OTHER_KINDS.includes(y.t) && [subjectStem(fieldOf(x)), subjectStem(px.name)].includes(subjectOf(y))) return `${y.t === 'Option' ? 'an option' : `a ${y.t.toLowerCase()}`} in the same subject as a major`;
    if (x.t === 'Minor' && y.t === 'Diploma' && subjectOf(x) === subjectOf(y)) return 'a minor and a diploma in the same subject';
    if (x.t === 'Major' && px.of === 'Bachelor of Architectural Studies' && y.t === 'Option' && /Engineering/.test(y.f ?? '') && !(y.deg ?? []).includes('Bachelor of Architectural Studies')) return 'a BAS student takes only the Faculty of Engineering options that allow it';
    if (x.t === 'Major' && px.of === 'Bachelor of Medical Sciences' && (y.t === 'Minor' || y.t === 'Option') && /\bScience\b/.test(y.f ?? '')) return 'a BMSc student takes no Faculty of Science minor or option';
  }
  const language = (p) => (p.t === 'Diploma' ? /^(.+?) Language(?: (?:I{1,3}|[1-3]))?$/.exec(planParts(p).name)?.[1] : null);
  if (language(a) && language(a) === language(b)) return 'two diplomas in the same language';
  return '';
}

/**
 * A major's degrees the way an option's "available to" list names them: "Bachelor of Applied Science", and for a
 * degree more than one faculty gives, with the faculty too ("Bachelor of Science (Science)", "(Health)").
 */
export function degreeNames(major) {
  if (major?.t !== 'Major') return [];
  const g = facultyOf(major).group;
  return planParts(major)
    .of.split(/ and (?=Bachelor of |Doctor of )/)
    .filter(Boolean)
    .flatMap((d) => [d, `${d} (${g})`]);
}
/** The options open to a major's degree: an engineering major's thirteen, a BSc in Science's five. */
export function optionsFor(major, programs) {
  const names = new Set(degreeNames(major));
  return names.size ? programs.filter((q) => q.t === 'Option' && q.deg?.some((d) => names.has(d))) : [];
}

const FACULTY_SHORT = { Mathematics: 'Math' };
/**
 * Whether a plan is open to someone with these majors, from what the calendar says (scripts/lib/pathways.mjs's
 * eligibility): {ok, tag, why}. Paused, or only for students outside a degree: not ok. Only for one faculty's
 * students: not ok once a major in another is picked; with none picked, tagged. → tag: a few words for a chip.
 */
export function whoFor(p, majors = []) {
  const faculties = new Set(majors.map((m) => facultyOf(m).group));
  const short = (f) => FACULTY_SHORT[f] ?? f;
  if (p.paused) return { ok: false, tag: 'paused', why: p.who };
  if (p.nd) return { ok: false, tag: 'not for degree students', why: p.who };
  if (p.lim) return { ok: !faculties.size || faculties.has(p.lim), tag: `${short(p.lim)} students only`, why: p.who };
  if (p.notf) return { ok: !faculties.has(p.notf), tag: `not for ${short(p.notf)} students`, why: p.who };
  if (p.soft) return { ok: true, tag: `mostly ${short(p.soft)} students`, why: p.who };
  return { ok: true, tag: '', why: '' };
}

// ---------------- entry programs ----------------
// What first-years apply to before they choose a major (uwaterloo.ca/future-students/programs/majors-and-entry-
// programs, as of November 2026; the calendar has majors, not these). Honours Arts leads to any Faculty of Arts BA
// major; Honours Arts and Business to the honours ones it's taken with (takenWith). The rest are fields, with the
// degree when a field has majors in two (Psychology's BSc is Life Sciences', its BA Honours Arts').
export const ENTRY_PROGRAMS = [
  { name: 'Honours Arts', arts: 'all' },
  { name: 'Honours Arts and Business', arts: 'arbus' },
  { name: 'Mathematics', fields: ['Actuarial Science', 'Applied Mathematics', 'Biostatistics', 'Combinatorics and Optimization', 'Computational Mathematics', ['Data Science', 'BMath'], 'Information Technology Management', ['Mathematical Economics', 'BMath'], 'Mathematical Finance', 'Mathematical Optimization', ['Mathematical Physics', 'BMath'], 'Mathematical Studies', 'Mathematics', 'Mathematics and Teaching', 'Pure Mathematics', 'Statistics'] },
  { name: 'Computer Science', fields: [['Computer Science', 'BCS'], ['Data Science', 'BCS']] },
  { name: 'Life Sciences', fields: ['Biochemistry', 'Biology', 'Biomedical Sciences', ['Psychology', 'BSc']] },
  { name: 'Physical Sciences', fields: ['Biological and Medical Physics', 'Chemistry', 'Earth Sciences', 'Materials and Nanosciences', ['Mathematical Physics', 'BSc'], 'Medicinal Chemistry', 'Physics', 'Physics and Astronomy'] },
  { name: 'Recreation and Leisure Studies', fields: ['Recreation, Leadership, and Health', 'Sport and Recreation Management', 'Therapeutic Recreation'] },
];
/**
 * The majors an entry program leads to, and a test for the plans in their fields (their minors and
 * specializations too): {majors, has(plan)}.
 */
export function entryProgram(name, programs) {
  const e = ENTRY_PROGRAMS.find((x) => x.name === name);
  if (!e) return null;
  const isMajor = (p) => p.t === 'Major';
  let majors;
  if (e.arts === 'arbus') majors = takenWith(programs.find((p) => isMajor(p) && p.fi === 'Arts and Business'), programs)?.plans ?? [];
  else if (e.arts) majors = programs.filter((p) => isMajor(p) && p.fi !== 'Arts and Business' && facultyOf(p).group === 'Arts' && planParts(p).of === 'Bachelor of Arts');
  else {
    const want = new Map(e.fields.map((f) => (Array.isArray(f) ? f : [f, ''])));
    // A joint major is a second plan, not a first-year's choice; nor is a double degree.
    majors = programs.filter((p) => isMajor(p) && want.has(p.fi) && planParts(p).kind.startsWith(want.get(p.fi)) && !/Joint Honours|^BBA/.test(planParts(p).kind) && !/Double Degree$/.test(planParts(p).name));
  }
  const fields = new Set(majors.map((p) => p.fi));
  const chosen = new Set(majors.map((p) => p.s));
  return { majors, has: (p) => (isMajor(p) ? chosen.has(p.s) : fields.has(p.fi)) };
}

// ---------------- finding a plan by name ----------------
// Names stay the calendar's, but a search (app.js's plan box) finds a plan the way people say it: each word typed
// is the start of a word in the name ("math/cpa", "bio cpa"), the starts of a run of words in it ("cpa" =
// Chartered Professional Accountancy, "syde" = SYstems DEsign, "pmath"), a subject most of its courses are in
// ("cs" is Computer Science's, not Classical Studies'), or a word of its code ("bba", "farm").
const PSTOP = new Set(['and', 'of', 'the', 'in', 'for', 'with', 'a', 'an', 'to']);
// Short forms that aren't the start of anything in the name.
const PALIAS = { stats: ['statistics'], stat: ['statistics'], tron: ['mechatronics'], ece: ['electrical engineering', 'computer engineering'], bme: ['biomedical engineering'], mgmt: ['management'], biz: ['business'], intl: ['international'], hlth: ['health'], psci: ['political science'], polisci: ['political science'], compsci: ['computer science'] };
// Names the admissions site, a department's pages or an earlier calendar use for a plan the calendar names
// otherwise. Searched as well as what's typed, not instead (2021–23's calendars still have Financial Leadership).
const PLAN_PHRASES = [
  [/\bgeospatial data analysis\b|\bgeomatics\b/, 'geospatial data science'],
  [/\barchitecture\b/, 'architectural studies'],
  [/\bfinancial economics\b/, 'finance specialization economics'],
  [/\bfinancial leadership\b/, 'enterprise performance and risk'],
  [/\bhonours arts and business\b/, 'arts and business'],
  [/\bhonours science\b/, 'science bachelor of science honours'],
];
/** The searches for what's typed: itself, then each name it's known by (as planTokens). */
export function planQueries(text) {
  const t = String(text ?? '').toLowerCase();
  const out = [planTokens(t)];
  for (const [re, to] of PLAN_PHRASES) if (re.test(t)) out.push(planTokens(t.replace(re, to)));
  return out;
}
/** A plan's score for planQueries: the best of them, a name it's known by counting for more than words in common. */
export function planBest(p, queries) {
  return Math.max(0, ...queries.map((t, i) => {
    const sc = planScore(p, t);
    return sc && i ? sc + 5 : sc;
  }));
}
/** A plan search's words: lowercase, "&" as and, common words out; "c&o" as "co". */
export const planTokens = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\bc\s*&\s*o\b/g, 'co')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !PSTOP.has(w));
const planIndex = new WeakMap();
export function planWords(p) {
  let x = planIndex.get(p);
  if (!x) {
    // The subjects most of its named courses are in (CS for Computer Science, CLAS for Classical Studies), so a
    // subject code typed ("cs", "econ", "syde", "ece") finds the plans built on it.
    const count = new Map();
    let n = 0;
    const nodes = (list) => {
      for (const node of list ?? []) {
        for (const code of node.c ?? []) {
          const subj = /^[A-Z]+/.exec(code)?.[0];
          if (!subj) continue;
          count.set(subj, (count.get(subj) ?? 0) + 1);
          n++;
        }
        nodes(node.i);
      }
    };
    const walk = (sec) => {
      nodes(sec.r);
      for (const l of sec.l ?? []) walk(l);
    };
    for (const sec of p.req ?? []) walk(sec);
    const subjects = [...count].filter(([, k]) => k >= 3 && k / n >= 0.25).map(([sj]) => sj.toLowerCase());
    x = { name: planTokens(p.n), other: planTokens(`${p.t} ${p.fi ?? ''} ${p.c ?? ''}`), subjects };
    planIndex.set(p, x);
  }
  return x;
}
/** How a typed word matches a name's words: {s, at}. s: 4 a whole word, 3.5 the initials of a run of words
 *  ("cpa"), 3.2 a word's start ("mech"), 2.8 the starts of a run of words ("pmath", "syde"), 2.5 a word's
 *  first two letters, 0 none; at: the word it starts at. */
export function wordMatch(t, words) {
  let best = { s: 0, at: 99 };
  const keep = (s, at) => {
    if (s > best.s || (s === best.s && at < best.at)) best = { s, at };
  };
  const run = (pos, j, pieces, initials) => {
    if (pos === t.length) return pieces >= 2 ? (initials ? 3.5 : 2.8) : 0;
    if (j >= words.length) return 0;
    let b = 0;
    for (let len = Math.min(t.length - pos, words[j].length); len >= 1; len--) if (t.startsWith(words[j].slice(0, len), pos)) b = Math.max(b, run(pos + len, j + 1, pieces + 1, initials && len === 1));
    return b;
  };
  words.forEach((w, i) => {
    if (w === t) keep(4, i);
    else if (w.startsWith(t)) keep(t.length >= 3 ? 3.2 : 2.5, i);
    if (t.length >= 2) keep(run(0, i, 0, true), i);
  });
  return best;
}
/** A plan's score for the words typed: 0 unless every word matches. Better matches, and ones at the start of
 *  the name, score higher. */
export function planScore(p, tokens) {
  const w = planWords(p);
  let total = 0;
  let first = 99;
  for (const t of tokens) {
    const m = wordMatch(t, w.name);
    // Every way it matches the name or the plan's subjects: the best counts, the others a little ("co" is C&O's
    // initials and its subject). Its code and kind ("CPA-Finance Specialization", "Minor") only when nothing else does.
    const ways = [m.s, w.subjects.includes(t) ? 4 : 0, (PALIAS[t] ?? []).some((alt) => planTokens(alt).every((x) => w.name.some((y) => y.startsWith(x)))) ? 3 : 0].filter(Boolean);
    const code = w.other.includes(t) ? 3 : w.other.some((x) => x.startsWith(t)) ? 1.5 : 0;
    if (!ways.length && !code) return 0;
    const top = Math.max(code, ...ways);
    total += top + 0.1 * (ways.reduce((a, b) => a + b, 0) - Math.max(0, ...ways));
    first = Math.min(first, m.s ? m.at : 99);
  }
  return total + (first === 0 ? 1 : 0);
}
