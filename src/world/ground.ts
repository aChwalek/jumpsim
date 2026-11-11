// Ground surfaces. Everything flat shares one trick: the colour is modulated
// by textures sampled in world space. Two scales of soft noise break up the
// big surfaces seen from high up. The grain is what tells height in the last
// metres: sharp marks a few centimetres across, which blur into a plain
// colour with distance, so how far up the picture they can be made out
// depends on how low the eye is.

import * as THREE from 'three';
import type { Rect } from './dz';

const DEG = Math.PI / 180;

function makeNoiseTexture(): THREE.Texture {
  const size = 256;
  const coarseSize = 32;
  const coarse = new Float32Array(coarseSize * coarseSize);
  for (let i = 0; i < coarse.length; i++) coarse[i] = Math.random();
  const at = (x: number, y: number): number => coarse[(y % coarseSize) * coarseSize + (x % coarseSize)]!;

  const data = new Uint8Array(size * size * 4);
  const step = size / coarseSize;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x / step;
      const cy = y / step;
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const fx = cx - x0;
      const fy = cy - y0;
      const smooth =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
        (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const v = 0.5 + (Math.random() - 0.5) * 0.6 + (smooth - 0.5) * 0.7;
      const byte = Math.max(0, Math.min(255, Math.round(v * 255)));
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = byte;
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

/** Metres of ground one repeat of the grain covers: half a centimetre a texel. */
const GRAIN_TILE = 2.56;

type Mark = (context: CanvasRenderingContext2D, x: number, y: number) => void;

function blade(): Mark {
  const angle = Math.random() * Math.PI;
  const half = 3 + Math.random() * 8;
  const dx = Math.cos(angle) * half;
  const dy = Math.sin(angle) * half;
  const width = 1.6 + Math.random() * 1.6;
  return (context, x, y) => {
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(x - dx, y - dy);
    context.lineTo(x + dx, y + dy);
    context.stroke();
  };
}

function stone(): Mark {
  const radius = 0.8 + Math.random() * Math.random() * 3.5;
  return (context, x, y) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  };
}

/**
 * Red: blades of grass seen from above. Green: stones, for tarmac and gravel.
 * Both average to mid grey.
 */
function makeGrainTexture(): THREE.Texture {
  const size = 512;
  /** One channel of grey marks, painted darkest first so that the light ones end up on top. */
  const paint = (count: number, contrast: number, shape: () => Mark): Uint8ClampedArray => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#000';
    context.fillRect(0, 0, size, size);
    context.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const level = Math.round(255 * Math.min(1, (i / count) * (0.6 + 0.8 * Math.random())));
      context.strokeStyle = context.fillStyle = `rgb(${level},${level},${level})`;
      const mark = shape();
      const x = Math.random() * size;
      const y = Math.random() * size;
      // Again one tile away, for the marks that cross an edge.
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) mark(context, x + ox, y + oy);
    }
    const pixels = context.getImageData(0, 0, size, size).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i]!;
    const mean = sum / (size * size);
    for (let i = 0; i < pixels.length; i += 4) pixels[i] = 128 + (pixels[i]! - mean) * contrast;
    return pixels;
  };
  const blades = paint(12000, 1, blade);
  const stones = paint(16000, 0.5, stone);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = blades[i]!;
    data[i + 1] = stones[i]!;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

let noise: THREE.Texture | undefined;
let grain: THREE.Texture | undefined;

/** Lambert material whose colour carries world-space ground detail. */
export function groundMaterial(params: THREE.MeshLambertMaterialParameters, layer: number): THREE.MeshLambertMaterial {
  noise ??= makeNoiseTexture();
  const detail = noise;
  grain ??= makeGrainTexture();
  const marks = grain;
  const material = new THREE.MeshLambertMaterial({
    ...params,
    // Coplanar layers: later layers win without fighting over depth.
    polygonOffset: layer > 0,
    polygonOffsetFactor: -2 * layer,
    polygonOffsetUnits: -2 * layer,
    depthWrite: layer === 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.uniforms.grainMap = { value: marks };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform sampler2D grainMap;\nvarying vec2 vGroundXZ;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 marks = texture2D(grainMap, vGroundXZ / ${GRAIN_TILE}).rg;
        // Grass wherever green leads.
        float grassy = step(1.15 * max(diffuseColor.r, diffuseColor.b), diffuseColor.g);
        float d1 = mix(marks.g, marks.r, grassy);
        float d2 = texture2D(detailMap, vGroundXZ / 11.0).r;
        float d3 = texture2D(detailMap, vGroundXZ / 170.0).r;
        diffuseColor.rgb *= (0.45 + 1.1 * d1) * (0.75 + 0.5 * d2) * (0.8 + 0.4 * d3);`,
      );
  };
  material.customProgramCacheKey = () => 'ground-detail';
  return material;
}

/**
 * The base terrain: a flat sheet reaching the horizon. It is cut into 400 m
 * cells because depth interpolated across one 80 km triangle is too coarse
 * for the surfaces laid on top of it, which then flicker in and out.
 */
export function buildTerrain(color: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(80000, 80000, 200, 200);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, groundMaterial({ color }, 0));
  mesh.renderOrder = 0;
  return mesh;
}

/** The rectangles as triangles lying on the ground, each in its own colour. */
function quads(list: Rect[]): THREE.BufferGeometry {
  const color = new THREE.Color();
  const positions = new Float32Array(list.length * 18);
  const colors = new Float32Array(list.length * 18);
  const normals = new Float32Array(list.length * 18);
  list.forEach((r, i) => {
    const h = r.headingDeg * DEG;
    const dx = (Math.sin(h) * r.length) / 2;
    const dz = (-Math.cos(h) * r.length) / 2;
    const rx = (Math.cos(h) * r.width) / 2;
    const rz = (Math.sin(h) * r.width) / 2;
    const a = [r.x - dx - rx, r.z - dz - rz] as const;
    const b = [r.x - dx + rx, r.z - dz + rz] as const;
    const c = [r.x + dx + rx, r.z + dz + rz] as const;
    const d = [r.x + dx - rx, r.z + dz - rz] as const;
    color.setHex(r.color);
    [a, b, c, a, c, d].forEach((p, k) => {
      const o = i * 18 + k * 3;
      positions[o] = p[0];
      positions[o + 1] = 0;
      positions[o + 2] = p[1];
      normals[o + 1] = 1;
      colors[o] = color.r;
      colors[o + 1] = color.g;
      colors[o + 2] = color.b;
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Flat coloured rectangles (fields, runway, markings), one mesh per layer. */
export function buildSurfaces(rects: Rect[]): THREE.Group {
  const group = new THREE.Group();
  const layers = new Map<number, Rect[]>();
  for (const r of rects) {
    const list = layers.get(r.layer) ?? [];
    list.push(r);
    layers.set(r.layer, list);
  }
  for (const [layer, list] of layers) {
    const mesh = new THREE.Mesh(quads(list), groundMaterial({ vertexColors: true, side: THREE.DoubleSide }, layer));
    mesh.renderOrder = layer;
    group.add(mesh);
  }
  return group;
}

export interface Water {
  object: THREE.Object3D;
  /** Call every frame with the time in seconds. */
  update(seconds: number): void;
}

/**
 * Ponds. Seen from above the water shows its own colour, at a low angle it
 * mirrors the sky. Wavelets a hand's width across drift over it: smooth
 * water gives nothing to judge height by.
 */
export function buildWater(rects: Rect[], sky: THREE.Color): Water {
  noise ??= makeNoiseTexture();
  const time = { value: 0 };
  const group = new THREE.Group();
  for (const r of rects) {
    const material = new THREE.ShaderMaterial({
      uniforms: { time, sky: { value: sky }, detailMap: { value: noise } },
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2 * r.layer,
      polygonOffsetUnits: -2 * r.layer,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vDeep;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vDeep = color;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 sky;
        uniform sampler2D detailMap;
        varying vec3 vWorld;
        varying vec3 vDeep;
        void main() {
          vec3 toEye = cameraPosition - vWorld;
          float a = texture2D(detailMap, vWorld.xz / 2.3 + time * vec2(0.021, 0.013)).r;
          float b = texture2D(detailMap, vWorld.xz / 0.9 - time * vec2(0.017, 0.031)).r;
          float ripple = a + b - 1.0;
          float grazing = 1.0 - abs(toEye.y) / length(toEye);
          float mirror = clamp(0.1 + 0.85 * pow(grazing, 4.0) + 0.3 * ripple, 0.0, 1.0);
          vec3 color = mix(vDeep, sky, mirror) + vec3(0.2) * smoothstep(0.42, 0.62, ripple);
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(quads([r]), material);
    mesh.renderOrder = r.layer;
    group.add(mesh);
  }
  return {
    object: group,
    update(seconds) {
      time.value = seconds;
    },
  };
}

/** A flat disc on the ground, e.g. the gravel target. */
export function buildDisc(x: number, z: number, radius: number, color: number, layer: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius, 48);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, groundMaterial({ color }, layer));
  mesh.position.set(x, 0, z);
  mesh.renderOrder = layer;
  return mesh;
}
