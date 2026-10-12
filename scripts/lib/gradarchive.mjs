// The Graduate Calendars from before Kuali, Fall 2006 to Winter 2024 (uwloo.ca/1109/co/#CO602).
//
//   Fall 2006 to Fall 2016     uwaterloo.ca/gsac-archive/{year}/{season}/, the old gradcalendar.uwaterloo.ca
//                              saved whole. Each department page links its course list, ucalendar's
//                              SA/GRAD/{YYyy}/GRDcourse-{SUBJ}.html, saved alongside it.
//   Winter 2017 to Winter 2024 academic-calendar-archive.uwaterloo.ca (the WCMS calendar), read only if its
//                              robots.txt allows it. Winter 2020 on, UW Open Data's course catalog for the
//                              term stands in when it can't be read.
//
// scripts/grad-archive.mjs fetches them once (archives don't change) into data/grad-archive/:
//   terms/{term}.json   {term, label, source, from, parser, stats, subjects: [{code, dept, url, courses: [key]}]}
//   entries.json        {"CO602~1a2b3c4d": {t, u, c, id, d: [paragraphs], x: [notes]}}, one line each.
//                       A course that reads the same in 20 terms is stored once.
// Builds only read those files. Pure functions here are unit-tested.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { gradArchiveUrl } from '../../site/route.js';
import { decode } from './links.mjs';
import { numsNav, shell, subjectList } from './render.mjs';
import { esc, fmtCode, linkCodes, slug } from './requisites.mjs';
import { parseTerm, termName, termRange, yearCodeFor } from './terms.mjs';

export const OLD_FIRST = '1069'; // Fall 2006, the oldest Graduate Calendar online
export const OLD_LAST = '1241'; // Winter 2024; Spring 2024 on is Kuali
export const GSAC_LAST = '1169'; // Fall 2016, the last term in uwaterloo.ca/gsac-archive
export const PARSER = 1; // bump when parseCoursePage changes, and the next run reparses every calendar term
export const DIR = 'data/grad-archive';
export { gradArchiveUrl };

const GSAC = process.env.GSAC_BASE ?? 'https://uwaterloo.ca/gsac-archive';
const ACA = process.env.ACA_BASE ?? 'http://academic-calendar-archive.uwaterloo.ca/graduate-studies';
const academicYear = (t) => (t.month === 9 ? t.year : t.year - 1);

/**
 * Every term from Fall 2006 to Winter 2024 and where its calendar is: `start` (the first page), `scope`
 * (pages under it are the calendar's own) and `kind` ('gsac' or 'aca').
 */
export function oldTerms({ gsac = GSAC, aca = ACA } = {}) {
  return termRange(OLD_FIRST, OLD_LAST).map((term) => {
    const t = parseTerm(term);
    const season = t.season.toLowerCase();
    const base = { term, label: termName(term), year: t.year, season, yearCode: yearCodeFor(academicYear(t)), official: gradArchiveUrl(term) };
    if (Number(term) <= Number(GSAC_LAST)) {
      const scope = `${gsac}/${t.year}/${season}/`;
      return { ...base, kind: 'gsac', scope, start: `${scope}gradcalendar.uwaterloo.ca/group/Gen-Info-Regs.html` };
    }
    const scope = `${aca}/archive-${season}-${t.year}/`;
    return { ...base, kind: 'aca', scope, start: `${scope}index.html` };
  });
}

// ---------------- reading a course page ----------------

const BLOCK = /^(p|div|li|ul|ol|tr|table|tbody|thead|tfoot|dl|dt|dd|center|blockquote|pre|form|section|article|header|footer|nav|main|aside|caption|address)$/;
const H = '\u0001';
const I_ON = '\u0002';
const I_OFF = '\u0003';

/**
 * HTML → lines of text, one per block (paragraph, list item, table row, <br>). Each line knows whether it's
 * a heading or a rule, and whether it's (almost) all italic: the old calendars set notes like "Prereq: …"
 * and "(Cross-listed with CM 740)" in italics.
 */
export function htmlLines(html) {
  let s = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|noscript|select)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (m, close, tag) => {
    const t = tag.toLowerCase();
    if (t === 'br') return '\n';
    if (t === 'hr') return `\n${H}R\n`;
    if (/^h[1-6]$/.test(t)) return close ? '\n' : `\n${H}H`;
    if (t === 'i' || t === 'em') return close ? I_OFF : I_ON;
    if (t === 'td' || t === 'th') return ' ';
    return BLOCK.test(t) ? '\n' : '';
  });
  s = decode(s.replace(/<[^>]*>/g, '')).replace(/ /g, ' ');
  const out = [];
  let depth = 0; // italics can run across lines
  for (const raw of s.split('\n')) {
    let kind = 'text';
    let line = raw;
    if (line.startsWith(`${H}R`)) {
      out.push({ kind: 'rule', text: '', italic: false });
      continue;
    }
    if (line.startsWith(`${H}H`)) {
      kind = 'heading';
      line = line.slice(2);
    }
    let text = '';
    let ital = 0;
    let all = 0;
    for (const ch of line) {
      if (ch === I_ON) depth++;
      else if (ch === I_OFF) depth = Math.max(0, depth - 1);
      else {
        text += ch;
        if (!/\s/.test(ch)) {
          all++;
          if (depth > 0) ital++;
        }
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ kind, text, italic: ital >= 0.8 * all });
  }
  return out;
}

// "CS 642 Principles of Programming Languages (0.50) LEC Course ID: 000599", the bold header of each entry.
const COMPS = '[A-Z]{3}(?:\\s*[,/&]\\s*[A-Z]{3})*';
const HEAD_UNITS = new RegExp(`^[-–•*\\s]*([A-Z]{2,8}) ?(\\d{3}[A-Z]{0,2})\\b\\s*(.*?)\\s*\\(\\s*(\\d{0,2}\\.\\d{1,3})\\s*\\)\\s*(${COMPS})?\\s*(?:Course\\s*ID\\s*:?\\s*(\\d{3,8}))?\\s*$`);
const HEAD_ID = new RegExp(`^[-–•*\\s]*([A-Z]{2,8}) ?(\\d{3}[A-Z]{0,2})\\b\\s*(.*?)\\s*(${COMPS})?\\s*Course\\s*ID\\s*:?\\s*(\\d{3,8})\\s*$`);
const ID_ONLY = /^Course\s*ID\s*:?\s*(\d{3,8})$/i;
const FOOTER = /^(back to top|top of page|return to|©|copyright|last (updated|modified)|printable version|page \d+ of)\b/i;

export function parseHeader(text) {
  let m = HEAD_UNITS.exec(text);
  if (m && (m[6] || m[5] || m[3])) {
    return { subject: m[1], number: m[2], title: m[3].replace(/[\s:–-]+$/, ''), units: Number(m[4]), comp: m[5]?.replace(/\s+/g, '') ?? null, id: m[6] ?? null };
  }
  m = HEAD_ID.exec(text);
  if (m) return { subject: m[1], number: m[2], title: m[3].replace(/[\s:–-]+$/, ''), units: null, comp: m[4]?.replace(/\s+/g, '') ?? null, id: m[5] };
  return null;
}

/**
 * One GRDcourse-{SUBJ}.html page → {courses: [{code, subject, number, title, units, comp, id, d, x}], ids, missed}.
 * `d` is the description (paragraphs), `x` the italic notes in order (prerequisites, cross-listings, topics).
 * `ids` counts "Course ID" in the page and `missed` lists header-like lines that didn't parse, so a layout
 * this doesn't know shows up in the crawler's log instead of silently losing courses.
 */
export function parseCoursePage(html) {
  const lines = htmlLines(html);
  const courses = [];
  const missed = [];
  let cur = null;
  let ids = 0;
  for (const l of lines) {
    ids += (l.text.match(/Course\s*ID\b/gi) ?? []).length;
    if (l.kind !== 'text' || /^[A-Z]{2,8} ?\d00s$/.test(l.text)) {
      cur = null; // "CS 600s" (a heading, or just a line), a rule: between entries
      continue;
    }
    const h = parseHeader(l.text);
    if (h) {
      const code = h.subject + h.number;
      cur = { code, ...h, d: [], x: [] };
      if (!courses.some((c) => c.code === code)) courses.push(cur);
      continue;
    }
    if (/^[-–•*\s]*[A-Z]{2,8} ?\d{3}[A-Z]{0,2}\b.*Course\s*ID/i.test(l.text)) {
      missed.push(l.text.slice(0, 160)); // a header this doesn't read: its lines aren't the last course's
      cur = null;
      continue;
    }
    if (!cur) continue;
    if (FOOTER.test(l.text)) {
      cur = null;
      continue;
    }
    const id = ID_ONLY.exec(l.text);
    if (id) {
      cur.id ??= id[1];
      continue;
    }
    (l.italic ? cur.x : cur.d).push(l.text);
  }
  return { courses, ids, missed };
}

/** "Combinatorics & Optimization (CO) Courses" → {dept, code} */
export function courseLinkText(text) {
  const m = /^(.*?)\s*\(([A-Z]{2,8})\)\s*Courses?\s*$/i.exec(String(text ?? '').trim());
  return m ? { dept: m[1].trim() || null, code: m[2].toUpperCase() } : null;
}

// ---------------- storage ----------------

const ENTRY_FIELDS = ['t', 'u', 'c', 'id', 'd', 'x'];
/** The stored form of one course: title, units, components, Course ID, description, notes. */
export function toEntry(c) {
  const e = { t: c.title ?? '', u: c.units ?? null, c: c.comp ?? null, id: c.id ?? null, d: c.d ?? [], x: c.x ?? [] };
  return Object.fromEntries(ENTRY_FIELDS.map((k) => [k, e[k]]));
}
export const entryKey = (code, e) => `${code}~${createHash('sha1').update(JSON.stringify(e)).digest('hex').slice(0, 8)}`;
const byKey = (a, b) => a.localeCompare(b, 'en', { numeric: true });

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}
async function writeAtomic(path, text) {
  await writeFile(`${path}.part`, text);
  await rename(`${path}.part`, path);
}

export async function readStore(dir = DIR) {
  const entries = await readJson(`${dir}/entries.json`, {});
  const terms = {};
  let files = [];
  try {
    files = (await readdir(`${dir}/terms`)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const f of files) terms[f.slice(0, 4)] = await readJson(`${dir}/terms/${f}`, null);
  return { entries, terms };
}

/**
 * Saves one term: `subjects` = [{code, dept, url, courses: [parsed course]}]. Entries no term uses any more
 * are dropped, so re-reading a term never leaves stale ones behind.
 */
export async function saveTerm(store, doc, subjects, dir = DIR) {
  const keys = [];
  const out = { ...doc, subjects: [] };
  for (const s of [...subjects].sort((a, b) => a.code.localeCompare(b.code))) {
    const list = [];
    for (const c of s.courses) {
      const e = toEntry(c);
      const key = entryKey(c.code, e);
      store.entries[key] = e;
      list.push(key);
      keys.push(key);
    }
    if (list.length) out.subjects.push({ code: s.code, dept: s.dept ?? null, url: s.url ?? null, courses: list });
  }
  store.terms[doc.term] = out;
  const used = new Set(Object.values(store.terms).flatMap((t) => t?.subjects.flatMap((s) => s.courses) ?? []));
  for (const k of Object.keys(store.entries)) if (!used.has(k)) delete store.entries[k];
  await mkdir(`${dir}/terms`, { recursive: true });
  await writeAtomic(`${dir}/terms/${doc.term}.json`, `${JSON.stringify(out, null, 1)}\n`);
  const lines = Object.keys(store.entries)
    .sort(byKey)
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(store.entries[k])}`);
  await writeAtomic(`${dir}/entries.json`, `{\n${lines.join(',\n')}\n}\n`);
  return keys.length;
}

// ---------------- for the build ----------------

const REQ_NOTE = /^\(?\s*(pre|co|anti)[-\s]?req/i;
/** What "requisites changed" compares between two terms: the Prereq/Coreq/Antireq notes. */
export const reqSignature = (notes) =>
  (notes ?? [])
    .filter((n) => REQ_NOTE.test(n))
    .map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .join('|');

/**
 * data/grad-archive → one catalog per term, oldest first, shaped like the Kuali ones where it matters:
 * {term, label, kind: 'old', source, from, yearCode, subjects: Set, bySubject: Map, courses: Map}.
 * `names(subject)` gives subject names (today's calendars know most of them).
 */
export async function loadGradArchive({ dir = DIR, names = () => null } = {}) {
  const { entries, terms } = await readStore(dir);
  const out = [];
  for (const doc of Object.values(terms)) {
    if (!doc?.subjects?.length) continue;
    const t = parseTerm(doc.term);
    const cat = {
      term: doc.term,
      label: termName(doc.term),
      kind: 'old',
      level: 'grad',
      status: 'past',
      source: doc.source,
      from: doc.from,
      official: gradArchiveUrl(doc.term),
      yearCode: yearCodeFor(academicYear(t)),
      subjects: new Set(),
      bySubject: new Map(),
      courses: new Map(),
      names: new Map(),
    };
    for (const s of doc.subjects) {
      const list = [];
      for (const key of s.courses) {
        const e = entries[key];
        if (!e) continue;
        const code = key.split('~')[0];
        const m = /^([A-Z]+)(\d.*)$/.exec(code);
        const c = {
          code,
          subject: m[1],
          number: m[2],
          title: e.t,
          units: e.u,
          comp: e.c,
          cid: e.id,
          paras: e.d,
          description: e.d.join(' '),
          notes: e.x,
          url: s.url,
          signature: reqSignature(e.x),
          key,
        };
        if (cat.courses.has(code)) continue;
        cat.courses.set(code, c);
        list.push(c);
      }
      if (!list.length) continue;
      // A course listed on another subject's page (cross-listed) goes under its own subject.
      for (const c of list) {
        if (!cat.bySubject.has(c.subject)) cat.bySubject.set(c.subject, []);
        cat.bySubject.get(c.subject).push(c);
      }
      if (!cat.names.has(s.code)) cat.names.set(s.code, names(s.code) ?? s.dept ?? null);
    }
    for (const [subj, list] of cat.bySubject) {
      list.sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
      cat.subjects.add(subj);
      if (!cat.names.get(subj)) cat.names.set(subj, names(subj) ?? null);
    }
    out.push(cat);
  }
  return out.sort((a, b) => Number(a.term) - Number(b.term));
}

/** For each course: the old terms it's in (oldest first) and its newest entry. */
export function gradAppearances(oldCats) {
  const out = new Map();
  for (const cat of oldCats) {
    for (const c of cat.courses.values()) {
      const a = out.get(c.code) ?? { terms: [], latest: null, latestCat: null };
      a.terms.push({ term: cat.term, label: cat.label, href: `/${cat.term}/${slug(c.subject)}/#${c.code}` });
      a.latest = c;
      a.latestCat = cat;
      out.set(c.code, a);
    }
  }
  return out;
}

// ---------------- pages ----------------

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtUnits = (u) => (u == null ? null : Number(u).toFixed(2));
const TOPIC = /^\d{1,3}\s+\S/;

/** Links in one old term: to the course in the same term when it's there, else to its main page. */
export function termLinker(cat, linkable) {
  const inTerm = (c) => cat.courses.get(c);
  return {
    has: (c) => Boolean(inTerm(c)) || linkable.has(c),
    href: (c) => (inTerm(c) ? `/${cat.term}/${slug(inTerm(c).subject)}/#${c}` : linkable.href(c)),
    retired: { has: (c) => !inTerm(c) && Boolean(linkable.retired?.has(c)) },
  };
}

function notesHtml(notes, linker) {
  if (!notes.length) return '';
  const topics = notes.filter((n) => TOPIC.test(n));
  const rest = notes.filter((n) => !TOPIC.test(n));
  return `<div class="notes">${rest.map((n) => `<p><i>${linkCodes(n, linker)}</i></p>`).join('')}${
    topics.length ? `<ul class="topics">${topics.map((n) => `<li>${linkCodes(n, linker)}</li>`).join('')}</ul>` : ''
  }</div>`;
}

function oldEntryHtml(c, cat, linker, linkable) {
  const main = linkable.href(c.code);
  const facts = [c.comp && c.comp.replace(/,/g, ', '), c.cid && `Course ID ${c.cid}`].filter(Boolean).join(' · ');
  const links = [
    c.url && cat.source === 'calendar' && [c.url, 'Archived page'],
    cat.source === 'opendata' && [cat.official, `Graduate Calendar, ${cat.label}`],
    main && [main, `${fmtCode(c.code)} today`],
  ].filter(Boolean);
  return `<section class="entry" id="${c.code}">
  <h2>${main ? `<a class="cc" href="${main}">${esc(fmtCode(c.code))}</a>` : `<span class="cc">${esc(fmtCode(c.code))}</span>`} <span>${esc(c.title)}</span>${c.units != null ? `<span class="u">${fmtUnits(c.units)} units</span>` : ''}</h2>
  ${c.paras.map((p) => `<p>${linkCodes(p, linker)}</p>`).join('\n  ')}
  ${notesHtml(c.notes, linker)}
  <p class="entry-links">${facts ? `<span class="t">${esc(facts)}</span>` : ''}${links.map(([u, label]) => `<a href="${esc(u)}">${esc(label)}</a>`).join('')}</p>
</section>`;
}

/** "4 graduate courses in the Fall 2010 Graduate Calendar, from Waterloo’s archived copy." */
function countLine(cat, count) {
  if (cat.source === 'opendata') {
    return `${count} in Waterloo’s course catalog for ${esc(cat.label)}, from <a href="https://openapi.data.uwaterloo.ca/api-docs">UW Open Data</a>. uwloo can’t read that term’s Graduate Calendar, so this stands in for it; <a href="${esc(cat.official)}">the calendar itself</a> is in Waterloo’s archive.`;
  }
  return `${count} in the ${esc(cat.label)} Graduate Calendar, from <a href="${esc(cat.from)}">Waterloo’s archived copy</a>.`;
}

/** /1109/co: one subject as an old term's Graduate Calendar has it. */
export function oldTermSubjectPage({ cat, nav, subject, courses, linkable, faculty, builtAt, version }) {
  const name = cat.names.get(subject);
  const linker = termLinker(cat, linkable);
  const body = `<header class="cal-head">
  <h1>${name ? `${esc(name)} (${esc(subject)})` : esc(subject)}</h1>
  <p>${countLine(cat, plural(courses.length, 'graduate course'))}</p>
  ${nav}
</header>
${numsNav('', courses)}
${courses.map((c) => oldEntryHtml(c, cat, linker, linkable)).join('\n')}`;
  return shell({
    title: `${subject} graduate courses, ${cat.label} | uwloo`,
    description: `Every ${name ? `${name} (${subject})` : subject} course in Waterloo’s ${cat.label} Graduate Calendar.`,
    path: `/${cat.term}/${slug(subject)}/`,
    body,
    faculty,
    builtAt,
    version,
  });
}

export function oldTermIndexPage({ cat, nav, builtAt, version }) {
  const rows = [...cat.bySubject.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subject, list]) => ({ subject, name: cat.names.get(subject) ?? '', ug: 0, grad: list.length }));
  const body = `<header class="cal-head">
  <h1>${esc(cat.label)} Graduate Calendar</h1>
  <p>${countLine(cat, `${plural(cat.courses.size, 'graduate course')} in ${plural(rows.length, 'subject')}`)}</p>
  ${nav}
</header>
${subjectList(`/${cat.term}/`, rows)}`;
  return shell({
    title: `${cat.label} Graduate Calendar by subject | uwloo`,
    description: `All subjects in Waterloo’s ${cat.label} Graduate Calendar.`,
    path: `/${cat.term}/`,
    body,
    builtAt,
    version,
  });
}
