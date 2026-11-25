// One-off look at the calendar's programs before uwloo builds on them (majors, minors, options, specializations,
// diplomas, certificates, degree and faculty requirements), and its policies and academic regulations (Invalid
// Credential Combinations among them). Reads them raw from Kuali, the same source as the course pages, and writes:
//   data/probe/summary.json                which endpoints answered, counts, sizes, the fields programs have
//   data/probe/{kind}-{catalog}.json.gz    every index entry and every program in full, as Kuali sends them
//   data/probe/samples/*.json              a few programs, pretty-printed, to read on GitHub
// Run by .github/workflows/programs-probe.yml (on push of this file, or by hand). Kuali's robots.txt allows all.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { getJson, pool } from './lib/http.mjs';
import { KUALI_BASE, loadCatalogList } from './lib/kuali.mjs';

const OUT = 'data/probe';
const CONCURRENCY = 8;

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/samples`, { recursive: true });

const { ug, grad } = await loadCatalogList();
const short = (c) => ({ id: c.id, title: c.title, status: c.status, startDate: c.startDate, endDate: c.endDate });
const summary = {
  at: new Date().toISOString(),
  base: KUALI_BASE,
  catalogs: { ug: ug.map(short), grad: grad.map(short) },
  endpoints: {},
  sets: {},
};

async function tryGet(label, url) {
  try {
    const v = await getJson(url, { retries: 2 });
    const first = Array.isArray(v) ? v[0] : v;
    summary.endpoints[label] = {
      url,
      ok: true,
      shape: Array.isArray(v) ? `array of ${v.length}` : typeof v,
      keys: first && typeof first === 'object' ? Object.keys(first) : [],
    };
    return v;
  } catch (err) {
    summary.endpoints[label] = { url, ok: false, error: String(err.status ?? err.message) };
    return null;
  }
}

/** Every key path down to depth 3, with how many items have it: what a program record looks like. */
function fieldCounts(items) {
  const counts = {};
  const walk = (v, path, depth) => {
    if (!v || typeof v !== 'object' || depth > 3) return;
    const keys = Array.isArray(v) ? (v.length ? ['[]'] : []) : Object.keys(v);
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      counts[p] = (counts[p] ?? 0) + 1;
      walk(k === '[]' ? v[0] : v[k], p, depth + 1);
    }
  };
  for (const it of items) walk(it, '', 0);
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * One kind ('programs' or 'specializations') in one catalog: the index, then every entry in full.
 * sampleWords picks a few to pretty-print.
 */
async function readSet(kind, one, cat, { details = true, sampleWords = [] } = {}) {
  const label = `${kind} ${cat.title}`;
  const index = await tryGet(label, `${KUALI_BASE}/${kind}/${cat.id}`);
  if (!Array.isArray(index)) return;
  const full = {};
  let failed = 0;
  if (details) {
    await pool(index, CONCURRENCY, async (e) => {
      if (!e?.pid) return;
      try {
        full[e.pid] = await getJson(`${KUALI_BASE}/${one}/${cat.id}/${e.pid}`, { retries: 3 });
      } catch (err) {
        failed++;
        full[e.pid] = { __error: String(err.status ?? err.message) };
      }
    }, label, 100);
  }
  const body = JSON.stringify({ catalog: short(cat), kind, index, details: full });
  const file = `${kind}-${slug(cat.title)}.json.gz`;
  await writeFile(`${OUT}/${file}`, gzipSync(body, { level: 9 }));
  const records = Object.values(full).filter((d) => !d.__error);
  summary.sets[label] = {
    file,
    entries: index.length,
    read: records.length,
    failed,
    rawBytes: body.length,
    indexFields: fieldCounts(index),
    recordFields: fieldCounts(records),
    // Kinds of program, by whatever field names them.
    byType: Object.fromEntries(
      ['type', 'programType', 'credentialType', 'academicLevel', 'degreeDesignation', 'programLevel'].map((k) => {
        const n = {};
        for (const d of [...index, ...records]) {
          const v = d?.[k];
          const key = v == null ? null : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v);
          if (key) n[key] = (n[key] ?? 0) + 1;
        }
        return [k, n];
      }),
    ),
    titles: index.map((e) => e.title ?? e.name ?? e.code ?? e.pid).slice(0, 2000),
  };
  // A few in full, to read: anything matching the words, then a spread of the rest.
  const picks = new Set();
  for (const w of sampleWords) {
    const hit = index.find((e) => new RegExp(w, 'i').test(`${e.title ?? ''} ${e.code ?? ''}`) && full[e.pid] && !full[e.pid].__error);
    if (hit) picks.add(hit);
  }
  for (let i = 0; picks.size < sampleWords.length + 6 && i < index.length; i += Math.max(1, Math.floor(index.length / 7))) {
    if (full[index[i]?.pid] && !full[index[i].pid].__error) picks.add(index[i]);
  }
  for (const e of picks) await writeFile(`${OUT}/samples/${kind}-${slug(cat.title).slice(0, 12)}-${slug(e.title ?? e.pid)}.json`, JSON.stringify({ indexEntry: e, record: full[e.pid] }, null, 2));
  console.log(`${label}: ${index.length} entries, ${records.length} read, ${failed} failed, ${(body.length / 1e6).toFixed(1)} MB raw`);
}

const curUg = ug.find((c) => c.status === 'current') ?? ug.at(-1);
const curGrad = grad.find((c) => c.status === 'current') ?? grad.at(-1);
const UG_WORDS = [
  'economics.*specialization',
  'specialization.*economics',
  'honours economics',
  'economics minor',
  'computer science',
  'bachelor of mathematics',
  'option',
  'diploma',
  'certificate',
  'joint',
  'co-operative|co-op',
  'faculty of arts|arts.*requirements',
];

if (curUg) {
  await tryGet(`catalog ${curUg.title}`, `${KUALI_BASE}/public/catalogs/${curUg.id}`);
  await readSet('programs', 'program', curUg, { sampleWords: UG_WORDS });
  await readSet('specializations', 'specialization', curUg, { sampleWords: ['economics', 'option'] });
  // Policies and academic regulations. S17gweg46 is "Invalid Credential Combinations" (its calendar page:
  // https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/policy/S17gweg46).
  await readSet('policies', 'policy', curUg, { sampleWords: ['invalid credential', 'credential', 'degree', 'co-operative', 'course load', 'minor', 'transfer'] });
  const icc = await tryGet('policy S17gweg46', `${KUALI_BASE}/policy/${curUg.id}/S17gweg46`);
  if (icc) await writeFile(`${OUT}/samples/policy-invalid-credential-combinations.json`, JSON.stringify(icc, null, 2));
}
// The static archive of older calendars (2021–22 to 2023–24): whether its robots.txt lets uwloo read it later.
try {
  const r = await fetch('https://academic-calendar-archive.uwaterloo.ca/robots.txt', { headers: { 'user-agent': 'uwloo.ca-builder/1.0 (+https://uwloo.ca)' } });
  summary.archiveRobots = { status: r.status, text: (await r.text()).slice(0, 4000) };
} catch (err) {
  summary.archiveRobots = { error: String(err.message) };
}
// Earlier undergraduate years: the index only, to see whether programs keep their ids from year to year.
for (const c of ug.filter((c) => c !== curUg)) await readSet('programs', 'program', c, { details: false });
if (curGrad) await readSet('programs', 'program', curGrad, { sampleWords: ['economics', 'master', 'doctor', 'diploma'] });

await writeFile(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.endpoints, null, 2));
