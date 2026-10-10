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
