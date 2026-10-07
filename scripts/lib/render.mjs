import { esc, fmtCode, linkCodes, renderTree, sanitize, slug } from './requisites.mjs';
import { CALENDAR_PAGE, GRAD_CALENDAR_PAGE, calendarCourseUrl } from './kuali.mjs';
import { FACULTY_NAMES } from './opendata.mjs';
import { termName, termShort } from './terms.mjs';

export const SITE = 'https://uwloo.ca';
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap';
const UCAL = 'https://ucalendar.uwaterloo.ca';
const QUEST = 'https://quest.pecs.uwaterloo.ca/psc/PB/ACADEMIC/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL';
const ARCHIVES = 'https://uwaterloo.ca/academic-calendar/archives';

const fmtUnits = (u) => (u == null ? null : u.toFixed(2));
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtStamp = (d) => d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export function shell({ title, description, path, body, faculty, builtAt, version, head = '', noindex = false }) {
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${path ? `<link rel="canonical" href="${SITE}${esc(path)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#1d1f22">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/style.css?v=${version}">
${head}
</head>
<body${faculty ? ` class="f-${faculty}"` : ''}>
<header class="bar">
  <a class="mark" href="/">uwloo</a>
  <form class="jump" action="/" role="search">
    <label class="vh" for="q">Go to a course code</label>
    <span aria-hidden="true">uwloo.ca/</span><input id="q" name="q" placeholder="cs135" autocomplete="off" autocapitalize="none" spellcheck="false">
  </form>
</header>
<main id="main">
${body}
</main>
<footer>
  <p>Unofficial. The <a href="${CALENDAR_PAGE}">Undergraduate</a> and <a href="${GRAD_CALENDAR_PAGE}">Graduate</a> Calendars are the authority on requirements.</p>
  <p>Course data from Waterloo’s Academic Calendar; offerings and seats from <a href="https://openapi.data.uwaterloo.ca/api-docs">UW Open Data</a>. Rebuilt ${esc(fmtStamp(builtAt).replace(/\.?$/, '.'))}</p>
</footer>
<script type="module" src="/app.js?v=${version}"></script>
</body>
</html>
`;
}

// ---------------- course page ----------------

function stripHtml(strip, hint, sectionsByTerm) {
  if (strip?.length) {
    const cells = strip
      .map((s, i) => {
        const label = s.state === 'on' ? 'ran' : s.state === 'tbd' ? 'schedule not published yet' : 'not offered';
        return `<li class="${s.state}${s.now ? ' now' : ''}" style="--i:${i}"><abbr title="${esc(termName(s.term))}: ${label}">${esc(termShort(s.term))}</abbr></li>`;
      })
      .join('');
    const known = strip.filter((s) => s.state !== 'tbd' && !s.future);
    const ran = known.filter((s) => s.state === 'on').length;
    const ahead = strip.filter((s) => s.future);
    const nextBits = ahead.map((s) => {
      const n = sectionsByTerm.find((x) => x.term === s.term)?.list.filter((x) => x.comp === 'LEC').length;
      if (s.state === 'on') return `${termName(s.term)}: scheduled${n ? `, ${n} lecture section${n === 1 ? '' : 's'}` : ''}.`;
      if (s.state === 'tbd') return `${termName(s.term)}: schedule not out yet.`;
      return `${termName(s.term)}: not on the schedule.`;
    });
    return `<section class="terms" aria-labelledby="terms-h">
  <h2 id="terms-h" class="vh">When it runs</h2>
  <ol class="strip">${cells}</ol>
  <p class="strip-note">Ran in ${ran} of the last ${known.length} terms. ${esc(nextBits.join(' '))}</p>
</section>`;
  }
  if (hint) {
    const names = { F: 'Fall', W: 'Winter', S: 'Spring' };
    return `<p class="strip-note">The calendar lists it as offered in ${esc(hint.map((h) => names[h]).join(', '))}.</p>`;
  }
  return '';
}

function meetText(m) {
  const time = m.start && m.end ? `${m.start}–${m.end}` : '';
  const when = m.date ? fmtDate(m.date) : m.days;
  return esc([when, time].filter(Boolean).join(' ')) || '<span class="t">Time to be announced</span>';
}

function sectionsHtml(term, list, course) {
  const rows = list
    .map((s) => {
      const pct = s.cap ? Math.min(100, Math.round((100 * (s.enrl ?? 0)) / s.cap)) : 0;
      const seats =
        s.cap != null
          ? `<span class="seats">${s.enrl ?? 0} / ${s.cap}<span class="meter${pct >= 100 ? ' full' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></span></span>`
          : '<span class="t">n/a</span>';
      return `<tr><td>${esc(s.comp)} ${esc(s.sec)}</td><td>${s.cls ?? ''}</td><td>${seats}</td><td>${s.meets.map(meetText).join('<br>') || '<span class="t">Online or by arrangement</span>'}</td></tr>`;
    })
    .join('');
  const level = Number.parseInt(course.number, 10) >= 600 ? 'grad' : 'under';
  const soc = `https://classes.uwaterloo.ca/cgi-bin/cgiwrap/infocour/salook.pl?level=${level}&sess=${term}&subject=${course.subject}&cournum=${course.number}`;
  return `<section aria-labelledby="sec-${term}">
  <h2 id="sec-${term}">${esc(termName(term))} sections</h2>
  <div class="scroll"><table class="sec">
    <caption>Enrolment from UW Open Data, which can trail Quest by up to two days. Instructors and rooms: <a href="${esc(soc)}">Schedule of Classes</a>.</caption>
    <thead><tr><th scope="col">Section</th><th scope="col">Class</th><th scope="col">Enrolled</th><th scope="col">Meets</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}

export function coursePage(ctx) {
  const { course: c, cat, known, leadsTo, history, faculty, strip, hint, sectionsByTerm, curTerm, subjectHref } = ctx;
  const S = c.subject;
  const N = c.number;
  const isGrad = cat.level === 'grad';
  const calendarName = isGrad ? 'Graduate Calendar' : 'Undergraduate Calendar';
  const socLevel = isGrad || Number.parseInt(N, 10) >= 600 ? 'grad' : 'under';
  const facts = [
    c.units != null && ['Units', fmtUnits(c.units)],
    isGrad && ['Level', 'Graduate'],
    faculty && ['Faculty', FACULTY_NAMES[faculty]],
    ['Subject', `<a href="${esc(subjectHref)}">${esc(c.subjectName)}</a>`],
    c.crossListed.length && ['Cross-listed', c.crossListed.map((x) => linkCodes(fmtCode(x), known)).join(', ')],
  ].filter(Boolean);

  const block = (id, heading, tree) =>
    `<section aria-labelledby="${id}"><h2 id="${id}">${heading}</h2>${tree ? renderTree(tree, known, cat.pageUrl) : '<p class="none">None listed.</p>'}</section>`;

  const leads = leadsTo.length
    ? `<ul class="leads">${leadsTo.map((x) => `<li><a class="cc" href="/${slug(x.code)}/" title="${esc(x.title)}">${esc(fmtCode(x.code))}</a></li>`).join('')}</ul>`
    : '<p class="none">No course lists it as a requisite.</p>';

  const notes = sanitize(c.notesHtml, known);
  const sectionBlocks = sectionsByTerm.filter((s) => s.list.length).map((s) => sectionsHtml(s.term, s.list, c)).join('\n');

  const out = [
    [calendarCourseUrl(cat, c.pid), `${calendarName}, ${cat.label}`, cat.status === 'past' ? 'The archived entry' : 'The official entry'],
    [`https://acal.fast.uwaterloo.ca/course/${curTerm}/${S}/${N}`, `Requirements for ${termName(curTerm)}`, 'Waterloo’s requisite checker'],
    [
      `https://classes.uwaterloo.ca/cgi-bin/cgiwrap/infocour/salook.pl?level=${socLevel}&sess=${curTerm}&subject=${S}&cournum=${N}`,
      `Schedule of Classes, ${termName(curTerm)}`,
      'Instructors, rooms, live seats',
    ],
    [QUEST, 'Quest Class Search', 'Where you enrol'],
    [`https://uwflow.com/course/${slug(c.code)}`, 'UW Flow', 'Student ratings and reviews'],
  ];

  const verItems = (items) =>
    items
      .map(
        (h) =>
          `<li><a href="${esc(h.href)}">${esc(h.cat.label)}</a>${h.changed ? ' <span class="changed">requisites changed</span>' : ''}${h.cat === cat ? ' <span class="t">(shown here)</span>' : ''}</li>`,
      )
      .join('');
  const versions = [
    history.ug.length &&
      `<h3 class="ver-h">Undergraduate Calendar</h3><ul class="versions">${verItems(history.ug)}<li><a href="${UCAL}/2324/COURSE/course-${S}.html#${c.code}">2023–24 and earlier</a> <span class="t">on ucalendar</span></li></ul>`,
    history.grad.length &&
      `<h3 class="ver-h">Graduate Calendar</h3><ul class="versions">${verItems(history.grad)}<li><a href="${ARCHIVES}">Winter 2024 and earlier</a> <span class="t">in the calendar archives</span></li></ul>`,
  ]
    .filter(Boolean)
    .join('');

  const note =
    cat.status === 'past'
      ? `Not in the current ${calendarName}. Shown as it appeared in ${cat.label}.`
      : cat.status === 'future'
        ? `New in the ${cat.label} ${calendarName}.`
        : '';
  const desc = c.description || (c.detailMissing ? 'The calendar entry could not be loaded on the last rebuild.' : '');

  const body = `<article class="course">
<header class="course-head">
  <h1><span class="code">${esc(fmtCode(c.code))}</span><span class="title">${esc(c.title)}</span></h1>
  <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  ${note ? `<p class="gone-note">${esc(note)}</p>` : ''}
</header>
${stripHtml(strip, hint, sectionsByTerm)}
${desc ? `<p class="desc">${linkCodes(desc, known)}</p>` : ''}
<div class="reqs">
  <div>
    ${block('pre-h', 'Prerequisites', c.prereq)}
    ${c.coreq ? block('co-h', 'Corequisites', c.coreq) : ''}
    ${block('anti-h', 'Antirequisites', c.antireq)}
    ${notes ? `<section aria-labelledby="notes-h"><h2 id="notes-h">Notes</h2><div class="notes">${notes}</div></section>` : ''}
  </div>
  <section aria-labelledby="leads-h"><h2 id="leads-h">Leads to</h2>${leads}</section>
</div>
${sectionBlocks}
<section aria-labelledby="out-h">
  <h2 id="out-h">Check it elsewhere</h2>
  <ul class="out">${out.map(([href, label, n]) => `<li><a href="${esc(href)}">${esc(label)}</a><small>${esc(n)}</small></li>`).join('')}</ul>
</section>
<section aria-labelledby="ver-h">
  <h2 id="ver-h">Calendar versions</h2>
  ${versions}
</section>
</article>`;

  return shell({
    title: `${fmtCode(c.code)}: ${c.title} | uwloo`,
    description: `${fmtCode(c.code)} ${c.title} at the University of Waterloo: prerequisites, antirequisites, what it leads to, and when it runs.`,
    path: `/${slug(c.code)}/`,
    body,
    faculty,
    builtAt: ctx.builtAt,
    version: ctx.version,
  });
}

// ---------------- calendar pages (ucalendar / gradcalendar replicas) ----------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function yearNav(catalogs, active, subject) {
  const items = catalogs
    .map((k) => `<li><a href="/${k.yearCode}/${subject ? `${slug(subject)}/` : ''}"${k === active ? ' aria-current="page"' : ''}>${esc(k.label)}</a></li>`)
    .join('');
  const old = subject ? `${UCAL}/2324/COURSE/course-${subject}.html` : `${UCAL}/2324/`;
  return `<nav aria-label="Undergraduate calendar year"><ul class="years">${items}<li><a href="${old}">2023–24 and earlier</a></li></ul></nav>`;
}

/** Every grad term; links to this subject in that term when it's there, else to the term's subject list. */
function termNav(gradCatalogs, active, subject) {
  const items = gradCatalogs
    .map((t) => {
      const href = subject && t.subjects.has(subject) ? `/${t.term}/${slug(subject)}/` : `/${t.term}/`;
      return `<li><a href="${href}"${t === active ? ' aria-current="page"' : ''}>${esc(t.label)}</a></li>`;
    })
    .join('');
  return `<nav aria-label="Graduate calendar term"><ul class="years">${items}<li><a href="${ARCHIVES}">Winter 2024 and earlier</a></li></ul></nav>`;
}

function numsNav(label, courses) {
  if (!courses.length) return '';
  return `<nav class="nums" aria-label="${label || 'Course'} numbers">${label ? `<span class="nums-label">${label}</span>` : ''}${courses.map((c) => `<a href="#${c.code}">${esc(c.number)}</a>`).join('')}</nav>`;
}

function entryHtml(c, known, calendarBase) {
  const notes = sanitize(c.notesHtml, known);
  const dl = [
    c.prereq && ['Prerequisites', renderTree(c.prereq, known, calendarBase)],
    c.coreq && ['Corequisites', renderTree(c.coreq, known, calendarBase)],
    c.antireq && ['Antirequisites', renderTree(c.antireq, known, calendarBase)],
    c.crossListed.length && ['Cross-listed', c.crossListed.map((x) => linkCodes(fmtCode(x), known)).join(', ')],
  ].filter(Boolean);
  const onSite = known.has(c.code);
  return `<section class="entry" id="${c.code}">
  <h2>${onSite ? `<a class="cc" href="/${slug(c.code)}/">${esc(fmtCode(c.code))}</a>` : `<span class="cc">${esc(fmtCode(c.code))}</span>`} <span>${esc(c.title)}</span>${c.units != null ? `<span class="u">${fmtUnits(c.units)} units</span>` : ''}</h2>
  ${c.description ? `<p>${linkCodes(c.description, known)}</p>` : ''}
  ${notes ? `<div class="notes">${notes}</div>` : ''}
  ${dl.length ? `<dl>${dl.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
</section>`;
}

/** /2627/cs: the year's undergrad courses, then grad courses from that year's latest grad calendar. */
export function yearSubjectPage(p) {
  const { cat, catalogs, gradCat, gradCatalogs, subject, subjectName, ugCourses, gradCourses, known, faculty } = p;
  const both = ugCourses.length > 0 && gradCourses.length > 0;
  const counts = [
    ugCourses.length && `${plural(ugCourses.length, 'undergraduate course')} in the ${cat.label} Undergraduate Calendar`,
    gradCourses.length && `${plural(gradCourses.length, 'graduate course')} in the ${gradCat.label} Graduate Calendar`,
  ]
    .filter(Boolean)
    .join(', and ');
  const otherTerms = gradCat
    ? gradCatalogs.filter((t) => t.yearCode === cat.yearCode && t !== gradCat && t.subjects.has(subject))
    : [];
  const gradNote = gradCat
    ? `From the ${esc(gradCat.label)} Graduate Calendar.${otherTerms.length ? ` Also this year: ${otherTerms.map((t) => `<a href="/${t.term}/${slug(subject)}/">${esc(t.label)}</a>`).join(', ')}.` : ''}`
    : '';
  const body = `<header class="cal-head">
  <h1>${esc(subjectName)} (${esc(subject)})</h1>
  <p>${counts}.</p>
  ${yearNav(catalogs, cat, subject)}
</header>
${both ? numsNav('Undergraduate', ugCourses) + numsNav('Graduate', gradCourses) : numsNav('', [...ugCourses, ...gradCourses])}
${both ? '<h2 class="level" id="undergraduate">Undergraduate</h2>' : ''}
${ugCourses.map((c) => entryHtml(c, known, cat.pageUrl)).join('\n')}
${gradCourses.length ? `<h2 class="level" id="graduate">Graduate</h2><p class="level-note">${gradNote}</p>` : ''}
${gradCourses.map((c) => entryHtml(c, known, gradCat.pageUrl)).join('\n')}`;
  return shell({
    title: `${subject} courses, ${cat.label} | uwloo`,
    description: `Every ${subjectName} (${subject}) course in Waterloo’s ${cat.label} calendars, undergraduate and graduate, with descriptions and requisites on one page.`,
    path: `/${cat.yearCode}/${slug(subject)}/`,
    body,
    faculty,
    builtAt: p.builtAt,
    version: p.version,
  });
}

/** /1249/cs: one subject exactly as one term's Graduate Calendar has it. */
export function termSubjectPage(p) {
  const { cat, gradCatalogs, subject, subjectName, courses, known, faculty } = p;
  const body = `<header class="cal-head">
  <h1>${esc(subjectName)} (${esc(subject)})</h1>
  <p>${plural(courses.length, 'graduate course')} in the ${esc(cat.label)} Graduate Calendar.</p>
  ${termNav(gradCatalogs, cat, subject)}
</header>
${numsNav('', courses)}
${courses.map((c) => entryHtml(c, known, cat.pageUrl)).join('\n')}`;
  return shell({
    title: `${subject} graduate courses, ${cat.label} | uwloo`,
    description: `Every ${subjectName} (${subject}) course in Waterloo’s ${cat.label} Graduate Calendar.`,
    path: `/${cat.term}/${slug(subject)}/`,
    body,
    faculty,
    builtAt: p.builtAt,
    version: p.version,
  });
}

const subjectList = (base, subjects) =>
  `<ul class="cols">${subjects
    .map((s) => {
      const counts = [s.ug && `${s.ug} undergrad`, s.grad && `${s.grad} grad`].filter(Boolean).join(', ');
      return `<li><a class="cc" href="${base}${slug(s.subject)}/">${esc(s.subject)}</a> <span>${esc(s.name)}</span> <span class="count">${counts}</span></li>`;
    })
    .join('')}</ul>`;

export function yearPage({ cat, catalogs, gradCat, subjects, builtAt, version }) {
  const body = `<header class="cal-head">
  <h1>${esc(cat.label)} calendar</h1>
  <p>Courses by subject: the ${esc(cat.label)} Undergraduate Calendar${gradCat ? ` and the ${esc(gradCat.label)} Graduate Calendar` : ''}. Each subject is one page, like the old ucalendar.</p>
  ${yearNav(catalogs, cat)}
</header>
${subjectList(`/${cat.yearCode}/`, subjects)}`;
  return shell({
    title: `${cat.label} calendar by subject | uwloo`,
    description: `All subjects in Waterloo’s ${cat.label} undergraduate and graduate calendars.`,
    path: `/${cat.yearCode}/`,
    body,
    builtAt,
    version,
  });
}

export function termIndexPage({ cat, gradCatalogs, subjects, builtAt, version }) {
  const body = `<header class="cal-head">
  <h1>${esc(cat.label)} Graduate Calendar</h1>
  <p>Graduate courses by subject, as this term’s calendar has them.</p>
  ${termNav(gradCatalogs, cat)}
</header>
${subjectList(`/${cat.term}/`, subjects)}`;
  return shell({
    title: `${cat.label} Graduate Calendar by subject | uwloo`,
    description: `All subjects in Waterloo’s ${cat.label} Graduate Calendar.`,
    path: `/${cat.term}/`,
    body,
    builtAt,
    version,
  });
}

export function homePage({ current, catalogs, gradCatalogs, groups, courseCount, builtAt, version }) {
  const body = `<form class="go" action="/" role="search">
  <label for="home-q">Type a course code or title</label>
  <div class="url"><span aria-hidden="true">uwloo.ca/</span><input id="home-q" name="q" placeholder="cs135" autocomplete="off" autocapitalize="none" spellcheck="false" role="combobox" aria-controls="results" aria-expanded="true" autofocus></div>
</form>
<p class="lede">Prerequisites, what a course leads to, and when it actually runs, for ${courseCount.toLocaleString('en-CA')} Waterloo undergraduate and graduate courses.</p>
<ol id="results" class="results" role="listbox" aria-label="Matching courses"></ol>
<div class="home-grid">
${groups
  .map(
    (g) => `<section aria-labelledby="g-${g.key}"><h2 id="g-${g.key}">${esc(g.name)}</h2><ul class="cols">${g.subjects
      .map((s) => `<li><a class="cc" href="/${current.yearCode}/${slug(s.subject)}/">${esc(s.subject)}</a> <span>${esc(s.name)}</span></li>`)
      .join('')}</ul></section>`,
  )
  .join('\n')}
<section aria-labelledby="cal-h"><h2 id="cal-h">Undergraduate Calendar</h2>${yearNav(catalogs, current)}</section>
${gradCatalogs.length ? `<section aria-labelledby="gcal-h"><h2 id="gcal-h">Graduate Calendar</h2>${termNav(gradCatalogs, gradCatalogs.find((t) => t.status === 'current'))}</section>` : ''}
</div>`;
  return shell({
    title: 'uwloo: Waterloo courses at a short URL',
    description: 'Waterloo course lookup: uwloo.ca/cs135 shows prerequisites, what it leads to, and when it runs.',
    path: '/',
    body,
    builtAt,
    version,
  });
}

export function notFoundPage({ meta, builtAt, version }) {
  const body = `<div id="nf">
  <h1 class="cal-head" style="margin:0"><span class="code" id="nf-path" style="font-size:clamp(2.5rem,10vw,5rem)"></span></h1>
  <p id="nf-msg" class="lede">Finding that page…</p>
  <div id="suggest"></div>
</div>
<script type="module">
import { resolve } from '/route.js';
const meta = ${JSON.stringify(meta)};
// For the scanned-PDF years (6364 to 9495), load that year's page index before resolving.
const year = location.pathname.split('/').filter(Boolean)[0];
if (/^[0-9]{4}$/.test(year ?? '')) {
  try {
    const res = await fetch(\`/archive/\${year}.json\`);
    if (res.ok) meta.pdfPages = { [year]: await res.json() };
  } catch {}
}
const r = resolve(location.pathname, meta);
if (r.type === 'redirect') {
  location.replace(r.to.includes('#') ? r.to : r.to + location.hash);
} else {
  document.title = 'Not found | uwloo';
  document.getElementById('nf-path').textContent = decodeURIComponent(location.pathname);
  document.getElementById('nf-msg').textContent = r.message ?? 'No page here. Check the course code, or search from the top of the page.';
  // app.js runs after this (module scripts execute in document order) and fills in suggestions.
  if (r.query) document.getElementById('suggest').dataset.query = r.query;
}
</script>`;
  return shell({ title: 'uwloo', body, builtAt, version, noindex: true });
}

export function redirectPage(to) {
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><title>Redirecting</title><meta name="robots" content="noindex"><link rel="canonical" href="${SITE}${esc(to)}"><meta http-equiv="refresh" content="0; url=${esc(to)}"></head><body><p><a href="${esc(to)}">Continue to ${esc(to)}</a></p></body></html>\n`;
}
