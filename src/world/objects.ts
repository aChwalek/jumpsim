// Things standing on the ground. They are all built at true size: buildings
// with doors and windows, cars, people and trees are what the eye uses to
// read height and distance.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BaseExit, Building, Flag, Placed, Tree } from './dz';
import { noiseTexture } from './ground';

const DEG = Math.PI / 180;

/** Height of the ground at a point, m. */
export type GroundAt = (x: number, z: number) => number;
const flat: GroundAt = () => 0;

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

export function buildBuildings(buildings: Building[], groundAt = flat): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const placed: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  for (const b of buildings) {
    const walls = b.flatRoof ? b.height : b.height * 0.8;
    const parts = [box(b.width, walls, b.length, 0, walls / 2, 0, b.color)];
    if (b.flatRoof) parts.push(box(b.width + 0.2, 0.25, b.length + 0.2, 0, walls, 0, b.roofColor));
    else parts.push(gableRoof(b.length, b.width, b.height - walls, b.roofColor).translate(0, walls, 0));
    // A person-sized door and windows on one long side.
    parts.push(box(0.1, 2.05, 0.95, b.width / 2, 1.025, -b.length / 2 + 2, 0x3b4046));
    for (let z = -b.length / 2 + 5; z < b.length / 2 - 1.5; z += 4) {
      parts.push(box(0.1, 1.1, 1.4, b.width / 2, 1.65, z, 0x24323f));
    }
    if (b.floors) {
      // Bands of glass all round, floor after floor: what the eye reads the height and the distance off.
      for (let y = b.floors * 0.6; y < walls - 1; y += b.floors) {
        parts.push(box(b.width + 0.1, 1.6, b.length + 0.1, 0, y, 0, 0x3a4652));
      }
    }
    if (b.hangar ?? b.height > 6) {
      // Hangar door on the other side.
      parts.push(box(0.12, walls * 0.85, b.length * 0.62, -b.width / 2, (walls * 0.85) / 2, 0, 0x596068));
    }
    // Sunk a little into sloping ground rather than floating over it.
    position.set(b.x, lowestUnder(groundAt, b.x, b.z, Math.max(b.length, b.width) / 2), b.z);
    q.setFromAxisAngle(up, -b.headingDeg * DEG);
    m.compose(position, q, one);
    for (const part of parts) placed.push(part.applyMatrix4(m));
  }
  // One mesh for the lot: a village is thousands of boxes.
  const geometry = placed.length ? mergeGeometries(placed) : new THREE.BufferGeometry();
  return new THREE.Mesh(geometry, material);
}

/**
 * The run painted on top of a BASE object: its two sides, a line where the
 * jumper starts and a yellow one along the edge.
 */
export function buildLedgeMarks(base: BaseExit, top: number): THREE.Mesh {
  const y = top + 0.01;
  const len = base.runUp;
  const half = base.width / 2;
  // Along the run, -Z towards the edge, then turned to its heading.
  const parts = [
    box(0.15, 0.02, len, -half, y, -len / 2, 0xe8e8e8),
    box(0.15, 0.02, len, half, y, -len / 2, 0xe8e8e8),
    box(base.width, 0.02, 0.2, 0, y, 0, 0xe8e8e8),
    box(base.width + 4, 0.02, 0.4, 0, y, -len + 0.25, 0xf2c21a),
  ];
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(base.x, 0, base.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -base.headingDeg * DEG),
    new THREE.Vector3(1, 1, 1),
  );
  for (const p of parts) p.applyMatrix4(m);
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/** Lowest ground within `radius` of a point, so that nothing floats on a slope. */
function lowestUnder(groundAt: GroundAt, x: number, z: number, radius: number): number {
  let low = groundAt(x, z);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    low = Math.min(low, groundAt(x + dx * radius, z + dz * radius));
  }
  return low;
}

export interface Trees {
  object: THREE.Group;
  /** Lays the shadows away from the sun; `strength` 0..1 is how dark they are. */
  setSun(sun: THREE.Vector3, strength: number): void;
}

export function buildTrees(trees: Tree[], groundAt = flat): Trees {
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
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x0c1a08,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    polygonOffset: true,
    // Over every layer of flat ground.
    polygonOffsetFactor: -20,
    polygonOffsetUnits: -20,
  });
  shadowMaterial.userData.castShadow = true;
  const shadow = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, trees.length);
  shadow.renderOrder = 6;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const seeds = trees.map((t) => Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1);
  const bases = trees.map((t) => groundAt(t.x, t.z));
  /** Crown radius: broad for most trees, a narrow spindle for cypresses. */
  const crownRadius = (t: Tree, seed: number): number => t.height * (t.slim ? 0.12 + 0.03 * seed : 0.26 + 0.1 * seed);
  trees.forEach((t, i) => {
    const seed = seeds[i]!;
    const base = bases[i]!;
    const radius = crownRadius(t, seed);
    const trunkHeight = t.height * (t.slim ? 0.08 : 0.35);
    q.setFromAxisAngle(up, seed * 6.28);
    m.compose(position.set(t.x, base, t.z), q, scale.set(t.height * 0.035, trunkHeight, t.height * 0.035));
    trunk.setMatrixAt(i, m);
    const crownHeight = (t.height - trunkHeight * 0.7) / 2;
    m.compose(position.set(t.x, base + t.height - crownHeight, t.z), q, scale.set(radius, crownHeight, radius));
    crown.setMatrixAt(i, m);
    if (t.slim) crown.setColorAt(i, color.setHSL(0.3 + 0.03 * seed, 0.38, 0.13 + 0.04 * seed));
    else crown.setColorAt(i, color.setHSL(0.26 + 0.06 * seed, 0.42, 0.2 + 0.1 * seed));
  });
  group.add(trunk, crown, shadow);

  return {
    object: group,
    setSun(sun, strength) {
      // Shadows fall away from the sun, stretched by its elevation; with the
      // sun overhead they shrink to a pool under the crown.
      const flatLength = Math.max(1e-3, Math.hypot(sun.x, sun.z));
      const stretch = Math.min(3, flatLength / Math.max(0.2, sun.y));
      const awayX = -sun.x / flatLength;
      const awayZ = -sun.z / flatLength;
      q.setFromAxisAngle(up, Math.atan2(-awayZ, awayX));
      trees.forEach((t, i) => {
        const radius = crownRadius(t, seeds[i]!);
        const reach = t.height * 0.55 * stretch;
        m.compose(
          position.set(t.x + awayX * reach, bases[i]!, t.z + awayZ * reach),
          q,
          scale.set(radius + reach, 1, radius * 1.05),
        );
        shadow.setMatrixAt(i, m);
      });
      shadow.instanceMatrix.needsUpdate = true;
      shadowMaterial.opacity = 0.38 * strength;
      shadow.visible = strength > 0.02;
    },
  };
}

export function buildCars(cars: Placed[], groundAt = flat): THREE.InstancedMesh {
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
  place(mesh, cars, groundAt);
  return mesh;
}

export function buildPeople(people: Placed[], groundAt = flat): THREE.Group {
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
  place(shirt, people, groundAt);
  place(rest, people, groundAt, false);
  group.add(shirt, rest);
  return group;
}

function place(mesh: THREE.InstancedMesh, items: Placed[], groundAt: GroundAt, colored = true): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  items.forEach((item, i) => {
    q.setFromAxisAngle(up, -item.headingDeg * DEG);
    mesh.setMatrixAt(i, m.compose(position.set(item.x, groundAt(item.x, item.z), item.z), q, one));
    if (colored) mesh.setColorAt(i, color.setHex(item.color));
  });
}

export interface Windsock {
  object: THREE.Group;
  setWind(fromDeg: number, speed: number): void;
}

export function buildWindsock(x: number, z: number, height: number, groundAt = flat): Windsock {
  const object = new THREE.Group();
  object.position.set(x, groundAt(x, z), z);
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
export function buildFlags(flags: Flag[], fabric: THREE.Color, groundAt = flat): Flags {
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
  const sailMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  // Dimmed with the daylight: the material shares the colour object.
  sailMaterial.color = fabric;
  const sails = new THREE.InstancedMesh(sail, sailMaterial, flags.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const bases = flags.map((f) => groundAt(f.x, f.z));
  flags.forEach((f, i) => {
    poles.setMatrixAt(i, m.compose(position.set(f.x, bases[i]!, f.z), q, scale.setScalar(f.height)));
    sails.setColorAt(i, color.setHex(f.color));
  });

  let downwind = 0;
  let flutter = 0;
  const update = (seconds: number): void => {
    flags.forEach((f, i) => {
      const sway = flutter * (0.16 * Math.sin(seconds * 2.3 + i * 1.7) + 0.07 * Math.sin(seconds * 6.1 + i * 2.9));
      q.setFromAxisAngle(up, downwind + sway);
      sails.setMatrixAt(i, m.compose(position.set(f.x, bases[i]!, f.z), q, scale.setScalar(f.height)));
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

/**
 * Rows of vines: a hedge of leaves on its wire, shoulder high, narrow at the
 * foot and at the top. `rows` holds lengths of row, ax, az, bx, bz, each
 * straight from the ground at one end to the ground at the other.
 */
/** Vines are drawn out to this from the eye, m, thinning away over the last part: beyond, the photo shows them. */
const VINES_DRAWN = 450;

export function buildVines(rows: number[], groundAt = flat): { object: THREE.Group; update(eye: THREE.Vector3): void } {
  /** Across the row and up, from one foot over the top to the other. */
  const SECTION: [number, number][] = [[-0.25, 0.25], [-0.42, 1.15], [0, 1.75], [0.42, 1.15], [0.25, 0.25]];
  /** The rows are gathered in squares of this side, m, so that those out of sight or too far are not drawn. */
  const SQUARE = 100;
  const squares = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i += 4) {
    const key = `${Math.floor(rows[i]! / SQUARE)},${Math.floor(rows[i + 1]! / SQUARE)}`;
    const list = squares.get(key);
    if (list) list.push(i);
    else squares.set(key, [i]);
  }
  /** The same at the end of one length and the start of the next: 0 to 1. */
  const chance = (x: number, z: number, k: number): number => Math.abs(Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453) % 1;
  // Leaves, not a clipped hedge: mottled light and dark, with gaps one sees
  // through where a vine is thin or missing.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const leaves = noiseTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.leafMap = { value: leaves };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLeafWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D leafMap;\nvarying vec3 vLeafWorld;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Height leans both ways into the plan, so that a wall running either way gets the pattern unstretched.
        vec2 leafAt = vLeafWorld.xz + vLeafWorld.y * vec2(0.7, 1.1);
        // Thinning out towards the far edge of what is drawn, so that the squares do not pop.
        float fade = smoothstep(${(VINES_DRAWN * 0.7).toFixed(1)}, ${VINES_DRAWN.toFixed(1)}, distance(vLeafWorld, cameraPosition));
        float thin = texture2D(leafMap, leafAt / 9.0).r;
        float leaf = texture2D(leafMap, leafAt / 1.1).r;
        if (thin + 0.5 * leaf < 0.62 + 1.2 * fade) discard;
        diffuseColor.rgb *= (0.45 + 1.1 * leaf) * (0.7 + 0.6 * thin);`,
      );
  };
  material.customProgramCacheKey = () => 'vines';
  const group = new THREE.Group();
  const color = new THREE.Color();
  for (const list of squares.values()) {
    const faces = SECTION.length - 1;
    const position = new Float32Array(list.length * faces * 18);
    const colors = new Float32Array(list.length * faces * 18);
    let o = 0;
    for (const i of list) {
      const ends = [[rows[i]!, rows[i + 1]!], [rows[i + 2]!, rows[i + 3]!]] as const;
      const dx = ends[1][0] - ends[0][0];
      const dz = ends[1][1] - ends[0][1];
      const length = Math.hypot(dx, dz);
      // To the right of the way the row runs.
      const rx = -dz / length;
      const rz = dx / length;
      /** Corner `k` of the section at one end: vines grow unevenly, and no two rows alike. */
      const corner = (end: 0 | 1, k: number): [number, number, number, number] => {
        const [x, z] = ends[end];
        const [across, up] = SECTION[k]!;
        const grown = 0.8 + 0.4 * chance(x, z, 1);
        const wide = 0.8 + 0.5 * chance(x, z, 2);
        // Dark at the foot, in the shade of the leaves; lighter on top.
        const shade = (0.45 + 0.55 * (up / 1.75)) * (0.85 + 0.3 * chance(x, z, 3));
        return [x + rx * across * wide, groundAt(x, z) + up * grown, z + rz * across * wide, shade];
      };
      for (let k = 0; k < faces; k++) {
        const a = corner(0, k);
        const b = corner(0, k + 1);
        const c = corner(1, k + 1);
        const d = corner(1, k);
        for (const p of [a, b, c, a, c, d]) {
          color.setHSL(0.25, 0.42, 0.17 * p[3]);
          position[o] = p[0];
          position[o + 1] = p[1];
          position[o + 2] = p[2];
          colors[o] = color.r;
          colors[o + 1] = color.g;
          colors[o + 2] = color.b;
          o += 3;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry, material));
  }
  return {
    object: group,
    update(eye) {
      for (const mesh of group.children as THREE.Mesh[]) {
        const sphere = mesh.geometry.boundingSphere!;
        mesh.visible = eye.distanceTo(sphere.center) - sphere.radius < VINES_DRAWN;
      }
    },
  };
}
