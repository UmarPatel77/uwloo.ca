// The timetable as a calendar file (.ics), for Google Calendar, Apple Calendar or Outlook. No DOM here.
const fmtCode = (c) => String(c).replace(/^([A-Z]+)(\d)/, '$1 $2');
const slug = (c) => String(c).toLowerCase();
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const TZ = ['BEGIN:VTIMEZONE', 'TZID:America/Toronto', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const icsTime = (d, m) => `${d.replace(/-/g, '')}T${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`);

function event(pk, m, day, uid, stamp, term, weekly, except = []) {
  const s = pk.opt.section;
  return [
    'BEGIN:VEVENT',
    `UID:${term.replace(/\s+/g, '')}-${s.cls ?? `${pk.code}-${s.comp}${s.sec}`}-${uid}@uwloo.ca`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${icsText(`${fmtCode(pk.code)} ${s.comp} ${s.sec}`)}`,
    `DTSTART;TZID=America/Toronto:${icsTime(day, m.s)}`,
    `DTEND;TZID=America/Toronto:${icsTime(day, m.e)}`,
    ...(weekly ? [`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY.filter((_, d) => m.mask & (1 << d)).join(',')};UNTIL=${addDays(m.to, 1).replace(/-/g, '')}T045959Z`] : []),
    ...(except.length ? [`EXDATE;TZID=America/Toronto:${except.map((d) => icsTime(d, m.s)).join(',')}`] : []),
    `DESCRIPTION:${icsText(`Class ${s.cls ?? ''}. https://uwloo.ca/${slug(pk.code)}/`)}`,
    'END:VEVENT',
  ];
}

/** An all-day event, from one date to another (both in). */
function dayEvent(uid, stamp, name, from, to, desc = '') {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@uwloo.ca`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${icsText(name)}`,
    `DTSTART;VALUE=DATE:${from.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${addDays(to, 1).replace(/-/g, '')}`,
    'TRANSP:TRANSPARENT',
    ...(desc ? [`DESCRIPTION:${icsText(desc)}`] : []),
    'END:VEVENT',
  ];
}

/** Every date from one to another, both in. */
function span(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The timetable as an .ics file: weekly classes repeat over their weeks; tests and dated classes are single events.
 * dates: the term's dates from Open Data (scripts/lib/planner.mjs's termDates). Days off (holidays, reading week,
 * study days) are skipped in the weekly classes; on a make-up day, the classes of the weekday it follows meet
 * instead of its own. With withDates, each date is an all-day event too (drop deadlines, the exam period…).
 * exams: final exams by course ({code: [[sections, date, start, minutes, where, note]]}), each one an event for
 * the courses picked (and their lecture section, when the exam names sections).
 */
export function icsFile(picks, term, { dayBit, dates = [], exams = {}, withDates = true }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const termKey = term.replace(/\s+/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//uwloo.ca//Timetable//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(`${term} timetable`)}`, ...TZ];
  const off = new Set(dates.filter((d) => d[1] === 'off').flatMap((d) => span(d[2], d[3])));
  // A make-up day: whose classes meet (follow, a weekday's bit), and whose don't (its own weekday's, if another).
  const makeups = dates.filter((d) => d[1] === 'makeup').map((d) => ({ day: d[2], follow: d[4] === '' ? dayBit(d[2]) : 1 << Number(d[4]) }));
  let skipped = 0;
  for (const pk of picks)
    pk.opt.meets.forEach((m, i) => {
      if (m.dates) return void m.dates.forEach((d, j) => lines.push(...event(pk, m, d, `${i}-${j}`, stamp, term, false)));
      let day = m.from;
      if (!day || (!m.one && !m.to)) return void skipped++;
      if (m.one) return void lines.push(...event(pk, m, day, i, stamp, term, false));
      for (let k = 0; k < 7 && !(dayBit(day) & m.mask); k++) day = addDays(day, 1);
      const except = [...off].filter((d) => d >= day && d <= m.to && dayBit(d) & m.mask);
      const extra = [];
      for (const mk of makeups) {
        const own = dayBit(mk.day);
        const meets = mk.day >= day && mk.day <= m.to;
        if (mk.follow !== own && meets && own & m.mask) except.push(mk.day);
        // This class meets that day: on another weekday's schedule, or just after its weeks end.
        if (mk.follow & m.mask && mk.day >= day && mk.day <= addDays(m.to, 7) && !(meets && own & m.mask && mk.follow === own) && !off.has(mk.day)) extra.push(mk.day);
      }
      lines.push(...event(pk, m, day, i, stamp, term, true, [...new Set(except)].sort()));
      extra.forEach((d) => lines.push(...event(pk, m, d, `${i}-mk${d.replace(/-/g, '')}`, stamp, term, false)));
    });
  // Final exams for the courses picked: their lecture's section, or any.
  let examCount = 0;
  const seen = new Set();
  for (const pk of picks) {
    if (seen.has(pk.code) || !exams[pk.code]) continue;
    seen.add(pk.code);
    const lec = picks.find((p) => p.code === pk.code && p.opt.section.comp === 'LEC')?.opt.section.sec;
    exams[pk.code].forEach(([secs, date, start, mins, where, note], j) => {
      if (secs && lec && !secs.includes(lec)) return;
      examCount++;
      const name = `${fmtCode(pk.code)} final exam`;
      const desc = [note, `https://uwloo.ca/${slug(pk.code)}/`].filter(Boolean).join(' · ');
      if (start == null) return void lines.push(...dayEvent(`${termKey}-exam-${pk.code}-${j}`, stamp, name, date, date, desc));
      lines.push('BEGIN:VEVENT', `UID:${termKey}-exam-${pk.code}-${j}@uwloo.ca`, `DTSTAMP:${stamp}`, `SUMMARY:${icsText(name)}`, `DTSTART;TZID=America/Toronto:${icsTime(date, start)}`, `DTEND;TZID=America/Toronto:${icsTime(date, Math.min(start + (mins ?? 150), 1439))}`, ...(where ? [`LOCATION:${icsText(where)}`] : []), `DESCRIPTION:${icsText(desc)}`, 'END:VEVENT');
    });
  }
  // The term's dates, as all-day events.
  let dateCount = 0;
  if (withDates)
    for (const [name, kind, from, to] of dates) {
      dateCount++;
      lines.push(...dayEvent(`${termKey}-date-${slug(name).replace(/[^a-z0-9]+/g, '-')}-${from}`, stamp, name, from, to, kind === 'off' ? 'No classes.' : kind === 'makeup' ? 'Classes follow another day’s schedule: see the class events.' : ''));
    }
  lines.push('END:VCALENDAR');
  return { text: `${lines.join('\r\n')}\r\n`, skipped, exams: examCount, dates: dateCount, off: off.size > 0 };
}
