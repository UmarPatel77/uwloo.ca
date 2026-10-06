// The JSON API behind both Academic Calendars. No key needed. Endpoints:
//   GET /public/catalogs/                 every published catalog: undergrad (yearly) and grad (per term)
//   GET /courses/{catalogId}              course index: pid, __catalogCourseId, title, subjectCode
//   GET /course/{catalogId}/{pid}         one course: description, credits, requisites, notes…
// Human pages: https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog
//              https://uwaterloo.ca/academic-calendar/graduate-studies/catalog
import { ageDays, getJson, pool, readCache, writeCache } from './http.mjs';
import { kualiToTree, norm, treeSignature } from './requisites.mjs';
import { termCode, termFrom, yearCodeFor, yearLabel } from './terms.mjs';

export const KUALI_BASE = process.env.KUALI_BASE ?? 'https://uwaterloocm.kuali.co/api/v1/catalog';
export const CALENDAR_PAGE = 'https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog';
export const GRAD_CALENDAR_PAGE = 'https://uwaterloo.ca/academic-calendar/graduate-studies/catalog';
const FIRST_UG_START = 2024; // 2024–25 is the first undergraduate calendar on Kuali
export const FIRST_GRAD_TERM = '1245'; // Spring 2024 is the first graduate calendar on Kuali
const CACHE = '.cache/kuali';
const LIVE_MAX_AGE_DAYS = Number(process.env.KUALI_MAX_AGE_DAYS ?? 7);
const CONCURRENCY = Number(process.env.KUALI_CONCURRENCY ?? 6);

const SEASON_MONTH = { winter: 1, spring: 5, fall: 9 };
const cap = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** Marks the live catalog 'current' (dates contain today, else the latest that has started) and the rest past/future. */
function setStatus(list, isStarted, now) {
  if (!list.length) return list;
  const today = now.toISOString().slice(0, 10);
  const live = list.filter((c) => c.startDate && day(c.startDate) <= today && (!c.endDate || today < day(c.endDate)));
  const current = live.at(-1) ?? list.filter(isStarted).at(-1) ?? list[0];
  const i = list.indexOf(current);
  list.forEach((c, j) => (c.status = j === i ? 'current' : j < i ? 'past' : 'future'));
  return list;
}

/**
 * Sorts Kuali's catalog list into undergraduate years (2024–25 on) and graduate terms (Spring 2024 on),
 * oldest first, one catalog per year or term. Pure, so it's unit-tested.
 */
export function classifyCatalogs(raw, now = new Date()) {
  const ug = new Map();
  const grad = new Map();
  for (const c of raw ?? []) {
    const id = c.id ?? c._id;
    const title = norm(c.title ?? '');
    if (!id || /draft|test|copy|sandbox/i.test(title)) continue;
    const base = { id, title, startDate: c.startDate ?? null, endDate: c.endDate ?? null };

    if (/undergraduate/i.test(title)) {
      const span = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(title);
      const start = span ? Number(span[1]) : Number(String(c.startDate ?? '').slice(0, 4)) || null;
      if (!start || start < FIRST_UG_START) continue;
      const entry = { ...base, level: 'ug', start, yearCode: yearCodeFor(start), label: yearLabel(start), name: `${yearLabel(start)} undergraduate` };
      const prev = ug.get(start);
      if (!prev || String(entry.startDate) > String(prev.startDate)) ug.set(start, entry);
    } else if (/\bgraduate/i.test(title)) {
      // "Fall 2024", "2024 Fall", or no term in the title at all (then the start date decides).
      const m = /(fall|winter|spring)\W{0,3}(\d{4})/i.exec(title) ?? /(\d{4})\W{0,3}(fall|winter|spring)/i.exec(title);
      let season;
      let year;
      if (m) {
        season = /\d/.test(m[1]) ? m[2] : m[1];
        year = Number(/\d/.test(m[1]) ? m[1] : m[2]);
      } else if (c.startDate) {
        const month = Number(day(c.startDate).slice(5, 7));
        season = month <= 4 ? 'winter' : month <= 8 ? 'spring' : 'fall';
        year = Number(day(c.startDate).slice(0, 4));
      } else continue;
      season = season.toLowerCase();
      const term = termFrom(year, SEASON_MONTH[season]);
      if (Number(term) < Number(FIRST_GRAD_TERM)) continue;
      const academicStart = season === 'fall' ? year : year - 1;
      const entry = {
        ...base,
        level: 'grad',
        term,
        season: cap(season),
        year,
        label: `${cap(season)} ${year}`,
        name: `${cap(season)} ${year} graduate`,
        yearCode: yearCodeFor(academicStart),
        archiveSlug: `${season}-${year}`,
      };
      const prev = grad.get(term);
      if (!prev || String(entry.startDate) > String(prev.startDate)) grad.set(term, entry);
    }
  }

  const academicStart = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const curTerm = termCode(now);
  const ugList = setStatus([...ug.values()].sort((a, b) => a.start - b.start), (c) => c.start <= academicStart, now);
  const gradList = setStatus([...grad.values()].sort((a, b) => Number(a.term) - Number(b.term)), (c) => Number(c.term) <= Number(curTerm), now);

  // Where each calendar lives on uwaterloo.ca: the live one at the main page, older ones under /archive/.
  for (const c of ugList) c.pageUrl = c.status === 'past' ? `${CALENDAR_PAGE}/archive/${c.start}-${c.start + 1}` : CALENDAR_PAGE;
  for (const c of gradList) c.pageUrl = c.status === 'past' ? `${GRAD_CALENDAR_PAGE}/archive/${c.archiveSlug}` : GRAD_CALENDAR_PAGE;
  return { ug: ugList, grad: gradList };
}

export async function loadCatalogList(now = new Date()) {
  let raw;
  try {
    const payload = await getJson(`${KUALI_BASE}/public/catalogs/`);
    raw = Array.isArray(payload) ? payload : (payload?.catalogs ?? []);
    await writeCache(`${CACHE}/catalogs.json`, raw);
  } catch (err) {
    console.warn(`! catalog list failed (${err.message}); using cached copy`);
    raw = (await readCache(`${CACHE}/catalogs.json`)) ?? [];
  }
  return classifyCatalogs(raw, now);
}

const stripCodeSuffix = (s) => norm(s).replace(/\s*\([^)]*\)\s*$/, '');

function parseUnits(credits) {
  const v = credits?.value ?? credits;
  const n = typeof v === 'object' && v ? Number(v.max ?? v.min) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeCourse(entry, detail) {
  const d = detail ?? {};
  const code = String(d.__catalogCourseId ?? entry.__catalogCourseId ?? '').replace(/\s+/g, '').toUpperCase();
  let subject = String(d.subjectCode?.name ?? entry.subjectCode?.name ?? '').toUpperCase();
  if (!subject || !code.startsWith(subject)) subject = /^[A-Z]+/.exec(code)?.[0] ?? '';
  const prereq = kualiToTree(d.prerequisites);
  const coreq = kualiToTree(d.corequisites);
  const antireq = kualiToTree(d.antirequisites);
  return {
    code,
    subject,
    number: code.slice(subject.length),
    pid: entry.pid,
    title: norm(d.title ?? entry.title ?? ''),
    subjectName: stripCodeSuffix(d.subjectCode?.description ?? entry.subjectCode?.description ?? '') || subject,
    units: parseUnits(d.credits),
    description: norm(String(d.description ?? '').replace(/<[^>]*>/g, ' ')),
    notesHtml: d.notes ?? '',
    prereq,
    coreq,
    antireq,
    crossListed: [...new Set((d.crossListedCourses ?? []).map((x) => String(x.__catalogCourseId ?? '').replace(/\s+/g, '').toUpperCase()))].filter(
      (c) => c && c !== code,
    ),
    signature: `${treeSignature(prereq)}|${treeSignature(coreq)}|${treeSignature(antireq)}`,
    detailMissing: !detail,
  };
}

/** Load every course in a catalog. Past calendars are cached forever; live ones refresh weekly or when Kuali's version id changes. */
export async function loadCourses(cat) {
  const dir = `${CACHE}/${cat.id}`;
  let index;
  const cachedIndex = await readCache(`${dir}/index.json`);
  if (cat.status === 'past' && cachedIndex?.data?.length) {
    index = cachedIndex.data;
  } else {
    try {
      index = await getJson(`${KUALI_BASE}/courses/${cat.id}`);
      await writeCache(`${dir}/index.json`, { fetchedAt: new Date().toISOString(), data: index });
    } catch (err) {
      if (!cachedIndex?.data?.length) throw err;
      console.warn(`! ${cat.name} index failed (${err.message}); using cached copy`);
      index = cachedIndex.data;
    }
  }
  index = index.filter((e) => e?.pid && e?.__catalogCourseId);
  console.log(`${cat.name} calendar (${cat.status}): ${index.length} courses`);

  const courses = new Map();
  let fetched = 0;
  let failed = 0;
  await pool(
    index,
    CONCURRENCY,
    async (entry) => {
      const path = `${dir}/courses/${entry.pid}.json`;
      const hit = await readCache(path);
      const versionChanged = hit && entry._id && hit.version && hit.version !== entry._id;
      const stale = hit && cat.status !== 'past' && ageDays(hit.fetchedAt) > LIVE_MAX_AGE_DAYS;
      let detail = hit?.data ?? null;
      if (!hit || versionChanged || stale) {
        try {
          detail = await getJson(`${KUALI_BASE}/course/${cat.id}/${entry.pid}`);
          await writeCache(path, { fetchedAt: new Date().toISOString(), version: entry._id ?? null, data: detail });
          fetched++;
        } catch (err) {
          if (!detail) failed++;
          if (failed <= 10) console.warn(`  ! ${entry.__catalogCourseId}: ${err.message}${detail ? ' (kept cached copy)' : ''}`);
        }
      }
      const course = normalizeCourse(entry, detail);
      if (course.code) courses.set(course.code, course);
    },
    `${cat.name} details`,
    1000,
  );
  console.log(`  fetched ${fetched}, from cache ${index.length - fetched - failed}, failed ${failed}`);
  if (failed > index.length * 0.2) {
    throw new Error(`${cat.name}: ${failed}/${index.length} course details failed; not publishing a half-empty calendar`);
  }
  return courses;
}

/** The course's entry in the official calendar it came from (live or archived). */
export const calendarCourseUrl = (cat, pid) => `${cat.pageUrl}#/courses/${pid}`;
