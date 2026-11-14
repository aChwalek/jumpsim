// A pyrotechnic on the right ankle in place of a smoke canister: a shower of
// sparks, born white hot at the outlet with the jumper's speed and a kick of
// their own, soon slowed to the air's, falling a little, going yellow, orange,
// red and out within a second or so. Each is drawn as a short streak along
// the way it goes, a pixel or two wide whatever the distance, adding light to
// what is behind. The pilot's own also lights what is about it: legs, canopy,
// the ground in the last metres.

import * as THREE from 'three';
import { GEAR_LAYER, OUTSIDE_LAYER, type Lighting } from './scene';
import { SmokeTrail, type SmokeKind } from './smoke';

/** Sparks a second. */
const RATE = 650;
/** Longest a spark lives, s. */
const LIFE = 1.5;
const MAX = Math.ceil(RATE * LIFE);
/** Time for a spark to lose its speed to the air, s. */
const DRAG = 0.3;
/** What is left of gravity on a spark, once the air holds it back, m/s². */
const FALL = 4;
/** How long a streak is, as a time along its way, s: what the eye smears. */
const STREAK = 0.035;
/** The light the pilot's own sparks throw about, candela, and how far it reaches, m. */
const GLARE = 6;
const REACH = 40;

const VERTEX = /* glsl */ `
attribute vec4 spark;
attribute vec4 motion;
uniform float pointScale;
varying float vHeat;
varying float vAlong;
varying float vAcross;
#include <fog_pars_vertex>
void main() {
  vHeat = motion.w;
  vAlong = position.x;
  vAcross = position.y;
  vec4 head = viewMatrix * vec4(spark.xyz, 1.0);
  vec4 tail = viewMatrix * vec4(spark.xyz - motion.xyz * ${STREAK.toFixed(3)}, 1.0);
  // A pixel and a half wide at least, wherever it is.
  float distance = max(-head.z, 0.05);
  // One flying right past the eyes would be a blur too close to see.
  vHeat *= smoothstep(0.25, 0.8, distance);
  float pixel = distance / (projectionMatrix[1][1] * pointScale);
  float width = max(0.006, 1.5 * pixel) * spark.w;
  vec3 along = tail.xyz - head.xyz;
  // At least as long as it is wide, seen end on.
  if (length(along.xy) < width) along = vec3(0.0, width, 0.0);
  vec3 across = normalize(cross(along, head.xyz)) * width;
  vec4 mvPosition = vec4(mix(head.xyz, head.xyz + along, position.x) + across * position.y, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
varying float vHeat;
varying float vAlong;
varying float vAcross;
#include <fog_pars_fragment>
void main() {
  if (vHeat <= 0.0) discard;
  // White hot, then yellow, orange, a dull red.
  vec3 color = mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.45, 0.08), smoothstep(0.0, 0.45, vHeat));
  color = mix(color, vec3(1.0, 0.85, 0.5), smoothstep(0.45, 0.85, vHeat));
  color = mix(color, vec3(1.0, 0.97, 0.9), smoothstep(0.85, 1.0, vHeat));
  // Brightest at the head, fading along the streak and to its edges.
  float shape = (1.0 - vAlong * 0.85) * (1.0 - vAcross * vAcross);
  float through = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      through = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.7);
    #endif
  #endif
  gl_FragColor = vec4(color * (0.4 + 3.6 * vHeat * vHeat) * shape * through, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const bufferSize = new THREE.Vector2();

export class SparkTrail {
  /** World frame: add it to the scene. */
  readonly object: THREE.Mesh;
  /** The light of the pilot's own sparks, out when they are; null on others'. Add it to the scene from the start. */
  readonly light: THREE.PointLight | null;
  private readonly material: THREE.ShaderMaterial;
  /** Per spark: x, y, z, width; and the way it goes, x, y, z, how hot it is. */
  private readonly sparks: THREE.InstancedBufferAttribute;
  private readonly motions: THREE.InstancedBufferAttribute;
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  private readonly life = new Float32Array(MAX).fill(LIFE);
  private next = 0;
  private owed = 0;
  private readonly last = new THREE.Vector3();
  private hasLast = false;
  private alive = 0;
  private flicker = 1;
  /** The ground under the outlet, m: the light stays above it. Set by the owner. */
  floor = -Infinity;

  constructor(withLight = false) {
    const geometry = new THREE.InstancedBufferGeometry();
    // Along the streak 0 to 1, across it -1 to 1.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.sparks = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.motions = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('spark', this.sparks);
    geometry.setAttribute('motion', this.motions);
    geometry.instanceCount = MAX;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { pointScale: { value: 500 } }]);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.object = new THREE.Mesh(geometry, this.material);
    // Sparks are placed in the shader: the quad at the origin says nothing of where they are.
    this.object.frustumCulled = false;
    this.object.renderOrder = 8;
    this.object.visible = false;
    this.object.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(bufferSize);
      this.material.uniforms.pointScale!.value = bufferSize.y / 2;
    };
    if (withLight) {
      // Always in the scene, out when not burning: a light coming or going would rebuild every shader.
      this.light = new THREE.PointLight(0xffa64a, 0, REACH, 2);
      this.light.layers.enable(GEAR_LAYER);
      this.light.layers.enable(OUTSIDE_LAYER);
    } else this.light = null;
  }

  /** No colours to sparks: the same call as the smoke's. */
  setColor(): void {}

  /** No sparks left in the air. */
  clear(): void {
    this.age.fill(LIFE);
    this.owed = 0;
    this.hasLast = false;
    this.alive = 0;
    this.object.visible = false;
    if (this.light) this.light.intensity = 0;
  }

  /**
   * Moves the sparks on by `dt`, s. `from`: where the outlet is, world frame,
   * or null when it is not burning; `vel` its speed, `wind` the air's.
   */
  update(dt: number, from: THREE.Vector3 | null, vel: THREE.Vector3, wind: THREE.Vector3): void {
    if (!from) this.hasLast = false;
    if (this.light && !from) this.light.intensity = 0;
    if (dt <= 0 || (this.alive === 0 && !from)) return;
    const p = this.sparks.array as Float32Array;
    const m = this.motions.array as Float32Array;
    const v = this.vel;
    const keep = Math.exp(-dt / DRAG);
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      const age = (this.age[i]! += dt);
      if (age >= this.life[i]!) {
        m[4 * i + 3] = 0;
        continue;
      }
      alive++;
      v[3 * i] = wind.x + (v[3 * i]! - wind.x) * keep;
      v[3 * i + 1] = wind.y + (v[3 * i + 1]! - wind.y) * keep - FALL * dt;
      v[3 * i + 2] = wind.z + (v[3 * i + 2]! - wind.z) * keep;
      for (let k = 0; k < 3; k++) p[4 * i + k]! += v[3 * i + k]! * dt;
      this.shape(i);
    }

    if (from) {
      this.owed += RATE * dt;
      const n = Math.floor(this.owed);
      this.owed -= n;
      if (!this.hasLast) this.last.copy(from);
      for (let j = 1; j <= n; j++) {
        const i = this.next;
        this.next = (this.next + 1) % MAX;
        const t = j / n;
        const age = (1 - t) * dt;
        // Out of the outlet, downwards mostly, every which way some.
        const speed = 3 + 7 * Math.random();
        const a = Math.random() * Math.PI * 2;
        const spread = 0.35 + 0.65 * Math.random() ** 2;
        const dx = Math.cos(a) * spread;
        const dz = Math.sin(a) * spread;
        const dy = -Math.sqrt(Math.max(0, 1 - spread * spread)) * (Math.random() < 0.85 ? 1 : -1);
        v[3 * i] = vel.x + dx * speed;
        v[3 * i + 1] = vel.y + dy * speed;
        v[3 * i + 2] = vel.z + dz * speed;
        p[4 * i] = this.last.x + (from.x - this.last.x) * t + v[3 * i]! * age;
        p[4 * i + 1] = this.last.y + (from.y - this.last.y) * t + v[3 * i + 1]! * age;
        p[4 * i + 2] = this.last.z + (from.z - this.last.z) * t + v[3 * i + 2]! * age;
        // Most short-lived, a few big ones that go on glowing.
        const big = Math.random() < 0.12;
        p[4 * i + 3] = big ? 1.8 : 0.7 + 0.5 * Math.random();
        this.life[i] = big ? 0.9 + 0.6 * Math.random() : 0.25 + 0.5 * Math.random();
        if (this.age[i]! >= LIFE) alive++;
        this.age[i] = age;
        this.shape(i);
      }
      this.last.copy(from);
      this.hasLast = true;
      if (this.light) {
        // A flame that never burns steady.
        this.flicker += (0.65 + 0.7 * Math.random() - this.flicker) * Math.min(1, dt * 25);
        this.light.intensity = GLARE * this.flicker;
        // From the middle of the shower, below the outlet, not from the outlet against the shoe.
        this.light.position.set(from.x, Math.max(from.y - 0.4, this.floor + 0.3), from.z);
      }
    }
    this.alive = alive;
    this.object.visible = alive > 0;
    this.sparks.needsUpdate = true;
    this.motions.needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    this.light?.dispose();
  }

  /** How spark `i` looks at its age: the way it goes, for the streak, and how hot it still is. */
  private shape(i: number): void {
    const m = this.motions.array as Float32Array;
    const v = this.vel;
    m[4 * i] = v[3 * i]!;
    m[4 * i + 1] = v[3 * i + 1]!;
    m[4 * i + 2] = v[3 * i + 2]!;
    const left = 1 - this.age[i]! / this.life[i]!;
    // Hot at first, cooling fast, with a twinkle.
    m[4 * i + 3] = Math.max(0.001, left ** 1.3 * (0.85 + 0.15 * Math.random()));
  }
}

/** What comes out of the canister on the ankle: smoke of a colour, or sparks. */
export type Trail = SmokeTrail | SparkTrail;

/** A trail for a canister that makes one; another trail if the one held is of the wrong sort, else that one, recoloured. */
export function fitTrail(kind: Exclude<SmokeKind, 'none'>, light: Lighting, held: Trail | null): Trail {
  if (kind === 'sparks') return held instanceof SparkTrail ? held : new SparkTrail();
  if (held instanceof SmokeTrail) {
    held.setColor(kind);
    return held;
  }
  return new SmokeTrail(kind, light);
}
