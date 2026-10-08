// Pages for the scanned calendars, 1963–64 to 1994–95 (uwloo.ca/8283/math/#MATH135).
// Text comes from data/archive-text/{YYyy}.json, made by tools/archive/extract_text.py (Tesseract
// OCR of the course-description pages). Years without that file keep redirecting to the PDF.
import { readdir, readFile } from 'node:fs/promises';
import { shell } from './render.mjs';
import { esc, fmtCode, linkCodes, slug } from './requisites.mjs';
import { parseYearCode, yearCodeFor, yearLabel } from './terms.mjs';

const FIRST_ONLINE = 1963;

export async function loadArchiveText(dir = 'data/archive-text') {
  const out = new Map();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const f of files) {
    const doc = JSON.parse(await readFile(`${dir}/${f}`, 'utf8'));
    doc.start = parseYearCode(doc.year).start;
    for (const s of doc.subjects) s.slug = slug(s.code);
    out.set(doc.year, doc);
  }
  return out;
}

/** { slug: lead slug } for every subject code and alias with a page that year (read by the router). */
export function textMap(doc) {
  const map = {};
  for (const s of doc.subjects) {
    map[s.slug] = s.slug;
    for (const a of s.aliases) map[slug(a)] = s.slug;
  }
  return map;
}

/** Course codes in that year's text → their anchor, so "Prereq: CS 134" links within 1994–95. */
export function yearLinker(doc) {
  const where = new Map();
  for (const s of doc.subjects) {
    for (const c of s.courses) {
      if (!c.id) continue;
      const href = `/${doc.year}/${s.slug}/#${c.id}`;
      where.set(c.id, href);
      for (const a of s.aliases) where.set(a + c.id.slice(s.code.length), href);
    }
  }
  return { has: (code) => where.has(code), href: (code) => where.get(code) ?? null };
}

const pdfPage = (doc, page) => `${doc.pdf}#page=${page}`;
const LABEL = /^(Prereq|Antireq|Coreq|Prerequisites?|Corequisites?|Antirequisites?|Note)\s?:/;

function para(text, linker) {
  const m = LABEL.exec(text);
  return m ? `<p><strong>${esc(m[1])}:</strong>${linkCodes(text.slice(m[0].length), linker)}</p>` : `<p>${linkCodes(text, linker)}</p>`;
}

function yearNav(doc, s) {
  const prev = doc.start - 1 >= FIRST_ONLINE ? yearCodeFor(doc.start - 1) : null;
  const next = yearCodeFor(doc.start + 1);
  const at = (code) => (s ? `/${code}/${s.slug}/` : `/${code}/`);
  return `<nav aria-label="Calendar year"><ul class="years">${prev ? `<li><a href="${at(prev)}">← ${esc(yearLabel(doc.start - 1))}</a></li>` : ''}<li><a aria-current="page" href="${at(doc.year)}">${esc(doc.label)}</a></li><li><a href="${at(next)}">${esc(yearLabel(doc.start + 1))} →</a></li><li><a href="${esc(pdfPage(doc, s ? s.page : 1))}">Scanned calendar (PDF)</a></li></ul></nav>`;
}

function entryHtml(c, s, doc, linker, today) {
  const number = c.label.slice(c.label.indexOf(' ') + 1);
  const code = c.id ?? s.code + number;
  const links = [`<a href="${esc(pdfPage(doc, c.page))}">Scanned page ${c.page}</a>`];
  if (today.has(code)) links.push(`<a href="/${slug(code)}/">${esc(fmtCode(code))} today</a>`);
  if (c.listed) {
    const note = /not\s+offered/i.test(c.listed) ? `Not offered in ${doc.label}.` : 'Listed without a description.';
    return `<section class="entry listed"${c.id ? ` id="${c.id}"` : ''}>
  <h2><span class="cc">${esc(c.label)}</span> <span>${esc(c.title)}</span></h2>
  <p class="t">${note}</p>
  <p class="entry-links">${links.join('')}</p>
</section>`;
  }
  return `<section class="entry"${c.id ? ` id="${c.id}"` : ''}>
  <h2><span class="cc">${esc(c.label)}</span> <span>${esc(c.title)}</span>${c.spec ? `<span class="u">${esc(c.spec)}</span>` : ''}</h2>
  ${c.paras.map((t) => para(t, linker)).join('\n  ')}
  <p class="entry-links">${links.join('')}</p>
</section>`;
}

/** /9495/cs: one subject as the scanned 1994–95 calendar printed it. */
export function archiveSubjectPage({ doc, s, index, today, faculty, builtAt, version }) {
  const linker = yearLinker(doc);
  const described = s.courses.filter((c) => c.id && !c.listed);
  // Courses the page index places in this subject but whose header the OCR text missed:
  // a link to /9495/cs241 that finds no anchor offers the scanned page instead.
  const anchored = new Set(s.courses.map((c) => c.id).filter(Boolean));
  const prefixes = [s.code, ...s.aliases];
  const fallback = {};
  for (const [k, page] of Object.entries(index ?? {})) {
    const p = prefixes.find((x) => k.startsWith(x) && /^\d/.test(k.slice(x.length)));
    if (p && !anchored.has(s.code + k.slice(p.length))) fallback[k] = page;
  }
  const count = s.courses.length;
  const body = `<header class="cal-head">
  <h1>${esc(s.name)} (${esc(s.code)})</h1>
  <p>${count} course${count === 1 ? '' : 's'} in the ${esc(doc.label)} Undergraduate Calendar, read from the scanned original. The text comes from OCR, so check the scanned page before relying on a detail.</p>
  ${yearNav(doc, s)}
</header>
<p class="gone-note" id="missing" hidden></p>
${described.length ? `<nav class="nums" aria-label="Course numbers">${described.map((c) => `<a href="#${c.id}">${esc(c.label.slice(c.label.indexOf(' ') + 1))}</a>`).join('')}</nav>` : ''}
${s.intro ? `<section class="entry intro"><h2>Notes</h2>${s.intro.paras.map((t) => para(t, linker)).join('')}<p class="entry-links"><a href="${esc(pdfPage(doc, s.intro.page))}">Scanned page ${s.intro.page}</a></p></section>` : ''}
${s.courses.map((c) => entryHtml(c, s, doc, linker, today)).join('\n')}
<script>
(() => {
  const pages = ${JSON.stringify(fallback)};
  const pdf = ${JSON.stringify(doc.pdf)};
  const show = () => {
    const id = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    const box = document.getElementById('missing');
    if (!id || document.getElementById(id)) return (box.hidden = true);
    const page = pages[id] ?? ${s.page};
    const code = id.replace(/^([A-Z]+)(\\d)/, '$1 $2');
    box.innerHTML = code + ' isn’t in this page’s text. <a href="' + pdf + '#page=' + page + '">See it on the scanned calendar, page ' + page + '</a>.';
    box.hidden = false;
  };
  addEventListener('hashchange', show);
  show();
})();
</script>`;
  return shell({
    title: `${s.code} courses, ${doc.label} | uwloo`,
    description: `${s.name} (${s.code}) courses in Waterloo’s ${doc.label} Undergraduate Calendar, from the scanned original.`,
    path: `/${doc.year}/${s.slug}/`,
    body,
    faculty,
    builtAt,
    version,
  });
}

/** /9495: every subject in that year's scanned calendar. */
export function archiveYearPage({ doc, builtAt, version }) {
  const rows = [...doc.subjects].sort((a, b) => a.code.localeCompare(b.code));
  const body = `<header class="cal-head">
  <h1>${esc(doc.label)} calendar</h1>
  <p>Undergraduate courses by subject, read from the scanned calendar. The text comes from OCR, so each course links to its scanned page.</p>
  ${yearNav(doc, null)}
</header>
<ul class="cols">${rows
    .map((s) => `<li><a class="cc" href="/${doc.year}/${s.slug}/">${esc(s.code)}</a> <span>${esc(s.name)}</span> <span class="count">${s.courses.length}</span></li>`)
    .join('')}</ul>`;
  return shell({
    title: `${doc.label} Undergraduate Calendar by subject | uwloo`,
    description: `All subjects in Waterloo’s ${doc.label} Undergraduate Calendar, from the scanned original.`,
    path: `/${doc.year}/`,
    body,
    builtAt,
    version,
  });
}
