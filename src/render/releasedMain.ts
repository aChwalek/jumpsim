import * as THREE from 'three';
import type { ReleasedFrame } from '../net/snapshot';
import { neutralControls } from '../sim/flightModel';
import type { CanopyView } from './canopyView';
import type { Lighting } from './scene';

/** What drawing a cut-away main needs from the frame: the clock, the air, the ground, the light. */
export interface ReleasedScene {
  time: number;
  dt: number;
  wind: THREE.Vector3;
  airDensity: number;
  groundAt: (x: number, z: number, y?: number) => number;
  light: Lighting;
}

/**
 * The main once cut away, drawn from where it was recorded or sent: where it
 * drifts, then in a heap where it lands. Nothing of it is simulated here.
 */
export class ReleasedMain {
  private readonly pos = new THREE.Vector3();
  private readonly att = new THREE.Quaternion();
  private readonly air = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly fall = new THREE.Vector3();
  private readonly risers = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly noHands = neutralControls();

  draw(view: CanopyView, r: ReleasedFrame, s: ReleasedScene): void {
    this.pos.set(r.pos.x, r.pos.y, r.pos.z);
    this.att.set(r.att.x, r.att.y, r.att.z, r.att.w);
    this.air.copy(s.wind).sub(this.top.set(r.vel.x, r.vel.y, r.vel.z));
    view.setCrumple(r.crumple);
    view.setHeap(r.heap, this.pos, this.fall.set(r.fallTo.x, 0, r.fallTo.z));
    const ground = s.groundAt(r.pos.x, r.pos.z, r.pos.y);
    view.update(
      this.pos,
      this.att,
      { time: s.time, dt: s.dt, air: this.air, controls: this.noHands, hands: this.noHands, pilotAtt: null, ground },
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
}
