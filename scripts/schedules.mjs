// Reads past class schedules from WClasses into data/schedules/ (see scripts/lib/schedules.mjs).
// .github/workflows/schedules.yml runs this until every course is in.
//
//   node scripts/schedules.mjs                    courses not read yet, within the time budget
//   node scripts/schedules.mjs --minutes 30
//   node scripts/schedules.mjs --only CS135,ECON355
//   node scripts/schedules.mjs --probe            just the checks
//
// Which courses: today's (uwloo.ca/courses.csv) by their WClasses page; ones that are gone by its API, over
// the terms they could have run: Spring 2004 to Winter 2020 for undergrad courses in the 1994–95 scanned
// calendar or the 2020–21 to 2023–24 calendars, and the terms a grad course was listed in the older Graduate
// Calendars.
//
// Checks first, against what WClasses showed by hand: ECON 355 in Fall 2015 (API) is LEC 001, 60 of 60,
// Hongxiu Li; CS 135's page has Fall 2015 lectures. If either fails, it saves nothing.
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { apiUrl, BASE, DIR, FIRST, LAST, pageUrl, readApi, readPage, termsBetween } from './lib/schedules.mjs';

const UA = 'uwloo (+https://uwloo.ca)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** GET with retries: {status, text} or {status: 0, error}. */
async function get(url, fetchImpl, { tries = 3, pause = 250 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      if (res.status === 200 || res.status === 404) return { status: res.status, text };
      last = { status: 0, error: `HTTP ${res.status}` };
    } catch (err) {
      last = { status: 0, error: err.cause?.code ?? err.message };
    }
    await sleep(pause * 4 * (i + 1));
  }
  return last;
}

/** Codes and the API terms to ask for each gone course. */
export async function plan({ fetchImpl, current }) {
  const ug = new Set();
  const scan = await readJson('data/archive-text/9495.json', { subjects: [] });
  for (const s of scan.subjects) for (const c of s.courses) if (c.id) ug.add(c.id);
  for (const f of await readdir('data/ug-archive/terms').catch(() => []))
    for (const s of (await readJson(`data/ug-archive/terms/${f}`, { subjects: [] })).subjects) for (const c of s.courses) ug.add(String(c).split('~')[0]);
  const grad = new Map();
  for (const f of await readdir('data/grad-archive/terms').catch(() => [])) {
    const doc = await readJson(`data/grad-archive/terms/${f}`, { subjects: [] });
    for (const s of doc.subjects) for (const c of s.courses) {
      const code = String(c).split('~')[0];
      if (!grad.has(code)) grad.set(code, new Set());
      grad.get(code).add(doc.term);
    }
  }
  const gone = new Map();
  const before = termsBetween(FIRST, '1201');
  for (const code of ug) if (!current.has(code)) gone.set(code, before);
  for (const [code, ts] of grad) if (!current.has(code)) gone.set(code, [...new Set([...(gone.get(code) ?? []), ...[...ts].filter((t) => t >= FIRST && t <= LAST)])].sort());
  return gone;
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch, log = console, dir = DIR, now = new Date(), workers = 3, pause = 250, currentCodes } = {}) {
  const a = args(argv);
  const deadline = Date.now() + Number(a.minutes ?? 150) * 60_000;
  const today = now.toISOString().slice(0, 10);
  const finish = async (out) => {
    await writeJson(`${dir}/report.json`, { at: now.toISOString(), source: BASE, ...out });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `more=${Boolean(out.left > 0 && out.saved > 0)}\n`);
    if (out.error) process.exitCode = 1;
    return out;
  };

  // The checks.
  const e = await get(apiUrl('ECON355', '1159'), fetchImpl);
  const lec = e.status === 200 ? readApi(JSON.parse(e.text || '{}'), '1159').find((r) => r[0] === 'LEC 001') : null;
  const p = await get(pageUrl('CS135'), fetchImpl);
  const cs = p.status === 200 ? readPage(p.text) : null;
  if (!(lec && lec[1] === 60 && lec[2] === 60 && /\bLi\b/.test(lec[4])) || !cs?.terms['1159']?.some((r) => r[0].startsWith('LEC'))) {
    log.warn(`! WClasses checks failed: ECON 355 Fall 2015 ${JSON.stringify(lec ?? e.error ?? e.status)}; CS 135 page ${cs ? `${Object.keys(cs.terms).length} terms` : (p.error ?? `HTTP ${p.status}, no __NEXT_DATA__ schedule`)}. Saving nothing.`);
    if (p.text && !cs) log.warn(p.text.replace(/\s+/g, ' ').slice(0, 2000));
    return finish({ error: 'checks failed', saved: 0, left: 0 });
  }
  log.log('WClasses checks passed: ECON 355 Fall 2015 is LEC 001, 60/60, Hongxiu Li; CS 135’s page has Fall 2015.');
  if (a.probe) return finish({ probe: true, saved: 0, left: 0 });

  // What to read.
  let current = currentCodes;
  if (!current) {
    const csv = await get('https://uwloo.ca/courses.csv', fetchImpl);
    if (csv.status !== 200) return finish({ error: `courses.csv: ${csv.error ?? csv.status}`, saved: 0, left: 0 });
    current = new Set(csv.text.split('\n').slice(1).map((l) => l.split(',')[0]).filter((c) => /^[A-Z]+\d/.test(c)));
  }
  const gone = await plan({ fetchImpl, current });
  const only = a.only ? new Set(String(a.only).split(',')) : null;
  const store = new Map(); // subject → its file's contents
  const fileOf = async (code) => {
    const s = /^[A-Z]+/.exec(code)[0];
    if (!store.has(s)) store.set(s, await readJson(`${dir}/${s}.json`, {}));
    return store.get(s);
  };
  const jobs = [];
  for (const code of [...current].sort()) jobs.push({ code, how: 'page' });
  for (const [code, terms] of [...gone].sort((x, y) => x[0].localeCompare(y[0]))) jobs.push({ code, how: 'api', terms });
  const todo = [];
  for (const j of jobs) {
    if (only && !only.has(j.code)) continue;
    const have = (await fileOf(j.code))[j.code];
    if (have && !only && (j.how === 'page' || j.terms.every((t) => have.asked?.includes(t) || have.terms?.[t]))) continue;
    todo.push(j);
  }
  log.log(`WClasses: ${current.size} current courses, ${gone.size} gone; ${todo.length} to read.`);

  let saved = 0;
  let failed = 0;
  const dirty = new Set();
  const flush = async () => {
    for (const s of dirty) await writeJson(`${dir}/${s}.json`, Object.fromEntries(Object.entries(store.get(s)).sort((x, y) => x[0].localeCompare(y[0], 'en', { numeric: true }))));
    dirty.clear();
  };
  let i = 0;
  const work = async () => {
    while (i < todo.length && Date.now() < deadline) {
      const j = todo[i++];
      const file = await fileOf(j.code);
      const subject = /^[A-Z]+/.exec(j.code)[0];
      if (j.how === 'page') {
        const r = await get(pageUrl(j.code), fetchImpl, { pause });
        await sleep(pause);
        if (r.status === 200 && readPage(r.text)) {
          file[j.code] = { via: 'page', read: today, terms: readPage(r.text).terms };
        } else if (r.status === 404) {
          // In the catalog but not on WClasses' list (new since early 2026, say): the API, over every term it has.
          j.how = 'api';
          j.terms = termsBetween(FIRST, LAST);
          todo.push(j);
          continue;
        } else {
          failed++;
          continue;
        }
      } else {
        const c = file[j.code] ?? { via: 'api', read: today, asked: [], terms: {} };
        let ok = true;
        for (const t of j.terms) {
          if (c.asked.includes(t) || c.terms[t] || Date.now() > deadline) continue;
          const r = await get(apiUrl(j.code, t), fetchImpl, { pause });
          await sleep(pause);
          if (r.status !== 200) {
            ok = false;
            continue;
          }
          const rows = readApi(JSON.parse(r.text || '{}'), t);
          if (rows.length) c.terms[t] = rows;
          else c.asked.push(t);
        }
        c.asked.sort();
        c.read = today;
        file[j.code] = c;
        if (!ok) failed++;
      }
      dirty.add(subject);
      saved++;
      if (saved % 100 === 0) await flush();
    }
  };
  await Promise.all(Array.from({ length: workers }, work));
  await flush();
  const left = todo.length - i;
  log.log(`WClasses: ${saved} courses saved, ${failed} with failed requests (asked again next run), ${left} left.`);
  return finish({ saved, failed, left });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
