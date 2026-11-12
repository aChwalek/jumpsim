// The top of a cliff about a BASE exit, as the jumper sees it from a metre or
// two before running. The relief there is known every metre, but the photos,
// taken from above, see mostly the scrub that grows to the rim and drape its
// green over the rock. So where the rock is bare is worked out from the relief
// itself: the rim, the slabs running down to it and whatever is too steep to
// hold soil are bare limestone, with tussocks of grass in its cracks and loose
// stones on it. And on the lip, the steel step built there to jump from.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded, type BaseExit, type ExitPad } from './dz';

const DEG = Math.PI / 180;
/** The most tussocks drawn: a hundred-odd triangles each. */
const MAX_TUFTS = 7000;

type GroundAt = (x: number, z: number) => number;

/** How bare the rock is over a square: 0 leaves the photo, 1 is bare limestone. */
export interface RockMask {
  /** Centre of the square's north-west cell, m, and the spacing of its cells. */
  x0: number;
  z0: number;
  spacing: number;
  /** Cells a side, rows north to south, 0..255. */
  n: number;
  values: Uint8Array;
}

/** A tussock of grass: where its foot is, how tall it stands and how wide it spreads, m. */
export interface Tuft {
  x: number;
  y: number;
  z: number;
  height: number;
  spread: number;
  /** Turned about its foot, rad; 0 green to 1 straw. */
  turn: number;
  dry: number;
}

/** A loose block of limestone, half sunk. */
export interface Stone {
  x: number;
  y: number;
  z: number;
  size: number;
  turn: number;
  tilt: number;
  tone: number;
}

export interface CliffTop {
  rock: RockMask;
  tufts: Tuft[];
  stones: Stone[];
}

/** A square of terrain known finely, centred on (x, z). */
export interface Square {
  x: number;
  z: number;
  size: number;
  spacing: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Smooth noise in 0..1 with features about `scale` metres across. */
function valueNoise(seed: number, scale: number): (x: number, z: number) => number {
  const random = seeded(seed);
  const size = 64;
  const grid = Float32Array.from({ length: size * size }, () => random());
  const at = (i: number, j: number): number => grid[(((j % size) + size) % size) * size + (((i % size) + size) % size)]!;
  return (x, z) => {
    const u = x / scale;
    const v = z / scale;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const su = fu * fu * (3 - 2 * fu);
    const sv = fv * fv * (3 - 2 * fv);
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  };
}

/** Metres along the run from its start, and to its right. */
function runFrame(base: BaseExit): (x: number, z: number) => { along: number; across: number } {
  const h = base.headingDeg * DEG;
  const ax = Math.sin(h);
  const az = -Math.cos(h);
  return (x, z) => ({ along: (x - base.x) * ax + (z - base.z) * az, across: (x - base.x) * -az + (z - base.z) * ax });
}

/**
 * Where the lip is along the run, m from its start: the last point before the
 * ground falls away by more than a metre in ten centimetres.
 */
export function lipAlong(base: BaseExit, groundAt: GroundAt): number {
  const h = base.headingDeg * DEG;
  const at = (s: number): number => groundAt(base.x + Math.sin(h) * s, base.z - Math.cos(h) * s);
  for (let s = 0; s < base.runUp * 2 + 10; s += 0.05) {
    if (at(s) - at(s + 0.1) > 1) return s;
  }
  return base.runUp;
}

/**
 * The steel step on the lip: its front edge a hand's width out over the wall,
 * level, its top flush with the rock at its back, where the run comes down
 * onto it; set into the rock, which a block of it fills in under its front.
 */
export function placePad(base: BaseExit, size: { length: number; width: number }, groundAt: GroundAt): ExitPad {
  const h = base.headingDeg * DEG;
  const ax = Math.sin(h);
  const az = -Math.cos(h);
  const front = lipAlong(base, groundAt) + 0.1;
  const middle = front - size.length / 2;
  const x = base.x + ax * middle;
  const z = base.z + az * middle;
  const back = front - size.length;
  const top = groundAt(base.x + ax * back, base.z + az * back);
  return { x, z, top: top + 0.02, length: size.length, width: size.width, headingDeg: base.headingDeg };
}

/** Whether a point is on the step, or within `margin` of it. */
export function onPad(pad: ExitPad, x: number, z: number, margin = 0): boolean {
  const h = pad.headingDeg * DEG;
  const dx = x - pad.x;
  const dz = z - pad.z;
  const along = dx * Math.sin(h) - dz * Math.cos(h);
  const across = dx * Math.cos(h) + dz * Math.sin(h);
  return Math.abs(along) <= pad.length / 2 + margin && Math.abs(across) <= pad.width / 2 + margin;
}

/**
 * The bare rock, the grass and the stones about an exit, from the relief of
 * the square round it.
 */
export function cliffTopOf(square: Square, groundAt: GroundAt, base: BaseExit, pad?: ExitPad): CliffTop {
  const s = square.spacing;
  const n = Math.round(square.size / s) + 1;
  const x0 = square.x - square.size / 2;
  const z0 = square.z - square.size / 2;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = groundAt(x0 + i * s, z0 + j * s);
  const h = (i: number, j: number): number => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]!;

  // The rim: the top of a drop of more than 12 m within two cells.
  const far = 1e9;
  const rim = new Float32Array(n * n).fill(far);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const here = h(i, j);
      let drop = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) drop = Math.max(drop, here - h(i + di, j + dj));
      if (drop > 12) rim[j * n + i] = 0;
    }
  }
  // How far each cell is from it, m: a chamfer distance, one pass each way.
  const diagonal = s * Math.SQRT2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (i > 0) rim[k] = Math.min(rim[k]!, rim[k - 1]! + s);
      if (j > 0) rim[k] = Math.min(rim[k]!, rim[k - n]! + s);
      if (i > 0 && j > 0) rim[k] = Math.min(rim[k]!, rim[k - n - 1]! + diagonal);
      if (i < n - 1 && j > 0) rim[k] = Math.min(rim[k]!, rim[k - n + 1]! + diagonal);
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      if (i < n - 1) rim[k] = Math.min(rim[k]!, rim[k + 1]! + s);
      if (j < n - 1) rim[k] = Math.min(rim[k]!, rim[k + n]! + s);
      if (i < n - 1 && j < n - 1) rim[k] = Math.min(rim[k]!, rim[k + n + 1]! + diagonal);
      if (i > 0 && j < n - 1) rim[k] = Math.min(rim[k]!, rim[k + n - 1]! + diagonal);
    }
  }

  const patches = valueNoise(7, 7);
  const specks = valueNoise(11, 1.6);
  const frame = runFrame(base);
  const slopeAt = (i: number, j: number): number =>
    Math.atan(Math.hypot(h(i + 1, j) - h(i - 1, j), h(i, j + 1) - h(i, j - 1)) / (2 * s)) / DEG;
  const values = new Uint8Array(n * n);
  const bareAt = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = x0 + i * s;
      const z = z0 + j * s;
      const slope = slopeAt(i, j);
      const wobble = patches(x, z) - 0.5 + (specks(x, z) - 0.5) * 0.7;
      // Bare along the rim, a few metres back, and in patches where it is too steep for soil...
      const nearRim = 1 - smoothstep(2, 9, rim[k]! + wobble * 14);
      const steep = smoothstep(34, 48, slope + wobble * 30);
      // ...and all along the run, worn bare.
      const { along, across } = frame(x, z);
      const run = along > -2 && along < base.runUp + 2 ? 1 - smoothstep(base.width / 2 - 0.5, base.width / 2 + 1.5, Math.abs(across) + wobble * 2) : 0;
      // Walls are left to the rock drawn on faces; the square's edge blends into the photo.
      const face = 1 - smoothstep(60, 74, slope);
      const edge = Math.min(i, j, n - 1 - i, n - 1 - j) * s;
      const bare = Math.max(nearRim, steep, run) * face * smoothstep(4, 24, edge);
      bareAt[k] = bare;
      values[k] = Math.round(bare * 255);
    }
  }
  const bare = (x: number, z: number): number => {
    const i = Math.round((x - x0) / s);
    const j = Math.round((z - z0) / s);
    return i < 0 || j < 0 || i >= n || j >= n ? 0 : bareAt[j * n + i]!;
  };
  const slope = (x: number, z: number): number => slopeAt(Math.round((x - x0) / s), Math.round((z - z0) / s));

  // --- Grass ------------------------------------------------------------------------
  // Tussocks thick on the grassy ground and along the edges of the bare rock,
  // a few in its cracks, in clumps; none on the line the jumper runs, nor on
  // the step, nor down the wall. Thinner further out, where they only add up
  // to a texture.
  const random = seeded(20261112);
  const lip = lipAlong(base, groundAt);
  const run = base.headingDeg * DEG;
  const middle = { x: base.x + Math.sin(run) * lip * 0.5, z: base.z - Math.cos(run) * lip * 0.5 };
  const lipHeight = groundAt(base.x + Math.sin(run) * lip, base.z - Math.cos(run) * lip);
  const reach = Math.min(60, square.size / 2 - 10);
  const clumps = valueNoise(23, 2.2);
  const tufts: Tuft[] = [];
  const inLane = (x: number, z: number, margin: number): boolean => {
    const { along, across } = frame(x, z);
    return (along > -1.5 && along < lip + 0.5 && Math.abs(across) < margin) || (!!pad && onPad(pad, x, z, 0.15));
  };
  for (let k = 0; k < 200000 && tufts.length < MAX_TUFTS; k++) {
    const r = reach * Math.sqrt(random());
    const a = random() * Math.PI * 2;
    const x = middle.x + Math.cos(a) * r;
    const z = middle.z + Math.sin(a) * r;
    const y = groundAt(x, z);
    const sl = slope(x, z);
    if (sl > 55 || Math.abs(y - lipHeight) > 45 || inLane(x, z, 0.8)) continue;
    const b = bare(x, z);
    const grassy = b < 0.5 ? 1 : 0.3 + 0.7 * smoothstep(0.95, 0.6, b);
    const near = r < 12 ? 1 : 12 / r;
    if (random() > grassy * smoothstep(0.25, 0.65, clumps(x, z)) * near) continue;
    const tall = 0.2 + 0.45 * random() ** 1.4;
    tufts.push({
      x,
      y: y - 0.03,
      z,
      height: tall,
      spread: tall * (0.8 + 0.6 * random()),
      turn: random() * Math.PI * 2,
      dry: Math.min(1, Math.max(0, 0.55 + 0.3 * b + (random() - 0.5) * 0.6)),
    });
  }

  // --- Stones -----------------------------------------------------------------------
  const stones: Stone[] = [];
  for (let k = 0; k < 20000 && stones.length < 600; k++) {
    const r = 40 * Math.sqrt(random());
    const a = random() * Math.PI * 2;
    const x = middle.x + Math.cos(a) * r;
    const z = middle.z + Math.sin(a) * r;
    if (bare(x, z) < 0.3 || slope(x, z) > 42 || Math.abs(groundAt(x, z) - lipHeight) > 30 || inLane(x, z, 1.2)) continue;
    // Mostly small, a few as big as a rucksack, half sunk.
    const size = 0.06 + 0.4 * random() ** 2.5;
    stones.push({ x, y: groundAt(x, z) - size * 0.35, z, size, turn: random() * Math.PI * 2, tilt: (random() - 0.5) * 0.5, tone: 0.75 + 0.3 * random() });
  }

  return { rock: { x0, z0, spacing: s, n, values }, tufts, stones };
}

// --- Drawing ------------------------------------------------------------------------

/** One tussock, a metre tall and wide: blades arching out from the foot, green at the base, straw at the tips. */
function tuftGeometry(): THREE.BufferGeometry {
  const random = seeded(5);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const base = new THREE.Color(0x4f5d2a);
  const middle = new THREE.Color(0x8f8a4c);
  const tip = new THREE.Color(0xd8c690);
  const blades = 34;
  for (let b = 0; b < blades; b++) {
    const dir = random() * Math.PI * 2;
    const ox = Math.cos(dir);
    const oz = Math.sin(dir);
    // Side to side, across the blade.
    const sx = -oz;
    const sz = ox;
    // Upright in the middle of the tussock, arching right over at its edge.
    const outer = random();
    const lean = (4 + 40 * outer) * DEG;
    const bend = (20 + 110 * outer * random()) * DEG;
    const length = 0.65 + 0.45 * random();
    const width = 0.012 + 0.008 * random();
    const foot = 0.12 * Math.sqrt(random());
    const point = (t: number): [number, number, number] => {
      // Arching over: the blade leans further from upright towards its tip.
      let x = foot;
      let y = 0;
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const u = ((k + 0.5) / steps) * t;
        const angle = lean + bend * u * u;
        x += (Math.sin(angle) * length * t) / steps;
        y += (Math.cos(angle) * length * t) / steps;
      }
      return [ox * x, y, oz * x];
    };
    const p0 = point(0);
    const p1 = point(0.45);
    const p2 = point(0.8);
    const p3 = point(1);
    const w = [width, width * 0.8, width * 0.45];
    const ring = [p0, p1, p2].map((p, k) => [
      [p[0] - sx * w[k]!, p[1], p[2] - sz * w[k]!],
      [p[0] + sx * w[k]!, p[1], p[2] + sz * w[k]!],
    ]);
    const shade = [base, middle, tip];
    // Lit as if facing up and a little out, the same from either side: no black backs.
    const nx = ox * 0.35;
    const nz = oz * 0.35;
    const push = (p: number[], c: THREE.Color): void => {
      positions.push(p[0]!, p[1]!, p[2]!);
      normals.push(nx, 0.94, nz);
      colors.push(c.r, c.g, c.b);
    };
    for (let k = 0; k < 2; k++) {
      const [a, b2] = ring[k]!;
      const [c, d] = ring[k + 1]!;
      push(a!, shade[k]!);
      push(b2!, shade[k]!);
      push(c!, shade[k + 1]!);
      push(b2!, shade[k]!);
      push(d!, shade[k + 1]!);
      push(c!, shade[k + 1]!);
    }
    const [a, b2] = ring[2]!;
    push(a!, tip);
    push(b2!, tip);
    push(p3, tip);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * A round shape knocked about, so that it reads as rock: each corner moved in
 * or out, the same for every copy of it, the faces being separate, so that no
 * crack opens. `flatTop` cuts it level at the middle.
 */
function knocked(geometry: THREE.BufferGeometry, seed: number, flatTop = false): THREE.BufferGeometry {
  const random = seeded(seed);
  const knocks = new Map<string, number>();
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    if (!knocks.has(key)) knocks.set(key, 0.8 + 0.35 * random());
    const k = knocks.get(key)!;
    const y = flatTop ? Math.min(0, position.getY(i)) : position.getY(i);
    position.setXYZ(i, position.getX(i) * k, y * k, position.getZ(i) * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A rubber mat, black, a grid of square cells with raised ribs. */
function matTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Square cells sunk between ribs, a little worn.
      const rib = x % 8 < 2 || y % 8 < 2;
      const v = (rib ? 46 : 26) + ((x * 7 + y * 13) % 5);
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = v;
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function steelBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** The step: a galvanised frame with a bar down its middle, two mats, legs down to the rock. */
function buildPad(pad: ExitPad, groundAt: GroundAt): THREE.Group {
  const group = new THREE.Group();
  const bar = 0.06;
  const L = pad.length;
  const W = pad.width;
  // In the step's own frame: -Z along the run, towards the wall; top at y = 0.
  const frame = [
    steelBox(bar, bar, L, -W / 2 + bar / 2, -bar / 2, 0),
    steelBox(bar, bar, L, W / 2 - bar / 2, -bar / 2, 0),
    steelBox(bar, bar, L, 0, -bar / 2, 0),
    steelBox(W, bar, bar, 0, -bar / 2, -L / 2 + bar / 2),
    steelBox(W, bar, bar, 0, -bar / 2, L / 2 - bar / 2),
    // A plate across the front, over the wall.
    steelBox(W, 0.14, 0.008, 0, -0.07, -L / 2 - 0.004),
  ];
  const h = pad.headingDeg * DEG;
  const ax = Math.sin(h);
  const az = -Math.cos(h);
  const world = (along: number, across: number): [number, number] => [pad.x + ax * along - az * across, pad.z + az * along + ax * across];
  // A block of rock fills in under it, down into the lip.
  let low = pad.top;
  for (const [along, across] of [
    [L / 2, -W / 2],
    [L / 2, W / 2],
    [-L / 2, -W / 2],
    [-L / 2, W / 2],
  ] as const) {
    const [x, z] = world(-along, across);
    low = Math.min(low, groundAt(x, z));
  }
  const depth = Math.min(1.2, pad.top - low + 0.3);
  const rock = knocked(new THREE.IcosahedronGeometry(1, 1), 3, true);
  const block = new THREE.Mesh(
    rock.scale(W / 2 + 0.05, depth, L / 2).translate(0, -bar, 0),
    new THREE.MeshLambertMaterial({ color: 0xa29d92, flatShading: true }),
  );
  group.add(block);
  const steel = new THREE.Mesh(mergeGeometries(frame), new THREE.MeshLambertMaterial({ color: 0xa8adb0 }));
  const mat = matTexture();
  mat.repeat.set(3, 3);
  const inner = (W - 3 * bar) / 2;
  const mats = new THREE.Mesh(
    mergeGeometries([
      steelBox(inner, 0.025, L - 2 * bar, -(inner + bar) / 2, -0.0175, 0),
      steelBox(inner, 0.025, L - 2 * bar, (inner + bar) / 2, -0.0175, 0),
    ]),
    new THREE.MeshLambertMaterial({ map: mat }),
  );
  group.add(steel, mats);
  group.position.set(pad.x, pad.top, pad.z);
  group.rotation.y = -h;
  return group;
}

export interface CliffTopView {
  object: THREE.Group;
  /** The grass in the breeze, `seconds` the time. */
  update(seconds: number): void;
}

export function buildCliffTop(top: CliffTop, groundAt: GroundAt, pad?: ExitPad): CliffTopView {
  const group = new THREE.Group();
  const time = { value: 0 };

  const grass = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  grass.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float time;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // The tips sway in the breeze, each tussock in its own time.
      vec2 spot = instanceMatrix[3].xz;
      float sway = position.y * position.y;
      transformed.x += sway * 0.07 * sin(time * 1.9 + spot.x * 0.7 + spot.y * 0.3);
      transformed.z += sway * 0.05 * sin(time * 2.6 + spot.y * 0.9 - spot.x * 0.2);`,
    );
  };
  grass.customProgramCacheKey = () => 'cliff-grass';
  const tufts = new THREE.InstancedMesh(tuftGeometry(), grass, top.tufts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const green = new THREE.Color(0x9fae78);
  const straw = new THREE.Color(0xf2e6c6);
  top.tufts.forEach((t, i) => {
    q.setFromAxisAngle(up, t.turn);
    m.compose(p.set(t.x, t.y, t.z), q, scale.set(t.spread, t.height, t.spread));
    tufts.setMatrixAt(i, m);
    tufts.setColorAt(i, color.lerpColors(green, straw, t.dry));
  });
  tufts.frustumCulled = false;

  const stones = new THREE.InstancedMesh(
    knocked(new THREE.IcosahedronGeometry(1, 1), 9).scale(1, 0.55, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x9e998e, flatShading: true }),
    top.stones.length,
  );
  const e = new THREE.Euler();
  top.stones.forEach((s, i) => {
    q.setFromEuler(e.set(s.tilt, s.turn, s.tilt * 0.5));
    m.compose(p.set(s.x, s.y, s.z), q, scale.setScalar(s.size));
    stones.setMatrixAt(i, m);
    stones.setColorAt(i, color.setScalar(s.tone));
  });
  stones.frustumCulled = false;

  group.add(tufts, stones);
  if (pad) group.add(buildPad(pad, groundAt));
  return {
    object: group,
    update(seconds) {
      time.value = seconds % 1000;
    },
  };
}

/** The bare rock as a texture the ground's shader reads, and the square it covers: west, north, side, m. */
export function rockTexture(rock: RockMask): { texture: THREE.DataTexture; box: THREE.Vector3 } {
  const texture = new THREE.DataTexture(rock.values, rock.n, rock.n, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  // Rows of one byte a cell, not padded to four.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const box = new THREE.Vector3(rock.x0 - rock.spacing / 2, rock.z0 - rock.spacing / 2, rock.n * rock.spacing);
  return { texture, box };
}
