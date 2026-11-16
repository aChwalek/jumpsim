import * as THREE from 'three';
import { expect, test } from 'vitest';
import { castShadow, layShadow, onShadowPlane, shadowFall, shadowGrazing, type GroundAt } from '../src/render/groundShadow';

/** Towards a sun `elevation` degrees up, from compass `fromDeg` (+X east, +Z south). */
function sunFrom(fromDeg: number, elevation: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(fromDeg);
  const e = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

const flat: GroundAt = () => 200;
/** A face falling to the west at `deg` degrees, at 1000 m where x = 0. */
const face =
  (deg: number): GroundAt =>
  (x) =>
    1000 + x * Math.tan(THREE.MathUtils.degToRad(deg));

test('on flat ground the shadow falls where the old flat cast put it', () => {
  const sun = sunFrom(110, 41);
  const from = new THREE.Vector3(10, 260, -30);
  const fall = shadowFall();
  expect(castShadow(from, sun, flat, fall)).toBe(true);
  const t = 60 / sun.y;
  expect(fall.point.x).toBeCloseTo(10 - sun.x * t, 1);
  expect(fall.point.z).toBeCloseTo(-30 - sun.z * t, 1);
  expect(fall.point.y).toBe(200);
  expect(fall.normal.y).toBeCloseTo(1, 6);
  expect(fall.drop).toBeCloseTo(60, 6);
});

test('over a face falling away from the sun the shadow lies far down it, on it, not in the air', () => {
  // Sun from the east, 41° up, behind a pilot 20 m over a 37° face falling west: the case of the Deux Aigles at 10h.
  const sun = sunFrom(90, 41);
  const ground = face(37);
  const from = new THREE.Vector3(0, ground(0, 0) + 20, 0);
  const fall = shadowFall();
  expect(castShadow(from, sun, ground, fall)).toBe(true);
  expect(Math.abs(fall.point.y - ground(fall.point.x, fall.point.z))).toBeLessThan(0.01);
  // On the ray from the pilot.
  const back = from.clone().sub(fall.point).normalize();
  expect(back.dot(sun)).toBeCloseTo(1, 4);
  // 20 m of air over a slope 4° gentler than the light: about 160 m out.
  expect(-fall.point.x).toBeGreaterThan(120);
  expect(fall.drop).toBeGreaterThan(100);
  // The flat of the face.
  expect(fall.normal.angleTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(THREE.MathUtils.degToRad(37), 3);
});

test('a face rising to the shadow catches it close', () => {
  // The same face with the sun from the west: the shadow goes up it.
  const sun = sunFrom(270, 20);
  const ground = face(37);
  const from = new THREE.Vector3(0, ground(0, 0) + 6, 0);
  const fall = shadowFall();
  expect(castShadow(from, sun, ground, fall)).toBe(true);
  expect(fall.point.distanceTo(from)).toBeLessThan(8);
  expect(shadowGrazing(sun, fall)).toBe(1);
});

test('the shape is laid on the slope, its middle where the cast fell', () => {
  const sun = sunFrom(60, 30);
  const ground = face(25);
  const centre = new THREE.Vector3(5, ground(5, 12) + 30, 12);
  const fall = shadowFall();
  expect(castShadow(centre, sun, ground, fall)).toBe(true);
  const placed = new THREE.Matrix4().makeRotationY(0.7).setPosition(centre);
  const m = layShadow(new THREE.Matrix4(), placed, sun, fall);
  // The middle: on the sun's ray through the centre, just over the face.
  const middle = new THREE.Vector3().applyMatrix4(m);
  expect(centre.clone().sub(middle).normalize().dot(sun)).toBeCloseTo(1, 5);
  expect(middle.y - ground(middle.x, middle.z)).toBeLessThan(0.1);
  expect(middle.distanceTo(fall.point)).toBeLessThan(0.5);
  // Every corner of a 9 m span lies on the face, just over it.
  for (const [x, z] of [[-4.5, -1], [4.5, -1], [-4.5, 2], [4.5, 2]] as const) {
    const p = new THREE.Vector3(x, 0, z).applyMatrix4(m);
    const over = p.y - ground(p.x, p.z);
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(0.1);
  }
  // A point of the body falls on the same flat.
  const feet = onShadowPlane(new THREE.Vector3(), centre.clone().add(new THREE.Vector3(0, -7, 0)), sun, fall);
  expect(feet.y - ground(feet.x, feet.z)).toBeLessThan(0.1);
});

test('a face turned away from the sun is in its own shade and takes no shadow', () => {
  // The sun from the east, low, over a face falling west at 40°: the face is turned away.
  const sun = sunFrom(90, 25);
  const ground = face(40);
  const fall = shadowFall();
  const from = new THREE.Vector3(0, ground(0, 0) + 10, 0);
  // The ray never comes down onto that face.
  expect(castShadow(from, sun, ground, fall)).toBe(false);
  // Under a face that does catch it, then the same place seen as turned away.
  fall.normal.set(-Math.sin(THREE.MathUtils.degToRad(80)), Math.cos(THREE.MathUtils.degToRad(80)), 0);
  expect(shadowGrazing(sun, fall)).toBe(0);
});

test('a shadow on a deck stays on the deck, not on the river under it', () => {
  // A deck 3 m thick, 20 m wide, 60 m over the water.
  const river = 100;
  const deck = 160;
  const ground: GroundAt = (x, _z, y) => (Math.abs(x) < 10 && (y === undefined || y >= deck - 3) ? deck : river);
  const sun = sunFrom(180, 60);
  const fall = shadowFall();
  expect(castShadow(new THREE.Vector3(0, deck + 1.7, 0), sun, ground, fall)).toBe(true);
  expect(fall.point.y).toBe(deck);
  expect(fall.normal.y).toBeCloseTo(1, 6);
});

test('a sun at the horizon casts nothing within reach', () => {
  const fall = shadowFall();
  expect(castShadow(new THREE.Vector3(0, 1500, 0), sunFrom(270, 0.5), flat, fall)).toBe(false);
});
