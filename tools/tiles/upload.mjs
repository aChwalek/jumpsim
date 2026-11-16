// Uploads a map's tiles from public/tiles/<map>/ to the R2 bucket the
// Worker serves /tiles/ from (wrangler.jsonc, binding TILES):
//
//   node tools/tiles/upload.mjs chamonix
//
// The tileset goes last, once every square it names is there.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'jumpsim-tiles';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = process.argv[2];
if (!map) throw new Error('usage: node tools/tiles/upload.mjs <map>');
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
const squares = files.filter((f) => f.endsWith('.glb')).map(entry);
const tileset = files.filter((f) => f.endsWith('tileset.json')).map(entry);

const put = (entries, type) => {
  const manifest = path.join(os.tmpdir(), `jumpsim-tiles-${map}-${Date.now()}.json`);
  writeFileSync(manifest, JSON.stringify(entries));
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'bulk', 'put', BUCKET, '--filename', manifest, '--remote', '--concurrency', '16', '--content-type', type],
    { cwd: root, stdio: 'inherit' },
  );
};
console.log(`${squares.length} squares and the tileset to ${BUCKET}/${map}/`);
put(squares, 'model/gltf-binary');
put(tileset, 'application/json');
