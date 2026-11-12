import * as THREE from 'three';
import { expect, test } from 'vitest';
import type { FreeInputs } from '../src/input/devices';
import { FreeCamera } from '../src/render/freeCamera';

const still = (): FreeInputs => ({ forward: 0, right: 0, up: 0, fast: false, yaw: 0, pitch: 0, yawRate: 0, pitchRate: 0 });
const flat = () => 0;

function run(free: FreeCamera, camera: THREE.PerspectiveCamera, input: FreeInputs, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) free.update(camera, 1 / 60, input, flat);
}

test('it starts where the camera was, looking the same way', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 50, -20);
  camera.lookAt(10, 50, -40);
  const free = new FreeCamera(camera);
  expect(free.heading).toBeCloseTo(0, 6);
  expect(free.pitch).toBeCloseTo(0, 6);
  run(free, camera, still(), 1);
  expect(camera.position.distanceTo(new THREE.Vector3(10, 50, -20))).toBeLessThan(1e-9);
});

test('it goes along the view, to the side and up, faster when asked', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 50, -1);
  const free = new FreeCamera(camera);
  run(free, camera, { ...still(), forward: 1 }, 2);
  // Ten metres a second once up to speed: north, which is -z.
  expect(camera.position.z).toBeLessThan(-17);
  expect(camera.position.z).toBeGreaterThan(-20);
  const before = camera.position.clone();
  run(free, camera, { ...still(), right: 1, fast: true }, 1);
  expect(camera.position.x - before.x).toBeGreaterThan(45);
  run(free, camera, { ...still(), up: 1 }, 1);
  expect(camera.position.y).toBeGreaterThan(55);
});

test('it turns with the mouse and the stick, and stays above the ground', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -1);
  const free = new FreeCamera(camera);
  free.update(camera, 1 / 60, { ...still(), yaw: Math.PI / 2 }, flat);
  const dir = camera.getWorldDirection(new THREE.Vector3());
  // A quarter turn to the right: east, +x.
  expect(dir.x).toBeCloseTo(1, 6);
  run(free, camera, { ...still(), pitchRate: -1 }, 3);
  expect(free.pitch).toBeCloseTo(-1.5, 6);
  // Diving at the ground: it stops just above it.
  run(free, camera, { ...still(), forward: 1, fast: true }, 2);
  expect(camera.position.y).toBeCloseTo(0.4, 6);
});
