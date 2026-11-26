// The 2021–22 to 2023–24 Undergraduate Calendars' program pages, for Pathways' older start years. They're at
// academic-calendar-archive.uwaterloo.ca, which has no robots.txt (checked again here; one that appears is
// honoured), and they don't change, so they're read once and kept in the repo: data/archive-programs/{year}.json.gz,
// each page's address and the HTML of its main part. scripts/lib/archiveprograms.mjs reads them into plans.
//
// Which pages: the ones the archive probe's map (data/probe/archive/{year}-map.json.gz) shows linking to two or
// more courses, which is where requirements are. Pages already read are kept; run it again to fill gaps.
// Run by .github/workflows/archive-programs.yml (on push of this file, or by hand).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mainPart } from './lib/archiveprograms.mjs';
import { parseRobots, robotsAllows } from './lib/links.mjs';

const OUT = 'data/archive-programs';
const ACA = process.env.ACA_BASE ?? 'https://academic-calendar-archive.uwaterloo.ca';
const YEARS = ['2021-2022', '2022-2023', '2023-2024'];
const UA = 'uwloo.ca-builder/1.0 (+https://uwloo.ca)';
const CONCURRENCY = 2;
// Not program pages: the University's general pages and regulations, co-op, fees and awards.
const SKIP = /\/(uWaterloo-|Acad-Regs-|Co-op|Co-operative-Education)|Fees|Award|Scholarship|Admission/i;

const robots = await fetch(`${ACA}/robots.txt`, { headers: { 'user-agent': UA } }).then(
  async (r) => (r.ok ? parseRobots(await r.text()) : []),
  () => [],
);
const allowed = (url) => !robots.length || robotsAllows(robots, new URL(url).pathname, 'uwloo.ca-builder');

async function getText(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (err) {
      if (i + 1 >= tries) throw err;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
}
await mkdir(OUT, { recursive: true });
for (const year of YEARS) {
  const map = JSON.parse(gunzipSync(await readFile(`data/probe/archive/${year}-map.json.gz`)));
  const courseLinks = (p) => (p.links ?? []).filter(([href]) => /ucalendar\.uwaterloo\.ca\/\d{4}\/COURSE\//i.test(href)).length;
  const urls = map.pages.filter((p) => /\/page\/[^/]+\.html$/.test(p.url) && !SKIP.test(p.url) && courseLinks(p) >= 2).map((p) => p.url);
  const file = `${OUT}/${year}.json.gz`;
  let kept = [];
  try {
    kept = JSON.parse(gunzipSync(await readFile(file))).pages;
  } catch {}
  const have = new Set(kept.map((p) => p.url));
  const todo = urls.filter((u) => !have.has(u) && allowed(u));
  let failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + CONCURRENCY).map(async (url) => {
        try {
          const html = await getText(url);
          if (html) kept.push({ url, html: mainPart(html) });
        } catch (err) {
          failed++;
          console.warn(`! ${url}: ${err.message}`);
        }
      }),
    );
    await new Promise((res) => setTimeout(res, 300));
  }
  kept.sort((a, b) => a.url.localeCompare(b.url));
  await writeFile(file, gzipSync(JSON.stringify({ year, pages: kept })));
  console.log(`${year}: ${kept.length} program pages (${todo.length - failed} read now, ${failed} failed)`);
}
