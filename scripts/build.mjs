// Builds the static site into dist/. Run by GitHub Actions daily; also runnable locally:
//   node scripts/build.mjs                 (Kuali only)
//   UW_API_KEY=… node scripts/build.mjs    (adds offering history and section seats)
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { archiveSubjectPage, archiveYearPage, loadArchiveText, textMap } from './lib/archive.mjs';
import * as kuali from './lib/kuali.mjs';
import { loadReddit, redditSection, SHOWN } from './lib/reddit.mjs';
import { available, entryPages, linksAboutPage, loadResources, publishFiles, resourcePage, resourcesSection, syncFiles } from './lib/resources.mjs';
import { loadHistory } from './lib/history.mjs';
import { archiveAppearances, mentionsOf, retiredCourses, retiredPage } from './lib/retired.mjs';
import { gradAppearances, loadGradArchive, oldTermIndexPage, oldTermSubjectPage, oldTerms } from './lib/gradarchive.mjs';
import { groupThreads } from '../site/reddit.js';
import * as opendata from './lib/opendata.mjs';
import {
  coursePage,
  homePage,
  notFoundPage,
  outlineUrl,
  redirectPage,
  SITE,
  termIndexPage,
  termNav,
  termSubjectPage,
  yearPage,
  yearSubjectPage,
} from './lib/render.mjs';
import { offeredHint, slug, treeCodes } from './lib/requisites.mjs';
import { shiftTerm, termCode, termName, termRange } from './lib/terms.mjs';

const OUT = 'dist';
const TERMS_BACK = Number(process.env.TERMS_BACK ?? 6);
const TERMS_AHEAD = Number(process.env.TERMS_AHEAD ?? 2);
const SECTION_TERMS = Number(process.env.SECTION_TERMS ?? 2); // current + next
const HISTORY_BACK = Number(process.env.HISTORY_TERMS_BACK ?? 21); // how far back courses.csv looks for "last ran" (7 years)
const byNumber = (a, b) => a.number.localeCompare(b.number, 'en', { numeric: true });
const byCode = (a, b) => a.localeCompare(b, 'en', { numeric: true });

async function write(path, content) {
  const full = join(OUT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

async function writeAll(entries, n = 64) {
  for (let i = 0; i < entries.length; i += n) await Promise.all(entries.slice(i, i + n).map(([p, c]) => write(p, c)));
}

/** subject → courses, numerically sorted. */
function bySubject(courses) {
  const out = new Map();
  for (const c of courses) {
    if (!out.has(c.subject)) out.set(c.subject, []);
    out.get(c.subject).push(c);
  }
  for (const list of out.values()) list.sort(byNumber);
  return out;
}

async function main() {
  const builtAt = new Date();
  const css = await readFile('site/style.css');
  const js = await readFile('site/app.js');
  const rjs = await readFile('site/reddit.js');
  const vjs = await readFile('site/viewer.js');
  const version = createHash('sha1').update(css).update(js).update(rjs).update(vjs).digest('hex').slice(0, 8);

  // 1. Calendars (Kuali): undergrad by academic year, grad by term.
  const { ug, grad } = await kuali.loadCatalogList(builtAt);
  if (!ug.length) throw new Error('No undergraduate calendars found in Kuali');
  if (!grad.length) console.warn('! No graduate calendars found in Kuali; building undergrad only');
  for (const cat of [...ug, ...grad]) {
    cat.courses = await kuali.loadCourses(cat);
    cat.bySubject = bySubject(cat.courses.values());
    cat.subjects = new Set(cat.bySubject.keys());
  }
  // Older Graduate Calendars, Fall 2006 to Winter 2024 (data/grad-archive, from scripts/grad-archive.mjs).
  // Terms not in there yet still show in the term grid, linked to Waterloo's archive.
  const subjectNames = new Map();
  for (const cat of [...ug, ...grad]) for (const c of cat.courses.values()) if (c.subjectName) subjectNames.set(c.subject, c.subjectName);
  const oldCats = await loadGradArchive({ names: (s) => subjectNames.get(s) ?? null });
  const oldHave = new Set(oldCats.map((c) => c.term));
  const gradNav = [
    ...oldCats,
    ...oldTerms()
      .filter((t) => !oldHave.has(t.term))
      .map((t) => ({ term: t.term, label: t.label, kind: 'link', href: t.official })),
    ...grad,
  ].sort((a, b) => Number(a.term) - Number(b.term));
  console.log(`Older Graduate Calendars: ${oldCats.length} terms (${oldCats.filter((c) => c.source === 'opendata').length} from Open Data), ${oldCats.reduce((n, c) => n + c.courses.size, 0)} course entries`);

  const current = ug.find((c) => c.status === 'current');
  const gradCurrent = grad.find((c) => c.status === 'current') ?? null;
  console.log(`Current calendars: ${current.label} undergraduate, ${gradCurrent?.label ?? 'none'} graduate`);

  // The grad calendar shown on a year's subject pages: the latest term of that academic year that has started.
  const gradForYear = (yearCode) => {
    const inYear = grad.filter((g) => g.yearCode === yearCode);
    return inYear.filter((g) => g.status !== 'future').at(-1) ?? inYear.at(-1) ?? null;
  };
  const ugYears = new Set(ug.map((c) => c.yearCode));

  // Which version of each course gets the /code/ page: the live calendars, then newer ones, then the most recent older ones.
  const priority = [
    current,
    gradCurrent,
    ...ug.filter((c) => c.status === 'future'),
    ...grad.filter((c) => c.status === 'future'),
    ...ug.filter((c) => c.status === 'past').reverse(),
    ...grad.filter((c) => c.status === 'past').reverse(),
  ].filter(Boolean);
  const primary = new Map();
  for (const cat of priority) for (const [code, course] of cat.courses) if (!primary.has(code)) primary.set(code, { cat, course });
  const known = new Set(primary.keys());

  // "Leads to": every course whose prerequisites or corequisites mention this one (undergrad and grad).
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
  const historyWindow = termRange(shiftTerm(curTerm, -Math.max(HISTORY_BACK, TERMS_BACK)), shiftTerm(curTerm, TERMS_AHEAD));
  let offerings = null;
  const sections = {};
  if (opendata.enabled()) {
    try {
      offerings = await opendata.loadOfferings(historyWindow, curTerm);
      for (const term of termRange(curTerm, shiftTerm(curTerm, SECTION_TERMS - 1))) {
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
  const ctxBase = { builtAt, version };

  // Where a course sits on a calendar page: grad terms that share a year page link there, others to their term page.
  const subjectHref = (cat, subject, code) =>
    cat.level === 'ug' || (ugYears.has(cat.yearCode) && gradForYear(cat.yearCode) === cat)
      ? `/${cat.yearCode}/${slug(subject)}/#${code}`
      : `/${cat.term}/${slug(subject)}/#${code}`;

  const historyIn = (list, code, href) => {
    const out = [];
    let prevSig = null;
    for (const k of list) {
      const v = k.courses.get(code);
      if (!v) {
        prevSig = null;
        continue;
      }
      out.push({ cat: k, changed: prevSig !== null && prevSig !== v.signature, href: href(k, v) });
      prevSig = v.signature;
    }
    return out;
  };

  // Every calendar a course appears in: undergrad years link to that year's subject page, grad terms to their version page.
  const historyFor = (code) => ({
    ug: historyIn(ug, code, (k, v) => `/${k.yearCode}/${slug(v.subject)}/#${code}`),
    grad: historyIn(grad, code, (k) => `/${k.term}/${slug(code)}/`),
    old: historyIn(oldCats, code, (k, v) => `/${k.term}/${slug(v.subject)}/#${code}`),
  });
  const leadsList = (codes, titleOf) => [...(codes ?? [])].map((c) => ({ code: c, title: titleOf(c) })).sort((a, b) => byCode(a.code, b.code));

  // r/uwaterloo mentions (data/reddit/, see tools/reddit/). Pages show the newest; /reddit/{code}.json has the rest.
  const reddit = await loadReddit();
  const repo = process.env.GITHUB_REPOSITORY || 'UmarPatel77/uwloo.ca';
  let redditPages = 0;

  // Courses no longer offered (in no calendar uwloo has): Open Data's catalog history, built up a few terms
  // per build, and the scanned 1963–64 to 1994–95 calendars. They get pages, and links to them from
  // today's calendar (an antirequisite that's gone, say) go there.
  const courseHistory = await loadHistory(curTerm, opendata.enabled() ? {} : { maxNew: 0 });
  const archiveText = await loadArchiveText();
  const gradOld = gradAppearances(oldCats);
  const retired = retiredCourses({ history: courseHistory, archive: archiveAppearances(archiveText), current: known, grad: gradOld });
  const linkable = { has: (c) => known.has(c) || retired.has(c), href: (c) => (known.has(c) || retired.has(c) ? `/${slug(c)}/` : null), retired };

  // Course resources (data/resources/, see tools/resources/). Hosted PDFs come from the "files" release;
  // one that isn't there yet is hidden, so a page never links to a missing file.
  const res = await loadResources();
  for (const err of res.errors) console.warn(`! data/resources/${err}`);
  const onHand = await syncFiles(res.entries, { repo, token: process.env.GITHUB_TOKEN });
  for (const e of res.entries) if (!known.has(e.codes[0])) console.warn(`! Resource ${e.id}: ${e.codes[0]} has no page on uwloo, so it's hidden`);
  const shown = res.entries.filter((e) => known.has(e.codes[0])).map((e) => available(e, onHand)).filter(Boolean);
  // Links the finder found (data/links/found.json, from scripts/find-links.mjs), minus any removed on request.
  const foundFile = JSON.parse(await readFile('data/links/found.json', 'utf8').catch(() => 'null'));
  const removedLinks = (await readFile('data/links/removed.txt', 'utf8').catch(() => ''))
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
  const linkRemoved = (url) =>
    removedLinks.some((r) => (r.endsWith('*') ? url.startsWith(r.slice(0, -1)) : r.includes('/') ? url.replace(/\/$/, '') === r.replace(/\/$/, '') : new URL(url).hostname.replace(/^www\./, '') === r.replace(/^www\./, '')));
  const foundFor = new Map();
  for (const l of foundFile?.links ?? []) {
    if (linkRemoved(l.url)) continue;
    for (const c of l.codes) {
      if (!linkable.has(c)) continue;
      if (!foundFor.has(c)) foundFor.set(c, []);
      foundFor.get(c).push(l);
    }
  }
  const resourcesFor = new Map();
  for (const e of shown) {
    for (const c of e.codes) {
      if (!known.has(c)) continue;
      if (!resourcesFor.has(c)) resourcesFor.set(c, []);
      resourcesFor.get(c).push(e);
    }
  }

  for (const [code, { cat, course }] of primary) {
    const history = historyFor(code);
    const strip = offerings
      ? termWindow.map((term) => {
          const t = offerings.terms[term];
          const future = Number(term) > Number(curTerm);
          const state = !t?.published ? 'tbd' : t.offered.has(code) ? 'on' : 'off';
          return { term, state, now: term === curTerm, future };
        })
      : null;
    const sectionsByTerm = Object.entries(sections).map(([term, data]) => ({ term, list: data[code] ?? [] }));
    const leads = leadsList(leadsTo.get(code), (c) => primary.get(c).course.title);
    pages.push([
      `${slug(code)}/index.html`,
      coursePage({
        ...ctxBase,
        course,
        cat,
        known: linkable,
        leadsTo: leads,
        history,
        faculty: faculty(code, course.subject),
        strip,
        hint: offeredHint(course.description, course.notesHtml),
        sectionsByTerm,
        curTerm,
        subjectHref: subjectHref(cat, course.subject, code).replace(/#.*$/, ''),
        reddit: redditSection(code, reddit.map.get(code), reddit.meta, { repo, slug: slug(code), version }),
        resources: resourcesSection(code, resourcesFor.get(code), { known: linkable, repo, found: foundFor.get(code) }),
      }),
    ]);
    sitemap.push(`/${slug(code)}/`);
    const mentions = reddit.map.get(code);
    if (mentions && groupThreads(mentions).length > SHOWN) pages.push([`reddit/${slug(code)}.json`, JSON.stringify(mentions)]);
    if (mentions?.length) redditPages++;
  }

  // "No longer offered" pages (/msci452/).
  const stillMentioned = mentionsOf(primary, retired);
  for (const r of retired.values()) {
    const subject = /^[A-Z]+/.exec(r.code)[0];
    const mentions = reddit.map.get(r.code);
    const extra = redditSection(r.code, mentions, reddit.meta, { repo, slug: slug(r.code), version }) + resourcesSection(r.code, [], { known: linkable, repo, found: foundFor.get(r.code) });
    pages.push([`${slug(r.code)}/index.html`, retiredPage({ ...ctxBase, r, known: linkable, mentions: stillMentioned, reddit: extra, floor: courseHistory.floor, oldHave, faculty: faculty(r.code, subject) })]);
    sitemap.push(`/${slug(r.code)}/`);
    if (mentions && groupThreads(mentions).length > SHOWN) pages.push([`reddit/${slug(r.code)}.json`, JSON.stringify(mentions)]);
    if (mentions?.length) redditPages++;
  }

  // Resource pages (/cs341/1249-notes/, /cs341/1249-notes/2/): the notes, then one PDF.
  let hostedPages = 0;
  for (const e of shown) {
    const { course } = primary.get(e.codes[0]);
    for (const [path, p] of entryPages(e)) {
      if (!p) {
        pages.push([`${path.slice(1)}index.html`, redirectPage(entryPages(e)[0][0])]);
        continue;
      }
      const text = await readFile(`data/resources/text/${p.file.slice(0, -4)}.txt`, 'utf8').catch(() => '');
      pages.push([`${path.slice(1)}index.html`, resourcePage({ ...ctxBase, e, p, course, known, text, repo, faculty: faculty(e.codes[0], course.subject) })]);
      sitemap.push(path);
      hostedPages++;
    }
  }

  // Grad version pages (/1249/math631): each course exactly as one term's Graduate Calendar lists it.
  // Links on them stay in that term when the other course is in the same calendar.
  let versionPages = 0;
  for (const cat of grad) {
    const linker = {
      has: (c) => known.has(c),
      href: (c) => (cat.courses.has(c) ? `/${cat.term}/${slug(c)}/` : known.has(c) ? `/${slug(c)}/` : null),
    };
    const termLeads = new Map();
    for (const [code, course] of cat.courses) {
      for (const ref of treeCodes([...(course.prereq ?? []), ...(course.coreq ?? [])])) {
        if (ref === code || !cat.courses.has(ref)) continue;
        if (!termLeads.has(ref)) termLeads.set(ref, new Set());
        termLeads.get(ref).add(code);
      }
    }
    for (const [code, course] of cat.courses) {
      pages.push([
        `${cat.term}/${slug(code)}/index.html`,
        coursePage({
          ...ctxBase,
          course,
          cat,
          known: linker,
          leadsTo: leadsList(termLeads.get(code), (c) => cat.courses.get(c).title),
          history: historyFor(code),
          faculty: faculty(code, course.subject),
          strip: null,
          hint: null,
          sectionsByTerm: [],
          curTerm,
          subjectHref: `/${cat.term}/${slug(course.subject)}/`,
          versionTerm: cat.term,
        }),
      ]);
      versionPages++;
    }
  }

  // Year pages (/2627/cs): undergrad, then that year's grad calendar.
  const yearSubjects = new Map(); // yearCode → [{subject, name, ug, grad}]
  for (const cat of ug) {
    const gradCat = ugYears.has(cat.yearCode) ? gradForYear(cat.yearCode) : null;
    const subjects = [...new Set([...cat.subjects, ...(gradCat?.subjects ?? [])])].sort();
    const rows = [];
    for (const subject of subjects) {
      const ugCourses = cat.bySubject.get(subject) ?? [];
      const ugCodes = new Set(ugCourses.map((c) => c.code));
      const gradCourses = (gradCat?.bySubject.get(subject) ?? []).filter((c) => !ugCodes.has(c.code));
      const name = (ugCourses[0] ?? gradCourses[0]).subjectName;
      rows.push({ subject, name, ug: ugCourses.length, grad: gradCourses.length });
      pages.push([
        `${cat.yearCode}/${slug(subject)}/index.html`,
        yearSubjectPage({
          ...ctxBase,
          cat,
          catalogs: ug,
          gradCat,
          gradCatalogs: grad,
          subject,
          subjectName: name,
          ugCourses,
          gradCourses,
          known,
          faculty: subjectFaculty(subject),
        }),
      ]);
      if (cat === current) sitemap.push(`/${cat.yearCode}/${slug(subject)}/`);
    }
    yearSubjects.set(cat.yearCode, rows);
    pages.push([`${cat.yearCode}/index.html`, yearPage({ ...ctxBase, cat, catalogs: ug, gradCat, subjects: rows })]);
    sitemap.push(`/${cat.yearCode}/`);
  }

  // Grad term pages (/1249/cs): one subject exactly as that term's Graduate Calendar has it.
  for (const cat of grad) {
    const rows = [];
    for (const [subject, courses] of [...cat.bySubject.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push({ subject, name: courses[0].subjectName, ug: 0, grad: courses.length });
      pages.push([
        `${cat.term}/${slug(subject)}/index.html`,
        termSubjectPage({ ...ctxBase, cat, gradCatalogs: gradNav, subject, subjectName: courses[0].subjectName, courses, known, faculty: subjectFaculty(subject) }),
      ]);
      if (cat === gradCurrent) sitemap.push(`/${cat.term}/${slug(subject)}/`);
    }
    pages.push([`${cat.term}/index.html`, termIndexPage({ ...ctxBase, cat, gradCatalogs: gradNav, subjects: rows })]);
    sitemap.push(`/${cat.term}/`);
  }

  // Older grad term pages (/1109/co): one subject as that term's calendar had it. No per-course pages:
  // /1109/co602 goes to /1109/co/#CO602.
  let oldPages = 0;
  for (const cat of oldCats) {
    for (const [subject, courses] of [...cat.bySubject.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      pages.push([
        `${cat.term}/${slug(subject)}/index.html`,
        oldTermSubjectPage({ ...ctxBase, cat, nav: termNav(gradNav, cat, subject), subject, courses, linkable, faculty: subjectFaculty(subject) }),
      ]);
      sitemap.push(`/${cat.term}/${slug(subject)}/`);
      oldPages++;
    }
    pages.push([`${cat.term}/index.html`, oldTermIndexPage({ ...ctxBase, cat, nav: termNav(gradNav, cat) })]);
    sitemap.push(`/${cat.term}/`);
  }

  // Scanned-calendar years (6364 to 9495) with OCR text: real subject pages instead of the PDF.
  const archiveIndex = {};
  for (const f of await readdir('data/archive').catch(() => [])) {
    if (/^\d{4}\.json$/.test(f)) archiveIndex[f.slice(0, 4)] = JSON.parse(await readFile(`data/archive/${f}`, 'utf8'));
  }
  let archivePages = 0;
  for (const doc of archiveText.values()) {
    for (const subj of doc.subjects) {
      pages.push([
        `${doc.year}/${subj.slug}/index.html`,
        archiveSubjectPage({ ...ctxBase, doc, s: subj, index: archiveIndex[doc.year], today: known, faculty: subjectFaculty(subj.code) }),
      ]);
      for (const a of subj.aliases) pages.push([`${doc.year}/${slug(a)}/index.html`, redirectPage(`/${doc.year}/${subj.slug}/`)]);
      sitemap.push(`/${doc.year}/${subj.slug}/`);
      archivePages++;
    }
    pages.push([`${doc.year}/index.html`, archiveYearPage({ ...ctxBase, doc })]);
    sitemap.push(`/${doc.year}/`);
  }
  // 404.html fetches /archive/{year}.json for these years: the page index, plus _text listing subjects with pages.
  for (const [year, idx] of Object.entries(archiveIndex)) {
    const doc = archiveText.get(year);
    pages.push([`archive/${year}.json`, JSON.stringify(doc ? { ...idx, _text: textMap(doc) } : idx)]);
  }

  // /cs → the current year's CS page (or the newest page that has the subject), as a real file so it isn't a 404.
  // Subjects only in older Graduate Calendars go to the newest term that has them.
  const RESERVED = new Set(['about', 'archive', 'files', 'reddit', 'vendor']);
  const allSubjects = new Set();
  for (const cat of [...ug, ...grad, ...oldCats]) for (const s of cat.subjects) if (!RESERVED.has(slug(s))) allSubjects.add(s);
  for (const s of allSubjects) {
    const year = [current, ...[...ug].reverse()].find((k) => yearSubjects.get(k.yearCode)?.some((r) => r.subject === s));
    const term = [...grad].reverse().find((k) => k.subjects.has(s)) ?? [...oldCats].reverse().find((k) => k.subjects.has(s));
    const target = year ? `/${year.yearCode}/${slug(s)}/` : `/${term.term}/${slug(s)}/`;
    pages.push([`${slug(s)}/index.html`, redirectPage(target)]);
  }

  const groupNames = { mat: 'Mathematics', eng: 'Engineering', sci: 'Science', hea: 'Health', env: 'Environment', art: 'Arts' };
  const homeSubjects = yearSubjects.get(current.yearCode);
  const groups = subjectVotes.size
    ? [...Object.entries(groupNames), ['other', 'Other']]
        .map(([key, name]) => ({ key, name, subjects: homeSubjects.filter((s) => (subjectFaculty(s.subject) ?? 'other') === key) }))
        .filter((g) => g.subjects.length)
    : [{ key: 'all', name: 'Subjects', subjects: homeSubjects }];
  const liveCount = new Set([...current.courses.keys(), ...(gradCurrent?.courses.keys() ?? [])]).size;
  pages.push(['about/links/index.html', linksAboutPage({ ...ctxBase, repo, meta: foundFile && { links: foundFile.links.length, courses: foundFor.size, generated: foundFile.generated } })]);
  pages.push(['index.html', homePage({ ...ctxBase, current, catalogs: ug, gradCatalogs: gradNav, groups, courseCount: liveCount })]);
  sitemap.push('/');

  const meta = {
    years: ug.map((c) => c.yearCode),
    current: current.yearCode,
    gradTerms: grad.map((c) => c.term),
    gradOld: oldCats.map((c) => c.term),
    subjects: [...allSubjects].map(slug).sort(),
  };
  pages.push(['404.html', notFoundPage({ ...ctxBase, meta })]);

  // Courses no longer offered are in the search too, flagged (third field) so they rank after current ones.
  const search = [
    ...[...primary.entries()].map(([code, { course }]) => [code, course.title]),
    ...[...retired.values()].map((r) => [r.code, r.od?.title ?? r.ga?.latest.title ?? r.arch?.latest.title ?? '', 1]),
  ].sort((a, b) => byCode(a[0], b[0]));
  pages.push(['search.json', JSON.stringify(search)]);

  // courses.csv: every course, whether it's in the current calendars, and the last term it ran.
  // Courses that haven't run in years are the likeliest to have no outline on outline.uwaterloo.ca.
  const pastTerms = historyWindow.filter((t) => Number(t) <= Number(curTerm));
  const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csvRows = [
    ['code', 'title', 'level', 'in_current_calendar', 'last_ran_term', 'last_ran', `terms_run_since_${termName(pastTerms[0]).replace(' ', '_')}`, 'outline_search', 'reddit_mentions', 'resources', 'links_found', 'uwloo'],
  ];
  for (const [code, { cat, course }] of [...primary.entries()].sort((a, b) => byCode(a[0], b[0]))) {
    const ran = offerings ? pastTerms.filter((t) => offerings.terms[t]?.offered.has(code)) : [];
    const last = ran.at(-1) ?? '';
    csvRows.push([
      code,
      course.title,
      cat.level === 'grad' ? 'graduate' : 'undergraduate',
      cat.status === 'past' ? 'no' : 'yes',
      last,
      last ? termName(last) : offerings ? 'not since ' + termName(pastTerms[0]) : 'unknown (no UW_API_KEY)',
      offerings ? ran.length : '',
      outlineUrl(course.subject, course.number),
      reddit.map.get(code)?.length ?? 0,
      resourcesFor.get(code)?.length ?? 0,
      foundFor.get(code)?.length ?? 0,
      `${SITE}/${slug(code)}/`,
    ]);
  }
  for (const r of [...retired.values()].sort((a, b) => byCode(a.code, b.code))) {
    const S = /^[A-Z]+/.exec(r.code)[0];
    const N = r.code.slice(S.length);
    const last = r.od?.ran.at(-1) ?? '';
    csvRows.push([
      r.code,
      r.od?.title ?? r.ga?.latest.title ?? r.arch?.latest.title ?? '',
      r.od?.career === 'GRD' || r.ga || Number.parseInt(N, 10) >= 600 ? 'graduate' : 'undergraduate',
      'no (no longer offered)',
      last,
      last ? termName(last) : r.od ? 'no classes in Open Data' : r.ga ? `in Graduate Calendars to ${r.ga.terms.at(-1).label}` : `in calendars to ${r.arch.years.at(-1).label}`,
      offerings ? pastTerms.filter((t) => offerings.terms[t]?.offered.has(r.code)).length : '',
      outlineUrl(S, N),
      reddit.map.get(r.code)?.length ?? 0,
      0,
      foundFor.get(r.code)?.length ?? 0,
      `${SITE}/${slug(r.code)}/`,
    ]);
  }
  pages.push(['courses.csv', `${csvRows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`]);
  pages.push(['sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>\n`]);
  pages.push(['robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`]);
  pages.push(['CNAME', 'uwloo.ca\n']);
  pages.push(['.nojekyll', '']);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp('site', OUT, { recursive: true });
  await writeAll(pages);
  const fileBytes = await publishFiles(new Set(shown.flatMap((e) => e.parts.map((p) => p.file).filter(Boolean))), { out: join(OUT, 'files') });
  const gradOnly = [...primary.values()].filter((p) => p.cat.level === 'grad').length;
  console.log(`Wrote ${pages.length} files to ${OUT}/ (${primary.size} course pages, ${retired.size} no longer offered (${[...retired.values()].filter((r) => r.od).length} from Open Data), ${gradOnly} from the Graduate Calendar, ${versionPages} grad term versions, ${oldPages} older grad subject pages, ${archivePages} scanned-calendar subject pages, ${redditPages} with r/uwaterloo mentions${reddit.removed ? `, ${reddit.removed} removal requests applied` : ''}, ${shown.length} resources on ${resourcesFor.size} courses, ${[...foundFor.values()].reduce((n, x) => n + x.length, 0)} found links on ${foundFor.size} courses, ${hostedPages} hosted PDFs, ${(fileBytes / 1e6).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
