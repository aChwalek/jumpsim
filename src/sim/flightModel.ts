// Nine degree of freedom canopy flight model.
//
// Two rigid bodies joined where the risers meet the harness, at the pilot's
// shoulders: the canopy with its lines and risers, and the pilot. The joint
// moves (three degrees of freedom) and each body turns about it (three each).
// The canopy is split into spanwise panels on an arc; each panel sees its own
// airflow (including the part due to rotation) and its own brake and front
// riser input. Turns, dives, the recovery arc and the flare are not scripted:
// they come out of the forces acting high above a pilot who carries nearly
// all the mass.
//
// The harness decides how the pilot follows: see JointParams.

import { sectionCoeffs, type SectionCoeffs } from './aero';
import { AIR_DENSITY_SEA_LEVEL, type BodyParams, type RigParams } from './rig';
import {
  clamp,
  integrateQuat,
  quat,
  rotate,
  rotateInv,
  set,
  vec3,
  type Quat,
  type Vec3,
} from './vec';

/**
 * Pilot inputs, each from 0 (hands up / released) to 1 (fully pulled). The
 * toggles go on past 1, up to BRAKE_DEEP: arms fully down, the pilot takes
 * wraps of the steering line round the hand and pulls the tail deeper still.
 */
export interface Controls {
  brakeL: number;
  brakeR: number;
  frontL: number;
  frontR: number;
}

/** Toggle travel with wraps taken: past 1 the tail separates and the canopy stalls. */
export const BRAKE_DEEP = 1.3;

/**
 * A line over the top of the canopy holds its half this far collapsed, and
 * pulls that side's tail down as a toggle taken a little into wraps would.
 */
export const LINEOVER_COLLAPSE = 0.5;
export const LINEOVER_PULL = 1.15;

export const neutralControls = (): Controls => ({
  brakeL: 0,
  brakeR: 0,
  frontL: 0,
  frontR: 0,
});

export interface Environment {
  /** Wind velocity in world frame, m/s (direction the air moves towards). */
  wind: Vec3;
  airDensity: number;
}

export const calmAir = (): Environment => ({
  wind: vec3(),
  airDensity: AIR_DENSITY_SEA_LEVEL,
});

export interface FlightState {
  /** Position of the joint, where the risers meet the harness. World frame, m. */
  pos: Vec3;
  /** Velocity of the joint, world frame, m/s. */
  vel: Vec3;
  /** Attitude of the canopy and its lines, body to world. */
  att: Quat;
  /** Angular velocity of the canopy and its lines, in their own frame, rad/s. */
  omega: Vec3;
  /** Attitude of the pilot, body to world. */
  pilotAtt: Quat;
  /** Angular velocity of the pilot, in the pilot's frame, rad/s. */
  pilotOmega: Vec3;
  /**
   * How far the pilot has turned under the canopy, rad, positive to the
   * right. It keeps counting past half a turn: those are line twists.
   */
  twist: number;
}

const RIGHT = vec3(1, 0, 0);
const BACK = vec3(0, 0, 1);
const DOWN = vec3(0, -1, 0);

export class FlightModel {
  readonly state: FlightState = {
    pos: vec3(),
    vel: vec3(),
    att: quat(),
    omega: vec3(),
    pilotAtt: quat(),
    pilotOmega: vec3(),
    twist: 0,
  };

  /** Aerodynamic force divided by weight during the last step. */
  loadFactor = 1;
  /** Angle of attack at the centre of the canopy during the last step, rad. */
  alphaCentre = 0;
  /**
   * How far each half of the canopy has lost its pressure, from 0 (flying) to
   * 1: deep in a stall the air meets the wing from below and behind, the
   * inlets no longer face it, and the cells go soft and fold.
   */
  deflationL = 0;
  deflationR = 0;

  private readonly air = vec3();
  private readonly vb = vec3();
  private readonly tmp = vec3();
  private readonly coeffs: SectionCoeffs = { cl: 0, cd: 0 };
  // Force on the canopy and its torque about the joint, canopy frame.
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  // Per body, in its own frame: the force on it, and the angular acceleration
  // it would have if the joint did not accelerate.
  private readonly canopyForce = vec3();
  private readonly canopyTurn = vec3();
  private readonly pilotForce = vec3();
  private readonly pilotTurn = vec3();
  private readonly harness = vec3();
  private readonly shoulders = vec3();
  private readonly spin = vec3();
  private readonly accel = vec3();
  // The equation for the joint's acceleration: a symmetric 3x3 matrix and
  // its right-hand side, world frame.
  private m00 = 0;
  private m01 = 0;
  private m02 = 0;
  private m11 = 0;
  private m12 = 0;
  private m22 = 0;
  private rx = 0;
  private ry = 0;
  private rz = 0;

  /**
   * Drag area added at the links, m²: the calibration flies with the slider
   * down and open, so collapsing it or taking it off makes this negative.
   */
  dragAreaDelta = 0;

  /**
   * A line gone over the top of the canopy, pinching in its left (-1) or right
   * (1) half, whatever the toggles do; 0 for none.
   */
  lineover: -1 | 0 | 1 = 0;

  /** The canopy flown: the reserve takes over from the main after a cutaway. */
  constructor(public rig: RigParams) {}

  step(dt: number, c: Controls, env: Environment): void {
    const s = this.state;
    const rig = this.rig;
    const w = s.omega;
    const vb = this.vb;
    const halfRho = 0.5 * env.airDensity;
    // The tails as the lines pull them: the toggles, and a line over the top.
    const brakeL = this.lineover < 0 ? Math.max(c.brakeL, LINEOVER_PULL) : c.brakeL;
    const brakeR = this.lineover > 0 ? Math.max(c.brakeR, LINEOVER_PULL) : c.brakeR;

    // Velocity of the joint through the air, world frame then canopy frame.
    const air = set(this.air, s.vel.x - env.wind.x, s.vel.y - env.wind.y, s.vel.z - env.wind.z);
    rotateInv(vb, s.att, air);

    this.fx = this.fy = this.fz = 0;
    this.tx = this.ty = this.tz = 0;

    const panels = rig.panels;
    const mid = panels.length >> 1;
    const aero = rig.aero;
    let alphaL = 0;
    let alphaR = 0;
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i]!;
      const r = p.r;
      const toggle = p.side < 0 ? brakeL : brakeR;
      const brake = Math.min(toggle, 1) * p.brakeGain;
      // The first wraps mostly take up the stretch in the lines.
      const wrapped = toggle > 1 ? (toggle - 1) / (BRAKE_DEEP - 1) : 0;
      const deep = wrapped * wrapped;
      const front = p.side < 0 ? c.frontL : c.frontR;

      // Local airspeed: u = vb + omega x r.
      const ux = vb.x + (w.y * r.z - w.z * r.y);
      const uy = vb.y + (w.z * r.x - w.x * r.z);
      const uz = vb.z + (w.x * r.y - w.y * r.x);

      // Front risers pitch this side of the canopy nose down.
      const d = -rig.frontRiserMax * front;
      const cd = Math.cos(d);
      const sd = Math.sin(d);
      const fwx = cd * p.forward.x + sd * p.normal.x;
      const fwy = cd * p.forward.y + sd * p.normal.y;
      const fwz = cd * p.forward.z + sd * p.normal.z;
      const nx = cd * p.normal.x - sd * p.forward.x;
      const ny = cd * p.normal.y - sd * p.forward.y;
      const nz = cd * p.normal.z - sd * p.forward.z;

      // Angle of attack is set by the flow at the three-quarter chord point,
      // half a chord behind where the force acts. This is what damps pitching.
      const wt = w.x * p.tangent.x + w.y * p.tangent.y + w.z * p.tangent.z;
      const uf = ux * fwx + uy * fwy + uz * fwz;
      const un = ux * nx + uy * ny + uz * nz - 0.5 * rig.chord * wt;
      const ut = ux * p.tangent.x + uy * p.tangent.y + uz * p.tangent.z;
      const v2 = uf * uf + un * un;
      if (v2 < 1e-6) continue;

      const alpha = Math.atan2(-un, uf);
      if (i === mid) this.alphaCentre = alpha;
      if (p.side < 0) alphaL += alpha;
      else alphaR += alpha;
      const k = sectionCoeffs(alpha, brake, aero, this.coeffs, deep);
      // Soft cells carry less: the canopy has folded up into a smaller one.
      const q = halfRho * v2 * p.area * (1 - aero.deflatedLoss * (p.side < 0 ? this.deflationL : this.deflationR));
      const lift = q * k.cl;
      const drag = q * k.cd;
      const sa = Math.sin(alpha);
      const ca = Math.cos(alpha);
      // Lift and drag act in the section plane: they are pressure forces and
      // have no spanwise part. Sliding sideways is resisted separately (skin
      // friction, end cells, stabilisers); in a skid that sideways pull, high
      // above the pilot, is what rolls the system into the turn.
      const a = lift * sa - drag * ca;
      const b = lift * ca + drag * sa;
      const t = -rig.aero.cdSpan * halfRho * p.area * Math.sqrt(v2 + ut * ut) * ut;
      this.addForce(
        r,
        a * fwx + b * nx + t * p.tangent.x,
        a * fwy + b * ny + t * p.tangent.y,
        a * fwz + b * nz + t * p.tangent.z,
      );

      // Resistance of the section to rotating about its own quarter chord,
      // and the nose-down moment of the pulled-down tail.
      const moment =
        -rig.aero.cmq * halfRho * Math.sqrt(v2) * rig.chord * rig.chord * p.area * wt -
        rig.aero.cmBrake * brake * q * rig.chord;
      this.tx += moment * p.tangent.x;
      this.ty += moment * p.tangent.y;
      this.tz += moment * p.tangent.z;
    }

    const half = panels.length / 2;
    this.deflationL = Math.max(this.lineover < 0 ? LINEOVER_COLLAPSE : 0, this.deflate(this.deflationL, alphaL / half, dt));
    this.deflationR = Math.max(this.lineover > 0 ? LINEOVER_COLLAPSE : 0, this.deflate(this.deflationR, alphaR / half, dt));

    // Uneven front risers shorten one side's lines, which tips the canopy,
    // and its lift with it, towards that side.
    const tilt = rig.frontRiserRoll * (c.frontR - c.frontL);
    if (tilt !== 0) this.addForce(rig.linksPos, tilt * this.fy, -tilt * this.fx, 0);

    // Yaw of the canopy as a whole, which summing sections gets wrong: see
    // AeroParams. Sideslip and airspeed are those of the canopy centre.
    const cx = vb.x - w.z * rig.canopyPos.y;
    const cz = vb.z + w.x * rig.canopyPos.y;
    const speed = Math.hypot(cx, vb.y, cz);
    const pull = aero.cnBrake * (Math.min(brakeR, 1) - Math.min(brakeL, 1)) + aero.cnFront * (c.frontR - c.frontL);
    this.ty +=
      halfRho *
      speed *
      rig.area *
      rig.span *
      (aero.cnr * 0.5 * rig.span * w.y - aero.cnBeta * cx - pull * speed);

    this.addBluffDrag(rig.linePos, halfRho * rig.lineDragArea);
    if (this.dragAreaDelta !== 0) this.addBluffDrag(rig.linksPos, halfRho * this.dragAreaDelta);

    // The pilot's drag, at the pilot's centre of mass, pilot frame.
    const canopy = rig.canopy;
    const pilot = rig.pilot;
    const wp = s.pilotOmega;
    const pv = rotateInv(this.tmp, s.pilotAtt, air);
    const ux = pv.x - wp.z * pilot.cgY;
    const uy = pv.y;
    const uz = pv.z + wp.x * pilot.cgY;
    const k = -halfRho * rig.pilotDragArea * Math.hypot(ux, uy, uz);
    const pf = set(this.pilotForce, k * ux, k * uy, k * uz);
    const cf = set(this.canopyForce, this.fx, this.fy, this.fz);

    // The harness is felt through last step's load: it lags by 4 ms.
    const ht = this.harnessTorque(this.harness, this.loadFactor * pilot.weight);

    const weight = canopy.weight + pilot.weight;
    const lift = rotate(this.accel, s.att, cf);
    const drag = rotate(this.tmp, s.pilotAtt, pf);
    this.loadFactor = Math.hypot(lift.x + drag.x, lift.y + drag.y, lift.z + drag.z) / weight;

    // What turns each body about the joint, in its own frame: the air, its
    // weight, the harness, and Euler's term for a spinning body.
    let down = rotateInv(this.tmp, s.att, DOWN);
    let arm = canopy.weight * canopy.cgY;
    let I = canopy.inertia;
    set(
      this.canopyTurn,
      (this.tx + arm * down.z - ht.x - (w.y * I.z * w.z - w.z * I.y * w.y)) / I.x,
      (this.ty - ht.y - (w.z * I.x * w.x - w.x * I.z * w.z)) / I.y,
      (this.tz - arm * down.x - ht.z - (w.x * I.y * w.y - w.y * I.x * w.x)) / I.z,
    );
    rotateInv(ht, s.pilotAtt, rotate(ht, s.att, ht));
    down = rotateInv(this.tmp, s.pilotAtt, DOWN);
    arm = pilot.weight * pilot.cgY;
    I = pilot.inertia;
    set(
      this.pilotTurn,
      (pilot.cgY * pf.z + arm * down.z + ht.x - (wp.y * I.z * wp.z - wp.z * I.y * wp.y)) / I.x,
      (ht.y - (wp.z * I.x * wp.x - wp.x * I.z * wp.z)) / I.y,
      (-pilot.cgY * pf.x - arm * down.x + ht.z - (wp.x * I.y * wp.y - wp.y * I.x * wp.x)) / I.z,
    );

    // Newton's law for the two bodies together gives the joint's
    // acceleration; each body's turning then follows from it.
    this.m00 = this.m11 = this.m22 = rig.inertMass;
    this.m01 = this.m02 = this.m12 = 0;
    this.rx = this.rz = 0;
    this.ry = -weight;
    this.carry(canopy, s.att, w, cf, this.canopyTurn);
    this.carry(pilot, s.pilotAtt, wp, pf, this.pilotTurn);
    const a = this.solve(this.accel);
    s.vel.x += a.x * dt;
    s.vel.y += a.y * dt;
    s.vel.z += a.z * dt;
    this.spinBody(canopy, s.att, w, this.canopyTurn, a, dt);
    this.spinBody(pilot, s.pilotAtt, wp, this.pilotTurn, a, dt);

    // Semi-implicit Euler: positions use the updated velocities.
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;
    integrateQuat(s.att, w, dt);
    integrateQuat(s.pilotAtt, wp, dt);
  }

  /** Pressure lost by half a canopy flying at `alpha` on average, after a step. */
  private deflate(deflation: number, alpha: number, dt: number): number {
    const a = this.rig.aero;
    const x = (alpha - a.deflateAlpha) / (a.deflateAlphaFull - a.deflateAlpha);
    const target = x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    const time = target > deflation ? a.deflateTime : a.refillTime;
    return deflation + (target - deflation) * Math.min(1, dt / time);
  }

  /** World position of a point given in the canopy's frame. */
  worldPoint(out: Vec3, canopyPoint: Vec3): Vec3 {
    return this.place(out, this.state.att, canopyPoint);
  }

  /** World velocity of a point given in the canopy's frame. */
  worldPointVelocity(out: Vec3, canopyPoint: Vec3): Vec3 {
    return this.carried(out, this.state.att, this.state.omega, canopyPoint);
  }

  /** World position of a point given in the pilot's frame. */
  pilotPoint(out: Vec3, pilotPoint: Vec3): Vec3 {
    return this.place(out, this.state.pilotAtt, pilotPoint);
  }

  /** World velocity of a point given in the pilot's frame. */
  pilotPointVelocity(out: Vec3, pilotPoint: Vec3): Vec3 {
    return this.carried(out, this.state.pilotAtt, this.state.pilotOmega, pilotPoint);
  }

  private place(out: Vec3, att: Quat, point: Vec3): Vec3 {
    rotate(out, att, point);
    out.x += this.state.pos.x;
    out.y += this.state.pos.y;
    out.z += this.state.pos.z;
    return out;
  }

  private carried(out: Vec3, att: Quat, w: Vec3, point: Vec3): Vec3 {
    set(out, w.y * point.z - w.z * point.y, w.z * point.x - w.x * point.z, w.x * point.y - w.y * point.x);
    rotate(out, att, out);
    out.x += this.state.vel.x;
    out.y += this.state.vel.y;
    out.z += this.state.vel.z;
    return out;
  }

  /**
   * Torque of the harness on the pilot, canopy frame; the canopy gets the
   * opposite. Also keeps the count of line twists up to date.
   */
  private harnessTorque(out: Vec3, tension: number): Vec3 {
    const s = this.state;
    const j = this.rig.joint;
    // The pilot's shoulder line and how the pilot turns, seen from the canopy.
    const sh = rotateInv(this.shoulders, s.att, rotate(this.shoulders, s.pilotAtt, RIGHT));
    const rel = rotateInv(this.spin, s.att, rotate(this.spin, s.pilotAtt, s.pilotOmega));
    rel.x -= s.omega.x;
    rel.y -= s.omega.y;
    rel.z -= s.omega.z;

    // Yaw, about the lines: held square at first, then a bifilar pendulum.
    // Past a quarter turn the risers are wound round each other and go on
    // pulling back as hard.
    const turned = Math.atan2(sh.z, sh.x) - s.twist;
    s.twist += turned - 2 * Math.PI * Math.round(turned / (2 * Math.PI));
    const quarter = Math.PI / 2;
    const yaw =
      tension * (j.yawHold * clamp(s.twist / j.yawGive, -1, 1) + j.yawArm * Math.sin(clamp(s.twist, -quarter, quarter))) -
      j.yawDamping * rel.y;

    // Roll, about the axis square to the lines and to the shoulders.
    const flat = Math.hypot(sh.x, sh.z) || 1;
    const nx = -sh.z / flat;
    const nz = sh.x / flat;
    const roll = -j.rollStiffness * Math.asin(clamp(sh.y, -1, 1)) - j.rollDamping * (rel.x * nx + rel.z * nz);

    // Pitch, about the shoulder line.
    const pitch = -j.pitchDamping * (rel.x * sh.x + rel.y * sh.y + rel.z * sh.z);

    return set(out, roll * nx + pitch * sh.x, yaw + pitch * sh.y, roll * nz + pitch * sh.z);
  }

  /**
   * Adds one body to the equation for the joint's acceleration. Its centre of
   * mass sits `cgY` along its Y axis, so a push on the joint across that axis
   * partly swings the body round instead of moving it: it weighs less on the
   * joint that way.
   */
  private carry(b: BodyParams, att: Quat, w: Vec3, force: Vec3, turn: Vec3): void {
    const my = b.mass * b.cgY;
    // The force on the body, less what its centre of mass takes to follow
    // the body's own turning.
    const f = set(
      this.tmp,
      force.x - my * (w.x * w.y - turn.z),
      force.y + my * (w.x * w.x + w.z * w.z),
      force.z - my * (w.y * w.z + turn.x),
    );
    rotate(f, att, f);
    this.rx += f.x;
    this.ry += f.y;
    this.rz += f.z;
    this.lighten(rotate(this.tmp, att, RIGHT), (my * my) / b.inertia.z);
    this.lighten(rotate(this.tmp, att, BACK), (my * my) / b.inertia.x);
  }

  private lighten(axis: Vec3, mass: number): void {
    this.m00 -= mass * axis.x * axis.x;
    this.m01 -= mass * axis.x * axis.y;
    this.m02 -= mass * axis.x * axis.z;
    this.m11 -= mass * axis.y * axis.y;
    this.m12 -= mass * axis.y * axis.z;
    this.m22 -= mass * axis.z * axis.z;
  }

  /** Acceleration of the joint, world frame. */
  private solve(out: Vec3): Vec3 {
    const c00 = this.m11 * this.m22 - this.m12 * this.m12;
    const c01 = this.m02 * this.m12 - this.m01 * this.m22;
    const c02 = this.m01 * this.m12 - this.m02 * this.m11;
    const c11 = this.m00 * this.m22 - this.m02 * this.m02;
    const c12 = this.m01 * this.m02 - this.m00 * this.m12;
    const c22 = this.m00 * this.m11 - this.m01 * this.m01;
    const det = this.m00 * c00 + this.m01 * c01 + this.m02 * c02;
    return set(
      out,
      (c00 * this.rx + c01 * this.ry + c02 * this.rz) / det,
      (c01 * this.rx + c11 * this.ry + c12 * this.rz) / det,
      (c02 * this.rx + c12 * this.ry + c22 * this.rz) / det,
    );
  }

  /** Updates a body's angular velocity once the joint's acceleration is known. */
  private spinBody(b: BodyParams, att: Quat, w: Vec3, turn: Vec3, accel: Vec3, dt: number): void {
    const my = b.mass * b.cgY;
    const a = rotateInv(this.tmp, att, accel);
    w.x += (turn.x - (my * a.z) / b.inertia.x) * dt;
    w.y += turn.y * dt;
    w.z += (turn.z + (my * a.x) / b.inertia.z) * dt;
  }

  private addForce(r: Vec3, x: number, y: number, z: number): void {
    this.fx += x;
    this.fy += y;
    this.fz += z;
    this.tx += r.y * z - r.z * y;
    this.ty += r.z * x - r.x * z;
    this.tz += r.x * y - r.y * x;
  }

  /** Drag of a non-lifting part of the canopy body (the lines): F = -k |u| u. */
  private addBluffDrag(r: Vec3, k: number): void {
    const w = this.state.omega;
    const vb = this.vb;
    const ux = vb.x + (w.y * r.z - w.z * r.y);
    const uy = vb.y + (w.z * r.x - w.x * r.z);
    const uz = vb.z + (w.x * r.y - w.y * r.x);
    const f = -k * Math.hypot(ux, uy, uz);
    this.addForce(r, f * ux, f * uy, f * uz);
  }
}
