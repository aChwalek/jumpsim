// Uploads a map's tiles from public/tiles/<map>/ to the R2 bucket the
// Worker serves /tiles/ from (wrangler.jsonc, binding TILES):
//
//   node tools/tiles/upload.mjs chamonix [--from n]
//
// Through Cloudflare's API with wrangler's login, a few requests a second:
// the API takes 1200 requests in 5 minutes, and `wrangler r2 bulk put`
// goes faster and is turned away. `--from n` starts at the n-th square, to
// finish an upload cut short. The tileset goes last, once every square it
// names is there.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'jumpsim-tiles';
/** Requests a second, under the API's 4. */
const RATE = 3.5;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = process.argv[2];
if (!map) throw new Error('usage: node tools/tiles/upload.mjs <map> [--from n]');
const dir = path.join(root, 'public', 'tiles', map);

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const file = path.join(d, name);
    if (statSync(file).isDirectory()) walk(file);
    else files.push(file);
  }
};
walk(dir);
const entry = (file) => ({ key: `${map}/${path.relative(dir, file).split(path.sep).join('/')}`, file });
const from = process.argv.includes('--from') ? Number(process.argv[process.argv.indexOf('--from') + 1]) : 0;
const squares = files
  .filter((f) => f.endsWith('.glb'))
  .map(entry)
  .slice(from);
const tileset = files.filter((f) => f.endsWith('tileset.json')).map(entry);

const wrangler = (...args) => execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const account = JSON.parse(wrangler('whoami', '--json')).accounts[0].id;
// The login lasts about an hour: asked again every twenty minutes.
let token = '';
let tokenAt = 0;
const auth = () => {
  if (Date.now() - tokenAt > 20 * 60 * 1000) {
    // The last line: wrangler prints its banner first.
    token = wrangler('auth', 'token').trim().split('\n').pop().trim();
    tokenAt = Date.now();
  }
  return token;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function put({ key, file }, type) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects/${key}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth()}`, 'Content-Type': type },
      body: readFileSync(file),
    });
    if (res.ok) return;
    // Turned away for going too fast, or a server in trouble: once more, later.
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await sleep(res.status === 429 ? 60000 : 5000 * (attempt + 1));
      continue;
    }
    throw new Error(`${key}: HTTP ${res.status} ${await res.text()}`);
  }
}

async function upload(entries, type) {
  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < entries.length) {
      const k = next++;
      // Paced: the k-th request no sooner than k / RATE seconds in.
      const wait = started + (k / RATE) * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      await put(entries[k], type);
      done++;
      if (done % 100 === 0 || done === entries.length) {
        console.log(`  ${done}/${entries.length} (${Math.round((Date.now() - started) / 1000)} s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

console.log(`${squares.length} squares and the tileset to ${BUCKET}/${map}/, about ${Math.round(squares.length / RATE / 60)} min`);
await upload(squares, 'model/gltf-binary');
await upload(tileset, 'application/json');
console.log('done');
