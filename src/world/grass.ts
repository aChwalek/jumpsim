// Grass and flowers drawn blade by blade around the pilot. A ground texture
// looks the same from 15 m as from 1 m; things of a known size that stand up
// from the ground do not: they come into view on the way down, slide past
// faster and faster, and end up at the pilot's feet.
//
// The blades are fixed to the ground. They are laid out once in a square tile
// that repeats, and the shader draws the copy of each one nearest to the eye.
// The ground is taken to be flat, at height 0.

import * as THREE from 'three';
import type { Rect } from './dz';

export interface GrassSpec {
  /** Grass grows inside this rectangle, in the rectangle's colour. */
  area: Rect;
  /** Mown short here. */
  mown: Rect;
  /** Nothing grows on these: tarmac, gravel. */
  bare: Rect[];
  /** Nor on the landing target. */
  target: { x: number; z: number; radius: number };
}

export interface Grass {
  object: THREE.Group;
  /** Call every frame with the eye position and the time in seconds. */
  update(eye: THREE.Vector3, seconds: number): void;
}

const DEG = Math.PI / 180;

const VERTEX = /* glsl */ `
  uniform vec3 eye;
  uniform float time;
  uniform vec2 size;
  uniform float tile;
  uniform float reach;
  uniform float widen;
  uniform float grassy;
  uniform vec4 areaBox;
  uniform vec2 areaDir;
  uniform vec4 mownBox;
  uniform vec2 mownDir;
  uniform vec3 target;
  uniform vec4 bareBox[BARE];
  uniform vec2 bareDir[BARE];
  uniform vec3 rough;
  uniform vec3 mown;
  uniform vec3 light;
  attribute vec2 lean;
  attribute vec3 color;
  attribute vec2 offset;
  attribute vec4 seed;
  varying vec3 vColor;

  // 1 inside the rectangle. box: centre x z, half length, half width; dir: sin and cos of its heading.
  float inside(vec2 p, vec4 box, vec2 dir) {
    vec2 d = p - box.xy;
    return step(abs(d.x * dir.x - d.y * dir.y), box.z) * step(abs(d.x * dir.y + d.y * dir.x), box.w);
  }

  void main() {
    vec2 rel = mod(offset - eye.xz + 0.5 * tile, tile) - 0.5 * tile;
    vec2 at = eye.xz + rel;
    float away = length(vec3(rel, eye.y));

    // Each blade has its own range, so the grass thins out with distance
    // instead of stopping at an edge, and grows in on the way down.
    float show = 1.0 - smoothstep(0.5, 1.0, away / (reach * mix(0.25, 1.0, seed.w)));
    show *= inside(at, areaBox, areaDir) * step(target.z, distance(at, target.xy));
    for (int i = 0; i < BARE; i++) show *= 1.0 - inside(at, bareBox[i], bareDir[i]);

    float cut = inside(at, mownBox, mownDir);
    float tall = size.y * mix(1.0, 0.45, cut) * (0.55 + 0.9 * seed.y) * show;
    // Far blades are thinner than a pixel: widen them rather than let them flicker.
    float wide = size.x * (1.0 + widen * away) * min(1.0, show * 4.0);

    float c = cos(seed.x);
    float s = sin(seed.x);
    vec2 spot = position.xz * wide + lean * tall;
    float gust = sin(time * 1.7 + at.x * 0.35 + at.y * 0.5) + 0.5 * sin(time * 4.3 + at.x * 2.1);
    spot = vec2(c * spot.x + s * spot.y, c * spot.y - s * spot.x);
    spot.x += gust * 0.18 * tall * position.y * position.y;

    gl_Position = projectionMatrix * viewMatrix * vec4(at.x + spot.x, position.y * tall, at.y + spot.y, 1.0);
    // Dark tufts, light ones, and a few dry ones: blades the colour of the
    // ground under them cannot be told apart.
    vec3 ground = mix(rough, mown, cut) * mix(0.5, 1.6, seed.z);
    ground = mix(ground, vec3(0.5, 0.42, 0.16), 0.7 * step(0.86, fract(seed.x * 3.7)));
    vColor = color * mix(vec3(1.0), ground, grassy) * light;
  }`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
  }`;

/** A tuft of blades. x and z are in blade widths, y and the lean in blade heights. */
function tuft(blades: number): THREE.BufferGeometry {
  const position: number[] = [];
  const lean: number[] = [];
  const color: number[] = [];
  for (let k = 0; k < blades; k++) {
    const turn = (k / blades) * Math.PI * 2 + k;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const height = 1 - 0.55 * (k / blades);
    const out = 0.25 + 0.3 * (k % 3);
    // Two corners at the root, one at the tip, which leans outwards.
    for (const [across, up] of [[-0.5, 0], [0.5, 0], [0, 1]] as const) {
      position.push(c * across + s * 1.2, up * height, -s * across + c * 1.2);
      lean.push(s * out * up, c * out * up);
      const shade = 0.4 + 1.0 * up;
      color.push(shade, shade, shade * 0.9);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('lean', new THREE.Float32BufferAttribute(lean, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  return geometry;
}

/** A daisy or a dandelion seen from above: petals round a heart, at the height of the grass. */
function flower(petals: [number, number, number], heart: [number, number, number]): THREE.BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const disc = (radius: number, y: number, r: number, g: number, b: number): void => {
    // A hexagon, fanned out from its first corner.
    const corner = (k: number): number[] => [radius * Math.sin((k * Math.PI) / 3), y, radius * Math.cos((k * Math.PI) / 3)];
    for (let k = 1; k < 5; k++) {
      position.push(...corner(0), ...corner(k), ...corner(k + 1));
      color.push(r, g, b, r, g, b, r, g, b);
    }
  };
  disc(1, 1, ...petals);
  disc(0.38, 1.03, ...heart);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('lean', new THREE.Float32BufferAttribute(new Float32Array((position.length / 3) * 2), 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  return geometry;
}

const box = (r: Rect): THREE.Vector4 => new THREE.Vector4(r.x, r.z, r.length / 2, r.width / 2);
const dir = (r: Rect): THREE.Vector2 => new THREE.Vector2(Math.sin(r.headingDeg * DEG), Math.cos(r.headingDeg * DEG));

/** `light` is what flat ground sends back of its own colour. */
export function buildGrass(spec: GrassSpec, light: THREE.Color): Grass {
  let state = 987654321;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const shared = {
    eye: { value: new THREE.Vector3() },
    time: { value: 0 },
    areaBox: { value: box(spec.area) },
    areaDir: { value: dir(spec.area) },
    mownBox: { value: box(spec.mown) },
    mownDir: { value: dir(spec.mown) },
    target: { value: new THREE.Vector3(spec.target.x, spec.target.z, spec.target.radius) },
    // A shader array cannot be empty.
    bareBox: { value: spec.bare.length ? spec.bare.map(box) : [new THREE.Vector4()] },
    bareDir: { value: spec.bare.length ? spec.bare.map(dir) : [new THREE.Vector2()] },
    rough: { value: new THREE.Color(spec.area.color) },
    mown: { value: new THREE.Color(spec.mown.color) },
    light: { value: light },
  };

  /**
   * `perM2` plants per square metre, seen from up to `reach` metres and made
   * `widen` times wider per metre of distance. `clumps` > 0 gathers them in
   * patches of that many.
   */
  const layer = (shape: THREE.BufferGeometry, perM2: number, size: [number, number], reach: number, widen: number, grassy: number, clumps = 0): THREE.Mesh => {
    const tile = reach * 2;
    const count = Math.round(perM2 * tile * tile);
    const geometry = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'lean', 'color']) geometry.setAttribute(name, shape.getAttribute(name));
    const offset = new Float32Array(count * 2);
    const seed = new Float32Array(count * 4);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      if (clumps === 0 || i % clumps === 0) {
        cx = random() * tile;
        cz = random() * tile;
      }
      const spread = clumps === 0 ? 0 : 0.2 + 1.2 * random();
      offset[i * 2] = cx + (random() - 0.5) * spread;
      offset[i * 2 + 1] = cz + (random() - 0.5) * spread;
      seed.set([random() * Math.PI * 2, random(), random(), random()], i * 4);
    }
    geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offset, 2));
    geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geometry.instanceCount = count;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      defines: { BARE: Math.max(1, spec.bare.length) },
      uniforms: {
        ...shared,
        size: { value: new THREE.Vector2(...size) },
        tile: { value: tile },
        reach: { value: reach },
        widen: { value: widen },
        grassy: { value: grassy },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.userData.reach = reach;
    return mesh;
  };

  const object = new THREE.Group();
  object.add(
    layer(tuft(4), 105, [0.013, 0.2], 20, 0.1, 1),
    layer(flower([0.95, 0.95, 0.9], [0.95, 0.72, 0.1]), 5, [0.016, 0.22], 50, 0.03, 0, 6),
    layer(flower([0.95, 0.78, 0.08], [0.8, 0.55, 0.05]), 0.8, [0.024, 0.26], 60, 0.03, 0, 3),
  );
  return {
    object,
    update(eye, seconds) {
      for (const mesh of object.children) mesh.visible = eye.y < mesh.userData.reach;
      shared.eye.value.copy(eye);
      shared.time.value = seconds;
    },
  };
}
