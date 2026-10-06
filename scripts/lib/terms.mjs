// Waterloo term codes and academic-year codes.
//
// Term code = (century − 20) + YY + first month of the term:
//   Fall 2026 → "1" + "26" + "9" → 1269. Winter 2027 → 1271. Spring 2026 → 1265.
// Academic-year code = YY + yy of the two calendar years it spans:
//   2026–27 → "2627". 1957–58 → "5758".

export const SEASONS = { 1: 'Winter', 5: 'Spring', 9: 'Fall' };
const MONTHS = [1, 5, 9];

export const FIRST_YEAR_START = 1957; // 5758, the first Waterloo calendar year
export const LAST_UCALENDAR_START = 2023; // 2324, the last year on ucalendar.uwaterloo.ca

export function termFrom(year, month) {
  return `${Math.floor(year / 100) - 19}${String(year % 100).padStart(2, '0')}${month}`;
}

/** Term in progress on `date` (Jan–Apr Winter, May–Aug Spring, Sep–Dec Fall). */
export function termCode(date = new Date()) {
  const m = date.getUTCMonth() + 1;
  return termFrom(date.getUTCFullYear(), m <= 4 ? 1 : m <= 8 ? 5 : 9);
}

export function parseTerm(code) {
  const m = /^(\d)(\d\d)([159])$/.exec(String(code));
  if (!m) return null;
  const year = (Number(m[1]) + 19) * 100 + Number(m[2]);
  return { code: String(code), year, month: Number(m[3]), season: SEASONS[m[3]] };
}

export function termName(code) {
  const t = parseTerm(code);
  return t ? `${t.season} ${t.year}` : String(code);
}

/** "F26", "W27" */
export function termShort(code) {
  const t = parseTerm(code);
  return t ? `${t.season[0]}${String(t.year % 100).padStart(2, '0')}` : String(code);
}

export function shiftTerm(code, n) {
  const t = parseTerm(code);
  let i = MONTHS.indexOf(t.month) + n;
  const year = t.year + Math.floor(i / 3);
  i = ((i % 3) + 3) % 3;
  return termFrom(year, MONTHS[i]);
}

/** Inclusive list of term codes from `first` to `last`. */
export function termRange(first, last) {
  const out = [];
  for (let t = first; Number(t) <= Number(last); t = shiftTerm(t, 1)) out.push(t);
  return out;
}

export function parseYearCode(s) {
  const m = /^(\d\d)(\d\d)$/.exec(String(s));
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (b !== (a + 1) % 100) return null;
  const start = a >= 57 ? 1900 + a : 2000 + a;
  return { code: String(s), start, end: start + 1, label: yearLabel(start) };
}

export function yearCodeFor(startYear) {
  return `${String(startYear % 100).padStart(2, '0')}${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** 2026 → "2026–27" */
export function yearLabel(startYear) {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;
}
