// uwloo.ca/pathways: map out a whole degree, term by term. This writes its data file and its page; the app
// itself is site/pathways/ (engine.js for the rules, app.js for the grid).
//
// /pathways/data.json: {cat, term, year, years, courses: {CODE: [title, units, prereq, coreq, antireq, seasons, equiv]},
//                       programs: [{s, n, t, f, fi, c, req, open, deg, lim, soft, notf, nd, paused, who, tu, tsub, tt,
//                       seq, co, re, cant}]}  (open: majors a specialization is for; deg: degrees an option is for;
//                       lim/soft/notf/nd/paused/who: who a plan is for, see eligibility) (the current
//                       calendar's; seq: a co-op major's study/work sequences; co/re: co-op, regular offered;
//                       ld: the usual courses a term, when a term-by-term program lists more than 5)
// /pathways/programs-{year}.json: {year, label, programs} for each other calendar year: someone follows the
//                       requirements of the year they started. 2021–22 to 2023–24 (scripts/lib/archiveprograms.mjs)
//                       add courses (the older courses their plans name) and each plan's src (its archived page).
//   prereq, coreq: compact requisite trees (engine.js describes the shape); antireq: the codes it rules out
//   seasons: [Fall, Winter, Spring] terms with sections in the last 4 academic years, plus any published term
import { FACULTY } from './opendata.mjs';
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
        // "Earned a minimum grade of 60% in each of the following": mg, checked against grades someone enters.
        const mg = /minimum grade of (\d+(?:\.\d+)?)\s*%/i.exec(n.lead ?? '')?.[1];
        return { r: k, ...(num != null ? { n: num } : {}), c, ...(mg ? { mg: Number(mg) } : {}) };
      }
      const t = norm(n.text);
      return t ? hints(t) : null;
    })
    .filter(Boolean);
}

/** A program's sections (programs.mjs) → compact sections. */
// "All Bachelor of Mathematics students, with the exceptions of Mathematical Studies and Mathematics/Chartered
// Professional Accountancy, must complete the following List A courses.": the section and its lists don't apply
// to those majors. ex keeps the names as written; the app checks them against the majors someone picked.
const EXCEPT = /\bwith the exceptions? of (.+?),\s*(?:must|are|is|will|who)\b/i;
export const compactSections = (sections) =>
  (sections ?? [])
    .map((s) => {
      const r = compact(s.tree);
      let ex = null;
      for (const n of r) {
        const m = n.t && EXCEPT.exec(n.t);
        if (m) {
          ex = m[1];
          n.info = 1;
        }
      }
      return { h: s.heading, ...(s.units != null ? { u: s.units } : {}), ...(ex ? { ex } : {}), r, l: compactSections(s.lists) };
    })
    .filter((s) => s.r.length || s.l.length);

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
/**
 * A co-op chart's study/work sequences: [{label, plans, start, terms}]. Charts are tables of terms under F/W/S
 * headers ("1A", "WT", "off"), sometimes after a Plan column (names, spanning several rows) and a Sequence or
 * S/S column ("1", "8X"). A chart that stops being specific ("†") ends there, marked cut.
 */
export function sequences(html) {
  if (!html || !/<table/i.test(html)) return [];
  const out = [];
  for (const table of findAll(parseHtml(html), (n) => n.tag === 'table')) {
    // The table as a grid, with cells that span rows repeated down.
    const grid = [];
    const spans = [];
    for (const tr of findAll(table, (n) => n.tag === 'tr')) {
      const row = [];
      let col = 0;
      const carry = () => {
        while (spans[col]?.left > 0) {
          row[col] = spans[col].text;
          spans[col].left--;
          col++;
        }
      };
      for (const c of tr.children.filter((x) => x.tag === 'td' || x.tag === 'th')) {
        carry();
        const text = norm(textOf(c));
        const rows = Number(c.attrs.rowspan) || 1;
        for (let k = 0; k < (Number(c.attrs.colspan) || 1); k++) {
          row[col] = text;
          if (rows > 1) spans[col] = { text, left: rows - 1 };
          col++;
        }
      }
      carry();
      grid.push(row);
    }
    const head = grid[0] ?? [];
    const first = head.findIndex((h) => /^[FWS]$/.test(h));
    if (first < 0 || head.length - first < 4 || !head.slice(first).every((h) => /^[FWS]$/.test(h))) continue;
    const before = head.slice(0, first);
    const planCol = before.findIndex((h) => /^plan/i.test(h));
    const labelCol = before.findIndex((h) => /^(s\/s|sequence|stream)/i.test(h));
    for (const row of grid.slice(1)) {
      const cells = row.slice(first).map((c) => (c ?? '').trim());
      const terms = [];
      for (const c of cells) {
        if (/^\d[AB]$/i.test(c)) terms.push(c.toUpperCase());
        else if (/^wt/i.test(c)) terms.push('WT');
        else if (/^off$/i.test(c)) terms.push('off');
        else break;
      }
      if (!terms.some((t) => /^\d[AB]$/.test(t))) continue;
      const plans = planCol >= 0 ? (row[planCol] ?? '').replace(/^[*#†\s]+|[*#†\s]+$/g, '') : null;
      out.push({ label: labelCol >= 0 ? row[labelCol] ?? '' : '', ...(plans ? { plans } : {}), start: head[first], terms, ...(cells[terms.length] === '†' ? { cut: 1 } : {}) });
    }
  }
  return out;
}

/** How many courses a term's rules list: all of a list, n of a choice, the number in words. */
export const termLoad = (nodes) => (nodes ?? []).reduce((t, n) => t + (n.g === 'all' ? termLoad(n.i) : n.g === 'n' ? n.n ?? 1 : n.r === 'all' ? n.c.length : n.r === 'n' ? n.n ?? 1 : n.nc ?? (n.u ? Math.round(n.u / 0.5) : 0)), 0);

/** "Faculty of Arts" → 'art'. */
export const facultyKey = (f) => FACULTY_WORDS[String(f ?? '').replace(/^Facult(?:y|ies) of /, '').split(/ and | with /)[0].trim().toLowerCase()] ?? null;

const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9/&]+/g, ' ').trim();
/** The names a chart's Plan cell lists: "Management, Mechanical, Mechatronics", "Computer Science; Data Science",
 *  "Honours Arts co-op majors of Economics, English, Fine Arts". */
const chartNames = (cell) =>
  (cell.includes(';') ? cell.split(';') : cell.split(','))
    .flatMap((x) => {
      const m = /\bmajors? (?:of|in) (.+)$/i.exec(x);
      return m ? m[1].split(/,\s*(?:and\s+)?|\s+and\s+/) : [x];
    })
    .map(nameKey)
    .filter(Boolean);
/** The names a major goes by in a chart, most specific first: its name, then "Mechanical" for Mechanical
 *  Engineering, then its field ("Computer Science" for the BBA and BCS double degree). */
function majorNames(p) {
  const base = p.n.replace(/\s*\(.*$/, '');
  const tiers = [[base], [base.replace(/ Engineering$/, '')], [p.fi, String(p.fi ?? '').replace(/ Engineering$/, '')]];
  return tiers.map((t) => [...new Set(t.filter(Boolean).map(nameKey))]);
}
// Engineering's charts list streams ("4", "8X"); the others number sequences.
const yearsLabel = (label, eng) => (eng && /^\d[A-Z]?$/.test(label) ? `Stream ${label}` : /^\d+$/.test(label) ? `Sequence ${label}` : label);

/**
 * Each co-op major's study/work sequences: its own chart, else the rows of its degree's chart that name it
 * (or that are for "all other majors"), else a row of another degree's chart that names it (double degrees).
 * → Map slug → [{label, start, terms, cut}]
 */
export function coopSequences(list) {
  const degrees = list.filter((p) => p.t === 'Degree Requirements' && p.seq?.length);
  const out = new Map();
  for (const p of list) {
    if (p.t !== 'Major') continue;
    if (p.seq?.length) {
      out.set(p.s, p.seq.map((q, i, all) => ({ label: q.label ? yearsLabel(q.label, /Engineering/.test(p.f)) : all.length > 1 ? `Sequence ${i + 1}` : 'Co-op', start: q.start, terms: q.terms, ...(q.cut ? { cut: 1 } : {}) })));
      continue;
    }
    if (p.co !== 1) continue;
    const deg = /\((Bachelor of [A-Za-z ]+?)\s*[-,)]/.exec(p.n)?.[1];
    const own = degrees.filter((d) => deg && d.n.startsWith(deg));
    const fac = String(p.f).replace(/^Facult(?:y|ies) of /, '').split(/ and | with /)[0];
    const isDefault = (q) => q.plans && /^all other|excluding/i.test(q.plans);
    const ownDeg = own.find((d) => d.n.includes(`(${fac})`)) ?? own[0];
    const named = (d) => {
      for (const names of majorNames(p)) {
        const hit = d.seq.filter((q) => q.plans && !isDefault(q) && chartNames(q.plans).some((x) => names.includes(x)));
        if (hit.length) return hit;
      }
      return [];
    };
    const sameFaculty = degrees.filter((d) => d.f === p.f && d !== ownDeg);
    // Its own degree's rows that name it; then its faculty's other charts (a double degree's row is in the BCS
    // or BMath chart); then "all other majors" (joint honours name no degree); then any chart that names it.
    let rows = ownDeg ? named(ownDeg) : [];
    for (const d of sameFaculty) if (!rows.length) rows = named(d);
    const fallback = ownDeg ?? sameFaculty.find((d) => d.seq.some(isDefault));
    if (!rows.length && fallback) rows = fallback.seq.filter(isDefault);
    for (const d of degrees) if (!rows.length) rows = named(d);
    if (!rows.length) continue;
    const eng = /Engineering/.test(p.f);
    out.set(p.s, rows.map((q, i) => ({ label: q.label ? yearsLabel(q.label, eng) : rows.length > 1 ? `Sequence ${i + 1}` : 'Co-op', start: q.start, terms: q.terms, ...(q.cut ? { cut: 1 } : {}) })));
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
export function pathwaysData({ programs, combos, catalog, schedules, published = {}, curTerm, retired = new Map(), years = [], faculty = new Map() }) {
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
  // Each subject's faculty ('art', 'mat'…), from Open Data's course groups: for "any course from another
  // faculty" and averages over a faculty's courses.
  const votes = new Map();
  for (const [code, group] of faculty) {
    const f = FACULTY[group];
    const subj = /^[A-Z]+/.exec(code)?.[0];
    if (!f || !subj) continue;
    const v = votes.get(subj) ?? new Map();
    v.set(f, (v.get(f) ?? 0) + 1);
    votes.set(subj, v);
  }
  // Without Open Data there's no map: the app checks faculty averages by hand then.
  const sf = Object.fromEntries([...votes].map(([subj, v]) => [subj, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  return { cat: catalog.label, term: curTerm, year: catalog.start ?? null, years, courses, programs: list, sf };
}

// ---------------- averages, breadth, and units by level ----------------

const plainText = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
const SUBJECT_NAMES = { physics: ['PHYS'], biology: ['BIOL'], chemistry: ['CHEM'], 'earth sciences': ['EARTH'], psychology: ['PSYCH'], economics: ['ECON'], 'computer science': ['CS'], statistics: ['STAT'], 'actuarial science': ['ACTSC'] };
const CODE = /^[A-Z]{2,8}\d{3}[A-Z]?$/;
const RANGE = /^([A-Z]{2,8})(\d{3})-(\d{3})$/;
const FACULTY_WORDS = { math: 'mat', mathematics: 'mat', arts: 'art', science: 'sci', engineering: 'eng', environment: 'env', health: 'hea' };

/**
 * A program's minimum averages (its "Minimum Average(s) Required"): [{k, min, ...}], k one of
 *   overall  "A minimum cumulative overall average of 60.0%"
 *   term     "A minimum term average of 60.0%"
 *   plan     "major/minor/option/diploma/specialization average of 65.0%" (the courses that count toward it)
 *   subj     "…average of 70.0% in all AVIA, ENVS, GDS, and GEOG courses", "a Physics average" (subj: [...])
 *   fac      "…: all math courses", "in Faculty of Arts courses", "a Science average" (fac: 'mat')
 *   codes    "a combined average of 65.0% in CHEM264 and CHEM265", "…in two or more of the following courses:
 *            CS136, CS138, CS240-299…" (c: codes, rg: [[subject, from, to]], n: how many before it applies)
 *   hand     anything else, kept as written (t) to check by hand
 */
export function averages(html) {
  const text = plainText(html);
  const out = [];
  for (const m of text.matchAll(/(?:^|[.;]\s+|:\s*)([^.;]*?)\baverage of (\d+(?:\.\d+)?)%([^.]*(?:\.\d[^.]*)*)/g)) {
    const [, before, num, after] = m;
    const min = Number(num);
    const t = `${before} average of ${num}%${after}`.replace(/\s+/g, ' ').trim();
    const head = `${before.trim()} average`;
    const what = before.toLowerCase();
    const label = /\b(special major|major|minor|option|diploma|specialization|certificate)\b/.exec(what)?.[1] ?? /^\s*in the (major|minor|option|diploma|specialization|certificate) courses/i.exec(after)?.[1]?.toLowerCase() ?? null;
    // A list of courses: every piece a code or a range.
    const listed = /following courses:\s*(.+)$/i.exec(after)?.[1] ?? /^\s*in\s+(.+)$/i.exec(after)?.[1] ?? '';
    const parts = listed.split(/[,;]\s*|\s+and\s+|\s+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length && parts.every((x) => CODE.test(x) || RANGE.test(x))) {
      const n = /\b(two|three|four) or more of the following/i.exec(after)?.[1];
      out.push({ k: 'codes', min, c: parts.filter((x) => CODE.test(x)), rg: parts.filter((x) => RANGE.test(x)).map((x) => RANGE.exec(x).slice(1).map((v, i) => (i ? Number(v) : v))), ...(n ? { n: { two: 2, three: 3, four: 4 }[n.toLowerCase()] } : {}), ...(label ? { label } : {}), t });
      continue;
    }
    const subj = /\bin all ([A-Z]{2,8}(?:,?\s*(?:and\s+)?[A-Z]{2,8})*) courses/.exec(after)?.[1]?.split(/[^A-Z]+/).filter(Boolean);
    const fac = /all (math|mathematics) courses/i.exec(after)?.[1] ?? /Faculty of (\w+) courses/i.exec(after)?.[1] ?? /\bcumulative (Science|Math|Mathematics|Arts|Engineering|Health|Environment) average/i.exec(head)?.[1];
    const namedRaw = /\bcumulative ([A-Z][A-Za-z]+(?: [A-Z][a-z]+)?) average/.exec(head)?.[1];
    const named = namedRaw?.toLowerCase();
    const codeNamed = namedRaw && /^[A-Z]{2,8}$/.test(namedRaw) ? [namedRaw] : null;
    if (/^if\b/i.test(before.trim()) || /\b(two or more|home department)\b/i.test(t)) out.push({ k: 'hand', min, t });
    else if (subj?.length) out.push({ k: 'subj', min, subj, ...(label ? { label } : {}), t });
    else if (fac) out.push({ k: 'fac', min, fac: FACULTY_WORDS[fac.toLowerCase()], ...(label ? { label } : {}), t });
    else if (named && SUBJECT_NAMES[named]) out.push({ k: 'subj', min, subj: SUBJECT_NAMES[named], t });
    else if (codeNamed) out.push({ k: 'subj', min, subj: codeNamed, t });
    else if (/\bterm\s*$/i.test(before)) out.push({ k: 'term', min, t });
    else if (label) out.push({ k: 'plan', min, label, t });
    else if (/\boverall\b|^\s*a minimum cumulative\s*$/i.test(before)) out.push({ k: 'overall', min, t });
    else out.push({ k: 'hand', min, t });
  }
  return out;
}

/**
 * Rules a degree states in prose rather than as course lists:
 *   "Three-Year General degrees: … a minimum of 8.0 units at the 200-level or above", "Liberal Studies major: A
 *   minimum of 12.5 units must be at the 200-level or above", "All other Arts majors: …" → one section each,
 *   for the majors it's about (only: {type, major, other}), checked over every course (ov: overlay).
 *   The BA's breadth table (Requirement | Units Required | Subject Codes) and its notes: no more than 1.0 unit
 *   from one discipline (ms), ARTS160 and PD courses don't count (no, nos), "also any course taken in another
 *   University of Waterloo faculty" (of).
 * fac: the degree's own faculty ('art').
 */
export function degreeProse(html, fac) {
  const out = [];
  const text = plainText(html);
  // Units at a level, by kind of degree and major.
  let type = null;
  let named = [];
  for (const m of text.matchAll(/(Three-Year General|Four-Year General|Honours) degrees?:|([A-Z][A-Za-z ,'’-]*?) majors?:\s*A minimum of (\d+(?:\.\d+)?) units must be at the (\d)00-level or above|with a minimum of (\d+(?:\.\d+)?) units at the (\d)00-level or above/g)) {
    if (m[1]) {
      type = m[1];
      named = [];
      continue;
    }
    const u = Number(m[3] ?? m[5]);
    const min = Number(m[4] ?? m[6]);
    const rule = { t: `A minimum of ${u.toFixed(1)} units at the ${min}00-level or above`, u, min, any: 1, ov: 1 };
    let only = { ...(type ? { type } : {}) };
    if (m[2]) {
      const who = m[2].trim();
      if (/^all other\b/i.test(who)) only = { ...only, other: [...named] };
      else {
        only = { ...only, major: who };
        named.push(who);
      }
    }
    out.push({ h: 'Units at the 200-level or above'.replace('200', `${min}00`), only, r: [rule], l: [] });
  }
  // Breadth: a table of requirement, units and subject codes.
  for (const table of findAll(parseHtml(String(html ?? '')), (n) => n.tag === 'table')) {
    const rows = findAll(table, (n) => n.tag === 'tr').map((tr) => tr.children.filter((x) => x.tag === 'td' || x.tag === 'th').map((x) => norm(textOf(x))));
    const head = rows[0]?.map((x) => x.toLowerCase()) ?? [];
    const iName = head.findIndex((x) => /requirement/.test(x));
    const iUnits = head.findIndex((x) => /units/.test(x));
    const iSubj = head.findIndex((x) => /subject/.test(x));
    if (iName < 0 || iUnits < 0 || iSubj < 0) continue;
    const rules = [];
    for (const row of rows.slice(1)) {
      const name = row[iName];
      const u = Number(/(\d+(?:\.\d+)?)\s*units?/i.exec(row[iUnits] ?? '')?.[1]);
      const cell = row[iSubj] ?? '';
      const subj = cell.split('.')[0].split(/,\s*/).map((x) => x.trim()).filter((x) => /^[A-Z]{2,8}$/.test(x));
      if (!name || !u || !subj.length) continue;
      const other = /any course taken in another University of Waterloo faculty/i.test(cell);
      rules.push({ t: `${name}: ${u.toFixed(1)} ${u === 1 ? 'unit' : 'units'} of ${subj.join(', ')}${other ? ', or any course from another faculty' : ''}`, u, subj, ...(other && fac ? { of: fac } : {}), name });
    }
    if (!rules.length) continue;
    // Notes under the table.
    for (const m of text.matchAll(/No more than (\d+(?:\.\d+)?) units? in the same discipline may count towards the ([A-Za-z ,]+?) requirement/g)) {
      const r = rules.find((x) => x.name.toLowerCase() === m[2].trim().toLowerCase());
      if (r) r.ms = Number(m[1]);
    }
    const no = [...text.matchAll(/\(((?:[A-Z]{2,8}\d{3}[A-Z]?)(?:\s*(?:,|or|and)\s*[A-Z]{2,8}\d{3}[A-Z]?)*)\) do not fulfil any of the breadth/gi)].flatMap((m) => m[1].match(/[A-Z]{2,8}\d{3}[A-Z]?/g));
    const nos = [...text.matchAll(/\(([A-Z]{2,8})\) courses do not fulfil any of the breadth/gi)].map((m) => m[1]);
    for (const r of rules) {
      delete r.name;
      if (no.length) r.no = no;
      if (nos.length) r.nos = nos;
    }
    out.push({ h: 'Breadth Requirements', r: rules, l: [] });
  }
  return out;
}

// Faculty words the calendar uses for its students ("non-math students").
const FACULTY_WORD = { math: 'Mathematics', mathematics: 'Mathematics', arts: 'Arts', science: 'Science', engineering: 'Engineering', environment: 'Environment', health: 'Health' };
/**
 * Who a plan is for, beyond the invalid combinations, from what the calendar says when declaring it: lim, a faculty
 * whose students alone can take it ("only open to students enrolled in a Faculty of Mathematics academic plan",
 * "open to students enrolled in any degree program in the Faculty of Mathematics"); soft, one it's mostly for
 * ("generally not available to students outside the Faculty of Mathematics"); notf, a faculty whose students
 * can't ("only open to non-math students"); nd, only students outside a degree program (its audience); paused, a
 * notice that it takes no new students. who: the calendar's sentence.
 */
export function eligibility(p) {
  const out = {};
  const sentences = (html) => plainText(html).split(/(?<=\.)\s+/);
  for (const s of sentences(p.text?.specialNotice))
    if (/\bpaused\b|not open to new (?:entrants|students|applicants|admissions)/i.test(s)) {
      out.paused = 1;
      out.who = s;
    }
  for (const s of [...sentences(p.text?.declarationRequirements), ...sentences(p.text?.admissionRequirements)]) {
    let m;
    if ((m = /\bonly (?:open|available) to students (?:enrolled )?(?:in|within) (?:an? |the )?Faculty of (\w+)/i.exec(s) ?? /\bopen to students enrolled in any degree program in the Faculty of (\w+)/i.exec(s))) out.lim = m[1];
    else if ((m = /\bgenerally not available to students outside (?:of )?the Faculty of (\w+)/i.exec(s))) out.soft = m[1];
    else if ((m = /\bonly open to non-(\w+) students/i.exec(s)) && FACULTY_WORD[m[1].toLowerCase()]) out.notf = FACULTY_WORD[m[1].toLowerCase()];
    else continue;
    out.who ??= s;
  }
  const audience = p.audience ?? [];
  if (audience.length && audience.every((a) => /open to students enrolled in any non- or post-degree academic plan/i.test(a) && !/degree programs? or/i.test(a))) {
    out.nd = 1;
    out.who ??= audience[0];
  }
  return out;
}

/** One calendar's programs, in the shape the app reads. */
export function pathwaysPrograms({ programs, combos }) {
  const list = programs.list.map((p) => {
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
    // An option's degrees ("Bachelor of Applied Science", "Bachelor of Science (Science)"), and who a plan is for.
    if (p.degrees?.length) out.deg = p.degrees;
    Object.assign(out, eligibility(p));
    const tu = totalUnits(p.text.graduationRequirements);
    if (tu?.subj) out.tsub = tu;
    else if (tu) out.tu = tu.u;
    if (p.type === 'Degree Requirements') {
      const tt = totalUnits(p.text.degreeRequirements, { all: true });
      if (tt.length) out.tt = tt;
      // Breadth and units by level, from the degree's prose, as sections of their own.
      out.req.push(...degreeProse(p.text.degreeRequirements, facultyKey(p.faculty)));
    }
    const avg = averages(p.text.minimumAverageSRequired);
    if (avg.length) out.avg = avg;
    // "Maximum failed or excluded course units (excluding COOP, PD): 2.0", "Maximum of unusable attempts: 5.0 units".
    const all = plainText(Object.values(p.text).join(' '));
    const fx = /Maximum failed or excluded course units \(excluding COOP, PD\): (\d+(?:\.\d+)?)/i.exec(all)?.[1] ?? /maximum of (\d+(?:\.\d+)?) units of failed or excluded courses/i.exec(all)?.[1];
    const ua = /Maximum of unusable attempts: (\d+(?:\.\d+)?) units/i.exec(all)?.[1] ?? /maximum of (\d+(?:\.\d+)?) units of unusable course attempts/i.exec(all)?.[1];
    if (fx) out.fx = Number(fx);
    if (ua) out.ua = Number(ua);
    const seq = sequences(p.text.coOperativeRequirementsUndergraduate);
    if (seq.length) out.seq = seq;
    // Systems of study: co: 1 when there's co-op, re: 1 when there's a regular (no co-op) way through.
    if (p.coop) out.co = 1;
    if (p.regular) out.re = 1;
    // A term-by-term program's usual load (engineering puts 6 or 7 in a term): the most its terms list.
    const ld = Math.max(0, ...out.req.filter((x) => /^\d[AB]\s+Term\b/i.test(x.h ?? '')).map((x) => termLoad(x.r)));
    if (ld > 5) out.ld = Math.min(7, ld);
    const cant = (combos?.get(p.pid) ?? []).flatMap((o) => o.to.map((q) => q.slug)).filter((s) => s !== p.slug);
    if (cant.length) out.cant = [...new Set(cant)];
    return out;
  });
  // Co-op sequences end up on the majors they're for; the degree charts they came from aren't needed after.
  const coop = coopSequences(list);
  for (const p of list) {
    if (p.t === 'Major') {
      if (coop.has(p.s)) p.seq = coop.get(p.s);
      else delete p.seq;
    } else delete p.seq;
  }
  return list;
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
