// The jump plane: a high-wing single turboprop holding jump run, straight and
// level at slow speed. It is flown by hand, so to speak: no flight model,
// just a straight line at a steady true airspeed.
//
// Plane frame, as everywhere: -Z towards the nose, +Y up, +X the right wing.
// The origin is on the cabin floor under the wing.

import { trueAirspeed } from './atmosphere';
import { DEG, quat, quatFromAxisAngle, quatFromYaw, quatMultiply, rotate, set, vec3, type Quat, type Vec3 } from './vec';

export interface JumpRun {
  /** Where the jumper's eyes are when the run starts, world frame, m (y above the ground). */
  x: number;
  z: number;
  height: number;
  /** Compass heading of the run, degrees. */
  headingDeg: number;
  /** Speed on the airspeed indicator, m/s: jump run is flown slow. */
  indicatedAirspeed: number;
}

/** Size of the cabin and its door, plane frame, m. */
export const CABIN = { halfWidth: 0.82, height: 1.42 };
/** The door: on the left side, behind the wing, from the floor up. */
export const DOOR = { front: 0.55, back: 1.85, top: 1.3 };
/** Eyes of the jumper crouched in the doorway, facing the nose, the head at the door line. */
export const DOOR_EYE = vec3(-CABIN.halfWidth - 0.04, 1.12, 0.85);
/** Hub of the propeller, plane frame, m. */
export const PROPELLER = vec3(0, 0.45, -4.72);
/** Nose-up attitude of the plane flying slow on jump run. */
const PITCH = 3 * DEG;
const AXIS_X = vec3(1, 0, 0);

export class Plane {
  /** Origin of the plane frame, world, m. */
  readonly pos = vec3();
  /** World velocity, m/s. */
  readonly vel = vec3();
  /** Plane frame to world. */
  readonly att: Quat = quat();
  /** Plane frame to world, without the pitch: how the jumper stands in it. */
  readonly level: Quat = quat();
  /** Propeller angle, rad. */
  prop = 0;

  private readonly tmp = vec3();
  private readonly pitch = quat();

  constructor(run: JumpRun, wind: Vec3, groundHeight = 0) {
    const heading = run.headingDeg * DEG;
    const tas = trueAirspeed(run.indicatedAirspeed, groundHeight + run.height);
    set(this.vel, Math.sin(heading) * tas + wind.x, 0, -Math.cos(heading) * tas + wind.z);
    quatFromYaw(this.level, -heading);
    quatMultiply(this.att, this.level, quatFromAxisAngle(this.pitch, AXIS_X, PITCH));
    // Put the jumper's eyes where the run says.
    const eye = rotate(this.tmp, this.att, DOOR_EYE);
    set(this.pos, run.x - eye.x, groundHeight + run.height - eye.y, run.z - eye.z);
  }

  step(dt: number): void {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // A three-blade propeller at about 1700 rpm.
    this.prop = (this.prop + 180 * dt) % (2 * Math.PI);
  }

  /** World position of a point given in the plane's frame. */
  point(out: Vec3, local: Vec3): Vec3 {
    rotate(out, this.att, local);
    out.x += this.pos.x;
    out.y += this.pos.y;
    out.z += this.pos.z;
    return out;
  }
}
