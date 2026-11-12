// Ground surfaces. Everything flat shares one trick: the colour is modulated
// by textures sampled in world space. Two scales of soft noise break up the
// big surfaces seen from high up. The grain is what tells height in the last
// metres: sharp marks a few centimetres across, which blur into a plain
// colour with distance, so how far up the picture they can be made out
// depends on how low the eye is.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Area, Imagery, Rect } from './dz';

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

/** Aerial photos of a drop zone on the graphics card, finest first, and how to read them. */
export interface Photos {
  textures: THREE.Texture[];
  /** What the shaders read: the textures, their sizes, which have come in, brightness. */
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

/**
 * Starts loading the photos; each shows once it has come in, the coarser
 * ones until then. `gain` is the brightness they are drawn at: they already
 * hold the light of the day they were taken. `fallback` shows where none covers.
 */
export function loadPhotos(imagery: Imagery[], fallback: number, gain = 1): Photos {
  const loader = new THREE.TextureLoader();
  const ready = new THREE.Vector3(0, 0, 0);
  const levels = [0, 1, 2].map((k) => imagery[Math.min(k, imagery.length - 1)]!);
  const textures = levels.map((level, k) => {
    const texture = loader.load(`${import.meta.env.BASE_URL}${level.url}`, () => ready.setComponent(k, 1));
    texture.colorSpace = THREE.SRGBColorSpace;
    // The first row of the image is the north edge, at the smallest z.
    texture.flipY = false;
    texture.anisotropy = 16;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
  return {
    textures,
    uniforms: {
      photo0: { value: textures[0] },
      photo1: { value: textures[1] },
      photo2: { value: textures[2] },
      photoSize: { value: new THREE.Vector3(levels[0]!.size, levels[1]!.size, levels[2]!.size) },
      photoReady: { value: ready },
      photoGain: { value: gain },
      photoFallback: { value: new THREE.Color(fallback) },
    },
    dispose() {
      for (const t of textures) t.dispose();
    },
  };
}

/**
 * GLSL reading the photos at a point of the ground: the finest one that
 * covers it, fading into the next one out near its edge.
 */
const PHOTO_GLSL = /* glsl */ `
  uniform sampler2D photo0;
  uniform sampler2D photo1;
  uniform sampler2D photo2;
  uniform vec3 photoSize;
  uniform vec3 photoReady;
  uniform float photoGain;
  uniform vec3 photoFallback;
  float photoWeight(vec2 uv) {
    vec2 d = min(uv, 1.0 - uv);
    return smoothstep(0.0, 0.05, min(d.x, d.y));
  }
  // blur: a mip bias, each step averaging twice as far round.
  vec3 photoAt(vec2 p, float blur) {
    vec2 uv2 = p / photoSize.z + 0.5;
    vec2 uv1 = p / photoSize.y + 0.5;
    vec2 uv0 = p / photoSize.x + 0.5;
    vec3 c = mix(photoFallback, texture2D(photo2, uv2, blur).rgb, photoReady.z * photoWeight(uv2));
    c = mix(c, texture2D(photo1, uv1, blur).rgb, photoReady.y * photoWeight(uv1));
    c = mix(c, texture2D(photo0, uv0, blur).rgb, photoReady.x * photoWeight(uv0));
    return c * photoGain;
  }
  vec3 photoAt(vec2 p) { return photoAt(p, 0.0); }
`;


/**
 * GLSL for rock faces. A photo taken from above spends a pixel or two on a
 * face hundreds of metres high, which comes out as streaks running down it:
 * there the photo only gives the tint, averaged over a few tens of metres,
 * and the texture is drawn on the face itself, seen from either side
 * (triplanar): beds of rock lying flat, blocks, and grit.
 */
const ROCK_GLSL = /* glsl */ `
  // q: along the face, up. The stretched samples are read blurred: the
  // speckle of single texels would come out as threadlike lines.
  float rockFace(vec2 q) {
    float beds = texture2D(detailMap, vec2(q.x / 1700.0, q.y / 110.0), 3.0).r;
    float thin = texture2D(detailMap, vec2(q.x / 300.0, q.y / 25.0), 3.0).r;
    // Dark stains where water runs down.
    float stains = texture2D(detailMap, vec2(q.x / 250.0, q.y / 1500.0), 3.0).r;
    float blocks = texture2D(detailMap, q / 29.0).r;
    float grit = texture2D(detailMap, q / 4.3).r;
    return (0.6 + 0.8 * beds) * (0.8 + 0.4 * thin) * (0.7 + 0.6 * smoothstep(0.35, 0.65, stains))
      * (0.6 + 0.8 * blocks) * (0.8 + 0.4 * grit);
  }
  vec3 rockAt(vec3 p, vec3 n) {
    vec2 w = abs(n.xz) + 0.001;
    w /= w.x + w.y;
    float face = rockFace(vec2(p.z, p.y)) * w.x + rockFace(vec2(p.x, p.y)) * w.y;
    vec3 tint = photoAt(p.xz, 4.5);
    // Rock is greyer than the averaged photo, which takes in the ledges' grass.
    float grey = dot(tint, vec3(0.3, 0.5, 0.2));
    tint = mix(vec3(grey), tint, 0.55) * vec3(1.02, 1.0, 0.97);
    return tint * face;
  }
`;

/**
 * Lambert material whose colour carries world-space ground detail. With
 * photos, the colour is the photo's, and only the fine grain is added to it.
 */
export function groundMaterial(params: THREE.MeshLambertMaterialParameters, layer: number, photos?: Photos): THREE.MeshLambertMaterial {
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
    if (photos) Object.assign(shader.uniforms, photos.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGroundNormal = mat3(modelMatrix) * objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D detailMap;
        uniform sampler2D grainMap;
        varying vec3 vGroundWorld;
        varying vec3 vGroundNormal;
        ${photos ? PHOTO_GLSL + ROCK_GLSL : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        photos
          ? `#include <color_fragment>
        vec2 vGroundXZ = vGroundWorld.xz;
        diffuseColor.rgb = photoAt(vGroundXZ);
        vec2 marks = texture2D(grainMap, vGroundXZ / ${GRAIN_TILE}).rg;
        float grassy = step(1.08 * max(diffuseColor.r, diffuseColor.b), diffuseColor.g);
        float d1 = mix(marks.g, marks.r, grassy);
        float d2 = texture2D(detailMap, vGroundXZ / 11.0).r;
        diffuseColor.rgb *= (0.45 + 1.1 * d1) * (0.85 + 0.3 * d2);
        vec3 groundNormal = normalize(vGroundNormal);
        float steep = smoothstep(0.8, 0.6, groundNormal.y);
        if (steep > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, rockAt(vGroundWorld, groundNormal), steep);`
          : `#include <color_fragment>
        vec2 vGroundXZ = vGroundWorld.xz;
        vec2 marks = texture2D(grainMap, vGroundXZ / ${GRAIN_TILE}).rg;
        // Grass wherever green leads.
        float grassy = step(1.15 * max(diffuseColor.r, diffuseColor.b), diffuseColor.g);
        float d1 = mix(marks.g, marks.r, grassy);
        float d2 = texture2D(detailMap, vGroundXZ / 11.0).r;
        float d3 = texture2D(detailMap, vGroundXZ / 170.0).r;
        diffuseColor.rgb *= (0.45 + 1.1 * d1) * (0.75 + 0.5 * d2) * (0.8 + 0.4 * d3);`,
      );
  };
  material.customProgramCacheKey = () => (photos ? 'ground-photo' : 'ground-detail');
  return material;
}

/**
 * Grid lines of the terrain along one axis: every 100 m out to 6 km, every
 * 400 m beyond, to 40 km. Depth interpolated across long triangles is too
 * coarse for the surfaces laid on top, which then flicker in and out, and
 * hills need the finer cells near the drop zone.
 */
function terrainLines(): number[] {
  const lines: number[] = [];
  for (let x = -40000; x < -6000; x += 400) lines.push(x);
  for (let x = -6000; x < 6000; x += 100) lines.push(x);
  for (let x = 6000; x <= 40000; x += 400) lines.push(x);
  return lines;
}

/** A square of terrain drawn finer, centred on (x, z): its sides on the 100 m lines. */
export interface TerrainDetail {
  x: number;
  z: number;
  size: number;
  spacing: number;
}

/**
 * The base terrain reaching the horizon: flat, or shaped by `groundAt`, in
 * one colour or coloured point by point by `colorAt`. Inside `detail` it is
 * drawn finer, for a cliff.
 */
export function buildTerrain(
  color: number,
  groundAt: (x: number, z: number) => number = () => 0,
  colorAt?: (x: number, z: number) => number,
  photos?: Photos,
  detail?: TerrainDetail,
): THREE.Mesh {
  const lines = terrainLines();
  const half = detail ? detail.size / 2 : 0;
  // Cells of the coarse mesh the fine square covers are left out.
  const covered = (x0: number, z0: number, x1: number, z1: number): boolean =>
    !!detail && x0 >= detail.x - half && x1 <= detail.x + half && z0 >= detail.z - half && z1 <= detail.z + half;
  const n = lines.length;
  const positions = new Float32Array(n * n * 3);
  const colors = colorAt && !photos ? new Float32Array(n * n * 3) : null;
  const tint = new THREE.Color();
  let o = 0;
  for (const z of lines) {
    for (const x of lines) {
      if (colors) {
        tint.setHex(colorAt!(x, z));
        colors[o] = tint.r;
        colors[o + 1] = tint.g;
        colors[o + 2] = tint.b;
      }
      positions[o++] = x;
      positions[o++] = groundAt(x, z);
      positions[o++] = z;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (covered(lines[i]!, lines[j]!, lines[i + 1]!, lines[j + 1]!)) continue;
      const a = j * n + i;
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  if (detail) geometry = mergeGeometries([geometry, fineTerrain(detail, lines, groundAt, colorAt, !!colors)]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, groundMaterial(colors ? { vertexColors: true } : { color }, 0, photos));
  mesh.renderOrder = 0;
  return mesh;
}

/**
 * The fine square of terrain. Along its sides the points follow the straight
 * edges of the coarse cells next to it, so that no crack opens between them.
 */
function fineTerrain(
  d: TerrainDetail,
  lines: number[],
  groundAt: (x: number, z: number) => number,
  colorAt: ((x: number, z: number) => number) | undefined,
  colored: boolean,
): THREE.BufferGeometry {
  const n = Math.round(d.size / d.spacing) + 1;
  const x0 = d.x - d.size / 2;
  const z0 = d.z - d.size / 2;
  /** Height along a coarse edge: straight between the coarse points either side. */
  const along = (fixed: number, t: number, horizontal: boolean): number => {
    let k = 0;
    while (k < lines.length - 2 && lines[k + 1]! <= t) k++;
    const a = lines[k]!;
    const b = lines[k + 1]!;
    const f = (t - a) / (b - a);
    const ha = horizontal ? groundAt(a, fixed) : groundAt(fixed, a);
    const hb = horizontal ? groundAt(b, fixed) : groundAt(fixed, b);
    return ha + (hb - ha) * f;
  };
  const positions = new Float32Array(n * n * 3);
  const colors = colored ? new Float32Array(n * n * 3) : null;
  const tint = new THREE.Color();
  let o = 0;
  for (let j = 0; j < n; j++) {
    const z = z0 + j * d.spacing;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * d.spacing;
      let y: number;
      if (j === 0 || j === n - 1) y = along(z, x, true);
      else if (i === 0 || i === n - 1) y = along(x, z, false);
      else y = groundAt(x, z);
      if (colors) {
        tint.setHex(colorAt!(x, z));
        colors[o] = tint.r;
        colors[o + 1] = tint.g;
        colors[o + 2] = tint.b;
      }
      positions[o++] = x;
      positions[o++] = y;
      positions[o++] = z;
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      index[k++] = a;
      index[k++] = a + n;
      index[k++] = a + 1;
      index[k++] = a + 1;
      index[k++] = a + n;
      index[k++] = a + n + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
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

/** Polygons as triangles lying on the ground, each in its own colour. */
function polygons(list: Area[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const ring = (flat: number[]): THREE.Vector2[] => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return out;
  };
  for (const a of list) {
    const contour = ring(a.points);
    const holes = (a.holes ?? []).map(ring);
    const all = contour.concat(...holes);
    color.setHex(a.color);
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const [a, b, c] = triangle.map((k) => all[k]!) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
      // Facing up whichever way round the polygon was given: a face seen
      // from behind is lit from below, and comes out dark.
      const up = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) > 0;
      for (const p of up ? [a, b, c] : [a, c, b]) {
        positions.push(p.x, 0, p.y);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Rectangles and polygons sorted by layer. */
function byLayer(rects: Rect[], areas: Area[]): Map<number, { rects: Rect[]; areas: Area[] }> {
  const layers = new Map<number, { rects: Rect[]; areas: Area[] }>();
  const at = (layer: number) => {
    let entry = layers.get(layer);
    if (!entry) layers.set(layer, (entry = { rects: [], areas: [] }));
    return entry;
  };
  for (const r of rects) at(r.layer).rects.push(r);
  for (const a of areas) at(a.layer).areas.push(a);
  return layers;
}

/** The geometry of a layer: its rectangles and its polygons together. */
function layerGeometry(rects: Rect[], areas: Area[]): THREE.BufferGeometry {
  if (!areas.length) return quads(rects);
  if (!rects.length) return polygons(areas);
  return mergeGeometries([quads(rects), polygons(areas)]);
}

/** Flat coloured surfaces (fields, runway, markings), one mesh per layer. */
export function buildSurfaces(rects: Rect[], areas: Area[] = []): THREE.Group {
  const group = new THREE.Group();
  for (const [layer, list] of byLayer(rects, areas)) {
    const material = groundMaterial({ vertexColors: true, side: THREE.DoubleSide }, layer);
    const mesh = new THREE.Mesh(layerGeometry(list.rects, list.areas), material);
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
export function buildWater(rects: Rect[], sky: THREE.Color, areas: Area[] = [], photos?: Photos): Water {
  noise ??= makeNoiseTexture();
  const time = { value: 0 };
  const group = new THREE.Group();
  for (const [layer, list] of byLayer(rects, areas)) {
    const material = new THREE.ShaderMaterial({
      uniforms: { time, sky: { value: sky }, detailMap: { value: noise }, ...(photos ? photos.uniforms : {}) },
      defines: photos ? { USE_PHOTO: '' } : {},
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2 * layer,
      polygonOffsetUnits: -2 * layer,
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
        #ifdef USE_PHOTO
        ${PHOTO_GLSL}
        #endif
        void main() {
          vec3 toEye = cameraPosition - vWorld;
          #ifdef USE_PHOTO
          // The water's own colour is the photo's: turquoise over the reef, deep blue beyond.
          vec3 deep = photoAt(vWorld.xz) * 0.85;
          #else
          vec3 deep = vDeep;
          #endif
          float a = texture2D(detailMap, vWorld.xz / 2.3 + time * vec2(0.021, 0.013)).r;
          float b = texture2D(detailMap, vWorld.xz / 0.9 - time * vec2(0.017, 0.031)).r;
          float ripple = a + b - 1.0;
          float grazing = 1.0 - abs(toEye.y) / length(toEye);
          float mirror = clamp(0.1 + 0.85 * pow(grazing, 4.0) + 0.3 * ripple, 0.0, 1.0);
          vec3 color = mix(deep, sky, mirror) + vec3(0.2) * smoothstep(0.42, 0.62, ripple);
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(layerGeometry(list.rects, list.areas), material);
    mesh.renderOrder = layer;
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
