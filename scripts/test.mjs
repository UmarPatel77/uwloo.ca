import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { toSection } from './lib/opendata.mjs';
import { desiredRecords, planPages, planRecord } from './setup.mjs';
import { classifyCatalogs } from './lib/kuali.mjs';
import { kualiToTree, norm, renderTree, sanitize, treeCodes } from './lib/requisites.mjs';
import { parseYearCode, shiftTerm, termCode, termName, termRange } from './lib/terms.mjs';
import { resolve } from '../site/route.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/kuali-requisites.json', import.meta.url), 'utf8'));

test('term codes: century − 20, YY, first month of term', () => {
  assert.equal(termCode(new Date('2026-10-05T12:00:00Z')), '1269');
  assert.equal(termCode(new Date('2027-01-15T12:00:00Z')), '1271');
  assert.equal(termCode(new Date('2026-06-01T12:00:00Z')), '1265');
  assert.equal(termCode(new Date('1999-09-10T12:00:00Z')), '0999');
  assert.equal(shiftTerm('1269', 1), '1271');
  assert.equal(shiftTerm('1271', -1), '1269');
  assert.equal(shiftTerm('1269', -6), '1249');
  assert.deepEqual(termRange('1265', '1271'), ['1265', '1269', '1271']);
  assert.equal(termName('1271'), 'Winter 2027');
});

test('academic year codes', () => {
  assert.equal(parseYearCode('2627').start, 2026);
  assert.equal(parseYearCode('5758').start, 1957);
  assert.equal(parseYearCode('9900').start, 1999);
  assert.equal(parseYearCode('2628'), null);
});

const meta = { years: ['2425', '2526', '2627'], current: '2627', subjects: ['cs', 'math'], gradTerms: ['1245', '1249', '1251', '1255', '1259', '1261', '1265', '1269'] };
const to = (p) => resolve(p, meta).to;

test('router: course codes in any form', () => {
  assert.equal(to('/CS135'), '/cs135/');
  assert.equal(to('/cs-135'), '/cs135/');
  assert.equal(to('/cs/135'), '/cs135/');
  assert.equal(to('/CS%20136L/'), '/cs136l/');
  assert.equal(resolve('/cs999/', meta).type, 'notfound');
});

test('router: subjects and Kuali years', () => {
  assert.equal(to('/cs'), '/2627/cs/');
  assert.equal(to('/2526/CS'), '/2526/cs/');
  assert.equal(to('/2526/cs135'), '/2526/cs/#CS135');
  assert.equal(to('/2627/cs/135'), '/2627/cs/#CS135');
  assert.equal(resolve('/zzz', meta).type, 'notfound');
});

test('router: 9596 to 2324 go to ucalendar pages', () => {
  assert.equal(to('/2324/cs'), 'https://ucalendar.uwaterloo.ca/2324/COURSE/course-CS.html');
  assert.equal(to('/0910/math135'), 'https://ucalendar.uwaterloo.ca/0910/COURSE/course-MATH.html#MATH135');
  assert.equal(to('/9596/math'), 'https://ucalendar.uwaterloo.ca/9596/COURSE/course-MATH.html');
  assert.match(resolve('/2829/cs', meta).message, /isn’t published yet/);
});

test('router: 6364 to 9495 go to that year’s PDF', () => {
  assert.equal(to('/9495/math'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf');
  assert.equal(to('/8889/cs'), 'http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf');
  assert.equal(to('/6364'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf');
  assert.equal(to('/9900/cs'), 'https://ucalendar.uwaterloo.ca/9900/COURSE/course-CS.html');
  assert.match(resolve('/6263/math', meta).message, /starts at 1963–64/);
  assert.match(resolve('/5758', meta).message, /starts at 1963–64/);
});

test('router: indexed PDF pages', () => {
  const m = { ...meta, pdfPages: { 8889: { _courses: 300, CS: 412, CS134: 415 } } };
  assert.equal(resolve('/8889/cs', m).to, 'http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf#page=412');
  assert.equal(resolve('/8889/cs134', m).to, 'http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf#page=415');
  assert.equal(resolve('/8889/cs/999', m).to, 'http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf#page=412');
  assert.equal(resolve('/8889/math', m).to, 'http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf#page=300');
  assert.equal(resolve('/8889', m).to, 'http://www.ucalendar.uwaterloo.ca/6394/1988-89.pdf#page=300');
});

test('archive indexes: 1963-64 and 1994-95', async () => {
  const { readFile } = await import('node:fs/promises');
  const load = async (y) => JSON.parse(await readFile(new URL(`../data/archive/${y}.json`, import.meta.url), 'utf8'));
  const [a, b] = [await load('6364'), await load('9495')];
  const go = (y, idx, p) => resolve(p, { ...meta, pdfPages: { [y]: idx } }).to;
  assert.equal(go('6364', a, '/6364/math'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf#page=143');
  assert.equal(go('6364', a, '/6364/math330'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf#page=147');
  assert.equal(go('6364', a, '/6364/cs'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf#page=100');
  assert.equal(go('9495', b, '/9495/cs'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=354');
  assert.equal(go('9495', b, '/9495/co350'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=351');
  assert.equal(go('9495', b, '/9495/amath'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=327');
  for (const idx of [a, b]) for (const [k, v] of Object.entries(idx)) assert.ok(/^(_courses|[A-Z]{2,8}(\d{3}[A-Z]{0,2})?)$/.test(k) && Number.isInteger(v), k);
});

test('router: term codes go to acal when uwloo has no page', () => {
  assert.equal(to('/1269/cs135/'), 'https://acal.fast.uwaterloo.ca/course/1269/CS/135');
  assert.equal(to('/1071/cs135'), 'https://acal.fast.uwaterloo.ca/course/1071/CS/135');
  assert.equal(to('/1271/math/239'), 'https://acal.fast.uwaterloo.ca/course/1271/MATH/239');
});

test('Kuali: CS 136 keeps the calendar\'s exact wording', () => {
  const tree = kualiToTree(fx['CS136.prerequisites']);
  assert.equal(tree.length, 1);
  assert.equal(norm(tree[0].lead), 'Complete 1 of the following');
  assert.equal(tree[0].items.length, 4);
  assert.deepEqual(tree[0].items.map((r) => norm(r.lead)), [
    'Must have completed the following:',
    'Earned a minimum grade of 90% in each of the following:',
    'Earned a minimum grade of 70% in each of the following:',
    'Earned a minimum grade of 60% in each of the following:',
  ]);
  assert.deepEqual(tree[0].items[3].courses[0], { code: 'CS135', title: 'Designing Functional Programs', units: '0.50' });
});

test('Kuali: inactive course listed as plain text', () => {
  const tree = kualiToTree(fx['BUS247W.prerequisites']);
  assert.deepEqual([...treeCodes(tree)], ['AFM101', 'BUS127W']);
});

test('Kuali: antirequisites and rendering', () => {
  const tree = kualiToTree(fx['CS341.antirequisites']);
  assert.equal(norm(tree[0].lead), 'Not completed nor concurrently enrolled in any of the following:');
  const html = renderTree(tree, new Set(['CS231']));
  assert.match(html, /Not completed nor concurrently enrolled in any of the following:/);
  assert.match(html, /<a class="cc" href="\/cs231\/">CS231<\/a><span class="t"> - Algorithmic Problem Solving \(0\.50\)<\/span>/);
  assert.match(html, /class="cc gone"[^>]*>ECE406</);
});

test('Kuali: CS 341 groups, programs stay as text', () => {
  const tree = kualiToTree(fx['CS341.prerequisites']);
  assert.equal(norm(tree[0].lead), 'Complete all of the following');
  assert.ok(treeCodes(tree).has('MATH239'));
  assert.equal(tree[0].items.at(-1).type, 'text');
});

test('Kuali: level and program rules keep their wording and program links', () => {
  const amath = kualiToTree(fx['AMATH382.prerequisites']);
  const html = renderTree(amath, new Set(), 'https://cal');
  assert.match(html, /<li class="x">Students must be in level 3A or higher<\/li>/);
  assert.match(html, /<li class="x">Enrolled in an Honours program<\/li>/);

  const cs341 = renderTree(kualiToTree(fx['CS341.prerequisites']), new Set(), 'https://cal');
  assert.match(cs341, /<li class="x">Enrolled in <a href="https:\/\/cal#\/programs\/view\/[0-9a-f]+">H-BBA &amp; BCS Double Degree<\/a>, <a [^>]+>H-Computer Science \(BCS\)<\/a>/);
  assert.match(cs341, />H-Software Engineering<\/a><\/li>/);
});

test('Kuali: nothing is dropped (second list, text outside lists)', () => {
  const html =
    '<div><ul><li data-test="ruleView-A"><div data-test="ruleView-A-result">Students must be in level <span>2A</span> or higher</div></li></ul></div>' +
    '<div><ul><li data-test="ruleView-B"><div data-test="ruleView-B-result">Must have completed the following: <div><ul><li><span><a href="#/courses/view/1">MATH135</a> - Algebra <span>(0.50)</span></span></li></ul></div></div></li></ul></div>' +
    '<p>Not open to students in Software Engineering.</p>';
  const tree = kualiToTree(html);
  assert.deepEqual(tree.map((n) => n.type), ['text', 'rule', 'text']);
  assert.equal(tree[0].text, 'Students must be in level 2A or higher');
  assert.equal(tree[1].courses[0].code, 'MATH135');
  assert.equal(tree[2].text, 'Not open to students in Software Engineering.');
});

test('sanitize strips markup and links codes', () => {
  const out = sanitize('<p style="x">See <b>CS 135</b><script>alert(1)</script><img src=x onerror=y></p>', new Set(['CS135']));
  assert.equal(out, '<p>See <b><a class="cc" href="/cs135/">CS 135</a></b></p>');
});

test('Open Data class → section', () => {
  const s = toSection({
    classNumber: 4321,
    courseComponent: 'LEC',
    classSection: 1,
    maxEnrollmentCapacity: 90,
    enrolledStudents: 88,
    scheduleData: [
      { scheduleStartDate: '2026-09-08T00:00:00', scheduleEndDate: '2026-12-08T00:00:00', classMeetingStartTime: '2026-09-08T10:30:00', classMeetingEndTime: '2026-09-08T11:20:00', classMeetingWeekPatternCode: 'YNYNYNN' },
      { scheduleStartDate: '2026-10-14T00:00:00', scheduleEndDate: '2026-10-14T00:00:00', classMeetingStartTime: '19:00:00', classMeetingEndTime: '20:50:00', classMeetingDayPatternCode: 'W' },
    ],
  });
  assert.equal(s.sec, '001');
  assert.deepEqual(s.meets[0], { days: 'MWF', start: '10:30', end: '11:20', date: null });
  assert.equal(s.meets[1].date, '2026-10-14');
});

test('setup: DNS records for a GitHub Pages apex domain', () => {
  const want = desiredRecords({ domain: 'uwloo.ca', owner: 'UmarPatel77', code: 'abc123' });
  assert.deepEqual(want.map((r) => [r.type, r.name, r.content]), [
    ['CNAME', 'uwloo.ca', 'umarpatel77.github.io'],
    ['CNAME', 'www.uwloo.ca', 'umarpatel77.github.io'],
    ['TXT', '_github-pages-challenge-umarpatel77.uwloo.ca', '"abc123"'],
  ]);
});

test('setup: fixes the records you had (proxied apex, www → uwloo.ca)', () => {
  const [apex, www, txt] = desiredRecords({ domain: 'uwloo.ca', owner: 'UmarPatel77', code: 'abc123' });
  assert.deepEqual(planRecord(apex, [{ id: 1, type: 'CNAME', content: 'umarpatel77.github.io', proxied: true }]).map((x) => x.op), ['update']);
  const w = planRecord(www, [{ id: 2, type: 'CNAME', content: 'uwloo.ca', proxied: true }]);
  assert.equal(w[0].op, 'update');
  assert.equal(w[0].body.content, 'umarpatel77.github.io');
  assert.equal(w[0].body.proxied, false);
  // Cloudflare may return TXT content with or without quotes; both count as correct.
  assert.deepEqual(planRecord(txt, [{ id: 3, type: 'TXT', content: 'abc123' }]).map((x) => x.op), ['ok']);
  assert.deepEqual(planRecord(txt, []).map((x) => x.op), ['create']);
});

test('setup: a CNAME replaces clashing A/AAAA records', () => {
  const [apex] = desiredRecords({ domain: 'uwloo.ca', owner: 'u' });
  const ops = planRecord(apex, [
    { id: 1, type: 'A', content: '185.199.108.153' },
    { id: 2, type: 'AAAA', content: '2606:50c0:8000::153' },
    { id: 3, type: 'TXT', content: 'keep me' },
  ]);
  assert.deepEqual(ops.map((x) => `${x.op}:${x.record?.id ?? 'new'}`), ['delete:1', 'delete:2', 'create:new']);
});

test('setup: Pages settings', () => {
  assert.deepEqual(planPages(null, 'uwloo.ca'), { create: true, update: { build_type: 'workflow', cname: 'uwloo.ca' } });
  assert.deepEqual(planPages({ build_type: 'legacy', cname: null }, 'uwloo.ca').update, { build_type: 'workflow', cname: 'uwloo.ca' });
  assert.deepEqual(planPages({ build_type: 'workflow', cname: 'uwloo.ca' }, 'uwloo.ca').update, {});
});

test('router: grad term pages', () => {
  assert.equal(to('/1249/CS'), '/1249/cs/');
  assert.equal(to('/1245/STAT'), '/1245/stat/');
  assert.equal(resolve('/1249/cs/', meta).type, 'notfound'); // exists-check: same path means no such page
  assert.match(resolve('/1241/cs', meta).message, /before Spring 2024 aren’t on uwloo yet/);
  assert.match(resolve('/1239', meta).message, /before Spring 2024/);
  assert.match(resolve('/1275/cs', meta).message, /no Spring 2027 Graduate Calendar yet/);
  // Grad terms: uwloo's version page first, acal when there isn't one.
  assert.equal(to('/1249/CS686'), '/1249/cs686/');
  assert.equal(to('/1249/CS/686'), '/1249/cs686/');
  assert.equal(to('/1249/cs686/'), 'https://acal.fast.uwaterloo.ca/course/1249/CS/686');
  assert.equal(to('/1241/cs686'), 'https://acal.fast.uwaterloo.ca/course/1241/CS/686');
  assert.equal(to('/2627/cs686'), '/2627/cs/#CS686');
});

test('catalogs: undergrad years and grad terms from Kuali titles', () => {
  const raw = [
    { id: 'u5', title: '2025-2026 Undergraduate Studies Academic Calendar', startDate: '2025-05-01', endDate: '2026-04-30' },
    { id: 'u6', title: '2026-2027 Undergraduate Studies Academic Calendar', startDate: '2026-05-01', endDate: '2027-04-30' },
    { id: 'u3', title: '2023-2024 Undergraduate Studies Academic Calendar', startDate: '2023-05-01' },
    { id: 'g0', title: 'Graduate Studies Academic Calendar Winter 2024', startDate: '2024-01-01' },
    { id: 'g1', title: 'Spring 2024 Graduate Studies Academic Calendar', startDate: '2024-05-01', endDate: '2024-08-31' },
    { id: 'g2', title: 'Graduate Studies Academic Calendar - Fall 2024', startDate: '2024-09-01', endDate: '2024-12-31' },
    { id: 'g3', title: 'Graduate Studies Academic Calendar', startDate: '2025-01-01', endDate: '2025-04-30' },
    { id: 'g4', title: 'Graduate Studies Academic Calendar 2026 Fall', startDate: '2026-09-01', endDate: '2026-12-31' },
    { id: 'g5', title: 'Graduate Studies Academic Calendar Winter 2027', startDate: '2027-01-01', endDate: '2027-04-30' },
    { id: 'gx', title: 'Graduate Studies Academic Calendar Fall 2026 (draft copy)', startDate: '2026-09-01' },
  ];
  const { ug, grad } = classifyCatalogs(raw, new Date('2026-10-06T12:00:00Z'));
  assert.deepEqual(ug.map((c) => [c.yearCode, c.status]), [['2526', 'past'], ['2627', 'current']]);
  assert.equal(ug[0].pageUrl, 'https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog/archive/2025-2026');
  assert.deepEqual(grad.map((c) => [c.term, c.label, c.yearCode, c.status]), [
    ['1245', 'Spring 2024', '2324', 'past'],
    ['1249', 'Fall 2024', '2425', 'past'],
    ['1251', 'Winter 2025', '2425', 'past'],
    ['1269', 'Fall 2026', '2627', 'current'],
    ['1271', 'Winter 2027', '2627', 'future'],
  ]);
  assert.equal(grad[0].pageUrl, 'https://uwaterloo.ca/academic-calendar/graduate-studies/catalog/archive/spring-2024');
  assert.equal(grad[3].pageUrl, 'https://uwaterloo.ca/academic-calendar/graduate-studies/catalog');
});

test('404 page script survives templating (regexes, archive fetch)', async () => {
  const { notFoundPage } = await import('./lib/render.mjs');
  const html = notFoundPage({ meta: { years: [], current: '2627', gradTerms: [], subjects: [] }, builtAt: new Date(), version: 'x' });
  assert.ok(html.includes('/^[0-9]{4}$/.test(year'), 'year check intact');
  assert.ok(html.includes('fetch(`/archive/${year}.json`)'), 'archive fetch intact');
  assert.ok(!/[^\\]\/\^d\{/.test(html), 'no regex lost its backslash');
});

test('outline link uses the outline site\'s own encoding', async () => {
  const { outlineUrl } = await import('./lib/render.mjs');
  assert.equal(outlineUrl('ECON', '221'), 'https://outline.uwaterloo.ca/viewer/?q=econ%2520221');
  assert.equal(outlineUrl('CS', '136L'), 'https://outline.uwaterloo.ca/viewer/?q=cs%2520136l');
});
