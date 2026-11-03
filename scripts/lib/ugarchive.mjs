// Undergraduate calendars from before Kuali that uwloo can host (uwloo.ca/2324/cs/#CS135):
//   2022–23, 2023–24   ucalendar.uwaterloo.ca/{2223,2324}/COURSE/course-{SUBJ}.html, found through the
//                      "Course Descriptions Index" of each year in academic-calendar-archive.uwaterloo.ca.
//                      ucalendar's robots.txt asks programs to stay out of every earlier year (9596 to 2122),
//                      so those years keep linking to ucalendar instead.
//   2020–21, 2021–22   UW Open Data's course catalog for the year's three terms, standing in for the calendar
//                      (Open Data starts at Winter 2020).
// scripts/grad-archive.mjs reads them into data/ug-archive/, stored like data/grad-archive/
// (terms/{YYyy}.json and entries.json); builds only read that.
import { ugArchiveUrl } from '../../site/route.js';
import { notesHtml, readStore, reqSignature } from './gradarchive.mjs';
import { numsNav, shell, subjectList } from './render.mjs';
import { esc, fmtCode, linkCodes, slug } from './requisites.mjs';
import { termName, yearCodeFor, yearLabel } from './terms.mjs';

export const UG_DIR = 'data/ug-archive';
export const UG_PARSER = 1; // bump when the reader changes for these years, and the next run reads them again
const UCAL = process.env.UCAL_BASE ?? 'https://ucalendar.uwaterloo.ca';
const ACA_UG = process.env.ACA_UG_BASE ?? 'https://academic-calendar-archive.uwaterloo.ca/undergraduate-studies';

/** The years uwloo hosts from before Kuali, and where each one comes from. */
export function oldYears({ ucal = UCAL, aca = ACA_UG } = {}) {
  const at = (start) => ({ start, yearCode: yearCodeFor(start), term: yearCodeFor(start), label: yearLabel(start) });
  const od = (start) => ({ ...at(start), kind: 'opendata', terms: [`1${String(start % 100).padStart(2, '0')}9`, `1${String((start + 1) % 100).padStart(2, '0')}1`, `1${String((start + 1) % 100).padStart(2, '0')}5`] });
  const cal = (start) => ({ ...at(start), kind: 'ucal', start, index: `${aca}/${start}-${start + 1}/page/Course-Descriptions-Index.html`, scope: `${ucal}/${yearCodeFor(start)}/COURSE/` });
  return [od(2020), od(2021), cal(2022), cal(2023)];
}

/** data/ug-archive → one catalog per year, oldest first, shaped like the Kuali years where the pages need it. */
export async function loadUgArchive({ dir = UG_DIR, names = () => null } = {}) {
  const { entries, terms } = await readStore(dir);
  const plan = new Map(oldYears().map((y) => [y.yearCode, y]));
  const out = [];
  for (const doc of Object.values(terms)) {
    const y = plan.get(doc?.term);
    if (!y || !doc.subjects?.length) continue;
    const cat = {
      yearCode: y.yearCode,
      start: y.start,
      label: y.label,
      kind: 'oldug',
      level: 'ug',
      status: 'past',
      source: doc.source,
      terms: y.terms ?? null,
      subjects: new Set(),
      bySubject: new Map(),
      courses: new Map(),
      names: new Map(),
    };
    for (const s of doc.subjects) {
      for (const key of s.courses) {
        const e = entries[key];
        if (!e) continue;
        const code = key.split('~')[0];
        if (cat.courses.has(code)) continue;
        const subject = /^[A-Z]+/.exec(code)[0];
        const c = { code, subject, number: code.slice(subject.length), title: e.t, units: e.u, comp: e.c, cid: e.id, paras: e.d, description: e.d.join(' '), notes: e.x, signature: reqSignature(e.x), key };
        cat.courses.set(code, c);
        if (!cat.bySubject.has(subject)) cat.bySubject.set(subject, []);
        cat.bySubject.get(subject).push(c);
      }
    }
    for (const [subject, list] of cat.bySubject) {
      list.sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
      cat.subjects.add(subject);
      cat.names.set(subject, names(subject) ?? null);
    }
    cat.pageSubjects = cat.subjects;
    out.push(cat);
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------- pages ----------------

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtUnits = (u) => (u == null ? null : Number(u).toFixed(2));
const bare = (u) => u.replace(/^https?:\/\//, '');

/** Links in one old year: to the course in the same year when it's there, else to its page today. */
export function yearLinker(cat, linkable) {
  const inYear = (c) => cat.courses.get(c);
  return {
    has: (c) => Boolean(inYear(c)) || linkable.has(c),
    href: (c) => (inYear(c) ? `/${cat.yearCode}/${slug(inYear(c).subject)}/#${c}` : linkable.href(c)),
    retired: { has: (c) => !inYear(c) && Boolean(linkable.retired?.has(c)) },
  };
}

function entryHtml(c, cat, linker, linkable) {
  const main = linkable.href(c.code);
  const facts = [c.comp && c.comp.replace(/,/g, ', '), c.cid && `Course ID ${c.cid}`].filter(Boolean).join(' · ');
  const links = [[ugArchiveUrl(cat.start, c.subject, c.code), 'On ucalendar'], main && [main, `${fmtCode(c.code)} today`]].filter(Boolean);
  return `<section class="entry" id="${c.code}">
  <h2>${main ? `<a class="cc" href="${main}">${esc(fmtCode(c.code))}</a>` : `<span class="cc">${esc(fmtCode(c.code))}</span>`} <span>${esc(c.title)}</span>${c.units != null ? `<span class="u">${fmtUnits(c.units)} units</span>` : ''}</h2>
  ${c.paras.map((p) => `<p>${linkCodes(p, linker)}</p>`).join('\n  ')}
  ${notesHtml(c.notes, linker)}
  <p class="entry-links">${facts ? `<span class="t">${esc(facts)}</span>` : ''}${links.map(([u, label]) => `<a href="${esc(u)}">${esc(label)}</a>`).join('')}</p>
</section>`;
}

/** "43 courses in the 2023–24 Undergraduate Calendar. Original: ucalendar.uwaterloo.ca/2324/COURSE/course-CS.html" */
function countLine(cat, count, subject) {
  const original = ugArchiveUrl(cat.start, subject);
  const orig = subject ? ` Original: <a href="${esc(original)}">${esc(bare(original))}</a>` : '';
  if (cat.source === 'opendata') {
    const terms = (cat.terms ?? []).map(termName);
    return `${count} in Waterloo’s course catalog for ${esc(cat.label)} (${esc(terms.join(', '))}), from <a href="https://openapi.data.uwaterloo.ca/api-docs">UW Open Data</a>. ucalendar asks programs not to read that year’s calendar, so this stands in for it.${orig}`;
  }
  return `${count} in the ${esc(cat.label)} Undergraduate Calendar.${orig}`;
}

/** /2324/cs: one subject as an old year's Undergraduate Calendar had it. */
export function ugOldSubjectPage({ cat, nav, subject, courses, linkable, faculty, builtAt, version }) {
  const name = cat.names.get(subject);
  const linker = yearLinker(cat, linkable);
  const body = `<header class="cal-head">
  <h1>${name ? `${esc(name)} (${esc(subject)})` : esc(subject)}</h1>
  <p>${countLine(cat, plural(courses.length, 'course'), subject)}</p>
  ${nav}
</header>
${numsNav('', courses)}
${courses.map((c) => entryHtml(c, cat, linker, linkable)).join('\n')}`;
  return shell({
    title: `${subject} courses, ${cat.label} | uwloo`,
    description: `Every ${name ? `${name} (${subject})` : subject} course in Waterloo’s ${cat.label} Undergraduate Calendar.`,
    path: `/${cat.yearCode}/${slug(subject)}/`,
    body,
    faculty,
    builtAt,
    version,
  });
}

export function ugOldYearPage({ cat, nav, builtAt, version }) {
  const rows = [...cat.bySubject.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subject, list]) => ({ subject, name: cat.names.get(subject) ?? '', ug: list.length, grad: 0 }));
  const body = `<header class="cal-head">
  <h1>${esc(cat.label)} calendar</h1>
  <p>${countLine(cat, `${plural(cat.courses.size, 'course')} in ${plural(rows.length, 'subject')}`)} Each subject is one page, like the old ucalendar.</p>
  ${nav}
</header>
${subjectList(`/${cat.yearCode}/`, rows)}`;
  return shell({
    title: `${cat.label} calendar by subject | uwloo`,
    description: `All subjects in Waterloo’s ${cat.label} Undergraduate Calendar.`,
    path: `/${cat.yearCode}/`,
    body,
    builtAt,
    version,
  });
}
