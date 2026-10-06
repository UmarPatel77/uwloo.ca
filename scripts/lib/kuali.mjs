// The JSON API behind https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog
// No key needed. Endpoints:
//   GET /public/catalogs/                 every published catalog (undergrad + grad, all years)
//   GET /courses/{catalogId}              course index: pid, __catalogCourseId, title, subjectCode
//   GET /course/{catalogId}/{pid}         one course: description, credits, requisites, notes…
import { ageDays, getJson, pool, readCache, writeCache } from './http.mjs';
import { kualiToTree, norm, treeSignature } from './requisites.mjs';
import { yearCodeFor, yearLabel } from './terms.mjs';

export const KUALI_BASE = process.env.KUALI_BASE ?? 'https://uwaterloocm.kuali.co/api/v1/catalog';
export const CALENDAR_PAGE = 'https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog';
const FIRST_KUALI_START = 2024; // 2024–25 is the first undergraduate calendar on Kuali
const CACHE = '.cache/kuali';
const LIVE_MAX_AGE_DAYS = Number(process.env.KUALI_MAX_AGE_DAYS ?? 7);
const CONCURRENCY = Number(process.env.KUALI_CONCURRENCY ?? 6);

/** Undergraduate catalogs from 2024–25 on, one per academic year, oldest first, with a status. */
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

  const byYear = new Map();
  for (const c of raw) {
    const id = c.id ?? c._id;
    const title = norm(c.title ?? '');
    if (!id || !/undergraduate/i.test(title) || /draft|test|copy/i.test(title)) continue;
    const span = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(title);
    const start = span ? Number(span[1]) : Number(String(c.startDate ?? '').slice(0, 4)) || null;
    if (!start || start < FIRST_KUALI_START) continue;
    const entry = { id, title, start, yearCode: yearCodeFor(start), label: yearLabel(start), startDate: c.startDate ?? null, endDate: c.endDate ?? null };
    const prev = byYear.get(start);
    if (!prev || String(entry.startDate) > String(prev.startDate)) byYear.set(start, entry);
  }
  const list = [...byYear.values()].sort((a, b) => a.start - b.start);
  if (!list.length) return list;

  const today = now.toISOString().slice(0, 10);
  const academicStart = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const live = list.filter((c) => c.startDate && c.startDate.slice(0, 10) <= today && (!c.endDate || today < c.endDate.slice(0, 10)));
  const current = live.at(-1) ?? list.filter((c) => c.start <= academicStart).at(-1) ?? list[0];
  for (const c of list) c.status = c === current ? 'current' : c.start < current.start ? 'past' : 'future';
  return list;
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
      console.warn(`! ${cat.label} index failed (${err.message}); using cached copy`);
      index = cachedIndex.data;
    }
  }
  index = index.filter((e) => e?.pid && e?.__catalogCourseId);
  console.log(`${cat.label} calendar (${cat.status}): ${index.length} courses`);

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
    `${cat.label} details`,
    1000,
  );
  console.log(`  fetched ${fetched}, from cache ${index.length - fetched - failed}, failed ${failed}`);
  if (failed > index.length * 0.2) {
    throw new Error(`${cat.label}: ${failed}/${index.length} course details failed; not publishing a half-empty calendar`);
  }
  return courses;
}

export const calendarCourseUrl = (pid) => `${CALENDAR_PAGE}#/courses/${pid}`;
