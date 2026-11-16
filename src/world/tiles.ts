// The terrain of a real drop zone as 3D Tiles, built by tools/tiles: squares
// of ground, each with its own aerial photo, fine near the eye and coarse far
// from it, fetched as the eye goes (3d-tiles-renderer). They take the
// ground's own material, its grain and rock, with the square's photo instead
// of the drop zone's few big ones.

import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, TilesFadePlugin } from '3d-tiles-renderer/three/plugins';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { handheld } from '../viewport';
import type { Forest } from './forest';

/**
 * Screen-space error the tiles are refined to, CSS px. A phone takes coarser
 * squares, fewer of them.
 */
const ERROR_TARGET = { desktop: 16, handheld: 24 };
/**
 * What a square's error is made of (tools/tiles writes both in its extras):
 * its grid's height error, m, times HEIGHT_WEIGHT, or its photo's texel, m,
 * times TEXEL_WEIGHT and the pixels drawn per CSS pixel, whichever is
 * larger. Against a target of 16 CSS px, a square is split once its heights
 * are 4 CSS px out or its texels 1.6 pixels drawn wide: on a fine screen the
 * photo is as sharp as it is drawn, the shape no finer than the eye needs.
 */
const HEIGHT_WEIGHT = 4;
const TEXEL_WEIGHT = 10;

interface TileJson {
  geometricError: number;
  boundingVolume: { box: number[] };
  extras?: { h: number; t: number };
  children?: TileJson[];
}

/**
 * How far above its ground a square's box reaches, m: the box holds the
 * ground only, and a square whose ground is out of the picture is not drawn,
 * nor are its trees, which may stand 50 m tall in it.
 */
const TREE_ROOM = 55;

/** Sets each square's error from its extras, at least its children's; lifts its box over its trees. */
function weigh(tile: TileJson, height: number, texel: number): number {
  // The tileset's frame is z up: the box's centre z and its half-height up.
  const box = tile.boundingVolume.box;
  box[2] = box[2]! + TREE_ROOM / 2;
  box[11] = box[11]! + TREE_ROOM / 2;
  const children = (tile.children ?? []).map((c) => weigh(c, height, texel));
  if (!tile.extras) return tile.geometricError;
  tile.geometricError = children.length ? Math.max(tile.extras.h * height, tile.extras.t * texel, ...children.map((e) => e * 1.01)) : 0;
  return tile.geometricError;
}
/** Bytes of squares held at most, on the graphics card and off: then coarser ones are shown. */
const HELD_BYTES = { desktop: 400e6, handheld: 160e6 };

export interface TerrainTiles {
  object: THREE.Object3D;
  /** Call every frame, once the camera has moved: picks and fetches the squares it needs. */
  update(): void;
  /** Whether the squares the camera needs have all come in. */
  ready(): boolean;
  /** How many squares have come in so far: it changes as finer ones arrive. */
  arrived(): number;
  /** Squares drawn, triangles, and the bytes of the ones held; with `bySize`, how many squares are drawn of each size, m. */
  stats(bySize?: boolean): { visible: number; loaded: number; downloading: number; bytes: number; sizes?: Record<number, number> };
  dispose(): void;
}

let ktx2: KTX2Loader | null = null;

/**
 * Where the tiles are fetched from: the dev server's public/tiles, or the R2
 * bucket on its own domain, straight from Cloudflare's edge, so that they
 * never go through the Worker and count against its requests.
 */
export const TILES_ORIGIN = import.meta.env.DEV ? `${import.meta.env.BASE_URL}tiles/` : 'https://tiles.lowpull.app/';

/** A number the page asks for (?tileError=24, ?tileHeight=4, ?tileTexel=10), to try others out. */
function asked(name: string): number | null {
  try {
    const v = Number(new URLSearchParams(location.search).get(name));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Whether the page asks for the old terrain instead (?tiles=0), to compare. */
export function tilesWanted(): boolean {
  try {
    return new URLSearchParams(location.search).get('tiles') !== '0';
  } catch {
    return true;
  }
}

/**
 * The tiles at `url` (under TILES_ORIGIN), seen by `camera`. Each square's mesh takes the
 * material `material` makes from its photo; `prepare` is called on each
 * material made (cloud shadows).
 */
export function buildTerrainTiles(
  url: string,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  material: (photo: THREE.Texture, texel: number) => THREE.Material,
  forest?: Forest,
): TerrainTiles {
  ktx2 ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
  // In development, another build can be tried (?tileset=chamonix/<version>/tileset.json).
  const tried = import.meta.env.DEV ? new URLSearchParams(location.search).get('tileset') : null;
  const tiles = new TilesRenderer(`${TILES_ORIGIN}${tried ?? url}`);
  tiles.registerPlugin(new GLTFExtensionsPlugin({ ktxLoader: ktx2, meshoptDecoder: MeshoptDecoder }));
  const device = handheld() ? 'handheld' : 'desktop';
  tiles.errorTarget = asked('tileError') ?? ERROR_TARGET[device];
  const cache = (tiles as unknown as { lruCache: { maxBytesSize: number; minBytesSize: number } }).lruCache;
  cache.maxBytesSize = HELD_BYTES[device];
  cache.minBytesSize = HELD_BYTES[device] * 0.75;
  // Off-screen squares stay in the scene (culled as usual): the map from above draws them too.
  tiles.displayActiveTiles = true;
  tiles.setCamera(camera);
  // The error is weighed in CSS pixels: on a screen of fine pixels (2 or 3 a CSS
  // pixel), the squares a pixel needs would be four or nine times as many.
  const css = new THREE.Vector2();
  const resolution = (): void => {
    renderer.getSize(css);
    tiles.setResolution(camera, css.x, css.y);
  };
  resolution();
  // The tileset is z up, as 3D Tiles have it; the world is y up.
  tiles.group.rotation.x = -Math.PI / 2;
  tiles.group.name = 'terrain';

  let loading = false;
  let arrived = 0;
  let rootIn = false;
  let updated = false;
  tiles.addEventListener('load-root-tileset', ({ tileset }) => {
    const texel = asked('tileTexel') ?? TEXEL_WEIGHT * renderer.getPixelRatio();
    weigh((tileset as { root: TileJson }).root, asked('tileHeight') ?? HEIGHT_WEIGHT, texel);
    rootIn = true;
  });
  tiles.addEventListener('tiles-load-start', () => (loading = true));
  tiles.addEventListener('tiles-load-end', () => (loading = false));
  // The squares' trees go to the forest, drawn all together.
  if (forest) {
    tiles.addEventListener('dispose-model', ({ tile }) => forest.remove(tile));
    tiles.addEventListener('tile-visibility-change', ({ tile, visible }) => forest.show(tile, visible));
  }
  tiles.addEventListener('load-model', ({ scene, tile }) => {
    arrived++;
    if (forest) {
      tiles.group.updateMatrixWorld();
      forest.add(tile, scene as THREE.Object3D, tiles.group.matrixWorld);
    }
    // A texel of the square's photo, m: its edges hold texels too.
    const box = (tile as { boundingVolume: { box: number[] } }).boundingVolume.box;
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material as THREE.MeshStandardMaterial;
      const photo = old.map;
      if (!photo) return;
      photo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const texel = (box[3]! * 2) / ((photo.image as { width: number }).width - 1);
      mesh.material = material(photo, texel);
      old.map = null;
      old.dispose();
      mesh.renderOrder = 0;
    });
  });
  // A square giving way to finer ones dissolves into them instead of switching at once. Registered
  // after the listener above, so that it takes the ground's material, not the glTF's.
  tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 400 }));

  return {
    object: tiles.group,
    update() {
      resolution();
      tiles.update();
      updated = true;
    },
    ready: () => rootIn && updated && !loading,
    arrived: () => arrived,
    stats(bySize) {
      const t = tiles as unknown as {
        stats: { visible: number; loaded: number; downloading: number };
        lruCache: { cachedBytes: number };
        visibleTiles: Set<{ boundingVolume: { box: number[] } }>;
      };
      const sizes: Record<number, number> = {};
      if (bySize) for (const tile of t.visibleTiles) sizes[tile.boundingVolume.box[3]! * 2] = (sizes[tile.boundingVolume.box[3]! * 2] ?? 0) + 1;
      return { visible: t.stats.visible, loaded: t.stats.loaded, downloading: t.stats.downloading, bytes: t.lruCache.cachedBytes, ...(bySize ? { sizes } : {}) };
    },
    dispose() {
      tiles.dispose();
    },
  };
}
