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

test('router: 9596 to 2324 go to ucalendar’s subject pages, and year front pages to Waterloo’s archive', () => {
  assert.equal(to('/2324/cs'), 'https://ucalendar.uwaterloo.ca/2324/COURSE/course-CS.html');
  assert.equal(to('/0910/math135'), 'https://ucalendar.uwaterloo.ca/0910/COURSE/course-MATH.html#MATH135');
  assert.equal(to('/9596/math'), 'https://ucalendar.uwaterloo.ca/9596/COURSE/course-MATH.html');
  // ucalendar.uwaterloo.ca/2324/ is gone; the archives page links these instead.
  assert.equal(to('/2324'), 'https://academic-calendar-archive.uwaterloo.ca/undergraduate-studies/2023-2024/page/uWaterloo-Undergraduate-Calendar-Access.html');
  assert.equal(to('/0708'), 'https://academic-calendar-archive.uwaterloo.ca/undergraduate-studies/2007-2008/page/uWaterloo-Undergraduate-Calendar-Access.html');
  assert.equal(to('/0607'), 'http://www.ucalendar.uwaterloo.ca/0607/');
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

test('archive indexes: spot checks against the page images', async () => {
  const { readFile } = await import('node:fs/promises');
  const load = async (y) => JSON.parse(await readFile(new URL(`../data/archive/${y}.json`, import.meta.url), 'utf8'));
  const [a, b] = [await load('6364'), await load('9495')];
  const go = (y, idx, p) => resolve(p, { ...meta, pdfPages: { [y]: idx } }).to;
  assert.equal(go('6364', a, '/6364/math'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf#page=143');
  assert.equal(go('6364', a, '/6364/math330'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf#page=147');
  assert.equal(go('6364', a, '/6364/cs'), 'http://www.ucalendar.uwaterloo.ca/6394/1963-64.pdf#page=100');
  // p. 353 has the "Computer Science" heading and notes; the course entries start on 354.
  assert.equal(go('9495', b, '/9495/cs'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=353');
  assert.equal(go('9495', b, '/9495/co350'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=351');
  assert.equal(go('9495', b, '/9495/amath'), 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=327');
});

test('archive indexes: every year from 6364 to 9495 is present and well-formed', async () => {
  // data/archive/ is generated by tools/archive/index_pdf.py; this catches a bad regeneration before it deploys.
  const { readFile } = await import('node:fs/promises');
  for (let start = 1963; start <= 1994; start++) {
    const y = `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`;
    const idx = JSON.parse(await readFile(new URL(`../data/archive/${y}.json`, import.meta.url), 'utf8'));
    assert.ok(Number.isInteger(idx._courses) && idx._courses > 0, `${y}: _courses`);
    for (const [k, v] of Object.entries(idx)) {
      assert.ok(/^(_courses|[A-Z]{2,8}(\d{3}[A-Z]{0,2})?)$/.test(k), `${y}: bad key ${k}`);
      assert.ok(Number.isInteger(v) && v > 0, `${y}: bad page for ${k}`);
    }
    assert.ok(Object.keys(idx).length > 20, `${y}: suspiciously small`);
    assert.ok(resolve(`/${y}/math`, { ...meta, pdfPages: { [y]: idx } }).to.includes('#page='), `${y}: /math has a page`);
  }
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
  assert.deepEqual(s.meets[0], { days: 'MWF', start: '10:30', end: '11:20', date: null, from: '2026-09-08', to: '2026-12-08', room: null });
  assert.equal(s.assoc, null);
  assert.equal(toSection({ associatedClassCode: '99', scheduleData: [{ locationName: 'MC 2065', classMeetingDayPatternCode: 'M', classMeetingStartTime: '10:30', classMeetingEndTime: '11:20' }] }).assoc, 99);
  assert.equal(toSection({ scheduleData: [{ locationName: 'MC 2065', classMeetingDayPatternCode: 'M', classMeetingStartTime: '10:30', classMeetingEndTime: '11:20' }] }).meets[0].room, 'MC 2065');
  assert.equal(toSection({ scheduleData: [{ locationName: 'UW U', classMeetingDayPatternCode: 'M', classMeetingStartTime: '10:30', classMeetingEndTime: '11:20' }] }).meets[0].room, null, 'only the campus');
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
  assert.match(resolve('/1249/xyz/', meta).message, /Fall 2024 Graduate Calendar has no XYZ courses/);
  // Before Kuali and not on uwloo: Waterloo's own archive.
  assert.equal(to('/1241/cs'), 'https://academic-calendar-archive.uwaterloo.ca/graduate-studies/archive-winter-2024/index.html');
  assert.equal(to('/1165'), 'https://academic-calendar-archive.uwaterloo.ca/graduate-studies/archive-spring-2016/index.html');
  assert.equal(to('/1109'), 'https://academic-calendar-archive.uwaterloo.ca/graduate-studies/2010/fall/gradcalendar.uwaterloo.ca/group/Gen-Info-Regs.html');
  assert.match(resolve('/1065', meta).message, /start at Fall 2006/);
  assert.match(resolve('/1275/cs', meta).message, /no Spring 2027 Graduate Calendar yet/);
  // Grad terms: uwloo's version page first, acal when there isn't one.
  assert.equal(to('/1249/CS686'), '/1249/cs686/');
  assert.equal(to('/1249/CS/686'), '/1249/cs686/');
  assert.equal(to('/1249/cs686/'), 'https://acal.fast.uwaterloo.ca/course/1249/CS/686');
  assert.equal(to('/1241/cs686'), 'https://acal.fast.uwaterloo.ca/course/1241/CS/686');
  assert.equal(to('/2627/cs686'), '/2627/cs/#CS686');
});

test('router: older grad terms on uwloo, and codes that are both a term and a year', () => {
  const m = { ...meta, gradOld: ['1069', '1109', '1201'] };
  const go = (p) => resolve(p, m).to;
  assert.equal(go('/1109/CO'), '/1109/co/');
  assert.equal(resolve('/1109', m).type, 'notfound', 'the router only runs when /1109/ isn’t a page');
  assert.equal(go('/1109/co602'), '/1109/co/#CO602');
  assert.equal(go('/1109/CO/602'), '/1109/co/#CO602');
  assert.equal(go('/1201/cs-646/'), '/1201/cs/#CS646');
  assert.match(resolve('/1109/xyz/', m).message, /Fall 2010 Graduate Calendar has no XYZ courses/);
  assert.equal(go('/1171/cs'), 'https://academic-calendar-archive.uwaterloo.ca/graduate-studies/archive-winter-2017/index.html');
  assert.equal(go('/1171/cs646'), 'https://acal.fast.uwaterloo.ca/course/1171/CS/646');
  // 1011 is Winter 2001 and 2010–11; 1415 is Spring 2041 and 2014–15: the year wins.
  assert.equal(go('/1011/cs'), 'https://ucalendar.uwaterloo.ca/1011/COURSE/course-CS.html');
  assert.equal(go('/1415/msci452'), 'https://ucalendar.uwaterloo.ca/1415/COURSE/course-MSCI.html#MSCI452');
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

test('router: scanned years with OCR text go to their uwloo pages', () => {
  const m = { ...meta, pdfPages: { 9495: { _courses: 323, CS: 353, CS241: 354, _text: { cs: 'cs', am: 'am', amath: 'am' } } } };
  assert.equal(resolve('/9495/CS', m).to, '/9495/cs/');
  assert.equal(resolve('/9495/cs241', m).to, '/9495/cs/#CS241');
  assert.equal(resolve('/9495/cs/241', m).to, '/9495/cs/#CS241');
  assert.equal(resolve('/9495/amath231', m).to, '/9495/am/#AM231');
  // subjects without a text page still open the PDF
  assert.equal(resolve('/9495/xyz', m).to, 'http://www.ucalendar.uwaterloo.ca/6394/1994-95.pdf#page=323');
});

test('archive text: files are well-formed and pages render', async () => {
  const { loadArchiveText, archiveSubjectPage, textMap } = await import('./lib/archive.mjs');
  const docs = await loadArchiveText(new URL('../data/archive-text', import.meta.url).pathname);
  for (const doc of docs.values()) {
    assert.match(doc.year, /^\d{4}$/);
    assert.ok(doc.pdf.endsWith('.pdf'), `${doc.year}: pdf`);
    const ids = new Set();
    for (const s of doc.subjects) {
      assert.match(s.code, /^[A-Z]{2,8}$/, `${doc.year}: subject ${s.code}`);
      assert.ok(Number.isInteger(s.page), `${doc.year} ${s.code}: page`);
      for (const c of s.courses) {
        assert.ok(Number.isInteger(c.page) && Array.isArray(c.paras), `${doc.year} ${c.label}`);
        if (c.id) {
          assert.ok(c.id.startsWith(s.code), `${doc.year}: ${c.id} under ${s.code}`);
          assert.ok(!ids.has(c.id), `${doc.year}: duplicate anchor ${c.id}`);
          ids.add(c.id);
        }
      }
    }
    assert.ok(Object.keys(textMap(doc)).length >= doc.subjects.length);
  }
  const doc = docs.get('9495');
  if (doc) {
    const cs = doc.subjects.find((s) => s.code === 'CS');
    const html = archiveSubjectPage({ doc, s: cs, index: { CS999: 360 }, today: new Set(['CS241']), builtAt: new Date(), version: 'x' });
    assert.match(html, /<section class="entry" id="CS241">/);
    assert.match(html, /href="\/cs241\/">CS 241 today</);
    assert.match(html, /1994-95\.pdf#page=\d+">Scanned page/);
    assert.ok(html.includes("id.replace(/^([A-Z]+)([0-9])/, '$1 $2')"), 'missing-course script intact');
    assert.ok(!/<script>[\s\S]*[^\\]\(d\)[\s\S]*<\/script>/.test(html), 'no regex in the page script lost its backslash');
    assert.ok(html.includes("/^[A-Z]+$/.test(el.id.slice(id.length))"), 'suffix-variant check intact');
    assert.ok(html.includes('"CS999":360'), 'fallback page for a course the text missed');
  }
});

test('reddit: removals drop comments, posts, starters and users', async () => {
  const { parseRemovals, applyRemovals } = await import('./lib/reddit.mjs');
  const entries = [
    { in: 'comment', post: 'p1', comment: 'c1', author: 'alice', starter: 's1', starter_author: 'bob', starter_text: 'hi', t: 3 },
    { in: 'comment', post: 'p2', comment: 'c2', author: 'carol', t: 2 },
    { in: 'post', post: 'p3', post_author: 'Dave', post_text: 'x', t: 1 },
  ];
  const r = parseRemovals('# comment\nt1_c2\n\nu/dave\nbob\n');
  assert.deepEqual([...r.ids].sort(), ['bob', 'c2']);
  assert.deepEqual([...r.users], ['dave']);
  const kept = applyRemovals(entries, parseRemovals('t1_c2\nu/dave\ns1'));
  assert.deepEqual(kept.map((e) => e.comment ?? e.post), ['c1']);
  assert.equal(kept[0].starter_text, '[deleted]');
  assert.equal(applyRemovals(entries, parseRemovals('t3_p1')).length, 2);
  assert.equal(entries[0].starter_text, 'hi', 'original entries untouched');
});

test('reddit: entries escape quoted text and link the whole thread branch', async () => {
  const { entryHtml, listHtml, termOf, threadUrl } = await import('../site/reddit.js');
  const e = { in: 'comment', post: 'abc', comment: 'c9', starter: 's7', t: 1735365524, title: 'CS 135 <b>help</b>', score: 3, n: 16,
    text: '<script>alert(1)</script> CS 135 is fine', author: 'u_1', starter_text: 'start', starter_author: null, post_text: 'op words' };
  const html = entryHtml(e, 'CS135', { repo: 'me/repo' });
  assert.ok(!html.includes('<script>alert'), 'quoted text is escaped');
  assert.match(html, /&lt;b&gt;help&lt;\/b&gt;/);
  assert.equal(threadUrl(e), 'https://www.reddit.com/r/uwaterloo/comments/abc/_/s7/');
  assert.match(html, /<span class="rd-user">\[deleted\]<\/span>: “start”/);
  assert.match(html, /github\.com\/me\/repo\/issues\/new\?title=Remove%20Reddit%20quote%20c9/);
  assert.equal(termOf(1735365524), 'Fall 2024');
  assert.equal(termOf(Date.UTC(2025, 4, 1) / 1000), 'Spring 2025');
  const list = listHtml([e, { ...e, post: 'old', t: Date.UTC(2024, 1, 1) / 1000 }], 'CS135');
  assert.deepEqual([...list.matchAll(/<h3 class="rd-term">([^<]+)/g)].map((m) => m[1]), ['Fall 2024', 'Winter 2024']);
});

test('reddit: one card per thread, post first, replies under their thread starter', async () => {
  const { groupThreads, threadHtml } = await import('../site/reddit.js');
  const base = { post: 'p1', title: 'T', score: 5, n: 9, post_text: 'op' };
  const entries = [
    { ...base, in: 'comment', comment: 'c2', starter: 's1', starter_text: 'start', starter_author: 'b', author: 'x', text: 'second', t: 30 },
    { ...base, in: 'post', post_author: 'op_user', t: 10 },
    { ...base, in: 'comment', comment: 'c1', starter: 's1', starter_text: 'start', starter_author: 'b', author: 'y', text: 'first', t: 20 },
    { ...base, in: 'comment', comment: 'c3', author: 'z', text: 'top-level', t: 25 },
  ];
  const [th, ...rest] = groupThreads(entries);
  assert.equal(rest.length, 0);
  assert.equal(th.t, 30);
  assert.ok(th.hit);
  assert.deepEqual(th.branches.map((b) => [b.root?.comment ?? null, b.replies.map((r) => r.comment)]), [[null, ['c1', 'c2']], ['c3', []]]);
  const html = threadHtml(th, 'CS135');
  assert.equal(html.match(/“start”/g).length, 1, 'shared thread starter shown once');
  // a thread starter that names the course itself appears once, highlighted
  const both = groupThreads([
    { ...base, in: 'comment', comment: 's9', author: 'r', text: 'root says CS 135', t: 40 },
    { ...base, in: 'comment', comment: 'c9', starter: 's9', starter_text: 'root says CS 135', starter_author: 'r', author: 'k', text: 'reply', t: 41 },
  ])[0];
  const h2 = threadHtml(both, 'CS135');
  assert.equal(h2.match(/root says CS 135/g).length, 1);
  assert.match(h2, /rd-q rd-hit">.*root says/);
  assert.ok(html.indexOf('“op”') < html.indexOf('“start”') && html.indexOf('“first”') < html.indexOf('“second”'));
  assert.match(html, /u\/op_user/);
});

test('reddit: data files are well-formed', async () => {
  const { loadReddit } = await import('./lib/reddit.mjs');
  const { map, meta } = await loadReddit(new URL('../data/reddit', import.meta.url).pathname);
  if (!map.size) return;
  assert.ok(meta?.through > 1.7e9, 'meta.through');
  let checked = 0;
  assert.ok(map.get('PD11')?.length > 100, 'PD courses have one- or two-digit numbers');
  for (const [code, entries] of map) {
    assert.match(code, /^([A-Z]{2,6}\d{3}[A-Z]?|PD\d{1,2})$/, code);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      assert.ok(/^[a-z0-9]+$/.test(e.post) && Number.isInteger(e.t), `${code}: entry ${i}`);
      assert.ok(e.in === 'post' || (e.in === 'comment' && e.comment && typeof e.text === 'string'), `${code}: ${e.post}`);
      if (i) assert.ok(entries[i - 1].t >= e.t, `${code}: newest first`);
    }
    if (++checked > 400) break;
  }
});

// ---------- course resources ----------

const pdfPart = (n, over = {}) => ({ n, file: `${String(n).repeat(12).slice(0, 12)}.pdf`, pages: 10, ...over });
const resource = (over = {}) => ({
  id: '8ac91f576377', codes: ['CS341'], slug: '1249-notes', kind: 'notes', title: 'CS 341 course notes', by: 'Prof. X', term: '1249',
  permission: 'Shared by the author, October 2026', note: 'Covers everything; see CS 240.\n\nAlso https://en.wikipedia.org/wiki/Master_theorem_(analysis_of_algorithms).',
  parts: [{ n: 1, file: '8ac91f576377.pdf', pages: 10, page_notes: { 4: 'Typo in <Lemma 2>', 8: 'Dijkstra starts here.' } }], added: '2026-10-10', ...over,
});
const set = (over = {}) => resource({
  parts: [
    pdfPart(1, { title: 'Chapter 1' }),
    pdfPart(2, { title: 'Chapter 2', page_notes: { 3: 'A typo' } }),
    pdfPart(6, { title: 'Chapter 3' }),
    { n: 4, title: 'Course website', url: 'https://example.com/~x/cs341/' },
    pdfPart(3, { title: 'Chapter 10', url: 'https://example.com/~x/ch10.pdf' }),
  ],
  ...over,
});

test('resources: catalogue entries are checked', async () => {
  const { validate } = await import('./lib/resources.mjs');
  assert.deepEqual(validate(resource()), []);
  assert.deepEqual(validate(set()), []);
  assert.deepEqual(validate(resource({ permission: undefined, parts: [{ n: 1, url: 'https://example.com/n.pdf' }] })), []);
  const bad = (over) => validate(resource(over)).join(' | ');
  assert.match(bad({ permission: '' }), /permission/);
  assert.match(bad({ parts: [{ n: 1 }] }), /needs a file \(hosted\) or a url/);
  assert.match(bad({ parts: [] }), /at least one/);
  assert.match(bad({ slug: '1251-notes' }), /slug’s term/);
  assert.match(bad({ slug: 'Notes' }), /slug must/);
  assert.match(bad({ kind: 'lecture' }), /kind must/);
  assert.match(bad({ codes: ['cs341'] }), /codes/);
  assert.match(bad({ parts: [{ n: 1, file: 'other.pdf' }] }), /file must be/);
  assert.match(bad({ parts: [{ n: 1, file: '8ac91f576377.pdf', pages: 10, page_notes: { 11: 'past the end' } }] }), /page_notes\["11"\]/);
  assert.match(bad({ term: '1248' }), /term must/);
  assert.match(validate(set({ parts: [pdfPart(1, { title: 'A' }), pdfPart(2)] })).join(), /parts\[1\]\.title is required/);
  assert.match(validate(set({ parts: [pdfPart(1, { title: 'A' }), pdfPart(1, { title: 'B', file: 'bbbbbbbbbbbb.pdf' })] })).join(), /same n/);
  assert.match(validate(set({ parts: [pdfPart(1, { title: 'A' }), pdfPart(2, { title: 'B', file: '111111111111.pdf' })] })).join(), /same file is in two parts/);
  assert.match(bad({ parts: [{ n: 1, url: 'https://x.y', pages: 3 }] }), /for hosted PDFs/);
});

test('resources: loader skips bad entries and catches clashes', async () => {
  const { mkdtemp, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { loadResources } = await import('./lib/resources.mjs');
  const dir = await mkdtemp(`${tmpdir()}/res-`);
  await wf(`${dir}/CS.json`, JSON.stringify([
    resource(),
    resource({ id: '111111111111', parts: [pdfPart(1, { file: '111111111111.pdf' })] }), // same /cs341/1249-notes
    resource({ id: '222222222222', codes: ['MATH239'], slug: 'notes', term: undefined, parts: [pdfPart(1, { file: '222222222222.pdf' })] }), // wrong file
    resource({ slug: '1249-notes-2', parts: [pdfPart(1, { file: '333333333333.pdf' })] }), // same id twice
    resource({ id: '444444444444', slug: '1249-notes-3' }), // a PDF that's already in another entry
  ]));
  const { entries, errors } = await loadResources(dir);
  assert.deepEqual(entries.map((e) => e.id), ['8ac91f576377']);
  assert.equal(errors.length, 4);
  assert.match(errors.join('\n'), /cs341\/1249-notes is already used/);
  assert.match(errors.join('\n'), /belongs in MATH\.json/);
  assert.match(errors.join('\n'), /id 8ac91f576377 is used twice/);
  assert.match(errors.join('\n'), /8ac91f576377\.pdf is already in cs341\/1249-notes/);
  assert.deepEqual(await loadResources(`${dir}/none`), { entries: [], errors: [] });
});

test('resources: course page section and the notes-then-PDF page', async () => {
  const { resourcesSection, resourcePage, citation, noteHtml } = await import('./lib/resources.mjs');
  const known = new Set(['CS341', 'CS240']);
  const hosted = resource({ title: 'Notes <b>bold</b>' });
  const linked = resource({ id: 'd5ecbee25209', slug: '1251-notes', term: '1251', permission: undefined, parts: [{ n: 1, url: 'https://www.example.com/~a/cs341/' }], title: 'Summaries', note: 'One page per lecture.' });
  const sec = resourcesSection('CS341', [hosted, linked], { known, repo: 'me/repo' });
  assert.ok(sec.indexOf('Summaries') < sec.indexOf('Notes &lt;b&gt;'), 'newest term first');
  assert.ok(!sec.includes('<b>bold'), 'titles escaped');
  assert.match(sec, /href="\/cs341\/1249-notes\/"/);
  assert.match(sec, /href="\/files\/8ac91f576377\.pdf" download="CS341-1249-notes\.pdf"/);
  assert.match(sec, /Fall 2024 · Prof\. X · 10 pages/);
  assert.match(sec, /Open on example\.com/);
  assert.match(sec, /<a class="cc" href="\/cs240\/">CS 240<\/a>/);
  assert.match(sec, /github\.com\/me\/repo\/issues\/new\?title=Resource%20for%20CS%20341/);
  assert.equal(resourcesSection('CS341', [], { known, repo: 'r' }), '');
  assert.match(noteHtml('a https://en.wikipedia.org/wiki/X_(y). b', known), /href="https:\/\/en\.wikipedia\.org\/wiki\/X_\(y\)">[^<]+<\/a>\. b/);

  const page = resourcePage({ e: hosted, course: { title: 'Algorithms' }, known, text: 'Page one text\fPage two\f', repo: 'me/repo', builtAt: new Date(), version: 'v' });
  assert.ok(page.indexOf('class="res-notes"') < page.indexOf('id="viewer"'), 'notes sit above the PDF');
  assert.ok(!page.includes('In this set'), 'one PDF: no parts list');
  assert.match(page, /<a href="#page=4" data-page="4">p\. 4<\/a> <span>Typo in &lt;Lemma 2&gt;<\/span>/);
  assert.match(page, /data-src="\/files\/8ac91f576377\.pdf" data-pdfjs="\/vendor\/pdfjs-[\d.]+\/pdf\.min\.js" data-pages="10"/);
  assert.match(page, /Shared by the author, October 2026/);
  assert.match(page, /<h3 id="text-p2">Page 2<\/h3>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/uwloo\.ca\/cs341\/1249-notes\/">/);
  assert.equal(citation(resource()), 'Prof. X. “CS 341 course notes.” University of Waterloo, CS 341, Fall 2024. https://uwloo.ca/cs341/1249-notes/');
  assert.equal(citation(linked), 'Prof. X. “Summaries.” University of Waterloo, CS 341, Winter 2025. https://www.example.com/~a/cs341/');
});

test('resources: a set of PDFs and links', async () => {
  const { resourcesSection, resourcePage, entryPages, citation, available, partPath } = await import('./lib/resources.mjs');
  const known = new Set(['CS341']);
  const e = set();
  // Pages: the first PDF at the entry's address, the others at /{n}/ (n never changes), /1/ redirects.
  assert.deepEqual(entryPages(e).map(([path, p]) => [path, p?.title ?? null]), [
    ['/cs341/1249-notes/', 'Chapter 1'], ['/cs341/1249-notes/2/', 'Chapter 2'], ['/cs341/1249-notes/6/', 'Chapter 3'], ['/cs341/1249-notes/3/', 'Chapter 10'], ['/cs341/1249-notes/1/', null],
  ]);
  const sec = resourcesSection('CS341', [e], { known, repo: 'me/repo' });
  assert.match(sec, /Fall 2024 · Prof\. X · 4 PDFs · 1 link/);
  assert.deepEqual([...sec.matchAll(/<li>(<a [^>]+>[^<]+<\/a>)/g)].map((m) => /href="([^"]+)"/.exec(m[1])[1]),
    ['/cs341/1249-notes/', '/cs341/1249-notes/2/', '/cs341/1249-notes/6/', 'https://example.com/~x/cs341/', '/cs341/1249-notes/3/']);
  assert.ok(!sec.includes('download='), 'a set has no single download');
  // Ten PDFs: the card lists eight and points to the rest.
  const big = set({ parts: Array.from({ length: 10 }, (_, i) => pdfPart(i + 1, { title: `Lecture ${i + 1}`, file: `${String(i).padStart(12, 'a')}.pdf` })) });
  assert.match(resourcesSection('CS341', [big], { known, repo: 'r' }), /<li class="more-parts"><a href="\/cs341\/1249-notes\/">2 more<\/a><\/li>/);

  const p3 = e.parts.find((p) => p.title === 'Chapter 3');
  const page = resourcePage({ e, p: p3, course: { title: 'Algorithms' }, known, text: '', repo: 'me/repo', builtAt: new Date(), version: 'v' });
  assert.ok(page.indexOf('class="res-notes"') < page.indexOf('In this set') && page.indexOf('In this set') < page.indexOf('id="viewer"'));
  assert.match(page, /<details class="res-set" open><summary><h2>In this set<\/h2> <span class="t">4 PDFs · 1 link<\/span>/);
  assert.match(resourcePage({ e: big, p: big.parts[0], known, repo: 'r', builtAt: new Date(), version: 'v' }), /<details class="res-set"><summary>/);
  assert.match(page, /<a aria-current="page" href="\/cs341\/1249-notes\/6\/">Chapter 3<\/a>/);
  assert.match(page, /<h2><span class="pn">3<\/span> Chapter 3<\/h2>/);
  assert.match(page, /href="\/cs341\/1249-notes\/2\/" rel="prev">← Previous.*href="\/cs341\/1249-notes\/3\/" rel="next">Next →/);
  assert.match(page, /download="CS341-1249-notes-6\.pdf">Download this PDF/);
  assert.match(page, /<link rel="canonical" href="https:\/\/uwloo\.ca\/cs341\/1249-notes\/6\/">/);
  assert.match(page, /<title>Chapter 3, CS 341 course notes, CS 341 \| uwloo<\/title>/);
  assert.ok(!page.includes('Page notes'), 'page notes belong to their own PDF');
  const p2 = resourcePage({ e, p: e.parts[1], known, repo: 'r', builtAt: new Date(), version: 'v' });
  assert.match(p2, /Page notes <span class="t">for Chapter 2<\/span>/);
  const p10 = resourcePage({ e, p: e.parts[4], known, repo: 'r', builtAt: new Date(), version: 'v' });
  assert.match(p10, /Original on example\.com/);
  assert.equal(citation(e, p3), 'Prof. X. “CS 341 course notes: Chapter 3.” University of Waterloo, CS 341, Fall 2024. https://uwloo.ca/cs341/1249-notes/6/');
  assert.equal(partPath(e, e.parts[0]), '/cs341/1249-notes/');
  // A PDF not uploaded yet drops out; the rest stay.
  const some = available(e, new Set(['222222222222.pdf']));
  assert.deepEqual(some.parts.map((p) => p.title), ['Chapter 2', 'Course website']);
  assert.equal(partPath(some, some.parts[0]), '/cs341/1249-notes/');
  assert.equal(available(resource(), new Set()), null);
});

test('resources: PDF.js files the viewer loads are all there', async () => {
  const { existsSync } = await import('node:fs');
  const src = readFileSync(new URL('./lib/resources.mjs', import.meta.url), 'utf8');
  const dir = new URL(`../site${/const PDFJS = '([^']+)'/.exec(src)[1].replace(/pdf\.min\.js$/, '')}`, import.meta.url);
  for (const f of ['pdf.min.js', 'pdf.worker.min.js', 'wasm/jbig2.wasm', 'wasm/openjpeg.wasm', 'standard_fonts/FoxitDingbats.pfb', 'cmaps/UniJIS-UTF16-H.bcmap', 'LICENSE']) {
    assert.ok(existsSync(new URL(f, dir)), f);
  }
  const viewer = readFileSync(new URL('../site/viewer.js', import.meta.url), 'utf8');
  for (const opt of ['wasmUrl', 'standardFontDataUrl', 'cMapUrl', 'iccUrl']) assert.ok(viewer.includes(opt), opt);
});

test('resources: files come from the release and must match their id', async () => {
  const http = await import('node:http');
  const { createHash } = await import('node:crypto');
  const { mkdtemp, readdir: rd } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { syncFiles, publishFiles } = await import('./lib/resources.mjs');
  const good = Buffer.from('%PDF-1.4 good');
  const goodName = `${createHash('sha256').update(good).digest('hex').slice(0, 12)}.pdf`;
  const server = http.createServer((req, res) => {
    const base = `http://localhost:${server.address().port}`;
    if (req.url.startsWith('/repos/me/repo/releases?')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([
        { tag_name: 'files', assets: [{ name: goodName, url: `${base}/a/1` }, { name: 'aaaaaaaaaaaa.pdf', url: `${base}/a/2` }] },
        { tag_name: 'v1', assets: [{ name: 'bbbbbbbbbbbb.pdf', url: `${base}/a/3` }] },
      ]));
    }
    res.writeHead(200);
    res.end(req.url === '/a/1' ? good : 'not the same file');
  });
  await new Promise((r) => server.listen(0, r));
  const cacheDir = await mkdtemp(`${tmpdir()}/files-`);
  const warnings = [];
  try {
    const entries = ['', 'aaaaaaaaaaaa.pdf', 'bbbbbbbbbbbb.pdf', 'cccccccccccc.pdf'].map((f, i) => ({ id: String(i), parts: [{ n: 1, file: f || goodName }] }));
    const have = await syncFiles([...entries, { id: 'link', parts: [{ n: 1, url: 'https://x' }] }], { repo: 'me/repo', cacheDir, api: `http://localhost:${server.address().port}`, log: { warn: (m) => warnings.push(m) } });
    assert.deepEqual([...have], [goodName]);
    assert.match(warnings.join('\n'), /aaaaaaaaaaaa\.pdf: contents don’t match/);
    assert.match(warnings.join('\n'), /hidden: aaaaaaaaaaaa\.pdf, bbbbbbbbbbbb\.pdf, cccccccccccc\.pdf/);
    const out = `${cacheDir}/out`;
    assert.equal(await publishFiles(have, { cacheDir, out }), good.length);
    assert.deepEqual(await rd(out), [goodName]);
    // Cached files aren't fetched again.
    server.close();
    assert.deepEqual([...(await syncFiles(entries.slice(0, 1), { repo: 'me/repo', cacheDir, api: 'http://localhost:1' }))], [goodName]);
  } finally {
    server.close();
  }
});

test('router: resource pages in any case', () => {
  assert.equal(to('/CS341/1249-Notes'), '/cs341/1249-notes/');
  assert.equal(to('/cs-341/cheatsheet'), '/cs341/cheatsheet/');
  assert.equal(to('/CS341/1249-NOTES/6'), '/cs341/1249-notes/6/');
  assert.equal(resolve('/cs341/1249-notes/6/', meta).type, 'notfound');
  assert.equal(resolve('/cs341/1249-notes/', meta).type, 'notfound');
  assert.equal(to('/cs/135'), '/cs135/');
});

test('resources: data files are well-formed', async () => {
  const { loadResources } = await import('./lib/resources.mjs');
  const { errors } = await loadResources(new URL('../data/resources', import.meta.url).pathname);
  assert.deepEqual(errors, []);
});

// ---------- link finder ----------

test('links: robots.txt', async () => {
  const { parseRobots, robotsAllows, robotsDelay } = await import('./lib/links.mjs');
  const g = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/ok.html\nDisallow: /*.pdf$\nCrawl-delay: 2\n\nUser-agent: uwloo-links\nUser-agent: other\nDisallow: /no-uwloo/\n');
  assert.equal(robotsAllows(g, '/private/x', 'Googlebot'), false);
  assert.equal(robotsAllows(g, '/private/ok.html', 'Googlebot'), true);
  assert.equal(robotsAllows(g, '/a/b.pdf', 'Googlebot'), false);
  assert.equal(robotsAllows(g, '/a/b.pdfx', 'Googlebot'), true);
  assert.equal(robotsDelay(g, 'Googlebot'), 2);
  // A group naming uwloo-links replaces the * group for it.
  assert.equal(robotsAllows(g, '/no-uwloo/a'), false);
  assert.equal(robotsAllows(g, '/private/x'), true);
  assert.equal(robotsAllows(parseRobots(''), '/anything'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:\n'), '/x'), true);
});

test('links: course codes in addresses and text', async () => {
  const { urlCodes, textCodes, courseHome, skipReason, looksLikeAnswers, classify, termIn, cleanTitle } = await import('./lib/links.mjs');
  const known = new Set(['CS245', 'STAT330', 'CS480', 'CS341', 'CO350', 'CS240', 'ECE428', 'CS136L', 'CS136', 'CS349']);
  assert.deepEqual(urlCodes('https://student.cs.uwaterloo.ca/~cs245/assign5.html', known), ['CS245']);
  assert.deepEqual(urlCodes('https://www.richardwu.ca/notes/stat330-notes.pdf', known), ['STAT330']);
  assert.deepEqual(urlCodes('https://cs.uwaterloo.ca/~zsheikhb/CS480-winter2020.html', known), ['CS480']);
  assert.deepEqual(urlCodes('https://example.com/cs/341/', known), ['CS341']);
  assert.deepEqual(urlCodes('https://example.com/cs136l/lab1', known), ['CS136L']);
  assert.deepEqual(urlCodes('https://example.com/page123', known), []);
  assert.deepEqual(textCodes('CS 341 and C&O 350, but not cs 240', known), ['CS341', 'CO350']);
  assert.deepEqual(courseHome('http://www.student.cs.uwaterloo.ca/~cs245/w17/assign5.html', known), { url: 'https://student.cs.uwaterloo.ca/~cs245/', code: 'CS245' });
  assert.equal(courseHome('https://cs.uwaterloo.ca/~zsheikhb/x.html', known), null);
  assert.match(skipReason('https://web.stanford.edu/class/cs107/'), /skipped/);
  assert.match(skipReason('https://www.coursehero.com/x'), /skipped/);
  assert.match(skipReason('https://uwflow.com/course/cs341'), /skipped/);
  assert.match(skipReason('https://uwloo.ca/cs341/'), /uwloo/);
  assert.equal(skipReason('https://www.youtube.com/playlist?list=x'), null);
  assert.equal(skipReason('https://sites.google.com/site/emmfis/teaching/amath-475'), null, 'Google Sites pages are web pages');
  assert.match(skipReason('https://drive.google.com/file/d/x/view'), /skipped/);
  assert.match(skipReason('https://www.google.com/url?q=https://www.dropbox.com/s/x/Block1.pdf'), /skipped/);
  const { canonical, homepageIn, teachingLinks } = await import('./lib/links.mjs');
  assert.equal(canonical('https://sites.google.com/site/emmfis/teaching/amath-475?authuser=0'), 'https://sites.google.com/site/emmfis/teaching/amath-475');
  // A professor's Google Site: profile → homepage → teaching page → one page per course.
  const g = 'https://sites.google.com/site/emmfis';
  assert.equal(homepageIn({ links: [{ href: 'https://uwaterloo.ca/applied-mathematics/profiles/x', text: 'Profile' }, { href: `${g}/homepage`, text: 'Personal website' }] }, 'https://uwaterloo.ca/applied-mathematics/profiles/x'), `${g}/homepage`);
  assert.deepEqual(teachingLinks({ links: [{ href: `${g}/research`, text: 'Research' }, { href: `${g}/teaching`, text: 'Teaching' }] }, `${g}/homepage`), [`${g}/teaching`]);
  assert.deepEqual(urlCodes(`${g}/teaching/amath-475`, new Set(['AMATH475'])), ['AMATH475']);
  assert.equal(skipReason('https://github.com/a/b'), null);
  assert.ok(looksLikeAnswers('https://x.ca/cs240/a2-solutions.pdf'));
  assert.ok(looksLikeAnswers('CS 341 Assignment 3'));
  assert.ok(!looksLikeAnswers('https://x.ca/notes/cs341.pdf', 'CS 341 course notes'));
  assert.equal(termIn('https://ece.uwaterloo.ca/~cath/ece428w12/'), '1121');
  assert.equal(termIn('CS 341 Fall 2019'), '1199');
  assert.equal(termIn('https://cs.uwaterloo.ca/~z/CS480-winter2020.html'), '1201');
  assert.equal(termIn('https://student.cs.uwaterloo.ca/~cs349/s20/'), '1205');
  assert.equal(termIn('https://x.ca/cs341/1249/'), '1249');
  assert.equal(termIn('https://x.ca/cs341/'), null);
  assert.equal(classify({ url: 'https://x.ca/stat330-notes.pdf' }).kind, 'notes');
  assert.equal(classify({ url: 'https://www.youtube.com/playlist?list=x', title: 'CS 341 lectures' }).kind, 'videos');
  assert.equal(classify({ url: 'https://student.cs.uwaterloo.ca/~cs341/', home: true }).kind, 'site');
  assert.equal(classify({ url: 'https://x.ca/cs341/midterm-w19.pdf' }).kind, 'midterm');
  assert.equal(cleanTitle('CS 341: Algorithms | Cheriton School of Computer Science', 'https://x'), 'CS 341: Algorithms');
  assert.equal(cleanTitle('CS 341 – Algorithms', 'https://x'), 'CS 341 – Algorithms');
  assert.equal(cleanTitle('', 'https://x.ca/notes/cs341.pdf'), 'x.ca/notes/cs341.pdf');
  assert.equal(cleanTitle('GitHub - shinew/cs341: CS 341 notes', 'https://github.com/shinew/cs341'), 'CS 341 notes');
  assert.equal(cleanTitle('notes-uwaterloo/co487/classnotes.pdf at master · mtahmed/notes-uwaterloo · GitHub', 'https://github.com/x'), 'notes-uwaterloo/co487/classnotes.pdf');
  const { codeHostReason, isForumDump } = await import('./lib/links.mjs');
  assert.equal(codeHostReason('https://github.com/shinew/cs341', 'CS 341 notes'), null);
  assert.equal(codeHostReason('https://github.com/billxinli/cs350', 'CS350 Fall of 2010'), 'code, not notes');
  assert.equal(codeHostReason('https://github.com/topics/cs452'), 'not a repository');
  assert.equal(codeHostReason('https://github.com/Dakkers/UW-Course-Notes/blob/master/MATH%20136/Course%20Notes.pdf'), null);
  assert.equal(codeHostReason('https://example.com/cs350'), null);
  assert.ok(isForumDump('https://github.com/foxfriends/cs348-piazza'));
});

test('links: webrings, directories, profiles, link lists', async () => {
  const { webringMembers, directoryProfiles, homepageIn, readHtml, readMarkdown, teachingLinks } = await import('./lib/links.mjs');
  // The three webrings' formats: JSON in index.html, a JS array, a JS array with bare keys.
  assert.deepEqual(webringMembers('const webringData = {"sites": [{"name": "Justin Gu","year": 2026,"website": "https://justin.run"}]}'), [{ name: 'Justin Gu', url: 'https://justin.run' }]);
  assert.deepEqual(webringMembers('const allSites = [\n {\n "name": "A B",\n "year": 2025,\n "website": "https://ab.me/"\n }\n];'), [{ name: 'A B', url: 'https://ab.me/' }]);
  assert.deepEqual(webringMembers('var ece_students = [ { name: "S K", website: "https://sk.github.io/", year: "2024" } ]'), [{ name: 'S K', url: 'https://sk.github.io/' }]);
  const dir = `<ul><li><a href="/pure-mathematics/contacts/ann-a">Ann A</a> <p>Associate Professor</p></li>
    <li><a href="/pure-mathematics/contacts/bob-b">Bob B</a> <p>Graduate Student</p></li>
    <li><a href="/pure-mathematics/contacts?group=faculty">Faculty</a></li><li><a href="/pure-mathematics/news">News</a></li></ul>`;
  assert.deepEqual(directoryProfiles(dir, 'https://uwaterloo.ca/pure-mathematics/contacts'), ['https://uwaterloo.ca/pure-mathematics/contacts/ann-a']);
  const prof = readHtml('<body><a href="/pure-mathematics/">Home</a><a href="https://uwaterloo.ca/about">About</a><h2>Links</h2><p>Link to personal webpage: <a href="https://melczer.ca">https://melczer.ca</a></p><a href="https://scholar.google.com/x">Scholar</a></body>', 'https://uwaterloo.ca/pure-mathematics/contacts/x');
  assert.equal(homepageIn(prof, 'https://uwaterloo.ca/pure-mathematics/contacts/x'), 'https://melczer.ca/');
  const tilde = readHtml('<a href="https://cs.uwaterloo.ca/~mli/">Ming Li</a>', 'https://cs.uwaterloo.ca/about/people/mli');
  assert.equal(homepageIn(tilde, 'https://cs.uwaterloo.ca/about/people/mli'), 'https://cs.uwaterloo.ca/~mli/');
  const home = readHtml('<a href="teaching.html">Teaching</a><a href="pubs.html">Papers</a><a href="https://other.ca/courses">x</a>', 'https://melczer.ca/');
  assert.deepEqual(teachingLinks(home, 'https://melczer.ca/'), ['https://melczer.ca/teaching.html']);
  const md = readMarkdown('# Links\n- https://general.ca/\n### CS 341 - Algorithms\n- https://student.cs.uwaterloo.ca/~cs341/\n- [Visualizer](https://vis.ca/bfs)\n### Co-op\n- https://coop.ca/', 'https://raw.githubusercontent.com/a/b/master/README.md', new Set(['CS341']));
  assert.deepEqual(md.map((l) => [l.href, l.codes]), [
    ['https://general.ca/', []], ['https://student.cs.uwaterloo.ca/~cs341/', ['CS341']], ['https://vis.ca/bfs', ['CS341']], ['https://coop.ca/', []],
  ]);
});

test('links: the finder end to end, against a local site', async () => {
  const http = await import('node:http');
  const { Fetcher, findLinks } = await import('./find-links.mjs');
  let port;
  const html = (title, body = '') => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
  const routes = {
    '/robots.txt': [200, 'text/plain', 'User-agent: *\nDisallow: /secret/\n'],
    '/ring.js': [200, 'text/plain', () => `const allSites = [{"name": "Ana Lee", "year": 2025, "website": "http://localhost:${port}/ana/"}];`],
    '/ana/': [200, 'text/html', html('Ana Lee', '<a href="notes/">My notes</a> <a href="cs341-notes.pdf">CS 341 notes (PDF)</a>')],
    '/ana/notes/': [200, 'text/html', html('Notes', '<a href="cs240.html">CS 240 notes</a> <a href="cs240-a2-solutions.html">CS 240 A2 solutions</a>')],
    '/ana/notes/cs240.html': [200, 'text/html', html('CS 240 notes | Ana', '<h1>CS 240</h1>')],
    '/ana/notes/cs240-a2-solutions.html': [200, 'text/html', html('CS 240 A2 solutions')],
    '/ana/cs341-notes.pdf': [200, 'application/pdf', '%PDF-1.4'],
    '/dir/': [200, 'text/html', html('People', '<a href="/dir/prof-x">Prof X</a> <span>Associate Professor</span> <a href="/dir/grad">Grad Y</a> <span>Graduate Student</span>')],
    '/dir/prof-x': [200, 'text/html', () => html('Prof X | People', `<h1>Prof X</h1><p>Link to personal webpage: <a href="http://127.0.0.1:${port}/~px/">site</a></p>`)],
    '/~px/': [200, 'text/html', html('Prof X', '<a href="teaching.html">Teaching</a>')],
    '/~px/teaching.html': [200, 'text/html', html('Teaching', '<a href="cs341f24/">CS 341, Fall 2024</a>')],
    '/~px/cs341f24/': [200, 'text/html', html('CS 341: Algorithms, Fall 2024')],
    '/~cs341/': [200, 'text/html', html('CS 341: Algorithms', '<h1>CS 341</h1>')],
    '/secret/cs240.html': [200, 'text/html', html('CS 240')],
    '/hub/': [200, 'text/html', html('Study notes', '<a href="math135.html">MATH 135</a> <a href="https://www.coursehero.com/cs240">CS 240</a>')],
    '/hub/math135.html': [200, 'text/html', html('MATH 135 notes')],
    '/list.md': [200, 'text/plain', () => `### CS 341 - Algorithms\n- http://localhost:${port}/vis/\n`],
    '/vis/': [200, 'text/html', html('Graph search visualizer')],
    '/wayback': [200, 'application/json', null],
  };
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(u.pathname);
    if (u.pathname === '/gh/search/repositories') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ items: u.searchParams.get('page') === '1' ? [
        { full_name: 'ana/cs341-notes', name: 'cs341-notes', html_url: 'https://github.com/ana/cs341-notes', description: 'My UWaterloo CS 341 notes', owner: { login: 'ana' } },
        { full_name: 'bob/cs341-a3', name: 'cs341-a3', html_url: 'https://github.com/bob/cs341-a3', description: 'UWaterloo CS 341 assignment 3', owner: { login: 'bob' } },
        { full_name: 'cal/cs341', name: 'cs341', html_url: 'https://github.com/cal/cs341', description: 'Algorithms notes (Stanford)', owner: { login: 'cal' } },
      ] : [] }));
    }
    if (u.pathname === '/wayback') {
      const gone = u.searchParams.get('url').endsWith('/gone/cs341-old.html');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ archived_snapshots: gone ? { closest: { available: true, status: '200', url: 'http://web.archive.org/web/20160301000000/x', timestamp: '20160301000000' } } : {} }));
    }
    const r = routes[u.pathname];
    if (!r) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('not found');
    }
    res.writeHead(r[0], { 'content-type': r[1] });
    res.end(typeof r[2] === 'function' ? r[2]() : r[2]);
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  const base = `http://localhost:${port}`;
  try {
    const known = new Set(['CS240', 'CS341', 'MATH135']);
    const fetcher = new Fetcher({ delay: 0, log: { warn() {} } });
    const { links, dropped } = await findLinks({
      known,
      fetcher,
      log: { warn() {} },
      wayback: `${base}/wayback`,
      github: { token: '', api: `${base}/gh` },
      sources: {
        github_search: ['uwaterloo notes'],
        lists: [{ name: 'A list', url: `${base}/list.md` }],
        webrings: [{ name: 'CS webring', list: `${base}/ring.js` }],
        directories: [{ name: 'Dept', url: `${base}/dir/` }],
        course_sites: [{ subjects: ['CS'], url: `${base}/~{code}/` }],
      },
      seeds: {
        reddit: {
          seeds: [
            { url: `${base}/gone/cs341-old.html`, kind: 'link', codes: ['CS341'], n: 2, first: 1456790400, thread: { post: 'abc' } },
            { url: `${base}/secret/cs240.html`, kind: 'link', codes: ['CS240'], n: 1, first: 1456790400, thread: { post: 'def' } },
            { url: `${base}/hub/`, kind: 'hub', codes: ['MATH135'], n: 3, first: 1456790400, thread: { post: 'ghi' } },
          ],
        },
      },
    });
    const by = Object.fromEntries(links.map((l) => [l.url.replace(base, '').replace(`http://127.0.0.1:${port}`, '@'), l]));
    assert.deepEqual(Object.keys(by).sort(), ['/~cs341/', '/ana/cs341-notes.pdf', '/ana/notes/cs240.html', '/gone/cs341-old.html', '/hub/math135.html', '/vis/', '@/~px/cs341f24/', 'https://github.com/ana/cs341-notes'].sort());
    assert.equal(by['https://github.com/ana/cs341-notes'].kind, 'notes');
    assert.equal(by['https://github.com/ana/cs341-notes'].via[0].name, 'ana');
    assert.equal(by['/~cs341/'].kind, 'site');
    assert.deepEqual(by['/ana/notes/cs240.html'].via[0], { type: 'webring', ring: 'CS webring', name: 'Ana Lee', url: `${base}/ana/` });
    assert.equal(by['/ana/notes/cs240.html'].title, 'CS 240 notes');
    assert.equal(by['/ana/cs341-notes.pdf'].kind, 'notes');
    assert.equal(by['@/~px/cs341f24/'].term, '1249');
    assert.equal(by['@/~px/cs341f24/'].via[0].type, 'faculty');
    assert.equal(by['@/~px/cs341f24/'].via[0].name, 'Prof X');
    assert.equal(by['/gone/cs341-old.html'].status, 'archived');
    assert.equal(by['/gone/cs341-old.html'].archived, 'https://web.archive.org/web/20160301000000/x');
    assert.equal(by['/hub/math135.html'].via[0].type, 'reddit');
    assert.equal(by['/vis/'].via[0].type, 'list');
    assert.ok(dropped['assignments or solutions'] >= 1);
    assert.ok(dropped['robots.txt'] >= 1);
    assert.ok(!hits.includes('/secret/cs240.html'), 'robots.txt was respected');
    assert.ok(!hits.includes('/dir/grad'), 'only teaching staff profiles are opened');
    // A second run reuses the cached pages, and keeps what it can't recheck.
    const before = hits.length;
    const again = await findLinks({ known, fetcher, log: { warn() {} }, wayback: `${base}/wayback`, previous: { links }, removed: [`${base}/vis/`], sources: { lists: [{ name: 'A list', url: `${base}/list.md` }] } });
    assert.ok(hits.length - before <= 2, `cached (${hits.length - before} new requests)`);
    assert.ok(!again.links.some((l) => l.url === `${base}/vis/`), 'removed on request');
    assert.ok(again.links.some((l) => l.url.endsWith('/ana/notes/cs240.html')), 'unchecked finds stay');
  } finally {
    server.close();
  }
});

test('links: found links render on course pages', async () => {
  const { resourcesSection } = await import('./lib/resources.mjs');
  const found = [
    { url: 'https://example.com/cs341/', codes: ['CS341'], kind: 'notes', title: 'CS 341 <notes>', term: '1201', via: [{ type: 'webring', ring: 'CS webring', name: 'Ana Lee', url: 'https://example.com/' }], status: 'ok' },
    { url: 'https://student.cs.uwaterloo.ca/~cs341/', codes: ['CS341'], kind: 'site', title: 'CS 341: Algorithms', via: [{ type: 'course' }], status: 'ok' },
    { url: 'http://old.ca/cs341.html', codes: ['CS341'], kind: 'other', title: 'old.ca/cs341.html', via: [{ type: 'reddit', post: 'abc', t: 1456790400 }], status: 'archived', archived: 'https://web.archive.org/web/2016/x', archived_on: '2016-03-01' },
  ];
  const sec = resourcesSection('CS341', [], { known: new Set(['CS341']), repo: 'me/repo', found });
  assert.match(sec, /Around the web/);
  assert.ok(sec.indexOf('CS 341: Algorithms') < sec.indexOf('CS 341 &lt;notes&gt;'), 'the course website first');
  assert.match(sec, /from <a href="https:\/\/example\.com\/">Ana Lee’s site<\/a>, CS webring/);
  assert.match(sec, /posted on <a href="https:\/\/www\.reddit\.com\/r\/uwaterloo\/comments\/abc\/">r\/uwaterloo<\/a> Mar 2016/);
  assert.match(sec, /<a class="found-title" href="https:\/\/web\.archive\.org\/web\/2016\/x">/);
  assert.match(sec, /gone now; <a href="https:\/\/web\.archive\.org\/web\/2016\/x">archived copy<\/a> from Mar 2016/);
  assert.equal(resourcesSection('CS341', [], { known: new Set(), repo: 'r', found: [] }), '');
});

test('links: data files are well-formed', async () => {
  const seeds = JSON.parse(readFileSync(new URL('../data/links/seeds/reddit.json', import.meta.url), 'utf8'));
  assert.ok(seeds.seeds.length > 100);
  for (const s of seeds.seeds.slice(0, 500)) assert.ok(/^https?:\/\//.test(s.url) && ['link', 'hub'].includes(s.kind) && s.codes.length, s.url);
  const sources = JSON.parse(readFileSync(new URL('../data/links/sources.json', import.meta.url), 'utf8'));
  assert.ok(sources.webrings.length && sources.directories.length && sources.course_sites.length);
  let found = null;
  try {
    found = JSON.parse(readFileSync(new URL('../data/links/found.json', import.meta.url), 'utf8'));
  } catch {}
  for (const l of found?.links ?? []) assert.ok(l.url && l.codes.length && l.title && l.via?.length && ['ok', 'archived'].includes(l.status), l.url);
});

// ---------- courses no longer offered ----------

test('history: catalog terms fold into one record per course', async () => {
  const { addTerm } = await import('./lib/history.mjs');
  const h = { done: {}, codes: {} };
  const row = (id, n, title, extra = {}) => ({ courseId: id, subjectCode: 'MSCI', catalogNumber: n, title, description: `${title} description`, requirementsDescription: 'Prereq: MSCI 211.', associatedAcademicCareer: 'UG', associatedAcademicGroupCode: 'ENG', ...extra });
  addTerm(h, '1161', [row('7', '452', 'Decision Making Under Uncertainty')], ['7']);
  addTerm(h, '1149', [row('7', '452', 'Decision Making')], []);
  addTerm(h, '1159', [row('7', '452', 'Decision Making Under Uncertainty')], ['7']);
  addTerm(h, '1151', [{ courseId: 'x', subjectCode: '', catalogNumber: '' }], []);
  const e = h.codes.MSCI452;
  assert.deepEqual([e.first, e.last, e.ran, e.title, e.detail], ['1149', '1161', ['1159', '1161'], 'Decision Making Under Uncertainty', '1161']);
  assert.equal(e.requirements, 'Prereq: MSCI 211.');
  assert.equal(Object.keys(h.codes).length, 1);
  // PD courses have one- or two-digit numbers; other subjects don't.
  addTerm(h, '1201', [row('8', '2', 'Critical Reflection', { subjectCode: 'PD' }), row('9', '1', 'Not a course', { subjectCode: 'COOP' })], ['8']);
  assert.deepEqual(Object.keys(h.codes).sort(), ['MSCI452', 'PD2']);
});

test('course codes: PD 1 to PD 99, and nothing else with short numbers', async () => {
  const { codesIn, linkCodes, isCode } = await import('./lib/requisites.mjs');
  assert.deepEqual(codesIn('Antireq: PD 11 or PD1; CS 135, PD 120'), ['PD11', 'PD1', 'CS135', 'PD120']);
  assert.deepEqual(codesIn('Grade 12 U Physics, STAT 2, XPD 11, PD 11A'), []);
  assert.equal(linkCodes('Take PD 1 first', { has: (c) => c === 'PD1' }), 'Take <a class="cc" href="/pd1/">PD 1</a> first');
  assert.ok(isCode('PD11') && isCode('CS136L') && !isCode('CS1') && !isCode('PD'));
  assert.equal(to('/PD1'), '/pd1/');
  assert.equal(to('/pd-11'), '/pd11/');
  assert.equal(to('/pd/20'), '/pd20/');
  assert.equal(to('/2627/pd/1'), '/2627/pd/#PD1');
  assert.equal(resolve('/cs1', meta).type, 'notfound');
});

test('history: fetched newest first, a few terms per build, until Open Data runs out', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { loadHistory } = await import('./lib/history.mjs');
  const dir = await mkdtemp(`${tmpdir()}/hist-`);
  const asked = [];
  // Open Data has 1199 (Fall 2019) on; nothing older. CS 134 ran every term; 1249's schedule read fails once.
  const fetch = async (t) => {
    asked.push(t);
    const glitch = t === '1249' && asked.filter((x) => x === t).length === 1;
    return Number(t) >= 1199 ? { rows: [{ courseId: '1', subjectCode: 'CS', catalogNumber: '134', title: 'Old CS' }], scheduled: glitch ? [] : ['1'] } : { rows: [], scheduled: [] };
  };
  const log = { log() {} };
  const path = `${dir}/h.json`;
  let h = await loadHistory('1269', { maxNew: 10, fetch, path, log });
  assert.deepEqual(asked, ['1265', '1261', '1259', '1255', '1251', '1249', '1245', '1241', '1239', '1235']);
  assert.equal(h.floor, null);
  assert.deepEqual(h.unscheduled, ['1249'], 'a catalog with no schedule is a failed read, kept to ask again');
  assert.ok(!h.codes.CS134.ran.includes('1249'));
  h = await loadHistory('1269', { maxNew: 10, fetch, path, log });
  assert.equal(asked.filter((x) => x === '1249').length, 2, 'asked again the next build');
  assert.ok(h.codes.CS134.ran.includes('1249'), 'and folded in once its schedule comes back');
  assert.deepEqual(h.unscheduled, []);
  for (let i = 0; i < 4; i++) h = await loadHistory('1269', { maxNew: 10, fetch, path, log });
  assert.equal(h.floor, '1199');
  assert.equal(h.codes.CS134.first, '1199');
  assert.equal(h.codes.CS134.ran.length, 21, 'every term from 1199 to 1265');
  const n = asked.length;
  await loadHistory('1269', { maxNew: 10, fetch, path, log });
  assert.equal(asked.length, n, 'nothing is asked for again once the floor is known');
  assert.ok(asked.length <= 31, `stopped soon after the records end (${asked.length} terms asked)`);
  // Next term, only the newly finished one is fetched.
  await loadHistory('1271', { maxNew: 10, fetch, path, log });
  assert.deepEqual(asked.slice(n), ['1269']);
  // Open Data trouble stops the run without marking anything.
  const flaky = await loadHistory('1275', { maxNew: 10, fetch: async () => null, path, log });
  assert.equal(flaky.done['1271'], undefined);
});

test('retired: a scanned-only course shows its text, version by version, with each year’s scan', async () => {
  const { archiveAppearances, retiredCourses, retiredPage, scanVersions, readSpec } = await import('./lib/retired.mjs');
  assert.deepEqual(readSpec('W 3C,1T 0.5'), { terms: ['Winter'], hours: '3 class, 1 tutorial', weight: '0.5' });
  assert.deepEqual(readSpec('F,S 3c 0.5'), { terms: ['Fall', 'Spring'], hours: '3 class', weight: '0.5' });
  assert.equal(readSpec('Y 1.0 fidlab'), null, 'anything unclear: not decoded');
  const energy = 'An analysis of the economics of conservation, especially the adequacy of the market mechanism as an allocator of resource use over time.';
  const v1 = `${energy} The political economy of the world’s supply of and demand for energy resources and major issues in Canadian energy policy will be considered.`;
  const v2 = `${energy} Issues concerning the economic behaviour of Canada’s fishery, forest, fuel and nonfuel mineral industries will be considered.`;
  const year = (y, start, c) => [y, { year: y, label: `${start}–${String(start + 1).slice(2)}`, start, pdf: `http://example.test/${y}.pdf`, subjects: [{ code: 'ECON', slug: 'econ', courses: [{ id: 'ECON355', page: start - 1600, ...c }] }] }];
  const docs = new Map([
    year('6364', 1963, { title: 'International Economics', paras: ['Balance of payments statistics; the economic basis of trade and investment; foreign exchange rates and commercial policy.'] }),
    year('6465', 1964, { title: 'International Economics', paras: ['Balance of payments statistics; the economic basis of trade and investment; foreign exchange rates and commercial policy.'] }),
    year('7475', 1974, { title: 'Economics of Energy and Natural Resources', spec: 'W 3C 0.5', paras: [v1, 'Prereq: ECON 201'] }),
    year('7576', 1975, { title: 'Economics of Energy and Natural Resources', spec: 'W 3C 0.5', paras: [v1.replace('world’s', 'worid’s').replace('policy', 'po1icy'), 'Prereq: ECON 201'] }),
    year('7677', 1976, { title: 'Mechanics of Deformable Solids', paras: ['A general treatment of stress and strain in structural components, Mohr circle, beams and columns.'] }),
    year('7778', 1977, { title: 'Economics of Energy and Natural Resources', spec: 'W 3C 0.5', paras: [v1, 'Prereq: ECON 201'] }),
    year('7879', 1978, { title: 'Economics of Energy and National Resources', listed: 'COURSES NOT OFFERED 1978-79', paras: [] }),
    year('8485', 1984, { title: 'Economics of Energy and Natural Resources', spec: 'W 3C 0.5', paras: [v2, 'Prereq: ECON 201'] }),
    year('8586', 1985, { title: 'Economics of Energy and Natural', spec: 'W 3C 0.5', paras: [`Resources : ${v2.replace('concerning', 'conceming')}`, 'Prereq: ECON 201'] }),
  ]);
  const arch = archiveAppearances(docs);
  const vs = scanVersions(arch.get('ECON355').years);
  assert.deepEqual(vs.map((v) => v.years.map((y) => y.year)), [['6364', '6465'], ['7475', '7576', '7677', '7778', '7879'], ['8485', '8586']], 'OCR noise, a misread year and a year without text don’t split a version; a rewrite does');
  assert.ok(!vs[1].desc.join(' ').includes('Mohr'), 'the misread year’s text isn’t the one shown');
  assert.deepEqual(vs[2].reqs, ['Prereq: ECON 201']);
  const retired = retiredCourses({ history: { codes: {} }, archive: arch, current: new Set(['ECON201']) });
  const known = { has: (c) => c === 'ECON201', href: (c) => `/${c.toLowerCase()}/`, retired };
  const page = retiredPage({ r: retired.get('ECON355'), known, mentions: new Map(), builtAt: new Date(), version: 'v' });
  assert.match(page, /scanned calendars from 1974–75 to 1985–86 \(before that, 1963–64 to 1964–65 used the number for International Economics\)/);
  assert.match(page, /<dt>Offered<\/dt><dd>Winter<\/dd>.*<dt>Credit<\/dt><dd>0\.5<\/dd>.*<dt>Last listed<\/dt><dd>1985–86<\/dd>/s);
  assert.match(page, /<p class="desc">An analysis of the economics of conservation.*fishery/);
  assert.match(page, /As printed in the 1984–85 to 1985–86 calendars, read by OCR; <a href="http:\/\/example\.test\/8485\.pdf#page=384">the scanned page<\/a>/);
  assert.match(page, /Prereq: <a class="cc" href="\/econ201\/">ECON 201<\/a>/);
  assert.match(page, /<a href="\/7879\/econ\/#ECON355" title="listed as not offered">1978–79<\/a>/);
  assert.match(page, /<a class="pdf" href="http:\/\/example\.test\/7475\.pdf#page=374"/);
  assert.match(page, /Another title:<\/b> International Economics, probably a different course/);
  const scans = page.slice(page.indexOf('id="scan-h"'));
  const order = ['1984–85 to 1985–86', '1974–75 to 1978–79', 'Not in the 1965–66 to 1973–74 calendars', '1963–64 to 1964–65'].map((t) => scans.indexOf(t));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `newest first, the gap between the versions it separates: ${order}`);
  assert.ok(!page.includes('outline.uwaterloo.ca') || page.includes('1995–96'), 'outline links only when it may have run past 1994–95');
  // No title read in any year: still a page.
  const bare = archiveAppearances(new Map([year('9394', 1993, { id: 'ECON356', title: '', paras: [] }), year('9495', 1994, { id: 'ECON356', title: '', paras: [] })].map(([y, d]) => [y, { ...d, subjects: [{ ...d.subjects[0], courses: [{ ...d.subjects[0].courses[0], id: 'ECON356' }] }] }])));
  const r2 = retiredCourses({ history: { codes: {} }, archive: bare, current: new Set() });
  assert.match(retiredPage({ r: r2.get('ECON356'), known, mentions: new Map(), builtAt: new Date(), version: 'v' }), /scanned calendars from 1993–94 to 1994–95/);
});

test('retired: pages for courses no calendar has, linked from today’s calendar', async () => {
  const { retiredCourses, mentionsOf, retiredPage, academicYearOf, archiveAppearances } = await import('./lib/retired.mjs');
  assert.equal(academicYearOf('1159'), 2015);
  assert.equal(academicYearOf('1161'), 2015);
  assert.equal(academicYearOf('1165'), 2015);
  const archive = archiveAppearances(new Map([
    ['9394', { year: '9394', label: '1993–94', start: 1993, subjects: [{ code: 'MSCI', slug: 'msci', courses: [{ id: 'MSCI452', title: 'Decision Making' }, { id: 'MSCI999', title: 'OCR noise' }] }] }],
    ['9495', { year: '9495', label: '1994–95', start: 1994, subjects: [{ code: 'MSCI', slug: 'msci', courses: [{ id: 'MSCI452', title: 'Decision Making' }, { id: 'MSCI261', title: 'Engineering Economics' }, { id: 'MSCI300', title: 'Gone' }] }] }],
    ['9293', { year: '9293', label: '1992–93', start: 1992, subjects: [{ code: 'MSCI', slug: 'msci', courses: [{ id: 'MSCI300', title: 'Gone' }] }] }],
  ]));
  const history = { floor: '1135', codes: { MSCI452: { first: '1135', last: '1161', ran: ['1149', '1159'], title: 'Decision Making Under Uncertainty', description: 'Topics in decision analysis. See MSCI 261.', requirements: 'Prereq: MSCI 211.', career: 'UG', group: 'ENG', detail: '1161' } } };
  const current = new Set(['MSCI261', 'MSCI446']);
  const retired = retiredCourses({ history, archive, current });
  assert.deepEqual([...retired.keys()].sort(), ['MSCI300', 'MSCI452'], 'one year in the scans alone (MSCI 999) isn’t enough');
  assert.ok(retired.get('MSCI452').arch, 'Open Data and scanned years together');
  const primary = new Map([['MSCI446', { course: { antireq: [{ type: 'text', text: 'MSCI 452' }], prereq: [], coreq: [], notesHtml: '', description: '' } }]]);
  const mentions = mentionsOf(primary, retired);
  assert.deepEqual([...mentions.get('MSCI452')], [['MSCI446', 'antirequisite']]);
  const known = { has: (c) => current.has(c) || retired.has(c), href: (c) => `/${c.toLowerCase()}/`, retired };
  const page = retiredPage({ r: retired.get('MSCI452'), known, mentions, floor: '1135', builtAt: new Date(), version: 'v' });
  assert.match(page, /No longer offered\. It was in Waterloo’s course catalog since at least Spring 2013 \(as far back as Open Data goes\) to Winter 2016 and last ran in Fall 2015\./);
  assert.match(page, /ucalendar\.uwaterloo\.ca\/1516\/COURSE\/course-MSCI\.html#MSCI452/);
  assert.match(page, /<a class="cc" href="\/msci446\/">MSCI 446<\/a> <span class="t">lists it as an antirequisite<\/span>/);
  assert.match(page, /<a class="cc" href="\/msci261\/">MSCI 261<\/a>/);
  assert.match(page, /<a href="\/9495\/msci\/#MSCI452">1994–95<\/a>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/uwloo\.ca\/msci452\/">/);
  const old = retiredPage({ r: retired.get('MSCI300'), known, mentions, builtAt: new Date(), version: 'v' });
  assert.match(old, /scanned calendars from 1992–93 to 1994–95/);
  // Today's pages link a retired antirequisite, marked.
  const { linkCodes } = await import('./lib/requisites.mjs');
  assert.equal(linkCodes('Antireq: MSCI 452', known), 'Antireq: <a class="cc gone" href="/msci452/" title="No longer offered">MSCI 452</a>');
});

test('found links: one folder of PDFs is one entry, under its course site when found', async () => {
  const { groupFound, tidyTitle, partTitle, resourcesSection } = await import('./lib/resources.mjs');
  const via = [{ type: 'faculty', name: 'Prof A', url: 'https://a.ca/' }];
  const link = (url, title, kind = 'notes', extra = {}) => ({ url, codes: ['CS466'], kind, title, via, status: 'ok', ...extra });
  const found = [
    link('https://a.ca/courses/cs466-f24/', 'CS 466 (Fall 2024)', 'site', { term: '1249' }),
    ...[1, 2, 10].map((n) => link(`https://a.ca/courses/cs466-f24/Lectures/lec${n}.pdf`, `[lec${n}]`)),
    ...[1, 2].map((n) => link(`https://b.me/assets/notes/CS466-${n}.pdf`, `Module ${n}`)),
    link('http://b.me/assets/notes/CS466-1.pdf', 'Module 1'),
    link('https://c.dev/notes/cs466.pdf', 'Algorithms Algorithms'),
  ];
  const g = groupFound(found);
  assert.equal(g.length, 3);
  const site = g.find((x) => x.lead);
  assert.equal(site.title, 'CS 466 (Fall 2024)');
  assert.deepEqual(site.items.map((x) => x.title), ['[lec1]', '[lec2]', '[lec10]'], 'in number order');
  assert.equal(site.noun, '3 PDFs');
  const set = g.find((x) => x.group && !x.lead);
  assert.equal(set.items.length, 2, 'http and https copies are one link');
  assert.equal(set.title, 'Course notes, 2 PDFs');
  assert.equal(tidyTitle('Logic and Computation Logic and Computation'), 'Logic and Computation');
  assert.equal(tidyTitle('[lec4]'), 'lec4');
  assert.equal(partTitle({ url: 'https://x.notion.site/CS-246-7a97ec0fce9245798ab12', title: 'Notion' }), 'CS 246 (Notion page)');
  assert.equal(partTitle({ url: 'https://x.ca/static/CS_246_CN.pdf', title: '**https://x.ca/static/CS\\_246\\_CN.pdf**' }), 'CS 246 CN');
  const html = resourcesSection('CS466', [], { known: new Set(['CS466']), repo: 'r', found });
  assert.equal((html.match(/<li class="found-set">/g) ?? []).length, 2);
  assert.match(html, /<a class="found-title" href="https:\/\/a\.ca\/courses\/cs466-f24\/">CS 466 \(Fall 2024\)<\/a>.*<summary>3 PDFs from this site<\/summary>/s);
  assert.match(html, /<li><a href="https:\/\/a\.ca\/courses\/cs466-f24\/Lectures\/lec1\.pdf">lec1<\/a><\/li>/);
  assert.match(html, /Remove%20link%20\(CS%20466\)&amp;body=Please%20stop%20listing%20this%20on%20uwloo\.ca%3A%0Ahttps%3A%2F%2Fa\.ca%2Fcourses%2Fcs466-f24%2F\*/);
  assert.match(html, />Algorithms<\/a>/);
});

// ---------------- older Graduate Calendars ----------------

const gaFixture = (f) => readFileSync(new URL(`./fixtures/grad-archive/${f}`, import.meta.url));

test('grad archive: course pages in list and table layouts', async () => {
  const { parseCoursePage, parseHeader, htmlLines, courseLinkText } = await import('./lib/gradarchive.mjs');
  const { decodeBody } = await import('./grad-archive.mjs');
  assert.deepEqual(parseHeader('CS 642 Principles of Programming Languages (0.50) LEC Course ID: 000599'), {
    subject: 'CS', number: '642', title: 'Principles of Programming Languages', units: 0.5, comp: 'LEC', id: '000599',
  });
  assert.equal(parseHeader('CO 739 Topics in Combinatorics (Advanced) (0.50) LEC Course ID: 000300').title, 'Topics in Combinatorics (Advanced)');
  assert.equal(parseHeader('ECE 602 Thesis (0.00) Course ID: 1234').units, 0);
  assert.equal(parseHeader('CS 798 Research Topics LEC,SEM Course ID: 011950').comp, 'LEC,SEM');
  assert.equal(parseHeader('Prereq: CS 241'), null);
  assert.deepEqual(htmlLines('<p>a <i>b c d e f</i></p><h3>X</h3><hr>').map((l) => [l.kind, l.text, l.italic]), [['text', 'a b c d e f', true], ['heading', 'X', false], ['rule', '', false]]);
  assert.deepEqual(courseLinkText('Combinatorics & Optimization (CO) Courses'), { dept: 'Combinatorics & Optimization', code: 'CO' });
  assert.deepEqual(parseCoursePage('<p><b>CO 601 A (0.50)</b> LEC Course ID: 000001</p><p>Text.</p><p><b>CO 700s</b></p><p>Stray.</p>').courses[0].d, ['Text.'], 'a section line that isn’t a heading still ends the entry');

  const co = parseCoursePage(decodeBody(new Uint8Array(gaFixture('GRDcourse-CO.html')), 'text/html'));
  assert.deepEqual(co.courses.map((c) => c.code), ['CO601', 'CO602', 'CO639', 'CO839']);
  assert.equal(co.ids, 4);
  assert.deepEqual(co.courses[1].x, ['(Cross-listed with CM 740)'], 'italic notes, wherever they sit');
  assert.deepEqual(co.courses[1].d, ['Linear, combinatorial and continuous optimization; duality and the simplex method.']);
  assert.deepEqual(co.courses[2].x, ['1 Quantum Error Correction', '3 Quantum Cryptography']);
  assert.deepEqual(co.courses[3], { code: 'CO839', subject: 'CO', number: '839', title: 'Seminar in Graph Theory', units: 0.5, comp: 'SEM', id: '000332', d: [], x: ['Department Consent Required'] });

  const cs = parseCoursePage(decodeBody(new Uint8Array(gaFixture('GRDcourse-CS.html')), 'text/html'));
  assert.deepEqual(cs.courses.map((c) => [c.code, c.units, c.comp, c.id]), [['CS642', 0.5, 'LEC,TUT', '000599'], ['CS798', null, 'LEC', '011950']]);
  assert.deepEqual(cs.courses[0].d, ['Survey of language design. [Note: Offered in Fall only.]', 'Second paragraph about CS 646.']);
  assert.deepEqual(cs.courses[0].x, ['Prereq: CS 241; Antireq: CS 442']);
  assert.match(cs.courses[1].d[0], /^Théorie des langages, with a note in italics/, 'Windows-1252, and a mostly plain line stays description');
  assert.equal(cs.courses[1].d.length, 1, 'a header it can’t read, and the footer, aren’t added to the last course');
  assert.deepEqual(cs.missed, ['CS 700 Readings, see the Course ID listing']);
});

test('grad archive: the crawler end to end, against a local copy', async () => {
  const http = await import('node:http');
  const { mkdtemp, readFile: rf, rm: rmr } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { main, Polite } = await import('./grad-archive.mjs');
  const { readStore, loadGradArchive, PARSER } = await import('./lib/gradarchive.mjs');
  const T = '/gsac-archive/2010/fall';
  const G = `${T}/gradcalendar.uwaterloo.ca`;
  const C = `${T}/www.ucalendar.uwaterloo.ca/SA/GRAD/1011`;
  const page = (body) => `<html><body>${body}</body></html>`;
  const routes = {
    '/robots.txt': [200, 'text/plain', 'User-agent: *\nDisallow: /aca/\nDisallow: /gsac-archive/2010/fall/gradcalendar.uwaterloo.ca/page/Secret.html\n'],
    [`${G}/group/Gen-Info-Regs.html`]: [200, 'text/html', page(`<a href="../page/Faculty-of-Mathematics.html">Math</a> <a href="../page/printable/1.html">Print</a> <a href="/gsac-archive/gradcalendar.uwaterloo.ca/page/Archived-Calendars.html">Archives</a> <a href="../page/Secret.html">x</a>`)],
    [`${G}/page/Faculty-of-Mathematics.html`]: [200, 'text/html', page(`<a href="../group/Combinatorics-Optimization.html">C&amp;O</a> <a href="../group/Computer-Science.html">CS</a> <a href="../page/CO-Programs.html">Programs</a>`)],
    [`${G}/group/Combinatorics-Optimization.html`]: [200, 'text/html', page(`<a href="${C}/GRDcourse-CO.html">Combinatorics &amp; Optimization (CO) Courses</a> <a href="${C}/GRDcourse-QIC.html">Combinatorics &amp; Optimization (QIC) Courses</a> <a href="/gsac-archive/2010/spring/www.ucalendar.uwaterloo.ca/SA/GRAD/0910/GRDcourse-PMATH.html">old</a>`)],
    [`${G}/group/Computer-Science.html`]: [200, 'text/html', page(`<a href="${C}/GRDcourse-CS.html">Computer Science (CS) Courses</a> <a href="../group/Combinatorics-Optimization.html">C&amp;O</a>`)],
    [`${C}/GRDcourse-CO.html`]: [200, 'text/html; charset=utf-8', gaFixture('GRDcourse-CO.html')],
    [`${C}/GRDcourse-CS.html`]: [200, 'text/html', gaFixture('GRDcourse-CS.html')],
  };
  const hits = [];
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits.push(path);
    const r = routes[path];
    res.writeHead(r ? r[0] : 404, { 'content-type': r ? r[1] : 'text/html' });
    res.end(r ? r[2] : 'nope');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(`${tmpdir()}/ga-`);
  const quiet = { log() {}, warn() {} };
  const urls = { gsac: `${base}/gsac-archive`, aca: `${base}/aca` };
  const odRows = [
    { associatedAcademicCareer: 'GRD', subjectCode: 'CS', catalogNumber: '646', title: 'Software  Design', description: 'Design. See CS 642.', requirementsDescription: 'Prereq: CS 445', courseId: '13085' },
    { associatedAcademicCareer: 'UG', subjectCode: 'CS', catalogNumber: '135', title: 'Undergrad' },
  ];
  try {
    const opts = { dir: `${dir}/data`, urls, log: quiet, od: async (term) => (term === '1201' ? odRows : null), polite: new Polite({ delay: 0, cacheDir: `${dir}/cache`, log: quiet }) };
    const run = await main(['--terms', '1109,1179,1201', '--minutes', '5'], opts);
    assert.equal(run.left, 0);
    assert.ok(!hits.some((h) => h.startsWith('/aca/')), 'robots.txt keeps it out of /aca/');
    assert.ok(!hits.includes(`${G}/page/Secret.html`), 'robots.txt rules for single pages too');
    assert.ok(!hits.some((h) => /printable|Archived-Calendars|spring|CO-Programs/.test(h)), 'only this term’s faculty and department pages');
    const store = await readStore(`${dir}/data`);
    assert.deepEqual(Object.keys(store.terms).sort(), ['1109', '1201']);
    const t = store.terms['1109'];
    assert.equal(t.source, 'calendar');
    assert.equal(t.parser, PARSER);
    assert.deepEqual(t.subjects.map((x) => [x.code, x.dept, x.courses.length]), [['CO', null, 4], ['CS', 'Computer Science', 2]], 'QIC’s page is missing; a department with two subjects doesn’t name either');
    assert.equal(store.terms['1201'].source, 'opendata');
    const report = JSON.parse(await rf(`${dir}/data/report.json`, 'utf8'));
    assert.equal(report.aca.robots, 'robots');
    assert.equal(report.terms['1109'].missed.length, 1);
    assert.ok((await rf(`${dir}/data/samples/1109-GRDcourse-CS.html`, 'utf8')).includes('CS 642'));
    const entries = (await rf(`${dir}/data/entries.json`, 'utf8')).split('\n');
    assert.ok(entries[1].startsWith('"CO601~'), 'one entry per line, in code order');

    // Again: nothing to do, nothing fetched.
    const before = hits.length;
    const again = await main(['--terms', '1109,1179,1201', '--minutes', '5'], { ...opts, polite: new Polite({ delay: 0, cacheDir: `${dir}/cache`, log: quiet }) });
    assert.equal(again.changed, 0);
    assert.equal(hits.length, before, 'done terms are skipped, and the aca check waits a month');

    // The same course text in two terms is stored once.
    const { saveTerm } = await import('./lib/gradarchive.mjs');
    const s2 = await readStore(`${dir}/data`);
    const co = s2.terms['1109'].subjects[0].courses;
    await saveTerm(s2, { term: '1111', label: 'Winter 2011', source: 'calendar', from: 'x', parser: PARSER }, [{ code: 'CO', dept: null, url: 'u', courses: [{ code: 'CO601', title: 'Fundamentals of Enumerative Combinatorics', units: 0.5, comp: 'LEC', id: '012175', d: ['Counting, generating series, integer partitions & linear recurrences. See also CO 630.'], x: [] }] }], `${dir}/data`);
    assert.equal((await readStore(`${dir}/data`)).terms['1111'].subjects[0].courses[0], co[0]);

    const cats = await loadGradArchive({ dir: `${dir}/data`, names: (x) => ({ CO: 'Combinatorics and Optimization' })[x] ?? null });
    assert.deepEqual(cats.map((c) => [c.term, c.source, c.courses.size]), [['1109', 'calendar', 6], ['1111', 'calendar', 1], ['1201', 'opendata', 1]]);
    assert.equal(cats[0].names.get('CO'), 'Combinatorics and Optimization');
    assert.equal(cats[0].names.get('CS'), 'Computer Science', 'the department’s name when today’s calendars don’t have one');
    assert.equal(cats[2].courses.get('CS646').title, 'Software Design');
  } finally {
    server.close();
    await rmr(dir, { recursive: true, force: true });
  }
});

test('grad archive: term pages, the older-terms grid, versions and retired courses', async () => {
  const { mkdtemp, rm: rmr } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { saveTerm, readStore, loadGradArchive, gradAppearances, oldTermSubjectPage, oldTermIndexPage, oldTerms, PARSER } = await import('./lib/gradarchive.mjs');
  const { termNav } = await import('./lib/render.mjs');
  const { retiredCourses, retiredPage } = await import('./lib/retired.mjs');
  const dir = await mkdtemp(`${tmpdir()}/ga-`);
  try {
    const store = await readStore(dir);
    const c = (code, title, d, x = []) => ({ code, title, units: 0.5, comp: 'LEC', id: '000001', d, x });
    const url = 'https://uwaterloo.ca/gsac-archive/2015/fall/www.ucalendar.uwaterloo.ca/SA/GRAD/1516/GRDcourse-CS.html';
    await saveTerm(store, { term: '1159', label: 'Fall 2015', source: 'calendar', from: 'https://uwaterloo.ca/gsac-archive/2015/fall/gradcalendar.uwaterloo.ca/group/Gen-Info-Regs.html', parser: PARSER }, [
      { code: 'CS', dept: null, url, courses: [c('CS642', 'Principles of Programming Languages', ['Uses CS 646 ideas.'], ['Prereq: CS 641', '1 Types']), c('CS641', 'Old Course', ['Gone now.'], ['Antireq: CS 642'])] },
    ], dir);
    await saveTerm(store, { term: '1169', label: 'Fall 2016', source: 'calendar', from: 'f', parser: PARSER }, [
      { code: 'CS', dept: null, url, courses: [c('CS642', 'Principles of Programming Languages', ['Uses CS 646 ideas.'], ['Prereq: CS 640']), c('CS641', 'Old Course', ['Gone now.'], ['Antireq: CS 642'])] },
    ], dir);
    const cats = await loadGradArchive({ dir, names: () => 'Computer Science' });
    const current = new Set(['CS642', 'CS646']);
    const ga = gradAppearances(cats);
    const retired = retiredCourses({ history: { codes: {} }, archive: new Map(), current, grad: ga });
    assert.deepEqual([...retired.keys()], ['CS641']);
    const linkable = { has: (x) => current.has(x) || retired.has(x), href: (x) => (current.has(x) || retired.has(x) ? `/${x.toLowerCase()}/` : null), retired };

    const grad = [{ term: '1245', label: 'Spring 2024', subjects: new Set(['CS']), status: 'past' }, { term: '1249', label: 'Fall 2024', subjects: new Set(['CS']), status: 'current' }];
    const have = new Set(cats.map((k) => k.term));
    const nav = [...cats, ...oldTerms().filter((t) => !have.has(t.term)).map((t) => ({ term: t.term, label: t.label, kind: 'link', href: t.official })), ...grad].sort((a, b) => a.term - b.term);
    const html = oldTermSubjectPage({ cat: cats[0], nav: termNav(nav, cats[0], 'CS'), subject: 'CS', courses: cats[0].bySubject.get('CS'), linkable, builtAt: new Date(), version: 'v' });
    assert.match(html, /<h1>Computer Science \(CS\)<\/h1>/);
    assert.match(html, /<section class="entry" id="CS642">/);
    assert.match(html, /<a class="cc" href="\/cs642\/">CS 642<\/a> <span>Principles of Programming Languages<\/span><span class="u">0\.50 units<\/span>/);
    assert.match(html, /<p><i>Prereq: <a class="cc" href="\/1159\/cs\/#CS641">CS 641<\/a><\/i><\/p>/, 'codes in the same term link within it, unmarked');
    assert.match(html, /Uses <a class="cc" href="\/cs646\/">CS 646<\/a> ideas/, 'others link to their page today');
    assert.match(html, /<ul class="topics"><li>1 Types<\/li><\/ul>/);
    assert.match(html, /<a href="https:\/\/uwaterloo\.ca\/gsac-archive\/2015\/fall\/www\.ucalendar[^"]+GRDcourse-CS\.html">Archived page<\/a>/);
    assert.match(html, /<details class="older"><summary>Older calendars, Fall 2006 to Winter 2024<\/summary>/);
    assert.match(html, /<p class="tstep"><a href="\/1169\/cs\/" rel="next">Fall 2016 →<\/a><\/p>/, 'step to the next term uwloo has');
    assert.match(html, /2 graduate courses in the Fall 2015 Graduate Calendar, from <a href="https:\/\/uwaterloo\.ca\/gsac-archive\/2015\/fall\/gradcalendar[^"]+">Waterloo’s archived copy<\/a>\./);
    assert.match(html, /<tr><th scope="row">2015–16<\/th><td><a href="\/1159\/cs\/" aria-current="page">Fall<\/a><\/td><td><a class="ext" href="https:\/\/academic-calendar-archive\.uwaterloo\.ca\/graduate-studies\/2016\/winter\/[^"]+" title="Winter 2016, in Waterloo’s archive">Winter<\/a><\/td>/);
    assert.match(html, /<tr><th scope="row">2023–24<\/th><td><a class="ext"[^>]*>Fall<\/a><\/td><td><a class="ext"[^>]*>Winter<\/a><\/td><td><a href="\/1245\/cs\/">Spring<\/a><\/td><\/tr>/, 'Spring 2024 is Kuali, in the same row');
    assert.match(html, /<link rel="canonical" href="https:\/\/uwloo\.ca\/1159\/cs\/">/);
    const idx = oldTermIndexPage({ cat: cats[0], nav: termNav(nav, cats[0]), builtAt: new Date(), version: 'v' });
    assert.match(idx, /2 graduate courses in 1 subject/);
    assert.match(idx, /<a class="cc" href="\/1159\/cs\/">CS<\/a>/);
    // Kuali pages: the pills, then the grid, closed.
    const kn = termNav(nav, grad[1], 'CS');
    assert.match(kn, /<li><a href="\/1249\/cs\/" aria-current="page">Fall 2024<\/a><\/li><\/ul><details class="older"><summary>/);
    assert.ok(!/Winter 2024 and earlier/.test(kn));

    // Retired: only in older Graduate Calendars.
    const page = retiredPage({ r: retired.get('CS641'), known: linkable, mentions: new Map(), oldHave: have, builtAt: new Date(), version: 'v' });
    assert.match(page, /It’s in the archived Graduate Calendars from Fall 2015 to Fall 2016\. The calendars after Fall 2016 aren’t on uwloo, so it may have been listed a little longer\./);
    assert.match(page, /<p class="desc">Gone now\.<\/p>/);
    assert.match(page, /Notes, as last listed<\/h2><div class="notes"><p><i>Antireq: <a class="cc" href="\/cs642\/">CS 642<\/a><\/i><\/p>/);
    assert.match(page, /<a href="\/1169\/cs\/#CS641">Fall 2016<\/a>/);
    assert.match(page, /<dt>Last listed<\/dt><dd>Fall 2016<\/dd>/);
    assert.match(page, /<dt>Level<\/dt><dd>Graduate<\/dd>/);

    // Course pages: "Older Graduate Calendars", with the requisites change marked.
    const { coursePage } = await import('./lib/render.mjs');
    const hist = (k) => ({ cat: k, href: `/${k.term}/cs/#CS642` });
    const course = { code: 'CS642', subject: 'CS', number: '642', subjectName: 'Computer Science', title: 'Principles of Programming Languages', units: 0.5, crossListed: [], prereq: null, antireq: null, coreq: null, description: '', notesHtml: '' };
    const cp = coursePage({ course, cat: { level: 'grad', label: 'Fall 2024', status: 'current', pageUrl: 'https://x/' }, known: linkable, leadsTo: [], history: { ug: [], grad: [], old: [hist(cats[0]), { ...hist(cats[1]), changed: cats[0].courses.get('CS642').signature !== cats[1].courses.get('CS642').signature }] }, strip: null, hint: null, sectionsByTerm: [], curTerm: '1269', subjectHref: '/1249/cs/', builtAt: new Date(), version: 'v' });
    assert.doesNotMatch(cp, /deg-tie/, 'graduate courses aren’t planned in Pathways');
    const ug = coursePage({ course: { ...course, code: 'CS135', number: '135', title: 'Designing Functional Programs' }, cat: { level: 'ug', label: '2026–27', status: 'current', pageUrl: 'https://x/' }, known: linkable, leadsTo: [], history: { ug: [], grad: [], old: [] }, strip: null, hint: null, sectionsByTerm: [], curTerm: '1269', subjectHref: '/2627/cs/', builtAt: new Date(), version: 'v' });
    assert.match(ug, /<p class="deg-tie" data-code="CS135"><a href="\/pathways\/#course=CS135">Plan your degree with CS 135<\/a>/, 'a current course opens on Pathways’ card');
    const past = coursePage({ course: { ...course, code: 'CS135', number: '135' }, cat: { level: 'ug', label: '2023–24', status: 'past', pageUrl: 'https://x/' }, known: linkable, leadsTo: [], history: { ug: [], grad: [], old: [] }, strip: null, hint: null, sectionsByTerm: [], curTerm: '1269', subjectHref: '/2324/cs/', builtAt: new Date(), version: 'v' });
    assert.doesNotMatch(past, /deg-tie/, 'not for a course no longer in the calendar');
    assert.match(cp, /<h3 class="ver-h">Older Graduate Calendars<\/h3><details class="ver-old" open><summary>In 2 terms, Fall 2015 to Fall 2016<\/summary><ul class="versions"><li><a href="\/1159\/cs\/#CS642">Fall 2015<\/a><\/li><li><a href="\/1169\/cs\/#CS642">Fall 2016<\/a> <span class="changed">requisites changed<\/span><\/li>/);
  } finally {
    await rmr(dir, { recursive: true, force: true });
  }
});

test('grad archive: data files are well-formed', async () => {
  const { readStore, oldTerms } = await import('./lib/gradarchive.mjs');
  const { entries, terms } = await readStore();
  const valid = new Set(oldTerms().map((t) => t.term));
  for (const [term, t] of Object.entries(terms)) {
    assert.ok(valid.has(term), `${term}: not a term from Fall 2006 to Winter 2024`);
    assert.ok(['calendar', 'opendata'].includes(t.source), `${term}: source`);
    for (const s of t.subjects) {
      assert.match(s.code, /^[A-Z]{2,8}$/);
      for (const k of s.courses) assert.ok(entries[k], `${term} ${s.code}: ${k} missing from entries.json`);
    }
  }
  for (const [k, e] of Object.entries(entries)) {
    assert.match(k, /^[A-Z]{2,8}\d{3}[A-Z]{0,2}~[0-9a-f]{8}$/);
    assert.ok(Array.isArray(e.d) && Array.isArray(e.x), k);
  }
});

test('year pages: links to other years skip subjects those years don’t have; 2023–24 and earlier is ucalendar’s subject page', async () => {
  const { yearSubjectPage } = await import('./lib/render.mjs');
  const y = (start, subs) => ({ start, yearCode: `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`, label: `${start}–${String((start + 1) % 100).padStart(2, '0')}`, level: 'ug', status: 'past', pageUrl: 'https://x/', pageSubjects: new Set(subs) });
  const cats = [y(2024, ['CS']), y(2025, ['CS', 'PD'])];
  const c = { code: 'PD11', subject: 'PD', number: '11', title: 'Report Writing', units: 0.5, crossListed: [], prereq: null, coreq: null, antireq: null, description: '', notesHtml: '', pid: 'p' };
  const html = yearSubjectPage({ cat: cats[1], catalogs: cats, gradCat: null, gradCatalogs: [], subject: 'PD', subjectName: 'Professional Development', ugCourses: [c], gradCourses: [], known: new Set(['PD11']), builtAt: new Date(), version: 'v' });
  assert.match(html, /<li><a href="\/2425\/" class="no" title="No PD courses in 2024–25">2024–25<\/a><\/li><li><a href="\/2526\/pd\/" aria-current="page">2025–26<\/a><\/li>/);
  assert.match(html, /<a href="https:\/\/ucalendar\.uwaterloo\.ca\/2324\/COURSE\/course-PD\.html">2023–24 and earlier<\/a>/);
  const { yearPage } = await import('./lib/render.mjs');
  assert.match(yearPage({ cat: cats[1], catalogs: cats, gradCat: null, subjects: [], builtAt: new Date(), version: 'v' }), /<a href="https:\/\/academic-calendar-archive\.uwaterloo\.ca\/undergraduate-studies\/2023-2024\/page\/uWaterloo-Undergraduate-Calendar-Access\.html">2023–24 and earlier<\/a>/, 'no subject: the year’s front page, which ucalendar no longer has');
});

// ---------------- older undergraduate years ----------------

test('ug archive: ucalendar’s course pages', async () => {
  const { parseCoursePage } = await import('./lib/gradarchive.mjs');
  const r = parseCoursePage(readFileSync(new URL('./fixtures/ug-archive/course-CS.html', import.meta.url), 'utf8'));
  assert.deepEqual(r.courses.map((c) => [c.code, c.title, c.units, c.comp, c.id]), [
    ['CS135', 'Designing Functional Programs', 0.5, 'LAB,LEC,TST,TUT', '004380'],
    ['CS136L', 'Tools and Techniques for Software Development', 0.25, 'LAB', '017090'],
    ['CS241', 'Foundations of Sequential Programs', 0.5, 'LEC,TUT', '004397'],
  ]);
  assert.deepEqual(r.courses[0].x, ['Prereq: Not open to General Mathematics students.', 'Antireq: CS 115, 121, 122, 137, 145']);
  assert.match(r.courses[0].d[0], /\[Note: Offered: F,W,S\]$/);
  assert.deepEqual(r.courses[2].d, ['The relationship between high-level languages and the computer architecture.'], 'the subject’s notes (#CS999) aren’t the last course’s');
  assert.equal(r.ids, 3);
});

test('ug archive: reads the years ucalendar allows, Open Data before, pages and links', async () => {
  const http = await import('node:http');
  const { mkdtemp, rm: rmr } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { main, Polite } = await import('./grad-archive.mjs');
  const { readStore } = await import('./lib/gradarchive.mjs');
  const { loadUgArchive, ugOldSubjectPage, oldYears } = await import('./lib/ugarchive.mjs');
  const { yearNav } = await import('./lib/render.mjs');
  const page = readFileSync(new URL('./fixtures/ug-archive/course-CS.html', import.meta.url));
  const routes = {
    '/robots.txt': 'User-agent: *\nDisallow: /ucal/2122/\n',
    '/aca/undergraduate-studies/2023-2024/page/Course-Descriptions-Index.html': () =>
      `<a href="${base}/ucal/2324/COURSE/course-CS.html#CS100S">CS</a> <a href="${base}/ucal/2324/COURSE/course-CS.html#CS999">notes</a> <a href="${base}/ucal/1920/COURSE/course-MATH.html">old</a>`,
    '/ucal/2324/COURSE/course-CS.html': page,
  };
  const hits = [];
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    hits.push(p);
    const r = routes[p];
    res.writeHead(r ? 200 : 404, { 'content-type': p.endsWith('.txt') ? 'text/plain' : 'text/html' });
    res.end(r ? (typeof r === 'function' ? r() : r) : 'nope');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(`${tmpdir()}/ug-`);
  const quiet = { log() {}, warn() {} };
  const rows = (term) => [
    { associatedAcademicCareer: 'UG', subjectCode: 'CS', catalogNumber: '135', title: term === '1225' ? 'Designing Functional Programs' : 'Old title', description: 'Functional programming.', courseId: '4380' },
    { associatedAcademicCareer: 'UG', subjectCode: 'PD', catalogNumber: '11', title: 'Report Writing', courseId: '1' },
    { associatedAcademicCareer: 'GRD', subjectCode: 'CS', catalogNumber: '646', title: 'Grad' },
  ];
  try {
    const opts = { dir: `${dir}/grad`, ugDir: `${dir}/ug`, ugUrls: { ucal: `${base}/ucal`, aca: `${base}/aca/undergraduate-studies` }, log: quiet, od: async (t) => rows(t), polite: new Polite({ delay: 0, cacheDir: `${dir}/cache`, log: quiet }) };
    await main(['--terms', '2324,2223,2122', '--minutes', '5'], opts);
    assert.ok(!hits.some((h) => h.startsWith('/ucal/1920/')), 'only the year’s own course pages');
    const store = await readStore(`${dir}/ug`);
    assert.deepEqual(Object.keys(store.terms).sort(), ['2122', '2324'], '2022–23’s index isn’t there; 2021–22 from Open Data');
    assert.deepEqual(store.terms['2324'].subjects.map((x) => [x.code, x.courses.length]), [['CS', 3]]);
    assert.deepEqual(store.terms['2122'].subjects.map((x) => [x.code, x.courses.length]), [['CS', 1], ['PD', 1]], 'undergrad rows only, PD 11 included');
    const cats = await loadUgArchive({ dir: `${dir}/ug`, names: (x) => ({ CS: 'Computer Science' })[x] ?? null });
    assert.equal(cats[0].courses.get('CS135').title, 'Designing Functional Programs', 'the year’s newest wording');
    const y = cats.find((c) => c.yearCode === '2324');
    const kuali = [{ start: 2024, yearCode: '2425', label: '2024–25', pageSubjects: new Set(['CS']) }];
    const nav = yearNav([...cats, ...kuali], y, 'CS');
    assert.match(nav, /<a href="https:\/\/ucalendar\.uwaterloo\.ca\/2021\/COURSE\/course-CS\.html">2020–21 and earlier<\/a>/, 'before the first year uwloo has, ucalendar');
    assert.match(nav, /<a href="\/2122\/" class="no" title="No CS courses in 2021–22">|<a href="\/2122\/cs\/">2021–22/);
    const linkable = { has: (c) => c === 'CS135' || c === 'CS136', href: (c) => `/${c.toLowerCase()}/`, retired: new Set() };
    const html = ugOldSubjectPage({ cat: y, nav, subject: 'CS', courses: y.bySubject.get('CS'), linkable, builtAt: new Date(), version: 'v' });
    assert.match(html, /<h1>Computer Science \(CS\)<\/h1>\s*<p>3 courses in the 2023–24 Undergraduate Calendar\. Original: <a href="https:\/\/ucalendar\.uwaterloo\.ca\/2324\/COURSE\/course-CS\.html">ucalendar\.uwaterloo\.ca\/2324\/COURSE\/course-CS\.html<\/a><\/p>/);
    assert.match(html, /<section class="entry" id="CS135">/);
    assert.match(html, /<a href="https:\/\/ucalendar\.uwaterloo\.ca\/2324\/COURSE\/course-CS\.html#CS135">On ucalendar<\/a><a href="\/cs135\/">CS 135 today<\/a>/);
    assert.match(html, /Coreq: <a class="cc" href="\/cs136\/">CS 136<\/a>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/uwloo\.ca\/2324\/cs\/">/);
    const od = ugOldSubjectPage({ cat: cats[0], nav: '', subject: 'PD', courses: cats[0].bySubject.get('PD'), linkable, builtAt: new Date(), version: 'v' });
    assert.match(od, /1 course in Waterloo’s course catalog for 2021–22 \(Fall 2021, Winter 2022, Spring 2022\), from <a href="https:\/\/openapi\.data\.uwaterloo\.ca\/api-docs">UW Open Data<\/a>\. ucalendar asks programs not to read that year’s calendar, so this stands in for it\. Original: <a href="https:\/\/ucalendar\.uwaterloo\.ca\/2122\/COURSE\/course-PD\.html">/);
    // The router: a year uwloo hosts is a page; anything older is ucalendar.
    const m = { ...meta, years: ['2021', '2122', '2324', ...meta.years] };
    assert.equal(resolve('/2324/CS', m).to, '/2324/cs/');
    assert.equal(resolve('/2324/cs135', m).to, '/2324/cs/#CS135');
    assert.equal(resolve('/1920/cs135', m).to, 'https://ucalendar.uwaterloo.ca/1920/COURSE/course-CS.html#CS135');
    assert.deepEqual(oldYears().map((x) => [x.yearCode, x.kind]), [['2021', 'opendata'], ['2122', 'opendata'], ['2223', 'ucal'], ['2324', 'ucal']]);
  } finally {
    server.close();
    await rmr(dir, { recursive: true, force: true });
  }
});

test('ug archive: data files are well-formed', async () => {
  const { readStore } = await import('./lib/gradarchive.mjs');
  const { oldYears, UG_DIR } = await import('./lib/ugarchive.mjs');
  const { entries, terms } = await readStore(UG_DIR);
  const valid = new Set(oldYears().map((y) => y.yearCode));
  for (const [year, t] of Object.entries(terms)) {
    assert.ok(valid.has(year), `${year}: not a year uwloo hosts`);
    assert.ok(['calendar', 'opendata'].includes(t.source), `${year}: source`);
    for (const s of t.subjects) for (const k of s.courses) assert.ok(entries[k], `${year} ${s.code}: ${k} missing from entries.json`);
  }
});

test('reddit: the section folds from its heading', async () => {
  const { redditSection } = await import('./lib/reddit.mjs');
  const html = redditSection('CS135', [{ post: 'abc', t: 1.73e9, title: 'CS 135 help', score: 3, n: 2, in: 'post' }], { through: 1.74e9 }, { repo: 'u/r', slug: 'cs135' });
  assert.match(html, /^<section class="reddit" aria-labelledby="reddit-h"><details class="rd-fold" data-fold="reddit" open>\s*<summary><h2 id="reddit-h">Discussed on r\/uwaterloo<\/h2><\/summary>/);
  assert.match(html, /<\/details><\/section>$/);
});

test('not found: a code that doesn’t exist suggests its nearest neighbours, same hundred first', async () => {
  const { nearby } = await import('../site/route.js');
  const rows = ['CS100', 'CS135', 'CS341', 'CS418', 'CS431', 'CS432', 'CS440', 'CS480', 'CS486', 'CS499T', 'CS519', 'MATH421'].map((c) => [c, '']);
  rows.push(['CS420', 'Old', 1]);
  rows.push(['CS422', 'Current', 0]);
  assert.deepEqual(nearby('cs421', rows, 6).map((r) => r[0]), ['CS422', 'CS418', 'CS431', 'CS432', 'CS440', 'CS480'], 'still offered first');
  assert.equal(nearby('cs421', rows, 20).at(-1)[0], 'CS420', 'no longer offered: after every current one');
  assert.deepEqual(nearby('CS 199', rows, 3).map((r) => r[0]), ['CS135', 'CS100', 'CS341']);
  assert.deepEqual(nearby('cs-9', rows, 2).map((r) => r[0]), ['CS100', 'CS135']);
  assert.deepEqual(nearby('database', rows), []);
  assert.deepEqual(nearby('xyz421', rows), []);
});

// ---------------- UW Flow ----------------

test('uwflow: ratings and comments from the GraphQL API, paged, cached a week, removals honoured', async () => {
  const http = await import('node:http');
  const { mkdtemp, writeFile: wf, rm: rmr } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const courses = Array.from({ length: 1001 }, (_, i) => ({ code: i === 0 ? 'cs135' : `zz${100 + (i % 800)}`, rating: i === 0 ? { liked: 0.781, easy: 0.452, useful: 0.8, filled_count: 1234, comment_count: 456 } : { liked: null, easy: null, useful: null, filled_count: 0, comment_count: 0 } }));
  const reviews = [
    { id: 1, created_at: '2019-01-05T10:00:00Z', liked: 1, course_easy: 0.5, course_useful: 1, course_comment: 'Old but helpful.', course: { code: 'cs135' }, course_review_rating: { upvote_count: 30 } },
    { id: 2, created_at: '2025-03-02T10:00:00Z', liked: 0, course_easy: 0.25, course_useful: 0.5, course_comment: 'Racket   is\r\n\r\n\r\nfine', course: { code: 'cs135' }, course_review_rating: { upvote_count: 2 } },
    { id: 3, created_at: '2025-04-02T10:00:00Z', liked: 1, course_easy: 1, course_useful: 1, course_comment: 'Take it.', course: { code: 'cs135' }, course_review_rating: null },
    { id: 4, created_at: '2025-04-02T10:00:00Z', liked: 1, course_easy: 1, course_useful: 1, course_comment: 'Not rated course.', course: { code: 'zz999' }, course_review_rating: null },
  ];
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const ch of req) body += ch;
    const { query, variables } = JSON.parse(body);
    calls.push([query.includes('review(') ? 'review' : 'course', variables.offset]);
    const all = query.includes('review(') ? reviews : courses;
    const key = query.includes('review(') ? 'review' : 'course';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { [key]: all.slice(variables.offset, variables.offset + variables.limit) } }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  process.env.UWFLOW_GRAPHQL = `http://127.0.0.1:${server.address().port}/graphql`;
  const dir = await mkdtemp(`${tmpdir()}/flow-`);
  const quiet = { log() {}, warn() {} };
  try {
    const { loadFlow, flowSection, shape } = await import(`./lib/uwflow.mjs?${Date.now()}`);
    const path = `${dir}/flow.json`;
    await wf(`${dir}/removed.txt`, '# taken down\n3\n');
    const now = Date.parse('2026-11-09T12:00:00Z');
    const f = await loadFlow({ path, now, pause: 0, log: quiet, removedPath: `${dir}/removed.txt`, enabled: true });
    assert.deepEqual(calls, [['course', 0], ['course', 1000], ['review', 0]], 'two pages of courses, one of comments');
    assert.deepEqual(Object.keys(f.courses), ['CS135'], 'only courses someone rated');
    const c = f.courses.CS135;
    assert.equal(c.ratings, 1234);
    assert.deepEqual(c.top.map((t) => t.id), [1, 2], 'most helpful first; a removed comment is dropped');
    assert.equal(c.top[1].text, 'Racket is\n\nfine');
    // A week later than the copy: fetched again. Within the week: not.
    calls.length = 0;
    await loadFlow({ path, now: now + 3 * 86_400_000, pause: 0, log: quiet, enabled: true });
    assert.equal(calls.length, 0, 'cached for a week');
    server.close();
    const stale = await loadFlow({ path, now: now + 9 * 86_400_000, pause: 0, log: quiet, enabled: true });
    assert.equal(stale.courses.CS135.ratings, 1234, 'UW Flow down: the last copy is used');
    assert.equal(await loadFlow({ path: `${dir}/none.json`, now, pause: 0, log: quiet, enabled: true }), null, 'no copy and no UW Flow: nothing');

    const html = flowSection('CS135', c, { repo: 'u/r' });
    assert.match(html, /^<section class="uwflow" aria-labelledby="flow-h"><details class="rd-fold" data-fold="uwflow" open>\s*<summary><h2 id="flow-h">Reviewed on UW Flow<\/h2><\/summary>/);
    assert.match(html, /<span><b>78%<\/b> liked it<\/span><span><b>45%<\/b> easy<\/span><span><b>80%<\/b> useful<\/span>/);
    assert.match(html, /From 1,234 ratings and 456 comments on UW Flow\. The most helpful comments, quoted as written, without names\. <a href="https:\/\/uwflow\.com\/course\/cs135">Read them all on UW Flow<\/a>/);
    assert.match(html, /<p class="rd-q flow-q">Old but helpful\.<\/p>\s*<p class="entry-links"><span class="t">Jan 2019 · liked it · 30 found this helpful<\/span>/);
    assert.match(html, /Racket is<br>fine/);
    assert.match(html, /didn’t like it/);
    assert.match(html, /issues\/new\?title=Remove%20UW%20Flow%20comment%201%20\(CS%20135\)/);
    assert.equal(flowSection('CS999', undefined, { repo: 'u/r' }), '');
    const long = shape([{ code: 'x100', rating: { liked: 1, filled_count: 1, comment_count: 1 } }], [{ id: 9, created_at: '2024-01-01', course_comment: 'word '.repeat(300), course: { code: 'x100' } }]);
    assert.match(flowSection('X100', long.X100, { repo: 'u/r' }), /word…<\/p>/, 'a long comment is clipped at a word');
  } finally {
    server.close();
    delete process.env.UWFLOW_GRAPHQL;
    await rmr(dir, { recursive: true, force: true });
  }
});


test('schedules: WClasses pages for current courses, its API for gone ones, checks first, failures asked again', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { main } = await import('./schedules.mjs');
  const { loadSchedules, mainSections } = await import('./lib/schedules.mjs');
  const cls = (type, num, cap, tot, inst, start = 10) => ({ section: { type, num }, enrolCap: cap, enrolTotal: tot, instructor: inst, time: { startTime: { hours: start, mins: 0 }, endTime: { hours: start + 1, mins: 20 }, days: ['T', 'Th'] } });
  assert.deepEqual(mainSections([cls('TUT', '101', 30, 20, ''), cls('LEC', '002', 90, 80, 'B'), cls('LEC', '001', 90, 85, 'A')]).map((r) => r[0]), ['LEC 001', 'LEC 002']);
  const { row } = await import('./lib/schedules.mjs');
  assert.deepEqual(row({ ...cls('LEC', '001', 60, 61, 'Insley,Margaret'), time: { startTime: { hours: 10, mins: 30 }, endTime: { hours: 11, mins: 20 }, days: ['MWFRCH'] } }).slice(3), ['10:30-11:20 MWF', 'Insley,Margaret', 'RCH'], 'a building read into the days moves to the room');
  assert.deepEqual(row({ ...cls('LEC', '001', 60, 60, 'Li'), buildingCode: 'AL', roomNumber: '116' }).at(-1), 'AL 116');
  assert.deepEqual(mainSections([cls('SEM', '001', 15, 12, 'C', 13)]), [['SEM 001', 15, 12, '13:00-14:20 TTh', 'C', '']]);
  const nextPage = (schedule) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { schedule: JSON.stringify(schedule) } } })}</script></html>`;
  const asked = [];
  let flaky = 3; // every retry in one run
  const fetchImpl = async (url) => {
    const u = new URL(url);
    asked.push(u.pathname + u.search);
    const q = u.searchParams;
    const res = (status, body) => ({ status, text: async () => body });
    if (u.pathname === '/api/get-schedule') {
      if (q.get('subjectCode') === 'ECON' && q.get('catalogNumber') === '355' && q.get('term') === '1159') return res(200, JSON.stringify({ 1159: [cls('LEC', '001', 60, 60, 'Li, Hongxiu')] }));
      if (q.get('catalogNumber') === '355' && q.get('term') === '1079') return res(200, JSON.stringify({ 1079: [cls('LEC', '001', 60, 60, 'Insley, Margaret')] }));
      if (q.get('term') === '1089' && flaky-- > 0) return res(500, 'oops');
      return res(200, '{}');
    }
    if (q.get('subjectCode') === 'cs' && q.get('catalogNumber') === '135') return res(200, nextPage({ 1159: [cls('LEC', '001', 100, 99, 'Doe, Jane'), cls('TUT', '101', 50, 40, '')], 1161: [] }));
    return res(404, 'not found');
  };
  const dir = await mkdtemp(`${tmpdir()}/sched-`);
  const log = { log() {}, warn() {} };
  const opts = { fetchImpl, log, dir, pause: 0, workers: 1, currentCodes: new Set(['CS135']) };
  let out = await main(['--only', 'CS135,ECON355'], opts);
  assert.ok(asked[0].includes('ECON') && asked[0].includes('1159'), 'the checks come first');
  let s = await loadSchedules(dir);
  assert.deepEqual(s.get('CS135'), { v: 2, via: 'page', read: s.get('CS135').read, terms: { 1159: [['LEC 001', 100, 99, '10:00-11:20 TTh', 'Doe, Jane', '']] } });
  assert.deepEqual(s.get('ECON355').terms, { 1079: [['LEC 001', 60, 60, '10:00-11:20 TTh', 'Insley, Margaret', '']], 1159: [['LEC 001', 60, 60, '10:00-11:20 TTh', 'Li, Hongxiu', '']] });
  assert.ok(!s.get('ECON355').asked.includes('1089'), 'a failed request isn’t "nothing that term"');
  assert.ok(s.get('ECON355').asked.includes('1091'), 'an empty answer is recorded as asked');
  assert.equal(out.failed, 1);
  const before = asked.length;
  out = await main(['--only', 'ECON355'], opts);
  assert.ok(asked.slice(before).some((x) => x.includes('term=1089')), 'asked again next run');
  assert.ok(!asked.slice(before).some((x) => x.includes('term=1091')), 'not the ones already answered');
  // Checks failing: nothing saved, the run fails.
  const bad = await mkdtemp(`${tmpdir()}/sched-`);
  const prev = process.exitCode;
  out = await main([], { ...opts, dir: bad, fetchImpl: async () => ({ status: 200, text: async () => '{}' }) });
  assert.equal(out.error, 'checks failed');
  assert.equal(process.exitCode, 1);
  process.exitCode = prev;
  assert.equal((await loadSchedules(bad)).size, 0);
});

test('offerings: every term since 2001, clickable, Taught by, one-student sections with their professor', async () => {
  const { summarize, offeringsSection, personName, termsWithData } = await import('./lib/offerings.mjs');
  const { calendarInstructor } = await import('./lib/retired.mjs');
  assert.equal(personName('Insley,Margaret Caren'), 'Margaret Insley');
  assert.equal(personName('Li,Hongxiu'), 'Hongxiu Li');
  const e = {
    v: 2,
    terms: {
      1051: [['LEC 001', 60, 61, '10:30-11:20 MWF', 'Insley,Margaret', 'AL']],
      1105: [['LEC 001', 1, 1, '', 'Insley,Margaret Caren', '']],
      1109: [['LEC 001', 60, 59, '13:00-14:20 TTh', 'Insley,Margaret Caren', 'AL 116'], ['LEC 002', 1, 1, '', '', '']],
      1129: [['LEC 001', 60, 42, '13:00-14:20 TTh', 'Jefferson,Robert', '']],
      1159: [['LEC 001', 60, 60, '10:00-11:20 TTh', 'Li,Hongxiu', 'AL 116']],
    },
  };
  const s = summarize(e);
  assert.deepEqual(s.ran.map((t) => t.term), ['1051', '1109', '1129', '1159'], 'a term with only a one-student section isn’t "ran"');
  assert.deepEqual(s.taughtBy, [['Margaret Insley', 2], ['Hongxiu Li', 1], ['Robert Jefferson', 1]]);
  assert.equal(s.usual, '3 Fall, 1 Winter');
  const html = offeringsSection('ECON355', e, { current: false });
  assert.match(html, /Ran in 4 terms, Winter 2005 to Fall 2015: 3 Fall, 1 Winter\./);
  assert.match(html, /<a class="og on" href="#t1159"[^>]*>1<\/a>/);
  assert.match(html, /<a class="og solo" href="#t1105"/);
  assert.match(html, /Individual arrangements \(one student\): <a href="#t1105">S10<\/a> with Margaret Insley · <a href="#t1109">F10<\/a>\./);
  assert.match(html, /id="t1109"[\s\S]*LEC 002[\s\S]*individual arrangement, 1 student/);
  assert.match(html, /<td>TTh 10:00–11:20<\/td><td>AL 116<\/td><td>Hongxiu Li/);
  assert.ok(html.indexOf('og-y">2015') < html.indexOf('og-y">2005'), 'newest year first');
  assert.ok(!html.includes('og-y">2016'), 'a course that’s gone stops at its last year');
  assert.ok(offeringsSection('CS135', e).includes('og-y">2026'), 'a current course runs to now');
  assert.equal(offeringsSection('X', { terms: {} }), '');
  assert.deepEqual([...termsWithData(e)].sort(), ['1051', '1105', '1109', '1129', '1159']);
  assert.equal(calendarInstructor(['3 hours per week (Winter term) Instructor: Dutt, Schuster Purpose: To understand how to sim']), 'Dutt, Schuster');
  assert.equal(calendarInstructor(['3 hours per week, Fall term Instructor: to be announced']), null);
  assert.equal(calendarInstructor(['Prereq: Consent of Instructor']), null);
});

test('term archive: Open Data terms saved like data/schedules, finished terms once, the grid carries on past WClasses', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { main, toRows, loadOdTerms } = await import('./term-archive.mjs');
  const { offeringsSection } = await import('./lib/offerings.mjs');
  const sec = (comp, s, cap, enrl, start, end, days) => ({ comp, sec: s, cap, enrl, meets: start ? [{ days, start, end, date: null }] : [] });
  assert.deepEqual(toRows([sec('TUT', '101', 30, 20, '13:30', '14:20', 'F'), sec('LEC', '002', 90, 80, '08:30', '09:50', 'TTh'), sec('LEC', '001', 90, 88, '10:00', '11:20', 'TTh')]), [
    ['LEC 001', 90, 88, '10:00-11:20 TTh', '', ''],
    ['LEC 002', 90, 80, '8:30-9:50 TTh', '', ''],
  ]);
  const dir = await mkdtemp(`${tmpdir()}/tod-`);
  const offerings = { terms: { 1265: { published: true }, 1269: { published: true }, 1259: { published: false } }, rows: { 1265: [{ subject: 'CS', number: '135' }], 1269: [{ subject: 'CS', number: '135' }, { subject: 'CS', number: '136' }] } };
  const asked = [];
  const fetchClasses = async (term, r) => {
    asked.push(`${term} ${r.number}`);
    return r.number === '135' ? [{ courseComponent: 'LEC', classSection: 1, maxEnrollmentCapacity: 100, enrolledStudents: term === '1265' ? 97 : 60, scheduleData: [{ classMeetingStartTime: '2026-01-01T10:30:00', classMeetingEndTime: '2026-01-01T11:20:00', classMeetingWeekPatternCode: 'YNYNYNN' }] }] : null;
  };
  const log = { log() {}, warn() {} };
  const now = new Date('2026-11-16T12:00:00Z');
  await main(['--terms', '1265,1269'], { now, dir, fetchClasses, offerings, log });
  const od = await loadOdTerms(dir);
  assert.deepEqual(od.get('1265'), { term: '1265', read: '2026-11-16', final: true, source: 'UW Open Data', courses: { CS135: [['LEC 001', 100, 97, '10:30-11:20 MWF', '', '']] } });
  assert.equal(od.get('1269').final, false, 'the term in progress');
  asked.length = 0;
  await main([], { now, dir, fetchClasses, offerings: { ...offerings, terms: { ...offerings.terms } }, log });
  assert.ok(!asked.some((x) => x.startsWith('1265')), 'a finished term already read isn’t read again');
  assert.ok(asked.some((x) => x.startsWith('1269')), 'the term in progress is');
  // The grid: an Open Data Spring 2026 replaces WClasses’ early read, and Fall 2026 is a term like any other.
  const entry = { terms: { 1261: [['LEC 001', 100, 99, '', 'Doe,Jane', '']], 1265: [['LEC 001', 100, 97, '10:30-11:20 MWF', '', '']], 1269: [['LEC 001', 100, 60, '10:30-11:20 MWF', '', '']] }, od: ['1265', '1269'] };
  const html = offeringsSection('CS135', entry, { through: '1269', now });
  assert.match(html, /href="#t1269"/);
  assert.ok(!html.includes('before enrolment settled'), 'no "not final" note when the term came from Open Data');
  assert.match(html, /href="#t1261"/);
  const older = offeringsSection('CS135', { ...entry, terms: { ...entry.terms, 1259: [['LEC 001', 100, 98, '', '', '']] } }, { through: '1269', now });
  assert.match(older, /aria-label="Winter 2025: nothing on WClasses"/, 'before the last term read: "nothing", not "no data"');
});

// ---------------- the timetable planner (uwloo.ca/calendar) ----------------

const P = await import('../site/calendar/solve.js');
const { run: planRun } = await import('../site/calendar/run.js');
const { icsFile } = await import('../site/calendar/ics.js');
const { plannerData, plannerPage } = await import('./lib/planner.mjs');
const TERM = { from: '2027-01-06', to: '2027-04-06' };
const MWF = 1 | 4 | 16;
const TTh = 2 | 8;
// [comp, sec, assoc, class, cap, enrolled, meets]
const lec = (sec, assoc, cls, mask, s, e, enrl = 10, cap = 100) => ['LEC', sec, assoc, cls, cap, enrl, [[mask, s, e]]];
const tut = (sec, assoc, cls, mask, s, e, enrl = 10, cap = 30) => ['TUT', sec, assoc, cls, cap, enrl, [[mask, s, e]]];
const plan = (entries, prefs = {}) => Object.assign(planRun(P, TERM, entries, { ...P.DEFAULTS, ...prefs }), { prefs: { ...P.DEFAULTS, ...prefs } });
const picked = (res, entries, i = 0) =>
  res.schedules[i].picks.map(([ci, comp, oi]) => {
    const code = Object.keys(entries)[ci];
    const built = P.buildCourse(code, entries[code], TERM, res.prefs ?? P.DEFAULTS);
    return `${code} ${comp} ${built.opts[comp][oi].section.sec}`;
  });

test('planner: a tutorial goes with its own lecture, or any lecture when its number is 99', () => {
  const entries = {
    CS136: ['Elementary Algorithm Design', [lec('001', 1, 5001, MWF, 510, 560), lec('002', 2, 5002, MWF, 630, 680), tut('101', 1, 5101, 1, 870, 920), tut('102', 2, 5102, 2, 870, 920)]],
    MATH138: ['Calculus 2', [lec('001', 1, 6001, MWF, 690, 740), tut('101', 99, 6101, 4, 900, 950)]],
  };
  const res = plan(entries);
  assert.equal(res.schedules.length, 2, 'two CS 136 lectures, each with only its own tutorial');
  for (let i = 0; i < 2; i++) {
    const p = picked(res, entries, i);
    const l = p.find((x) => x.startsWith('CS136 LEC')).slice(-1);
    assert.ok(p.includes(`CS136 TUT 10${l}`), `LEC 00${l} brings TUT 10${l}`);
    assert.ok(p.includes('MATH138 TUT 101'), 'the 99 tutorial goes with any lecture');
  }
  assert.ok(res.all && res.complete);
});

test('planner: clashing sections never pair; days off and start times rank the rest', () => {
  const entries = {
    A100: ['', [lec('001', 1, 1, MWF, 510, 560), lec('002', 2, 2, TTh, 600, 680)]],
    B200: ['', [lec('001', 1, 3, MWF, 510, 560), lec('002', 2, 4, MWF, 870, 920)]],
  };
  const res = plan(entries);
  for (const s of res.schedules) {
    const p = picked({ schedules: [s], prefs: res.prefs }, entries);
    assert.ok(!(p.includes('A100 LEC 001') && p.includes('B200 LEC 001')), '8:30 MWF twice');
  }
  assert.equal(res.schedules.length, 3);
  assert.deepEqual(picked(plan(entries, { start: 600 }), entries).sort(), ['A100 LEC 002', 'B200 LEC 002'], 'start after 10: nothing at 8:30');
  const fri = plan(entries, { off: 2 | 8 });
  assert.ok(picked(fri, entries).includes('A100 LEC 001'), 'Tuesday and Thursday off: A100 moves to MWF');
});

test('planner: full sections are skipped unless they’re all that’s left; locks and busy times', () => {
  const entries = { C300: ['', [lec('001', 1, 11, MWF, 510, 560, 100, 100), lec('002', 2, 12, MWF, 600, 650), lec('003', 3, 13, TTh, 600, 680)]] };
  const all = plan(entries);
  assert.ok(!all.schedules.some((s) => picked({ schedules: [s], prefs: all.prefs }, entries)[0] === 'C300 LEC 001'), 'the full one is left out');
  assert.equal(plan(entries, { skipFull: false }).schedules.length, 3);
  const only = plan({ D400: ['', [lec('001', 1, 21, MWF, 510, 560, 100, 100)]] });
  assert.equal(only.schedules.length, 1, 'every section full: they’re shown anyway');
  assert.match(only.notes[0][1], /full/);
  const locked = plan(entries, { locks: [13] });
  assert.deepEqual(picked(locked, entries), ['C300 LEC 003']);
  assert.equal(locked.schedules.length, 1);
  const busy = plan(entries, { blocks: [{ mask: 4, s: 540, e: 720 }] });
  assert.deepEqual(picked(busy, entries), ['C300 LEC 003'], 'Wednesday 9–noon busy');
  const none = plan(entries, { blocks: [{ mask: 31, s: 480, e: 1200 }] });
  assert.equal(none.schedules.length, 0);
  assert.deepEqual(none.problems, [['C300', 'blocked:LEC']]);
});

test('planner: weeks and one-day meetings; why nothing fits; other choices', () => {
  // Same time, different halves of the term: no clash.
  const a = P.readSection(['LEC', '001', 1, 1, 50, 0, [[MWF, 600, 650, '2027-01-06', '2027-02-14']]], TERM);
  const b = P.readSection(['LEC', '001', 1, 2, 50, 0, [[MWF, 600, 650, '2027-02-24', '2027-04-06']]], TERM);
  const c = P.readSection(['LEC', '001', 1, 3, 50, 0, [[1, 600, 650]]], TERM);
  assert.equal(P.clash(a.meets[0], b.meets[0]), false);
  assert.equal(P.clash(a.meets[0], c.meets[0]), true);
  const t = P.readSection(['TST', '201', 99, 4, 400, 0, [[0, 1140, 1250, '2027-02-25']]], TERM);
  assert.equal(t.meets[0].mask, 8, 'a test on Thursday Feb 25');
  assert.ok(t.meets[0].one);
  // A test overlapping a class costs, but doesn't rule the timetable out.
  const entries = {
    E500: ['', [lec('001', 1, 31, TTh, 1140, 1250), lec('002', 2, 32, TTh, 600, 680)]],
    F600: ['', [lec('001', 1, 41, MWF, 600, 650), ['TST', '201', 99, 42, 400, 0, [[0, 1140, 1250, '2027-02-25']]]]],
  };
  const res = plan(entries);
  assert.equal(res.schedules.length, 2);
  assert.ok(picked(res, entries).includes('E500 LEC 002'), 'the one without the overlap ranks first');
  const built = Object.entries(entries).map(([k, v]) => P.buildCourse(k, v, TERM, P.DEFAULTS));
  const second = res.schedules[1].picks.map(([ci, comp, oi]) => ({ code: built[ci].code, comp, opt: built[ci].opts[comp][oi] }));
  assert.equal(P.metrics(second).overlaps, 1);
  // Nothing fits: name the pair.
  const stuck = plan({ G1: ['', [lec('001', 1, 51, MWF, 510, 560)]], H2: ['', [lec('001', 1, 52, 1, 530, 580)]], I3: ['', [lec('001', 1, 53, TTh, 510, 560)]] });
  assert.equal(stuck.schedules.length, 0);
  assert.deepEqual(stuck.why.pairs, [['G1', 'H2']]);
  // Three that clash only all together: say which one to leave out.
  const tri = plan({
    J1: ['', [lec('001', 1, 61, 1, 510, 560), lec('002', 2, 62, 2, 510, 560)]],
    K2: ['', [lec('001', 1, 63, 1, 510, 560), lec('002', 2, 64, 2, 510, 560)]],
    L3: ['', [lec('001', 1, 65, 1, 510, 560), lec('002', 2, 66, 2, 510, 560)]],
  });
  assert.deepEqual(tri.why, { pairs: [], drop: ['J1', 'K2', 'L3'] });
  // Same-time sections are one choice; alternatives say what a swap would clash with.
  const same = P.buildCourse('M1', ['', [lec('001', 1, 71, MWF, 510, 560, 90), lec('002', 1, 72, MWF, 510, 560, 20), lec('003', 3, 73, MWF, 600, 650)]], TERM, P.DEFAULTS);
  assert.equal(same.opts.LEC.length, 2);
  assert.equal(same.opts.LEC[0].section.sec, '002', 'the one with more seats left');
  const other = P.buildCourse('N2', ['', [lec('001', 1, 81, MWF, 600, 650)]], TERM, P.DEFAULTS);
  const s = P.solve([same, other], P.DEFAULTS).schedules[0];
  const alts = P.alternatives([same, other], s.picks, 0);
  assert.equal(alts[0].opt, s.picks[0].opt, 'the current choice first');
  assert.equal(alts[1].clash.code, 'N2');
});

test('planner: a search too big to finish says so', () => {
  const entries = {};
  for (let k = 0; k < 8; k++) entries[`Z${k}`] = ['', Array.from({ length: 12 }, (_, i) => lec(String(i + 1).padStart(3, '0'), i + 1, k * 100 + i, [1, 2, 4, 8, 16][i % 5], 480 + 60 * (i % 10), 530 + 60 * (i % 10)))];
  const courses = Object.entries(entries).map(([k, v]) => P.buildCourse(k, v, TERM, P.DEFAULTS));
  const res = P.solve(courses, P.DEFAULTS, { budget: 2000 });
  assert.equal(res.complete, false);
  assert.equal(res.all, false);
  const full = P.solve(courses, P.DEFAULTS);
  assert.ok(full.schedules.length > 0 && full.schedules.length <= 60);
  for (let i = 1; i < full.schedules.length; i++) assert.ok(full.schedules[i].cost >= full.schedules[i - 1].cost, 'best first');
});

test('planner: term file from Open Data sections; calendar file; page', () => {
  const sec = (over) => ({ cls: 5001, comp: 'LEC', sec: '001', cap: 100, enrl: 90, assoc: 1, meets: [{ days: 'MWF', start: '08:30', end: '09:20', date: null, from: '2027-01-06', to: '2027-04-06' }], ...over });
  const data = plannerData(
    '1271',
    {
      CS136: [sec(), sec({ cls: 5101, comp: 'TUT', sec: '101', meets: [{ days: 'Th', start: '14:30', end: '15:20', date: null, from: '2027-01-14', to: '2027-04-01' }] }), sec({ cls: 5201, comp: 'TST', sec: '201', assoc: 99, meets: [{ days: 'Th', start: '19:00', end: '20:50', date: '2027-02-25', from: '2027-02-25', to: '2027-02-25' }] })],
      MATH138: [sec({ cls: 6001, meets: [{ days: 'TTh', start: '10:00', end: '11:20', date: null, from: '2027-01-06', to: '2027-04-06' }] }), sec({ cls: 6002, sec: '002', meets: [] })],
    },
    { asOf: '2026-11-18T10:00:00Z', titleOf: (c) => ({ CS136: 'Elementary Algorithm Design and Data Abstraction' })[c] },
  );
  assert.equal(data.name, 'Winter 2027');
  assert.equal(data.from, '2027-01-06');
  assert.deepEqual(data.c.CS136[1][0], ['LEC', '001', 1, 5001, 100, 90, [[MWF, 510, 560]]], 'the usual weeks are left out');
  assert.deepEqual(data.c.CS136[1][1][6], [[8, 870, 920, '2027-01-14', '2027-04-01']], 'other weeks are written out');
  assert.deepEqual(data.c.CS136[1][2][6], [[8, 1140, 1250, '2027-02-25']]);
  assert.deepEqual(data.c.MATH138[1][1][6], [], 'online');
  assert.equal(data.c.MATH138[0], '');
  const res = planRun(P, { from: data.from, to: data.to }, data.c, P.DEFAULTS);
  assert.equal(res.schedules.length, 2, 'MATH 138 in person or online');
  const built = Object.entries(data.c).map(([k, v]) => P.buildCourse(k, v, data, P.DEFAULTS));
  const picks = res.schedules[0].picks.map(([ci, comp, oi]) => ({ code: built[ci].code, comp, opt: built[ci].opts[comp][oi] }));
  const { text } = icsFile(picks, 'Winter 2027', { dayBit: P.dayBit });
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /DTSTART;TZID=America\/Toronto:20270106T083000\r\nDTEND;TZID=America\/Toronto:20270106T092000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270407T045959Z/);
  assert.match(text, /DTSTART;TZID=America\/Toronto:20270114T143000/, 'the first Thursday on or after the tutorials start');
  assert.match(text, /SUMMARY:CS 136 TST 201\r\nDTSTART;TZID=America\/Toronto:20270225T190000\r\nDTEND;TZID=America\/Toronto:20270225T205000\r\nDESCRIPTION/, 'a test is one event');
  const html = plannerPage({ terms: [{ term: '1269', name: 'Fall 2026', asOf: null, from: '2026-09-02', courses: 1 }, { term: '1271', name: data.name, asOf: data.asOf, from: data.from, courses: 2 }], builtAt: new Date('2026-11-19T12:00:00Z'), version: 'abc12345' });
  assert.match(html, /<link rel="canonical" href="https:\/\/uwloo\.ca\/calendar\/">/);
  assert.match(html, /data-terms="\[\{&quot;term&quot;:&quot;1269&quot;/);
  assert.match(html, /src="\/calendar\/planner\.js\?v=abc12345"/);
  assert.match(html, /<button type="button" data-term="1271" aria-pressed="true">Winter 2027<\/button>/);
  assert.doesNotMatch(plannerPage({ terms: [], builtAt: new Date(), version: 'x' }), /planner\.js/);
});

test('planner: an associated-class number of 0 (Open Data’s, for now) pairs with anything; dated labs are classes', () => {
  const entries = {
    ECE106: ['', [lec('001', 0, 1, MWF, 510, 560), lec('002', 0, 2, MWF, 630, 680), tut('101', 0, 3, 1, 870, 920)]],
  };
  assert.equal(plan(entries).schedules.length, 2, 'either lecture with the tutorial');
  // A lab on three Tuesdays: it clashes with a weekly Tuesday class at that time, but not with one on other weeks.
  const lab = P.readSection(['LAB', '201', 0, 9, 48, 0, [[0, 510, 680, '2027-01-19'], [0, 510, 680, '2027-02-02'], [0, 510, 680, '2027-02-16']]], TERM);
  assert.equal(lab.meets.length, 1);
  assert.deepEqual(lab.meets[0].dates, ['2027-01-19', '2027-02-02', '2027-02-16']);
  assert.equal(lab.meets[0].one, false);
  const weekly = P.readSection(['LEC', '001', 0, 10, 50, 0, [[2, 540, 590]]], TERM);
  const later = P.readSection(['LEC', '001', 0, 11, 50, 0, [[2, 540, 590, '2027-03-01', '2027-04-06']]], TERM);
  const otherLab = P.readSection(['LAB', '202', 0, 12, 48, 0, [[0, 510, 680, '2027-01-26']]], TERM);
  assert.equal(P.clash(lab.meets[0], weekly.meets[0]), true);
  assert.equal(P.clash(weekly.meets[0], lab.meets[0]), true);
  assert.equal(P.clash(lab.meets[0], later.meets[0]), false, 'the lecture starts after the last lab');
  assert.equal(P.clash(lab.meets[0], otherLab.meets[0]), false, 'different Tuesdays');
  const res = plan({ ECE124: ['', [['LAB', '201', 0, 9, 48, 0, [[0, 510, 680, '2027-01-19'], [0, 510, 680, '2027-02-02']]]]], X1: ['', [lec('001', 0, 20, 2, 540, 590), lec('002', 0, 21, 4, 540, 590)]] });
  assert.equal(res.schedules.length, 1, 'only the Wednesday lecture fits around the lab');
  const built = [P.buildCourse('ECE124', [['LAB', '201', 0, 9, 48, 0, [[0, 510, 680, '2027-01-19'], [0, 510, 680, '2027-02-02']]]], TERM, P.DEFAULTS)];
  const { text } = icsFile([{ code: 'ECE124', comp: 'LAB', opt: built[0].opts.LAB[0] }], 'Winter 2027', { dayBit: P.dayBit });
  assert.equal(text.match(/BEGIN:VEVENT/g).length, 2, 'one event per date');
  assert.doesNotMatch(text, /RRULE:FREQ=WEEKLY/);
  assert.equal(P.metrics([{ code: 'ECE124', comp: 'LAB', opt: built[0].opts.LAB[0] }]).days, 1, 'a dated lab is a day on campus');
});

test('planner: saved plans per term; the course page button; the header link', async () => {
  const Plans = await import('../site/calendar/plans.js');
  const terms = [
    { term: '1269', from: '2026-09-08' },
    { term: '1271', from: '2027-01-11' },
  ];
  assert.equal(Plans.defaultTerm(terms), '1271', 'Fall started long ago: plan Winter');
  assert.equal(Plans.defaultTerm([{ term: '1271', from: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10) }, { term: '1275', from: null }]), '1271', 'Winter started 5 days ago: still Winter');
  assert.equal(Plans.defaultTerm([{ term: '1271', from: '2027-01-11' }]), '1271');
  assert.equal(Plans.chooseTerm({ last: '1269', terms: {} }, terms), '1271', 'a plan for a past term isn’t picked up');
  assert.equal(Plans.chooseTerm({ last: '1271', terms: {} }, terms), '1271');
  assert.equal(Plans.chooseTerm(null, terms), '1271');
  const all = { last: null, terms: { 1271: 'c=CS136&off=16' } };
  assert.deepEqual(Plans.toggleCourse(all, '1271', 'MATH138'), ['CS136', 'MATH138']);
  assert.equal(all.terms['1271'], 'c=CS136,MATH138&off=16', 'preferences kept');
  assert.equal(all.last, '1271');
  assert.deepEqual(Plans.toggleCourse(all, '1271', 'CS136'), ['MATH138']);
  assert.deepEqual(Plans.toggleCourse(all, '1271', 'MATH138'), []);
  assert.equal(all.terms['1271'], 'off=16');
  const full = { terms: { 1271: 'c=A1,A2,A3,A4,A5,A6,A7,A8' } };
  assert.equal(Plans.toggleCourse(full, '1271', 'B1'), null);
  assert.deepEqual(Plans.codesOf('c=CS136,MATH138&s=600'), ['CS136', 'MATH138']);

  const { planButton } = await import('./lib/render.mjs');
  assert.equal(planButton('CS135', null), '');
  assert.equal(planButton('CS135', [{ t: '1269', n: 'Fall 2026', f: '2026-09-08', h: 0 }]), '');
  const btn = planButton('CS136', [
    { t: '1269', n: 'Fall 2026', f: '2026-09-08', h: 1 },
    { t: '1271', n: 'Winter 2027', f: '2027-01-11', h: 1 },
  ]);
  assert.match(btn, /<a class="plan-btn" href="\/calendar\/\?t=1271&amp;c=CS136">Plan a Winter 2027 timetable with CS 136<\/a>/);
  assert.match(btn, /data-plan="\[\{&quot;term&quot;:&quot;1269&quot;,&quot;name&quot;:&quot;Fall 2026&quot;,&quot;from&quot;:&quot;2026-09-08&quot;,&quot;has&quot;:true\}/);
  const page = plannerPage({ terms: [{ term: '1271', name: 'Winter 2027', asOf: null, from: '2027-01-11', courses: 1 }], builtAt: new Date(), version: 'v1' });
  assert.match(page, /<a class="nav-plan" href="\/calendar\/" aria-current="page">Timetable<span class="nav-count" aria-hidden="true"><\/span><\/a>/);
  assert.match(page, /<a class="nav-plan nav-path" href="\/pathways\/">Pathways<\/a>/, 'Pathways sits beside it in the header');
  assert.match(page, /<p class="support">uwloo is free and has no ads\. If it’s useful to you: <a href="https:\/\/buymeacoffee\.com\/umarhq">Buy me a coffee<\/a> · <a href="https:\/\/github\.com\/sponsors\/UmarPatel77">Sponsor on GitHub<\/a><\/p>/);
});

// ---------------- programs (/programs/, "Counts toward") ----------------

const PR = await import('./lib/programs.mjs');
// Trimmed from the 2026–27 calendar's Public Policy Specialization and Aging Studies Option.
const course = (id, code, title, units = '0.50') => `<li><span><a href="#/courses/view/${id}" target="_blank">${code}</a> <!-- -->-<!-- --> <!-- -->${title}<!-- --> <span style="margin-left:5px">(${units})</span></span></li>`;
const PUBLIC_POLICY = `<div><section><header data-test="grouping-0-header"><div><h2 data-testid="grouping-label"><span>Required Courses</span></h2></div><div><div><button aria-label="Collapse"><i></i></button></div></div></header><div><div><ul><li><span>Complete <!-- -->all<!-- --> of the following</span><ul><li data-test="ruleView-A"><div data-test="ruleView-A-result">Complete all the following: <div><ul style="margin-top:5px;margin-bottom:5px">${course('a1', 'ECON361', 'Cost-Benefit Analysis and Project Evaluation')}${course('a2', 'ECON441', 'Public Economics')}</ul></div></div></li><li data-test="ruleView-B"><div data-test="ruleView-B-result">Complete <span>2</span> of the following: <div><ul>${course('b1', 'ECON351', 'Labour Economics')}${course('b2', 'ECON363', 'The Economics of Social Problems')}${course('b3', 'ECON366', 'Gender and Economics')}</ul></div></div></li></ul></li></ul></div><div></div></div></section></div>`;
const AGING = `<div><section><header data-test="grouping-1-header"><div><h2 data-testid="grouping-label"><span>Approved Courses List</span></h2></div><div><span>2.5</span><span>Units to Complete</span></div></header><div><div><ul><li data-test="ruleView-A"><div data-test="ruleView-A-result"><div>Complete 5 courses from List 1 and List 2, with no more than 1 course from List 2.</div></div></li></ul></div><div><section><div><header><div><h2>List 1</h2></div><div></div></header><div><div><ul><li data-test="ruleView-B"><div data-test="ruleView-B-result">Choose any of the following: <div><ul>${course('c1', 'BIOL355', 'Biology of Human Aging')}${course('c2', 'GERON218', 'Psychology of Death and Dying')}</ul></div></div></li></ul></div></div></div></section><section><div><header><div><h2>List 2</h2></div></header><div><div><ul><li data-test="ruleView-C"><div data-test="ruleView-C-result">Complete no more than <span>1</span> from the following: <div><ul>${course('d1', 'STAT202', 'Introductory Statistics for Scientists')}</ul></div></div></li></ul></div></div></div></section></div></div></section></div>`;
const progEntry = (pid, id, code, title, type, field) => ({ pid, id, code, title, undergraduateCredentialType: { name: type }, fieldOfStudy: { name: field } });

test('programs: requirement sections, lists, and what each course is for', () => {
  const [s] = PR.sectionsOf(PUBLIC_POLICY);
  assert.equal(s.heading, 'Required Courses');
  assert.equal(s.tree[0].type, 'group');
  assert.deepEqual(s.tree[0].items.map((n) => n.lead), ['Complete all the following:', 'Complete 2 of the following:']);
  const [a] = PR.sectionsOf(AGING);
  assert.equal(a.heading, 'Approved Courses List');
  assert.equal(a.units, 2.5);
  assert.equal(a.tree[0].type, 'text', 'the rule sentence stays in the calendar’s words');
  assert.deepEqual(a.lists.map((l) => l.heading), ['List 1', 'List 2']);
  const progs = PR.readPrograms(
    [progEntry('p1', 'v1', 'ECON-Public Policy Specialization', 'Public Policy Specialization', 'Specialization', 'Economics'), progEntry('p2', 'v2', 'Aging Studies Option', 'Aging Studies Option', 'Option', 'Options: Faculty of Health')],
    new Map([
      ['p1', { pid: 'p1', courseRequirementsNoUnits: PUBLIC_POLICY, specializationIsAvailableForStudentsInTheFollowingMajorsRules: '<div><ul><li data-test="ruleView-A"><div data-test="ruleView-A-result"><span><a href="#/programs/view/v9">H-Economics</a></span></div></li></ul></div>' }],
      ['p2', { pid: 'p2', courseListsNew: AGING, systemsOfStudy: { regular: true } }],
    ]),
  );
  const pp = progs.bySlug.get('econ-public-policy-specialization');
  assert.equal(pp.name, 'Public Policy Specialization (Economics)');
  assert.deepEqual(pp.availableTo, [{ id: 'v9', name: 'H-Economics' }]);
  assert.deepEqual([...PR.courseRoles(pp)], [
    ['ECON361', ['Required']],
    ['ECON441', ['Required']],
    ['ECON351', ['Choose 2 of 3']],
    ['ECON363', ['Choose 2 of 3']],
    ['ECON366', ['Choose 2 of 3']],
  ]);
  const aging = progs.bySlug.get('aging-studies-option');
  assert.deepEqual(Object.fromEntries(PR.courseRoles(aging)), { BIOL355: ['List 1'], GERON218: ['List 1'], STAT202: ['List 2: At most 1 from a list'] });
  const counts = PR.countsToward(progs);
  assert.deepEqual(counts.get('ECON351').map((x) => [x.p.slug, x.roles]), [['econ-public-policy-specialization', ['Choose 2 of 3']]]);
  const html = PR.countsSection('ECON351', counts.get('ECON351'), { label: '2026–27' });
  assert.match(html, /<h3>Specializations <span class="t">1<\/span><\/h3>/);
  assert.match(html, /<a href="\/programs\/econ-public-policy-specialization\/">Public Policy Specialization \(Economics\)<\/a> <span class="t">Choose 2 of 3<\/span>/);
  assert.equal(PR.countsSection('CS999', undefined, { label: '2026–27' }), '');
  assert.equal(PR.programSlug('H-Geography & Environmental Management'), 'h-geography-and-environmental-management');
  assert.equal(PR.programSlug('Degree Reqs: BSc (Science)'), 'degree-reqs-bsc-science');
});

test('programs: invalid credential combinations, matched to programs', () => {
  const list = [
    progEntry('a', 'va', 'H-Accounting & Financial Management', 'Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)', 'Major', 'Accounting and Financial Management'),
    progEntry('b', 'vb', 'Management Studies Minor', 'Management Studies Minor', 'Minor', 'Management Studies'),
    progEntry('c', 'vc', 'H-Data Science (BCS)', 'Data Science (Bachelor of Computer Science - Honours)', 'Major', 'Data Science'),
    progEntry('d', 'vd', 'H-Data Science (BMath)', 'Data Science (Bachelor of Mathematics - Honours)', 'Major', 'Data Science'),
    progEntry('e', 've', 'GEM-Aviation Specialization', 'Aviation Specialization', 'Specialization', 'Geography and Environmental Management'),
    progEntry('f', 'vf', 'CEC-Aviation Specialization', 'Aviation Specialization', 'Specialization', 'Climate and Environmental Change'),
    progEntry('g', 'vg', 'Gerontology Minor', 'Gerontology Minor', 'Minor', 'Gerontology'),
    progEntry('h', 'vh', 'Gerontology Diploma', 'Diploma in Gerontology', 'Diploma', 'Gerontology'),
    progEntry('i', 'vi', 'Aging Studies Option', 'Aging Studies Option', 'Option', 'Options: Faculty of Health'),
    progEntry('j', 'vj', 'ECON-Finance Specialization', 'Finance Specialization', 'Specialization', 'Economics'),
    progEntry('k', 'vk', 'ECON-Public Policy Specialization', 'Public Policy Specialization', 'Specialization', 'Economics'),
    progEntry('l', 'vl', 'ECON-Intensive Economics Specialization', 'Intensive Economics Specialization', 'Specialization', 'Economics'),
    progEntry('m', 'vm', '4G-Communication Studies', 'Communication Studies (Bachelor of Arts - Four-Year General)', 'Major', 'Communication Studies'),
  ];
  const progs = PR.readPrograms(list, new Map(list.map((e) => [e.pid, { pid: e.pid }])));
  const td = (s) => `<td style="width: 30%;">${s}</td>`;
  const icc = PR.parseCombinations(`<p>Minors are normally open to all undergraduate students.</p><ul><li>No student may enrol in or graduate from: <ul><li>Multiple “topic” specializations offered by the same major in the following majors: <ul><li>Economics (maximum of one topic specialization)</li><li>Mathematical Economics, BA (maximum of one topic specialization)</li></ul></li></ul></li></ul>
<table border="1"><caption>List</caption><thead><tr><th>Active Plan/Program</th><th>Faculty</th><th>Cannot be Combined With</th></tr></thead><tbody>
<tr>${td('Accounting and Financial Management, Bachelor of')}${td('Arts')}${td('Arts and Business;<br />Management Studies Minor;<br />Any stand-alone major')}</tr>
<tr>${td('Aging Studies Option')}${td('Health')}${td('Gerontology, Diploma in;<br />Gerontology Minor')}</tr>
<tr>${td('Gerontology Minor or Diploma')}${td('Health')}${td('Aging Studies Option')}</tr>
<tr>${td('Aviation Minor')}${td('Science')}${td('Aviation Specialization (Climate and Environmental Change major; Geography and Environmental Management major)')}</tr>
<tr>${td('Latin American Studies, Diploma in;')}${td('Arts')}${td('Communications Studies major*')}</tr>
</tbody></table>`);
  assert.equal(icc.rows.length, 5);
  assert.deepEqual(icc.rows[0].cannot, ['Arts and Business', 'Management Studies Minor', 'Any stand-alone major']);
  assert.deepEqual(icc.rows[3].cannot, ['Aviation Specialization (Climate and Environmental Change major; Geography and Environmental Management major)'], 'not split inside parentheses');
  assert.equal(icc.rows[4].plan, 'Latin American Studies, Diploma in', 'stray semicolon dropped');
  assert.doesNotMatch(PR.richText(icc.rulesHtml, { known: new Set() }), /<table/, 'the table is taken out of the rules');
  const idx = PR.nameIndex(progs);
  const codes = (name) => PR.matchName(name, idx, progs).map((p) => p.code).sort();
  assert.deepEqual(codes('Accounting and Financial Management, Bachelor of'), ['H-Accounting & Financial Management']);
  assert.deepEqual(codes('Data Science (BCS)'), ['H-Data Science (BCS)'], 'a degree in parentheses narrows it');
  assert.deepEqual(codes('Data Science major (BCS or BMath)'), ['H-Data Science (BCS)', 'H-Data Science (BMath)']);
  assert.deepEqual(codes('Aviation Specialization (Climate and Environmental Change major; Geography and Environmental Management major)'), ['CEC-Aviation Specialization', 'GEM-Aviation Specialization']);
  assert.deepEqual(codes('Gerontology Minor or Diploma'), ['Gerontology Diploma', 'Gerontology Minor']);
  assert.deepEqual(codes('Gerontology, Diploma in'), ['Gerontology Diploma']);
  assert.deepEqual(codes('Communications Studies major*'), ['4G-Communication Studies'], 'a spelling slip');
  assert.deepEqual(codes('Any stand-alone major'), []);
  const { byProgram, stats } = PR.combosFor(icc.rows, progs, icc.rulesHtml);
  assert.deepEqual(stats, { rows: 5, plans: 3, names: 8, matched: 7 }, 'a group counts as matched');
  const of = (code) => byProgram.get(progs.list.find((p) => p.code === code).pid).map((o) => [o.text, o.to.map((p) => p.code).sort()]);
  assert.deepEqual(of('H-Accounting & Financial Management'), [['Arts and Business', []], ['Management Studies Minor', ['Management Studies Minor']], ['Any stand-alone major', ['4G-Communication Studies', 'H-Data Science (BCS)', 'H-Data Science (BMath)']]], '"Any stand-alone major": every other major');
  assert.ok(byProgram.get(progs.list.find((p) => p.code === 'H-Accounting & Financial Management').pid).find((o) => o.text === 'Any stand-alone major').group);
  assert.deepEqual(of('H-Data Science (BCS)'), [['Programs that take no other major', ['H-Accounting & Financial Management']]], 'and each of those majors says so once');
  assert.deepEqual(of('Management Studies Minor'), [['Accounting and Financial Management, Bachelor of', ['H-Accounting & Financial Management']]], 'both ways round');
  assert.deepEqual(of('Aging Studies Option'), [['Gerontology, Diploma in', ['Gerontology Diploma']], ['Gerontology Minor', ['Gerontology Minor']]], '"Minor or Diploma" collapses into the two it names');
  assert.deepEqual([...PR.topicMajors(icc.rulesHtml)], ['economics', 'mathematical economics']);
  assert.deepEqual(of('ECON-Public Policy Specialization'), [['Another Economics topic specialization: one at most', ['ECON-Finance Specialization']]]);
  assert.deepEqual(of('ECON-Intensive Economics Specialization'), [], 'the intensive one isn’t a topic specialization');
});

test('programs: prose links, and the pages', () => {
  const list = [progEntry('p1', 'v1', 'Economics Minor', 'Economics Minor', 'Minor', 'Economics'), progEntry('p2', 'v2', 'H-Economics', 'Economics (Bachelor of Arts - Honours)', 'Major', 'Economics'), progEntry('p3', 'v3', '4G-Economics', 'Economics (Bachelor of Arts - Four-Year General)', 'Major', 'Economics')];
  const progs = PR.readPrograms(list, new Map([['p1', { pid: 'p1', declarationRequirements: '<p>Before declaring, see <a href="#/policy/S17gweg46">invalid credential combinations</a>, the <a href="#/programs/view/v2">H-Economics</a> plan, <a href="#/courses/view/x">ECON101</a>, <a href="#/policy/abc">Course Load</a> and <a href="https://uwaterloo.ca/economics">the department</a>.</p><h5>Note</h5>' }]]));
  const cat = { label: '2026–27', pageUrl: 'https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog' };
  const known = new Set(['ECON101']);
  const minor = progs.bySlug.get('economics-minor');
  const prose = PR.richText(minor.text.declarationRequirements, { known, byId: progs.byId, cat });
  assert.match(prose, /<a href="\/programs\/combinations\/">invalid credential combinations<\/a>/);
  assert.match(prose, /<a href="\/programs\/h-economics\/">H-Economics<\/a>/);
  assert.match(prose, /<a class="cc" href="\/econ101\/">ECON 101<\/a>/);
  assert.match(prose, /<a href="https:\/\/uwaterloo\.ca\/academic-calendar\/undergraduate-studies\/catalog#\/policy\/abc">Course Load<\/a>/);
  assert.match(prose, /<a href="https:\/\/uwaterloo\.ca\/economics">the department<\/a>/);
  assert.match(prose, /<h4>Note<\/h4>/);
  const page = PR.programPage({ p: minor, programs: progs, combos: new Map(), cat, known, builtAt: new Date('2026-11-25T12:00:00Z'), version: 'v' });
  assert.match(page, /<link rel="canonical" href="https:\/\/uwloo\.ca\/programs\/economics-minor\/">/);
  assert.match(page, /<h2 id="dec-h">Declaring<\/h2>/);
  assert.match(page, /Nothing in the calendar’s table of invalid credential combinations/);
  assert.match(page, /catalog#\/programs\/p1">Economics Minor<\/a>/);
  const index = PR.programsIndexPage({ programs: progs, cat, builtAt: new Date(), version: 'v' });
  assert.match(index, /<span class="pbase">Economics<\/span> <a class="pv" href="\/programs\/4g-economics\/" title="Economics \(Bachelor of Arts - Four-Year General\)">Four-Year General<\/a> · <a class="pv" href="\/programs\/h-economics\/" title="Economics \(Bachelor of Arts - Honours\)">Honours<\/a>/);
  assert.match(index, /1 minor/);
});

test('programs: degree names, renamed specializations, and the "and Financial Management" rule', () => {
  const list = [
    progEntry('a', 'va', 'Degree Reqs: BMath', 'Bachelor of Mathematics Degree Requirements', 'Degree Requirements', 'Degree Requirements'),
    progEntry('b', 'vb', 'H-BBA & BCS Double Degree', 'Business Administration and Computer Science Double Degree (Bachelor of Business Administration and Bachelor of Computer Science - Honours)', 'Major', 'Computer Science'),
    progEntry('c', 'vc', 'BME-Biomechanical & Rehabilitation Engineering Specialization', 'Biomechanical and Rehabilitation Engineering Specialization', 'Specialization', 'Biomedical Engineering'),
    progEntry('d', 'vd', 'BME-Biomedical Artificial Intelligence Specialization', 'Biomedical Artificial Intelligence Specialization', 'Specialization', 'Biomedical Engineering'),
    progEntry('e', 've', 'H-Accounting & Financial Management', 'Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)', 'Major', 'Accounting and Financial Management'),
    progEntry('f', 'vf', 'H-Computing & Financial Management', 'Computing and Financial Management (Bachelor of Computing and Financial Management - Honours)', 'Major', 'Computing and Financial Management'),
    progEntry('g', 'vg', 'SE-Business Specialization', 'Business Specialization', 'Specialization', 'Software Engineering'),
  ];
  const progs = PR.readPrograms(list, new Map(list.map((e) => [e.pid, { pid: e.pid }])));
  const idx = PR.nameIndex(progs);
  const codes = (name) => PR.matchName(name, idx, progs).map((p) => p.code).sort();
  assert.deepEqual(codes('Mathematics, Bachelor of'), ['Degree Reqs: BMath']);
  assert.deepEqual(codes('Business Administration and BCS double degree'), ['H-BBA & BCS Double Degree']);
  assert.deepEqual(codes('Biomechanics and Rehabilitation Specialization (Biomedical Engineering major)'), ['BME-Biomechanical & Rehabilitation Engineering Specialization'], 'renamed since');
  assert.deepEqual(codes('Business Specialization (Computer Science major, BCS or BMath; Software Engineering. Bachelor of)'), ['SE-Business Specialization'], 'a full stop where a comma should be');
  const rules = '<ul><li>No student may enrol in or graduate from: <ul><li>Any two “and Financial Management” bachelor’s degrees.</li></ul></li></ul>';
  const { byProgram } = PR.combosFor([], progs, rules);
  const afm = progs.list.find((p) => p.code === 'H-Accounting & Financial Management');
  assert.deepEqual(byProgram.get(afm.pid).map((o) => [o.text, o.to.map((p) => p.code), o.rule]), [['Another “and Financial Management” degree', ['H-Computing & Financial Management'], true]]);
  assert.deepEqual(PR.combosFor([], progs, '<p>Nothing about degrees.</p>').byProgram.get(afm.pid), [], 'only when the rules say so');
  const page = PR.programPage({ p: afm, programs: progs, combos: new Map([[afm.pid, [{ text: 'Chemical Physics major', to: [] }, { text: 'Geomatics major*', to: [] }, { text: 'Any stand-alone major', to: [] }]]]), cat: { label: '2026–27', pageUrl: 'x' }, known: new Set(), builtAt: new Date(), version: 'v' });
  assert.match(page, /<li>Chemical Physics major <span class="t">\(not in the 2026–27 calendar by this name\)<\/span><\/li>/);
  assert.match(page, /<li>Geomatics major <span class="t">\(no longer offered\)<\/span><\/li>/);
  assert.match(page, /<li>Any stand-alone major<\/li>/);
  const twoMajors = progs.list.filter((q) => q.type === 'Major' && q !== afm).slice(0, 2);
  const grouped = PR.programPage({ p: afm, programs: progs, combos: new Map([[afm.pid, [{ text: 'Any stand-alone major', to: twoMajors, group: true }]]]), cat: { label: '2026–27', pageUrl: 'x' }, known: new Set(), builtAt: new Date(), version: 'v' });
  assert.match(grouped, /<li>Any stand-alone major <span class="t">\(2 majors: every one but joint honours plans\)<\/span><\/li>/, 'as the calendar words it, not 190 links');
});

test('programs: the combinations table’s groups ("Any other stand-alone Arts major")', () => {
  const fac = (e, name) => ({ ...e, facultyCalendarDisplay: { name } });
  const list = [
    fac(progEntry('a', 'va', 'H-Liberal Studies', 'Liberal Studies (Bachelor of Arts - Honours)', 'Major', 'Liberal Studies'), 'Faculty of Arts'),
    fac(progEntry('b', 'vb', 'H-Economics', 'Economics (Bachelor of Arts - Honours)', 'Major', 'Economics'), 'Faculty of Arts'),
    fac(progEntry('c', 'vc', 'H-French', 'French (Bachelor of Arts - Honours)', 'Major', 'French'), 'Faculty of Arts'),
    fac(progEntry('d', 'vd', 'FR-French Teaching Specialization', 'French Teaching Specialization', 'Specialization', 'French'), 'Faculty of Arts'),
    fac(progEntry('e', 've', 'H-Pure Mathematics', 'Pure Mathematics (Bachelor of Mathematics - Honours)', 'Major', 'Pure Mathematics'), 'Faculty of Mathematics'),
    fac(progEntry('f', 'vf', 'H-Mathematical Studies', 'Mathematical Studies (Bachelor of Mathematics - Honours)', 'Major', 'Mathematical Studies'), 'Faculty of Mathematics'),
    fac(progEntry('g', 'vg', 'JH-Statistics', 'Statistics (Joint Honours)', 'Major', 'Statistics'), 'Faculty of Mathematics'),
    fac(progEntry('h', 'vh', 'JH-Biology', 'Biology (Joint Honours)', 'Major', 'Biology'), 'Faculty of Science'),
    fac(progEntry('i', 'vi', 'Economics Minor', 'Economics Minor', 'Minor', 'Economics'), 'Faculty of Arts'),
    fac(progEntry('j', 'vj', 'H-Arts & Business', 'Arts and Business (Bachelor of Arts - Honours)', 'Major', 'Arts and Business'), 'Faculty of Arts'),
  ];
  const details = new Map(list.map((e) => [e.pid, { pid: e.pid }]));
  details.set('j', { pid: 'j', graduationRequirements: '<p>Complete the requirements for a Faculty of Arts honours major or Honours Liberal Studies.</p>' });
  const progs = PR.readPrograms(list, details);
  const one = (code) => progs.list.filter((p) => p.code === code);
  const codes = (text, row) => PR.groupOf(text, one(row), progs).map((p) => p.code).sort();
  assert.deepEqual(codes('Any stand-alone major', 'H-Economics'), ['H-French', 'H-Liberal Studies', 'H-Mathematical Studies', 'H-Pure Mathematics'], 'majors only, and joint honours plans aren’t stand-alone');
  assert.deepEqual(codes('Any other stand-alone Arts major', 'H-Liberal Studies'), ['H-Economics', 'H-French'], 'its faculty’s, and not Arts and Business: it’s taken with another major (Honours Liberal Studies, for one)');
  assert.deepEqual(codes('Any other stand-alone or Mathematics Joint plan', 'H-Mathematical Studies'), ['H-Economics', 'H-French', 'H-Liberal Studies', 'H-Pure Mathematics', 'JH-Statistics'], 'and the Faculty of Mathematics’ joint plans');
  assert.deepEqual(codes('Any other stand-alone major', 'FR-French Teaching Specialization'), ['H-Economics', 'H-Liberal Studies', 'H-Mathematical Studies', 'H-Pure Mathematics'], '“other”: not the French major it’s part of');
  assert.deepEqual(codes('Any plan similar to one appearing on the student’s Laurier academic record transcript', 'H-Economics'), [], 'a group it can’t read stays as written');
});

test('programs: whole degrees, renamed programs and "any second" in the combinations table', () => {
  const list = [
    progEntry('a', 'va', 'Degree Reqs: BMath', 'Bachelor of Mathematics Degree Requirements', 'Degree Requirements', 'Degree Requirements'),
    progEntry('b', 'vb', 'H-Pure Mathematics', 'Pure Mathematics (Bachelor of Mathematics - Honours)', 'Major', 'Pure Mathematics'),
    progEntry('c', 'vc', '3G-Mathematics', 'Mathematics (Bachelor of Mathematics, Three-Year General)', 'Major', 'Mathematics'),
    progEntry('d', 'vd', 'H-BBA & BMath Double Degree', 'Business Administration and Mathematics Double Degree (Bachelor of Business Administration and Bachelor of Mathematics - Honours)', 'Major', 'Mathematics and Business'),
    progEntry('e', 've', 'H-Science & Financial Management', 'Science and Financial Management (Bachelor of Science and Financial Management - Honours)', 'Major', 'Science and Financial Management'),
    progEntry('f', 'vf', 'H-Biology', 'Biology (Bachelor of Science - Honours)', 'Major', 'Biology'),
    progEntry('g', 'vg', 'Mathematics Minor', 'Mathematics Minor', 'Minor', 'Mathematics'),
    progEntry('h', 'vh', 'H-Sport & Recreation Management', 'Sport and Recreation Management (Bachelor of Arts - Honours)', 'Major', 'Sport and Recreation Management'),
    progEntry('i', 'vi', 'JH-Sport & Recreation Management', 'Sport and Recreation Management (Joint Honours)', 'Major', 'Sport and Recreation Management'),
    progEntry('j', 'vj', 'Technical & Professional Writing Minor', 'Technical and Professional Writing Minor', 'Minor', 'English'),
    progEntry('k', 'vk', 'H-English - Literature', 'English - Literature (Bachelor of Arts - Honours)', 'Major', 'English'),
    progEntry('l', 'vl', 'H-English - Rhetoric', 'English - Rhetoric, Media, and Professional Communication (Bachelor of Arts - Honours)', 'Major', 'English'),
  ];
  const progs = PR.readPrograms(list, new Map(list.map((e) => [e.pid, { pid: e.pid }])));
  const idx = PR.nameIndex(progs);
  const codes = (name) => PR.matchName(name, idx, progs).map((p) => p.code).sort();
  const bmath = ['3G-Mathematics', 'Degree Reqs: BMath', 'H-BBA & BMath Double Degree', 'H-Pure Mathematics'];
  assert.deepEqual(codes('Mathematics, Bachelor of'), bmath, 'every plan that leads to the degree, and its requirements');
  assert.deepEqual(codes('Science, Bachelor of'), ['H-Biology'], 'not the Bachelor of Science and Financial Management');
  assert.deepEqual(codes('Recreation and Sport Business major'), ['H-Sport & Recreation Management', 'JH-Sport & Recreation Management'], 'renamed since');
  assert.equal(PR.renamedTo('Technical Writing Minor'), 'technical and professional writing minor');
  assert.deepEqual(codes('Technical Writing Minor'), ['Technical & Professional Writing Minor']);
  const rows = [
    { plan: 'English majors', faculty: 'Arts', cannot: ['any second English major', 'Technical Writing Minor'] },
    { plan: 'Mathematics, Bachelor of', faculty: 'Mathematics', cannot: ['Mathematics Minor'] },
    { plan: 'Mathematics Minor', faculty: 'Mathematics', cannot: ['Students who have completed a Diploma in Math'] },
  ];
  const { byProgram, stats } = PR.combosFor(rows, progs);
  assert.deepEqual(stats, { rows: 3, plans: 3, names: 4, matched: 3 });
  const of = (code) => byProgram.get(progs.list.find((p) => p.code === code).pid).map((o) => [o.text, o.to.map((p) => p.code).sort()]);
  assert.deepEqual(of('H-English - Literature'), [['any second English major', ['H-English - Rhetoric']], ['Technical Writing Minor', ['Technical & Professional Writing Minor']]], 'each English major: the others');
  assert.deepEqual(of('Mathematics Minor'), [['Mathematics, Bachelor of', bmath], ['Students who have completed a Diploma in Math', []]], 'BMath students can’t take the Mathematics Minor');
  // Pathways: the pairs, and what the table says in words for the plan's panel.
  const minor = PW.pathwaysPrograms({ programs: progs, combos: byProgram }).find((p) => p.c === 'Mathematics Minor');
  assert.deepEqual(minor.cant.sort(), ['3g-mathematics', 'degree-reqs-bmath', 'h-bba-and-bmath-double-degree', 'h-pure-mathematics']);
  assert.deepEqual(minor.cn, ['Students who have completed a Diploma in Math']);
});

test('programs and pathways: the calendar’s general rules on combining credentials', () => {
  const pl = (s, n, t, fi, f = '', extra = {}) => ({ s, n, t, fi, f, ...extra });
  const anth = pl('h-anthropology', 'Anthropology (Bachelor of Arts - Honours)', 'Major', 'Anthropology', 'Faculty of Arts');
  const anthMinor = pl('anthropology-minor', 'Anthropology Minor', 'Minor', 'Anthropology', 'Faculty of Arts');
  const se = pl('h-software-engineering', 'Software Engineering (Bachelor of Software Engineering - Honours)', 'Major', 'Software Engineering', 'Faculty of Engineering');
  const seOpt = pl('software-engineering-option', 'Software Engineering Option', 'Option', 'Options: Faculty of Engineering', 'Faculty of Engineering', { deg: ['Bachelor of Applied Science', 'Bachelor of Architectural Studies'] });
  const aiOpt = pl('artificial-intelligence-option', 'Artificial Intelligence Option', 'Option', 'Options: Faculty of Engineering', 'Faculty of Engineering', { deg: ['Bachelor of Applied Science', 'Bachelor of Software Engineering'] });
  const cmwMinor = pl('church-music-and-worship-minor', 'Church Music and Worship Minor', 'Minor', 'Church Music and Worship', 'Faculty of Arts');
  const cmwDip = pl('church-music-and-worship-diploma', 'Diploma in Church Music and Worship', 'Diploma', 'Church Music and Worship', 'Faculty of Arts');
  const jp1 = pl('japanese-language-i-diploma', 'Diploma in Japanese Language I', 'Diploma', 'Japanese', 'Faculty of Arts');
  const jp2 = pl('japanese-language-ii-diploma', 'Diploma in Japanese Language II', 'Diploma', 'Japanese', 'Faculty of Arts');
  const ko1 = pl('korean-language-i-diploma', 'Diploma in Korean Language I', 'Diploma', 'Korean', 'Faculty of Arts');
  const bas = pl('h-architectural-studies', 'Architectural Studies (Bachelor of Architectural Studies - Honours)', 'Major', 'Architectural Studies', 'Faculty of Engineering');
  const bmsc = pl('h-medical-sciences', 'Medical Sciences (Bachelor of Medical Sciences - Honours)', 'Major', 'Medical Sciences', 'Faculty of Science');
  const chemMinor = pl('chemistry-minor', 'Chemistry Minor', 'Minor', 'Chemistry', 'Faculty of Science');
  const econMinor = pl('economics-minor', 'Economics Minor', 'Minor', 'Economics', 'Faculty of Arts');
  const jhstat = pl('jh-statistics', 'Statistics (Joint Honours)', 'Major', 'Statistics', 'Faculty of Mathematics');
  const jhbio = pl('jh-biology', 'Biology (Joint Honours)', 'Major', 'Biology', 'Faculty of Science');
  const dsbcs = pl('h-data-science-bcs', 'Data Science (Bachelor of Computer Science - Honours)', 'Major', 'Data Science', 'Faculty of Mathematics');
  const dsbmath = pl('h-data-science-bmath', 'Data Science (Bachelor of Mathematics - Honours)', 'Major', 'Data Science', 'Faculty of Mathematics');
  const bbabcs = pl('h-bba-and-bcs-double-degree', 'Business Administration and Computer Science Double Degree (Bachelor of Business Administration and Bachelor of Computer Science - Honours)', 'Major', 'Computer Science', 'Faculty of Mathematics');
  const pmath = pl('h-pure-mathematics', 'Pure Mathematics (Bachelor of Mathematics - Honours)', 'Major', 'Pure Mathematics', 'Faculty of Mathematics', { co: 1, re: 1 });
  const phil = pl('h-philosophy', 'Philosophy (Bachelor of Arts - Honours)', 'Major', 'Philosophy', 'Faculty of Arts', { re: 1 });
  assert.equal(PE.planClash(anth, anthMinor), 'a minor in the same subject as a major');
  assert.equal(PE.planClash(seOpt, se), 'an option in the same subject as a major', 'either way round');
  assert.equal(PE.planClash(cmwMinor, cmwDip), 'a minor and a diploma in the same subject');
  assert.equal(PE.planClash(jp1, jp2), 'two diplomas in the same language');
  assert.equal(PE.planClash(jp1, ko1), '');
  assert.equal(PE.planClash(bas, aiOpt), 'a BAS student takes only the Faculty of Engineering options that allow it');
  assert.equal(PE.planClash(bas, seOpt), '', 'the Software Engineering Option says it’s for BAS students');
  assert.equal(PE.planClash(bmsc, chemMinor), 'a BMSc student takes no Faculty of Science minor or option');
  assert.equal(PE.planClash(bmsc, econMinor), '', 'another faculty’s minor is fine');
  assert.equal(PE.planClash(jhstat, jhbio), 'a BMath joint honours plan doesn’t combine with another faculty’s joint honours plan');
  assert.equal(PE.planClash(dsbmath, pmath), 'Data Science doesn’t combine with another Faculty of Mathematics honours plan');
  assert.equal(PE.planClash(dsbcs, bbabcs), '', 'the BCS (Data Science) can be the BBA and BCS double degree’s BCS half');
  assert.equal(PE.planClash(pmath, phil), '', 'outside co-op');
  assert.equal(PE.planClash(pmath, phil, { coop: true }), 'in co-op, a BCS or BMath honours plan doesn’t combine with an honours plan that has no co-op');
  assert.equal(PE.planClash(pmath, { ...phil, co: 1 }, { coop: true }), '', 'one with co-op too is fine');
  // On the program pages: one line per rule, and not in Pathways' pairs (its app applies the rules).
  const list = [progEntry('a', 'va', 'H-Economics', 'Economics (Bachelor of Arts - Honours)', 'Major', 'Economics'), progEntry('b', 'vb', '3G-Economics', 'Economics (Bachelor of Arts - Three-Year General)', 'Major', 'Economics'), progEntry('c', 'vc', 'Economics Minor', 'Economics Minor', 'Minor', 'Economics')];
  const progs = PR.readPrograms(list, new Map(list.map((e) => [e.pid, { pid: e.pid }])));
  const byProgram = PR.addGeneralCombos(new Map(), progs, PW.pathwaysPrograms({ programs: progs, combos: new Map() }), (x, y) => PE.planClash(x, y));
  const minor = progs.list.find((p) => p.code === 'Economics Minor');
  assert.deepEqual(byProgram.get(minor.pid).map((o) => [o.text, o.to.map((q) => q.code).sort(), o.general]), [['A minor in the same subject as a major', ['3G-Economics', 'H-Economics'], true]]);
  const page = PR.programPage({ p: minor, programs: progs, combos: byProgram, cat: { label: '2026–27', pageUrl: 'x' }, known: new Set(), builtAt: new Date(), version: 'v' });
  assert.match(page, /<li>A minor in the same subject as a major <span class="t">\(<a href="\/programs\/h-economics\/">Economics \(Bachelor of Arts - Honours\)<\/a>, <a href="\/programs\/3g-economics\/">/);
  assert.match(page, /From the calendar’s <a href="\/programs\/combinations\/">general rules on combining credentials<\/a>/);
  assert.equal(PW.pathwaysPrograms({ programs: progs, combos: byProgram }).find((p) => p.c === 'Economics Minor').cant, undefined);
});

// ---------------- pathways (/pathways/) ----------------

const PE = await import('../site/pathways/engine.js');
const PW = await import('./lib/pathways.mjs');

test('pathways: leads, words and co-op charts become rules the grid can check', () => {
  assert.deepEqual(PW.kindOf('Complete all the following:'), ['all']);
  assert.deepEqual(PW.kindOf('Must have completed at least 1 of the following:'), ['n', 1]);
  assert.deepEqual(PW.kindOf('Earned a minimum grade of 60% in each of the following:'), ['all']);
  assert.deepEqual(PW.kindOf('Not completed nor concurrently enrolled in any of the following:'), ['not']);
  assert.deepEqual(PW.kindOf('Complete no more than 1 from the following:'), ['max', 1]);
  assert.deepEqual(PW.kindOf('Choose any of the following:'), ['any']);
  assert.deepEqual(PW.kindOf('Must have completed or be concurrently enrolled in the following:'), ['all']);
  assert.deepEqual(PW.kindOf('Must have completed or be concurrently enrolled in at least 1 of the following:'), ['n', 1]);
  assert.deepEqual(PW.hints('Students must be in level 3A or higher'), { t: 'Students must be in level 3A or higher', lv: '3A' });
  assert.equal(PW.hints('Enrolled in H-Software Engineering').en, 'H-Software Engineering');
  assert.deepEqual(PW.hints('Complete 1.5 additional units of ECON courses at the 300-level or above'), { t: 'Complete 1.5 additional units of ECON courses at the 300-level or above', u: 1.5, subj: ['ECON'], min: 3 });
  assert.deepEqual(PW.hints('Complete 1 additional course at the 300- or 400-level from: ACTSC, AMATH, CO').subj, ['ACTSC', 'AMATH', 'CO']);
  assert.equal(PW.hints('Complete 1 additional course at the 300- or 400-level from: ACTSC, AMATH, CO').min, 3);
  assert.deepEqual(PW.hints('Complete 1 additional CS course chosen from CS340-CS398, CS440-CS489').rg, [['CS', 340, 398], ['CS', 440, 489]]);
  assert.equal(PW.hints('Complete 4 approved electives').pl, 1);
  assert.equal(PW.hints('See Additional Constraints when selecting courses.').info, 1);
  assert.equal(PW.hints('Complete a total of seven courses according to the requirements below.').info, 1);
  const tree = [{ type: 'group', lead: 'Complete 1 of the following', items: [{ type: 'rule', lead: 'Must have completed the following:', courses: [{ code: 'CS136' }] }, { type: 'text', text: 'Students must be in level 2A or higher' }] }];
  assert.deepEqual(PW.compact(tree), [{ g: 'n', n: 1, i: [{ r: 'all', c: ['CS136'] }, { t: 'Students must be in level 2A or higher', lv: '2A' }] }]);
  assert.deepEqual(PW.totalUnits('<ul><li>Complete a total of 20.0 units:</li></ul>'), { u: 20 });
  assert.deepEqual(PW.totalUnits('<p>Complete a total of 4.0 units of GSJ courses.</p>'), { u: 4, subj: ['GSJ'] });
  assert.deepEqual(PW.totalUnits('<p>Three-year: a total of 15.0 units, with … Honours: a total of 20.0 units.</p>', { all: true }), [15, 20]);
  assert.deepEqual(PW.totalUnits('<p>General degree: Complete a minimum of 15.0 units</p><p>Honours degree: Complete a minimum of 20.0 units, exceptions noted below. A minimum of 12.5 units must be at the 200-level.</p>', { all: true }), [15, 20]);
  assert.equal(PW.totalUnits('<p>Complete a minimum of 2.0 units at the 300-level.</p>'), null, 'a program’s own total says "a total of"');
  const seq = PW.sequences('<table><thead><tr><th>Sequence</th><th>F</th><th>W</th><th>S</th><th>F</th></tr></thead><tbody><tr><td>1</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td></tr></tbody></table><table><tr><th>Key</th><th>Description</th></tr></table>');
  assert.deepEqual(seq, [{ label: '1', start: 'F', terms: ['1A', '1B', 'WT', '2A'] }]);
});

test('pathways: requisites against earlier terms, levels and plans', () => {
  assert.deepEqual(PE.levels([{ kind: 'study' }, { kind: 'study' }, { kind: 'off' }, { kind: 'study' }, { kind: 'coop' }]), ['1A', '1B', null, '2A', null]);
  assert.equal(PE.nextTerm('1269'), '1271');
  assert.equal(PE.nextTerm('1275'), '1279');
  assert.equal(PE.termName('1271'), 'Winter 2027');
  const pre = [{ g: 'all', i: [{ r: 'n', n: 1, c: ['ECON101', 'MSE263'] }, { t: 'Students must be in level 3A or higher', lv: '3A' }] }];
  assert.equal(PE.holds(pre, new Set(['ECON101']), { level: '3A' }), true);
  assert.equal(PE.holds(pre, new Set(['ECON101']), { level: '2B' }), false, 'too early');
  assert.equal(PE.holds(pre, new Set(), { level: '3A' }), false);
  assert.deepEqual(PE.missing(pre, new Set(), { level: '3A' }), ['ECON101', 'MSE263']);
  assert.equal(PE.holds(pre, new Set(['MSE263']), {}), null, 'no level known: can’t tell');
  const enr = [{ g: 'n', n: 1, i: [{ t: 'Enrolled in H-Software Engineering', en: 'H-Software Engineering' }, { t: 'Enrolled in an Honours Mathematics program', en: 'an Honours Mathematics program' }] }];
  assert.equal(PE.holds(enr, new Set(), { plans: [] }), null);
  assert.equal(PE.holds(enr, new Set(), { plans: [{ code: 'H-Software Engineering', faculty: 'Faculty of Engineering', name: 'Software Engineering' }] }), true);
  assert.equal(PE.holds(enr, new Set(), { plans: [{ code: 'H-Pure Mathematics', faculty: 'Faculty of Mathematics', name: 'Pure Mathematics' }] }), true);
  assert.equal(PE.holds([{ r: 'all', c: ['CS136'] }], new Set(['CS136'])), true);
  assert.equal(PE.holds([{ r: 'all', c: ['CS135'] }], new Set(['CS145']), { equiv: new Map([['CS135', ['CS145']]]) }), true, 'a cross-listed course counts');
  assert.equal(PE.holds([{ r: 'not', c: ['MATH229'] }], new Set(['MATH229'])), false);
});

test('pathways: a program’s progress, and what’s still open', () => {
  const pp = { s: 'econ-pp', n: 'Public Policy Specialization (Economics)', t: 'Specialization', req: [{ h: 'Required Courses', r: [{ g: 'all', i: [{ r: 'all', c: ['ECON361', 'ECON441'] }, { r: 'n', n: 2, c: ['ECON351', 'ECON363', 'ECON366'] }] }], l: [] }] };
  const minor = {
    s: 'econ-minor',
    n: 'Economics Minor',
    t: 'Minor',
    req: [
      { h: 'Required Courses', r: [{ r: 'all', c: ['ECON101', 'ECON102'] }], l: [] },
      { h: 'Electives', r: [{ t: 'Complete 1.0 additional units of ECON courses at the 300-level or above', u: 1, subj: ['ECON'], min: 3 }, { t: 'See Additional Constraints when selecting courses.', info: 1 }, { t: 'Complete one course from an approved list', nc: 1 }], l: [] },
    ],
  };
  const planned = new Map(['ECON101', 'ECON102', 'ECON361', 'ECON351', 'ECON363'].map((c) => [c, { units: 0.5 }]));
  const a = PE.evaluate(pp, planned);
  assert.deepEqual([a.need, a.have], [4, 3]);
  assert.deepEqual([...a.used].sort(), ['ECON351', 'ECON361', 'ECON363']);
  const b = PE.evaluate(minor, planned);
  assert.deepEqual([b.need, b.have], [4, 4], 'two required, and 1.0 unit of 300-level ECON from the rest');
  assert.equal(b.unknown, true, 'a rule in words is left to tick');
  assert.equal(b.rows.find((r) => r.kind === 'units').got.length, 2);
  const ticked = PE.evaluate(minor, planned, { ticked: new Set(['econ-minor:s1.2']) });
  assert.equal(ticked.unknown, false);
  const n1 = { s: 'x', n: 'X', t: 'Minor', req: [{ h: '', r: [{ g: 'n', n: 1, i: [{ r: 'all', c: ['A1', 'A2'] }, { r: 'all', c: ['B1'] }] }], l: [] }] };
  const e = PE.evaluate(n1, new Map([['B1', { units: 0.5 }]]));
  assert.deepEqual([e.need, e.have], [1, 1], 'a group takes the option furthest along');
  assert.equal(e.rows.filter((r) => r.kind === 'all').length, 1, 'trying options leaves no rows behind');
  const open = PE.directions([pp, minor, n1], planned, { chosen: [], cant: new Map([['econ-minor', new Set(['econ-pp'])]]) });
  assert.deepEqual(open.map((x) => [x.p.s, x.left]), [['econ-minor', 0], ['econ-pp', 1], ['x', 1]]);
  const chosen = PE.directions([pp, minor, n1], planned, { chosen: ['econ-pp'], cant: new Map([['econ-minor', new Set(['econ-pp'])]]) });
  assert.deepEqual(chosen.map((x) => [x.p.s, x.blocked]), [['x', []], ['econ-minor', ['econ-pp']]], 'ones that can’t combine go last');
});

test('pathways: plans named short for chips and the list, by faculty', () => {
  const parts = (n, t) => PE.planParts({ n, t });
  assert.deepEqual(parts('Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)', 'Major'), { name: 'Accounting and Financial Management', kind: 'BAFM Honours', of: 'Bachelor of Accounting and Financial Management' });
  assert.equal(parts('Computer Science (Bachelor of Mathematics - Joint Honours)', 'Major').kind, 'BMath Joint Honours', 'the degree tells a BCS from a BMath');
  assert.equal(parts('Psychology (Bachelor of Science - Honours)', 'Major').kind, 'BSc Honours');
  assert.equal(parts('Social Development Studies and Social Work Double Degree (Bachelor of Arts - Three-Year General and Bachelor of Social Work - Honours)', 'Major').kind, 'BA Three-Year General and BSW Honours');
  assert.equal(parts('Business Administration and Mathematics Double Degree (Bachelor of Business Administration and Bachelor of Mathematics - Honours)', 'Major').kind, 'BBA and BMath Honours');
  assert.equal(parts('Science and Financial Management (Bachelor of Science and Financial Management - Honours)', 'Major').kind, 'Honours', 'not a BSc');
  assert.equal(parts('Pharmacy (Doctor of Pharmacy)', 'Major').kind, 'PharmD');
  assert.deepEqual(parts('Biology (Joint Honours)', 'Major'), { name: 'Biology', kind: 'Joint Honours', of: '' });
  assert.deepEqual(parts('Arts and Business', 'Major'), { name: 'Arts and Business', kind: 'Major', of: '' });
  assert.deepEqual(parts('Artificial Intelligence Specialization (Software Engineering)', 'Specialization'), { name: 'Artificial Intelligence', kind: 'Specialization', of: 'Software Engineering' });
  assert.deepEqual(parts('Economics Minor', 'Minor'), { name: 'Economics', kind: 'Minor', of: '' });
  assert.equal(parts('Diploma in Business and Entrepreneurship', 'Diploma').name, 'Business and Entrepreneurship');
  assert.equal(parts('Certificate in Experiential Education (EDGE)', 'Certificate').name, 'Experiential Education (EDGE)');
  assert.deepEqual(parts('Bachelor of Arts Degree Requirements (Health)', 'Degree Requirements'), { name: 'Bachelor of Arts', kind: 'Degree requirements', of: 'Health' });
  const fac = (f) => PE.facultyOf({ f });
  assert.deepEqual(fac('Faculty of Arts with Renison University College'), { group: 'Arts', college: 'Renison' });
  assert.deepEqual(fac("Faculty of Arts with St. Jerome's University"), { group: 'Arts', college: "St. Jerome's" });
  assert.deepEqual(fac('Renison University College'), { group: 'Arts', college: 'Renison' }, 'Social Work');
  assert.deepEqual(fac('Faculties of Arts, Health, and Science'), { group: 'Arts, Health and Science', college: null });
  assert.deepEqual(fac(''), { group: '', college: null }, 'EDGE, university-wide');
  const order = ['', 'Engineering and Mathematics', 'Science', 'Arts', 'Mathematics'].sort((a, b) => PE.facultyRank(a) - PE.facultyRank(b));
  assert.deepEqual(order, ['Arts', 'Mathematics', 'Science', 'Engineering and Mathematics', '']);
});

test('pathways: every plan by faculty and field, and what each is taken with', () => {
  const plan = (s, n, t, fi, extra = {}) => ({ s, n, t, fi, f: 'Faculty of Arts', ...extra });
  const programs = [
    plan('econ-pp', 'Public Policy Specialization (Economics)', 'Specialization', 'Economics', { open: ['h-econ', '4g-econ'] }),
    plan('h-econ', 'Economics (Bachelor of Arts - Honours)', 'Major', 'Economics'),
    plan('econ-minor', 'Economics Minor', 'Minor', 'Economics'),
    plan('4g-econ', 'Economics (Bachelor of Arts - Four-Year General)', 'Major', 'Economics'),
    plan('arbus', 'Arts and Business', 'Major', 'Arts and Business', { cant: ['h-afm'] }),
    plan('h-afm', 'Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)', 'Major', 'Accounting and Financial Management'),
    plan('h-sds', 'Social Development Studies (Bachelor of Arts - Honours)', 'Major', 'Social Development Studies', { f: 'Faculty of Arts with Renison University College' }),
    plan('ba-reqs', 'Bachelor of Arts Degree Requirements (Arts)', 'Degree Requirements', 'Arts'),
    plan('h-pmath', 'Pure Mathematics (Bachelor of Mathematics - Honours)', 'Major', 'Pure Mathematics', { f: 'Faculty of Mathematics' }),
    plan('jh-pmath', 'Pure Mathematics (Joint Honours)', 'Major', 'Pure Mathematics', { f: 'Faculty of Mathematics' }),
    plan('ai-option', 'Artificial Intelligence Option', 'Option', 'Options: Faculty of Engineering', { f: 'Faculty of Engineering', open: ['h-ce'] }),
  ];
  const laid = PE.byField(programs);
  assert.deepEqual(laid.map((g) => g.group), ['Arts', 'Engineering', 'Mathematics']);
  const econ = laid[0].rows.find((r) => r.field === 'Economics');
  assert.deepEqual(econ.plans.map((p) => p.s), ['h-econ', '4g-econ', 'econ-minor', 'econ-pp'], 'honours, general, minor, then its specializations');
  assert.equal(laid[0].rows.find((r) => r.field === 'Social Development Studies').college, 'Renison');
  assert.ok(!laid.flatMap((g) => g.rows).some((r) => r.plans.some((p) => p.t === 'Degree Requirements')));
  assert.deepEqual(laid[1].rows.map((r) => r.field), ['Options'], 'a faculty’s options share a row');
  assert.deepEqual(laid[2].rows[0].plans.map((p) => p.s), ['h-pmath', 'jh-pmath']);
  const arbus = PE.takenWith(programs.find((p) => p.s === 'arbus'), programs);
  assert.match(arbus.text, /Faculty of Arts honours major/);
  assert.deepEqual(arbus.plans.map((p) => p.s), ['h-econ', 'h-sds'], 'Arts honours majors, not general ones or ones it can’t go with');
  assert.deepEqual(PE.takenWith(programs[0], programs).plans.map((p) => p.s), ['h-econ', '4g-econ'], 'a specialization, with its majors');
  assert.deepEqual(PE.takenWith(programs.find((p) => p.s === 'jh-pmath'), programs).plans, [], 'a joint major names none');
  assert.equal(PE.takenWith(programs.find((p) => p.s === 'econ-minor'), programs), null);
  assert.deepEqual(PE.openTo(programs.find((p) => p.s === 'h-econ'), programs).map((p) => p.s), ['econ-pp']);
  const older = PE.byField([...programs, { s: 'old-spec', n: 'Sustainability Specialization (Economics)', t: 'Specialization', fi: 'Economics' }]);
  assert.ok(older[0].rows.find((r) => r.field === 'Economics').plans.some((p) => p.s === 'old-spec'), 'a plan with no faculty goes with its field’s');
});

test('every plan’s rules in words, as courses: program, course and subject pages', async () => {
  const { fittingCodes, wordsFits, subjectPlans, hints } = await import('./lib/pathways.mjs');
  const { fitsHtml, countsSection } = await import('./lib/programs.mjs');
  const { subjectPlansSection } = await import('./lib/render.mjs');
  const { renderTree } = await import('./lib/requisites.mjs');
  const codes = ['ECON101', 'ECON201', 'ECON361', 'ECON490', 'CS341', 'CS450', 'PSYCH101'];
  assert.deepEqual(fittingCodes(hints('Complete 2.0 additional units of ECON courses at the 200-level or above'), codes), ['ECON201', 'ECON361', 'ECON490']);
  assert.deepEqual(fittingCodes(hints('Complete 1.0 unit from CS340-CS398, CS440-CS489'), codes), ['CS341', 'CS450']);
  assert.deepEqual(fittingCodes({ subj: ['ECON', 'PSYCH'], nos: ['PSYCH'] }, codes), ['ECON101', 'ECON201', 'ECON361', 'ECON490'], 'a breadth rule’s subjects left out');

  const minor = { s: 'economics-minor', t: 'Minor', req: [{ h: 'Required Courses', r: [{ r: 'all', c: ['ECON101', 'ECON102', 'ECON201'] }, { t: 'Complete 2.0 additional units of ECON courses at the 200-level or above', u: 2, subj: ['ECON'], min: 2 }], l: [] }] };
  const major = { s: 'h-cs', t: 'Major', req: [{ h: '', r: [{ r: 'all', c: ['CS135', 'CS136', 'CS341', 'MATH135', 'MATH136'] }], l: [{ h: 'List', r: [{ t: 'Complete 1.0 unit from CS340-CS398, CS440-CS489', u: 1, rg: [['CS', 340, 398], ['CS', 440, 489]] }], l: [] }] }] };
  const degree = { s: 'ba', t: 'Degree Requirements', req: [{ h: '', r: [{ r: 'all', c: ['ECON101', 'ECON102'] }], l: [] }] };
  const fits = wordsFits([minor, major, degree], codes);
  assert.deepEqual(fits.get('ECON361'), [{ s: 'economics-minor', t: ['Complete 2.0 additional units of ECON courses at the 200-level or above'] }]);
  assert.deepEqual(fits.get('CS450').map((x) => x.s), ['h-cs']);
  assert.equal(fits.get('ECON101'), undefined, 'below the level');
  const bySubject = subjectPlans([minor, major, degree]);
  assert.deepEqual(bySubject.get('ECON'), [{ s: 'economics-minor', named: 3, words: ['Complete 2.0 additional units of ECON courses at the 200-level or above'] }], 'degree requirements left out');
  assert.deepEqual(bySubject.get('MATH').map((x) => x.s), ['h-cs'], 'names two MATH courses');
  assert.deepEqual(bySubject.get('CS')[0], { s: 'h-cs', named: 3, words: ['Complete 1.0 unit from CS340-CS398, CS440-CS489'] });

  const courses = new Map(codes.map((c) => [c, { title: `Title of ${c}` }]));
  const html = fitsHtml('Complete 2.0 additional units of ECON courses at the 200-level or above', { courses, subjects: new Set(['ECON']), yearCode: '2627' });
  assert.match(html, /3 courses fit/);
  assert.match(html, /href="\/econ361\/" title="Title of ECON361">ECON 361</);
  assert.match(html, /href="\/2627\/econ\/">Every ECON course/);
  assert.equal(fitsHtml('Complete all of the following', { courses, subjects: new Set(), yearCode: '2627' }), '');
  const tree = [{ type: 'text', text: 'Complete 2.0 additional units of ECON courses at the 200-level or above' }];
  assert.match(renderTree(tree, new Set(), null, { words: (t) => `<i>${t.length}</i>` }), /<li class="x">.*<i>\d+<\/i><\/li>/);

  const prog = (slug, name, type) => ({ slug, name, type });
  const counts = countsSection('ECON361', [], { label: '2026–27' }, [{ p: prog('economics-minor', 'Economics Minor', 'Minor'), rules: ['Complete 2.0 additional units of ECON courses at the 200-level or above'] }]);
  assert.match(counts, /Rules in words it fits <span class="t">1<\/span>/);
  assert.match(counts, /Economics Minor<\/a> <span class="t">Minor · Complete 2.0/);
  assert.equal(countsSection('ECON999', [], { label: '2026–27' }, []), '');
  const sp = subjectPlansSection('ECON', [{ p: prog('economics-minor', 'Economics Minor', 'Minor'), named: 3, words: ['Complete 2.0 additional units of ECON courses at the 200-level or above'] }]);
  assert.match(sp, /Plans built on ECON courses<\/h2> <span class="t">1: 1 minor</);
  assert.match(sp, /names 3 ECON courses; 2.0 additional units/);
  assert.match(sp, /href="\/pathways\/#show=economics-minor"/);
});

test('graduate programs: names, pages, counts toward, Pathways’ list', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { readPrograms, countsSection } = await import('./lib/programs.mjs');
  const G = await import('./lib/gradprograms.mjs');
  assert.deepEqual(G.gradParts('Master of Mathematics (MMath) in Computer Science - Co-operative Program (transfer entry)'), { degree: 'MMath', subject: 'Computer Science', variant: 'Co-operative Program (transfer entry)' });
  assert.deepEqual(G.gradParts('Graduate Diploma (GDip) in Business and Entrepreneurship (Type 3/Direct-entry)'), { degree: 'GDip', subject: 'Business and Entrepreneurship', variant: 'Type 3/Direct-entry' });
  assert.deepEqual(G.gradParts("Accelerated Master's Program in Biostatistics"), { degree: 'Accelerated master’s', subject: 'Biostatistics', variant: '' });
  assert.deepEqual(G.gradParts('Master of Business, Entrepreneurship and Technology (MBET)'), { degree: 'MBET', subject: '', variant: '' });
  assert.deepEqual(G.gradParts('Doctor of Philosophy (PhD) in Earth Sciences - Water'), { degree: 'PhD', subject: 'Earth Sciences', variant: 'Water' });
  assert.deepEqual(G.gradParts("OD-Accelerated Master's Program in Vision Science"), { degree: 'OD and accelerated master’s', subject: 'Vision Science', variant: '' });

  // The probe's real Fall 2026 Graduate Calendar records (data/probe/samples).
  const dir = new URL('../data/probe/samples/', import.meta.url);
  const samples = readdirSync(dir).filter((f) => f.startsWith('programs-fall-2026-gr-')).map((f) => JSON.parse(readFileSync(new URL(f, dir))));
  assert.ok(samples.length >= 5);
  const grad = readPrograms(samples.map((x) => x.indexEntry), new Map(samples.map((x) => [x.indexEntry.pid, x.record])));
  assert.equal(grad.list.length, samples.length);
  assert.ok(grad.list.every((p) => p.level === 'grad' && p.slug && p.name));
  const phd = grad.list.find((p) => /PhD\) in Applied Economics$/.test(p.title));
  assert.equal(phd.type, 'PhD');
  assert.equal(phd.field, 'Economics');
  assert.ok(phd.unit.length > 0 && phd.admit.length > 0);
  const acc = grad.list.find((p) => /Accelerated Master/.test(p.title));
  assert.match(acc.slug, /^accelerated-master-s-program-in-actuarial-science$/, 'no code: slugged by its title');
  const ma = grad.list.find((p) => /Political Science/.test(p.title));
  assert.ok(ma.options.length >= 1);

  const counts = G.gradCounts(grad);
  assert.ok([...counts.values()].flat().some((x) => x.p === phd), 'the PhD names courses');
  const known = { has: () => true, href: (c) => `/${c.toLowerCase()}/`, retired: new Set() };
  const html = G.gradProgramPage({ p: phd, programs: grad, ugPrograms: { list: [{ slug: 'h-economics', name: 'Economics (BA Honours)', type: 'Major', field: 'Economics', level: 'ug' }] }, cat: { label: 'Fall 2026', pageUrl: 'https://example.org/catalog' }, known, builtAt: new Date(), version: 't' });
  assert.match(html, /<h1><span class="title">Doctor of Philosophy \(PhD\) in Applied Economics<\/span><\/h1>/);
  assert.match(html, /<dt>Unit<\/dt>/);
  assert.match(html, /Economics as an undergraduate/);
  assert.match(html, /href="\/programs\/h-economics\/"/);
  assert.match(html, /https:\/\/example\.org\/catalog#\/programs\//);
  assert.match(html, new RegExp(`<a href="/pathways/#grad=${phd.slug}">See it in Pathways</a>`), 'into Pathways, with the plans that lead to it');
  const index = G.gradProgramsIndexPage({ programs: grad, cat: { label: 'Fall 2026' }, builtAt: new Date(), version: 't' });
  assert.match(index, /href="\/programs\/grad\/[a-z0-9-]+\/"/);
  const { list, ct } = G.gradPathways(grad, (c) => `Title ${c}`);
  assert.equal(list.length, grad.list.length);
  assert.ok(list.some((g) => g.ad && g.ad.length <= 262), 'admission in a sentence or two');
  assert.ok(list.every((g) => g.s && g.n && g.t && g.d));
  assert.ok(Object.values(ct).every((t) => t.startsWith('Title ')));
  const one = [...counts.entries()][0];
  assert.match(countsSection(one[0], one[1], { label: 'Fall 2026' }, [], { grad: true }), /Graduate programs in the Fall 2026 Graduate Calendar/);
  assert.match(countsSection('ECON101', [{ p: { slug: 'h-economics', name: 'Economics (BA Honours)', type: 'Major' }, roles: ['Required'] }], { label: '2026–27' }), /<a href="\/pathways\/#course=ECON101">Pathways<\/a> puts it in your grid/);
});

test('pathways: graduate programs in the plan box, and the plans that lead to one', () => {
  const g = (s, n, t, d, su, fi, f, extra = {}) => ({ s, n, t, d, su, fi, f, ...extra });
  const list = [
    g('ma-in-economics', 'Master of Arts (MA) in Economics', "Master's", 'MA', 'Economics', 'Economics', 'Faculty of Arts', { req: [{ h: 'Courses', c: ['ECON601', 'ECON602', 'ECON611'] }] }),
    g('phd-in-economics', 'Doctor of Philosophy (PhD) in Economics', 'PhD', 'PhD', 'Economics', 'Economics', 'Faculty of Arts'),
    g('mmath-in-computer-science', 'Master of Mathematics (MMath) in Computer Science', "Master's", 'MMath', 'Computer Science', 'Computer Science', 'Faculty of Mathematics', { req: [{ h: 'Courses', c: ['CS686', 'CS761', 'CS798'] }] }),
    g('mmath-in-pure-mathematics', 'Master of Mathematics (MMath) in Pure Mathematics', "Master's", 'MMath', 'Pure Mathematics', 'Pure Mathematics', 'Faculty of Mathematics'),
    g('gdip-in-climate-change', 'Graduate Diploma (GDip) in Climate Change (Type 2/Concurrent)', 'Graduate Diploma', 'GDip', 'Climate Change', 'Climate Change', 'Faculty of Environment'),
    g('accelerated-master-s-program-in-statistics', "Accelerated Master's Program in Statistics", "Master's", 'Accelerated master’s', 'Statistics', 'Statistics', 'Faculty of Mathematics'),
  ];
  const names = (q) => PE.gradHits(list, q).hits.map((x) => x.s);
  assert.deepEqual(PE.gradHits(list, 'master'), { hits: PE.gradHits(list, 'master').hits, grad: true });
  assert.deepEqual(names('master'), ['ma-in-economics', 'mmath-in-computer-science', 'mmath-in-pure-mathematics', 'accelerated-master-s-program-in-statistics'], 'master’s, accelerated ones last');
  assert.deepEqual(names('Doctor'), ['phd-in-economics']);
  assert.deepEqual(names('phd'), ['phd-in-economics']);
  assert.ok(PE.gradHits(list, 'doc').grad, 'the start of a word for them asks for them too');
  assert.deepEqual(names('mmath cs'), ['mmath-in-computer-science'], 'initials, as plans');
  assert.deepEqual(names('ma economics'), ['ma-in-economics']);
  assert.equal(PE.gradHits(list, 'ma').grad, false, '“ma” alone starts “math” too');
  assert.equal(PE.gradHits(list, 'economics').grad, false, 'a subject alone: undergraduate plans first');
  assert.deepEqual(names('economics'), ['ma-in-economics', 'phd-in-economics']);
  assert.deepEqual(names('graduate diploma'), ['gdip-in-climate-change']);
  assert.deepEqual(names('econ'), ['ma-in-economics', 'phd-in-economics'], 'a course subject’s letters');
  assert.deepEqual(names('afm'), []);
  const major = (s, n, fi, t = 'Major') => ({ s, n, t, fi });
  const P = [major('h-economics', 'Economics (Bachelor of Arts - Honours)', 'Economics'), major('4g-economics', 'Economics (Bachelor of Arts - Four-Year General)', 'Economics'), major('economics-minor', 'Economics Minor', 'Economics', 'Minor'), major('h-history', 'History (Bachelor of Arts - Honours)', 'History'), { s: 'econ-dr', n: 'Bachelor of Arts Degree Requirements (Arts)', t: 'Degree Requirements', fi: 'Economics' }];
  assert.deepEqual(PE.gradLeads(list[0], P).map((p) => p.s), ['h-economics', '4g-economics', 'economics-minor'], 'majors (honours first), then minors; not degree requirements');
});

test('pathways: two majors that can’t be taken together, beyond the calendar’s table', () => {
  const major = (s, n, fi) => ({ s, n, t: 'Major', fi });
  const econ = major('h-economics', 'Economics (Bachelor of Arts - Honours)', 'Economics');
  const econ4 = major('4g-economics', 'Economics (Bachelor of Arts - Four-Year General)', 'Economics');
  const hist = major('h-history', 'History (Bachelor of Arts - Honours)', 'History');
  const hist3 = major('3g-history', 'History (Bachelor of Arts - Three-Year General)', 'History');
  const cpa = major('h-mathematics-chartered-professional-accountancy', 'Mathematics/Chartered Professional Accountancy (Bachelor of Mathematics - Honours)', 'Mathematics/Chartered Professional Accountancy');
  const afm = major('h-accounting-and-financial-management', 'Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)', 'Accounting and Financial Management');
  const jhstat = major('jh-statistics', 'Statistics (Joint Honours)', 'Statistics');
  assert.equal(PE.majorsClash(econ, econ4), 'two versions of Economics');
  assert.equal(PE.majorsClash(econ, hist3), 'a BA combines two honours majors only, not a general one');
  assert.equal(PE.majorsClash(econ4, hist), 'a BA combines two honours majors only, not a general one', 'either way round');
  assert.equal(PE.majorsClash(econ, hist), '', 'two honours BA majors: a double major');
  assert.equal(PE.majorsClash(econ, jhstat), '', 'joint honours plans pair across faculties');
  assert.equal(PE.majorsClash(cpa, afm), '', 'different degrees alone aren’t a reason (the calendar’s table has AFM’s rule)');
  assert.equal(PE.majorsClash(econ, { s: 'economics-minor', n: 'Economics Minor', t: 'Minor', fi: 'Economics' }), '', 'majors only');
  const bcs = major('h-computer-science-bcs', 'Computer Science (Bachelor of Computer Science - Honours)', 'Computer Science');
  const pmath = major('h-pure-mathematics', 'Pure Mathematics (Bachelor of Mathematics - Honours)', 'Pure Mathematics');
  const jhstatm = { ...jhstat, f: 'Faculty of Mathematics' };
  const jhcs = major('jh-computer-science-bcs', 'Computer Science (Bachelor of Computer Science - Joint Honours)', 'Computer Science');
  assert.equal(PE.majorsClash(bcs, pmath), 'a stand-alone BCS doesn’t combine with any BMath plan');
  assert.equal(PE.majorsClash(jhstatm, bcs), 'a stand-alone BCS doesn’t combine with any BMath plan', 'including Math’s joint honours plans');
  assert.equal(PE.majorsClash(jhcs, pmath), '', 'a BCS joint honours plan isn’t stand-alone');
  const req = (code) => [{ h: 'Required Courses', r: [{ r: 'all', c: [code] }] }];
  const found = PE.directions([{ ...afm, req: req('AFM101') }, { ...hist, req: req('HIST101') }], new Map(), { chosen: [cpa.s], clash: (a, b) => (a === afm.s && b === cpa.s ? 'AFM takes no other major' : '') });
  assert.deepEqual(found.map((x) => [x.p.s, x.blocked]), [['h-history', []], [afm.s, [cpa.s]]], 'directions takes the clash check, and what can’t go with yours comes last');
});

test('pathways: who a plan is for, options by degree, entry programs, other names', () => {
  // What the calendar says when declaring (2026–27's own sentences).
  const el = (fields, audience = []) => PW.eligibility({ text: fields, audience });
  assert.deepEqual(el({ declarationRequirements: '<p>This credential is only open to students enrolled in a Faculty of Mathematics academic plan.</p>' }), { lim: 'Mathematics', who: 'This credential is only open to students enrolled in a Faculty of Mathematics academic plan.' });
  assert.equal(el({ declarationRequirements: '<p>Before declaring, see the table. This credential is open to students enrolled in any degree program in the Faculty of Mathematics.</p>' }).lim, 'Mathematics');
  assert.equal(el({ declarationRequirements: '<p>This credential is open to all Honours students and is generally not available to students outside the Faculty of Mathematics because it includes several restricted courses.</p>' }).soft, 'Mathematics');
  assert.equal(el({ declarationRequirements: '<p>The Joint Honours Mathematics academic plan is only open to non-math students enrolled in an Honours program.</p>' }).notf, 'Mathematics');
  assert.equal(el({ specialNotice: '<p>As a result, the Diploma in Future Cities is currently paused and is not open to new entrants.</p>' }).paused, 1);
  assert.equal(el({}, ['This credential is open to students enrolled in any non- or post-degree academic plan.']).nd, 1);
  assert.deepEqual(el({}, ['This credential is open to students enrolled in degree programs or any non- or post-degree academic plan.']), {}, 'open to everyone');
  assert.deepEqual(el({ declarationRequirements: '<p>Before declaring this academic plan, see invalid credential combinations.</p>' }), {});

  const major = (s, n, f, fi) => ({ s, n, t: 'Major', f, fi });
  const meche = major('h-me', 'Mechanical Engineering (Bachelor of Applied Science - Honours)', 'Faculty of Engineering', 'Mechanical Engineering');
  const kin = major('h-kin', 'Kinesiology (Bachelor of Science - Honours)', 'Faculty of Health', 'Kinesiology');
  const bio = major('h-bio', 'Biology (Bachelor of Science - Honours)', 'Faculty of Science', 'Biology');
  const psychBA = major('h-psych-ba', 'Psychology (Bachelor of Arts - Honours)', 'Faculty of Arts', 'Psychology');
  const psychBSc = major('h-psych-bsc', 'Psychology (Bachelor of Science - Honours)', 'Faculty of Science', 'Psychology');
  const option = (s, n, deg) => ({ s, n, t: 'Option', f: 'Faculty of Engineering', fi: 'Options: Faculty of Engineering', deg });
  const programs = [meche, kin, bio, psychBA, psychBSc, option('mech-opt', 'Mechatronics Option', ['Bachelor of Applied Science', 'Bachelor of Software Engineering']), option('micro-opt', 'Microbiology Option', ['Bachelor of Science (Science)']), option('aging-opt', 'Aging Studies Option', ['Bachelor of Science (Health)', 'Bachelor of Public Health'])];
  assert.deepEqual(PE.degreeNames(kin), ['Bachelor of Science', 'Bachelor of Science (Health)']);
  assert.deepEqual(PE.optionsFor(meche, programs).map((p) => p.s), ['mech-opt']);
  assert.deepEqual(PE.optionsFor(bio, programs).map((p) => p.s), ['micro-opt'], 'a BSc in Science');
  assert.deepEqual(PE.optionsFor(kin, programs).map((p) => p.s), ['aging-opt'], 'a BSc in Health');

  const minor = { s: 'stat-minor', n: 'Statistics Minor', t: 'Minor', lim: 'Mathematics', who: 'Only Math.' };
  assert.deepEqual(PE.whoFor(minor, []), { ok: true, tag: 'Math students only', why: 'Only Math.' }, 'tagged with no major picked');
  assert.equal(PE.whoFor(minor, [bio]).ok, false);
  assert.equal(PE.whoFor(minor, [{ ...bio, f: 'Faculty of Mathematics' }]).ok, true);
  assert.equal(PE.whoFor({ paused: 1 }, []).ok, false);
  assert.equal(PE.whoFor({ notf: 'Mathematics' }, [{ ...bio, f: 'Faculty of Mathematics' }]).ok, false);

  const life = PE.entryProgram('Life Sciences', programs);
  assert.deepEqual(life.majors.map((p) => p.s), ['h-bio', 'h-psych-bsc'], 'Psychology’s BSc, not its BA');
  assert.ok(life.has({ t: 'Minor', fi: 'Biology' }) && !life.has(psychBA));
  assert.deepEqual(PE.entryProgram('Honours Arts', programs).majors.map((p) => p.s), ['h-psych-ba']);
  assert.equal(PE.entryProgram('Nope', programs), null);

  assert.deepEqual(PE.planQueries('Geomatics minor'), [['geomatics', 'minor'], ['geospatial', 'data', 'science', 'minor']]);
  assert.equal(PE.planQueries('economics').length, 1);
  const arbus = { s: 'arbus', n: 'Arts and Business', t: 'Major', req: [] };
  const gbda = { s: 'gbda', n: 'Global Business and Digital Arts (Bachelor of Global Business and Digital Arts - Honours)', t: 'Major', req: [] };
  const q = PE.planQueries('honours arts and business');
  assert.ok(PE.planBest(arbus, q) > PE.planBest(gbda, q), 'the name it’s known by first');
});

test('pathways: the data file and the page', () => {
  const sec = PR.sectionsOf(PUBLIC_POLICY);
  const programs = { list: [{ pid: 'p1', slug: 'econ-pp', name: 'Public Policy Specialization (Economics)', type: 'Specialization', faculty: 'Faculty of Arts', field: 'Economics', code: 'ECON-Public Policy Specialization', sections: sec, availableTo: [], text: { graduationRequirements: '<p>Complete a total of 2.0 units.</p>', coOperativeRequirementsUndergraduate: '' } }], byId: new Map() };
  const catalog = { label: '2026–27', courses: new Map([['ECON351', { title: 'Labour Economics', units: 0.5, prereq: [{ type: 'rule', lead: 'Must have completed the following:', courses: [{ code: 'ECON101' }] }], coreq: null, antireq: null, crossListed: [] }]]) };
  const schedules = new Map([['ECON351', { terms: { 1229: [['001']], 1239: [['001']], 1241: [['001']], 1189: [['001']] } }]]);
  const d = PW.pathwaysData({ programs, combos: new Map(), catalog, schedules, published: { 1271: new Set(['ECON351']) }, curTerm: '1269' });
  assert.deepEqual(d.courses.ECON351, ['Labour Economics', 0.5, [{ r: 'all', c: ['ECON101'] }], 0, 0, [2, 2, 0]], 'two Falls and two Winters in the last four years, counting next term');
  assert.equal(d.courses.ECON361[7], 1, 'a course the program names that isn’t in this calendar');
  assert.equal(d.courses.ECON361[0], 'Cost-Benefit Analysis and Project Evaluation');
  assert.deepEqual(d.programs[0].req[0].r[0].i.map((n) => n.r), ['all', 'n']);
  assert.equal(d.programs[0].tu, 2);
  const g = PE.evaluate({ s: 'g', n: 'GSJ Minor', t: 'Minor', req: [], tsub: { u: 1.5, subj: ['GSJ'] } }, new Map([['GSJ101', { units: 0.5 }], ['GSJ205', { units: 0.5 }], ['ECON101', { units: 0.5 }]]));
  assert.deepEqual([g.need, g.have], [3, 2], 'a total in one subject is counted');
  assert.deepEqual(PE.why([{ g: 'all', i: [{ r: 'n', n: 1, c: ['ECON101', 'MSE263'] }, { t: 'level', lv: '3A' }] }], new Set(), { level: '2A' }), { codes: ['ECON101', 'MSE263'], groups: [['ECON101', 'MSE263']], level: '3A', plans: [] });
  assert.deepEqual(PE.why([{ r: 'n', n: 1, c: ['MATH128', 'MATH138'] }, { r: 'all', c: ['MATH136', 'CS136'] }], new Set(['CS136'])).groups, [['MATH128', 'MATH138'], ['MATH136']], 'each unmet list on its own');
  const page = PW.pathwaysPage({ cat: { label: '2026–27' }, builtAt: new Date(), version: 'v9', curTerm: '1269' });
  assert.match(page, /<link rel="canonical" href="https:\/\/uwloo\.ca\/pathways\/">/);
  assert.match(page, /src="\/pathways\/app\.js\?v=v9"/);
  assert.match(page, /href="\/pathways\/app\.css\?v=v9"/);
});

test('pathways: placeholders, and a course counts toward two plans at most', () => {
  assert.equal(PW.hints('Complete 1 CS course at the 200-, 300-, or 400-level').min, 2);
  assert.equal(PW.hints('Complete 1 additional CS course at the 100-, 200-, 300-, or 400-level').min, 1);
  assert.equal(PW.hints('Complete 1.0 unit of courses, in any combination, chosen from the Faculty of Arts, or from the following subject codes: BET, BUS, COMM, STV.').fa, 1);
  assert.ok(PE.isPlaceholder('PMATH4XX') && PE.isPlaceholder('ECONXXX') && PE.isPlaceholder('ELECTIVE'));
  assert.ok(!PE.isPlaceholder('ECON101') && !PE.isPlaceholder('CS136L'));
  const m = new Map();
  assert.deepEqual([PE.addPlanned(m, 'PMATH4XX'), PE.addPlanned(m, 'PMATH4XX'), PE.addPlanned(m, 'ECON101')], ['PMATH4XX', 'PMATH4XX#2', 'ECON101']);
  const pm = { s: 'pm', n: 'Pure Mathematics', t: 'Major', req: [{ h: 'Required Courses', r: [{ g: 'all', i: [{ r: 'all', c: ['PMATH347'] }, { t: 'Complete 3 additional PMATH courses at the 400-level', nc: 3, subj: ['PMATH'], min: 4 }, { t: 'Complete 1.0 unit from the Faculty of Arts', u: 1, fa: 1 }, { t: 'Complete 1 additional ECON course', nc: 1, subj: ['ECON'] }] }], l: [] }] };
  const planned = new Map();
  for (const c of ['PMATH347', 'PMATH4XX', 'PMATH4XX', 'PMATH3XX', 'ELECTIVE', 'ELECTIVE', 'ECONXXX']) PE.addPlanned(planned, c);
  const ev = PE.evaluate(pm, planned);
  assert.deepEqual([ev.need, ev.have], [7, 6], '2 of 3 PMATH 400-level (a 300-level one doesn’t count), 2 electives for the Arts unit, ECONXXX for the ECON course');
  assert.ok(!ev.used.has('PMATH3XX'));
  const major = { s: 'mj', n: 'Economics', t: 'Major', req: [{ h: '', r: [{ r: 'all', c: ['ECON101', 'ECON102'] }], l: [] }] };
  const spec = { s: 'sp', n: 'Public Policy Specialization', t: 'Specialization', req: [{ h: '', r: [{ r: 'all', c: ['ECON101'] }], l: [] }] };
  const minor = (s) => ({ s, n: `Minor ${s}`, t: 'Minor', req: [{ h: '', r: [{ r: 'all', c: ['ECON101', 'ECON102'] }], l: [] }] });
  const deg = { s: 'dg', n: 'Degree Requirements', t: 'Degree Requirements', req: [{ h: '', r: [{ r: 'all', c: ['ECON101'] }], l: [] }] };
  const two = new Map(['ECON101', 'ECON102'].map((c) => [c, { units: 0.5 }]));
  const r = PE.evaluateAll([minor('a'), major, minor('b'), spec, deg], two);
  assert.deepEqual(r.evals.map((e) => e.have), [2, 2, 0, 1, 1], 'the major counts first, then the specialization (one use with the major), then the first minor; the second minor gets nothing');
  assert.deepEqual(r.capped.get('ECON101'), ['Minor b']);
  assert.ok(!r.avail[2].has('ECON102') && r.avail[0].has('ECON102'));
});

test('pathways: co-op study/work sequences, from each chart to each major', () => {
  const head = (n) => `<tr><th>Plan</th><th>S/S</th>${'<th>F</th><th>W</th><th>S</th>'.repeat(n)}</tr>`;
  const bmath = `<table>${head(2)}<tr><td rowspan="2">*Computer Science; Data Science</td><td>1</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>WT</td><td>2B</td></tr><tr><td>2</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>2B</td><td>WT</td></tr><tr><td rowspan="2">Business Administration and Computer Science double degree</td><td></td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>WT</td><td>2B</td></tr><tr><td></td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>2B</td><td>WT</td></tr><tr><td>Mathematics/Teaching</td><td>1</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>†</td><td>†</td></tr><tr><td>*All other majors for the Bachelor of Mathematics</td><td>1</td><td>1A</td><td>1B</td><td>off</td><td>2A</td><td>WT</td><td>2B</td></tr></table>`;
  const rows = PW.sequences(bmath);
  assert.deepEqual(rows.map((r) => [r.plans, r.label, r.terms.length, r.cut ?? 0]), [
    ['Computer Science; Data Science', '1', 6, 0],
    ['Computer Science; Data Science', '2', 6, 0],
    ['Business Administration and Computer Science double degree', '', 6, 0],
    ['Business Administration and Computer Science double degree', '', 6, 0],
    ['Mathematics/Teaching', '1', 4, 1],
    ['All other majors for the Bachelor of Mathematics', '1', 6, 0],
  ], 'a Plan cell spanning rows names each of them; a chart that turns to † stops there');
  const basc = PW.sequences(`<table>${head(2)}<tr><td>Management, Mechanical, Mechatronics</td><td>8X</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>WT</td><td>2B</td></tr><tr><td>Environmental, Mechanical</td><td>4</td><td>1A</td><td>WT</td><td>1B</td><td>WT</td><td>2A</td><td>2B</td></tr></table>`);
  const arts = PW.sequences(`<table><tr><th>Plan</th>${'<th>F</th><th>W</th><th>S</th>'.repeat(2)}</tr><tr><td>Arts and Business; Honours Arts co-op majors of Economics, English</td><td>1A</td><td>1B</td><td>off</td><td>2A</td><td>WT</td><td>2B</td></tr><tr><td>Honours Arts co-op plans (excluding majors in Economics, English)</td><td>1A</td><td>1B</td><td>off</td><td>2A</td><td>2B</td><td>WT</td></tr></table>`);
  const list = [
    { s: 'bcs', n: 'Bachelor of Computer Science Degree Requirements', t: 'Degree Requirements', f: 'Faculty of Mathematics', seq: rows },
    { s: 'basc', n: 'Bachelor of Applied Science Degree Requirements', t: 'Degree Requirements', f: 'Faculty of Engineering', seq: basc },
    { s: 'ba', n: 'Bachelor of Arts Degree Requirements (Arts)', t: 'Degree Requirements', f: 'Faculty of Arts', seq: arts },
    { s: 'cs', n: 'Computer Science (Bachelor of Computer Science - Honours)', t: 'Major', f: 'Faculty of Mathematics', fi: 'Computer Science', co: 1, re: 1 },
    { s: 'bbacs', n: 'Business Administration and Computer Science Double Degree (Bachelor of Business Administration and Bachelor of Computer Science - Honours)', t: 'Major', f: 'Faculty of Mathematics', fi: 'Computer Science', co: 1 },
    { s: 'pm', n: 'Pure Mathematics (Joint Honours)', t: 'Major', f: 'Faculty of Mathematics', fi: 'Pure Mathematics', co: 1 },
    { s: 'me', n: 'Mechanical Engineering (Bachelor of Applied Science - Honours)', t: 'Major', f: 'Faculty of Engineering', fi: 'Mechanical Engineering', co: 1 },
    { s: 'econ', n: 'Economics (Bachelor of Arts - Honours)', t: 'Major', f: 'Faculty of Arts', fi: 'Economics', co: 1, re: 1 },
    { s: 'hist', n: 'History (Bachelor of Arts - Honours)', t: 'Major', f: 'Faculty of Arts', fi: 'History', co: 1, re: 1 },
    { s: 'anth', n: 'Anthropology (Bachelor of Arts - Four-Year General)', t: 'Major', f: 'Faculty of Arts', fi: 'Anthropology', re: 1 },
    { s: 'afm', n: 'Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)', t: 'Major', f: 'Faculty of Arts', co: 1, seq: [{ label: '1', start: 'F', terms: ['1A', '1B', 'off', '2A'] }, { label: '2', start: 'F', terms: ['1A', '1B', 'WT', '2A'] }] },
  ];
  const got = PW.coopSequences(list);
  const show = (s) => got.get(s)?.map((q) => `${q.label}:${q.terms.join(',')}`);
  assert.deepEqual(show('cs'), ['Sequence 1:1A,1B,WT,2A,WT,2B', 'Sequence 2:1A,1B,WT,2A,2B,WT']);
  assert.deepEqual(show('bbacs'), ['Sequence 1:1A,1B,WT,2A,WT,2B', 'Sequence 2:1A,1B,WT,2A,2B,WT'], 'its own rows, not Computer Science’s');
  assert.deepEqual(show('pm'), ['Sequence 1:1A,1B,off,2A,WT,2B'], 'joint honours: the faculty’s “all other majors”');
  assert.deepEqual(show('me'), ['Stream 8X:1A,1B,WT,2A,WT,2B', 'Stream 4:1A,WT,1B,WT,2A,2B'], 'engineering charts list streams; “Mechanical” is Mechanical Engineering');
  assert.deepEqual(show('econ'), ['Co-op:1A,1B,off,2A,WT,2B']);
  assert.deepEqual(show('hist'), ['Co-op:1A,1B,off,2A,2B,WT'], 'the row for majors the other row leaves out');
  assert.equal(got.get('anth'), undefined, 'no co-op, no sequence');
  assert.deepEqual(show('afm'), ['Sequence 1:1A,1B,off,2A', 'Sequence 2:1A,1B,WT,2A'], 'its own chart');
});

test('pathways: what each open requirement could still take', () => {
  const prog = {
    s: 'ec',
    n: 'Economics',
    t: 'Major',
    req: [
      { h: 'Required Courses', r: [{ g: 'all', i: [{ r: 'all', c: ['ECON101', 'ECON102'] }, { t: 'Complete 2 ECON courses at the 300-level or above', nc: 2, subj: ['ECON'], min: 3 }, { r: 'not', c: ['ECON371'] }] }], l: [] },
      { h: 'List 1', r: [{ r: 'n', n: 2, c: ['ECON301', 'ECON302', 'ECON303'] }], l: [] },
      { h: 'Electives', r: [{ t: 'Complete 1 additional course from List 1.', nc: 1, pl: 1 }], l: [] },
    ],
  };
  const courses = { ECON101: ['A', 0.5, 0, 0, 0, [1, 1, 1]], ECON301: ['B', 0.5, 0, 0, 0, [1, 0, 0]], ECON302: ['C', 0.5, 0, 0, 0, [0, 0, 0]], ECON371: ['D', 0.5, 0, 0, 0, [1, 1, 1]], ECON450: ['E', 0.5, 0, 0, 0, [1, 1, 0]], ECON290: ['F', 0.5, 0, 0, 0, [1, 1, 1]], ECON399: ['G', 0.5, 0, 0, 0, [0, 0, 0], [], 1] };
  const planned = new Map([['ECON101', { units: 0.5 }], ['ECON303', { units: 0.5 }]]);
  const got = PE.pools(prog, planned, { courses });
  assert.deepEqual(got.map((x) => [x.where, x.label, x.left, x.codes, x.kind]), [
    ['Required Courses', 'All of these', 1, ['ECON102'], 'required'],
    ['Required Courses', 'Complete 2 ECON courses at the 300-level or above', 1, ['ECON301', 'ECON302', 'ECON450'], 'words'],
    ['List 1', '2 of these', 2, ['ECON301', 'ECON302'], 'choice'],
    ['Electives', 'Complete 1 additional course from List 1.', 1, ['ECON301', 'ECON302'], 'words'],
  ], 'ECON303 counts once, toward the first section’s words; ECON371 can’t count; a gone course is left out; "from List 1" is List 1 wherever it is');
  const f = PE.fillItems(prog, planned, { courses });
  assert.deepEqual(f.words.find((w) => w.key === 's2.0').cands, ['ECON301'], 'picking from a list: courses that have run lately');
  const term = { s: 'me', n: 'ME', t: 'Major', req: [{ h: '1B Term', r: [{ g: 'all', i: [{ r: 'all', c: ['ME101', 'ME115'] }, { t: 'Complete 1 approved elective', nc: 1, pl: 1 }] }], l: [] }] };
  assert.deepEqual(PE.pools(term, new Map(), { courses }).map((x) => x.label), ['All of these'], 'a term’s approved elective doesn’t draw from the courses that term requires');
});

test('pathways: grades in prerequisites, breadth and units by level', () => {
  const pre = [{ r: 'all', c: ['CS136'], mg: 60 }];
  assert.equal(PE.holds(pre, new Set(['CS136']), { grades: new Map([['CS136', 72]]) }), true);
  assert.equal(PE.holds(pre, new Set(['CS136']), { grades: new Map([['CS136', 55]]) }), false, '55% isn’t the 60% it asks for');
  assert.equal(PE.holds(pre, new Set(['CS136']), {}), true, 'no grade yet: assume it’ll be enough');
  assert.deepEqual(PE.why(pre, new Set(['CS136']), { grades: new Map([['CS136', 55]]) }).low, [{ code: 'CS136', need: 60, got: 55 }]);
  const ba = {
    s: 'ba',
    n: 'BA',
    t: 'Degree Requirements',
    req: [
      { h: 'Breadth Requirements', r: [{ t: 'Social Sciences', u: 1, subj: ['ANTH', 'ECON', 'PSYCH'], ms: 0.5 }, { t: 'Transdisciplinary', u: 0.5, subj: ['PACS'], of: 'art', nos: ['PD'] }], l: [] },
      { h: '200-level', only: { type: 'Honours', other: ['Liberal Studies'] }, r: [{ t: 'A minimum of 1.0 units at the 200-level or above', u: 1, min: 2, any: 1, ov: 1 }], l: [] },
      { h: '200-level', only: { type: 'Honours', major: 'Liberal Studies' }, r: [{ t: 'A minimum of 1.5 units at the 200-level or above', u: 1.5, min: 2, any: 1, ov: 1 }], l: [] },
    ],
  };
  const econ = { s: 'ec', n: 'Economics (Bachelor of Arts - Honours)', t: 'Major', fi: 'Economics' };
  const p = PE.forPlans(ba, [econ, ba]);
  assert.deepEqual(p.req.map((x) => Boolean(x.skip)), [false, false, true], 'the Liberal Studies line is for Liberal Studies');
  const planned = new Map(['ECON101', 'ECON102', 'PSYCH101', 'ECON201', 'PD1', 'MATH135'].map((c) => [c, { units: 0.5 }]));
  const ev = PE.evaluate(p, planned, { faculty: { MATH: 'mat', ECON: 'art', PD: 'mat' } });
  const rows = ev.rows.filter((r) => r.kind === 'units');
  assert.deepEqual(rows[0].got, ['ECON101', 'PSYCH101'], 'at most 0.5 units from one discipline');
  assert.deepEqual(rows[1].got, ['MATH135'], 'a course from another faculty counts; PD doesn’t');
  assert.deepEqual([rows[2].sum, rows[2].got], [0.5, ['ECON201']], 'the 200-level total counts courses other rules used');
  const f = PE.fillItems(p, new Map(), { courses: {} });
  assert.deepEqual(f.words.map((w) => [w.count, w.phs ?? w.ph]), [[2, ['ANTHXXX', 'ECONXXX']], [1, 'PACSXXX']], 'no placeholders for a total over other courses; a capped rule spreads over subjects');
  // Work terms: a PD course goes on one, one a term.
  const rows2 = [
    { kind: 'study', season: 'F', codes: [] },
    { kind: 'study', season: 'W', codes: [] },
    { kind: 'coop', season: 'S', codes: [] },
    { kind: 'study', season: 'F', codes: [] },
    { kind: 'coop', season: 'W', codes: [] },
  ];
  const res = PE.arrange(rows2, [{ code: 'PD1' }, { code: 'PD20' }, { code: 'CS135' }], { courses: {} });
  assert.deepEqual(Object.fromEntries(res.placed.map((x) => [x.code, x.row])), { CS135: 0, PD1: 2, PD20: 4 });
});

test('pathways: a section with named exceptions', () => {
  const secs = PW.compactSections([
    { heading: 'Additional Requirements', tree: [{ type: 'text', text: 'All Bachelor of Mathematics students, with the exceptions of Mathematical Studies and Mathematics/Chartered Professional Accountancy, must complete the following List A courses.' }], lists: [{ heading: 'List A', tree: [{ type: 'rule', lead: 'Complete 1 of the following:', courses: [{ code: 'MATH235' }, { code: 'MATH245' }] }], lists: [] }] },
    { heading: 'Communication', tree: [{ type: 'rule', lead: 'Complete 1 of the following:', courses: [{ code: 'ENGL109' }, { code: 'COMMST100' }] }], lists: [] },
  ]);
  assert.equal(secs[0].ex, 'Mathematical Studies and Mathematics/Chartered Professional Accountancy');
  assert.equal(secs[0].r[0].info, 1, 'the sentence is a note, not a box to tick');
  const deg = { s: 'bmath', n: 'Bachelor of Mathematics Degree Requirements', t: 'Degree Requirements', req: secs };
  const cpa = { s: 'cpa', n: 'Mathematics/Chartered Professional Accountancy (Bachelor of Mathematics - Honours)', t: 'Major', fi: 'Mathematics/Chartered Professional Accountancy' };
  const pm = { s: 'pm', n: 'Pure Mathematics (Bachelor of Mathematics - Honours)', t: 'Major', fi: 'Pure Mathematics' };
  const mathJ = { s: 'mj', n: 'Mathematics (Joint Honours)', t: 'Major', fi: 'Mathematics' };
  const asCpa = PE.forPlans(deg, [cpa, deg]);
  assert.equal(asCpa.req.length, 2, 'sections keep their places');
  assert.deepEqual(asCpa.req[0].r, [{ t: 'Not required for Mathematics/Chartered Professional Accountancy students.', info: 1 }]);
  assert.deepEqual([PE.evaluate(asCpa, new Map()).need, PE.fillItems(asCpa, new Map()).picks.length], [1, 1], 'only the communication course is left');
  assert.equal(PE.forPlans(deg, [pm, deg]), deg);
  assert.equal(PE.forPlans(deg, [mathJ, deg]), deg, '“Mathematics” alone isn’t Mathematics/Chartered Professional Accountancy');
});

test('pathways: filling in a plan, and where its courses go', () => {
  const prog = {
    s: 'me',
    n: 'Mechanical',
    t: 'Major',
    req: [
      { h: '1A Term', r: [{ r: 'all', c: ['MATH115', 'ME100'] }], l: [] },
      { h: '1B Term', r: [{ g: 'all', i: [{ r: 'all', c: ['ME101'] }, { t: 'Complete 1 approved elective', nc: 1, pl: 1 }] }], l: [] },
      { h: 'Required Courses', r: [{ g: 'all', i: [{ r: 'n', n: 1, c: ['MATH135', 'MATH145'] }, { r: 'n', n: 2, c: ['ME321', 'ME322'] }, { g: 'n', n: 1, i: [{ r: 'n', n: 1, c: ['CS114', 'CS116'] }, { r: 'all', c: ['CS136', 'CS136L'] }] }, { t: 'Complete 2 additional ME courses at the 300-level', nc: 2, subj: ['ME'], min: 3 }] }], l: [] },
      { h: 'Technical Electives List', r: [{ t: 'Complete a total of 6 Technical Electives.', nc: 6, pl: 1 }], l: [{ h: 'List 1', r: [{ r: 'n', n: 4, c: ['ME423', 'ME435', 'ME436', 'ME452', 'ME456'] }], l: [] }] },
    ],
  };
  const courses = { ME340: ['Heat', 0.5, 0, 0, 0, [1, 1, 0]], ME354: ['Fluids', 0.5, 0, 0, 0, [1, 0, 0]], ME200A: ['Seminar', 0.5, 0, 0, 0, [0, 0, 0]], ME321: ['Gone', 0.5, 0, 0, 0, [1, 1, 1], [], 1] };
  const f = PE.fillItems(prog, new Map([['MATH145', { units: 0.5 }], ['ME100', { units: 0.5 }]]), { courses });
  assert.deepEqual(f.must, [{ code: 'MATH115', at: '1A' }, { code: 'ME101', at: '1B' }, { code: 'ME321', at: null }, { code: 'ME322', at: null }], 'planned ones and met choices are left out; 2 of 2 is all');
  assert.deepEqual(f.picks.map((p) => [p.n, p.options.map((o) => o.codes.join('+'))]), [[1, ['CS114', 'CS116', 'CS136+CS136L']], [4, ['ME423', 'ME435', 'ME436', 'ME452', 'ME456']]]);
  assert.deepEqual(f.words.map((w) => [w.count, w.ph, w.at]), [[1, 'ELECTIVE', '1B'], [2, 'ME3XX', null], [2, 'ELECTIVE', null]], 'a total of 6 technical electives is 4 from List 1 and 2 more');
  assert.deepEqual(f.words[1].cands, ['ME340', 'ME354'], 'courses that fit and have run lately, not gone ones');

  // A regular four years from Fall 2026: Fall and Winter study terms, Spring off.
  const rows = [];
  let t = '1269';
  for (let i = 0; i < 12; i++) {
    rows.push({ kind: PE.seasonOf(t) === 'S' ? 'off' : 'study', season: PE.seasonOf(t), codes: [] });
    t = PE.nextTerm(t);
  }
  rows[0].codes = ['ECON101'];
  const C = {
    MATH135: ['Algebra', 0.5, 0, 0, 0, [1, 1, 1]],
    MATH136: ['Linear Algebra', 0.5, [{ r: 'n', n: 1, c: ['MATH135', 'MATH145'] }], 0, 0, [1, 1, 1]],
    MATH239: ['Combinatorics', 0.5, [{ g: 'all', i: [{ r: 'all', c: ['MATH136'] }, { t: 'level', lv: '2A' }] }], 0, 0, [1, 1, 1]],
    CS136: ['Elementary Algorithm Design', 0.5, [{ r: 'n', n: 1, c: ['CS135', 'CS145'] }], 0, 0, [1, 1, 1]],
    CS136L: ['Tools', 0.25, 0, [{ r: 'all', c: ['CS136'] }], 0, [1, 1, 1]],
    STAT231: ['Statistics', 0.5, [{ r: 'all', c: ['STAT230'] }], 0, 0, [0, 1, 0]],
    STAT230: ['Probability', 0.5, 0, 0, 0, [1, 1, 1]],
  };
  const want = ['MATH239', 'CS136L', 'MATH136', 'STAT231', 'MATH135', 'CS136', 'PMATH4XX', 'ELECTIVE', 'STAT230'].map((code) => ({ code })).concat([{ code: 'ME100', at: '1B' }]);
  const res = PE.arrange(rows, want, { courses: C, load: 3 });
  const where = Object.fromEntries(res.placed.map((p) => [p.code, PE.levels(rows)[p.row]]));
  assert.deepEqual(where, { ME100: '1B', MATH135: '1A', CS136: '1A', MATH136: '1B', CS136L: '1B', MATH239: '2A', STAT230: '2A', STAT231: '2B', ELECTIVE: '2A', PMATH4XX: '4A' });
  assert.deepEqual(res.left, []);
  const afm = { s: 'afm', n: 'AFM', t: 'Major', tu: 3, req: [{ h: '', r: [{ r: 'all', c: ['AFM101', 'AFM102'] }], l: [] }] };
  const deg = { ...afm, tu: 20 };
  const some = new Map(['AFM101', 'ECON101', 'ELECTIVE'].map((c) => [c, { units: 0.5 }]));
  assert.deepEqual([PE.evaluate(afm, some).need, PE.evaluate(afm, some).have], [6, 1], 'a major’s own total (3.0 units) counts only its courses');
  const whole = PE.evaluate(deg, some);
  assert.deepEqual([whole.need, whole.have, whole.used.has('ECON101')], [40, 3, false], 'a whole degree’s total (20.0 units) counts every other course, without using it');
  assert.deepEqual(PE.fillItems(deg, some).words.map((w) => [w.key, w.count, w.ph]), [['total', 36, 'ELECTIVE']], 'AFM102 is named; 36 more make 40');
  const later = PE.arrange(rows, [{ code: 'MATH135' }, { code: 'ME100', at: '1A' }], { courses: C, from: 3 });
  assert.deepEqual(later.placed.map((p) => PE.levels(rows)[p.row]), ['2A', '2A'], 'nothing goes before the term it fills from');
});

test('pathways: minimum averages, breadth tables and units by level from the calendar’s prose', async () => {
  const { averages, degreeProse } = await import('./lib/pathways.mjs');
  const strip = (list) => list.map(({ t, ...a }) => a);
  assert.deepEqual(strip(averages('<p>A minimum cumulative overall average of 60.0%. A minimum cumulative major average of 70.0%: all math courses.</p>')), [
    { k: 'overall', min: 60 },
    { k: 'fac', min: 70, fac: 'mat', label: 'major' },
  ]);
  assert.deepEqual(strip(averages('<p>A minimum cumulative major average of 60.0% in two or more of the following courses: CS136, CS138; CS240-299; AMATH242.</p>')), [{ k: 'codes', min: 60, c: ['CS136', 'CS138', 'AMATH242'], rg: [['CS', 240, 299]], n: 2, label: 'major' }]);
  assert.deepEqual(strip(averages('<p>A minimum average of 60.0% in the specialization courses.</p><p>A minimum term average of 60.0%.</p>')), [
    { k: 'plan', min: 60, label: 'specialization' },
    { k: 'term', min: 60 },
  ]);
  assert.deepEqual(strip(averages('<p>A minimum cumulative Computer Science average of 60.0%.</p>')), [{ k: 'subj', min: 60, subj: ['CS'] }]);
  const html = `<p>Three-Year General degrees: Complete 15.0 units, with a minimum of 8.0 units at the 200-level or above.</p>
<p>Honours degrees:</p><p>Liberal Studies major: A minimum of 12.5 units must be at the 200-level or above.</p><p>All other Arts majors: A minimum of 8.0 units must be at the 200-level or above.</p>
<table><tr><th>Requirement</th><th>Units Required</th><th>Subject Codes</th></tr>
<tr><td>Humanities</td><td>1.0 unit</td><td>CLAS, ENGL, HIST</td></tr>
<tr><td>Social Sciences</td><td>2.0 units</td><td>ECON, PSYCH, SOC</td></tr>
<tr><td>Transdisciplinary Studies</td><td>0.5 units</td><td>ARTS, PACS. Also any course taken in another University of Waterloo faculty.</td></tr></table>
<p>No more than 1.0 unit in the same discipline may count towards the Social Sciences requirement.</p>
<p>Arts First courses (ARTS160 and ARTS160E) do not fulfil any of the breadth requirements. Professional Development (PD) courses do not fulfil any of the breadth requirements.</p>`;
  const secs = degreeProse(html, 'art');
  assert.deepEqual(secs.filter((s) => s.only).map((s) => [s.only, s.r[0].u]), [
    [{ type: 'Three-Year General' }, 8],
    [{ type: 'Honours', major: 'Liberal Studies' }, 12.5],
    [{ type: 'Honours', other: ['Liberal Studies'] }, 8],
  ]);
  const br = secs.find((s) => s.h === 'Breadth Requirements').r;
  assert.deepEqual(br.map((r) => [r.u, r.subj, r.ms ?? null, r.of ?? null]), [
    [1, ['CLAS', 'ENGL', 'HIST'], null, null],
    [2, ['ECON', 'PSYCH', 'SOC'], 1, null],
    [0.5, ['ARTS', 'PACS'], null, 'art'],
  ]);
  assert.deepEqual([br[0].no, br[0].nos], [['ARTS160', 'ARTS160E'], ['PD']]);
});

test('search: words, stems and pairs, the same at build time and in the browser', async () => {
  const { stem, terms } = await import('../site/search/text.js');
  // Porter's own examples.
  for (const [w, s] of Object.entries({ caresses: 'caress', ponies: 'poni', agreed: 'agre', motoring: 'motor', hopping: 'hop', relational: 'relat', conditional: 'condit', vietnamization: 'vietnam', electrical: 'electr', adjustment: 'adjust', controll: 'control', networks: 'network', learning: 'learn' })) assert.equal(stem(w), s, w);
  assert.deepEqual(terms('Red-black trees, and C++. CS 135 in 2026!'), ['red', 'black', 'red black', 'tree', 'black tree', 'cplusplu', 'cs']);
});

test('search: an index from a few courses ranks by words, pairs and what courses are about', async () => {
  const { searchIndex, searchDocs } = await import('./lib/search.mjs');
  const { queryTerms, rank, loadVec, respell } = await import('../site/search/rank.js');
  const { shardOf } = await import('../site/search/text.js');
  const course = (code, title, description, subjectName) => [code, { cat: { level: 'ug' }, course: { title, description, subject: /^[A-Z]+/.exec(code)[0], subjectName } }];
  const topics = ['graph algorithms shortest paths greedy', 'linear algebra matrices eigenvalues vectors', 'latin grammar roman authors translation', 'fourier series transforms signals', 'game theory strategic equilibrium auctions'];
  const list = [];
  topics.forEach((t, k) => {
    for (let i = 0; i < 6; i++) list.push(course(`S${k}X${100 + i}`, `${t.split(' ').slice(0, 2).join(' ')} ${i}`, `This course covers ${t}. ${t.split(' ').reverse().join(' ')} and more on ${t.split(' ')[i % 4]}.`, `Subject ${k}`));
  });
  list.push(course('CS341', 'Algorithms', 'Dynamic programming, greedy algorithms, graph algorithms and shortest paths.', 'Computer Science'));
  const docs = searchDocs({ primary: new Map(list), reddit: new Map([['CS341', [{ title: 'CS 341 tips', text: 'dynamic programming is the hardest part' }]]]) });
  const { files } = searchIndex(docs);
  const get = (p) => JSON.parse(files.find(([f]) => f === p)[1]);
  const d = get('search/docs.json');
  const vec = loadVec(get('search/vec.json'));
  const ask = (q) => {
    const qt = queryTerms(q);
    const entries = new Map([...qt.words, ...qt.pairs].map((x) => [x.t, get(`search/t/${shardOf(x.t)}.json`)[x.t]]));
    return rank(qt, entries, d, vec);
  };
  const top = ask('dynamic programming');
  assert.equal(d.codes[top.results[0].i], 'CS341');
  assert.ok(top.results[0].mask & 4 && top.results[0].mask & 16, 'matched in its description and on Reddit');
  assert.ok(ask('eigenvalues').results.slice(0, 6).every((x) => d.codes[x.i].startsWith('S1')));
  assert.equal(respell('eigenvaleus', get('search/vocab.json'))?.[0], 'eigenvalues');
  // Every course's fit for a goal, 0 to 1, for Pathways.
  const { relevance } = await import('../site/search/rank.js');
  const qt = queryTerms('latin translation');
  const fit = relevance(qt, new Map([...qt.words, ...qt.pairs].map((x) => [x.t, get(`search/t/${shardOf(x.t)}.json`)[x.t]])), d, vec);
  const best = [...fit].sort((a, b) => b[1] - a[1]);
  assert.equal(best[0][1], 1);
  assert.ok(best.slice(0, 6).every(([c]) => c.startsWith('S2')), 'the Latin courses fit best');
  assert.ok((fit.get('CS341') ?? 0) < 0.3);
});

test('pathways: finding a plan the way people say it', () => {
  const plan = (s, n, t, subjects = [], c = n) => ({ s, n, t, c, req: [{ h: 'Required', r: [{ r: 'all', c: subjects.flatMap((x) => [`${x}101`, `${x}102`, `${x}201`]) }], l: [] }] });
  const plans = [
    plan('cpa', 'Mathematics/Chartered Professional Accountancy (Bachelor of Mathematics - Honours)', 'Major', ['AFM', 'MATH']),
    plan('cpa-fin', 'Finance Specialization (Mathematics/Chartered Professional Accountancy)', 'Specialization', ['AFM'], 'CPA-Finance Specialization'),
    plan('cs', 'Computer Science (Bachelor of Computer Science - Honours)', 'Major', ['CS']),
    plan('clas', 'Classical Studies (Bachelor of Arts - Honours)', 'Major', ['CLAS']),
    plan('syde', 'Systems Design Engineering (Bachelor of Applied Science - Honours)', 'Major', ['SYDE']),
    plan('co', 'Combinatorics and Optimization (Bachelor of Mathematics - Honours)', 'Major', ['CO']),
    plan('mech', 'Mechanical Engineering (Bachelor of Applied Science - Honours)', 'Major', ['ME']),
    plan('medchem', 'Medicinal Chemistry (Bachelor of Science - Honours)', 'Major', ['CHEM']),
  ];
  const find = (q) =>
    plans
      .map((p) => [p.s, PE.planScore(p, PE.planTokens(q))])
      .filter(([, x]) => x > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  assert.equal(find('math/cpa')[0], 'cpa', 'a slash between words, initials for the rest');
  assert.deepEqual(find('math cpa').slice(0, 2), ['cpa', 'cpa-fin']);
  assert.deepEqual(find('chartered').sort(), ['cpa', 'cpa-fin']);
  assert.equal(find('cs')[0], 'cs', 'CS courses make it Computer Science before Classical Studies');
  assert.ok(find('cs').includes('clas'));
  assert.equal(find('syde')[0], 'syde');
  assert.equal(find('c&o')[0], 'co');
  assert.equal(find('mech')[0], 'mech', 'a word’s start before pieces of two words (Medicinal CHemistry)');
  assert.deepEqual(find('zzz'), []);
});

test('planner: the term’s dates and final exams from Open Data, in the calendar file', async () => {
  const { termDates, termExams, examDate, examTime, examMinutes } = await import('./lib/planner.mjs');
  const row = (name, type, details, extra = {}) => ({ name, importantDateType: type, description: extra.d ?? '', audiences: extra.a ?? ['Undergraduate students'], details: details.map(([termName, startDate, endDate = null]) => ({ termName, startDate: `${startDate}T00:00:00`, endDate: endDate && `${endDate}T00:00:00` })) });
  const all = [
    row('Classes begin', 'Academic', [['Winter 2027', '2027-01-06']]),
    row('Family Day', 'University closure', [['Winter 2027', '2027-02-15']]),
    row('Reading Week', 'Academic', [['Winter 2027', '2027-02-13', '2027-02-21']]),
    row('Good Friday', 'University closure', [['Winter 2027', '2027-03-26']]),
    row('Make-up day for Good Friday', 'Academic', [['Winter 2027', '2027-04-06']], { d: '<p>The loss of a Friday class on March 26 will be made up by following a  <strong>Friday schedule</strong>  on Tuesday, April 6.</p>' }),
    row('Final examinations begin', 'Academic', [['Winter 2027', '2027-04-09']]),
    row('Final examinations end', 'Academic', [['Winter 2027', '2027-04-23']]),
    row('Drop with WD ends', 'Academic', [['Winter 2027', '2027-03-19']]),
    row('Convocation - spring 2027', 'Event', [['Winter 2027', '2027-06-10']]),
    row('Thesis deadline', 'Academic', [['Winter 2027', '2027-04-01']], { a: ['Graduate students'] }),
    row('Thanksgiving Day', 'University closure', [['Fall 2026', '2026-10-12']]),
  ];
  const dates = termDates(all, '1271');
  assert.deepEqual(dates, [
    ['Classes begin', '', '2027-01-06', '2027-01-06', ''],
    ['Reading Week', 'off', '2027-02-13', '2027-02-21', ''],
    ['Family Day', 'off', '2027-02-15', '2027-02-15', ''],
    ['Drop with WD ends', '', '2027-03-19', '2027-03-19', ''],
    ['Good Friday', 'off', '2027-03-26', '2027-03-26', ''],
    ['Make-up day for Good Friday', 'makeup', '2027-04-06', '2027-04-06', '4'],
    ['Final examinations', 'exam', '2027-04-09', '2027-04-23', ''],
  ], 'this term’s, for undergraduates, not convocation; the exam period is one row');
  assert.deepEqual([examDate('2027-04-12T00:00:00'), examDate('4/12/2027'), examDate('Monday, April 12, 2027'), examDate('TBA')], ['2027-04-12', '2027-04-12', '2027-04-12', null]);
  assert.deepEqual([examTime('09:00:00'), examTime('7:30 PM'), examTime('12:30 PM'), examTime('')], [540, 1170, 750, null]);
  assert.deepEqual([examMinutes('02:30:00'), examMinutes('150'), examMinutes('2.5 hours'), examMinutes('')], [150, 150, 150, null]);
  const exams = termExams([
    { examDisplayName: 'CS 136', sections: '001,002', examWindowStartDate: '2027-04-12T00:00:00', examWindowStartTime: '09:00:00', examDuration: '02:30:00', location: 'PAC', isOnlineDescription: 'In person' },
    { examDisplayName: 'CS 136', sections: '003', examWindowStartDate: '2027-04-13T00:00:00', examWindowStartTime: '19:30:00', examDuration: '150', location: 'TBA' },
    { examDisplayName: 'MATH 138', sections: null, examWindowStartDate: 'April 20, 2027', examWindowStartTime: null, examDuration: null, location: '', notes: 'Online' },
    { examDisplayName: 'ECON 101', sections: '001', examWindowStartDate: null, notes: 'See instructor' },
  ]);
  assert.deepEqual(exams, {
    CS136: [
      [['001', '002'], '2027-04-12', 540, 150, 'PAC', ''],
      [['003'], '2027-04-13', 1170, 150, 'TBA', ''],
    ],
    MATH138: [[null, '2027-04-20', null, null, '', 'Online']],
  });
  // The calendar file: Monday-Wednesday-Friday CS 136 lecture 001, and a Tuesday-Thursday course.
  const entries = {
    CS136: ['', [lec('001', 1, 5001, MWF, 510, 560), lec('003', 3, 5003, MWF, 630, 680)]],
    MATH138: ['', [lec('001', 1, 6001, TTh, 690, 760)]],
  };
  const built = Object.entries(entries).map(([k, v]) => P.buildCourse(k, v, TERM, P.DEFAULTS));
  const picks = [
    { code: 'CS136', comp: 'LEC', opt: built[0].opts.LEC.find((o) => o.section.sec === '001') },
    { code: 'MATH138', comp: 'LEC', opt: built[1].opts.LEC[0] },
  ];
  const plain = icsFile(picks, 'Winter 2027', { dayBit: P.dayBit });
  assert.doesNotMatch(plain.text, /EXDATE/, 'without dates, as before');
  const res = icsFile(picks, 'Winter 2027', { dayBit: P.dayBit, dates, exams, withDates: true });
  const ev = res.text.split('BEGIN:VEVENT').slice(1);
  const cs = ev.find((e) => /SUMMARY:CS 136 LEC 001/.test(e) && /RRULE/.test(e));
  // Days off on Monday, Wednesday or Friday in its weeks: Reading Week's three, Family Day (also in it), Good Friday.
  assert.match(cs, /EXDATE;TZID=America\/Toronto:20270215T083000,20270217T083000,20270219T083000,20270326T083000\r\n/);
  const math = ev.find((e) => /SUMMARY:MATH 138 LEC 001/.test(e) && /RRULE/.test(e));
  assert.match(math, /EXDATE;TZID=America\/Toronto:20270216T113000,20270218T113000,20270406T113000\r\n/, 'Tuesday April 6 follows a Friday schedule: no Tuesday class');
  assert.ok(ev.some((e) => /SUMMARY:CS 136 LEC 001/.test(e) && /DTSTART;TZID=America\/Toronto:20270406T083000/.test(e) && !/RRULE/.test(e)), 'the Friday class meets on the make-up day');
  assert.match(res.text, /SUMMARY:CS 136 final exam\r\nDTSTART;TZID=America\/Toronto:20270412T090000\r\nDTEND;TZID=America\/Toronto:20270412T113000\r\nLOCATION:PAC/, 'lecture 001’s exam, not 003’s');
  assert.doesNotMatch(res.text, /20270413T193000/);
  assert.match(res.text, /SUMMARY:MATH 138 final exam\r\nDTSTART;VALUE=DATE:20270420\r\nDTEND;VALUE=DATE:20270421/, 'a day with no time: an all-day event');
  assert.match(res.text, /SUMMARY:Final examinations\r\nDTSTART;VALUE=DATE:20270409\r\nDTEND;VALUE=DATE:20270424\r\nTRANSP:TRANSPARENT/);
  assert.deepEqual([res.exams, res.dates, res.off], [2, 7, true]);
  assert.equal(icsFile(picks, 'Winter 2027', { dayBit: P.dayBit, dates, exams, withDates: false }).dates, 0, 'term dates only when asked for');
  const file = plannerData('1271', { CS136: [{ comp: 'LEC', sec: '001', meets: [{ days: 'MWF', start: '08:30', end: '09:20', from: '2027-01-06', to: '2027-04-06' }] }] }, { dates, exams });
  assert.deepEqual([file.d.length, Object.keys(file.x)], [7, ['CS136']], 'exams only for courses in the file');
});

test('archive programs: a page’s own part, without the site around it', async () => {
  const { mainPart } = await import('./lib/archiveprograms.mjs');
  const html = '<html><head><script>x()</script></head><body><div>Menu</div><h1>Mathematical Optimization</h1><!-- note --><h2>Degree Requirements</h2><ul><li>One of <ul><li>MATH 237</li></ul></li></ul><p>Office of the Registrar<br />University of Waterloo<br />200 University Avenue West</p></body></html>';
  assert.equal(mainPart(html), '<h1>Mathematical Optimization</h1><h2>Degree Requirements</h2><ul><li>One of <ul><li>MATH 237</li></ul></li></ul><p>');
});

test('archive programs: lines and lists of the older calendars as rules', async () => {
  const { lineNodes, listNodes, wordsRule, proseRules } = await import('./lib/archiveprograms.mjs');
  const { parseHtml, find } = await import('./lib/requisites.mjs');
  const list = (html) => listNodes(find(parseHtml(html), (n) => n.tag === 'ul' || n.tag === 'ol'));
  // Lines: counts before courses, cross-listed courses, ranges with a course, labels, "either … or".
  assert.deepEqual(lineNodes('one of ECON 406, ECON 407'), [{ r: 'n', n: 1, c: ['ECON406', 'ECON407'] }]);
  assert.deepEqual(lineNodes('GERON 201/HLTH 201'), [{ r: 'n', n: 1, c: ['GERON201', 'HLTH201'] }]);
  assert.deepEqual(lineNodes('CO 342, 351, 353'), [{ r: 'all', c: ['CO342'] }, { r: 'all', c: ['CO351'] }, { r: 'all', c: ['CO353'] }]);
  assert.deepEqual(lineNodes('Four additional courses from CS 200-CS 299, CS 300-CS 398, COMM 432')[0].rg, [['CS', 200, 299], ['CS', 300, 398], ['COMM', 432, 432]]);
  assert.deepEqual(lineNodes('Criticism: ENGL 251'), [{ r: 'all', c: ['ENGL251'] }]);
  assert.deepEqual(lineNodes('Literatures Romantic to Modern: two of ENGL 313, ENGL 325, ENGL 342'), [{ r: 'n', n: 2, c: ['ENGL313', 'ENGL325', 'ENGL342'] }]);
  assert.deepEqual(lineNodes('either a medieval HIST 450 or two of HIST 421 and/or HIST 422'), [{ g: 'n', n: 1, i: [{ r: 'all', c: ['HIST450'] }, { r: 'n', n: 2, c: ['HIST421', 'HIST422'] }] }]);
  assert.deepEqual(lineNodes('1.5 units at the 400-level from HIST 421, HIST 422, HIST 450'), [{ r: 'n', n: 3, c: ['HIST421', 'HIST422', 'HIST450'] }]);
  assert.deepEqual(lineNodes('(0.5 unit) fourth-year seminar course: HLTH 421, HLTH 427, HLTH 430'), [{ r: 'n', n: 1, c: ['HLTH421', 'HLTH427', 'HLTH430'] }]);
  assert.deepEqual(lineNodes('FR 192B, FR 251, and one other course taught in French at the 200-level or above.').at(-1), { t: 'one other course taught in French at the 200-level or above.', nc: 1, min: 2 });
  assert.deepEqual(lineNodes('Successful completion of 20 academic course units with a minimum cumulative overall average of 60%.'), [{ tu: 20 }]);
  // Words: units of a subject at a level, any subject, a category of subjects; what the grid can't count is ticked.
  assert.deepEqual(wordsRule('1.0 BIOL elective unit, 400-level'), { t: '1.0 BIOL elective unit, 400-level', u: 1, subj: ['BIOL'], min: 4 });
  assert.equal(wordsRule('8.0 units: Elective').any, 1);
  assert.equal(wordsRule('5.5 units chosen from any subject, with a maximum of 1.5 lab units').any, 1);
  assert.deepEqual(wordsRule('A fine or performing arts course: FINE, MUSIC, THPERF'), { t: 'A fine or performing arts course: FINE, MUSIC, THPERF', nc: 1, subj: ['FINE', 'MUSIC', 'THPERF'] });
  assert.deepEqual(wordsRule('four 300-level HIST courses'), { t: 'four 300-level HIST courses', nc: 4, subj: ['HIST'], min: 3 });
  assert.deepEqual(wordsRule('1.5 units with the same subject forming a prerequisite chain of length three'), { t: '1.5 units with the same subject forming a prerequisite chain of length three' });
  // Lists: an item's courses stay together, "X, or" items are alternatives, "one course in each of three fields".
  assert.deepEqual(list('<ul><li>One of <ul><li>CS 116</li><li>CS 136 and CS 136L</li></ul></li></ul>'), [{ g: 'n', n: 1, i: [{ r: 'all', c: ['CS116'] }, { r: 'all', c: ['CS136', 'CS136L'] }] }]);
  assert.deepEqual(list('<ul><li>One of <ul><li>CS 115</li><li>CS 135</li></ul></li><li>All of <ul><li>CS 240</li><li>CS 241</li></ul></li></ul>'), [{ r: 'n', n: 1, c: ['CS115', 'CS135'] }, { r: 'all', c: ['CS240', 'CS241'] }]);
  assert.deepEqual(list('<ul><li>1.5 units with the same subject, including at least 0.5 unit at 300-level or higher, <b>or</b></li><li>1.5 units with the same subject forming a prerequisite chain of length three</li></ul>')[0].g, 'n');
  const fields = list('<ul><li>one course in each of three fields: <ul><li>Canadian: HIST 253, HIST 254</li><li>American: HIST 257, HIST 258</li><li>European: HIST 260/MEDVL 260, HIST 262</li><li>International: HIST 268</li></ul></li></ul>');
  assert.deepEqual(fields, [{ g: 'n', n: 3, i: [{ r: 'n', n: 1, c: ['HIST253', 'HIST254'] }, { r: 'n', n: 1, c: ['HIST257', 'HIST258'] }, { r: 'n', n: 1, c: ['HIST260', 'MEDVL260', 'HIST262'] }, { r: 'n', n: 1, c: ['HIST268'] }] }]);
  // "Recreation courses (minimum of 10.5 units):" adds up what's under it; "four of the following categories".
  const rec = list('<ol><li>Recreation courses (minimum of 10.5 units): <ul><li>Required recreation courses (1.0 unit): REC 100, REC 101</li><li>Recreation elective courses (minimum of 6.5 units): Any additional REC courses</li></ul></li><li>Restricted elective courses (2.0 units): Students must complete a total of four courses from the following 12 subject categories. <ul><li>An English course: ENGL</li><li>A sociology course: SOC</li></ul></li></ol>');
  assert.deepEqual(rec[0], { r: 'all', c: ['REC100', 'REC101'] });
  assert.deepEqual(rec[1], { t: 'Recreation elective courses (minimum of 6.5 units): Any additional REC courses', u: 6.5, subj: ['REC'] });
  assert.equal(rec[2].g, 'n');
  assert.equal(rec[2].n, 4);
  // Lines of courses under "n of" are choices; a list of approved courses is a list others draw on.
  assert.deepEqual(list('<ul><li>four approved language courses (all in one language): <ul><li>ASL 101R, ASL 102R, ASL 201R</li><li>DUTCH 101, DUTCH 102, DUTCH 201</li></ul></li></ul>'), [{ r: 'n', n: 4, c: ['ASL101R', 'ASL102R', 'ASL201R', 'DUTCH101', 'DUTCH102', 'DUTCH201'] }]);
  assert.deepEqual(list('<ul><li>list of Medieval Studies approved courses: <ol><li>English: ENGL 200A, ENGL 208H</li><li>Latin: LAT 101, LAT 102</li></ol></li></ul>'), [{ r: 'list', c: ['ENGL200A', 'ENGL208H', 'LAT101', 'LAT102'] }]);
  // A plan in words.
  const subjects = new Map([['philosophy', 'PHIL'], ['classical studies', 'CLAS'], ['greek', 'GRK'], ['latin', 'LAT']]);
  assert.deepEqual(proseRules('Students may pursue a minor. The Classical Studies Minor requires successful completion of a minimum of four academic course units (eight courses) in Classical Studies, Greek, or Latin with a minimum cumulative minor average of 65%.', subjects), [{ t: 'The Classical Studies Minor requires successful completion of a minimum of four academic course units (eight courses) in Classical Studies, Greek, or Latin.', u: 4, subj: ['CLAS', 'GRK', 'LAT'] }]);
  assert.deepEqual(proseRules('The Option consists of seven courses selected from specified lists.'), [{ t: 'The Option consists of seven courses selected from specified lists.' }]);
});

test('archive programs: pages become plans with the later calendars’ names', async () => {
  const { archivePrograms, pageSections, readArchivePage } = await import('./lib/archiveprograms.mjs');
  const page = (path, title, content, section = '') => ({ url: `https://academic-calendar-archive.uwaterloo.ca/undergraduate-studies/2022-2023/page/${path}.html`, html: `<span id="ctl00_contentMain_lblPageTitle">${title}</span><span id="ctl00_contentMain_lblBottomTitle">${section}</span><span id="ctl00_contentMain_lblContent">${content}</span>` });
  const econ = page(
    'ARTS-Honours-Economics',
    'Honours Economics',
    '<p>Continuation in this academic plan requires a minimum cumulative overall average of 60%.</p><ol><li>Economics plan-level requirements: <ul><li>a minimum cumulative Economics major average of 70%</li><li>at least eight academic course units (16 courses) in Economics, including: <ul><li>ECON 101, ECON 102, ECON 201</li><li>one of ECON 406, ECON 407</li><li>five additional ECON courses at the 300-level or above</li></ul></li></ul></li></ol><h3>Notes</h3><ol><li>ECON 201 is recommended: ECON 999</li></ol><h3>Intensive Specialization</h3><p>Students must achieve a minimum cumulative Economics major average of 75%.</p><ul><li>Successful completion of two additional courses from: <ul><li>ECON 421</li><li>ECON 472</li><li>ECON 491</li></ul></li></ul>',
  );
  const me = page(
    'ENG-Mechanical-Engineering',
    'Mechanical Engineering',
    '<h4>Credit Courses</h4><ul><li>ME 201 Advanced Calculus</li><li>ME 202 Statistics</li></ul><h4>Term-by-Term Curriculum</h4><ul><li>Term 1A (Fall): <ul><li>CHE 102, MATH 115</li></ul></li><li>Term 2A (Fall/Winter): <ul><li>ME 201, ME 202</li><li>One CSE</li><li>WKRPT 100 (stream 4)</li></ul></li><li>Term 4A (Fall/Spring): <ul><li>Three Technical Electives</li></ul></li></ul><h3>Electives</h3><h4>Technical Electives</h4><p>Seven technical electives (TEs) are required in addition to the core courses listed above.</p><h5>Fluid Mechanics</h5><ul><li>ME 562 Experimental Methods in Fluids</li><li>ME 563 Turbomachines</li></ul>',
  );
  // 2021–22's Mathematics pages: lists in blockquotes under a paragraph.
  const cs = page('MATH-Bachelor-of-Computer-Science-1', 'Bachelor of Computer Science', '<p>Students in this plan must fulfil all the requirements:</p><p>One of</p><blockquote> CS 115 Introduction to Computer Science 1<br /> CS 135 Designing Functional Programs <br /></blockquote><p>All of</p><blockquote> CS 240 Data Structures<br /> CS 241 Foundations <br /></blockquote>', 'Plan Requirements');
  const generic = page('ARTS-BAFM-Degree-Requirements', 'Degree Requirements', '<ol><li>AFM 101, AFM 102</li></ol>', 'Bachelor of Accounting and Financial Management');
  const regs = page('ARTS-Co-op-Regulations', 'Co-op Regulations and Requirements', '<ul><li>COOP 1, PD 1</li></ul>');
  const known = [
    { s: 'h-economics', n: 'Economics (Bachelor of Arts - Honours)', t: 'Major', f: 'Faculty of Arts', fi: 'Economics', c: 'H-Economics', req: [], co: 1, re: 1, seq: [{ label: 'Co-op', start: 'F', terms: ['1A'] }], cant: ['h-mathematical-economics-ba', 'econ-intensive-economics-specialization'] },
    { s: 'econ-intensive-economics-specialization', n: 'Intensive Economics Specialization', t: 'Specialization', f: 'Faculty of Arts', fi: 'Economics', c: 'ECON-Intensive', req: [] },
    { s: 'h-computer-science-bcs', n: 'Computer Science (Bachelor of Computer Science - Honours)', t: 'Major', f: 'Faculty of Mathematics', fi: 'Computer Science', c: 'H-CS', req: [] },
    { s: 'h-computer-science-bmath', n: 'Computer Science (Bachelor of Mathematics - Honours)', t: 'Major', f: 'Faculty of Mathematics', fi: 'Computer Science', c: 'H-CS (BMath)', req: [] },
  ];
  const plans = archivePrograms([econ, me, cs, generic, regs], { known });
  const by = Object.fromEntries(plans.map((p) => [p.s, p]));
  assert.deepEqual(Object.keys(by).sort(), ['econ-intensive-economics-specialization', 'h-accounting-and-financial-management', 'h-computer-science-bcs', 'h-economics', 'h-mechanical-engineering']);
  // Honours Economics: the later calendar's name and slug, its total in ECON, averages, what's carried over.
  const e = by['h-economics'];
  assert.equal(e.n, 'Economics (Bachelor of Arts - Honours)');
  assert.deepEqual(e.tsub, { u: 8, subj: ['ECON'] });
  assert.deepEqual(e.req[0].r, [{ r: 'all', c: ['ECON101', 'ECON102', 'ECON201'] }, { r: 'n', n: 1, c: ['ECON406', 'ECON407'] }, { t: 'five additional ECON courses at the 300-level or above', nc: 5, subj: ['ECON'], min: 3 }]);
  assert.deepEqual(e.avg.map((a) => [a.k, a.min]), [['overall', 60], ['plan', 70]]);
  assert.equal(e.seq.length, 1);
  assert.deepEqual(e.cant, ['econ-intensive-economics-specialization']);
  assert.equal(JSON.stringify(e).includes('ECON999'), false, 'notes are left out');
  // Its specialization, a plan of its own, open to the major.
  const spec = by['econ-intensive-economics-specialization'];
  assert.deepEqual(spec.req[0].r, [{ r: 'n', n: 2, c: ['ECON421', 'ECON472', 'ECON491'] }]);
  assert.deepEqual(spec.open, ['h-economics']);
  assert.equal(spec.avg[0].min, 75);
  // Mechanical Engineering: terms as the later calendars' sections, no work-term reports, the summary gone, lists to
  // choose from under the count their heading gives.
  const m = by['h-mechanical-engineering'];
  assert.deepEqual(m.req.map((x) => x.h), ['1A Term', '2A Term', '4A Term', 'Technical Electives']);
  assert.deepEqual(m.req[1].r, [{ r: 'all', c: ['ME201', 'ME202'] }, { t: 'One CSE', nc: 1 }]);
  assert.deepEqual(m.req[3].r, [{ t: 'Seven technical electives (TEs) are required in addition to the core courses listed above', nc: 7, pl: 1 }]);
  assert.deepEqual(m.req[3].l, [{ h: 'Fluid Mechanics', r: [{ r: 'list', c: ['ME562', 'ME563'] }], l: [] }]);
  // A blockquote page, and "Degree Requirements" named by its section.
  assert.deepEqual(by['h-computer-science-bcs'].req[0].r, [{ r: 'n', n: 1, c: ['CS115', 'CS135'] }, { r: 'all', c: ['CS240', 'CS241'] }]);
  assert.equal(by['h-accounting-and-financial-management'].n, 'Accounting and Financial Management (Bachelor of Accounting and Financial Management - Honours)');
  assert.equal(readArchivePage(regs.html).title, 'Co-op Regulations and Requirements');
  assert.equal(pageSections(null, 'x').sections.length, 0);
});

test('pathways: the optimal plan picks courses that count twice, with what they need', () => {
  // A cross-listed course is one course under each code: SOC 327 meets "LS 327" and LS words.
  const X = { SOC327: ['Policing', 0.5, 0, 0, 0, [1, 1, 1], ['LS327']], LS327: ['Policing', 0.5, 0, 0, 0, [1, 1, 1], ['SOC327']] };
  const ls = { s: 'ls', n: 'Legal Studies Minor', t: 'Minor', req: [{ h: '', r: [{ t: 'Complete 0.5 units of LS courses', u: 0.5, subj: ['LS'] }], l: [] }] };
  const named = { s: 'x', n: 'X Minor', t: 'Minor', req: [{ h: '', r: [{ r: 'all', c: ['LS327'] }], l: [] }] };
  const soc = new Map([['SOC327', { units: 0.5 }]]);
  assert.deepEqual([PE.evaluate(ls, soc, { courses: X }).have, PE.evaluate(named, soc, { courses: X }).have], [1, 1]);
  assert.equal(PE.evaluate(ls, soc, { courses: {} }).have, 0, 'not without the cross-listing');

  // Two minors: the course both can use first; a prerequisite comes along; arranged and advanced courses last.
  const C = {
    SOC101: ['Introduction to Sociology', 0.5, 0, 0, 0, [2, 2, 2]],
    SOC201: ['Sociology A', 0.5, 0, 0, 0, [2, 2, 2]],
    SOC306: ['Juvenile Justice', 0.5, [{ r: 'all', c: ['SOC101'] }], 0, 0, [1, 1, 0], ['LS306']],
    LS306: ['Juvenile Justice', 0.5, [{ r: 'all', c: ['SOC101'] }], 0, 0, [1, 1, 0], ['SOC306']],
    LS201: ['Legal A', 0.5, 0, 0, 0, [2, 2, 2]],
    LS202: ['Legal B', 0.5, 0, 0, 0, [2, 2, 2]],
    SOC499A: ['Senior Honours Essay', 0.5, 0, 0, 0, [3, 3, 3]],
    MATH237: ['Calculus 3 for Honours Mathematics', 0.5, 0, 0, 0, [2, 2, 2]],
    MATH247: ['Calculus 3 (Advanced Level)', 0.5, 0, 0, 0, [2, 2, 2]],
    OLD101: ['Gone', 0.5, 0, 0, 0, [1, 1, 1], [], 1],
  };
  const sm = { s: 'sm', n: 'Sociology Minor', t: 'Minor', req: [{ h: '', r: [{ r: 'all', c: ['SOC101'] }, { t: 'Complete 1.0 units of SOC courses at the 200-level or above', u: 1, subj: ['SOC'], min: 2 }], l: [] }] };
  const lm = { s: 'lm', n: 'Legal Studies Minor', t: 'Minor', req: [{ h: '', r: [{ t: 'Complete 1.0 units of LS courses', u: 1, subj: ['LS'] }, { r: 'n', n: 1, c: ['OLD101', 'LS201'] }], l: [] }] };
  const math = { s: 'm', n: 'Math', t: 'Major', req: [{ h: '', r: [{ r: 'n', n: 1, c: ['MATH237', 'MATH247'] }], l: [] }] };
  const have = new Map([['SOC101', { units: 0.5 }]]);
  const add = PE.optimize([sm, lm, math], have, { courses: C });
  assert.ok(['SOC306', 'LS306'].includes(add[0].code) && add[0].plans.join() === '0,1', 'Juvenile Justice counts toward both minors (as SOC 306 and LS 306)');
  const codes = add.map((a) => a.code);
  assert.ok(!(codes.includes('LS306') && codes.includes('SOC306')), 'not the same course twice');
  assert.ok(!codes.includes('OLD101'), 'not a course that’s no longer offered');
  assert.ok(codes.includes('MATH237') && !codes.includes('MATH247'), 'the regular section over the advanced one');
  assert.ok(codes.indexOf('SOC201') >= 0 && !codes.includes('SOC499A'), 'a lecture before an honours essay');
  const all = new Map([...have, ...codes.map((c) => [c, { units: 0.5 }])]);
  assert.deepEqual(PE.evaluateAll([sm, lm, math], all, { courses: C }).evals.map((e) => e.have === e.need), [true, true, true]);
  // A course with a prerequisite brings it, ahead of it.
  const pre = PE.optimize([sm], new Map(), { courses: { ...C, SOC201: ['Sociology A', 0.5, [{ r: 'all', c: ['SOC101'] }], 0, 0, [2, 2, 2]] }, exclude: new Set(['SOC306', 'LS306']) });
  assert.deepEqual(pre.slice(0, 2).map((a) => [a.code, a.for ?? null]), [['SOC101', null], ['SOC201', null]], 'SOC 101 counts on its own and comes first');
  const exclude = PE.optimize([sm, lm], have, { courses: C, exclude: new Set(['SOC306', 'LS306']) }).map((x) => x.code);
  assert.ok(!exclude.includes('SOC306') && !exclude.includes('LS306'), 'a course taken out stays out');

  // With early, what has no room in its year can go in an earlier term with room: a 200-level course in 1B.
  const rows = ['F', 'W', 'F', 'W'].map((season) => ({ kind: 'study', season, codes: [] }));
  const want = ['A101', 'A201', 'A202', 'A203', 'A204', 'A205'].map((code) => ({ code }));
  const byYear = PE.arrange(rows, want, { courses: {}, load: 2 });
  assert.deepEqual(byYear.left, ['A205'], 'second year is full');
  const early = PE.arrange(rows, want, { courses: {}, load: 2, early: true });
  assert.deepEqual(early.left, []);
  assert.deepEqual(early.placed.find((p) => p.code === 'A205').row, 0, 'into the first term with room');
  const chain = { A205: ['x', 0.5, [{ r: 'all', c: ['A204'] }], 0, 0, [1, 1, 1]] };
  assert.deepEqual(PE.arrange(rows, want, { courses: chain, load: 2, early: true }).left, ['A205'], 'not before its prerequisite');
});

test('pathways: a goal for the optimal plan', async () => {
  const { goalQuery } = await import('../site/pathways/goals.js');
  // A career stands for its topics; a topic or a textbook's contents is searched as it is; roles drop out.
  const swe = goalQuery('non-math student still swe');
  assert.deepEqual(swe.names, ['software engineering']);
  assert.match(swe.query, /^software engineering, software design, algorithms/);
  assert.doesNotMatch(swe.query, /math|student/);
  assert.deepEqual(goalQuery('classics professor').names, ['classics']);
  assert.doesNotMatch(goalQuery('classics professor').query, /professor/);
  assert.deepEqual(goalQuery('Latin and Greek').names, ['classical languages']);
  assert.deepEqual(goalQuery('latin american studies'), { query: 'latin american studies', names: [] });
  assert.deepEqual(goalQuery('machine learning'), { query: 'machine learning', names: [] });
  assert.doesNotMatch(goalQuery('high school teacher').query, /high|school/);
  const toc = 'Introduction to Algorithms: sorting, heaps, hash tables, binary search trees, dynamic programming, greedy algorithms, graph algorithms, NP-completeness';
  assert.deepEqual(goalQuery(toc), { query: toc, names: [] });
  assert.deepEqual(goalQuery('  '), { query: '', names: [] });

  // With a goal, a requirement's choice goes to the course that fits it, and free electives come from it, up to
  // the degree's units, not from another program's own courses.
  const C = {
    ECON101: ['Microeconomics', 0.5, 0, 0, 0, [2, 2, 2]],
    ECON301: ['Labour Economics', 0.5, 0, 0, 0, [2, 2, 2]],
    ECON302: ['Economics of Technology and Software', 0.5, 0, 0, 0, [2, 2, 2]],
    CS230: ['Introduction to Computers', 0.5, 0, 0, 0, [2, 2, 2]],
    CS330: ['Management Information Systems', 0.5, [{ r: 'all', c: ['CS230'] }], 0, 0, [2, 2, 2]],
    CS430: ['Applications Software Engineering', 0.5, [{ r: 'all', c: ['CS330'] }], 0, 0, [2, 2, 2]],
    SE101: ['Introduction to Methods of Software Engineering', 0.5, 0, 0, 0, [2, 2, 2]],
    HIST101: ['History', 0.5, 0, 0, 0, [2, 2, 2]],
  };
  const econ = { s: 'e', n: 'Economics', t: 'Major', req: [{ h: '', r: [{ r: 'all', c: ['ECON101'] }, { r: 'n', n: 1, c: ['ECON301', 'ECON302'] }], l: [] }] };
  const goal = new Map([['SE101', 1], ['CS430', 0.95], ['CS330', 0.6], ['ECON302', 0.4], ['CS230', 0.3], ['ECON301', 0.05]]);
  const have = new Map([['ECON101', { units: 0.5 }]]);
  assert.deepEqual(PE.optimize([econ], have, { courses: C }).map((a) => a.code), ['ECON301'], 'without one, the first that does');
  const add = PE.optimize([econ], have, { courses: C, goal, total: 3 });
  assert.equal(add[0].code, 'ECON302', 'the choice that fits the goal');
  assert.deepEqual(
    add.slice(1).map((a) => [a.code, a.for ?? null]),
    [['CS230', 'CS430'], ['CS330', 'CS430'], ['CS430', null]],
    'an elective that fits, with its prerequisites ahead of it',
  );
  assert.ok(!add.some((a) => a.code === 'SE101'), 'not a program’s own course');
  assert.ok(add.every((a) => typeof a.goal === 'number'));
  const units = [...have.values(), ...add].length * 0.5;
  assert.ok(units <= 3, 'no more than the degree takes');
});
