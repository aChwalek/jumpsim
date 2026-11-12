// The jump plane: a high-wing turboprop holding jump run, straight and level
// at slow speed. It is flown by hand, so to speak: no flight model,
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
  /** The plane flying it: a Pilatus PC-6 if not given. */
  aircraft?: AircraftId;
}

export type AircraftId = 'pc6' | 'do28';

/** A jump plane: its cabin, its door and its propellers, plane frame, m. */
export interface Aircraft {
  id: AircraftId;
  name: string;
  /** Size of the cabin. */
  cabin: { halfWidth: number; height: number };
  /** Side of the door: +1 the right, -1 the left. */
  doorSide: 1 | -1;
  /** The door, behind the wing, from the floor up. */
  door: { front: number; back: number; top: number };
  /** Eyes of the jumper crouched in the doorway, facing the nose, the head at the door line. */
  doorEye: Vec3;
  /** Hubs of the propellers. */
  propellers: Vec3[];
}

export const AIRCRAFT: Record<AircraftId, Aircraft> = {
  // Pilatus PC-6 Turbo Porter: a single turboprop, its sliding jump door on the right.
  pc6: {
    id: 'pc6',
    name: 'Pilatus PC-6',
    cabin: { halfWidth: 0.82, height: 1.42 },
    doorSide: 1,
    door: { front: 0.55, back: 1.85, top: 1.3 },
    doorEye: vec3(0.82 + 0.04, 1.12, 0.85),
    propellers: [vec3(0, 0.45, -4.72)],
  },
  // Dornier Do 28 G92: the Skyservant on two Walter turboprops, hung on
  // stub wings either side of the nose; the big jump door on the left.
  do28: {
    id: 'do28',
    name: 'Dornier Do 28 G92',
    cabin: { halfWidth: 0.72, height: 1.5 },
    doorSide: -1,
    door: { front: 0.1, back: 1.5, top: 1.38 },
    doorEye: vec3(-0.72 - 0.04, 1.14, 0.4),
    propellers: [vec3(-2.05, 0.55, -3.75), vec3(2.05, 0.55, -3.75)],
  },
};

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
  readonly type: Aircraft;

  private readonly tmp = vec3();
  private readonly pitch = quat();

  constructor(run: JumpRun, wind: Vec3, groundHeight = 0) {
    this.type = AIRCRAFT[run.aircraft ?? 'pc6'];
    const heading = run.headingDeg * DEG;
    const tas = trueAirspeed(run.indicatedAirspeed, groundHeight + run.height);
    set(this.vel, Math.sin(heading) * tas + wind.x, 0, -Math.cos(heading) * tas + wind.z);
    quatFromYaw(this.level, -heading);
    quatMultiply(this.att, this.level, quatFromAxisAngle(this.pitch, AXIS_X, PITCH));
    // Put the jumper's eyes where the run says.
    const eye = rotate(this.tmp, this.att, this.type.doorEye);
    set(this.pos, run.x - eye.x, groundHeight + run.height - eye.y, run.z - eye.z);
  }

  step(dt: number): void {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // Three-blade propellers at about 1700 rpm.
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
