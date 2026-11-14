import * as THREE from 'three';
import { CANOPY_COLORS, RESERVE_PALETTE } from '../render/canopyColors';
import { CanopyView } from '../render/canopyView';
import { Posture } from '../render/posture';
import { RigView, type RigFrame } from '../render/rigView';
import { SMOKE_BURN } from '../render/smoke';
import { fitTrail, type Trail } from '../render/sparks';
import type { Lighting } from '../render/scene';
import { outfitOf, reserveRigFor, rigFor, sameFlight, suitOf, wingColor, type Gear } from '../setup';
import { hasWings } from '../sim/suit';
import { FlightModel } from '../sim/flightModel';
import { noBodyInputs } from '../sim/freefall';
import { feetHeight } from '../sim/landing';
import { Stride } from '../sim/runUp';
import type { Vec3 } from '../sim/vec';
import { SnapshotBuffer } from './interp';
import { copySnapshot, emptySnapshot, type Snapshot } from './snapshot';

/** What the frame gives every other jumper: the ground, the light, the air. */
export interface RemoteFrame {
  /** Local clock, ms. */
  now: number;
  dt: number;
  time: number;
  wind: THREE.Vector3;
  airDensity: number;
  groundAt: (x: number, z: number, y?: number) => number;
  light: Lighting;
}

const still = noBodyInputs();

/**
 * Another player's jumper, drawn from what they send. Nothing is simulated
 * here: their sim runs on their machine. Their state is put into flight
 * models only because that is what the views read.
 */
export class RemoteJumper {
  readonly buffer = new SnapshotBuffer();
  /**
   * Simulated on this machine (a bot): drawn as it is right now, from this,
   * and not a moment in the past from what came over the network.
   */
  live: Snapshot | null = null;
  private readonly now = emptySnapshot();
  private readonly posture = new Posture();
  /** On top of an object, the legs of the run, from how fast they go: no keys of theirs come here. */
  private readonly stride = new Stride();
  /** Where they were in their jump at the last frame drawn. */
  private phase: string | null = null;
  /** They left their plane at this frame. */
  exited = false;
  private readonly att = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private gear: Gear | null = null;
  private main: FlightModel | null = null;
  private reserve: FlightModel | null = null;
  private view: RigView | null = null;
  /** Their smoke, if they jump with a canister; lit when they left (local clock, ms). */
  private smoke: Trail | null = null;
  private smokeLitAt: number | null = null;
  private wasLanded = false;
  private readonly smokeFrom = new THREE.Vector3();
  private readonly smokeVel = new THREE.Vector3();
  private readonly frame: RigFrame = {
    time: 0,
    dt: 0,
    wind: new THREE.Vector3(),
    airDensity: 1.2,
    deploy: 'stowed',
    deployTime: 0,
    bagOut: 0,
  };

  constructor(private readonly scene: THREE.Scene) {}

  /** What they fly. A new canopy or weight brings a new view. */
  setGear(gear: Gear, light: Lighting): void {
    const before = this.gear;
    this.gear = gear;
    this.fitSmoke(light);
    this.fitSuit();
    if (before && sameFlight(before, gear) && before.color === gear.color) return;
    if (!before || !sameFlight(before, gear)) {
      this.main = new FlightModel(rigFor(gear));
      this.reserve = new FlightModel(reserveRigFor(gear));
    }
    this.newView(light);
  }

  update(f: RemoteFrame, visible: boolean): void {
    const view = this.view;
    const s = this.now;
    if (!view || !this.main || !this.reserve) return;
    const sampled = visible && (this.live ? (copySnapshot(s, this.live), true) : this.buffer.sample(f.now, s));
    // Into freefall from anything but freefall, and not by a cutaway: out of the plane,
    // even if the snapshots from the door were missed.
    this.exited = sampled && this.phase !== null && this.phase !== 'freefall' && s.phase === 'freefall' && !s.cutaway;
    if (sampled) this.phase = s.phase;
    // In their plane, which is not drawn here yet: not shown either. A bot is in ours, which is:
    // there in the door with us, to be seen and picked as a target before the exit.
    view.object.visible = sampled && (s.phase !== 'plane' || this.live !== null);
    if (!view.object.visible) {
      // Back in their plane: a new canister for the next jump. The smoke left drifts on.
      if (sampled) this.smokeLitAt = null;
      this.smoke?.update(f.dt, null, this.smokeVel, f.wind);
      return;
    }

    // A new jump after a reserve ride or a cutaway: a fresh rig.
    if (!s.reserve && !s.cutaway && (view.detached || view.canopy.reserve)) return this.newView(f.light);
    // Cut away: the main goes, and is not drawn on its way down here.
    if ((s.cutaway || s.reserve) && !view.detached && !view.canopy.reserve) view.detachCanopy().dispose();
    if (s.reserve && view.detached) {
      view.attachCanopy(new CanopyView(this.reserve.rig, RESERVE_PALETTE, f.light, true));
      seenFromAfar(view.object);
    }

    const model = s.reserve ? this.reserve : this.main;
    const st = model.state;
    Object.assign(st.pos, s.pos);
    Object.assign(st.vel, s.vel);
    Object.assign(st.att, s.att);
    Object.assign(st.pilotAtt, s.pilotAtt);
    model.deflationL = s.deflationL;
    model.deflationR = s.deflationR;

    view.setInflation(s.inflation);
    view.setArms(s.onRisers);
    if (s.phase === 'standing') this.stride.step(f.dt, Math.hypot(s.vel.x, s.vel.z));
    view.body.setPose(this.posture.update(f.dt, s.stance, still, s.phase === 'standing' ? [this.stride.legL, this.stride.legR] : undefined));
    view.body.showArms(!s.onRisers);
    view.body.setHeight(feetHeight(model, f.groundAt));
    view.body.setHandles(s.mainHandle, s.reserveHandle);
    if (!view.detached) view.canopy.setHeap(0);
    const frame = this.frame;
    frame.time = f.time;
    frame.dt = f.dt;
    frame.wind.copy(f.wind);
    frame.airDensity = f.airDensity;
    frame.deploy = s.deploy;
    frame.deployTime = s.deployTime;
    frame.bagOut = s.bagOut;
    view.update(model, s.controls, f.groundAt, f.light, s.hands, frame);
    this.drawSmoke(f, view);
  }

  /** What they were drawn from at the last frame, if drawn. */
  get drawn(): Snapshot | null {
    return this.view?.object.visible ? this.now : null;
  }

  /** What they fly, once known. */
  get gearOf(): Gear | null {
    return this.gear;
  }

  /** Gone to another moment of a replay: no smoke lit, the body straight into its stance. */
  restart(): void {
    this.smokeLitAt = null;
    this.wasLanded = false;
    this.phase = null;
    this.posture.reset();
    this.smoke?.clear();
  }

  dispose(): void {
    this.dropSmoke();
    this.disposeView();
  }

  private disposeView(): void {
    if (!this.view) return;
    this.scene.remove(this.view.object);
    this.view.dispose();
    this.view = null;
  }

  private newView(light: Lighting): void {
    if (!this.gear || !this.main) return;
    this.disposeView();
    this.view = new RigView(this.main.rig, CANOPY_COLORS[this.gear.color].cells, light);
    this.view.object.visible = false;
    seenFromAfar(this.view.object);
    this.scene.add(this.view.object);
    this.view.body.setSmoke(this.gear.smoke);
    this.fitSuit();
  }

  /** Their suit, its wings of their canopy's colour, in the colours they wear. */
  private fitSuit(): void {
    if (!this.gear) return;
    const suit = suitOf(this.gear);
    this.view?.body.setSuit(suit, wingColor(this.gear.color));
    this.view?.setOutfit(outfitOf(this.gear));
    this.posture.wings = hasWings(suit) ? suit.level : null;
  }

  /** A canister on their ankle, and a trail for it, as their gear has it. */
  private fitSmoke(light: Lighting): void {
    const kind = this.gear?.smoke ?? 'none';
    this.view?.body.setSmoke(kind);
    if (kind === 'none') return this.dropSmoke();
    const trail = fitTrail(kind, light, this.smoke);
    if (trail === this.smoke) return;
    this.dropSmoke();
    this.smoke = trail;
    this.scene.add(trail.object);
  }

  private dropSmoke(): void {
    if (!this.smoke) return;
    this.scene.remove(this.smoke.object);
    this.smoke.dispose();
    this.smoke = null;
  }

  /** Lit when they leave the plane or the object (at once under canopy), out after its burn; again on their next jump. */
  private drawSmoke(f: RemoteFrame, view: RigView): void {
    const s = this.now;
    const aboard = s.phase === 'plane' || s.phase === 'standing';
    if (aboard || (this.wasLanded && !s.landed)) this.smokeLitAt = null;
    this.wasLanded = s.landed;
    if (!this.smoke) return;
    if (!aboard && this.smokeLitAt === null) this.smokeLitAt = f.now;
    const burning = this.smokeLitAt !== null && f.now - this.smokeLitAt < SMOKE_BURN * 1000;
    this.smokeVel.set(s.vel.x, s.vel.y, s.vel.z);
    this.smoke.update(f.dt, burning ? view.body.smokePoint(this.smokeFrom) : null, this.smokeVel, f.wind);
  }

  /**
   * The middle of their body and how fast it goes, world frame, while they
   * are in the air and drawn: what can be bumped into. `falling`: in freefall.
   */
  body(pos: Vec3, vel: Vec3): { falling: boolean } | null {
    const s = this.now;
    if (!this.view?.object.visible || !this.main || !this.reserve) return null;
    if (s.landed || (s.phase !== 'freefall' && s.phase !== 'opening' && s.phase !== 'canopy')) return null;
    const model = s.reserve ? this.reserve : this.main;
    model.pilotPoint(pos, model.rig.pilotPos);
    Object.assign(vel, s.vel);
    return { falling: s.phase === 'freefall' };
  }

  /** Where they are now, if drawn: over their head, or over their canopy once it is out. */
  where(out: THREE.Vector3): THREE.Vector3 | null {
    const s = this.now;
    if (!this.view?.object.visible || !this.main) return null;
    const open = s.inflation !== null && s.inflation > 0.3 && !s.landed;
    const rig = (s.reserve && this.reserve ? this.reserve : this.main).rig;
    this.att.set(s.att.x, s.att.y, s.att.z, s.att.w);
    out.set(0, open ? rig.canopyPos.y + 0.8 : 1.2, 0);
    if (open) out.applyQuaternion(this.att);
    return out.add(this.at.set(s.pos.x, s.pos.y, s.pos.z));
  }

  /** The colour of their canopy, for their marker. */
  get color(): string {
    const cells = this.gear ? CANOPY_COLORS[this.gear.color].cells : [0xffffff];
    const c = cells[1] ?? cells[0] ?? 0xffffff;
    return `#${c.toString(16).padStart(6, '0')}`;
  }
}

/**
 * Our own body and gear are drawn by a camera of their own that sees no
 * further than arm's reach, and our head not at all. Someone else's are
 * scenery like any other: all of it on the main camera's layer.
 */
function seenFromAfar(object: THREE.Object3D): void {
  object.traverse((node) => node.layers.set(0));
}
