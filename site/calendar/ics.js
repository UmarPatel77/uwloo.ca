// The timetable as a calendar file (.ics), for Google Calendar, Apple Calendar or Outlook. No DOM here.
const fmtCode = (c) => String(c).replace(/^([A-Z]+)(\d)/, '$1 $2');
const slug = (c) => String(c).toLowerCase();
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const TZ = ['BEGIN:VTIMEZONE', 'TZID:America/Toronto', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const icsTime = (d, m) => `${d.replace(/-/g, '')}T${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`);

function event(pk, m, day, uid, stamp, term, weekly) {
  const s = pk.opt.section;
  return [
    'BEGIN:VEVENT',
    `UID:${term.replace(/\s+/g, '')}-${s.cls ?? `${pk.code}-${s.comp}${s.sec}`}-${uid}@uwloo.ca`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${icsText(`${fmtCode(pk.code)} ${s.comp} ${s.sec}`)}`,
    `DTSTART;TZID=America/Toronto:${icsTime(day, m.s)}`,
    `DTEND;TZID=America/Toronto:${icsTime(day, m.e)}`,
    ...(weekly ? [`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY.filter((_, d) => m.mask & (1 << d)).join(',')};UNTIL=${addDays(m.to, 1).replace(/-/g, '')}T045959Z`] : []),
    `DESCRIPTION:${icsText(`Class ${s.cls ?? ''}. https://uwloo.ca/${slug(pk.code)}/`)}`,
    'END:VEVENT',
  ];
}

/** The timetable as an .ics file: weekly classes repeat over their weeks; tests and dated classes are single events. */
export function icsFile(picks, term, { dayBit }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//uwloo.ca//Timetable//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(`${term} timetable`)}`, ...TZ];
  let skipped = 0;
  for (const pk of picks)
    pk.opt.meets.forEach((m, i) => {
      if (m.dates) return void m.dates.forEach((d, j) => lines.push(...event(pk, m, d, `${i}-${j}`, stamp, term, false)));
      let day = m.from;
      if (!day || (!m.one && !m.to)) return void skipped++;
      if (!m.one) for (let k = 0; k < 7 && !(dayBit(day) & m.mask); k++) day = addDays(day, 1);
      lines.push(...event(pk, m, day, i, stamp, term, !m.one));
    });
  lines.push('END:VCALENDAR');
  return { text: `${lines.join('\r\n')}\r\n`, skipped };
}
