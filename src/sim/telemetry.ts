import {
  FlightModel,
  calmAir,
  neutralControls,
  type Controls,
  type Environment,
} from './flightModel';
import { AIR_DENSITY_SEA_LEVEL, type RigParams } from './rig';
import { DEG, quat, quatFromYaw, rotate, set, vec3, type Quat, type Vec3 } from './vec';

export const SIM_DT = 1 / 240;

export interface Telemetry {
  /** Speed through the air, m/s. */
  airspeed: number;
  /** Horizontal speed over the ground, m/s. */
  groundSpeed: number;
  /** Vertical speed, m/s, negative when descending. */
  verticalSpeed: number;
  /** Horizontal distance covered per metre of height lost, through the air. */
  glideRatio: number;
  /** Compass heading of the body, degrees, 0 = north (-Z), 90 = east (+X). */
  headingDeg: number;
  /** Bank angle, degrees, positive when the right side is low. */
  bankDeg: number;
  /** Pitch of the body, degrees, positive when the pilot swings forward. */
  pitchDeg: number;
}

export const emptyTelemetry = (): Telemetry => ({
  airspeed: 0,
  groundSpeed: 0,
  verticalSpeed: 0,
  glideRatio: 0,
  headingDeg: 0,
  bankDeg: 0,
  pitchDeg: 0,
});

const fwd = vec3();
const right = vec3();
const up = vec3();

export function readTelemetry(model: FlightModel, env: Environment, out: Telemetry): Telemetry {
  const { vel, att } = model.state;
  const ax = vel.x - env.wind.x;
  const ay = vel.y - env.wind.y;
  const az = vel.z - env.wind.z;
  const airHorizontal = Math.hypot(ax, az);
  out.airspeed = Math.hypot(ax, ay, az);
  out.groundSpeed = Math.hypot(vel.x, vel.z);
  out.verticalSpeed = vel.y;
  out.glideRatio = ay < -0.01 ? airHorizontal / -ay : Infinity;

  rotate(fwd, att, set(fwd, 0, 0, -1));
  rotate(right, att, set(right, 1, 0, 0));
  rotate(up, att, set(up, 0, 1, 0));
  const heading = Math.atan2(fwd.x, -fwd.z) / DEG;
  out.headingDeg = heading < 0 ? heading + 360 : heading;
  out.pitchDeg = Math.asin(Math.max(-1, Math.min(1, fwd.y))) / DEG;
  out.bankDeg = Math.atan2(-right.y, up.y) / DEG;
  return out;
}

/** Run the model for a duration with fixed controls. */
export function simulate(
  model: FlightModel,
  seconds: number,
  controls: Controls,
  env: Environment,
  dt = SIM_DT,
): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) model.step(dt, controls, env);
}

interface Trim {
  /** Air-relative velocity when heading north, world frame, at sea level. */
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
}

const trimCache = new WeakMap<RigParams, Map<number, Trim>>();

/**
 * Steady glide of a rig with both toggles at `brake` (0 is hands up), found
 * by letting the model settle in sea-level air.
 */
function trimFor(rig: RigParams, brake = 0): Trim {
  let byBrake = trimCache.get(rig);
  if (!byBrake) trimCache.set(rig, (byBrake = new Map()));
  let trim = byBrake.get(brake);
  if (!trim) {
    const model = new FlightModel(rig);
    set(model.state.vel, 0, -5, -12);
    simulate(model, 40, { ...neutralControls(), brakeL: brake, brakeR: brake }, calmAir());
    const s = model.state;
    trim = { vel: vec3(s.vel.x, s.vel.y, s.vel.z), att: { ...s.att }, pilotAtt: { ...s.pilotAtt } };
    byBrake.set(brake, trim);
  }
  return trim;
}

/** Speeds of the steady hands-up glide of a rig, m/s. */
export function trimSpeeds(rig: RigParams, brake = 0): { forward: number; sink: number } {
  const { vel } = trimFor(rig, brake);
  return { forward: Math.hypot(vel.x, vel.z), sink: -vel.y };
}

const yaw = quat();

/** out = yaw * q, for a rotation `yaw` about the vertical. */
function yawed(out: Quat, q: Quat): void {
  out.x = yaw.w * q.x + yaw.y * q.z;
  out.y = yaw.w * q.y + yaw.y * q.w;
  out.z = yaw.w * q.z - yaw.y * q.x;
  out.w = yaw.w * q.w - yaw.y * q.y;
}

/** Velocity and attitudes of steady flight on a compass heading, world frame. */
export interface Trimmed {
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
}

/**
 * Steady flight of a rig on a heading with both toggles at `brake`. Thinner
 * air flies the same attitudes faster: the speed through it goes up as one
 * over the square root of the density.
 */
export function trimmedFlight(
  rig: RigParams,
  headingDeg: number,
  env: Environment,
  brake = 0,
  out: Trimmed = { vel: vec3(), att: quat(), pilotAtt: quat() },
): Trimmed {
  const trim = trimFor(rig, brake);
  // Compass headings turn clockwise seen from above; rotation about +Y is
  // counter-clockwise, hence the sign.
  quatFromYaw(yaw, -headingDeg * DEG);
  rotate(out.vel, yaw, trim.vel);
  const thin = env.airDensity > 0 ? Math.sqrt(AIR_DENSITY_SEA_LEVEL / env.airDensity) : 1;
  out.vel.x = out.vel.x * thin + env.wind.x;
  out.vel.y = out.vel.y * thin + env.wind.y;
  out.vel.z = out.vel.z * thin + env.wind.z;
  yawed(out.att, trim.att);
  yawed(out.pilotAtt, trim.pilotAtt);
  return out;
}

/** Place the model in steady flight at a position and compass heading, hands up unless `brake` says otherwise. */
export function initTrimmed(
  model: FlightModel,
  position: Vec3,
  headingDeg: number,
  env: Environment,
  brake = 0,
): void {
  const s = model.state;
  trimmedFlight(model.rig, headingDeg, env, brake, s);
  set(s.pos, position.x, position.y, position.z);
  set(s.omega, 0, 0, 0);
  set(s.pilotOmega, 0, 0, 0);
  s.twist = 0;
  model.loadFactor = 1;
  model.deflationL = model.deflationR = 0;
  model.lineover = 0;
  model.twistBind = false;
  model.kick = 0;
}
