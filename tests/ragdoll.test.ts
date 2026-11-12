import { expect, test } from 'vitest';
import { J, JOINT_COUNT, Ragdoll } from '../src/sim/ragdoll';
import { vec3, type Vec3 } from '../src/sim/vec';

/** A pilot standing upright, belly to -Z, feet at `y`. */
function standing(y: number): Vec3[] {
  const p: Vec3[] = [];
  const put = (i: number, x: number, h: number, z: number) => (p[i] = vec3(x, y + h, z));
  put(J.head, 0, 1.65, 0);
  put(J.neck, 0, 1.45, 0.02);
  put(J.pelvis, 0, 0.98, 0.02);
  put(J.shoulderL, -0.19, 1.42, 0.02);
  put(J.shoulderR, 0.19, 1.42, 0.02);
  put(J.elbowL, -0.3, 1.15, 0.02);
  put(J.elbowR, 0.3, 1.15, 0.02);
  put(J.handL, -0.33, 0.88, 0);
  put(J.handR, 0.33, 0.88, 0);
  put(J.hipL, -0.1, 0.94, 0.02);
  put(J.hipR, 0.1, 0.94, 0.02);
  put(J.kneeL, -0.1, 0.5, -0.03);
  put(J.kneeR, 0.1, 0.5, -0.03);
  put(J.footL, -0.1, 0.07, 0);
  put(J.footR, 0.1, 0.07, 0);
  return p;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('thrown at the ground fast, the body tumbles, is heard, and comes to rest on it', () => {
  const start = standing(0.3);
  const thigh = dist(start[J.hipL]!, start[J.kneeL]!);
  // A crash: 7 m/s down, 10 m/s forward.
  const vel = start.map(() => vec3(0, -7, -10));
  const body = new Ragdoll(start, vel, () => 0);
  for (let t = 0; t < 12 && !body.settled; t += 1 / 60) body.update(1 / 60);
  expect(body.settled).toBe(true);
  expect(body.hits.length).toBeGreaterThan(3);
  expect(body.hits[0]!.speed).toBeGreaterThan(6);
  for (const p of body.pos) expect(p.y).toBeGreaterThan(0.02);
  // Lying down, not standing.
  expect(body.pos[J.head]!.y).toBeLessThan(0.4);
  // Gone forward, slowed by the grass.
  expect(body.pos[J.pelvis]!.z).toBeLessThan(-0.5);
  expect(body.pos[J.pelvis]!.z).toBeGreaterThan(-12);
  // Bones keep their length.
  expect(dist(body.pos[J.hipL]!, body.pos[J.kneeL]!)).toBeCloseTo(thigh, 1);
  expect(body.pos.length).toBe(JOINT_COUNT);
});

test('a gentle drop is heard but breaks nothing', () => {
  const start = standing(0.05);
  const body = new Ragdoll(start, start.map(() => vec3(0, -2, 0)), () => 0);
  for (let t = 0; t < 10 && !body.settled; t += 1 / 60) body.update(1 / 60);
  expect(body.broken.size).toBe(0);
  expect(body.hits.every((h) => !h.broke)).toBe(true);
});

test('nothing starts inside the ground', () => {
  const start = standing(-0.5);
  const body = new Ragdoll(start, start.map(() => vec3()), () => 0);
  for (const p of body.pos) expect(p.y).toBeGreaterThan(0);
});
