// Bridges: a deck on piers, the road on top with a parapet along each edge.
// What the data gives (the axis, straight or curved, the road's height and
// grade, the width, where the piers stand, how deep the girder is, the piers'
// and pylons' shape) is drawn as it is; the rest (the parapets, the legs'
// and the stays' thickness) is what such bridges have.
//
// A deck is not like a tower's roof: there is air under it. It is solid to
// whoever is level with it or above it, not to a canopy flying under it, and
// a pilot who lands under it walks about on the ground.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Bridge, SolidAt } from './dz';

/** The parapets: how tall, how thick, and how far in from the edge of the deck, m. */
export const PARAPET_HEIGHT = 1.1;
const PARAPET_THICK = 0.3;
/** Outside the parapet, the lip of the deck: where a BASE jumper stands. */
export const PARAPET_INSET = 0.5;
/** The deck's edge beyond the girder: the slab, m thick. */
const SLAB = 0.45;
/** The girder's width, a share of the deck's. */
const GIRDER = 0.55;
/** A plain pier, along the deck and across it, m. */
const PIER_ALONG = 5;
const PIER_ACROSS = 7;
/** Each end rests on an abutment this long, solid down to the ground, m. */
const ABUTMENT = 8;
/** A pylon's legs and its mast: thickness along the deck, width across it, m. */
const LEG_ALONG = 3;
const LEG_ACROSS = 3.6;
const MAST_ALONG = 4;
/** Where a pylon's legs meet, and the span of its mast the stays are anchored on: shares of its height. */
const JOIN = 0.45;
const ANCHORS: [number, number] = [0.6, 0.96];
/** A stay's thickness, m. */
const STAY = 0.3;
/** Parapets taller than this are wind screens, drawn see-through. */
const SCREEN = 2;

const DECK_COLOR = 0x9a9c9c;
const GIRDER_COLOR = 0x8c8f90;
const PARAPET_COLOR = 0xc4c6c4;
const CONCRETE = 0xb3afa6;
const STAY_COLOR = 0xe4e2d8;
const SCREEN_COLOR = 0xdce4e6;

/** A deck in its own frame: metres along its axis from `a`, and to the right of it. */
export interface Frame {
  bridge: Bridge;
  length: number;
  /** Supports, m along: the ends and the piers. */
  supports: number[];
  /** Metres along the axis and to its right of a point. */
  local(x: number, z: number): { s: number; u: number };
  /** The point `s` along the axis and `u` to its right, x and z. */
  world(s: number, u: number): [number, number];
  /** The road's height `s` along, m above the plain. */
  road(s: number): number;
  /** Whether the axis bends: then the deck is drawn in short straight pieces. */
  curved: boolean;
}

export function frameOf(bridge: Bridge): Frame {
  const [ax, az] = bridge.a;
  const dx = bridge.b[0] - ax;
  const dz = bridge.b[1] - az;
  const chord = Math.hypot(dx, dz);
  const grade = bridge.grade ?? 0;
  const road = (s: number): number => bridge.top + grade * s;
  const supports = (length: number): number[] => [0, ...bridge.piers, length];
  const R = Math.abs(bridge.radius ?? 0);
  if (!R || R < chord / 2) {
    const ux = dx / chord;
    const uz = dz / chord;
    return {
      bridge,
      length: chord,
      supports: supports(chord),
      local: (x, z) => ({ s: (x - ax) * ux + (z - az) * uz, u: -(x - ax) * uz + (z - az) * ux }),
      world: (s, u) => [ax + ux * s - uz * u, az + uz * s + ux * u],
      road,
      curved: false,
    };
  }
  // An arc from a to b: its centre on the right of the chord if it bends right.
  const right = (bridge.radius ?? 0) > 0 ? 1 : -1;
  const off = Math.sqrt(R * R - (chord / 2) ** 2) * right;
  const cx = (ax + bridge.b[0]) / 2 - (dz / chord) * off;
  const cz = (az + bridge.b[1]) / 2 + (dx / chord) * off;
  const angleA = Math.atan2(az - cz, ax - cx);
  const wrap = (t: number): number => Math.atan2(Math.sin(t), Math.cos(t));
  const sweep = wrap(Math.atan2(bridge.b[1] - cz, bridge.b[0] - cx) - angleA);
  const turn = Math.sign(sweep);
  const length = R * Math.abs(sweep);
  return {
    bridge,
    length,
    supports: supports(length),
    local: (x, z) => {
      const rho = Math.hypot(x - cx, z - cz);
      // On the inside of the bend, the right is towards the centre.
      return { s: R * wrap(Math.atan2(z - cz, x - cx) - angleA) * turn, u: (R - rho) * right };
    },
    world: (s, u) => {
      const t = angleA + (turn * s) / R;
      const rho = R - u * right;
      return [cx + rho * Math.cos(t), cz + rho * Math.sin(t)];
    },
    road,
    curved: true,
  };
}

/**
 * Depth of the girder under the road, `s` metres along: deepest over the
 * piers, shallowest mid-span and at the abutments, in parabolic haunches.
 */
function depthAt(f: Frame, s: number): number {
  const [deep, shallow] = f.bridge.depth;
  if (deep === shallow) return deep;
  const k = f.supports;
  let i = 0;
  while (i < k.length - 2 && s > k[i + 1]!) i++;
  const a = k[i]!;
  const b = k[i + 1]!;
  let t: number;
  // 0 at a pier, 1 at the middle of a span or at an abutment.
  if (i === 0) t = (b - s) / (b - a);
  else if (i === k.length - 2) t = (s - a) / (b - a);
  else t = 1 - Math.abs((2 * (s - a)) / (b - a) - 1);
  t = Math.min(1, Math.max(0, t));
  return deep + (shallow - deep) * (1 - (1 - t) * (1 - t));
}

/** Where a point lies on a deck: metres along it and to its right, and whether it is over the deck. */
function onDeck(f: Frame, x: number, z: number): { s: number; u: number; over: boolean } {
  const { s, u } = f.local(x, z);
  return { s, u, over: s >= 0 && s <= f.length && Math.abs(u) <= f.bridge.width / 2 };
}

const parapetOf = (b: Bridge): number => b.parapet ?? PARAPET_HEIGHT;

/**
 * A pier's size `d` metres under the road: along the deck and across it, and
 * the gap between its two legs if it is split there (0 if not).
 */
function pierSize(f: Frame, d: number, under: number): { along: number; across: number; gap: number } {
  const shape = f.bridge.pierShape;
  if (!shape) return { along: PIER_ALONG, across: PIER_ACROSS, gap: 0 };
  const t = Math.min(1, (d / shape.foot.depth) ** 2);
  const along = shape.head[0] + (shape.foot.along - shape.head[0]) * t;
  const across = shape.head[1] + (shape.foot.across - shape.head[1]) * t;
  const split = shape.split && d - under <= shape.split.height;
  return { along, across, gap: split ? shape.split!.gap : 0 };
}

/** Whether a point `ds` along the deck from a pier's axis and `du` across is in it, `d` metres under the road. */
function inPier(f: Frame, ds: number, du: number, d: number, under: number, margin = 0): boolean {
  const { along, across, gap } = pierSize(f, d, under);
  if (Math.abs(du) > across / 2 + margin) return false;
  const a = Math.abs(ds);
  return a <= along / 2 + margin && a >= gap / 2 - margin;
}

/** Whether a point `ds` along the deck from a pier and `du` across is in its pylon, `h` metres over the road. */
function inPylon(f: Frame, ds: number, du: number, h: number): boolean {
  const pylon = f.bridge.pylons;
  if (!pylon || h < 0 || h > pylon.height || Math.abs(du) > LEG_ACROSS / 2) return false;
  const a = Math.abs(ds);
  const join = pylon.height * JOIN;
  if (h >= join) return a <= MAST_ALONG / 2;
  // On a leg: its axis comes in from the foot to the mast as it rises.
  const centre = (pylon.foot / 2 - LEG_ALONG / 2) * (1 - h / join);
  return Math.abs(a - centre) <= LEG_ALONG / 2;
}

/**
 * What one stands on or runs into, the bridges as well as the ground: the
 * road, or a parapet's top, to anyone level with the deck or above it; under
 * it, the ground, except in a pier, solid all the way up; over it, a pylon.
 */
export function bridgeSolid(bridges: Bridge[], groundAt: (x: number, z: number) => number): SolidAt {
  const frames = bridges.map(frameOf);
  return (x, z, y = Infinity) => {
    let top = groundAt(x, z);
    for (const f of frames) {
      const { s, u, over } = onDeck(f, x, z);
      if (!over) continue;
      const road = f.road(s);
      // A pylon, to whoever runs into it: its top. Its mast's top if no height is given.
      const pylon = f.bridge.pylons;
      const on = pylon && f.bridge.piers.find((p) => Math.abs(s - p) <= pylon.foot / 2 && inPylon(f, s - p, u, Math.min(y - f.road(p), pylon.height)));
      if (pylon && on !== undefined && f.road(on) + pylon.height > top) {
        top = f.road(on) + pylon.height;
        continue;
      }
      const half = f.bridge.width / 2;
      const a = Math.abs(u);
      const parapet = a <= half - PARAPET_INSET && a >= half - PARAPET_INSET - PARAPET_THICK;
      const surface = road + (parapet ? parapetOf(f.bridge) : 0);
      if (surface <= top) continue;
      const depth = depthAt(f, s);
      // Under the deck, a pier is solid from the ground up; with no height given, its head.
      const d = Math.max(depth, road - y);
      const pier = f.bridge.piers.some((p) => inPier(f, s - p, u, d, depth));
      const end = s < ABUTMENT || s > f.length - ABUTMENT;
      const under = pier || end ? -Infinity : road - (a <= half * (f.bridge.girder ?? GIRDER) ? depth : SLAB);
      if (y >= under) top = surface;
    }
    return top;
  };
}

/** Whether a point is under or on a deck, within `margin` metres of its edges. */
export function underBridge(bridges: Bridge[], x: number, z: number, margin: number): Bridge | null {
  for (const b of bridges) {
    const f = frameOf(b);
    const { s, u } = f.local(x, z);
    if (s >= -margin && s <= f.length + margin && Math.abs(u) <= b.width / 2 + margin) return b;
  }
  return null;
}

/** Whether a point is in a pier at its foot, its widest, or within `margin` metres of one. */
export function nearPier(bridges: Bridge[], x: number, z: number, margin: number): boolean {
  for (const b of bridges) {
    const f = frameOf(b);
    const { s, u } = f.local(x, z);
    if (b.piers.some((p) => inPier(f, s - p, u, Infinity, Infinity, margin))) return true;
  }
  return false;
}

/** How high the underside of a deck is over a point, m above the plain; Infinity off the deck. */
export function undersideAt(bridges: Bridge[], x: number, z: number): number {
  let low = Infinity;
  for (const b of bridges) {
    const f = frameOf(b);
    const { s, over } = onDeck(f, x, z);
    if (over) low = Math.min(low, f.road(s) - depthAt(f, s));
  }
  return low;
}

type Point = [number, number, number];

/** Flat-shaded triangles of one colour, as a geometry. */
function coloured(pos: number[], hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const colors = new Float32Array(pos.length);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Two triangles, a b c and a c d. */
function quad(pos: number[], p: Point[]): void {
  for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...p[k]!);
}

/** A solid through rings of four corners each, in the same turn: their sides, and the two ends. */
function prism(rings: Point[][], hex: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let k = 0; k < 4; k++) quad(pos, [a[k]!, a[(k + 1) % 4]!, b[(k + 1) % 4]!, b[k]!]);
  }
  quad(pos, rings[0]!);
  quad(pos, [...rings[rings.length - 1]!].reverse());
  return coloured(pos, hex);
}

/** A box between two stations along a deck, between two offsets across it and two heights, in world space. */
function slab(f: Frame, s0: number, s1: number, u0: number, u1: number, y0: (s: number) => number, y1: (s: number) => number, steps: number, hex: number): THREE.BufferGeometry {
  const ring = (s: number): Point[] => {
    const [lx, lz] = f.world(s, u0);
    const [rx, rz] = f.world(s, u1);
    return [[lx, y0(s), lz], [rx, y0(s), rz], [rx, y1(s), rz], [lx, y1(s), lz]];
  };
  const rings: Point[][] = [];
  for (let i = 0; i <= steps; i++) rings.push(ring(s0 + ((s1 - s0) * i) / steps));
  return prism(rings, hex);
}

/** A straight beam from one point to another, `w` wide along `side` (horizontal) and `t` thick the other way. */
function beam(p: Point, q: Point, side: [number, number], w: number, t: number, hex: number): THREE.BufferGeometry {
  const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
  const sv = new THREE.Vector3(side[0], 0, side[1]).normalize();
  const n = new THREE.Vector3().crossVectors(d, sv).normalize();
  const ring = (c: Point): Point[] =>
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [
      c[0] + (sv.x * w * i! + n.x * t * j!) / 2,
      c[1] + (sv.y * w * i! + n.y * t * j!) / 2,
      c[2] + (sv.z * w * i! + n.z * t * j!) / 2,
    ]);
  return prism([ring(p), ring(q)], hex);
}

/** A pier from a little into the ground up to the girder: a plain box, or tapered and split into two legs at the top. */
function pierParts(f: Frame, p: number, foot: number, parts: THREE.BufferGeometry[]): void {
  const head = f.road(p) - depthAt(f, p);
  const depth = depthAt(f, p);
  const shape = f.bridge.pierShape;
  if (!shape) {
    parts.push(slab(f, p - PIER_ALONG / 2, p + PIER_ALONG / 2, -PIER_ACROSS / 2, PIER_ACROSS / 2, () => foot, () => head, 1, CONCRETE));
    return;
  }
  // Rings every 10 m or so up the pier, `ds` along from its axis to `ds + along` (a leg), or the whole.
  const ring = (y: number, leg: -1 | 0 | 1): Point[] => {
    const { along, across, gap } = pierSize(f, f.road(p) - y, depth);
    const [s0, s1] = leg === 0 ? [-along / 2, along / 2] : leg > 0 ? [gap / 2, along / 2] : [-along / 2, -gap / 2];
    return ([[s0, -across / 2], [s1, -across / 2], [s1, across / 2], [s0, across / 2]] as const).map(([s, u]) => {
      const [x, z] = f.world(p + s, u);
      return [x, y, z] as Point;
    });
  };
  const column = (y0: number, y1: number, leg: -1 | 0 | 1): void => {
    if (y1 <= y0) return;
    const n = Math.max(1, Math.ceil((y1 - y0) / 10));
    const rings: Point[][] = [];
    for (let i = 0; i <= n; i++) rings.push(ring(y0 + ((y1 - y0) * i) / n, leg));
    parts.push(prism(rings, CONCRETE));
  };
  const split = shape.split ? Math.max(foot, head - shape.split.height) : head;
  column(foot, split, 0);
  column(split, head, -1);
  column(split, head, 1);
}

/** A pylon over a pier, an inverted Y on the deck's axis, and its stays fanned out to the deck both ways. */
function pylonParts(f: Frame, p: number, parts: THREE.BufferGeometry[], lines: number[]): void {
  const pylon = f.bridge.pylons!;
  const road = f.road(p);
  const at = (s: number, h: number): Point => {
    const [x, z] = f.world(s, 0);
    return [x, f.road(s) + h, z];
  };
  // Across the deck at the pier, for the beams' width.
  const [x0, z0] = f.world(p, 0);
  const [x1, z1] = f.world(p, 1);
  const across: [number, number] = [x1 - x0, z1 - z0];
  const join = pylon.height * JOIN;
  const spread = pylon.foot / 2 - LEG_ALONG / 2;
  for (const side of [-1, 1]) {
    const footAt = at(p + side * spread, 0);
    footAt[1] = road;
    const top = at(p, join);
    top[1] = road + join;
    parts.push(beam(footAt, top, across, LEG_ACROSS, LEG_ALONG, STAY_COLOR));
  }
  const mastFoot: Point = [x0, road + join - 2, z0];
  const mastTop: Point = [x0, road + pylon.height, z0];
  parts.push(beam(mastFoot, mastTop, across, LEG_ACROSS, MAST_ALONG, STAY_COLOR));
  // The stays: the innermost from lowest on the mast, in one plane over the middle of the road.
  const [near, far] = pylon.reach;
  for (const side of [-1, 1]) {
    for (let k = 0; k < pylon.stays; k++) {
      const t = pylon.stays > 1 ? k / (pylon.stays - 1) : 0;
      const s = p + side * (near + (far - near) * t);
      if (s < 0 || s > f.length) continue;
      const deck = at(s, 0.6);
      const h = pylon.height * (ANCHORS[0] + (ANCHORS[1] - ANCHORS[0]) * t);
      const [mx, mz] = f.world(p + side * (MAST_ALONG / 2 - 0.4), 0);
      const mast: Point = [mx, road + h, mz];
      parts.push(beam(mast, deck, across, STAY, STAY, STAY_COLOR));
      // And as a line, for when it is too thin to show.
      lines.push(...mast, ...deck);
    }
  }
}

/** The bridges, drawn: decks, girders, parapets or wind screens, piers down to the ground, pylons and stays, abutments. */
export function buildBridges(bridges: Bridge[], groundAt: (x: number, z: number) => number): THREE.Object3D {
  const parts: THREE.BufferGeometry[] = [];
  const screens: THREE.BufferGeometry[] = [];
  const lines: number[] = [];
  for (const b of bridges) {
    const f = frameOf(b);
    const half = b.width / 2;
    const road = (s: number): number => f.road(s);
    const paint = b.paint ?? GIRDER_COLOR;
    // Straight pieces of 20 m along a bend, and as many as a sloping road needs.
    const long = f.curved ? Math.ceil(f.length / 20) : 1;
    const steps = Math.max(long, Math.ceil(f.length / 5));
    // The road slab, the full width; the girder under its middle.
    parts.push(slab(f, 0, f.length, -half, half, (s) => road(s) - SLAB, road, long, DECK_COLOR));
    const g = half * (b.girder ?? GIRDER);
    parts.push(slab(f, 0, f.length, -g, g, (s) => road(s) - depthAt(f, s), (s) => road(s) - SLAB, steps, paint));
    // Parapets, or wind screens, on both edges.
    const parapet = parapetOf(b);
    for (const side of [-1, 1]) {
      const inner = half - PARAPET_INSET - PARAPET_THICK;
      const outer = half - PARAPET_INSET;
      const [u0, u1] = side > 0 ? [inner, outer] : [-outer, -inner];
      const wall = slab(f, 0, f.length, u0, u1, road, (s) => road(s) + parapet, long, parapet > SCREEN ? SCREEN_COLOR : PARAPET_COLOR);
      (parapet > SCREEN ? screens : parts).push(wall);
    }
    // Piers, from a little into the ground up to the girder.
    const lowest = (s: number, across: number, along: number): number => {
      let low = Infinity;
      for (const ds of [-along / 2, 0, along / 2]) {
        for (const du of [-across / 2, 0, across / 2]) low = Math.min(low, groundAt(...f.world(s + ds, du)));
      }
      return low - 2;
    };
    for (const p of b.piers) {
      const { along, across } = pierSize(f, Infinity, Infinity);
      pierParts(f, p, lowest(p, across, along), parts);
      if (b.pylons) pylonParts(f, p, parts, lines);
    }
    // Abutments at the ends, down to the ground the deck comes off.
    for (const [s0, s1] of [[0, ABUTMENT], [f.length - ABUTMENT, f.length]] as const) {
      const foot = lowest((s0 + s1) / 2, b.width, ABUTMENT);
      if (foot < road((s0 + s1) / 2) - SLAB) parts.push(slab(f, s0, s1, -half, half, () => foot, (s) => road(s) - SLAB, 1, CONCRETE));
    }
  }
  const group = new THREE.Group();
  group.name = 'bridges';
  // Both faces: the slabs are wound whichever way their side of the axis has them.
  group.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  if (screens.length) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false });
    group.add(new THREE.Mesh(mergeGeometries(screens), material));
  }
  if (lines.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: STAY_COLOR })));
  }
  return group;
}
