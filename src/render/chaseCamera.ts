// The outside camera: it follows the jumper from behind and a little above,
// turning with them a moment late, and the mouse or the right stick takes it
// round them. Under canopy it frames pilot and canopy together, in freefall
// the jumper alone, a little higher up as a camera flyer would be.

import * as THREE from 'three';

/** What the camera frames this frame. */
export interface ChaseTarget {
  /** The point to look at, world frame. */
  focus: THREE.Vector3;
  /** Compass heading to stand behind, rad (0 north, clockwise). */
  heading: number;
  /** How far back, m, before the zoom. */
  distance: number;
  /** How far above the focus to look down from, rad. */
  above: number;
}

/** How quickly the camera comes round behind a turning jumper, s. */
const FOLLOW = 0.9;
/** How quickly it moves in or out, s. */
const REFRAME = 0.6;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class ChaseCamera {
  private heading = 0;
  private distance = 10;
  private above = 0.25;
  private readonly focus = new THREE.Vector3();
  private fresh = true;
  private readonly offset = new THREE.Vector3();

  /** Starts again from where the next target says, with no easing in. */
  reset(): void {
    this.fresh = true;
  }

  /**
   * Places the camera. `lookYaw`, `lookPitch`: the mouse or stick taking it
   * round, rad; `zoom`: a multiple of the distance; `groundAt`: the camera
   * stays above the ground.
   */
  update(
    camera: THREE.PerspectiveCamera,
    target: ChaseTarget,
    dt: number,
    lookYaw: number,
    lookPitch: number,
    zoom: number,
    groundAt: (x: number, z: number) => number,
  ): void {
    if (this.fresh) {
      this.heading = target.heading;
      this.distance = target.distance;
      this.above = target.above;
      this.focus.copy(target.focus);
      this.fresh = false;
    } else {
      const k = 1 - Math.exp(-dt / FOLLOW);
      this.heading += wrap(target.heading - this.heading) * k;
      const r = 1 - Math.exp(-dt / REFRAME);
      this.distance += (target.distance - this.distance) * r;
      this.above += (target.above - this.above) * r;
      // The focus is followed closely: the jumper moves fast.
      this.focus.lerp(target.focus, 1 - Math.exp(-dt / 0.08));
      if (this.focus.distanceToSquared(target.focus) > 400) this.focus.copy(target.focus);
    }
    const yaw = this.heading + lookYaw;
    const pitch = Math.max(-1.45, Math.min(1.45, this.above - lookPitch));
    const d = this.distance * zoom;
    // Behind is opposite the heading; up is the pitch.
    this.offset.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(d);
    camera.position.copy(this.focus).add(this.offset);
    const floor = groundAt(camera.position.x, camera.position.z) + 0.6;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.up.set(0, 1, 0);
    camera.lookAt(this.focus);
  }
}
