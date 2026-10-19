// Resolves any uwloo.ca path that isn't a real file. Runs in 404.html; also unit-tested in Node.
//
//   /CS135, /cs-135, /cs/135          → /cs135/
//   /cs                               → /{current year}/cs/
//   /2627/cs   (Kuali years)          → /2627/cs/
//   /2627/cs135, /2627/cs/135         → /2627/cs/#CS135
//   /2223/cs   (9596 to 2324)         → ucalendar.uwaterloo.ca/2223/COURSE/course-CS.html
//   /2223/cs135                       → …/course-CS.html#CS135
//   /8889/cs   (6364 to 9495)         → /8889/cs/, the OCR text of the scanned calendar, when that year has it;
//   /8889/cs134                         else ucalendar.uwaterloo.ca/6394/1988-89.pdf at the CS (or CS 134) page
//   /1249, /1249/cs   (grad terms)    → /1249/cs/  Graduate Calendar for that term (Spring 2024 on)
//   /1249/math631, /1249/math/631     → /1249/math631/  MATH 631 as the Fall 2024 Graduate Calendar lists it
//   …and when uwloo has no such page  → acal.fast.uwaterloo.ca/course/1249/MATH/631
//   /1109/co   (older grad terms)     → /1109/co/  the Fall 2010 Graduate Calendar (Fall 2006 to Winter 2024)
//   /1109/co602, /1109/co/602         → /1109/co/#CO602
//   /1179      (not on uwloo)         → that term in Waterloo's calendar archive
//   A few codes are both a term and a year: 1011 (Winter 2001 or 2010–11), 1415 (Spring 2041 or 2014–15)
//   and 1819 (Fall 2081 or 2018–19). No Graduate Calendar uwloo has is one of those terms, so years win.
//   /CS341/1249-Notes                 → /cs341/1249-notes/  a course resource (notes, slides, a past exam…)
//   /CS341/1249-Notes/3               → /cs341/1249-notes/3/  one PDF of a set (chapter 3, lecture 3…)

const UCAL = 'https://ucalendar.uwaterloo.ca';
const PDF_ARCHIVE = 'http://www.ucalendar.uwaterloo.ca/6394';
const FIRST_ONLINE = 1963; // 1963–64, the oldest calendar UW has online
const FIRST_HTML = 1995; // 1995–96; 1963–64 to 1994–95 are scanned PDFs

/** 1988 → http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf */
export const pdfUrl = (start) => `${PDF_ARCHIVE}/${start}-${String((start + 1) % 100).padStart(2, '0')}.pdf`;
const ACAL = 'https://acal.fast.uwaterloo.ca/course';

export function splitCode(s) {
  // Three-digit numbers, or one or two after a subject that uses them (PD 1, PD 11): same rule as
  // SHORT_SUBJECTS in scripts/lib/requisites.mjs.
  const m = /^([a-z]{2,8})[\s\-_.]*(\d{3}[a-z]{0,2})$/i.exec(String(s).trim()) ?? /^(pd)[\s\-_.]*(\d{1,2})$/i.exec(String(s).trim());
  return m ? { subject: m[1].toUpperCase(), number: m[2].toUpperCase() } : null;
}

export function normalizeCode(s) {
  const c = splitCode(s);
  return c ? (c.subject + c.number).toLowerCase() : null;
}

export function yearInfo(s) {
  const m = /^(\d\d)(\d\d)$/.exec(s);
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) return null;
  const a = Number(m[1]);
  return { code: s, start: a >= 57 ? 1900 + a : 2000 + a };
}

const isTerm = (s) => /^\d\d\d[159]$/.test(s);
const SEASONS = { 1: 'Winter', 5: 'Spring', 9: 'Fall' };
const termName = (t) => `${SEASONS[t[3]]} ${(Number(t[0]) + 19) * 100 + Number(t.slice(1, 3))}`;

const OLD_FIRST = 1069; // Fall 2006, the oldest Graduate Calendar online
const OLD_LAST = 1241; // Winter 2024, the last before Kuali

/** Where Waterloo keeps a pre-Kuali Graduate Calendar (Fall 2006 to Winter 2024), as linked from its archives page. */
export function gradArchiveUrl(term) {
  const year = (Number(term[0]) + 19) * 100 + Number(term.slice(1, 3));
  const season = SEASONS[term[3]].toLowerCase();
  const base = 'http://academic-calendar-archive.uwaterloo.ca/graduate-studies';
  return Number(term) <= 1161
    ? `${base}/${year}/${season}/gradcalendar.uwaterloo.ca/group/Gen-Info-Regs.html`
    : `${base}/archive-${season}-${year}/index.html`;
}

/** /1249 or /1249/cs: a Graduate Calendar term page, or why there isn't one. */
function gradTerm(term, meta, subject) {
  const terms = meta.gradTerms ?? [];
  if (terms.includes(term) || (meta.gradOld ?? []).includes(term)) return { type: 'redirect', to: `/${term}/${subject ? `${subject}/` : ''}` };
  const n = Number(term);
  if (n >= OLD_FIRST && n <= OLD_LAST) return { type: 'redirect', to: gradArchiveUrl(term) };
  if (n < OLD_FIRST) {
    return { type: 'notfound', message: `Waterloo’s Graduate Calendars online start at Fall 2006. Older ones are available on request from Graduate Studies.` };
  }
  return { type: 'notfound', message: `There’s no ${termName(term)} Graduate Calendar yet.` };
}
const isSubject = (s) => /^[a-z]{2,8}$/.test(s);
// Resource page names: 1249-notes, 1249-final-2, cheatsheet (same rule as SLUG_RE in scripts/lib/resources.mjs)
const isResource = (s) => /^(\d{3}[159]-)?[a-z]+(-\d+)?$/.test(s);

function yearTarget(y, meta, subject, number) {
  const S = subject?.toUpperCase();
  const code = S && number ? `${S}${number.toUpperCase()}` : null;
  if (meta.years.includes(y.code)) {
    if (!S) return { type: 'redirect', to: `/${y.code}/` };
    return { type: 'redirect', to: `/${y.code}/${S.toLowerCase()}/${code ? `#${code}` : ''}` };
  }
  if (y.start >= FIRST_HTML && y.start <= 2023) {
    if (!S) return { type: 'redirect', to: `${UCAL}/${y.code}/` };
    return { type: 'redirect', to: `${UCAL}/${y.code}/COURSE/course-${S}.html${code ? `#${code}` : ''}` };
  }
  if (y.start >= FIRST_ONLINE && y.start < FIRST_HTML) {
    // Page numbers come from data/archive/{year}.json when that year has been indexed:
    // the course's page, else its subject's, else the start of the course descriptions.
    const pages = meta.pdfPages?.[y.code] ?? {};
    // Years with OCR text have real subject pages: /9495/cs241 → /9495/cs/#CS241 (aliases: amath → am).
    const lead = S && pages._text?.[S.toLowerCase()];
    if (lead) return { type: 'redirect', to: `/${y.code}/${lead}/${code ? `#${lead.toUpperCase()}${number.toUpperCase()}` : ''}` };
    const page = (code && pages[code]) || (S && pages[S]) || pages._courses;
    return { type: 'redirect', to: `${pdfUrl(y.start)}${page ? `#page=${page}` : ''}` };
  }
  const why =
    y.start < FIRST_ONLINE
      ? 'Waterloo’s online calendar archive starts at 1963–64.'
      : `The ${y.start}–${String((y.start + 1) % 100).padStart(2, '0')} calendar isn’t published yet.`;
  return { type: 'notfound', message: why };
}

/** meta: { years: ['2425','2526','2627'], current: '2627', gradTerms: ['1245', …], gradOld: ['1069', …], subjects: ['cs', 'math', …], pdfPages?: { '8889': { CS: 412 } } } */
export function resolve(pathname, meta) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    path = pathname;
  }
  const original = path;
  const segs = path.toLowerCase().split('/').filter(Boolean);
  const bare = (u) => u.replace(/\/+$/, '');
  // A redirect back to where we already are means the page doesn't exist.
  const done = (r) => (r.type === 'redirect' && bare(r.to) === bare(original) ? { type: 'notfound', query: segs.join(' ') } : r);

  if (segs.length === 0) return { type: 'redirect', to: '/' };

  const [a, b, c] = segs;
  const year = yearInfo(a);

  if (segs.length === 1) {
    if (year) return done(yearTarget(year, meta));
    if (isTerm(a)) return done(gradTerm(a, meta));
    const code = normalizeCode(a);
    if (code) return done({ type: 'redirect', to: `/${code}/` });
    if (isSubject(a) && (!meta.subjects || meta.subjects.includes(a))) return done({ type: 'redirect', to: `/${meta.current}/${a}/` });
    return { type: 'notfound', query: a };
  }

  if (year) {
    if (segs.length === 2 && isSubject(b)) return done(yearTarget(year, meta, b));
    const parts = splitCode(segs.length === 2 ? b : `${b}${c}`);
    if (parts && segs.length <= 3) return done(yearTarget(year, meta, parts.subject, parts.number));
  }

  if (isTerm(a) && segs.length === 2 && isSubject(b)) {
    const r = gradTerm(a, meta, b);
    // Already at /1109/xyz/ and it isn't a page: that term has no such subject.
    if (r.type === 'redirect' && bare(r.to) === bare(original)) {
      return { type: 'notfound', query: b, message: `The ${termName(a)} Graduate Calendar has no ${b.toUpperCase()} courses.` };
    }
    return r;
  }

  if (isTerm(a)) {
    const parts = splitCode(segs.length === 2 ? b : `${b}${c ?? ''}`);
    if (parts && segs.length <= 3) {
      // uwloo has a page for grad courses in its grad terms; send any other spelling there first.
      // Reaching the router at that exact address means no such page, so acal takes it.
      const page = `/${a}/${(parts.subject + parts.number).toLowerCase()}/`;
      if ((meta.gradTerms ?? []).includes(a) && bare(page) !== bare(original)) return { type: 'redirect', to: page };
      // Older terms have subject pages only: /1109/co602 → /1109/co/#CO602
      if ((meta.gradOld ?? []).includes(a)) return { type: 'redirect', to: `/${a}/${parts.subject.toLowerCase()}/#${parts.subject}${parts.number}` };
      return { type: 'redirect', to: `${ACAL}/${a}/${parts.subject}/${parts.number}` };
    }
  }

  if (segs.length === 2 && normalizeCode(a) && isResource(b)) return done({ type: 'redirect', to: `/${normalizeCode(a)}/${b}/` });
  if (segs.length === 3 && normalizeCode(a) && isResource(b) && /^[1-9]\d*$/.test(c)) return done({ type: 'redirect', to: `/${normalizeCode(a)}/${b}/${c}/` });

  if (segs.length === 2) {
    const code = normalizeCode(`${a}${b}`);
    if (code) return done({ type: 'redirect', to: `/${code}/` });
  }

  return { type: 'notfound', query: segs.join(' ') };
}
