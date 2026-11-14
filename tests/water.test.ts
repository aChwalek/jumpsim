import * as THREE from 'three';
import { expect, test } from 'vitest';
import { facetedHeight } from '../src/world/cover';
import type { Area } from '../src/world/dz';
import { TERRAIN_SPACING, buildWater } from '../src/world/ground';

/** Every point of the water drawn: x, y, z. */
function points(object: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  object.traverse((o) => {
    const geometry = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const p = geometry?.getAttribute('position');
    if (!p) return;
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  });
  return out;
}

const river: Area = { points: [-260, -30, 260, -30, 260, 30, -260, 30], color: 0x2f5560, layer: 2, draped: true };

test('a river lies on the terrain as drawn, down a valley, with no gap', () => {
  // A valley floor going down 3 % to the east, with a fold every 100 m that the terrain draws in straight facets.
  const groundAt = (x: number, z: number): number => -0.03 * x + 2 * Math.sin(x / 37) * Math.cos(z / 53);
  const drawn = facetedHeight(groundAt, TERRAIN_SPACING);
  const water = buildWater([], new THREE.Color(), [river], undefined, { groundAt, details: [] });
  const all = points(water.object);
  expect(all.length).toBeGreaterThan(0);
  for (const p of all) expect(p.y).toBeCloseTo(drawn(p.x, p.z), 4);
  // Its whole area is covered: the triangles add up to the river's.
  let area = 0;
  for (let i = 0; i < all.length; i += 3) {
    const [a, b, c] = [all[i]!, all[i + 1]!, all[i + 2]!];
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  expect(area).toBeCloseTo(520 * 60, 0);
});

test('a finer square of terrain carries the water at its own heights', () => {
  const groundAt = (x: number, z: number): number => 3 * Math.sin(x / 9) + 2 * Math.cos(z / 7);
  const details = [{ x: 0, z: 0, size: 400, spacing: 10 }];
  const drawn = facetedHeight(groundAt, TERRAIN_SPACING, details);
  const water = buildWater([], new THREE.Color(), [{ ...river, points: [-50, -30, 50, -30, 50, 30, -50, 30] }], undefined, {
    groundAt,
    details,
  });
  const all = points(water.object);
  expect(all.length).toBeGreaterThan(0);
  for (const p of all) expect(p.y).toBeCloseTo(drawn(p.x, p.z), 4);
});

test('water the relief puts on a hillside is left to the photo', () => {
  const groundAt = (x: number): number => 0.4 * x;
  const water = buildWater([], new THREE.Color(), [river], undefined, { groundAt, details: [] });
  expect(points(water.object)).toHaveLength(0);
});

test('the sea, not draped, stays flat at the level of the plain', () => {
  const groundAt = (x: number): number => 0.04 * x;
  const sea: Area = { ...river, draped: false, layer: 1 };
  const water = buildWater([], new THREE.Color(), [sea], undefined, { groundAt, details: [] });
  const all = points(water.object);
  expect(all.length).toBeGreaterThan(0);
  for (const p of all) expect(p.y).toBe(0);
});
