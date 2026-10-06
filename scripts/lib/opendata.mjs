// UW Open Data API v3 (https://openapi.data.uwaterloo.ca/api-docs). Free key, sent as x-api-key.
// Used for the machine-readable side of what classes.uwaterloo.ca and Quest show to people:
//   GET /Courses/{term}                          every course row for a term (courseId ↔ subject/number, faculty)
//   GET /ClassSchedules/{term}                   courseIds with at least one scheduled class that term
//   GET /ClassSchedules/{term}/{subject}/{num}   sections, seats and meeting times for one course
// Quest data reaches Open Data within ~48 hours. Instructor names and rooms are withheld for privacy.
import { ageDays, getJson, HttpError, pool, readCache, writeCache } from './http.mjs';

export const OPENDATA_BASE = process.env.OPENDATA_BASE ?? 'https://openapi.data.uwaterloo.ca/v3';
const KEY = process.env.UW_API_KEY ?? '';
const CACHE = '.cache/opendata';
const CONCURRENCY = Number(process.env.OPENDATA_CONCURRENCY ?? 3);

export const enabled = () => Boolean(KEY);

async function od(path) {
  try {
    return await getJson(`${OPENDATA_BASE}/${path}`, { headers: { 'x-api-key': KEY } });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null; // Open Data's "no data"
    throw err;
  }
}

const codeOf = (r) => `${String(r.subjectCode ?? '').trim()}${String(r.catalogNumber ?? '').trim()}`.toUpperCase();

/**
 * Which courses ran in each term. Past terms are cached forever.
 * Returns { terms: {[term]: {published, offered:Set}}, faculty: Map(code → group), rows: {[term]: rows} }
 */
export async function loadOfferings(terms, currentTerm) {
  const out = { terms: {}, faculty: new Map(), rows: {} };
  for (const term of terms) {
    const path = `${CACHE}/offerings-${term}.json`;
    let hit = await readCache(path);
    const frozen = Number(term) < Number(currentTerm);
    if (!hit || (!frozen && ageDays(hit.fetchedAt) > 0.5)) {
      try {
        const rows = (await od(`Courses/${term}`)) ?? [];
        const scheduled = (await od(`ClassSchedules/${term}`)) ?? [];
        hit = {
          fetchedAt: new Date().toISOString(),
          rows: rows.map((r) => ({
            id: String(r.courseId),
            subject: String(r.subjectCode ?? '').trim(),
            number: String(r.catalogNumber ?? '').trim(),
            group: r.associatedAcademicGroupCode ?? null,
            career: r.associatedAcademicCareer ?? null,
          })),
          scheduled: scheduled.map(String),
        };
        await writeCache(path, hit);
      } catch (err) {
        console.warn(`! Open Data ${term}: ${err.message}${hit ? ' (using cached copy)' : ''}`);
        if (!hit) continue;
      }
    }
    const scheduled = new Set(hit.scheduled);
    const offered = new Set();
    for (const r of hit.rows) {
      const code = codeOf({ subjectCode: r.subject, catalogNumber: r.number });
      if (r.group) out.faculty.set(code, r.group);
      if (scheduled.has(r.id)) offered.add(code);
    }
    out.terms[term] = { published: scheduled.size > 0, offered };
    out.rows[term] = hit.rows.filter((r) => scheduled.has(r.id));
    console.log(`Open Data ${term}: ${hit.rows.length} courses, ${offered.size} scheduled`);
  }
  return out;
}

const DAY_NAMES = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];

function hhmm(s) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(s ?? '').split('T').pop());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function days(meeting) {
  const week = String(meeting.classMeetingWeekPatternCode ?? '').trim();
  if (/^[YN]{5,7}$/i.test(week)) return [...week].map((c, i) => (c.toUpperCase() === 'Y' ? DAY_NAMES[i] : '')).join('');
  return String(meeting.classMeetingDayPatternCode ?? '').trim();
}

/** One Open Data class → the compact shape the pages render. */
export function toSection(c) {
  const meets = (c.scheduleData ?? []).map((m) => {
    const start = String(m.scheduleStartDate ?? '').slice(0, 10);
    const end = String(m.scheduleEndDate ?? '').slice(0, 10);
    return { days: days(m), start: hhmm(m.classMeetingStartTime), end: hhmm(m.classMeetingEndTime), date: start && start === end ? start : null };
  });
  return {
    cls: c.classNumber ?? null,
    comp: String(c.courseComponent ?? '').trim(),
    sec: String(c.classSection ?? '').padStart(3, '0'),
    cap: Number.isFinite(Number(c.maxEnrollmentCapacity)) ? Number(c.maxEnrollmentCapacity) : null,
    enrl: Number.isFinite(Number(c.enrolledStudents)) ? Number(c.enrolledStudents) : null,
    meets: meets.filter((m) => m.start || m.days || m.date),
  };
}

const COMP_ORDER = ['LEC', 'SEM', 'STU', 'LAB', 'TUT', 'TST', 'PRA', 'CLN', 'RDG', 'ESS', 'PRJ', 'WRK', 'FLD', 'DIS', 'OLN'];
const compRank = (c) => (COMP_ORDER.indexOf(c) + 1 || 99);

/** Sections for undergrad courses that are scheduled in `term` and exist on the site. Cached ~20 h. */
export async function loadSections(term, offerings, known) {
  const rows = (offerings.rows[term] ?? []).filter((r) => (!r.career || r.career === 'UG') && known.has(codeOf({ subjectCode: r.subject, catalogNumber: r.number })));
  const path = `${CACHE}/sections-${term}.json`;
  const hit = await readCache(path);
  if (hit && ageDays(hit.fetchedAt) < 0.8) {
    console.log(`Sections ${term}: cached (${Object.keys(hit.data).length} courses)`);
    return hit.data;
  }
  const data = {};
  let failed = 0;
  await pool(
    rows,
    CONCURRENCY,
    async (r) => {
      try {
        const classes = await od(`ClassSchedules/${term}/${encodeURIComponent(r.subject)}/${encodeURIComponent(r.number)}`);
        if (!classes?.length) return;
        data[codeOf({ subjectCode: r.subject, catalogNumber: r.number })] = classes
          .map(toSection)
          .sort((a, b) => compRank(a.comp) - compRank(b.comp) || a.sec.localeCompare(b.sec));
      } catch (err) {
        failed++;
        if (failed <= 5) console.warn(`  ! sections ${term} ${r.subject} ${r.number}: ${err.message}`);
      }
    },
    `sections ${term}`,
    500,
  );
  if (failed > rows.length * 0.25 && hit) {
    console.warn(`! sections ${term}: ${failed} failures, keeping previous snapshot`);
    return hit.data;
  }
  await writeCache(path, { fetchedAt: new Date().toISOString(), data });
  return data;
}

/** Open Data academic group → faculty key used for colour. Affiliated colleges teach Arts subjects. */
export const FACULTY = {
  MAT: 'mat', ENG: 'eng', ART: 'art', REN: 'art', CGC: 'art', STJ: 'art', STP: 'art', THL: 'art', UCOL: 'art',
  ENV: 'env', AHS: 'hea', HEA: 'hea', HLTH: 'hea', SCI: 'sci',
};
export const FACULTY_NAMES = { mat: 'Mathematics', eng: 'Engineering', art: 'Arts', env: 'Environment', hea: 'Health', sci: 'Science' };
