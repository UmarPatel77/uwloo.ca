// Course resources: PDFs uwloo hosts (only with permission) and links to material elsewhere.
//
//   Catalogue  data/resources/{SUBJ}.json        one list per subject (the subject of each entry's first code),
//                                                written by tools/resources/intake.py. Schema: validate() below.
//   Text       data/resources/text/{file id}.txt pdftotext output, pages split by form feeds (optional)
//   Files      GitHub release tagged "files"      one asset per hosted PDF, named {file id}.pdf. The build copies
//                                                the catalogued ones into dist/files/, served from uwloo.ca.
//
// An entry is one resource as its author made it: a single PDF, a set (chapters, lecture slides,
// assignments 1 to 5), links, or a mix. Its parts are listed in order; each part is a hosted PDF, a link,
// or a PDF with a link to where the original lives. The course page shows one card per entry. Each hosted
// PDF gets a page with the entry's notes on top and the PDF underneath: the first at /cs341/1249-notes/,
// the rest at /cs341/1249-notes/{n}/.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shell, SITE } from './render.mjs';
import { esc, fmtCode, linkCodes, slug } from './requisites.mjs';
import { termName } from './terms.mjs';

export const KINDS = {
  notes: 'Course notes',
  slides: 'Slides',
  assignments: 'Assignments',
  midterm: 'Past midterm',
  final: 'Past final',
  exam: 'Past exam',
  solutions: 'Solutions',
  cheatsheet: 'Cheat sheet',
  outline: 'Course outline',
  textbook: 'Textbook',
  site: 'Course website',
  videos: 'Lecture videos',
  other: 'Other',
};
const KIND_ORDER = Object.keys(KINDS);
export const SLUG_RE = /^(\d{3}[159]-)?[a-z]+(-\d+)?$/;
const FILE_RE = /^[0-9a-f]{12}\.pdf$/;
export const RELEASE_TAG = 'files';
// Renamed from .mjs to .js so any static host serves them as JavaScript.
const PDFJS = '/vendor/pdfjs-6.3.289/pdf.min.js';
const SHOWN_PARTS = 8; // on a course page card; the rest are on the resource's own page
const OPEN_PARTS = 6; // a resource page's parts list starts open up to this many parts

// ---------------- catalogue ----------------

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function partErrors(p, i, multi) {
  const errs = [];
  const at = `parts[${i}]`;
  if (!Number.isInteger(p?.n) || p.n < 1) errs.push(`${at}.n must be a whole number from 1 (its page: /…/{n}/)`);
  if (multi && !isStr(p?.title)) errs.push(`${at}.title is required when there's more than one part`);
  if (p?.kind != null && !KINDS[p.kind]) errs.push(`${at}.kind must be one of ${KIND_ORDER.join(', ')}`);
  if (p?.file != null && !FILE_RE.test(p.file)) errs.push(`${at}.file must be "{12 hex digits}.pdf" (start of its SHA-256)`);
  if (p?.file == null && !isStr(p?.url)) errs.push(`${at} needs a file (hosted) or a url (linked)`);
  if (p?.url != null && !/^https?:\/\/[^\s]+$/.test(p.url)) errs.push(`${at}.url must be an http(s) link`);
  if (p?.pages != null && !(Number.isInteger(p.pages) && p.pages > 0)) errs.push(`${at}.pages must be a whole number`);
  if (p?.file == null && (p?.pages != null || p?.page_notes != null)) errs.push(`${at}: pages and page_notes are for hosted PDFs`);
  if (p?.page_notes != null) {
    if (typeof p.page_notes !== 'object' || Array.isArray(p.page_notes)) errs.push(`${at}.page_notes must map page numbers to text`);
    else {
      for (const [k, t] of Object.entries(p.page_notes)) {
        if (!/^[1-9]\d*$/.test(k) || typeof t !== 'string' || (p.pages && Number(k) > p.pages)) errs.push(`${at}.page_notes["${k}"] isn’t a page in that file`);
      }
    }
  }
  return errs;
}

/** Problems with one catalogue entry, as readable strings ([] when it's fine). */
export function validate(e) {
  const errs = [];
  if (!/^[0-9a-f]{12}$/.test(e.id ?? '')) errs.push('id must be 12 hex characters');
  if (!Array.isArray(e.codes) || !e.codes.length || !e.codes.every((c) => /^[A-Z]{2,8}\d{3}[A-Z]{0,2}$/.test(c))) errs.push('codes must list course codes like "CS341"');
  if (!SLUG_RE.test(e.slug ?? '')) errs.push('slug must look like "1249-notes" or "notes-2"');
  if (!KINDS[e.kind]) errs.push(`kind must be one of ${KIND_ORDER.join(', ')}`);
  if (!isStr(e.title)) errs.push('title is required');
  if (e.term != null && !/^\d{3}[159]$/.test(e.term)) errs.push('term must be a term code like "1249"');
  if (/^\d/.test(e.slug ?? '') && !String(e.slug).startsWith(`${e.term}-`)) errs.push('slug’s term doesn’t match term');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.added ?? '')) errs.push('added must be a date like "2026-10-10"');
  if (!Array.isArray(e.parts) || !e.parts.length) {
    errs.push('parts must list at least one PDF or link');
    return errs;
  }
  e.parts.forEach((p, i) => errs.push(...partErrors(p, i, e.parts.length > 1)));
  const ns = e.parts.map((p) => p?.n);
  if (new Set(ns).size !== ns.length) errs.push('two parts share the same n');
  const files = e.parts.map((p) => p?.file).filter(Boolean);
  if (new Set(files).size !== files.length) errs.push('the same file is in two parts');
  if (files.length && !isStr(e.permission)) errs.push('hosted files need permission: who allowed it and when');
  return errs;
}

/** Every catalogue entry, with problems listed instead of thrown so the build can skip bad ones. */
export async function loadResources(dir = 'data/resources') {
  const entries = [];
  const errors = [];
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => /^[A-Z]+\.json$/.test(f)).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const seen = new Map(); // "cs341/1249-notes", entry ids and file names → where they're used
  for (const f of files) {
    const list = JSON.parse(await readFile(join(dir, f), 'utf8'));
    if (!Array.isArray(list)) {
      errors.push(`${f}: should be a list of entries`);
      continue;
    }
    for (const e of list) {
      const where = `${f}: ${e?.id ?? '(no id)'}`;
      const errs = validate(e ?? {});
      if (!errs.length) {
        const subj = /^[A-Z]+/.exec(e.codes[0])[0];
        if (subj !== f.slice(0, -5)) errs.push(`first code ${e.codes[0]} belongs in ${subj}.json`);
        const page = `${slug(e.codes[0])}/${e.slug}`;
        if (seen.has(page)) errs.push(`${page} is already used by ${seen.get(page)}`);
        if (seen.has(e.id)) errs.push(`id ${e.id} is used twice`);
        for (const p of e.parts) if (p.file && seen.has(p.file)) errs.push(`${p.file} is already in ${seen.get(p.file)}`);
      }
      if (errs.length) {
        errors.push(...errs.map((x) => `${where}: ${x}`));
        continue;
      }
      const page = `${slug(e.codes[0])}/${e.slug}`;
      seen.set(page, e.id);
      seen.set(e.id, page);
      for (const p of e.parts) if (p.file) seen.set(p.file, page);
      entries.push(e);
    }
  }
  return { entries, errors };
}

/** The entry with only the parts whose PDF is on hand (links always are); null when nothing's left. */
export function available(e, onHand) {
  const parts = e.parts.filter((p) => !p.file || onHand.has(p.file));
  return parts.length ? { ...e, parts } : null;
}

export const pagePath = (e) => `/${slug(e.codes[0])}/${e.slug}/`;
const hosted = (e) => e.parts.filter((p) => p.file);
/** The first hosted part lives at the entry's page; the others at /{n}/. */
export const partPath = (e, p) => (hosted(e)[0] === p ? pagePath(e) : `${pagePath(e)}${p.n}/`);
export const fileHref = (p) => `/files/${p.file}`;
const downloadName = (e, p) => `${e.codes[0]}-${e.slug}${e.parts.length > 1 ? `-${p.n}` : ''}.pdf`;
const host = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
};
const count = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Newest term first; within a term, notes before slides before exams…; undated last. */
export function sortResources(list) {
  return [...list].sort((a, b) => Number(b.term ?? 0) - Number(a.term ?? 0) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title));
}

/** "Fall 2024 · Prof. X · 212 pages", or for a set "… · 9 PDFs · 2 links". */
function metaBits(e) {
  const out = [e.term && termName(e.term), e.by];
  const pdfs = hosted(e);
  const links = e.parts.filter((p) => !p.file);
  if (e.parts.length === 1) {
    const [p] = e.parts;
    out.push(p.file ? p.pages && count(p.pages, 'page') : host(p.url));
  } else {
    out.push(pdfs.length && count(pdfs.length, 'PDF'), links.length && count(links.length, 'link'));
  }
  return out.filter(Boolean);
}

// ---------------- notes ----------------

// [text](url), or a bare url (balanced parentheses allowed, as in Wikipedia links; trailing punctuation isn't part of it)
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)|(https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\))*(?:[^\s<>().,;:!?'"]|\([^\s<>()]*\)))/g;

/** One paragraph of a note: [text](url) and bare links become links; course codes link to their pages. */
export function inlineHtml(text, known) {
  let out = '';
  let last = 0;
  for (const m of String(text).matchAll(LINK_RE)) {
    out += linkCodes(text.slice(last, m.index), known);
    const url = m[2] ?? m[3];
    out += `<a href="${esc(url)}">${esc(m[1] ?? url.replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
    last = m.index + m[0].length;
  }
  return out + linkCodes(text.slice(last), known);
}

/** A note: paragraphs split by blank lines. */
export function noteHtml(text, known) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inlineHtml(p.replace(/\s*\n\s*/g, ' '), known)}</p>`)
    .join('');
}

/** Plain-text citation for one part (or the whole entry). Hosted files cite their uwloo page; links cite where they live. */
export function citation(e, p = e.parts[0]) {
  const where = p.file ? `${SITE}${partPath(e, p)}` : p.url;
  const title = e.parts.length > 1 && p.title ? `${e.title.replace(/\.$/, '')}: ${p.title.replace(/\.$/, '')}` : e.title.replace(/\.$/, '');
  const course = `${e.codes.map(fmtCode).join(' / ')}${e.term ? `, ${termName(e.term)}` : ''}`;
  return `${e.by ? `${e.by.replace(/\.$/, '')}. ` : ''}“${title}.” University of Waterloo, ${course}. ${where}`;
}

function issueUrl(repo, title, body) {
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
const where = (e) => (hosted(e).length ? SITE + pagePath(e) : e.parts.map((p) => p.url).join('\n'));
const removeUrl = (e, repo) =>
  issueUrl(repo, `Remove resource ${e.id} (${fmtCode(e.codes[0])})`, `Please remove this from uwloo.ca:\n${where(e)}\n\nId: ${e.id}\n\nAll of it, or which part:\nWhy (you made it, it's out of date, something else):\n`);
const correctUrl = (e, p, repo) =>
  issueUrl(repo, `Note for resource ${e.id} (${fmtCode(e.codes[0])})`, `Resource: ${SITE}${partPath(e, p)}\nId: ${e.id}, part ${p.n}\n\nPage (if it's about one page):\nNote or correction:\n`);
const suggestUrl = (code, repo) =>
  issueUrl(repo, `Resource for ${fmtCode(code)}`, `Course: ${fmtCode(code)}\nLink(s):\nWhat it is (notes, slides, past exam…) and which term:\nWho made it, and are they OK with it being listed:\n`);

// ---------------- course page section ----------------

/** One part as a link: its uwloo page for a PDF, the site itself for a link. */
function partLink(e, p, { current } = {}) {
  const label = esc(p.title ?? e.title);
  if (p.file) return p === current ? `<a aria-current="page" href="${esc(partPath(e, p))}">${label}</a>` : `<a href="${esc(partPath(e, p))}">${label}</a>`;
  return `<a href="${esc(p.url)}">${label}</a> <span class="t">${esc(host(p.url))}</span>`;
}

function itemHtml(e, code, known, repo) {
  const pdfs = hosted(e);
  const single = e.parts.length === 1 ? e.parts[0] : null;
  const href = pdfs.length ? pagePath(e) : single ? single.url : null;
  const meta = metaBits(e);
  const others = e.codes.filter((c) => c !== code);
  if (others.length) meta.push(`also ${others.map(fmtCode).join(', ')}`);
  const links = [];
  if (single?.file) links.push(`<a href="${esc(pagePath(e))}">View</a>`, `<a href="${esc(fileHref(single))}" download="${esc(downloadName(e, single))}">Download</a>`);
  else if (single) links.push(`<a href="${esc(single.url)}">Open on ${esc(host(single.url))}</a>`);
  links.push(`<a href="${esc(removeUrl(e, repo))}">Remove this</a>`);
  let parts = '';
  if (!single) {
    // A set: its parts in order, the first few here; all of them on its page (or all here, for links only).
    const shown = pdfs.length ? e.parts.slice(0, SHOWN_PARTS) : e.parts;
    const more = e.parts.length - shown.length;
    parts = `<ol class="res-parts">${shown.map((p) => `<li>${partLink(e, p)}</li>`).join('')}${more ? `<li class="more-parts"><a href="${esc(pagePath(e))}">${more} more</a></li>` : ''}</ol>`;
  }
  return `<li class="res-item">
  <p class="res-line"><span class="kind">${esc(KINDS[e.kind])}</span> ${href ? `<a class="res-title" href="${esc(href)}">${esc(e.title)}</a>` : `<span class="res-title">${esc(e.title)}</span>`}</p>
  <p class="res-meta t">${esc(meta.join(' · '))}</p>
  ${e.note ? `<div class="res-note">${noteHtml(e.note, known)}</div>` : ''}
  ${parts}
  <p class="entry-links">${links.join('')}</p>
</li>`;
}

// ---------------- links found around the web (data/links/found.json) ----------------

const FOUND_SHOWN = 8;
const FOUND_ORDER = ['site', 'notes', 'slides', 'videos', 'cheatsheet', 'midterm', 'final', 'exam', 'outline', 'textbook', 'solutions', 'assignments', 'other'];
const VIA_ORDER = ['course', 'faculty', 'list', 'webring', 'reddit', 'github'];
const monthYear = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Where the finder came across a link, as a short phrase with links. */
function viaHtml(v) {
  if (!v) return '';
  const name = (x) => esc(String(x ?? '').replace(/\s*[|·–—].*$/, '').slice(0, 60));
  switch (v.type) {
    case 'faculty':
      return `from <a href="${esc(v.url)}">${name(v.name)}’s site</a>`;
    case 'webring':
      return `from <a href="${esc(v.url)}">${v.name ? `${name(v.name)}’s site` : 'a member’s site'}</a>, ${esc(v.ring)}`;
    case 'list':
      return `from <a href="${esc(v.url)}">${name(v.name)}</a>`;
    case 'reddit': {
      const when = v.t ? ` ${new Date(v.t * 1000).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' })}` : '';
      const thread = v.post ? `https://www.reddit.com/r/uwaterloo/comments/${v.post}/${v.comment ? `_/${v.comment}/` : ''}` : null;
      return thread ? `posted on <a href="${esc(thread)}">r/uwaterloo</a>${when}` : `posted on r/uwaterloo${when}`;
    }
    case 'github':
      return v.name ? `by ${name(v.name)} on GitHub` : 'on GitHub';
    default:
      return '';
  }
}

export function sortFound(list) {
  const k = (l) => (FOUND_ORDER.indexOf(l.kind) + 1 || 99);
  const v = (l) => (VIA_ORDER.indexOf(l.via?.[0]?.type) + 1 || 99);
  return [...list].sort((a, b) => k(a) - k(b) || v(a) - v(b) || Number(b.term ?? 0) - Number(a.term ?? 0) || (a.status === 'archived') - (b.status === 'archived') || a.title.localeCompare(b.title));
}

function foundItem(l, code, repo) {
  const href = l.status === 'archived' ? l.archived : l.url;
  const bits = [esc(KINDS[l.kind] ?? 'Link'), l.term && esc(termName(l.term)), esc(host(l.url)), viaHtml(l.via?.[0])].filter(Boolean);
  if (l.status === 'archived') bits.push(`gone now; <a href="${esc(l.archived)}">archived copy</a>${l.archived_on ? ` from ${esc(monthYear(l.archived_on))}` : ''}`);
  const remove = issueUrl(repo, `Remove link (${fmtCode(code)})`, `Please stop listing this on uwloo.ca:\n${l.url}\n\nCourse: ${fmtCode(code)}\nWhy (you made it, it's wrong, it's out of date, something else):\n`);
  return `<li><a class="found-title" href="${esc(href)}">${esc(l.title)}</a> <span class="t">${bits.join(' · ')}</span> <a class="rm" href="${esc(remove)}" title="Ask for this link to be removed">Remove</a></li>`;
}

/** "Around the web": what the link finder found for this course, best first. */
function foundHtml(code, found, repo) {
  if (!found?.length) return '';
  const sorted = sortFound(found);
  const shown = sorted.slice(0, FOUND_SHOWN);
  const rest = sorted.slice(FOUND_SHOWN);
  return `<h3 class="found-h">Around the web</h3>
  <p class="t found-note">Found by uwloo’s <a href="/about/links/">link finder</a>, which checks that each page names ${esc(fmtCode(code))}.</p>
  <ul class="found">${shown.map((l) => foundItem(l, code, repo)).join('')}</ul>
  ${rest.length ? `<details class="found-more"><summary>${rest.length} more link${rest.length === 1 ? '' : 's'}</summary><ul class="found">${rest.map((l) => foundItem(l, code, repo)).join('')}</ul></details>` : ''}`;
}

/** The "Resources" section on a course page, or '' when there's nothing for it. */
export function resourcesSection(code, list, { known, repo, found = [] }) {
  const curated = list ?? [];
  const mine = new Set(curated.flatMap((e) => e.parts.map((p) => p.url).filter(Boolean)));
  const extra = found.filter((l) => !mine.has(l.url));
  if (!curated.length && !extra.length) return '';
  return `<section class="resources" aria-labelledby="res-h">
  <h2 id="res-h">Resources</h2>
  ${curated.length ? `<ul class="res-list">${sortResources(curated).map((e) => itemHtml(e, code, known, repo)).join('\n')}</ul>` : ''}
  ${foundHtml(code, extra, repo)}
  <p class="t res-foot">${curated.length ? 'PDFs here are shared with permission of the people who made them; links go where they posted them. ' : ''}<a href="${esc(suggestUrl(code, repo))}">Suggest a resource</a>.</p>
</section>`;
}

/** /about/links/: what the link finder does, and how to opt out. */
export function linksAboutPage({ meta, repo, builtAt, version }) {
  const n = (x) => Number(x ?? 0).toLocaleString('en-CA');
  const body = `<article class="about">
<header class="cal-head"><h1>uwloo’s link finder</h1>
<p>${meta ? `${n(meta.links)} link${meta.links === 1 ? '' : 's'} for ${n(meta.courses)} course${meta.courses === 1 ? '' : 's'}, last checked ${esc(new Date(meta.generated).toLocaleDateString('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' }))}.` : 'It hasn’t run yet.'}</p></header>
<p>Course pages on uwloo list resources for each course: notes, slides, course websites, lecture videos and past exams. Besides PDFs shared with uwloo directly, a weekly job looks for them around the web:</p>
<ul>
  <li>links posted on r/uwaterloo next to a course code;</li>
  <li>students’ sites in the Waterloo CS, SE and ECE webrings, and students’ lists of course links;</li>
  <li>professors’ sites, found through department directories, and their teaching pages;</li>
  <li>course websites like <code>student.cs.uwaterloo.ca/~cs341/</code>;</li>
  <li>GitHub repositories of course notes.</li>
</ul>
<p>A page is listed only if it loads and names the course, in its title, heading, text or address. Assignments and solutions are never listed unless they’re on the course’s own website. When a link has died, the listing points to the Wayback Machine’s copy instead, or drops it.</p>
<h2>For site owners</h2>
<p>The finder identifies itself as <code>uwloo-links/1.0 (+https://uwloo.ca/about/links/)</code>, follows <code>robots.txt</code>, and fetches one page at a time from each site with a pause in between. Most pages are fetched once every few weeks. To keep it off your site:</p>
<pre>User-agent: uwloo-links
Disallow: /</pre>
<p>To have a link taken down, use the “Remove” link next to it, or <a href="https://github.com/${esc(repo)}/issues/new?title=${encodeURIComponent('Remove links')}">open an issue</a>. Removed links and sites are listed in <code>data/links/removed.txt</code> and never come back.</p>
</article>`;
  return shell({ title: 'Link finder | uwloo', description: 'How uwloo finds course resources around the web, and how to opt out.', path: '/about/links/', body, builtAt, version });
}

// ---------------- PDF pages ----------------

/** pdftotext output → per-page text (form feeds separate pages). */
export function splitPages(text) {
  const pages = String(text ?? '').split('\f');
  if (pages.length && !pages.at(-1).trim()) pages.pop();
  return pages;
}

const TEXT_LIMIT = 600_000; // characters; longer texts stay out of the page

function textHtml(pages) {
  const total = pages.reduce((n, p) => n + p.length, 0);
  if (!pages.some((p) => p.trim()) || total > TEXT_LIMIT) return '';
  const body = pages
    .map((p, i) => {
      const paras = p.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
      return paras.length ? `<h3 id="text-p${i + 1}">Page ${i + 1}</h3>${paras.map((x) => `<p>${esc(x)}</p>`).join('')}` : '';
    })
    .join('');
  return `<details class="res-text"><summary>Text of this PDF</summary>${body}</details>`;
}

/**
 * One hosted PDF of an entry: the entry's notes on top (with this PDF's page notes and citation),
 * the list of parts when there's more than one, then the PDF.
 */
export function resourcePage({ e, p = hosted(e)[0], course, known, text, repo, faculty, builtAt, version }) {
  const code = e.codes[0];
  const multi = e.parts.length > 1;
  const pdfs = hosted(e);
  const at = pdfs.indexOf(p);
  const prev = pdfs[at - 1];
  const next = pdfs[at + 1];
  const pn = Object.entries(p.page_notes ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const links = [
    `<a href="${esc(fileHref(p))}" download="${esc(downloadName(e, p))}">Download ${multi ? 'this PDF' : 'PDF'}</a>`,
    p.url && `<a href="${esc(p.url)}">Original on ${esc(host(p.url))}</a>`,
    `<a href="${esc(correctUrl(e, p, repo))}">Suggest a note or correction</a>`,
    `<a href="${esc(removeUrl(e, repo))}">Remove this</a>`,
  ].filter(Boolean);
  const also = e.codes.slice(1);
  const partNo = (x) => (x.file ? `${pdfs.indexOf(x) + 1}` : '');
  // The set's parts, between the notes and the PDF. A long list starts folded so the PDF stays near the
  // top on a phone; Previous and Next by the PDF's title move through it either way.
  const partsHtml = multi
    ? `<details class="res-set"${e.parts.length <= OPEN_PARTS ? ' open' : ''}><summary><h2>In this set</h2> <span class="t">${esc(metaBits({ ...e, term: null, by: null }).join(' · '))}</span></summary><ol class="set-list">${e.parts.map((x) => `<li${x.file ? '' : ' class="link"'}>${x.file ? `<span class="pn">${partNo(x)}</span>` : '<span class="pn" aria-hidden="true">↗</span>'}${partLink(e, x, { current: p })}${x.pages ? ` <span class="t">${x.pages} pp.</span>` : ''}</li>`).join('')}</ol></details>`
    : '';
  const partHead = multi
    ? `<div class="part-head"><h2>${pdfs.length > 1 ? `<span class="pn">${at + 1}</span> ` : ''}${esc(p.title)}</h2><p class="part-nav">${prev ? `<a href="${esc(partPath(e, prev))}" rel="prev">← Previous</a>` : ''}${next ? `<a href="${esc(partPath(e, next))}" rel="next">Next →</a>` : ''}</p></div>`
    : '';
  const body = `<article class="res-page">
<header class="res-head">
  <p class="crumb"><a class="cc" href="/${slug(code)}/">${esc(fmtCode(code))}</a>${course ? ` <span class="t">${esc(course.title)}</span>` : ''}${also.length ? ` <span class="t">· also ${also.map((c) => linkCodes(fmtCode(c), known)).join(', ')}</span>` : ''}</p>
  <h1>${esc(e.title)}</h1>
  <p class="res-meta">${[KINDS[e.kind], ...metaBits(e)].map(esc).join(' · ')}</p>
</header>
<section class="res-notes" aria-label="Notes">
  ${e.note ? noteHtml(e.note, known) : ''}
  ${pn.length ? `<h2>Page notes${multi ? ` <span class="t">for ${esc(p.title)}</span>` : ''}</h2><ul class="pnotes">${pn.map(([k, t]) => `<li><a href="#page=${k}" data-page="${k}">p. ${k}</a> <span>${inlineHtml(t, known)}</span></li>`).join('')}</ul>` : ''}
  <p class="cite"><span class="cite-label">Cite</span> <span id="cite">${esc(citation(e, p))}</span> <button type="button" class="copy" data-copy="cite">Copy</button></p>
  <p class="t">${esc(e.permission)}</p>
  <p class="entry-links">${links.join('')}</p>
</section>
${partsHtml}
${partHead}
<section class="viewer" id="viewer" aria-label="PDF" data-src="${esc(fileHref(p))}" data-pdfjs="${PDFJS}"${p.pages ? ` data-pages="${p.pages}"` : ''}>
  <div class="vbar">
    <span class="vpage-no" id="vpage-no" aria-live="polite">${p.pages ? count(p.pages, 'page') : ''}</span>
    <span class="vzoom"><button type="button" data-zoom="-1" aria-label="Zoom out">−</button><button type="button" data-zoom="0">Fit</button><button type="button" data-zoom="1" aria-label="Zoom in">+</button></span>
  </div>
  <div class="vpages" id="vpages"><p class="vmsg">Loading the PDF… <a href="${esc(fileHref(p))}">Open it directly</a> if it doesn’t appear.</p></div>
</section>
${textHtml(splitPages(text))}
</article>
<script type="module" src="/viewer.js?v=${version}"></script>`;
  const name = multi ? `${p.title}, ${e.title}` : e.title;
  return shell({
    title: `${name}, ${fmtCode(code)} | uwloo`,
    description: `${[KINDS[e.kind], ...metaBits(e)].join(', ')}. ${fmtCode(code)}${course ? ` ${course.title}` : ''} at the University of Waterloo.`,
    path: partPath(e, p),
    body,
    faculty,
    builtAt,
    version,
  });
}

/** Every page an entry needs: [path, part] for each hosted PDF, plus /{n}/ of the first, which redirects. */
export function entryPages(e) {
  const pdfs = hosted(e);
  return pdfs.map((p) => [partPath(e, p), p]).concat(pdfs.length && e.parts.length > 1 ? [[`${pagePath(e)}${pdfs[0].n}/`, null]] : []);
}

// ---------------- files (GitHub release assets) ----------------

const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

/**
 * Makes sure every catalogued file is in `cacheDir`, downloading from the repo's "files" release
 * (and "files-2"…, since a release holds at most 1000 assets). Returns the set of file names on hand.
 * A file that can't be fetched or doesn't match its name is left out; its part is hidden.
 */
export async function syncFiles(entries, { repo, token, cacheDir = '.cache/files', api = process.env.GITHUB_API_URL ?? 'https://api.github.com', log = console } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const wanted = new Set(entries.flatMap((e) => (e.parts ?? [e]).map((p) => p.file).filter(Boolean)));
  const have = new Set();
  for (const name of await readdir(cacheDir)) if (wanted.has(name)) have.add(name);
  const missing = [...wanted].filter((n) => !have.has(n));
  if (!missing.length) return have;

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'uwloo-build', ...(token && { authorization: `Bearer ${token}` }) };
  const assets = new Map();
  try {
    for (let page = 1; page < 20; page++) {
      const res = await fetch(`${api}/repos/${repo}/releases?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      for (const r of list) if (r.tag_name === RELEASE_TAG || r.tag_name.startsWith(`${RELEASE_TAG}-`)) for (const a of r.assets) assets.set(a.name, a);
      if (list.length < 100) break;
    }
  } catch (err) {
    log.warn(`! Couldn't list the "${RELEASE_TAG}" release (${err.message}); ${missing.length} hosted PDF(s) hidden this build`);
    return have;
  }
  for (const name of missing) {
    const a = assets.get(name);
    if (!a) continue;
    try {
      const res = await fetch(a.url, { headers: { ...headers, accept: 'application/octet-stream' }, signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (`${sha12(buf)}.pdf` !== name) throw new Error('contents don’t match the file’s id');
      await writeFile(join(cacheDir, `${name}.part`), buf);
      await rename(join(cacheDir, `${name}.part`), join(cacheDir, name));
      have.add(name);
    } catch (err) {
      log.warn(`! ${name}: ${err.message}`);
    }
  }
  const gone = missing.filter((n) => !have.has(n));
  if (gone.length) log.warn(`! Not in the "${RELEASE_TAG}" release yet, so hidden: ${gone.join(', ')}`);
  return have;
}

/** Copies the files on hand into dist/files/. */
export async function publishFiles(names, { cacheDir = '.cache/files', out = 'dist/files' } = {}) {
  await rm(out, { recursive: true, force: true });
  if (!names.size) return 0;
  await mkdir(out, { recursive: true });
  let bytes = 0;
  for (const n of names) {
    await copyFile(join(cacheDir, n), join(out, n));
    bytes += (await stat(join(out, n))).size;
  }
  return bytes;
}
