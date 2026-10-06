// Kuali serves requisites as rendered "ruleView" HTML:
//   group: <li><span>Complete all|N of the following</span><ul>…</ul></li>
//   rule:  <li data-test="ruleView-X"><div data-test="ruleView-X-result">TEXT <div><ul>course links</ul></div></div></li>
// This turns that into a small tree of plain objects so pages can render it cleanly
// and the build can compute "leads to" from it. Nothing unrecognised is dropped:
// it falls through as a text node.

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'source']);
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', eacute: 'é', egrave: 'è',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const norm = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Tolerant HTML → tree. Nodes: {tag, attrs, children, parent} or {text, parent}. */
export function parseHtml(src = '') {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  for (const m of String(src).matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined || m[2] === undefined) {
      top.children.push({ text: decodeEntities(m[5] ?? '<'), parent: top });
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[3] ?? ''), children: [], parent: top };
    top.children.push(node);
    if (!m[4] && !VOID.has(tag)) stack.push(node);
  }
  return root;
}

export const textOf = (n) => (n.text !== undefined ? n.text : n.tag === 'br' ? ' ' : n.children.map(textOf).join(''));
const elems = (n) => n.children.filter((c) => c.tag);

function find(n, pred) {
  for (const c of n.children ?? []) {
    if (c.tag && pred(c)) return c;
    const hit = c.tag ? find(c, pred) : null;
    if (hit) return hit;
  }
  return null;
}

function findAll(n, pred, out = []) {
  for (const c of n.children ?? []) {
    if (!c.tag) continue;
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

function closest(n, tag, stop) {
  for (let p = n.parent; p && p !== stop; p = p.parent) if (p.tag === tag) return p;
  return null;
}

// ---------- course codes ----------

export const CODE_RE = /\b([A-Z]{2,8}) ?(\d{3}[A-Z]{0,2})\b/g;

/** "CS136L" → "CS 136L" */
export function fmtCode(code) {
  const m = /^([A-Z]+)(\d.*)$/.exec(code ?? '');
  return m ? `${m[1]} ${m[2]}` : String(code ?? '');
}

export const slug = (code) => String(code).toLowerCase();

export function codesIn(text) {
  return [...String(text).matchAll(CODE_RE)].map((m) => m[1] + m[2]);
}

// ---------- Kuali rule tree ----------

/** Kuali's rule sentence exactly as the calendar prints it, e.g. "Must have completed at least 1 of the following:". */
const lead = (n) => norm(n.lead);

/** <li> children of a list, looking through the <div> wrappers Kuali puts around nested groups. */
function listItems(ul) {
  const out = [];
  for (const c of ul.children) {
    if (!c.tag) continue;
    if (c.tag === 'li') out.push(c);
    else if (c.tag !== 'ul' && c.tag !== 'ol') out.push(...listItems(c));
  }
  return out;
}

/**
 * A rule sentence as pieces of text and program links, in the calendar's order:
 * "Enrolled in [H-Computer Science (BCS)], [H-Software Engineering]". Skips the nested course list.
 */
function segments(node, out = [], skipLists = true) {
  for (const c of node.children) {
    if (c.text !== undefined) out.push({ t: c.text });
    else if (c.tag === 'br') out.push({ t: ' ' });
    else if (c.tag === 'a' && (c.attrs.href ?? '').includes('/programs/')) out.push({ t: textOf(c), href: c.attrs.href });
    else if (skipLists && (c.tag === 'ul' || c.tag === 'ol')) continue;
    else segments(c, out, skipLists);
  }
  return out;
}

/** Collapse whitespace across pieces; drop empties. */
function tidy(segs) {
  const out = [];
  for (const seg of segs) {
    const t = seg.t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    if (!t) continue;
    const prev = out.at(-1);
    if (prev && !seg.href && !prev.href) prev.t += t;
    else out.push({ ...seg, t });
  }
  for (let i = 1; i < out.length; i++) if (out[i - 1].t.endsWith(' ') && out[i].t.startsWith(' ')) out[i].t = out[i].t.slice(1);
  if (out.length) {
    out[0].t = out[0].t.replace(/^ /, '');
    out.at(-1).t = out.at(-1).t.replace(/ $/, '');
  }
  return out.filter((x) => x.t);
}

const hasLinks = (segs) => segs.some((x) => x.href);

function directText(node) {
  return norm(node.children.filter((c) => !(c.tag === 'div' || c.tag === 'ul')).map(textOf).join(' '));
}

function liToNode(li) {
  const kids = elems(li);
  const sub = kids.find((c) => c.tag === 'ul');
  if (sub) {
    const head = kids.find((c) => c.tag === 'span');
    const label = norm(head ? textOf(head) : directText(li));
    if (/of the following/i.test(label) || !find(li, (n) => (n.attrs['data-test'] ?? '').endsWith('-result'))) {
      return { type: 'group', lead: label, items: listItems(sub).map(liToNode) };
    }
  }
  const result = find(li, (n) => (n.attrs['data-test'] ?? '').endsWith('-result')) ?? li;
  const full = norm(textOf(result));
  let lead = directText(result);
  const courses = [];
  const seen = new Set();
  for (const a of findAll(result, (n) => n.tag === 'a')) {
    const href = a.attrs.href ?? '';
    const label = norm(textOf(a));
    if (!href.includes('/courses/')) continue;
    const code = label.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2,8}\d{3}[A-Z]{0,2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const item = closest(a, 'li', result);
    let title = item ? norm(textOf(item)) : '';
    title = title.replace(label, '').replace(/^\s*[-–]\s*/, '');
    const units = /\((\d+(?:\.\d+)?)\)\s*$/.exec(title)?.[1] ?? null;
    title = title.replace(/\s*\(\d+(?:\.\d+)?\)\s*$/, '');
    courses.push({ code, title, units });
  }
  if (!courses.length) {
    // Inactive courses are listed as plain text: "Must have completed the following: BUS127W".
    const [head, ...rest] = full.split(':');
    const tail = rest.join(':');
    for (const code of codesIn(tail)) {
      if (!seen.has(code)) {
        seen.add(code);
        courses.push({ code, title: '', units: null });
      }
    }
    if (courses.length) lead = `${head}:`;
  }
  if (!courses.length) {
    // Level, program, unit and free-text rules: "Students must be in level 3A or higher", "Enrolled in …".
    const segs = tidy(segments(result, [], false));
    return { type: 'text', text: full, ...(hasLinks(segs) && { segs }) };
  }
  if (!lead) lead = full;
  const segs = tidy(segments(result));
  return { type: 'rule', lead, courses, ...(hasLinks(segs) && { segs }) };
}

/** Lists that aren't inside another list. */
function topLists(node, out = []) {
  for (const c of node.children ?? []) {
    if (!c.tag) continue;
    if (c.tag === 'ul' || c.tag === 'ol') out.push(c);
    else topLists(c, out);
  }
  return out;
}

/** Kuali requisite HTML → array of nodes, or null when empty. Every rule in the HTML ends up in the tree. */
export function kualiToTree(html) {
  if (!html || !norm(html.replace(/<[^>]*>/g, ''))) return null;
  const root = parseHtml(html);
  const items = topLists(root).flatMap(listItems).map(liToNode);
  const outside = tidy(segments(root));
  if (outside.length) {
    const text = norm(outside.map((x) => x.t).join(''));
    items.push({ type: 'text', text, ...(hasLinks(outside) && { segs: outside }) });
  }
  return items.length ? items : null;
}

/** Every course code referenced anywhere in a tree (rule lists and free text). */
export function treeCodes(tree, out = new Set()) {
  for (const n of tree ?? []) {
    if (n.type === 'group') treeCodes(n.items, out);
    else if (n.type === 'rule') n.courses.forEach((c) => out.add(c.code));
    else codesIn(n.text).forEach((c) => out.add(c));
  }
  return out;
}

/** Stable fingerprint for "did this change between calendar years". */
export function treeSignature(tree) {
  const walk = (ns) =>
    (ns ?? []).map((n) =>
      n.type === 'group' ? `${lead(n)}(${walk(n.items)})` : n.type === 'rule' ? `${lead(n)}[${n.courses.map((c) => c.code).sort()}]` : norm(n.text).toLowerCase(),
    ).join(';');
  return walk(tree);
}

// ---------- rendering ----------

/** Escape text and link any course code that exists on the site. */
export function linkCodes(text, known) {
  let out = '';
  let last = 0;
  for (const m of String(text).matchAll(CODE_RE)) {
    const code = m[1] + m[2];
    out += esc(text.slice(last, m.index));
    out += known.has(code) ? `<a class="cc" href="/${slug(code)}/">${esc(fmtCode(code))}</a>` : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

function courseItem(c, known) {
  const link = known.has(c.code)
    ? `<a class="cc" href="/${slug(c.code)}/">${esc(c.code)}</a>`
    : `<span class="cc gone" title="Not in the undergraduate calendar">${esc(c.code)}</span>`;
  const rest = [c.title && ` - ${esc(c.title)}`, c.units && ` (${esc(c.units)})`].filter(Boolean).join('');
  return `<li>${link}${rest ? `<span class="t">${rest}</span>` : ''}</li>`;
}

/** Tree → nested list HTML, in the calendar's own words. */
function sentence(text, segs, known, calendarBase) {
  if (!segs) return linkCodes(text, known);
  return segs.map((x) => (x.href && calendarBase ? `<a href="${esc(calendarBase + x.href)}">${esc(x.t)}</a>` : linkCodes(x.t, known))).join('');
}

/** Tree → nested list HTML, in the calendar's own words. */
export function renderTree(tree, known, calendarBase) {
  const node = (n) => {
    if (n.type === 'group') return `<li class="g"><span class="lead">${esc(lead(n))}</span><ul>${n.items.map(node).join('')}</ul></li>`;
    if (n.type === 'rule') {
      const list = `<ul class="cl">${n.courses.map((c) => courseItem(c, known)).join('')}</ul>`;
      return `<li class="r"><span class="lead">${n.segs ? sentence(null, n.segs, known, calendarBase) : esc(lead(n))}</span>${list}</li>`;
    }
    return `<li class="x">${sentence(n.text, n.segs, known, calendarBase)}</li>`;
  };
  return tree?.length ? `<ul class="req">${tree.map(node).join('')}</ul>` : '';
}

const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br', 'sup', 'sub']);

/** Kuali notes / description HTML → safe HTML with course codes linked. */
export function sanitize(html, known) {
  if (!html) return '';
  const root = parseHtml(html);
  const walk = (n) => {
    if (n.text !== undefined) return linkCodes(n.text, known);
    if (n.tag === 'script' || n.tag === 'style') return '';
    const inner = n.children.map(walk).join('');
    if (n.tag === 'br') return '<br>';
    if (ALLOWED.has(n.tag)) return `<${n.tag}>${inner}</${n.tag}>`;
    if (n.tag === 'div') return `${inner} `;
    return inner;
  };
  const out = walk(root).trim();
  return norm(out.replace(/<[^>]*>/g, '')) ? out : '';
}

/** "[Offered: F,W]" style hints that some descriptions/notes carry. */
export function offeredHint(...texts) {
  for (const t of texts) {
    const m = /Offered:\s*([FWS](?:\s*,\s*[FWS])*)/i.exec(norm(String(t ?? '').replace(/<[^>]*>/g, ' ')));
    if (m) return m[1].toUpperCase().split(/\s*,\s*/);
  }
  return null;
}
