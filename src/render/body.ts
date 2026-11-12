// The pilot's own body, whole: torso in its harness, the container on the
// back, legs that bend at the knee, and arms free of the risers (in the
// door, in freefall, on the ground), with an altimeter on the left wrist.
//
// Everything is in the pilot frame (origin between the shoulders, Y to the
// head, -Z where the belly faces). What sits within a hand's width of the
// eyes is on the gear layer, drawn by the near camera; the legs are far
// enough to stay with the world.

import * as THREE from 'three';
import type { RigParams } from '../sim/rig';
import { GEAR_LAYER, OUTSIDE_LAYER } from './scene';

const UPPER_ARM = 0.3;
const FOREARM = 0.28;
const THIGH = 0.43;
/** Hip joints below the pilot's centre of mass, apart, and back, m. */
const HIP_DROP = 0.1;
const HIP_APART = 0.1;
const HIP_BACK = 0.08;
/**
 * The model's eyes are only 10 cm above the riser attachments. A real torso
 * starts some 20 cm under the eyes and its chest is just behind them, so it
 * is put there: down and back, out of the way of a glance down at the ground.
 */
const TORSO_TOP = -0.12;
const TORSO_BACK = 0.13;
export const SHOULDER = new THREE.Vector3(0.19, -0.18, 0.12);
/**
 * Where each pair of risers meets the harness, right-hand side: the three
 * rings on top of the main lift web, just in front of the collarbone.
 */
export const RING = new THREE.Vector3(0.12, -0.15, 0.035);
/** Where the bridle leaves the main container, on its top flap, pilot frame. */
export const PIN = new THREE.Vector3(0, -0.33, 0.39);
/** Where the reserve's spring pilot chute leaves, on top of the container, pilot frame. */
export const RESERVE_PIN = new THREE.Vector3(0, -0.2, 0.36);
/** The pilot chute's handle, in its pouch at the bottom of the container, pilot frame. */
export const BOC = new THREE.Vector3(0.12, -0.64, 0.39);
/** The cutaway pillow on the right main lift web and the reserve handle on the left, pilot frame (right side given). */
export const HANDLES = new THREE.Vector3(0.1, -0.33, 0.0);
/** The altimeter reads one turn of the needle over this height, m. */
const DIAL_RANGE = 4000;
const UP = new THREE.Vector3(0, 1, 0);

/** How the body is held. Angles in radians, points in the pilot frame. */
export interface Pose {
  /** Thighs forward (towards the belly side) from hanging straight. */
  hipL: number;
  hipR: number;
  /** Knees bent, shins going back. */
  kneeL: number;
  kneeR: number;
  /** Each leg out to its side. */
  spread: number;
  /** Both legs swung to the right together, rad. */
  sway: number;
  /**
   * The trunk leaning about the eyes, as when crouched in a door: `lean`
   * to the left (hips go right), `bow` forward (hips go back).
   */
  lean: number;
  bow: number;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  /** Which way each elbow points. */
  elbowL: THREE.Vector3;
  elbowR: THREE.Vector3;
}

export const makePose = (): Pose => ({
  hipL: 0,
  hipR: 0,
  kneeL: 0,
  kneeR: 0,
  spread: 0,
  sway: 0,
  lean: 0,
  bow: 0,
  handL: new THREE.Vector3(),
  handR: new THREE.Vector3(),
  elbowL: new THREE.Vector3(-1, 0, 0),
  elbowR: new THREE.Vector3(1, 0, 0),
});

export function copyPose(out: Pose, p: Pose): Pose {
  out.hipL = p.hipL;
  out.hipR = p.hipR;
  out.kneeL = p.kneeL;
  out.kneeR = p.kneeR;
  out.spread = p.spread;
  out.sway = p.sway;
  out.lean = p.lean;
  out.bow = p.bow;
  out.handL.copy(p.handL);
  out.handR.copy(p.handR);
  out.elbowL.copy(p.elbowL);
  out.elbowR.copy(p.elbowR);
  return out;
}

/** Moves a pose a fraction `k` of the way towards another. */
export function blendPose(out: Pose, to: Pose, k: number): Pose {
  out.hipL += (to.hipL - out.hipL) * k;
  out.hipR += (to.hipR - out.hipR) * k;
  out.kneeL += (to.kneeL - out.kneeL) * k;
  out.kneeR += (to.kneeR - out.kneeR) * k;
  out.spread += (to.spread - out.spread) * k;
  out.sway += (to.sway - out.sway) * k;
  out.lean += (to.lean - out.lean) * k;
  out.bow += (to.bow - out.bow) * k;
  out.handL.lerp(to.handL, k);
  out.handR.lerp(to.handR, k);
  out.elbowL.lerp(to.elbowL, k);
  out.elbowR.lerp(to.elbowR, k);
  return out;
}

interface Leg {
  thigh: THREE.Group;
  shin: THREE.Group;
}

interface Arm {
  sign: number;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  hand: THREE.Mesh;
  /** The elbow and the wrist, pilot frame, after the last pose. */
  elbow: THREE.Vector3;
}

/** The face of a metric skydiving altimeter: 0 to 4 thousand metres, red under 1000, yellow to 1500. */
function dialTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  const angle = (m: number) => (m / DIAL_RANGE) * 2 * Math.PI - Math.PI / 2;
  g.fillStyle = '#2a2d31';
  g.beginPath();
  g.arc(c, c, c, 0, 2 * Math.PI);
  g.fill();
  g.fillStyle = '#0d0e10';
  g.beginPath();
  g.arc(c, c, c - 10, 0, 2 * Math.PI);
  g.fill();
  const arc = (from: number, to: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 16;
    g.beginPath();
    g.arc(c, c, c - 22, angle(from), angle(to));
    g.stroke();
  };
  arc(0, 1000, '#e0322a');
  arc(1000, 1500, '#f2c21a');
  g.strokeStyle = '#f2f2f2';
  for (let m = 0; m < DIAL_RANGE; m += 100) {
    const major = m % 1000 === 0;
    const a = angle(m);
    const r0 = c - (major ? 44 : 34);
    g.lineWidth = major ? 6 : 3;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.lineTo(c + Math.cos(a) * (c - 14), c + Math.sin(a) * (c - 14));
    g.stroke();
  }
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 44px -apple-system, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let k = 0; k < 4; k++) {
    const a = angle(k * 1000);
    g.fillText(String(k), c + Math.cos(a) * (c - 72), c + Math.sin(a) * (c - 72));
  }
  g.font = '22px -apple-system, Helvetica, sans-serif';
  g.fillText('×1000 m', c, c + 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class Body {
  /** Goes in the pilot frame. */
  readonly group = new THREE.Group();
  /** Torso and legs, which lean about the eyes as a whole. */
  private readonly trunk = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];
  private readonly altimeter = new THREE.Group();
  private readonly needle: THREE.Mesh;
  private readonly cutawayHandle: THREE.Mesh;
  private readonly reserveHandle: THREE.Mesh;
  private readonly eye: THREE.Vector3;
  private readonly lean = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(rig: RigParams) {
    this.eye = new THREE.Vector3(rig.eyePos.x, rig.eyePos.y, rig.eyePos.z);
    const suit = new THREE.MeshLambertMaterial({ color: 0x1d2a44 });
    const webbing = new THREE.MeshLambertMaterial({ color: 0x33363b, emissive: 0x0d0e10 });
    const container = new THREE.MeshLambertMaterial({ color: 0x2c3036, emissive: 0x0b0c0e });
    const glove = new THREE.MeshLambertMaterial({ color: 0x6f747c, emissive: 0x1d1f23 });
    const shoe = new THREE.MeshLambertMaterial({ color: 0xdcdcdc });
    const near = (mesh: THREE.Mesh): THREE.Mesh => {
      mesh.layers.set(GEAR_LAYER);
      return mesh;
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) =>
      near(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m));

    // The torso, a rounded block from the shoulders to the crotch, in its
    // harness: main lift webs down the chest, the chest strap across.
    const radius = 0.12;
    const height = 0.56;
    const torso = near(new THREE.Mesh(new THREE.CapsuleGeometry(radius, height - 2 * radius, 4, 14), suit));
    torso.scale.set(1.35, 1, 0.85);
    const middle = TORSO_TOP - height / 2;
    torso.position.set(0, middle, TORSO_BACK);
    const front = TORSO_BACK - radius * 0.85 - 0.006;
    const back = TORSO_BACK + radius * 0.85;
    this.trunk.add(
      torso,
      box(0.045, 0.48, 0.01, -0.1, middle + 0.02, front, webbing),
      box(0.045, 0.48, 0.01, 0.1, middle + 0.02, front, webbing),
      box(0.25, 0.035, 0.012, 0, middle + 0.1, front - 0.006, webbing),
      // The container on the back, the pilot chute's handle at its foot.
      box(0.34, 0.5, 0.15, 0, middle, back + 0.075, container),
      box(0.05, 0.03, 0.03, BOC.x, BOC.y, BOC.z, new THREE.MeshLambertMaterial({ color: 0xffd84a })),
      // The reserve's flap on top of the main's.
      box(0.3, 0.012, 0.13, 0, middle + 0.12, back + 0.15, webbing),
    );
    // The two handles of an emergency: cutaway pillow right, reserve left.
    this.cutawayHandle = box(0.05, 0.07, 0.025, HANDLES.x, HANDLES.y, HANDLES.z - 0.006, new THREE.MeshLambertMaterial({ color: 0xd8261c, emissive: 0x2a0503 }));
    this.reserveHandle = box(0.055, 0.045, 0.02, -HANDLES.x, HANDLES.y, HANDLES.z - 0.006, new THREE.MeshLambertMaterial({ color: 0xb9bec6, emissive: 0x202226 }));
    this.trunk.add(this.cutawayHandle, this.reserveHandle);

    // Head, neck and helmet: only ever seen from outside, the eyes are in it.
    const outside = (mesh: THREE.Mesh): THREE.Mesh => {
      mesh.layers.set(OUTSIDE_LAYER);
      return mesh;
    };
    const eye = rig.eyePos;
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89a7c });
    const shell = new THREE.MeshLambertMaterial({ color: 0xe4e4e0 });
    const visor = new THREE.MeshLambertMaterial({ color: 0x121418, emissive: 0x050608 });
    // The eyes are high in the model (10 cm over the risers' joint): from
    // outside, where the eyes cannot be told apart, the head sits a little
    // lower, so the neck is a neck and not a stalk. Collar of the jumpsuit.
    const drop = 0.06;
    const neckTop = new THREE.Vector3(0, eye.y - 0.1 - drop, 0.07);
    const neckFoot = new THREE.Vector3(0, TORSO_TOP - 0.02, 0.1);
    const neck = outside(new THREE.Mesh(new THREE.CapsuleGeometry(0.058, neckTop.distanceTo(neckFoot), 3, 10), suit));
    neck.position.addVectors(neckTop, neckFoot).multiplyScalar(0.5);
    neck.quaternion.setFromUnitVectors(UP, new THREE.Vector3().subVectors(neckTop, neckFoot).normalize());
    const head = outside(new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), skin));
    head.position.set(0, eye.y + 0.005 - drop, eye.z + 0.065);
    // A full-face helmet: the shell, and the dark visor across the front.
    const helmet = outside(new THREE.Mesh(new THREE.SphereGeometry(0.122, 22, 16).scale(0.94, 1, 1.08), shell));
    helmet.position.set(0, eye.y + 0.025 - drop, eye.z + 0.07);
    const glass = outside(
      new THREE.Mesh(new THREE.SphereGeometry(0.126, 18, 8, 1.5 * Math.PI - 0.95, 1.9, 1.05, 0.72).scale(0.94, 1, 1.08), visor),
    );
    glass.position.copy(helmet.position);
    this.trunk.add(neck, head, helmet, glass);

    // Legs: thigh and shin turn at hip and knee, the shoe at the end.
    const pilotY = rig.pilotPos.y;
    const shinLength = pilotY - rig.feetPos.y - HIP_DROP - THIGH;
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.rotation.order = 'ZYX';
      thigh.position.set(side * HIP_APART, pilotY - HIP_DROP, HIP_BACK);
      const shin = new THREE.Group();
      shin.position.y = -THIGH;
      thigh.add(
        new THREE.Mesh(new THREE.CapsuleGeometry(0.08, THIGH - 0.12, 4, 10).translate(0, -THIGH / 2 + 0.02, 0), suit),
        // A leg strap round the top of the thigh.
        new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.045, 12).translate(0, -0.1, 0), webbing),
        shin,
      );
      shin.add(
        new THREE.Mesh(new THREE.CapsuleGeometry(0.062, shinLength - 0.1, 4, 10).translate(0, -shinLength / 2 + 0.02, 0), suit),
        new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.28).translate(0, -shinLength, -0.07), shoe),
      );
      this.trunk.add(thigh);
      this.legs.push({ thigh, shin });
    }
    this.group.add(this.trunk);

    // Arms, stretched from shoulder to elbow to hand each time they move.
    const limb = (radius: number): THREE.Mesh => near(new THREE.Mesh(new THREE.CapsuleGeometry(radius, 1 - 2 * radius, 3, 10), suit));
    for (const sign of [-1, 1]) {
      const arm: Arm = {
        sign,
        upper: limb(0.042),
        fore: limb(0.034),
        hand: near(new THREE.Mesh(new THREE.IcosahedronGeometry(0.046, 2).scale(0.85, 1.15, 0.9), glove)),
        elbow: new THREE.Vector3(),
      };
      this.group.add(arm.upper, arm.fore, arm.hand);
      this.arms.push(arm);
    }

    // The altimeter on the left wrist, turned to the eyes to be read.
    const face = near(
      new THREE.Mesh(new THREE.CircleGeometry(0.03, 40), new THREE.MeshBasicMaterial({ map: dialTexture() })),
    );
    this.needle = near(
      new THREE.Mesh(
        new THREE.PlaneGeometry(0.0035, 0.024).translate(0, 0.01, 0.001),
        new THREE.MeshBasicMaterial({ color: 0xff8a1e }),
      ),
    );
    this.altimeter.add(face, this.needle);
    this.group.add(this.altimeter);
  }

  /** Shows the handles still in their place on the harness, or not once pulled. */
  setHandles(cutaway: boolean, reserve: boolean): void {
    this.cutawayHandle.visible = cutaway;
    this.reserveHandle.visible = reserve;
  }

  /** Where a hand is, pilot frame, after the last pose. */
  handPoint(out: THREE.Vector3, right: boolean): THREE.Vector3 {
    return out.copy(this.arms[right ? 1 : 0]!.hand.position);
  }

  /** Shows or hides the free arms (and the altimeter on them). */
  showArms(visible: boolean): void {
    for (const arm of this.arms) arm.upper.visible = arm.fore.visible = arm.hand.visible = visible;
    this.altimeter.visible = visible;
  }

  /** What the altimeter reads, m above the ground it was zeroed on. */
  setHeight(metres: number): void {
    this.needle.rotation.z = -(Math.max(0, metres) / DIAL_RANGE) * 2 * Math.PI;
  }

  setPose(p: Pose): void {
    // The trunk turns about the eyes, which stay where the camera is.
    this.euler.set(-p.bow, 0, p.lean);
    this.trunk.quaternion.setFromEuler(this.euler);
    this.lean.copy(this.trunk.quaternion);
    this.trunk.position.copy(this.eye).sub(this.a.copy(this.eye).applyQuaternion(this.lean));

    const [left, right] = [this.legs[0]!, this.legs[1]!];
    left.thigh.rotation.set(p.hipL, 0, -p.spread + p.sway);
    right.thigh.rotation.set(p.hipR, 0, p.spread + p.sway);
    left.shin.rotation.x = -p.kneeL;
    right.shin.rotation.x = -p.kneeR;

    for (const arm of this.arms) {
      const left = arm.sign < 0;
      this.reach(arm, left ? p.handL : p.handR, left ? p.elbowL : p.elbowR);
    }
    this.placeAltimeter();
  }

  /** Shoulder, elbow, hand: two bones of fixed length, the elbow pointing the given way. */
  private reach(arm: Arm, hand: THREE.Vector3, pole: THREE.Vector3): void {
    // The shoulder goes where the trunk's lean takes it.
    const root = this.a
      .set(arm.sign * SHOULDER.x, SHOULDER.y, SHOULDER.z)
      .applyQuaternion(this.trunk.quaternion)
      .add(this.trunk.position);
    const reach = this.b.subVectors(hand, root);
    const d = Math.min(Math.max(reach.length(), 0.05), UPPER_ARM + FOREARM - 0.005);
    reach.normalize();
    const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
    const side = this.c.copy(pole).addScaledVector(reach, -pole.dot(reach)).normalize();
    arm.elbow.copy(root).addScaledVector(reach, along).addScaledVector(side, out);
    const grip = this.c.copy(root).addScaledVector(reach, d);
    this.span(arm.upper, root, arm.elbow);
    this.span(arm.fore, arm.elbow, grip);
    arm.hand.position.copy(grip);
    arm.hand.quaternion.copy(arm.fore.quaternion);
  }

  private span(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = this.d.subVectors(b, a);
    const length = dir.length() || 1e-6;
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.scale.y = length;
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  }

  /** On the back of the left wrist, its face turned to the eyes, twelve o'clock towards the fingers. */
  private placeAltimeter(): void {
    const arm = this.arms[0]!;
    const wrist = this.a.copy(arm.elbow).lerp(arm.hand.position, 0.8);
    const toEye = this.b.subVectors(this.eye, wrist).normalize();
    wrist.addScaledVector(toEye, 0.04);
    const fingers = this.c.subVectors(arm.hand.position, arm.elbow);
    fingers.addScaledVector(toEye, -fingers.dot(toEye)).normalize();
    const across = this.e.crossVectors(fingers, toEye);
    this.basis.makeBasis(across, fingers, toEye);
    this.altimeter.position.copy(wrist);
    this.altimeter.quaternion.setFromRotationMatrix(this.basis);
  }
}
