// Makes GitHub Pages and Cloudflare DNS match what this site needs. Runs at the start of every
// workflow run and only changes what's wrong, so manual clicks in Settings → Pages aren't needed.
//
//   Cloudflare (CLOUDFLARE_API_TOKEN):  CNAME @ and www → <owner>.github.io, DNS only;
//                                       TXT _github-pages-challenge-<owner> → PAGES_VERIFICATION_CODE
//   GitHub (PAGES_ADMIN_TOKEN):         Pages on, source "GitHub Actions", custom domain from CNAME,
//                                       Enforce HTTPS as soon as GitHub has issued the certificate
//
// Either token can be missing; that part is skipped with a note. GitHub has no API for the
// "Verify" button on the verified-domains page, so that one click stays manual.
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const GITHUB_API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const CLOUDFLARE_API = process.env.CLOUDFLARE_API_URL ?? 'https://api.cloudflare.com/client/v4';

// ---------- pure planning (unit-tested) ----------

const unquote = (s) => String(s ?? '').replace(/^"(.*)"$/s, '$1');
const sameContent = (type, a, b) =>
  type === 'TXT' ? unquote(a) === unquote(b) : String(a).replace(/\.$/, '').toLowerCase() === String(b).replace(/\.$/, '').toLowerCase();

/** The records this site needs. */
export function desiredRecords({ domain, owner, code }) {
  const target = `${owner.toLowerCase()}.github.io`;
  const out = [
    { type: 'CNAME', name: domain, content: target, proxied: false },
    { type: 'CNAME', name: `www.${domain}`, content: target, proxied: false },
  ];
  if (code) out.push({ type: 'TXT', name: `_github-pages-challenge-${owner.toLowerCase()}.${domain}`, content: `"${code}"` });
  return out;
}

/**
 * What to do to make `existing` (records at want.name) match `want`.
 * Returns a list of {op: 'create'|'update'|'delete'|'ok', record?, body?}.
 * A CNAME can't share its name with A/AAAA/CNAME records, so those get removed.
 */
export function planRecord(want, existing) {
  const same = existing.filter((r) => r.type === want.type);
  const keep = same.find((r) => sameContent(want.type, r.content, want.content)) ?? same[0];
  const ops = [];
  const clashTypes = want.type === 'CNAME' ? ['A', 'AAAA', 'CNAME'] : [want.type];
  for (const r of existing) if (r !== keep && clashTypes.includes(r.type)) ops.push({ op: 'delete', record: r });
  const body = { type: want.type, name: want.name, content: want.content, ttl: 1, ...(want.type === 'TXT' ? {} : { proxied: want.proxied }) };
  if (!keep) ops.push({ op: 'create', body });
  else if (!sameContent(want.type, keep.content, want.content) || (want.type !== 'TXT' && Boolean(keep.proxied) !== want.proxied)) ops.push({ op: 'update', record: keep, body });
  else ops.push({ op: 'ok', record: keep });
  return ops;
}

/** Which Pages settings need changing. */
export function planPages(site, domain) {
  if (!site) return { create: true, update: { build_type: 'workflow', cname: domain } };
  const update = {};
  if (site.build_type !== 'workflow') update.build_type = 'workflow';
  if ((site.cname ?? '').toLowerCase() !== domain.toLowerCase()) update.cname = domain;
  return { create: false, update };
}

// ---------- I/O ----------

const summary = [];
const note = (level, msg) => console.log(`::${level}::${msg}`);
const row = (check, status) => summary.push(`| ${check} | ${status} |`);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function github(method, path, token, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'uwloo-setup',
      ...(body && { 'content-type': 'application/json' }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, `GitHub ${method} ${path}: ${res.status} ${data?.message ?? ''}`.trim());
  return { status: res.status, data };
}

async function cloudflare(method, path, token, body) {
  const res = await fetch(`${CLOUDFLARE_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    const why = data?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || res.statusText;
    throw new ApiError(res.status, `Cloudflare ${method} ${path}: ${why}`);
  }
  return data.result;
}

async function syncDns({ domain, owner, code, token }) {
  if (!token) {
    note('notice', 'CLOUDFLARE_API_TOKEN not set: leaving DNS as it is.');
    row('Cloudflare DNS', 'skipped (no CLOUDFLARE_API_TOKEN)');
    return;
  }
  let zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    const zones = await cloudflare('GET', `/zones?name=${encodeURIComponent(domain)}`, token);
    zoneId = zones?.[0]?.id;
    if (!zoneId) throw new Error(`Cloudflare has no zone named ${domain} that this token can see. Check the token's zone, or set CLOUDFLARE_ZONE_ID.`);
  }
  const changes = [];
  for (const want of desiredRecords({ domain, owner, code })) {
    const existing = await cloudflare('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(want.name)}&per_page=100`, token);
    for (const step of planRecord(want, existing ?? [])) {
      if (step.op === 'delete') await cloudflare('DELETE', `/zones/${zoneId}/dns_records/${step.record.id}`, token);
      if (step.op === 'create') await cloudflare('POST', `/zones/${zoneId}/dns_records`, token, step.body);
      if (step.op === 'update') await cloudflare('PATCH', `/zones/${zoneId}/dns_records/${step.record.id}`, token, step.body);
      if (step.op !== 'ok') changes.push(`${step.op} ${want.type} ${want.name}`);
    }
  }
  if (changes.length) console.log(`Cloudflare: ${changes.join(', ')}`);
  if (!code) note('notice', 'PAGES_VERIFICATION_CODE not set: the GitHub verification TXT record is not managed.');
  row('Cloudflare DNS', changes.length ? `fixed: ${changes.join(', ')}` : 'correct');
}

async function syncPages({ owner, repo, domain, adminToken, readToken }) {
  const base = `/repos/${owner}/${repo}/pages`;
  const settingsUrl = `https://github.com/${owner}/${repo}/settings/pages`;
  const get = async (token) => {
    try {
      return (await github('GET', base, token)).data;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  };

  let admin = adminToken;
  let site;
  if (admin) {
    try {
      site = await get(admin);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
      note('warning', `PAGES_ADMIN_TOKEN was rejected (${err.status}). It may have expired or lack Pages/Administration permissions. Checking with the workflow token instead.`);
      admin = null;
    }
  }
  if (!admin) {
    site = await get(readToken);
    if (!site || site.build_type !== 'workflow') {
      throw new Error(
        `GitHub Pages isn't set to deploy from GitHub Actions. Add a PAGES_ADMIN_TOKEN secret (see README) so this step can do it, or set Source: GitHub Actions at ${settingsUrl}`,
      );
    }
    row('Pages source', 'GitHub Actions');
    row('Custom domain', site.cname ? `${site.cname} (not managed: PAGES_ADMIN_TOKEN missing or rejected)` : `not set; add it at ${settingsUrl}`);
    return;
  }

  if (!site) {
    await github('POST', base, admin, { build_type: 'workflow' });
    console.log('GitHub Pages: turned on with source GitHub Actions');
    site = await get(admin);
  }
  const { update } = planPages(site, domain);
  if (Object.keys(update).length) {
    try {
      await github('PUT', base, admin, update);
      console.log(`GitHub Pages: set ${Object.entries(update).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    } catch (err) {
      // GitHub can refuse the domain while DNS doesn't point at it yet; the next run retries.
      note('warning', `Couldn't update Pages settings yet: ${err.message}`);
    }
  }
  site = await get(admin);
  row('Pages source', site.build_type === 'workflow' ? 'GitHub Actions' : site.build_type);
  row('Custom domain', site.cname ?? 'not set');

  const verified = site.protected_domain_state;
  if (verified === 'verified') row('Domain verified', 'yes');
  else {
    note('notice', `${domain} isn't verified on GitHub yet. With the TXT record in place, click Verify at https://github.com/settings/pages_verified_domains`);
    row('Domain verified', `${verified ?? 'no'}: click Verify at https://github.com/settings/pages_verified_domains`);
  }

  if (site.https_enforced) row('HTTPS', 'enforced');
  else if (site.https_certificate?.state === 'approved') {
    try {
      await github('PUT', base, admin, { https_enforced: true });
      console.log('GitHub Pages: Enforce HTTPS turned on');
      row('HTTPS', 'enforced (turned on this run)');
    } catch (err) {
      note('notice', `HTTPS not enforced yet: ${err.message}`);
      row('HTTPS', 'certificate ready, enforcing failed; will retry next run');
    }
  } else {
    const state = site.https_certificate?.state ?? 'not requested yet';
    note('notice', `HTTPS certificate is "${state}". It's usually issued within an hour of DNS being correct; the next run will enforce HTTPS.`);
    row('HTTPS', `waiting for certificate (${state}); next run enforces it`);
  }

  try {
    const health = await github('GET', `${base}/health`, admin);
    const d = health?.status === 200 ? health.data?.domain : null;
    if (d?.is_proxied || d?.is_cloudflare_ip) {
      note('warning', `${domain} is behind Cloudflare's proxy. GitHub can't issue the certificate that way; set the records to DNS only (grey cloud).`);
    }
  } catch {
    // Health checks are best-effort: 202 (still checking) or 4xx before a domain is set.
  }
}

export async function main() {
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is not set (expected owner/repo; Actions sets it).');
  const domain = (process.env.PAGES_DOMAIN || (await readFile('CNAME', 'utf8'))).trim().toLowerCase();

  try {
    await syncDns({ domain, owner, code: process.env.PAGES_VERIFICATION_CODE?.trim(), token: process.env.CLOUDFLARE_API_TOKEN });
  } catch (err) {
    // DNS only has to be right once; a broken Cloudflare token shouldn't stop the daily deploy.
    note('warning', `DNS not checked: ${err.message}`);
    row('Cloudflare DNS', `not checked: ${err.message}`);
  }
  await syncPages({ owner, repo, domain, adminToken: process.env.PAGES_ADMIN_TOKEN, readToken: process.env.GITHUB_TOKEN });

  const table = ['### Pages and DNS', '', '| Check | Status |', '| --- | --- |', ...summary, ''].join('\n');
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
