// Past class schedules: which courses had sections in each term since Fall 2001, with each section's
// enrolment, times and instructor. From "Waterloo Class Schedules" (cs.uwaterloo.ca/cscf/teaching/schedule),
// the CS Computing Facility's copy of the Registrar's Schedule of Classes: it keeps every term from Fall 2001,
// refreshes recent ones twice an hour and leaves older ones as they were. Its robots.txt lets uwloo in;
// the Registrar's own classes.uwaterloo.ca doesn't.
//
// One request per subject, per level, per term. A past term never changes, so it's read once and saved to
// data/schedules/{term}.json. A read that fails, or a page that doesn't say what was asked for, is never
// saved as "no classes": the term is left for the next run.
import { readdir, readFile } from 'node:fs/promises';

export const DIR = 'data/schedules';
export const PARSER = 1;
export const TOOL = process.env.SCHEDULES_TOOL ?? 'https://cs.uwaterloo.ca/cscf/teaching/schedule/expert';

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((x) => x != null) ?? null;

/** Every <frame>/<iframe> src on a page, resolved. */
export function frameSources(html, base) {
  return [...html.matchAll(/<i?frame\b[^>]*>/gi)].map((m) => attr(m[0], 'src')).filter(Boolean).map((s) => new URL(s, base).href);
}

/**
 * The query form: {action, method, fields: [{name, value, options?}]}, from whichever page has a select named
 * "sess" (the term). null if none does.
 */
export function readForm(html, base) {
  for (const m of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
    const body = m[1];
    if (!/<select\b[^>]*name\s*=\s*["']?sess\b/i.test(body)) continue;
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const fields = [];
    for (const s of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const options = [...s[2].matchAll(/<option\b([^>]*)>([^<]*)/gi)].map((o) => ({ value: attr(o[1], 'value') ?? decode(o[2]), label: decode(o[2]), selected: /\bselected\b/i.test(o[1]) }));
      fields.push({ name: attr(s[1], 'name'), value: (options.find((o) => o.selected) ?? options[0])?.value ?? '', options });
    }
    for (const i of body.matchAll(/<input\b[^>]*>/gi)) {
      const type = (attr(i[0], 'type') ?? 'text').toLowerCase();
      const name = attr(i[0], 'name');
      if (!name || ['button', 'reset', 'image', 'file'].includes(type) || (type === 'checkbox' && !/\bchecked\b/i.test(i[0]))) continue;
      fields.push({ name, value: attr(i[0], 'value') ?? '', type });
    }
    return { action: new URL(attr(tag, 'action') || base, base).href, method: (attr(tag, 'method') ?? 'get').toLowerCase(), fields: fields.filter((f) => f.name) };
  }
  return null;
}

/** The form's URL for one term, level and subject (every other field as the form has it, course number blank). */
export function queryUrl(form, { term, level, subject }) {
  const q = new URLSearchParams();
  for (const f of form.fields) {
    if (f.type === 'submit' && q.has(f.name)) continue;
    const v = f.name === 'sess' ? term : f.name === 'level' ? level : f.name === 'subject' ? subject : f.options || f.type === 'submit' || f.type === 'hidden' ? f.value : '';
    q.append(f.name, v);
  }
  const u = new URL(form.action);
  u.search = q.toString();
  return u.href;
}

/** Every <tr> as its cells' text, nesting ignored: rows are told apart by shape, not by where they sit. */
function rows(html) {
  const out = [];
  let row = null;
  let cell = null;
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)(tr|td|th|br)\b[^>]*>|([^<]+)|<[^>]*>/gi)) {
    const [, close, tag, text] = m;
    const t = tag?.toLowerCase();
    if (text != null) {
      if (cell) cell.push(text);
    } else if (t === 'tr' && !close) {
      if (row?.length) out.push(row);
      row = [];
    } else if ((t === 'td' || t === 'th') && !close) {
      row ??= [];
      cell = [];
      cell.th = t === 'th';
    } else if ((t === 'td' || t === 'th') && close && cell) {
      row?.push(Object.assign(new String(decode(cell.join(' '))), { th: cell.th }));
      cell = null;
    } else if (t === 'br' && cell) cell.push(' ');
    else if (t === 'tr' && close) {
      if (row?.length) out.push(row);
      row = null;
    }
  }
  if (row?.length) out.push(row);
  return out.map((r) => r.map((c) => ({ text: String(c), th: c.th })));
}

// The Schedule of Classes' columns, in its usual order; a header row, when there is one, says otherwise.
const COLS = ['num', 'sec', 'camp', 'assoc', 'rel1', 'rel2', 'cap', 'tot', 'wcap', 'wtot', 'time', 'room', 'inst'];
const HINTS = [
  [/assoc/, 'assoc'], [/rel ?1/, 'rel1'], [/rel ?2/, 'rel2'], [/enrl ?cap/, 'cap'], [/enrl ?tot/, 'tot'], [/wait ?cap/, 'wcap'], [/wait ?tot/, 'wtot'],
  [/comp/, 'sec'], [/camp/, 'camp'], [/instructor/, 'inst'], [/room|bldg/, 'room'], [/time|date/, 'time'], [/class/, 'num'],
];
const SECTION = /^([A-Z]{3})\s*(\d{3}[A-Z]?)$/;
const TIME = /\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/;

/**
 * One result page → {status: 'ok', courses: {ECON355: {title, units, sections: [[sec, cap, tot, time, inst]]}}},
 * {status: 'none'} (it says there's nothing), or {status: 'error', why}. A course row for another subject
 * than the one asked for means the page isn't the answer to this question: an error, never "none".
 */
export function parseResult(html, subject) {
  const text = decode(html);
  if (/no matches|no classes found|no courses found/i.test(text)) return { status: 'none' };
  const courses = {};
  let course = null;
  let map = null;
  for (const cells of rows(html)) {
    const t = cells.map((c) => c.text);
    const low = t.map((x) => x.toLowerCase());
    if (low.some((x) => x.startsWith('class')) && low.some((x) => /comp|sec/.test(x)) && cells.some((c) => c.th)) {
      map = {};
      const used = new Set();
      low.forEach((x, i) => {
        const hit = HINTS.find(([re, name]) => re.test(x) && !used.has(name));
        if (hit) (map[i] = hit[1]), used.add(hit[1]);
      });
      continue;
    }
    if (t.length >= 4 && /^[A-Z]{2,8}$/.test(t[0]) && /^\d{3}[A-Z]{0,2}$/.test(t[1]) && /^\d\.\d\d$/.test(t[2])) {
      if (t[0] !== subject.toUpperCase()) return { status: 'error', why: `asked for ${subject}, page has ${t[0]}` };
      const code = `${t[0]}${t[1]}`;
      course = courses[code] ??= { title: t[3], units: t[2], sections: [] };
      continue;
    }
    if (!course) continue;
    if (/^\d{3,6}$/.test(t[0] ?? '') && SECTION.test(t[1] ?? '')) {
      const r = {};
      t.forEach((v, i) => {
        const k = map?.[i] ?? COLS[i];
        if (k) r[k] = v;
      });
      const [, comp, sec] = SECTION.exec(r.sec ?? t[1]) ?? SECTION.exec(t[1]);
      const n = (x) => (/^\d+$/.test(x ?? '') ? Number(x) : null);
      course.sections.push([`${comp} ${sec}`, n(r.cap), n(r.tot), r.time ?? '', r.inst ?? '']);
      continue;
    }
    // Another meeting time for the section above.
    const last = course.sections.at(-1);
    if (last && !t[0] && TIME.test(t.join(' '))) last[3] = `${last[3]} | ${t.filter(Boolean).join(' ')}`.replace(/^ \| /, '');
  }
  if (!Object.keys(courses).length) return { status: 'error', why: 'no course rows and no "no matches"' };
  return { status: 'ok', courses };
}

/** Term code → number to compare, and the term in progress or next (past terms are those before it). */
export const termNow = (d = new Date()) => `1${String(d.getUTCFullYear()).slice(2)}${d.getUTCMonth() < 4 ? 1 : d.getUTCMonth() < 8 ? 5 : 9}`;
export const isTerm = (t) => /^1\d\d[159]$/.test(t);

/** data/schedules → Map(code → [{term, title, sections}]), oldest term first. */
export async function loadSchedules(dir = DIR) {
  const out = new Map();
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  for (const f of files) {
    const doc = JSON.parse(await readFile(`${dir}/${f}`, 'utf8'));
    for (const [code, c] of Object.entries(doc.courses ?? {})) {
      if (!out.has(code)) out.set(code, []);
      out.get(code).push({ term: doc.term, level: c.level, title: c.title, sections: c.sections });
    }
  }
  return out;
}
