// How the pilot holds the body at each moment of the jump, and the moves
// between: crouched in the door, the four freefall positions (box, back,
// sit, head down, which shift with the inputs) and the track, the reach for the pilot
// chute, hanging in the harness, standing on the ground.

import type { BodyInputs, BodyPosition } from '../sim/freefall';
import { blendPose, copyPose, makePose, type Pose } from './body';

/** In the door: `door` on the left of the plane, `doorRight` on its right. */
/** `track`: stretched out to glide, a track flat, an angle upright; drawn the same, the body's attitude does the rest. */
export type Stance = 'door' | 'doorRight' | BodyPosition | 'track' | 'throw' | 'hanging' | 'ground' | 'cutaway' | 'reserve';

/** The stances that follow the freefall inputs. */
export const FREEFALL_STANCES: ReadonlySet<Stance> = new Set(['belly', 'back', 'sit', 'headDown', 'track']);

/** Hip angle of the legs hanging in the harness, rad forward. */
const HANGING_HIPS = 0.21;

/** Time to settle into each stance, s: the reach for the handle is quick. */
const SETTLE: Record<Stance, number> = {
  door: 0.35,
  doorRight: 0.35,
  belly: 0.3,
  back: 0.3,
  sit: 0.3,
  headDown: 0.3,
  track: 0.5,
  throw: 0.12,
  hanging: 0.35,
  ground: 0.15,
  cutaway: 0.1,
  reserve: 0.1,
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

function door(p: Pose, side: -1 | 1): void {
  // Crouched on the sill facing the nose, bent forward, the head at the
  // door line: the outer hand on the front of the door frame, the inner one
  // on the knee. Drawn for a door on the left, mirrored for one on the right.
  p.lean = 0;
  p.bow = 0.35;
  p.hipL = p.hipR = 1.8;
  p.kneeL = p.kneeR = 1.55;
  p.spread = 0.1;
  const [frame, frameElbow, knee, kneeElbow] = side < 0 ? [p.handL, p.elbowL, p.handR, p.elbowR] : [p.handR, p.elbowR, p.handL, p.elbowL];
  frame.set(0.03 * -side, -0.03, -0.28);
  frameElbow.set(side, -0.6, 0.1);
  knee.set(0.13 * -side, -0.47, -0.13);
  kneeElbow.set(-side, 0, 0.4);
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

function track(p: Pose, input: BodyInputs): void {
  // Stretched out: legs straight and nearly together, a slight pike at the
  // hips, arms back along the sides with the hands by the hips, a little
  // behind the body, the shoulders rolled in.
  const { forward, back } = drives(input);
  p.lean = p.bow = 0;
  // Pushed hard, the legs straighter still; eased off, a little more pike.
  p.hipL = p.hipR = 0.08 - 0.06 * forward + 0.2 * back;
  p.kneeL = p.kneeR = 0.06 + 0.15 * back;
  p.spread = 0.07;
  const span = 0.26 + 0.12 * back;
  const height = -0.48 + 0.12 * back;
  // The low hand turns, a hand out slides.
  const dip = 0.08 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-span + shift, height, 0.12 + dip);
  p.handR.set(span + shift, height, 0.12 - dip);
  p.elbowL.set(-1, 0, 0.4);
  p.elbowR.set(1, 0, 0.4);
}

function wingsuit(p: Pose, input: BodyInputs): void {
  // Flying a wingsuit: arms out wide and nearly straight, swept back a
  // little, the wings taut between them and the body; legs straight in a V
  // for the wing between them.
  const { forward, back, up, down } = drives(input);
  p.lean = p.bow = 0;
  // Diving, the shoulders roll forward and the arms come back; flaring, they go out ahead.
  p.hipL = p.hipR = 0.04 - 0.04 * forward + 0.18 * back;
  p.kneeL = p.kneeR = 0.05 + 0.1 * back;
  // Wings closed a little to go down faster, spread wide to float.
  p.spread = 0.24 + 0.05 * up - 0.12 * down;
  const span = 0.5 + 0.03 * up - 0.2 * down - 0.04 * forward;
  const height = -0.34 - 0.1 * forward + 0.1 * back - 0.08 * down;
  const reach = 0.06 + 0.04 * forward - 0.06 * back;
  // The low hand turns, the arms shift to slide.
  const dip = 0.1 * input.turn;
  const shift = 0.05 * input.slide;
  p.handL.set(-0.19 - span + shift, height, reach + dip);
  p.handR.set(0.19 + span + shift, height, reach - dip);
  p.elbowL.set(-0.3, 0.2, 1);
  p.elbowR.set(0.3, 0.2, 1);
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

/** Peeling the cutaway pillow out with the right hand, the left already on the reserve handle. */
function cutaway(p: Pose): void {
  hanging(p, 0);
  p.handR.set(0.3, -0.44, -0.3);
  p.elbowR.set(1, -0.3, 0.3);
  p.handL.set(-0.1, -0.34, -0.05);
  p.elbowL.set(-1, -0.4, 0.3);
}

/** The reserve handle pulled out to arm's length, the right arm out to keep flat. */
function reservePull(p: Pose): void {
  box(p, { turn: 0, forward: 0, slide: 0, fall: 0 });
  p.handL.set(-0.34, -0.3, -0.32);
  p.elbowL.set(-1, -0.2, 0.3);
}

/**
 * Hanging in the harness. `prep`: getting ready to land, from 0 to 1: feet
 * and knees together, knees a little bent, feet slightly forward.
 */
function hanging(p: Pose, prep: number): void {
  p.lean = p.bow = 0;
  p.hipL = p.hipR = HANGING_HIPS + 0.16 * prep;
  p.kneeL = p.kneeR = 0.12 + 0.2 * prep;
  p.spread = 0.06 * (1 - prep) + 0.01;
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

/** What the legs do on top of the stance: the landing coming, and the way they swing. */
export interface LegCues {
  /** Ready to land, 0 to 1. */
  prep: number;
  /** The legs swung forward and to the right of the body, rad. */
  fore: number;
  side: number;
}

/**
 * The legs as pendulums from the hips: they lag behind what the body does,
 * swinging back when it surges forward, forward in a flare, out of a turn.
 */
export class LegSwing {
  fore = 0;
  side = 0;
  private foreRate = 0;
  private sideRate = 0;

  /**
   * `ahead`, `right`: the push the body feels from its harness, beyond
   * holding it up, along its own forward and right, m/s².
   */
  update(dt: number, ahead: number, right: number): void {
    if (dt <= 0) return;
    // Legs about 0.9 m long hanging from the hips, and damping themselves a little.
    const w = Math.sqrt(9.81 / 0.9);
    const zeta = 0.3;
    const h = Math.min(dt, 0.05);
    const toFore = Math.max(-0.5, Math.min(0.5, Math.atan(-ahead / 9.81)));
    const toSide = Math.max(-0.4, Math.min(0.4, Math.atan(-right / 9.81)));
    this.foreRate += (w * w * (toFore - this.fore) - 2 * zeta * w * this.foreRate) * h;
    this.sideRate += (w * w * (toSide - this.side) - 2 * zeta * w * this.sideRate) * h;
    this.fore += this.foreRate * h;
    this.side += this.sideRate * h;
  }

  reset(): void {
    this.fore = this.side = this.foreRate = this.sideRate = 0;
  }
}

export class Posture {
  /** In a wingsuit: the track is the wings flown. */
  wings = false;
  readonly pose = makePose();
  private readonly target = makePose();
  private readonly out = makePose();
  private stance: Stance | null = null;

  /**
   * Moves the pose on towards the stance. `legs`: hip angles on the ground,
   * which the landing animates itself and are followed at once. `cues`:
   * under canopy, what the legs do on top of hanging.
   */
  update(
    dt: number,
    stance: Stance,
    input: BodyInputs,
    legs: [number, number] = [HANGING_HIPS, HANGING_HIPS],
    cues: LegCues = { prep: 0, fore: 0, side: 0 },
  ): Pose {
    const t = this.target;
    switch (stance) {
      case 'door':
      case 'doorRight':
        door(t, stance === 'door' ? -1 : 1);
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
      case 'track':
        if (this.wings) wingsuit(t, input);
        else track(t, input);
        break;
      case 'throw':
        throwOut(t);
        break;
      case 'hanging':
        hanging(t, cues.prep);
        break;
      case 'cutaway':
        cutaway(t);
        break;
      case 'reserve':
        reservePull(t);
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
    if (stance === 'hanging') {
      // The swing goes on top of the pose, and is not eased: it is the swing.
      copyPose(this.out, this.pose);
      this.out.hipL += cues.fore;
      this.out.hipR += cues.fore;
      this.out.sway = cues.side;
      return this.out;
    }
    return this.pose;
  }

  /** Jumps straight into the next stance given, as at the start of a jump. */
  reset(): void {
    this.stance = null;
  }
}
