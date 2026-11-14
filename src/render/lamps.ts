// Lights seen in the dark that light nothing up: windows and lamps in the
// villages, floodlights on the hangars, lamps round the target, glow sticks
// on the jumpers. Each is a point drawn as a soft spot of light, never
// smaller than a couple of pixels, so that a village shows from 4000 m as it
// does on a real night. They add to what is behind them, and the haze dims
// the far ones.

import * as THREE from 'three';
import type { DzPack } from '../world/dz';

const VERTEX = /* glsl */ `
attribute vec3 color;
attribute float size;
uniform float pointScale;
uniform float minPixels;
uniform float maxPixels;
uniform float nearFade;
varying vec3 vColor;
varying float vDim;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distance = max(-mvPosition.z, 0.01);
  // Its size on screen, in pixels, where the lens puts it.
  float pixels = size * projectionMatrix[1][1] * pointScale / distance;
  float drawn = clamp(pixels, minPixels, maxPixels);
  gl_PointSize = drawn;
  // Smaller than the smallest spot drawn: as much light, spread wider, so dimmer;
  // but not so dim that a lamp far off is lost.
  vDim = clamp(pixels / drawn, 0.3, 1.0);
  // Right by the eyes, the glow round it would fill the view: the thing itself shows.
  vDim *= smoothstep(nearFade * 0.4, nearFade, distance);
  vColor = color;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform float strength;
varying vec3 vColor;
varying float vDim;
#include <fog_pars_fragment>
void main() {
  vec2 at = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(at, at);
  if (r2 > 1.0) discard;
  // A bright core in a soft glow, not so bright that the colour washes out to white.
  float light = exp(-r2 * 9.0) + exp(-r2 * 2.5) * 0.22;
  float through = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      through = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.7);
    #endif
  #endif
  gl_FragColor = vec4(vColor * light * strength * vDim * through, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface GlowOptions {
  /** How bright, shared: 0 puts every point out. */
  strength: { value: number };
  /** Never drawn smaller than this, nor larger, pixels. */
  minPixels?: number;
  maxPixels?: number;
  /** Nearer than this, m, the glow fades and only the thing itself is seen. */
  nearFade?: number;
}

/** The material that draws points as spots of light; `color` and `size` (m across the glow) per point. */
export function glowMaterial(options: GlowOptions): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      pointScale: { value: 500 },
      minPixels: { value: options.minPixels ?? 2.5 },
      maxPixels: { value: options.maxPixels ?? 64 },
      nearFade: { value: options.nearFade ?? 0 },
    },
  ]);
  uniforms.strength = options.strength;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

const bufferSize = new THREE.Vector2();

/** Points drawn with a glow material: they learn the picture's height just before each draw. */
export function glowPoints(geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial): THREE.Points {
  const points = new THREE.Points(geometry, material);
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(bufferSize);
    material.uniforms.pointScale!.value = bufferSize.y / 2;
  };
  points.renderOrder = 9;
  return points;
}

/** Points of the given positions, colours (linear, may be over 1) and sizes. */
export function pointsGeometry(positions: number[], colors: number[], sizes: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  return geometry;
}

/** Kinds of lamp, their colour (linear, bright) and size of their glow, m. */
const LAMP = {
  /** A lit window, warm. */
  window: { color: [1.1, 0.55, 0.2], size: 0.9 },
  /** The light over a door, a little whiter. */
  porch: { color: [1.2, 0.8, 0.45], size: 0.8 },
  /** A sodium street lamp. */
  street: { color: [1.4, 0.62, 0.16], size: 1.6 },
  /** A floodlight on a hangar, cold white. */
  flood: { color: [1.6, 1.6, 1.75], size: 3 },
  /** The lamps on the ground round the target. */
  target: { color: [1.7, 1.45, 0.9], size: 0.9 },
} as const;

/** A random number from a seed, the same every time. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The drop zone's lamps, lit at dusk: in the buildings, over the hangar
 * doors, round the target and on the windsock. Out by day (`strength` 0).
 */
export function buildLamps(dz: DzPack, strength: { value: number }): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const add = (x: number, y: number, z: number, kind: keyof typeof LAMP, scale = 1): void => {
    positions.push(x, y, z);
    const { color, size } = LAMP[kind];
    colors.push(color[0] * scale, color[1] * scale, color[2] * scale);
    sizes.push(size);
  };
  dz.buildings.forEach((b, i) => {
    const h = (k: number): number => hash(i * 13.7 + k);
    const ground = dz.groundAt(b.x, b.z);
    const heading = (b.headingDeg * Math.PI) / 180;
    // Along the building and across it, in the world's axes (x east, z south).
    const ax = Math.sin(heading);
    const az = -Math.cos(heading);
    /** A point on a wall: `side` 0 to 3 round the building, `along` -1 to 1 along that wall. */
    const onWall = (side: number, along: number, up: number, kind: keyof typeof LAMP, scale = 1): void => {
      const long = side % 2 === 0;
      const sign = side < 2 ? 1 : -1;
      const out = (long ? b.width : b.length) / 2 + 0.15;
      const run = ((long ? b.length : b.width) / 2) * along * 0.8;
      // Out from the wall, then along it.
      const ox = long ? -az * out * sign + ax * run : ax * out * sign - az * run;
      const oz = long ? ax * out * sign + az * run : az * out * sign + ax * run;
      add(b.x + ox, ground + up, b.z + oz, kind, scale);
    };
    const big = b.hangar ?? b.height > 6;
    if (b.floors) {
      // A tower: lit windows here and there on every floor.
      for (let f = 1; f * b.floors < b.height; f++) {
        for (let side = 0; side < 4; side++) if (h(f * 4 + side) < 0.35) onWall(side, h(f * 7 + side) * 2 - 1, f * b.floors - 1.2, 'window');
      }
    } else if (big) {
      // Floodlights high on the long sides, which one has the door is not known.
      for (const side of [0, 2]) {
        onWall(side, -0.4, b.height - 1, 'flood');
        onWall(side, 0.4, b.height - 1, 'flood');
      }
      onWall(1, 0, 3, 'porch');
    } else {
      // A house: most have a window or two lit, some a lamp over the door.
      if (h(2) < 0.7) onWall(Math.floor(h(3) * 4), h(4) * 2 - 1, 1.5, 'window', 0.7 + 0.6 * h(5));
      if (h(6) < 0.35) onWall(Math.floor(h(7) * 4), h(8) * 2 - 1, 1.5, 'window', 0.7 + 0.6 * h(9));
      if (h(10) < 0.25) onWall(Math.floor(h(11) * 4), 0, 2.3, 'porch');
      // And a street lamp in front of one house in three.
      if (h(12) < 0.33) onWall(Math.floor(h(13) * 4), 0, 6, 'street');
    }
  });
  // Lamps round the target, on the ground, as a night landing area has them.
  const { target } = dz;
  const ring = Math.max(target.radius + 3, 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = target.x + Math.cos(a) * ring;
    const z = target.z + Math.sin(a) * ring;
    add(x, dz.groundAt(x, z) + 0.2, z, 'target');
  }
  // A lamp at the top of the windsock's mast.
  const sock = dz.windsock;
  add(sock.x, dz.groundAt(sock.x, sock.z) + sock.height + 0.4, sock.z, 'flood', 0.6);
  return glowPoints(pointsGeometry(positions, colors, sizes), glowMaterial({ strength }));
}
