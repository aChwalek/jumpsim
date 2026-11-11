// How the pilot holds the body at each moment of the jump, and the moves
// between: crouched in the door, the box in freefall (which shifts with the
// inputs), the reach for the pilot chute, hanging in the harness, standing
// on the ground.

import type { BodyInputs } from '../sim/freefall';
import { blendPose, copyPose, makePose, type Pose } from './body';

export type Stance = 'door' | 'box' | 'throw' | 'hanging' | 'ground';

/** Hip angle of the legs hanging in the harness, rad forward. */
const HANGING_HIPS = 0.21;

/** Time to settle into each stance, s: the reach for the handle is quick. */
const SETTLE: Record<Stance, number> = { door: 0.35, box: 0.3, throw: 0.12, hanging: 0.35, ground: 0.15 };

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
  const ahead = input.forward;
  const forward = Math.max(0, ahead);
  const back = Math.max(0, -ahead);
  p.lean = p.bow = 0;
  p.hipL = p.hipR = -0.28 + 0.1 * back;
  // Legs out to go forward, tucked to back up.
  p.kneeL = p.kneeR = 1.25 - 0.75 * forward + 0.3 * back;
  p.spread = 0.32;
  // Arms in to go forward, reaching out ahead to back up; the low hand turns.
  const reach = 0.24 - 0.14 * forward + 0.2 * back;
  const dip = 0.13 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-0.44 + shift, reach, 0.07 + dip);
  p.handR.set(0.44 + shift, reach, 0.07 - dip);
  p.elbowL.set(-1, -0.25, 0.5);
  p.elbowR.set(1, -0.25, 0.5);
}

function throwOut(p: Pose): void {
  // Right hand back to the handle at the foot of the container, left hand
  // forward over the head to stay level.
  box(p, { turn: 0, forward: 0, slide: 0 });
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
      case 'box':
        box(t, input);
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
