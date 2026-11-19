// uwloo.ca/calendar, the schedule planner: its data (one file per term with sections) and its page.
// The searching happens in the browser: site/calendar/solve.js, run by site/calendar/planner.js.
//
// /calendar/{term}.json: {term, name, asOf, from, to, c: {CS136: [title, sections]}}
//   section: [comp, sec, assoc, class, cap, enrolled, meets]
//   meet:    [days, start, end]            weekly, over the term's usual weeks (from–to)
//            [days, start, end, from, to]  weekly, over other weeks
//            [days, start, end, date]      one day (a test, say)
//   days: a bitmask, M = 1, T = 2, W = 4, Th = 8, F = 16, Sa = 32, Su = 64. Times: minutes after midnight.
import { esc } from './requisites.mjs';
import { shell } from './render.mjs';
import { termName } from './terms.mjs';

const BIT = { M: 1, T: 2, W: 4, Th: 8, F: 16, Sa: 32, Su: 64 };
const maskOf = (days) => (String(days ?? '').match(/Th|Sa|Su|M|T|W|F/g) ?? []).reduce((m, d) => m | BIT[d], 0);
const minutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** One term's sections (opendata.loadSections' shape) → the planner's file for that term. */
export function plannerData(term, sections, { asOf = null, titleOf = () => '' } = {}) {
  // The term's usual weeks: the commonest date range of weekly meetings. Others are written out.
  const weeks = new Map();
  for (const list of Object.values(sections))
    for (const s of list) for (const m of s.meets ?? []) if (!m.date && m.from && m.to) weeks.set(`${m.from}|${m.to}`, (weeks.get(`${m.from}|${m.to}`) ?? 0) + 1);
  const [from = null, to = null] = ([...weeks].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '').split('|').map((x) => x || null);
  const c = {};
  for (const code of Object.keys(sections).sort()) {
    const rows = sections[code].map((s) => [
      s.comp,
      s.sec,
      s.assoc ?? null,
      s.cls ?? null,
      s.cap ?? null,
      s.enrl ?? null,
      (s.meets ?? [])
        .map((m) => {
          const st = minutes(m.start);
          const en = minutes(m.end);
          if (st == null || en == null || en <= st) return null;
          if (m.date) return [maskOf(m.days), st, en, m.date];
          const mask = maskOf(m.days);
          if (!mask) return null;
          return (m.from ?? null) === from && (m.to ?? null) === to ? [mask, st, en] : [mask, st, en, m.from ?? null, m.to ?? null];
        })
        .filter(Boolean),
    ]);
    if (rows.length) c[code] = [titleOf(code) ?? '', rows];
  }
  return { term, name: termName(term), asOf, from, to, c };
}

const TIMES = (from, to, step = 60) => {
  const out = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
};
const label = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'am' : 'pm'}`;

/** The planner page. terms: [{term, name, asOf, from, courses}], oldest first. planner.js picks the default. */
export function plannerPage({ terms, builtAt, version }) {
  const def = terms.at(-1)?.term ?? '';
  const days = [
    ['M', 1, 'Monday'],
    ['T', 2, 'Tuesday'],
    ['W', 4, 'Wednesday'],
    ['Th', 8, 'Thursday'],
    ['F', 16, 'Friday'],
  ];
  const body = terms.length
    ? `<div class="pl" id="planner" data-v="${esc(version)}" data-default="${esc(def)}" data-terms="${esc(JSON.stringify(terms.map(({ term, name, asOf, from }) => ({ term, name, asOf, from }))))}">
<header class="pl-head">
  <h1>Plan a timetable</h1>
  <p class="lede">Add up to 8 courses. uwloo tries every combination of their sections and shows the timetables that fit, best first.</p>
</header>
<div class="pl-terms" role="group" aria-label="Term">${terms.map((t) => `<button type="button" data-term="${esc(t.term)}" aria-pressed="${t.term === def}">${esc(t.name)}</button>`).join('')}</div>
<form class="pl-add" id="pl-add" role="search" autocomplete="off">
  <label for="pl-q">Add a course</label>
  <div class="pl-box"><input id="pl-q" placeholder="cs136, math138, …" autocapitalize="none" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="pl-sugg" aria-expanded="false"><button type="submit">Add</button></div>
  <ul id="pl-sugg" class="pl-sugg" role="listbox" aria-label="Matching courses" hidden></ul>
</form>
<ul class="pl-chips" id="pl-chips" aria-label="Your courses"></ul>
<details class="pl-prefs" open>
  <summary>What matters to you</summary>
  <div class="pl-pgrid">
    <label>Start after <select id="pl-start"><option value="">Any time</option>${TIMES(510, 750).map((m) => `<option value="${m}">${label(m)}</option>`).join('')}</select></label>
    <label>Finish by <select id="pl-end"><option value="">Any time</option>${TIMES(870, 1230).map((m) => `<option value="${m}">${label(m)}</option>`).join('')}</select></label>
    <div class="pl-off" role="group" aria-label="Days you’d like off"><span>Days off</span>${days.map(([d, bit, name]) => `<button type="button" data-off="${bit}" aria-pressed="false" aria-label="${name} off">${d}</button>`).join('')}</div>
  </div>
  <div class="pl-checks">
    <label><input type="checkbox" id="pl-compact"> Short gaps between classes</label>
    <label><input type="checkbox" id="pl-fewer"> Fewer days on campus</label>
    <label><input type="checkbox" id="pl-lunch"> Time for lunch <span class="t">(45 min between 11:30 and 1:30)</span></label>
    <label><input type="checkbox" id="pl-full"> Skip full sections</label>
  </div>
  <div class="pl-busyrow">
    <button type="button" id="pl-blockmode" aria-pressed="false">Block off time</button>
    <span class="t pl-blockhint">Then drag down a day on the timetable, for work or anything else you can’t move.</span>
    <form id="pl-busyform" class="pl-busyform">
      <label class="vh" for="pl-bday">Day</label><select id="pl-bday">${days.map(([d, bit]) => `<option value="${bit}">${d}</option>`).join('')}<option value="31">M–F</option></select>
      <label class="vh" for="pl-bfrom">From</label><select id="pl-bfrom">${TIMES(480, 1260, 30).map((m) => `<option value="${m}"${m === 720 ? ' selected' : ''}>${label(m)}</option>`).join('')}</select>
      <label class="vh" for="pl-bto">To</label><select id="pl-bto">${TIMES(510, 1320, 30).map((m) => `<option value="${m}"${m === 780 ? ' selected' : ''}>${label(m)}</option>`).join('')}</select>
      <button type="submit">Add busy time</button>
    </form>
    <ul id="pl-blocks" class="pl-blocklist" aria-label="Busy times"></ul>
  </div>
</details>
<section class="pl-out" id="pl-out" aria-label="Timetables"><p class="pl-msg">Loading the class schedule…</p></section>
<noscript><p class="pl-msg">The planner needs JavaScript. Each course’s page still lists its sections.</p></noscript>
</div>
<script type="module" src="/calendar/planner.js?v=${esc(version)}"></script>`
    : `<h1>Plan a timetable</h1><p class="lede">No term’s class schedule is available from UW Open Data right now. Try again after the next rebuild.</p>`;
  return shell({
    title: 'Plan a timetable | uwloo',
    description: 'Add up to 8 Waterloo courses and see every timetable that fits, ranked by start times, days off and gaps. Copy the class numbers into Quest.',
    path: '/calendar/',
    body,
    builtAt,
    version,
    head: `<link rel="stylesheet" href="/calendar/planner.css?v=${esc(version)}">`,
  });
}
