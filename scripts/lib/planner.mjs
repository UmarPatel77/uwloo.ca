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
export function plannerData(term, sections, { asOf = null, titleOf = () => '', dates = [], exams = {} } = {}) {
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
  // The term's dates and its courses' final exams (Open Data), for the calendar file.
  const x = Object.fromEntries(Object.entries(exams).filter(([code]) => c[code]));
  return { term, name: termName(term), asOf, from, to, c, ...(dates.length ? { d: dates } : {}), ...(Object.keys(x).length ? { x } : {}) };
}

// ---------------- term dates and final exams (Open Data) ----------------

const clean = (v) => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// Dates that aren't about a student's own term of classes.
const SKIP_DATE = /Convocation|Reserves removed|Fees Arranged Extension|Not Fees Arranged|holds applied|new students|Apply for Graduation|Co-operative work term|Examinations on Sunday|examination centre|In-person exam days for online|Final examination emergency/i;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * A term's important dates for undergraduates (Open Data's ImportantDates) → [[name, kind, from, to, follow]],
 * by date. kind:
 *   'off'    no classes: holidays and closures, reading week, pre-examination study days
 *   'makeup' a make-up day: classes follow another weekday's schedule (follow: 0 Monday … 6 Sunday), or their
 *            own ('' : "no change in schedule")
 *   'exam'   the final examination period
 *   ''       deadlines and the rest (classes begin and end, drop dates, fees)
 */
export function termDates(all, term) {
  const name = termName(term);
  const rows = [];
  for (const x of all ?? []) {
    const n = clean(x.name);
    if (!n || SKIP_DATE.test(n)) continue;
    if (x.audiences?.length && !x.audiences.includes('Undergraduate students')) continue;
    const text = clean(x.description);
    for (const d of x.details ?? []) {
      if (clean(d.termName) !== name) continue;
      const from = /^\d{4}-\d{2}-\d{2}/.exec(d.startDate ?? '')?.[0];
      if (!from) continue;
      const end = /^\d{4}-\d{2}-\d{2}/.exec(d.endDate ?? '')?.[0];
      const to = end && end > from ? end : from;
      if (x.importantDateType === 'University closure' || /^Reading Week$|^Pre-examination study days$/i.test(n)) rows.push([n, 'off', from, to, '']);
      else if (/^Make-up day/i.test(n)) {
        const follow = /following an? (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) schedule/i.exec(text)?.[1];
        rows.push([n, 'makeup', from, to, follow ? String(WEEKDAYS.indexOf(follow.toLowerCase())) : '']);
      } else rows.push([n, '', from, to, '']);
    }
  }
  // "Final examinations begin" … "end": one row, the exam period. (Other pairs stay apart: the day something ends
  // is the deadline, and a banner across seven weeks of a calendar says less.)
  const begin = rows.find((r) => /^Final examinations begins?$/i.test(r[0]));
  const end = rows.find((r) => /^Final examinations ends?$/i.test(r[0]));
  const out = begin && end && end[2] >= begin[2] ? [...rows.filter((r) => r !== begin && r !== end), ['Final examinations', 'exam', begin[2], end[3], '']] : rows.map((r) => (/^Final examinations/i.test(r[0]) ? [r[0], 'exam', r[2], r[3], r[4]] : r));
  const seen = new Set();
  return out.filter((r) => !seen.has(r.join('|')) && seen.add(r.join('|'))).sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "2026-12-10T00:00:00", "12/10/2026", "December 10, 2026", "Thursday, Dec 10, 2026" → "2026-12-10". */
export function examDate(v) {
  const s = clean(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/.exec(s);
  const month = m ? MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3))) : -1;
  return month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}
/** "09:00:00", "9:00 AM", "7:30 PM", "19:30" → minutes after midnight, or null. */
export function examTime(v) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?/.exec(clean(v));
  if (!m) return null;
  let h = Number(m[1]) % 24;
  const pm = m[3] && /p/i.test(m[3]);
  if (m[3]) h = (h % 12) + (pm ? 12 : 0);
  return h * 60 + Number(m[2]);
}
/** "02:30:00", "2:30", "150", "150 minutes", "2.5 hours", "2 hours 30 minutes" → minutes, or null. */
export function examMinutes(v) {
  const s = clean(v).toLowerCase();
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*(h|hours?|hrs?)\b(?:\s*(\d+)\s*(?:m|min|minutes?))?/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60) + Number(m[3] ?? 0);
  m = /^(\d+)\s*(?:m|min|minutes?)?$/.exec(s);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}
/**
 * Final exams (Open Data's ExamSchedules) → {code: [[sections, date, start, minutes, where, note]]}: sections the
 * section numbers it's for, or null for all; start minutes after midnight, or null when only the day is known;
 * where and note as text. One without a date ("see your instructor") is left out.
 */
export function termExams(rows) {
  const out = {};
  for (const r of rows ?? []) {
    const m = /^\s*([A-Z]{2,8})\s*(\d{3}[A-Z]?)\b/.exec(clean(r.examDisplayName).toUpperCase());
    const date = examDate(r.examWindowStartDate);
    if (!m || !date) continue;
    const secs = clean(r.sections).match(/\b\d{3}\b/g);
    const where = clean(r.location);
    const note = [clean(r.isOnlineDescription), clean(r.notes)].filter((x) => x && !/^(no|false|in[- ]person)$/i.test(x)).join(' · ');
    (out[`${m[1]}${m[2]}`] ??= []).push([secs?.length ? secs : null, date, examTime(r.examWindowStartTime), examMinutes(r.examDuration), where, note]);
  }
  return out;
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
