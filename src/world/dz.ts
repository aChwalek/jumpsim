// A drop zone as data: everything the world builder needs to draw it and the
// sim needs to fly over it. World axes: +X east, -Z north, +Y up, metres,
// origin at the landing target. Real drop zones will be more packs like this.

import { AIRCRAFT, type AircraftId, type JumpRun } from '../sim/plane';

export interface Rect {
  x: number;
  z: number;
  /** Size along its heading, m. */
  length: number;
  width: number;
  /** Compass heading of the long axis, degrees. */
  headingDeg: number;
  color: number;
  /** Draw order for overlapping flat surfaces: higher is on top. */
  layer: number;
}

export interface Building {
  x: number;
  z: number;
  length: number;
  width: number;
  height: number;
  headingDeg: number;
  color: number;
  roofColor: number;
  /** A flat roof instead of a gable. */
  flatRoof?: boolean;
  /** Has a hangar door; by default anything over 6 m does. */
  hangar?: boolean;
  /** A tower: bands of windows all round, one every this many metres up. */
  floors?: number;
}

/**
 * What one stands on or runs into at a point: the top of the highest thing
 * there whose underside is below `y` (anything, if not given). A bridge's deck
 * is solid to whoever is level with it or above it, not to who flies under it.
 */
export type SolidAt = (x: number, z: number, y?: number) => number;

/** A bridge: a deck on piers, the road on top. */
export interface Bridge {
  /** Ends of the deck's axis, x, z. */
  a: [number, number];
  b: [number, number];
  /** The road at `a`, m above the plain. */
  top: number;
  /** How much the road rises a metre along from `a` to `b`, falling if negative: level if not given. */
  grade?: number;
  /**
   * Radius of the axis in plan, m, positive if it bends to the right going
   * from `a` to `b`, negative to the left: straight if not given. Distances
   * along the deck are then along the arc.
   */
  radius?: number;
  /** Width of the deck, m. */
  width: number;
  /** Where the piers stand, m along the axis from `a`. */
  piers: number[];
  /** Depth of the girder under the road at the piers and mid-span, m. */
  depth: [number, number];
  /** Share of the deck's width the girder takes under its middle: 0.55 if not given. */
  girder?: number;
  /** Colour of the girder and the pylons. */
  paint?: number;
  /** Height of the parapets, m; over 2 m, wind screens one sees through. 1.1 if not given. */
  parapet?: number;
  /**
   * Piers of their own shape rather than plain boxes: along the deck and
   * across it under the deck, then at `foot.depth` metres under the road,
   * growing as the square of the depth between; and over their top
   * `split.height` metres, in two legs `split.gap` metres apart along the deck.
   */
  pierShape?: { head: [number, number]; foot: { depth: number; along: number; across: number }; split?: { height: number; gap: number } };
  /**
   * A cable-stayed bridge: over each pier a pylon `height` metres above the
   * road, an inverted Y on the deck's axis whose legs stand `foot` metres
   * apart along it, and `stays` stays fanned out each way in one plane down
   * to the middle of the deck, from `reach[0]` to `reach[1]` metres from the pier.
   */
  pylons?: { height: number; foot: number; stays: number; reach: [number, number] };
}

/** The top of a BASE object, where the jumper stands and runs from. */
export interface BaseExit {
  /** Where the jumper stands at the start, m. */
  x: number;
  z: number;
  /** Compass heading of the run, towards the edge, degrees. */
  headingDeg: number;
  /**
   * How far ahead the edge is, m. None (0) off a bridge: the jumper stands on
   * the edge itself, outside the parapet, and jumps out from there.
   */
  runUp: number;
  /** Width of the run marked on top, m. */
  width: number;
  /**
   * Height of the top above the ground at its foot, m; for a cliff, whose
   * foot is a slope of fallen rock, the height down to the landing area.
   */
  height: number;
}

export interface Tree {
  x: number;
  z: number;
  height: number;
  /** A tall narrow tree, such as the cypresses of a windbreak. */
  slim?: boolean;
}

/** A flat polygon on the ground. */
export interface Area {
  /** Corners in turn: x, z, x, z... */
  points: number[];
  /** Holes cut in it, the same way: islands in a lake or the sea. */
  holes?: number[][];
  color: number;
  /** Draw order for overlapping flat surfaces: higher is on top. */
  layer: number;
}

export interface Placed {
  x: number;
  z: number;
  headingDeg: number;
  color: number;
}

/** A feather flag on a pole: it shows the wind, and how high its tip is. */
export interface Flag {
  x: number;
  z: number;
  /** Tip above the ground, m. */
  height: number;
  color: number;
}

export interface Spawn {
  x: number;
  z: number;
  /** Height above the ground, m. */
  height: number;
  headingDeg: number;
}

/** An aerial photo draped on the ground: a square centred on the origin. */
export interface Imagery {
  url: string;
  /** Metres a side. */
  size: number;
}

export interface DzPack {
  name: string;
  /** Where it is on the globe, degrees: the sun depends on it. */
  lat: number;
  lon: number;
  /** Local clock time in July minus UTC, h. French summer time (2) if not given. */
  utcOffsetH?: number;
  /** Photos of the ground, finest first, each covering more than the one before. */
  imagery?: Imagery[];
  /** Brightness the photos are drawn at, 1 as they are. */
  imageryGain?: number;
  /** Wind the place usually gets: where it comes from, and speed in m/s. */
  wind: { fromDeg: number; speed: number };
  groundAt(x: number, z: number): number;
  /**
   * The top of whatever stands at a point, where it is something one can
   * land on or hit (a tower's roof, a bridge's deck); the ground if not given.
   * See SolidAt for `y`.
   */
  topAt?(x: number, z: number, y?: number): number;
  /** Bridges, drawn and solid. */
  bridges?: Bridge[];
  /** An object to BASE jump from. */
  base?: BaseExit;
  /**
   * A square of terrain drawn finer than the rest, centred on (x, z), for a
   * cliff: its sides on the 100 m lines of the terrain mesh.
   */
  terrainDetail?: { x: number; z: number; size: number; spacing: number };
  target: { x: number; z: number; radius: number };
  surfaces: Rect[];
  /** Flat surfaces of any shape. */
  areas?: Area[];
  /** Colour of the ground itself at a point, where nothing is laid on it. */
  landColor?(x: number, z: number): number;
  /** Draw order of the target disc and its centre. */
  targetLayer?: number;
  /** Colour of the target disc: pea gravel by default. */
  targetColor?: number;
  /** False where nothing marks the target on the ground: it is only where people aim. */
  targetShown?: boolean;
  /** The red disc in the middle of the target, which only the made-up drop zones have. */
  targetCentre?: boolean;
  /** Grass drawn blade by blade: all over `area` except on `bare`, cut short on `mown`. */
  grass: { area: Rect; mown: Rect; bare: Rect[] };
  /** Ponds, level with the ground. */
  water: Rect[];
  /** Ponds and rivers of any shape. */
  waterAreas?: Area[];
  flags: Flag[];
  buildings: Building[];
  trees: Tree[];
  cars: Placed[];
  people: Placed[];
  windsock: { x: number; z: number; height: number };
  /**
   * Start of the downwind leg, placed with the wind: metres upwind of the
   * target, and to the right of the downwind track (negative: to the left,
   * for a right-hand circuit).
   */
  pattern: { upwind: number; side: number; height: number };
  /**
   * Where the landing area is long and narrow, finals are flown along it:
   * its compass axis, flown whichever way is nearer into the wind. Straight
   * into the wind if not given.
   */
  landingAxisDeg?: number;
  /**
   * The side of the landing area the pattern is always flown on, compass
   * degrees: left-hand or right-hand depending on the wind. If not given,
   * `pattern.side` says which.
   */
  patternSideDeg?: number;
  /** Start on final: metres downwind of the target, flying into the wind. */
  final: { downwind: number; height: number };
  /**
   * Jump run, flown into the wind: where it starts, metres downwind of the
   * target and off to the side away from the door, so that the target passes
   * on the door side; height above the ground, airspeed, and the plane
   * (a Pilatus PC-6 if not given).
   */
  jumpRun: { downwind: number; offset: number; height: number; indicatedAirspeed: number; aircraft?: AircraftId };
}

/** What one stands on or runs into at a point: a roof or a deck where there is one, else the ground. */
export const solidOf = (dz: DzPack): SolidAt => dz.topAt?.bind(dz) ?? dz.groundAt;

/** Which way finals are flown with the wind from this direction, compass degrees. */
export function landingHeading(dz: Pick<DzPack, 'landingAxisDeg'>, windFromDeg: number): number {
  const wind = ((windFromDeg % 360) + 360) % 360;
  if (dz.landingAxisDeg === undefined) return wind;
  const a = ((dz.landingAxisDeg % 360) + 360) % 360;
  const b = (a + 180) % 360;
  const off = (h: number): number => Math.abs((((h - wind) % 360) + 540) % 360 - 180);
  return off(a) <= off(b) ? a : b;
}

/**
 * How far before the target jump run starts, m: the drop zone's distance
 * into the wind, more as the run turns downwind, since the jumpers then go
 * out before the target and drift back over it.
 */
export function runLeadIn(downwind: number, headingDeg: number, windFromDeg: number): number {
  const into = Math.cos(((headingDeg - windFromDeg) * Math.PI) / 180);
  return downwind + Math.max(0, -into) * 1000;
}

/**
 * Where the jumps start with the wind from this direction. Jump run is flown
 * into the wind at the drop zone's height unless `run` says otherwise.
 */
export function spawnsFor(
  dz: DzPack,
  windFromDeg: number,
  run: { headingDeg?: number; height?: number } = {},
): { pattern: Spawn; final: Spawn; plane: JumpRun } {
  const { x, z } = dz.target;
  const p = dz.pattern;
  const f = dz.final;
  const jr = dz.jumpRun;
  // Under canopy: along the landing direction. Downwind, and to its right,
  // in world axes (+X east, +Z south).
  const land = landingHeading(dz, windFromDeg);
  const to = ((land + 180) * Math.PI) / 180;
  const dx = Math.sin(to);
  const dz_ = -Math.cos(to);
  const rx = Math.cos(to);
  const rz = Math.sin(to);
  let side = p.side;
  if (dz.patternSideDeg !== undefined) {
    const s = (dz.patternSideDeg * Math.PI) / 180;
    side = Math.abs(p.side) * Math.sign(rx * Math.sin(s) - rz * Math.cos(s) || 1);
  }
  // Jump run: ahead along its heading, and off the target on the side away from the door.
  const heading = (((run.headingDeg ?? windFromDeg) % 360) + 360) % 360;
  const h = (heading * Math.PI) / 180;
  const ahead = { x: Math.sin(h), z: -Math.cos(h) };
  const right = { x: Math.cos(h), z: Math.sin(h) };
  const back = runLeadIn(jr.downwind, heading, windFromDeg);
  const aside = -AIRCRAFT[jr.aircraft ?? 'pc6'].doorSide * jr.offset;
  return {
    pattern: {
      x: x - p.upwind * dx + side * rx,
      z: z - p.upwind * dz_ + side * rz,
      height: p.height,
      headingDeg: (land + 180) % 360,
    },
    final: { x: x + f.downwind * dx, z: z + f.downwind * dz_, height: f.height, headingDeg: land },
    plane: {
      x: x - back * ahead.x + aside * right.x,
      z: z - back * ahead.z + aside * right.z,
      height: run.height ?? jr.height,
      headingDeg: heading,
      indicatedAirspeed: jr.indicatedAirspeed,
      aircraft: jr.aircraft,
    },
  };
}

/** Whether the point lies in the polygon. */
export function inArea(a: Area, x: number, z: number): boolean {
  return inRing(a.points, x, z) && !(a.holes ?? []).some((h) => inRing(h, x, z));
}

function inRing(p: number[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!;
    const zi = p[i + 1]!;
    const xj = p[j]!;
    const zj = p[j + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Whether the point is in water. */
export function isWet(dz: DzPack, x: number, z: number): boolean {
  return dz.water.some((r) => inRect(r, x, z)) || (dz.waterAreas ?? []).some((a) => inArea(a, x, z));
}

/** Whether the point lies on the rectangle. */
export function inRect(r: Rect, x: number, z: number): boolean {
  const h = (r.headingDeg * Math.PI) / 180;
  const dx = x - r.x;
  const dz = z - r.z;
  const along = dx * Math.sin(h) - dz * Math.cos(h);
  const across = dx * Math.cos(h) + dz * Math.sin(h);
  return Math.abs(along) <= r.length / 2 && Math.abs(across) <= r.width / 2;
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WOOD_COLORS = [0x37522a, 0x3f5c2e, 0x324a26];
const ROOF_COLORS = [0x9c4a33, 0xa65a3c, 0x8a8a86, 0xb7a58a, 0x7a3c2c];

/**
 * A field cut into one to four parcels side by side, each with its own crop,
 * with a strip of grass between them.
 */
function parcels(field: Rect, random: () => number): Rect[] {
  const r = random();
  const n = r < 0.4 ? 1 : r < 0.72 ? 2 : r < 0.9 ? 3 : 4;
  if (n === 1) return [field];
  const across = random() < 0.5;
  const h = (field.headingDeg * Math.PI) / 180;
  // Unit vectors of the long and the short side.
  const ax = across ? Math.cos(h) : Math.sin(h);
  const az = across ? Math.sin(h) : -Math.cos(h);
  const total = across ? field.width : field.length;
  const shares = Array.from({ length: n }, () => 0.5 + random());
  const sum = shares.reduce((a, b) => a + b, 0);
  const out: Rect[] = [];
  let at = -total / 2;
  for (const share of shares) {
    const size = (total * share) / sum;
    const mid = at + size / 2;
    at += size;
    const color = FIELD_COLORS[Math.floor(random() * FIELD_COLORS.length)]!;
    const piece: Rect = { ...field, x: field.x + ax * mid, z: field.z + az * mid, color };
    if (across) piece.width = size - 5;
    else piece.length = size - 5;
    out.push(piece);
  }
  return out;
}

/** Houses, roofs seen from above, round a crossroads in the middle of a cell. */
function village(out: Rect[], cell: Rect, random: () => number): void {
  const street = { ...cell, length: cell.length * 0.9, width: 6, color: 0x5e6062, layer: 2 };
  out.push(street, { ...street, headingDeg: cell.headingDeg + 90 });
  const h = (cell.headingDeg * Math.PI) / 180;
  for (let k = 0; k < 40; k++) {
    const along = (random() - 0.5) * cell.length * 0.8;
    const side = (random() < 0.5 ? -1 : 1) * (10 + random() * 30);
    const onCross = random() < 0.5;
    const u = onCross ? side : along;
    const v = onCross ? along : side;
    out.push({
      x: cell.x + Math.sin(h) * u + Math.cos(h) * v,
      z: cell.z - Math.cos(h) * u + Math.sin(h) * v,
      length: 9 + random() * 9,
      width: 7 + random() * 5,
      headingDeg: cell.headingDeg + (onCross ? 0 : 90),
      color: ROOF_COLORS[Math.floor(random() * ROOF_COLORS.length)]!,
      layer: 3,
    });
  }
}

const FIELD_COLORS = [0x6f8f3a, 0x7d9a45, 0x597a32, 0x9aa24a, 0xc2b25a, 0xd4c04a, 0x8a6f4a, 0x9c8458, 0x4f7034, 0x86a04e];
const CAR_COLORS = [0xd9d9d9, 0x2b2b2e, 0x8a1f1f, 0x1f3f8a, 0x9a9a9a, 0xf2f2f2, 0x30506a];
const SHIRT_COLORS = [0xd94f30, 0x2f6fd0, 0xf0c020, 0x30a060, 0xe8e8e8, 0x9040b0];

/** Fictional French airfield drop zone, flat, with a hard runway. */
export function createValbrise(): DzPack {
  const random = seeded(20261110);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const surfaces: Rect[] = [];
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const cars: Placed[] = [];
  const people: Placed[] = [];

  // Patchwork of fields all around, leaving the airfield clear. They are
  // cut into parcels further down, with numbers of their own.
  const fields: Rect[] = [];
  const cell = 320;
  for (let i = -14; i <= 14; i++) {
    for (let j = -14; j <= 14; j++) {
      const x = i * cell + (random() - 0.5) * 40;
      const z = j * cell + (random() - 0.5) * 40;
      const onAirfield = x > -520 && x < 760 && z > -420 && z < 380;
      if (onAirfield || random() < 0.06) continue;
      fields.push({
        x,
        z,
        length: cell - 14 - random() * 30,
        width: cell - 14 - random() * 30,
        headingDeg: 8,
        color: pick(FIELD_COLORS),
        layer: 1,
      });
    }
  }

  // Runway 09/27 north of the landing area, with markings.
  const rwyZ = -230;
  const rwyX = 100;
  const runway: Rect = { x: rwyX, z: rwyZ, length: 900, width: 23, headingDeg: 90, color: 0x3a3c40, layer: 2 };
  surfaces.push(runway);
  for (let x = -300; x <= 300; x += 60) {
    surfaces.push({ x: rwyX + x, z: rwyZ, length: 30, width: 0.45, headingDeg: 90, color: 0xe8e8e8, layer: 3 });
  }
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      surfaces.push({ x: rwyX + end * 425, z: rwyZ + k * 2.6, length: 30, width: 1.5, headingDeg: 90, color: 0xe8e8e8, layer: 3 });
    }
  }
  // Taxiway and apron in front of the hangars.
  const taxiway: Rect = { x: -170, z: -175, length: 110, width: 10, headingDeg: 0, color: 0x46484c, layer: 2 };
  const apron: Rect = { x: -180, z: -105, length: 90, width: 60, headingDeg: 90, color: 0x4a4c50, layer: 2 };
  surfaces.push(taxiway, apron);

  // Landing area: mown grass with stripes, and a gravel target.
  const landingArea: Rect = { x: 20, z: 10, length: 260, width: 200, headingDeg: 90, color: 0x6a9a3c, layer: 2 };
  surfaces.push(landingArea);
  for (let k = -9; k <= 9; k += 2) {
    surfaces.push({ x: 20, z: 10 + k * 10, length: 260, width: 10, headingDeg: 90, color: 0x74a644, layer: 3 });
  }
  const target = { x: 0, z: 0, radius: 7 };

  // Swoop pond on the south side of the landing area, along the usual wind,
  // with a bank of bare earth round it.
  const pond: Rect = { x: 20, z: 70, length: 75, width: 22, headingDeg: 90, color: 0x2c5560, layer: 5 };
  const bank: Rect = { ...pond, length: pond.length + 2.4, width: pond.width + 2.4, color: 0x8f8463, layer: 4 };
  surfaces.push(bank);

  // Flags 25 m apart down both sides of the landing axis: their tips cross
  // the horizon when the pilot's feet are 3 m up.
  const flags: Flag[] = [];
  const FLAG_COLORS = [0xe8501e, 0xf2c21a];
  for (let k = 0; k < 6; k++) {
    for (const side of [-1, 1]) {
      flags.push({ x: 75 - k * 25, z: side * 14, height: 4.5, color: FLAG_COLORS[k % 2]! });
    }
  }
  // Pond: tall flags at the corners, gates of short ones 10 m wide at both ends.
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      flags.push({ x: pond.x + end * (pond.length / 2 + 3), z: pond.z + side * (pond.width / 2 + 3), height: 4.5, color: 0x1e6fd0 });
      flags.push({ x: pond.x + end * (pond.length / 2 - 1), z: pond.z + side * 5, height: 1.5, color: 0xe8501e });
    }
  }

  // Hangars, clubhouse, packing shelter.
  buildings.push({ x: -215, z: -60, length: 34, width: 26, height: 9, headingDeg: 90, color: 0xb9bcc0, roofColor: 0x7d8288 });
  buildings.push({ x: -170, z: -58, length: 24, width: 20, height: 7.5, headingDeg: 90, color: 0xa8b0a0, roofColor: 0x6f766c });
  buildings.push({ x: -130, z: -52, length: 16, width: 8, height: 3.4, headingDeg: 90, color: 0xe6dcc6, roofColor: 0x9a4a35 });
  buildings.push({ x: -105, z: -30, length: 14, width: 9, height: 3, headingDeg: 0, color: 0xcfd4d8, roofColor: 0x3f6a8a });

  // Access road along the west side, car park, roadside trees.
  const road: Rect = { x: -300, z: 0, length: 2400, width: 6, headingDeg: 0, color: 0x55575a, layer: 2 };
  const carPark: Rect = { x: -262, z: -20, length: 60, width: 30, headingDeg: 0, color: 0x6b6659, layer: 2 };
  surfaces.push(road, carPark);
  for (let k = 0; k < 14; k++) {
    if (random() < 0.25) continue;
    cars.push({ x: -270 + (k % 2) * 16, z: -46 + Math.floor(k / 2) * 7.5, headingDeg: 90 + (k % 2) * 180, color: pick(CAR_COLORS) });
  }
  cars.push({ x: -300, z: 240, headingDeg: 0, color: pick(CAR_COLORS) });
  cars.push({ x: -303, z: -480, headingDeg: 180, color: pick(CAR_COLORS) });
  for (let z = -1100; z <= 1100; z += 21) {
    if (z > -90 && z < 30) continue;
    trees.push({ x: -309 + random() * 2, z: z + random() * 4, height: 11 + random() * 5 });
  }

  // A wood to the east, a hedge along the south edge, a few loners.
  for (let k = 0; k < 420; k++) {
    const x = 330 + random() * 380;
    const z = -120 + random() * 520;
    if ((x - 330) / 380 + Math.abs(z - 140) / 400 > 1.1) continue;
    trees.push({ x, z, height: 12 + random() * 9 });
  }
  for (let x = -280; x <= 300; x += 9) {
    trees.push({ x: x + random() * 3, z: 245 + random() * 5, height: 5 + random() * 5 });
  }
  for (let k = 0; k < 90; k++) {
    const x = (random() - 0.5) * 5000;
    const z = (random() - 0.5) * 5000;
    if (x > -330 && x < 760 && z > -300 && z < 260) continue;
    trees.push({ x, z, height: 9 + random() * 10 });
  }

  // People: a few watching near the target, some by the buildings.
  for (const [x, z] of [[-14, 9], [-15.2, 10.1], [-22, -6], [-60, -20], [-98, -22], [-101, -24], [-126, -44], [-150, -80]] as const) {
    people.push({ x, z, headingDeg: random() * 360, color: pick(SHIRT_COLORS) });
  }

  // Farmland on out to the haze, for the view from altitude, with woods and
  // villages. Its own random numbers, so that nothing nearer moves.
  const far = seeded(4000);
  const farPick = <T>(list: T[]): T => list[Math.floor(far() * list.length)]!;
  for (let i = -40; i <= 40; i++) {
    for (let j = -40; j <= 40; j++) {
      if (Math.abs(i) <= 14 && Math.abs(j) <= 14) continue;
      const x = i * cell + (far() - 0.5) * 60;
      const z = j * cell + (far() - 0.5) * 60;
      const kind = far();
      if (kind < 0.04) continue;
      // Fields of a block of land run the same way; the next block may not.
      const block = Math.sin(Math.floor(i / 5) * 12.9898 + Math.floor(j / 5) * 78.233) * 43758.5453;
      const headingDeg = [8, 8, 8, 24, -14, 38][Math.floor((block - Math.floor(block)) * 6)]!;
      const size = cell - 14 - far() * 40;
      const rect: Rect = { x, z, length: size, width: cell - 14 - far() * 40, headingDeg, color: farPick(FIELD_COLORS), layer: 1 };
      if (kind < 0.11) {
        surfaces.push({ ...rect, color: farPick(WOOD_COLORS) });
      } else if (kind < 0.125) {
        village(surfaces, rect, far);
      } else {
        fields.push(rect);
      }
    }
  }
  const split = seeded(4001);
  for (const field of fields) surfaces.push(...parcels(field, split));

  return {
    name: 'Valbrise',
    // Made up: somewhere in the middle of France.
    lat: 46.2,
    lon: 2.6,
    wind: { fromDeg: 270, speed: 3 },
    groundAt: () => 0,
    target,
    surfaces,
    grass: {
      // The airfield, short of the fields around it.
      area: { x: 120, z: -20, length: 930, width: 450, headingDeg: 90, color: 0x5d7f38, layer: 0 },
      mown: landingArea,
      bare: [runway, taxiway, apron, road, carPark, bank],
    },
    water: [pond],
    flags,
    buildings,
    trees,
    cars,
    people,
    windsock: { x: -45, z: -45, height: 6 },
    // Left-hand circuit, south of the landing area with the usual westerly.
    pattern: { upwind: 180, side: 160, height: 300 },
    final: { downwind: 260, height: 90 },
    // Into the wind along the north side, a little short of the spot: out
    // at once, the canopy opens about over the target; after ten seconds,
    // well upwind of it.
    jumpRun: { downwind: 500, offset: 60, height: 4000, indicatedAirspeed: 40 },
  };
}
