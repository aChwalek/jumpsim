// Freefall, from the door of the plane to the pull: belly to earth, on the
// back, sitting (head up) or head down.
//
// The body meets the air with a different shape along each of its axes. Lying
// flat (belly or back) it is a broad, blunt plate: air hitting it square
// pushes hard, air sliding across it much less. Upright (sitting or head
// down) it is a slender body: the air along it from head to feet meets little,
// the air across it meets the whole length. The force is the sum over the
// three axes of the air along each, times the drag area the body shows that
// way, so the less it shows to the air, the faster it falls: about 200 km/h
// flat, 250 sitting, 280 head down.
//
// A stable flyer keeps the body in its position against the airflow, so the
// body turns to follow where the air comes from. Out of the door the air comes
// from in front, and the jumper lies on it chest first; as the fall builds up,
// the flow swings round to come from below and the jumper ends up facing the
// ground. Nobody scripts that "hill": it is the drag and gravity.
//
// The pilot moves by tilting the body off the airflow. A plate moves towards
// its low edge: head low to go forward on the belly. A slender body moves
// towards its leading end: head down, the head goes where the body goes;
// sitting, the feet lead and the shoulders lean back. Spreading arms and legs
// shows more of the body to the air and slows the fall; tucking them in and
// arching speeds it up. Turns are the body rotating about the airflow. Going
// from one position to another, the body swings round onto its new axis in
// about a second.
//
// Frame: the pilot frame of the flight model, origin at the shoulders. Y runs
// from the feet to the head, -Z is where the face and belly look, X is the
// right hand. Belly to earth, -Z points down and Y points ahead.

import { GRAVITY } from './rig';
import { DEG, clamp, quat, rotate, rotateInv, set, vec3, type Quat, type Vec3 } from './vec';

export type BodyPosition = 'belly' | 'back' | 'sit' | 'headDown';

/**
 * ↑ / ↓ from where the pilot is, round and round the same way as a loop:
 * ↑ goes belly → head down → back → sit → belly, ↓ the other way round.
 */
const CYCLE: BodyPosition[] = ['belly', 'headDown', 'back', 'sit'];
export function stepPosition(from: BodyPosition, dir: 'up' | 'down'): BodyPosition {
  const n = CYCLE.length;
  return CYCLE[(CYCLE.indexOf(from) + (dir === 'up' ? 1 : n - 1)) % n]!;
}

/** What the pilot asks of the body, each from -1 to 1. */
export interface BodyInputs {
  /** Left (-1) to right (1). */
  turn: number;
  /** Back up (-1) to go forward (1), forward being where the eyes look. */
  forward: number;
  /** Slide to the left (-1) or to the right (1). */
  slide: number;
  /** Spread out to fall slower (-1, up on the others) or tuck in to fall faster (1, down). */
  fall: number;
  /** ↑ / ↓ held: somersaults one after the other, forwards (1) or backwards (-1). */
  flip?: number;
  /** ← / → held: rolls (half turns upright) one after the other, to the left (-1) or right (1). */
  roll?: number;
}

export const noBodyInputs = (): BodyInputs => ({ turn: 0, forward: 0, slide: 0, fall: 0 });

/** How long ↑ ↓ ← → have to be held before the somersaults or rolls carry on by themselves, s. */
export const SPIN_HOLD = 0.4;

/** How the body flies in one position. */
export interface BodyShape {
  /**
   * Drag area against air along the right hand, the head and the back, as a
   * fraction of the belly's area flat on the air.
   */
  area: Vec3;
  /** The body axis the air leaves by, which points up in a steady fall. */
  downstream: Vec3;
  /** Where the eyes look and "forward" goes. */
  forward: Vec3;
  /** Tilt of the body against the airflow at full drive, rad. */
  forwardTilt: number;
  backTilt: number;
  sideTilt: number;
  /** Turn rate at full input once the fall is established, rad/s. */
  turnRate: number;
}

const RIGHT = vec3(1, 0, 0);

export const BODY_SHAPES: Record<BodyPosition, BodyShape> = {
  // Arched, belly into the air. A body is no thin plate: it is three times
  // harder to push flat on than sideways. Much less and a tilted belly glides
  // like a wing. About 8 m/s forward, 5 m/s back and 5 m/s sideways, a 360
  // in about four seconds.
  belly: {
    area: vec3(1 / 3, 1 / 3, 1),
    downstream: vec3(0, 0, 1),
    forward: vec3(0, 1, 0),
    forwardTilt: 12 * DEG,
    backTilt: 8 * DEG,
    sideTilt: 8 * DEG,
    turnRate: 100 * DEG,
  },
  // Back to earth, sitting in a chair laid on its back, looking past the
  // knees: a little less blunt than the arch, so a little faster. Forward is
  // towards the feet, where the eyes are.
  back: {
    area: vec3(0.3, 0.3, 0.9),
    downstream: vec3(0, 0, -1),
    forward: vec3(0, -1, 0),
    forwardTilt: 10 * DEG,
    backTilt: 8 * DEG,
    sideTilt: 8 * DEG,
    turnRate: 90 * DEG,
  },
  // Sitting on the air, the trunk upright, thighs level, shins down. The
  // air across the body meets trunk and legs side on, half as much again as
  // the air along it.
  sit: {
    area: vec3(0.95, 2 / 3, 1),
    downstream: vec3(0, 1, 0),
    forward: vec3(0, 0, -1),
    forwardTilt: 13 * DEG,
    backTilt: 9 * DEG,
    sideTilt: 10 * DEG,
    turnRate: 140 * DEG,
  },
  // Upside down, the body straight: the slimmest it gets along the air and
  // the whole of it across, so it falls fastest and the smallest tilt moves
  // it a long way.
  headDown: {
    area: vec3(1, 0.53, 1),
    downstream: vec3(0, -1, 0),
    forward: vec3(0, 0, -1),
    forwardTilt: 7 * DEG,
    backTilt: 5 * DEG,
    sideTilt: 5 * DEG,
    turnRate: 140 * DEG,
  },
};

/**
 * Stretched out to glide: arms back along the body, legs straight and
 * together, the shoulders rolled in. Flat (belly or back) it is a track, the
 * body a wing a little head low; upright (sitting or head down) an angle,
 * the trace, the body slanted off the vertical and going where it leads.
 */
export interface TrackShape {
  /** Drag areas as for a position, as a fraction of the belly's flat on the air. */
  area: Vec3;
  /** Tilt of the body off the airflow, rad: with nothing asked, pushed hard (W) and held back (S). */
  tilt: number;
  dive: number;
  ease: number;
  /** 1: goes where the eyes look; -1: the other way, head first on the back. */
  dir: 1 | -1;
}

export const TRACK_SHAPES: Record<BodyPosition, TrackShape> = {
  // Arms back, legs straight: hardly anything along the head, so the body
  // flies like a flat wing, about a metre forward for every metre down. A
  // wing at a shallow angle turns far more air than its bare area meets
  // square on: hence nearly twice the belly's area against the air below.
  // The tilt is the one asked: the airflow swings round with the body and
  // it settles at about 65° off it, not far from the best glide.
  belly: { area: vec3(0.6, 0.28, 1.9), tilt: 78 * DEG, dive: 83 * DEG, ease: 45 * DEG, dir: 1 },
  // The same on the back, head first, looking back past the feet.
  back: { area: vec3(0.6, 0.3, 1.85), tilt: 78 * DEG, dive: 83 * DEG, ease: 45 * DEG, dir: -1 },
  // Upright and stretched, the body slanted off the vertical: it goes where
  // it leads, faster than a track and steeper, about half as far again as down.
  sit: { area: vec3(0.95, 0.3, 1), tilt: 28 * DEG, dive: 20 * DEG, ease: 40 * DEG, dir: 1 },
  headDown: { area: vec3(1, 0.28, 1), tilt: 28 * DEG, dive: 20 * DEG, ease: 40 * DEG, dir: 1 },
};

/** Drag areas tucked in (falling faster) and spread out (slower), against neutral. */
const TUCKED = 0.72;
const SPREAD = 1.36;

export interface FreefallParams {
  /** Pilot and gear, kg. */
  mass: number;
  /**
   * Drag area (Cd A) of the body flat on the air, m². 0.5 for 90 kg gives the
   * usual 200 km/h belly to earth near the ground, 235 at 4000 m.
   */
  bellyArea: number;
  /** Time for the body to settle onto the airflow, s. */
  settle: number;
  /** Fastest the body swings round from one position to another, rad/s. */
  swingRate: number;
  /** A half roll flat, or a half turn upright, on ← / →, rad/s. */
  rollRate: number;
  /** Somersaults on ↑ / ↓, a quarter at a time, rad/s. */
  flipRate: number;
  /** How fast a roll or a somersault picks up speed and slows down at the end, rad/s². */
  spinAccel: number;
  /** Time for arms and legs to take a new shape, s. */
  reshape: number;
  /** Time for a turn to start or stop, s. */
  turnLag: number;
  /** Time to stretch out into a track or come out of it, s. */
  trackIn: number;
}

/** A body of this weight: bigger people are heavier and broader, and fall a little faster. */
export function freefallParams(exitWeightKg: number): FreefallParams {
  const size = (exitWeightKg / 90) ** (2 / 3);
  return {
    mass: exitWeightKg,
    bellyArea: 0.5 * size,
    settle: 0.25,
    // A quarter turn, belly to sitting, in about three quarters of a second.
    swingRate: 150 * DEG,
    // A barrel roll in a little over a second.
    rollRate: 300 * DEG,
    // A somersault in about a second and a half, a quarter in half a second.
    flipRate: 270 * DEG,
    spinAccel: 2000 * DEG,
    reshape: 0.4,
    turnLag: 0.4,
    trackIn: 0.6,
  };
}

export interface FreefallState {
  /** Between the shoulders, world frame, m. */
  pos: Vec3;
  vel: Vec3;
  /** Pilot frame to world. */
  att: Quat;
  /** Turn rate about the airflow, rad/s, positive to the right. */
  yawRate: number;
}

export interface Air {
  /** Velocity of the air, world frame, m/s. */
  wind: Vec3;
  airDensity: number;
}

/** Drag area a shape shows along one of the body axes. */
const along = (area: Vec3, axis: Vec3): number =>
  area.x * Math.abs(axis.x) + area.y * Math.abs(axis.y) + area.z * Math.abs(axis.z);

export class Freefall {
  readonly state: FreefallState = { pos: vec3(), vel: vec3(), att: quat(), yawRate: 0 };
  /** The position the pilot is in, or going to. */
  position: BodyPosition = 'belly';
  /** Aerodynamic force over weight during the last step. */
  loadFactor = 0;
  /** Drag areas the body shows along its axes right now, m²: they follow the position and the fall input. */
  readonly area: Vec3;
  /** Asked to track (flat) or fly an angle (upright). */
  tracking = false;
  /** How far into the track the body is, 0 to 1. */
  track = 0;
  /**
   * Which way a half turn onto the other side goes: +1 rolls to the right
   * or tips over the front, -1 the other way.
   */
  private flipSign = 1;
  /**
   * A roll flat, a half turn upright or a somersault under way: what is left
   * of it, rad, about `axis` in the pilot frame, and how fast it goes now.
   * A roll or a somersault takes the body off the airflow: it is not settled
   * back onto it until it is over.
   */
  private readonly maneuver: { axis: Vec3; left: number; rate: number; kind: 'roll' | 'turn' | 'flip' } = {
    axis: vec3(),
    left: 0,
    rate: 0,
    kind: 'roll',
  };
  /** How long ↑ / ↓ and ← / → have been held, s. */
  private readonly held = { flip: 0, roll: 0 };
  /** Where the body is heading for: tilted off the airflow by the inputs. */
  private readonly target = vec3();
  private readonly down = vec3();
  private readonly ahead = vec3();
  private readonly right = vec3();
  private readonly flow = vec3();
  private readonly local = vec3();
  private readonly spin = quat();

  constructor(readonly params: FreefallParams) {
    const a = BODY_SHAPES.belly.area;
    this.area = vec3(a.x * params.bellyArea, a.y * params.bellyArea, a.z * params.bellyArea);
  }

  get shape(): BodyShape {
    return BODY_SHAPES[this.position];
  }

  /**
   * Goes into another position. `roll`: for a half turn onto the other
   * side, which way (-1 to the left or backwards, 1 to the right or forwards).
   */
  setPosition(position: BodyPosition, roll = 1): void {
    if (position === this.position) return;
    this.position = position;
    this.flipSign = roll < 0 ? -1 : 1;
    this.maneuver.left = 0;
    this.maneuver.rate = 0;
  }

  /**
   * ← / → (`dir` -1 / 1). Flat, a half roll that way onto the other side:
   * twice in a row on the belly is a barrel roll. Upright, a half turn about
   * the head to face the other way.
   */
  rollOver(dir: -1 | 1): void {
    const m = this.maneuver;
    const flat = this.position === 'belly' || this.position === 'back';
    const kind = flat ? 'roll' : 'turn';
    if (m.left !== 0 && m.kind !== kind) return;
    if (flat) {
      // About the head, always the same way for the same key, so that a
      // second press carries on round: → on the belly, the right hand goes down.
      set(m.axis, 0, 1, 0);
      m.left += dir * Math.PI;
      this.position = this.position === 'belly' ? 'back' : 'belly';
    } else {
      // About the axis that is up for the eyes, the way a turn goes.
      const f = this.shape.forward;
      set(m.axis, 0, f.z, -f.y);
      m.left += dir * Math.PI;
    }
    m.kind = kind;
  }

  /**
   * ↑ / ↓ (`dir` 1 / -1): a quarter somersault about the shoulders, forwards
   * head first, backwards feet first, into the next position round the loop
   * belly → head down → back → sit → belly. Pressed again before it is over,
   * the next quarter follows on without a stop: twice from the belly goes
   * through head down onto the back, four times is a whole somersault.
   */
  flip(dir: -1 | 1): void {
    const m = this.maneuver;
    if (m.left !== 0 && m.kind !== 'flip') return;
    // Forwards the head goes down, towards where the belly faces.
    set(m.axis, 1, 0, 0);
    m.left -= dir * (Math.PI / 2);
    m.kind = 'flip';
    this.position = stepPosition(this.position, dir > 0 ? 'up' : 'down');
  }

  /** A roll, a half turn or a somersault under way. */
  get maneuvering(): boolean {
    return this.maneuver.left !== 0;
  }

  /**
   * ↑ ↓ ← → held: once held long enough, the next quarter somersault or
   * half roll goes on before the one under way is over, so they follow one
   * another without a stop. Let go, the one under way finishes in a position.
   */
  private carryOn(dt: number, input: BodyInputs): void {
    const m = this.maneuver;
    const h = this.held;
    const flip = Math.sign(input.flip ?? 0);
    const roll = Math.sign(input.roll ?? 0);
    h.flip = flip ? h.flip + dt : 0;
    h.roll = roll ? h.roll + dt : 0;
    // The same way as the one under way, about half of it left.
    const due = (kind: 'roll' | 'turn' | 'flip', sign: number, step: number): boolean =>
      m.left === 0 || (m.kind === kind && Math.sign(m.left) === sign && Math.abs(m.left) < step / 2);
    if (flip && h.flip >= SPIN_HOLD && due('flip', -flip, Math.PI / 2)) this.flip(flip as -1 | 1);
    else if (roll && h.roll >= SPIN_HOLD) {
      const flat = this.position === 'belly' || this.position === 'back';
      if (due(flat ? 'roll' : 'turn', roll, Math.PI)) this.rollOver(roll as -1 | 1);
    }
  }

  /** Angle between the body and its position on the airflow, rad: 0 once settled. */
  offPosition(): number {
    const s = this.state;
    const down = rotate(this.down, s.att, this.shape.downstream);
    const f = this.flow;
    const speed = Math.hypot(f.x, f.y, f.z);
    if (speed < 0.5) return 0;
    return Math.acos(clamp((down.x * f.x + down.y * f.y + down.z * f.z) / speed, -1, 1));
  }

  /**
   * `drogue`: drag area of something towed behind the back (a pilot chute),
   * which pulls along the airflow, m².
   */
  step(dt: number, input: BodyInputs, air: Air, drogue = 0): void {
    const p = this.params;
    const s = this.state;
    const shape = this.shape;

    // Arms and legs come to the shape the position and the fall ask for.
    const fall = clamp(input.fall, -1, 1);
    const size = p.bellyArea * (fall > 0 ? 1 + (TUCKED - 1) * fall : 1 + (SPREAD - 1) * -fall);
    const reshape = 1 - Math.exp(-dt / p.reshape);
    // Into the track and out of it, the stretch taking its time.
    const tr = TRACK_SHAPES[this.position];
    const inTrack = (this.track += ((this.tracking ? 1 : 0) - this.track) * (1 - Math.exp(-dt / p.trackIn)));
    const area = this.area;
    area.x += ((shape.area.x + (tr.area.x - shape.area.x) * inTrack) * size - area.x) * reshape;
    area.y += ((shape.area.y + (tr.area.y - shape.area.y) * inTrack) * size - area.y) * reshape;
    area.z += ((shape.area.z + (tr.area.z - shape.area.z) * inTrack) * size - area.z) * reshape;

    // Air past the body, as it moves relative to the body.
    const ux = air.wind.x - s.vel.x;
    const uy = air.wind.y - s.vel.y;
    const uz = air.wind.z - s.vel.z;
    const speed = Math.hypot(ux, uy, uz);
    const q = 0.5 * air.airDensity * speed * speed;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    const flow = this.flow;
    if (speed > 0.01) {
      set(flow, ux / speed, uy / speed, uz / speed);
      // Along each body axis, the air pushes on what the body shows that way.
      const l = rotateInv(this.local, s.att, flow);
      set(l, l.x * area.x * q, l.y * area.y * q, l.z * area.z * q);
      rotate(l, s.att, l);
      fx = l.x + q * drogue * flow.x;
      fy = l.y + q * drogue * flow.y;
      fz = l.z + q * drogue * flow.z;
    } else set(flow, 0, 0, 0);
    this.loadFactor = Math.hypot(fx, fy, fz) / (p.mass * GRAVITY);
    s.vel.x += (fx / p.mass) * dt;
    s.vel.y += (fy / p.mass - GRAVITY) * dt;
    s.vel.z += (fz / p.mass) * dt;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;

    // The body settles onto the airflow, tilted off it by the inputs. With
    // hardly any air (a hop off a balloon) it has nothing to settle on.
    const authority = clamp(q / ((p.mass * GRAVITY) / p.bellyArea), 0, 1);
    const down = rotate(this.down, s.att, shape.downstream);
    const ahead = rotate(this.ahead, s.att, shape.forward);
    const right = rotate(this.right, s.att, RIGHT);
    let wx = 0;
    let wy = 0;
    let wz = 0;
    const m = this.maneuver;
    this.carryOn(dt, input);
    if (speed > 3 && !(m.left !== 0 && m.kind !== 'turn')) {
      // A body broader across the air than along it glides towards its low
      // edge, a slender one towards its leading end: they tilt opposite ways.
      const flowArea = along(shape.area, shape.downstream);
      const plate = (side: Vec3): number => (flowArea > along(shape.area, side) ? 1 : -1);
      const drive = clamp(input.forward, -1, 1);
      const free = drive > 0 ? drive * shape.forwardTilt : drive * shape.backTilt;
      // Tracking, the drive goes into the track: harder to dive it, back to ease off.
      const tracked = tr.dir * (drive > 0 ? tr.tilt + (tr.dive - tr.tilt) * drive : tr.tilt + (tr.tilt - tr.ease) * drive);
      const tilt = plate(shape.forward) * Math.tan(free + (tracked - free) * inTrack);
      const lean = plate(RIGHT) * Math.tan(clamp(input.slide, -1, 1) * shape.sideTilt);
      // Ahead and the right hand, square to the airflow.
      const h = ahead.x * flow.x + ahead.y * flow.y + ahead.z * flow.z;
      const r = right.x * flow.x + right.y * flow.y + right.z * flow.z;
      const target = set(
        this.target,
        flow.x + tilt * (ahead.x - h * flow.x) + lean * (right.x - r * flow.x),
        flow.y + tilt * (ahead.y - h * flow.y) + lean * (right.y - r * flow.y),
        flow.z + tilt * (ahead.z - h * flow.z) + lean * (right.z - r * flow.z),
      );
      const norm = Math.hypot(target.x, target.y, target.z);
      target.x /= norm;
      target.y /= norm;
      target.z /= norm;
      const cos = down.x * target.x + down.y * target.y + down.z * target.z;
      // Swinging round into another position takes its time, more so with little air.
      const most = p.swingRate * (0.4 + 0.6 * authority);
      if (cos < -0.85) {
        // Onto the other side: no shortest way round. Flat, it is a roll
        // about the head; upright, a tip over the front or the back.
        const flat = shape.downstream.z !== 0;
        const axis = rotate(this.local, s.att, flat ? BODY_SHAPES[this.position === 'back' ? 'belly' : 'back'].forward : RIGHT);
        const sign = flat ? this.flipSign : -this.flipSign;
        wx = axis.x * most * sign;
        wy = axis.y * most * sign;
        wz = axis.z * most * sign;
      } else {
        // Rotation from where the downstream axis points to where it should.
        const ax = down.y * target.z - down.z * target.y;
        const ay = down.z * target.x - down.x * target.z;
        const az = down.x * target.y - down.y * target.x;
        const sin = Math.hypot(ax, ay, az);
        if (sin > 1e-9) {
          const angle = Math.atan2(sin, cos);
          const rate = Math.min(angle / p.settle, most) / sin;
          wx = ax * rate;
          wy = ay * rate;
          wz = az * rate;
        }
      }
    }

    if (m.left !== 0) {
      // Picking up speed, then slowing down so as to stop square in the position.
      const most = m.kind === 'flip' ? p.flipRate : p.rollRate;
      m.rate = Math.min(most, m.rate + p.spinAccel * dt, Math.sqrt(2 * p.spinAccel * Math.abs(m.left)) + p.spinAccel * dt);
      const step = Math.sign(m.left) * Math.min(Math.abs(m.left), m.rate * dt);
      m.left -= step;
      if (Math.abs(m.left) < 1e-9) {
        m.left = 0;
        m.rate = 0;
      }
      const axis = rotate(this.local, s.att, m.axis);
      wx += (axis.x * step) / dt;
      wy += (axis.y * step) / dt;
      wz += (axis.z * step) / dt;
    }

    // Turning: about the axis that is up for the eyes (the back belly to
    // earth, the head when upright, even upside down), so that a turn to the
    // right is always to the right of where they look.
    const wanted = clamp(input.turn, -1, 1) * shape.turnRate * authority;
    s.yawRate += (wanted - s.yawRate) * Math.min(1, dt / p.turnLag);
    const up = this.local;
    set(
      up,
      right.y * ahead.z - right.z * ahead.y,
      right.z * ahead.x - right.x * ahead.z,
      right.x * ahead.y - right.y * ahead.x,
    );
    wx -= s.yawRate * up.x;
    wy -= s.yawRate * up.y;
    wz -= s.yawRate * up.z;

    // The rotation is in world axes: it goes on the left.
    const w = Math.hypot(wx, wy, wz);
    if (w > 1e-9) {
      const half = 0.5 * w * dt;
      const k = Math.sin(half) / w;
      const r = set4(this.spin, wx * k, wy * k, wz * k, Math.cos(half));
      const a = s.att;
      const x = r.w * a.x + r.x * a.w + r.y * a.z - r.z * a.y;
      const y = r.w * a.y - r.x * a.z + r.y * a.w + r.z * a.x;
      const z = r.w * a.z + r.x * a.y - r.y * a.x + r.z * a.w;
      const ww = r.w * a.w - r.x * a.x - r.y * a.y - r.z * a.z;
      const n = 1 / Math.hypot(x, y, z, ww);
      set4(a, x * n, y * n, z * n, ww * n);
    }
  }

  /**
   * Compass heading of where the pilot looks, degrees: the head belly to
   * earth, the feet on the back, the face upright.
   */
  headingDeg(): number {
    const s = this.state;
    const ahead = rotate(this.ahead, s.att, this.shape.forward);
    // Standing in the door, or halfway between two positions, where the face
    // looks is the better guess.
    const face = rotate(this.right, s.att, set(this.right, 0, 0, -1));
    const flat = Math.hypot(ahead.x, ahead.z) > 0.5 ? ahead : face;
    const deg = (Math.atan2(flat.x, -flat.z) * 180) / Math.PI;
    return deg < 0 ? deg + 360 : deg;
  }
}

function set4(out: Quat, x: number, y: number, z: number, w: number): Quat {
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}
