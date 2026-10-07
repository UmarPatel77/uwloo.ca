// Resolves any uwloo.ca path that isn't a real file. Runs in 404.html; also unit-tested in Node.
//
//   /CS135, /cs-135, /cs/135          → /cs135/
//   /cs                               → /{current year}/cs/
//   /2627/cs   (Kuali years)          → /2627/cs/
//   /2627/cs135, /2627/cs/135         → /2627/cs/#CS135
//   /2223/cs   (9596 to 2324)         → ucalendar.uwaterloo.ca/2223/COURSE/course-CS.html
//   /2223/cs135                       → …/course-CS.html#CS135
//   /8889/cs   (6364 to 9495)         → ucalendar.uwaterloo.ca/6394/1988-89.pdf, at the CS page if indexed
//   /8889/cs134                       → same PDF, at CS 134's page if indexed
//   /1249, /1249/cs   (grad terms)    → /1249/cs/  Graduate Calendar for that term (Spring 2024 on)
//   /1249/math631, /1249/math/631     → /1249/math631/  MATH 631 as the Fall 2024 Graduate Calendar lists it
//   …and when uwloo has no such page  → acal.fast.uwaterloo.ca/course/1249/MATH/631

const UCAL = 'https://ucalendar.uwaterloo.ca';
const PDF_ARCHIVE = 'http://www.ucalendar.uwaterloo.ca/6394';
const FIRST_ONLINE = 1963; // 1963–64, the oldest calendar UW has online
const FIRST_HTML = 1995; // 1995–96; 1963–64 to 1994–95 are scanned PDFs

/** 1988 → http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf */
export const pdfUrl = (start) => `${PDF_ARCHIVE}/${start}-${String((start + 1) % 100).padStart(2, '0')}.pdf`;
const ACAL = 'https://acal.fast.uwaterloo.ca/course';

export function splitCode(s) {
  const m = /^([a-z]{2,8})[\s\-_.]*(\d{3}[a-z]{0,2})$/i.exec(String(s).trim());
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

/** /1249 or /1249/cs: a Graduate Calendar term page, or why there isn't one. */
function gradTerm(term, meta, subject) {
  const terms = meta.gradTerms ?? [];
  if (terms.includes(term)) return { type: 'redirect', to: `/${term}/${subject ? `${subject}/` : ''}` };
  if (terms.length && Number(term) < Number(terms[0])) {
    return { type: 'notfound', message: `Graduate Calendars before ${termName(terms[0])} aren’t on uwloo yet.` };
  }
  return { type: 'notfound', message: `There’s no ${termName(term)} Graduate Calendar yet.` };
}
const isSubject = (s) => /^[a-z]{2,8}$/.test(s);

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
    const page = (code && pages[code]) || (S && pages[S]) || pages._courses;
    return { type: 'redirect', to: `${pdfUrl(y.start)}${page ? `#page=${page}` : ''}` };
  }
  const why =
    y.start < FIRST_ONLINE
      ? 'Waterloo’s online calendar archive starts at 1963–64.'
      : `The ${y.start}–${String((y.start + 1) % 100).padStart(2, '0')} calendar isn’t published yet.`;
  return { type: 'notfound', message: why };
}

/** meta: { years: ['2425','2526','2627'], current: '2627', gradTerms: ['1245', …], subjects: ['cs', 'math', …], pdfPages?: { '8889': { CS: 412 } } } */
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

  if (isTerm(a) && segs.length === 2 && isSubject(b)) return done(gradTerm(a, meta, b));

  if (isTerm(a)) {
    const parts = splitCode(segs.length === 2 ? b : `${b}${c ?? ''}`);
    if (parts && segs.length <= 3) {
      // uwloo has a page for grad courses in its grad terms; send any other spelling there first.
      // Reaching the router at that exact address means no such page, so acal takes it.
      const page = `/${a}/${(parts.subject + parts.number).toLowerCase()}/`;
      if ((meta.gradTerms ?? []).includes(a) && bare(page) !== bare(original)) return { type: 'redirect', to: page };
      return { type: 'redirect', to: `${ACAL}/${a}/${parts.subject}/${parts.number}` };
    }
  }

  if (segs.length === 2) {
    const code = normalizeCode(`${a}${b}`);
    if (code) return done({ type: 'redirect', to: `/${code}/` });
  }

  return { type: 'notfound', query: segs.join(' ') };
}
