// The jump plane, as seen from its door and from below once out: a Pilatus
// PC-6 Porter, a Dornier Do 28 G92, a C-130 Hercules or an AS350 Écureuil
// helicopter, built from boxes at true size. The cabin is open on the door's
// side, and lined inside, since the jumper starts in it, in that doorway or
// on the step under it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SKID_OUT, type Aircraft, type AircraftId, type Plane } from '../sim/plane';

const WHITE = 0xf1f1ee;
const STRIPE = 0x1f4f9a;
const BELLY = 0xa9adb2;
const LINING = 0x41454b;
const FLOOR = 0x2a2c2f;
const GLASS = 0x1b2530;
const METAL = 0x6d7278;
const TYRE = 0x1a1a1a;
const RED = 0xc8202a;
const GREY = 0x7d848a;
const GREY_DARK = 0x60666c;
const WEBBING = 0x8a2f27;
const YELLOW = 0xd9b324;
const GREEN_LIGHT = 0x3be05a;
const HELI_RED = 0xb52a22;
const HELI_BELLY = 0x2e3135;

function tint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  // Every part must carry the same attributes to be merged into one mesh.
  g.deleteAttribute('uv');
  const color = new THREE.Color(hex);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A box between two corners. */
function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number): THREE.BufferGeometry {
  return tint(
    new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    hex,
  );
}

/**
 * A solid whose cross-sections are rectangles, from one at z0 to another at
 * z1, each given by its half width and its bottom and top.
 */
function taper(
  z0: number,
  a: { w: number; y0: number; y1: number },
  z1: number,
  b: { w: number; y0: number; y1: number },
  hex: number,
): THREE.BufferGeometry {
  const v = [
    [-a.w, a.y0, z0], [a.w, a.y0, z0], [a.w, a.y1, z0], [-a.w, a.y1, z0],
    [-b.w, b.y0, z1], [b.w, b.y0, z1], [b.w, b.y1, z1], [-b.w, b.y1, z1],
  ];
  // Quads as corner indices, wound to face out.
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], // ends
    [0, 1, 5, 4], [3, 7, 6, 2], // bottom, top
    [0, 4, 7, 3], [1, 2, 6, 5], // left, right
  ];
  const positions: number[] = [];
  for (const [p, q, r, s] of faces) {
    for (const k of [p, q, r, p, r, s]) positions.push(...v[k!]!);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return tint(geometry, hex);
}

/** A round rod from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, hex: number): THREE.BufferGeometry {
  const along = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.CylinderGeometry(radius, radius, along.length(), 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tint(geometry, hex);
}

function wheel(x: number, y: number, z: number, radius = 0.3): THREE.BufferGeometry {
  return tint(new THREE.CylinderGeometry(radius, radius, radius * 0.57, 16).rotateZ(Math.PI / 2).translate(x, y, z), TYRE);
}

/** Corners along x of a slab `a` to `b` out from the middle on one side (+1 right, -1 left). */
const out = (side: number, a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * The box of the cabin from `front` to `back`: floor, belly, roof, the walls
 * with the door cut in one, the lining inside, a stripe and windows down
 * each side, and the step under the door with a handle on its frame.
 */
function cabin(
  a: Aircraft,
  front: number,
  back: number,
  bottom: number,
  windows: number[],
  livery: { stripe: number; belly: number; skin?: number },
): THREE.BufferGeometry[] {
  const { halfWidth: w, height: h } = a.cabin;
  const { door, doorSide: s } = a;
  const skin = 0.03;
  const top = h + 0.08;
  const paint = livery.skin ?? WHITE;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(slab(-w, w, -0.05, 0, front, back, FLOOR));
  parts.push(slab(-w - skin, w + skin, bottom, -0.05, front, back, livery.belly));
  parts.push(slab(-w - skin, w + skin, h, top, front, back, paint));
  // The wall across from the door, then the one around it.
  parts.push(slab(...out(-s, w, w + skin), -0.05, h, front, back, paint));
  parts.push(slab(...out(s, w, w + skin), -0.05, h, front, door.front, paint));
  parts.push(slab(...out(s, w, w + skin), -0.05, h, door.back, back, paint));
  parts.push(slab(...out(s, w, w + skin), door.top, h, door.front, door.back, paint));
  // The lining inside, darker, so the cabin reads as a cabin.
  parts.push(slab(...out(-s, w - 0.02, w), 0, h, front, back, LINING));
  parts.push(slab(...out(s, w - 0.02, w), 0, h, front, door.front, LINING));
  parts.push(slab(...out(s, w - 0.02, w), 0, h, door.back, back, LINING));
  parts.push(slab(...out(s, w - 0.02, w), door.top, h, door.front, door.back, LINING));
  parts.push(slab(-w, w, h - 0.02, h, front, back, LINING));
  parts.push(slab(-w, w, 0, h, back - 0.02, back, LINING));
  parts.push(slab(-w, w, 0, h, front, front + 0.02, LINING));
  for (const side of [-1, 1]) {
    const x = out(side, w + skin, w + skin + 0.005);
    parts.push(slab(...x, 0.38, 0.5, front, back, livery.stripe));
    for (const z of windows) {
      if (side === s && z + 0.35 > door.front && z - 0.35 < door.back) continue;
      parts.push(slab(...x, 0.72, 1.12, z - 0.3, z + 0.3, GLASS));
    }
  }
  // The step, braced from the floor's edge, and a handle up the front of the frame outside.
  const step = a.step;
  parts.push(slab(...out(s, w + skin, w + step.out), step.top - 0.035, step.top, step.front, step.back, METAL));
  for (const z of [step.front + 0.06, step.back - 0.06]) {
    parts.push(rod(v(s * (w + skin), -0.02, z), v(s * (w + step.out - 0.04), step.top - 0.03, z), 0.02, METAL));
  }
  const grip = s * (w + skin + 0.045);
  parts.push(rod(v(grip, 0.35, door.front - 0.07), v(grip, door.top - 0.15, door.front - 0.07), 0.016, METAL));
  for (const y of [0.35, door.top - 0.15]) parts.push(rod(v(s * (w + skin), y, door.front - 0.07), v(grip, y, door.front - 0.07), 0.016, METAL));
  return parts;
}

/** A fin standing on the tail, given as triangles of (z, y) corners. */
function fin(corners: number[], hex: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const x of [-0.04, 0.04]) {
    for (let i = 0; i < corners.length; i += 2) positions.push(x, corners[i + 1]!, corners[i]!);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return tint(geometry, hex);
}

/** The Pilatus PC-6 Turbo Porter: long nose, strut-braced wing, tricycle gear as drawn here. */
function buildPorter(a: Aircraft): THREE.BufferGeometry[] {
  const w = a.cabin.halfWidth;
  const top = a.cabin.height + 0.08;
  const skin = 0.03;
  const front = -2.6;
  const back = 2.6;
  const bottom = -0.4;
  const parts = cabin(a, front, back, bottom, [-1.7, -0.7, 0.3, 2.15], { stripe: STRIPE, belly: BELLY });

  // Cockpit glass, engine cowling, spinner.
  parts.push(taper(front, { w: w + skin, y0: bottom, y1: top }, front - 0.7, { w: 0.7, y0: -0.3, y1: 1.05 }, WHITE));
  parts.push(slab(-0.62, 0.62, 1.07, 1.45, front - 0.55, front - 0.05, GLASS));
  parts.push(taper(front - 0.7, { w: 0.7, y0: -0.3, y1: 1.05 }, front - 2.1, { w: 0.42, y0: 0.05, y1: 0.85 }, WHITE));
  parts.push(slab(-0.72, -0.7, 0.2, 0.32, front - 1.9, front - 0.8, STRIPE));
  parts.push(slab(0.7, 0.72, 0.2, 0.32, front - 1.9, front - 0.8, STRIPE));
  parts.push(tint(new THREE.ConeGeometry(0.24, 0.45, 12).rotateX(-Math.PI / 2).translate(0, 0.45, front - 2.32), METAL));

  // Tail cone, fin and tailplane.
  parts.push(taper(back, { w: w + skin, y0: bottom, y1: top }, 7.4, { w: 0.14, y0: 0.75, y1: 1.12 }, WHITE));
  parts.push(taper(6.0, { w: 0.05, y0: 1.0, y1: 1.05 }, 7.4, { w: 0.05, y0: 1.0, y1: 1.05 }, WHITE));
  parts.push(fin([5.5, 1.0, 7.4, 1.0, 7.6, 3.1, 5.5, 1.0, 7.6, 3.1, 6.9, 3.1], WHITE));
  parts.push(slab(-2.9, 2.9, 0.84, 0.9, 6.2, 7.3, WHITE));

  // The wing on top, its struts, and the wheels.
  parts.push(slab(-7.9, 7.9, top, top + 0.14, -2.2, -0.35, WHITE));
  parts.push(slab(-7.9, -7.7, top - 0.02, top + 0.16, -2.25, -0.3, STRIPE));
  parts.push(slab(7.7, 7.9, top - 0.02, top + 0.16, -2.25, -0.3, STRIPE));
  for (const side of [-1, 1]) {
    parts.push(rod(v(side * (w + 0.02), 0.05, -1.2), v(side * 4.7, top, -1.2), 0.05, WHITE));
    parts.push(rod(v(side * (w - 0.1), bottom, 0.25), v(side * 1.55, -1.05, 0.25), 0.05, METAL));
    parts.push(wheel(side * 1.62, -1.1, 0.25));
  }
  parts.push(rod(v(0, -0.2, front - 1.2), v(0, -1.05, front - 1.2), 0.05, METAL));
  parts.push(wheel(0, -1.12, front - 1.2));
  return parts;
}

/**
 * The Dornier Do 28 G92: a tall narrow box of a cabin under a straight
 * unbraced wing, a short glazed nose, the two turboprops on stub wings
 * either side of it with the main wheels under them, and a tail wheel. In
 * white with a red nose, fin and wing tips.
 */
function buildDornier(a: Aircraft): THREE.BufferGeometry[] {
  const w = a.cabin.halfWidth;
  const top = a.cabin.height + 0.08;
  const skin = 0.03;
  const front = -2.3;
  const back = 2.6;
  const bottom = -0.35;
  const parts = cabin(a, front, back, bottom, [-1.75, -0.85, 0.8, 1.95], { stripe: RED, belly: WHITE });

  // The nose, its windscreen and its red cap.
  const nose = { w: 0.6, y0: -0.2, y1: 1.15 };
  parts.push(taper(front, { w: w + skin, y0: bottom, y1: top }, front - 0.8, nose, WHITE));
  parts.push(slab(-0.6, 0.6, 1.08, 1.5, front - 0.5, front - 0.02, GLASS));
  parts.push(taper(front - 0.8, nose, front - 1.4, { w: 0.32, y0: 0.15, y1: 0.75 }, RED));

  // Tail cone, the tall fin and the tailplane.
  parts.push(taper(back, { w: w + skin, y0: bottom, y1: top }, 7.7, { w: 0.12, y0: 0.9, y1: 1.3 }, WHITE));
  parts.push(fin([5.4, 1.25, 7.7, 1.25, 7.9, 3.7, 5.4, 1.25, 7.9, 3.7, 7.05, 3.7], RED));
  parts.push(slab(-3.2, 3.2, 1.0, 1.06, 6.5, 7.6, WHITE));
  parts.push(slab(-3.2, -2.9, 0.99, 1.07, 6.48, 7.62, RED));
  parts.push(slab(2.9, 3.2, 0.99, 1.07, 6.48, 7.62, RED));

  // The wing, red at the tips.
  parts.push(slab(-7.78, 7.78, top, top + 0.16, -2.1, -0.2, WHITE));
  parts.push(slab(-7.8, -7.5, top - 0.01, top + 0.17, -2.12, -0.18, RED));
  parts.push(slab(7.5, 7.8, top - 0.01, top + 0.17, -2.12, -0.18, RED));

  for (const hub of a.propellers) {
    const x = hub.x;
    const y = hub.y;
    // Stub wing out to the engine, then the nacelle and its spinner.
    parts.push(slab(...out(Math.sign(x), w, Math.abs(x)), y - 0.18, y - 0.05, -2.0, -0.6, WHITE));
    parts.push(taper(hub.z + 0.25, { w: 0.24, y0: y - 0.24, y1: y + 0.22 }, hub.z + 1.1, { w: 0.3, y0: y - 0.32, y1: y + 0.3 }, WHITE).translate(x, 0, 0));
    parts.push(taper(hub.z + 1.1, { w: 0.3, y0: y - 0.32, y1: y + 0.3 }, -0.2, { w: 0.12, y0: y - 0.1, y1: y + 0.08 }, WHITE).translate(x, 0, 0));
    parts.push(tint(new THREE.ConeGeometry(0.17, 0.4, 12).rotateX(-Math.PI / 2).translate(x, y, hub.z + 0.05), METAL));
    // The main leg under it, and its wheel.
    parts.push(rod(v(x, y - 0.3, -1.6), v(x, -0.95, -1.45), 0.06, METAL));
    parts.push(wheel(x, -1.0, -1.45, 0.32));
  }
  parts.push(rod(v(0, 0.95, 7.0), v(0, 0.55, 7.15), 0.04, METAL));
  parts.push(wheel(0, 0.5, 7.15, 0.13));
  return parts;
}

/** One half of a wing out along +x (`side` 1) or -x, from the root to the tip, its chord along z. */
function wingHalf(side: 1 | -1, span: number, root: { w: number; y0: number; y1: number }, tip: { w: number; y0: number; y1: number }, z: number, hex: number) {
  // Built along z, then turned a quarter round to lie along x.
  return taper(0, root, span, tip, hex)
    .rotateY((side * Math.PI) / 2)
    .translate(0, 0, z);
}

/**
 * The Lockheed C-130 Hercules: a deep box of a hold under a high wing with
 * four turboprops, the ramp at the back lowered level with the floor and the
 * cargo door up into the upswept tail, so the back of the hold is open. In
 * grey, the hold lined, its seats folded up against the walls, the green light
 * over the hinge of the ramp.
 */
function buildHercules(a: Aircraft): THREE.BufferGeometry[] {
  const { halfWidth: w, height: h } = a.cabin;
  const r = a.ramp!;
  const W = w + 0.6;
  const belly = -1.2;
  const roof = h + 0.5;
  const parts: THREE.BufferGeometry[] = [];

  // The floor of the hold, its rails, and the ramp with its treads and a yellow edge.
  parts.push(slab(-w, w, -0.06, 0, r.front, r.hinge, FLOOR));
  for (const x of [-0.85, 0.85]) parts.push(slab(x - 0.06, x + 0.06, 0, 0.015, r.front, r.end - 0.2, METAL));
  parts.push(slab(-w, w, -0.14, 0, r.hinge, r.end, GREY_DARK));
  for (let z = r.hinge + 0.3; z < r.end - 0.2; z += 0.35) parts.push(slab(-w + 0.1, w - 0.1, 0, 0.012, z, z + 0.06, FLOOR));
  parts.push(slab(-w, w, 0, 0.016, r.end - 0.18, r.end, YELLOW));

  // The shell: under the floor, the walls either side from the front of the hold to the end of the ramp, the roof.
  parts.push(slab(-W, W, belly, -0.06, r.front, r.hinge, GREY));
  parts.push(taper(r.hinge, { w: W, y0: belly, y1: -0.14 }, r.end, { w: W - 0.2, y0: -0.4, y1: -0.14 }, GREY));
  for (const side of [-1, 1]) {
    parts.push(slab(...out(side, w, W), -0.14, roof, r.front, r.end, GREY));
    // The lining, ribs every metre and a half, and the seats folded up against it.
    parts.push(slab(...out(side, w - 0.02, w), 0, h, r.front, r.end, LINING));
    for (let z = r.front + 0.8; z < r.end; z += 1.5) parts.push(slab(...out(side, w - 0.07, w), 0, h, z, z + 0.08, METAL));
    parts.push(slab(...out(side, w - 0.12, w - 0.02), 0.45, 1.35, r.front + 1.0, r.hinge - 0.6, WEBBING));
    // Portholes down the side, and the paratroop door just ahead of the ramp.
    const x = out(side, W, W + 0.005);
    for (let z = r.front + 1.2; z < r.hinge - 3; z += 2.2) parts.push(slab(...x, 1.55, 1.9, z, z + 0.32, GLASS));
    parts.push(slab(...x, 0.05, 1.95, r.hinge - 2.2, r.hinge - 1.2, GREY_DARK));
    // The sponsons that take the main gear up, low on the sides under the wing.
    parts.push(slab(...out(side, W - 0.1, W + 0.5), belly + 0.1, 0.6, -2.8, 2.6, GREY));
  }
  parts.push(slab(-W, W, h, roof, r.front, r.end, GREY));
  parts.push(slab(-w, w, h - 0.02, h, r.front, r.end, LINING));
  parts.push(slab(-w, w, 0, h, r.front, r.front + 0.02, LINING));
  // The light over the hinge of the ramp: green, it is time.
  parts.push(slab(-0.12, 0.12, h - 0.14, h - 0.02, r.hinge - 0.05, r.hinge + 0.05, GREEN_LIGHT));

  // The flight deck ahead and above the hold, its windscreen, the nose.
  const deck = { w: W - 0.15, y0: belly + 0.2, y1: roof - 0.05 };
  parts.push(taper(r.front, { w: W, y0: belly, y1: roof }, r.front - 2.8, deck, GREY));
  const brow = { w: W - 0.6, y0: belly + 0.5, y1: roof - 0.75 };
  parts.push(taper(r.front - 2.8, deck, r.front - 3.8, brow, GREY));
  parts.push(slab(-1.45, 1.45, roof - 0.85, roof - 0.15, r.front - 3.7, r.front - 2.9, GLASS));
  parts.push(taper(r.front - 3.8, brow, r.front - 5.7, { w: 0.45, y0: 0.4, y1: 1.4 }, GREY_DARK));

  // The tail: swept up from the end of the ramp over the opening, the tall fin, the tailplane.
  parts.push(taper(r.end, { w: W, y0: h - 0.6, y1: roof }, r.end + 8.3, { w: 0.35, y0: roof - 0.3, y1: roof + 0.25 }, GREY));
  const fz = r.end + 3;
  parts.push(fin([fz, roof, fz + 5.6, roof, fz + 5.9, roof + 7.2, fz, roof, fz + 5.9, roof + 7.2, fz + 3.3, roof + 7.2], GREY));
  parts.push(slab(-8.1, 8.1, roof - 0.05, roof + 0.1, fz + 2.4, fz + 5.5, GREY));

  // The wing on top, the four engines under its leading edge.
  for (const side of [-1, 1] as const) {
    parts.push(wingHalf(side, 20.2, { w: 2.1, y0: roof, y1: roof + 0.5 }, { w: 1.0, y0: roof + 0.2, y1: roof + 0.4 }, -1.5, GREY));
  }
  for (const hub of a.propellers) {
    const y = hub.y;
    const nacelle = { w: 0.5, y0: y - 0.6, y1: y + 0.5 };
    parts.push(taper(hub.z + 0.25, { w: 0.32, y0: y - 0.3, y1: y + 0.3 }, hub.z + 1.2, nacelle, GREY).translate(hub.x, 0, 0));
    parts.push(taper(hub.z + 1.2, nacelle, 1.6, { w: 0.35, y0: y - 0.4, y1: roof + 0.3 }, GREY).translate(hub.x, 0, 0));
    parts.push(tint(new THREE.ConeGeometry(0.28, 0.5, 12).rotateX(-Math.PI / 2).translate(hub.x, y, hub.z + 0.02), METAL));
  }
  return parts;
}

/**
 * The Airbus AS350 B3 Écureuil: a rounded pod of a cabin behind a glass
 * bubble, the engine and the gearbox in a fairing on its roof under the
 * rotor's mast, a slim tail boom with its stabiliser, the fin, and the tail
 * rotor on its left. On two skids, the step on the left one under the back
 * door. In red with a white stripe; the seats in the back taken out.
 */
function buildEcureuil(a: Aircraft): THREE.BufferGeometry[] {
  const w = a.cabin.halfWidth;
  const top = a.cabin.height + 0.08;
  const skin = 0.03;
  const front = -1.3;
  const back = 1.2;
  const bottom = -0.32;
  const hub = a.rotors!.hub;
  const parts = cabin(a, front, back, bottom, [-0.75, 0.45], { stripe: WHITE, belly: HELI_BELLY, skin: HELI_RED });

  // The two seats up front, their backs to the cabin, and the panel in the bubble.
  for (const x of [-0.4, 0.4]) {
    parts.push(slab(x - 0.24, x + 0.24, 0.05, 1.0, front + 0.42, front + 0.52, LINING));
    parts.push(slab(x - 0.24, x + 0.24, 0.3, 0.4, front + 0.0, front + 0.45, LINING));
  }
  parts.push(slab(-0.55, 0.55, 0.35, 0.62, front - 0.45, front - 0.25, FLOOR));

  // The bubble: painted below, glass from the stripe up, sloping down to the nose.
  parts.push(taper(front, { w: w + skin, y0: bottom, y1: 0.42 }, front - 1.05, { w: 0.5, y0: -0.1, y1: 0.36 }, HELI_RED));
  parts.push(taper(front, { w: w + skin, y0: 0.42, y1: top }, front - 1.05, { w: 0.5, y0: 0.36, y1: 0.52 }, GLASS));
  parts.push(taper(front - 1.05, { w: 0.5, y0: -0.1, y1: 0.52 }, front - 1.3, { w: 0.28, y0: 0.0, y1: 0.38 }, HELI_RED));

  // Behind the cabin, under the engine, down to the boom.
  parts.push(taper(back, { w: w + skin, y0: bottom, y1: top }, 2.7, { w: 0.42, y0: 0.35, y1: top }, HELI_RED));

  // The fairing on the roof over the gearbox and the engine, the exhaust, the mast and the rotor's head.
  const deck = top + 0.6;
  parts.push(taper(-0.9, { w: 0.45, y0: top, y1: top + 0.08 }, -0.25, { w: 0.62, y0: top, y1: deck }, HELI_RED));
  parts.push(slab(-0.62, 0.62, top, deck, -0.25, 1.4, HELI_RED));
  parts.push(taper(1.4, { w: 0.62, y0: top, y1: deck }, 2.7, { w: 0.38, y0: top - 0.05, y1: top + 0.32 }, HELI_RED));
  parts.push(slab(-0.2, 0.2, top + 0.02, top + 0.28, 2.7, 2.85, FLOOR));
  parts.push(rod(v(hub.x, deck - 0.05, hub.z), v(hub.x, hub.y, hub.z), 0.07, METAL));
  parts.push(tint(new THREE.CylinderGeometry(0.24, 0.3, 0.14, 12).translate(hub.x, hub.y - 0.04, hub.z), METAL));

  // The tail boom, its stabiliser with fins at the ends, the fin over it and under it, the tail skid.
  parts.push(taper(2.7, { w: 0.3, y0: 0.62, y1: 1.18 }, 7.2, { w: 0.13, y0: 0.82, y1: 1.02 }, HELI_RED));
  parts.push(slab(-1.05, 1.05, 0.86, 0.91, 5.7, 6.2, HELI_RED));
  for (const side of [-1, 1]) parts.push(slab(...out(side, 1.0, 1.04), 0.76, 1.04, 5.78, 6.16, HELI_RED));
  parts.push(fin([6.9, 0.95, 7.55, 0.95, 7.78, 2.05, 6.9, 0.95, 7.78, 2.05, 7.38, 2.05], HELI_RED));
  parts.push(fin([7.0, 0.9, 7.55, 0.88, 7.5, 0.32], HELI_RED));
  parts.push(rod(v(0, 0.36, 7.48), v(0, 0.2, 7.2), 0.02, METAL));

  // The skids, turned up in front, on their two cross tubes.
  const y = -0.76;
  for (const side of [-1, 1]) {
    const x = side * SKID_OUT;
    parts.push(rod(v(x, y, -1.75), v(x, y, 1.55), 0.045, METAL));
    parts.push(rod(v(x, y, -1.75), v(x, y + 0.24, -2.15), 0.045, METAL));
    for (const z of [-0.95, 0.85]) parts.push(rod(v(x, y + 0.02, z), v(side * 0.62, bottom + 0.02, z), 0.04, METAL));
  }
  for (const z of [-0.95, 0.85]) parts.push(rod(v(-0.62, bottom + 0.02, z), v(0.62, bottom + 0.02, z), 0.04, METAL));
  return parts;
}

const BUILD: Record<AircraftId, (a: Aircraft) => THREE.BufferGeometry[]> = {
  pc6: buildPorter,
  do28: buildDornier,
  c130: buildHercules,
  as350: buildEcureuil,
};
/** Radius of the propeller discs, m (none on a helicopter). */
const PROP_RADIUS: Record<AircraftId, number> = { pc6: 1.3, do28: 1.15, c130: 2.05, as350: 0 };
/** Blades on each propeller. */
const BLADES: Record<AircraftId, number> = { pc6: 3, do28: 3, c130: 4, as350: 0 };

/** Light bounced onto the plane's shaded side by day. */
const BOUNCE = 0x34383e;

export class PlaneView {
  readonly object = new THREE.Group();
  private props: THREE.Group[] = [];
  /** A helicopter's rotors: the main one turning about its mast, the tail one about the side axis. */
  private rotor: THREE.Group | null = null;
  private tailRotor: THREE.Group | null = null;
  private type: Aircraft | null = null;
  // Light bounced off the ground and the haze keeps the shaded side, the
  // underside of the wing, from going dark.
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: BOUNCE });
  private readonly discMaterial = new THREE.MeshBasicMaterial({
    color: 0x15181b,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly bladeMaterial = new THREE.MeshLambertMaterial({ color: 0x202326, transparent: true, opacity: 0.35, depthWrite: false });
  // A rotor turns slowly enough to see its blades, over a faint blur.
  private readonly rotorDiscMaterial = new THREE.MeshBasicMaterial({
    color: 0x15181b,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly rotorBladeMaterial = new THREE.MeshLambertMaterial({
    color: 0x1d2023,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /** Builds the plane of this type, in place of the one before. */
  private build(a: Aircraft): void {
    this.clear();
    this.type = a;
    this.object.add(new THREE.Mesh(mergeGeometries(BUILD[a.id](a))!, this.material));
    // Each propeller: a blur of a disc with its blades in it.
    const r = PROP_RADIUS[a.id];
    const blades = BLADES[a.id];
    this.props = a.propellers.map((hub) => {
      const prop = new THREE.Group();
      prop.add(new THREE.Mesh(new THREE.CircleGeometry(r, 40), this.discMaterial));
      for (let k = 0; k < blades; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, r - 0.05, 0.03).translate(0, r / 2 + 0.03, 0), this.bladeMaterial);
        blade.rotation.z = (k * 2 * Math.PI) / blades;
        prop.add(blade);
      }
      prop.position.set(hub.x, hub.y, hub.z);
      this.object.add(prop);
      return prop;
    });
    const rotors = a.rotors;
    if (!rotors) return;
    // The main rotor, flat over the cabin: its blades out from the mast, a disc of blur.
    this.rotor = new THREE.Group();
    this.rotor.add(new THREE.Mesh(new THREE.CircleGeometry(rotors.radius, 64).rotateX(-Math.PI / 2), this.rotorDiscMaterial));
    for (let k = 0; k < rotors.blades; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(rotors.radius - 0.2, 0.05, 0.35).translate(rotors.radius / 2 + 0.1, 0, 0), this.rotorBladeMaterial);
      blade.rotation.y = (k * 2 * Math.PI) / rotors.blades;
      this.rotor.add(blade);
    }
    this.rotor.position.set(rotors.hub.x, rotors.hub.y, rotors.hub.z);
    this.object.add(this.rotor);
    // The tail rotor, upright beside the fin: much faster, a blur with its blades in it.
    const t = rotors.tail;
    this.tailRotor = new THREE.Group();
    this.tailRotor.add(new THREE.Mesh(new THREE.CircleGeometry(t.radius, 32).rotateY(Math.PI / 2), this.discMaterial));
    for (let k = 0; k < t.blades; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, t.radius - 0.05, 0.14).translate(0, t.radius / 2 + 0.03, 0), this.bladeMaterial);
      blade.rotation.x = (k * 2 * Math.PI) / t.blades;
      this.tailRotor.add(blade);
    }
    this.tailRotor.position.set(t.hub.x, t.hub.y, t.hub.z);
    this.object.add(this.tailRotor);
  }

  private clear(): void {
    this.object.traverse((node) => (node as THREE.Mesh).geometry?.dispose());
    this.object.clear();
    this.props = [];
    this.rotor = null;
    this.tailRotor = null;
  }

  /** How dark it is, 0 by day, 1 at night: there is nothing to bounce light off at night. */
  setNight(night: number): void {
    this.material.emissive.setHex(BOUNCE).multiplyScalar(1 - 0.95 * night);
  }

  update(plane: Plane): void {
    if (plane.type !== this.type) this.build(plane.type);
    this.object.position.set(plane.pos.x, plane.pos.y, plane.pos.z);
    this.object.quaternion.set(plane.att.x, plane.att.y, plane.att.z, plane.att.w);
    for (const prop of this.props) prop.rotation.z = plane.prop;
    // Clockwise seen from above; the tail rotor geared up from it.
    if (this.rotor) this.rotor.rotation.y = -plane.prop;
    if (this.tailRotor) this.tailRotor.rotation.x = plane.prop * plane.type.rotors!.tail.gear;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.discMaterial.dispose();
    this.bladeMaterial.dispose();
    this.rotorDiscMaterial.dispose();
    this.rotorBladeMaterial.dispose();
  }
}
