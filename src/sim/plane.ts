// The jump plane: a high-wing turboprop holding jump run, straight and level
// at slow speed. It is flown by hand, so to speak: no flight model,
// just a straight line at a steady true airspeed. Or a helicopter, which
// holds a hover over the exit point instead: still over the ground, the air
// going past it at the speed of the wind.
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

export type AircraftId = 'pc6' | 'do28' | 'c130' | 'as350';
export const AIRCRAFT_IDS: readonly AircraftId[] = ['pc6', 'do28', 'c130', 'as350'];

/**
 * Where the jumper waits for the exit, the places of a four-way exit:
 * `inside`, kneeling in the cabin behind the door, to dive out; `high`,
 * standing bent over in the doorway, the head under its top; `low`, crouched
 * on the sill at the front of the door; `step`, outside on the step under the
 * door, holding on to its frame, already in the wind.
 */
export type ExitSpot = 'inside' | 'high' | 'low' | 'step';
/** From the back of the cabin out to the step: forward goes out, back goes in. */
export const EXIT_SPOTS: readonly ExitSpot[] = ['inside', 'high', 'low', 'step'];

/** One place at the door, plane frame. */
export interface DoorSpot {
  /** The jumper's eyes, m. */
  eye: Vec3;
  /** Turned from the nose towards the door, degrees. */
  yawDeg: number;
  /** How the jumper leaves from there, m/s: out of the door, towards the nose, up. */
  push: { out: number; ahead: number; up: number };
}

/** A helicopter's rotors, plane frame, m. */
export interface Rotors {
  /** Hub of the main rotor, over the cabin, turning about the vertical. */
  hub: Vec3;
  radius: number;
  blades: number;
  /** Turning speed of the main rotor, rad/s. */
  rate: number;
  /** The tail rotor, at the end of the boom, turning about the side axis this many times faster. */
  tail: { hub: Vec3; radius: number; blades: number; gear: number };
}

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
  /** The step under the front of the door, outside: its top, and how far it sticks out of the cabin's side. */
  step: { top: number; out: number; front: number; back: number };
  /** The places at the door. The plane is placed on jump run by the eyes of the jumper at `low`. */
  spots: Record<ExitSpot, DoorSpot>;
  /** Hubs of the propellers. */
  propellers: Vec3[];
  /**
   * A hold open at the back, its ramp down level with the floor: the jumper
   * walks about in it, and goes off the end of the ramp. The floor from the
   * front bulkhead to the hinge of the ramp, then the ramp to its end, m.
   */
  ramp?: { front: number; hinge: number; end: number };
  /** Its own jump run speed, m/s indicated, whatever the drop zone flies. */
  indicatedAirspeed?: number;
  /**
   * A helicopter: no propellers but rotors. It holds a hover over the exit
   * point, level, rather than flying the run: out of the door, there is no
   * relative wind but the wind's own.
   */
  rotors?: Rotors;
}

/**
 * The places round a door, from its size. `crouch`: the eyes of the jumper
 * crouched on the sill above the floor, m, the head at the door line.
 */
function doorSpots(a: Pick<Aircraft, 'cabin' | 'doorSide' | 'door' | 'step'>, crouch: number): Record<ExitSpot, DoorSpot> {
  const { cabin, doorSide: s, door, step } = a;
  const w = cabin.halfWidth;
  return {
    // On both knees in the cabin, turned towards the door: a dive out of it.
    inside: { eye: vec3(s * (w - 0.55), 1.02, door.front + 0.95), yawDeg: 55, push: { out: 2.6, ahead: 0.3, up: 0.2 } },
    // Standing bent over in the doorway, over and behind the one on the sill: up and out over them. The
    // eyes stay a hand's breadth under the roof, which the camera cannot see any nearer.
    high: {
      eye: vec3(s * (w - 0.12), Math.min(door.top - 0.16, cabin.height - 0.28), door.front + 0.62),
      yawDeg: 10,
      push: { out: 1.8, ahead: 0, up: 0.4 },
    },
    // Crouched on the sill at the front of the door, the head out at the door line: a roll out.
    low: { eye: vec3(s * (w + 0.04), crouch, door.front + 0.3), yawDeg: 0, push: { out: 1.5, ahead: 0, up: -0.5 } },
    // Upright on the step, facing the nose, holding the front of the door frame: just let go.
    step: { eye: vec3(s * (w + 0.25), step.top + 1.47, (step.front + step.back) / 2), yawDeg: 0, push: { out: 0.4, ahead: 0, up: 0 } },
  };
}

/**
 * On a ramp, the places are on its floor, upright and facing out the back:
 * at its end in the middle (`low`), at its end to the left and to the right
 * (`high`, `step`), and a little way up it (`inside`). Off them, a step out.
 */
function rampSpots(halfWidth: number, end: number): Record<ExitSpot, DoorSpot> {
  const eye = 1.66;
  const out = { out: 0, ahead: -1.6, up: 0.4 };
  return {
    inside: { eye: vec3(0, eye, end - 2.2), yawDeg: 180, push: { out: 0, ahead: -3.2, up: 0.5 } },
    high: { eye: vec3(-halfWidth * 0.55, eye, end - 0.7), yawDeg: 180, push: out },
    low: { eye: vec3(0, eye, end - 0.6), yawDeg: 180, push: out },
    step: { eye: vec3(halfWidth * 0.55, eye, end - 0.7), yawDeg: 180, push: out },
  };
}

const PC6 = { cabin: { halfWidth: 0.82, height: 1.42 }, doorSide: 1, door: { front: 0.55, back: 1.85, top: 1.3 }, step: { top: -0.4, out: 0.42, front: 0.6, back: 1.15 } } as const;
const DO28 = { cabin: { halfWidth: 0.72, height: 1.5 }, doorSide: -1, door: { front: 0.1, back: 1.5, top: 1.38 }, step: { top: -0.36, out: 0.42, front: 0.15, back: 0.7 } } as const;
// The step of the Écureuil is a plate on its left skid, under the back door.
const AS350 = { cabin: { halfWidth: 0.8, height: 1.3 }, doorSide: -1, door: { front: -0.05, back: 1.0, top: 1.18 }, step: { top: -0.7, out: 0.38, front: 0.1, back: 0.6 } } as const;
/** Across from the middle to each skid, m. */
export const SKID_OUT = 1.1;

export const AIRCRAFT: Record<AircraftId, Aircraft> = {
  // Pilatus PC-6 Turbo Porter: a single turboprop, its sliding jump door on the right.
  pc6: {
    id: 'pc6',
    name: 'Pilatus PC-6',
    ...PC6,
    spots: doorSpots(PC6, 1.12),
    propellers: [vec3(0, 0.45, -4.72)],
  },
  // Dornier Do 28 G92: the Skyservant on two Walter turboprops, hung on
  // stub wings either side of the nose; the big jump door on the left.
  do28: {
    id: 'do28',
    name: 'Dornier Do 28 G92',
    ...DO28,
    spots: doorSpots(DO28, 1.14),
    propellers: [vec3(-2.05, 0.55, -3.75), vec3(2.05, 0.55, -3.75)],
  },
  // Lockheed C-130 Hercules: four turboprops on a high wing over a hold 3 m
  // wide and 12 m long, its ramp lowered level with the floor at the back.
  // Jump run is flown faster than in the small planes.
  c130: {
    id: 'c130',
    name: 'Lockheed C-130 Hercules',
    cabin: { halfWidth: 1.56, height: 2.74 },
    doorSide: 1,
    // The opening at the back: from the hinge of the ramp to its end.
    door: { front: 5.4, back: 8.5, top: 2.74 },
    step: { top: 0, out: 0, front: 8.5, back: 8.5 },
    spots: rampSpots(1.56, 8.5),
    propellers: [vec3(-9.9, 2.75, -5.4), vec3(-5.1, 2.6, -5.6), vec3(5.1, 2.6, -5.6), vec3(9.9, 2.75, -5.4)],
    ramp: { front: -6.9, hinge: 5.4, end: 8.5 },
    indicatedAirspeed: 57,
  },
  // Airbus AS350 B3 Écureuil: a single turbine, a three-blade main rotor 10.7 m
  // across turning clockwise seen from above, the tail rotor on the left of
  // the fin. The back door on the left slid open; it hovers over the exit point.
  as350: {
    id: 'as350',
    name: 'AS350 Écureuil',
    ...AS350,
    spots: {
      ...doorSpots(AS350, 1.04),
      // On the skid, upright under the door, holding the front of its frame: let go and drop.
      step: {
        eye: vec3(-SKID_OUT, AS350.step.top + 1.47, (AS350.step.front + AS350.step.back) / 2),
        yawDeg: 0,
        push: { out: 0.4, ahead: 0, up: 0 },
      },
    },
    propellers: [],
    rotors: {
      hub: vec3(0, 2.38, 0.2),
      radius: 5.35,
      blades: 3,
      // 390 rpm.
      rate: 40.8,
      tail: { hub: vec3(-0.27, 1.32, 7.48), radius: 0.93, blades: 2, gear: 5 },
    },
  },
};

/** Propellers at about 1700 rpm, rad/s. */
const PROP_RATE = 180;
/** How fast the propellers, or the main rotor, turn, rad/s. */
export const propRate = (a: Aircraft): number => a.rotors?.rate ?? PROP_RATE;
/** Where the engine is heard from: the propellers, or the main rotor. */
export const engineHubs = (a: Aircraft): readonly Vec3[] => (a.rotors ? [a.rotors.hub] : a.propellers);

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
  /** Propeller angle, or the main rotor's, rad. */
  prop = 0;
  readonly type: Aircraft;
  /** Compass heading of the run, degrees. */
  readonly headingDeg: number;

  private readonly tmp = vec3();
  private readonly pitch = quat();

  constructor(run: JumpRun, wind: Vec3, groundHeight = 0) {
    this.type = AIRCRAFT[run.aircraft ?? 'pc6'];
    this.headingDeg = run.headingDeg;
    const heading = run.headingDeg * DEG;
    if (this.type.rotors) {
      // In a hover: still over the ground, level, the nose on the run's heading.
      set(this.vel, 0, 0, 0);
    } else {
      const tas = trueAirspeed(this.type.indicatedAirspeed ?? run.indicatedAirspeed, groundHeight + run.height);
      set(this.vel, Math.sin(heading) * tas + wind.x, 0, -Math.cos(heading) * tas + wind.z);
    }
    quatFromYaw(this.level, -heading);
    quatMultiply(this.att, this.level, quatFromAxisAngle(this.pitch, AXIS_X, this.type.rotors ? 0 : PITCH));
    // Put the eyes of a jumper crouched in the door where the run says,
    // whichever place the jumper takes: the run is the same.
    const eye = rotate(this.tmp, this.att, this.type.spots.low.eye);
    set(this.pos, run.x - eye.x, groundHeight + run.height - eye.y, run.z - eye.z);
  }

  step(dt: number): void {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.prop = (this.prop + propRate(this.type) * dt) % (2 * Math.PI);
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
