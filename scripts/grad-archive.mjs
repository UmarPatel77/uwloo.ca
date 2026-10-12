// Fetches the Graduate Calendars from before Kuali (Fall 2006 to Winter 2024) into data/grad-archive/.
// scripts/lib/gradarchive.mjs says where each one is and how it's stored. Archives don't change, so each
// term is fetched once; .github/workflows/grad-archive.yml runs this until every term it can read is in.
//
//   node scripts/grad-archive.mjs                    every term not in yet, within the time budget
//   node scripts/grad-archive.mjs --minutes 30
//   node scripts/grad-archive.mjs --terms 1069,1109  just these
//   node scripts/grad-archive.mjs --redo             again, even if they're in already
//   node scripts/grad-archive.mjs --probe            look at academic-calendar-archive again now
//
// Polite: robots.txt first, one request at a time with a pause, every page cached in .cache/grad-archive/
// so a rerun (after a parser fix, say) fetches nothing twice.
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { courseLinkText, DIR, oldTerms, PARSER, parseCoursePage, readStore, saveTerm } from './lib/gradarchive.mjs';
import { parseRobots, readHtml, robotsAllows, robotsDelay } from './lib/links.mjs';
import * as opendata from './lib/opendata.mjs';

export const UA_TOKEN = 'uwloo-calendar';
export const USER_AGENT = `${UA_TOKEN}/1.0 (+https://github.com/UmarPatel77/uwloo.ca)`;
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha1').update(s).digest('hex');

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
  await writeFile(`${path}.part`, `${JSON.stringify(value, null, 1)}\n`);
  await rename(`${path}.part`, path);
}

/** Bytes → text, by the charset the server or the page names (the 2006 pages may be Windows-1252). */
export function decodeBody(buf, contentType = '') {
  let cs = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!cs) cs = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(buf.subarray(0, 4096)))?.[1];
  cs = (cs ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs, { fatal: cs === 'utf-8' || cs === 'utf8' }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** One request at a time, a pause after each, robots.txt obeyed, pages cached on disk for good. */
export class Polite {
  constructor({ delay = 1000, timeout = 30_000, deadline = Infinity, cacheDir = '.cache/grad-archive', log = console } = {}) {
    Object.assign(this, { delay, timeout, deadline, cacheDir, log });
    this.robotsBy = new Map();
    this.wait = new Map();
    this.stats = { fetched: 0, cached: 0, blocked: 0, failed: 0 };
  }

  get late() {
    return Date.now() > this.deadline;
  }

  async request(url) {
    if (this.late) throw new Error('out of time');
    const origin = new URL(url).origin;
    try {
      return await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.5' }, redirect: 'manual', signal: AbortSignal.timeout(this.timeout) });
    } finally {
      await sleep(this.wait.get(origin) ?? this.delay);
    }
  }

  /** 'ok', 'robots' (robots.txt says no) or 'unreachable' (no answer about robots.txt: don't go in). */
  async allowed(url) {
    const u = new URL(url);
    if (!this.robotsBy.has(u.origin)) {
      const path = `${this.cacheDir}/robots/${sha(u.origin)}.json`;
      let hit = await readJson(path, null);
      if (!hit || Date.now() - hit.t > 7 * DAY) {
        try {
          // Redirects are followed (up to five, as RFC 9309 asks). No robots.txt (a 4xx) means everything is
          // allowed; a server error or no answer means don't go in this run.
          let at = `${u.origin}/robots.txt`;
          let res = await this.request(at);
          for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
            await res.arrayBuffer().catch(() => {});
            at = new URL(res.headers.get('location'), at).href;
            res = await this.request(at);
          }
          const text = res.status === 200 ? await res.text() : (await res.arrayBuffer().catch(() => {}), '');
          hit = res.status === 200 || (res.status >= 400 && res.status < 500) ? { t: Date.now(), text, status: res.status } : null;
        } catch (err) {
          if (err.message === 'out of time') throw err;
          hit = null;
        }
        if (hit) {
          await mkdir(`${this.cacheDir}/robots`, { recursive: true });
          await writeFile(path, JSON.stringify(hit));
        }
      }
      const groups = hit ? parseRobots(hit.text) : null;
      this.robotsBy.set(u.origin, groups);
      const d = groups && (robotsDelay(groups, UA_TOKEN) ?? null);
      if (d) this.wait.set(u.origin, Math.min(Math.max(this.delay, d * 1000), 15_000));
    }
    const groups = this.robotsBy.get(u.origin);
    if (!groups) return 'unreachable';
    return robotsAllows(groups, u.pathname + u.search, UA_TOKEN) ? 'ok' : 'robots';
  }

  /** {status, url (after redirects), html} or {status: 0, error}. 200s and 404s are cached for good. */
  async get(url) {
    const path = `${this.cacheDir}/pages/${sha(url)}.json`;
    const hit = await readJson(path, null);
    if (hit) {
      this.stats.cached++;
      return hit;
    }
    let cur = url;
    let out = null;
    for (let hop = 0; hop < 6 && !out; hop++) {
      const ok = await this.allowed(cur);
      if (ok !== 'ok') {
        this.stats.blocked++;
        return { status: 0, error: ok, url: cur };
      }
      let res;
      try {
        res = await this.request(cur);
      } catch (err) {
        if (err.message === 'out of time') throw err;
        this.stats.failed++;
        return { status: 0, error: err.cause?.code ?? err.message, url: cur };
      }
      this.stats.fetched++;
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.arrayBuffer().catch(() => {});
        cur = new URL(location, cur).href;
        continue;
      }
      const type = res.headers.get('content-type') ?? '';
      const html = res.status === 200 && /html|text/i.test(type || 'text/html') ? decodeBody(new Uint8Array(await res.arrayBuffer()), type) : (await res.arrayBuffer().catch(() => {}), null);
      out = { status: res.status, url: cur, html };
    }
    out ??= { status: 0, error: 'too many redirects', url: cur };
    if (out.status === 200 || out.status === 404 || out.status === 410) {
      await mkdir(`${this.cacheDir}/pages`, { recursive: true });
      await writeFile(path, JSON.stringify(out));
    }
    return out;
  }
}

const COURSE_PAGE = /\/GRDcourse-([A-Za-z]+)\.html?$/i;

/**
 * One term's calendar: walk its faculty and department pages for links to GRDcourse-{SUBJ}.html, then read
 * those. {subjects: [{code, dept, url, courses}], stats, samples} or {error}.
 */
export async function crawlTerm(t, polite, { maxPages = t.kind === 'gsac' ? 400 : 500, maxDepth = t.kind === 'gsac' ? 3 : 4, log = console } = {}) {
  const site = `${t.scope}gradcalendar.uwaterloo.ca/`;
  const nav =
    t.kind === 'gsac'
      ? (u) => u.startsWith(site) && !/\/printable\//i.test(u) && /\/(group\/[^/]+|page\/(Faculty-of-[^/]+|Theology|[^/]*Courses?))\.html$/i.test(u)
      : (u) => u.startsWith(t.scope) && /(\.html?|\/)$/i.test(u);
  // gsac: the course pages saved with this term (…/2010/fall/www.ucalendar.uwaterloo.ca/SA/GRAD/1011/…).
  const courseScope = t.kind === 'gsac' ? t.scope : `${new URL(t.scope).origin}/`;
  const queue = [[t.start, 0]];
  const seen = new Set([t.start]);
  const found = new Map(); // SUBJ → {url, dept}
  const inline = []; // pages that are themselves course lists (the 2017 on calendars, if any are)
  const stats = { pages: 0, coursePages: 0, courses: 0, ids: 0, failed: 0, missed: [] };
  const looks = new Map(); // what kinds of pages there were, for the report when nothing is found
  while (queue.length && stats.pages < maxPages) {
    const [url, depth] = queue.shift();
    const r = await polite.get(url);
    stats.pages++;
    if (!r.html) {
      if (url === t.start) return { error: r.error ? `start page: ${r.error}` : `start page: HTTP ${r.status}`, stats };
      stats.failed++;
      continue;
    }
    const pageKey = new URL(r.url).pathname.replace(/[^/]+$/, '').split('/').slice(-3).join('/');
    looks.set(pageKey, (looks.get(pageKey) ?? 0) + 1);
    if (t.kind !== 'gsac') {
      const p = parseCoursePage(r.html);
      if (p.courses.filter((c) => c.id).length >= 3) inline.push({ url: r.url, parsed: p, html: r.html });
    }
    const links = readHtml(r.html, r.url).links;
    const onPage = new Map();
    for (const l of links) {
      const u = l.href.replace(/#.*$/, '');
      const m = COURSE_PAGE.exec(new URL(u).pathname);
      if (m && u.startsWith(courseScope)) {
        onPage.set(m[1].toUpperCase(), { url: u, text: l.text });
        continue;
      }
      if (depth < maxDepth && nav(u) && !seen.has(u)) {
        seen.add(u);
        queue.push([u, depth + 1]);
      }
    }
    // A department that lists one subject's courses names it: "Combinatorics & Optimization (CO) Courses".
    for (const [subj, l] of onPage) {
      const e = found.get(subj) ?? { url: l.url, dept: null };
      const named = courseLinkText(l.text);
      if (onPage.size === 1 && named?.code === subj && named.dept) e.dept ??= named.dept;
      found.set(subj, e);
    }
  }
  const subjects = [];
  const samples = [];
  for (const [code, e] of [...found].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = await polite.get(e.url);
    if (!r.html) {
      stats.failed++;
      continue;
    }
    const p = parseCoursePage(r.html);
    stats.coursePages++;
    stats.courses += p.courses.length;
    stats.ids += p.ids;
    stats.missed.push(...p.missed.map((m) => `${code}: ${m}`));
    if (p.ids > p.courses.length) log.warn(`  ! ${t.term} ${code}: ${p.ids} "Course ID"s but ${p.courses.length} courses read`);
    subjects.push({ code, dept: e.dept, url: e.url, courses: p.courses });
    if (code === 'CS' || code === 'CO') samples.push({ name: `${t.term}-GRDcourse-${code}.html`, html: r.html });
  }
  for (const { url, parsed, html } of inline) {
    const bySubj = new Map();
    for (const c of parsed.courses) {
      if (!bySubj.has(c.subject)) bySubj.set(c.subject, []);
      bySubj.get(c.subject).push(c);
    }
    for (const [code, courses] of bySubj) {
      if (subjects.some((s) => s.code === code)) continue;
      subjects.push({ code, dept: null, url, courses });
      stats.courses += courses.length;
    }
    if (samples.length < 2) samples.push({ name: `${t.term}-list-${samples.length + 1}.html`, html });
  }
  stats.looks = [...looks].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return { subjects, stats, samples };
}

/** A term's course catalog from UW Open Data, as a stand-in for a calendar uwloo can't read. */
export function fromOpenData(rows) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const bySubj = new Map();
  for (const r of rows ?? []) {
    if (r.associatedAcademicCareer !== 'GRD') continue;
    const subject = clean(r.subjectCode).toUpperCase();
    const number = clean(r.catalogNumber).toUpperCase();
    if (!/^[A-Z]{2,8}$/.test(subject) || !/^\d{3}[A-Z]{0,2}$/.test(number)) continue;
    const code = subject + number;
    const list = bySubj.get(subject) ?? [];
    bySubj.set(subject, list);
    if (list.some((c) => c.code === code)) continue;
    list.push({
      code,
      subject,
      number,
      title: clean(r.title),
      units: null,
      comp: clean(r.courseComponentCode) || null,
      id: r.courseId ? String(r.courseId).padStart(6, '0') : null,
      d: clean(r.description) ? [clean(r.description)] : [],
      x: clean(r.requirementsDescription) ? [clean(r.requirementsDescription)] : [],
    });
  }
  return [...bySubj]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, courses]) => ({ code, dept: null, url: null, courses: courses.sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true })) }));
}

const PROBE_EVERY = 30 * DAY;

export async function main(argv = process.argv.slice(2), opts = {}) {
  const a = args(argv);
  const log = opts.log ?? console;
  const dir = opts.dir ?? DIR;
  const minutes = Number(a.minutes ?? 150);
  const deadline = Date.now() + minutes * 60_000;
  const polite = opts.polite ?? new Polite({ delay: Number(a.delay ?? 1000), deadline, cacheDir: opts.cacheDir ?? '.cache/grad-archive', log });
  const only = a.terms && a.terms !== true ? String(a.terms).split(/[\s,]+/).filter(Boolean) : null;
  const odFetch = opts.od ?? (opendata.enabled() ? (term) => opendata.od(`Courses/${term}`) : null);
  const store = await readStore(dir);
  const report = await readJson(`${dir}/report.json`, { terms: {} });
  const terms = oldTerms(opts.urls ?? {}).filter((t) => !only || only.includes(t.term));
  let changed = 0; // anything written, the report included
  let saved = 0; // terms read and saved: only these count as progress
  let left = 0;
  const save = async (t, source, from, result) => {
    const st = result.stats;
    const stats = st ? { pages: st.pages, coursePages: st.coursePages, courses: st.courses, ids: st.ids, failed: st.failed, missed: st.missed.length } : null;
    const n = await saveTerm(store, { term: t.term, label: t.label, source, from, parser: source === 'calendar' ? PARSER : null, fetched: new Date().toISOString().slice(0, 10), stats }, result.subjects, dir);
    report.terms[t.term] = { source, courses: n, subjects: result.subjects.length, ...(result.stats ?? {}), missed: result.stats?.missed?.slice(0, 8) ?? [] };
    for (const s of result.samples ?? []) {
      const path = `${dir}/samples/${s.name}`;
      if (!(await readFile(path).catch(() => null))) {
        await mkdir(`${dir}/samples`, { recursive: true });
        await writeFile(path, s.html.slice(0, 400_000));
      }
    }
    changed++;
    saved++;
    log.log(`  ${t.term} ${t.label}: ${n} courses in ${result.subjects.length} subjects (${source})`);
  };
  const redo = Boolean(a.redo);
  const due = (t, have) => redo || !have || (have.source === 'calendar' && (have.parser ?? 0) < PARSER);

  try {
    // 1. Winter 2017 to Winter 2024: academic-calendar-archive, if its robots.txt lets uwloo in and its pages
    //    hold course lists. Checked once a month; the result goes in report.json either way.
    const aca = terms.filter((t) => t.kind === 'aca');
    let acaReadable = report.aca?.readable === true;
    const probeDue = a.probe || !report.aca || Date.now() - Date.parse(report.aca.checked ?? 0) > PROBE_EVERY;
    if (aca.length && probeDue && !acaReadable) {
      const probe = aca.find((t) => t.term === '1179') ?? aca[0];
      const ok = await polite.allowed(probe.start);
      let res = null;
      if (ok === 'ok') res = await crawlTerm(probe, polite, { log });
      const found = res?.subjects?.reduce((n, s) => n + s.courses.length, 0) ?? 0;
      acaReadable = found > 0;
      // No answer about robots.txt isn't an answer: ask again next run.
      report.aca = { checked: ok === 'unreachable' ? null : new Date().toISOString(), robots: ok, term: probe.term, readable: acaReadable, courses: found, pages: res?.stats?.pages ?? 0, error: res?.error ?? null, looks: res?.stats?.looks ?? [] };
      log.log(`academic-calendar-archive: robots.txt ${ok}${res ? `, ${res.stats?.pages ?? 0} pages, ${found} courses` : ''}`);
      if (res?.samples?.length || (ok === 'ok' && !found)) {
        await mkdir(`${dir}/samples`, { recursive: true });
        const start = await polite.get(probe.start);
        if (start.html) await writeFile(`${dir}/samples/aca-${probe.term}-index.html`, start.html.slice(0, 400_000));
      }
      if (acaReadable) await save(probe, 'calendar', probe.start, res);
      changed++;
    }
    for (const t of aca) {
      const have = store.terms[t.term];
      if (acaReadable && (due(t, have) || have.source === 'opendata')) {
        if (polite.late) {
          left++;
          continue;
        }
        const res = await crawlTerm(t, polite, { log });
        if (res.subjects?.length) {
          await save(t, 'calendar', t.start, res);
          continue;
        }
      }
      // Open Data stands in from Winter 2020, as far back as it goes.
      if (Number(t.term) >= 1201 && odFetch && (!have || redo) && !(acaReadable && have?.source === 'calendar')) {
        const rows = await odFetch(t.term);
        const subjects = fromOpenData(rows);
        if (subjects.length) await save(t, 'opendata', 'https://openapi.data.uwaterloo.ca/v3/Courses/' + t.term, { subjects });
      }
    }

    // 2. Fall 2006 to Fall 2016: uwaterloo.ca/gsac-archive, newest first.
    for (const t of terms.filter((x) => x.kind === 'gsac').reverse()) {
      if (!due(t, store.terms[t.term])) continue;
      if (polite.late) {
        left++;
        continue;
      }
      const res = await crawlTerm(t, polite, { log });
      if (res.error || !res.subjects.length) {
        log.warn(`  ! ${t.term} ${t.label}: ${res.error ?? 'no course pages found'}`);
        report.terms[t.term] = { source: null, error: res.error ?? 'no course pages found', ...(res.stats ?? {}) };
        changed++;
        continue;
      }
      await save(t, 'calendar', t.start, res);
    }
  } catch (err) {
    if (err.message !== 'out of time') throw err;
    left++;
  }

  if (changed) {
    report.updated = new Date().toISOString();
    await writeJson(`${dir}/report.json`, report);
  }
  const s = polite.stats;
  log.log(`Grad archive: ${saved} terms read, ${left ? `${left}+ left for next time` : 'nothing left'}. ${s.fetched} fetched, ${s.cached} from cache, ${s.blocked} blocked by robots.txt, ${s.failed} failed.`);
  // Another run only if this one got somewhere: a site that's down or blocking shouldn't loop forever.
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed > 0}\nmore=${left > 0 && saved > 0}\n`);
  return { changed, saved, left };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
