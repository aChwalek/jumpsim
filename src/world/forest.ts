// The trees the terrain's tiles carry (tools/tiles: one per crown of the
// LiDAR's canopy, where the photo shows them), drawn all together whichever
// square brought them: one draw per shape. Near the eye a tree is drawn
// whole, trunk and tiers of crown; further off plainly; its shadow lies on
// the slope under it.
//
// The squares near the eye put their trees in both a whole and a plain mesh,
// and the graphics card draws each tree in one of them by its distance; the
// others only in plain meshes. The meshes are filled again only when the
// squares shown change, or one comes near or goes away: not as the eye moves.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Nearer than this, m, a tree is drawn whole; farther, plainly; over BAND either side, the one dissolves into the other. */
const WHOLE = 350;
const BAND = 30;
/** How long a square's trees take to come in or go, s: when a square is split into four finer ones, the one set dissolves into the other. */
const FADE = 0.5;
/** A square this close, m, has its trees in the whole meshes too. */
const NEAR_SQUARE = WHOLE + BAND + 200;
/** Squares nearer than this lay their trees' shadows, m. */
const SHADOWS = 1600;
/** How far the eye goes before the squares are sorted near and far again, m. */
const RESORT = 40;

/**
 * x, y, z, height | radius, slope x, slope z, conifer | r, g, b | fade: 12
 * floats a tree. Fade: 0 shown; t > 0 coming in since t (s); t < 0 going since -t.
 */
const STRIDE = 12;

/** A square's trees of one kind, in the world, and the box round them. */
interface Grove {
  count: number;
  data: Float32Array;
  box: THREE.Box3;
  shown: boolean;
  /** Hidden, but still going until then, s. */
  goingUntil: number;
  near: boolean;
  shadows: boolean;
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

  /** Adds a grove's trees, all of them. */
  pushAll(grove: Grove): void {
    const needed = this.count + grove.count;
    if (needed > this.capacity) {
      const old = this.array;
      while (this.capacity < needed) this.capacity *= 2;
      this.attach(this.capacity);
      this.array.set(old.subarray(0, this.count * STRIDE));
    }
    this.array.set(grove.data.subarray(0, grove.count * STRIDE), this.count * STRIDE);
    this.count = needed;
    const b = this.bounds;
    const { min, max } = grove.box;
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
  shadow: () => partOf(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), 1),
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
`;

/** A pixel shows if the tree's share is above its place in a 4 x 4 pattern: two shares that add up to one share the pixels. */
const DITHER_GLSL = /* glsl */ `
  float treeDither(vec2 p) {
    ivec2 q = ivec2(mod(p, 4.0));
    const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[q.x + q.y * 4] + 0.5) / 16.0;
  }
`;

/**
 * Lambert, flat, each tree in its own place, size and colour; the trunk
 * brown. `split`: drawn only nearer than WHOLE (1), only farther (2), or at any distance (0).
 */
function bodyMaterial(split: 0 | 1 | 2, time: { value: number }): THREE.MeshLambertMaterial {
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
        // Crowns as wide as found, a little more or less; trunks by the tree's height.
        float wide = part > 0.5 ? crown.x * (0.92 + 0.16 * seed) : tree.w * 0.022 + 0.08;
        vec3 transformed = vec3(xz.x * wide, position.y * tree.w, xz.y * wide) + tree.xyz;
        // Darker low in the crown, lighter at the tips; each tree a shade of its own.
        vec3 shade = vec3(0.85 + 0.3 * seed, 0.9 + 0.2 * fract(seed * 7.13), 0.85 + 0.25 * fract(seed * 3.71));
        vTree = part > 0.5 ? tint * shade * (0.6 + 0.6 * position.y) : vec3(0.06, 0.04, 0.026);`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vShow = treeShown();
        ${
          split === 0
            ? ''
            : `// Whole near, plain far, the one dissolving into the other across the band.
          float across = smoothstep(${(WHOLE - BAND).toFixed(1)}, ${(WHOLE + BAND).toFixed(1)}, distance(cameraPosition, tree.xyz + vec3(0.0, tree.w * 0.5, 0.0)));
          vShow *= ${split === 1 ? '1.0 - across' : 'across'};`
        }
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

/** A dark pool on the ground, stretched away from the sun, lying on the slope under the tree. */
function shadowMaterial(sun: { away: THREE.Vector2; stretch: { value: number } }, time: { value: number }): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0x0c1a08,
    transparent: true,
    opacity: 0.38,
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
      .replace('#include <common>', `#include <common>\n${TREE_GLSL}\nuniform vec2 sunAway;\nuniform float sunStretch;`)
      .replace(
        '#include <begin_vertex>',
        `float reach = tree.w * 0.55 * sunStretch;
        vec2 side = vec2(-sunAway.y, sunAway.x);
        vec2 d = sunAway * (position.x * (crown.x + reach) + reach) + side * (position.z * crown.x * 1.05);
        vec3 transformed = vec3(tree.x + d.x, tree.y + crown.y * d.x + crown.z * d.y + 0.05, tree.z + d.y);
        vShow = treeShown();`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vShow;');
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
  /** Trees in the meshes: near squares' (whole or plain by distance), far squares', shadows. */
  stats(): { near: number; far: number; shadows: number };
  dispose(): void;
}

export function buildForest(): Forest {
  const object = new THREE.Group();
  object.name = 'trees';
  const time = { value: 0 };
  const materials = [bodyMaterial(1, time), bodyMaterial(2, time), bodyMaterial(0, time)] as const;
  const sun = { away: new THREE.Vector2(1, 0), stretch: { value: 1 } };
  const shadowMat = shadowMaterial(sun, time);
  const shapes = {
    coniferWhole: new Shape(SHAPES.coniferWhole(), materials[0]),
    broadleafWhole: new Shape(SHAPES.broadleafWhole(), materials[0]),
    coniferNearPlain: new Shape(SHAPES.coniferPlain(), materials[1]),
    broadleafNearPlain: new Shape(SHAPES.broadleafPlain(), materials[1]),
    coniferPlain: new Shape(SHAPES.coniferPlain(), materials[2]),
    broadleafPlain: new Shape(SHAPES.broadleafPlain(), materials[2]),
    shadow: new Shape(SHAPES.shadow(), shadowMat),
  };
  shapes.shadow.mesh.renderOrder = 6;
  for (const s of Object.values(shapes)) object.add(s.mesh);

  // Each square's trees split by kind, so that a mesh of one shape takes them whole.
  const groves = new Map<object, { conifers: Grove; broadleaves: Grove }>();
  let dirty = true;
  let shadows = false;
  const sortedAt = new THREE.Vector3(Infinity, 0, 0);
  const v = new THREE.Vector3();
  const color = new THREE.Color();

  const place = (g: Grove, eye: THREE.Vector3): boolean => {
    const d = g.box.distanceToPoint(eye);
    const near = d < NEAR_SQUARE;
    const shade = d < SHADOWS;
    const changed = near !== g.near || shade !== g.shadows;
    g.near = near;
    g.shadows = shade;
    return changed;
  };

  /** Shown, or still going. */
  const drawn = (g: Grove): boolean => g.shown || g.goingUntil > time.value;
  /** Marks a grove's trees coming in or going from now. */
  const fadeAll = (g: Grove, coming: boolean): void => {
    // Never 0, which reads as shown.
    const mark = Math.max(1e-3, time.value) * (coming ? 1 : -1);
    for (let k = 0; k < g.count; k++) g.data[k * STRIDE + 11] = mark;
  };

  const fill = (): void => {
    for (const s of Object.values(shapes)) s.begin();
    for (const { conifers, broadleaves } of groves.values()) {
      if (!drawn(conifers)) continue;
      for (const [g, conifer] of [
        [conifers, true],
        [broadleaves, false],
      ] as const) {
        if (!g.count) continue;
        if (g.near) {
          (conifer ? shapes.coniferWhole : shapes.broadleafWhole).pushAll(g);
          (conifer ? shapes.coniferNearPlain : shapes.broadleafNearPlain).pushAll(g);
        } else (conifer ? shapes.coniferPlain : shapes.broadleafPlain).pushAll(g);
        if (shadows && g.shadows) shapes.shadow.pushAll(g);
      }
    }
    for (const s of Object.values(shapes)) s.end();
  };

  const grove = (count: number): Grove => ({
    count: 0,
    data: new Float32Array(count * STRIDE),
    box: new THREE.Box3(),
    shown: false,
    goingUntil: 0,
    near: false,
    shadows: false,
  });

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
        d[o + 7] = conifer ? 1 : 0;
        d[o + 8] = base[0]! * 0.45 + color.r * 0.55;
        d[o + 9] = base[1]! * 0.45 + color.g * 0.55;
        d[o + 10] = base[2]! * 0.45 + color.b * 0.5;
        d[o + 11] = 0;
        g.box.expandByPoint(v);
        g.count++;
      }
      // Up to the tallest top.
      for (const g of [conifers, broadleaves]) g.box.max.y += 50;
      points.removeFromParent();
      geometry.dispose();
      groves.set(tile, { conifers, broadleaves });
    },
    remove(tile) {
      const g = groves.get(tile);
      if (!g) return;
      groves.delete(tile);
      if (drawn(g.conifers)) dirty = true;
    },
    show(tile, shown) {
      const g = groves.get(tile);
      if (!g || g.conifers.shown === shown) return;
      for (const grove of [g.conifers, g.broadleaves]) {
        grove.shown = shown;
        // Going: kept a moment longer, dissolving.
        grove.goingUntil = shown ? 0 : time.value + FADE;
        fadeAll(grove, shown);
      }
      dirty = true;
    },
    update(eye, seconds) {
      time.value = seconds;
      // The squares near and far again, once the eye has gone some way: refill only if one has crossed over.
      if (dirty || eye.distanceTo(sortedAt) > RESORT) {
        for (const { conifers, broadleaves } of groves.values()) {
          if (!drawn(conifers)) continue;
          if (place(conifers, eye)) dirty = true;
          if (place(broadleaves, eye)) dirty = true;
        }
        sortedAt.copy(eye);
      }
      // A square gone by now leaves the meshes.
      for (const { conifers } of groves.values()) {
        if (!conifers.shown && conifers.goingUntil > 0 && conifers.goingUntil <= seconds) {
          conifers.goingUntil = 0;
          dirty = true;
        }
      }
      if (!dirty) return;
      fill();
      dirty = false;
    },
    setSun(direction, strength) {
      const flat = Math.max(1e-3, Math.hypot(direction.x, direction.z));
      sun.stretch.value = Math.min(3, flat / Math.max(0.2, direction.y));
      sun.away.set(-direction.x / flat, -direction.z / flat);
      shadowMat.opacity = 0.38 * strength;
      const on = strength > 0.02;
      if (on !== shadows) {
        shadows = on;
        dirty = true;
      }
    },
    stats: () => ({
      near: shapes.coniferWhole.count + shapes.broadleafWhole.count,
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
