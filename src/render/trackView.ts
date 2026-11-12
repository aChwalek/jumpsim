// A jump played back from its track (see replay/track.ts): the jumper, their
// canopy, the main once cut away, the reserve, the plane, the body thrown
// about by a crash and the smoke, drawn as they were; and the others on the
// jump, bots or players, as they were drawn then. Nothing is simulated:
// the recorded state is put into flight models only because that is what
// the views read. Its own views, so that the jump under way is left as it is.

import * as THREE from 'three';
import { Markers, type MarkerTarget } from '../net/markers';
import { RemoteJumper } from '../net/remote';
import type { OtherShown, TrackFrame, TrackMeta } from '../replay/track';
import { outfitOf, reserveRigFor, rigFor, suitOf, validSetup, wingColor, type Setup } from '../setup';
import { FlightModel, neutralControls } from '../sim/flightModel';
import { feetHeight } from '../sim/landing';
import { Plane } from '../sim/plane';
import { J } from '../sim/ragdoll';
import type { RigParams } from '../sim/rig';
import { vec3 } from '../sim/vec';
import { CANOPY_COLORS, RESERVE_PALETTE } from './canopyColors';
import { CanopyView, type SliderState } from './canopyView';
import { PlaneView } from './planeView';
import { RagdollView } from './ragdollView';
import { RigView, type RigFrame } from './rigView';
import type { Lighting } from './scene';
import { SMOKE_BURN, SmokeTrail } from './smoke';

/** What the frame gives the replay beyond the track: the ground, the light, the air. */
export interface TrackScene {
  /** Seconds of the replay's clock since the last frame drawn; 0 when paused. */
  dt: number;
  /** The replay has jumped (a seek): what carries on from frame to frame starts again. */
  jumped: boolean;
  wind: THREE.Vector3;
  airDensity: number;
  groundAt: (x: number, z: number, y?: number) => number;
  light: Lighting;
  /** When the smoke was lit, on the track's clock; null for none. */
  smokeLitAt: number | null;
}

export class TrackView {
  /** The pilot as recorded, under the main or the reserve: what the views read, and the camera follows. */
  readonly model: FlightModel;
  /** What the jump was set up with, anything an older version did not keep put back to its default. */
  readonly setup: Setup;
  private readonly mainRig: RigParams;
  private readonly reserveRig: RigParams;
  private view!: RigView;
  /** The main once cut away, drawn on its own. */
  private released: CanopyView | null = null;
  private readonly plane: Plane | null = null;
  private readonly planeView: PlaneView | null = null;
  private readonly ragdoll = new RagdollView();
  private readonly smoke: SmokeTrail | null = null;
  private slider: SliderState = 'open';
  private readonly frame: RigFrame = {
    time: 0,
    dt: 0,
    wind: new THREE.Vector3(),
    airDensity: 1.2,
    deploy: 'stowed',
    deployTime: 0,
    bagOut: 0,
  };
  private readonly heapFrom = new THREE.Vector3();
  private readonly fallTo = new THREE.Vector3();
  private readonly smokeFrom = new THREE.Vector3();
  private readonly smokeBefore = new THREE.Vector3();
  private readonly smokeVel = new THREE.Vector3();
  private smokeWasOut = false;
  private readonly pos = new THREE.Vector3();
  private readonly att = new THREE.Quaternion();
  private readonly air = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly fall = new THREE.Vector3();
  private readonly risers = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly noHands = neutralControls();
  /** The others on the jump, as `meta.others`, drawn as another player is; their names over them. */
  private readonly others: RemoteJumper[] = [];
  private readonly names: string[] = [];
  private readonly markers: Markers | null = null;
  private readonly targets: MarkerTarget[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly meta: TrackMeta,
    light: Lighting,
  ) {
    this.setup = validSetup(meta.setup);
    const gear = this.setup.gear;
    this.mainRig = rigFor(gear);
    this.reserveRig = reserveRigFor(gear);
    this.model = new FlightModel(this.mainRig);
    this.newView(light);
    for (const m of this.ragdoll.materials()) if (m instanceof THREE.MeshLambertMaterial) light.clouds.shade(m, 'light');
    this.ragdoll.setOutfit(outfitOf(gear));
    scene.add(this.ragdoll.object);
    if (meta.plane) {
      const p = meta.plane;
      this.plane = new Plane({ x: 0, z: 0, height: 0, headingDeg: 0, indicatedAirspeed: 0, aircraft: p.aircraft }, vec3());
      Object.assign(this.plane.vel, { x: p.vel[0], y: p.vel[1], z: p.vel[2] });
      Object.assign(this.plane.att, { x: p.att[0], y: p.att[1], z: p.att[2], w: p.att[3] });
      this.planeView = new PlaneView();
      scene.add(this.planeView.object);
    }
    if (gear.smoke !== 'none') {
      this.smoke = new SmokeTrail(gear.smoke, light);
      scene.add(this.smoke.object);
    }
    if (meta.landing) {
      this.heapFrom.fromArray(meta.landing.from);
      this.fallTo.fromArray(meta.landing.fallTo).setY(0);
    }
    for (const m of meta.others ?? []) {
      const jumper = new RemoteJumper(scene);
      // Their gear made safe as ours is.
      jumper.setGear(validSetup({ gear: m.gear }).gear, light);
      this.others.push(jumper);
      this.names.push(typeof m.name === 'string' && m.name ? m.name : '…');
    }
    if (this.others.length) this.markers = new Markers(document.getElementById('hud') ?? document.body);
  }

  /** The plane as it was at the moment shown, if there was one. */
  get planeNow(): Plane | null {
    return this.plane;
  }

  /** A fresh pilot under a fresh main: at the start, or going back to before a cutaway. */
  private newView(light: Lighting): void {
    if (this.view) {
      this.scene.remove(this.view.object);
      this.view.dispose();
    }
    this.dropReleased();
    const gear = this.setup.gear;
    this.view = new RigView(this.mainRig, CANOPY_COLORS[gear.color].cells, light);
    this.view.body.setSuit(suitOf(gear), wingColor(gear.color));
    this.view.setOutfit(outfitOf(gear));
    this.view.body.setSmoke(gear.smoke);
    this.slider = 'open';
    this.scene.add(this.view.object);
  }

  private dropReleased(): void {
    if (!this.released) return;
    this.scene.remove(this.released.object, this.released.shadow, this.released.deployment.object);
    this.released.dispose();
    this.released = null;
  }

  /** The canopies as the moment has them: the main, cut away or not, the reserve. `jumped`: at once. */
  private fitCanopies(f: TrackFrame, light: Lighting, jumped: boolean): void {
    const view = this.view;
    // Back before the cutaway or the reserve: a fresh rig, then on from there.
    if ((this.released && !f.hasReleased) || (view.canopy.reserve && !f.reserve)) this.newView(light);
    if (f.hasReleased && !this.released && !this.view.detached && !this.view.canopy.reserve) {
      this.released = this.view.detachCanopy();
      this.scene.add(this.released.object, this.released.shadow, this.released.deployment.object);
    }
    if (f.reserve && !this.view.canopy.reserve) {
      // Fired with the main still packed: that main is never drawn.
      if (!this.view.detached) this.view.detachCanopy().dispose();
      this.view.attachCanopy(new CanopyView(this.reserveRig, RESERVE_PALETTE, light, true));
    }
    this.model.rig = f.reserve ? this.reserveRig : this.mainRig;
    if (!f.reserve && !this.view.detached && f.slider !== this.slider) {
      this.view.canopy.setSlider(f.slider, jumped);
      this.slider = f.slider;
    }
  }

  update(f: TrackFrame, s: TrackScene, others: readonly OtherShown[] = []): void {
    if (s.jumped) {
      this.smoke?.clear();
      this.smokeWasOut = false;
    }
    this.drawOthers(f, s, others);
    this.fitCanopies(f, s.light, s.jumped);
    const view = this.view;
    const st = this.model.state;
    Object.assign(st.pos, f.pos);
    Object.assign(st.vel, f.vel);
    Object.assign(st.att, f.att);
    Object.assign(st.pilotAtt, f.pilotAtt);
    st.pilotOmega.x = st.pilotOmega.y = st.pilotOmega.z = 0;
    this.model.deflationL = f.deflationL;
    this.model.deflationR = f.deflationR;

    view.setInflation(f.inflation);
    view.setArms(f.onRisers && !f.hasJoints);
    view.body.setPose(f.pose);
    view.body.showArms(!f.onRisers);
    view.body.setHeight(feetHeight(this.model, s.groundAt));
    view.body.setHandles(f.mainHandle, f.reserveHandle);
    view.body.group.visible = !f.hasJoints;
    this.ragdoll.update(f.hasJoints ? f.joints : null);
    if (!view.detached) {
      if (f.heap > 0 && this.meta.landing) view.canopy.setHeap(f.heap, this.heapFrom, this.fallTo);
      else view.canopy.setHeap(0);
    }
    const frame = this.frame;
    frame.time = f.t;
    frame.dt = s.dt;
    frame.wind.copy(s.wind);
    frame.airDensity = s.airDensity;
    frame.deploy = f.deploy;
    frame.deployTime = f.deployTime;
    frame.bagOut = f.bagOut;
    view.update(this.model, f.controls, s.groundAt, s.light, f.hands, frame);
    this.drawReleased(f, s);
    this.drawPlane(f.t);
    this.drawSmoke(f, s);
  }

  /** The others where they were, on the replay's clock. */
  private drawOthers(f: TrackFrame, s: TrackScene, others: readonly OtherShown[]): void {
    const frame = { now: f.t * 1000, dt: s.dt, time: f.t, wind: s.wind, airDensity: s.airDensity, groundAt: s.groundAt, light: s.light };
    this.others.forEach((jumper, i) => {
      const o = others[i];
      if (s.jumped) jumper.restart();
      jumper.live = o?.snap ?? null;
      jumper.update(frame, !!o?.shown);
    });
  }

  /** Their names over the others in sight, arrows at the edge for the rest. After the camera has moved. */
  drawMarkers(camera: THREE.PerspectiveCamera): void {
    if (!this.markers) return;
    const targets = this.targets;
    let n = 0;
    this.others.forEach((jumper, i) => {
      const target = (targets[n] ??= { id: '', name: '', pos: new THREE.Vector3(), color: '' });
      if (!jumper.where(target.pos)) return;
      target.id = `other-${i}`;
      target.name = this.names[i]!;
      target.color = jumper.color;
      n++;
    });
    targets.length = n;
    this.markers.update(camera, targets, null);
  }

  /** The main once cut away, where it drifts, then in a heap where it lands. */
  private drawReleased(f: TrackFrame, s: TrackScene): void {
    const view = this.released;
    if (!view || !f.hasReleased) return;
    const r = f.released;
    this.pos.set(r.pos.x, r.pos.y, r.pos.z);
    this.att.set(r.att.x, r.att.y, r.att.z, r.att.w);
    this.air.copy(s.wind).sub(this.top.set(r.vel.x, r.vel.y, r.vel.z));
    view.setCrumple(r.crumple);
    view.setHeap(r.heap, this.pos, this.fall.set(r.fallTo.x, 0, r.fallTo.z));
    const ground = s.groundAt(r.pos.x, r.pos.z, r.pos.y);
    view.update(
      this.pos,
      this.att,
      { time: f.t, dt: s.dt, air: this.air, controls: this.noHands, hands: this.noHands, pilotAtt: null, ground },
      s.light,
    );
    view.topAttach(this.top);
    view.deployment.update({
      stage: 'canopy',
      dt: s.dt,
      wind: s.wind,
      airDensity: s.airDensity,
      hand: this.top,
      pin: this.top,
      vel: this.pos,
      launch: this.pos,
      bagOut: this.top,
      canopyTop: this.top,
      canopy: view,
      pilotChuteOpen: 0,
      stageTime: 10,
      risers: this.risers,
      ground,
    });
  }

  /** The plane flies straight on at the speed it had. */
  private drawPlane(t: number): void {
    const p = this.meta.plane;
    if (!p || !this.plane || !this.planeView) return;
    const dt = t - p.t;
    this.plane.pos.x = p.pos[0]! + p.vel[0]! * dt;
    this.plane.pos.y = p.pos[1]! + p.vel[1]! * dt;
    this.plane.pos.z = p.pos[2]! + p.vel[2]! * dt;
    // Three-blade propellers at about 1700 rpm, as the plane turns them.
    this.plane.prop = (180 * t) % (2 * Math.PI);
    this.planeView.update(this.plane);
  }

  /** Lit on leaving, smoking for a while: from the foot thrown about by a crash, or the pilot's own. */
  private drawSmoke(f: TrackFrame, s: TrackScene): void {
    if (!this.smoke) return;
    const lit = s.smokeLitAt;
    const burning = lit !== null && f.t >= lit && f.t - lit < SMOKE_BURN;
    if (!burning || s.dt <= 0) {
      if (!burning) this.smokeWasOut = false;
      return this.smoke.update(s.dt, null, this.smokeVel, s.wind);
    }
    if (f.hasJoints) this.smokeFrom.fromArray(f.joints, 3 * J.footR);
    else this.view.body.smokePoint(this.smokeFrom);
    if (this.smokeWasOut) this.smokeVel.subVectors(this.smokeFrom, this.smokeBefore).divideScalar(s.dt);
    else this.smokeVel.set(f.vel.x, f.vel.y, f.vel.z);
    this.smokeBefore.copy(this.smokeFrom);
    this.smokeWasOut = true;
    this.smoke.update(s.dt, this.smokeFrom, this.smokeVel, s.wind);
  }

  dispose(): void {
    for (const jumper of this.others) jumper.dispose();
    this.markers?.dispose();
    this.scene.remove(this.view.object);
    this.view.dispose();
    this.dropReleased();
    this.scene.remove(this.ragdoll.object);
    this.ragdoll.object.traverse((node) => {
      const { geometry, material } = node as THREE.Mesh;
      geometry?.dispose();
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
    if (this.planeView) {
      this.scene.remove(this.planeView.object);
      this.planeView.dispose();
    }
    if (this.smoke) {
      this.scene.remove(this.smoke.object);
      this.smoke.dispose();
    }
  }
}
