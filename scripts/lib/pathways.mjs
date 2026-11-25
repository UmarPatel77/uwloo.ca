// uwloo.ca/pathways: map out a whole degree, term by term. This writes its data file and its page; the app
// itself is site/pathways/ (engine.js for the rules, app.js for the grid).
//
// /pathways/data.json: {cat, term, year, years, courses: {CODE: [title, units, prereq, coreq, antireq, seasons, equiv]},
//                       programs: [{s, n, t, f, fi, c, req, open, tu, tsub, tt, seq, cant}]}  (the current calendar's)
// /pathways/programs-{year}.json: {year, label, programs} for each other calendar year (2024–25 on): someone
//                       follows the requirements of the year they started.
//   prereq, coreq: compact requisite trees (engine.js describes the shape); antireq: the codes it rules out
//   seasons: [Fall, Winter, Spring] terms with sections in the last 4 academic years, plus any published term
import { shell } from './render.mjs';
import { esc, find, findAll, norm, parseHtml, textOf } from './requisites.mjs';
import { termName } from './terms.mjs';

// ---------------- trees ----------------

/** A requirement or requisite lead ("Complete 2 of the following:") → [kind, n]. */
export function kindOf(lead) {
  const l = norm(lead).toLowerCase();
  let m;
  if (/cannot be used|not completed|not open to/.test(l)) return ['not'];
  if ((m = /no more than (\d+(?:\.\d+)?)/.exec(l))) return ['max', Number(m[1])];
  if ((m = /(?:at least|complete) (\d+(?:\.\d+)?) of the following/.exec(l))) return ['n', Number(m[1])];
  if (/choose any of the following/.test(l)) return ['any'];
  // "Must have completed or be concurrently enrolled in the following:" (a corequisite) is all of them too.
  if (/\b(all|each) (of )?the following|completed the following|complete the following|enrolled in the following/.test(l)) return ['all'];
  return ['list'];
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const SUBJ = '[A-Z]{2,8}';
const SUBJ_LIST = `${SUBJ}(?:\\s*(?:,|or|and|, or|, and)\\s*${SUBJ})*`;

/**
 * Words in a rule → what the planner can do with them: a level ("level 3A or higher"), a plan to be enrolled
 * in, or a number of units or courses, drawn from the section's lists, from subjects at a level, or from
 * ranges of course numbers. Words that ask for nothing ("See Additional Constraints") are marked info.
 */
export function hints(text) {
  const t = norm(text);
  const h = { t };
  let m;
  if ((m = /\blevel (\d[AB]) or (?:higher|above)\b/i.exec(t))) h.lv = m[1].toUpperCase();
  if ((m = /^(?:Students must be )?Enrolled in (.+?)\.?$/i.exec(t))) h.en = m[1];
  const num = (x) => (NUMBER_WORDS[x.toLowerCase()] ?? Number(x));
  // "Complete a total of seven courses according to the requirements below": a summary of the rules after it.
  if (/according to the requirements|as described below|as follows\b/i.test(t)) {
    h.info = 1;
    return h;
  }
  if ((m = /\bcomplete (?:a (?:total|minimum) of |at least )?(\d+(?:\.\d+)?) (?:additional )?units?\b/i.exec(t))) h.u = Number(m[1]);
  else if ((m = /\bcomplete (?:a (?:total|minimum) of |at least )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:[A-Za-z/-]+ ){0,4}?(?:courses?|electives?|seminars?)\b/i.exec(t))) h.nc = num(m[1]);
  if (h.u || h.nc) {
    const subj = new Set();
    const lists = [
      new RegExp(`subject codes?:?\\s*(${SUBJ_LIST})`),
      new RegExp(`\\bfrom:?\\s*(${SUBJ}(?:\\s*,\\s*(?:or\\s+|and\\s+)?${SUBJ})+)`),
      new RegExp(`\\b(?:units?|courses?) (?:of|in|from) (${SUBJ_LIST}) courses?\\b`),
      new RegExp(`\\b(?:additional |more |senior )?(${SUBJ_LIST}) (?:elective |lecture |seminar )?(?:courses?|seminars?|electives?)\\b`),
    ];
    for (const re of lists) {
      const hit = re.exec(t);
      if (hit) {
        for (const x of hit[1].split(/[^A-Z]+/)) if (x.length >= 2) subj.add(x);
        break;
      }
    }
    // "chosen from CS340-CS398, CS440-CS489"
    const ranges = [...t.matchAll(new RegExp(`(${SUBJ}) ?(\\d{3})\\s*[-–]\\s*(?:${SUBJ} ?)?(\\d{3})`, 'g'))].map((x) => [x[1], Number(x[2]), Number(x[3])]);
    if (ranges.length) h.rg = ranges;
    else if (subj.size) h.subj = [...subj];
    // "at the 300- or 400-level", "at the 200-, 300-, or 400-level", "at the 200-level or above"
    if ((m = /\b((?:\d00-?,?\s*(?:or\s+|and\s+)?)*\d00)[- ]level\b/i.exec(t))) h.min = Math.min(...[...m[1].matchAll(/(\d)00/g)].map((x) => Number(x[1])));
    // "from the Faculty of Arts", "offered by the Faculties of…": the grid can't check a faculty.
    if (/\bFacult(?:y|ies)\b/.test(t)) h.fa = 1;
    if (!h.subj && !h.rg && /\b(list|lists|following|below|approved|technical electives?)\b/i.test(t)) h.pl = 1;
  } else if (!h.lv && !h.en && !/\b(complete|earn|take|must|required?)\b/i.test(t)) h.info = 1;
  return h;
}

/** kualiToTree's nodes → the compact shape engine.js reads. */
export function compact(nodes) {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'group') {
        const [k, num] = kindOf(n.lead);
        return { g: k === 'n' ? 'n' : 'all', ...(k === 'n' ? { n: num } : {}), i: compact(n.items) };
      }
      if (n.type === 'rule') {
        const [k, num] = kindOf(n.lead);
        const c = [...new Set(n.courses.map((x) => x.code).filter(Boolean))];
        if (!c.length) return n.lead ? hints(n.lead) : null;
        return { r: k, ...(num != null ? { n: num } : {}), c };
      }
      const t = norm(n.text);
      return t ? hints(t) : null;
    })
    .filter(Boolean);
}

/** A program's sections (programs.mjs) → compact sections. */
export const compactSections = (sections) => (sections ?? []).map((s) => ({ h: s.heading, ...(s.units != null ? { u: s.units } : {}), r: compact(s.tree), l: compactSections(s.lists) })).filter((s) => s.r.length || s.l.length);

/**
 * "Complete a total of 4.0 units." → {u: 4}; "…a total of 8.0 units of ECON courses." → {u: 8, subj: ['ECON']};
 * every total in the text with all: true (a degree's "15.0 units" and "20.0 units").
 */
export function totalUnits(html, { all = false } = {}) {
  const text = norm(String(html ?? '').replace(/<[^>]*>/g, ' '));
  // A degree's total can also be "Complete a minimum of 20.0 units" (BMath, BCS).
  const lead = all ? /(?:total of|[Cc]omplete a minimum of)/ : /total of/;
  const re = new RegExp(`${lead.source}\\s*(\\d+(?:\\.\\d+)?)\\s*units(?: of ((?:[A-Z]{2,8})(?:\\s*(?:,|or|and)\\s*[A-Z]{2,8})*) courses)?`, 'g');
  const found = [...text.matchAll(re)].map((m) => ({ u: Number(m[1]), ...(m[2] ? { subj: m[2].split(/[^A-Z]+/).filter(Boolean) } : {}) }));
  if (all) return [...new Set(found.filter((x) => !x.subj).map((x) => x.u))].sort((a, b) => a - b);
  return found[0] ?? null;
}

/** Study/work sequence charts in a program's co-op section → [{label, start: 'F', terms: ['1A', '1B', 'off', 'WT', …]}]. */
export function sequences(html) {
  if (!html || !/<table/i.test(html)) return [];
  const out = [];
  for (const table of findAll(parseHtml(html), (n) => n.tag === 'table')) {
    const head = findAll(table, (n) => n.tag === 'th').map((n) => norm(textOf(n)));
    if (head.length < 4 || !/^(sequence|plan|stream)/i.test(head[0]) || !head.slice(1).every((h) => /^[FWS]$/.test(h))) continue;
    for (const tr of findAll(table, (n) => n.tag === 'tr')) {
      const cells = tr.children.filter((c) => c.tag === 'td').map((c) => norm(textOf(c)));
      if (cells.length < 3) continue;
      const terms = cells.slice(1).map((c) => (/^\d[AB]$/i.test(c) ? c.toUpperCase() : /^wt/i.test(c) ? 'WT' : 'off'));
      if (terms.some((t) => /^\d[AB]$/.test(t))) out.push({ label: cells[0], start: head[1], terms });
    }
  }
  return out;
}

// ---------------- the data file ----------------

const SEASONS = { 9: 0, 1: 1, 5: 2 };
const oldTitle = (r) => r?.od?.title ?? r?.arch?.title ?? r?.ga?.title ?? '';

/**
 * Everything the app needs. programs: programs.mjs's {list, byId}; combos: its byProgram; catalog: the current
 * undergraduate catalog (its courses); schedules: code → {terms}; published: {term: Set of codes} (this term
 * and next, from Open Data); curTerm: e.g. '1269'; years: [{year, label, file}] for every calendar with programs.
 */
export function pathwaysData({ programs, combos, catalog, schedules, published = {}, curTerm, retired = new Map(), years = [] }) {
  const from = String(Number(curTerm) - 40); // four academic years back
  const courses = {};
  for (const [code, c] of catalog.courses) {
    const seasons = [0, 0, 0];
    const seen = new Set();
    for (const [term, rows] of Object.entries(schedules.get(code)?.terms ?? {})) if (rows?.length && term >= from) seen.add(term);
    for (const [term, set] of Object.entries(published)) if (set.has(code)) seen.add(term);
    for (const term of seen) seasons[SEASONS[term.slice(-1)]]++;
    const pre = compact(c.prereq);
    const co = compact(c.coreq);
    const anti = [...new Set(compact(c.antireq).flatMap(function codes(n) {
      return n.g ? n.i.flatMap(codes) : n.c ?? [];
    }))];
    const row = [c.title, c.units ?? 0.5, pre.length ? pre : 0, co.length ? co : 0, anti.length ? anti : 0, seasons];
    if (c.crossListed?.length) row.push(c.crossListed);
    courses[code] = row;
  }
  // Courses programs name that aren't in this calendar: a title, so the grid can say what they were.
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.type === 'group') walk(n.items);
      else if (n.type === 'rule') for (const x of n.courses) if (x.code && !courses[x.code]) courses[x.code] = [x.title || oldTitle(retired.get(x.code)), x.units ?? 0.5, 0, 0, 0, [0, 0, 0], [], 1];
    }
  };
  const walkSection = (s) => {
    walk(s.tree);
    for (const l of s.lists ?? []) walkSection(l);
  };
  for (const p of programs.list) for (const s of p.sections) walkSection(s);
  const list = pathwaysPrograms({ programs, combos });
  return { cat: catalog.label, term: curTerm, year: catalog.start ?? null, years, courses, programs: list };
}

/** One calendar's programs, in the shape the app reads. */
export function pathwaysPrograms({ programs, combos }) {
  return programs.list.map((p) => {
    const out = {
      s: p.slug,
      n: p.name,
      t: p.type,
      f: p.faculty,
      fi: p.field,
      c: p.code,
      req: compactSections(p.sections),
    };
    const open = p.availableTo.map((r) => programs.byId.get(r.id)?.slug).filter(Boolean);
    if (open.length) out.open = open;
    const tu = totalUnits(p.text.graduationRequirements);
    if (tu?.subj) out.tsub = tu;
    else if (tu) out.tu = tu.u;
    if (p.type === 'Degree Requirements') {
      const tt = totalUnits(p.text.degreeRequirements, { all: true });
      if (tt.length) out.tt = tt;
    }
    const seq = sequences(p.text.coOperativeRequirementsUndergraduate);
    if (seq.length) out.seq = seq;
    const cant = (combos?.get(p.pid) ?? []).flatMap((o) => o.to.map((q) => q.slug)).filter((s) => s !== p.slug);
    if (cant.length) out.cant = [...new Set(cant)];
    return out;
  });
}

// ---------------- the page ----------------

export function pathwaysPage({ cat, builtAt, version, curTerm }) {
  const body = `<div class="pw" id="pathways" data-v="${esc(version)}" data-term="${esc(curTerm)}">
<header class="pw-head">
  <h1>Pathways</h1>
  <p class="lede">Map out your whole degree, term by term: pick your plans and fill in their courses, then make it yours. See what each course counts toward, and what you’d still need for anything else.</p>
</header>
<noscript><p class="pl-msg">Pathways needs JavaScript. Every program’s requirements are on its page under <a href="/programs/">Programs</a>.</p></noscript>
<div class="pw-app" id="pw-app"><p class="pl-msg">Loading the ${esc(cat.label)} calendar…</p></div>
</div>
<script type="module" src="/pathways/app.js?v=${esc(version)}"></script>`;
  return shell({
    title: 'Pathways: plan your degree | uwloo',
    description: `Plan a University of Waterloo degree term by term with the Undergraduate Calendar of the year you started (${cat.label} and earlier): majors, minors, options and specializations, prerequisites, course loads, and what each course counts toward.`,
    path: '/pathways/',
    body,
    builtAt,
    version,
    head: `<link rel="stylesheet" href="/pathways/app.css?v=${esc(version)}">`,
  });
}

export { termName };
