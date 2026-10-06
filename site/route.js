// Resolves any uwloo.ca path that isn't a real file. Runs in 404.html; also unit-tested in Node.
//
//   /CS135, /cs-135, /cs/135          → /cs135/
//   /cs                               → /{current year}/cs/
//   /2627/cs   (Kuali years)          → /2627/cs/
//   /2627/cs135, /2627/cs/135         → /2627/cs/#CS135
//   /2223/cs   (2324 and earlier)     → ucalendar.uwaterloo.ca/2223/COURSE/course-CS.html
//   /2223/cs135                       → …/course-CS.html#CS135
//   /1269/cs135, /1269/cs/135         → acal.fast.uwaterloo.ca/course/1269/CS/135

const UCAL = 'https://ucalendar.uwaterloo.ca';
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
const isSubject = (s) => /^[a-z]{2,8}$/.test(s);

function yearTarget(y, meta, subject, number) {
  const S = subject?.toUpperCase();
  const code = S && number ? `${S}${number.toUpperCase()}` : null;
  if (meta.years.includes(y.code)) {
    if (!S) return { type: 'redirect', to: `/${y.code}/` };
    return { type: 'redirect', to: `/${y.code}/${S.toLowerCase()}/${code ? `#${code}` : ''}` };
  }
  if (y.start >= 1957 && y.start <= 2023) {
    if (!S) return { type: 'redirect', to: `${UCAL}/${y.code}/` };
    return { type: 'redirect', to: `${UCAL}/${y.code}/COURSE/course-${S}.html${code ? `#${code}` : ''}` };
  }
  const why = y.start < 1957 ? 'Waterloo’s first calendar is 1957–58.' : `The ${y.start}–${String((y.start + 1) % 100).padStart(2, '0')} calendar isn’t published yet.`;
  return { type: 'notfound', message: why };
}

/** meta: { years: ['2425','2526','2627'], current: '2627', subjects: ['cs', 'math', …] } */
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

  if (isTerm(a)) {
    const parts = splitCode(segs.length === 2 ? b : `${b}${c ?? ''}`);
    if (parts && segs.length <= 3) return { type: 'redirect', to: `${ACAL}/${a}/${parts.subject}/${parts.number}` };
  }

  if (segs.length === 2) {
    const code = normalizeCode(`${a}${b}`);
    if (code) return done({ type: 'redirect', to: `/${code}/` });
  }

  return { type: 'notfound', query: segs.join(' ') };
}
