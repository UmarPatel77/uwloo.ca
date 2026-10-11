// Finds course resources around the web and writes data/links/found.json. Run weekly by
// .github/workflows/find-links.yml; the build lists what it found under each course's Resources.
//
//   node scripts/find-links.mjs [--minutes 100] [--only reddit,lists,webrings,faculty,sites,github]
//
// Where it looks (data/links/sources.json, data/links/seeds/):
//   reddit    links posted on r/uwaterloo next to a course code (seeds from tools/links/reddit_links.py)
//   lists     students' link lists with a section per course
//   webrings  the CS, SE and ECE webrings: each member's site, and its notes or courses pages
//   faculty   department directories → profiles → personal sites → teaching pages
//   sites     course accounts like student.cs.uwaterloo.ca/~cs341/
//   github    repositories of course notes (never assignments or solutions)
//
// Every page is checked before it's listed: it has to load, and name the course (in its title, heading,
// text, address or the link to it). Dead links get an archived copy from the Wayback Machine, or go.
// It identifies itself (uwloo-links), follows robots.txt, fetches one page at a time per site with a
// pause in between, and caches pages in .cache/links/ so a weekly run refetches little.
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  USER_AGENT, canonical, classify, cleanTitle, codeHostReason, courseHome, directoryProfiles, homepageIn, isForumDump, isUW, looksLikeAnswers,
  parseRobots, readHtml, readMarkdown, robotsAllows, robotsDelay, skipReason, teachingLinks, textCodes, urlCodes, webringMembers,
} from './lib/links.mjs';

const DAY = 86_400_000;
const SOURCE_ORDER = ['course', 'faculty', 'list', 'webring', 'reddit', 'github'];

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (m) out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};
async function writeJson(path, value, pretty = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.part`, `${JSON.stringify(value, null, pretty ? 1 : 0)}\n`);
  await rename(`${path}.part`, path);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polite fetching: robots.txt, one request at a time per host with a pause, a deadline, a page cache. */
export class Fetcher {
  constructor({ delay = 1000, timeout = 20_000, maxBytes = 1_500_000, deadline = Infinity, maxPerHost = 1500, cache = {}, log = console } = {}) {
    Object.assign(this, { delay, timeout, maxBytes, deadline, maxPerHost, log });
    this.cache = cache;
    cache.pages ??= {};
    cache.robots ??= {};
    this.hosts = new Map();
    this.stats = { fetched: 0, cached: 0, blocked: 0, failed: 0 };
  }

  get late() {
    return Date.now() > this.deadline;
  }

  host(origin) {
    if (!this.hosts.has(origin)) this.hosts.set(origin, { chain: Promise.resolve(), count: 0, wait: this.delay });
    return this.hosts.get(origin);
  }

  /** Runs `fn` when it's this host's turn. */
  turn(origin, fn) {
    const h = this.host(origin);
    const run = h.chain.then(async () => {
      if (this.late) throw new Error('out of time');
      if (h.count++ >= this.maxPerHost) throw new Error('enough from this site for one run');
      try {
        return await fn();
      } finally {
        await sleep(h.wait);
      }
    });
    h.chain = run.catch(() => {});
    return run;
  }

  /** {groups} for a site, or {dead: 'ENOTFOUND'} when the site itself is gone. A flaky site is skipped this run. */
  async robots(origin) {
    const c = this.cache.robots[origin];
    if (c && Date.now() - c.t < (c.dead ? 30 : 7) * DAY) return c;
    const NONE = [{ agents: ['*'], rules: [{ allow: false, path: '/' }], delay: null }];
    let entry;
    try {
      const res = await this.turn(origin, () => fetch(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(this.timeout) }));
      if (res.ok) entry = { groups: parseRobots((await res.text()).slice(0, 500_000)) };
      else {
        await res.arrayBuffer().catch(() => {});
        entry = { groups: res.status >= 500 ? NONE : [] }; // 4xx: no robots.txt, so everything is allowed
      }
    } catch (err) {
      if (err.message === 'out of time') throw err;
      const code = err.cause?.code ?? '';
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|ERR_TLS|UNABLE_TO_VERIFY/i.test(code)) entry = { groups: NONE, dead: code };
      else return { groups: NONE }; // a timeout: try again next run, don't remember it
    }
    entry.t = Date.now();
    const d = robotsDelay(entry.groups);
    if (d) this.host(origin).wait = Math.min(Math.max(this.delay, d * 1000), 10_000);
    this.cache.robots[origin] = entry;
    return entry;
  }

  /**
   * One page: {status, url (after redirects), type, title, h1, text, links, md} or {status: 0, error}.
   * HTML is read and parsed; PDFs and other files are only checked (status and type).
   */
  async page(url, { ttl = 21 * DAY, raw = false } = {}) {
    const key = canonical(url);
    const hit = this.cache.pages[key];
    if (hit && Date.now() - hit.t < (hit.status >= 200 && hit.status < 300 ? ttl : 30 * DAY) && (!raw || hit.raw != null || hit.status !== 200)) {
      this.stats.cached++;
      return hit;
    }
    let cur = key;
    let out;
    for (let hop = 0; hop < 6; hop++) {
      const u = new URL(cur);
      const skip = skipReason(cur);
      if (skip) {
        out = { status: 0, error: skip };
        break;
      }
      const site = await this.robots(u.origin);
      if (site.dead) {
        out = { status: 0, error: site.dead };
        break;
      }
      if (!robotsAllows(site.groups, u.pathname + u.search)) {
        this.stats.blocked++;
        out = { status: 0, error: 'robots.txt' };
        break;
      }
      let res;
      try {
        res = await this.turn(u.origin, async () => {
          const r = await fetch(cur, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' }, redirect: 'manual', signal: AbortSignal.timeout(this.timeout) });
          this.stats.fetched++;
          const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
          const location = r.headers.get('location');
          let body = null;
          if (r.status === 200 && (type.includes('html') || type.startsWith('text/') || type.includes('json'))) body = await readLimited(r, this.maxBytes);
          else await r.body?.cancel().catch(() => {});
          return { status: r.status, type, location, body };
        });
      } catch (err) {
        if (err.message === 'out of time') throw err;
        this.stats.failed++;
        const code = err.cause?.code ?? '';
        // A site that no longer exists is worth remembering; a timeout or this run's per-site limit isn't.
        out = /ENOTFOUND|ECONNREFUSED|CERT|ERR_TLS|UNABLE_TO_VERIFY/i.test(code) ? { status: 0, error: code } : { status: 0, error: code || err.message || 'failed', transient: true };
        break;
      }
      if (res.status >= 300 && res.status < 400 && res.location) {
        cur = canonical(new URL(res.location, cur).href);
        continue;
      }
      out = { status: res.status, url: cur, type: res.type };
      if (res.body != null) {
        if (res.type.includes('html')) Object.assign(out, readHtml(res.body, cur));
        else out.text = res.body.slice(0, 20_000);
        if (raw) out.raw = res.body.slice(0, 400_000);
      }
      break;
    }
    out ??= { status: 0, error: 'too many redirects' };
    out.t = Date.now();
    // Kept small: what the checks need. Of a page's links, only those that could matter: ones naming a
    // number (a course code), and ones about teaching, notes, school or someone's own site.
    const keep = { ...out, text: out.text?.slice(0, 4000), links: out.links?.filter(interesting).slice(0, 300) };
    if (!raw) delete keep.raw;
    if (!out.transient && out.status !== 429 && !(out.status >= 500)) this.cache.pages[key] = keep;
    return out.raw ? { ...out, links: keep.links } : keep;
  }
}

const INTERESTING = /\d{3}|~|teach|course|class|notes?\b|lecture|school|uni|waterloo|\buw\b|study|resource|personal|home|web ?site|webpage|github/i;
const interesting = (l) => INTERESTING.test(`${l.href} ${l.text} ${l.before ?? ''}`);

async function readLimited(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

async function pool(items, n, fn) {
  let i = 0;
  const work = async () => {
    while (i < items.length) {
      const k = i++;
      try {
        await fn(items[k], k);
      } catch (err) {
        if (err.message === 'out of time') return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, work));
}

const RAW_GITHUB = /^https:\/\/raw\.githubusercontent\.com\//;
const HUB_SKIP = /(^|\.)(uwaterloo\.ca|youtube\.com|youtu\.be|twitch\.tv|cbc\.ca|ctvnews\.ca|coursera\.org|edx\.org|wusa\.ca|htdp\.org|global\.oup\.com|imgflip\.com|wlu\.ca)$/;
const HUB_OK_UW = /^(mathsoc|csclub|open\.math|student\.math|engsoc|wics|cscclub)\./;

export async function findLinks({ known, current = known, sources, seeds = {}, previous = { links: [] }, removed = [], only = null, fetcher, github = {}, wayback = 'https://archive.org/wayback/available', log = console }) {
  const want = (s) => !only || only.includes(s);
  const cands = new Map(); // url → {url, codes:Set, via:[...], anchor, home, trust}
  const add = (url, codes, via, { anchor = null, home = false, trust = false, api = null } = {}) => {
    let u = canonical(url);
    if (!u || skipReason(u)) return;
    const h = courseHome(u, known);
    if (h) {
      u = h.url;
      codes = [h.code];
      home = true;
    }
    codes = codes.filter((c) => known.has(c));
    if (!codes.length) return;
    const c = cands.get(u) ?? { url: u, codes: new Set(), via: [], anchor: null, home: false, trust: false };
    for (const code of codes) c.codes.add(code);
    if (!c.via.some((v) => v.type === via.type && v.url === via.url && v.name === via.name)) c.via.push(via);
    c.anchor ??= anchor;
    c.home ||= home;
    c.trust ||= trust;
    c.api ??= api;
    cands.set(u, c);
  };
  /** Links on a page that name a course, in the address or the link text. */
  const harvest = (page, via, { limit = 80, sameHostOnly = false } = {}) => {
    let n = 0;
    for (const l of page.links ?? []) {
      if (n >= limit) break;
      if (sameHostOnly && new URL(l.href).hostname !== new URL(page.url).hostname) continue;
      const codes = [...new Set([...urlCodes(l.href, known), ...textCodes(l.text, known)])];
      if (!codes.length) continue;
      add(l.href, codes, via, { anchor: l.text || null });
      n++;
    }
  };
  const counts = {};
  const tally = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  const stages = [];

  // r/uwaterloo: links that name a course are candidates; front pages (hubs) get opened for theirs.
  if (want('reddit') && seeds.reddit) {
    stages.push(async () => {
      const hubs = [];
      for (const s of seeds.reddit.seeds) {
        const via = { type: 'reddit', post: s.thread?.post, comment: s.thread?.comment, t: s.first, n: s.n };
        if (s.kind === 'link') add(s.url, s.codes, via, { anchor: s.anchor });
        else {
          const host = new URL(s.url).hostname.replace(/^www\./, '');
          if ((HUB_SKIP.test(host) && !HUB_OK_UW.test(host)) || skipReason(s.url)) continue;
          hubs.push([s, via]);
        }
      }
      tally('reddit seeds', seeds.reddit.seeds.length);
      await pool(hubs, 6, async ([s, via]) => {
        const page = await fetcher.page(s.url);
        if (page.status === 200) harvest(page, { ...via, hub: s.url }, { limit: 60 });
      });
    });
  }

  // Students' link lists: a Markdown file with a section per course.
  if (want('lists')) {
    stages.push(async () => {
      for (const list of sources.lists ?? []) {
        const page = await fetcher.page(list.url, { raw: true });
        if (page.status !== 200) {
          log.warn(`! list ${list.name}: ${page.status || page.error}`);
          continue;
        }
        const links = readMarkdown(page.raw ?? page.text, list.url, known).filter((l) => l.codes.length);
        for (const l of links) add(l.href, l.codes, { type: 'list', name: list.name, url: list.site ?? list.url }, { anchor: l.text || null, trust: true });
        tally('list links', links.length);
      }
    });
  }

  // Webrings: each member's site, and up to a few of its pages about notes or courses.
  if (want('webrings')) {
    stages.push(async () => {
      const members = [];
      for (const ring of sources.webrings ?? []) {
        const page = await fetcher.page(ring.list, { raw: true });
        const got = page.status === 200 ? webringMembers(page.raw ?? page.text) : [];
        if (!got.length) log.warn(`! webring ${ring.name}: no members read (${page.status || page.error})`);
        for (const m of got) members.push({ ...m, ring: ring.name });
        tally(`${ring.name} members`, got.length);
      }
      await pool(members, 8, async (m) => {
        const via = { type: 'webring', ring: m.ring, name: m.name, url: m.url };
        const home = await fetcher.page(m.url);
        if (home.status !== 200) return;
        harvest(home, via);
        const more = (home.links ?? [])
          .filter((l) => {
            try {
              return new URL(l.href).hostname === new URL(home.url).hostname && /\b(notes?|courses?|school|uni(versity)?|waterloo|uw|study|teaching|resources?)\b/i.test(`${l.text} ${new URL(l.href).pathname.replace(/[_\-/.]/g, ' ')}`);
            } catch {
              return false;
            }
          })
          .map((l) => l.href)
          .filter((h, i, a) => a.indexOf(h) === i && canonical(h) !== canonical(home.url))
          .slice(0, 5);
        for (const href of more) {
          const p = await fetcher.page(href);
          if (p.status === 200) harvest(p, via);
        }
      });
    });
  }

  // Professors: directory → profile → personal site → teaching page → course pages.
  if (want('faculty')) {
    stages.push(async () => {
      const profiles = [];
      for (const dir of sources.directories ?? []) {
        const page = await fetcher.page(dir.url, { raw: true, ttl: 14 * DAY });
        const got = page.status === 200 && page.raw ? directoryProfiles(page.raw, page.url) : [];
        if (!got.length) log.warn(`! directory ${dir.name}: no profiles read (${page.status || page.error})`);
        for (const p of got) profiles.push({ url: p, dept: dir.name });
        tally('profiles', got.length);
      }
      await pool(profiles, 6, async (prof) => {
        const page = await fetcher.page(prof.url, { ttl: 60 * DAY });
        if (page.status !== 200) return;
        const name = (page.h1 || cleanTitle(page.title, prof.url)).replace(/\s*\|.*$/, '');
        const via0 = { type: 'faculty', name, dept: prof.dept, url: prof.url };
        harvest(page, via0, { limit: 30 });
        const home = homepageIn(page, page.url);
        if (!home || skipReason(home)) return;
        tally('personal sites');
        const hp = await fetcher.page(home);
        if (hp.status !== 200) return;
        const via = { ...via0, url: hp.url };
        harvest(hp, via);
        for (const t of teachingLinks(hp, hp.url)) {
          const tp = await fetcher.page(t);
          if (tp.status === 200) harvest(tp, via);
        }
      });
    });
  }

  // Course accounts: student.cs.uwaterloo.ca/~cs341/ and the like, for every course in those subjects.
  if (want('sites')) {
    stages.push(async () => {
      for (const pattern of sources.course_sites ?? []) {
        const subjects = new Set(pattern.subjects);
        for (const code of current) { // a retired course's account is long gone
          const m = /^([A-Z]+)(\d{3}[A-Z]?)$/.exec(code);
          if (m && subjects.has(m[1])) add(pattern.url.replace('{code}', code.toLowerCase()), [code], { type: 'course' }, { home: true });
        }
      }
    });
  }

  // GitHub: repositories of notes, cheat sheets and summaries for Waterloo courses.
  if (want('github') && github.token !== undefined) {
    stages.push(async () => {
      const api = github.api ?? 'https://api.github.com';
      const headers = { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT, ...(github.token && { authorization: `Bearer ${github.token}` }) };
      const repos = new Map();
      for (const q of sources.github_search ?? []) {
        for (let pg = 1; pg <= 3 && !fetcher.late; pg++) {
          const res = await fetch(`${api}/search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${pg}`, { headers, signal: AbortSignal.timeout(30_000) }).catch(() => null);
          if (!res?.ok) break;
          const items = (await res.json()).items ?? [];
          for (const r of items) repos.set(r.full_name, r);
          if (items.length < 100) break;
          await sleep(2500); // search allows 30 requests a minute
        }
      }
      tally('github repos seen', repos.size);
      for (const r of repos.values()) {
        const about = `${r.full_name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`;
        if (r.fork || r.archived && !r.description) continue;
        if (!/waterloo|uwaterloo|\buw\b/i.test(about)) continue;
        if (!/notes?|summar|cheat|study|review|textbook|course/i.test(about) || looksLikeAnswers(r.full_name, r.description)) continue;
        const codes = [...new Set([...urlCodes(r.html_url, known), ...textCodes(r.description ?? '', known)])];
        if (codes.length && codes.length <= 3) {
          add(r.html_url, codes, { type: 'github', name: r.owner?.login, url: r.html_url }, { anchor: r.description ?? null, trust: true, api: { title: r.description ? `${r.name}: ${r.description}` : r.full_name } });
        }
      }
    });
  }

  // Looking around gets up to 60% of the time; checking what was found gets the rest.
  const end = fetcher.deadline;
  if (Number.isFinite(end)) fetcher.deadline = Date.now() + (end - Date.now()) * 0.6;
  await Promise.all(stages.map((s) => s().catch((err) => log.warn(`! stage failed: ${err.stack ?? err.message}`))));
  fetcher.deadline = end;
  tally('candidates', cands.size);

  // Check every candidate.
  const prev = new Map((previous.links ?? []).map((l) => [l.url, l]));
  const found = new Map();
  const isRemoved = (url) => removed.some((r) => (r.endsWith('*') ? url.startsWith(r.slice(0, -1)) : r.includes('/') ? url === r : new URL(url).hostname.replace(/^www\./, '') === r));
  const sortVia = (vias) => [...vias].sort((a, b) => SOURCE_ORDER.indexOf(a.type) - SOURCE_ORDER.indexOf(b.type));
  const today = new Date().toISOString().slice(0, 10);
  const why = {};
  const decided = new Set(); // URLs settled this run, kept or left out

  await pool([...cands.values()], 10, async (c) => {
    const drop = (reason) => {
      why[reason] = (why[reason] ?? 0) + 1;
      if (!/couldn't check/.test(reason)) decided.add(c.url);
    };
    if (isRemoved(c.url)) return drop('removed on request');
    const via = sortVia(c.via);
    const best = via[0];
    const official = c.home || best.type === 'course';
    if (c.api) {
      // A repository GitHub's API just described: it exists, so there's no page to fetch.
      const old = prev.get(c.url);
      const title = cleanTitle(c.api.title, c.url);
      decided.add(c.url);
      found.set(c.url, { url: c.url, codes: [...c.codes].sort(), ...classify({ url: c.url, title }), title, via, status: 'ok', first_seen: old?.first_seen ?? today, checked: today });
      if (!found.get(c.url).term) delete found.get(c.url).term;
      return;
    }
    const page = await fetcher.page(c.url);
    const old = prev.get(c.url);
    const keepOld = () => {
      if (old && Date.now() - Date.parse(old.checked) < 60 * DAY) found.set(c.url, old);
      return drop(`couldn't check (${page.status || page.error})`);
    };
    if (page.status === 0 && page.error === 'robots.txt') return drop('robots.txt');
    if (page.status === 404 || page.status === 410 || (page.status === 0 && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|SSL/i.test(page.error ?? ''))) {
      // Gone. Reddit's old links are worth an archived copy; a probed course account isn't.
      if (best.type === 'course' && via.length === 1) return drop('no such course site');
      const snap = await archived(c.url, best.t, fetcher, wayback);
      if (!snap) return drop('gone, no archived copy');
      if (!official && looksLikeAnswers(c.url, c.anchor)) return drop('assignments or solutions');
      const { kind, term } = classify({ url: c.url, anchor: c.anchor ?? '', home: c.home });
      decided.add(c.url);
      found.set(c.url, {
        url: c.url, codes: [...c.codes].sort(), kind, title: cleanTitle(c.anchor || '', c.url), term, via, status: 'archived', archived: snap.url,
        archived_on: snap.date, first_seen: old?.first_seen ?? today, checked: today,
      });
      return;
    }
    if (page.status !== 200) return keepOld();
    const final = page.url ?? c.url;
    if (skipReason(final)) return drop('redirects somewhere skipped');
    const isHtml = (page.type ?? '').includes('html');
    if (!isHtml && !/pdf/.test(page.type ?? '')) return drop('not a web page or PDF');
    let codes = [...c.codes];
    if (isHtml && !c.trust) {
      const named = new Set([...textCodes(`${page.title} ${page.h1} ${page.text}`, known), ...urlCodes(final, known)]);
      codes = codes.filter((x) => named.has(x));
      if (!codes.length) return drop("page doesn't name the course");
      if (!isUW(new URL(final).hostname) && best.type === 'reddit' && !/waterloo|\buw\b/i.test(`${page.title} ${page.text}`) && !via.some((v) => v.type !== 'reddit')) {
        // A Reddit link off campus that never says Waterloo might be another school's course.
        if (!urlCodes(final, known).length) return drop("doesn't say Waterloo");
      }
    } else if (!isHtml && !c.trust) {
      const named = new Set([...urlCodes(final, known), ...textCodes(c.anchor ?? '', known)]);
      codes = codes.filter((x) => named.has(x));
      if (!codes.length) return drop("file name doesn't name the course");
    }
    if (!official && looksLikeAnswers(final, page.title, c.anchor)) return drop('assignments or solutions');
    if (isForumDump(final)) return drop('a copy of a course forum');
    const codeHost = codeHostReason(final, `${page.title ?? ''} ${c.anchor ?? ''}`);
    if (codeHost && !(c.trust && codeHost === 'code, not notes')) return drop(codeHost);
    const title = cleanTitle(isHtml ? page.title || page.h1 : c.anchor || '', final);
    const { kind, term } = classify({ url: final, title, anchor: c.anchor ?? '', home: official || (best.type === 'faculty' && isHtml && textCodes(page.title, known).length > 0) });
    let key = canonical(final) ?? c.url;
    const twin = key.endsWith('/') ? key.slice(0, -1) : `${key}/`; // "/repo" and "/repo/" are one page
    if (found.has(twin)) key = twin;
    const prior = found.get(key);
    const entry = {
      url: key, codes: [...new Set([...(prior?.codes ?? []), ...codes])].sort(), kind, title, term, via: sortVia([...(prior?.via ?? []), ...via]).slice(0, 4), status: 'ok',
      first_seen: old?.first_seen ?? prev.get(key)?.first_seen ?? today, checked: today,
    };
    if (!entry.term) delete entry.term;
    decided.add(c.url);
    found.set(key, entry);
  });

  // Last run's finds that this run didn't settle (out of time, site down) stay for 60 days after their last check.
  for (const [url, l] of prev) if (!found.has(url) && !decided.has(url) && Date.now() - Date.parse(l.checked) < 60 * DAY && !isRemoved(url)) found.set(url, l);

  const links = [...found.values()].sort((a, b) => a.codes[0].localeCompare(b.codes[0], 'en', { numeric: true }) || a.url.localeCompare(b.url));
  return { links, counts, dropped: why };
}

/** The Wayback Machine's copy closest to when it was posted. */
async function archived(url, t, fetcher, api) {
  const stamp = t ? new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '') : '';
  const page = await fetcher.page(`${api}?url=${encodeURIComponent(url)}${stamp ? `&timestamp=${stamp}` : ''}`, { raw: true, ttl: 90 * DAY }).catch(() => null);
  if (page?.status !== 200) return null;
  try {
    const snap = JSON.parse(page.raw ?? page.text).archived_snapshots?.closest;
    if (!snap?.available || !/^2\d\d$/.test(String(snap.status))) return null;
    return { url: snap.url.replace(/^http:/, 'https:'), date: `${snap.timestamp.slice(0, 4)}-${snap.timestamp.slice(4, 6)}-${snap.timestamp.slice(6, 8)}` };
  } catch {
    return null;
  }
}

/** Every course with a page on uwloo; `current` leaves out the ones no longer offered (flagged in search.json). */
async function knownCourses(where) {
  const src = where ?? 'https://uwloo.ca/search.json';
  const rows = /^https?:/.test(src)
    ? await (await fetch(src, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })).json()
    : JSON.parse(await readFile(src, 'utf8'));
  return { known: new Set(rows.map((r) => r[0])), current: new Set(rows.filter((r) => !r[2]).map((r) => r[0])) };
}

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  const started = Date.now();
  const minutes = Number(a.minutes ?? 100);
  const dataDir = a.data ?? 'data/links';
  const cachePath = a.cache ?? '.cache/links/cache.json';
  const out = a.out ?? `${dataDir}/found.json`;
  const { known, current } = await knownCourses(a.courses);
  const sources = await readJson(a.sources ?? `${dataDir}/sources.json`, {});
  const seeds = { reddit: await readJson(`${dataDir}/seeds/reddit.json`, null) };
  const previous = await readJson(out, { links: [] });
  const removed = (await readFile(`${dataDir}/removed.txt`, 'utf8').catch(() => ''))
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => (l.includes('/') ? canonical(l.replace(/\*$/, '')) + (l.endsWith('*') ? '*' : '') : l.replace(/^www\./, '')));
  const cache = await readJson(cachePath, {});
  const fetcher = new Fetcher({ delay: Number(a.delay ?? 1000), deadline: started + minutes * 60_000, maxPerHost: Number(a['max-per-host'] ?? 1500), cache });
  const only = typeof a.only === 'string' ? a.only.split(',') : null;
  console.log(`Finding links for ${known.size} courses (${known.size - current.size} no longer offered; ${minutes} min budget${only ? `, only ${only.join(', ')}` : ''})`);
  // Save the cache every few minutes, so a run that's cut off still helps the next one.
  const saver = setInterval(() => writeJson(cachePath, cache).catch(() => {}), 5 * 60_000);
  let result;
  try {
    result = await findLinks({
      known, current, sources, seeds, previous, removed, only, fetcher,
      github: { token: process.env.GITHUB_TOKEN ?? (a.github ? '' : undefined), api: process.env.GITHUB_API_URL },
      wayback: a.wayback ?? 'https://archive.org/wayback/available',
    });
  } finally {
    clearInterval(saver);
    await writeJson(cachePath, cache);
  }
  const { links, counts, dropped } = result;
  const courses = new Set(links.flatMap((l) => l.codes));
  const bySource = {};
  for (const l of links) bySource[l.via[0].type] = (bySource[l.via[0].type] ?? 0) + 1;
  await writeJson(out, { generated: new Date().toISOString(), courses: courses.size, by_source: bySource, links }, true);
  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  const lines = [
    `### Link finder`,
    '',
    `${links.length} links for ${courses.size} courses (${links.filter((l) => l.status === 'archived').length} as archived copies), in ${mins} min.`,
    '',
    `| Found through | Links |`, `| --- | --- |`, ...Object.entries(bySource).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `| Looked at | |`, `| --- | --- |`, ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`),
    `| pages fetched / from cache / blocked by robots.txt / failed | ${fetcher.stats.fetched} / ${fetcher.stats.cached} / ${fetcher.stats.blocked} / ${fetcher.stats.failed} |`,
    '',
    `| Left out because | |`, `| --- | --- |`, ...Object.entries(dropped).sort((x, y) => y[1] - x[1]).map(([k, v]) => `| ${k} | ${v} |`),
  ].join('\n');
  console.log(lines);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
