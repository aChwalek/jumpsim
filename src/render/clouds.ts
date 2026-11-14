// Fair-weather cumulus: flat grey bases at 1500 m, rounded white tops up to
// 900 m higher, a third of the sky covered. They drift with the wind up
// there, and their shadows go over the ground, the trees and the pilot.
//
// The field is a height map that repeats every 24 km: for each point, how
// high the cloud above it reaches. A pass drawn over the scene marches each
// line of sight through the layer, from below, from inside when falling
// through it, or from above out of the plane; anything lit by the sun looks
// up along the sun to see whether a cloud is in the way.

import * as THREE from 'three';
import { handheld } from '../viewport';

/** Cloud base above the landing area, m. */
export const CLOUD_BASE = 1500;
/** Tallest cloud, base to top, m. */
export const CLOUD_DEPTH = 900;
/** The field repeats every this many metres. */
const TILE = 24000;
const SIZE = 1024;
/** Fraction of the ground under a cloud. */
const COVERAGE = 0.3;
/** How much of the sun a cloud holds back. */
const OPACITY = 0.88;

/** Detail noise is drawn this many times smaller than the field. */
const DETAIL = 7;

export const CLOUD_GLSL = /* glsl */ `
#define CLOUD_BASE ${CLOUD_BASE.toFixed(1)}
#define CLOUD_DEPTH ${CLOUD_DEPTH.toFixed(1)}
#define CLOUD_TILE ${TILE.toFixed(1)}
#define CLOUD_TEXEL ${(TILE / SIZE).toFixed(3)}
#define CLOUD_DETAIL ${DETAIL.toFixed(1)}
uniform sampler2D cloudMap;
uniform vec2 cloudOffset;
uniform float cloudCover;
uniform vec3 cloudSunDir;
float cloudColumn(vec2 xz) {
  return texture(cloudMap, (xz + cloudOffset) / CLOUD_TILE).r;
}
/**
 * Share of the sunlight that reaches a point, 1 in the open: looks up along
 * the sun at three heights of the layer, those above the point.
 */
float cloudSunThrough(vec3 p) {
  if (cloudCover <= 0.0 || cloudSunDir.y < 0.02) return 1.0;
  vec2 slope = cloudSunDir.xz / cloudSunDir.y;
  float cover = 0.0;
  for (int k = 0; k < 3; k++) {
    float level = 0.3 * float(k);
    float y = CLOUD_BASE + level * CLOUD_DEPTH;
    // Sampled whatever the height, so that the texture sees smooth derivatives.
    float shade = smoothstep(level, level + 0.2, cloudColumn(p.xz + slope * (y - p.y)));
    cover = max(cover, shade * step(p.y, y));
  }
  return 1.0 - cloudCover * cover;
}
`;

/** Nearest the eye the clouds are drawn, m: not over the jumper's own body. */
const NEAR = 2.5;
/** Farthest, m: beyond that the haze has them. */
const FAR = 40000;
/** Samples along each line of sight: half on a phone, whose graphics chip cannot march 64 per pixel. */
const PHONE = handheld();
const STEPS = PHONE ? 32 : 64;
const ACROSS = PHONE ? '12.0' : '24.0';

const LAYER_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const LAYER_FRAGMENT = /* glsl */ `
${CLOUD_GLSL}
uniform mat4 cloudInvProj;
uniform mat4 cloudCamWorld;
uniform mat4 cloudViewProj;
uniform vec3 cloudEye;
uniform vec3 cloudSun;
uniform vec3 cloudShade;
uniform vec3 cloudHaze;
uniform float cloudFog;
varying vec2 vNdc;

/** Cloud density at a point, 0..1: under the top of the column, with cauliflower bumps. */
float cloudDensity(vec3 p, float lod) {
  float h = (p.y - CLOUD_BASE) / CLOUD_DEPTH;
  vec2 uv = (p.xz + cloudOffset) / CLOUD_TILE;
  float column = textureLod(cloudMap, uv, lod).r;
  if (column < 0.004 || h > column * 1.25) return 0.0;
  // Bumps that change with the height, so that the sides billow instead
  // of standing straight up.
  vec2 drift = vec2(0.31, 0.17) * h;
  float detail = textureLod(cloudMap, uv * CLOUD_DETAIL + drift, lod + 2.8).g;
  float fine = textureLod(cloudMap, uv * CLOUD_DETAIL * 3.7 - drift, lod + 4.7).g;
  float bumps = 0.7 * detail + 0.3 * fine;
  float top = column * (0.6 + 0.75 * bumps);
  float side = smoothstep(0.0, 0.08, column - 0.16 * (1.0 - bumps));
  return smoothstep(0.0, 0.08, top - h) * side * smoothstep(0.0, 0.02, h);
}

void main() {
  if (cloudCover <= 0.0) discard;
  vec4 view = cloudInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((cloudCamWorld * vec4(view.xyz / view.w, 0.0)).xyz);
  vec3 eye = cloudEye;
  // Where the line of sight is in the layer.
  float t0 = ${NEAR.toFixed(1)};
  float t1 = ${FAR.toFixed(1)};
  if (abs(dir.y) > 1e-5) {
    float a = (CLOUD_BASE - eye.y) / dir.y;
    float b = (CLOUD_BASE + CLOUD_DEPTH - eye.y) / dir.y;
    t0 = max(t0, min(a, b));
    t1 = min(t1, max(a, b));
  } else if (eye.y < CLOUD_BASE || eye.y > CLOUD_BASE + CLOUD_DEPTH) {
    discard;
  }
  if (t0 >= t1) discard;

  float mu = dot(dir, cloudSunDir);
  // Bright towards the sun, where the light comes through the edges.
  float phase = 0.75 + 1.4 * pow(max(mu, 0.0), 8.0);
  // Where each line of sight takes its samples, at random: grain rather than bands.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  // Short steps near the eye, longer far away, and enough across the layer.
  float most = (t1 - t0) / ${ACROSS};
  float t = t0;
  float dt = min(max(15.0, 0.08 * t), most);
  t += dt * jitter;
  float through = 1.0;
  vec3 color = vec3(0.0);
  float hit = -1.0;
  for (int i = 0; i < ${STEPS}; i++) {
    if (t > t1 || through < 0.02) break;
    dt = min(max(15.0, 0.08 * t), most);
    vec3 p = eye + dir * t;
    float lod = log2(max(1.0, max(t * 0.0013, dt * 0.5) / CLOUD_TEXEL));
    float d = cloudDensity(p, lod);
    if (d > 0.01) {
      if (hit < 0.0) hit = t;
      float h = (p.y - CLOUD_BASE) / CLOUD_DEPTH;
      float toSun = cloudDensity(p + cloudSunDir * 60.0, lod) * 60.0 + cloudDensity(p + cloudSunDir * 220.0, lod + 1.0) * 160.0;
      float sunlit = exp(-toSun * 0.018);
      vec3 c = cloudShade * (0.5 + 0.5 * h) + cloudSun * sunlit * phase;
      float fog = 1.0 - exp(-pow(t * cloudFog, 2.0));
      c = mix(c, cloudHaze, fog);
      float a = 1.0 - exp(-d * dt * 0.018);
      color += through * a * c;
      through *= 1.0 - a;
    }
    t += dt;
  }
  float alpha = 1.0 - through;
  if (alpha < 0.004) discard;
  // In front of what is behind the cloud, behind what is in front of it.
  vec4 clip = cloudViewProj * vec4(eye + dir * hit, 1.0);
  gl_FragDepth = clamp(0.5 * clip.z / clip.w + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(color / alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Colours the clouds are lit with, kept up to date by the owner. */
export interface CloudLight {
  /** Sunlight on a cloud. */
  sun: THREE.Color;
  /** Skylight on a cloud, in its own shade. */
  shade: THREE.Color;
  /** The haze far clouds fade into. */
  haze: THREE.Color;
  /** Density of that haze for the clouds, per metre. */
  fog: { value: number };
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Height of the cloud tops, as a fraction of CLOUD_DEPTH, on a SIZE × SIZE
 * grid over the tile. Each cloud is a heap of rounded puffs, the middle ones
 * tallest; big clouds grow taller than small ones.
 */
function cloudTops(random: () => number): Float32Array {
  const tops = new Float32Array(SIZE * SIZE);
  const texel = TILE / SIZE;
  let covered = 0;
  const placed: { x: number; z: number; r: number }[] = [];
  /** Shortest distance on the repeating tile. */
  const wrap = (d: number): number => d - TILE * Math.round(d / TILE);
  const puff = (x: number, z: number, r: number, h: number): void => {
    const reach = Math.ceil(r / texel);
    const ci = Math.round(x / texel);
    const cj = Math.round(z / texel);
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        const d = Math.hypot(i * texel - x, j * texel - z) / r;
        if (d >= 1) continue;
        // Steep sides and a rounded top.
        const v = h * (1 - d * d) ** 0.4;
        const k = (((j % SIZE) + SIZE) % SIZE) * SIZE + (((i % SIZE) + SIZE) % SIZE);
        if (v > tops[k]!) {
          if (tops[k] === 0) covered++;
          tops[k] = v;
        }
      }
    }
  };
  for (let attempt = 0; attempt < 5000 && covered < COVERAGE * SIZE * SIZE; attempt++) {
    const x = random() * TILE;
    const z = random() * TILE;
    // Many small clouds, a few big ones, 0.7 to 2.8 km across.
    const size = random() ** 1.6;
    const r = 350 + 1050 * size;
    // Clouds keep apart: each grows where the air rises, and sinks around it.
    if (placed.some((c) => Math.hypot(wrap(c.x - x), wrap(c.z - z)) < 0.95 * (c.r + r))) continue;
    placed.push({ x, z, r });
    // Small ones flat, big ones towering: wider than tall all the same.
    const height = (0.18 + 0.82 * size ** 1.2) * (0.75 + 0.25 * random());
    puff(x, z, 0.5 * r, height);
    const puffs = 6 + Math.floor(r / 110);
    for (let p = 0; p < puffs; p++) {
      const angle = random() * Math.PI * 2;
      const out = 0.7 * r * Math.sqrt(random());
      puff(
        x + Math.cos(angle) * out,
        z + Math.sin(angle) * out,
        r * (0.18 + 0.22 * random()),
        height * (0.45 + 0.45 * random()) * (1 - (0.5 * out) / r),
      );
    }
  }
  return tops;
}

/** Value noise that repeats over the grid, a few octaves, 0..1. */
function tilingNoise(random: () => number): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let total = 0;
  for (const [cells, weight] of [
    [16, 0.5],
    [32, 0.25],
    [64, 0.15],
    [128, 0.1],
  ] as const) {
    const lattice = Float32Array.from({ length: cells * cells }, random);
    const at = (i: number, j: number): number => lattice[(j % cells) * cells + (i % cells)]!;
    for (let y = 0; y < SIZE; y++) {
      const fy = (y * cells) / SIZE;
      const j = Math.floor(fy);
      const ty = fy - j;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < SIZE; x++) {
        const fx = (x * cells) / SIZE;
        const i = Math.floor(fx);
        const tx = fx - i;
        const sx = tx * tx * (3 - 2 * tx);
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
        out[y * SIZE + x]! += (a + (b - a) * sy) * weight;
      }
    }
    total += weight;
  }
  for (let k = 0; k < out.length; k++) out[k] = out[k]! / total;
  return out;
}

/** The cumulus over the drop zone, and what they do to the sunlight. */
export class Clouds {
  /** Shared by the sky and by every material the clouds shade. */
  readonly uniforms: {
    cloudMap: { value: THREE.Texture };
    cloudOffset: { value: THREE.Vector2 };
    cloudCover: { value: number };
    cloudSunDir: { value: THREE.Vector3 };
  };
  /** Draws the clouds over the scene: add it to the scene. */
  readonly layer: THREE.Mesh;
  /** Cloud top heights, 0..255, as the graphics card has them. */
  private tops: Uint8Array | null = null;

  /** `sun` points towards the sun; it and `light` are kept up to date by the owner. */
  constructor(sun: THREE.Vector3, light: CloudLight) {
    const empty = new THREE.DataTexture(new Uint8Array([0, 0]), 1, 1, THREE.RGFormat);
    empty.needsUpdate = true;
    this.uniforms = {
      cloudMap: { value: empty },
      cloudOffset: { value: new THREE.Vector2() },
      cloudCover: { value: 0 },
      cloudSunDir: { value: sun },
    };
    const view = {
      cloudInvProj: { value: new THREE.Matrix4() },
      cloudCamWorld: { value: new THREE.Matrix4() },
      cloudViewProj: { value: new THREE.Matrix4() },
      cloudEye: { value: new THREE.Vector3() },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: LAYER_VERTEX,
      fragmentShader: LAYER_FRAGMENT,
      uniforms: {
        ...this.uniforms,
        ...view,
        cloudSun: { value: light.sun },
        cloudShade: { value: light.shade },
        cloudHaze: { value: light.haze },
        cloudFog: light.fog,
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.layer = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.layer.frustumCulled = false;
    // After the ground, the trees and their shadows.
    this.layer.renderOrder = 50;
    this.layer.visible = false;
    // The line of sight comes from whichever camera draws it.
    this.layer.onBeforeRender = (_renderer, _scene, camera) => {
      view.cloudInvProj.value.copy(camera.projectionMatrixInverse);
      view.cloudCamWorld.value.copy(camera.matrixWorld);
      view.cloudViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      view.cloudEye.value.setFromMatrixPosition(camera.matrixWorld);
    };
  }

  /** Whether there are any clouds. */
  get on(): boolean {
    return this.uniforms.cloudCover.value > 0;
  }

  /** Brings the clouds out or clears the sky. They are made the first time. */
  show(on: boolean): void {
    if (on && !this.tops) this.make();
    this.uniforms.cloudCover.value = on ? OPACITY : 0;
    this.layer.visible = on;
  }

  private make(): void {
    const random = mulberry32(1729);
    const tops = cloudTops(random);
    const detail = tilingNoise(random);
    const data = new Uint8Array(SIZE * SIZE * 2);
    this.tops = new Uint8Array(SIZE * SIZE);
    for (let k = 0; k < tops.length; k++) {
      const top = Math.round(Math.min(1, tops[k]!) * 255);
      this.tops[k] = top;
      data[k * 2] = top;
      data[k * 2 + 1] = Math.round(detail[k]! * 255);
    }
    const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGFormat);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    this.uniforms.cloudMap.value.dispose();
    this.uniforms.cloudMap.value = map;
  }

  /** Moves the clouds with the wind up there (m/s, world frame) for a while. */
  drift(windX: number, windZ: number, seconds: number): void {
    const offset = this.uniforms.cloudOffset.value;
    // A point of the field shows at its position less the offset.
    offset.x = (offset.x - windX * seconds) % TILE;
    offset.y = (offset.y - windZ * seconds) % TILE;
  }

  /** Height of the cloud top above a point, as a fraction of CLOUD_DEPTH: 0 for clear sky. */
  column(x: number, z: number): number {
    const tops = this.tops;
    if (!tops) return 0;
    const offset = this.uniforms.cloudOffset.value;
    // As the graphics card filters it: between the four nearest texel centres.
    const u = ((x + offset.x) / TILE) * SIZE - 0.5;
    const v = ((z + offset.y) / TILE) * SIZE - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const at = (a: number, b: number): number =>
      tops[(((b % SIZE) + SIZE) % SIZE) * SIZE + (((a % SIZE) + SIZE) % SIZE)]! / 255;
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
    return top + (bottom - top) * fv;
  }

  /** Share of the sunlight reaching a point, 1 in the open: as CLOUD_GLSL works it out. */
  sunThrough(x: number, y: number, z: number): number {
    const cover = this.uniforms.cloudCover.value;
    const sun = this.uniforms.cloudSunDir.value;
    if (cover <= 0 || sun.y < 0.02) return 1;
    let shade = 0;
    for (let k = 0; k < 3; k++) {
      const level = 0.3 * k;
      const up = CLOUD_BASE + level * CLOUD_DEPTH - y;
      if (up <= 0) continue;
      const column = this.column(x + (sun.x / sun.y) * up, z + (sun.z / sun.y) * up);
      shade = Math.max(shade, smoothstep(level, level + 0.2, column));
    }
    return 1 - cover * shade;
  }

  /**
   * Makes a material feel the cloud shadows: a lit material loses the sun
   * under a cloud ('light'), a cast shadow fades out ('shadow').
   */
  shade(material: THREE.Material, how: 'light' | 'shadow'): void {
    const before = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCloudWorld;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 cloudWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cloudWorld = instanceMatrix * cloudWorld;
          #endif
          vCloudWorld = (modelMatrix * cloudWorld).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vCloudWorld;\n${CLOUD_GLSL}`,
      );
      shader.fragmentShader =
        how === 'light'
          ? shader.fragmentShader.replace(
              '#include <lights_fragment_begin>',
              THREE.ShaderChunk.lights_fragment_begin.replace(
                'getDirectionalLightInfo( directionalLight, directLight );',
                '$&\n\t\tdirectLight.color *= cloudSunThrough(vCloudWorld);',
              ),
            )
          : shader.fragmentShader.replace(
              '#include <color_fragment>',
              '#include <color_fragment>\ndiffuseColor.a *= cloudSunThrough(vCloudWorld);',
            );
    };
    material.customProgramCacheKey = () => `${key}|clouds-${how}`;
    material.needsUpdate = true;
  }
}
