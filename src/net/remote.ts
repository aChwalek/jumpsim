import * as THREE from 'three';
import { copyPose } from '../render/body';
import { CANOPY_COLORS, RESERVE_PALETTE } from '../render/canopyColors';
import { CanopyView } from '../render/canopyView';
import { FREEFALL_STANCES, Posture } from '../render/posture';
import { RagdollView } from '../render/ragdollView';
import { ReleasedMain } from '../render/releasedMain';
import { RigView, type RigFrame } from '../render/rigView';
import { SMOKE_BURN } from '../render/smoke';
import { fitTrail, type Trail } from '../render/sparks';
import type { Lighting } from '../render/scene';
import { outfitOf, reserveRigFor, rigFor, sameFlight, suitOf, wingColor, type Gear } from '../setup';
import { hasWings } from '../sim/suit';
import { FlightModel } from '../sim/flightModel';
import { noBodyInputs } from '../sim/freefall';
import { feetHeight } from '../sim/landing';
import type { AircraftId } from '../sim/plane';
import { J } from '../sim/ragdoll';
import { Stride } from '../sim/runUp';
import { vec3, type Vec3 } from '../sim/vec';
import { SnapshotBuffer } from './interp';
import { copySnapshot, emptySnapshot, type PlaneFrame, type Snapshot } from './snapshot';

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
  /** Our plane, on a jump from one: those in theirs, on the same load, are drawn in it. */
  plane?: OurPlane | null;
  /**
   * When what we draw of ourselves is true, on the room's clock (ms), which
   * the others stamp what they send with: they are drawn as they are at that
   * same moment. Absent for a bot or a replay.
   */
  roomTime?: number;
}

/** What of our plane the others are drawn in. */
export interface OurPlane {
  pos: Vec3;
  vel: Vec3;
  headingDeg: number;
  type: { id: AircraftId };
}

/**
 * Flown on to now by at most this, ms. What comes is drawn about 150 to
 * 250 ms late (the network, and the snapshots kept to go between): 8 to 14 m
 * of a fall at 55 m/s, enough to see a jumper level with us well above.
 * Past this, they are no longer heard from, and wait where they were.
 */
const MAX_LEAD_MS = 500;
/** A stamp further than this from the room's clock is not on it: a sender of an older version, ms. */
const ON_THE_CLOCK_MS = 10_000;

/** Whether a stamp `t` is on the room's clock, read at `roomTime`: not from a sender of an older version. */
export const onTheClock = (roomTime: number | undefined, t: number): roomTime is number =>
  roomTime !== undefined && Math.abs(roomTime - t) < ON_THE_CLOCK_MS;

/**
 * How long before `roomTime`, s, a snapshot stamped `t` on the room's clock
 * was true: what they are to be flown on by. Zero when the stamp is not on
 * the room's clock.
 */
export function leadOf(roomTime: number | undefined, t: number): number {
  if (!onTheClock(roomTime, t)) return 0;
  return Math.min(Math.max(roomTime - t, 0), MAX_LEAD_MS) / 1000;
}

/**
 * Where they are `lead` s later, going on as they went: what was true when
 * they sent it is drawn where it is now. A cut-away main goes on its own way.
 */
export function flyOn(s: Snapshot, lead: number): Snapshot {
  s.pos.x += s.vel.x * lead;
  s.pos.y += s.vel.y * lead;
  s.pos.z += s.vel.z * lead;
  if (s.hasReleased) {
    const r = s.released;
    r.pos.x += r.vel.x * lead;
    r.pos.y += r.vel.y * lead;
    r.pos.z += r.vel.z * lead;
  }
  return s;
}

/** Out of their plane, the gap between it and ours closes over this long, ms: they come to where they are. */
const GAP_CLOSES_MS = 6000;
/** Two planes this near on the same heading are the same load, m: one leaving a moment after the other. */
const SAME_LOAD_ALONG = 400;
const SAME_LOAD_UP = 30;
const SAME_LOAD_DEG = 2;

/**
 * From their plane to ours, world frame, m, into `out`: where they are in
 * theirs is then where they are in ours. Null when theirs is not on the same
 * load as ours: another aircraft, another height or run, a load before or
 * after, or a jump alone in a public room. `lead`: how long ago, s, what they
 * sent was true, and they have been flown on by since: theirs is flown on by
 * as much, and what is left is the two clocks' disagreement, a few cm. Without
 * it, mostly how far the plane has gone since.
 */
export function planeGap(ours: OurPlane, theirs: PlaneFrame, out: Vec3, lead = 0): Vec3 | null {
  if (ours.type.id !== theirs.aircraft) return null;
  const turn = Math.abs(((((ours.headingDeg - theirs.headingDeg) % 360) + 540) % 360) - 180);
  out.x = ours.pos.x - theirs.pos.x;
  out.y = ours.pos.y - theirs.pos.y;
  out.z = ours.pos.z - theirs.pos.z;
  if (turn >= SAME_LOAD_DEG || Math.abs(out.y) >= SAME_LOAD_UP || Math.hypot(out.x, out.z) >= SAME_LOAD_ALONG) return null;
  out.x -= ours.vel.x * lead;
  out.y -= ours.vel.y * lead;
  out.z -= ours.vel.z * lead;
  return out;
}

/** Everything of theirs that is somewhere, moved by `d` times `k`. */
function shiftSnapshot(s: Snapshot, d: Vec3, k: number): void {
  const [x, y, z] = [d.x * k, d.y * k, d.z * k];
  s.pos.x += x;
  s.pos.y += y;
  s.pos.z += z;
  if (s.hasJoints) {
    for (let i = 0; i < s.joints.length; i += 3) {
      s.joints[i]! += x;
      s.joints[i + 1]! += y;
      s.joints[i + 2]! += z;
    }
  }
  if (s.hasReleased) {
    s.released.pos.x += x;
    s.released.pos.y += y;
    s.released.pos.z += z;
  }
}

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const still = noBodyInputs();
/** Where a canopy gathered up off the ground is held, pilot frame: against the belly. */
const CARRY_AT = vec3(0, -0.55, -0.42);

/**
 * Another player's jumper, drawn from what they send: all of it as they draw
 * it, the body, the canopy, the slider, the twists, the heap on the ground,
 * a crash, a main cut away. Nothing is simulated here: their sim runs on
 * their machine. Their state is put into flight models only because that is
 * what the views read. A bot's body is posed here, from its stance and keys.
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
  /** On the same load as us: drawn in our plane, then out of it. */
  private aboard = false;
  /** From their plane to ours, world frame, m: what they are moved by while in it. */
  private readonly gap = vec3();
  /** Out of our plane since then (local clock, ms): the gap closes. */
  private leftAt: number | null = null;
  private readonly att = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private gear: Gear | null = null;
  private main: FlightModel | null = null;
  private reserve: FlightModel | null = null;
  private view: RigView | null = null;
  /** Their main once cut away, and their body thrown about by a crash: made when first needed. */
  private released: CanopyView | null = null;
  private readonly releasedMain = new ReleasedMain();
  private ragdoll: RagdollView | null = null;
  /** The slider straight to how it is, not sliding there: a new rig, a jump in a replay. */
  private jumped = true;
  private readonly heapFrom = new THREE.Vector3();
  private readonly fallTo = new THREE.Vector3();
  private readonly walked = new THREE.Vector3();
  private readonly bundle = new THREE.Vector3();
  private readonly carried = vec3();
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
    // Stamped on the room's clock: never later than the moment we are at, should we be behind it.
    const notAfter = onTheClock(f.roomTime, this.buffer.newest) ? f.roomTime : Number.POSITIVE_INFINITY;
    const sampled = visible && (this.live ? (copySnapshot(s, this.live), true) : this.buffer.sample(f.now, s, notAfter));
    // Into freefall from anything but freefall, and not by a cutaway: out of the plane,
    // even if the snapshots from the door were missed.
    this.exited = sampled && this.phase !== null && this.phase !== 'freefall' && s.phase === 'freefall' && !s.cutaway;
    if (sampled) this.phase = s.phase;
    // What came is a moment old: flown on to now, where they are on their own screen. Not on the
    // ground, nor thrown about by a crash: they stay where they are. A bot is drawn as it is now.
    const lead = sampled && this.live === null && !s.landed && !s.hasJoints ? leadOf(f.roomTime, s.t) : 0;
    if (lead > 0) flyOn(s, lead);
    // In their plane, drawn in ours if it is the same load: in the hold or at the door with us, to be
    // seen and picked as a target before the exit. Another plane is not drawn here: nor are they. A bot
    // is in ours already.
    const inOurs = sampled && this.live === null && this.board(s, f, lead);
    view.object.visible = sampled && (s.phase !== 'plane' || this.live !== null || inOurs);
    if (!view.object.visible) {
      // Back in their plane: a new canister for the next jump. The smoke left drifts on.
      if (sampled) this.smokeLitAt = null;
      this.smoke?.update(f.dt, null, this.smokeVel, f.wind);
      this.ragdoll?.update(null);
      this.dropReleased();
      return;
    }

    // A new jump after a reserve ride or a cutaway: a fresh rig.
    if (!s.reserve && !s.cutaway && (view.detached || view.canopy.reserve)) return this.newView(f.light);
    // Cut away: the main goes its own way, drawn where they say it is.
    if ((s.cutaway || s.reserve) && !view.detached && !view.canopy.reserve) {
      const main = view.detachCanopy();
      if (s.cutaway && s.hasReleased) this.keepReleased(main);
      else main.dispose();
    }
    if (!s.hasReleased) this.dropReleased();
    else if (s.cutaway && !this.released && this.gear && this.main) {
      // Seen again with their main still on its way down: drawn anew.
      const main = new CanopyView(this.main.rig, CANOPY_COLORS[this.gear.color].cells, f.light);
      main.setReleased(true);
      main.setSlider(s.slider, true);
      this.keepReleased(main);
    }
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
    st.twist = s.twist;
    model.deflationL = s.deflationL;
    model.deflationR = s.deflationR;
    if (lead > 0) {
      // Flown on, not into the ground: on their screen they touch down before going under it.
      const under = feetHeight(model, f.groundAt);
      if (under < 0) {
        st.pos.y -= under;
        s.pos.y -= under;
      }
    }

    view.setInflation(s.inflation);
    view.setArms(s.onRisers && !s.hasJoints);
    if (!s.posed) {
      // A bot: posed here. Kept as drawn, for the replay of the jump.
      if (s.phase === 'standing') this.stride.step(f.dt, Math.hypot(s.vel.x, s.vel.z));
      const legs: [number, number] | undefined = s.phase === 'standing' ? [this.stride.legL, this.stride.legR] : undefined;
      copyPose(s.pose, this.posture.update(f.dt, s.stance, FREEFALL_STANCES.has(s.stance) ? s.body : still, legs));
      s.posed = true;
    }
    view.body.setPose(s.pose);
    view.body.showArms(!s.onRisers);
    view.body.setHeight(feetHeight(model, f.groundAt));
    view.body.setHandles(s.mainHandle, s.reserveHandle);
    // Thrown about by a crash: the ragdoll instead of the body.
    view.body.group.visible = !s.hasJoints;
    if (s.hasJoints) this.ragdollOf(f.light).update(s.joints);
    else this.ragdoll?.update(null);
    if (!view.detached) {
      const canopy = view.canopy;
      if (!s.reserve) canopy.setSlider(s.slider, this.jumped);
      if (s.heap > 0) canopy.setHeap(s.heap, this.heapFrom.set(s.heapFrom.x, s.heapFrom.y, s.heapFrom.z), this.fallTo.set(s.fallTo.x, 0, s.fallTo.z));
      else canopy.setHeap(0);
      if (s.walker) canopy.dragHeap(this.walked.set(s.pos.x, 0, s.pos.z));
      if (s.gather > 0) {
        const p = model.pilotPoint(this.carried, CARRY_AT);
        canopy.setGather(s.gather, this.bundle.set(p.x, p.y, p.z));
      } else canopy.setGather(0);
    }
    this.jumped = false;
    const frame = this.frame;
    frame.time = f.time;
    frame.dt = f.dt;
    frame.wind.copy(f.wind);
    frame.airDensity = f.airDensity;
    frame.deploy = s.deploy;
    frame.deployTime = s.deployTime;
    frame.bagOut = s.bagOut;
    view.update(model, s.controls, f.groundAt, f.light, s.hands, frame);
    if (this.released) {
      const { time, dt, wind, airDensity, groundAt, light } = f;
      this.releasedMain.draw(this.released, s.released, { time, dt, wind, airDensity, groundAt, light });
    }
    this.drawSmoke(f, view);
  }

  /**
   * In their plane, on the same load: moved into ours, to where they are in
   * theirs. Out of it, moved by the gap between the two planes, less and less
   * until they are where they are. True while in a plane and drawn in ours.
   * `lead`: they have been flown on by this, s, from what they sent.
   */
  private board(s: Snapshot, f: RemoteFrame, lead: number): boolean {
    if (s.phase === 'plane') {
      this.leftAt = null;
      this.aboard = s.hasPlane && f.plane != null && planeGap(f.plane, s.plane, this.gap, lead) !== null;
      if (this.aboard) shiftSnapshot(s, this.gap, 1);
      return this.aboard;
    }
    if (!this.aboard) return false;
    this.leftAt ??= f.now;
    const k = 1 - ease((f.now - this.leftAt) / GAP_CLOSES_MS);
    if (k > 0) shiftSnapshot(s, this.gap, k);
    else this.aboard = false;
    return false;
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
    this.jumped = true;
    this.smokeLitAt = null;
    this.wasLanded = false;
    this.phase = null;
    this.aboard = false;
    this.leftAt = null;
    this.posture.reset();
    this.smoke?.clear();
  }

  dispose(): void {
    this.dropSmoke();
    this.disposeView();
    if (this.ragdoll) {
      this.scene.remove(this.ragdoll.object);
      this.ragdoll.object.traverse((node) => {
        const { geometry, material } = node as THREE.Mesh;
        geometry?.dispose();
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
      });
      this.ragdoll = null;
    }
  }

  private disposeView(): void {
    this.dropReleased();
    if (!this.view) return;
    this.scene.remove(this.view.object);
    this.view.dispose();
    this.view = null;
  }

  private keepReleased(main: CanopyView): void {
    for (const o of [main.object, main.shadow, main.deployment.object]) {
      seenFromAfar(o);
      this.scene.add(o);
    }
    this.released = main;
  }

  private dropReleased(): void {
    if (!this.released) return;
    this.scene.remove(this.released.object, this.released.shadow, this.released.deployment.object);
    this.released.dispose();
    this.released = null;
  }

  /** Their body thrown about by a crash, in what they wear. */
  private ragdollOf(light: Lighting): RagdollView {
    if (this.ragdoll) return this.ragdoll;
    const ragdoll = new RagdollView();
    for (const m of ragdoll.materials()) if (m instanceof THREE.MeshLambertMaterial) light.clouds.shade(m, 'light');
    if (this.gear) ragdoll.setOutfit(outfitOf(this.gear));
    seenFromAfar(ragdoll.object);
    this.scene.add(ragdoll.object);
    return (this.ragdoll = ragdoll);
  }

  private newView(light: Lighting): void {
    if (!this.gear || !this.main) return;
    this.disposeView();
    this.jumped = true;
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
    this.ragdoll?.setOutfit(outfitOf(this.gear));
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
    // From the foot thrown about by a crash, or the body's own.
    const from = s.hasJoints ? this.smokeFrom.fromArray(s.joints, 3 * J.footR) : view.body.smokePoint(this.smokeFrom);
    this.smoke.update(f.dt, burning ? from : null, this.smokeVel, f.wind);
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
