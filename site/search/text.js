// Words for search, the same at build time (scripts/lib/search.mjs) and in the browser (site/search/app.js):
// lowercase, accents off, common words out, each word to its stem (Porter's algorithm), and pairs of
// neighbouring words ("machin learn") as terms of their own.

// Common English words, and words every course description or course chat has.
export const STOP = new Set(
  `a about above after again against all almost along already also although always am among an and another any anyone anything are around as at
  away back be became because become becomes been before being below best better between both but by can cannot could did didn do does doesn
  doing don done down during each either else enough especially etc even ever every eg few first for from further get gets getting go goes going
  gone got had has hasn have haven having he her here hers him his how however i ie if in into is isn it its itself just last least less let
  like likely lot lots made make makes making many may me might more most much must my near need needs neither never new next no nor not now of
  off often on once one only or other others otherwise our out over own per perhaps please quite rather really said same see seem seems several
  shall she should since so some something sometimes still such than that the their them then there these they thing things this those though
  through thus to too toward towards under unless until up upon us use used uses using usually very via was way ways we well were what whatever
  when where whether which while who whom whose why will with within without would yet you your yours yes yeah lol im ive youre thats dont cant
  wont isnt didnt doesnt wasnt arent hes shes theyre whats theres also ok okay pretty probably actually maybe sure anyway honestly basically
  course courses student students topic topics introduction introductory intro include includes including included emphasis overview
  selected various aspect aspects related principle principles basic basics fundamental fundamentals concept concepts issue issues area areas
  prerequisite prerequisites antirequisite antirequisites corequisite corequisites lecture lectures tutorial tutorials lab labs term terms
  offered offering offerings credit credits unit units hour hours week weeks weekly year years level levels part parts section sections note notes
  class classes prof profs professor professors instructor instructors ta tas midterm midterms final finals exam exams assignment assignments
  quiz quizzes grade grades mark marks average averages easy easier hard harder difficult tough bird gpa elective electives semester
  waterloo uw uwaterloo reddit people take took taking taken think know good bad want going thing stuff guy guys anyone someone everyone`.split(/\s+/),
);

const vowel = (w, i) => {
  const c = w[i];
  if ('aeiou'.includes(c)) return true;
  return c === 'y' && i > 0 && !vowel(w, i - 1);
};
/** How many vowel-consonant runs a stem has (Porter's m). */
function measure(w) {
  let n = 0;
  let i = 0;
  while (i < w.length && !vowel(w, i)) i++;
  while (i < w.length) {
    while (i < w.length && vowel(w, i)) i++;
    if (i >= w.length) break;
    while (i < w.length && !vowel(w, i)) i++;
    n++;
  }
  return n;
}
const hasVowel = (w) => [...w].some((_, i) => vowel(w, i));
const doubled = (w) => w.length > 1 && w.at(-1) === w.at(-2) && !vowel(w, w.length - 1);
const cvc = (w) => {
  const n = w.length;
  return n > 2 && !vowel(w, n - 1) && vowel(w, n - 2) && !vowel(w, n - 3) && !'wxy'.includes(w[n - 1]);
};
const STEP2 = [['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'], ['bli', 'ble'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'], ['logi', 'log']];
const STEP3 = [['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', '']];
const STEP4 = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'];
const memo = new Map();

/** Porter's stemmer: "networks" → "network", "learning" → "learn", "probability" → "probabl". */
export function stem(word) {
  if (word.length <= 2 || /\d/.test(word)) return word;
  const hit = memo.get(word);
  if (hit) return hit;
  let w = word;
  if (w.endsWith('sses') || w.endsWith('ies')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  let again = false;
  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else if (w.endsWith('ed') && hasVowel(w.slice(0, -2))) {
    w = w.slice(0, -2);
    again = true;
  } else if (w.endsWith('ing') && hasVowel(w.slice(0, -3))) {
    w = w.slice(0, -3);
    again = true;
  }
  if (again) {
    if (w.endsWith('at') || w.endsWith('bl') || w.endsWith('iz')) w += 'e';
    else if (doubled(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1);
    else if (measure(w) === 1 && cvc(w)) w += 'e';
  }
  if (w.endsWith('y') && hasVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;
  for (const [suf, to] of STEP2)
    if (w.endsWith(suf)) {
      if (measure(w.slice(0, -suf.length)) > 0) w = w.slice(0, -suf.length) + to;
      break;
    }
  for (const [suf, to] of STEP3)
    if (w.endsWith(suf)) {
      if (measure(w.slice(0, -suf.length)) > 0) w = w.slice(0, -suf.length) + to;
      break;
    }
  for (const suf of STEP4)
    if (w.endsWith(suf)) {
      const s = w.slice(0, -suf.length);
      if (measure(s) > 1 && (suf !== 'ion' || /[st]$/.test(s))) w = s;
      break;
    }
  if (w.endsWith('e')) {
    const s = w.slice(0, -1);
    const m = measure(s);
    if (m > 1 || (m === 1 && !cvc(s))) w = s;
  }
  if (w.endsWith('ll') && measure(w) > 1) w = w.slice(0, -1);
  if (memo.size < 200000) memo.set(word, w);
  return w;
}

/** Plain lowercase text, accents off, a few names that punctuation would break kept whole (C++, C#, .NET). */
export const fold = (text) =>
  String(text ?? '')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bc\+\+/g, ' cplusplus ')
    .replace(/\bc#/g, ' csharp ')
    .replace(/\bf#/g, ' fsharp ')
    .replace(/\.net\b/g, ' dotnet ');

/** A word worth indexing: two letters or more, not a number, not a course code ("cs135"). */
const keep = (w) => w.length > 1 && !/^\d+$/.test(w) && !/^[a-z]{2,8}\d{3}[a-z]?$/.test(w) && !STOP.has(w);

/**
 * Text → terms, in order: each word's stem, and each pair of neighbouring words in the same phrase
 * ("red-black trees" → red, black, tree, "red black", "black tree"). With surfaces: [{t, s}] where s is
 * the words as written, for showing a term.
 */
export function terms(text, { pairs = true, surfaces = false } = {}) {
  const out = [];
  for (const phrase of fold(text).split(/[.,;:!?()[\]{}"“”\n\r\t|/]+/)) {
    let prev = null;
    for (const raw of phrase.split(/[^a-z0-9]+/)) {
      if (!keep(raw)) {
        prev = null;
        continue;
      }
      const t = stem(raw);
      out.push(surfaces ? { t, s: raw } : t);
      if (pairs && prev) out.push(surfaces ? { t: `${prev.t} ${t}`, s: `${prev.s} ${raw}` } : `${prev.t} ${t}`);
      prev = { t, s: raw };
    }
  }
  return out;
}

/** Which of 128 files a term's postings are in. */
export function shardOf(term) {
  let h = 2166136261;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 128;
}
