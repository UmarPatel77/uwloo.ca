// Every course Waterloo's course catalog has listed, as far back as UW Open Data's records go, and the terms
// each one actually ran. Courses that are in no calendar uwloo has (2024–25 on) get a "no longer offered"
// page from this: uwloo.ca/msci452.
//
//   Courses/{term}         the catalog that term: title, description, requirements text
//   ClassSchedules/{term}  the courses with classes that term
//
// Past terms never change, so each is fetched once and folded into .cache/opendata/history.json, newest
// first, a few terms per build. Going back, a run of empty terms means Open Data's records have ended:
// that's the floor, and nothing older is asked for again.
import { readCache, writeCache } from './http.mjs';
import { isCode } from './requisites.mjs';
import { CACHE, od } from './opendata.mjs';
import { shiftTerm, termRange } from './terms.mjs';

export const HISTORY_FLOOR = '0951'; // Winter 1995: no point asking for anything older
const PATH = `${CACHE}/history-2.json`; // -2: refolds every term so PD 1 to PD 99 are in it
const EMPTY_RUN = 4; // this many empty terms in a row, going back, and the records have ended
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || null;
};

/** Folds one term of Open Data into `h` (pure, unit-tested). */
export function addTerm(h, term, rows, scheduledIds) {
  const ran = new Set((scheduledIds ?? []).map(String));
  const t = Number(term);
  for (const r of rows ?? []) {
    const code = `${String(r.subjectCode ?? '').trim()}${String(r.catalogNumber ?? '').trim()}`.toUpperCase();
    if (!isCode(code)) continue; // CS135, and PD 1 to PD 99
    const e = (h.codes[code] ??= { first: term, last: term, ran: [] });
    if (t < Number(e.first)) e.first = term;
    // The newest catalog entry is the one shown: its title, description and requirements.
    if (t >= Number(e.last) || !e.title) {
      if (t >= Number(e.last)) e.last = term;
      if (t >= Number(e.detail ?? 0)) {
        e.detail = term;
        e.title = clip(r.title, 200);
        e.description = clip(r.description, 2500);
        e.requirements = clip(r.requirementsDescription, 800);
        e.career = r.associatedAcademicCareer ?? null;
        e.group = r.associatedAcademicGroupCode ?? null;
      }
    }
    if (ran.has(String(r.courseId)) && !e.ran.includes(term)) {
      e.ran.push(term);
      e.ran.sort((a, b) => Number(a) - Number(b));
    }
  }
  return h;
}

async function fetchTerm(term) {
  try {
    return { rows: (await od(`Courses/${term}`)) ?? [], scheduled: (await od(`ClassSchedules/${term}`)) ?? [] };
  } catch (err) {
    console.warn(`! Open Data history ${term}: ${err.message}`);
    return null;
  }
}

/**
 * The history so far, after adding up to `maxNew` more past terms. `{done: {term: rows}, codes: {code:
 * {first, last, ran, title, description, requirements, career, group}}, floor}`.
 */
export async function loadHistory(curTerm, { maxNew = Number(process.env.HISTORY_TERMS_PER_BUILD ?? 24), fetch = fetchTerm, path = PATH, log = console } = {}) {
  const h = (await readCache(path)) ?? { version: 1, done: {}, codes: {}, floor: null };
  const newest = shiftTerm(curTerm, -1);
  const terms = termRange(h.floor ?? HISTORY_FLOOR, newest).reverse();
  let added = 0;
  let empty = 0;
  let oldestWithData = null;
  for (const t of terms) {
    if (h.done[t] === undefined) {
      if (added >= maxNew) break;
      const got = await fetch(t);
      if (!got) break; // Open Data trouble: try again next build
      h.done[t] = got.rows.length;
      addTerm(h, t, got.rows, got.scheduled);
      added++;
    }
    if (h.done[t] > 0) {
      empty = 0;
      oldestWithData = t;
    } else if (++empty >= EMPTY_RUN && oldestWithData) {
      h.floor = oldestWithData;
      break;
    }
  }
  if (added) await writeCache(path, h);
  const have = Object.entries(h.done).filter(([, n]) => n > 0).map(([t]) => t).sort();
  log.log(`Course history: ${Object.keys(h.codes).length} courses, ${have.length} terms (${have[0] ?? '–'} to ${have.at(-1) ?? '–'})${h.floor ? `; Open Data starts at ${h.floor}` : ''}${added ? `; ${added} new this build` : ''}`);
  return h;
}
