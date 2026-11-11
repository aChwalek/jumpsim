// How the pilot holds the body at each moment of the jump, and the moves
// between: crouched in the door, the four freefall positions (box, back,
// sit, head down, which shift with the inputs), the reach for the pilot
// chute, hanging in the harness, standing on the ground.

import type { BodyInputs, BodyPosition } from '../sim/freefall';
import { blendPose, copyPose, makePose, type Pose } from './body';

export type Stance = 'door' | BodyPosition | 'throw' | 'hanging' | 'ground';

/** The stances that follow the freefall inputs. */
export const FREEFALL_STANCES: ReadonlySet<Stance> = new Set(['belly', 'back', 'sit', 'headDown']);

/** Hip angle of the legs hanging in the harness, rad forward. */
const HANGING_HIPS = 0.21;

/** Time to settle into each stance, s: the reach for the handle is quick. */
const SETTLE: Record<Stance, number> = {
  door: 0.35,
  belly: 0.3,
  back: 0.3,
  sit: 0.3,
  headDown: 0.3,
  throw: 0.12,
  hanging: 0.35,
  ground: 0.15,
};

/** The inputs split into the halves each pose reacts to. */
function drives(input: BodyInputs) {
  return {
    forward: Math.max(0, input.forward),
    back: Math.max(0, -input.forward),
    // Spread out to go up, tucked in to go down.
    up: Math.max(0, -input.fall),
    down: Math.max(0, input.fall),
  };
}

function door(p: Pose): void {
  // Crouched on the sill facing the nose, bent forward, the head at the
  // door line: left hand on the front of the door frame, right hand on the
  // knee.
  p.lean = 0;
  p.bow = 0.35;
  p.hipL = p.hipR = 1.8;
  p.kneeL = p.kneeR = 1.55;
  p.spread = 0.1;
  p.handL.set(0.03, -0.03, -0.28);
  p.elbowL.set(-1, -0.6, 0.1);
  p.handR.set(0.13, -0.47, -0.13);
  p.elbowR.set(1, 0, 0.4);
}

function box(p: Pose, input: BodyInputs): void {
  // Arched, arms out with the elbows bent and the hands level with the
  // head, knees bent so the shins point at the sky.
  const { forward, back, up, down } = drives(input);
  p.lean = p.bow = 0;
  // Arched hard to go down, flattened out to go up.
  p.hipL = p.hipR = -0.28 + 0.1 * back - 0.12 * down + 0.3 * up;
  // Legs out to go forward or up, tucked to back up.
  p.kneeL = p.kneeR = 1.25 - 0.75 * forward + 0.3 * back - 0.4 * up + 0.15 * down;
  p.spread = 0.32 + 0.1 * up - 0.12 * down;
  // Arms in to go forward, reaching out ahead to back up, swept back to go
  // down; the low hand turns.
  const reach = 0.24 - 0.14 * forward + 0.2 * back + 0.06 * up - 0.2 * down;
  const span = 0.44 + 0.06 * up - 0.1 * down;
  const dip = 0.13 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-span + shift, reach, 0.07 + dip);
  p.handR.set(span + shift, reach, 0.07 - dip);
  p.elbowL.set(-1, -0.25, 0.5);
  p.elbowR.set(1, -0.25, 0.5);
}

function backFly(p: Pose, input: BodyInputs): void {
  // On the back as in a chair laid down: thighs up, shins out towards where
  // the eyes look, arms out to the sides and a little into the air.
  const { forward, back, up, down } = drives(input);
  p.lean = p.bow = 0;
  // Legs out (feet low) to go towards them, knees in to go the other way.
  p.hipL = p.hipR = 0.7 - 0.3 * forward + 0.3 * back + 0.1 * up;
  p.kneeL = p.kneeR = 1.2 - 0.5 * forward + 0.25 * back;
  p.spread = 0.35 + 0.15 * up - 0.2 * down;
  const span = 0.5 + 0.08 * up - 0.16 * down;
  const reach = -0.12 + 0.05 * forward - 0.14 * back - 0.08 * down;
  const dip = 0.12 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-span + shift, reach, 0.1 - dip);
  p.handR.set(span + shift, reach, 0.1 + dip);
  p.elbowL.set(-1, 0.1, 0.5);
  p.elbowR.set(1, 0.1, 0.5);
}

function sit(p: Pose, input: BodyInputs): void {
  // Sitting on the air: thighs level, shins down, knees apart, arms out to
  // the sides with the hands at the hips.
  const { forward, back, up, down } = drives(input);
  p.lean = p.bow = 0;
  p.hipL = p.hipR = 1.45 - 0.1 * back;
  // Shins pushed forward to go forward, drawn under to back up.
  p.kneeL = p.kneeR = 1.45 - 0.5 * forward + 0.25 * back;
  p.spread = 0.35 + 0.15 * up - 0.2 * down;
  const span = 0.5 + 0.08 * up - 0.15 * down;
  const height = -0.32 + 0.06 * up - 0.06 * down;
  const reach = -0.12 + 0.04 * forward - 0.08 * back;
  // The low hand turns.
  const dip = 0.08 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-span + shift, height + dip, reach);
  p.handR.set(span + shift, height - dip, reach);
  p.elbowL.set(-1, -0.4, 0.2);
  p.elbowR.set(1, -0.4, 0.2);
}

function headDown(p: Pose, input: BodyInputs): void {
  // Upside down and straight, legs up a little apart with soft knees, arms
  // out level with the shoulders.
  const { forward, back, up, down } = drives(input);
  p.lean = p.bow = 0;
  // Legs back to go forward, a slight pike to back up; split to go up.
  p.hipL = p.hipR = 0.1 - 0.15 * forward + 0.25 * back;
  p.kneeL = p.kneeR = 0.3 + 0.35 * up - 0.15 * down;
  p.spread = 0.2 + 0.25 * up - 0.15 * down;
  // Arms in along the body to dive faster.
  const span = 0.56 + 0.06 * up - 0.26 * down;
  const height = -0.16 - 0.16 * down;
  const reach = -0.08 - 0.08 * forward + 0.08 * back;
  const dip = 0.1 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-span + shift, height, reach + dip);
  p.handR.set(span + shift, height, reach - dip);
  p.elbowL.set(-1, 0.2, 0.3);
  p.elbowR.set(1, 0.2, 0.3);
}

function throwOut(p: Pose): void {
  // Right hand back to the handle at the foot of the container, left hand
  // forward over the head to stay level.
  box(p, { turn: 0, forward: 0, slide: 0, fall: 0 });
  p.handR.set(0.12, -0.63, 0.36);
  p.elbowR.set(1, 0.2, 0.7);
  p.handL.set(-0.16, 0.56, 0.03);
  p.elbowL.set(-1, 0, 0.4);
}

function hanging(p: Pose): void {
  p.lean = p.bow = 0;
  p.hipL = p.hipR = HANGING_HIPS;
  p.kneeL = p.kneeR = 0.12;
  p.spread = 0.06;
  // The hands are on the risers then; these only matter on the way there.
  p.handL.set(-0.25, 0.25, -0.05);
  p.handR.set(0.25, 0.25, -0.05);
  p.elbowL.set(-1, -0.6, 0.3);
  p.elbowR.set(1, -0.6, 0.3);
}

function ground(p: Pose, hipL: number, hipR: number): void {
  p.lean = p.bow = 0;
  p.hipL = hipL;
  p.hipR = hipR;
  p.kneeL = p.kneeR = 0.12;
  p.spread = 0.06;
  // Arms down by the sides once the toggles are let go.
  p.handL.set(-0.3, -0.7, 0.08);
  p.handR.set(0.3, -0.7, 0.08);
  p.elbowL.set(-1, 0, 0.6);
  p.elbowR.set(1, 0, 0.6);
}

export class Posture {
  readonly pose = makePose();
  private readonly target = makePose();
  private stance: Stance | null = null;

  /**
   * Moves the pose on towards the stance. `legs`: hip angles on the ground,
   * which the landing animates itself and are followed at once.
   */
  update(dt: number, stance: Stance, input: BodyInputs, legs: [number, number] = [HANGING_HIPS, HANGING_HIPS]): Pose {
    const t = this.target;
    switch (stance) {
      case 'door':
        door(t);
        break;
      case 'belly':
        box(t, input);
        break;
      case 'back':
        backFly(t, input);
        break;
      case 'sit':
        sit(t, input);
        break;
      case 'headDown':
        headDown(t, input);
        break;
      case 'throw':
        throwOut(t);
        break;
      case 'hanging':
        hanging(t);
        break;
      case 'ground':
        ground(t, legs[0], legs[1]);
        break;
    }
    if (this.stance === null) copyPose(this.pose, t);
    else blendPose(this.pose, t, 1 - Math.exp(-dt / SETTLE[stance]));
    if (stance === 'ground') {
      this.pose.hipL = legs[0];
      this.pose.hipR = legs[1];
    }
    this.stance = stance;
    return this.pose;
  }

  /** Jumps straight into the next stance given, as at the start of a jump. */
  reset(): void {
    this.stance = null;
  }
}
