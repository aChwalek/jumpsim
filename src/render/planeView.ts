// The jump plane, as seen from its door and from below once out: a generic
// high-wing single turboprop, built from boxes at true size. The cabin is
// open on the left behind the wing, and lined inside, since the jumper
// starts crouched in that doorway.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CABIN, DOOR, type Plane } from '../sim/plane';

const WHITE = 0xf1f1ee;
const STRIPE = 0x1f4f9a;
const BELLY = 0xa9adb2;
const LINING = 0x41454b;
const FLOOR = 0x2a2c2f;
const GLASS = 0x1b2530;
const METAL = 0x6d7278;
const TYRE = 0x1a1a1a;

function tint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  // Every part must carry the same attributes to be merged into one mesh.
  g.deleteAttribute('uv');
  const color = new THREE.Color(hex);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A box between two corners. */
function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number): THREE.BufferGeometry {
  return tint(
    new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    hex,
  );
}

/**
 * A solid whose cross-sections are rectangles, from one at z0 to another at
 * z1, each given by its half width and its bottom and top.
 */
function taper(
  z0: number,
  a: { w: number; y0: number; y1: number },
  z1: number,
  b: { w: number; y0: number; y1: number },
  hex: number,
): THREE.BufferGeometry {
  const v = [
    [-a.w, a.y0, z0], [a.w, a.y0, z0], [a.w, a.y1, z0], [-a.w, a.y1, z0],
    [-b.w, b.y0, z1], [b.w, b.y0, z1], [b.w, b.y1, z1], [-b.w, b.y1, z1],
  ];
  // Quads as corner indices, wound to face out.
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], // ends
    [0, 1, 5, 4], [3, 7, 6, 2], // bottom, top
    [0, 4, 7, 3], [1, 2, 6, 5], // left, right
  ];
  const positions: number[] = [];
  for (const [p, q, r, s] of faces) {
    for (const k of [p, q, r, p, r, s]) positions.push(...v[k!]!);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return tint(geometry, hex);
}

/** A round rod from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, hex: number): THREE.BufferGeometry {
  const along = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.CylinderGeometry(radius, radius, along.length(), 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tint(geometry, hex);
}

function wheel(x: number, y: number, z: number): THREE.BufferGeometry {
  return tint(new THREE.CylinderGeometry(0.3, 0.3, 0.17, 16).rotateZ(Math.PI / 2).translate(x, y, z), TYRE);
}

function buildBody(): THREE.BufferGeometry {
  const w = CABIN.halfWidth;
  const h = CABIN.height;
  const skin = 0.03;
  const front = -2.6;
  const back = 2.6;
  const top = h + 0.08;
  const bottom = -0.4;
  const parts: THREE.BufferGeometry[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Floor, belly and roof.
  parts.push(slab(-w, w, -0.05, 0, front, back, FLOOR));
  parts.push(slab(-w - skin, w + skin, bottom, -0.05, front, back, BELLY));
  parts.push(slab(-w - skin, w + skin, h, top, front, back, WHITE));
  // Right wall, then the left one around the door.
  parts.push(slab(w, w + skin, -0.05, h, front, back, WHITE));
  parts.push(slab(-w - skin, -w, -0.05, h, front, DOOR.front, WHITE));
  parts.push(slab(-w - skin, -w, -0.05, h, DOOR.back, back, WHITE));
  parts.push(slab(-w - skin, -w, DOOR.top, h, DOOR.front, DOOR.back, WHITE));
  // The lining inside, darker, so the cabin reads as a cabin.
  parts.push(slab(w - 0.02, w, 0, h, front, back, LINING));
  parts.push(slab(-w, -w + 0.02, 0, h, front, DOOR.front, LINING));
  parts.push(slab(-w, -w + 0.02, 0, h, DOOR.back, back, LINING));
  parts.push(slab(-w, -w + 0.02, DOOR.top, h, DOOR.front, DOOR.back, LINING));
  parts.push(slab(-w, w, h - 0.02, h, front, back, LINING));
  parts.push(slab(-w, w, 0, h, back - 0.02, back, LINING));
  // A stripe down each side and windows above it.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -w - skin - 0.005 : w + skin;
    parts.push(slab(x0, x0 + 0.005, 0.38, 0.5, front, back, STRIPE));
    for (const z of [-1.7, -0.7, 0.3, 2.15]) {
      if (side < 0 && z > DOOR.front - 0.5 && z < DOOR.back + 0.1) continue;
      parts.push(slab(x0, x0 + 0.005, 0.72, 1.12, z - 0.3, z + 0.3, GLASS));
    }
  }

  // Cockpit glass, engine cowling, spinner.
  parts.push(taper(front, { w: w + skin, y0: bottom, y1: top }, front - 0.7, { w: 0.7, y0: -0.3, y1: 1.05 }, WHITE));
  parts.push(slab(-0.62, 0.62, 1.07, 1.45, front - 0.55, front - 0.05, GLASS));
  parts.push(taper(front - 0.7, { w: 0.7, y0: -0.3, y1: 1.05 }, front - 2.1, { w: 0.42, y0: 0.05, y1: 0.85 }, WHITE));
  parts.push(slab(-0.72, -0.7, 0.2, 0.32, front - 1.9, front - 0.8, STRIPE));
  parts.push(slab(0.7, 0.72, 0.2, 0.32, front - 1.9, front - 0.8, STRIPE));
  parts.push(tint(new THREE.ConeGeometry(0.24, 0.45, 12).rotateX(-Math.PI / 2).translate(0, 0.45, front - 2.32), METAL));

  // Tail cone, fin and tailplane.
  parts.push(taper(back, { w: w + skin, y0: bottom, y1: top }, 7.4, { w: 0.14, y0: 0.75, y1: 1.12 }, WHITE));
  parts.push(taper(6.0, { w: 0.05, y0: 1.0, y1: 1.05 }, 7.4, { w: 0.05, y0: 1.0, y1: 1.05 }, WHITE));
  const fin = new THREE.BufferGeometry();
  // prettier-ignore
  const finSide = [5.5, 1.0, 7.4, 1.0, 7.6, 3.1, 5.5, 1.0, 7.6, 3.1, 6.9, 3.1];
  const finPositions: number[] = [];
  for (const x of [-0.04, 0.04]) {
    for (let i = 0; i < finSide.length; i += 2) finPositions.push(x, finSide[i + 1]!, finSide[i]!);
  }
  fin.setAttribute('position', new THREE.Float32BufferAttribute(finPositions, 3));
  fin.computeVertexNormals();
  parts.push(tint(fin, WHITE));
  parts.push(slab(-2.9, 2.9, 0.84, 0.9, 6.2, 7.3, WHITE));

  // The wing on top, its struts, and the wheels.
  parts.push(slab(-7.9, 7.9, top, top + 0.14, -2.2, -0.35, WHITE));
  parts.push(slab(-7.9, -7.7, top - 0.02, top + 0.16, -2.25, -0.3, STRIPE));
  parts.push(slab(7.7, 7.9, top - 0.02, top + 0.16, -2.25, -0.3, STRIPE));
  for (const side of [-1, 1]) {
    parts.push(rod(v(side * (w + 0.02), 0.05, -1.2), v(side * 4.7, top, -1.2), 0.05, WHITE));
    parts.push(rod(v(side * (w - 0.1), bottom, 0.25), v(side * 1.55, -1.05, 0.25), 0.05, METAL));
    parts.push(wheel(side * 1.62, -1.1, 0.25));
  }
  parts.push(rod(v(0, -0.2, front - 1.2), v(0, -1.05, front - 1.2), 0.05, METAL));
  parts.push(wheel(0, -1.12, front - 1.2));
  return mergeGeometries(parts)!;
}

export class PlaneView {
  readonly object = new THREE.Group();
  private readonly prop = new THREE.Group();

  constructor() {
    // Light bounced off the ground and the haze keeps the shaded side, the
    // underside of the wing, from going dark.
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x34383e });
    this.object.add(new THREE.Mesh(buildBody(), material));

    // The propeller: a blur of a disc with three blades in it.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 40),
      new THREE.MeshBasicMaterial({ color: 0x15181b, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    );
    const blades = new THREE.Group();
    const blade = new THREE.MeshLambertMaterial({ color: 0x202326, transparent: true, opacity: 0.35, depthWrite: false });
    for (let k = 0; k < 3; k++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.03).translate(0, 0.68, 0), blade);
      mesh.rotation.z = (k * 2 * Math.PI) / 3;
      blades.add(mesh);
    }
    this.prop.add(disc, blades);
    this.prop.position.set(0, 0.45, -4.72);
    this.object.add(this.prop);
  }

  update(plane: Plane): void {
    this.object.position.set(plane.pos.x, plane.pos.y, plane.pos.z);
    this.object.quaternion.set(plane.att.x, plane.att.y, plane.att.z, plane.att.w);
    this.prop.rotation.z = plane.prop;
  }

  dispose(): void {
    this.object.traverse((node) => {
      const { geometry, material } = node as THREE.Mesh;
      geometry?.dispose();
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
  }
}
