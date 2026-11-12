// A camera on its own, to walk about the scene of a replay: it goes where it
// is driven, ahead along the view, to the sides and up, and looks where the
// mouse or the right stick turns it. It eases into its speed, and stays
// above the ground.

import * as THREE from 'three';
import type { FreeInputs } from '../input/devices';

/** Speeds, m/s: walking about the landing area, and across the sky. */
const SPEED = 10;
const FAST = 60;
/** Time to come up to speed or to stop, s. */
const EASE = 0.15;
/** As far as it looks up or down, rad. */
const MAX_PITCH = 1.5;
/** As close as it comes to the ground, m. */
const CLEAR = 0.4;

export class FreeCamera {
  readonly pos = new THREE.Vector3();
  /** Compass heading it looks along, rad (0 north, clockwise), and how far up. */
  heading = 0;
  pitch = 0;
  private readonly vel = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly wanted = new THREE.Vector3();
  private readonly at = new THREE.Vector3();

  /** Starts where `camera` is, looking where it looks. */
  constructor(camera: THREE.Camera) {
    this.pos.copy(camera.position);
    const dir = camera.getWorldDirection(this.ahead);
    this.heading = Math.atan2(dir.x, -dir.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  }

  update(camera: THREE.PerspectiveCamera, dt: number, input: FreeInputs, groundAt: (x: number, z: number) => number): void {
    this.heading += input.yaw + input.yawRate * dt;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + input.pitch + input.pitchRate * dt));
    const cp = Math.cos(this.pitch);
    this.ahead.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), -Math.cos(this.heading) * cp);
    this.side.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    const speed = input.fast ? FAST : SPEED;
    this.wanted
      .copy(this.ahead)
      .multiplyScalar(input.forward)
      .addScaledVector(this.side, input.right)
      .addScaledVector(camera.up.set(0, 1, 0), input.up);
    if (this.wanted.lengthSq() > 1) this.wanted.normalize();
    this.vel.lerp(this.wanted.multiplyScalar(speed), 1 - Math.exp(-dt / EASE));
    this.pos.addScaledVector(this.vel, dt);
    const floor = groundAt(this.pos.x, this.pos.z) + CLEAR;
    if (this.pos.y < floor) {
      this.pos.y = floor;
      this.vel.y = Math.max(0, this.vel.y);
    }
    camera.position.copy(this.pos);
    camera.lookAt(this.at.copy(this.pos).add(this.ahead));
  }
}
