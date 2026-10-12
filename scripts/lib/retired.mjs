// Pages for courses that are no longer offered: uwloo.ca/msci452. They come from three places:
//   Open Data history (scripts/lib/history.mjs)  the catalog as far back as Open Data goes: title, description,
//                                                requirements as last listed, and every term it ran
//   older Graduate Calendars (data/grad-archive) Fall 2006 to Winter 2024 (scripts/lib/gradarchive.mjs)
//   the scanned calendars (data/archive-text)    1963–64 to 1994–95, for courses older than that
// A course in any calendar uwloo has (2024–25 on) has a regular page instead.
import { shell } from './render.mjs';
import { codesIn, esc, fmtCode, linkCodes, slug, treeCodes } from './requisites.mjs';
import { FACULTY, FACULTY_NAMES } from './opendata.mjs';
import { parseTerm, shiftTerm, termName, termShort, yearCodeFor, yearLabel } from './terms.mjs';

const OLD_FIRST = '1069'; // Fall 2006, the oldest archived Graduate Calendar (scripts/lib/gradarchive.mjs)
const OLD_LAST = '1241';

const UCAL = 'https://ucalendar.uwaterloo.ca';
const ARCHIVES = 'https://uwaterloo.ca/academic-calendar/archives';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The academic year a term belongs to: Fall 2015, Winter 2016 and Spring 2016 are all 2015–16. */
export function academicYearOf(term) {
  const t = parseTerm(term);
  return t ? (t.month === 9 ? t.year : t.year - 1) : null;
}

/** For each scanned-calendar course: the years it's in, and its newest entry. */
export function archiveAppearances(archiveText) {
  const out = new Map();
  for (const doc of archiveText.values()) {
    for (const s of doc.subjects) {
      for (const c of s.courses) {
        if (!c.id) continue;
        const a = out.get(c.id) ?? { years: [], latest: null };
        if (!a.years.some((y) => y.year === doc.year)) a.years.push({ year: doc.year, label: doc.label, start: doc.start, href: `/${doc.year}/${s.slug}/#${c.id}` });
        if (!a.latest || doc.start > a.latest.start) a.latest = { start: doc.start, label: doc.label, title: c.title, listed: c.listed ?? null };
        out.set(c.id, a);
      }
    }
  }
  for (const a of out.values()) a.years.sort((x, y) => x.start - y.start);
  return out;
}

/**
 * Which courses get a "no longer offered" page: everything in Open Data's history or an older Graduate
 * Calendar that no current calendar lists, plus scanned-calendar courses seen in at least two years (one
 * year alone may be an OCR misread). `grad` is gradAppearances() from scripts/lib/gradarchive.mjs.
 */
export function retiredCourses({ history, archive, current, grad = new Map() }) {
  const out = new Map();
  const add = (code, od) => out.set(code, { code, od, arch: archive.get(code) ?? null, ga: grad.get(code) ?? null });
  for (const [code, od] of Object.entries(history?.codes ?? {})) if (!current.has(code)) add(code, od);
  for (const code of grad.keys()) if (!current.has(code) && !out.has(code)) add(code, null);
  for (const [code, arch] of archive) {
    if (current.has(code) || out.has(code)) continue;
    if (arch.years.length >= 2) add(code, null);
  }
  return out;
}

/** Current courses that still mention a retired one: as an antirequisite, a requisite, or in their notes. */
export function mentionsOf(primary, retired) {
  const out = new Map();
  const note = (code, by, how) => {
    if (!retired.has(code) || code === by) return;
    if (!out.has(code)) out.set(code, new Map());
    const m = out.get(code);
    if (!m.has(by)) m.set(by, how);
  };
  for (const [by, { course }] of primary) {
    for (const c of treeCodes(course.antireq ?? [])) note(c, by, 'antirequisite');
    for (const c of treeCodes([...(course.prereq ?? []), ...(course.coreq ?? [])])) note(c, by, 'requisite');
    for (const c of codesIn(String(course.notesHtml ?? '').replace(/<[^>]+>/g, ' '))) note(c, by, 'notes');
    for (const c of codesIn(course.description ?? '')) note(c, by, 'description');
  }
  return out;
}

const HOW = { antirequisite: 'lists it as an antirequisite', requisite: 'lists it in its requisites', notes: 'mentions it in its notes', description: 'mentions it in its description' };

function ranHtml(ran, first, last) {
  if (!ran?.length) return `<p class="strip-note">In the course catalog from ${esc(termName(first))} to ${esc(termName(last))}; Open Data has no classes for it in that time.</p>`;
  const cells = ran.map((t) => `<li class="on"><abbr title="${esc(termName(t))}: ran">${esc(termShort(t))}</abbr></li>`).join('');
  return `<section class="terms" aria-labelledby="ran-h">
  <h2 id="ran-h" class="vh">When it ran</h2>
  <ol class="strip">${cells}</ol>
  <p class="strip-note">Ran in ${plural(ran.length, 'term')}, ${esc(termName(ran[0]))} to ${esc(termName(ran.at(-1)))}.</p>
</section>`;
}

/** `oldHave`: the older Graduate Calendar terms uwloo has (a Set), to say when a course's trail goes cold. */
export function retiredPage({ r, known, mentions, reddit, floor, faculty: fac, oldHave = new Set(), builtAt, version }) {
  const { code, od, arch, ga } = r;
  const S = /^[A-Z]+/.exec(code)[0];
  const N = code.slice(S.length);
  const grad = od?.career === 'GRD' || Boolean(ga) || Number.parseInt(N, 10) >= 600;
  const title = od?.title ?? ga?.latest.title ?? arch?.latest.title ?? '';
  const faculty = fac ?? FACULTY[od?.group] ?? null;
  const gaFirst = ga?.terms[0];
  const gaLast = ga?.terms.at(-1);

  // When it was last around.
  let note;
  if (od) {
    const lastRan = od.ran.at(-1);
    const earlier = gaFirst && Number(gaFirst.term) < Number(od.first);
    const since = earlier
      ? `from ${gaFirst.label}${gaFirst.term === OLD_FIRST ? ' (as far back as the archived Graduate Calendars go)' : ''}`
      : floor && od.first === floor
        ? `since at least ${termName(od.first)} (as far back as Open Data goes)`
        : `from ${termName(od.first)}`;
    note = `No longer offered. It was in Waterloo’s ${earlier ? 'calendars' : 'course catalog'} ${since} to ${termName(od.last)}${lastRan ? ` and last ran in ${termName(lastRan)}` : ''}. It isn’t in the 2024–25 or later calendars.`;
  } else if (ga) {
    const next = shiftTerm(gaLast.term, 1);
    const cold = Number(next) <= Number(OLD_LAST) && !oldHave.has(next);
    note = `No longer offered. It’s in the archived Graduate Calendars from ${gaFirst.label}${gaFirst.term === OLD_FIRST ? ' (the oldest one online)' : ''} to ${gaLast.label}.${cold ? ` The calendars after ${gaLast.label} aren’t on uwloo, so it may have been listed a little longer.` : ''}`;
  } else {
    note = `No longer offered. It’s in Waterloo’s scanned calendars from ${arch.years[0].label} to ${arch.years.at(-1).label}; the 1995–96 to 2023–24 calendars are on ucalendar.`;
  }

  const lastListed = od?.detail ? termName(od.detail) : gaLast?.label;
  const facts = [
    grad && ['Level', 'Graduate'],
    faculty && ['Faculty', FACULTY_NAMES[faculty]],
    lastListed && ['Last listed', esc(lastListed)],
  ].filter(Boolean);

  // Where to read the old calendar entries.
  const out = [];
  if (ga) {
    const last = ga.latestCat;
    const url = last.source === 'calendar' && ga.latest.url ? ga.latest.url : last.official;
    out.push([url, `Graduate Calendar, ${gaLast.label}`, last.source === 'calendar' ? 'Its last archived entry' : 'That term’s calendar, in Waterloo’s archive']);
  }
  if (od) {
    const year = academicYearOf(od.last);
    if (!grad && year >= 1995 && year <= 2023) out.push([`${UCAL}/${yearCodeFor(year)}/COURSE/course-${S}.html#${code}`, `Undergraduate Calendar, ${yearLabel(year)}`, 'Its last calendar entry, on ucalendar']);
    if (grad) out.push([ARCHIVES, 'Graduate Calendar archives', 'Past Graduate Calendars']);
  } else if (ga) {
    out.push([ARCHIVES, 'Graduate Calendar archives', 'Past Graduate Calendars']);
  } else {
    out.push([`${UCAL}/9596/COURSE/course-${S}.html#${code}`, 'Undergraduate Calendar, 1995–96', 'If it ran past 1994–95, on ucalendar']);
  }
  out.push([`https://outline.uwaterloo.ca/viewer/?q=${S.toLowerCase()}%2520${N.toLowerCase()}`, 'Course outlines', 'Syllabi from past terms (UW login)']);
  out.push([`https://uwflow.com/course/${slug(code)}`, 'UW Flow', 'Student ratings and reviews']);

  const mention = mentions?.get(code);
  const mentionHtml = mention?.size
    ? `<section aria-labelledby="now-h"><h2 id="now-h">In today’s calendar</h2><ul class="mentions">${[...mention]
        .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
        .map(([by, how]) => `<li>${linkCodes(fmtCode(by), known)} <span class="t">${esc(HOW[how])}</span></li>`)
        .join('')}</ul></section>`
    : '';

  const gaHtml = ga
    ? `<section aria-labelledby="ga-h"><h2 id="ga-h">In older Graduate Calendars</h2><ul class="versions">${ga.terms.map((t) => `<li><a href="${esc(t.href)}">${esc(t.label)}</a></li>`).join('')}</ul></section>`
    : '';
  const description = od?.description ?? ga?.latest.description;
  const gaNotes = !od?.requirements && ga?.latest.notes.length ? ga.latest.notes : null;

  const archHtml = arch
    ? `<section aria-labelledby="scan-h"><h2 id="scan-h">In the scanned calendars</h2><ul class="versions">${arch.years.map((y) => `<li><a href="${esc(y.href)}">${esc(y.label)}</a></li>`).join('')}</ul></section>`
    : '';

  const body = `<article class="course retired">
<header class="course-head">
  <h1><span class="code">${esc(fmtCode(code))}</span><span class="title">${esc(title)}</span></h1>
  ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
  <p class="gone-note">${esc(note)}</p>
</header>
${od ? ranHtml(od.ran, od.first, od.last) : ''}
${description ? `<p class="desc">${linkCodes(description, known)}</p>` : ''}
${od?.requirements ? `<section aria-labelledby="req-h"><h2 id="req-h">Requirements, as last listed</h2><p>${linkCodes(od.requirements, known)}</p></section>` : ''}
${gaNotes ? `<section aria-labelledby="req-h"><h2 id="req-h">Notes, as last listed</h2><div class="notes">${gaNotes.map((n) => `<p><i>${linkCodes(n, known)}</i></p>`).join('')}</div></section>` : ''}
${!od && !ga && arch ? `<p class="desc t">Its description is in the scanned calendars below (OCR text, with the page images).</p>` : ''}
${mentionHtml}
${reddit ?? ''}
<section aria-labelledby="out-h">
  <h2 id="out-h">Check it elsewhere</h2>
  <ul class="out">${out.map(([href, label, n]) => `<li><a href="${esc(href)}">${esc(label)}</a><small>${esc(n)}</small></li>`).join('')}</ul>
</section>
${gaHtml}
${archHtml}
</article>`;
  const span = od ? `${termName(od.first)} to ${termName(od.last)}` : ga ? `${gaFirst.label} to ${gaLast.label}` : `${arch.years[0].label} to ${arch.years.at(-1).label}`;
  return shell({
    title: `${fmtCode(code)}: ${title || 'No longer offered'} | uwloo`,
    description: `${fmtCode(code)} ${title} at the University of Waterloo, no longer offered (${span}).`,
    path: `/${slug(code)}/`,
    body,
    faculty,
    builtAt,
    version,
  });
}
