// Builds the static site into dist/. Run by GitHub Actions daily; also runnable locally:
//   node scripts/build.mjs                 (Kuali only)
//   UW_API_KEY=… node scripts/build.mjs    (adds offering history and section seats)
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as kuali from './lib/kuali.mjs';
import * as opendata from './lib/opendata.mjs';
import { coursePage, homePage, notFoundPage, redirectPage, SITE, subjectPage, yearPage } from './lib/render.mjs';
import { offeredHint, slug, treeCodes } from './lib/requisites.mjs';
import { shiftTerm, termCode, termRange } from './lib/terms.mjs';

const OUT = 'dist';
const TERMS_BACK = Number(process.env.TERMS_BACK ?? 6);
const TERMS_AHEAD = Number(process.env.TERMS_AHEAD ?? 2);
const SECTION_TERMS = Number(process.env.SECTION_TERMS ?? 2); // current + next
const byNumber = (a, b) => a.number.localeCompare(b.number, 'en', { numeric: true });

async function write(path, content) {
  const full = join(OUT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

async function writeAll(entries, n = 64) {
  for (let i = 0; i < entries.length; i += n) await Promise.all(entries.slice(i, i + n).map(([p, c]) => write(p, c)));
}

async function main() {
  const builtAt = new Date();
  const css = await readFile('site/style.css');
  const js = await readFile('site/app.js');
  const version = createHash('sha1').update(css).update(js).digest('hex').slice(0, 8);

  // 1. Calendars (Kuali)
  const catalogs = await kuali.loadCatalogList(builtAt);
  if (!catalogs.length) throw new Error('No undergraduate calendars found in Kuali');
  for (const cat of catalogs) cat.courses = await kuali.loadCourses(cat);
  const current = catalogs.find((c) => c.status === 'current');
  console.log(`Current calendar: ${current.label}`);

  // Which version of each course gets the /code/ page: current calendar, then newer, then most recent older.
  const priority = [current, ...catalogs.filter((c) => c.status === 'future'), ...catalogs.filter((c) => c.status === 'past').reverse()];
  const primary = new Map();
  for (const cat of priority) for (const [code, course] of cat.courses) if (!primary.has(code)) primary.set(code, { cat, course });
  const known = new Set(primary.keys());

  // "Leads to": every course whose prerequisites or corequisites mention this one.
  const leadsTo = new Map();
  for (const [code, { course }] of primary) {
    for (const ref of treeCodes([...(course.prereq ?? []), ...(course.coreq ?? [])])) {
      if (ref === code || !known.has(ref)) continue;
      if (!leadsTo.has(ref)) leadsTo.set(ref, new Set());
      leadsTo.get(ref).add(code);
    }
  }

  // 2. Offerings and sections (Open Data, optional)
  const curTerm = termCode(builtAt);
  const termWindow = termRange(shiftTerm(curTerm, -TERMS_BACK), shiftTerm(curTerm, TERMS_AHEAD));
  let offerings = null;
  const sections = {};
  if (opendata.enabled()) {
    try {
      offerings = await opendata.loadOfferings(termWindow, curTerm);
      for (const term of termWindow.slice(TERMS_BACK, TERMS_BACK + SECTION_TERMS)) {
        if (offerings.terms[term]?.published) sections[term] = await opendata.loadSections(term, offerings, known);
      }
    } catch (err) {
      console.warn(`! Open Data unavailable (${err.message}); building without offerings`);
      offerings = null;
    }
  } else {
    console.log('UW_API_KEY not set: skipping offering history and seats');
  }

  // Faculty colour per course, falling back to the subject's most common faculty.
  const facultyOf = new Map();
  const subjectVotes = new Map();
  if (offerings) {
    for (const [code, group] of offerings.faculty) {
      const key = opendata.FACULTY[group];
      if (!key) continue;
      facultyOf.set(code, key);
      const subj = /^[A-Z]+/.exec(code)?.[0];
      const votes = subjectVotes.get(subj) ?? {};
      votes[key] = (votes[key] ?? 0) + 1;
      subjectVotes.set(subj, votes);
    }
  }
  const subjectFaculty = (s) => Object.entries(subjectVotes.get(s) ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const faculty = (code, subject) => facultyOf.get(code) ?? subjectFaculty(subject);

  // 3. Render
  const pages = [];
  const sitemap = [];
  const calendarBaseFor = (cat) => (cat.status === 'current' ? kuali.CALENDAR_PAGE : null);

  for (const [code, { cat, course }] of primary) {
    const history = [];
    let prevSig = null;
    for (const k of catalogs) {
      const v = k.courses.get(code);
      if (!v) {
        prevSig = null;
        continue;
      }
      history.push({ cat: k, changed: prevSig !== null && prevSig !== v.signature });
      prevSig = v.signature;
    }
    const strip = offerings
      ? termWindow.map((term) => {
          const t = offerings.terms[term];
          const future = Number(term) > Number(curTerm);
          const state = !t?.published ? 'tbd' : t.offered.has(code) ? 'on' : 'off';
          return { term, state, now: term === curTerm, future };
        })
      : null;
    const sectionsByTerm = Object.entries(sections).map(([term, data]) => ({ term, list: data[code] ?? [] }));
    const leads = [...(leadsTo.get(code) ?? [])]
      .map((c) => ({ code: c, title: primary.get(c).course.title }))
      .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
    pages.push([
      `${slug(code)}/index.html`,
      coursePage({
        course,
        cat,
        known,
        leadsTo: leads,
        history,
        faculty: faculty(code, course.subject),
        strip,
        hint: offeredHint(course.description, course.notesHtml),
        sectionsByTerm,
        curTerm,
        calendarBase: calendarBaseFor(cat),
        builtAt,
        version,
      }),
    ]);
    sitemap.push(`/${slug(code)}/`);
  }

  const subjectsByYear = new Map();
  for (const cat of catalogs) {
    const bySubject = new Map();
    for (const c of cat.courses.values()) {
      if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
      bySubject.get(c.subject).push(c);
    }
    const subjects = [...bySubject.entries()]
      .map(([subject, list]) => ({ subject, name: list[0].subjectName, count: list.length, list: list.sort(byNumber) }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
    subjectsByYear.set(cat, subjects);
    for (const s of subjects) {
      pages.push([
        `${cat.yearCode}/${slug(s.subject)}/index.html`,
        subjectPage({
          cat,
          catalogs,
          subject: s.subject,
          subjectName: s.name,
          courses: s.list,
          known,
          faculty: subjectFaculty(s.subject),
          calendarBase: calendarBaseFor(cat),
          builtAt,
          version,
        }),
      ]);
      if (cat === current) sitemap.push(`/${cat.yearCode}/${slug(s.subject)}/`);
    }
    pages.push([`${cat.yearCode}/index.html`, yearPage({ cat, catalogs, subjects, builtAt, version })]);
    sitemap.push(`/${cat.yearCode}/`);
  }

  // /cs → current year's CS page, as a real file so it isn't a 404.
  const allSubjects = new Set();
  for (const subjects of subjectsByYear.values()) for (const s of subjects) allSubjects.add(s.subject);
  for (const s of allSubjects) {
    const target = (subjectsByYear.get(current).some((x) => x.subject === s) ? current : catalogs.findLast((k) => k.courses.size && subjectsByYear.get(k).some((x) => x.subject === s))).yearCode;
    pages.push([`${slug(s)}/index.html`, redirectPage(`/${target}/${slug(s)}/`)]);
  }

  const groupNames = { mat: 'Mathematics', eng: 'Engineering', sci: 'Science', hea: 'Health', env: 'Environment', art: 'Arts' };
  const homeSubjects = subjectsByYear.get(current);
  const groups = subjectVotes.size
    ? [...Object.entries(groupNames), ['other', 'Other']]
        .map(([key, name]) => ({ key, name, subjects: homeSubjects.filter((s) => (subjectFaculty(s.subject) ?? 'other') === key) }))
        .filter((g) => g.subjects.length)
    : [{ key: 'all', name: 'Subjects', subjects: homeSubjects }];
  pages.push(['index.html', homePage({ current, catalogs, groups, courseCount: current.courses.size, builtAt, version })]);
  sitemap.push('/');

  const meta = { years: catalogs.map((c) => c.yearCode), current: current.yearCode, subjects: [...allSubjects].map(slug).sort() };
  pages.push(['404.html', notFoundPage({ meta, builtAt, version })]);

  const search = [...primary.entries()]
    .map(([code, { course }]) => [code, course.title])
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  pages.push(['search.json', JSON.stringify(search)]);
  pages.push(['sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>\n`]);
  pages.push(['robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`]);
  pages.push(['CNAME', 'uwloo.ca\n']);
  pages.push(['.nojekyll', '']);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp('site', OUT, { recursive: true });
  await writeAll(pages);
  console.log(`Wrote ${pages.length} files to ${OUT}/ (${primary.size} course pages)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
