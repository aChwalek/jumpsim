# Low Pull (jumpsim)

A parachute and BASE simulator in the browser (three.js, TypeScript, Vite),
served by a Cloudflare Worker (`worker/`, `wrangler.jsonc`). Every push to
`main` goes live; other branches get Preview URLs (Workers Builds).

## Costs

Everything runs on Cloudflare's free plans. Keep it that way: ask Antoine
before anything that needs a paid plan or a new paid product.

- **Worker requests are the tight limit**: 100,000 a day on the free plan,
  shared by every route the Worker answers (`/signal`, `/players`, `/turn`,
  `/perf`, `/api`, `/scores`). Past it, the Worker answers errors until
  00:00 UTC. Nothing is billed, but multiplayer, accounts and scores stop.
  Keep per-file and per-frame traffic off the Worker:
  - Static files go in `public/`: assets are served before the Worker, free
    and without limit.
  - Big data goes to R2 behind its own domain (below).
- **Big data goes to R2, not git and not the Worker**: the terrain tiles
  (`tools/tiles`) live in the bucket `jumpsim-tiles`, served straight from
  R2 at `https://tiles.lowpull.app/`.
  - The bucket allows CORS reads (GET, HEAD) from any origin:
    `tools/tiles/cors.json`.
  - R2 free tier, per month: 10 GB stored, 1 M writes, 10 M reads. Egress is
    free.
  - Each flight reads about a thousand tiles. Chamonix stores 0.3 GB;
    Millau, Pujaut and Chambéry 0.2 GB each.
- **Upload versions, never overwrite**: a build goes to
  `<map>/<version>/...` with `Cache-Control: public, max-age=31536000,
  immutable`, so browsers keep it and a second flight downloads nothing.
  - Upload a build before shipping the code that names it
    (`src/world/tilesets.ts`, written by the build).
  - Delete old versions once nothing names them.
- **Cloudflare's API takes 1200 requests per 5 minutes**: bulk transfers to
  R2 must not go through it.
  - Upload through R2's S3 endpoint instead, with the bucket's own key in
    `~/.config/jumpsim/r2-tiles.env` (outside any repo; never commit it).
    `tools/tiles/r2.mjs` uses it: a whole map uploads in about a minute.
  - Without that key, the scripts fall back to the API at 3.5 requests a
    second: 18 minutes a map.
  - `wrangler r2 bulk put` goes faster than the API allows, is turned away
    (429), and can hang silently.
- **The players' data costs too**: the first flight over a tiled map
  downloads tens of megabytes, and phones on mobile data pay for it.
  - When changing how fine the tiles are (`src/world/tiles.ts`) or how they
    are built, measure the bytes of a flight before and after.
  - Prefer cheaper settings on phones.
