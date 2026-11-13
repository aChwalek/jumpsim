// The pilot and the canopy over them, as drawn: the body in its harness, the
// canopy it hangs from (the main, or the reserve once the main is gone), and
// the shadows both cast on the ground (a strong height cue near landing).

import * as THREE from 'three';
import type { Controls, FlightModel } from '../sim/flightModel';
import type { RigParams } from '../sim/rig';
import { BOC, Body, PIN, RESERVE_PIN, RING } from './body';
import { CanopyView, type CanopyLook } from './canopyView';
import type { DeployStage } from './deployment';
import { DEFAULT_HELMET, DEFAULT_SUIT, OUTFIT_COLORS, type Outfit } from './outfit';
import type { Lighting } from './scene';

/** What the frame needs to know beyond the flight model. */
export interface RigFrame {
  time: number;
  dt: number;
  wind: THREE.Vector3;
  airDensity: number;
  /** Where the pilot chute and bag are, and how long they have been there, s. */
  deploy: DeployStage;
  deployTime: number;
  /** While the lines pay out: how far the bag has been carried, 0 at the container to 1 at line stretch. */
  bagOut: number;
}

export class RigView {
  /** Everything, world frame: add it to the scene. */
  readonly object = new THREE.Group();
  /** The pilot's body, which hangs from the risers and follows its own frame. */
  readonly pilot = new THREE.Group();
  /** The pilot's body, posed by whoever drives it. */
  readonly body: Body;
  /** The canopy the pilot hangs from, or will. */
  canopy: CanopyView;
  /** It has been cut away and is no longer this view's to draw. */
  detached = false;

  private readonly pilotShadow: THREE.Mesh;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly shadow = new THREE.Group();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly att = new THREE.Quaternion();
  private readonly pilotAtt = new THREE.Quaternion();
  private readonly look: CanopyLook;
  private readonly air = new THREE.Vector3();
  private readonly flow = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly pin = new THREE.Vector3();
  private readonly bagOut = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly risers = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly launch = new THREE.Vector3();
  /** The main's pilot chute: open while it pulls, then collapsed by its kill line. */
  private pilotChuteOpen = 0;
  /** What the pilot wears, kept for a canopy hung later (the reserve). */
  private outfit: Outfit = { helmet: OUTFIT_COLORS[DEFAULT_HELMET], suit: OUTFIT_COLORS[DEFAULT_SUIT] };

  /** `palette`: one colour per cell, left tip to right tip. */
  constructor(rig: RigParams, palette: number[], light: Lighting) {
    this.canopy = new CanopyView(rig, palette, light);
    this.body = new Body(rig);
    this.pilot.add(this.body.group);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x08100a,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -22,
      polygonOffsetUnits: -22,
    });
    // One metre across, stretched to the pilot's shadow every frame.
    this.pilotShadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2), this.shadowMaterial);
    this.pilotShadow.renderOrder = 7;
    this.shadow.add(this.pilotShadow);
    light.clouds.shade(this.shadowMaterial, 'shadow');
    const lit = new Set<THREE.Material>();
    this.pilot.traverse((node) => {
      const material = (node as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        if (m instanceof THREE.MeshLambertMaterial) lit.add(m);
      }
    });
    for (const m of lit) light.clouds.shade(m, 'light');
    this.object.add(this.pilot, this.shadow);
    this.adopt(this.canopy);

    this.look = {
      time: 0,
      dt: 0,
      air: this.air,
      controls: { brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 },
      hands: { brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 },
      pilotAtt: this.pilotAtt,
      ground: 0,
    };
  }

  private adopt(view: CanopyView): void {
    this.object.add(view.object, view.shadow, view.deployment.object);
  }

  /** Lets go of the canopy (cut away): it is the caller's to draw from now on. */
  detachCanopy(): CanopyView {
    const view = this.canopy;
    this.object.remove(view.object, view.shadow, view.deployment.object);
    view.setReleased(true);
    this.detached = true;
    return view;
  }

  /** Hangs the pilot under another canopy (the reserve). The one before must have been detached or disposed. */
  attachCanopy(view: CanopyView): void {
    this.canopy = view;
    this.detached = false;
    this.adopt(view);
    view.setSuitColor(this.outfit.suit);
  }

  /** The colours of the jumpsuit and of the helmet, on the body and on the arms up on the toggles. */
  setOutfit(outfit: Outfit): void {
    this.outfit = { ...outfit };
    this.body.setOutfit(outfit);
    if (!this.detached) this.canopy.setSuitColor(outfit.suit);
  }

  /** How far the canopy is out: null while packed, from 0 at line stretch to 1 open. */
  setInflation(inflation: number | null): void {
    if (!this.detached) this.canopy.setInflation(inflation);
  }

  /** Shows or hides the arms and the toggles in the hands: they let go on the ground. */
  setArms(visible: boolean): void {
    if (!this.detached) this.canopy.setArms(visible);
  }

  /** Frees what the view holds on the graphics card, once it has left the scene. */
  dispose(): void {
    this.pilot.traverse((node) => {
      const { geometry, material } = node as THREE.Mesh;
      geometry?.dispose();
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
    this.pilotShadow.geometry.dispose();
    this.shadowMaterial.dispose();
    if (!this.detached) this.canopy.dispose();
  }

  /** A point given in the pilot's frame, in the world. */
  private pilotPoint(out: THREE.Vector3, p: { x: number; y: number; z: number }): THREE.Vector3 {
    return out.set(p.x, p.y, p.z).applyQuaternion(this.pilotAtt).add(this.pos);
  }

  /**
   * Follow the model in this light. `controls`: what the canopy's lines are
   * pulled to; `hands`: where the hands have the toggles, short of the
   * canopy's brakes while they are still stowed.
   */
  update(
    model: FlightModel,
    controls: Controls,
    groundAt: (x: number, z: number, y?: number) => number,
    light: Lighting,
    hands: Controls,
    frame: RigFrame,
  ): void {
    const { sun } = light;
    const s = model.state;
    this.pos.set(s.pos.x, s.pos.y, s.pos.z);
    this.att.set(s.att.x, s.att.y, s.att.z, s.att.w);
    this.pilotAtt.set(s.pilotAtt.x, s.pilotAtt.y, s.pilotAtt.z, s.pilotAtt.w);
    this.pilot.position.copy(this.pos);
    this.pilot.quaternion.copy(this.pilotAtt);
    this.vel.set(s.vel.x, s.vel.y, s.vel.z);

    const look = this.look;
    look.time = frame.time;
    look.dt = frame.dt;
    this.air.copy(frame.wind).sub(this.vel);
    Object.assign(look.controls, controls);
    if (!this.detached) this.canopy.setDeflation(model.deflationL, model.deflationR);
    if (!this.detached) this.canopy.setTwist(model.state.twist);
    Object.assign(look.hands, hands);
    const rig = model.rig;
    if (!this.detached) this.updateCanopy(rig, groundAt, light, frame);

    // The pilot's shadow runs from the feet to the head: its near end comes
    // up to the feet as they come down to the ground.
    const cast = (out: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 => {
      this.pilotPoint(out, { x, y, z });
      const ground = groundAt(out.x, out.z, out.y);
      const t = (out.y - ground) / sun.y;
      return out.set(out.x - sun.x * t, ground, out.z - sun.z * t);
    };
    const feet = cast(this.feet, rig.feetPos.x, rig.feetPos.y, rig.feetPos.z);
    const head = cast(this.head, rig.eyePos.x, rig.eyePos.y + 0.12, rig.eyePos.z);
    this.pilotShadow.position.lerpVectors(feet, head, 0.5);
    this.pilotShadow.rotation.y = Math.atan2(head.x - feet.x, head.z - feet.z);
    this.pilotShadow.scale.set(0.5, 1, feet.distanceTo(head) + 0.35);
    const height = this.pos.y - groundAt(this.pos.x, this.pos.z, this.pos.y);
    // Shadows are faint and washed out from high up, crisp near the ground.
    this.shadowMaterial.opacity = (0.12 + 0.36 * Math.max(0, 1 - height / 250)) * light.shadow;
    this.shadow.visible = light.shadow > 0.02;
  }

  /** The canopy over the pilot, its pilot chute and bag. */
  private updateCanopy(rig: RigParams, groundAt: (x: number, z: number, y?: number) => number, light: Lighting, frame: RigFrame): void {
    const look = this.look;
    const top = this.top.set(0, rig.canopyPos.y, 0).applyQuaternion(this.att).add(this.pos);
    look.ground = groundAt(top.x, top.z, top.y);
    this.canopy.update(this.pos, this.att, look, light);

    // Pilot chute and bag: in the hand, towing, carrying the bag up the line
    // stretch, then behind the canopy. A reserve's spring throws its own off
    // the top of the container.
    const d = this.canopy.deployment;
    const reserve = this.canopy.reserve;
    if (frame.deploy === 'tow' || frame.deploy === 'bag' || frame.deploy === 'hand') this.pilotChuteOpen = 1;
    else if (frame.deploy === 'canopy' && frame.deployTime > 0.8) this.pilotChuteOpen = Math.max(0, this.pilotChuteOpen - frame.dt / 1.5);
    this.pilotPoint(this.pin, reserve ? RESERVE_PIN : PIN);
    if (reserve) this.hand.copy(this.pin);
    else if (frame.deploy === 'hand') this.pilotPoint(this.hand, this.body.handPoint(this.hand, true));
    else this.pilotPoint(this.hand, BOC);
    const flow = this.air.lengthSq() > 1 ? this.flow.copy(this.air).normalize() : this.flow.set(0, 1, 0);
    const climb = (rig.linksPos.y + rig.lineLength) * frame.bagOut;
    this.bagOut.copy(this.pin).addScaledVector(flow, climb);
    this.launch.set(0, 0.5, 1).applyQuaternion(this.pilotAtt).multiplyScalar(reserve ? 9 : 4);
    this.risers.forEach((r, i) => this.pilotPoint(r, { x: (i < 2 ? -1 : 1) * RING.x, y: RING.y, z: RING.z }));
    if (frame.deploy === 'canopy' || frame.deploy === 'free') this.canopy.topAttach(top);
    d.update({
      stage: frame.deploy,
      dt: frame.dt,
      wind: frame.wind,
      airDensity: frame.airDensity,
      hand: this.hand,
      pin: this.pin,
      launch: this.launch,
      vel: this.vel,
      bagOut: this.bagOut,
      canopyTop: top,
      canopy: frame.deploy === 'canopy' || frame.deploy === 'free' ? this.canopy : null,
      pilotChuteOpen: this.pilotChuteOpen,
      stageTime: frame.deployTime,
      risers: this.risers,
      ground: groundAt(this.pos.x, this.pos.z, this.pos.y),
    });
  }
}
