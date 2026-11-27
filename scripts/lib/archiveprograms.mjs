// The 2021–22 to 2023–24 Undergraduate Calendars' program pages (academic-calendar-archive.uwaterloo.ca, read by
// scripts/fetch-archive-programs.mjs into data/archive-programs/), as plans for Pathways' older start years.
//
// A page is a title and nested lists, the same across faculties:
//   • One of            • All of             • Three additional courses chosen from    • 5.0 units distributed as follows:
//     • MATH 237 …        • AFM 101 …          • CO 342 …                                • 1.0 BIOL elective unit, 400-level
// and lines with their own words: "ECON 101, ECON 102, ECON 201", "one of ECON 206, ECON 207", "four additional ECON
// courses at the 200-level or above", "GERON 201/HLTH 201". Each becomes engine.js's nodes: rules ({r, n, c}),
// groups ({g, n, i}) and words ({t, u, nc, subj, rg, min…}, scripts/lib/pathways.mjs's hints). Headings are
// sections; notes, admissions and suggested sequences are left out. A page of specializations ("Specializations
// in Economics", or a major's page with its specializations below it) becomes one plan each.
//
// Plans keep the slugs of the same plans in later calendars ("Honours Economics" is h-economics, "Economics (Bachelor
// of Arts - Honours)" there), so someone's plans carry over when they change their start year.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { averages, degreeProse, facultyKey, hints, termLoad, totalUnits } from './pathways.mjs';
import { find, findAll, norm, parseHtml, textOf } from './requisites.mjs';

export const ARCHIVE_DIR = 'data/archive-programs';

/** The fetched pages, a year a file: [{year: 2021, label: '2021–22', pages: [{url, html}]}], oldest first. */
export async function loadArchivePrograms(dir = ARCHIVE_DIR) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d{4}-\d{4}\.json\.gz$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    const { pages } = JSON.parse(gunzipSync(await readFile(join(dir, f))).toString('utf8'));
    const year = Number(f.slice(0, 4));
    out.push({ year, label: `${year}–${String(year + 1).slice(2)}`, pages });
  }
  return out;
}

/** A page's own part: from its first heading to the Registrar's address at the foot, without scripts. */
export function mainPart(html) {
  const clean = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '');
  const start = clean.search(/<h1\b/i);
  const end = clean.search(/Office of the Registrar\s*(<[^>]+>\s*)*University of Waterloo/i);
  return clean.slice(start >= 0 ? start : 0, end > start ? end : undefined).replace(/\s+/g, ' ').trim();
}

const FACULTIES = { ARTS: 'Faculty of Arts', MATH: 'Faculty of Mathematics', SCI: 'Faculty of Science', ENV: 'Faculty of Environment', ENG: 'Faculty of Engineering', HEA: 'Faculty of Health', SOCIAL: 'Faculty of Arts' };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUMBER = `(\\d+|${Object.keys(NUM).join('|')})`;
const num = (x) => NUM[String(x).toLowerCase()] ?? Number(x);
// Headings whose lists aren't requirements: notes, admissions, suggested sequences, combinations with other plans.
const SKIP_HEAD = /^notes?\b|further information|admissions?|recommended|suggested|course sequences?$|system of study|honours double majors|arts and business|breadth and depth notes|^co-op|co-operative|^contact|^advisors?\b|^overview$|^about\b/i;
// Pages that aren't plans.
const NOT_PLAN = /regulations|overlaps|antirequisites|courses, enrolment|enrolment and grades|^co-operative (system|education)|system of study|^overview of|admission|examinations and (promotion|standings)|^academic plans?$|^list of|^table of|course descriptions|communication requirement|co-op requirements|complementary studies|foundation term|plans with|programs with|^arts and business|applying for|^about /i;

/** The parts of a page: its title and headings, and its content. */
export function readArchivePage(html) {
  const root = parseHtml(html);
  const byId = (id) => find(root, (n) => n.attrs?.id === `ctl00_contentMain_${id}`);
  const content = byId('lblContent');
  return {
    title: norm(textOf(byId('lblPageTitle') ?? { children: [] })),
    group: norm(textOf(byId('lblTopTitle') ?? { children: [] })),
    section: norm(textOf(byId('lblBottomTitle') ?? { children: [] })),
    content: content ? asLists(content) : null,
  };
}

/** A blockquote's lines (split at <br>, or its paragraphs) as a list; a blockquote inside is the list under the line
 *  before it. */
function quoteList(q) {
  const items = [];
  let cur = [];
  const flush = () => {
    if (norm(cur.map(textOf).join(''))) items.push({ tag: 'li', attrs: {}, children: cur });
    cur = [];
  };
  for (const c of q.children) {
    if (c.tag === 'br') flush();
    else if (c.tag === 'p' || c.tag === 'div') {
      flush();
      cur = [...c.children];
      flush();
    } else if (c.tag === 'blockquote') {
      flush();
      const sub = quoteList(c);
      if (items.length) items.at(-1).children.push(sub);
      else items.push({ tag: 'li', attrs: {}, children: [sub] });
    } else cur.push(c);
  }
  flush();
  return { tag: 'ul', attrs: {}, children: items };
}
/**
 * The 2021–22 calendar's Mathematics pages put lists in blockquotes, under a paragraph ("<p>One of</p>
 * <blockquote>CS 115 …<br/>CS 135 …</blockquote>"): those as the lists the other pages have, the paragraph as the
 * item the list is under.
 */
function asLists(n) {
  if (!n.children) return n;
  const out = [];
  for (const c of n.children) {
    if (c.tag !== 'blockquote') {
      out.push(asLists(c));
      continue;
    }
    const ul = quoteList(c);
    let k = out.length - 1;
    while (k >= 0 && !out[k].tag && !norm(out[k].text ?? '')) k--;
    const prev = out[k];
    if (prev?.tag === 'p' && norm(textOf(prev)).length < 200) out.splice(k, out.length - k, { tag: 'ul', attrs: {}, children: [{ tag: 'li', attrs: {}, children: [...prev.children, ul] }] });
    else out.push(ul);
  }
  n.children = out;
  return n;
}

// ---------------- course codes in a line ----------------

/**
 * The courses a line names, as items of alternatives: "ECON 101, ECON 102" → [[ECON101], [ECON102]];
 * "HLTH 407/KIN 407" (cross-listed: one course) → [[HLTH407, KIN407]]; "CO 342, 351, 353" → the subject carries on;
 * "PHYS 111 and PHYS 111L" → two items. Ranges ("CS 340-CS 398", "CO 450 to CO 471") come back apart.
 */
export function codesIn(text) {
  const t = String(text).replace(/–|—/g, '-');
  const ranges = [];
  const rangeRe = /\b([A-Z]{2,8}) ?(\d{3})\s*(?:-|to)\s*(?:\1 ?)?(\d{3})\b/g;
  for (const m of t.matchAll(rangeRe)) ranges.push([m[1], Number(m[2]), Number(m[3])]);
  const plain = t.replace(rangeRe, ' ');
  const items = [];
  let subject = null;
  // A code, a bare number after a code ("CO 342, 351"), and slashes between cross-listed codes.
  const re = /\b([A-Z]{2,8}) ?(\d{3}[A-Z]{0,2})\b(?!\s*-)|(?<=[,\s])(\d{3}[A-Z]?)\b(?!\s*(?:-|units?|courses?|level|%))/g;
  let last = -1;
  for (const m of plain.matchAll(re)) {
    let code;
    if (m[1]) {
      subject = m[1];
      code = `${m[1]}${m[2]}`;
    } else if (subject && last >= 0 && /^[\s,]*(?:and|or|\/)?[\s,]*$/.test(plain.slice(last, m.index))) code = `${subject}${m[3]}`;
    else continue;
    const between = last >= 0 ? plain.slice(last, m.index) : '';
    if (items.length && /^\s*\/\s*$/.test(between)) items.at(-1).push(code);
    else items.push([code]);
    last = m.index + m[0].length;
  }
  return { items, ranges };
}

// ---------------- a line in words ----------------

const SUBJ_LIST = /\bfrom:?\s*(?:[a-z ]+? plus )?((?:[A-Z]{2,8}\s*(?:,|and|or|\s)\s*)+[A-Z]{2,8})\b/;
/**
 * A line without courses → a words rule: "five additional ECON courses at the 200-level or above", "1.0 BIOL
 * elective unit, 400-level", "2.0 Science elective units from: BIOL, CHEM, EARTH", "6.0 elective units chosen from
 * any subject", "Three Technical Electives", "One CSE". Lines that ask for nothing are info.
 */
export function wordsRule(text) {
  const t = norm(text).replace(/\s*\(see Note[^)]*\)/gi, '').replace(/\s+([,.;:])/g, '$1').replace(/,?\s*\bor[.:]?$/i, '');
  const own = (h) => ({ ...h, t });
  let m;
  // "1.5 units with the same subject forming a prerequisite chain of length three": not something the grid can
  // count, so a line to tick by hand.
  if (/\bsame subject\b|\bprerequisite chain\b/i.test(t)) return { t };
  // "1.0 BIOL elective unit, 400-level", "0.5 ENGL unit: …" (with no courses left in it)
  if ((m = /^(\d+(?:\.\d+)?) ([A-Z]{2,8}) (?:elective )?units?\b(?:,? (\d)00-level(?: or (?:higher|above))?)?/.exec(t))) return { t, u: Number(m[1]), subj: [m[2]], ...(m[3] ? { min: Number(m[3]) } : {}) };
  // "6.0 elective units chosen from any subject", "Free elective courses: 6.5 units", "Electives totaling 0.5 unit"
  if ((m = /^(\d+(?:\.\d+)?) (?:free )?(?:elective )?units? chosen from any subject|^(?:free )?electives?(?: courses)?(?: totaling|:)\s*(\d+(?:\.\d+)?) units?/i.exec(t))) return { t, u: Number(m[1] ?? m[2]), any: 1 };
  // "8.0 units: Elective"
  if ((m = /^(\d+(?:\.\d+)?) units?:?\s*(?:free )?electives?$/i.exec(t))) return { t, u: Number(m[1]), any: 1 };
  // "Recreation elective courses (minimum of 6.5 units): Any additional REC courses"
  if ((m = /\((?:minimum of )?(\d+(?:\.\d+)?) units?\):?\s*any (?:additional )?([A-Z]{2,8}) courses?\b/i.exec(t))) return { t, u: Number(m[1]), subj: [m[2]] };
  // "A fine or performing arts course: FINE, MUSIC, THPERF": one course of those subjects.
  if ((m = /^(?:[Aa]n?|[Oo]ne) [^:]*?\bcourse\b[^:]*:\s*((?:[A-Z]{2,8}(?:,\s*|\s+|$))+)$/.exec(t))) return { t, nc: 1, subj: m[1].split(/[^A-Z]+/).filter((x) => x.length >= 2) };
  // "four 300-level HIST courses"
  if ((m = new RegExp(`^${NUMBER} (?:additional |other |more )?(\\d)00-level ([A-Z]{2,8}) courses?$`, 'i').exec(t)) && /^[A-Z]+$/.test(m[3])) return { t, nc: num(m[1]), subj: [m[3]], min: Number(m[2]) };
  // "one additional FR literature and culture course at the 300-level or above"
  if ((m = new RegExp(`^${NUMBER} (?:additional |other |more )?([A-Z]{2,8}) (?:[A-Za-z]+ ){0,4}?courses?(?: at the (\\d)00-level(?: or (?:above|higher))?)?$`, 'i').exec(t)) && /^[A-Z]+$/.test(m[2])) return { t, nc: num(m[1]), subj: [m[2]], ...(m[3] ? { min: Number(m[3]) } : {}) };
  // "2.0 Science elective units from: BIOL, CHEM, EARTH, PHYS, SCI", "1.0 unit of humanities from: CHINA, CLAS, …"
  if ((m = /^(\d+(?:\.\d+)?) (?:[A-Za-z ]+? )?units?\b/.exec(t)) && SUBJ_LIST.test(t)) {
    const subj = SUBJ_LIST.exec(t)[1].split(/[^A-Z]+/).filter((x) => x.length >= 2);
    const lv = /\b(\d)00-level or (?:higher|above)\b/.exec(t)?.[1];
    return { t, u: Number(m[1]), subj, ...(lv ? { min: Number(lv) } : {}) };
  }
  // "Three Technical Electives", "One CSE", "Two additional math courses", "five additional ECON courses at …"
  const lead = new RegExp(`^(?:at least |a minimum of )?${NUMBER}\\b`, 'i').exec(t);
  if (lead && /\b(courses?|electives?|units?|CSEs?|TEs?)\b/i.test(t)) {
    const h = hints(`Complete ${t.replace(/\bCSEs?\b/, 'complementary studies electives').replace(/\bTEs?\b/, 'technical electives')}`);
    if (h.u || h.nc) return own(h);
  }
  const h = hints(/^(complete|successful completion)/i.test(t) ? t.replace(/^successful completion of/i, 'Complete') : `Complete ${t}`);
  if (h.u || h.nc) return own(h);
  // "Completion of a total of 160 hours of in-school volunteer experience": asked for, but not in courses.
  return /^(?:successful )?completion of|^complete\b/i.test(t) && !/average/i.test(t) ? { t } : { t, info: 1 };
}

// ---------------- lists ----------------

/** A lead ("One of", "Three additional courses chosen from", "At least 2.0 units from:") → {n} or {all} or null. */
export function leadKind(lead) {
  const l = norm(lead)
    .toLowerCase()
    .replace(/\s*\(see note[^)]*\)/g, '')
    .replace(/^(?:successful )?completion of (?=\d|one|two|three|four|five|six|seven|eight|nine|ten|at least|a minimum)|^complete (?=\d|one|two|three|four|five|six|seven|eight|nine|ten|at least|a minimum)/, '');
  let m;
  if (/^all of\b|^required courses\b|^complete all\b|completion of the following|^the following\b/.test(l)) return { all: 1 };
  // "list of Medieval Studies approved courses:": courses other lines choose from.
  if (!new RegExp(`\\d|\\b${NUMBER}\\b`).test(l) && /^(?:the )?list of\b|\bapproved courses:?$|\bcourse list:?$/.test(l)) return { list: 1 };
  if ((m = new RegExp(`^one (?:course )?(?:in|from) each of (?:the following )?${NUMBER}?`).exec(l))) return { each: 1, n: m[1] ? num(m[1]) : null };
  if ((m = new RegExp(`^(?:at least |a minimum of )?${NUMBER} (?:additional )?(?:of\\b|courses? (?:chosen )?from\\b|courses? \\(\\d+(?:\\.\\d+)? units?\\) from\\b|[a-z]+ courses? (?:chosen )?from\\b|(?:of )?these\\b|of the following\\b|from\\b)`).exec(l))) return { n: num(m[1]) };
  if ((m = /^(?:at least |a minimum of )?(\d+(?:\.\d+)?) (?:[a-z-]+ ){0,2}units?(?: of [a-z ]+?)? (?:from|chosen from)\b/.exec(l))) return { n: Math.max(1, Math.round(Number(m[1]) / 0.5)) };
  // "plus a two-term project from List E: Project", "and two courses from List B": n of the items.
  if ((m = new RegExp(`^(?:plus |and )?(?:at least |a minimum of )?(an?|${NUMBER}) (?:[a-z0-9-]+ ){0,5}?from\\b`).exec(l)) && !/following conditions/.test(l)) return { n: /^an?$/.test(m[1]) ? 1 : num(m[1]) };
  // "Restricted elective courses (4.0 units):": that many of the courses under it (when they're a sum of the rules
  // under it instead, listNodes takes them all).
  if ((m = /\((?:minimum of )?(\d+(?:\.\d+)?) units?\):?$/.exec(l)) && /elective|restricted|courses/.test(l)) return { n: Math.max(1, Math.round(Number(m[1]) / 0.5)), sum: 1 };
  // "four approved language courses (all in one language …):" over lists of courses.
  if ((m = new RegExp(`^${NUMBER} (?:[a-z-]+ ){0,3}courses?\\b(?: \\([^)]*\\))?:?$`).exec(l))) return { n: num(m[1]) };
  if (/^option (one|two|three|\d)\b/.test(l)) return { all: 1 };
  if (/units? distributed as follows|plan-level requirements|requirements:?$|including:?$|^\d+(?:\.\d+)? units?, at least/.test(l)) return { all: 1 };
  // "Students must complete a total of four courses from the following 12 subject categories."
  if ((m = new RegExp(`\\b(?:a total of )?${NUMBER} (?:additional )?courses? (?:chosen )?from the following\\b`).exec(l))) return { n: num(m[1]) };
  return null;
}

const TERM_ITEM = /^(?:Term (\d[AB])\b|(\d[AB]) Term\b)[^:]*:?\s*/i;
const single = (x) => x.r && x.c.length === 1 && (x.r === 'all' || (x.r === 'n' && (x.n ?? 1) === 1));
const alts = (x) => x.r === 'n' && (x.n ?? 1) === 1 && !x.t;

/** One line of a list (no list under it) → nodes. */
export function lineNodes(text) {
  const t = norm(text)
    .replace(/,?\s*\bor[.:]?$/i, '')
    .replace(/^(?:successful )?completion of (?=\d|at least|a minimum)/i, '');
  if (!t) return [];
  // "(0.5 unit) fourth-year seminar course: HLTH 421, HLTH 427, …": that many units of them.
  const share = /^\((\d+(?:\.\d+)?) units?\)\s*[^:]*:\s*/i.exec(t);
  if (share) {
    const c = [...new Set(codesIn(t).items.flat())];
    if (c.length) return [{ r: 'n', n: Math.min(c.length, Math.max(1, Math.round(Number(share[1]) / 0.5))), c }];
  }
  // "PHYS 111 and PHYS 111L, or PHYS 121 and PHYS 121L; PHYS 112 …": each part on its own.
  if (t.includes(';')) return t.split(/;\s*/).flatMap(lineNodes);
  if (/^notes?\b|^note that\b/i.test(t)) return [];
  // "20 academic course units with a minimum cumulative overall average of 60%": the degree's total (the plan's tu).
  const total = /^(?:a minimum of )?(\d+(?:\.\d+)?) (?:academic )?(?:course )?units\b[^.]*?\bwith a minimum cumulative (?:overall )?average\b/i.exec(t);
  if (total) return [{ tu: Number(total[1]) }];
  // "A fine or performing arts course: FINE, MUSIC, THPERF"
  if (/^(?:[Aa]n?|[Oo]ne) [^:]*?\bcourse\b[^:]*:\s*(?:[A-Z]{2,8}(?:,\s*|\s+|$))+$/.test(t)) return [wordsRule(t)];
  // "Criticism: ENGL 251", "Literatures Romantic to Modern: two of ENGL 313, …": a label, then the rule.
  const label = /^([A-Z][A-Za-z ,'’&()-]{0,80}?):\s*(?=\S)/.exec(t);
  if (label && !/\d/.test(label[1]) && !/\b(?:from|of|units?|courses?)$/i.test(label[1])) return lineNodes(t.slice(label[0].length));
  // "either a medieval HIST 450 or two of HIST 421 and/or HIST 422": one of the parts.
  if (/^either\b/i.test(t) && /\s+or\s+/.test(t)) {
    const parts = t.replace(/^either\s+/i, '').split(/,?\s+or\s+/).map(lineNodes).filter((x) => x.length);
    if (parts.length >= 2) return [{ g: 'n', n: 1, i: parts.map(asOne) }];
  }
  const { items, ranges } = codesIn(t);
  if (!items.length) {
    if (ranges.length) {
      const w = wordsRule(t);
      return [{ t: w.t, rg: ranges, ...(w.u ? { u: w.u } : { nc: w.nc ?? 1 }), ...(w.min ? { min: w.min } : {}) }];
    }
    const w = wordsRule(t);
    return w.info ? [] : [w];
  }
  // "Four additional courses from CS 200-CS 299, CS 300-CS 398, COMM 432": the ranges and the courses with them are
  // what to choose from (a course as a range of one); "CS 240, CS 241, and three of CS 340-CS 398": the courses
  // before the count are required.
  if (ranges.length) {
    const at = new RegExp(`\\b(?:at least |a minimum of )?(?:${NUMBER}|\\d+\\.\\d+) (?:additional |other |more )?(?:[A-Z]{2,8} )?(?:of|courses?|units?)\\b`, 'i').exec(t);
    const before = at && at.index > 0 ? codesIn(t.slice(0, at.index)).items : [];
    const tail = at ? t.slice(at.index) : t;
    const w = wordsRule(tail);
    const one = codesIn(tail).items.flat().map((c) => /^([A-Z]+)(\d{3})/.exec(c)).filter(Boolean).map((x) => [x[1], Number(x[2]), Number(x[2])]);
    return [...before.map((alt) => (alt.length > 1 ? { r: 'n', n: 1, c: alt } : { r: 'all', c: alt })), { t: w.t, rg: [...ranges, ...one], ...(w.u ? { u: w.u } : { nc: w.nc ?? 1 }), ...(w.min ? { min: w.min } : {}) }];
  }
  const codes = [...new Set(items.flat())];
  let m;
  // "one of ECON 406, ECON 407", "three of …", "four of X, Y, Z, one of A, B": a number before them.
  if ((m = new RegExp(`^(?:at least |a minimum of )?${NUMBER} (?:additional )?(?:of|courses? (?:chosen )?from|[A-Za-z]+ courses? (?:chosen )?from)\\b:?`, 'i').exec(t))) {
    const rest = t.slice(m[0].length);
    // "four of ECON 422, …, ECON 426, one of ECON 421, STAT 331": two rules in one line.
    const more = new RegExp(`,\\s*${NUMBER} (?:additional )?of\\b`, 'i').exec(rest);
    if (more) return [...lineNodes(t.slice(0, m[0].length + more.index)), ...lineNodes(rest.slice(more.index + 1))];
    return [{ r: 'n', n: num(m[1]), c: codes }];
  }
  // "A statistics course (0.5 unit) from: X, Y", "one course in Canadian History from the following: …", "two
  // courses at the 400-level from …"
  if ((m = new RegExp(`^(an?|${NUMBER}) (?:additional |other )?(?:[A-Za-z-]+ ){0,3}?courses?(?: \\([^)]*\\))?(?: (?:in|at|on|of) [^:]+?)? (?:chosen )?from\\b`, 'i').exec(t))) return [{ r: 'n', n: /^an?$/i.test(m[1]) ? 1 : num(m[1]), c: codes }];
  // "2.0 program elective units from: CS 200, HLTH 101…", "1.5 units at the 400-level from HIST 421, …": that many
  // units of them (0.5 a course). ("5.75 BIOL units: BIOL 130, …" without "from" lists what's required.)
  if ((m = /^(?:at least |a minimum of )?(\d+(?:\.\d+)?) (?:[A-Za-z-]+ ){0,3}?units?(?: (?:at|in|of) [^:]+?)? (?:chosen )?from\b/i.exec(t))) return [{ r: 'n', n: Math.min(codes.length, Math.max(1, Math.round(Number(m[1]) / 0.5))), c: codes }];
  // "X and Y, or Z and W": one of these pairs.
  if (/\bor\b/.test(t) && /\band\b/.test(t) && items.length >= 4) {
    const sets = t.split(/,?\s+or\s+/).map((part) => codesIn(part).items.flat()).filter((s) => s.length);
    if (sets.length >= 2 && sets.every((s) => s.length >= 1)) return [{ g: 'n', n: 1, i: sets.map((s) => ({ r: 'all', c: s })) }];
  }
  // "MATH 235 or MATH 245", "CO 250 Introduction to Optimization or CO 255 …": one of them.
  if (/\bor\b/.test(t) && !/\band\b/.test(t.replace(/\b[A-Z][a-z]+ and [A-Z][a-z]+\b/g, ''))) return [{ r: 'n', n: 1, c: codes }];
  // Each course, cross-listed ones as alternatives: "GERON 201/HLTH 201" is one course. Words after them ("…, and
  // one other course taught in French at the 200-level or above") are a rule of their own.
  const each = items.map((alt) => (alt.length > 1 ? { r: 'n', n: 1, c: alt } : { r: 'all', c: alt }));
  const tail = new RegExp(`(?:,|;)?\\s*(?:and|plus)\\s+(${NUMBER}\\s+(?:additional|other|more)\\b[^;]*)$`, 'i').exec(t);
  const w = tail && !codesIn(tail[1]).items.length ? wordsRule(tail[1]) : null;
  return w && !w.info ? [...each, w] : each;
}

/** A list's items and the lists under each. Some pages close an item before its list ("<li>…from the following:</li>
 *  <ul>…</ul>"): a list straight inside a list belongs to the item before it. */
function itemsOf(list) {
  const items = [];
  const stray = [];
  for (const c of list.children ?? []) {
    const isList = c.tag === 'ul' || c.tag === 'ol';
    if (c.tag === 'li') items.push({ li: c, nested: c.children.filter((x) => x.tag === 'ul' || x.tag === 'ol') });
    else if (isList && items.length) items.at(-1).nested.push(c);
    else if (isList) stray.push(c);
  }
  return { items, stray };
}
const ownText = (li) => norm(li.children.filter((c) => !(c.tag === 'ul' || c.tag === 'ol')).map(textOf).join(''));
const isAlternatives = (items) => items.length >= 2 && items.slice(0, -1).every(({ li }) => /\bor[.:]?$/i.test(ownText(li)));
/** One item's nodes as one node: a few required courses together, or all of what it asks. A line of three or more
 *  single courses ("ARABIC 101R, ARABIC 102R, ARABIC 120R") is remembered as a list (LISTY): under "four of the
 *  following" its courses are choices, not a set to take together. */
const LISTY = new WeakSet();
const asOne = (nodes) => {
  if (nodes.length === 1) return nodes[0];
  if (!nodes.every((x) => x.r === 'all')) return { g: 'all', i: nodes };
  const one = { r: 'all', c: [...new Set(nodes.flatMap((x) => x.c))] };
  if (nodes.length >= 3 && nodes.every((x) => x.c.length === 1)) LISTY.add(one);
  return one;
};
// "at least eight academic course units (16 courses) in History, including:": the plan's total in its subject.
const IN_SUBJECT = new RegExp(`^(?:at least |a minimum of )?(\\d+(?:\\.\\d+)?|${Object.keys(NUM).join('|')}) (?:academic )?(?:course )?units?(?: \\(\\d+ courses\\))? in ([A-Z][A-Za-z ,'’&-]+?),? including:?$`, 'i');

/** A list (ul/ol) → nodes. */
export function listNodes(list) {
  const out = [];
  const { items, stray } = itemsOf(list);
  for (const l of stray) out.push(...listNodes(l));
  // "X, or" / "Y": items that are alternatives, one group.
  if (isAlternatives(items)) {
    const each = items.map(({ li, nested }) => listNodes({ children: [li, ...nested] })).filter((x) => x.length);
    if (each.length >= 2) return [...out, { g: 'n', n: 1, i: each.map(asOne) }];
  }
  for (const { li, nested } of items) {
    const own = ownText(li);
    // "Term 1A (Fall):" and its courses: a term of a term-by-term curriculum (pageSections makes it a section).
    const term = TERM_ITEM.exec(own);
    if (term) {
      const kids = [...lineNodes(own.slice(term[0].length)), ...nested.flatMap(listNodes)];
      if (kids.length) out.push({ term: (term[1] ?? term[2]).toUpperCase(), i: kids });
      continue;
    }
    if (!nested.length) {
      out.push(...lineNodes(own));
      continue;
    }
    // "2.0 Science elective units from: BIOL, CHEM…, with the following conditions:": the count is the rule, the
    // conditions under it say which levels.
    if (/following conditions/i.test(own)) {
      const w = wordsRule(own);
      if (!w.info) out.push(w);
      continue;
    }
    // What each item under it asks, one node an item ("CS 136 and CS 136L" stay together).
    const kids = nested
      .flatMap((l) => {
        const sub = itemsOf(l);
        const strays = sub.stray.map((x) => listNodes(x));
        if (isAlternatives(sub.items)) return [listNodes(l)];
        return [...strays, ...sub.items.map(({ li: x, nested: xs }) => listNodes({ children: [{ ...x, children: [...x.children.filter((c) => c.tag !== 'ul' && c.tag !== 'ol'), ...xs] }] }))];
      })
      .filter((x) => x.length)
      .map(asOne);
    if (!kids.length) {
      out.push(...lineNodes(own));
      continue;
    }
    const total = IN_SUBJECT.exec(own);
    if (total) out.push({ tsub: { u: num(total[1]), name: total[2] } });
    let kind = leadKind(own) ?? { all: 1 };
    // A lead's units in brackets that add up the rules under it ("Recreation courses (minimum of 10.5 units):"
    // over required courses and electives): all of them.
    if (kind.sum && !kids.every((k) => single(k) || alts(k) || LISTY.has(k))) kind = { all: 1 };
    if (kind.list) {
      const c = [...codesOf(kids)];
      if (c.length) out.push({ r: 'list', c });
      continue;
    }
    // "one course in each of three fields:": one of each item's courses, from that many items.
    if (kind.each) {
      const fields = kids.map((k) => ({ r: 'n', n: 1, c: [...codesOf([k])] })).filter((k) => k.c.length);
      out.push({ g: 'n', n: Math.min(kind.n ?? fields.length, fields.length), i: fields });
      continue;
    }
    // "4.0 units, at least 2.0 of which are at the 300- or 400-level, from the following list:": the count, in words,
    // from the courses listed. ("5.0 units distributed as follows:" and "plan-level requirements:" only gather.)
    const counted = kind.all && /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(own) && !/distributed|plan-level|including|requirements/i.test(own) ? wordsRule(own) : null;
    // A count that is the rules under it ("six additional courses …:" over six courses) adds nothing.
    const lead = counted && (counted.nc || counted.u) && (counted.nc ?? Math.round((counted.u ?? 0) / 0.5)) !== termLoad(kids) ? [counted] : [];
    // "11 courses chosen from the following:" over lines of courses: all of their courses are the choices.
    const choices = (k) => (single(k) || alts(k) || LISTY.has(k) ? k.c : k.g === 'all' && k.i.every((x) => single(x) || alts(x) || LISTY.has(x) || (!x.r && !x.g)) ? k.i.flatMap((x) => x.c ?? []) : null);
    if (kind.n && kids.length < kind.n && kids.every(choices)) {
      out.push({ r: 'n', n: kind.n, c: [...new Set(kids.flatMap(choices))] });
      continue;
    }
    // Every item a course (or cross-listed course), or for "n of", lines of courses: a rule over them.
    if (kids.every((k) => single(k) || alts(k) || (kind.n && LISTY.has(k)))) {
      const c = [...new Set(kids.flatMap((k) => k.c))];
      if (lead.length) out.push(...lead, { r: 'list', c });
      else if (kind.all && kids.every(single)) out.push({ r: 'all', c });
      else if (kind.all) out.push(...kids);
      else out.push({ r: 'n', n: kind.n, c });
      continue;
    }
    if (kind.all) out.push(...lead, ...kids.flatMap((k) => (k.g === 'all' ? k.i : [k])));
    else out.push({ g: 'n', n: kind.n, i: kids });
  }
  // "0.5 unit … from: pure sciences plus ENVS, ERS": the subjects of the line it names, too.
  for (const w of out) {
    const named = w.t && /from:?\s*([a-z ]+?) plus /i.exec(w.t)?.[1];
    const ref = named && out.find((x) => x !== w && x.subj && x.t?.toLowerCase().includes(`${named.toLowerCase()} from`));
    if (ref) w.subj = [...new Set([...ref.subj, ...(w.subj ?? [])])];
  }
  return out;
}

/** Consecutive single required courses as one "all of" rule, the way the later calendars list them. */
function merge(nodes) {
  const out = [];
  for (const n of nodes) {
    const prev = out.at(-1);
    if (prev && ((n.r === 'all' && prev.r === 'all') || (n.r === 'list' && prev.r === 'list'))) prev.c = [...new Set([...prev.c, ...n.c])];
    // "One technical elective" twice: "2 technical electives".
    else if (prev && !n.r && !n.g && n.nc && prev.nc && !prev.r && !prev.g && (prev.base ?? prev.t) === n.t && /^One /.test(n.t)) {
      prev.base ??= prev.t;
      prev.nc += n.nc;
      prev.t = `${prev.nc} ${n.t.slice(4)}s`;
    } else out.push(n.r ? { ...n, c: [...n.c] } : { ...n });
  }
  for (const n of out) delete n.base;
  return out;
}

// Headings over lists to choose from rather than lists of required courses: "Technical Electives", "List A",
// "Theme areas".
const CHOOSE = /electives?\b|^lists?\b|^list [a-z0-9]{1,3}\b|\bthemes?\b|course lists?$/i;
// Work-term reports and co-op courses are taken on work terms, not in a term's courses.
const WORK = /^(WKRPT|COOP)\d/;
// A paragraph that is a line of requirements: "FR 151, FR 152, FR 192A, FR 192B (see Note 1)."
const REQ_P = /^[A-Z]{2,8} ?\d{3}[A-Z]{0,2}\b/;
// "Three additional CS courses chosen from CS 340-CS 398, CS 440-CS 489."
const REQ_COUNT = new RegExp(`^${NUMBER} (?:additional |other )?(?:[A-Z]{2,8} )?(?:courses?|units?|of)\\b`, 'i');
const PROSE_P = /\b(is|are|was|were|will|must|should|may|can|students?|recommended|encouraged)\b/i;
// A part of a page that is a plan of its own: a major's specializations, each diploma on a page of diplomas.
const SUB_HEAD = /\bspecialization$|^(?:diploma|certificate|specialization|option) in\b|\b(?:diploma|certificate)(?: [IVX]+)?$/i;

const codesOf = (nodes, out = new Set()) => {
  for (const n of nodes ?? []) {
    for (const c of n.c ?? []) out.add(c);
    codesOf(n.i, out);
  }
  return out;
};
/** Rules without work-term courses; rules left with none go. */
const withoutWork = (nodes) =>
  nodes.flatMap((n) => {
    if (n.c) {
      const c = n.c.filter((x) => !WORK.test(x));
      return c.length ? [{ ...n, c }] : [];
    }
    if (n.i) {
      const i = withoutWork(n.i);
      return i.length ? [{ ...n, i }] : [];
    }
    return [n];
  });

/**
 * The content → {sections: [{h, r, l: [], sub}], prose: [{t, sub}]}, by heading. A section knows the headings
 * above it: under "Notes" or "Co-op" it's left out, under "Technical Electives" or "List A" its courses are a list
 * to choose from, and under "Welding and Joining Specialization" it belongs to that plan (sub). "Term 1A (Fall):"
 * items become sections of their own ("1A Term", the later calendars' name), and once a page has them, sections
 * that only sum up their courses ("Credit Courses") go. Prose is kept for averages and plans described in words.
 */
export function pageSections(content, title) {
  const raw = [{ h: title, heads: [], nodes: [], text: [] }];
  const stack = [];
  const walk = (n) => {
    for (const c of n.children ?? []) {
      if (!c.tag) continue;
      const hm = /^h([1-6])$/.exec(c.tag);
      const cur = raw.at(-1);
      if (hm) {
        // "Term 3B (Fall)": the later calendars' "3B Term".
        // "Table B – Welding and Joining Specialization": the specialization.
        const h = norm(textOf(c))
          .replace(/^Term (\d[AB])\b.*$/i, '$1 Term')
          .replace(/^Table [A-Z0-9]{1,2}\s*[–—-]\s*/i, '');
        if (!h) continue;
        const lv = Number(hm[1]);
        while (stack.length && stack.at(-1).lv >= lv) stack.pop();
        stack.push({ lv, h });
        raw.push({ h, heads: stack.map((x) => x.h), nodes: [], text: [] });
      } else if (c.tag === 'ul' || c.tag === 'ol') {
        cur.nodes.push(...listNodes(c));
        cur.text.push(norm(textOf(c)));
      } else if (c.tag === 'p') {
        const t = norm(textOf(c));
        if (!t) continue;
        if ((REQ_P.test(t) || REQ_COUNT.test(t)) && !PROSE_P.test(t)) cur.nodes.push(...lineNodes(t));
        cur.text.push(t);
      } else if (c.tag === 'table') {
        cur.nodes.push(...tableNodes(c));
      } else walk(c);
    }
  };
  if (content) walk(content);
  const sections = [];
  const prose = [];
  const made = new Map();
  for (const [k, x] of raw.entries()) {
    if (x.heads.some((h) => SKIP_HEAD.test(h))) continue;
    // A legend's heading ("F - fall term") over the lists after it: they're the section above's.
    if (/^legend$/i.test(x.h)) x.h = x.heads.at(-2) ?? title;
    const sub = [...x.heads].reverse().find((h) => SUB_HEAD.test(h) && h !== title) ?? null;
    const choose = x.heads.some((h) => CHOOSE.test(h));
    prose.push(...x.text.map((t) => ({ t, sub })));
    const own = [];
    const terms = [];
    for (const n of withoutWork(x.nodes)) (n.term ? terms : own).push(n);
    const r = merge(choose ? own.map((n) => (n.r === 'all' ? { ...n, r: 'list' } : n)) : own);
    // Lists under a heading of lists ("Technical Electives" › "Fluid Mechanics") are that section's lists, with the
    // count its prose gives ("Seven technical electives (TEs) are required…"), as in the later calendars.
    const up = x.heads.length >= 2 && CHOOSE.test(x.heads.at(-2)) ? raw.slice(0, k).findLast((y) => y.heads.length === x.heads.length - 1 && y.h === x.heads.at(-2)) : null;
    if (up && r.length) {
      let sec = made.get(up);
      if (!sec) {
        const count = up.text.map((t) => new RegExp(`^(?:The )?${NUMBER} (?:[A-Za-z]+ ){0,3}(?:electives|courses)\\b[^.]*\\b(?:required|chosen|to be taken)\\b[^.]*`, 'i').exec(t)?.[0]).find(Boolean);
        const w = count ? wordsRule(count.replace(/^The /i, '')) : null;
        sec = { h: up.h, r: w?.nc || w?.u ? [{ ...w, pl: 1 }] : [], l: [], sub };
        sections.push(sec);
        made.set(up, sec);
      }
      sec.l.push({ h: x.h, r, l: [] });
      continue;
    }
    if (r.length) {
      const sec = { h: x.h, r, l: [], sub };
      sections.push(sec);
      made.set(x, sec);
    }
    for (const t of terms) {
      const tr = merge(withoutWork(t.i));
      if (tr.length) sections.push({ h: `${t.term} Term`, r: tr, l: [], sub, term: 1 });
    }
  }
  // A page with a term-by-term curriculum: its terms say where each course goes, so other sections' lists of the
  // same courses ("Credit Courses", "Non-Credit Courses") only sum them up.
  const inTerms = codesOf(sections.filter((x) => x.term).flatMap((x) => x.r));
  const out = sections
    .map((x) => (x.term || x.l.length || !inTerms.size ? x : { ...x, r: x.r.map((n) => (n.r === 'all' ? { ...n, c: n.c.filter((c) => !inTerms.has(c)) } : n)).filter((n) => !n.c || n.c.length) }))
    .filter((x) => x.r.length || x.l.length);
  return { sections: out.map(({ term, ...x }) => x), prose };
}

/**
 * A table of courses → nodes. The 2021–22 Engineering curricula are tables of terms (Term | Course and Title | Cls |
 * Tut | Lab: "1A Fall | CHE 102 Chemistry for Engineers", then the term's other courses), as term markers like
 * listNodes's ("CSE† Complementary Studies Elective" is one CSE, "TE‡ Technical Elective" one technical elective);
 * other tables whose rows start with a course are those courses.
 */
export function tableNodes(table) {
  const rows = findAll(table, (n) => n.tag === 'tr').map((tr) => tr.children.filter((x) => x.tag === 'td' || x.tag === 'th').map((x) => norm(textOf(x))));
  const head = rows[0]?.map((x) => x.toLowerCase()) ?? [];
  const iCourse = head.findIndex((x) => /^course/.test(x));
  if (head[0] === 'term' && iCourse > 0) {
    const out = [];
    let cur = null;
    for (const r of rows.slice(1)) {
      const term = /^(\d[AB])\b/.exec(r[0] ?? '');
      if (term) {
        cur = { term: term[1], i: [] };
        out.push(cur);
      }
      // Rows after a term's first leave out its Term cell.
      const cell = term || r.length >= head.length ? r[iCourse] : r[iCourse - 1];
      if (!cur || !cell) continue;
      if (/^CSE\b/.test(cell)) cur.i.push({ t: 'One CSE', nc: 1 });
      else if (/^TE\b/.test(cell)) cur.i.push({ t: 'One technical elective', nc: 1, pl: 1 });
      else cur.i.push(...lineNodes(cell));
    }
    return out.filter((x) => x.i.length);
  }
  const codes = rows.map((r) => /^([A-Z]{2,8}) ?(\d{3}[A-Z]{0,2})\b/.exec(r[0] ?? '')).filter(Boolean).map((m) => `${m[1]}${m[2]}`);
  return codes.length >= 2 ? [{ r: 'all', c: [...new Set(codes)] }] : [];
}

/**
 * A plan described in words → rules: "The Philosophy Minor requires successful completion of a minimum of four
 * academic course units (eight courses) in Philosophy" → 4.0 units of PHIL (subjects: name → code, lower case).
 * Words the grid can't check (no subjects it knows) are a line to tick by hand.
 */
export function proseRules(text, subjects = new Map()) {
  const out = [];
  const sentences = String(text).split(/(?<=\.)\s+(?=[A-Z])/);
  for (const raw of sentences) {
    const t = norm(raw).replace(/\s+([,.;:])/g, '$1');
    if (!/\b(requires?|consists? of|must (?:successfully )?complete|successful completion of)\b/i.test(t)) continue;
    const m = new RegExp(`\\b(?:a minimum of |at least )?(\\d+(?:\\.\\d+)?|${Object.keys(NUM).join('|')}) (?:academic )?(?:course )?(units?|courses)\\b`, 'i').exec(t);
    if (!m || /average/i.test(t.slice(0, m.index))) continue;
    const n = num(m[1]);
    const units = /^units?$/i.test(m[2]);
    const lv = /\b(\d)00-level or (?:higher|above)\b/.exec(t)?.[1];
    // "… in Classical Studies, Greek, or Latin with a minimum …": the subjects, by name.
    const names = /\bin\s+([A-Z][A-Za-z ,'’&-]+?)(?:\s+with\b|\s+at\b|\s*\(|[.;]|$)/.exec(t.slice(m.index))?.[1];
    const subj = names
      ? names
          .split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/)
          .map((x) => subjects.get(x.trim().toLowerCase()))
          .filter(Boolean)
      : [];
    const rule = { t: t.replace(/\s*with a minimum cumulative [^.]*average of \d+%/i, '') };
    if (subj.length) Object.assign(rule, units ? { u: n } : { nc: n }, { subj: [...new Set(subj)] }, lv ? { min: Number(lv) } : {});
    out.push(rule);
  }
  return out;
}

// ---------------- names and slugs ----------------

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const fieldKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** A later calendar's plan → its key: "Major|H|economics", "Minor||economics", "Specialization||economics|applied mathematics". */
export function planKey(p) {
  const t = p.t;
  if (t === 'Major') {
    const kind = /Joint Honours/i.test(p.n) ? 'JH' : /Four-Year General/i.test(p.n) ? '4G' : /Three-Year General/i.test(p.n) ? '3G' : 'H';
    return `Major|${kind}|${fieldKey(p.n.replace(/\s*\(.*$/, ''))}`;
  }
  if (t === 'Specialization') {
    const parent = /\(([^)]+)\)\s*$/.exec(p.n)?.[1] ?? '';
    return `Specialization||${fieldKey(p.n.replace(/\s*\(.*$/, '').replace(/\s*Specialization$/i, ''))}|${fieldKey(parent.replace(/^Bachelor of .*$/, ''))}`;
  }
  if (t === 'Degree Requirements') return `Degree Requirements||${fieldKey(p.n.replace(/\s*\(.*$/, '').replace(/\s*Degree Requirements$/i, ''))}`;
  return `${t}||${fieldKey(p.n.replace(/\s*\(.*$/, '').replace(new RegExp(`^${t}s? in |\\s*${t}s?$`, 'i'), ''))}`;
}
const TYPE_OF = (title) => (/\bspecializations?\b/i.test(title) ? 'Specialization' : /\bminor\b/i.test(title) ? 'Minor' : /\boption\b/i.test(title) ? 'Option' : /\bdiplomas?\b/i.test(title) ? 'Diploma' : /\bcertificate\b/i.test(title) ? 'Certificate' : /degree requirements/i.test(title) ? 'Degree Requirements' : 'Major');

// A faculty's usual degree, to tell plans of one name apart (Mathematical Physics in Mathematics and in Science).
const DEGREE = { ARTS: 'Bachelor of Arts', MATH: 'Bachelor of Mathematics', SCI: 'Bachelor of Science', ENV: 'Bachelor of Environmental Studies', ENG: 'Bachelor of Applied Science', HEA: 'Bachelor of Science', SOCIAL: 'Bachelor of Social Work' };
const GENERIC = /^(degree requirements|requirements|plan requirements|program requirements|overview|overview and degree requirements)$/i;

/**
 * What a page's plan is: {name, type, kind, field, degree}. "Honours Economics" → a major, H, Economics;
 * "Four-Year General French" → 4G; "Joint Pure Mathematics" → JH; "General Kinesiology" (Health) → 4G;
 * "Bachelor of Computer Science (Data Science)" → Data Science, BCS; "Degree Requirements" under a section
 * "Bachelor of Accounting and Financial Management" → that major; "Bachelor of Arts Breadth Requirements" and
 * "Degree Requirements for all Math Students" → the degree's requirements.
 */
export function planName(title, section, prefix) {
  let name = GENERIC.test(title) && section ? section : title;
  if (/breadth requirements$/i.test(name) || /^degree requirements for (all )?math/i.test(name)) {
    const degree = /^degree requirements for/i.test(name) ? 'Bachelor of Mathematics' : name.replace(/\s*breadth requirements$/i, '');
    return { name: `${degree} Degree Requirements`, type: 'Degree Requirements', kind: null, field: degree, degree };
  }
  const type = TYPE_OF(name);
  // "Honours Biochemistry, Biotechnology Specialization": Biotechnology, of Biochemistry.
  const sci = type === 'Specialization' && /^(?:Honours |Joint )?(.+?), (.+?) Specialization$/i.exec(name);
  if (sci) return { name, type, kind: null, field: sci[2], degree: null, parent: sci[1] };
  if (type !== 'Major') {
    const field = name.replace(/\s*\((?:co-op|regular)[^)]*\)/gi, '').replace(/\s*Specializations?$/i, '').replace(/^(?:Diploma|Certificate)s? in /i, '').replace(/\s*(?:Minor|Option|Diploma|Certificate)$/i, '');
    return { name, type, kind: null, field, degree: null };
  }
  let kind = null;
  let degree = null;
  let field = name.replace(/\s*\((?:co-op|regular)[^)]*\)/gi, '').replace(/^Co-operative\s+/i, '').replace(/^The\s+/i, '');
  const pre = /^(Honours|Joint Honours|Joint|Three-Year General|Four-Year General|3-Year General|3-Yr General|4-Year General|General)\s+(.+)$/i.exec(field);
  if (pre) {
    const k = pre[1].toLowerCase();
    kind = /joint/.test(k) ? 'JH' : /^(three|3)/.test(k) ? '3G' : /^(four|4|general)/.test(k) ? '4G' : 'H';
    field = pre[2].replace(/^Co-operative\s+/i, '');
  }
  // "Bachelor of Computer Science (Data Science)", "Bachelor of Mathematics (Computer Science)": the field in brackets.
  let m = /^(Bachelor of [A-Za-z ]+?)\s*\(([^)]+)\)$/.exec(field);
  if (m) [, degree, field] = m;
  else if ((m = /^(Bachelor of [A-Za-z ]+)$/.exec(field))) {
    degree = m[1];
    field = m[1].replace(/^Bachelor of /, '');
  }
  // "Psychology (Bachelor of Arts)", "Psychology Bachelor of Science": the degree, apart.
  if ((m = /\s*\(?(Bachelor of [A-Za-z ]+?)\)?$/.exec(field)) && m.index > 0) {
    degree = m[1];
    field = field.slice(0, m.index);
  }
  field = field.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return { name, type, kind: kind ?? 'H', field, degree: degree ?? DEGREE[prefix] ?? null };
}

/** A parsed node back to HTML, for the helpers that read HTML (degreeProse's breadth table). */
const toHtml = (n) => (n.text !== undefined ? n.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) : `<${n.tag}>${n.children.map(toHtml).join('')}</${n.tag}>`);

const KIND_NAME = { H: 'Honours', JH: 'Joint Honours', '3G': 'Three-Year General', '4G': 'Four-Year General' };

/**
 * The archive's pages of one year → Pathways plans, in the later calendars' shape ({s, n, t, f, fi, c, req, open,
 * avg, tu, fx, ua, ld, src}). known: the later calendars' plans; a plan that's the same plan takes its slug, name,
 * faculty and field, and what the archive's pages don't have: its co-op sequences and systems of study (seq, co,
 * re), the degree's unit totals (tt) and the plans it can't be combined with (cant). subjects: subject names
 * (lower case) → codes, for plans described in words.
 */
export function archivePrograms(pages, { known = [], subjects = new Map() } = {}) {
  const byKey = new Map();
  for (const p of known) byKey.set(planKey(p), [...(byKey.get(planKey(p)) ?? []), p]);
  const out = [];
  // One plan per slug: when two pages are the same plan (Medical Physiology Minor, in Science and in Health; a
  // plan's page and its "Degree Requirements" page), the one with more rules.
  const size = (p) => p.req.reduce((n, x) => n + x.r.length, 0);
  const add = (plan) => {
    const i = out.findIndex((p) => p.s === plan.s);
    if (i < 0) out.push(plan);
    else if (size(plan) > size(out[i])) out[i] = plan;
  };
  for (const page of pages) {
    const { title, section, content } = readArchivePage(page.html);
    if (!title || !content || NOT_PLAN.test(title)) continue;
    const prefix = /\/page\/([A-Za-z]+)-/.exec(page.url)?.[1]?.toUpperCase() ?? '';
    const f = FACULTIES[prefix] ?? FACULTIES[prefix.slice(0, 3)] ?? '';
    // "Program Requirements" under "About Social Work": Social Work's.
    const main = planName(title, section.replace(/^About /, ''), prefix);
    if (NOT_PLAN.test(main.name) || GENERIC.test(main.name)) continue;
    const { sections, prose } = pageSections(content, title);
    const many = /^(?:specializations|diplomas|certificates|options) in /i.test(title);
    const parentField = main.parent ?? /^specializations in (.+)$/i.exec(title)?.[1] ?? (main.type === 'Major' ? main.field : /same requirements as (?:Honours |Joint )?([A-Z][A-Za-z/ ]+?)(?: academic plan| with|,|\.)/.exec(prose.map((x) => x.t).join(' '))?.[1] ?? section);
    const plans = [];
    if (!many) plans.push({ ...main, sub: null, base: true });
    for (const h of new Set([...sections, ...prose].map((x) => x.sub).filter(Boolean))) {
      const pn = planName(h, '', prefix);
      if (pn.type === 'Specialization') plans.push({ ...pn, field: pn.parent ? pn.field : h.replace(/\s*Specialization$/i, ''), parent: pn.parent ?? parentField, sub: h });
      else plans.push({ ...pn, sub: h });
    }
    const all = prose.map((x) => x.t).join(' ');
    for (const pl of plans) {
      const text = prose.filter((x) => x.sub === pl.sub).map((x) => x.t).join(' ');
      let req = sections.filter((x) => x.sub === pl.sub).map(({ h, r, l }) => ({ h, r, l }));
      // A degree's breadth table (BA): the later calendars' "Breadth Requirements".
      if (pl.type === 'Degree Requirements') req.push(...degreeProse(toHtml(content), facultyKey(f)));
      if (!req.length && !pl.base) continue;
      if (!req.length) {
        const r = proseRules(text, subjects);
        if (r.length) req = [{ h: pl.name, r, l: [] }];
      }
      if (!req.length) continue;
      // "at least eight academic course units (16 courses) in History, including:": the plan's total in History,
      // which the later calendars give as "Complete a total of 8.0 units of HIST courses" (tsub).
      let tsub = null;
      let stated = null;
      for (const x of req) {
        const tus = x.r.filter((n) => n.tu);
        if (tus.length) {
          stated = tus[0].tu;
          x.r = x.r.filter((n) => !n.tu);
        }
        const marks = x.r.filter((n) => n.tsub);
        if (!marks.length) continue;
        x.r = x.r.filter((n) => !n.tsub);
        const { u, name } = marks[0].tsub;
        const named = name.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/).map((y) => subjects.get(y.trim().toLowerCase())).filter(Boolean);
        const counts = new Map();
        for (const c of codesOf(req.flatMap((y) => y.r))) counts.set(/^[A-Z]+/.exec(c)[0], (counts.get(/^[A-Z]+/.exec(c)[0]) ?? 0) + 1);
        const most = [...counts].sort((a2, b2) => b2[1] - a2[1])[0]?.[0];
        const subj = named.length ? named : most ? [most] : [];
        if (subj.length) tsub = { u, subj };
      }
      // A course two "all of" rules ask for counts once: the later rule doesn't ask again.
      const required = new Set();
      const once = (nodes) =>
        nodes
          .map((n) => {
            // Inside "one of" groups, choices: not required, and left as they are.
            if (n.r !== 'all') return n.g === 'all' ? { ...n, i: once(n.i) } : n;
            const c = n.c.filter((x) => !required.has(x));
            for (const x of c) required.add(x);
            return { ...n, c };
          })
          .filter((n) => (n.c ? n.c.length : n.i ? n.i.length : true));
      const dedupe = (x) => ({ ...x, r: once(x.r), l: x.l.map(dedupe) });
      req = req.map(dedupe).filter((x) => x.r.length || x.l.length);
      const parent = pl.type === 'Specialization' ? pl.parent ?? parentField ?? '' : '';
      // The same plan in the later calendars: by kind and field (and a specialization's major), the one of this
      // faculty or degree when a name is in several (Psychology in Arts and in Science).
      const keys =
        pl.type === 'Major'
          ? [`Major|${pl.kind}|${fieldKey(pl.field)}`]
          : pl.type === 'Specialization'
            ? [`Specialization||${fieldKey(pl.field)}|${fieldKey(parent)}`, `Specialization||${fieldKey(`${pl.field} ${parent}`)}|`, `Specialization||${fieldKey(pl.field)}|`]
            : [`${pl.type}||${fieldKey(pl.field)}`];
      const cands = keys.map((k) => byKey.get(k)).find((x) => x?.length) ?? [];
      const match = cands.find((p) => p.f === f && (!pl.degree || p.n.includes(pl.degree))) ?? cands.find((p) => p.f === f) ?? cands.find((p) => pl.degree && p.n.includes(pl.degree)) ?? cands[0];
      const s = match?.s ?? slugify(pl.type === 'Major' ? `${pl.kind}-${pl.field}` : pl.type === 'Specialization' ? `${parent}-${pl.field}-specialization` : pl.type === 'Degree Requirements' ? `degree-reqs-${pl.field}` : pl.name);
      const name = match?.n ?? (pl.type === 'Major' ? `${pl.field} (${pl.degree ? `${pl.degree} - ` : ''}${KIND_NAME[pl.kind]})` : pl.type === 'Specialization' && parent ? `${pl.field} Specialization (${parent})` : pl.name);
      const avg = averages(`<p>${text.replace(/</g, ' ')}</p>`);
      const own = pl.base ? all : text;
      // Units in all ("21.5 units distributed as follows", "a total of 4.0 units", "Successful completion of 5.0
      // units"), and the most failed or unusable units.
      const tu = stated ?? /(\d+(?:\.\d+)?) units distributed as follows/i.exec(text)?.[1] ?? /total number of units to complete (?:the )?degree is (\d+(?:\.\d+)?)/i.exec(text)?.[1] ?? totalUnits(text)?.u ?? /successful completion of (?:a minimum of )?(\d+(?:\.\d+)?) units\b/i.exec(text)?.[1];
      const fx = /maximum of (\d+(?:\.\d+)?) (?:units of )?failed (?:or excluded )?(?:course )?units\b/i.exec(own)?.[1] ?? /maximum of (\d+(?:\.\d+)?) units of failed or excluded courses/i.exec(own)?.[1];
      const ua = /maximum of (\d+(?:\.\d+)?) units of unusable course attempts/i.exec(own)?.[1];
      const ld = Math.max(0, ...req.filter((x) => /^\d[AB] Term$/.test(x.h)).map((x) => termLoad(x.r)));
      add({
        s,
        n: name,
        t: pl.type,
        f: match?.f ?? f,
        fi: match?.fi ?? (pl.type === 'Specialization' ? parent || pl.field : pl.field),
        c: match?.c ?? pl.name,
        req,
        ...(avg.length ? { avg } : {}),
        ...(tsub ? { tsub } : tu && pl.type !== 'Degree Requirements' ? { tu: Number(tu) } : {}),
        ...(fx ? { fx: Number(fx) } : {}),
        ...(ua ? { ua: Number(ua) } : {}),
        ...(ld > 5 ? { ld: Math.min(7, ld) } : match?.ld ? { ld: match.ld } : {}),
        ...(match?.tt && pl.type === 'Degree Requirements' ? { tt: match.tt } : {}),
        ...(match?.seq && pl.type === 'Major' ? { seq: match.seq } : {}),
        ...(match?.co ? { co: 1 } : {}),
        ...(match?.re ? { re: 1 } : {}),
        ...(match?.cant ? { cant: match.cant } : {}),
        ...(match?.solo ? { solo: match.solo } : {}),
        ...(match?.cn ? { cn: match.cn } : {}),
        ...(pl.type === 'Specialization' && parent ? { parent } : {}),
        src: page.url,
      });
    }
  }
  const slugs = new Set(out.map((p) => p.s));
  for (const p of out) {
    // A specialization is open to the majors of its field, in this year's set.
    if (p.t === 'Specialization' && p.parent) {
      const open = out.filter((q) => q.t === 'Major' && fieldKey(q.fi) === fieldKey(p.parent)).map((q) => q.s);
      if (open.length) p.open = open;
    }
    delete p.parent;
    if (p.cant) {
      p.cant = p.cant.filter((x) => slugs.has(x));
      if (!p.cant.length) delete p.cant;
    }
  }
  return out;
}
