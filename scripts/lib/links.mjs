// The link finder's rules: which pages count as resources for which course, and how to read robots.txt
// and HTML. Pure functions, unit-tested; scripts/find-links.mjs does the fetching.

export const UA_TOKEN = 'uwloo-links';
export const USER_AGENT = `${UA_TOKEN}/1.0 (+https://uwloo.ca/about/links/)`;

// ---------------- robots.txt ----------------

/** robots.txt → [{agents: [...], rules: [{allow, path}], delay}] */
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [], delay: null }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value || key === 'allow') cur.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay' && Number.isFinite(Number(value))) cur.delay = Number(value);
  }
  return groups;
}

const ruleRe = (path) => new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);

/** Whether `ua` may fetch `path` (path + query). Longest matching rule wins; Allow wins ties. */
export function robotsAllows(groups, path, ua = UA_TOKEN) {
  const name = ua.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== '*' && name.includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (r.path === '' ) continue;
    if (!ruleRe(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

export function robotsDelay(groups, ua = UA_TOKEN) {
  const name = ua.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== '*' && name.includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  return group?.delay ?? null;
}

// ---------------- HTML ----------------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
export const decode = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
const squash = (s) => decode(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** {title, h1, text (start of the visible text), links: [{href, text}]} with hrefs made absolute. */
export function readHtml(html, base) {
  const src = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const title = squash(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1] ?? '');
  const h1 = squash(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(src)?.[1] ?? '');
  const baseHref = /<base\s[^>]*href\s*=\s*["']([^"']+)["']/i.exec(src)?.[1];
  const root = (() => {
    try {
      return new URL(baseHref ?? base, base);
    } catch {
      return null;
    }
  })();
  const links = [];
  for (const m of src.matchAll(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decode((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!raw || /^(#|mailto:|javascript:|tel:|data:)/i.test(raw)) continue;
    try {
      const u = new URL(raw, root ?? undefined);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      u.hash = '';
      // The words just before a link label it too: "Link to personal webpage: https://melczer.ca"
      const before = squash(src.slice(Math.max(0, m.index - 300), m.index)).slice(-60);
      links.push({ href: u.href, text: squash(m[4]).slice(0, 200), ...(before && { before }) });
    } catch {}
    if (links.length >= 600) break;
  }
  const body = src.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ');
  const text = squash(/<body[^>]*>([\s\S]*)<\/body>/i.exec(body)?.[1] ?? body).slice(0, 20_000);
  return { title, h1, text, links };
}

/** Links in Markdown: under a heading that names courses, each link belongs to those courses. */
export function readMarkdown(md, base, known) {
  const out = [];
  let codes = [];
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      codes = textCodes(h[1], known);
      continue;
    }
    for (const m of line.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|(?<![(\[])(https?:\/\/[^\s<>)\]]+)/g)) {
      const href = m[2] ?? m[3];
      const here = textCodes(line, known);
      try {
        out.push({ href: new URL(href, base).href, text: (m[1] ?? '').trim(), codes: here.length ? here : codes });
      } catch {}
    }
  }
  return out;
}

// ---------------- course codes ----------------

/** Codes in prose: written in capitals ("CS 341", "CS341", "C&O 350" → CO350), and only real courses. */
export function textCodes(text, known) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/(?<![A-Za-z0-9&])(C&O|E&CE|[A-Z]{2,8}) ?(\d{3}[A-Z]?)(?![0-9A-Za-z])/g)) {
    const subj = m[1] === 'C&O' ? 'CO' : m[1] === 'E&CE' ? 'ECE' : m[1];
    const code = subj + m[2];
    if (known.has(code)) out.push(code);
    else if (known.has(subj + m[2].slice(0, 3))) out.push(subj + m[2].slice(0, 3));
  }
  return [...new Set(out)];
}

/** Codes a URL names, in any case: ~cs245, stat330-notes.pdf, CS480-winter2020.html, /cs/341/. */
export function urlCodes(url, known) {
  let path;
  try {
    const u = new URL(url);
    path = decodeURIComponent(u.hostname.split('.')[0] + u.pathname + u.search).toLowerCase();
  } catch {
    return [];
  }
  const out = [];
  for (const m of path.matchAll(/(?<![a-z0-9])([a-z]{2,8})(?:[-_ +/]|%20)?(\d{3})([a-z]?)(?![0-9a-z])/g)) {
    const code = (m[1] + m[2]).toUpperCase();
    const withSuffix = code + m[3].toUpperCase();
    if (m[3] && known.has(withSuffix)) out.push(withSuffix);
    else if (known.has(code)) out.push(code);
  }
  return [...new Set(out)];
}

// ---------------- URLs ----------------

const TRACKING = /^(utm_|fbclid$|gclid$|ref$|ref_src$|s$|si$|feature$|share$)/;

/** One spelling per page: https when it was given, no tracking parameters, no fragment, no "www." doubles. */
export function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname === '') u.pathname = '/';
    // Google cache leftovers on Reddit: "outline.html+&cd=1&hl=en"
    u.pathname = u.pathname.replace(/\+&.*$/, '');
    return u.href;
  } catch {
    return null;
  }
}

/** A course account's site (student.cs.uwaterloo.ca/~cs341/…, ece.uwaterloo.ca/~ece327/…) → its front page. */
export function courseHome(url, known) {
  try {
    const u = new URL(url);
    const m = /^\/~([a-z]{2,8})(\d{3}[a-z]?)(\/|$)/i.exec(u.pathname);
    if (!m) return null;
    const code = (m[1] + m[2]).toUpperCase();
    if (!known.has(code) && !known.has(code.slice(0, -1))) return null;
    const host = u.host.replace(/^www\./, '');
    const scheme = isUW(u.hostname) ? 'https:' : u.protocol; // Waterloo's servers all do https now
    return { url: `${scheme}//${host}/~${m[1].toLowerCase()}${m[2].toLowerCase()}/`, code: known.has(code) ? code : code.slice(0, -1) };
  } catch {
    return null;
  }
}

const UW = /(^|\.)(uwaterloo\.ca|sju\.ca|renison\.ca|uwaterloo\.edu|grebel\.ca|stpauls\.uwaterloo\.ca)$/;
export const isUW = (host) => UW.test(host);

// Never fetched or listed: social media, chat, shopping, sign-in walls, uwloo's own sources, paywalled
// homework sites, file lockers whose contents can't be checked, and other universities' courses.
const SKIP_HOST = new RegExp(
  `(^|\\.)(${[
    'reddit\\.com', 'redd\\.it', 'removeddit\\.com', 'imgur\\.com', 'gyazo\\.com', 'puu\\.sh', 'fbcdn\\.net', 'giphy\\.com',
    'uwflow\\.com', 'ucalendar\\.uwaterloo\\.ca', 'ugradcalendar\\.uwaterloo\\.ca', 'classes\\.uwaterloo\\.ca', 'outline\\.uwaterloo\\.ca',
    'adm\\.uwaterloo\\.ca', 'quest\\.pecs\\.uwaterloo\\.ca', 'learn\\.uwaterloo\\.ca', 'crowdmark\\.com', 'piazza\\.com', 'mobius\\.uwaterloo\\.ca',
    'wstore\\.uwaterloo\\.ca', 'waterlooworks\\.uwaterloo\\.ca', 'portal\\.uwaterloo\\.ca', 'odyssey\\.uwaterloo\\.ca', 'edstem\\.org',
    'discord\\.gg', 'discord\\.com', 'facebook\\.com', 'twitter\\.com', 'x\\.com', 'instagram\\.com', 'linkedin\\.com', 'tiktok\\.com',
    'amazon\\.ca', 'amazon\\.com', 'ratemyprofessors\\.com', 'ratemyprofessor\\.com', 'birdcourses\\.com', 'uwcourse\\.atomala\\.com',
    'coursehero\\.com', 'chegg\\.com', 'studocu\\.com', 'quizlet\\.com', 'scribd\\.com', 'oneclass\\.com', 'slader\\.com', 'bartleby\\.com',
    'dropbox\\.com', 'drive\\.google\\.com', 'docs\\.google\\.com', 'sites\\.google\\.com', '1drv\\.ms', 'onedrive\\.live\\.com', 'mega\\.nz',
    'forms\\.gle', 'forms\\.office\\.com', 'google\\.com', 'goo\\.gl', 'bit\\.ly', 'tinyurl\\.com', 'wikipedia\\.org', 'scholar\\.google\\.com',
    'orcid\\.org', 'researchgate\\.net', 'academia\\.edu', 'arxiv\\.org', 'doi\\.org', 'dblp\\.org', 'semanticscholar\\.org',
    // other universities (their CS 107 isn't Waterloo's)
    '[a-z0-9-]+\\.edu', 'utoronto\\.ca', 'ualberta\\.ca', 'ubc\\.ca', 'mcgill\\.ca', 'yorku\\.ca', 'queensu\\.ca', 'uottawa\\.ca', 'carleton\\.ca',
    'mcmaster\\.ca', 'uwo\\.ca', 'wlu\\.ca', 'sfu\\.ca', 'umanitoba\\.ca', 'usask\\.ca', 'ucalgary\\.ca', 'uvic\\.ca', 'dal\\.ca', 'concordia\\.ca',
    'torontomu\\.ca', 'ryerson\\.ca', 'uoguelph\\.ca', 'brocku\\.ca', 'ox\\.ac\\.uk', 'cam\\.ac\\.uk',
  ].join('|')})$`,
);
const SKIP_PATH = /\.(png|jpe?g|gif|webp|svg|ico|mp4|mov|zip|tar|gz|exe|dmg|docx?|pptx?|xlsx?)$/i;

/** Why a URL is never listed, or null. */
export function skipReason(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'not a URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'not http';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (u.hostname.toLowerCase() === 'uwloo.ca' || host.endsWith('uwloo.ca') || host.endsWith('uwloo.com')) return 'uwloo itself';
  if (SKIP_HOST.test(host) && !(host === 'youtube.com' || host === 'youtu.be')) return 'skipped site';
  if (SKIP_PATH.test(u.pathname)) return 'file type';
  if (RUDE.test(host.replace(/[.-]/g, ' '))) return 'rude';
  return null;
}
const RUDE = /\b(ass|arse|fuck\w*|shit\w*|porn\w*|sex\w*|xxx|cunt|dick)\b/i;

// Assignment and solution sets from anyone but the course itself would help people copy, not learn.
const ANSWERS = /solutions?\b|\bsolns?\b|\banswers?\b|answer[\s_-]?key|assignments?\b|\bassn\s?\d|\ba\d{1,2}[a-z]?\b|\bhw\s?\d|homework|problem[\s_-]?sets?|\bpset|\bprojects?\b|\blabs?\s?\d|tutorial[\s_-]?sol/i;
export const looksLikeAnswers = (...texts) => texts.some((t) => ANSWERS.test(String(t ?? '').replace(/[_-]/g, ' ')));

// Code hosts are full of course repos that are someone's assignments; only notes count there.
const CODE_HOST = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$/;
const NOTES_SIGNAL = /notes?\b|summar|cheat ?sheet|study|review|textbook|lecture|slides|course ?book|exam ?prep/i;
/** Why a page on GitHub (or the like) isn't a resource, or null. */
export function codeHostReason(url, title = '') {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!CODE_HOST.test(u.hostname)) return null;
  if (/^\/(topics|search|orgs|marketplace|explore|trending|collections)\b|\/(issues|pulls|actions|wiki\/?$)/.test(u.pathname)) return 'not a repository';
  return NOTES_SIGNAL.test(`${decodeURIComponent(u.pathname).replace(/[_\-/.]+/g, ' ')} ${title}`) ? null : 'code, not notes';
}
// Never: copies of course forums (other students' posts).
export const isForumDump = (url) => /piazza|edstem|campuswire/i.test(String(url));

// ---------------- what a page is ----------------

const KIND_RULES = [
  ['cheatsheet', /cheat ?sheet|formula sheet|crib sheet|aid sheet/i],
  ['videos', /\b(youtube|youtu\.be|playlist|lecture (videos?|recordings?)|recordings)\b/i],
  ['midterm', /mid ?terms?\b/i],
  ['final', /\bfinals?\b|final exam/i],
  ['exam', /\bexams?\b|exam ?bank|past (papers|tests)|\bquiz(zes)?\b/i],
  ['slides', /\bslides?\b|lecture ?\d+ ?\.?pdf/i],
  ['outline', /\b(course )?outline\b|\bsyllabus\b/i],
  ['notes', /\bnotes?\b|\bsummar(y|ies)\b|\bstudy guide\b|\btextbook\b|\bcourse ?book\b|\breview\b/i],
];

/** {kind, term} from what's known about a page. A course's own site is "site". */
export function classify({ url, title = '', anchor = '', home = false }) {
  const words = `${anchor} ${title} ${decodeURIComponent(String(url)).replace(/[_\-/.]+/g, ' ')}`;
  let kind = home ? 'site' : null;
  if (!kind) for (const [k, re] of KIND_RULES) if (re.test(words)) (kind ??= k);
  if (!kind && /\.pdf$/i.test(new URL(url).pathname)) kind = 'notes';
  return { kind: kind ?? 'other', term: termIn(`${url} ${title} ${anchor}`) };
}

const SEASONS = { w: 1, winter: 1, s: 5, spring: 5, summer: 5, f: 9, fall: 9, autumn: 9 };
/** "w17", "/s20/", "Fall 2019", "winter2020", "1249" → a term code, or null. */
export function termIn(s) {
  const t = String(s ?? '').toLowerCase();
  const code = (y, season) => (y >= 1990 && y <= 2099 ? `${Math.floor(y / 100) - 19}${String(y % 100).padStart(2, '0')}${SEASONS[season]}` : null);
  let m = /\b(winter|spring|summer|fall|autumn)[\s_-]*(20\d\d|19\d\d)\b/.exec(t) ?? /\b(20\d\d)[\s_-]*(winter|spring|summer|fall|autumn)\b/.exec(t);
  if (m) return /^\d/.test(m[1]) ? code(Number(m[1]), m[2]) : code(Number(m[2]), m[1]);
  m = /(?<![a-z])([wsf])(\d\d)(?![0-9a-z])/.exec(t); // w17, /s20/, ece428w12
  if (m) return code(2000 + Number(m[2]), m[1]);
  m = /(?<![0-9])(1[0-3]\d[159])(?![0-9])/.exec(t);
  return m ? m[1] : null;
}

/** "CS 341: Algorithms (Fall 2026) | Cheriton School…" → "CS 341: Algorithms (Fall 2026)". */
export function cleanTitle(title, url) {
  let t = String(title ?? '').replace(/\s+/g, ' ').trim();
  // GitHub: "GitHub - shinew/cs341: CS 341 notes" → "CS 341 notes"; "co487/classnotes.pdf at master · mtahmed/notes" → "co487/classnotes.pdf"
  // Drop a trailing site name ("… | Cheriton School of Computer Science"), but not half of "CS 341 – Algorithms".
  const m = /^(.{8,}?)\s+[|·–—]\s+([^|·–—\d]{1,45})$/.exec(t);
  if (m) t = m[1].trim();
  t = t.replace(/^GitHub - [^\s:]+(?:: (.+))?$/, (m, d) => d ?? m.replace(/^GitHub - /, '')).replace(/ at (master|main|[0-9a-f]{7,40}) · [^\s]+$/, '');
  if (t.length > 110) t = `${t.slice(0, 107).replace(/\s+\S*$/, '')}…`;
  if (!t || /^(index of|home|untitled|404|page not found)\b/i.test(t)) {
    try {
      const u = new URL(url);
      t = `${u.hostname.replace(/^www\./, '')}${decodeURIComponent(u.pathname).replace(/\/$/, '')}`;
    } catch {}
  }
  return t;
}

// ---------------- webring and directory lists ----------------

/** Member sites from a webring's source file (JS or JSON with name/website pairs, in either order). */
export function webringMembers(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/\{[^{}]*?\}/g)) {
    const name = /["']?name["']?\s*:\s*["']([^"']+)["']/.exec(m[0])?.[1];
    const site = /["']?(?:website|url|site|link)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(m[0])?.[1];
    if (site && !/linkedin\.com|github\.com\/?$/.test(site)) out.push({ name: name ?? null, url: site });
  }
  return out;
}

const PROFILE_TITLE = /\b(professor|lecturer|instructor|teaching)\b/i;

/**
 * Profile pages listed in a department directory: links on the same host under the directory (or the
 * site's /people/ and /contacts/), whose entry mentions a teaching title when the page has titles at all.
 */
export function directoryProfiles(html, dirUrl) {
  const dir = new URL(dirUrl);
  const page = String(html ?? '');
  const out = new Map();
  for (const m of page.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try {
      u = new URL(decode(m[1]), dir);
    } catch {
      continue;
    }
    if (u.hostname !== dir.hostname) continue;
    const p = u.pathname.replace(/\/$/, '');
    const under = p.startsWith(dir.pathname.replace(/\/$/, '') + '/') || /\/(people|contacts|profiles?|people-profiles)\/[^/]+$/.test(p);
    if (!under || /\/(page|search|filter|group|groups|category|tags?)\b/.test(p) || u.search) continue;
    // The entry's title comes right after the name: up to the next link (often the email), at most 400 characters.
    const rest = page.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const after = rest.slice(0, rest.search(/<a\s/i) + 1 || rest.length).replace(/<[^>]+>/g, ' ');
    out.set(u.href, PROFILE_TITLE.test(after));
  }
  const titled = [...out.values()].some(Boolean);
  return [...out].filter(([, t]) => !titled || t).map(([href]) => href);
}

const HOMEPAGE_TEXT = /\b(personal|home|my)\s*(web)?\s*(page|site)\b|\bhomepage\b|^\s*(personal\s+)?web\s?site\s*$/i;
const SOCIAL = /linkedin|twitter|x\.com|facebook|instagram|scholar\.google|orcid|researchgate|dblp|github\.com\/?$|youtube|mailto/i;

/** A profile page's link to its owner's own site. */
export function homepageIn(page, profileUrl) {
  const prof = new URL(profileUrl);
  const off = page.links.filter((l) => {
    const u = new URL(l.href);
    if (u.hostname === prof.hostname && !/\/~/.test(u.pathname)) return false; // the department's own pages
    if (/(^|\.)uwaterloo\.ca$/.test(u.hostname) && !/\/~/.test(u.pathname) && u.pathname.split('/').filter(Boolean).length <= 1) return false; // site-wide links
    return !SOCIAL.test(l.href);
  });
  const label = (l) => `${(l.before ?? '').split(/[.!?]\s/).at(-1)} ${l.text}`;
  return (
    off.find((l) => HOMEPAGE_TEXT.test(l.text)) ??
    off.find((l) => /\b(personal|home)\s*(web)?\s*(page|site)\b|\bhomepage\b/i.test(label(l))) ??
    off.find((l) => /\/~[a-z0-9._-]+\/?$/i.test(new URL(l.href).pathname))
  )?.href ?? null;
}

/** On a homepage: the links worth opening for course pages (teaching, courses, notes). */
export function teachingLinks(page, homeUrl) {
  const home = new URL(homeUrl);
  return page.links
    .filter((l) => {
      try {
        return new URL(l.href).hostname === home.hostname && /\b(teaching|courses?|classes|notes|lectures?)\b/i.test(`${l.text} ${new URL(l.href).pathname.replace(/[_\-/.]/g, ' ')}`);
      } catch {
        return false;
      }
    })
    .map((l) => l.href)
    .filter((h, i, a) => a.indexOf(h) === i && h !== home.href)
    .slice(0, 6);
}
