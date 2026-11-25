// One-off look at what Pathways reads next, before building on it:
//   1. The 2021–22 to 2023–24 Undergraduate Calendars at academic-calendar-archive.uwaterloo.ca (it has no
//      robots.txt, so programs may read it; this checks again and honours one if it appears): how their faculty,
//      program, minor and co-op pages are laid out. Writes every page's title and links (the map of the program
//      sections), and the full HTML of a sample of pages.
//   2. UW Open Data's ImportantDates and ExamSchedules: their shape, for the timetable's calendar file.
// Writes data/probe/archive/{year}-map.json.gz, data/probe/archive/{year}-samples.json.gz and
// data/probe/opendata/*.json. Run by .github/workflows/archive-probe.yml (on push of this file, or by hand).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { parseRobots, robotsAllows } from './lib/links.mjs';
import { enabled as odEnabled, od } from './lib/opendata.mjs';

const OUT = 'data/probe';
const ACA = process.env.ACA_PROBE_BASE ?? 'https://academic-calendar-archive.uwaterloo.ca';
const YEARS = ['2021-2022', '2022-2023', '2023-2024'];
const UA = 'uwloo.ca-builder/1.0 (+https://uwloo.ca)';
const MAX_PAGES = 1500; // a year
const MAX_SAMPLES = 90; // a year
const CONCURRENCY = 3;
// Pages that aren't about programs: course lists (read elsewhere), fees, awards, admissions.
const SKIP = /Course-Descriptions|\/Courses-|Fees|Fee-|Award|Scholarship|Bursar|Admission|Financial-Aid|Student-Awards/i;
// A sample across faculties and kinds of plan, to see each layout.
const SAMPLE = /Faculty-of|Academic-Plans|List-of-Academic|Degree-Requirements|Pure-Math|Computer-Science|Mathematical-Optimization|Chartered|Accounting|Economics|Mechanical|Software-Eng|Kinesiology|Biology|Psychology|History|Planning|Architecture|Minor|Specialization|Option|Diploma|Certificate|Joint|General|Co-op|Co-operative|Sequence|Invalid-Credential|Calendar-Events|Breadth|Depth|Communication/i;

await rm(`${OUT}/archive`, { recursive: true, force: true });
await rm(`${OUT}/opendata`, { recursive: true, force: true });
await mkdir(`${OUT}/archive`, { recursive: true });
await mkdir(`${OUT}/opendata`, { recursive: true });
const summary = { at: new Date().toISOString(), archive: {}, opendata: {} };

// ---------------- the calendar archive ----------------

const robots = await fetch(`${ACA}/robots.txt`, { headers: { 'user-agent': UA } }).then(
  async (r) => ({ status: r.status, groups: r.ok ? parseRobots(await r.text()) : [] }),
  (err) => ({ status: 0, error: String(err.message), groups: [] }),
);
summary.archive.robots = { status: robots.status, groups: robots.groups.length };
const allowed = (url) => !robots.groups.length || robotsAllows(robots.groups, new URL(url).pathname, 'uwloo.ca-builder');

async function getText(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (err) {
      if (i + 1 >= tries) throw err;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const stripped = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '');

for (const year of YEARS) {
  const root = `${ACA}/undergraduate-studies/${year}/`;
  const seen = new Set();
  const queue = [`${root}page/uWaterloo-Undergraduate-Calendar-Access.html`, `${root}`];
  const pages = [];
  const samples = [];
  const inScope = (u) => u.startsWith(root) && /\/(page|group)\/[^/#?]+\.html$/.test(u) && !SKIP.test(u);
  const add = (u) => {
    const clean = u.split('#')[0];
    if (!seen.has(clean) && (clean === root || inScope(clean))) {
      seen.add(clean);
      queue.push(clean);
    }
  };
  for (const u of queue.splice(0)) add(u);
  let failed = 0;
  while (queue.length && pages.length < MAX_PAGES) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(
      batch.map(async (url) => {
        if (!allowed(url)) return;
        let html;
        try {
          html = await getText(url);
        } catch (err) {
          failed++;
          pages.push({ url, error: String(err.message) });
          return;
        }
        if (html == null) return pages.push({ url, status: 404 });
        const title = textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
        const links = [];
        for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
          let href;
          try {
            href = new URL(m[1].replace(/&amp;/g, '&'), url).href;
          } catch {
            continue;
          }
          links.push([href, textOf(m[2]).slice(0, 120)]);
          add(href);
        }
        pages.push({ url, title, size: html.length, links });
        if (samples.length < MAX_SAMPLES && (SAMPLE.test(url) || SAMPLE.test(title))) samples.push({ url, title, html: stripped(html) });
      }),
    );
    await new Promise((res) => setTimeout(res, 150));
  }
  summary.archive[year] = { pages: pages.length, samples: samples.length, failed, left: queue.length };
  await writeFile(`${OUT}/archive/${year}-map.json.gz`, gzipSync(JSON.stringify({ year, root, pages })));
  await writeFile(`${OUT}/archive/${year}-samples.json.gz`, gzipSync(JSON.stringify({ year, root, samples })));
  console.log(`${year}: ${pages.length} pages, ${samples.length} samples, ${failed} failed, ${queue.length} not read`);
}

// ---------------- Open Data: important dates and exams ----------------

if (odEnabled()) {
  const short = (v) => (Array.isArray(v) ? { count: v.length, keys: v[0] && typeof v[0] === 'object' ? Object.keys(v[0]) : [], first: v.slice(0, 60) } : v);
  for (const path of ['ImportantDates', 'ImportantDates/2026', 'ImportantDates/2025', 'ImportantDates/2026-2027', 'ExamSchedules', 'ExamSchedules/1269', 'ExamSchedules/1271', 'ExamSchedules/1259', 'ExamSchedules/1261']) {
    try {
      const v = await od(path);
      summary.opendata[path] = v == null ? 'no data' : Array.isArray(v) ? `array of ${v.length}` : typeof v;
      if (v != null) await writeFile(`${OUT}/opendata/${path.replace(/\//g, '-')}.json`, `${JSON.stringify(short(v), null, 2)}\n`);
    } catch (err) {
      summary.opendata[path] = `error ${err.status ?? err.message}`;
    }
  }
} else summary.opendata.skipped = 'no UW_API_KEY';

await writeFile(`${OUT}/archive/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
