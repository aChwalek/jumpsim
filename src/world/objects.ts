// Things standing on the ground. They are all built at true size: buildings
// with doors and windows, cars, people and trees are what the eye uses to
// read height and distance.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building, Flag, Placed, Tree } from './dz';

const DEG = Math.PI / 180;

/** Give every vertex of a geometry the same colour. */
function tint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  return tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(), hex);
}

function gableRoof(length: number, width: number, rise: number, hex: number): THREE.BufferGeometry {
  const l = length / 2 + 0.4;
  const w = width / 2 + 0.4;
  // prettier-ignore
  const v = [
    -w, 0,  l,   0, rise,  l,   0, rise, -l,   -w, 0,  l,   0, rise, -l,  -w, 0, -l, // west slope
     w, 0,  l,   0, rise, -l,   0, rise,  l,    w, 0,  l,   w, 0, -l,      0, rise, -l, // east slope
    -w, 0,  l,   w, 0,  l,      0, rise,  l, // gable
    -w, 0, -l,   0, rise, -l,   w, 0, -l, // gable
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  geometry.computeVertexNormals();
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
  return tint(geometry, hex);
}

export function buildBuildings(buildings: Building[]): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (const b of buildings) {
    const walls = b.height * 0.8;
    const parts = [
      box(b.width, walls, b.length, 0, walls / 2, 0, b.color),
      gableRoof(b.length, b.width, b.height - walls, b.roofColor).translate(0, walls, 0),
      // A person-sized door and windows on one long side.
      box(0.1, 2.05, 0.95, b.width / 2, 1.025, -b.length / 2 + 2, 0x3b4046),
    ];
    for (let z = -b.length / 2 + 5; z < b.length / 2 - 1.5; z += 4) {
      parts.push(box(0.1, 1.1, 1.4, b.width / 2, 1.65, z, 0x24323f));
    }
    if (b.height > 6) {
      // Hangar door on the other side.
      parts.push(box(0.12, walls * 0.85, b.length * 0.62, -b.width / 2, (walls * 0.85) / 2, 0, 0x596068));
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.position.set(b.x, 0, b.z);
    mesh.rotation.y = -b.headingDeg * DEG;
    group.add(mesh);
  }
  return group;
}

export function buildTrees(trees: Tree[], sun: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.65, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
    trees.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    trees.length,
  );
  const shadowGeometry = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const shadow = new THREE.InstancedMesh(
    shadowGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x0c1a08,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -12,
      polygonOffsetUnits: -12,
    }),
    trees.length,
  );
  shadow.renderOrder = 6;

  // Shadows fall away from the sun, stretched by its elevation.
  const flat = Math.hypot(sun.x, sun.z);
  const stretch = Math.min(3, flat / Math.max(0.2, sun.y));
  const awayX = -sun.x / flat;
  const awayZ = -sun.z / flat;
  const shadowYaw = Math.atan2(-awayZ, awayX);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  trees.forEach((t, i) => {
    const seed = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
    const radius = t.height * (0.26 + 0.1 * seed);
    const trunkHeight = t.height * 0.35;
    q.setFromAxisAngle(up, seed * 6.28);
    m.compose(position.set(t.x, 0, t.z), q, scale.set(t.height * 0.035, trunkHeight, t.height * 0.035));
    trunk.setMatrixAt(i, m);
    const crownHeight = (t.height - trunkHeight * 0.7) / 2;
    m.compose(position.set(t.x, t.height - crownHeight, t.z), q, scale.set(radius, crownHeight, radius));
    crown.setMatrixAt(i, m);
    crown.setColorAt(i, color.setHSL(0.26 + 0.06 * seed, 0.42, 0.2 + 0.1 * seed));
    const reach = t.height * 0.55 * stretch;
    q.setFromAxisAngle(up, shadowYaw);
    m.compose(
      position.set(t.x + awayX * reach, 0, t.z + awayZ * reach),
      q,
      scale.set(radius + reach, 1, radius * 1.05),
    );
    shadow.setMatrixAt(i, m);
  });
  group.add(trunk, crown, shadow);
  return group;
}

export function buildCars(cars: Placed[]): THREE.InstancedMesh {
  const parts = [
    box(1.8, 0.7, 4.3, 0, 0.62, 0, 0xffffff),
    box(1.62, 0.55, 2.2, 0, 1.22, 0.25, 0x30363c),
  ];
  for (const x of [-0.82, 0.82]) {
    for (const z of [-1.35, 1.35]) parts.push(box(0.24, 0.64, 0.64, x, 0.32, z, 0x151515));
  }
  const mesh = new THREE.InstancedMesh(
    mergeGeometries(parts),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    cars.length,
  );
  place(mesh, cars);
  return mesh;
}

export function buildPeople(people: Placed[]): THREE.Group {
  const group = new THREE.Group();
  const shirt = new THREE.InstancedMesh(
    mergeGeometries([
      box(0.44, 0.6, 0.24, 0, 1.17, 0, 0xffffff),
      box(0.1, 0.58, 0.12, -0.28, 1.16, 0, 0xffffff),
      box(0.1, 0.58, 0.12, 0.28, 1.16, 0, 0xffffff),
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    people.length,
  );
  const rest = new THREE.InstancedMesh(
    mergeGeometries([
      box(0.17, 0.87, 0.2, -0.11, 0.435, 0, 0x2c3550),
      box(0.17, 0.87, 0.2, 0.11, 0.435, 0, 0x2c3550),
      tint(new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.62, 0).toNonIndexed(), 0xd9a98a),
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    people.length,
  );
  place(shirt, people);
  place(rest, people, false);
  group.add(shirt, rest);
  return group;
}

function place(mesh: THREE.InstancedMesh, items: Placed[], colored = true): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  items.forEach((item, i) => {
    q.setFromAxisAngle(up, -item.headingDeg * DEG);
    mesh.setMatrixAt(i, m.compose(position.set(item.x, 0, item.z), q, one));
    if (colored) mesh.setColorAt(i, color.setHex(item.color));
  });
}

export interface Windsock {
  object: THREE.Group;
  setWind(fromDeg: number, speed: number): void;
}

export function buildWindsock(x: number, z: number, height: number): Windsock {
  const object = new THREE.Group();
  object.position.set(x, 0, z);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  object.add(new THREE.Mesh(tint(new THREE.CylinderGeometry(0.045, 0.06, height, 8).translate(0, height / 2, 0), 0xe6e6e6), material));

  // Five bands, red and white, narrowing towards the tail.
  const length = 2.4;
  const bands: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const wide = 0.3 - 0.036 * k;
    const band = new THREE.CylinderGeometry(wide - 0.036, wide, length / 5, 12, 1, true);
    band.translate(0, (k + 0.5) * (length / 5), 0);
    bands.push(tint(band, k % 2 === 0 ? 0xd8281e : 0xf2f2f2));
  }
  // Lay it along -Z (the "forward" axis), mouth at the origin.
  const sock = new THREE.Mesh(mergeGeometries(bands).rotateX(-Math.PI / 2), material);
  const pitch = new THREE.Group();
  pitch.add(sock);
  const yaw = new THREE.Group();
  yaw.position.y = height - 0.3;
  yaw.add(pitch);
  object.add(yaw);

  return {
    object,
    setWind(fromDeg, speed) {
      yaw.rotation.y = -(fromDeg + 180) * DEG;
      // Hangs almost straight down in calm air, flies level from about 8 m/s.
      pitch.rotation.x = -(1 - Math.min(1, speed / 8)) * 78 * DEG;
    },
  };
}

export interface Flags {
  object: THREE.Group;
  setWind(fromDeg: number, speed: number): void;
  /** Call every frame with the time in seconds. */
  update(seconds: number): void;
}

/** Feather flags: a pole and a tall narrow sail that trails downwind and flutters. */
export function buildFlags(flags: Flag[]): Flags {
  // Both are built 1 m tall and scaled up to the height of each flag.
  const pole = new THREE.CylinderGeometry(0.006, 0.008, 1, 6).translate(0, 0.5, 0);
  // The free edge of the sail, trailing along -Z: widest low down, rounded off into the tip.
  const edge = (t: number): [number, number] => [0.15 + 0.85 * t, -0.16 * Math.sqrt(1 - t ** 2.2) * (0.75 + 0.25 * t)];
  const steps = 10;
  const positions: number[] = [];
  for (let i = 0; i < steps; i++) {
    const [y0, z0] = edge(i / steps);
    const [y1, z1] = edge((i + 1) / steps);
    positions.push(0, y0, 0, 0, y0, z0, 0, y1, z1, 0, y0, 0, 0, y1, z1, 0, y1, 0);
  }
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const poles = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0xdadada }), flags.length);
  // Unlit, like the canopy: thin fabric glows whichever side the sun is on.
  const sails = new THREE.InstancedMesh(sail, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), flags.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  flags.forEach((f, i) => {
    poles.setMatrixAt(i, m.compose(position.set(f.x, 0, f.z), q, scale.setScalar(f.height)));
    sails.setColorAt(i, color.setHex(f.color));
  });

  let downwind = 0;
  let flutter = 0;
  const update = (seconds: number): void => {
    flags.forEach((f, i) => {
      const sway = flutter * (0.16 * Math.sin(seconds * 2.3 + i * 1.7) + 0.07 * Math.sin(seconds * 6.1 + i * 2.9));
      q.setFromAxisAngle(up, downwind + sway);
      sails.setMatrixAt(i, m.compose(position.set(f.x, 0, f.z), q, scale.setScalar(f.height)));
    });
    sails.instanceMatrix.needsUpdate = true;
  };
  update(0);

  const object = new THREE.Group();
  object.add(poles, sails);
  return {
    object,
    setWind(fromDeg, speed) {
      downwind = -(fromDeg + 180) * DEG;
      flutter = Math.min(1, speed / 5);
    },
    update,
  };
}
