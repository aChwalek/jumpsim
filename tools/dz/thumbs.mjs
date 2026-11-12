// Makes the small pictures of each drop zone from above that the DZ list in
// the menu shows (public/dz/thumbs/<id>.jpg). They are cut from the map the
// sim draws itself, so run the dev server first, then:
//
//   npm i --no-save playwright-core
//   node tools/dz/thumbs.mjs [http://127.0.0.1:5173/]
//
// It drives the installed Google Chrome, on the real graphics card.

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = new URL('../../public/dz/thumbs/', import.meta.url);
const IDS = ['valbrise', 'pujaut', 'chambery', 'empuriabrava', 'guadeloupe'];
/** Side of the picture, px, and the part of the map it shows (from its centre). */
const SIZE = 192;
const CROP = 0.55;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// Same light for all: mid-morning, clear sky.
await page.addInitScript(() => localStorage.clear());
await page.goto(url, { timeout: 180000 });
await page.waitForFunction(() => window.sim?.menu, null, { timeout: 180000 });

for (const id of IDS) {
  await page.evaluate((id) => {
    window.sim.menu.debugSetDz(id);
    window.sim.menu.debugShow('dz');
  }, id);
  // Loaded, photos in, and the map drawn again with them.
  await page.waitForFunction(
    (id) => window.sim.setup.dz === id && window.sim.world.ready() && !document.querySelector('#menu .map-veil.on'),
    id,
    { timeout: 180000, polling: 250 },
  );
  await page.waitForTimeout(1500);
  const data = await page.evaluate(
    ({ size, crop }) => {
      const map = document.querySelector('#menu .map-picture');
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const side = map.width * crop;
      const from = (map.width - side) / 2;
      c.getContext('2d').drawImage(map, from, from, side, side, 0, 0, size, size);
      return c.toDataURL('image/jpeg', 0.84);
    },
    { size: SIZE, crop: CROP },
  );
  writeFileSync(new URL(`${id}.jpg`, out), Buffer.from(data.split(',')[1], 'base64'));
  console.log('thumb', id);
}
await browser.close();
