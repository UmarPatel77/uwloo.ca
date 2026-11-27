// uwloo.ca/programs/grad/: the Graduate Calendar's programs (master's, PhDs, graduate diplomas, accelerated
// programs), read from the same Kuali API as the undergraduate ones: programs.mjs loads and normalizes both
// (`/programs/{catalog}` and `/program/{catalog}/{pid}` with the current grad term's catalog). Here: a page each,
// the index by faculty and field, "Counts toward" on graduate course pages, and Pathways' list of them
// (/pathways/grad.json).
//
// A graduate program's requirements come by study option (Thesis, Master's Research Paper, Coursework): each has
// its courses, as the calendar's rule lists ("Complete all the following: ECON600…") or in words ("Students must
// complete 4 one-term graduate courses: at least 1 at the 800 level…"), and its milestones (a seminar, a thesis).
// PhDs have courses and milestones without options; graduate diplomas, courses.

import { shell } from './render.mjs';
import { codesIn, esc, norm } from './requisites.mjs';
import { courseRoles, programPath, richText, sectionHtml } from './programs.mjs';

/** A study option's fields: its rule lists, the same kind of rules in words, its milestones. */
export const STUDY_OPTIONS = [
  { name: 'Thesis', label: 'Thesis option', rules: 'thesisOption', text: 'thesisOptionCourseRequirementsRichText', miles: 'thesisOptionMilestoneRequirements' },
  { name: "Master's Research Paper", label: 'Master’s research paper option', rules: 'masterSResearchPaperOption', text: 'masterSResearchPaperOptionCourseRequirementsRichText', miles: 'masterSResearchPaperOptionMilestoneRequirements' },
  { name: 'Coursework', label: 'Coursework option', rules: 'courseworkOption', text: 'courseworkOptionCourseRequirementsRichText', miles: 'courseworkOptionMilestoneRequirements' },
];
/** A PhD's courses and milestones, and a graduate diploma's courses: not by option. */
const WHOLE = [
  { label: 'Courses', rules: 'graduateCourseRequirements', text: 'graduateCourseRequirementsRichTextPhd', miles: 'milestoneDetails' },
  { label: 'Courses', rules: 'graduateDiplomaCourseRequirements', text: 'graduateDiplomaCourseRequirementsRichText' },
];
const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };
const REG = { fullTime: 'Full-time', partTime: 'Part-time' };
const DELIVERY = { onCampus: 'On campus', online: 'Online' };
export const GRAD_TYPES = ["Master's", 'PhD', 'Graduate Diploma'];

const plain = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A graduate program's name in parts: "Master of Mathematics (MMath) in Computer Science - Co-operative Program
 * (transfer entry)" → {degree: 'MMath', subject: 'Computer Science', variant: 'Co-operative Program (transfer
 * entry)'}; "Graduate Diploma (GDip) in Taxation (Type 1/Completion)" → GDip, Taxation, Type 1/Completion;
 * "Accelerated Master's Program in Biostatistics" → Accelerated master's, Biostatistics.
 */
export function gradParts(title) {
  const t = norm(title);
  // "Accelerated Master's Program in Statistics", "OD-Accelerated Master's Program in Vision Science" (with the OD).
  const acc = /^(?:([A-Z]{2,})-)?Accelerated (Master['’]s|Doctoral) Program in (.+)$/i.exec(t);
  if (acc) return { degree: `${acc[1] ? `${acc[1]} and a${''}` : 'A'}ccelerated ${/doctoral/i.test(acc[2]) ? 'PhD' : 'master’s'}`, subject: acc[3], variant: '' };
  const m = /^(.*?)\s*\(([A-Za-z][A-Za-z.]*)\)\s*(.*)$/.exec(t);
  if (!m) return { degree: t, subject: '', variant: '' };
  let rest = m[3];
  let subject = '';
  let variant = '';
  const inName = /^in (.+)$/i.exec(rest);
  if (inName) {
    const [subj, ...more] = inName[1].split(/\s+-\s+/);
    subject = subj;
    variant = more.join(' - ');
    const paren = /\s*\(([^)]*)\)\s*$/.exec(subject);
    if (paren) {
      subject = subject.slice(0, paren.index);
      variant = [paren[1], variant].filter(Boolean).join(' · ');
    }
  } else if (rest) variant = rest.replace(/^-\s*/, '');
  return { degree: m[2], subject: subject.trim(), variant: variant.replace(/^\((.*)\)$/, '$1').trim() };
}
/** Its label among its field's programs: "MMath · Co-operative Program", "PhD in Applied Economics · Water". */
export function gradLabel(p, field = p.field) {
  const { degree, subject, variant } = gradParts(p.title);
  return `${degree}${subject && subject !== field ? ` in ${subject}` : ''}${variant ? ` · ${variant}` : ''}`;
}
/** What it is in a few words: its options, kinds, terms, registration and delivery. */
export function gradFacts(p) {
  return {
    admit: ['fall', 'winter', 'spring'].filter((x) => p.admit.includes(x)).map((x) => TERM[x]),
    reg: p.reg.map((x) => REG[x] ?? x),
    delivery: p.delivery.map((x) => DELIVERY[x] ?? x),
  };
}

/** The courses a program names, by option (or not), and the words of each: Pathways' panel and "Counts toward". */
function partsOf(p) {
  const out = [];
  for (const o of [...STUDY_OPTIONS, ...WHOLE]) {
    const secs = p.sections.filter((s) => s.field === o.rules);
    const codes = [...new Set([...secs.flatMap((s) => [...courseRoles({ sections: [s] }).keys()]), ...codesIn(plain(p.text[o.text]))])];
    const words = plain(p.text[o.text]);
    const miles = o.miles ? plain(p.text[o.miles]) : '';
    if (!codes.length && !words && !miles && !secs.length) continue;
    out.push({ o, secs, codes, words, miles });
  }
  return out;
}

/** Grad course code → [{p, roles}]: the graduate programs that name it, and where ("Thesis option: Required"). */
export function gradCounts(programs) {
  const out = new Map();
  for (const p of programs.list) {
    const roles = new Map();
    for (const { o, secs, codes } of partsOf(p)) {
      const where = o.label === 'Courses' ? '' : `${o.label}: `;
      for (const s of secs) for (const [code, rs] of courseRoles({ sections: [s] })) for (const r of rs) (roles.get(code) ?? roles.set(code, new Set()).get(code)).add(`${where}${r}`);
      for (const code of codes) if (!roles.has(code)) roles.set(code, new Set([`${where}Mentioned`]));
    }
    for (const [code, rs] of roles) {
      if (!out.has(code)) out.set(code, []);
      out.get(code).push({ p, roles: [...rs] });
    }
  }
  return out;
}

/**
 * Pathways' list of graduate programs (/pathways/grad.json, loaded when someone opens it): each one's name, kind,
 * faculty, field, unit, options, kinds, terms, and by option the courses it names and its words (shortened; its
 * page has the rest). titleOf: a course's title.
 */
export function gradPathways(programs, titleOf = () => '') {
  const ct = {};
  const list = programs.list.map((p) => {
    const { degree, subject, variant } = gradParts(p.title);
    const { admit, reg, delivery } = gradFacts(p);
    const req = partsOf(p).map(({ o, codes, words, miles }) => {
      for (const c of codes) if (!(c in ct)) ct[c] = titleOf(c) || '';
      return { h: o.label, ...(codes.length ? { c: codes } : {}), ...(words ? { t: words.length > 700 ? `${words.slice(0, 697)}…` : words } : {}), ...(miles ? { m: miles.length > 300 ? `${miles.slice(0, 297)}…` : miles } : {}) };
    });
    return {
      s: p.slug,
      n: p.name,
      t: p.type,
      d: degree,
      ...(subject ? { su: subject } : {}),
      ...(variant ? { v: variant } : {}),
      f: p.faculty,
      fi: p.field,
      ...(p.unit ? { u: p.unit } : {}),
      ...(p.options.length ? { o: p.options } : {}),
      ...(p.kinds.length ? { k: p.kinds } : {}),
      ...(admit.length ? { adm: admit } : {}),
      ...(reg.length ? { reg } : {}),
      ...(delivery.length ? { del: delivery } : {}),
      ...(p.text.specialNotice ? { notice: plain(p.text.specialNotice) } : {}),
      ...(p.text.admissionRequirements ? { ad: firstWords(plain(p.text.admissionRequirements), 260) } : {}),
      ...(req.length ? { req } : {}),
    };
  });
  return { list, ct };
}

/** The first sentences of some text, up to about n characters ("…" if it stops in the middle of one). */
function firstWords(text, n) {
  const t = String(text ?? '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > n / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`;
}

const factsDl = (rows) => `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

/** One graduate program's page: /programs/grad/{slug}/. ugPrograms: the undergraduate ones, for the same field. */
export function gradProgramPage({ p, programs, ugPrograms = null, cat, known, builtAt, version }) {
  const { byId } = programs;
  const text = (f) => richText(p.text[f], { known, byId, cat });
  const prose = (f, heading, id) => {
    const h = text(f);
    return h ? `<section aria-labelledby="${id}"><h2 id="${id}">${esc(heading)}</h2><div class="notes">${h}</div></section>` : '';
  };
  const { admit, reg, delivery } = gradFacts(p);
  const facts = [
    ['Credential', esc(p.type)],
    p.faculty && ['Faculty', esc(p.faculty)],
    p.unit && ['Unit', esc(p.unit)],
    p.field && ['Field', esc(p.field)],
    p.options.length && ['Study options', esc(p.options.join(', '))],
    p.kinds.length && ['Kind', esc(p.kinds.join(', '))],
    admit.length && ['Admits in', esc(admit.join(', '))],
    reg.length && ['Registration', esc(reg.join(', '))],
    delivery.length && ['Delivery', esc(delivery.join(', '))],
  ].filter(Boolean);
  // Each study option (or a PhD's or diploma's courses): its rule lists, its rules in words, its milestones.
  const parts = partsOf(p).map(({ o, secs }, i) => {
    const lists = secs.map((s) => sectionHtml(s, known, byId, 4)).join('');
    const words = text(o.text);
    const miles = o.miles ? text(o.miles) : '';
    const head = o.label === 'Courses' ? (p.type === 'Graduate Diploma' ? 'Courses' : 'Courses and milestones') : o.label;
    return `<section aria-labelledby="go${i}" class="gopt"><h2 id="go${i}">${esc(head)}</h2>${lists || words ? `${o.label === 'Courses' ? '' : '<h3>Courses</h3>'}${lists}${words ? `<div class="notes">${words}</div>` : ''}` : ''}${miles ? `<h3>Milestones</h3><div class="notes">${miles}</div>` : ''}</section>`;
  });
  // Its field's other graduate programs, and the undergraduate plans in the same field.
  const same = programs.list.filter((q) => q !== p && q.field === p.field).sort((a, b) => a.name.localeCompare(b.name));
  const subject = gradParts(p.title).subject;
  const ug = (ugPrograms?.list ?? []).filter((q) => q.type !== 'Degree Requirements' && (q.field === p.field || (subject && q.field === subject))).sort((a, b) => a.name.localeCompare(b.name));
  const calUrl = `${cat.pageUrl}#/programs/${p.pid}`;
  const body = `<article class="course program grad">
<header class="course-head">
  <p class="kicker"><a href="/programs/grad/">Graduate programs</a> · ${esc(p.type)}</p>
  <h1><span class="title">${esc(p.name)}</span></h1>
  ${factsDl(facts)}
  <p class="plan-link"><a href="/pathways/#grad=${esc(p.slug)}">See it in Pathways</a> <span class="t">with the undergraduate plans that lead to it, to start your grid from</span></p>
</header>
${p.text.specialNotice ? `<div class="gone-note">${text('specialNotice')}</div>` : ''}
${prose('degreeRequirementsGrad', 'Degree requirements', 'dreq-h')}
${parts.join('\n')}
${prose('lengthOfProgram', 'Length of the program', 'len-h')}
${prose('graduateResearchFields', 'Research areas', 'res-h')}
${prose('graduateSpecializations', 'Specializations', 'gspec-h')}
${prose('acceleratedMasterSProgramDetails', 'The accelerated program', 'acc-h')}
${prose('additionalProgramInformation', 'More about the program', 'more-h')}
${prose('admissionRequirements', 'Admission', 'adm-h')}
${prose('admissionRequirementsApplicationMaterials', 'Application materials', 'app-h')}
${prose('admissionRequirementsReferences', 'References', 'ref-h')}
${prose('deliveryModeInformation', 'Where it’s taught', 'where-h')}
${prose('registrationOptionsInformation', 'Registration', 'regi-h')}
${prose('detailsAndNotes', 'Notes', 'notes-h')}
${same.length ? `<section aria-labelledby="same-h"><h2 id="same-h">Other ${esc(p.field)} graduate programs</h2><ul class="plinks">${same.map((q) => `<li><a href="${programPath(q)}">${esc(q.name)}</a> <span class="t">${esc(q.type)}</span></li>`).join('')}</ul></section>` : ''}
${ug.length ? `<section aria-labelledby="ug-h"><h2 id="ug-h">${esc(subject || p.field)} as an undergraduate</h2><ul class="plinks">${ug.map((q) => `<li><a href="${programPath(q)}">${esc(q.name)}</a> <span class="t">${esc(q.type)}</span></li>`).join('')}</ul></section>` : ''}
<section aria-labelledby="out-h"><h2 id="out-h">In the official calendar</h2><ul class="out"><li><a href="${esc(calUrl)}">${esc(p.name)}</a><small>${esc(cat.label)} Graduate Calendar</small></li></ul></section>
</article>`;
  return shell({
    title: `${p.name} | uwloo`,
    description: `${p.name} at the University of Waterloo: its study options, courses, milestones and admission requirements, from the ${cat.label} Graduate Calendar.`,
    path: programPath(p),
    body,
    builtAt,
    version,
  });
}

const FACULTY_ORDER = ['Arts', 'Engineering', 'Environment', 'Health', 'Mathematics', 'Science'];
const facultyRank = (f) => {
  const one = /^Faculty of ([A-Za-z]+)/.exec(f)?.[1];
  return one && FACULTY_ORDER.includes(one) ? FACULTY_ORDER.indexOf(one) : 50;
};
const typeRank = (t) => (GRAD_TYPES.includes(t) ? GRAD_TYPES.indexOf(t) : 9);

/** /programs/grad/: every graduate program by faculty, then field, each field's programs on one line. */
export function gradProgramsIndexPage({ programs, cat, builtAt, version }) {
  const byFaculty = new Map();
  for (const p of programs.list) {
    const f = p.faculty || 'Other';
    if (!byFaculty.has(f)) byFaculty.set(f, new Map());
    const fields = byFaculty.get(f);
    if (!fields.has(p.field)) fields.set(p.field, []);
    fields.get(p.field).push(p);
  }
  const counts = GRAD_TYPES.map((t) => [t, programs.list.filter((p) => p.type === t).length]).filter(([, n]) => n);
  const plural = (t, n) => (t === "Master's" ? (n === 1 ? 'master’s' : 'master’s programs') : t === 'PhD' ? (n === 1 ? 'PhD' : 'PhDs') : n === 1 ? t.toLowerCase() : `${t.toLowerCase()}s`);
  const search = (p) => `${p.name} ${p.type} ${p.field} ${p.faculty} ${p.unit} ${p.kinds.join(' ')} ${p.options.join(' ')} ${p.coop ? 'co-op coop' : ''}`.toLowerCase();
  const groups = [...byFaculty]
    .sort((a, b) => facultyRank(a[0]) - facultyRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([f, fields]) => {
      const n = [...fields.values()].reduce((k, ps) => k + ps.length, 0);
      const lines = [...fields]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([field, ps]) => {
          const sorted = ps.sort((a, b) => typeRank(a.type) - typeRank(b.type) || gradLabel(a, field).localeCompare(gradLabel(b, field)));
          return `<li data-s="${esc(sorted.map(search).join(' '))}"><span class="pbase">${esc(field)}</span> ${sorted.map((p) => `<a${gradLabel(p, field).length <= 24 ? ' class="pv"' : ''} href="${programPath(p)}" title="${esc(p.name)}">${esc(gradLabel(p, field))}</a>`).join(' · ')}</li>`;
        })
        .join('');
      return `<section class="pgroup"><h2>${esc(f)} <span class="t">${n}</span></h2><ul class="plist">${lines}</ul></section>`;
    })
    .join('');
  const body = `<h1>Graduate programs</h1>
<p class="lede">Every master’s, PhD, graduate diploma and accelerated program in the ${esc(cat.label)} Graduate Calendar: ${counts.map(([t, n]) => `${n} ${plural(t, n)}`).join(', ')}, by faculty and field. Each page has its study options (thesis, master’s research paper, coursework), courses, milestones and admission requirements.</p>
<p><a href="/programs/">Undergraduate programs</a> · <a href="/pathways/#grad">Browse them in Pathways</a></p>
<div class="pfilter"><label for="pf">Filter</label><input id="pf" type="search" placeholder="computer science, PhD, co-op, online…" autocomplete="off" spellcheck="false"></div>
${groups}
<p class="none" id="pnone" hidden>No program matches.</p>
<script type="module">
const box = document.getElementById('pf');
const items = [...document.querySelectorAll('.plist li')];
box.addEventListener('input', () => {
  const words = box.value.toLowerCase().split(/\\s+/).filter(Boolean);
  for (const li of items) li.hidden = !words.every((w) => li.dataset.s.includes(w));
  for (const g of document.querySelectorAll('.pgroup')) g.hidden = ![...g.querySelectorAll('.plist li')].some((li) => !li.hidden);
  document.getElementById('pnone').hidden = items.some((li) => !li.hidden);
});
</script>`;
  return shell({
    title: 'Graduate programs: master’s, PhDs and diplomas | uwloo',
    description: `All ${programs.list.length} graduate programs at the University of Waterloo, with their study options, courses and milestones.`,
    path: '/programs/grad/',
    body,
    builtAt,
    version,
  });
}
