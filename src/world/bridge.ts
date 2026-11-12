// Bridges: a straight deck on piers, the road on top with a parapet along each
// edge. What the data gives (the axis, the road's height, the width, where the
// piers stand, how deep the girder is) is drawn as it is; the rest (the
// girder's width, the piers' size, the parapets) is what such bridges have.
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
/** A pier, along the deck and across it, m. */
const PIER_ALONG = 5;
const PIER_ACROSS = 7;
/** Each end rests on an abutment this long, solid down to the ground, m. */
const ABUTMENT = 8;

const DECK_COLOR = 0x9a9c9c;
const GIRDER_COLOR = 0x8c8f90;
const PARAPET_COLOR = 0xc4c6c4;
const CONCRETE = 0xb3afa6;

/** A deck in its own frame: its first end, the unit vectors along and to the right, its length. */
interface Frame {
  bridge: Bridge;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  rx: number;
  rz: number;
  length: number;
  /** Supports, m along: the ends and the piers. */
  supports: number[];
}

function frameOf(bridge: Bridge): Frame {
  const [ax, az] = bridge.a;
  const dx = bridge.b[0] - ax;
  const dz = bridge.b[1] - az;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  return { bridge, ax, az, ux, uz, rx: -uz, rz: ux, length, supports: [0, ...bridge.piers, length] };
}

/**
 * Depth of the girder under the road, `s` metres along: deepest over the
 * piers, shallowest mid-span and at the abutments, in parabolic haunches.
 */
function depthAt(f: Frame, s: number): number {
  const [deep, shallow] = f.bridge.depth;
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
  const dx = x - f.ax;
  const dz = z - f.az;
  const s = dx * f.ux + dz * f.uz;
  const u = dx * f.rx + dz * f.rz;
  return { s, u, over: s >= 0 && s <= f.length && Math.abs(u) <= f.bridge.width / 2 };
}

/**
 * What one stands on or runs into, the bridges as well as the ground: the
 * road, or a parapet's top, to anyone level with the deck or above it; under
 * it, the ground, except in a pier, solid all the way up.
 */
export function bridgeSolid(bridges: Bridge[], groundAt: (x: number, z: number) => number): SolidAt {
  const frames = bridges.map(frameOf);
  return (x, z, y = Infinity) => {
    let top = groundAt(x, z);
    for (const f of frames) {
      const { s, u, over } = onDeck(f, x, z);
      if (!over) continue;
      const half = f.bridge.width / 2;
      const a = Math.abs(u);
      const parapet = a <= half - PARAPET_INSET && a >= half - PARAPET_INSET - PARAPET_THICK;
      const surface = f.bridge.top + (parapet ? PARAPET_HEIGHT : 0);
      if (surface <= top) continue;
      const pier = a <= PIER_ACROSS / 2 && f.bridge.piers.some((p) => Math.abs(s - p) <= PIER_ALONG / 2);
      const end = s < ABUTMENT || s > f.length - ABUTMENT;
      const under = pier || end ? -Infinity : f.bridge.top - (a <= (half * GIRDER) ? depthAt(f, s) : SLAB);
      if (y >= under) top = surface;
    }
    return top;
  };
}

/** Whether a point is under or on a deck, within `margin` metres of its edges. */
export function underBridge(bridges: Bridge[], x: number, z: number, margin: number): Bridge | null {
  for (const b of bridges) {
    const f = frameOf(b);
    const { s, u } = onDeck(f, x, z);
    if (s >= -margin && s <= f.length + margin && Math.abs(u) <= b.width / 2 + margin) return b;
  }
  return null;
}

/** Whether a point is in a pier, or within `margin` metres of one. */
export function nearPier(bridges: Bridge[], x: number, z: number, margin: number): boolean {
  for (const b of bridges) {
    const f = frameOf(b);
    const { s, u } = onDeck(f, x, z);
    if (Math.abs(u) <= PIER_ACROSS / 2 + margin && b.piers.some((p) => Math.abs(s - p) <= PIER_ALONG / 2 + margin)) return true;
  }
  return false;
}

/** How high the underside of a deck is over a point, m above the plain; Infinity off the deck. */
export function undersideAt(bridges: Bridge[], x: number, z: number): number {
  let low = Infinity;
  for (const b of bridges) {
    const f = frameOf(b);
    const { s, over } = onDeck(f, x, z);
    if (over) low = Math.min(low, b.top - depthAt(f, s));
  }
  return low;
}

/** A box between two stations along a deck, between two offsets across it and two heights, in world space. */
function slab(f: Frame, s0: number, s1: number, u0: number, u1: number, y0: (s: number) => number, y1: (s: number) => number, steps: number, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const pos: number[] = [];
  const at = (s: number, u: number): [number, number] => [f.ax + f.ux * s + f.rx * u, f.az + f.uz * s + f.rz * u];
  const quad = (p: number[][]): void => {
    // Two triangles, a b c and a c d.
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...p[k]!);
  };
  for (let i = 0; i < steps; i++) {
    const sa = s0 + ((s1 - s0) * i) / steps;
    const sb = s0 + ((s1 - s0) * (i + 1)) / steps;
    const [lax, laz] = at(sa, u0);
    const [rax, raz] = at(sa, u1);
    const [lbx, lbz] = at(sb, u0);
    const [rbx, rbz] = at(sb, u1);
    const ta = y1(sa);
    const tb = y1(sb);
    const ba = y0(sa);
    const bb = y0(sb);
    // Top, bottom, left side, right side.
    quad([[lax, ta, laz], [lbx, tb, lbz], [rbx, tb, rbz], [rax, ta, raz]]);
    quad([[lax, ba, laz], [rax, ba, raz], [rbx, bb, rbz], [lbx, bb, lbz]]);
    quad([[lax, ba, laz], [lbx, bb, lbz], [lbx, tb, lbz], [lax, ta, laz]]);
    quad([[rax, ba, raz], [rax, ta, raz], [rbx, tb, rbz], [rbx, bb, rbz]]);
  }
  // The two ends.
  for (const [s, flip] of [[s0, false], [s1, true]] as const) {
    const [lx, lz] = at(s, u0);
    const [rx, rz] = at(s, u1);
    const end = [[lx, y0(s), lz], [rx, y0(s), rz], [rx, y1(s), rz], [lx, y1(s), lz]];
    quad(flip ? end.reverse() : end);
  }
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

/** The bridges, drawn: decks, girders, parapets, piers down to the ground, abutments. */
export function buildBridges(bridges: Bridge[], groundAt: (x: number, z: number) => number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const b of bridges) {
    const f = frameOf(b);
    const half = b.width / 2;
    const top = (): number => b.top;
    const steps = Math.ceil(f.length / 5);
    // The road slab, the full width; the girder under its middle.
    parts.push(slab(f, 0, f.length, -half, half, () => b.top - SLAB, top, 1, DECK_COLOR));
    const g = half * GIRDER;
    parts.push(slab(f, 0, f.length, -g, g, (s) => b.top - depthAt(f, s), () => b.top - SLAB, steps, GIRDER_COLOR));
    // Parapets on both edges.
    for (const side of [-1, 1]) {
      const inner = half - PARAPET_INSET - PARAPET_THICK;
      const outer = half - PARAPET_INSET;
      const [u0, u1] = side > 0 ? [inner, outer] : [-outer, -inner];
      parts.push(slab(f, 0, f.length, u0, u1, top, () => b.top + PARAPET_HEIGHT, 1, PARAPET_COLOR));
    }
    // Piers, from a little into the ground up to the girder.
    const lowest = (s: number, across: number, along: number): number => {
      let low = Infinity;
      for (const ds of [-along / 2, along / 2]) {
        for (const du of [-across / 2, across / 2]) {
          low = Math.min(low, groundAt(f.ax + f.ux * (s + ds) + f.rx * du, f.az + f.uz * (s + ds) + f.rz * du));
        }
      }
      return low - 2;
    };
    for (const p of b.piers) {
      const foot = lowest(p, PIER_ACROSS, PIER_ALONG);
      const head = b.top - depthAt(f, p);
      parts.push(slab(f, p - PIER_ALONG / 2, p + PIER_ALONG / 2, -PIER_ACROSS / 2, PIER_ACROSS / 2, () => foot, () => head, 1, CONCRETE));
    }
    // Abutments at the ends, down to the ground the deck comes off.
    for (const [s0, s1] of [[0, ABUTMENT], [f.length - ABUTMENT, f.length]] as const) {
      const foot = lowest((s0 + s1) / 2, b.width, ABUTMENT);
      if (foot < b.top - SLAB) parts.push(slab(f, s0, s1, -half, half, () => foot, () => b.top - SLAB, 1, CONCRETE));
    }
  }
  // Both faces: the slabs are wound whichever way their side of the axis has them.
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'bridges';
  return mesh;
}
