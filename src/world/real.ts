// Real drop zones built from open data by tools/dz/build.py: the relief, the
// aerial photos draped on it, the buildings, woods and water of
// OpenStreetMap, and the aerodrome and landing areas read off the charts and
// the photos. What the data cannot say (wall colours, how tall the trees
// grow, where people stand, the pattern) comes with each drop zone's look.

import { bridgeSolid, nearPier, underBridge, undersideAt } from './bridge';
import { cliffTopOf, onPad, placePad } from './cliffTop';
import type { Area, Bridge, Building, DzPack, Flag, ImagerySpots, Placed, Rect, Tree } from './dz';
import { inArea, seeded } from './dz';
import { gridOf, reliefFrom } from './terrain';
import { VINE_LENGTH, onVineRow, vineRows, vineyardOf, type Vineyard } from './vines';

const DEG = Math.PI / 180;

/** x, z, length, width, compass heading of the length. */
type RectTuple = [number, number, number, number, number];

/** What tools/dz/build.py writes, in local metres: x east, z south, origin at the main landing area. */
export interface RealDzData {
  origin: { lat: number; lon: number; elevation: number };
  /** Local clock time minus UTC, h. */
  utcOffsetH: number;
  /** Ground above the plain, m, rows north to south, centred on the origin. */
  near: { size: number; spacing: number; heights: number[] };
  far: { size: number; spacing: number; heights: number[] };
  /**
   * Fine relief about the exit (a cliff, a valley), centred on (x, z):
   * decimetres above the plain, little-endian 16-bit integers in base64, rows
   * north to south.
   */
  fine?: { x: number; z: number; size: number; rows?: number; spacing: number; heights: string };
  /** Finer still about a BASE exit on a cliff, inside the fine square, packed the same way. */
  exitRelief?: { x: number; z: number; size: number; spacing: number; heights: string };
  /** The same about each of several exits, in the order of `dz.exits`. */
  exitReliefs?: { x: number; z: number; size: number; spacing: number; heights: string }[];
  /** The photos, finest first: squares centred on the origin, or on (x, z). */
  imagery: { url: string; size: number; x?: number; z?: number }[];
  imagerySpots?: ImagerySpots;
  /** x, z, length, width, heading, height, roof colour (-1: none), wall colour (-1), flat roof, hangar door, greenhouse. */
  buildings: number[][];
  /** Kind letter, ring, then holes. */
  woods: (string | number[])[][];
  /** Hedge (1) or trees (0), then x, z pairs. */
  treeRows: number[][];
  /** x, z pairs. */
  trees: number[];
  water: { kind: string; ring: number[]; holes: number[][] }[];
  dz: {
    boundary: number[];
    fieldRect: RectTuple;
    runways: { ref: string; a: [number, number]; b: [number, number]; width: number; surface: string }[];
    paved: { name: string; surface: string; points: number[]; rect: RectTuple }[];
    landing: { name: string; use: string; surface: string; color: string | null; points: number[]; rect: RectTuple }[];
    /** Where the sport jumpers aim; not drawn if `shown` is false. */
    target: { x: number; z: number; radius: number; color?: string | null; shown?: boolean } | null;
    /** People standing about: x, z. */
    people: [number, number][];
    pond: number[] | null;
    windsocks: [number, number][];
    flags: [number, number, number][];
    /**
     * A cliff or a bridge to BASE jump from: where the run starts (none off a
     * bridge), its heading, and the height down to the landing area, m; the
     * size of a steel step built on the lip, if there is one.
     */
    base?: {
      x: number;
      z: number;
      headingDeg: number;
      runUp: number;
      width: number;
      height: number;
      name: string;
      pad?: { length: number; width: number };
    };
    /** Bridges: the deck's axis, the road's height above the plain, the piers along it. */
    bridges?: (Bridge & { name: string })[];
    /**
     * Several exits, each with its own landing area (an index into `landing`)
     * and target: a drop zone's look picks one. `base` is then the first's.
     */
    exits?: {
      name: string;
      landing: number;
      base: NonNullable<RealDzData['dz']['base']>;
      target: { x: number; z: number; radius: number; shown?: boolean };
    }[];
  };
}

/** Kinds of woods in the data: wood, scrub, orchard, vineyard, mangrove or swamp. */
export type WoodKind = 'w' | 's' | 'o' | 'v' | 'm';

/** What each drop zone adds to its data. */
export interface RealDzLook {
  name: string;
  /** The wind the place usually gets: from, m/s. */
  wind: { fromDeg: number; speed: number };
  /** Grass blades round the pilot: on the field, and mown on the landing area. */
  grass: { rough: number; mown: number };
  /** Walls of the buildings, picked at random. */
  walls: number[];
  /** Roofs, where the photo does not cover them. */
  roofs: number[];
  /** How tall the trees of each kind grow, m, and how many a hectare near the field; none if left out. Vineyards are rows of vines whatever this says. */
  woods: Partial<Record<WoodKind, { height: [number, number]; perHectare: number; slim?: boolean }>>;
  /** Trees along the mapped rows, m. */
  rowHeight: [number, number];
  slimRows?: boolean;
  /** Brightness the photos are drawn at. */
  imageryGain?: number;
  /** The colour of the rock faces, where the photos' is wrong, and how much of the photo's to keep (0..1). */
  rockTint?: { color: number; photo: number };
  /**
   * Ground less than `flatBelow` above the landing area is laid flat, the
   * hills growing out of it over `blend` metres: 12 and 20 if not given.
   * Ground lower than the landing area is laid flat at its level too, unless
   * `below` keeps it as it is.
   */
  relief?: { flatBelow: number; blend: number; below?: boolean };
  /** Which of the data's exits this look jumps from, where it has several. */
  exit?: number;
  /** No grass nor stones drawn about the exit: high mountains, rock and snow. */
  bareExit?: boolean;
  /** No grass higher than this above the landing area, m. */
  grassBelow?: number;
  /** Where the sport jumpers aim, if not the data's target. */
  target?: { x: number; z: number; radius: number };
  targetColor?: number;
  pattern: DzPack['pattern'];
  landingAxisDeg?: number;
  patternSideDeg?: number;
  final: DzPack['final'];
  jumpRun: DzPack['jumpRun'];
}

const SHIRT_COLORS = [0xd94f30, 0x2f6fd0, 0xf0c020, 0x30a060, 0xe8e8e8, 0x9040b0];
const CAR_COLORS = [0xd9d9d9, 0x2b2b2e, 0x8a1f1f, 0x1f3f8a, 0x9a9a9a, 0xf2f2f2, 0x30506a];

const rect = ([x, z, length, width, headingDeg]: RectTuple, color = 0, layer = 0): Rect => ({
  x,
  z,
  length,
  width,
  headingDeg,
  color,
  layer,
});

/** A strip of ground from one point to another. */
function strip(ax: number, az: number, bx: number, bz: number, width: number): Rect {
  const dx = bx - ax;
  const dz = bz - az;
  return { x: (ax + bx) / 2, z: (az + bz) / 2, length: Math.hypot(dx, dz), width, headingDeg: Math.atan2(dx, -dz) / DEG, color: 0, layer: 0 };
}

const hex = (s: string | null | undefined, fallback: number): number => (s ? parseInt(s.replace('#', ''), 16) : fallback);

function bounds(points: number[]): [number, number, number, number] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]!);
    x1 = Math.max(x1, points[i]!);
    z0 = Math.min(z0, points[i + 1]!);
    z1 = Math.max(z1, points[i + 1]!);
  }
  return [x0, z0, x1, z1];
}

function ringArea(points: number[]): number {
  let s = 0;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    s += points[j]! * points[i + 1]! - points[i]! * points[j + 1]!;
  }
  return Math.abs(s) / 2;
}

/** Vineyards are planted out to here, m: beyond, the photo shows them. */
const VINES_REACH = 600;

/** The most trees a drop zone gets, to keep the frame rate. */
const TREE_BUDGET = 40000;

export function createRealDz(data: RealDzData, look: RealDzLook): DzPack {
  const random = seeded(20261112);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;

  // Of several exits, the one this look jumps from, with its own landing.
  const chosen = data.dz.exits?.[look.exit ?? 0];
  const fine = data.fine
    ? { ...gridOf(data.fine.size, data.fine.spacing, decimetres(data.fine.heights), data.fine.rows), x: data.fine.x, z: data.fine.z }
    : undefined;
  const exit = data.exitReliefs?.[look.exit ?? 0] ?? data.exitRelief;
  const finer = fine && exit ? { ...gridOf(exit.size, exit.spacing, decimetres(exit.heights)), x: exit.x, z: exit.z } : undefined;
  const relief = reliefFrom(gridOf(data.near.size, data.near.spacing, data.near.heights), {
    plain: 0,
    flatBelow: look.relief?.flatBelow ?? 12,
    blend: look.relief?.blend ?? 20,
    below: look.relief?.below,
    far: gridOf(data.far.size, data.far.spacing, data.far.heights),
    fine,
    finer,
  });
  // On a ridge of rock and snow, the run is a track trodden even from where
  // it starts to the lip: the relief, every metre, keeps every knob of snow,
  // and the first step off one would be taken for the edge.
  const runBase = chosen?.base ?? data.dz.base;
  const groundAt = look.bareExit && runBase && runBase.runUp > 0 ? trodden(relief, runBase) : relief;
  const onPlain = (x: number, z: number): boolean => Math.abs(groundAt(x, z)) < 0.5;

  // --- The field ------------------------------------------------------------------
  // Grass blades grow round the landing area, mown short on it.
  const sport = chosen ? data.dz.landing[chosen.landing]! : (data.dz.landing.find((l) => l.use === 'sport') ?? data.dz.landing[0]!);
  const mown = rect(sport.rect, look.grass.mown);
  const field: Rect = { ...mown, length: mown.length + 400, width: mown.width + 300, color: look.grass.rough };
  const bare: Rect[] = [];
  for (const r of data.dz.runways) {
    if (r.surface !== 'grass') bare.push(strip(r.a[0], r.a[1], r.b[0], r.b[1], r.width));
  }
  for (const p of data.dz.paved) bare.push(rect(p.rect));
  const dataTarget = chosen?.target ?? data.dz.target;
  const target = look.target ?? (dataTarget ? { x: dataTarget.x, z: dataTarget.z, radius: dataTarget.radius } : { x: 0, z: 0, radius: 2.5 });
  // Where the trees are thickest and the eye comes closest: the landing of the
  // exit jumped from, which may lie far from the origin.
  const [hubX, hubZ] = chosen ? [target.x, target.z] : [0, 0];

  // --- Water ------------------------------------------------------------------------
  // Laid flat at the level of the plain: lakes up in the hills are left to the photo.
  const waterAreas: Area[] = [];
  for (const w of data.water) {
    const [x0, z0, x1, z1] = bounds(w.ring);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (w.kind !== 'sea' && !(onPlain(cx, cz) && onPlain(w.ring[0]!, w.ring[1]!))) continue;
    waterAreas.push({ points: w.ring, holes: w.holes, color: w.kind === 'pool' ? 0x3fa0c0 : 0x2f5560, layer: w.kind === 'sea' ? 1 : 2 });
  }

  // --- Buildings ----------------------------------------------------------------------
  const bridges: Bridge[] = (data.dz.bridges ?? []).map(({ name: _, ...bridge }) => bridge);
  const buildings: Building[] = [];
  for (const [x, z, length, width, heading, height, roof, wall, flatRoof, hangar, greenhouse] of data.buildings as number[][]) {
    // Whatever OSM has under a deck (its own piers, a hut) gives way to the bridge drawn.
    if (underBridge(bridges, x!, z!, 3)) continue;
    if (greenhouse) {
      buildings.push({ x: x!, z: z!, length: length!, width: width!, headingDeg: heading!, height: 3.5, color: 0xdfe4e4, roofColor: 0xe9ecec, flatRoof: true, hangar: false });
      continue;
    }
    buildings.push({
      x: x!,
      z: z!,
      length: length!,
      width: width!,
      headingDeg: heading!,
      height: height!,
      color: wall! >= 0 ? wall! : pick(look.walls),
      roofColor: roof! >= 0 ? roof! : pick(look.roofs),
      flatRoof: flatRoof === 1,
      hangar: hangar === 1 || (height! > 7.5 && length! * width! > 300 && flatRoof !== 1),
    });
  }

  // --- Trees --------------------------------------------------------------------------
  const trees: Tree[] = [];
  const field2 = { points: data.dz.boundary, color: 0, layer: 0 };
  const clear = (x: number, z: number): boolean => !inArea(field2, x, z);
  // Fewer with distance, where only their mass shows over the photo.
  const thin = (d: number): number => (d < 1500 ? 1 : d < 3000 ? 0.5 : 0.25);
  const woods = data.woods
    .map((w) => {
      const kind = w[0] as WoodKind;
      const ring = w[1] as number[];
      const holes = w.slice(2) as number[][];
      const [x0, z0, x1, z1] = bounds(ring);
      return { kind, area: { points: ring, holes, color: 0, layer: 0 }, box: [x0, z0, x1, z1], far: Math.hypot((x0 + x1) / 2 - hubX, (z0 + z1) / 2 - hubZ) };
    })
    .sort((a, b) => a.far - b.far);
  // Vineyards are rows of vines, off the airfield.
  const vineyards: Vineyard[] = [];
  const rows: number[] = [];
  const planted = (x: number, z: number): boolean => Math.hypot(x, z) < VINES_REACH && clear(x, z);
  for (const w of woods) {
    if (w.kind !== 'v') continue;
    const [x0, z0, x1, z1] = w.box as [number, number, number, number];
    // The plot's nearest point is too far.
    if (Math.hypot(Math.max(x0, Math.min(0, x1)), Math.max(z0, Math.min(0, z1))) > VINES_REACH) continue;
    const vineyard = vineyardOf(w.area);
    vineyards.push(vineyard);
    for (const [ax, az, bx, bz] of vineRows(vineyard)) {
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / VINE_LENGTH);
      for (let k = 0; k < n; k++) {
        const px = ax + ((bx - ax) * k) / n;
        const pz = az + ((bz - az) * k) / n;
        const qx = ax + ((bx - ax) * (k + 1)) / n;
        const qz = az + ((bz - az) * (k + 1)) / n;
        if (planted((px + qx) / 2, (pz + qz) / 2)) rows.push(px, pz, qx, qz);
      }
    }
  }
  for (const w of woods) {
    const spec = w.kind === 'v' ? undefined : look.woods[w.kind];
    if (!spec) continue;
    const [x0, z0, x1, z1] = w.box as [number, number, number, number];
    const want = (ringArea(w.area.points) / 10000) * spec.perHectare * thin(w.far);
    const tries = Math.min(Math.round(want * 1.6), TREE_BUDGET);
    for (let k = 0, placed = 0; k < tries && placed < want && trees.length < TREE_BUDGET; k++) {
      const x = x0 + random() * (x1 - x0);
      const z = z0 + random() * (z1 - z0);
      if (!inArea(w.area, x, z) || !clear(x, z)) continue;
      const d = Math.hypot(x - hubX, z - hubZ);
      const [h0, h1] = spec.height;
      trees.push({ x, z, height: (h0 + random() * (h1 - h0)) * (d > 3000 ? 1.3 : 1), slim: spec.slim });
      placed++;
    }
  }
  for (const row of data.treeRows) {
    const hedge = row[0] === 1;
    for (let i = 3; i < row.length; i += 2) {
      const ax = row[i - 2]!;
      const az = row[i - 1]!;
      const bx = row[i]!;
      const bz = row[i + 1]!;
      const length = Math.hypot(bx - ax, bz - az);
      const gap = hedge ? 2.5 : look.slimRows ? 3.5 : 7;
      const n = Math.max(1, Math.floor(length / gap));
      for (let k = 0; k <= n && trees.length < TREE_BUDGET + 8000; k++) {
        const t = k / n;
        const [h0, h1] = look.rowHeight;
        trees.push({
          x: ax + (bx - ax) * t + (random() - 0.5),
          z: az + (bz - az) * t + (random() - 0.5),
          height: hedge ? 2.5 + random() * 1.5 : h0 + random() * (h1 - h0),
          slim: !hedge && look.slimRows,
        });
      }
    }
  }
  for (let i = 0; i < data.trees.length; i += 2) {
    const [h0, h1] = look.rowHeight;
    trees.push({ x: data.trees[i]!, z: data.trees[i + 1]!, height: h0 + random() * (h1 - h0) });
  }

  // Nothing grows on the run up to a BASE exit, nor just either side of it.
  const base = chosen?.base ?? data.dz.base;
  if (base && base.runUp > 0) {
    const h = base.headingDeg * DEG;
    let kept = 0;
    for (const t of trees) {
      const along = (t.x - base.x) * Math.sin(h) - (t.z - base.z) * Math.cos(h);
      const across = (t.x - base.x) * Math.cos(h) + (t.z - base.z) * Math.sin(h);
      if (along < -8 || along > base.runUp + 2 || Math.abs(across) > base.width / 2 + 5) trees[kept++] = t;
    }
    trees.length = kept;
  }
  // Under a bridge, the woods go on down the slopes: only the trees that
  // would reach the deck, or stand where a pier does, are taken out.
  if (bridges.length) {
    let kept = 0;
    for (const t of trees) {
      const clear =
        !underBridge(bridges, t.x, t.z, 4) || (groundAt(t.x, t.z) + t.height < undersideAt(bridges, t.x, t.z) - 3 && !nearPier(bridges, t.x, t.z, 3));
      if (clear) trees[kept++] = t;
    }
    trees.length = kept;
  }

  // --- Life on the DZ -------------------------------------------------------------------
  // Of several landings, only the one jumped to has people on it.
  const people: Placed[] = data.dz.people
    .filter(([x, z]) => !chosen || Math.hypot(x - target.x, z - target.z) < 400)
    .map(([x, z]) => ({ x, z, headingDeg: random() * 360, color: pick(SHIRT_COLORS) }));
  // Car parks partly full, in rows along their length.
  const cars: Placed[] = [];
  for (const p of data.dz.paved) {
    if (!/car park|parking|aparcament|aparcamiento/i.test(p.name)) continue;
    const start = cars.length;
    const [px, pz, length, width, heading] = p.rect;
    const h = heading * DEG;
    const ux = Math.sin(h);
    const uz = -Math.cos(h);
    const rows = Math.max(1, Math.floor(width / 7));
    const per = Math.max(1, Math.floor((length - 4) / 2.8));
    for (let r = 0; r < rows && cars.length < start + 50; r++) {
      const across = (r + 0.5) * (width / rows) - width / 2;
      for (let k = 0; k < per && cars.length < start + 50; k++) {
        if (random() > 0.4) continue;
        const along = (k + 0.5) * ((length - 4) / per) - (length - 4) / 2;
        cars.push({
          x: px + ux * along - uz * across,
          z: pz + uz * along + ux * across,
          headingDeg: heading + 90 + (r % 2) * 180,
          color: pick(CAR_COLORS),
        });
      }
    }
  }
  const flags: Flag[] = data.dz.flags.map(([x, z, height]) => ({ x, z, height, color: 0xe8501e }));
  // The windsock nearest the landing.
  const sock = [...data.dz.windsocks].sort((a, b) => Math.hypot(a[0] - target.x, a[1] - target.z) - Math.hypot(b[0] - target.x, b[1] - target.z))[0];
  const [wx, wz] = sock ?? [target.x + 40, target.z - 40];

  // --- The top of the cliff -----------------------------------------------------------------
  // The steel step on the lip, solid; the bare rock, grass and stones round
  // the exit, where the relief is known every metre.
  const exitBase = base && { x: base.x, z: base.z, headingDeg: base.headingDeg, runUp: base.runUp, width: base.width, height: base.height };
  const pad = exitBase && base.pad && base.runUp > 0 ? placePad(exitBase, base.pad, groundAt) : undefined;
  const squares = [fine, finer]
    .filter((g) => !!g)
    .map((g) => ({
      x: g.x,
      z: g.z,
      size: (g.size - 1) * g.spacing,
      ...(g.rows && g.rows !== g.size ? { sizeZ: (g.rows - 1) * g.spacing } : {}),
      spacing: g.spacing,
    }));
  const closest = finer && squares[squares.length - 1];
  const cliffTop = exitBase && closest && exitBase.runUp > 0 && !look.bareExit ? cliffTopOf(closest, groundAt, exitBase, pad) : undefined;
  const bridgeTop = bridges.length ? bridgeSolid(bridges, groundAt) : undefined;
  const solidAt = (x: number, z: number, y?: number): number => {
    const under = bridgeTop ? bridgeTop(x, z, y) : groundAt(x, z);
    return pad && onPad(pad, x, z) ? Math.max(under, pad.top) : under;
  };

  return {
    name: look.name,
    lat: data.origin.lat,
    lon: data.origin.lon,
    utcOffsetH: data.utcOffsetH,
    imagery: data.imagery,
    imagerySpots: data.imagerySpots,
    imageryGain: look.imageryGain,
    rockTint: look.rockTint,
    wind: look.wind,
    groundAt,
    topAt: bridgeTop || pad ? solidAt : undefined,
    bridges: bridges.length ? bridges : undefined,
    target,
    targetLayer: 6,
    targetShown: dataTarget?.shown !== false,
    targetCentre: false,
    targetColor: look.targetColor ?? (data.dz.target?.color ? hex(data.dz.target.color, 0xcdbf9a) : undefined),
    surfaces: [],
    areas: [],
    grass: { area: field, mown, bare },
    water: [],
    waterAreas,
    flags,
    buildings,
    trees,
    vineRows: rows,
    onVines: (x, z) => planted(x, z) && onVineRow(vineyards, x, z),
    cars,
    people,
    windsock: { x: wx, z: wz, height: 6 },
    pattern: look.pattern,
    landingAxisDeg: look.landingAxisDeg,
    patternSideDeg: look.patternSideDeg,
    final: look.final,
    jumpRun: look.jumpRun,
    base: exitBase && { ...exitBase, pad },
    // The cliff drawn as finely as it is known, short of the edge where it blends away.
    terrainDetail: squares.length ? squares : undefined,
    grassBelow: look.grassBelow,
    // The 100 m terrain reaches as far as the 100 m relief does.
    terrainReach: Math.max(6000, Math.floor(((data.near.size - 1) * data.near.spacing) / 2 / 100) * 100),
    cliffTop,
  };
}

/**
 * The ground with a run trodden into it: from `back` metres behind the start
 * to the lip, as wide as the run and a metre more each side, the ground lies
 * on the straight line between the two ends, blending into the relief over
 * the last metre either side and behind. Over the lip it falls away as it
 * does, but no knob of snow stands up above the line there to stop a runner.
 */
function trodden(
  groundAt: (x: number, z: number) => number,
  base: { x: number; z: number; headingDeg: number; runUp: number; width: number },
): (x: number, z: number) => number {
  const back = 3;
  const h = base.headingDeg * DEG;
  const ux = Math.sin(h);
  const uz = -Math.cos(h);
  const from = groundAt(base.x - ux * back, base.z - uz * back);
  const to = groundAt(base.x + ux * base.runUp, base.z + uz * base.runUp);
  const half = base.width / 2 + 1;
  const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  return (x, z) => {
    const dx = x - base.x;
    const dz = z - base.z;
    const along = dx * ux + dz * uz;
    const across = Math.abs(dx * uz - dz * ux);
    if (along < -back - 1 || along > base.runUp + 3 || across > half + 1) return groundAt(x, z);
    const line = from + ((to - from) * (along + back)) / (base.runUp + back);
    const w = ease(half + 1 - across) * ease(along + back + 1);
    const raw = groundAt(x, z);
    const trod = along > base.runUp ? Math.min(raw, line) : line;
    return w >= 1 ? trod : raw + (trod - raw) * w;
  };
}

/** Heights packed by tools/dz/build.py: decimetres, int16 little-endian, base64. */
function decimetres(packed: string): number[] {
  const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Array<number>(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 10;
  return out;
}
