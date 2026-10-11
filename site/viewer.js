// The PDF on a resource page (/cs341/1249-notes/). PDF.js draws each page itself, so it shows the same on
// every device: Chrome on Android, for one, won't show a PDF inside a page and offers a download instead.
//
// Pages are drawn once scrolling settles, nearest first, two at a time, and dropped when far off screen,
// so a 500-page scan on a phone stays as light as a 10-page handout. Each page fits the width on its own
// (scans mix page sizes); zoom multiplies that.

const viewer = document.getElementById('viewer');
const box = document.getElementById('vpages');
const pageNo = document.getElementById('vpage-no');
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const FIT = 4; // ZOOMS[FIT] === 1
const AT_ONCE = 2;
const MARGIN = 1500; // px above and below the screen that count as near
const MAX_PIXELS = 16e6; // iOS Safari won't draw a canvas bigger than this
let zoom = FIT;
let pdfjs = null;
let doc = null;
let pages = []; // {n, el, size: {w, h} at scale 1, proxy, task, text, drawn: scale drawn at, busy, gen, fails}
const near = new Set();

const fail = () => {
  box.innerHTML = `<p class="vmsg">This PDF couldn’t be shown here. <a href="${viewer.dataset.src}">Open it directly</a>.</p>`;
};

const width = () => box.clientWidth - 2; // page borders
const scaleOf = (p) => (width() / (p.size ?? pages[0].size).w) * ZOOMS[zoom];

function size(p) {
  const s = scaleOf(p);
  const { w, h } = p.size ?? pages[0].size;
  p.el.style.width = `${Math.floor(w * s)}px`;
  p.el.style.height = `${Math.floor(h * s)}px`;
  p.el.style.setProperty('--total-scale-factor', s);
  if (p.drawn && p.drawn !== s) undraw(p);
}
const layout = () => pages.forEach(size);

function undraw(p) {
  p.gen = (p.gen ?? 0) + 1;
  p.task?.cancel();
  p.task = null;
  p.text?.cancel?.();
  p.text = null;
  p.drawn = 0;
  p.el.replaceChildren();
}

async function draw(p) {
  p.busy = true;
  const gen = p.gen ?? 0;
  const stale = () => gen !== (p.gen ?? 0);
  try {
    p.proxy ??= await doc.getPage(p.n);
    if (stale()) return;
    const unit = p.proxy.getViewport({ scale: 1 });
    if (!p.size || p.size.w !== unit.width || p.size.h !== unit.height) {
      p.size = { w: unit.width, h: unit.height };
      size(p);
    }
    const s = scaleOf(p);
    const vp = p.proxy.getViewport({ scale: s });
    let dpr = window.devicePixelRatio || 1;
    while (dpr > 1 && vp.width * vp.height * dpr * dpr > MAX_PIXELS) dpr -= 0.25;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.setAttribute('aria-hidden', 'true');
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    p.el.replaceChildren(canvas, layer);
    p.drawn = s;
    p.task = p.proxy.render({ canvas, viewport: vp, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
    await p.task.promise;
    p.task = null;
    if (stale()) return;
    p.text = new pdfjs.TextLayer({ textContentSource: p.proxy.streamTextContent(), container: layer, viewport: vp });
    await p.text.render();
  } catch (err) {
    p.task = null;
    if (err?.name !== 'RenderingCancelledException' && err?.name !== 'AbortException') {
      p.fails = (p.fails ?? 0) + 1;
      console.warn(`page ${p.n}:`, err);
    }
  } finally {
    p.busy = false;
    pump();
  }
}

// Start drawing the near pages that need it, closest to the middle of the screen first.
function pump() {
  const busy = pages.filter((p) => p.busy).length;
  if (busy >= AT_ONCE) return;
  const mid = innerHeight / 2;
  const dist = (p) => {
    const r = p.el.getBoundingClientRect();
    return r.bottom < mid ? mid - r.bottom : r.top > mid ? r.top - mid : 0;
  };
  const todo = [...near].filter((p) => !p.busy && p.drawn !== scaleOf(p) && (p.fails ?? 0) < 2).sort((a, b) => dist(a) - dist(b));
  for (const p of todo.slice(0, AT_ONCE - busy)) draw(p);
}

// While scrolling fast, wait: a page that's flown past isn't worth drawing. Draw at least every 300 ms.
let settle = null;
let lastPump = 0;
function soon() {
  clearTimeout(settle);
  if (performance.now() - lastPump > 300) {
    lastPump = performance.now();
    pump();
  }
  settle = setTimeout(() => {
    lastPump = performance.now();
    pump();
  }, 120);
}

// Which page is at the top of the screen, for "Page 34 of 212".
function currentPage() {
  const line = viewer.querySelector('.vbar').getBoundingClientRect().bottom + Math.min(innerHeight * 0.25, 160);
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pages[mid].el.getBoundingClientRect().top <= line) lo = mid;
    else hi = mid - 1;
  }
  return pages[lo];
}

let ticking = false;
function onScroll() {
  soon();
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    if (pages.length) pageNo.textContent = `Page ${currentPage().n} of ${pages.length}`;
  });
}

function goTo(n, smooth) {
  const p = pages[Math.min(Math.max(1, n), pages.length) - 1];
  if (p) p.el.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });
}
const pageFromHash = () => Number(/^#page=(\d+)$/.exec(location.hash)?.[1] ?? 0);

// Resizing or zooming keeps the same spot of the same page at the top of the screen.
function keepPlace(change) {
  const bar = viewer.querySelector('.vbar').getBoundingClientRect().bottom;
  const keep = currentPage();
  const before = keep.el.getBoundingClientRect();
  const into = (bar - before.top) / before.height;
  change();
  layout();
  const after = keep.el.getBoundingClientRect();
  window.scrollBy({ top: after.top + into * after.height - bar, behavior: 'instant' });
  soon();
}

async function start() {
  try {
    pdfjs = await import(viewer.dataset.pdfjs);
    const dir = viewer.dataset.pdfjs.replace(/pdf\.min\.js$/, '');
    pdfjs.GlobalWorkerOptions.workerSrc = `${dir}pdf.worker.min.js`;
    // Scans often use JBIG2 or JPEG 2000 images, which PDF.js decodes with these WebAssembly files;
    // the fonts and character maps cover PDFs that don't embed theirs. Each loads only when needed.
    doc = await pdfjs.getDocument({
      url: viewer.dataset.src,
      enableXfa: false,
      wasmUrl: `${dir}wasm/`,
      standardFontDataUrl: `${dir}standard_fonts/`,
      cMapUrl: `${dir}cmaps/`,
      iccUrl: `${dir}iccs/`,
    }).promise;
  } catch (err) {
    console.warn(err);
    return fail();
  }
  const first = await doc.getPage(1);
  const unit = first.getViewport({ scale: 1 });
  box.replaceChildren();
  pages = Array.from({ length: doc.numPages }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'vpage';
    el.id = `page-${i + 1}`;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `Page ${i + 1}`);
    el.dataset.n = i + 1;
    box.append(el);
    return { n: i + 1, el, size: i === 0 ? { w: unit.width, h: unit.height } : null, proxy: i === 0 ? first : null, drawn: 0 };
  });
  layout();
  if (pageFromHash()) goTo(pageFromHash());

  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const p = pages[en.target.dataset.n - 1];
        if (en.isIntersecting) near.add(p);
        else {
          near.delete(p);
          if (p.drawn || p.busy) undraw(p);
        }
      }
      soon();
    },
    { rootMargin: `${MARGIN}px 0px` },
  );
  for (const p of pages) io.observe(p.el);

  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  let w = box.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(box.clientWidth - w) < 2) return;
    w = box.clientWidth;
    keepPlace(() => {});
  }).observe(box);
}

viewer.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-zoom]');
  if (!b || !pages.length) return;
  const step = Number(b.dataset.zoom);
  keepPlace(() => {
    zoom = step === 0 ? FIT : Math.min(ZOOMS.length - 1, Math.max(0, zoom + step));
  });
  for (const x of viewer.querySelectorAll('[data-zoom]')) x.setAttribute('aria-pressed', String(x.dataset.zoom === '0' && zoom === FIT));
});

// Page notes link to #page=34.
addEventListener('hashchange', () => {
  const n = pageFromHash();
  if (n && pages.length) goTo(n, true);
});

// "Copy" next to the citation.
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    const el = document.getElementById(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(el.textContent);
      btn.textContent = 'Copied';
    } catch {
      getSelection().selectAllChildren(el);
      btn.textContent = 'Selected';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 2000);
  });
}

start();
