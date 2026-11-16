import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { limbMesh, roundLimbEnds } from '../src/render/characterParts';
import { CharacterHead } from '../src/render/characterStyle';
import { canopyTaper } from '../src/render/canopyView';

describe('stickman joints', () => {
  it('keeps spherical joints joined at both ends through short and extended poses', () => {
    const radius = 0.052;
    const limb = limbMesh(radius, new THREE.MeshBasicMaterial());
    const a = new THREE.Vector3(-0.19, -0.18, 0.12);
    for (const length of [0.05, 0.28, 0.3, 0.58]) {
      const dir = new THREE.Vector3(1, -2, 3).normalize();
      const b = a.clone().addScaledVector(dir, length);
      limb.position.addVectors(a, b).multiplyScalar(0.5);
      limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      limb.scale.y = length;
      roundLimbEnds(limb, length);
      limb.updateMatrixWorld(true);
      limb.children.forEach((cap, i) => {
        const centre = cap.getWorldPosition(new THREE.Vector3());
        expect(centre.distanceTo(i === 0 ? a : b)).toBeLessThan(1e-6);
        const size = new THREE.Vector3().setFromMatrixScale(cap.matrixWorld);
        expect(size.x).toBeCloseTo(1);
        expect(size.y).toBeCloseTo(1);
        expect(size.z).toBeCloseTo(1);
      });
    }
  });
});

it('tapers the canopy continuously while retaining open tip cells', () => {
  expect(canopyTaper(0)).toBe(1);
  expect(canopyTaper(1)).toBeCloseTo(0.6);
  let previous = 1;
  for (let i = 1; i <= 100; i++) {
    const s = i / 100;
    expect(canopyTaper(s)).toBeLessThan(previous);
    expect(canopyTaper(-s)).toBe(canopyTaper(s));
    previous = canopyTaper(s);
  }
});


it('exposes the actual face with an open helmet or raised visor, and covers it when closed', () => {
  const head = new CharacterHead();
  const seenAtEye = () => {
    head.group.updateMatrixWorld(true);
    const visible: THREE.Object3D[] = [];
    head.group.traverseVisible((o) => { if (o instanceof THREE.Mesh) visible.push(o); });
    const ray = new THREE.Raycaster(new THREE.Vector3(0.037, 0.009, -1), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObjects(visible, false)[0]!;
    return ((hit.object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
  };
  const base = { suit: 0, helmet: 0xffffff, face: true, goggles: false };
  head.set({ ...base, helmetKind: 'full' });
  expect(seenAtEye()).toBe(0x152733);
  head.set({ ...base, helmetKind: 'full', visorRaised: true });
  expect(seenAtEye()).toBe(0x20242b);
  head.set({ ...base, helmetKind: 'open' });
  expect(seenAtEye()).toBe(0x20242b);
  head.set({ ...base, helmetKind: 'open', face: false, skin: 0x935d3c });
  expect(seenAtEye()).toBe(0x935d3c);
});
