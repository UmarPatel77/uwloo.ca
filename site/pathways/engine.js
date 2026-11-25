// uwloo.ca/pathways: the rules, with no DOM, so the build's tests can run them too.
//
// Requirement trees (programs) and requisite trees (courses) share one compact shape, written by
// scripts/lib/pathways.mjs from the calendar's rules:
//   {g: 'all'|'n', n, i: [nodes]}                       a group ("Complete 1 of the following")
//   {r: 'all'|'n'|'any'|'max'|'not'|'list', n, c: [codes]} a rule over listed courses
//   {t: text, lv, en, u, nc, subj, min}                 words: a level ("3A"), a plan to be enrolled in, or units
//                                                        or courses from the section's lists or from subjects
// A program's requirements are sections: {h: heading, u: units, r: [nodes], l: [sections]}.
// A course is [title, units, prereq, coreq, antireq codes, [Fall, Winter, Spring] terms run lately, cross-listed,
// gone]: gone is 1 when it isn't in the current calendar.

export const UNIT = 0.5; // a usual course, for turning units into a number of courses

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

function holdsNode(n, have, ctx) {
  if (n.g) {
    const vals = n.i.map((c) => holdsNode(c, have, ctx));
    return n.g === 'n' ? atLeast(vals, n.n ?? 1) : all(vals);
  }
  if (n.r) {
    const hits = n.c.filter((c) => has(have, c, ctx)).length;
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
export const antiCodes = (nodes) => (nodes ?? []).flatMap((n) => (n.g ? antiCodes(n.i) : n.r ? n.c : []));

/** Courses a requisite tree names that aren't done: what to add first. */
export const missing = (nodes, have, ctx = {}) => why(nodes, have, ctx).codes;

/** Why a requisite tree fails: {codes: courses to add, level: 'nX' needed, plans: ["H-Software Engineering"…]}. */
export function why(nodes, have, ctx = {}) {
  const codes = new Set();
  let level = null;
  const plans = new Set();
  const walk = (list) => {
    for (const n of list ?? []) {
      if (holdsNode(n, have, ctx) !== false) continue;
      if (n.g) walk(n.i);
      else if (n.r && n.r !== 'not') for (const c of n.c) if (!has(have, c, ctx)) codes.add(c);
      if (n.lv && (!level || levelRank(n.lv) > levelRank(level))) level = n.lv;
      if (n.en) plans.add(n.en);
    }
  };
  walk(nodes);
  return { codes: [...codes], level, plans: [...plans] };
}

// ---------------- programs ----------------

/**
 * How far a set of courses gets through a program. planned: Map code → {units}. ticked: Set of keys the person
 * marked done by hand (for requirements in words). → {need, have, rows: [...], used: Set, unknown}
 * need and have count courses (units ÷ 0.5); rows describe every requirement for the checklist; unknown is
 * true while a requirement in words isn't ticked (those aren't in need: they may not be a course).
 */
export function evaluate(program, planned, { ticked = new Set(), courses = {} } = {}) {
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
  const takeUnits = (codes, units) => {
    const got = [];
    let sum = 0;
    for (const c of codes) {
      if (sum >= units - 1e-9) break;
      if (planned.has(c) && !used.has(c)) {
        got.push(c);
        sum += unitsOf(c);
      }
    }
    return { got, sum };
  };
  const subjectPool = (n) =>
    [...planned.keys()].filter((c) => {
      const m = /^([A-Z]+)(\d+)/.exec(c);
      if (!m) return false;
      const num = Number(m[2]);
      if (n.rg) return n.rg.some(([s, lo, hi]) => s === m[1] && num >= lo && num <= hi);
      return n.subj.includes(m[1]) && (!n.min || num >= n.min * 100);
    });

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
      const codes = n.subj || n.rg ? subjectPool(n) : n.pl ? pool : null;
      if (codes?.length || n.subj || n.rg) {
        if (n.u) {
          const { got, sum } = takeUnits(codes, n.u);
          for (const c of got) used.add(c);
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
    const got = [...planned.keys()].filter((c) => subj.includes(/^[A-Z]+/.exec(c)?.[0]));
    const sum = got.reduce((s, c) => s + unitsOf(c), 0);
    emit({ key: 'total', depth: 0, kind: 'units', text: `A total of ${program.tsub.u} units of ${subj.join(', ')} courses`, units: program.tsub.u, sum, got });
    const tn = Math.round(program.tsub.u / UNIT);
    if (tn > need) {
      have = Math.max(have, Math.min(tn, Math.round(sum / UNIT)));
      need = tn;
    }
  } else if (program.tu && Math.round(program.tu / UNIT) > need) need = Math.round(program.tu / UNIT);
  return { need, have, rows, used, unknown };
}
const rank = (n) => (n.r === 'all' ? 0 : n.g ? 1 : n.r === 'n' ? 2 : n.r === 'not' || n.r === 'max' ? 4 : n.t ? 3 : 5);

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
