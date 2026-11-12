// A smoke canister on the right ankle, and the trail it leaves: puffs born at
// the canister with the jumper's speed, soon slowed to the wind's, swelling
// and thinning out as they drift. Drawn in the world frame, one quad per
// puff turned to the camera.

import * as THREE from 'three';
import type { Lighting } from './scene';

export const SMOKE_COLORS = {
  red: 0xe5332a,
  orange: 0xff7417,
  yellow: 0xf6d21c,
  green: 0x35c25a,
  blue: 0x2f7fe6,
  purple: 0x9b4fd6,
} as const;
export type SmokeColor = keyof typeof SMOKE_COLORS;
/** No canister, or one of a colour. */
export type SmokeKind = 'none' | SmokeColor;
export const SMOKE_KINDS: readonly SmokeKind[] = ['none', ...(Object.keys(SMOKE_COLORS) as SmokeColor[])];
export const isSmoke = (v: unknown): v is SmokeKind => SMOKE_KINDS.includes(v as SmokeKind);

/** How long a canister burns once lit, s. */
export const SMOKE_BURN = 90;
/** Puffs a second, enough to keep the trail whole at freefall speed. */
const RATE = 80;
/** How long a puff is seen, s. */
const LIFE = 7;
const MAX = Math.ceil(RATE * LIFE * 1.1);
/** Time for a puff to lose its speed to the air, s. */
const DRAG = 0.15;
/** Spread of the drift each puff keeps, m/s. */
const DRIFT = 0.6;

const VERTEX = /* glsl */ `
attribute vec4 puff;
attribute vec2 look;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy * 2.0;
  vAlpha = look.x;
  vSeed = look.y;
  vec4 mvPosition = viewMatrix * vec4(puff.xyz, 1.0);
  float a = look.y * 6.2832;
  mvPosition.xy += mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy * puff.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform vec3 light;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // A lumpy edge, different on every puff.
  float angle = atan(vUv.y, vUv.x);
  float edge = 0.82 + 0.18 * sin(angle * 3.0 + vSeed * 40.0) * sin(angle * 5.0 - vSeed * 23.0);
  float alpha = (1.0 - smoothstep(edge * 0.25, edge, r)) * vAlpha;
  if (alpha < 0.004) discard;
  // Lit from above a little more than from below.
  gl_FragColor = vec4(color * light * (0.78 + 0.22 * (vUv.y * 0.5 + 0.5)), alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class SmokeTrail {
  /** World frame: add it to the scene. */
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly puffs: THREE.InstancedBufferAttribute;
  private readonly looks: THREE.InstancedBufferAttribute;
  private readonly vel = new Float32Array(MAX * 3);
  private readonly drift = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  /** Next puff to be reused, the oldest. */
  private next = 0;
  /** Puffs owed from earlier frames. */
  private owed = 0;
  private readonly last = new THREE.Vector3();
  private hasLast = false;
  private alive = 0;

  constructor(color: SmokeColor, light: Lighting) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.puffs = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.looks = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) this.looks.setY(i, Math.random());
    geometry.setAttribute('puff', this.puffs);
    geometry.setAttribute('look', this.looks);
    geometry.instanceCount = MAX;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { color: { value: new THREE.Color() } }]);
    // Shared with the light, not copied: it follows the hour.
    uniforms.light = { value: light.fabric };
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.setColor(color);
    this.object = new THREE.Mesh(geometry, this.material);
    // Puffs are placed in the shader: the quad at the origin says nothing of where they are.
    this.object.frustumCulled = false;
    this.object.renderOrder = 8;
    this.object.visible = false;
  }

  setColor(color: SmokeColor): void {
    (this.material.uniforms.color!.value as THREE.Color).setHex(SMOKE_COLORS[color]);
  }

  /** No smoke left in the air. */
  clear(): void {
    this.age.fill(LIFE);
    this.owed = 0;
    this.hasLast = false;
    this.alive = 0;
    this.object.visible = false;
  }

  /**
   * Moves the smoke on by `dt`, s. `from`: where the canister is, world
   * frame, or null when it is not burning; `vel` its speed, `wind` the air's.
   */
  update(dt: number, from: THREE.Vector3 | null, vel: THREE.Vector3, wind: THREE.Vector3): void {
    if (!from) this.hasLast = false;
    if (dt <= 0 || (this.alive === 0 && !from)) return;
    const p = this.puffs.array as Float32Array;
    const l = this.looks.array as Float32Array;
    const v = this.vel;
    const keep = Math.exp(-dt / DRAG);
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      const age = (this.age[i]! += dt);
      if (age >= LIFE) {
        p[4 * i + 3] = 0;
        l[2 * i] = 0;
        continue;
      }
      alive++;
      for (let k = 0; k < 3; k++) {
        const air = (k === 0 ? wind.x : k === 1 ? wind.y : wind.z) + this.drift[3 * i + k]!;
        v[3 * i + k] = air + (v[3 * i + k]! - air) * keep;
        p[4 * i + k]! += v[3 * i + k]! * dt;
      }
      this.shape(i, age);
    }

    if (from) {
      // Spread along the way the canister went this frame, so the trail has no gaps.
      this.owed += RATE * dt;
      const n = Math.floor(this.owed);
      this.owed -= n;
      if (!this.hasLast) this.last.copy(from);
      for (let j = 1; j <= n; j++) {
        const i = this.next;
        this.next = (this.next + 1) % MAX;
        const t = j / n;
        // Born earlier in the frame: older, and already on its way.
        const age = (1 - t) * dt;
        p[4 * i] = this.last.x + (from.x - this.last.x) * t;
        p[4 * i + 1] = this.last.y + (from.y - this.last.y) * t;
        p[4 * i + 2] = this.last.z + (from.z - this.last.z) * t;
        v[3 * i] = vel.x;
        v[3 * i + 1] = vel.y;
        v[3 * i + 2] = vel.z;
        this.drift[3 * i] = (Math.random() * 2 - 1) * DRIFT;
        this.drift[3 * i + 1] = (Math.random() * 2 - 1) * DRIFT * 0.6;
        this.drift[3 * i + 2] = (Math.random() * 2 - 1) * DRIFT;
        if (this.age[i]! >= LIFE) alive++;
        this.age[i] = age;
        this.shape(i, age);
      }
      this.last.copy(from);
      this.hasLast = true;
    }
    this.alive = alive;
    this.object.visible = alive > 0;
    this.puffs.needsUpdate = true;
    this.looks.needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }

  /** Size and opacity of puff `i` at its age: small and thick at the canister, wide and thin later. */
  private shape(i: number, age: number): void {
    const p = this.puffs.array as Float32Array;
    const l = this.looks.array as Float32Array;
    p[4 * i + 3] = 0.35 + 3.2 * (1 - Math.exp(-age / 1.2)) + 0.3 * age;
    const fadeIn = Math.min(1, age / 0.08);
    const fadeOut = Math.pow(1 - age / LIFE, 1.6);
    l[2 * i] = 0.6 * fadeIn * fadeOut;
  }
}
