// The timetables someone is planning, kept in this browser: one per term. Shared by every page (the header's
// "Timetable" count), course pages ("Add to timetable", in app.js) and the planner at /timetable/ (planner.js).
// Stored as {last: '1271', terms: {'1271': 'c=CS136,MATH138&off=16', …}}: each term's planner address, minus t.
const KEY = 'uwloo.plans';
const OLD = 'uwloo.planner'; // the planner's first version kept one plan, as its address

/** Every saved plan, or null when this browser won't store anything. */
export function readPlans() {
  try {
    let all = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!all || typeof all !== 'object') {
      all = { last: null, terms: {} };
      const old = localStorage.getItem(OLD);
      if (old) {
        const q = new URLSearchParams(old);
        const t = q.get('t');
        q.delete('t');
        if (/^\d{4}$/.test(t ?? '')) {
          all.terms[t] = tidy(q);
          all.last = t;
        }
      }
    }
    if (!all.terms || typeof all.terms !== 'object') all.terms = {};
    return all;
  } catch {
    return null;
  }
}

export function writePlans(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    localStorage.removeItem(OLD);
    return true;
  } catch {
    return false;
  }
}

export const tidy = (q) => q.toString().replace(/%2C/g, ',');
/** The course codes in one term's saved plan. */
export const codesOf = (qs) => (new URLSearchParams(qs ?? '').get('c') ?? '').split(',').filter(Boolean);

/**
 * The term to plan, of [{term, from}] (oldest first): the next one once its schedule is out, unless the current
 * one started under 3 weeks ago (people are still changing classes then).
 */
export function defaultTerm(terms) {
  const [a, b] = terms.slice(-2);
  if (!b) return a?.term ?? null;
  const started = a.from ? Date.parse(`${a.from}T12:00:00Z`) : NaN;
  return Date.now() < started + 21 * 86_400_000 ? a.term : b.term;
}

/** The term someone is planning: the one they planned last, unless it's older than the default (a past plan). */
export function chooseTerm(all, terms) {
  const def = defaultTerm(terms);
  const last = all?.last;
  return last && terms.some((t) => t.term === last) && Number(last) >= Number(def) ? last : def;
}

/** Add or take out one course in a term's plan. → the new list of codes, or null if the plan is full. */
export function toggleCourse(all, term, code, max = 8) {
  const q = new URLSearchParams(all.terms[term] ?? '');
  let codes = codesOf(q.toString());
  if (codes.includes(code)) codes = codes.filter((c) => c !== code);
  else if (codes.length >= max) return null;
  else codes.push(code);
  if (codes.length) q.set('c', codes.join(','));
  else q.delete('c');
  all.terms[term] = tidy(q);
  all.last = term;
  return codes;
}

/** The header's count: courses in the plan last worked on. */
export function paintCount(all = readPlans()) {
  const el = document.querySelector('.nav-count');
  if (!el) return;
  const n = all?.last ? codesOf(all.terms[all.last]).length : 0;
  el.textContent = n ? String(n) : '';
  el.closest('a')?.setAttribute('aria-label', n ? `Timetable, ${n} course${n === 1 ? '' : 's'}` : 'Timetable');
}
