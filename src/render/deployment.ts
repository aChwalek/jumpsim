// The pilot chute, its bridle and the deployment bag, as seen from the throw
// to the end of the jump.
//
// The pilot chute is thrown from the hand, drags the bridle out of the
// container, lifts the bag off the back and pulls it away until the lines are
// stretched; then the canopy leaves the bag and the whole lot trails behind
// the top of the canopy for the rest of the flight: bridle, empty bag, and the
// pilot chute, which its kill line has collapsed. A reserve's spring-loaded
// pilot chute and free bag let go of the canopy once it is open and drift
// away on their own.
//
// Nothing here acts on the flight. It is a small rope of point masses in the
// air, world frame, pulled along by whatever it hangs from: the hand, the
// container, the bag carried up the line stretch, the top of the canopy.

import * as THREE from 'three';
import { suspensionLines } from './lines';

/** The canopy as the bridle lies on it: nothing goes through its top skin. */
export interface CanopySurface {
  readonly object: THREE.Object3D;
  /** Pushes a world point that has got under the top skin back out, `clear` above it, by `most` m at the most. */
  liftOut(p: THREE.Vector3, clear: number, most: number): boolean;
}

/** Where the deployment is: nothing out, in the hand, towing, lifting the bag, behind the canopy, or let go. */
export type DeployStage = 'stowed' | 'hand' | 'tow' | 'bag' | 'canopy' | 'free';

export interface DeployFrame {
  stage: DeployStage;
  /** Sim time step, s. */
  dt: number;
  /** Velocity of the air, world frame, m/s. */
  wind: THREE.Vector3;
  airDensity: number;
  /** The pilot's throwing hand, world frame: where the pilot chute is held. */
  hand: THREE.Vector3;
  /** Where the bridle leaves the container, world frame. */
  pin: THREE.Vector3;
  /** The pilot's velocity, world frame, m/s: what everything in the hand or the container moves at. */
  vel: THREE.Vector3;
  /** How a reserve's spring throws its pilot chute off the back, world frame, m/s. */
  launch: THREE.Vector3;
  /** Where the bag is carried as the lines pay out: from the container to line stretch. */
  bagOut: THREE.Vector3;
  /** Top of the canopy, where the bridle is sewn on, world frame. */
  canopyTop: THREE.Vector3;
  /** The canopy, once it is out: the bag, the bridle and the pilot chute stay on top of it. */
  canopy: CanopySurface | null;
  /** How far the pilot chute is open: 1 inflated, less once collapsed by its kill line. */
  pilotChuteOpen: number;
  /** Seconds since the start of the stage, for the throw. */
  stageTime: number;
  /** The line groups, world frame: from each riser top up to the bag, while it is being carried. */
  risers: THREE.Vector3[];
  /** Height of the ground, m: nothing goes through it. */
  ground: number;
}

/** The bag: across, along the bridle, and thick, m. */
const BAG = { x: 0.34, y: 0.3, z: 0.12 };
/** Bridle from the canopy to the bag, and from the bag to the pilot chute, m. */
const TO_BAG = 1.0;
const TO_PILOT_CHUTE = 1.8;
const BRIDLE_NODES = 4;
const LEAD_NODES = 6;
/** How fast the canopy can push something lying on it back out, m/s: about as fast as its top skin moves. */
const LIFT_SPEED = 10;
/** Time step for the rope, s. */
const STEP = 1 / 240;
const GRAVITY = 9.80665;

interface Node {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mass: number;
  /** Drag area, m². */
  area: number;
  /** Held where the stage puts it. */
  pinned: boolean;
  /** How far its centre stays off the fabric, m. */
  clear: number;
}

const node = (mass: number, area: number, clear: number): Node => ({
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  mass,
  area,
  pinned: false,
  clear,
});

export class Deployment {
  /** World frame. */
  readonly object = new THREE.Group();
  /** First the bridle from the canopy, then the bag, then the bridle on to the pilot chute. */
  private readonly nodes: Node[] = [];
  private readonly rest: number[] = [];
  private readonly bagIndex = BRIDLE_NODES;
  private stage: DeployStage = 'stowed';
  private freeFor = 0;
  private readonly bridle: THREE.Line;
  private readonly lines: THREE.LineSegments;
  private readonly bag: THREE.Mesh;
  private readonly pilotChute: THREE.Group;
  private readonly dome: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private readonly air = new THREE.Vector3();
  /** Per node: where it was at the start of the step, and where a held node is taken this frame. */
  private readonly old: THREE.Vector3[] = [];
  private readonly from: THREE.Vector3[] = [];
  private readonly target: THREE.Vector3[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly side = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  /** How far the canopy moved this frame, and where its top was the frame before. */
  private readonly shift = new THREE.Vector3();
  private readonly lastTop = new THREE.Vector3();
  private hadTop = false;

  /**
   * `reserve`: a spring pilot chute that stays open and a free bag. `colour`:
   * of the pilot chute's fabric. `light`: brightness of what is drawn without
   * the lights.
   */
  constructor(
    private readonly reserve: boolean,
    colour: number,
    light: THREE.Color,
  ) {
    for (let i = 0; i < BRIDLE_NODES; i++) this.nodes.push(node(0.015, 0.004, 0.02));
    this.nodes.push(node(0.25, 0.05, BAG.z / 2 + 0.01));
    for (let i = 0; i < LEAD_NODES; i++) this.nodes.push(node(0.015, 0.004, 0.02));
    // The pilot chute itself is the last.
    this.nodes.push(node(0.12, 0.3, 0.08));
    for (let i = 0; i < this.nodes.length; i++) {
      this.old.push(new THREE.Vector3());
      this.from.push(new THREE.Vector3());
      this.target.push(new THREE.Vector3());
    }
    for (let i = 0; i < this.nodes.length - 1; i++) {
      this.rest.push(i < BRIDLE_NODES ? TO_BAG / BRIDLE_NODES : TO_PILOT_CHUTE / (LEAD_NODES + 1));
    }

    const bridle = new THREE.BufferGeometry();
    bridle.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.nodes.length * 3), 3));
    this.bridle = new THREE.Line(bridle, new THREE.LineBasicMaterial({ color: reserve ? 0xe8e8e2 : 0xf3d34a }));
    this.bridle.frustumCulled = false;

    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    this.lines = suspensionLines(lines, light);

    // A d-bag, the size of the container it came out of, the bridle
    // through the top of it; flattened once empty.
    this.bag = new THREE.Mesh(
      new THREE.BoxGeometry(BAG.x, BAG.y, BAG.z),
      new THREE.MeshLambertMaterial({ color: reserve ? 0x3a3d42 : 0x2b2e33 }),
    );

    // A pilot chute: a dome of fabric, open side towards what it pulls, and a
    // band of mesh under it. Built pointing up (+Y); turned to the bridle.
    this.pilotChute = new THREE.Group();
    const profile: THREE.Vector2[] = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * (Math.PI / 2);
      profile.push(new THREE.Vector2(Math.sin(a) * 0.46 + 0.001, Math.cos(a) * 0.3));
    }
    this.dome = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 18),
      new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }),
    );
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.2, 0.22, 18, 1, true).translate(0, -0.11, 0),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.pilotChute.add(this.dome, mesh);
    // A reserve's spring pilot chute is smaller than a main's hand-thrown one.
    if (reserve) this.dome.scale.setScalar(0.7), mesh.scale.setScalar(0.7);

    this.object.add(this.bridle, this.lines, this.bag, this.pilotChute);
    this.object.visible = false;
  }

  /** The bag and pilot chute have flown away and are no longer drawn. */
  get gone(): boolean {
    return this.stage === 'free' && this.freeFor > 12;
  }

  update(f: DeployFrame): void {
    const was = this.stage;
    this.stage = f.stage;
    this.object.visible = f.stage !== 'stowed' && !this.gone;
    if (!this.object.visible) {
      if (f.stage === 'stowed') this.freeFor = 0;
      return;
    }
    const nodes = this.nodes;
    const pc = nodes[nodes.length - 1]!;
    const bag = nodes[this.bagIndex]!;
    if (was === 'stowed' || (was === 'hand' && f.stage !== 'hand')) {
      // Everything starts bunched where it is held.
      for (const n of nodes) {
        n.pos.copy(f.stage === 'hand' ? f.hand : f.pin);
        n.vel.copy(f.vel);
      }
      pc.pos.copy(f.hand);
      if (was === 'hand') {
        // Thrown out to the side at arm's length.
        pc.vel.add(this.tmp.subVectors(f.hand, f.pin).setLength(4));
      } else if (this.reserve) {
        // Sprung off the back.
        pc.vel.add(f.launch);
      }
    }
    if (f.stage === 'free') this.freeFor += f.dt;
    // The canopy moves on over the frame: the rope meets it where it is at each step.
    if (f.canopy && this.hadTop && this.lastTop.distanceToSquared(f.canopyTop) < 25) this.shift.subVectors(f.canopyTop, this.lastTop);
    else this.shift.set(0, 0, 0);
    this.lastTop.copy(f.canopyTop);
    this.hadTop = f.canopy !== null;

    // What is held where, this stage: those nodes are carried from where
    // they were to there over the frame.
    const bridleOut = f.stage === 'canopy' || f.stage === 'free';
    const open = this.reserve ? 1 : f.pilotChuteOpen;
    pc.area = 0.04 + 0.32 * open;
    nodes.forEach((n, i) => {
      n.pinned = true;
      if (f.stage === 'hand') this.target[i]!.copy(f.hand);
      else if (f.stage === 'tow' && i <= this.bagIndex) this.target[i]!.copy(f.pin);
      else if (f.stage === 'bag' && i <= this.bagIndex) this.target[i]!.copy(f.bagOut);
      else if (f.stage === 'canopy' && i === 0) this.target[i]!.copy(f.canopyTop);
      else n.pinned = false;
      this.from[i]!.copy(n.pos);
    });
    const steps = Math.max(1, Math.min(24, Math.ceil(f.dt / STEP - 1e-6)));
    const dt = f.dt / steps;
    if (dt > 0) for (let s = 0; s < steps; s++) this.integrate(dt, f, (s + 1) / steps);
    if (!bridleOut && f.stage !== 'hand') {
      // Not yet out of the bag: the bridle on the canopy side stays in it.
      for (let i = 0; i < this.bagIndex; i++) nodes[i]!.pos.copy(bag.pos);
    }

    // Bridle through every node.
    const position = this.bridle.geometry.getAttribute('position') as THREE.BufferAttribute;
    nodes.forEach((n, i) => position.setXYZ(i, n.pos.x, n.pos.y, n.pos.z));
    position.needsUpdate = true;
    this.bridle.geometry.setDrawRange(0, f.stage === 'hand' ? 0 : nodes.length);

    // The bag, along the bridle; the line groups up to it while it climbs.
    const bagHome = f.stage === 'tow' || f.stage === 'hand';
    this.bag.visible = !bagHome;
    if (this.bag.visible) {
      const ahead = nodes[this.bagIndex + 1]!.pos;
      const behind = bridleOut ? nodes[this.bagIndex - 1]!.pos : bag.pos;
      this.orient(this.bag, bag.pos, this.tmp.subVectors(ahead, behind));
      // On the canopy it lies flat on the fabric.
      if (f.canopy && f.stage === 'canopy') this.lieFlat(this.bag, this.tmp, this.normal.set(0, 1, 0).applyQuaternion(f.canopy.object.quaternion));
    }
    const lines = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const carrying = f.stage === 'bag';
    this.lines.visible = carrying;
    if (carrying) {
      f.risers.forEach((r, i) => {
        lines.setXYZ(2 * i, r.x, r.y, r.z);
        lines.setXYZ(2 * i + 1, bag.pos.x, bag.pos.y, bag.pos.z);
      });
      lines.needsUpdate = true;
    }

    // The pilot chute: folded in the hand, a full dome in tow, a crumpled
    // sleeve once its kill line has pulled its apex in.
    const prev = nodes[nodes.length - 2]!.pos;
    this.orient(this.pilotChute, pc.pos, this.tmp.subVectors(pc.pos, prev));
    if (f.stage === 'hand') {
      this.pilotChute.scale.set(0.25, 0.4, 0.25);
    } else {
      const k = Math.min(1, (f.stage === 'tow' ? f.stageTime : 1) / 0.25);
      const across = 0.2 + 0.8 * open * k;
      const flap = 1 + (1 - open) * 0.25 * Math.sin(37 * this.freeFor + 23 * f.stageTime);
      this.pilotChute.scale.set(across * flap, 0.6 + 0.9 * (1 - open) + 0.4 * open * k, across);
    }
  }

  /** Points an object's +Y along a direction, at a position. */
  private orient(object: THREE.Object3D, at: THREE.Vector3, along: THREE.Vector3): void {
    object.position.copy(at);
    if (along.lengthSq() > 1e-8) object.quaternion.setFromUnitVectors(this.up, along.normalize());
  }

  /** Turns an object about its +Y, already along `along`, so its +Z is as near `normal` as it goes. */
  private lieFlat(object: THREE.Object3D, along: THREE.Vector3, normal: THREE.Vector3): void {
    const y = along.normalize();
    const z = normal.addScaledVector(y, -normal.dot(y));
    if (z.lengthSq() < 1e-6) return;
    z.normalize();
    const x = this.side.crossVectors(y, z);
    object.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
  }

  /**
   * One step of the rope: held nodes moved on, free ones under gravity and
   * drag, then the lengths held, and speeds from where everything went.
   */
  private integrate(dt: number, f: DeployFrame, along: number): void {
    const nodes = this.nodes;
    nodes.forEach((n, i) => {
      this.old[i]!.copy(n.pos);
      if (n.pinned) {
        n.pos.lerpVectors(this.from[i]!, this.target[i]!, along);
        return;
      }
      // Drag pulls the speed towards the air's, exactly over the step, so
      // even the light bridle in a 200 km/h airflow stays stable.
      const rel = this.air.subVectors(n.vel, f.wind);
      const speed = rel.length();
      const k = (0.5 * f.airDensity * n.area * speed) / n.mass;
      n.vel.copy(f.wind).addScaledVector(rel, Math.exp(-k * dt));
      n.vel.y -= GRAVITY * dt;
      n.pos.addScaledVector(n.vel, dt);
      if (n.pos.y < f.ground + 0.05) n.pos.y = f.ground + 0.05;
    });
    // A rope: each stretch no longer than its length, slack allowed.
    for (let iteration = 0; iteration < 8; iteration++) {
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i]!;
        const b = nodes[i + 1]!;
        const d = this.tmp.subVectors(b.pos, a.pos);
        const length = d.length();
        const rest = this.rest[i]!;
        if (length <= rest || length < 1e-9) continue;
        const wa = a.pinned ? 0 : 1 / a.mass;
        const wb = b.pinned ? 0 : 1 / b.mass;
        if (wa + wb === 0) continue;
        d.multiplyScalar((length - rest) / length / (wa + wb));
        if (wa) a.pos.addScaledVector(d, wa);
        if (wb) b.pos.addScaledVector(d, -wb);
      }
    }
    // Nothing goes through the canopy: whatever has got under its top skin
    // is pushed back out, against the canopy where it is at this step.
    const canopy = f.canopy;
    if (canopy) {
      const back = 1 - along;
      for (const n of nodes) {
        if (n.pinned) continue;
        n.pos.addScaledVector(this.shift, back);
        canopy.liftOut(n.pos, n.clear, LIFT_SPEED * dt);
        n.pos.addScaledVector(this.shift, -back);
      }
    }
    nodes.forEach((n, i) => n.vel.subVectors(n.pos, this.old[i]!).divideScalar(dt));
  }

  dispose(): void {
    this.object.traverse((o) => {
      const { geometry, material } = o as THREE.Mesh;
      geometry?.dispose();
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
  }
}
