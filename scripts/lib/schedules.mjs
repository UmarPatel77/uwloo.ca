// Past class schedules, from WClasses (wclasses.vercel.app, by Marcus Chan, who said uwloo could): every
// section it has of a course, Spring 2004 to early 2026, with enrolment, times and instructor. WClasses read
// them from the Registrar's Schedule of Classes, which uwloo can't read itself (its robots.txt says no).
//
// Two ways in. A course in today's catalog: its WClasses page, one request for every term at once (the
// page's data is in its __NEXT_DATA__). A course that's gone (that page says "not found"): WClasses' API,
// one request per term, only over the terms it could have run.
//
// Kept in data/schedules/{SUBJ}.json: {CS135: {via, read, asked?, terms: {1159: [[sec, cap, tot, time, inst]]}}}.
// Only a course's main sections are kept (lectures; seminars or labs when it has no lectures), to keep it small.
// A term WClasses doesn't have is unknown, not "didn't run": its scraper skipped failed reads silently.
import { readdir, readFile } from 'node:fs/promises';

export const DIR = 'data/schedules';
export const BASE = process.env.WCLASSES ?? 'https://wclasses.vercel.app';
export const FIRST = '1045'; // Spring 2004, WClasses' first term
export const LAST = '1265'; // Spring 2026, its last

const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => (t && Number.isFinite(t.hours) ? `${t.hours}:${pad(t.mins ?? 0)}` : '');
/** A WClasses class → [sec, cap, tot, time, instructor]. */
export function row(c) {
  const sec = c.section ? `${c.section.type} ${c.section.num}` : '';
  const time = c.time?.startTime ? `${hm(c.time.startTime)}-${hm(c.time.endTime)} ${(c.time.days ?? []).join('')}`.trim() : '';
  return [sec, Number.isFinite(c.enrolCap) ? c.enrolCap : null, Number.isFinite(c.enrolTotal) ? c.enrolTotal : null, time, (c.instructor ?? '').trim()];
}
const MAIN = ['LEC', 'SEM', 'LAB', 'STU', 'CLN', 'PRJ', 'RDG', 'TST'];
/** One term's classes → its main sections (lectures, or the first kind it has), as rows. */
export function mainSections(classes) {
  const rows = classes.map(row).filter((r) => r[0]);
  const kind = MAIN.find((k) => rows.some((r) => r[0].startsWith(`${k} `))) ?? rows[0]?.[0].split(' ')[0];
  return rows.filter((r) => r[0].startsWith(`${kind} `)).sort((a, b) => a[0].localeCompare(b[0]));
}

/** A WClasses course page → {terms: {1159: rows}} or null if it isn't a course page (not found, or changed). */
export function readPage(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html ?? '');
  if (!m) return null;
  let props;
  try {
    props = JSON.parse(m[1]).props?.pageProps;
  } catch {
    return null;
  }
  if (typeof props?.schedule !== 'string') return null;
  const schedule = JSON.parse(props.schedule);
  const terms = {};
  for (const [t, classes] of Object.entries(schedule)) if (Array.isArray(classes) && classes.length) terms[t] = mainSections(classes);
  return { terms };
}

/** The API's answer for one term → rows ([] when it has nothing). */
export function readApi(json, term) {
  const classes = json?.[term];
  return Array.isArray(classes) ? mainSections(classes) : [];
}

export const pageUrl = (code) => {
  const [, s, n] = /^([A-Z]+)(.+)$/.exec(code);
  return `${BASE}/course?subjectCode=${s.toLowerCase()}&catalogNumber=${encodeURIComponent(n)}`;
};
export const apiUrl = (code, term) => {
  const [, s, n] = /^([A-Z]+)(.+)$/.exec(code);
  return `${BASE}/api/get-schedule?subjectCode=${s}&catalogNumber=${encodeURIComponent(n)}&term=${term}`;
};

/** Every term code from a to b, inclusive. */
export function termsBetween(a, b) {
  const out = [];
  for (let y = Number(a.slice(1, 3)); y <= Number(b.slice(1, 3)); y++)
    for (const m of [1, 5, 9]) {
      const t = `1${pad(y)}${m}`;
      if (Number(t) >= Number(a) && Number(t) <= Number(b)) out.push(t);
    }
  return out;
}

/** data/schedules → Map(code → {terms: {term: rows}}). */
export async function loadSchedules(dir = DIR) {
  const out = new Map();
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => /^[A-Z]+\.json$/.test(x))) {
    for (const [code, c] of Object.entries(JSON.parse(await readFile(`${dir}/${f}`, 'utf8')))) out.set(code, c);
  }
  return out;
}
