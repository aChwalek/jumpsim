// The R2 bucket the tiles live in. Through R2's S3 endpoint when a key for it
// is at hand (~/.config/jumpsim/r2-tiles.env, or R2_ACCESS_KEY_ID and
// R2_SECRET_ACCESS_KEY in the environment): thirty files at once, a whole map
// in a minute or two. Else through Cloudflare's API with wrangler's login,
// paced under its 1200 requests in 5 minutes (see CLAUDE.md): 18 minutes.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';

export const BUCKET = 'jumpsim-tiles';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrangler = (...args) => execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const account = process.env.R2_ACCOUNT_ID ?? JSON.parse(wrangler('whoami', '--json')).accounts[0].id;

// --- The key for the S3 endpoint, if any ---------------------------------------------------------
const keyFile = path.join(os.homedir(), '.config', 'jumpsim', 'r2-tiles.env');
const saved = existsSync(keyFile)
  ? Object.fromEntries(
      readFileSync(keyFile, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {};
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? saved.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? saved.R2_SECRET_ACCESS_KEY;
const s3 = accessKeyId && secretAccessKey ? new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }) : null;
const bucketUrl = `https://${account}.r2.cloudflarestorage.com/${BUCKET}`;
/** Files at once, and requests a second (none: as fast as they go). */
const AT_ONCE = s3 ? 32 : 4;
const RATE = s3 ? Infinity : 3.5;
export const via = s3 ? "R2's S3 endpoint" : "Cloudflare's API, paced";

// --- Cloudflare's API, with wrangler's login ----------------------------------------------------
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
const objects = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects`;

/** One request, again later if turned away for going too fast or a server in trouble. */
async function request(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = s3 ? await s3.fetch(url, init) : await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${auth()}` } });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await sleep(res.status === 429 ? 60000 : 2000 * (attempt + 1));
      continue;
    }
    throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${res.status} ${await res.text()}`);
  }
}

export const putObject = (key, body, headers) => request(s3 ? `${bucketUrl}/${key}` : `${objects}/${key}`, { method: 'PUT', headers, body });

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every key under a prefix. */
export async function listKeys(prefix) {
  const keys = [];
  let cursor = '';
  for (;;) {
    if (s3) {
      const res = await request(`${bucketUrl}?list-type=2&prefix=${encodeURIComponent(prefix)}${cursor ? `&continuation-token=${encodeURIComponent(cursor)}` : ''}`);
      const body = await res.text();
      keys.push(...[...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => unxml(m[1])));
      cursor = /<IsTruncated>true<\/IsTruncated>/.test(body) ? unxml(/<NextContinuationToken>([^<]*)</.exec(body)?.[1] ?? '') : '';
    } else {
      const res = await request(`${objects}?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${cursor}` : ''}`);
      const body = await res.json();
      keys.push(...body.result.map((o) => o.key));
      cursor = body.result_info?.is_truncated ? (body.result_info?.cursor ?? '') : '';
      await sleep(1000 / RATE);
    }
    if (!cursor) return keys;
  }
}

/** Deletes the keys: a thousand a request through S3, one by one through the API. */
export async function deleteKeys(keys) {
  if (!s3) return parallel(keys, (key) => request(`${objects}/${key}`, { method: 'DELETE' }), 'deleted');
  const batches = [];
  for (let k = 0; k < keys.length; k += 1000) batches.push(keys.slice(k, k + 1000));
  await parallel(
    batches,
    async (batch) => {
      const body = `<Delete><Quiet>true</Quiet>${batch.map((key) => `<Object><Key>${xml(key)}</Key></Object>`).join('')}</Delete>`;
      const md5 = createHash('md5').update(body).digest('base64');
      await request(`${bucketUrl}?delete`, { method: 'POST', body, headers: { 'Content-MD5': md5, 'Content-Type': 'application/xml' } });
    },
    'batches deleted',
  );
}

/** Runs `job` on each item, AT_ONCE at a time and no faster than RATE a second; says how far it has got. */
export async function parallel(items, job, label) {
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
      if (done % 500 === 0 || done === items.length) console.log(`  ${label} ${done}/${items.length} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
}

/** About how long n requests take, min. */
export const minutes = (n) => (s3 ? Math.max(1, Math.round(n / 40 / 60)) : Math.round(n / RATE / 60));
