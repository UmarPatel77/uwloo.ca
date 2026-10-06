import { esc, fmtCode, linkCodes, renderTree, sanitize, slug } from './requisites.mjs';
import { CALENDAR_PAGE, calendarCourseUrl } from './kuali.mjs';
import { FACULTY_NAMES } from './opendata.mjs';
import { termName, termShort } from './terms.mjs';

export const SITE = 'https://uwloo.ca';
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap';
const UCAL = 'https://ucalendar.uwaterloo.ca';
const QUEST = 'https://quest.pecs.uwaterloo.ca/psc/PB/ACADEMIC/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL';

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
  <p>Unofficial. The <a href="${CALENDAR_PAGE}">Undergraduate Calendar</a> is the authority on requirements.</p>
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
  const { course: c, cat, known, leadsTo, history, faculty, strip, hint, sectionsByTerm, curTerm, calendarBase } = ctx;
  const S = c.subject;
  const N = c.number;
  const level = Number.parseInt(N, 10) >= 600 ? 'grad' : 'under';
  const facts = [
    c.units != null && ['Units', fmtUnits(c.units)],
    faculty && ['Faculty', FACULTY_NAMES[faculty]],
    ['Subject', `<a href="/${cat.yearCode}/${slug(S)}/">${esc(c.subjectName)}</a>`],
    c.crossListed.length && ['Cross-listed', c.crossListed.map((x) => linkCodes(fmtCode(x), known)).join(', ')],
  ].filter(Boolean);

  const block = (id, heading, tree) =>
    `<section aria-labelledby="${id}"><h2 id="${id}">${heading}</h2>${tree ? renderTree(tree, known, calendarBase) : '<p class="none">None listed.</p>'}</section>`;

  const leads = leadsTo.length
    ? `<ul class="leads">${leadsTo.map((x) => `<li><a class="cc" href="/${slug(x.code)}/" title="${esc(x.title)}">${esc(fmtCode(x.code))}</a></li>`).join('')}</ul>`
    : '<p class="none">No course lists it as a requisite.</p>';

  const notes = sanitize(c.notesHtml, known);

  const sectionBlocks = sectionsByTerm.filter((s) => s.list.length).map((s) => sectionsHtml(s.term, s.list, c)).join('\n');

  const out = [
    cat.status === 'current' && [`${calendarCourseUrl(c.pid)}`, `Undergraduate Calendar, ${cat.label}`, 'The official entry'],
    [`https://acal.fast.uwaterloo.ca/course/${curTerm}/${S}/${N}`, `Requirements for ${termName(curTerm)}`, 'Waterloo’s requisite checker'],
    [
      `https://classes.uwaterloo.ca/cgi-bin/cgiwrap/infocour/salook.pl?level=${level}&sess=${curTerm}&subject=${S}&cournum=${N}`,
      `Schedule of Classes, ${termName(curTerm)}`,
      'Instructors, rooms, live seats',
    ],
    [QUEST, 'Quest Class Search', 'Where you enrol'],
    [`https://uwflow.com/course/${slug(c.code)}`, 'UW Flow', 'Student ratings and reviews'],
  ].filter(Boolean);

  const versions = history
    .map(
      (h) =>
        `<li><a href="/${h.cat.yearCode}/${slug(S)}/#${c.code}">${esc(h.cat.label)}</a>${h.changed ? ' <span class="changed">requisites changed</span>' : ''}${h.cat === cat ? ' <span class="t">(shown here)</span>' : ''}</li>`,
    )
    .join('');

  const desc = c.description || (c.detailMissing ? 'The calendar entry could not be loaded on the last rebuild.' : '');

  const body = `<article class="course">
<header class="course-head">
  <h1><span class="code">${esc(fmtCode(c.code))}</span><span class="title">${esc(c.title)}</span></h1>
  <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  ${cat.status !== 'current' ? `<p class="gone-note">${cat.status === 'past' ? `Not in the current calendar. Shown as it appeared in ${esc(cat.label)}.` : `New in the ${esc(cat.label)} calendar.`}</p>` : ''}
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
  <ul class="out">${out.map(([href, label, note]) => `<li><a href="${esc(href)}">${esc(label)}</a><small>${esc(note)}</small></li>`).join('')}</ul>
</section>
<section aria-labelledby="ver-h">
  <h2 id="ver-h">Calendar years</h2>
  <ul class="versions">${versions}<li><a href="${UCAL}/2324/COURSE/course-${S}.html#${c.code}">2023–24 and earlier</a> <span class="t">on ucalendar</span></li></ul>
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

// ---------------- calendar pages (ucalendar replica) ----------------

function yearNav(catalogs, active, subject) {
  const items = catalogs
    .map((k) => `<li><a href="/${k.yearCode}/${subject ? `${slug(subject)}/` : ''}"${k === active ? ' aria-current="page"' : ''}>${esc(k.label)}</a></li>`)
    .join('');
  const old = subject ? `${UCAL}/2324/COURSE/course-${subject}.html` : `${UCAL}/2324/`;
  return `<nav aria-label="Calendar year"><ul class="years">${items}<li><a href="${old}">2023–24 and earlier</a></li></ul></nav>`;
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

export function subjectPage({ cat, catalogs, subject, subjectName, courses, known, faculty, calendarBase, builtAt, version }) {
  const nums = courses.map((c) => `<a href="#${c.code}">${esc(c.number)}</a>`).join('');
  const body = `<header class="cal-head">
  <h1>${esc(subjectName)} (${esc(subject)})</h1>
  <p>${courses.length} course${courses.length === 1 ? '' : 's'} in the ${esc(cat.label)} Undergraduate Calendar.</p>
  ${yearNav(catalogs, cat, subject)}
</header>
<nav class="nums" aria-label="Jump to course number">${nums}</nav>
${courses.map((c) => entryHtml(c, known, calendarBase)).join('\n')}`;
  return shell({
    title: `${subject} courses, ${cat.label} | uwloo`,
    description: `Every ${subjectName} (${subject}) course in Waterloo’s ${cat.label} Undergraduate Calendar, with descriptions and requisites on one page.`,
    path: `/${cat.yearCode}/${slug(subject)}/`,
    body,
    faculty,
    builtAt,
    version,
  });
}

export function yearPage({ cat, catalogs, subjects, builtAt, version }) {
  const body = `<header class="cal-head">
  <h1>${esc(cat.label)} calendar</h1>
  <p>Undergraduate courses by subject. Each subject is one page, like the old ucalendar.</p>
  ${yearNav(catalogs, cat)}
</header>
<ul class="cols">${subjects
    .map((s) => `<li><a class="cc" href="/${cat.yearCode}/${slug(s.subject)}/">${esc(s.subject)}</a> ${esc(s.name)} <span class="count">${s.count}</span></li>`)
    .join('')}</ul>`;
  return shell({
    title: `${cat.label} Undergraduate Calendar by subject | uwloo`,
    description: `All subjects in Waterloo’s ${cat.label} Undergraduate Calendar.`,
    path: `/${cat.yearCode}/`,
    body,
    builtAt,
    version,
  });
}

export function homePage({ current, catalogs, groups, courseCount, builtAt, version }) {
  const body = `<form class="go" action="/" role="search">
  <label for="home-q">Type a course code or title</label>
  <div class="url"><span aria-hidden="true">uwloo.ca/</span><input id="home-q" name="q" placeholder="cs135" autocomplete="off" autocapitalize="none" spellcheck="false" role="combobox" aria-controls="results" aria-expanded="true" autofocus></div>
</form>
<p class="lede">Prerequisites, what a course leads to, and when it actually runs, for ${courseCount.toLocaleString('en-CA')} Waterloo undergraduate courses.</p>
<ol id="results" class="results" role="listbox" aria-label="Matching courses"></ol>
<div class="home-grid">
${groups
  .map(
    (g) => `<section aria-labelledby="g-${g.key}"><h2 id="g-${g.key}">${esc(g.name)}</h2><ul class="cols">${g.subjects
      .map((s) => `<li><a class="cc" href="/${current.yearCode}/${slug(s.subject)}/">${esc(s.subject)}</a> ${esc(s.name)}</li>`)
      .join('')}</ul></section>`,
  )
  .join('\n')}
<section aria-labelledby="cal-h"><h2 id="cal-h">Calendars</h2>${yearNav(catalogs, current)}</section>
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
