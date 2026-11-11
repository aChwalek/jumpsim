// Belly-to-earth freefall, from the door of the plane to the pull.
//
// The body is a broad, blunt plate: air hitting the belly pushes it back
// along the line from belly to back, air sliding across it is resisted much
// less. A stable flyer keeps the belly into the airflow, so the body turns to
// follow where the air comes from. Out of the door the air comes from in
// front, and the jumper lies on it chest first; as the fall builds up, the
// flow swings round to come from below and the jumper ends up facing the
// ground. Nobody scripts that "hill": it is the drag and gravity.
//
// The pilot moves by tilting the body against the air: head low (legs out)
// to go forward, head high (arms out) to back up, one shoulder low to slide.
// The tilted plate then pushes partly sideways. Turns are the body rotating
// about the axis through belly and back.
//
// Frame: the pilot frame of the flight model, origin at the shoulders. Y runs
// from the feet to the head, -Z is where the face and belly look, X is the
// right hand. Belly to earth, -Z points down and Y points ahead.

import { GRAVITY } from './rig';
import { clamp, quat, rotate, set, vec3, type Quat, type Vec3 } from './vec';

/** What the pilot asks of the body, each from -1 to 1. */
export interface BodyInputs {
  /** Left (-1) to right (1). */
  turn: number;
  /** Back up (-1) to go forward (1). */
  forward: number;
  /** Slide to the left (-1) or to the right (1). */
  slide: number;
}

export const noBodyInputs = (): BodyInputs => ({ turn: 0, forward: 0, slide: 0 });

export interface FreefallParams {
  /** Pilot and gear, kg. */
  mass: number;
  /**
   * Drag area (Cd A) of the body facing the air, m². 0.5 for 90 kg gives
   * the usual 200 km/h belly to earth near the ground, 235 at 4000 m.
   */
  bellyArea: number;
  /** Drag area against air sliding along the body, m². */
  edgeArea: number;
  /** Tilt of the body against the airflow at full drive, rad. */
  forwardTilt: number;
  backTilt: number;
  sideTilt: number;
  /** Turn rate at full input once the fall is established, rad/s. */
  turnRate: number;
  /** Time for the body to settle onto the airflow, s. */
  settle: number;
  /** Time for a turn to start or stop, s. */
  turnLag: number;
}

/** A body of this weight: bigger people are heavier and broader, and fall a little faster. */
export function freefallParams(exitWeightKg: number): FreefallParams {
  const size = (exitWeightKg / 90) ** (2 / 3);
  const bellyArea = 0.5 * size;
  return {
    mass: exitWeightKg,
    bellyArea,
    // A body is no thin plate: it is three times harder to push flat on than
    // sideways. Much less and a tilted belly glides like a wing.
    edgeArea: bellyArea / 3,
    // Gives about 8 m/s forward, 5 m/s back and 5 m/s sideways.
    forwardTilt: (12 * Math.PI) / 180,
    backTilt: (8 * Math.PI) / 180,
    sideTilt: (8 * Math.PI) / 180,
    // A 360 in about four seconds.
    turnRate: (100 * Math.PI) / 180,
    settle: 0.25,
    turnLag: 0.4,
  };
}

export interface FreefallState {
  /** Between the shoulders, world frame, m. */
  pos: Vec3;
  vel: Vec3;
  /** Pilot frame to world. */
  att: Quat;
  /** Turn rate about the axis from belly to back, rad/s, positive to the right. */
  yawRate: number;
}

export interface Air {
  /** Velocity of the air, world frame, m/s. */
  wind: Vec3;
  airDensity: number;
}

const BACK = vec3(0, 0, 1);
const HEAD = vec3(0, 1, 0);
const RIGHT = vec3(1, 0, 0);

export class Freefall {
  readonly state: FreefallState = { pos: vec3(), vel: vec3(), att: quat(), yawRate: 0 };
  /** Aerodynamic force over weight during the last step. */
  loadFactor = 0;
  /** Where the body is heading for: tilted off the airflow by the inputs. */
  private readonly target = vec3();
  private readonly back = vec3();
  private readonly head = vec3();
  private readonly right = vec3();
  private readonly flow = vec3();
  private readonly spin = quat();

  constructor(readonly params: FreefallParams) {}

  /**
   * `drogue`: drag area of something towed behind the back (a pilot chute),
   * which pulls along the airflow, m².
   */
  step(dt: number, input: BodyInputs, air: Air, drogue = 0): void {
    const p = this.params;
    const s = this.state;
    const back = rotate(this.back, s.att, BACK);

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
      const along = flow.x * back.x + flow.y * back.y + flow.z * back.z;
      // Pressure on the belly pushes square to it; the rest slides across.
      const n = q * p.bellyArea * along;
      const t = q * p.edgeArea;
      fx = n * back.x + t * (flow.x - along * back.x) + q * drogue * flow.x;
      fy = n * back.y + t * (flow.y - along * back.y) + q * drogue * flow.y;
      fz = n * back.z + t * (flow.z - along * back.z) + q * drogue * flow.z;
    }
    this.loadFactor = Math.hypot(fx, fy, fz) / (p.mass * GRAVITY);
    s.vel.x += (fx / p.mass) * dt;
    s.vel.y += (fy / p.mass - GRAVITY) * dt;
    s.vel.z += (fz / p.mass) * dt;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;

    // The body settles belly into the airflow, tilted off it by the inputs.
    // With hardly any air (a hop off a balloon) it has nothing to settle on.
    const authority = clamp(q / ((p.mass * GRAVITY) / p.bellyArea), 0, 1);
    let wx = 0;
    let wy = 0;
    let wz = 0;
    if (speed > 3) {
      const head = rotate(this.head, s.att, HEAD);
      const right = rotate(this.right, s.att, RIGHT);
      const ahead = clamp(input.forward, -1, 1);
      const tilt = Math.tan(ahead > 0 ? ahead * p.forwardTilt : ahead * p.backTilt);
      const lean = Math.tan(clamp(input.slide, -1, 1) * p.sideTilt);
      // Head and right hand, square to the airflow.
      const h = head.x * flow.x + head.y * flow.y + head.z * flow.z;
      const r = right.x * flow.x + right.y * flow.y + right.z * flow.z;
      const target = set(
        this.target,
        flow.x + tilt * (head.x - h * flow.x) + lean * (right.x - r * flow.x),
        flow.y + tilt * (head.y - h * flow.y) + lean * (right.y - r * flow.y),
        flow.z + tilt * (head.z - h * flow.z) + lean * (right.z - r * flow.z),
      );
      const norm = Math.hypot(target.x, target.y, target.z);
      target.x /= norm;
      target.y /= norm;
      target.z /= norm;
      // Rotation from where the back points to where it should.
      const ax = back.y * target.z - back.z * target.y;
      const ay = back.z * target.x - back.x * target.z;
      const az = back.x * target.y - back.y * target.x;
      const sin = Math.hypot(ax, ay, az);
      if (sin > 1e-9) {
        const angle = Math.atan2(sin, back.x * target.x + back.y * target.y + back.z * target.z);
        const rate = angle / p.settle / sin;
        wx = ax * rate;
        wy = ay * rate;
        wz = az * rate;
      }
    }

    // Turning: about the back, which points up when belly to earth, so a
    // turn to the right is a negative rotation about it.
    const wanted = clamp(input.turn, -1, 1) * p.turnRate * authority;
    s.yawRate += (wanted - s.yawRate) * Math.min(1, dt / p.turnLag);
    wx -= s.yawRate * back.x;
    wy -= s.yawRate * back.y;
    wz -= s.yawRate * back.z;

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

  /** Compass heading of the head, degrees: where the pilot faces belly to earth. */
  headingDeg(): number {
    const s = this.state;
    const head = rotate(this.head, s.att, HEAD);
    const face = rotate(this.right, s.att, set(this.right, 0, 0, -1));
    // Belly to earth the head points ahead; standing in the door, the face does.
    const flat = Math.hypot(head.x, head.z) > Math.hypot(face.x, face.z) ? head : face;
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
