// Reads past terms' class schedules into data/schedules/{term}.json (see scripts/lib/schedules.mjs).
// .github/workflows/schedules.yml runs this until every past term since Fall 2001 is in.
//
//   node scripts/schedules.mjs                  every past term not in yet, within the time budget
//   node scripts/schedules.mjs --minutes 30
//   node scripts/schedules.mjs --terms 1159     just these
//   node scripts/schedules.mjs --probe          find the form, run the check, read nothing else
//
// Before reading anything it asks for ECON 355 in Fall 2015 and checks the answer against what WClasses (a
// copy of the same tool) shows: LEC 001, 60 enrolled of 60, Hongxiu Li. If the form or the page has changed
// so that check fails, it stops and saves nothing.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Polite } from './grad-archive.mjs';
import { DIR, frameSources, isTerm, parseResult, PARSER, queryUrl, readForm, termNow, TOOL } from './lib/schedules.mjs';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (m) out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}
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

/** The query form, wherever the tool keeps it (the page itself, or one of its frames). */
export async function findForm(polite, url = TOOL) {
  const page = await polite.get(url);
  if (!page.html) return { error: `${url}: ${page.error ?? `HTTP ${page.status}`}` };
  const here = readForm(page.html, page.url);
  if (here) return { form: here };
  for (const src of frameSources(page.html, page.url)) {
    const f = await polite.get(src);
    const form = f.html && readForm(f.html, f.url);
    if (form) return { form };
  }
  return { error: `no form with a term list at ${url} or its frames`, sample: page.html.slice(0, 1500) };
}

/** ECON 355, Fall 2015, as WClasses has it from the same tool. */
export function checkCanary(res) {
  const s = res.status === 'ok' && res.courses.ECON355?.sections.find((x) => x[0] === 'LEC 001');
  return Boolean(s && s[1] === 60 && s[2] === 60 && /\bli\b/i.test(s[4]));
}

export async function main(argv = process.argv.slice(2), { polite, log = console, dir = DIR, now = new Date(), tool = TOOL } = {}) {
  const a = args(argv);
  const minutes = Number(a.minutes ?? 150);
  polite ??= new Polite({ delay: 1000, cacheDir: '.cache/schedules', deadline: Date.now() + minutes * 60_000, log });
  const report = { at: now.toISOString(), parser: PARSER };
  const done = async (out) => {
    await writeJson(`${dir}/report.json`, { ...report, ...out });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `more=${Boolean(out.left > 0 && out.saved > 0)}\n`);
    return out;
  };

  const found = await findForm(polite, tool);
  if (found.error) {
    log.warn(`! Class schedules: ${found.error}`);
    if (found.sample) log.warn(found.sample);
    return done({ error: found.error, saved: 0, left: 0 });
  }
  const { form } = found;
  const field = (n) => form.fields.find((f) => f.name === n);
  report.form = { action: form.action, method: form.method, fields: form.fields.map((f) => `${f.name}${f.options ? `(${f.options.length})` : `=${f.value}`}`) };
  log.log(`Class schedules form: ${form.method.toUpperCase()} ${form.action} [${report.form.fields.join(', ')}]`);
  if (form.method !== 'get') return done({ error: 'the form posts; only GET is supported', saved: 0, left: 0 });

  const canaryUrl = queryUrl(form, { term: '1159', level: 'under', subject: 'ECON' });
  const canaryPage = await polite.get(canaryUrl);
  const canary = canaryPage.html ? parseResult(canaryPage.html, 'ECON') : { status: 'error', why: canaryPage.error ?? `HTTP ${canaryPage.status}` };
  report.canary = { url: canaryUrl, status: canary.status, why: canary.why, econ355: canary.courses?.ECON355 ?? null };
  if (!checkCanary(canary)) {
    log.warn(`! Class schedules: the ECON 355 Fall 2015 check failed (${canary.status}${canary.why ? `: ${canary.why}` : ''}); reading nothing.`);
    log.warn(JSON.stringify(report.canary).slice(0, 1500));
    if (canaryPage.html) log.warn(canaryPage.html.replace(/\s+/g, ' ').slice(0, 3000));
    return done({ error: 'check failed', saved: 0, left: 0 });
  }
  log.log('Class schedules: ECON 355 Fall 2015 matches WClasses (LEC 001, 60/60, Hongxiu Li).');
  if (a.probe) return done({ probe: true, saved: 0, left: 0 });

  const cur = termNow(now);
  const levels = field('level')?.options?.map((o) => o.value).filter(Boolean) ?? ['under', 'grad'];
  const subjects = field('subject').options.map((o) => o.value).filter((v) => /^[A-Z]{2,8}$/.test(v));
  const wanted = a.terms ? String(a.terms).split(',') : null;
  const terms = field('sess')
    .options.map((o) => o.value)
    .filter((t) => isTerm(t) && Number(t) < Number(cur) && Number(t) >= 1019)
    .filter((t) => !wanted || wanted.includes(t))
    .sort((x, y) => Number(y) - Number(x)); // newest first
  let saved = 0;
  let left = 0;
  const failed = [];
  for (const term of terms) {
    const path = `${dir}/${term}.json`;
    const have = await readJson(path, null);
    if (have?.parser === PARSER && !a.redo && !wanted) continue;
    if (polite.late) {
      left++;
      continue;
    }
    const doc = { term, read: now.toISOString().slice(0, 10), parser: PARSER, source: TOOL, courses: {} };
    let bad = null;
    try {
      for (const level of levels) {
        for (const subject of subjects) {
          const page = await polite.get(queryUrl(form, { term, level, subject }));
          const res = page.html ? parseResult(page.html, subject) : { status: 'error', why: page.error ?? `HTTP ${page.status}` };
          if (res.status === 'error') {
            bad = `${level} ${subject}: ${res.why}`;
            break;
          }
          for (const [code, c] of Object.entries(res.courses ?? {})) doc.courses[code] = { ...c, level };
        }
        if (bad) break;
      }
    } catch (err) {
      if (err.message !== 'out of time') throw err;
      bad = 'out of time';
    }
    if (bad) {
      left++;
      if (bad !== 'out of time') failed.push(`${term} ${bad}`);
      log.warn(`! ${term}: ${bad}; left for next time`);
      continue;
    }
    // A past term with no classes at all isn't a term that was read.
    if (!Object.keys(doc.courses).length) {
      left++;
      failed.push(`${term}: nothing in any subject`);
      continue;
    }
    await writeJson(path, doc);
    saved++;
    log.log(`${term}: ${Object.keys(doc.courses).length} courses with sections`);
  }
  const s = polite.stats;
  log.log(`Class schedules: ${saved} terms read, ${left ? `${left} left` : 'nothing left'}. ${s.fetched} fetched, ${s.cached} from cache, ${s.blocked} blocked by robots.txt, ${s.failed} failed.`);
  return done({ saved, left, failed: failed.slice(0, 50) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
