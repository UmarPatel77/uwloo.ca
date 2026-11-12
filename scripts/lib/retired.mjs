// Pages for courses that are no longer offered: uwloo.ca/msci452. They come from three places:
//   Open Data history (scripts/lib/history.mjs)  the catalog as far back as Open Data goes: title, description,
//                                                requirements as last listed, and every term it ran
//   older Graduate Calendars (data/grad-archive) Fall 2006 to Winter 2024 (scripts/lib/gradarchive.mjs)
//   the scanned calendars (data/archive-text)    1963–64 to 1994–95, for courses older than that
// A course in any calendar uwloo has (2024–25 on) has a regular page instead.
import { shell } from './render.mjs';
import { ugArchiveUrl } from '../../site/route.js';
import { codesIn, esc, fmtCode, linkCodes, slug, treeCodes } from './requisites.mjs';
import { FACULTY, FACULTY_NAMES } from './opendata.mjs';
import { parseTerm, shiftTerm, termName, termShort, yearLabel } from './terms.mjs';

const OLD_FIRST = '1069'; // Fall 2006, the oldest archived Graduate Calendar (scripts/lib/gradarchive.mjs)
const OLD_LAST = '1241';

const ARCHIVES = 'https://uwaterloo.ca/academic-calendar/archives';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The academic year a term belongs to: Fall 2015, Winter 2016 and Spring 2016 are all 2015–16. */
export function academicYearOf(term) {
  const t = parseTerm(term);
  return t ? (t.month === 9 ? t.year : t.year - 1) : null;
}

/** For each scanned-calendar course: the years it's in (with that year's entry), and its newest entry. */
export function archiveAppearances(archiveText) {
  const out = new Map();
  for (const doc of archiveText.values()) {
    for (const s of doc.subjects) {
      for (const c of s.courses) {
        if (!c.id) continue;
        const a = out.get(c.id) ?? { years: [], latest: null };
        if (!a.years.some((y) => y.year === doc.year))
          a.years.push({
            year: doc.year,
            label: doc.label,
            start: doc.start,
            href: `/${doc.year}/${s.slug}/#${c.id}`,
            pdf: doc.pdf && c.page ? `${doc.pdf}#page=${c.page}` : null,
            page: c.page ?? null,
            title: c.title ?? '',
            spec: c.spec ?? '',
            paras: c.paras ?? [],
            listed: c.listed ?? null,
          });
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

// ---------------- the scanned calendars, version by version ----------------

const REQ = /^\s*(prereq|coreq|antireq|pre-?requisite|co-?requisite|anti-?requisite|also offered|cross-?listed|note)/i;
const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'are', 'will', 'this', 'that', 'its', 'which']);
const words = (s) => new Set(String(s ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}
// Two years' entries are the same version when most of their words match. OCR misreads ("conceming",
// "worid's") cost a word or two and a rewritten sentence far more. One entry may also hold all of the other
// plus text the OCR ran on into, or be cut short, so mostly containing the other counts too.
const SAME = 0.6;
const WITHIN = 0.8;
function alike(a, b) {
  if (overlap(a, b) >= SAME) return true;
  const small = Math.min(a.size, b.size);
  if (small < 8) return false;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / small >= WITHIN;
}
const describe = (y) => (y.listed ? [] : y.paras.filter((p) => !REQ.test(p)));
const textOf = (y) => words(`${y.title} ${describe(y).join(' ')}`);
const told = (y) => words(describe(y).join(' ')).size >= 6;

/**
 * The year whose text is closest to all the others' (the newest, on a tie), so one bad scan doesn't stand
 * for the rest. A year with the usual title gets a nudge: a title the OCR cut short ("…and Natural" with
 * "Resources" starting the description) is the commonest misread.
 */
function typical(ys) {
  const pool = ys.some(told) ? ys.filter(told) : ys;
  const sets = pool.map(textOf);
  const counts = new Map();
  for (const y of pool) counts.set(y.title, (counts.get(y.title) ?? 0) + 1);
  const usual = [...counts].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)[0][0];
  let best = pool.length - 1;
  let top = -1;
  sets.forEach((a, i) => {
    const slips = (describe(pool[i]).join(' ').match(/\b[a-z]{3,}[.?!]\s+[a-z]/g) ?? []).length; // "time. issues"
    const score = sets.reduce((t, b, j) => t + (i === j ? 0 : overlap(a, b)), (pool[i].title === usual ? 0.5 : 0) - 0.5 * slips);
    if (score > top + 1e-9 || (Math.abs(score - top) < 1e-9 && i > best)) [top, best] = [score, i];
  });
  return pool[best];
}

/**
 * The scanned years grouped into versions, oldest first: consecutive years whose text matches apart from OCR
 * noise, shown with their most typical year's text. Years listed without a description join the version
 * around them unless their title says it's another course. A single year between two matching versions is
 * a misread (garbled, or another course's text under this number) and joins them.
 */
export function scanVersions(years) {
  const groups = [];
  for (const y of years) {
    const w = textOf(y);
    const g = groups.at(-1);
    const same = g && (told(y) && g.text ? alike(w, g.text) : overlap(words(y.title), g.title) >= 0.5 || (!told(y) && !y.title));
    if (same) {
      g.years.push(y);
      if (told(y)) g.text = w;
    } else groups.push({ years: [y], text: told(y) ? w : null, title: words(y.title) });
  }
  for (let i = 1; i < groups.length - 1; i++) {
    if (groups[i].years.length === 1 && alike(textOf(typical(groups[i - 1].years)), textOf(typical(groups[i + 1].years)))) {
      groups.splice(i - 1, 3, { years: [...groups[i - 1].years, ...groups[i].years, ...groups[i + 1].years] });
      i = 0;
    }
  }
  return groups.map(({ years: ys }) => {
    const rep = typical(ys);
    return { years: ys, rep, desc: describe(rep), reqs: rep.listed ? [] : rep.paras.filter((p) => REQ.test(p)) };
  });
}

const TERMS = { F: 'Fall', W: 'Winter', S: 'Spring' };
const HOURS = { C: 'class', L: 'lab', T: 'tutorial', S: 'seminar' };
/** "W 3C,1T 0.5" → {terms: ['Winter'], hours: '3 class, 1 tutorial', weight: '0.5'}; null if any part is unclear. */
export function readSpec(spec) {
  const toks = String(spec ?? '').trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const out = {};
  let i = 0;
  if (/^[FWS](,[FWS])*$/.test(toks[i])) out.terms = toks[i++].split(',').map((t) => TERMS[t]);
  if (i < toks.length && /^\d+[CLTS](,\d+[CLTS])*$/i.test(toks[i]))
    out.hours = toks[i++]
      .split(',')
      .map((h) => `${Number.parseInt(h, 10)} ${HOURS[h.slice(-1).toUpperCase()]}`)
      .join(', ');
  if (i < toks.length && /^\d\.\d\d?$/.test(toks[i])) out.weight = toks[i++];
  return i === toks.length && (out.terms || out.hours || out.weight) ? out : null;
}

const range = (ys) => (ys.length === 1 ? ys[0].label : `${ys[0].label} to ${ys.at(-1).label}`);

function yearChip(y) {
  const gone = y.listed ? (/not\s+offered/i.test(y.listed) ? 'listed as not offered' : 'listed without a description') : '';
  return `<li><a href="${esc(y.href)}"${gone ? ` title="${esc(gone)}"` : ''}>${esc(y.label)}</a>${gone ? '<sup aria-hidden="true">*</sup>' : ''}${
    y.pdf ? ` <a class="pdf" href="${esc(y.pdf)}" title="The scanned ${esc(y.label)} calendar, page ${y.page}">PDF p.&nbsp;${y.page}</a>` : ''
  }</li>`;
}

/** "In the scanned calendars": each version's text, newest first, with every year's page and scan. */
function scansHtml(arch, known) {
  const versions = scanVersions(arch.years);
  const now = words(versions.at(-1).rep.title);
  const blocks = versions
    .map((v, i) => {
      const prev = versions[i - 1];
      const gapFrom = prev ? prev.years.at(-1).start + 1 : null;
      const gapTo = v.years[0].start - 1;
      const gap = prev && gapTo >= gapFrom ? `<p class="t scan-gap">Not in the ${esc(gapFrom === gapTo ? yearLabel(gapFrom) : `${yearLabel(gapFrom)} to ${yearLabel(gapTo)}`)} calendar${gapFrom === gapTo ? '' : 's'}.</p>` : '';
      const other = i < versions.length - 1 && now.size > 0 && words(v.rep.title).size > 0 && overlap(words(v.rep.title), now) < 0.3;
      const spec = readSpec(v.rep.spec);
      const bits = spec ? [spec.terms && `Offered ${spec.terms.join(', ')}`, spec.hours && `${spec.hours} hours a week`, spec.weight && `${spec.weight} credit`].filter(Boolean) : [];
      const starred = v.years.some((y) => y.listed);
      return `<section class="scan-ver">
  <h3>${esc(range(v.years))} <span class="t">${plural(v.years.length, 'calendar')}</span></h3>
  ${other ? `<p class="t"><b>Another title:</b> ${esc(v.rep.title)}, probably a different course under the same number (or a misread scan).</p>` : v.rep.title && overlap(words(v.rep.title), now) < 0.99 ? `<p class="t">Titled ${esc(v.rep.title)}.</p>` : ''}
  ${v.desc.map((p) => `<p>${linkCodes(p, known)}</p>`).join('')}
  ${v.reqs.map((p) => `<p class="t">${linkCodes(p, known)}</p>`).join('')}
  ${bits.length ? `<p class="t">${esc(bits.join(' · '))}</p>` : ''}
  <ul class="versions scan-years">${v.years.map(yearChip).join('')}</ul>
  ${starred ? '<p class="t"><small>* Listed that year without a description, or as not offered.</small></p>' : ''}
</section>${gap}`;
    })
    .reverse()
    .join('');
  return `<section aria-labelledby="scan-h"><details class="rd-fold" data-fold="scans" open><summary><h2 id="scan-h">In the scanned calendars</h2></summary>
  <p class="t">How it read in each calendar from ${esc(arch.years[0].label)} to ${esc(arch.years.at(-1).label)}, newest first. The text is OCR of the scanned pages; years whose wording matches are shown once, from the clearest scan. Each year links to its page on uwloo and to that page of the scanned PDF.</p>
  ${blocks}
</details></section>`;
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
/** `hosted(start, code)`: uwloo's page for the course in an older undergrad year it hosts (/2324/cs/#CS135), or null. */
export function retiredPage({ r, known, mentions, reddit, floor, faculty: fac, oldHave = new Set(), hosted = () => null, builtAt, version }) {
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
    const vs = scanVersions(arch.years);
    const now = words(vs.at(-1).rep.title);
    // From the oldest version with this title; anything before under another title was likely another course.
    const k = Math.max(0, vs.findIndex((v) => overlap(words(v.rep.title), now) >= 0.3)); // no title read: from the start
    const before = vs.slice(0, k);
    const other = before.length ? ` (before that, ${range(before.flatMap((v) => v.years))} used the number for ${before.map((v) => v.rep.title).filter((t, i, a) => t && a.indexOf(t) === i).join(' and ') || 'another course'})` : '';
    note = `No longer offered. It’s in Waterloo’s scanned calendars from ${vs[k].years[0].label} to ${arch.years.at(-1).label}${other}; the 1995–96 to 2023–24 calendars are on ucalendar.`;
  }

  // A course only the scans have: its newest version stands in for the calendar entry.
  const scanOnly = !od && !ga && arch;
  const newest = scanOnly ? scanVersions(arch.years).at(-1) : null;
  const spec = newest ? readSpec(newest.rep.spec) : null;
  const lastListed = od?.detail ? termName(od.detail) : gaLast?.label ?? arch?.years.at(-1).label;
  const facts = [
    grad && ['Level', 'Graduate'],
    faculty && ['Faculty', FACULTY_NAMES[faculty]],
    spec?.terms && ['Offered', esc(spec.terms.join(', '))],
    spec?.weight && ['Credit', esc(spec.weight)],
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
    const here = !grad && hosted(year, code);
    if (here) out.push([here, `Undergraduate Calendar, ${yearLabel(year)}`, 'Its last calendar entry, on uwloo']);
    else if (!grad && year >= 1995 && year <= 2023) out.push([ugArchiveUrl(year, S, code), `Undergraduate Calendar, ${yearLabel(year)}`, 'Its last calendar entry, on ucalendar']);
    if (grad) out.push([ARCHIVES, 'Graduate Calendar archives', 'Past Graduate Calendars']);
  } else if (ga) {
    out.push([ARCHIVES, 'Graduate Calendar archives', 'Past Graduate Calendars']);
  } else if (arch.years.at(-1).year === '9495') {
    out.push([ugArchiveUrl(1995, S, code), 'Undergraduate Calendar, 1995–96', 'If it ran past 1994–95, on ucalendar']);
  }
  // Gone before the 1994–95 calendar: too old for outlines (2010s on), UW Flow or WClasses (2004 on).
  const gone = scanOnly && arch.years.at(-1).year !== '9495';
  if (!gone) {
    out.push([`https://outline.uwaterloo.ca/viewer/?q=${S.toLowerCase()}%2520${N.toLowerCase()}`, 'Course outlines', 'Syllabi from past terms (UW login)']);
    out.push([`https://uwflow.com/course/${slug(code)}`, 'UW Flow', 'Student ratings and reviews']);
    out.push([`https://wclasses.vercel.app/course?subjectCode=${encodeURIComponent(S.toLowerCase())}&catalogNumber=${encodeURIComponent(N)}`, 'WClasses', 'Past sections back to 2004, and who taught them']);
  }

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

  const archHtml = arch ? scansHtml(arch, known) : '';
  const last = arch?.years.at(-1);
  const scanDesc = newest?.desc.length
    ? `<p class="desc">${newest.desc.map((p) => linkCodes(p, known)).join(' ')}</p>
<p class="t scan-src">As printed in the ${esc(range(newest.years))} calendar${newest.years.length > 1 ? 's' : ''}, read by OCR${newest.rep.pdf ? `; <a href="${esc(newest.rep.pdf)}">the scanned page</a> is the original` : ''}.${last.year === '9495' ? ' Later calendars (1995–96 on) aren’t on uwloo.' : ''}</p>
${newest.reqs.length ? `<section aria-labelledby="req-h"><h2 id="req-h">Requirements, as last listed</h2>${newest.reqs.map((p) => `<p>${linkCodes(p, known)}</p>`).join('')}</section>` : ''}`
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
${scanOnly ? scanDesc || `<p class="desc t">The scanned calendars list it without a description; see each year below.</p>` : ''}
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
