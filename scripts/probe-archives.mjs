// A one-off look at two places older course information might still be, reading nothing in bulk:
//
// 1. The Wayback Machine: what it saved from 1995 to 2002 of the Registrar's old web Schedule of Classes,
//    page counts per year and per address, a sample of addresses, and the start of one saved page.
// 2. Waterloo's own calendar archive (academic-calendar-archive.uwaterloo.ca, no robots.txt): for each
//    undergraduate calendar 2007–08 to 2022–23, whether its front page loads, which course-list addresses
//    it links to, and whether ECON's course page has ECON 355.
//
// Writes data/probes/archives.json (committed by the workflow, so it can be read without the run's log).
import { mkdir, writeFile } from 'node:fs/promises';
import { Polite } from './grad-archive.mjs';

const polite = new Polite({ delay: 1500, cacheDir: '.cache/probe', deadline: Date.now() + 40 * 60_000 });
const out = { at: new Date().toISOString(), wayback: [], calendarArchive: [] };

// ---------- 1. Wayback ----------
const PREFIXES = [
  'www.adm.uwaterloo.ca/infocour/',
  'adm.uwaterloo.ca/infocour/',
  'www.registrar.uwaterloo.ca/',
  'registrar.uwaterloo.ca/',
  'www.infocour.uwaterloo.ca/',
  'infocour.uwaterloo.ca/',
  'classes.uwaterloo.ca/',
  'www.adm.uwaterloo.ca/',
];
for (const prefix of PREFIXES) {
  const q = new URLSearchParams({
    url: prefix,
    matchType: 'prefix',
    from: '1995',
    to: '2002',
    fl: 'timestamp,original,statuscode,mimetype',
    collapse: 'urlkey',
    limit: '20000',
  });
  const url = `https://web.archive.org/cdx/search/cdx?${q}`;
  const r = await polite.get(url);
  const row = { prefix, status: r.status ?? null, error: r.error ?? null };
  if (r.html) {
    // Plain-text answer (a JSON one wouldn't come back as text): one capture per line, fields as asked for.
    const rows = r.html
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((f) => /^\d{14}$/.test(f[0]));
    const byYear = {};
    for (const [ts] of rows) byYear[ts.slice(0, 4)] = (byYear[ts.slice(0, 4)] ?? 0) + 1;
    const schedule = rows.filter(([, u]) => /infocour|schedule|sched|course|class/i.test(u));
    Object.assign(row, {
      pages: rows.length,
      byYear,
      scheduleLike: schedule.length,
      sample: schedule.slice(0, 25).map(([ts, u, st, mt]) => `${ts} ${st} ${mt} ${u}`),
    });
    const pick =
      schedule.find(([, , st, mt]) => st === '200' && /html/.test(mt)) ??
      rows.find(([, , st]) => st === '200');
    if (pick) {
      const snap = await polite.get(`https://web.archive.org/web/${pick[0]}id_/${pick[1]}`);
      row.snapshot = {
        url: `https://web.archive.org/web/${pick[0]}/${pick[1]}`,
        status: snap.status ?? null,
        start: (snap.html ?? '').replace(/\s+/g, ' ').slice(0, 2500),
      };
    }
  }
  out.wayback.push(row);
  console.log(
    `Wayback ${prefix}: ${row.pages ?? 0} pages${
      row.scheduleLike ? `, ${row.scheduleLike} schedule-like` : ''
    }${row.error ? ` (${row.error})` : ''} ${JSON.stringify(row.byYear ?? {})}`,
  );
}

// ---------- 2. Waterloo's calendar archive ----------
const ARCH = 'https://academic-calendar-archive.uwaterloo.ca';
for (let y = 2007; y <= 2022; y++) {
  const base = `${ARCH}/undergraduate-studies/${y}-${y + 1}`;
  const front = await polite.get(`${base}/page/uWaterloo-Undergraduate-Calendar-Access.html`);
  const row = { year: `${y}-${y + 1}`, front: front.status ?? front.error };
  const links = front.html
    ? [...front.html.matchAll(/href\s*=\s*["']([^"'#]+)/gi)].map((m) => {
        try {
          return new URL(m[1], front.url ?? base).href;
        } catch {
          return null;
        }
      }).filter(Boolean)
    : [];
  row.courseLinks = [...new Set(links.filter((l) => /course/i.test(l)))].slice(0, 15);
  // Course pages: the address ucalendar used, and whatever the front page links to that looks like ECON's.
  const tries = [
    ...new Set([
      `${base}/COURSE/course-ECON.html`,
      `${base}/page/COURSE-course-ECON.html`,
      ...links.filter((l) => /ECON/i.test(l) && /course/i.test(l)),
    ]),
  ].slice(0, 4);
  row.econ = [];
  for (const t of tries) {
    const p = await polite.get(t);
    row.econ.push({
      url: t,
      status: p.status ?? p.error,
      hasEcon355: p.html ? /ECON\s*355/.test(p.html) : null,
      length: p.html?.length ?? 0,
    });
    if (p.html && /ECON/.test(p.html)) break;
  }
  out.calendarArchive.push(row);
  console.log(
    `Calendar archive ${row.year}: front ${row.front}; ${row.courseLinks.length} course links; ECON ${row.econ
      .map((e) => `${e.status}${e.hasEcon355 ? ' has ECON 355' : ''}`)
      .join(', ')}`,
  );
}

await mkdir('data/probes', { recursive: true });
await writeFile('data/probes/archives.json', `${JSON.stringify(out, null, 1)}\n`);
console.log(
  `Probe done: ${polite.stats.fetched} fetched, ${polite.stats.blocked} blocked by robots.txt, ${polite.stats.failed} failed.`,
);