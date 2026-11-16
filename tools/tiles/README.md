# Terrain tiles

`build.ts` turns a real drop zone's relief and aerial photos into
[3D Tiles](https://github.com/CesiumGS/3d-tiles): a tree of squares, the root
102.4 km a side, each child a quarter of its parent. Each square is one
`.glb`, holding a grid of the ground as the game draws it and its own photo.
The game shows fine squares near the eye and coarse ones far off
(`src/world/tiles.ts`, with 3d-tiles-renderer), so the triangles and texels on
screen stay about the same wherever one flies, and only the squares in view
are fetched.

```
npm install --prefix tools/tiles
node tools/tiles/run.mjs chamonix --dz chamonix,chamonix-durier
node tools/tiles/run.mjs chamonix --dz chamonix,chamonix-durier --focus 0,0,400   # a trial over a small area
```

It writes `public/tiles/<map>/<version>/` (ignored by git: hundreds of
megabytes; `--version` names it, the date and time by default) and the
map's line in `src/world/tilesets.ts`, which the game reads the tileset
from. It reads `src/world/data/<map>.ts`, `tools/dz/<map>.json` and the photos in
`public/dz/<map>/`, so `tools/dz/build.py` must have built the drop zone
first. `--dz` names every drop zone sharing the map (one per exit): each draws
the relief about its own exit every metre.

## What a square holds

- **Heights**: the game's own relief, read through Vite with the game's code
  (`facetedHeight` over the pack's `groundAt`), so the squares lie exactly
  where the grass, the water and the target are laid and the pilot lands. A
  square is split until its grid is as fine as the data under it (100 m, 10 m
  in the fine relief, 1 m about the exits), on the data's own lines: the
  finest squares draw the ground exactly; coarser ones stray from it, and
  that is their error. A skirt hangs round each square to hide the cracks
  along a coarser neighbour.
- **Photo**: 512 texels a side, its edge texels on the square's edges (shared
  with the next square, no seam). A square is also split until its texels are
  as fine as the finest photo over it: IGN orthophotos at zoom 18 (0.42 m)
  over the fine relief, zoom 19 (0.21 m) over the squares about the exits and
  landings (`imagerySpots`), then the drop zone's near, mid and far pictures.
  Each fades into the coarser ones near its edge. A parent's photo is its
  four children's, shrunk.
- **Compression**: photos in KTX2 (Basis ETC1S, quality 192, mipmaps), 8 times
  smaller on the graphics card than a JPEG once decoded; 192 is a fifth
  lighter to download than 255 and looks the same on the ground. Grids are
  quantized and compressed with meshopt.
- **Error**: each square's extras hold its grid's height error (`h`, m) and
  its photo's texel (`t`, m). The game sets the `geometricError` from them as
  it loads the tileset (`src/world/tiles.ts`): the height error × 4 or the
  texel × 10 × the pixels drawn per CSS pixel, whichever is larger, against a
  target of 16 CSS px (24 on a phone). A square is then split once its
  heights are 4 CSS px out or its texels 1.6 pixels drawn wide. The page can
  try others: `?tileError=`, `?tileHeight=`, `?tileTexel=`; `?tiles=0` draws
  the old terrain. The file's own `geometricError` (height × 8, texel × 12)
  only stands if the extras are missing.
- **Hosting**: `node tools/tiles/upload.mjs <map> <version>` puts a build in
  the R2 bucket `jumpsim-tiles`, served straight from R2 at
  `https://tiles.lowpull.app/<map>/<version>/` (its own domain, CORS reads
  from any origin: `cors.json`), cached a year: a build never changes. The
  Worker never sees them, so they cost none of its daily requests. Upload a
  build before shipping its line in `src/world/tilesets.ts`. The dev server
  serves them from `public/tiles/`. A local `npm run deploy` would ship them
  as assets too: deploy from a clean checkout, as usual. Once nothing names
  an older build, `node tools/tiles/prune.mjs <map> --keep <version> --yes`
  deletes it from the bucket (without `--yes` it only says what it would
  delete). See CLAUDE.md for what things cost.

Orthophoto tiles are cached in `~/.cache/jumpsim-dz`, the same as build.py's.
