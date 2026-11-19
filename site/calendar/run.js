// One planner request, the same in the worker and on the page (when workers aren't available): build each
// course's choices, search, and say why when nothing fits. Results carry indexes, not objects, so they can be
// posted between threads: picks are [course index, kind, option index].
export function run(S, term, entries, prefs) {
  const courses = Object.entries(entries).map(([code, entry]) => S.buildCourse(code, entry, term, prefs));
  const ready = courses.filter((c) => !c.problem);
  const res = ready.length ? S.solve(ready, prefs) : { schedules: [], complete: true, nodes: 0, all: true };
  const why = ready.length && !res.schedules.length && res.complete ? S.explain(ready, prefs) : null;
  const ix = new Map(courses.map((c, i) => [c.code, i]));
  return {
    problems: courses.filter((c) => c.problem).map((c) => [c.code, c.problem]),
    notes: courses.flatMap((c) => c.notes.map((n) => [c.code, n])),
    complete: res.complete,
    all: res.all,
    why,
    schedules: res.schedules.map((s) => ({
      cost: Math.round(s.cost),
      picks: s.picks.map((p) => [ix.get(p.code), p.comp, courses[ix.get(p.code)].opts[p.comp].indexOf(p.opt)]),
    })),
  };
}
