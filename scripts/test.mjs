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
  for (const [code, entries] of map) {
    assert.match(code, /^[A-Z]{2,6}\d{3}[A-Z]?$/, code);
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
