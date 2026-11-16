// Deletes from the R2 bucket the builds of a map that nothing names any more:
// every file under <map>/ but the version kept.
//
//   node tools/tiles/prune.mjs chamonix --keep 202611161410          # says what it would delete
//   node tools/tiles/prune.mjs chamonix --keep 202611161410 --yes    # deletes it
//
// Keep the version src/world/tilesets.ts names on main, and any a branch
// still being tried out names.

import { BUCKET, deleteObject, listKeys, minutes, paced } from './r2.mjs';

const map = process.argv[2];
const keep = process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep') + 1] : undefined;
if (!map || !keep) throw new Error('usage: node tools/tiles/prune.mjs <map> --keep <version> [--yes]');
const keys = await listKeys(`${map}/`);
const gone = keys.filter((k) => !k.startsWith(`${map}/${keep}/`));
const versions = new Set(gone.map((k) => (/^[^/]+\/(\d{12})\//.exec(k)?.[1] ?? '(unversioned)')));
console.log(`${BUCKET}/${map}/: ${keys.length} files, ${gone.length} to delete (${[...versions].join(', ') || 'none'}), keeping ${keep}`);
if (!process.argv.includes('--yes')) {
  console.log('nothing deleted: add --yes');
} else if (gone.length) {
  console.log(`deleting, about ${minutes(gone.length)} min`);
  await paced(gone, deleteObject, 'deleted');
}
