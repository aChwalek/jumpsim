// Ground surfaces. Everything flat shares one trick: the colour is modulated
// by textures sampled in world space. Two scales of soft noise break up the
// big surfaces seen from high up. The grain is what tells height in the last
// metres: sharp marks a few centimetres across, which blur into a plain
// colour with distance, so how far up the picture they can be made out
// depends on how low the eye is.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Area, Imagery, ImagerySpots, Rect } from './dz';

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

/** Soft noise with a speckle on it, tiling: what breaks up every plain surface. */
export const noiseTexture = (): THREE.Texture => (noise ??= makeNoiseTexture());
let grain: THREE.Texture | undefined;

/**
 * The colour of a drop zone's rock faces, which the photos taken from above
 * barely see: the colour itself, and how much of the photo's to keep (0..1).
 */
export interface RockTint {
  color: number;
  photo: number;
}

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
 * hold the light of the day they were taken. `fallback` shows where none covers;
 * `rockTint` is the colour of the rock faces, where it is known.
 */
export function loadPhotos(
  imagery: Imagery[],
  fallback: number,
  gain = 1,
  rockTint?: RockTint,
  spots?: ImagerySpots,
  grassBelow = 1e9,
): Photos {
  const loader = new THREE.TextureLoader();
  const ready = new THREE.Vector3(0, 0, 0);
  const spotsReady = { value: 0 };
  const levels = [0, 1, 2].map((k) => imagery[Math.min(k, imagery.length - 1)]!);
  const load = (url: string, done: () => void): THREE.Texture => {
    const texture = loader.load(`${import.meta.env.BASE_URL}${url}`, done);
    texture.colorSpace = THREE.SRGBColorSpace;
    // The first row of the image is the north edge, at the smallest z.
    texture.flipY = false;
    texture.anisotropy = 16;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  };
  const textures = levels.map((level, k) => load(level.url, () => ready.setComponent(k, 1)));
  // The squares at 1 m: one picture, `grid` to a row; each is read only inside its own cell.
  const spotTexture = spots ? load(spots.url, () => (spotsReady.value = 1)) : null;
  if (spotTexture) textures.push(spotTexture);
  const spotBoxes = Array.from({ length: MAX_SPOTS }, (_, k) => {
    const c = spots?.centres[k];
    return c ? new THREE.Vector4(c[0], c[1], spots!.size, k) : new THREE.Vector4(0, 0, 0, -1);
  });
  return {
    textures,
    uniforms: {
      photo0: { value: textures[0] },
      photo1: { value: textures[1] },
      photo2: { value: textures[2] },
      photoSize: { value: new THREE.Vector3(levels[0]!.size, levels[1]!.size, levels[2]!.size) },
      photoCentre: { value: levels.map((l) => new THREE.Vector2(l.x ?? 0, l.z ?? 0)) },
      photoSpots: { value: spotTexture ?? textures[0] },
      photoSpot: { value: spotBoxes },
      photoSpotGrid: { value: spots?.grid ?? 1 },
      photoSpotsReady: spotsReady,
      grassBelow: { value: grassBelow },
      photoReady: { value: ready },
      photoGain: { value: gain },
      photoFallback: { value: new THREE.Color(fallback) },
      rockTint: {
        value: rockTint ? new THREE.Vector4(...new THREE.Color(rockTint.color).toArray(), rockTint.photo) : new THREE.Vector4(0, 0, 0, -1),
      },
    },
    dispose() {
      for (const t of textures) t.dispose();
    },
  };
}

/** The most squares of finer photo a drop zone may have. */
const MAX_SPOTS = 4;

/**
 * GLSL reading the photos at a point of the ground: the finest one that
 * covers it, fading into the next one out near its edge.
 */
export const PHOTO_GLSL = /* glsl */ `
  // A vertex shader has no biased lookup: it sets its own, which names the level.
  #ifndef PHOTO_TEX
  #define PHOTO_TEX(t, uv, blur) texture2D(t, uv, blur)
  #endif
  uniform sampler2D photo0;
  uniform sampler2D photo1;
  uniform sampler2D photo2;
  uniform vec3 photoSize;
  // The centre of each level, where it is not the origin.
  uniform vec2 photoCentre[3];
  // Squares finer still, side by side in one picture: centre x, z, side, cell (< 0: none).
  uniform sampler2D photoSpots;
  uniform vec4 photoSpot[${MAX_SPOTS}];
  uniform float photoSpotGrid;
  uniform float photoSpotsReady;
  uniform vec3 photoReady;
  uniform float photoGain;
  uniform vec3 photoFallback;
  // Above this, high mountains: rock and snow, nothing grows.
  uniform float grassBelow;
  float photoWeight(vec2 uv) {
    vec2 d = min(uv, 1.0 - uv);
    return smoothstep(0.0, 0.05, min(d.x, d.y));
  }
  // blur: a mip bias, each step averaging twice as far round.
  vec3 photoAt(vec2 p, float blur) {
    vec2 uv2 = (p - photoCentre[2]) / photoSize.z + 0.5;
    vec2 uv1 = (p - photoCentre[1]) / photoSize.y + 0.5;
    vec2 uv0 = (p - photoCentre[0]) / photoSize.x + 0.5;
    vec3 c = mix(photoFallback, PHOTO_TEX(photo2, uv2, blur).rgb, photoReady.z * photoWeight(uv2));
    c = mix(c, PHOTO_TEX(photo1, uv1, blur).rgb, photoReady.y * photoWeight(uv1));
    c = mix(c, PHOTO_TEX(photo0, uv0, blur).rgb, photoReady.x * photoWeight(uv0));
    for (int k = 0; k < ${MAX_SPOTS}; k++) {
      vec4 s = photoSpot[k];
      if (s.w < 0.0) break;
      vec2 uv = (p - s.xy) / s.z + 0.5;
      if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) continue;
      // Kept off the cell's edge, where its neighbour's texels would bleed in.
      vec2 cell = vec2(mod(s.w, photoSpotGrid), floor(s.w / photoSpotGrid));
      vec2 inCell = clamp(uv, 0.002, 0.998);
      c = mix(c, PHOTO_TEX(photoSpots, (cell + inCell) / photoSpotGrid, blur).rgb, photoSpotsReady * photoWeight(uv));
    }
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
  // The rock's own colour, linear, and how much of the photo's to keep; a < 0: the photo's alone.
  uniform vec4 rockTint;
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
    // Where the rock's own colour is known, the photo only shades it.
    if (rockTint.a >= 0.0) tint = mix(rockTint.rgb * (0.75 + 0.5 * grey / max(0.05, dot(rockTint.rgb, vec3(0.3, 0.5, 0.2)))), tint, rockTint.a);
    return tint * face;
  }
`;

/**
 * GLSL for the bare limestone on top of a cliff, where the photos, taken from
 * above, show the scrub along the rim instead: light grey, in beds and blocks
 * on its faces, pitted and gritty on top, greyed by lichen, stained ochre in
 * places. Seen from every side (triplanar).
 */
const LIMESTONE_GLSL = /* glsl */ `
  uniform sampler2D rockMap;
  uniform vec3 rockBox;
  vec3 limestoneAt(vec3 p, vec3 n) {
    vec3 w = abs(n) + 0.001;
    w /= w.x + w.y + w.z;
    float sides = rockFace(vec2(p.z, p.y)) * w.x + rockFace(vec2(p.x, p.y)) * w.z;
    vec2 q = p.xz;
    float blocks = texture2D(detailMap, q / 23.0, 2.0).r;
    float pits = texture2D(detailMap, q / 4.1, 1.0).r;
    float grit = texture2D(detailMap, q / 0.9).r;
    // Cracks: thin dark lines where smooth noise crosses its middle, broken
    // off where another is low, at two sizes.
    float c1 = (1.0 - smoothstep(0.0, 0.012, abs(texture2D(detailMap, q / 47.0 + 0.13, 3.0).r - 0.5)))
      * smoothstep(0.48, 0.6, texture2D(detailMap, q / 31.0 + 0.29, 3.0).r);
    float c2 = (1.0 - smoothstep(0.0, 0.015, abs(texture2D(detailMap, q / 17.0 + 0.61, 3.0).r - 0.5)))
      * smoothstep(0.5, 0.62, texture2D(detailMap, q / 13.0 + 0.83, 3.0).r);
    float top = (0.55 + 0.9 * blocks) * (0.75 + 0.5 * pits) * (0.8 + 0.4 * grit) * (1.0 - 0.45 * c1) * (1.0 - 0.3 * c2);
    // Lichen greys it in patches; here and there an ochre or orange stain.
    float lichen = smoothstep(0.42, 0.62, texture2D(detailMap, q / 90.0 + 0.37, 3.0).r);
    float ochre = smoothstep(0.55, 0.7, texture2D(detailMap, q / 150.0 + 0.71, 3.0).r);
    vec3 stone = rockTint.a >= 0.0 ? rockTint.rgb : vec3(0.42, 0.405, 0.375);
    stone = mix(stone, stone * vec3(0.62, 0.64, 0.62), lichen * 0.7);
    stone = mix(stone, stone * vec3(1.12, 0.92, 0.7), ochre * 0.6);
    return stone * (sides + top * w.y);
  }
  // 0 where the photo stands, 1 where the rock is bare.
  float bareRock(vec2 xz) {
    vec2 uv = (xz - rockBox.xy) / rockBox.z;
    if (rockBox.z <= 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
    return texture2D(rockMap, uv).r;
  }
`;

/** Bare rock over a square, as a texture, and the square: west and north edges, side, m. */
export interface RockCover {
  texture: THREE.Texture;
  box: THREE.Vector3;
}

/**
 * Lambert material whose colour carries world-space ground detail. With
 * photos, the colour is the photo's, and only the fine grain is added to it;
 * bare rock replaces it where `rock` says so.
 */
export function groundMaterial(
  params: THREE.MeshLambertMaterialParameters,
  layer: number,
  photos?: Photos,
  rock?: RockCover,
): THREE.MeshLambertMaterial {
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
    if (photos && rock) Object.assign(shader.uniforms, { rockMap: { value: rock.texture }, rockBox: { value: rock.box } });
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
        ${photos ? PHOTO_GLSL + ROCK_GLSL : ''}
        ${photos && rock ? LIMESTONE_GLSL : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        photos
          ? `#include <color_fragment>
        vec2 vGroundXZ = vGroundWorld.xz;
        diffuseColor.rgb = photoAt(vGroundXZ);
        vec2 marks = texture2D(grainMap, vGroundXZ / ${GRAIN_TILE}).rg;
        // Blades wherever the ground bears something, as the grass standing on it has it: green, or
        // warm, short of blue or white. Bluish is tarmac, roofs and water, white is sand: stones.
        float warm = max(diffuseColor.r, diffuseColor.g);
        float bears = smoothstep(0.0, 0.1, (warm - diffuseColor.b) / max(warm, 0.001));
        bears *= 1.0 - smoothstep(0.5, 0.8, dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)));
        bears = max(bears, step(1.08 * max(diffuseColor.r, diffuseColor.b), diffuseColor.g));
        // High up, the warm grey of granite is no dry grass, and snow is even, grit only.
        float high = smoothstep(grassBelow - 100.0, grassBelow, vGroundWorld.y);
        bears *= 1.0 - high;
        float snow = high * smoothstep(0.55, 0.8, dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)));
        float d1 = mix(marks.g, marks.r, bears);
        d1 = mix(d1, 0.5 + 0.3 * (d1 - 0.5), snow);
        float d2 = texture2D(detailMap, vGroundXZ / 11.0).r;
        // A photo pixel is a metre across: patches a stride wide and drier
        // ones a few metres wide fill in what it blurs.
        float d3 = texture2D(detailMap, vGroundXZ.yx / 3.1).r;
        float dry = smoothstep(0.35, 0.65, texture2D(detailMap, vGroundXZ / 37.0 + 0.37).r);
        diffuseColor.rgb *= (0.45 + 1.1 * d1) * (0.85 + 0.3 * d2) * mix(1.0, 0.7 + 0.6 * d3, bears);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.1, 1.0, 0.8), 0.6 * bears * dry);
        vec3 groundNormal = normalize(vGroundNormal);
        float steep = smoothstep(0.8, 0.6, groundNormal.y);
        if (steep > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, rockAt(vGroundWorld, groundNormal), steep);
        ${
          rock
            ? `float bare = bareRock(vGroundXZ);
        if (bare > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, limestoneAt(vGroundWorld, groundNormal) * (0.7 + 0.6 * marks.g), bare);`
            : ''
        }`
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
  material.customProgramCacheKey = () => (photos ? (rock ? 'ground-photo-rock' : 'ground-photo') : 'ground-detail');
  return material;
}

/** Metres between the grid lines of the terrain near the drop zone. */
export const TERRAIN_SPACING = 100;

/** How far out the terrain's lines are 100 m apart, m, unless a drop zone reaches further. */
export const TERRAIN_REACH = 6000;

/**
 * Grid lines of the terrain along one axis: every 100 m out to `reach`, every
 * 400 m beyond, to 40 km. Depth interpolated across long triangles is too
 * coarse for the surfaces laid on top, which then flicker in and out, and
 * hills need the finer cells near the drop zone.
 */
function terrainLines(reach = TERRAIN_REACH): number[] {
  const lines: number[] = [];
  for (let x = -40000; x < -reach; x += 400) lines.push(x);
  for (let x = -reach; x < reach; x += TERRAIN_SPACING) lines.push(x);
  for (let x = reach; x <= 40000; x += 400) lines.push(x);
  return lines;
}

/**
 * A square of terrain drawn finer, centred on (x, z): its sides on the 100 m
 * lines. `size` is its side west to east; `sizeZ`, north to south, where it
 * is longer one way than the other.
 */
export interface TerrainDetail {
  x: number;
  z: number;
  size: number;
  sizeZ?: number;
  spacing: number;
}

/** Whether a cell lies inside a square of finer terrain, which draws it instead. */
function coveredBy(d: TerrainDetail | undefined, x0: number, z0: number, x1: number, z1: number): boolean {
  if (!d) return false;
  const halfX = d.size / 2;
  const halfZ = (d.sizeZ ?? d.size) / 2;
  return x0 >= d.x - halfX - 1e-6 && x1 <= d.x + halfX + 1e-6 && z0 >= d.z - halfZ - 1e-6 && z1 <= d.z + halfZ + 1e-6;
}

/**
 * The base terrain reaching the horizon: flat, or shaped by `groundAt`, in
 * one colour or coloured point by point by `colorAt`. Inside each of
 * `details`, coarsest first, each inside the one before, it is drawn finer,
 * for a cliff.
 */
export function buildTerrain(
  color: number,
  groundAt: (x: number, z: number) => number = () => 0,
  colorAt?: (x: number, z: number) => number,
  photos?: Photos,
  details: TerrainDetail[] = [],
  rock?: RockCover,
  reach = TERRAIN_REACH,
): THREE.Mesh {
  const lines = terrainLines(reach);
  // Cells of the coarse mesh the fine square covers are left out.
  const covered = (x0: number, z0: number, x1: number, z1: number): boolean => coveredBy(details[0], x0, z0, x1, z1);
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
  if (details.length) {
    const parts = [geometry];
    let outer = { x: lines, z: lines };
    details.forEach((d, i) => {
      parts.push(fineTerrain(d, outer, details[i + 1], groundAt, colorAt, !!colors));
      outer = detailLines(d);
    });
    geometry = mergeGeometries(parts);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, groundMaterial(colors ? { vertexColors: true } : { color }, 0, photos, rock));
  mesh.renderOrder = 0;
  return mesh;
}

/** The grid lines of a square of finer terrain, along x and along z. */
function detailLines(d: TerrainDetail): { x: number[]; z: number[] } {
  const along = (from: number, size: number): number[] =>
    Array.from({ length: Math.round(size / d.spacing) + 1 }, (_, k) => from + k * d.spacing);
  const sizeZ = d.sizeZ ?? d.size;
  return { x: along(d.x - d.size / 2, d.size), z: along(d.z - sizeZ / 2, sizeZ) };
}

/**
 * A finer square of terrain. Along its sides the points follow the straight
 * edges of the coarser cells next to it (`outer`, the lines of the mesh it is
 * laid in), so that no crack opens between them. Cells inside `inner`, finer
 * still, are left to it.
 */
function fineTerrain(
  d: TerrainDetail,
  outer: { x: number[]; z: number[] },
  inner: TerrainDetail | undefined,
  groundAt: (x: number, z: number) => number,
  colorAt: ((x: number, z: number) => number) | undefined,
  colored: boolean,
): THREE.BufferGeometry {
  const n = Math.round(d.size / d.spacing) + 1;
  const rows = Math.round((d.sizeZ ?? d.size) / d.spacing) + 1;
  const x0 = d.x - d.size / 2;
  const z0 = d.z - (d.sizeZ ?? d.size) / 2;
  /** Height along a coarse edge: straight between the coarse points either side. */
  const along = (fixed: number, t: number, horizontal: boolean): number => {
    const lines = horizontal ? outer.x : outer.z;
    let k = 0;
    while (k < lines.length - 2 && lines[k + 1]! <= t) k++;
    const a = lines[k]!;
    const b = lines[k + 1]!;
    const f = (t - a) / (b - a);
    const ha = horizontal ? groundAt(a, fixed) : groundAt(fixed, a);
    const hb = horizontal ? groundAt(b, fixed) : groundAt(fixed, b);
    return ha + (hb - ha) * f;
  };
  const positions = new Float32Array(n * rows * 3);
  const colors = colored ? new Float32Array(n * rows * 3) : null;
  const tint = new THREE.Color();
  let o = 0;
  for (let j = 0; j < rows; j++) {
    const z = z0 + j * d.spacing;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * d.spacing;
      let y: number;
      if (j === 0 || j === rows - 1) y = along(z, x, true);
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
  const index = new Uint32Array((n - 1) * (rows - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const cx = x0 + i * d.spacing;
      const cz = z0 + j * d.spacing;
      if (coveredBy(inner, cx, cz, cx + d.spacing, cz + d.spacing)) continue;
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
  geometry.setIndex(new THREE.BufferAttribute(index.subarray(0, k), 1));
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
