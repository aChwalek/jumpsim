// The R2 bucket the tiles live in, through Cloudflare's API with wrangler's
// login: paced under the API's 1200 requests in 5 minutes (see CLAUDE.md).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'jumpsim-tiles';
/** Requests a second, under the API's 4. */
const RATE = 3.5;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const wrangler = (...args) => execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const account = JSON.parse(wrangler('whoami', '--json')).accounts[0].id;
// The login lasts about an hour: asked again every twenty minutes. Its last line: wrangler prints its banner first.
let token = '';
let tokenAt = 0;
const auth = () => {
  if (Date.now() - tokenAt > 20 * 60 * 1000) {
    token = wrangler('auth', 'token').trim().split('\n').pop().trim();
    tokenAt = Date.now();
  }
  return token;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const objects = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects`;

/** One request, again later if turned away for going too fast or a server in trouble. */
export async function request(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${auth()}` } });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await sleep(res.status === 429 ? 60000 : 5000 * (attempt + 1));
      continue;
    }
    throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${res.status} ${await res.text()}`);
  }
}

export const putObject = (key, body, headers) => request(`${objects}/${key}`, { method: 'PUT', headers, body });
export const deleteObject = (key) => request(`${objects}/${key}`, { method: 'DELETE' });

/** Every key under a prefix. */
export async function listKeys(prefix) {
  const keys = [];
  let cursor = '';
  for (;;) {
    const res = await request(`${objects}?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${cursor}` : ''}`);
    const body = await res.json();
    keys.push(...body.result.map((o) => o.key));
    cursor = body.result_info?.cursor ?? '';
    if (!body.result_info?.is_truncated || !cursor) return keys;
    await sleep(1000 / RATE);
  }
}

/** Runs `job` on each item, four at a time, the k-th no sooner than k / RATE seconds in; says how far it has got. */
export async function paced(items, job, label) {
  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      const wait = started + (k / RATE) * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      await job(items[k]);
      done++;
      if (done % 100 === 0 || done === items.length) console.log(`  ${label} ${done}/${items.length} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

export const minutes = (n) => Math.round(n / RATE / 60);
