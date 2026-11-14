// The accuracy challenge on the ground: rings painted round the drop zone's
// target, widest seen from the circuit, the small ones in the last metres, and
// a disc in the middle. Rings of a known size are a height cue too.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACCURACY_CENTRE, ACCURACY_RINGS } from '../challenge';
import { groundMaterial } from './ground';

/** Width of a ring's line, m: a hand's breadth close in, half a metre round the outer one, to be seen from up high. */
const lineWidth = (radius: number): number => Math.max(0.1, radius * 0.024);

/**
 * The target, centred on (x, z), laid on the ground as drawn (`heightAt`), so
 * that a ring running up a bank stays on it; drawn over the flat surfaces up
 * to `layer` (see groundMaterial).
 */
export function buildAccuracyTarget(x: number, z: number, heightAt: (x: number, z: number) => number, layer: number): THREE.Group {
  const group = new THREE.Group();
  const rings = mergeGeometries(
    ACCURACY_RINGS.map((r) => {
      const w = lineWidth(r);
      return new THREE.RingGeometry(r - w / 2, r + w / 2, Math.max(48, Math.round(r * 10)), 1);
    }),
  );
  rings.rotateX(-Math.PI / 2);
  drape(rings, x, z, heightAt);
  const lines = new THREE.Mesh(rings, groundMaterial({ color: 0xf4f3ee }, layer));
  lines.renderOrder = layer;
  const disc = new THREE.CircleGeometry(ACCURACY_CENTRE, 32).rotateX(-Math.PI / 2);
  drape(disc, x, z, heightAt);
  const centre = new THREE.Mesh(disc, groundMaterial({ color: 0xff5a1f }, layer + 1));
  centre.renderOrder = layer + 1;
  group.add(lines, centre);
  group.position.set(x, 0, z);
  return group;
}

/** Puts every point of a flat shape about (x, z) on the ground under it. */
function drape(geometry: THREE.BufferGeometry, x: number, z: number, heightAt: (x: number, z: number) => number): void {
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(x + p.getX(i), z + p.getZ(i)));
  p.needsUpdate = true;
  geometry.computeBoundingSphere();
}
