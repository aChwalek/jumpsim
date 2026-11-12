import * as THREE from 'three';
import { CANOPY_COLORS, RESERVE_PALETTE } from '../render/canopyColors';
import { CanopyView } from '../render/canopyView';
import { Posture } from '../render/posture';
import { RigView, type RigFrame } from '../render/rigView';
import type { Lighting } from '../render/scene';
import { reserveRigFor, rigFor, sameFlight, type Gear } from '../setup';
import { FlightModel } from '../sim/flightModel';
import { noBodyInputs } from '../sim/freefall';
import { feetHeight } from '../sim/landing';
import { SnapshotBuffer } from './interp';
import { emptySnapshot } from './snapshot';

/** What the frame gives every other jumper: the ground, the light, the air. */
export interface RemoteFrame {
  /** Local clock, ms. */
  now: number;
  dt: number;
  time: number;
  wind: THREE.Vector3;
  airDensity: number;
  groundAt: (x: number, z: number) => number;
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
  private readonly now = emptySnapshot();
  private readonly posture = new Posture();
  private readonly att = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private gear: Gear | null = null;
  private main: FlightModel | null = null;
  private reserve: FlightModel | null = null;
  private view: RigView | null = null;
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
    // In their plane, which is not drawn here yet: not shown either.
    view.object.visible = visible && this.buffer.sample(f.now, s) && s.phase !== 'plane';
    if (!view.object.visible) return;

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

    view.setInflation(s.inflation);
    view.setArms(s.onRisers);
    view.body.setPose(this.posture.update(f.dt, s.stance, still));
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
  }

  dispose(): void {
    if (!this.view) return;
    this.scene.remove(this.view.object);
    this.view.dispose();
    this.view = null;
  }

  private newView(light: Lighting): void {
    if (!this.gear || !this.main) return;
    this.dispose();
    this.view = new RigView(this.main.rig, CANOPY_COLORS[this.gear.color].cells, light);
    this.view.object.visible = false;
    seenFromAfar(this.view.object);
    this.scene.add(this.view.object);
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
