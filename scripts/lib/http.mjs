import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const UA = 'uwloo.ca-builder/1.0 (+https://uwloo.ca; static site rebuilt daily)';

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;

/** GET JSON. Retries network errors, 429 and 5xx (honouring Retry-After); throws HttpError otherwise. */
export async function getJson(url, { headers = {}, retries = 5, timeout = 45_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return res.json();
    await res.arrayBuffer().catch(() => {});
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
      continue;
    }
    throw new HttpError(res.status, url);
  }
}

/** Run `fn` over `items` with at most `n` in flight. Logs progress every `every` items. */
export async function pool(items, n, fn, label = '', every = 500) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
      done++;
      if (label && (done % every === 0 || done === items.length)) {
        console.log(`  ${label}: ${done}/${items.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export async function readCache(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeCache(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

export const ageDays = (iso) => (Date.now() - Date.parse(iso ?? 0)) / 86_400_000;
