import {
  FlightModel,
  calmAir,
  neutralControls,
  type Controls,
  type Environment,
} from './flightModel';
import type { RigParams } from './rig';
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
  /** Air-relative velocity when heading north, world frame. */
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
}

const trimCache = new WeakMap<RigParams, Trim>();

/** Steady hands-up glide for a rig, found by letting the model settle. */
function trimFor(rig: RigParams): Trim {
  let trim = trimCache.get(rig);
  if (!trim) {
    const model = new FlightModel(rig);
    set(model.state.vel, 0, -5, -12);
    simulate(model, 40, neutralControls(), calmAir());
    const s = model.state;
    trim = { vel: vec3(s.vel.x, s.vel.y, s.vel.z), att: { ...s.att }, pilotAtt: { ...s.pilotAtt } };
    trimCache.set(rig, trim);
  }
  return trim;
}

/** Speeds of the steady hands-up glide of a rig, m/s. */
export function trimSpeeds(rig: RigParams): { forward: number; sink: number } {
  const { vel } = trimFor(rig);
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

/** Place the model in steady full flight at a position and compass heading. */
export function initTrimmed(
  model: FlightModel,
  position: Vec3,
  headingDeg: number,
  env: Environment,
): void {
  const trim = trimFor(model.rig);
  const s = model.state;
  // Compass headings turn clockwise seen from above; rotation about +Y is
  // counter-clockwise, hence the sign.
  quatFromYaw(yaw, -headingDeg * DEG);
  rotate(s.vel, yaw, trim.vel);
  s.vel.x += env.wind.x;
  s.vel.y += env.wind.y;
  s.vel.z += env.wind.z;
  yawed(s.att, trim.att);
  yawed(s.pilotAtt, trim.pilotAtt);
  set(s.pos, position.x, position.y, position.z);
  set(s.omega, 0, 0, 0);
  set(s.pilotOmega, 0, 0, 0);
  s.twist = 0;
  model.loadFactor = 1;
}
