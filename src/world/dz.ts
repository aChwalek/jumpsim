// A drop zone as data: everything the world builder needs to draw it and the
// sim needs to fly over it. World axes: +X east, -Z north, +Y up, metres,
// origin at the landing target. Real drop zones will be more packs like this.

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
}

export interface Tree {
  x: number;
  z: number;
  height: number;
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

export interface DzPack {
  name: string;
  /** Wind the place usually gets: where it comes from, and speed in m/s. */
  wind: { fromDeg: number; speed: number };
  groundAt(x: number, z: number): number;
  target: { x: number; z: number; radius: number };
  surfaces: Rect[];
  /** Grass drawn blade by blade: all over `area` except on `bare`, cut short on `mown`. */
  grass: { area: Rect; mown: Rect; bare: Rect[] };
  /** Ponds, level with the ground. */
  water: Rect[];
  flags: Flag[];
  buildings: Building[];
  trees: Tree[];
  cars: Placed[];
  people: Placed[];
  windsock: { x: number; z: number; height: number };
  spawns: { pattern: Spawn; final: Spawn };
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

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  // Patchwork of fields all around, leaving the airfield clear.
  const cell = 320;
  for (let i = -14; i <= 14; i++) {
    for (let j = -14; j <= 14; j++) {
      const x = i * cell + (random() - 0.5) * 40;
      const z = j * cell + (random() - 0.5) * 40;
      const onAirfield = x > -520 && x < 760 && z > -420 && z < 380;
      if (onAirfield || random() < 0.06) continue;
      surfaces.push({
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

  return {
    name: 'Valbrise',
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
    spawns: {
      pattern: { x: -180, z: 160, height: 300, headingDeg: 90 },
      final: { x: 260, z: 0, height: 90, headingDeg: 270 },
    },
  };
}
