// What the painted ground (?style=painted) draws sharp, the photo it is
// picked from being averaged over metres: the roads from OpenStreetMap
// (tools/dz/roads.py) as ribbons laid on the relief; the runways of the
// charts, asphalt with their markings or mown grass with white markers; the
// taxiways and aprons; the landing area mown in stripes, as Valbrise has it.

import * as THREE from 'three';
import { inArea, type Area, type DzPack, type Rect } from './dz';
import { buildDraped, type DrawnRelief } from './ground';

const DEG = Math.PI / 180;

/** Valbrise's colours. */
const ASPHALT = 0x3a3c40;
const TARMAC = 0x46484c;
const ROAD = 0x4c4e52;
const GRAVEL = 0x9c8f6e;
const PAINT = 0xe8e8e8;
const MOWN = 0x6f8f3a;
const MOWN_STRIPE = 0x7d9a45;
const STRIP = 0x7d9a45;
const STRIP_STRIPE = 0x86a04e;

/** Draw order, over the water (1, 2) and under the target (6). */
const UNDER = 3;
const RUNWAY = 4;
const MARKS = 5;

/** A rectangle as a polygon. */
function rectArea(r: Rect): Area {
  const h = r.headingDeg * DEG;
  const ax = (Math.sin(h) * r.length) / 2;
  const az = (-Math.cos(h) * r.length) / 2;
  const cx = (Math.cos(h) * r.width) / 2;
  const cz = (Math.sin(h) * r.width) / 2;
  return {
    points: [r.x - ax - cx, r.z - az - cz, r.x + ax - cx, r.z + az - cz, r.x + ax + cx, r.z + az + cz, r.x - ax + cx, r.z - az + cz],
    color: r.color,
    layer: r.layer,
  };
}

/**
 * A runway's markings, after ICAO Annex 14: threshold stripes 30 m long, as
 * many as its width calls for; the centre line in dashes 30 m long, 20 m
 * apart; side stripes; aiming points 300 m in on a long, wide one. A grass
 * runway is a strip mown lighter, white markers along its edges.
 */
function runwayAreas(r: { a: [number, number]; b: [number, number]; width: number; surface: string }): Area[] {
  const [ax, az] = r.a;
  const [bx, bz] = r.b;
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  const headingDeg = Math.atan2(ux, -uz) / DEG;
  const w = r.width;
  /** A rectangle s metres along from `a`, t to the right, `along` long and `across` wide. */
  const at = (s: number, t: number, along: number, across: number, color: number, layer: number): Area =>
    rectArea({ x: ax + ux * s - uz * t, z: az + uz * s + ux * t, length: along, width: across, headingDeg, color, layer });
  const out: Area[] = [];
  if (r.surface === 'grass') {
    out.push(at(length / 2, 0, length, w, STRIP, UNDER));
    for (let t = -w / 2 + 6; t < w / 2; t += 12) out.push(at(length / 2, t, length, 6, STRIP_STRIPE, UNDER));
    for (let s = 0; s <= length; s += 60) {
      for (const side of [-1, 1]) out.push(at(Math.min(length - 1.5, Math.max(1.5, s)), side * (w / 2 - 0.5), 3, 1, PAINT, MARKS));
    }
    return out;
  }
  out.push(at(length / 2, 0, length, w, ASPHALT, RUNWAY));
  const line = w >= 30 ? 0.9 : 0.45;
  for (const side of [-1, 1]) out.push(at(length / 2, side * (w / 2 - line / 2 - 0.3), length, line, PAINT, MARKS));
  const stripes = w < 20 ? 4 : w < 26 ? 6 : w < 36 ? 8 : w < 52 ? 12 : 16;
  for (const end of [0, 1]) {
    const from = (d: number): number => (end === 0 ? d : length - d);
    for (let k = 0; k < stripes / 2; k++) {
      for (const side of [-1, 1]) out.push(at(from(21), side * (2.7 + k * 3.6), 30, 1.8, PAINT, MARKS));
    }
    if (length >= 1200 && w >= 30) {
      for (const side of [-1, 1]) out.push(at(from(322.5), side * 12, 45, 6, PAINT, MARKS));
    }
  }
  for (let s = 60; s + 30 <= length - 60; s += 50) out.push(at(s + 15, 0, 30, line, PAINT, MARKS));
  return out;
}

/** Roads as read from roads.json: width, paved, then x, z in turn. */
interface Roads {
  ways: number[][];
  areas: number[][];
}

/** A polyline as quads, one a segment, and an octagon at each bend to fill the corner. */
function ribbon(points: number[], width: number, color: number): Area[] {
  const out: Area[] = [];
  const half = width / 2;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const [x0, z0, x1, z1] = [points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!];
    const length = Math.hypot(x1 - x0, z1 - z0);
    if (length < 0.05) continue;
    const nx = (-(z1 - z0) / length) * half;
    const nz = ((x1 - x0) / length) * half;
    out.push({ points: [x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz], color, layer: UNDER });
  }
  for (let i = 2; i + 2 < points.length; i += 2) {
    const ring: number[] = [];
    for (let k = 0; k < 8; k++) ring.push(points[i]! + Math.cos((k * Math.PI) / 4) * half, points[i + 1]! + Math.sin((k * Math.PI) / 4) * half);
    out.push({ points: ring, color, layer: UNDER });
  }
  return out;
}

/** Whether a point lies on a road, for the grass: the segments sorted into squares. */
class RoadMask {
  private cells = new Map<number, number[]>();
  private segments: number[] = [];
  private areas: Area[] = [];
  private static readonly CELL = 32;
  private key = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);

  add(roads: Roads): void {
    const C = RoadMask.CELL;
    for (const way of roads.ways) {
      const half = way[0]! / 2;
      for (let i = 2; i + 3 < way.length; i += 2) {
        const s = this.segments.length;
        const [x0, z0, x1, z1] = [way[i]!, way[i + 1]!, way[i + 2]!, way[i + 3]!];
        this.segments.push(x0, z0, x1, z1, half);
        for (let j = Math.floor((Math.min(z0, z1) - half) / C); j <= Math.floor((Math.max(z0, z1) + half) / C); j++) {
          for (let k = Math.floor((Math.min(x0, x1) - half) / C); k <= Math.floor((Math.max(x0, x1) + half) / C); k++) {
            const list = this.cells.get(this.key(k, j));
            if (list) list.push(s);
            else this.cells.set(this.key(k, j), [s]);
          }
        }
      }
    }
    for (const a of roads.areas) this.areas.push({ points: a.slice(1), color: 0, layer: 0 });
  }

  has(x: number, z: number): boolean {
    const C = RoadMask.CELL;
    for (const s of this.cells.get(this.key(Math.floor(x / C), Math.floor(z / C))) ?? []) {
      const [x0, z0, x1, z1, half] = this.segments.slice(s, s + 5) as [number, number, number, number, number];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < half) return true;
    }
    return this.areas.some((a) => inArea(a, x, z));
  }
}

export interface Painted {
  object: THREE.Group;
  /** Whether a point lies on a road: no grass grows there. */
  onRoad(x: number, z: number): boolean;
  dispose(): void;
}

/** Where a drop zone's roads.json lies: beside its photos. */
const roadsUrl = (dz: DzPack): string | undefined => dz.imagery?.[0]?.url.replace(/[^/]*$/, 'roads.json');

/** The painted ground's own surfaces, the roads coming in once fetched. */
export function buildPainted(dz: DzPack, relief: DrawnRelief): Painted {
  const object = new THREE.Group();
  const areas: Area[] = [];
  const mown = dz.grass.mown;
  areas.push(rectArea({ ...mown, color: MOWN, layer: UNDER }));
  for (let t = -mown.width / 2 + 5; t < mown.width / 2; t += 20) {
    const h = mown.headingDeg * DEG;
    areas.push(rectArea({ ...mown, x: mown.x + Math.cos(h) * t, z: mown.z + Math.sin(h) * t, width: 10, color: MOWN_STRIPE, layer: UNDER }));
  }
  for (const r of dz.airfield?.runways ?? []) areas.push(...runwayAreas(r));
  for (const p of dz.airfield?.paved ?? []) areas.push({ points: p, color: TARMAC, layer: UNDER });
  object.add(buildDraped(areas, relief));
  const mask = new RoadMask();
  let gone = false;
  const url = roadsUrl(dz);
  if (url) {
    fetch(`${import.meta.env.BASE_URL}${url}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((roads: Roads | null) => {
        if (gone || !roads?.ways) return;
        const started = performance.now();
        const list: Area[] = [];
        // Parks first, the roads over them.
        for (const a of roads.areas) list.push({ points: a.slice(1), color: a[0] ? TARMAC : GRAVEL, layer: UNDER });
        for (const way of roads.ways) list.push(...ribbon(way.slice(2), way[0]!, way[1] ? ROAD : GRAVEL));
        object.add(buildDraped(list, relief));
        mask.add(roads);
        console.info(`painted roads: ${roads.ways.length} ways, ${list.length} pieces, ${Math.round(performance.now() - started)} ms`);
      })
      // Not every drop zone has its roads yet; a page served instead of the file is no JSON either.
      .catch(() => {});
  }
  return {
    object,
    onRoad: (x, z) => mask.has(x, z),
    dispose() {
      gone = true;
    },
  };
}
