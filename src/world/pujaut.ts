// Pujaut: the drop zone on the Avignon-Pujaut aerodrome (LFNT), in the Gard,
// built from real data where there is some. The relief is IGN's, the field
// with its grass runways, the official landing area and the buildings around
// the hangar come from the aerodrome chart and OpenStreetMap, and so do the
// windbreaks, woods, villages, roads and water. Only the crops of the
// unmapped fields, the cars, people and caravans are made up.
//
// The aerodrome lies on a former lake bed, flat as a table, ringed by low
// hills of scrub and pine 1.5 to 5 km away, with the Rhône behind the
// eastern ridge.

import type { Area, Building, DzPack, Placed, Rect, Tree } from './dz';
import { inArea, seeded } from './dz';
import { AERODROME, AREAS, BUILDINGS, LAND, ORIGIN, RELIEF, ROADS, TREE_ROWS, VILLAGES, WATER } from './pujautData';
import { reliefFrom } from './terrain';

const DEG = Math.PI / 180;

/** Draw order of the flat things, bottom to top. */
const LAYER = { fields: 1, rows: 2, mapped: 3, roads: 4, field: 5, runways: 6, landing: 7, marks: 8 };

/** Colour of the ground by land use (see LAND): Provence in early July, dry. */
const LAND_COLORS: Record<string, number> = {
  v: 0x87884f,
  o: 0x6c8243,
  f: 0xb09d62,
  g: 0x8e9852,
  w: 0x3e5631,
  s: 0x6a6d45,
  r: 0xb2a487,
  i: 0x9a9993,
  q: 0xc0b597,
  h: 0xcfd2cc,
  a: 0x86895a,
  c: 0x8c8c82,
  l: 0x4d6a72,
};
/** Unmapped ground: dry soil on the plain, garrigue on the hills. */
const PLAIN_SOIL = 0x958f5c;
const HILL_SCRUB = 0x7b7a50;

/** Fields of the plain that nobody mapped: what grows there, and how much of it. */
const CROPS: { share: number; color: number; rows?: { spacing: number; width: number; color: number } }[] = [
  { share: 0.4, color: 0x8f8a58, rows: { spacing: 2.5, width: 0.9, color: 0x4f6b2c } }, // vines
  { share: 0.14, color: 0x7f8a50, rows: { spacing: 5, width: 2.6, color: 0x45612b } }, // orchard
  { share: 0.1, color: 0x6f9a3f }, // market garden
  { share: 0.12, color: 0xc9b57a }, // wheat stubble
  { share: 0.08, color: 0x9b7f5e }, // ploughed
  { share: 0.1, color: 0xa9a26a }, // fallow
  { share: 0.06, color: 0x6b8a35 }, // sunflowers, maize
];

const pairs = (list: readonly (number | string)[], from = 0): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = from; i + 1 < list.length; i += 2) out.push([list[i] as number, list[i + 1] as number]);
  return out;
};

/** A strip of ground from one point to another. */
function strip(ax: number, az: number, bx: number, bz: number, width: number, color: number, layer: number): Rect {
  const dx = bx - ax;
  const dz = bz - az;
  return {
    x: (ax + bx) / 2,
    z: (az + bz) / 2,
    length: Math.hypot(dx, dz),
    width,
    headingDeg: Math.atan2(dx, -dz) / DEG,
    color,
    layer,
  };
}

const vary = (hex: number, amount: number, random: () => number): number => {
  const k = 1 + (random() - 0.5) * 2 * amount;
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((hex >> 16) & 255) << 16) | (c((hex >> 8) & 255) << 8) | c(hex & 255);
};

const circle = (x: number, z: number, r: number, n = 32): number[] => {
  const points: number[] = [];
  for (let i = 0; i < n; i++) points.push(x + r * Math.cos((i / n) * 2 * Math.PI), z + r * Math.sin((i / n) * 2 * Math.PI));
  return points;
};

/** Buildings of the aerodrome that are known, by their mapped centre. */
const KNOWN: { x: number; z: number; color: number; roofColor: number; height?: number; flatRoof?: boolean; hangar?: boolean }[] = [
  // Main hangar, Skydive Pujaut: white roof.
  { x: 81.7, z: 29.8, color: 0xc9ccd0, roofColor: 0xeceeef, height: 9, hangar: true },
  // Volomax wind tunnel: a 10 m tower, blue roof.
  { x: 138.9, z: 97.8, color: 0xdfe3e6, roofColor: 0x2f6fb0, height: 10, flatRoof: true, hangar: false },
  // Restaurant, low building, sheds.
  { x: 163.6, z: 7.9, color: 0xe6d8bd, roofColor: 0xb45f3c, height: 5, hangar: false },
  { x: 105.9, z: 1.5, color: 0xd9d4c8, roofColor: 0x8c8f93, height: 4, hangar: false },
  // Glider hangar and clubhouse.
  { x: 502.9, z: 304.1, color: 0xb9bcc0, roofColor: 0x7d8288, height: 7, hangar: true },
];

const WALLS = [0xe6d8bd, 0xdcc49a, 0xece6da, 0xd9b98c, 0xe0d0b4];
const ROOFS = [0xb45f3c, 0xa8553a, 0xc06a45, 0x9c4f36];
const CAR_COLORS = [0xd9d9d9, 0x2b2b2e, 0x8a1f1f, 0x1f3f8a, 0x9a9a9a, 0xf2f2f2, 0x30506a];
const SHIRT_COLORS = [0xd94f30, 0x2f6fd0, 0xf0c020, 0x30a060, 0xe8e8e8, 0x9040b0];

export function createPujaut(): DzPack {
  const random = seeded(20261111);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;

  // --- Relief and land ------------------------------------------------------
  const size = RELIEF.size;
  const spacing = RELIEF.spacing;
  const half = ((size - 1) * spacing) / 2;
  const rows: number[][] = [];
  for (let r = 0; r < size; r++) rows.push(RELIEF.heights.slice(r * size, (r + 1) * size));
  const groundAt = reliefFrom({ spacing, size, heights: rows }, { plain: 0, flatBelow: RELIEF.flatBelow, blend: 20 });
  /** Land use letter at the nearest grid point. */
  const landAt = (x: number, z: number): string => {
    const c = Math.round((x + half) / spacing);
    const r = Math.round((z + half) / spacing);
    return c < 0 || r < 0 || c >= size || r >= size ? '.' : LAND[r]![c]!;
  };
  const colorOf = (x: number, z: number): number =>
    LAND_COLORS[landAt(x, z)] ?? (groundAt(x, z) > 0 ? HILL_SCRUB : PLAIN_SOIL);
  /** Ground colour, blended between the grid points around. */
  const landColor = (x: number, z: number): number => {
    const s = spacing / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [dx, dz] of [[-s, -s], [s, -s], [-s, s], [s, s]] as const) {
      const hex = colorOf(x + dx, z + dz);
      r += (hex >> 16) & 255;
      g += (hex >> 8) & 255;
      b += hex & 255;
    }
    return ((r / 4) << 16) | ((g / 4) << 8) | (b / 4);
  };
  /** Flat all round, with a margin: the flat surfaces are laid at zero. */
  const flatAround = (x: number, z: number, margin: number): boolean =>
    [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dz]) => groundAt(x + dx!, z + dz!) === 0);

  const fieldArea: Area = { points: AERODROME.boundary, color: 0x9e9a5e, layer: LAYER.field };
  const onAirfield = (x: number, z: number, margin = 0): boolean =>
    inArea(fieldArea, x, z) ||
    (margin > 0 && [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([dx, dz]) => inArea(fieldArea, x + dx!, z + dz!)));

  const surfaces: Rect[] = [];
  const areas: Area[] = [];
  const trees: Tree[] = [];
  const buildings: Building[] = [];
  const cars: Placed[] = [];
  const people: Placed[] = [];

  /** Cypresses along a line, a few metres apart, as in the windbreaks of the Rhône valley. */
  const windbreak = (ax: number, az: number, bx: number, bz: number): void => {
    const length = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.floor(length / 3.5));
    const tall = 8 + random() * 4;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      trees.push({ x: ax + (bx - ax) * t + (random() - 0.5), z: az + (bz - az) * t + (random() - 0.5), height: tall * (0.85 + 0.3 * random()), slim: true });
    }
  };

  // --- Fields of the plain ------------------------------------------------
  // Long narrow strips, square with the aerodrome as the real ones are: their
  // long side runs on 124 degrees.
  const [, , , , fieldHeading] = AERODROME.fieldRect as number[];
  const ux = Math.sin(fieldHeading! * DEG);
  const uz = -Math.cos(fieldHeading! * DEG);
  const vx = -uz;
  const vz = ux;
  const REACH = 4500;
  const cropOf = (): (typeof CROPS)[number] => {
    let x = random();
    for (const crop of CROPS) if ((x -= crop.share) <= 0) return crop;
    return CROPS[0]!;
  };
  for (let v = -REACH; v < REACH; ) {
    const width = 25 + random() * 35;
    for (let u = -REACH - random() * 200; u < REACH; ) {
      const length = 120 + random() * 140;
      const cu = u + length / 2;
      const cv = v + width / 2;
      u += length;
      const x = cu * ux + cv * vx;
      const z = cu * uz + cv * vz;
      const far = Math.hypot(x, z);
      if (far > REACH) continue;
      if (!flatAround(x, z, length / 2 + 60) || onAirfield(x, z, length / 2)) continue;
      if ('rwilqch'.includes(landAt(x, z))) continue;
      const crop = cropOf();
      const heading = fieldHeading!;
      // A track or a ditch between neighbours: the bare soil shows.
      const l = length - 3;
      const w = width - 3;
      surfaces.push({ x, z, length: l, width: w, headingDeg: heading, color: vary(crop.color, 0.07, random), layer: LAYER.fields });
      if (crop.rows && far < 1500) {
        for (let k = -w / 2 + crop.rows.spacing / 2; k < w / 2; k += crop.rows.spacing) {
          surfaces.push({ x: x + k * vx, z: z + k * vz, length: l - 2, width: crop.rows.width, headingDeg: heading, color: crop.rows.color, layer: LAYER.rows });
        }
      }
      // Some fields have a windbreak along their long side.
      if (far < 2500 && random() < 0.16) {
        const ex = x + (width / 2) * vx;
        const ez = z + (width / 2) * vz;
        windbreak(ex - (l / 2) * ux, ez - (l / 2) * uz, ex + (l / 2) * ux, ez + (l / 2) * uz);
      }
    }
    v += width;
  }

  // --- What is mapped ------------------------------------------------------
  for (const a of AREAS) {
    const kind = a[0] as string;
    const color = LAND_COLORS[kind];
    if (color === undefined || kind === 'l') continue;
    areas.push({ points: a.slice(1) as number[], color: vary(color, 0.06, random), layer: LAYER.mapped });
  }
  const waterAreas: Area[] = WATER.map((points) => ({ points, color: 0x2f5560, layer: LAYER.roads }));
  for (const row of TREE_ROWS) {
    const points = pairs(row);
    for (let i = 1; i < points.length; i++) windbreak(...points[i - 1]!, ...points[i]!);
  }
  for (const road of ROADS) {
    const [width, dirt] = road as [number, number];
    const color = dirt ? 0xa8987a : width > 15 ? 0x4a4c50 : 0x55575a;
    const points = pairs(road, 2);
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]!;
      const [bx, bz] = points[i]!;
      // Roads over the hills are left to the hills.
      if (groundAt(ax, az) > 0 || groundAt(bx, bz) > 0) continue;
      // A little longer, so that the joints do not show.
      const length = Math.hypot(bx - ax, bz - az) || 1;
      const ex = ((bx - ax) / length) * width * 0.4;
      const ez = ((bz - az) / length) * width * 0.4;
      surfaces.push(strip(ax - ex, az - ez, bx + ex, bz + ez, width, color, LAYER.roads));
    }
  }
  // The high-speed line, on its gravel bed.
  for (const line of AERODROME.rail as number[][]) {
    const points = pairs(line);
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]!;
      const [bx, bz] = points[i]!;
      if (groundAt(ax, az) > 0 || groundAt(bx, bz) > 0) continue;
      surfaces.push(strip(ax, az, bx, bz, 14, 0x8d877c, LAYER.roads));
    }
  }

  // --- The aerodrome -------------------------------------------------------
  // A grass square grazed by sheep, burnt yellow in July, with grass runways
  // mown a little shorter and marked with white boards.
  areas.push(fieldArea);
  for (const r of AERODROME.runways) {
    const [ax, az] = r.a as [number, number];
    const [bx, bz] = r.b as [number, number];
    const runway = strip(ax, az, bx, bz, r.width, 0x8f9658, LAYER.runways);
    surfaces.push(runway);
    const h = runway.headingDeg * DEG;
    const along = [Math.sin(h), -Math.cos(h)] as const;
    const across = [Math.cos(h), Math.sin(h)] as const;
    for (let s = -runway.length / 2; s <= runway.length / 2 + 1; s += 150) {
      for (const side of [-1, 1]) {
        const x = runway.x + along[0] * s + across[0] * side * (r.width / 2);
        const z = runway.z + along[1] * s + across[1] * side * (r.width / 2);
        surfaces.push({ x, z, length: 3, width: 0.8, headingDeg: runway.headingDeg, color: 0xf0f0ea, layer: LAYER.marks });
      }
    }
  }
  const landing: Area = { points: AERODROME.landingArea, color: 0x7c9a48, layer: LAYER.landing };
  areas.push(landing);
  const [sx, sz, sr] = AERODROME.sandCircle as [number, number, number];
  areas.push({ points: circle(sx, sz, sr), color: 0xd8cfb0, layer: LAYER.landing });
  const paved: Rect[] = [];
  const water: Rect[] = [];
  for (const [name, x, z, length, width, heading] of AERODROME.paved as [string, number, number, number, number, number][]) {
    const rect: Rect = { x, z, length, width, headingDeg: heading, color: 0x55575a, layer: LAYER.landing };
    if (name.startsWith('Swimming')) water.push({ ...rect, color: 0x3fa0c0 });
    else if (name.startsWith('Toilets')) buildings.push({ ...rect, height: 2.6, color: 0xe6d8bd, roofColor: 0xb45f3c, hangar: false });
    else {
      if (name.startsWith('Apron')) rect.color = 0xb5b2aa;
      paved.push(rect);
      surfaces.push(rect);
    }
  }

  // --- Buildings -----------------------------------------------------------
  for (const [x, z, length, width, heading, height, roof] of BUILDINGS as [number, number, number, number, number, number, number][]) {
    const known = KNOWN.find((k) => Math.hypot(k.x - x, k.z - z) < 4);
    if (known) {
      buildings.push({ x, z, length, width, headingDeg: heading, height: known.height ?? height, color: known.color, roofColor: known.roofColor, flatRoof: known.flatRoof, hangar: known.hangar });
    } else if (roof === 0) {
      // Greenhouses: low, flat, white plastic.
      buildings.push({ x, z, length, width, headingDeg: heading, height: 3.5, color: 0xdfe4e4, roofColor: 0xe9ecec, flatRoof: true, hangar: false });
    } else {
      buildings.push({ x, z, length, width, headingDeg: heading, height, color: pick(WALLS), roofColor: pick(ROOFS), hangar: height > 7.5 });
    }
  }
  // Villages beyond the buildings mapped one by one: houses scattered in the built-up areas.
  let houses = 0;
  for (const points of VILLAGES) {
    const village: Area = { points, color: 0, layer: 0 };
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of pairs(points)) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    if (Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) < 1900 || Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) > 6500) continue;
    const streets = random() * 180;
    const tries = Math.round(((x1 - x0) * (z1 - z0)) / 900);
    for (let k = 0; k < tries && houses < 4000; k++) {
      const x = x0 + random() * (x1 - x0);
      const z = z0 + random() * (z1 - z0);
      if (!inArea(village, x, z)) continue;
      houses++;
      buildings.push({
        x,
        z,
        length: 9 + random() * 6,
        width: 7 + random() * 3,
        height: 5.5 + random() * 1.8,
        headingDeg: streets + (random() < 0.5 ? 0 : 90) + (random() - 0.5) * 10,
        color: pick(WALLS),
        roofColor: pick(ROOFS),
        hangar: false,
      });
    }
  }
  // Caravans and vans of the jumpers who sleep on the DZ, north of the landing area.
  for (let k = 0; k < 9; k++) {
    buildings.push({ x: 18 + k * 8 + random() * 3, z: -78 - random() * 35, length: 5.5 + random() * 2, width: 2.3, height: 2.6, headingDeg: 34 + random() * 20, color: 0xeeeeea, roofColor: 0xdedede, flatRoof: true, hangar: false });
  }

  // --- Woods and garrigue --------------------------------------------------
  // Pines and holm oaks in the woods, kermes oak and broom in the scrub,
  // thinner with distance where only their mass shows.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const kind = LAND[r]![c]!;
      const cx = c * spacing - half;
      const cz = r * spacing - half;
      const far = Math.hypot(cx, cz);
      const hill = groundAt(cx, cz) > 0;
      const wood = kind === 'w';
      const scrub = kind === 's' || (kind === '.' && hill);
      if ((!wood && !scrub) || far > 5200) continue;
      const n = wood ? (far < 1500 ? 24 : far < 3000 ? 12 : 6) : far < 1500 ? 10 : far < 3000 ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const x = cx + (random() - 0.5) * spacing;
        const z = cz + (random() - 0.5) * spacing;
        if (onAirfield(x, z, 15)) continue;
        const grow = far > 3000 ? 1.3 : 1;
        trees.push({ x, z, height: (wood ? 8 + random() * 7 : 2.5 + random() * 3) * grow });
      }
    }
  }

  // --- Life on the DZ ------------------------------------------------------
  const carPark = paved[0]!;
  for (let k = 0; k < 16; k++) {
    if (random() < 0.25) continue;
    const row = Math.floor(k / 8);
    const s = (k % 8) - 3.5;
    const h = carPark.headingDeg * DEG;
    const x = carPark.x + Math.sin(h) * s * 6.5 + Math.cos(h) * (row - 0.5) * 14;
    const z = carPark.z - Math.cos(h) * s * 6.5 + Math.sin(h) * (row - 0.5) * 14;
    cars.push({ x, z, headingDeg: carPark.headingDeg + 90 + row * 180, color: pick(CAR_COLORS) });
  }
  for (const [x, z] of [[-9, -55], [-10.4, -54], [55, 30], [58, 33], [62, 26], [70, 52], [110, 40], [150, 12], [-40, -70]] as const) {
    people.push({ x, z, headingDeg: random() * 360, color: pick(SHIRT_COLORS) });
  }

  const [lx, lz, ll, lw, lh] = AERODROME.landingRect as number[];
  const [fx, fz, fl, fw, fh] = AERODROME.fieldRect as number[];
  const [wx, wz] = AERODROME.windsock as number[];
  return {
    name: 'Pujaut',
    lat: ORIGIN.lat,
    lon: ORIGIN.lon,
    // The mistral, north-north-west: four days in ten on summer afternoons.
    wind: { fromDeg: 340, speed: 5 },
    groundAt,
    landColor,
    // The gravel disc in the north-west part of the landing area.
    target: { x: -38, z: -53, radius: 2.7 },
    targetLayer: LAYER.marks,
    surfaces,
    areas,
    grass: {
      area: { x: fx!, z: fz!, length: fl!, width: fw!, headingDeg: fh!, color: 0x9e9a5e, layer: 0 },
      mown: { x: lx!, z: lz!, length: ll!, width: lw!, headingDeg: lh!, color: 0x7c9a48, layer: 0 },
      bare: [...paved, { x: sx, z: sz, length: sr * 2, width: sr * 2, headingDeg: 0, color: 0, layer: 0 }],
    },
    water,
    waterAreas,
    flags: [],
    buildings,
    trees,
    cars,
    people,
    windsock: { x: wx!, z: wz!, height: 6 },
    // Left-hand circuit west of the landing area with the mistral, over the open field.
    pattern: { upwind: 180, side: 150, height: 300 },
    final: { downwind: 260, height: 90 },
    // Into the wind, the same run as at Valbrise, in the club's Dornier Do 28 G92.
    jumpRun: { downwind: 500, offset: 60, height: 4000, indicatedAirspeed: 40, aircraft: 'do28' },
  };
}
