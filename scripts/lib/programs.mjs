// The calendar's programs: majors, minors, options, specializations, diplomas, certificates and degree
// requirements, from the same Kuali API as the courses (kuali.mjs). Endpoints:
//   GET /programs/{catalogId}        index: pid, id, code, title, undergraduateCredentialType, fieldOfStudy
//   GET /program/{catalogId}/{pid}   one program: requirement lists (the same "ruleView" HTML as requisites,
//                                    in sections like "Required Courses", "List 1", "1A Term") and text fields
//   GET /policy/{catalogId}/{pid}    one policy; S17gweg46 is Invalid Credential Combinations
// Pages: /programs/ (all of them), /programs/{slug}/ (one), /programs/combinations/ (what can't go together).
// Course pages get "Counts toward": every program that lists the course by name.
import { ageDays, getJson, pool, readCache, writeCache } from './http.mjs';
import { CALENDAR_PAGE, KUALI_BASE } from './kuali.mjs';
import { shell } from './render.mjs';
import { codesIn, esc, find, findAll, fmtCode, linkCodes, nodeToTree, norm, parseHtml, renderTree, slug, textOf } from './requisites.mjs';
import { fittingCodes, hints } from './pathways.mjs';

export const ICC_PID = 'S17gweg46'; // the Invalid Credential Combinations policy
const CACHE = '.cache/kuali';
const LIVE_MAX_AGE_DAYS = Number(process.env.KUALI_MAX_AGE_DAYS ?? 7);
const CONCURRENCY = Number(process.env.KUALI_CONCURRENCY ?? 6);

// Fields that hold requirement lists, in the order a program page shows them. The Graduate Calendar's: a study
// option's courses (thesis, master's research paper, coursework), a PhD's, a graduate diploma's.
const RULE_FIELDS = ['requiredCoursesTermByTerm', 'courseRequirementsNoUnits', 'requirements', 'specializationsYesrequired', 'courseListsNew', 'thesisOption', 'masterSResearchPaperOption', 'courseworkOption', 'graduateCourseRequirements', 'graduateDiplomaCourseRequirements'];
// Fields that hold prose, with the heading each gets on the page.
export const TEXT_FIELDS = [
  ['specialNotice', 'Notice'],
  ['graduationRequirements', 'Graduation requirements'],
  ['degreeRequirements', 'Degree requirements'],
  ['additionalConstraints', 'Additional constraints'],
  ['minimumAverageSRequired', 'Averages'],
  ['declarationRequirements', 'Declaring'],
  ['admissionRequirements', 'Admission'],
  ['coOperativeRequirementsUndergraduate', 'Co-op'],
  ['specializationDetails', 'Specializations'],
  ['detailsAndNotes', 'Notes'],
  // The Graduate Calendar's (gradprograms.mjs lays them out).
  ['degreeRequirementsGrad', 'Degree requirements'],
  ['thesisOptionCourseRequirementsRichText', 'Thesis option: courses'],
  ['thesisOptionMilestoneRequirements', 'Thesis option: milestones'],
  ['masterSResearchPaperOptionCourseRequirementsRichText', 'Master’s research paper option: courses'],
  ['masterSResearchPaperOptionMilestoneRequirements', 'Master’s research paper option: milestones'],
  ['courseworkOptionCourseRequirementsRichText', 'Coursework option: courses'],
  ['courseworkOptionMilestoneRequirements', 'Coursework option: milestones'],
  ['graduateCourseRequirementsRichTextPhd', 'Courses'],
  ['milestoneDetails', 'Milestones'],
  ['graduateDiplomaCourseRequirementsRichText', 'Courses'],
  ['admissionRequirementsApplicationMaterials', 'Application materials'],
  ['admissionRequirementsReferences', 'References'],
  ['lengthOfProgram', 'Length of the program'],
  ['graduateResearchFields', 'Research areas'],
  ['graduateSpecializations', 'Specializations'],
  ['acceleratedMasterSProgramDetails', 'Accelerated program'],
  ['additionalProgramInformation', 'More about the program'],
  ['deliveryModeInformation', 'Where it’s taught'],
  ['registrationOptionsInformation', 'Registration'],
];
// How program pages and lists order the kinds of credential.
export const TYPE_ORDER = ['Degree Requirements', 'Major', 'Specialization', 'Minor', 'Option', 'Diploma', 'Certificate'];
const TYPE_PLURAL = { 'Degree Requirements': 'Degree requirements', Major: 'Majors', Specialization: 'Specializations', Minor: 'Minors', Option: 'Options', Diploma: 'Diplomas', Certificate: 'Certificates', "Master's": 'Master’s programs', PhD: 'PhDs', 'Graduate Diploma': 'Graduate diplomas' };
export const typePlural = (t) => TYPE_PLURAL[t] ?? `${t}s`;

// ---------------- loading ----------------

/** Every program in a catalog, normalized. Past catalogs are cached forever; the live one refreshes weekly. */
export async function loadPrograms(cat) {
  const dir = `${CACHE}/${cat.id}/programs`;
  const cachedIndex = await readCache(`${dir}/index.json`);
  let index;
  if (cat.status === 'past' && cachedIndex?.data?.length) index = cachedIndex.data;
  else {
    try {
      index = await getJson(`${KUALI_BASE}/programs/${cat.id}`);
      await writeCache(`${dir}/index.json`, { fetchedAt: new Date().toISOString(), data: index });
    } catch (err) {
      if (!cachedIndex?.data?.length) throw err;
      console.warn(`! ${cat.name} programs index failed (${err.message}); using cached copy`);
      index = cachedIndex.data;
    }
  }
  index = (index ?? []).filter((e) => e?.pid);
  const details = new Map();
  let fetched = 0;
  let failed = 0;
  await pool(
    index,
    CONCURRENCY,
    async (entry) => {
      const path = `${dir}/${entry.pid}.json`;
      const hit = await readCache(path);
      const versionChanged = hit && entry.id && hit.version && hit.version !== entry.id;
      const stale = hit && cat.status !== 'past' && ageDays(hit.fetchedAt) > LIVE_MAX_AGE_DAYS;
      let detail = hit?.data ?? null;
      if (!hit || versionChanged || stale) {
        try {
          detail = await getJson(`${KUALI_BASE}/program/${cat.id}/${entry.pid}`);
          await writeCache(path, { fetchedAt: new Date().toISOString(), version: entry.id ?? null, data: detail });
          fetched++;
        } catch (err) {
          if (!detail) failed++;
          if (failed <= 10) console.warn(`  ! program ${entry.code ?? entry.pid}: ${err.message}${detail ? ' (kept cached copy)' : ''}`);
        }
      }
      details.set(entry.pid, detail);
    },
    `${cat.name} programs`,
    200,
  );
  console.log(`${cat.name} programs: ${index.length} (fetched ${fetched}, from cache ${index.length - fetched - failed}, failed ${failed})`);
  return readPrograms(index, details);
}

/** One policy page's body (HTML), or null. */
export async function loadPolicy(cat, pid) {
  const path = `${CACHE}/${cat.id}/policies/${pid}.json`;
  const hit = await readCache(path);
  if (hit && (cat.status === 'past' || ageDays(hit.fetchedAt) <= LIVE_MAX_AGE_DAYS)) return hit.data;
  try {
    const data = await getJson(`${KUALI_BASE}/policy/${cat.id}/${pid}`);
    await writeCache(path, { fetchedAt: new Date().toISOString(), data });
    return data;
  } catch (err) {
    console.warn(`! policy ${pid} failed (${err.message})${hit ? '; using cached copy' : ''}`);
    return hit?.data ?? null;
  }
}

// ---------------- reading ----------------

/** "H-Computer Science (BCS)" → "h-computer-science-bcs"; "ECON-Public Policy Specialization" → "econ-public-policy-specialization". */
export const programSlug = (code) =>
  String(code ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The name to show: specializations carry their major ("Public Policy Specialization (Economics)"). */
export function programName(p) {
  if (p.type === 'Specialization' && p.field && !p.title.toLowerCase().includes(p.field.toLowerCase())) return `${p.title} (${p.field})`;
  return p.title;
}

/**
 * One requirement field → its sections, each {heading, units, tree, lists}. Lists are the "List 1", "List 2"
 * sections some programs nest under a rule ("Complete 5 courses from List 1 and List 2").
 */
export function sectionsOf(html) {
  if (!html) return [];
  const root = parseHtml(html);
  const out = [];
  const visit = (node) => {
    for (const c of node.children ?? []) {
      if (!c.tag) continue;
      if (c.tag === 'section') out.push(readSection(c));
      else visit(c);
    }
  };
  visit(root);
  if (!out.length) {
    const tree = nodeToTree(root);
    if (tree) out.push({ heading: '', units: null, tree, lists: [] });
  }
  return out;
}

function readSection(sec) {
  const header = find(sec, (n) => n.tag === 'header');
  let heading = '';
  let units = null;
  if (header) {
    const h = find(header, (n) => /^h[1-6]$/.test(n.tag));
    heading = norm(h ? textOf(h) : '');
    const rest = norm(textOf(header).replace(heading, ''));
    const m = /(\d+(?:\.\d+)?)\s*Units? to Complete/i.exec(rest);
    if (m) units = Number(m[1]);
    header.parent.children = header.parent.children.filter((c) => c !== header);
  }
  const subs = [];
  const detach = (node) => {
    node.children = node.children.filter((c) => {
      if (c.tag === 'section') {
        subs.push(c);
        return false;
      }
      if (c.tag) detach(c);
      return true;
    });
  };
  detach(sec);
  return { heading, units, tree: nodeToTree(sec), lists: subs.map(readSection) };
}

/** Program links in a field: [{id, name}] ("#/programs/view/{id}" points at a program's version id). */
export function refsIn(html) {
  if (!html) return [];
  const out = [];
  for (const a of findAll(parseHtml(html), (n) => n.tag === 'a')) {
    const m = /#\/programs\/view\/([A-Za-z0-9]+)/.exec(a.attrs.href ?? '');
    if (m) out.push({ id: m[1], name: norm(textOf(a)) });
  }
  return out;
}

export function normalizeProgram(entry, d) {
  d = d ?? {};
  const names = (list) => (Array.isArray(list) ? list.map((x) => norm(x?.name)).filter(Boolean) : []);
  // A graduate program's switches ({fall: true, winter: false}) → the ones that are on.
  const on = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).filter((k) => o[k] === true) : []);
  const kinds = names(d.programTypesCheckboxes);
  const p = {
    pid: entry.pid,
    id: d.id ?? entry.id ?? null,
    code: norm(d.code ?? entry.code ?? entry.pid),
    title: norm(d.title ?? entry.title ?? ''),
    type: norm(d.undergraduateCredentialType?.name ?? entry.undergraduateCredentialType?.name ?? d.graduateCredentialType?.name ?? ''),
    field: norm(d.fieldOfStudy?.name ?? entry.fieldOfStudy?.name ?? d.graduateFieldOfStudy?.name ?? entry.graduateFieldOfStudy?.name ?? ''),
    faculty: norm(d.facultyCalendarDisplay?.name ?? entry.facultyCalendarDisplay?.name ?? ''),
    level: d.graduateCredentialType || entry.graduateCredentialType ? 'grad' : 'ug',
    // Graduate: the academic unit ("David R. Cheriton School of Computer Science"), study options (Thesis,
    // Master's Research Paper, Coursework), kinds (Co-operative, Collaborative, Internship, Joint, Diploma), the
    // terms it admits in, full- and part-time, on campus and online.
    unit: norm(d.groupFilter2?.name ?? ''),
    options: names(d.studyOptionsForCalendar),
    kinds,
    admit: on(d.admitTerms),
    reg: on(d.registrationOptions),
    delivery: on(d.deliveryModes),
    coop: Boolean(d.systemsOfStudy?.coOperative) || kinds.includes('Co-operative'),
    regular: Boolean(d.systemsOfStudy?.regular),
    online: names(d.onlineDegree),
    audience: names(d.declarationAudience),
    degrees: names(d.optionIsAvailableForStudentsInTheFollowingDegrees),
    availableTo: refsIn(d.specializationIsAvailableForStudentsInTheFollowingMajorsRules),
    specializationRefs: refsIn(d.specializationsList),
    sections: RULE_FIELDS.flatMap((f) => sectionsOf(d[f]).map((s) => ({ ...s, field: f }))),
    text: Object.fromEntries(TEXT_FIELDS.map(([f]) => [f, typeof d[f] === 'string' ? d[f] : ''])),
    missing: !entry || !d.pid,
  };
  // A few graduate programs have no code (Accelerated Master's Program in Biostatistics): their title then.
  p.slug = programSlug(d.code ?? entry.code ? p.code : p.title);
  p.name = programName(p);
  return p;
}

/** Index + details → {list, bySlug, byId}, sorted by name. */
export function readPrograms(index, details) {
  const list = index.map((e) => normalizeProgram(e, details.get(e.pid))).filter((p) => p.slug && p.title);
  list.sort((a, b) => a.name.localeCompare(b.name));
  const bySlug = new Map();
  for (const p of list) {
    let s = p.slug;
    for (let i = 2; bySlug.has(s); i++) s = `${p.slug}-${i}`;
    p.slug = s;
    bySlug.set(s, p);
  }
  const byId = new Map(list.filter((p) => p.id).map((p) => [p.id, p]));
  return { list, bySlug, byId };
}

// ---------------- which courses a program lists ----------------

/** How one rule uses its courses, in a few words: "Required", "Choose 2 of 10", "Can’t count"… */
function ruleRole(lead, count, inChoice) {
  let m;
  if (/^Complete all\b/i.test(lead)) return inChoice ? 'One of the options' : 'Required';
  if ((m = /^Complete (\d+(?:\.\d+)?) of the following/i.exec(lead))) return `Choose ${m[1]} of ${count}`;
  if (/^Choose any of the following/i.test(lead)) return 'On the list';
  if ((m = /^Complete no more than (\d+(?:\.\d+)?)/i.exec(lead))) return `At most ${m[1]} from a list`;
  if (/cannot be used/i.test(lead)) return 'Can’t count';
  return 'Listed';
}

/** Every course a program names → [roles], e.g. CS135 → ["1A Term: Required"]. */
export function courseRoles(p) {
  const out = new Map();
  const add = (code, role) => {
    if (!out.has(code)) out.set(code, []);
    if (!out.get(code).includes(role)) out.get(code).push(role);
  };
  const label = (heading, role) => {
    if (!heading || /^Required Courses$/i.test(heading)) return role;
    if (role === 'On the list' || role === 'Listed') return heading;
    return `${heading}: ${role}`;
  };
  const walk = (nodes, heading, inChoice) => {
    for (const n of nodes ?? []) {
      if (n.type === 'group') walk(n.items, heading, inChoice || /^Complete \d+(?:\.\d+)? of/i.test(norm(n.lead)));
      else if (n.type === 'rule') for (const c of n.courses) add(c.code, label(heading, ruleRole(norm(n.lead), n.courses.length, inChoice)));
      else for (const code of codesIn(n.text)) add(code, label(heading, 'Mentioned'));
    }
  };
  const section = (s, outer) => {
    const heading = s.heading || outer;
    walk(s.tree, heading, false);
    for (const l of s.lists) section(l, heading);
  };
  for (const s of p.sections) section(s, '');
  return out;
}

/** Course code → [{program, roles}], for "Counts toward" on course pages. */
export function countsToward(programs) {
  const out = new Map();
  for (const p of programs.list) {
    for (const [code, roles] of courseRoles(p)) {
      if (!out.has(code)) out.set(code, []);
      out.get(code).push({ p, roles });
    }
  }
  return out;
}

// ---------------- invalid credential combinations ----------------

/**
 * The Invalid Credential Combinations policy → {rulesHtml, rows}. rulesHtml is everything but the table (the
 * general rules, in the calendar's words); rows are [{plan, faculty, cannot: [names]}], one per table row.
 */
export function parseCombinations(html) {
  if (!html) return { rulesHtml: '', rows: [] };
  const root = parseHtml(html);
  const table = find(root, (n) => n.tag === 'table');
  const rows = [];
  if (table) {
    for (const tr of findAll(table, (n) => n.tag === 'tr')) {
      const cells = tr.children.filter((c) => c.tag === 'td');
      if (cells.length < 3) continue;
      const parts = [];
      const collect = (n, buf) => {
        for (const c of n.children) {
          if (c.text !== undefined) buf.push(c.text);
          else if (c.tag === 'br' || c.tag === 'p' || c.tag === 'li') {
            if (c.tag !== 'br') collect(c, buf);
            buf.push('\n');
          } else collect(c, buf);
        }
        return buf;
      };
      for (const piece of splitNames(collect(cells[2], []).join(''))) {
        const t = cleanName(piece);
        if (t) parts.push(t);
      }
      const plan = cleanName(textOf(cells[0]));
      if (plan) rows.push({ plan, faculty: norm(textOf(cells[1])), cannot: parts });
    }
    table.parent.children = table.parent.children.filter((c) => c !== table);
  }
  return { rulesHtml: root, rows };
}

/** Split a cell on ";" and line breaks, but not inside parentheses ("Aviation Specialization (A major; B major)"). */
function splitNames(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === '\n') && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const cleanName = (s) => norm(s).replace(/[;,:]+$/, '').trim();

const normName = (s) =>
  norm(String(s ?? '').replace(/\*/g, '').replace(/&/g, ' and ').replace(/’/g, "'"))
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

/** The names the combinations table might use for a program. */
function namesFor(p) {
  const out = new Set();
  const t = normName(p.title);
  out.add(t);
  const base = t.replace(/\s*\([^)]*\)\s*$/, '');
  const paren = /\(([^)]*)\)\s*$/.exec(t)?.[1] ?? '';
  if (p.type === 'Major') {
    out.add(base);
    out.add(`${base} major`);
    if (/joint/.test(paren) || /^jh-/i.test(p.code)) {
      out.add(`${base}, joint`);
      out.add(`${base} joint`);
    }
    const deg = /^(bachelor of .+?)\s*(?:-|$)/.exec(paren)?.[1]?.trim();
    if (deg === `bachelor of ${base}`) out.add(`${base}, bachelor of`);
  }
  if (p.type === 'Specialization' && p.field) out.add(`${t} (${normName(p.field)} major)`);
  const dc = /^(diploma|certificate) (in|of) (.+)$/.exec(t);
  if (dc) out.add(`${dc[3]}, ${dc[1]} ${dc[2]}`);
  // "Bachelor of Mathematics Degree Requirements" is what the table calls "Mathematics, Bachelor of".
  const dr = p.type === 'Degree Requirements' && /^bachelor of (.+?) degree requirements/.exec(t);
  if (dr) out.add(`${dr[1]}, bachelor of`);
  return out;
}

// Degree abbreviations the table uses in parentheses: "Data Science (BCS)", "Mathematical Economics major (BA or BMath)".
const DEGREES = {
  ba: 'bachelor of arts',
  bsc: 'bachelor of science',
  bmath: 'bachelor of mathematics',
  bcs: 'bachelor of computer science',
  bes: 'bachelor of environmental studies',
  basc: 'bachelor of applied science',
  bse: 'bachelor of software engineering',
  bki: 'bachelor of knowledge integration',
  bph: 'bachelor of public health',
  bsw: 'bachelor of social work',
  bbm: 'bachelor of business management',
};
/** The degrees a parenthesis names, as they appear in program titles; [] when it names none. */
function degreesIn(paren) {
  const out = new Set();
  for (const m of paren.matchAll(/bachelor of [a-z ]+?(?=\s*(?:,|;|\)|$| or | and ))/g)) out.add(m[0].trim());
  for (const w of paren.split(/[^a-z]+/)) if (DEGREES[w]) out.add(DEGREES[w]);
  return [...out];
}
const plain = (s) => s.replace(/s\b/g, ''); // "communications studies" ~ "communication studies"
const baseOf = (p) => normName(p.title).replace(/\s*\([^)]*\)\s*$/, '');

export function nameIndex(programs) {
  const index = new Map();
  const put = (n, p) => {
    if (!index.has(n)) index.set(n, new Set());
    index.get(n).add(p);
  };
  for (const p of programs.list) {
    for (const n of namesFor(p)) {
      put(n, p);
      put(`~${plain(n)}`, p);
    }
  }
  return index;
}

/**
 * Names the table still uses for programs the calendar has since renamed (the policy's own rule covers "the same
 * credential that has been renamed"). Each one checked: Recreation and Sport Business's page on uwaterloo.ca
 * (future-students/programs/recreation-and-sport-business) is now "Sport and Recreation Management degree", and
 * the 2023–24 Technical Writing Minor's course list is the 2026–27 Technical and Professional Writing Minor's.
 */
const RENAMED = new Map([
  ['recreation and sport business major', 'sport and recreation management major'],
  ['technical writing minor', 'technical and professional writing minor'],
]);
export const renamedTo = (name) => RENAMED.get(normName(name)) ?? null;

/**
 * A whole degree, "Mathematics, Bachelor of": every major that leads to it (Pure Mathematics, Statistics, the BBA and
 * BMath double degree…) and its degree requirements. Not "Bachelor of Science and Financial Management" for
 * "Science, Bachelor of": the degree's name has to end there.
 */
function degreePrograms(degree, programs) {
  const at = new RegExp(`\\(${degree}(?:\\s*[-,)]|\\s*$| and bachelor of )|\\band ${degree}(?:\\s*[-,)]|\\s*$)`);
  return programs.list.filter((p) => (p.type === 'Major' && at.test(normName(p.title))) || (p.type === 'Degree Requirements' && normName(p.title).startsWith(`${degree} degree requirements`)));
}

/** The programs a name in the combinations table refers to ([] when it's a group like "Any stand-alone major"). */
export function matchName(name, index, programs) {
  const alias = renamedTo(name);
  if (alias) return matchName(alias, index, programs);
  const n = normName(name).replace(/\bbcs double degree\b/, 'computer science double degree').replace(/\bbmath double degree\b/, 'mathematics double degree');
  const degree = /^(.+), bachelor of$/.exec(n);
  if (degree) {
    const all = degreePrograms(`bachelor of ${degree[1]}`, programs);
    if (all.length) return all;
  }
  const paren = /\(([^)]*)\)/.exec(n)?.[1] ?? '';
  const degrees = degreesIn(paren);
  const narrow = (list) => {
    if (!degrees.length) return list;
    const hit = list.filter((p) => degrees.some((d) => normName(p.title).includes(d)));
    return hit.length ? hit : list;
  };
  const look = (keys) => {
    const found = new Set();
    for (const k of keys) for (const p of index.get(k) ?? []) found.add(p);
    return [...found];
  };
  // 1. The name as written, or both halves of "X Minor, or Diploma in".
  const both = /^(.+?) minor,? or diploma(?: in)?$/.exec(n);
  let hit = look(both ? [n, `${both[1]} minor`, `${both[1]}, diploma in`] : [n]);
  if (hit.length) return narrow(hit);
  // 2. A specialization of named majors: "Business Specialization (Computer Science major, BCS or BMath)",
  //    "Aviation Specialization (A major; B major)".
  const spec = /^(.+? specialization) \((.+)\)$/.exec(n);
  if (spec) {
    const out = new Set();
    const majors = spec[2].split(';').map((part) => norm(part.split(/ majors?\b|[,.]/)[0]));
    for (const major of majors) for (const p of programs.list) if (p.type === 'Specialization' && normName(p.title) === spec[1] && normName(p.field) === major) out.add(p);
    if (out.size) return [...out];
    // A specialization since renamed ("Biomechanics and Rehabilitation" → "Biomechanical and Rehabilitation
    // Engineering"): within the same major, the one whose words mostly match.
    const stems = (s) => new Set(s.split(/[^a-z]+/).filter((w) => w.length > 3 && w !== 'specialization').map((w) => w.slice(0, 6)));
    const want = stems(spec[1]);
    const close = programs.list.filter((p) => {
      if (p.type !== 'Specialization' || !majors.includes(normName(p.field))) return false;
      const have = stems(normName(p.title));
      return [...want].filter((w) => have.has(w)).length * 2 >= want.size && want.size > 1;
    });
    if (close.length === 1) return close;
  }
  // 3. Without its parentheses ("Actuarial Science major (Honours and Joint Honours)") or a trailing "plans".
  const stripped = n.replace(/\s*\([^)]*\)/g, '').replace(/ plans?$/, '').trim();
  hit = look([stripped]);
  if (hit.length) return narrow(hit);
  // 4. Every major of a family: "English majors", "Fine Arts major", "Mathematical Optimization major (all specializations)".
  const fam = /^(.+?) majors?$/.exec(stripped);
  if (fam) {
    hit = programs.list.filter((p) => p.type === 'Major' && (baseOf(p) === fam[1] || baseOf(p).startsWith(`${fam[1]} - `)));
    if (hit.length) return narrow(hit);
  }
  // 5. Spelling slips like "Communications Studies".
  hit = look([`~${plain(n)}`, `~${plain(stripped)}`]);
  if (hit.length) return narrow(hit);
  if (spec) {
    const only = programs.list.filter((p) => p.type === 'Specialization' && normName(p.title) === spec[1]);
    if (only.length === 1) return only;
  }
  return [];
}

/**
 * The table's groups, which matchName leaves alone: "Any stand-alone major" (every major but the joint honours plans,
 * which are made to be paired), "Any other stand-alone major" (not the row's own field: Mathematical Economics' other
 * version, the French majors for the French Teaching Specialization), "Any other stand-alone Arts major" (that
 * faculty's), "Any other stand-alone or Mathematics Joint plan" (the Faculty of Mathematics' joint honours plans too).
 * → programs, or [] for a group it can't read ("Any plan similar to one on the student's Laurier record").
 */
/**
 * A major taken with another isn't a stand-alone one: Arts and Business says "Complete the requirements for a Faculty
 * of Arts honours major or Honours Liberal Studies", so Liberal Studies' "Any other stand-alone Arts major" leaves it be.
 */
const flatText = new WeakMap();
const takenWithAnother = (p) => {
  if (!flatText.has(p)) flatText.set(p, norm(JSON.stringify([p.sections ?? [], p.text ?? {}]).replace(/<[^>]+>/g, ' ')));
  return /\bcomplete the requirements for (?:a|an|another) [^.]{0,80}?\bmajor\b/i.test(flatText.get(p));
};

export function groupOf(text, subjects, programs) {
  const t = norm(text).toLowerCase();
  // "any second English major" (for English majors): the family's others, per program (combosFor leaves each out).
  const second = /^any second (.+?) majors?$/.exec(t);
  if (second) return programs.list.filter((p) => p.type === 'Major' && (baseOf(p) === second[1] || baseOf(p).startsWith(`${second[1]} - `)));
  const major = /^any (other )?stand-alone (?:([a-z]+) )?majors?$/.exec(t);
  const plus = /^any (other )?stand-alone or ([a-z]+) joint (?:honours )?plans?$/.exec(t);
  const m = major ?? plus;
  if (!m) return [];
  const fac = major ? (m[2] ?? null) : null;
  const jointFac = plus ? m[2] : null;
  const own = new Set(subjects.map((q) => normName(q.field ?? '')).filter(Boolean));
  const inFac = (p, f) => new RegExp(`\\b${f}\\b`, 'i').test(p.faculty ?? '');
  return programs.list.filter((p) => {
    if (p.type !== 'Major' || subjects.includes(p) || takenWithAnother(p)) return false;
    if (m[1] && own.has(normName(p.field ?? ''))) return false;
    if (/joint honours/i.test(p.title ?? p.name ?? '')) return Boolean(jointFac && inFac(p, jointFac));
    return !fac || inFac(p, fac);
  });
}

/**
 * Per program, what the table says it can't be combined with, both ways round:
 * pid → [{text, to: [programs]}]. Also returns how much of the table matched. A group ("Any stand-alone major") is
 * kept as written on its program's page, and each major it covers gets one line for all of them ("Programs that take
 * no other major", back: true: Pathways checks both ways round, so its data needs only the first).
 */
export function combosFor(rows, programs, rulesHtml = null) {
  const index = nameIndex(programs);
  const out = new Map(programs.list.map((p) => [p.pid, new Map()]));
  let plans = 0;
  let names = 0;
  let matched = 0;
  for (const row of rows) {
    const subjects = matchName(row.plan, index, programs);
    if (subjects.length) plans++;
    const others = row.cannot.map((text) => {
      const to = matchName(text, index, programs);
      const group = to.length ? [] : groupOf(text, subjects, programs);
      return group.length ? { text, to: group, group: true } : { text, to };
    });
    names += others.length;
    matched += others.filter((o) => o.to.length).length;
    row.to = subjects;
    row.others = others;
    for (const p of subjects) {
      for (const o of others) {
        if (o.group && /^any second /i.test(o.text)) out.get(p.pid).set(o.text, { ...o, to: o.to.filter((q) => q !== p) });
        else if (!o.to.includes(p)) out.get(p.pid).set(o.text, o);
      }
    }
    for (const o of others) {
      for (const q of o.to) {
        if (subjects.includes(q)) continue;
        if (!o.group) out.get(q.pid).set(row.plan, { text: row.plan, to: subjects });
        else if (/^any second /i.test(o.text)) continue;
        else {
          const solo = out.get(q.pid).get('solo') ?? { text: 'Programs that take no other major', to: [], rule: true, back: true };
          for (const x of subjects) if (!solo.to.includes(x)) solo.to.push(x);
          out.get(q.pid).set('solo', solo);
        }
      }
    }
  }
  // A program that takes no other major already says so: the line for the others it's covered by adds nothing.
  for (const entries of out.values()) if ([...entries.values()].some((o) => o.group)) entries.delete('solo');
  // The general rules: no two "and Financial Management" bachelor's degrees,
  const fm = programs.list.filter((p) => p.type === 'Major' && / and financial management$/.test(baseOf(p)));
  if (rulesHtml && /“and Financial Management” bachelor|"and Financial Management" bachelor/.test(textOf(typeof rulesHtml === 'string' ? parseHtml(rulesHtml) : rulesHtml))) {
    for (const p of fm) {
      const others = fm.filter((q) => q !== p && baseOf(q) !== baseOf(p));
      if (others.length) out.get(p.pid).set('fm', { text: 'Another “and Financial Management” degree', to: others, rule: true });
    }
  }
  // no more than one "topic" specialization in some majors, and no two intensive specializations of one major.
  const topics = topicMajors(rulesHtml);
  for (const p of programs.list) {
    if (p.type !== 'Specialization' || !p.field) continue;
    const intensive = /\bintensive\b/i.test(p.title);
    const field = normName(p.field);
    const siblings = programs.list.filter((q) => q !== p && q.type === 'Specialization' && normName(q.field) === field && /\bintensive\b/i.test(q.title) === intensive);
    if (!siblings.length) continue;
    if (intensive) out.get(p.pid).set(`intensive:${field}`, { text: `Another intensive specialization in ${p.field}`, to: siblings, rule: true });
    else if (topics.has(field)) out.get(p.pid).set(`topic:${field}`, { text: `Another ${p.field} topic specialization: one at most`, to: siblings, rule: true });
  }
  return { byProgram: new Map([...out].map(([k, v]) => [k, tidyCombos([...v.values()])])), stats: { rows: rows.length, plans, names, matched } };
}

/**
 * The policy's general rules (above its table), pair by pair, onto each program's "can't be combined with": one line
 * per rule naming the programs it rules out (or how many, past a dozen), not repeating ones the table names. clash
 * is engine.js's planClash on Pathways' shape of each program (shaped: pathwaysPrograms), so the pages and Pathways
 * read the rules the same way. Pathways' data leaves these out (general: true): its app applies the rules itself.
 */
export function addGeneralCombos(byProgram, programs, shaped, clash) {
  const bySlug = new Map(shaped.map((x) => [x.s, x]));
  for (const p of programs.list) {
    const a = bySlug.get(p.slug);
    if (!a) continue;
    const rules = new Map();
    for (const q of programs.list) {
      const b = q !== p && bySlug.get(q.slug);
      const why = b ? clash(a, b) : '';
      if (!why) continue;
      if (!rules.has(why)) rules.set(why, []);
      rules.get(why).push(q);
    }
    const list = byProgram.get(p.pid) ?? [];
    const named = new Set(list.flatMap((o) => o.to));
    for (const [why, to] of rules) {
      const rest = to.filter((q) => !named.has(q));
      if (rest.length) list.push({ text: `${why[0].toUpperCase()}${why.slice(1)}`, to: rest, rule: true, general: true });
    }
    byProgram.set(p.pid, list);
  }
  return byProgram;
}

/** Majors the general rules limit to one "topic" specialization ("Economics (maximum of one topic specialization)"). */
export function topicMajors(rulesHtml) {
  const out = new Set();
  if (!rulesHtml) return out;
  const root = typeof rulesHtml === 'string' ? parseHtml(rulesHtml) : rulesHtml;
  for (const li of findAll(root, (n) => n.tag === 'li' && !find(n, (c) => c.tag === 'li'))) {
    const m = /^(.+?)\s*\(maximum of one topic specialization\)/i.exec(norm(textOf(li)));
    if (m) out.add(normName(m[1].replace(/,\s*(BA|BMath|BSc)$/i, '')));
  }
  return out;
}

/**
 * One program's "can't be combined with" entries, without repeats: entries naming the same programs collapse,
 * and an entry like "Gerontology Minor or Diploma" goes when both are already listed on their own.
 */
function tidyCombos(entries) {
  const singles = new Set(entries.filter((e) => e.to.length === 1 && !e.rule).map((e) => e.to[0]));
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = e.to.length ? e.to.map((q) => q.slug).sort().join('|') : `text:${normName(e.text)}`;
    if (seen.has(key)) continue;
    if (!e.rule && e.to.length > 1 && e.to.every((q) => singles.has(q))) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// ---------------- rendering ----------------

const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'sup', 'sub', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption']);

/** A program's prose field → safe HTML: course codes link to uwloo, program links to their uwloo pages. */
export function richText(html, { known, byId = new Map(), cat }) {
  if (!html) return '';
  const root = typeof html === 'string' ? parseHtml(html) : html;
  const walk = (n) => {
    if (n.text !== undefined) return linkCodes(n.text, known);
    if (n.tag === 'script' || n.tag === 'style') return '';
    if (n.tag === 'br') return '<br>';
    if (n.tag === 'hr') return '<hr>';
    if (n.tag === 'a') {
      const href = n.attrs.href ?? '';
      const text = norm(textOf(n));
      let m;
      if ((m = /#\/programs\/view\/([A-Za-z0-9]+)/.exec(href))) {
        const p = byId.get(m[1]);
        return p ? `<a href="${programPath(p)}">${esc(text)}</a>` : esc(text);
      }
      if (/#\/courses\//.test(href)) return linkCodes(text, known);
      if ((m = /#\/policy\/([A-Za-z0-9]+)/.exec(href))) return m[1] === ICC_PID ? `<a href="/programs/combinations/">${esc(text)}</a>` : `<a href="${esc(`${cat?.pageUrl ?? CALENDAR_PAGE}#/policy/${m[1]}`)}">${esc(text)}</a>`;
      if (/^(https?:|mailto:)/i.test(href)) return `<a href="${esc(href)}">${esc(text)}</a>`;
      return linkCodes(text, known);
    }
    const inner = n.children.map(walk).join('');
    if (/^h[1-6]$/.test(n.tag)) return `<h4>${inner}</h4>`;
    if (ALLOWED.has(n.tag)) return `<${n.tag}>${inner}</${n.tag}>`;
    if (n.tag === 'div') return `${inner} `;
    return inner;
  };
  const out = walk(root).trim();
  return norm(out.replace(/<[^>]*>/g, '')) ? out : '';
}

/** A program's page: /programs/{slug}/, or /programs/grad/{slug}/ for the Graduate Calendar's. */
export const programPath = (p) => (p.level === 'grad' ? `/programs/grad/${p.slug}/` : `/programs/${p.slug}/`);
const programLink = (p) => `<a href="${programPath(p)}">${esc(p.name)}</a>`;
const programHref = (byId) => (href) => {
  const m = /#\/programs\/view\/([A-Za-z0-9]+)/.exec(href);
  const p = m && byId.get(m[1]);
  return p ? programPath(p) : null;
};

export function sectionHtml(s, known, byId, depth = 3, words = null) {
  const units = s.units != null ? ` <span class="t">${esc(s.units)} units</span>` : '';
  const head = s.heading ? `<h${depth}>${esc(s.heading)}${units}</h${depth}>` : '';
  const tree = s.tree ? renderTree(s.tree, known, programHref(byId), { words }) : '';
  const lists = s.lists.map((l) => sectionHtml(l, known, byId, Math.min(depth + 1, 5), words)).join('');
  return head || tree || lists ? `<div class="psec">${head}${tree}${lists}</div>` : '';
}

/** Who a program is open to: majors (specializations), degrees (options), or the calendar's audience line. */
function openTo(p, byId) {
  const majors = p.availableTo.map((r) => (byId.get(r.id) ? programLink(byId.get(r.id)) : esc(r.name)));
  if (majors.length) return majors.join(', ');
  if (p.degrees.length) return p.degrees.map(esc).join(', ');
  return p.audience.map(esc).join(' ');
}

/**
 * After a rule in words on a program page ("Complete 2.0 additional units of ECON courses at the 200-level or
 * above"): the calendar's courses that fit it, and their subject's page, so the list is one tap away rather than
 * a subject page away. courses: the calendar's (code → {title}); subjects: the ones with a page this year.
 */
export function fitsHtml(text, { courses, subjects, yearCode }) {
  const h = hints(text);
  if (!(h.u || h.nc) || !(h.subj || h.rg) || !courses?.size) return '';
  const codes = fittingCodes(h, courses.keys());
  if (!codes.length) return '';
  const subj = [...new Set(h.subj ?? h.rg.map((r) => r[0]))].filter((x) => subjects?.has(x));
  const links = codes.map((c) => `<a class="cc" href="/${slug(c)}/" title="${esc(courses.get(c)?.title ?? '')}">${esc(fmtCode(c))}</a>`).join(' ');
  return `<details class="fits"><summary>${codes.length === 1 ? '1 course fits' : `${codes.length} courses fit`}</summary><p class="fits-l">${links}</p>${subj.length && yearCode ? `<p class="t">${subj.map((x) => `<a href="/${yearCode}/${slug(x)}/">Every ${esc(x)} course</a>`).join(' · ')}, with descriptions and requisites.</p>` : ''}</details>`;
}

export function programPage({ p, programs, combos, cat, known, courses = null, subjects = null, builtAt, version }) {
  const { byId } = programs;
  const systems = [p.regular && 'Regular', p.coop && 'Co-op'].filter(Boolean).join(', ');
  const open = openTo(p, byId);
  const facts = [
    ['Type', esc(p.type)],
    p.faculty && ['Faculty', esc(p.faculty)],
    p.field && p.type !== 'Degree Requirements' && ['Field', esc(p.field)],
    systems && ['Study', esc(systems)],
    p.online.length && ['Online', esc(p.online.join(' '))],
    open && ['Open to', open],
  ].filter(Boolean);
  const text = (f) => richText(p.text[f], { known, byId, cat });
  const prose = (f, heading, id) => {
    const h = text(f);
    return h ? `<section aria-labelledby="${id}"><h2 id="${id}">${esc(heading)}</h2><div class="notes">${h}</div></section>` : '';
  };
  const words = courses ? (text) => fitsHtml(text, { courses, subjects, yearCode: cat.yearCode }) : null;
  const sections = p.sections.map((s) => sectionHtml(s, known, byId, 3, words)).join('');
  const specs = p.specializationRefs.map((r) => byId.get(r.id)).filter(Boolean);
  const cant = combos?.get(p.pid) ?? [];
  const cantItem = (o) => {
    const gone = /\*/.test(o.text);
    const lost = !gone && !o.to.length && looksLikeProgram(o.text);
    const label = esc(o.text.replace(/\*/g, '').trim());
    const names = (to) => to.map((q) => `<a href="/programs/${q.slug}/">${esc(q.name)}</a>`).join(', ');
    if (o.general) return `<li>${label} <span class="t">(${o.to.length > 12 ? `${o.to.length} ${o.to.every((q) => q.type === 'Major') ? 'majors' : 'programs'}` : names(o.to)})</span></li>`;
    const links = o.group
      ? `${label} <span class="t">(${o.to.length} ${o.to.every((q) => q.type === 'Major') ? 'majors' : 'programs'}${/^any second /i.test(o.text) ? '' : `: every one but joint honours plans${/other/i.test(o.text) ? ' and its own' : ''}`})</span>`
      : renamedTo(o.text) && o.to.length
        ? `${label} <span class="t">(renamed since: ${o.to.map((q) => `<a href="/programs/${q.slug}/">${esc(q.name)}</a>`).join(', ')})</span>`
      : o.to.length === 1 && !o.rule
        ? programLink(o.to[0])
        : o.to.length
          ? `${label} <span class="t">(${o.to.map((q) => `<a href="/programs/${q.slug}/">${esc(q.name)}</a>`).join(', ')})</span>`
          : label;
    return `<li>${links}${gone ? ' <span class="t">(no longer offered)</span>' : lost ? ` <span class="t">(not in the ${esc(cat.label)} calendar by this name)</span>` : ''}</li>`;
  };
  const calUrl = `${cat.pageUrl}#/programs/${p.pid}`;
  // "Economics (Bachelor of Arts - Honours)": the name large, the degree under it.
  const split = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(p.name);
  const h1 = split ? `<span class="title">${esc(split[1])}</span><span class="psub">${esc(split[2])}</span>` : `<span class="title">${esc(p.name)}</span>`;
  const body = `<article class="course program">
<header class="course-head">
  <p class="kicker"><a href="/programs/">Programs</a> · ${esc(p.type)}</p>
  <h1>${h1}</h1>
  <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  <p class="plan-link"><a href="/pathways/#add=${esc(p.slug)}">Map it out term by term in Pathways</a>${p.type === 'Degree Requirements' ? '' : ` <span class="t">or</span> <a href="/pathways/#show=${esc(p.slug)}">pick electives from its courses</a>`}</p>
</header>
${p.text.specialNotice ? `<div class="gone-note">${text('specialNotice')}</div>` : ''}
${prose('graduationRequirements', 'Graduation requirements', 'grad-h')}
${sections ? `<section aria-labelledby="req-h"><h2 id="req-h">Courses</h2>${sections}</section>` : ''}
${prose('degreeRequirements', 'Degree requirements', 'deg-h')}
${prose('additionalConstraints', 'Additional constraints', 'add-h')}
${
  specs.length || p.text.specializationDetails
    ? `<section aria-labelledby="spec-h"><h2 id="spec-h">Specializations</h2>${text('specializationDetails') ? `<div class="notes">${text('specializationDetails')}</div>` : ''}${specs.length ? `<ul class="plinks">${specs.map((q) => `<li>${programLink(q)}</li>`).join('')}</ul>` : ''}</section>`
    : ''
}
${prose('minimumAverageSRequired', 'Averages', 'avg-h')}
${prose('declarationRequirements', 'Declaring', 'dec-h')}
<section aria-labelledby="icc-h"><h2 id="icc-h">Can’t be combined with</h2>${
    cant.length
      ? `<ul class="plinks">${cant.map(cantItem).join('')}</ul><p class="t">From the calendar’s <a href="/programs/combinations/">${cant.some((o) => !o.rule) ? `table of invalid credential combinations${cant.some((o) => o.rule) ? ' and the general rules above it' : ''}` : 'general rules on combining credentials'}</a>. Confirm a combination with an academic advisor before you declare it.</p>`
      : `<p class="none">Nothing in the calendar’s table of invalid credential combinations. Its <a href="/programs/combinations/">general rules</a> still apply, such as no minor in the same subject as your major.</p>`
  }</section>
${prose('admissionRequirements', 'Admission', 'adm-h')}
${prose('coOperativeRequirementsUndergraduate', 'Co-op', 'coop-h')}
${prose('detailsAndNotes', 'Notes', 'notes-h')}
<section aria-labelledby="out-h"><h2 id="out-h">In the official calendar</h2><ul class="out"><li><a href="${esc(calUrl)}">${esc(p.name)}</a><small>${esc(cat.label)} Undergraduate Calendar</small></li></ul></section>
</article>`;
  return shell({
    title: `${p.name} | uwloo`,
    description: `${p.name} at the University of Waterloo: required courses, electives, averages, and what it can’t be combined with.`,
    path: `/programs/${p.slug}/`,
    body,
    builtAt,
    version,
  });
}

const FACULTY_ORDER = ['Faculty of Arts', 'Faculty of Engineering', 'Faculty of Environment', 'Faculty of Health', 'Faculty of Mathematics', 'Faculty of Science'];
const facultyRank = (f) => {
  const i = FACULTY_ORDER.indexOf(f);
  return i >= 0 ? i : f.startsWith('Faculties') ? 6 : 7;
};

const DEGREE_ABBR = Object.fromEntries(Object.entries(DEGREES).map(([k, v]) => [v, { ba: 'BA', bsc: 'BSc', bmath: 'BMath', bcs: 'BCS', bes: 'BES', basc: 'BASc', bse: 'BSE', bki: 'BKI', bph: 'BPH', bsw: 'BSW', bbm: 'BBM' }[k]]));

/** Majors that share a name ("Economics (Bachelor of Arts - Honours)", "… - Four-Year General") as one line. */
function majorLines(list) {
  const groups = new Map();
  for (const p of list) {
    const base = p.title.replace(/\s*\([^)]*\)\s*$/, '');
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }
  const search = (p) => `${p.name} ${p.type} ${p.field} ${p.faculty} ${p.coop ? 'co-op coop' : ''}`.toLowerCase();
  return [...groups]
    .map(([base, ps]) => {
      if (ps.length === 1) return `<li data-s="${esc(search(ps[0]))}">${programLink(ps[0])}</li>`;
      const parts = ps.map((p) => {
        const paren = /\(([^)]*)\)\s*$/.exec(p.title)?.[1] ?? p.title;
        const [degree, ...rest] = paren.split(' - ');
        return { p, degree: /^bachelor of/i.test(degree) ? degree : '', kind: rest.length ? rest.join(' - ') : degree };
      });
      const degrees = new Set(parts.map((x) => x.degree).filter(Boolean));
      const label = (x) => (degrees.size > 1 && x.degree ? `${DEGREE_ABBR[x.degree.toLowerCase()] ?? x.degree} ${x.kind}` : x.kind);
      return `<li data-s="${esc(ps.map(search).join(' '))}"><span class="pbase">${esc(base)}</span> ${parts.map((x) => `<a${label(x).length <= 24 ? ' class="pv"' : ''} href="/programs/${x.p.slug}/" title="${esc(x.p.name)}">${esc(label(x))}</a>`).join(' · ')}</li>`;
    })
    .join('');
}

export function programsIndexPage({ programs, cat, grad = false, builtAt, version }) {
  const byFaculty = new Map();
  for (const p of programs.list) {
    const f = p.faculty || 'Other';
    if (!byFaculty.has(f)) byFaculty.set(f, []);
    byFaculty.get(f).push(p);
  }
  const faculties = [...byFaculty.keys()].sort((a, b) => facultyRank(a) - facultyRank(b) || a.localeCompare(b));
  const counts = TYPE_ORDER.map((t) => [t, programs.list.filter((p) => p.type === t).length]).filter(([, n]) => n);
  const groups = faculties
    .map((f) => {
      const list = byFaculty.get(f);
      const types = [...new Set([...TYPE_ORDER, ...list.map((p) => p.type)])].filter((t) => list.some((p) => p.type === t));
      return `<section class="pgroup"><h2>${esc(f)} <span class="t">${list.length}</span></h2>${types
        .map(
          (t) =>
            `<h3>${esc(typePlural(t))} <span class="t">${list.filter((p) => p.type === t).length}</span></h3><ul class="plist">${
              t === 'Major'
                ? majorLines(list.filter((p) => p.type === t))
                : list
                    .filter((p) => p.type === t)
                    .map((p) => `<li data-s="${esc(`${p.name} ${p.type} ${p.field} ${p.faculty} ${p.coop ? 'co-op coop' : ''}`.toLowerCase())}">${programLink(p)}</li>`)
                    .join('')
            }</ul>`,
        )
        .join('')}</section>`;
    })
    .join('');
  const body = `<h1>Programs</h1>
<p class="lede">Every major, minor, option, specialization, diploma and certificate in the ${esc(cat.label)} Undergraduate Calendar: ${counts.map(([t, n]) => `${n} ${esc(typePlural(t).toLowerCase())}`).join(', ')}.</p>
<p><a href="/pathways/">Map out your degree in Pathways</a> · <a href="/pathways/#browse">Pick electives from any of these there</a> · <a href="/programs/combinations/">What can’t be combined</a>${grad ? ' · <a href="/programs/grad/">Graduate programs</a>' : ''}</p>
<div class="pfilter"><label for="pf">Filter</label><input id="pf" type="search" placeholder="economics, minor, co-op…" autocomplete="off" spellcheck="false"></div>
${groups}
<p class="none" id="pnone" hidden>No program matches.</p>
<script type="module">
const box = document.getElementById('pf');
const items = [...document.querySelectorAll('.plist li')];
box.addEventListener('input', () => {
  const words = box.value.toLowerCase().split(/\\s+/).filter(Boolean);
  for (const li of items) li.hidden = !words.every((w) => li.dataset.s.includes(w));
  for (const ul of document.querySelectorAll('.plist')) ul.previousElementSibling.hidden = ul.hidden = ![...ul.children].some((li) => !li.hidden);
  for (const g of document.querySelectorAll('.pgroup')) g.hidden = ![...g.querySelectorAll('.plist li')].some((li) => !li.hidden);
  document.getElementById('pnone').hidden = items.some((li) => !li.hidden);
});
</script>`;
  return shell({
    title: 'Programs: majors, minors, options and specializations | uwloo',
    description: `All ${programs.list.length} undergraduate programs at the University of Waterloo, with their requirements: majors, minors, options, specializations, diplomas and certificates.`,
    path: '/programs/',
    body,
    builtAt,
    version,
  });
}

/** A name in the table that reads like one program ("Chemical Physics major"), not a group ("Any other stand-alone major"). */
const looksLikeProgram = (text) => !/^(any|students|all)\b/i.test(text.trim()) && text.length < 90;

export function combinationsPage({ icc, cat, known, programs, builtAt, version }) {
  const rules = richText(icc.rulesHtml, { known, byId: programs.byId, cat });
  const name = (text, to, group = false) => {
    const lost = !/\*/.test(text) && !to?.length && looksLikeProgram(text);
    const label = esc(text.replace(/\*/g, '').trim()) + (/\*/.test(text) ? ' <span class="t">(no longer offered)</span>' : lost ? ` <span class="t">(not in the ${esc(cat.label)} calendar by this name)</span>` : '');
    if (group) return `${label} <span class="t">(${to.length} majors)</span>`;
    if (renamedTo(text) && to?.length) return `${label} <span class="t">(renamed since: ${to.map((q) => `<a href="/programs/${q.slug}/">${esc(q.name)}</a>`).join(', ')})</span>`;
    if (to?.length === 1) return `<a href="/programs/${to[0].slug}/">${label}</a>`;
    if (to?.length) return `${label} <span class="t">(${to.map((q) => `<a href="/programs/${q.slug}/">${esc(q.name)}</a>`).join(', ')})</span>`;
    return label;
  };
  // How much of the table uwloo can apply, and what it can't (and why).
  const all = icc.rows.flatMap((r) => r.others ?? []);
  const unread = all.filter((o) => !o.to?.length);
  const gone = unread.filter((o) => /\*/.test(o.text)).length;
  const lostNames = [...new Set([...icc.rows.filter((r) => !r.to?.length).map((r) => r.plan), ...unread.filter((o) => !/\*/.test(o.text) && looksLikeProgram(o.text)).map((o) => o.text)])];
  const words = unread.filter((o) => !/\*/.test(o.text) && !looksLikeProgram(o.text)).length;
  const read = icc.rows.length
    ? `<p class="t icc-read">uwloo reads every row: ${icc.rows.filter((r) => r.to?.length).length} of the ${icc.rows.length} programs and ${all.length - unread.length} of the ${all.length} names they can’t be combined with are matched to programs (groups like “Any stand-alone major”, whole degrees like “Mathematics, Bachelor of”, and names the calendar has since changed included), and Pathways applies each pair both ways round. Not matched: ${[gone && `${gone} no longer offered (*)`, lostNames.length && `${lostNames.map((n) => `“${esc(n.replace(/\*/g, ''))}”`).join(', ')}, not programs in this calendar`, words && `${words} conditions in words (“Students who have completed a Diploma in HRM…”), shown on those programs’ pages and in Pathways`].filter(Boolean).join('; ')}.</p>`
    : '';
  const rows = icc.rows
    .map((r) => `<tr><th scope="row">${name(r.plan, r.to)}</th><td>${esc(r.faculty)}</td><td><ul>${(r.others ?? r.cannot.map((text) => ({ text }))).map((o) => `<li>${name(o.text, o.to, o.group)}</li>`).join('')}</ul></td></tr>`)
    .join('');
  const body = `<p class="kicker"><a href="/programs/">Programs</a></p>
<h1>What can’t be combined</h1>
<p class="lede">The ${esc(cat.label)} Undergraduate Calendar’s rules on which credentials can’t be taken together, with each program linked to its page.</p>
<div class="notes icc">${rules}</div>
${read}
<div class="scroll"><table class="icc-table"><caption>Specific invalid credential combinations (${icc.rows.length})</caption><thead><tr><th scope="col">Program</th><th scope="col">Faculty</th><th scope="col">Can’t be combined with</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="t">From <a href="${esc(`${cat.pageUrl}#/policy/${ICC_PID}`)}">Invalid Credential Combinations</a> in the official calendar, which has the final word. Confirm a combination with an academic advisor before you declare it.</p>`;
  return shell({
    title: 'Invalid credential combinations | uwloo',
    description: 'Which University of Waterloo majors, minors, options, specializations and diplomas can’t be combined, from the Undergraduate Calendar.',
    path: '/programs/combinations/',
    body,
    builtAt,
    version,
  });
}

/**
 * "Counts toward" on a course page: every program that lists it by name, by kind; then the ones whose rules in
 * words it fits ("2.0 units of ECON courses at the 200-level or above"), fits: [{p, rules}].
 */
export function countsSection(code, list, cat, fits = [], { grad = false } = {}) {
  list = list ?? [];
  const named = new Set(list.map((x) => x.p.slug));
  const more = fits.filter((x) => x.p && !named.has(x.p.slug)).sort((a, b) => TYPE_ORDER.indexOf(a.p.type) - TYPE_ORDER.indexOf(b.p.type) || a.p.name.localeCompare(b.p.name));
  if (!list.length && !more.length) return '';
  const words = more.length
    ? `<details class="counts-g counts-w"${!list.length && more.length <= 12 ? ' open' : ''}><summary>Rules in words it fits <span class="t">${more.length}</span></summary><ul class="plinks">${more.map((x) => `<li>${programLink(x.p)} <span class="t">${esc(x.p.type)} · ${esc(x.rules.join('; '))}</span></li>`).join('')}</ul></details>`
    : '';
  const types = [...new Set([...TYPE_ORDER, ...list.map((x) => x.p.type)])].filter((t) => list.some((x) => x.p.type === t));
  const group = (t) => {
    const items = list
      .filter((x) => x.p.type === t)
      .sort((a, b) => a.p.name.localeCompare(b.p.name))
      .map((x) => `<li>${programLink(x.p)} <span class="t">${esc(x.roles.join('; '))}</span></li>`);
    const head = `${esc(typePlural(t))} <span class="t">${items.length}</span>`;
    return items.length > 8 ? `<details class="counts-g"><summary>${head}</summary><ul class="plinks">${items.join('')}</ul></details>` : `<h3>${head}</h3><ul class="plinks">${items.join('')}</ul>`;
  };
  return `<section aria-labelledby="counts-h"><h2 id="counts-h">Counts toward</h2>
<p class="t">${grad ? `Graduate programs in the ${esc(cat.label)} Graduate Calendar that name ${esc(fmtCode(code))}, in their course lists or their words. <a href="/programs/grad/">Every graduate program</a>.` : `Programs in the ${esc(cat.label)} Undergraduate Calendar that list ${esc(fmtCode(code))} by name${more.length ? ', then ones whose rules in words it fits (“units of a subject at a level”)' : ''}. <a href="/pathways/#course=${esc(code)}">Pathways</a> puts it in your grid toward any of them.`}</p>
<div class="counts">${types.map(group).join('')}${words}</div></section>`;
}
