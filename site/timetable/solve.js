// uwloo.ca/timetable: finds the best timetables for a set of courses. Runs in a worker in the browser, and in
// the tests (scripts/test.mjs). No DOM here.
//
// A course needs one section of each kind it has (LEC, TUT, LAB, TST…). A tutorial or lab goes with the lecture
// whose associated-class number it shares, or with any lecture when its number is 99 (or 0 or missing: unknown;
// Open Data gives 0 for every section as of Winter 2027). Sections that meet at the
// same times are one choice ("LEC 002 or LEC 006"), so the search doesn't try the same timetable twice.
//
// The search is depth-first with a bound: every cost below only grows as classes are added, so a partial
// timetable that already costs more than the worst of the best `keep` found so far is dropped.

export const DAYS = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
export const COMP_ORDER = ['LEC', 'SEM', 'STU', 'LAB', 'TUT', 'TST', 'PRA', 'CLN', 'RDG', 'ESS', 'PRJ', 'WRK', 'FLD', 'DIS', 'OLN'];
const rank = (c) => COMP_ORDER.indexOf(c) + 1 || 99;
const ANY = 99;
const bits = (mask) => {
  let n = 0;
  for (let m = mask & 127; m; m &= m - 1) n++;
  return n;
};

/** "2027-01-06" → its weekday's bit (M = 1, T = 2, W = 4, Th = 8, F = 16, Sa = 32, Su = 64). */
export function dayBit(date) {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return 1 << ((d + 6) % 7);
}
export const maskText = (mask) => DAYS.filter((_, i) => mask & (1 << i)).join('');

/**
 * One section from a term file, [comp, sec, assoc, class, cap, enrolled, meets], with meets as
 * [days, start, end] (weekly, the term's usual weeks), [days, start, end, from, to] (weekly, other weeks) or
 * [days, start, end, date] (one day). Times are minutes after midnight.
 *
 * A test's one-day meeting becomes {one: true}: it may overlap a class, at a cost. Other one-day meetings (labs
 * on given dates, say) are gathered by weekday and time into {dates: [...]}: they're classes, on those dates only.
 */
export function readSection(row, term = {}) {
  const [comp, sec, assoc = null, cls = null, cap = null, enrl = null, raw = []] = row;
  const meets = [];
  const dated = new Map();
  for (const m of raw) {
    if (!Number.isFinite(m[1]) || !Number.isFinite(m[2]) || m[2] <= m[1]) continue;
    if (m.length === 4) {
      const mask = dayBit(m[3]);
      if (comp === 'TST') {
        meets.push({ mask, s: m[1], e: m[2], from: m[3], to: m[3], one: true });
        continue;
      }
      const k = `${mask},${m[1]},${m[2]}`;
      if (!dated.has(k)) dated.set(k, { mask, s: m[1], e: m[2], dates: [], from: null, to: null, one: false });
      dated.get(k).dates.push(m[3]);
    } else if (m[0]) meets.push({ mask: m[0], s: m[1], e: m[2], from: m[3] ?? term.from ?? null, to: m[4] ?? term.to ?? null, one: false });
  }
  for (const d of dated.values()) {
    d.dates = [...new Set(d.dates)].sort();
    d.from = d.dates[0];
    d.to = d.dates.at(-1);
    meets.push(d);
  }
  const full = Number.isFinite(cap) && cap > 0 && Number.isFinite(enrl) && enrl >= cap;
  return { comp, sec, assoc, cls, cap, enrl, meets, full, online: !meets.length };
}

/** Two meetings at the same time on a shared day, in weeks that overlap (on a shared date, for dated ones). */
export function clash(a, b) {
  if (!(a.s < b.e && b.s < a.e && (a.mask & b.mask) !== 0)) return false;
  if ((a.from && b.to && a.from > b.to) || (b.from && a.to && b.from > a.to)) return false;
  if (a.dates && b.dates) return a.dates.some((d) => b.dates.includes(d));
  if (a.dates) return a.dates.some((d) => (!b.from || d >= b.from) && (!b.to || d <= b.to));
  if (b.dates) return b.dates.some((d) => (!a.from || d >= a.from) && (!a.to || d <= a.to));
  return true;
}
// Weekly classes can't overlap. A one-day meeting (a midterm, say) overlapping a class costs instead of ruling the
// timetable out: Waterloo arranges another sitting for a test that clashes with a class or another test.
const clashesAny = (meets, placed) => meets.some((m) => !m.one && placed.some((p) => !p.one && clash(m, p)));
const testOverlaps = (meets, placed) => {
  let n = 0;
  for (const m of meets) for (const p of placed) if ((m.one || p.one) && clash(m, p)) n++;
  return n;
};
const known = (x) => x != null && x !== 0 && x !== ANY;
const compatible = (a, b) => !known(a) || !known(b) || a === b;

export const DEFAULTS = { start: null, end: null, off: 0, fewerDays: false, compact: true, lunch: false, skipFull: true, blocks: [], locks: [] };

const seatsLeft = (s) => (Number.isFinite(s.cap) && Number.isFinite(s.enrl) ? Math.max(0, s.cap - s.enrl) : -1);

/**
 * A course's choices, after the person's filters: full sections skipped (unless a kind has nothing else),
 * blocked times avoided, locked sections kept alone.
 * → {code, title, kinds: [comp], anchor, opts: {comp: [option]}, problem, notes: []}
 *   option: {code, comp, assoc, meets, sections (same times, most seats first), section (the pick), full}
 */
export function buildCourse(code, entry, term = {}, prefs = DEFAULTS) {
  const [title, rows] = Array.isArray(entry?.[1]) ? entry : ['', entry ?? []];
  const all = (rows ?? []).map((r) => readSection(r, term));
  const kinds = [...new Set(all.map((s) => s.comp))].sort((a, b) => rank(a) - rank(b));
  const out = { code, title, kinds, anchor: kinds[0], opts: {}, problem: null, notes: [] };
  if (!all.length) {
    out.problem = 'none';
    return out;
  }
  const locks = new Set((prefs.locks ?? []).map(Number));
  const blocks = (prefs.blocks ?? []).map((b) => ({ mask: b.mask, s: b.s, e: b.e, from: null, to: null }));
  for (const comp of kinds) {
    let list = all.filter((s) => s.comp === comp);
    const locked = list.filter((s) => locks.has(Number(s.cls)));
    if (locked.length) list = locked;
    else {
      if (prefs.skipFull) {
        const open = list.filter((s) => !s.full);
        if (open.length) list = open;
        else out.notes.push(`Every ${comp} is full; showing full ones.`);
      }
      if (blocks.length) {
        const free = list.filter((s) => !s.meets.some((m) => !m.one && blocks.some((b) => clash(m, b))));
        if (!free.length) {
          out.problem = `blocked:${comp}`;
          return out;
        }
        list = free;
      }
    }
    const groups = new Map();
    for (const s of list) {
      const key = `${s.assoc}|${s.meets.map((m) => `${m.mask},${m.s},${m.e},${m.from},${m.to}`).join(';')}`;
      if (!groups.has(key)) groups.set(key, { code, comp, assoc: s.assoc, meets: s.meets, sections: [] });
      groups.get(key).sections.push(s);
    }
    out.opts[comp] = [...groups.values()].map((g) => {
      g.sections.sort((a, b) => (locks.has(Number(b.cls)) ? 1 : 0) - (locks.has(Number(a.cls)) ? 1 : 0) || seatsLeft(b) - seatsLeft(a) || a.sec.localeCompare(b.sec));
      g.section = g.sections[0];
      g.full = g.sections.every((s) => s.full);
      return g;
    });
  }
  return out;
}

// ---------------- costs ----------------

const W = { early: 1.2, late: 1.2, soft: 0.15, dayOff: 600, day: 140, dayBase: 25, span: 0.35, spanSoft: 0.04, lunch: 90, seat: 40, full: 400, test: 250 };
const SOFT_EARLY = 510; // 8:30: a little against earlier classes even when no start time is set
const SOFT_LATE = 1110; // 6:30 pm

/** What one choice costs on its own: early and late classes, and how full it is. */
function optionCost(o, p) {
  let c = 0;
  for (const m of o.meets) {
    if (m.one) continue;
    const n = bits(m.mask);
    if (p.start != null && m.s < p.start) c += (p.start - m.s) * W.early * n;
    else if (m.s < SOFT_EARLY) c += (SOFT_EARLY - m.s) * W.soft * n;
    if (p.end != null && m.e > p.end) c += (m.e - p.end) * W.late * n;
    else if (m.e > SOFT_LATE) c += (m.e - SOFT_LATE) * W.soft * n;
  }
  const s = o.section;
  if (s.full) c += W.full;
  else if (Number.isFinite(s.cap) && s.cap > 0 && Number.isFinite(s.enrl)) c += W.seat * (s.enrl / s.cap) ** 2;
  return c;
}

const LUNCH = [690, 810, 45]; // a free 45 minutes between 11:30 and 1:30
function lunchFree(list) {
  const [a, b, need] = LUNCH;
  const busy = list.filter(([s, e]) => s < b && e > a).sort((x, y) => x[0] - y[0]);
  let t = a;
  for (const [s, e] of busy) {
    if (s - t >= need) return true;
    t = Math.max(t, e);
  }
  return b - t >= need;
}

/** What one day costs: being on campus at all, on a day you wanted off, how long it is, no time for lunch. */
function dayCost(list, bit, p) {
  if (!list.length) return 0;
  let c = 0;
  if (p.off & bit) c += W.dayOff;
  c += p.fewerDays ? W.day : W.dayBase; // a trip to campus costs a little even when days don’t matter much
  let lo = Infinity;
  let hi = -Infinity;
  for (const [s, e] of list) {
    if (s < lo) lo = s;
    if (e > hi) hi = e;
  }
  c += (hi - lo) * (p.compact ? W.span : W.spanSoft);
  if (p.lunch && !lunchFree(list)) c += W.lunch;
  return c;
}

/** A timetable's numbers: days on campus, first start, last finish, time between classes, full sections. */
export function metrics(picks) {
  const days = DAYS.map(() => []);
  const tests = [];
  for (const pk of picks)
    for (const m of pk.opt.meets) {
      if (m.one) tests.push({ ...m, pick: pk });
      else for (let d = 0; d < 7; d++) if (m.mask & (1 << d)) days[d].push([m.s, m.e]);
    }
  let gaps = 0;
  let first = Infinity;
  let last = -Infinity;
  let used = 0;
  for (const list of days) {
    if (!list.length) continue;
    used++;
    list.sort((a, b) => a[0] - b[0]);
    let t = list[0][0];
    for (const [s, e] of list) {
      if (s > t) gaps += s - t;
      t = Math.max(t, e);
    }
    first = Math.min(first, list[0][0]);
    last = Math.max(last, ...list.map((x) => x[1]));
  }
  // Each test or one-day meeting that overlaps another pick's class or test: [meeting, the pick it overlaps].
  for (const t of tests) t.over = picks.find((pk) => pk !== t.pick && pk.opt.meets.some((m) => clash(t, m))) ?? null;
  return {
    days: used,
    dayMask: days.reduce((m, l, i) => (l.length ? m | (1 << i) : m), 0),
    first: used ? first : null,
    last: used ? last : null,
    gaps,
    full: picks.filter((p) => p.opt.section.full).length,
    overlaps: tests.filter((t) => t.over).length,
    online: picks.filter((p) => p.opt.section.online).length,
    tests: tests.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.s - b.s)),
  };
}

// ---------------- search ----------------

/**
 * The best `keep` timetables for these courses (from buildCourse, none with a problem), cheapest first.
 * → {schedules: [{cost, picks: [{code, comp, opt}]}], complete, nodes, all}
 *   complete: the search finished (not cut off by `budget` or `ms`); all: complete and fewer than `keep` were
 *   found, so these are every timetable that fits.
 */
export function solve(courses, prefs = DEFAULTS, { keep = 60, budget = 4_000_000, ms = 4000 } = {}) {
  const p = { ...DEFAULTS, ...prefs };
  const ordered = [...courses].sort((a, b) => a.opts[a.anchor].length - b.opts[b.anchor].length || a.code.localeCompare(b.code));
  const vars = [];
  for (const c of ordered) {
    vars.push({ course: c, comp: c.anchor, dep: false });
    for (const k of c.kinds.slice(1)) vars.push({ course: c, comp: k, dep: true });
  }
  for (const v of vars) {
    const opts = v.course.opts[v.comp];
    for (const o of opts) o.add = optionCost(o, p);
    v.opts = [...opts].sort((a, b) => a.add - b.add);
    // A tutorial that may be skipped (no tutorial goes with some lecture) costs nothing at the least.
    const skippable = v.dep && v.course.opts[v.course.anchor].some((a) => !opts.some((o) => compatible(a.assoc, o.assoc)));
    v.min = skippable || !v.opts.length ? 0 : v.opts[0].add;
  }
  const suffix = new Array(vars.length + 1).fill(0);
  for (let i = vars.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + vars[i].min;

  const placed = [];
  const days = DAYS.map(() => []);
  const dayCosts = new Array(7).fill(0);
  let dayTotal = 0;
  const anchorOf = new Map();
  const picks = [];
  const best = [];
  let nodes = 0;
  let stopped = false;
  const deadline = Date.now() + ms;

  const touch = (mask) => {
    for (let d = 0; d < 7; d++)
      if (mask & (1 << d)) {
        const c = dayCost(days[d], 1 << d, p);
        dayTotal += c - dayCosts[d];
        dayCosts[d] = c;
      }
  };
  const place = (o) => {
    let mask = 0;
    for (const m of o.meets) {
      placed.push(m);
      if (!m.one) {
        for (let d = 0; d < 7; d++) if (m.mask & (1 << d)) days[d].push([m.s, m.e]);
        mask |= m.mask;
      }
    }
    touch(mask);
  };
  const unplace = (o) => {
    let mask = 0;
    for (let i = o.meets.length - 1; i >= 0; i--) {
      const m = o.meets[i];
      placed.pop();
      if (!m.one) {
        for (let d = 6; d >= 0; d--) if (m.mask & (1 << d)) days[d].pop();
        mask |= m.mask;
      }
    }
    touch(mask);
  };

  const visit = (i, add) => {
    if (stopped) return;
    if (++nodes > budget || ((nodes & 4095) === 0 && Date.now() > deadline)) {
      stopped = true;
      return;
    }
    const cost = add + dayTotal;
    if (best.length === keep && cost + suffix[i] >= best[keep - 1].cost) return;
    if (i === vars.length) {
      const entry = { cost, picks: picks.slice() };
      let at = best.length;
      while (at > 0 && best[at - 1].cost > cost) at--;
      best.splice(at, 0, entry);
      if (best.length > keep) best.pop();
      return;
    }
    const v = vars[i];
    const a = v.dep ? anchorOf.get(v.course.code) : null;
    const list = v.dep ? v.opts.filter((o) => compatible(a.assoc, o.assoc)) : v.opts;
    if (!list.length) {
      // Nothing of this kind goes with the lecture picked (an online lecture without a tutorial, say).
      if (v.dep) visit(i + 1, add);
      return;
    }
    for (const o of list) {
      if (clashesAny(o.meets, placed)) continue;
      const over = testOverlaps(o.meets, placed) * W.test;
      place(o);
      picks.push({ code: v.course.code, comp: v.comp, opt: o });
      if (!v.dep) anchorOf.set(v.course.code, o);
      visit(i + 1, add + o.add + over);
      picks.pop();
      unplace(o);
      if (stopped) return;
    }
  };
  visit(0, 0);
  const order = new Map(courses.map((c, i) => [c.code, i]));
  for (const s of best) s.picks.sort((x, y) => order.get(x.code) - order.get(y.code) || rank(x.comp) - rank(y.comp));
  return { schedules: best, complete: !stopped, nodes, all: !stopped && best.length < keep };
}

/**
 * Why nothing fits: pairs of courses that can't be taken together; failing that, which course to drop so the
 * rest fit. → {pairs: [[a, b]], drop: [code]}
 */
export function explain(courses, prefs = DEFAULTS) {
  const fits = (list) => solve(list, prefs, { keep: 1, budget: 300_000, ms: 800 }).schedules.length > 0;
  const pairs = [];
  for (let i = 0; i < courses.length; i++)
    for (let j = i + 1; j < courses.length; j++) if (!fits([courses[i], courses[j]])) pairs.push([courses[i].code, courses[j].code]);
  if (pairs.length) return { pairs, drop: [] };
  return { pairs, drop: courses.filter((c) => fits(courses.filter((x) => x !== c))).map((c) => c.code) };
}

/**
 * The other choices for one pick in a timetable: each with what it would clash with, if anything.
 * → [{opt, clash: pick or null}], the current choice first.
 */
export function alternatives(courses, picks, index) {
  const pk = picks[index];
  const course = courses.find((c) => c.code === pk.code);
  if (!course) return [];
  const others = picks.filter((_, i) => i !== index);
  const anchor = course.anchor === pk.comp ? null : others.find((x) => x.code === pk.code && x.comp === course.anchor)?.opt;
  const deps = course.anchor === pk.comp ? others.filter((x) => x.code === pk.code) : [];
  return course.opts[pk.comp]
    .filter((o) => (anchor ? compatible(anchor.assoc, o.assoc) : deps.every((d) => compatible(o.assoc, d.opt.assoc))))
    .map((o) => ({ opt: o, clash: o === pk.opt ? null : (others.find((x) => clashesAny(o.meets, x.opt.meets)) ?? null) }))
    .sort((a, b) => (a.opt === pk.opt ? -1 : b.opt === pk.opt ? 1 : (a.clash ? 1 : 0) - (b.clash ? 1 : 0)));
}
