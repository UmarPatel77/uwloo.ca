// Every term a course ran since Fall 2001, from data/schedules/ (WClasses, see scripts/lib/schedules.mjs):
// a grid of terms on its page, each term that ran clickable for its sections, a "Taught by" line, and the
// one-student sections (individual arrangements) listed with their professor.
//
// A term WClasses has nothing for is unknown, not "didn't run": its scraper skipped failed reads silently.
import { esc } from './requisites.mjs';
import { termName, termShort } from './terms.mjs';

const FIRST = 2001; // WClasses' first year (Fall 2001)
const LAST_TERM = '1265'; // its last (Spring 2026), read before enrolment settled
const SEASONS = [
  ['1', 'Winter'],
  ['5', 'Spring'],
  ['9', 'Fall'],
];

/** "Insley,Margaret Caren" → "Margaret Insley"; anything else as it is. */
export function personName(raw) {
  const s = String(raw ?? '').trim();
  const m = /^([^,]+),\s*(\S+)/.exec(s);
  return m ? `${m[2]} ${m[1].trim()}` : s;
}

/** A section for one student, by arrangement: cap 1. */
const solo = (r) => r[1] === 1;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * One course's saved schedule → {terms: [{term, classes, solo}], ran, taughtBy: [[name, terms]], usual} or
 * null if it has none. Terms that only had one-student sections don't count as "ran".
 */
export function summarize(entry) {
  const terms = Object.entries(entry?.terms ?? {})
    .map(([term, rows]) => ({ term, classes: rows.filter((r) => !solo(r)), solo: rows.filter(solo) }))
    .filter((t) => t.classes.length || t.solo.length)
    .sort((a, b) => Number(a.term) - Number(b.term));
  if (!terms.length) return null;
  const ran = terms.filter((t) => t.classes.length);
  const by = new Map();
  for (const t of ran)
    for (const name of new Set(t.classes.map((r) => personName(r[4])).filter(Boolean))) by.set(name, (by.get(name) ?? 0) + 1);
  const taughtBy = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const seasons = SEASONS.map(([m, name]) => [name, ran.filter((t) => t.term.endsWith(m)).length])
    .filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1]);
  // "always Fall", or how many in each ("8 Fall, 3 Winter"), once there are a few.
  const usual = ran.length < 3 ? '' : seasons.length === 1 ? `always ${seasons[0][0]}` : seasons.map(([n, k]) => `${k} ${n}`).join(', ');
  return { terms, ran, taughtBy, usual };
}

const when = (r) => {
  const m = /^(\d{1,2}:\d\d)-(\d{1,2}:\d\d)\s*(\S*)$/.exec(r[3] ?? '');
  return m ? `${m[3]} ${m[1]}–${m[2]}`.trim() : r[3] || '';
};

function termTable(t) {
  const row = (r, note) =>
    `<tr><th scope="row">${esc(r[0])}</th><td>${r[2] ?? '?'} / ${r[1] ?? '?'}</td><td>${esc(when(r)) || '<span class="t">—</span>'}</td><td>${esc(r[5] ?? '') || '<span class="t">—</span>'}</td><td>${esc(personName(r[4])) || '<span class="t">not listed</span>'}${note ? ` <span class="t">${note}</span>` : ''}</td></tr>`;
  const rows = [...t.classes.map((r) => row(r)), ...t.solo.map((r) => row(r, 'individual arrangement, 1 student'))].join('');
  const late = t.term === LAST_TERM ? '<p class="t">WClasses’ last read, from before enrolment settled: the numbers may not be final.</p>' : '';
  return `<section class="og-term" id="t${t.term}" aria-label="${esc(termName(t.term))}">
  <h3>${esc(termName(t.term))} <a class="t og-x" href="#offer-h" aria-label="Close">×</a></h3>
  <table class="sec"><thead><tr><th scope="col">Section</th><th scope="col">Enrolled / cap</th><th scope="col">When</th><th scope="col">Where</th><th scope="col">Instructor</th></tr></thead><tbody>${rows}</tbody></table>${late}
</section>`;
}

/**
 * "Every term since 2001": the summary, then one row per year (newest first) of Winter, Spring, Fall boxes.
 * A box that ran links to #t1159, whose sections open under its row (CSS :target, no script needed).
 */
export function offeringsSection(code, entry, { current = true, now = new Date() } = {}) {
  const s = summarize(entry);
  if (!s) return '';
  const byTerm = new Map(s.terms.map((t) => [t.term, t]));
  const firstYear = Math.max(FIRST, 2000 + Number(s.terms[0].term.slice(1, 3)));
  const lastYear = current ? Math.max(2026, now.getUTCFullYear()) : 2000 + Number(s.terms.at(-1).term.slice(1, 3));
  const rows = [];
  for (let y = lastYear; y >= firstYear; y--) {
    const yy = String(y % 100).padStart(2, '0');
    const cells = SEASONS.map(([m, season]) => {
      const term = `1${yy}${m}`;
      const t = byTerm.get(term);
      const outside = Number(term) > Number(LAST_TERM) || Number(term) < 1019;
      if (t?.classes.length) {
        const n = t.classes.length;
        return `<a class="og on" href="#t${term}" title="${esc(termName(term))}: ${plural(n, t.classes[0][0].split(' ')[0] === 'LEC' ? 'lecture' : 'section')}">${n}</a>`;
      }
      if (t?.solo.length) return `<a class="og solo" href="#t${term}" title="${esc(termName(term))}: individual arrangement only">1:1</a>`;
      return `<span class="og ${outside ? 'na' : 'none'}" title="${esc(termName(term))}: ${outside ? 'no data' : 'nothing on WClasses'}" aria-label="${esc(season)} ${y}: ${outside ? 'no data' : 'nothing on WClasses'}">·</span>`;
    }).join('');
    const details = SEASONS.map(([m]) => byTerm.get(`1${yy}${m}`))
      .filter(Boolean)
      .map(termTable)
      .join('');
    rows.push(`<div class="og-row"><span class="og-y">${y}</span>${cells}</div>${details}`);
  }
  const span = s.ran.length ? `Ran in ${plural(s.ran.length, 'term')}, ${termName(s.ran[0].term)} to ${termName(s.ran.at(-1).term)}${s.usual ? `: ${s.usual}` : ''}.` : 'No regular sections on WClasses, only individual arrangements.';
  const taught = s.taughtBy.length ? `<p class="og-by">Taught by ${s.taughtBy.slice(0, 8).map(([n, k]) => `${esc(n)} <span class="t">(${k})</span>`).join(' · ')}${s.taughtBy.length > 8 ? ` <span class="t">and ${s.taughtBy.length - 8} more</span>` : ''}</p>` : '';
  const solos = s.terms.filter((t) => t.solo.length);
  const soloLine = solos.length
    ? `<p class="t">Individual arrangements (one student): ${solos
        .map((t) => {
          const who = [...new Set(t.solo.map((r) => personName(r[4])).filter(Boolean))];
          return `<a href="#t${t.term}">${esc(termShort(t.term))}</a>${who.length ? ` with ${esc(who.join(', '))}` : ''}`;
        })
        .join(' · ')}.</p>`
    : '';
  return `<section class="offerings" aria-labelledby="offer-h"><details class="rd-fold" data-fold="offerings" open>
  <summary><h2 id="offer-h">Every term since 2001</h2></summary>
  <p class="og-sum">${esc(span)}</p>
  ${taught}
  ${soloLine}
  <div class="ogrid" role="group" aria-label="Terms ${esc(code)} ran">
    <div class="og-row og-head" aria-hidden="true"><span></span><span>Winter</span><span>Spring</span><span>Fall</span></div>
    ${rows.join('\n    ')}
  </div>
  <p class="t og-src">A number is how many lectures (or seminars or labs) it had; click it for that term’s sections. “·” means WClasses has nothing that term, which isn’t proof it didn’t run. From <a href="https://wclasses.vercel.app/">WClasses</a>’ copy of the Registrar’s Schedule of Classes, Fall 2001 to Spring 2026.</p>
</details></section>`;
}

/** The terms a course has saved sections for (the strip links them to the grid). */
export const termsWithData = (entry) => new Set(Object.entries(entry?.terms ?? {}).filter(([, rows]) => rows.length).map(([t]) => t));

/** The academic year (its Fall's year) a term belongs to: 1159 → 2015, 1161 → 2015. */
export const yearOfTerm = (t) => 2000 + Number(t.slice(1, 3)) - (t.endsWith('9') ? 0 : 1);
