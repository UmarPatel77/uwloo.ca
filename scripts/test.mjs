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
  assert.match(resolve('/1249/xyz/', meta).message, /Fall 2024 Graduate Calendar has no XYZ courses/);
  // Before Kuali and not on uwloo: Waterloo's own archive.
  assert.equal(to('/1241/cs'), 'http://academic-calendar-archive.uwaterloo.ca/graduate-studies/archive-winter-2024/index.html');
  assert.equal(to('/1165'), 'http://academic-calendar-archive.uwaterloo.ca/graduate-studies/archive-spring-2016/index.html');
  assert.equal(to('/1109'), 'http://academic-calendar-archive.uwaterloo.ca/graduate-studies/2010/fall/gradcalendar.uwaterloo.ca/group/Gen-Info-Regs.html');
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
  assert.equal(go('/1171/cs'), 'http://academic-calendar-archive.uwaterloo.ca/graduate-studies/archive-winter-2017/index.html');
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
  // Open Data has 1199 (Fall 2019) to 1261; nothing older.
  const fetch = async (t) => {
    asked.push(t);
    return Number(t) >= 1199 ? { rows: [{ courseId: '1', subjectCode: 'CS', catalogNumber: '134', title: 'Old CS' }], scheduled: t === '1201' ? ['1'] : [] } : { rows: [], scheduled: [] };
  };
  const log = { log() {} };
  const path = `${dir}/h.json`;
  let h = await loadHistory('1269', { maxNew: 10, fetch, path, log });
  assert.deepEqual(asked, ['1265', '1261', '1259', '1255', '1251', '1249', '1245', '1241', '1239', '1235']);
  assert.equal(h.floor, null);
  for (let i = 0; i < 5; i++) h = await loadHistory('1269', { maxNew: 10, fetch, path, log });
  assert.equal(h.floor, '1199');
  assert.equal(h.codes.CS134.first, '1199');
  assert.deepEqual(h.codes.CS134.ran, ['1201']);
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
    assert.match(html, /<tr><th scope="row">2015–16<\/th><td><a href="\/1159\/cs\/" aria-current="page">Fall<\/a><\/td><td><a class="ext" href="http:\/\/academic-calendar-archive\.uwaterloo\.ca\/graduate-studies\/2016\/winter\/[^"]+" title="Winter 2016, in Waterloo’s archive">Winter<\/a><\/td>/);
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

