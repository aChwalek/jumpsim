// Uploads a build of a map's tiles, public/tiles/<map>/<version>/, to the
// R2 bucket jumpsim-tiles, which serves them at https://tiles.lowpull.app/
// (its own domain: the Worker never sees them, nor counts them):
//
//   node tools/tiles/upload.mjs chamonix 202611161410 [--from n]
//
// A build's files never change: they are cached a year, by the browsers too,
// so that a second flight downloads nothing. Through Cloudflare's API, paced
// (r2.mjs): `wrangler r2 bulk put` goes faster and is turned away. `--from n`
// starts at the n-th square, to finish an upload cut short. The tileset goes
// last, once every square it names is there.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKET, minutes, paced, putObject } from './r2.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [map, version] = process.argv.slice(2);
if (!map || !version) throw new Error('usage: node tools/tiles/upload.mjs <map> <version> [--from n]');
const dir = path.join(root, 'public', 'tiles', map, version);
const CACHE = 'public, max-age=31536000, immutable';

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const file = path.join(d, name);
    if (statSync(file).isDirectory()) walk(file);
    else files.push(file);
  }
};
walk(dir);
const entry = (file) => ({ key: `${map}/${version}/${path.relative(dir, file).split(path.sep).join('/')}`, file });
const from = process.argv.includes('--from') ? Number(process.argv[process.argv.indexOf('--from') + 1]) : 0;
const squares = files
  .filter((f) => f.endsWith('.glb'))
  .map(entry)
  .slice(from);
const tileset = files.filter((f) => f.endsWith('tileset.json')).map(entry);
const put = (type) => (e) => putObject(e.key, readFileSync(e.file), { 'Content-Type': type, 'Cache-Control': CACHE });

console.log(`${squares.length} squares and the tileset to ${BUCKET}/${map}/${version}/, about ${minutes(squares.length)} min`);
await paced(squares, put('model/gltf-binary'), 'squares');
await paced(tileset, put('application/json'), 'tileset');
console.log('done');
