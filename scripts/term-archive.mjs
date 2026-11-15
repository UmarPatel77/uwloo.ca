// Keeps each term's sections from UW Open Data before Open Data drops them (it keeps about a year), so
// "Every term since 2001" carries on past WClasses, which stopped in early 2026.
//
// .github/workflows/term-archive.yml runs this weekly. Each run reads every term Open Data still has, from
// Fall 2025 up to the term in progress, and saves it to data/terms-od/{term}.json:
//   {term, read, final, courses: {CS135: [[sec, cap, tot, time, instructor, room]]}}
// rows shaped like data/schedules (main sections only). A finished term ("final": true) is read once more
// after it ends and then left alone; the term in progress is read again each week, since its enrolment
// still moves. Open Data withholds instructors and rooms, so those stay blank.
//
//   node scripts/term-archive.mjs                 the terms that need reading
//   node scripts/term-archive.mjs --terms 1265    just these (read again even if final)
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { enabled, loadOfferings, od, toSection } from './lib/opendata.mjs';
import { termCode, termRange } from './lib/terms.mjs';

export const DIR = 'data/terms-od';
export const FROM = '1259'; // Fall 2025: the oldest term Open Data still had when this started
const MAIN = ['LEC', 'SEM', 'LAB', 'STU', 'CLN', 'PRJ', 'RDG', 'TST'];

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJson(path, value) {
  await mkdir(path.replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(`${path}.part`, `${JSON.stringify(value)}\n`);
  await rename(`${path}.part`, path);
}

const noZero = (t) => String(t ?? '').replace(/^0(\d)/, '$1');
/** Open Data sections (toSection's shape) → the course's main sections as data/schedules rows. */
export function toRows(sections) {
  const kind = MAIN.find((k) => sections.some((s) => s.comp === k)) ?? sections[0]?.comp;
  return sections
    .filter((s) => s.comp === kind)
    .map((s) => {
      const m = s.meets.find((x) => x.start) ?? s.meets[0];
      const time = m?.start ? `${noZero(m.start)}-${noZero(m.end)} ${m.days ?? ''}`.trim() : '';
      return [`${s.comp} ${s.sec}`, s.cap, s.enrl, time, '', ''];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export async function main(argv = process.argv.slice(2), { now = new Date(), dir = DIR, fetchClasses, offerings: given, log = console } = {}) {
  const want = /--terms[= ](\S+)/.exec(argv.join(' '))?.[1]?.split(',') ?? null;
  if (!enabled() && !given) {
    log.warn('! UW_API_KEY not set: nothing read.');
    process.exitCode = 1;
    return { saved: 0 };
  }
  const cur = termCode(now);
  const terms = want ?? termRange(FROM, cur);
  const offerings = given ?? (await loadOfferings(terms, cur));
  fetchClasses ??= (term, r) => od(`ClassSchedules/${term}/${encodeURIComponent(r.subject)}/${encodeURIComponent(r.number)}`);
  let saved = 0;
  const report = [];
  for (const term of terms) {
    const path = `${dir}/${term}.json`;
    const have = await readJson(path, null);
    const final = Number(term) < Number(cur);
    if (have?.final && !want) continue; // finished and read after it ended: done
    if (!offerings.terms[term]?.published) {
      report.push(`${term}: Open Data has no class schedule${have ? ' (keeping the saved copy)' : ''}`);
      continue;
    }
    const rows = offerings.rows[term];
    const courses = {};
    let failed = 0;
    for (let i = 0; i < rows.length; i += 3) {
      await Promise.all(
        rows.slice(i, i + 3).map(async (r) => {
          try {
            const classes = await fetchClasses(term, r);
            if (!classes?.length) return;
            const out = toRows(classes.map(toSection));
            if (out.length) courses[`${r.subject}${r.number}`.toUpperCase()] = out;
          } catch {
            failed++;
          }
        }),
      );
    }
    // Too many failures: keep what's saved, ask again next week.
    if (failed > rows.length * 0.05 || !Object.keys(courses).length) {
      report.push(`${term}: ${failed} of ${rows.length} requests failed; not saved`);
      continue;
    }
    await writeJson(path, { term, read: now.toISOString().slice(0, 10), final, source: 'UW Open Data', courses });
    saved++;
    report.push(`${term}: ${Object.keys(courses).length} courses${final ? ', final' : ', in progress'}${failed ? `, ${failed} failed requests` : ''}`);
  }
  for (const line of report) log.log(line);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `saved=${saved}\n`);
  return { saved, report };
}

/** data/terms-od → Map(term → {final, courses}). */
export async function loadOdTerms(dir = DIR) {
  const out = new Map();
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => /^\d{4}\.json$/.test(x)).sort()) {
    const doc = await readJson(`${dir}/${f}`, null);
    if (doc?.courses) out.set(doc.term, doc);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
