// Runs the tile builder (build.ts) through Vite, so that it reads the relief
// with the game's own code: the tiles then lie exactly where the ground is
// drawn and walked on.
//
//   node tools/tiles/run.mjs <map> [options]: see README.md.

import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
let failed = false;
try {
  const { main } = await server.ssrLoadModule('/tools/tiles/build.ts');
  await main(process.argv.slice(2));
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
