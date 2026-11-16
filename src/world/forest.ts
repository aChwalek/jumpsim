// The trees the terrain's tiles carry (tools/tiles: one per crown of the
// LiDAR's canopy, where the photo shows them), drawn all together whichever
// square brought them: one draw per shape. Near the eye a tree is drawn
// whole, trunk and tiers of crown; further off plainly; its shadow lies on
// the slope under it.
//
// Each tree is in one square only, the coarsest that must carry it by its
// rank, and a square's trees are drawn with all its coarser squares': when a
// square gives way to four finer ones, trees are only added, never taken
// away. How many are drawn falls off with distance tree by tree, by rank,
// their crowns a little wider to keep the forest's cover: no edge of a
// square shows in the forest.
//
// Which squares' trees are drawn: those the tiles show and every coarser
// square above them, as long as the distance leaves any of their trees to
// draw; near the eye, every square come in, shown or not. The tiles show a
// square only while it is in sight and the right size for its distance:
// near the eye, a turn of the head, the canopy's swing or a square giving
// way to finer ones would take whole squares of trees away and bring them
// back. There, only the distance decides, tree by tree.
//
// Every tree drawn is in a plain mesh, drawn there only beyond WHOLE: those
// are filled again only when the squares drawn change. A square's trees are
// kept by cells of CELL metres; the cells near the eye also put theirs in the
// whole meshes, drawn there only within WHOLE, and in the shadows': those few
// are filled again each time the eye has gone RESORT metres.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Every tree is drawn within this, m; beyond, a share falling with the square of the distance (tools/tiles keeps them so). */
export const TREES_ALL_WITHIN = 500;
/** Nearer than this, m, a tree is drawn whole; farther, plainly; over BAND either side, the one dissolves into the other. */
const WHOLE = 350;
const BAND = 12;
/** How long a square's trees take to come in or go, s: when a square is split into four finer ones, the one set dissolves into the other. */
const FADE = 0.5;
/** Shadows fade out over the last quarter of this, m: beyond, they are lost in the photo's own. */
const SHADOWS = 800;
/** How far the eye goes before the cells are sorted near and far again, m. */
const RESORT = 40;
/** A square's trees are kept by cells this many metres a side, so that only those near the eye go to the whole meshes. */
const CELL = 100;
/** A cell this close, m, has its trees in the whole meshes: by the time the eye has gone RESORT nearer, they are sorted again. */
const NEAR_CELL = WHOLE + BAND + RESORT;
/** Nearer than this, m, a square's trees are drawn whether the tiles show the square or not. */
const KEEP = 700;

/**
 * x, y, z, height | radius, slope x, slope z, rank (+1 for a conifer) | r, g,
 * b | fade: 12 floats a tree. Fade: 0 shown; t > 0 coming in since t (s); t <
 * 0 going since -t.
 */
const STRIDE = 12;

/** A run of a grove's trees, all in one cell, and the box round them. */
interface Cell {
  start: number;
  count: number;
  box: THREE.Box3;
}

/** A square's trees of one kind, in the world, cell by cell, and the box round them. */
interface Grove {
  count: number;
  data: Float32Array;
  box: THREE.Box3;
  cells: Cell[];
  shown: boolean;
  /** Hidden, but still going until then, s. */
  goingUntil: number;
}

/** One of the shapes trees are drawn with, every tree of it in one draw. */
class Shape {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private buffer!: THREE.InstancedInterleavedBuffer;
  private array!: Float32Array;
  count = 0;
  /** The box round the trees pushed: west, low, north, east, high, south. */
  private readonly bounds = [0, 0, 0, 0, 0, 0];

  constructor(
    template: THREE.BufferGeometry,
    material: THREE.Material,
    private capacity = 4096,
  ) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = template.index;
    for (const [name, attribute] of Object.entries(template.attributes)) this.geometry.setAttribute(name, attribute);
    this.attach(capacity);
    this.mesh = new THREE.Mesh(this.geometry, material);
  }

  private attach(capacity: number): void {
    // Let go of the old buffer on the graphics card, and of the number of
    // trees three.js took it to hold the first time it drew the shape: kept,
    // it draws no more than that, and whole squares of trees go missing.
    this.geometry.dispose();
    this.array = new Float32Array(capacity * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.array, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('tree', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    this.geometry.setAttribute('crown', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    this.geometry.setAttribute('tint', new THREE.InterleavedBufferAttribute(this.buffer, 3, 8));
    this.geometry.setAttribute('fade', new THREE.InterleavedBufferAttribute(this.buffer, 1, 11));
  }

  begin(): void {
    this.count = 0;
    this.bounds.splice(0, 6, Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
  }

  /** Adds trees `start` to `start + count` of `data`, within `box`. */
  push(data: Float32Array, start: number, count: number, box: THREE.Box3): void {
    const needed = this.count + count;
    if (needed > this.capacity) {
      const old = this.array;
      while (this.capacity < needed) this.capacity *= 2;
      this.attach(this.capacity);
      this.array.set(old.subarray(0, this.count * STRIDE));
    }
    this.array.set(data.subarray(start * STRIDE, (start + count) * STRIDE), this.count * STRIDE);
    this.count = needed;
    const b = this.bounds;
    const { min, max } = box;
    b[0] = Math.min(b[0]!, min.x);
    b[1] = Math.min(b[1]!, min.y);
    b[2] = Math.min(b[2]!, min.z);
    b[3] = Math.max(b[3]!, max.x);
    b[4] = Math.max(b[4]!, max.y);
    b[5] = Math.max(b[5]!, max.z);
  }

  end(): void {
    this.geometry.instanceCount = this.count;
    this.buffer.needsUpdate = true;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, this.count * STRIDE);
    if (this.count) {
      const [x0, y0, z0, x1, y1, z1] = this.bounds as [number, number, number, number, number, number];
      // Held in by the tallest crowns and the longest shadows.
      this.geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
        Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 120,
      );
    }
    this.mesh.visible = this.count > 0;
  }
}

/** A shape of a unit tree: y from the ground (0) to the top (1), x and z in crowns (part 1) or trunks (part 0); indexed. */
function partOf(geometry: THREE.BufferGeometry, part: number): THREE.BufferGeometry {
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  const g = geometry.index ? geometry : mergeVertices(geometry);
  g.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count).fill(part), 1));
  return g;
}

const cone = (radius: number, from: number, to: number, sides: number, open = false): THREE.BufferGeometry =>
  new THREE.ConeGeometry(radius, to - from, sides, 1, open).translate(0, (from + to) / 2, 0);
const trunk = (top: number): THREE.BufferGeometry => new THREE.CylinderGeometry(0.8, 1, top, 5, 1, true).translate(0, top / 2, 0);
// A broadleaf's crown: from a quarter of the way up to the top.
const blob = (shape: THREE.BufferGeometry): THREE.BufferGeometry => shape.scale(1, 0.38, 1).translate(0, 0.62, 0);

const SHAPES = {
  coniferWhole: () =>
    mergeGeometries([
      partOf(trunk(0.3), 0),
      partOf(cone(1, 0.12, 0.55, 7), 1),
      partOf(cone(0.78, 0.38, 0.8, 7), 1),
      partOf(cone(0.52, 0.62, 1, 7), 1),
    ]),
  broadleafWhole: () => mergeGeometries([partOf(trunk(0.45), 0), partOf(blob(new THREE.IcosahedronGeometry(1, 1)), 1)]),
  coniferPlain: () => partOf(cone(1, 0.1, 1, 5, true), 1),
  broadleafPlain: () => partOf(blob(new THREE.OctahedronGeometry(1, 0)), 1),
  shadow: () => partOf(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), 1),
};

const TREE_GLSL = /* glsl */ `
  attribute vec4 tree;
  attribute vec4 crown;
  attribute vec3 tint;
  attribute float part;
  attribute float fade;
  uniform float forestTime;
  varying vec3 vTree;
  varying float vShow;
  float treeSeed() { return fract(sin(dot(tree.xz, vec2(12.9898, 78.233))) * 43758.5453); }
  // How much of the tree shows as its square comes in or goes.
  float treeShown() {
    float since = clamp((forestTime - abs(fade)) / ${FADE.toFixed(2)}, 0.0, 1.0);
    return fade < 0.0 ? 1.0 - since : since;
  }
  // The share of trees drawn this far off: all within ${TREES_ALL_WITHIN} m, then falling (treeShare below).
  float treeShare(float far) { return min(1.0, pow(${TREES_ALL_WITHIN.toFixed(1)} / max(far, 1.0), 2.0)); }
  // Whether a tree of this rank is drawn at this share, dissolving in over a little rank: all of them, whole, when all are drawn.
  float treeByRank(float share) { return clamp((share * 1.08 - fract(crown.w)) / 0.08, 0.0, 1.0); }
  // Fewer trees, a little wider each, up to twice: the forest keeps its cover.
  float treeWider(float share) { return clamp(pow(1.0 / max(share, 0.0625), 0.25), 1.0, 2.0); }
`;

/** A pixel shows if the tree's share is above its place in a 4 x 4 pattern: two shares that add up to one share the pixels. */
const DITHER_GLSL = /* glsl */ `
  float treeDither(vec2 p) {
    ivec2 q = ivec2(mod(p, 4.0));
    const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[q.x + q.y * 4] + 0.5) / 16.0;
  }
`;

/** The share of trees drawn this far off, m: the shaders' treeShare. */
const treeShare = (far: number): number => Math.min(1, (TREES_ALL_WITHIN / Math.max(far, 1)) ** 2);

/**
 * Lambert, flat, each tree in its own place, size and colour; the trunk
 * brown. `split`: drawn only nearer than WHOLE (1), or only farther (2).
 */
function bodyMaterial(split: 1 | 2, time: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.forestTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TREE_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `float seed = treeSeed();
        float turn = seed * 6.2831;
        vec2 xz = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * position.xz;
        float far = distance(cameraPosition, tree.xyz + vec3(0.0, tree.w * 0.5, 0.0));
        float share = treeShare(far);
        // Crowns as wide as found, a little more or less; trunks by the tree's height.
        float wide = part > 0.5 ? crown.x * (0.92 + 0.16 * seed) * treeWider(share) : tree.w * 0.022 + 0.08;
        vec3 transformed = vec3(xz.x * wide, position.y * tree.w, xz.y * wide) + tree.xyz;
        // Darker low in the crown, lighter at the tips; each tree a shade of its own.
        vec3 shade = vec3(0.85 + 0.3 * seed, 0.9 + 0.2 * fract(seed * 7.13), 0.85 + 0.25 * fract(seed * 3.71));
        vTree = part > 0.5 ? tint * shade * (0.6 + 0.6 * position.y) : vec3(0.06, 0.04, 0.026);`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vShow = treeShown() * treeByRank(share);
        // Whole near, plain far, the one dissolving into the other across the band.
        float across = smoothstep(${(WHOLE - BAND).toFixed(1)}, ${(WHOLE + BAND).toFixed(1)}, far);
        vShow *= ${split === 1 ? '1.0 - across' : 'across'};
        if (vShow <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTree;\nvarying float vShow;\n${DITHER_GLSL}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nif (vShow < 0.999 && vShow <= treeDither(gl_FragCoord.xy)) discard;\ndiffuseColor.rgb = vTree;',
      );
  };
  material.customProgramCacheKey = () => `forest-body-${split}`;
  return material;
}

/**
 * A soft dark pool on the ground under the crown, a little away from the
 * sun, lying on the slope: it sets the tree on the ground. Not the long
 * shadow the sun casts: the aerial photo has the trees' own, cast at the
 * hour it was taken, and two would cross. Drawn a little nearer the eye
 * along its line of sight, as far again as the coarser ground off in the
 * distance may stand above the true one: the picture is the same, the pool
 * stays on top.
 */
function shadowMaterial(sun: { away: THREE.Vector2; stretch: { value: number } }, time: { value: number }): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0x0c1a08,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -20,
    polygonOffsetUnits: -20,
  });
  material.userData.castShadow = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sunAway = { value: sun.away };
    shader.uniforms.sunStretch = sun.stretch;
    shader.uniforms.forestTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TREE_GLSL}\nuniform vec2 sunAway;\nuniform float sunStretch;\nvarying float vOut;`)
      .replace(
        '#include <begin_vertex>',
        `float share = treeShare(distance(cameraPosition, tree.xyz));
        float wide = crown.x * treeWider(share) * 1.2;
        // Off a little away from the sun, never past the crown's own width.
        vec2 d = sunAway * min(tree.w * 0.2 * sunStretch, wide * 0.6) + position.xz * wide;
        vOut = length(position.xz);
        vec3 transformed = vec3(tree.x + d.x, tree.y + crown.y * d.x + crown.z * d.y + 0.05, tree.z + d.y);
        vShow = treeShown() * treeByRank(share) * (1.0 - smoothstep(${(SHADOWS * 0.75).toFixed(1)}, ${SHADOWS.toFixed(1)}, distance(cameraPosition, tree.xyz)));`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        float eyeFar = max(length(mvPosition.xyz), 1e-3);
        mvPosition.xyz *= max(0.0, eyeFar - (0.2 + 0.004 * eyeFar)) / eyeFar;
        gl_Position = projectionMatrix * mvPosition;
        if (vShow <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShow;\nvarying float vOut;')
      // Dark in the middle, fading out to the rim.
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vShow * (1.0 - smoothstep(0.3, 1.0, vOut));');
  };
  material.customProgramCacheKey = () => 'forest-shadow';
  return material;
}

export interface Forest {
  object: THREE.Group;
  /** A square's model has come in: takes its trees (a Points child), if any, out of it. `frame`: the tiles' own. */
  add(tile: object, scene: THREE.Object3D, frame: THREE.Matrix4): void;
  remove(tile: object): void;
  show(tile: object, shown: boolean): void;
  update(eye: THREE.Vector3, seconds: number): void;
  setSun(sun: THREE.Vector3, strength: number): void;
  /** Trees in the meshes: whole (the cells near the eye), plain (all), shadows (the cells near the eye). */
  stats(): { whole: number; far: number; shadows: number };
  dispose(): void;
}

export function buildForest(): Forest {
  const object = new THREE.Group();
  object.name = 'trees';
  const time = { value: 0 };
  const materials = [bodyMaterial(1, time), bodyMaterial(2, time)] as const;
  const sun = { away: new THREE.Vector2(1, 0), stretch: { value: 1 } };
  const shadowMat = shadowMaterial(sun, time);
  const shapes = {
    coniferWhole: new Shape(SHAPES.coniferWhole(), materials[0]),
    broadleafWhole: new Shape(SHAPES.broadleafWhole(), materials[0]),
    coniferPlain: new Shape(SHAPES.coniferPlain(), materials[1]),
    broadleafPlain: new Shape(SHAPES.broadleafPlain(), materials[1]),
    shadow: new Shape(SHAPES.shadow(), shadowMat),
  };
  shapes.shadow.mesh.renderOrder = 6;
  for (const s of Object.values(shapes)) object.add(s.mesh);
  // Filled as the squares drawn change; as the eye goes.
  const farShapes = [shapes.coniferPlain, shapes.broadleafPlain];
  const nearShapes = [shapes.coniferWhole, shapes.broadleafWhole, shapes.shadow];

  // Each square's trees split by kind, so that a mesh of one shape takes them
  // whole; the box round them all; the lowest rank among them (the first
  // drawn as the eye comes near); gone: the tiles have thrown the square away,
  // its trees go once dissolved.
  interface Square {
    conifers: Grove;
    broadleaves: Grove;
    box: THREE.Box3;
    lowest: number;
    gone: boolean;
  }
  const groves = new Map<object, Square>();
  // The squares the tiles show; the trees of those and of every coarser square above them are drawn.
  const visible = new Set<object>();
  let regroup = false;
  /** The squares drawn have changed: every mesh is filled again. */
  let dirty = true;
  let shadows = false;
  const sortedAt = new THREE.Vector3(Infinity, 0, 0);
  const v = new THREE.Vector3();
  const color = new THREE.Color();

  /** Shown, or still going. */
  const drawn = (g: Grove): boolean => g.shown || g.goingUntil > time.value;
  /** Marks a grove's trees coming in or going from now. */
  const fadeAll = (g: Grove, coming: boolean): void => {
    // Never 0, which reads as shown.
    const mark = Math.max(1e-3, time.value) * (coming ? 1 : -1);
    for (let k = 0; k < g.count; k++) g.data[k * STRIDE + 11] = mark;
  };

  /**
   * Whether any of a square's trees are drawn at its distance (treeByRank),
   * or will be before the squares are looked at again, the eye RESORT nearer.
   */
  const anyDrawn = (q: Square, far: number): boolean => treeShare(Math.max(1, far - RESORT)) * 1.08 > q.lowest;

  /** Every tree drawn, in the plain meshes. */
  const fillFar = (): void => {
    for (const s of farShapes) s.begin();
    for (const { conifers, broadleaves } of groves.values()) {
      if (!drawn(conifers)) continue;
      if (conifers.count) shapes.coniferPlain.push(conifers.data, 0, conifers.count, conifers.box);
      if (broadleaves.count) shapes.broadleafPlain.push(broadleaves.data, 0, broadleaves.count, broadleaves.box);
    }
    for (const s of farShapes) s.end();
  };

  /** The trees of the cells near the eye, in the whole meshes; their shadows. */
  const fillNear = (eye: THREE.Vector3): void => {
    for (const s of nearShapes) s.begin();
    for (const { conifers, broadleaves, box } of groves.values()) {
      if (!drawn(conifers) || box.distanceToPoint(eye) > Math.max(NEAR_CELL, SHADOWS + RESORT)) continue;
      for (const [g, whole] of [
        [conifers, shapes.coniferWhole],
        [broadleaves, shapes.broadleafWhole],
      ] as const) {
        for (const c of g.cells) {
          const far = c.box.distanceToPoint(eye);
          if (far < NEAR_CELL) whole.push(g.data, c.start, c.count, c.box);
          // They fade out with distance tree by tree (shadowMaterial).
          if (shadows && far < SHADOWS + RESORT) shapes.shadow.push(g.data, c.start, c.count, c.box);
        }
      }
    }
    for (const s of nearShapes) s.end();
  };

  const grove = (count: number): Grove => ({
    count: 0,
    data: new Float32Array(count * STRIDE),
    box: new THREE.Box3(),
    cells: [],
    shown: false,
    goingUntil: 0,
  });

  /** Puts a grove's trees in order of their cells, and marks out each cell's run. */
  const intoCells = (g: Grove): void => {
    const keys = new Float64Array(g.count);
    const order = new Uint32Array(g.count);
    for (let k = 0; k < g.count; k++) {
      keys[k] = Math.floor(g.data[k * STRIDE]! / CELL) * 1e6 + Math.floor(g.data[k * STRIDE + 2]! / CELL);
      order[k] = k;
    }
    order.sort((a, b) => keys[a]! - keys[b]!);
    const sorted = new Float32Array(g.data.length);
    for (let k = 0; k < g.count; k++) sorted.set(g.data.subarray(order[k]! * STRIDE, (order[k]! + 1) * STRIDE), k * STRIDE);
    g.data = sorted;
    for (let k = 0; k < g.count; k++) {
      const key = keys[order[k]!]!;
      let cell = g.cells[g.cells.length - 1];
      if (!cell || key !== keys[order[cell.start]!]) {
        cell = { start: k, count: 0, box: new THREE.Box3() };
        g.cells.push(cell);
      }
      cell.count++;
      cell.box.expandByPoint(v.set(sorted[k * STRIDE]!, sorted[k * STRIDE + 1]!, sorted[k * STRIDE + 2]!));
    }
    for (const cell of g.cells) cell.box.max.y += 50;
  };

  return {
    object,
    add(tile, scene, frame) {
      let found: THREE.Points | null = null;
      scene.traverse((node) => {
        if ((node as THREE.Points).isPoints) found = node as THREE.Points;
      });
      const points = found as THREE.Points | null;
      if (!points) return;
      const geometry = points.geometry;
      const position = geometry.attributes.position!;
      const shape = geometry.attributes._shape!;
      const slope = geometry.attributes._slope!;
      const tint = geometry.attributes.color!;
      // Where the points stand in the world: the tiles' frame, the square's, then the glTF nodes' down to the points.
      const m = new THREE.Matrix4();
      for (let n: THREE.Object3D | null = points; n; n = n === scene ? null : n.parent) {
        if (n !== scene) n.updateMatrix();
        m.premultiply(n.matrix);
      }
      m.premultiply(frame);
      const count = position.count;
      const conifers = grove(count);
      const broadleaves = grove(count);
      let lowest = 1;
      for (let k = 0; k < count; k++) {
        v.fromBufferAttribute(position, k).applyMatrix4(m);
        const conifer = shape.getZ(k) > 0.5;
        const g = conifer ? conifers : broadleaves;
        // The photo's colour of the crown, seen from above in its shade, leaning to the kind's own green.
        color.setRGB(tint.getX(k), tint.getY(k), tint.getZ(k), THREE.SRGBColorSpace);
        const base = conifer ? [0.016, 0.04, 0.02] : [0.045, 0.085, 0.022];
        const o = g.count * STRIDE;
        const d = g.data;
        d[o] = v.x;
        d[o + 1] = v.y;
        d[o + 2] = v.z;
        d[o + 3] = shape.getX(k);
        d[o + 4] = shape.getY(k);
        d[o + 5] = slope.getX(k);
        d[o + 6] = slope.getY(k);
        const rank = Math.min(0.999, shape.getW(k));
        lowest = Math.min(lowest, rank);
        d[o + 7] = rank + (conifer ? 1 : 0);
        d[o + 8] = base[0]! * 0.45 + color.r * 0.55;
        d[o + 9] = base[1]! * 0.45 + color.g * 0.55;
        d[o + 10] = base[2]! * 0.45 + color.b * 0.5;
        d[o + 11] = 0;
        g.box.expandByPoint(v);
        g.count++;
      }
      // Up to the tallest top.
      for (const g of [conifers, broadleaves]) {
        g.box.max.y += 50;
        intoCells(g);
      }
      points.removeFromParent();
      geometry.dispose();
      const box = conifers.box.clone().union(broadleaves.box);
      groves.set(tile, { conifers, broadleaves, box, lowest, gone: false });
      regroup = true;
    },
    remove(tile) {
      visible.delete(tile);
      const q = groves.get(tile);
      if (!q) return;
      q.gone = true;
      regroup = true;
    },
    show(tile, shown) {
      if (shown) visible.add(tile);
      else visible.delete(tile);
      regroup = true;
    },
    update(eye, seconds) {
      time.value = seconds;
      const moved = eye.distanceTo(sortedAt) > RESORT;
      if (regroup || moved) {
        regroup = false;
        // The squares shown and every coarser one above them.
        const wanted = new Set<object>();
        for (const tile of visible) {
          for (let t: { parent?: object | null } | null | undefined = tile as { parent?: object | null }; t && !wanted.has(t); t = t.parent as typeof t) {
            wanted.add(t);
          }
        }
        for (const [tile, q] of groves) {
          const far = q.box.distanceToPoint(eye);
          const shown = !q.gone && anyDrawn(q, far) && (far < KEEP || wanted.has(tile));
          if (q.conifers.shown === shown) continue;
          for (const grove of [q.conifers, q.broadleaves]) {
            grove.shown = shown;
            // Going: kept a moment longer, dissolving.
            grove.goingUntil = shown ? 0 : seconds + FADE;
            fadeAll(grove, shown);
          }
          dirty = true;
        }
      }
      // A square gone by now leaves the meshes; one the tiles have thrown away, the forest.
      for (const [tile, { conifers, gone }] of groves) {
        if (!conifers.shown && conifers.goingUntil > 0 && conifers.goingUntil <= seconds) {
          conifers.goingUntil = 0;
          dirty = true;
        }
        if (gone && !drawn(conifers)) groves.delete(tile);
      }
      if (dirty) fillFar();
      // The cells near the eye again, once it has gone some way.
      if (dirty || moved) {
        fillNear(eye);
        sortedAt.copy(eye);
      }
      dirty = false;
    },
    setSun(direction, strength) {
      const flat = Math.max(1e-3, Math.hypot(direction.x, direction.z));
      // A low sun sets the pool further off the trunk.
      sun.stretch.value = Math.min(2, flat / Math.max(0.2, direction.y));
      sun.away.set(-direction.x / flat, -direction.z / flat);
      shadowMat.opacity = 0.45 * strength;
      const on = strength > 0.02;
      if (on !== shadows) {
        shadows = on;
        dirty = true;
      }
    },
    stats: () => ({
      whole: shapes.coniferWhole.count + shapes.broadleafWhole.count,
      far: shapes.coniferPlain.count + shapes.broadleafPlain.count,
      shadows: shapes.shadow.count,
    }),
    dispose() {
      for (const s of Object.values(shapes)) s.mesh.geometry.dispose();
      for (const m of materials) m.dispose();
      shadowMat.dispose();
    },
  };
}
