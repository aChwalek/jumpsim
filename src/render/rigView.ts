// What the pilot sees of their own gear: canopy overhead, lines, risers, legs,
// and the shadow they cast on the ground (a strong height cue near landing).

import * as THREE from 'three';
import type { Controls, FlightModel } from '../sim/flightModel';
import type { RigParams } from '../sim/rig';
import { GEAR_LAYER } from './scene';

const DEG = Math.PI / 180;
const CELLS = 9;
const CHORD_STATIONS = [0.02, 0.1, 0.25, 0.45, 0.62, 0.76, 0.88, 1];
const LINE_CHORDS = [0.08, 0.3, 0.55, 0.8];
const CELL_COLORS = [0x18305c, 0x2a6fd0, 0x2a6fd0, 0xf2f2ee, 0xf2f2ee, 0xf2f2ee, 0x2a6fd0, 0x2a6fd0, 0x18305c];
/** Cross-braced canopies get their own colours, to tell them apart overhead. */
const TRI_CELL_COLORS = [0x17181c, 0xc9382c, 0xc9382c, 0xf2f2ee, 0xf2f2ee, 0xf2f2ee, 0xc9382c, 0xc9382c, 0x17181c];
/** Shade of each chamber of a cell, so that the seams can be made out. */
const CHAMBER_SHADES = [1, 0.93, 0.97];
const HINGE = 0.72;

// The gear within arm's reach, canopy frame, right-hand side (x is mirrored
// for the left). The origin is the joint, between the shoulders; the eyes are
// 10 cm above it. The risers run up beside the head, where an eye sees them
// but a screen does not. The toggles come down along the rear risers as they
// do in the air, so they too are seen by looking up, down or sideways; the
// front risers are pulled down and a little forwards, into the picture.
const RISER_FOOT = new THREE.Vector3(0.19, -0.02, -0.05);
const FRONT_LINK = new THREE.Vector3(0.21, 0, -0.11);
const REAR_LINK = new THREE.Vector3(0.23, 0, 0.03);
/** How far a fully pulled front riser comes down, m. */
const FRONT_PULL = 0.18;
const ARM_ROOT = new THREE.Vector3(0.25, -0.07, 0.01);
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
/** Elbows point down, out and a little back, as when pulling something down. */
const ELBOW_OUT = new THREE.Vector3(0.6, -0.7, 0.35);
const UP = new THREE.Vector3(0, 1, 0);

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** What hangs on one side of the pilot: risers, toggle, and the arm working them. */
interface Side {
  sign: number;
  front: THREE.Mesh;
  rear: THREE.Mesh;
  toggle: THREE.Mesh;
  hand: THREE.Mesh;
  upperArm: THREE.Mesh;
  forearm: THREE.Mesh;
  /** Top of the front and rear risers, the ring the steering line runs through, and the hand. */
  frontLink: THREE.Vector3;
  rearLink: THREE.Vector3;
  ring: THREE.Vector3;
  grip: THREE.Vector3;
}

export class RigView {
  /** Canopy, lines and risers: follows the canopy's frame in the flight model. */
  readonly object = new THREE.Group();
  /** The pilot's body, which hangs from the risers and follows its own frame. */
  readonly pilot = new THREE.Group();
  /** Lives in world space, flat on the ground. */
  readonly shadow = new THREE.Group();

  private readonly canopy: THREE.BufferGeometry;
  private readonly lines: THREE.BufferGeometry;
  private readonly canopyShadow: THREE.Mesh;
  private readonly pilotShadow: THREE.Mesh;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly p = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  /** Strips of fabric across the span: one per chamber. */
  private readonly steps: number;
  private readonly last = { brakeL: -1, brakeR: -1, frontL: -1, frontR: -1 };
  private readonly legs: THREE.Mesh[] = [];
  private readonly sides: Side[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private readonly reach = new THREE.Vector3();

  constructor(private readonly rig: RigParams) {
    const chambers = rig.config.chambersPerCell;
    const palette = chambers > 2 ? TRI_CELL_COLORS : CELL_COLORS;
    this.steps = CELLS * chambers;
    const quads = this.steps * (CHORD_STATIONS.length - 1) * 2;
    this.canopy = new THREE.BufferGeometry();
    this.canopy.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quads * 18), 3));
    const colors = new Float32Array(quads * 18);
    const color = new THREE.Color();
    let o = 0;
    for (let surface = 0; surface < 2; surface++) {
      for (let i = 0; i < this.steps; i++) {
        color.setHex(palette[Math.floor(i / chambers)]!);
        // Unlit: the fabric glows with the sun behind it. A slight shade on
        // the chambers of a cell and on the underside keeps the shape readable.
        color.multiplyScalar((surface === 1 ? 0.86 : 1) * CHAMBER_SHADES[i % chambers]!);
        for (let k = 0; k < (CHORD_STATIONS.length - 1) * 6; k++) {
          colors[o++] = color.r;
          colors[o++] = color.g;
          colors[o++] = color.b;
        }
      }
    }
    this.canopy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.object.add(
      new THREE.Mesh(this.canopy, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    );

    const ribs = CELLS + 1;
    const segments = ribs * LINE_CHORDS.length + ribs + 2;
    this.lines = new THREE.BufferGeometry();
    this.lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 6), 3));
    this.object.add(new THREE.LineSegments(this.lines, new THREE.LineBasicMaterial({ color: 0x1c1c1c })));

    // Risers, toggles and the arms on them: boxes stretched between two points.
    const suit = new THREE.MeshLambertMaterial({ color: 0x1d2a44 });
    // Seen from below against the sky, most of this is in its own shade: a
    // little glow keeps it from going black.
    const webbing = new THREE.MeshLambertMaterial({ color: 0x33363b, emissive: 0x0d0e10 });
    const glove = new THREE.MeshLambertMaterial({ color: 0x6f747c, emissive: 0x1d1f23 });
    const handle = new THREE.MeshLambertMaterial({ color: 0xffd84a });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.layers.set(GEAR_LAYER);
      this.object.add(mesh);
      return mesh;
    };
    const part = (width: number, depth: number, material: THREE.Material, length = 1): THREE.Mesh =>
      add(new THREE.BoxGeometry(width, length, depth), material);
    /** A rounded limb one metre long, to be stretched between two joints. */
    const limb = (radius: number): THREE.Mesh => add(new THREE.CapsuleGeometry(radius, 1 - 2 * radius, 3, 10), suit);
    for (const sign of [-1, 1]) {
      this.sides.push({
        sign,
        front: part(0.027, 0.006, webbing),
        rear: part(0.027, 0.006, webbing),
        toggle: part(0.024, 0.01, handle, 0.11),
        hand: add(new THREE.IcosahedronGeometry(0.046, 2).scale(0.85, 1.15, 0.9), glove),
        upperArm: limb(0.042),
        forearm: limb(0.034),
        frontLink: new THREE.Vector3(),
        rearLink: new THREE.Vector3(),
        ring: new THREE.Vector3(),
        grip: new THREE.Vector3(),
      });
    }

    // Legs and shoes, hanging slightly forward as in a harness.
    const shoe = new THREE.MeshLambertMaterial({ color: 0xdcdcdc });
    const pilotY = rig.pilotPos.y;
    const legLength = rig.pilotPos.y - rig.feetPos.y - 0.1;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, legLength, 0.16).translate(0, -legLength / 2, 0), suit);
      leg.position.set(side * 0.13, pilotY - 0.1, 0);
      leg.rotation.x = 12 * DEG;
      this.legs.push(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.29).translate(0, -legLength, -0.08), shoe);
      leg.add(foot);
      this.pilot.add(leg);
    }

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x08100a,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -14,
      polygonOffsetUnits: -14,
    });
    this.canopyShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(rig.span * 0.92, rig.chord).rotateX(-Math.PI / 2),
      this.shadowMaterial,
    );
    // One metre across, stretched to the pilot's shadow every frame.
    this.pilotShadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2), this.shadowMaterial);
    this.canopyShadow.renderOrder = this.pilotShadow.renderOrder = 7;
    this.shadow.add(this.canopyShadow, this.pilotShadow);
    this.reshape({ brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 });
  }

  /** Stretches a box made one metre long from a to b, or just points it that way. */
  private span(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, stretch = true): void {
    const along = this.e.subVectors(b, a);
    const length = along.length() || 1e-6;
    if (stretch) {
      mesh.position.addVectors(a, b).multiplyScalar(0.5);
      mesh.scale.y = length;
    }
    mesh.quaternion.setFromUnitVectors(UP, along.divideScalar(length));
  }

  /**
   * Puts the risers, the toggle and the arm of one side where the controls
   * have them. The hand keeps its toggle: it brings it down in front of the
   * body to brake, and takes it along to the front riser to pull that down.
   */
  private rigSide(g: Side, brake: number, front: number): void {
    const { a, b } = this;
    const linksY = this.rig.linksPos.y;
    const foot = a.set(g.sign * RISER_FOOT.x, RISER_FOOT.y, RISER_FOOT.z);
    g.rearLink.set(g.sign * REAR_LINK.x, linksY, REAR_LINK.z);
    g.frontLink.set(g.sign * (FRONT_LINK.x + 0.01 * front), linksY - FRONT_PULL * front, FRONT_LINK.z - 0.15 * front);
    g.ring.lerpVectors(foot, g.rearLink, 0.8);
    this.span(g.rear, foot, g.rearLink);
    this.span(g.front, foot, g.frontLink);

    // The toggle comes straight down along the rear riser, passes just in
    // front of the shoulder and ends at arm's length beside the thigh.
    const pass = Math.sin(Math.PI * brake);
    g.grip.set(g.sign * (0.24 + 0.03 * brake), 0.34 - 0.97 * brake, -0.05 * brake - 0.075 * pass);
    // The loop of the front riser, just under its link.
    const loop = a.set(g.frontLink.x, g.frontLink.y - 0.06, g.frontLink.z - 0.01);
    g.grip.lerp(loop, ease(front / 0.15));
    g.toggle.position.copy(g.grip).addScaledVector(UP, 0.035);
    this.span(g.toggle, g.grip, g.ring, false);

    // Shoulder, elbow, hand: two bones of fixed length, the elbow kept out.
    const root = a.set(g.sign * ARM_ROOT.x, ARM_ROOT.y, ARM_ROOT.z);
    const reach = this.reach.subVectors(g.grip, root);
    const d = Math.min(reach.length(), UPPER_ARM + FOREARM - 0.005);
    reach.normalize();
    const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
    const side = this.p.set(g.sign * ELBOW_OUT.x, ELBOW_OUT.y, ELBOW_OUT.z);
    side.addScaledVector(reach, -side.dot(reach)).normalize();
    const elbow = b.copy(root).addScaledVector(reach, along).addScaledVector(side, out);
    this.span(g.upperArm, root, elbow);
    this.span(g.forearm, elbow, g.grip);
    g.hand.position.copy(g.grip);
    g.hand.quaternion.copy(g.forearm.quaternion);
  }

  /**
   * Shows or hides the arms and the toggles in the hands. They let go on the
   * ground, where the canopy falls away from the pilot.
   */
  setArms(visible: boolean): void {
    for (const g of this.sides) {
      g.toggle.visible = g.hand.visible = g.upperArm.visible = g.forearm.visible = visible;
    }
  }

  /** Swings the legs from the hips: angles in radians, forward positive. */
  setLegs(left: number, right: number): void {
    this.legs[0]!.rotation.x = left;
    this.legs[1]!.rotation.x = right;
  }

  /** Frees what the view holds on the graphics card, once it has left the scene. */
  dispose(): void {
    for (const group of [this.object, this.pilot, this.shadow]) {
      group.traverse((node) => {
        const { geometry, material } = node as THREE.Mesh;
        geometry?.dispose();
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
      });
    }
  }

  /** Point on the canopy skin, canopy frame. s: -1 left tip .. 1 right tip, c: 0 nose .. 1 tail. */
  private skin(out: THREE.Vector3, s: number, c: number, top: boolean, brakeL: number, brakeR: number): THREE.Vector3 {
    const rig = this.rig;
    const theta = (s * rig.span) / (2 * rig.lineLength);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const incidence = rig.config.riggingAngleDeg * DEG;
    const ci = Math.cos(incidence);
    const si = Math.sin(incidence);
    const outer = Math.max(0, (Math.abs(s) - 0.7) / 0.3);
    const chord = rig.chord * (1 - 0.3 * outer * outer);
    const half = 0.7 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1015 * c ** 4);
    let lift = (top ? half : -0.25 * half) * chord;
    if (c > HINGE) {
      const brake = (s < 0 ? brakeL : brakeR) * (0.5 + Math.abs(s));
      lift -= (c - HINGE) * chord * Math.sin(Math.min(1.5, brake) * 42 * DEG);
    }
    const along = (0.25 - c) * chord;
    const radius = rig.lineLength;
    // Quarter-chord point on the arc, then along the chord and the normal.
    return out.set(
      radius * sin + along * si * sin + lift * ci * sin,
      rig.linksPos.y + radius * cos + along * si * cos + lift * ci * cos,
      -along * ci + lift * si,
    );
  }

  private reshape(c: Controls): void {
    const { brakeL, brakeR } = c;
    const p = this.p;
    const position = this.canopy.getAttribute('position') as THREE.BufferAttribute;
    let v = 0;
    const put = (s: number, c: number, top: boolean): void => {
      this.skin(p, s, c, top, brakeL, brakeR);
      position.setXYZ(v++, p.x, p.y, p.z);
    };
    for (let surface = 0; surface < 2; surface++) {
      const top = surface === 0;
      for (let i = 0; i < this.steps; i++) {
        const s0 = (i / this.steps) * 2 - 1;
        const s1 = ((i + 1) / this.steps) * 2 - 1;
        for (let j = 0; j < CHORD_STATIONS.length - 1; j++) {
          const c0 = CHORD_STATIONS[j]!;
          const c1 = CHORD_STATIONS[j + 1]!;
          put(s0, c0, top);
          put(s1, c0, top);
          put(s1, c1, top);
          put(s0, c0, top);
          put(s1, c1, top);
          put(s0, c1, top);
        }
      }
    }
    position.needsUpdate = true;
    this.canopy.computeVertexNormals();
    this.canopy.computeBoundingSphere();

    const [left, right] = [this.sides[0]!, this.sides[1]!];
    this.rigSide(left, brakeL, c.frontL);
    this.rigSide(right, brakeR, c.frontR);

    const line = this.lines.getAttribute('position') as THREE.BufferAttribute;
    let n = 0;
    const segment = (from: THREE.Vector3, to: THREE.Vector3): void => {
      line.setXYZ(n++, from.x, from.y, from.z);
      line.setXYZ(n++, to.x, to.y, to.z);
    };
    for (let rib = 0; rib <= CELLS; rib++) {
      const s = (rib / CELLS) * 2 - 1;
      const g = s < 0 ? left : right;
      // The two front rows of lines go to the front riser, the others to the rear.
      LINE_CHORDS.forEach((chord, k) => {
        segment(k < 2 ? g.frontLink : g.rearLink, this.skin(p, s, chord, false, brakeL, brakeR));
      });
      // Steering lines fan out to the tail from the ring on the rear riser.
      segment(g.ring, this.skin(p, s, 1, false, brakeL, brakeR));
    }
    // And from the ring down to the toggle in the hand.
    segment(left.grip, left.ring);
    segment(right.grip, right.ring);
    line.needsUpdate = true;
    this.lines.computeBoundingSphere();
  }

  /** Follow the model. `sun` points towards the sun. */
  update(model: FlightModel, c: Controls, groundAt: (x: number, z: number) => number, sun: THREE.Vector3): void {
    const { pos, att, pilotAtt } = model.state;
    this.object.position.set(pos.x, pos.y, pos.z);
    this.object.quaternion.set(att.x, att.y, att.z, att.w);
    this.pilot.position.set(pos.x, pos.y, pos.z);
    this.pilot.quaternion.set(pilotAtt.x, pilotAtt.y, pilotAtt.z, pilotAtt.w);
    const last = this.last;
    const moved = (Object.keys(last) as (keyof typeof last)[]).some((k) => Math.abs(c[k] - last[k]) > 0.002);
    if (moved) {
      Object.assign(last, { brakeL: c.brakeL, brakeR: c.brakeR, frontL: c.frontL, frontR: c.frontR });
      this.reshape(c);
    }

    const rig = this.rig;
    const centre = this.centre.set(0, rig.canopyPos.y, 0).applyQuaternion(this.object.quaternion).add(this.object.position);
    const forward = this.p.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    const yaw = Math.atan2(-forward.x, -forward.z);
    /** Where the sun puts the shadow of a point given in the frame of the canopy or of the pilot. */
    const cast = (out: THREE.Vector3, frame: THREE.Group, x: number, y: number, z: number): THREE.Vector3 => {
      out.set(x, y, z).applyQuaternion(frame.quaternion).add(frame.position);
      const ground = groundAt(out.x, out.z);
      const t = (out.y - ground) / sun.y;
      return out.set(out.x - sun.x * t, ground, out.z - sun.z * t);
    };
    const height = centre.y - groundAt(centre.x, centre.z);
    cast(this.canopyShadow.position, this.object, 0, rig.canopyPos.y, 0);
    this.canopyShadow.rotation.y = yaw;
    // The pilot's shadow runs from the feet to the head: its near end comes
    // up to the feet as they come down to the ground.
    const feet = cast(this.feet, this.pilot, rig.feetPos.x, rig.feetPos.y, rig.feetPos.z);
    const head = cast(this.head, this.pilot, rig.eyePos.x, rig.eyePos.y + 0.12, rig.eyePos.z);
    this.pilotShadow.position.lerpVectors(feet, head, 0.5);
    this.pilotShadow.rotation.y = Math.atan2(head.x - feet.x, head.z - feet.z);
    this.pilotShadow.scale.set(0.5, 1, feet.distanceTo(head) + 0.35);
    // Shadows are faint and washed out from high up, crisp near the ground.
    this.shadowMaterial.opacity = 0.12 + 0.36 * Math.max(0, 1 - height / 250);
  }
}
