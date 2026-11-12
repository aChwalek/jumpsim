// A jumper flown by the sim itself, for company on a solo jump: out of the
// same plane a moment after us, into a slot beside us (or leading a track),
// away at the break-off, under a canopy and down to the landing area.
//
// A bot is a whole jump of its own, the same as ours, fed by a brain in place
// of the keys. In freefall the brain is a PD controller on each axis: it
// pushes towards the slot by how far off it is (P), and holds back by how
// fast it is closing (D), so it stops in the slot and not past it. Under
// canopy it is cruder: to the start of a final, round it until low enough,
// then in against the wind and a flare.

import { FlightModel, neutralControls, type Controls, type Environment } from './flightModel';
import { noBodyInputs, type BodyInputs } from './freefall';
import { Jump, type JumpOptions } from './jump';
import { detectTouchdown, feetHeight, type Touchdown } from './landing';
import { EXIT_SPOTS, type ExitSpot, type JumpRun } from './plane';
import type { RigParams } from './rig';
import { SIM_DT } from './telemetry';
import { DEG, clamp, rotate, set, vec3, type Vec3 } from './vec';

/** Round us, belly to earth; or a track, the first bot leading. */
export type BotMode = 'formation' | 'track';
export const BOT_MODES: readonly BotMode[] = ['formation', 'track'];
export const BOTS_MAX = 4;

/** Who the bots fly with: us, or for those following a track, the bot leading it. */
export interface Lead {
  pos: Vec3;
  vel: Vec3;
  /** Out of the plane. */
  out: boolean;
  /** In freefall: there to fly with. */
  falling: boolean;
  /** How hard it drives its track, -1 to 1: what holding a slot on it starts from. */
  drive?: number;
  /** Compass heading it faces, degrees: the round forms in front of it. */
  headingDeg?: number;
}

export interface BotPlan {
  /** Which of the bots this is, from 0, and how many there are. */
  index: number;
  of: number;
  mode: BotMode;
  run: JumpRun;
  /** Where we wait in the plane: the bots take the other places. */
  spot: ExitSpot;
  /** Where to land, and the compass heading finals are flown on. */
  landing: { x: number; z: number; headingDeg: number };
  groundAt: (x: number, z: number) => number;
  options: JumpOptions;
  random?: () => number;
}

/** In a round, how far each is from the next, shoulders to shoulders, m. */
export const SLOT_SPACING = 2.6;
/** The radius of a round of this many, us included, m: two face each other, more stand round a circle. */
export const roundRadius = (jumpers: number): number => SLOT_SPACING / 2 / Math.sin(Math.PI / Math.max(2, jumpers));
/**
 * The round is in front of us, and comes back in front of us when we turn,
 * but slowly, degrees per second: nobody flies round a formation as fast as its middle spins.
 */
const ROUND_FOLLOWS = 25;
/** In a track: each row this far behind the leader and out to the side, and this much above, m. */
const TRACK_ROW = 5;
const TRACK_STEP_UP = 1.5;
/** Out of the door this long after us, s, and each bot this long after the one before. */
const EXIT_AFTER = 0.15;
const EXIT_GAP = 0.15;
/** The track is off the line of flight: this far to the right of jump run, degrees. */
const TRACK_OFF_RUN = 90;
/** The leader falls flat this long before turning onto the track, s. */
const TRACK_FROM = 3;
/** The leader eases off when we are this far behind, m, and all the way at this much more. */
const WAIT_FROM = 12;
const WAIT_SPAN = 40;
/**
 * The leader flies an easy track, short of the best there is, and never eases
 * off all the way: those behind need something in hand to catch up, and to drop back.
 */
const TRACK_EASY = -0.3;
const TRACK_MARGIN = 0.25;
/** The lowest pull is this far above the ground, m; each bot after pulls this much higher. */
const PULL_HEIGHT = 1000;
const PULL_STEP = 60;
/** Nobody pulls lower than this, even out of a low plane, m. */
const PULL_FLOOR = 700;
/** From the break-off to the lowest pull, m. */
const BREAK_OFF_ABOVE = 450;
/** Tracking away from the others, at most this long, s. */
const AWAY_FOR = 6;

/**
 * The PD gains, per metre off the slot and per m/s closing on it. A belly
 * flyer gets about 2 m/s² from a full input and the air takes it back in
 * some 4 s: these stop it in the slot without going past.
 */
const KP = 0.8;
const KD = 1.1;
const KP_FALL = 1.2;
const KD_FALL = 1.2;
/** Turn asked per radian off the heading wanted. */
const K_TURN = 0.7;
/** In a track everything goes faster and the inputs do less: gentler. */
const KP_TRACK = 0.12;
const KD_TRACK = 0.35;

/** Under canopy: where the final starts, m above the ground, and how far back for each metre of it in still air. */
const FINAL_HEIGHT = 90;
const FINAL_GLIDE = 2.2;
/** A canopy flies at about this through the air, m/s: what a headwind is held against. */
const CANOPY_SPEED = 11;
/** Near enough the start of the final to go round it, m. */
const HOLD_RADIUS = 45;
/** Below this the canopy is not turned any more, m. */
const WINGS_LEVEL = 25;
/** The flare starts with the feet this high, m. */
const FLARE_HEIGHT = 4.5;
/** How fast the hands move a toggle, of its travel per second. */
const HAND_RATE = 1.6;
/** After the opening: a moment, then both toggles down to free the brakes, s. */
const UNSTOW_AT = 1.5;
const UNSTOW_FOR = 0.6;

/** Where the lowest bot pulls and where they all break off, out of a plane this high, m above the ground. */
export function botHeights(exitHeight: number): { pull: number; breakOff: number } {
  const pull = clamp(exitHeight - 600, PULL_FLOOR, PULL_HEIGHT);
  return { pull, breakOff: pull + BREAK_OFF_ABOVE };
}

/** The shortest way round from one compass heading to another, degrees, positive to the right. */
const turnTo = (fromDeg: number, toDeg: number): number => ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
/** Compass bearing of a horizontal vector, degrees. */
const bearing = (x: number, z: number): number => Math.atan2(x, -z) / DEG;

export class Bot {
  readonly model: FlightModel;
  readonly jump: Jump;
  /** What the canopy gets, and where the hands are. */
  readonly controls: Controls = neutralControls();
  readonly hands: Controls = neutralControls();
  readonly input: BodyInputs = noBodyInputs();
  /** On the ground, and for how long, s. */
  touchdown: Touchdown | null = null;
  landedFor = 0;
  /** Asked to track. */
  private tracking = false;
  /** Until the exit, s, once whoever we follow is out. */
  private exitIn: number | null = null;
  /** Since the break-off, s; null before it. */
  private away: number | null = null;
  /** Under an open canopy, s. */
  private flown = 0;
  private readonly wanted: Controls = neutralControls();
  private readonly slot = vec3();
  private readonly tmp = vec3();
  private readonly pullAt: number;
  private readonly breakOffAt: number;
  /** Compass heading of the track. */
  private readonly trackDeg: number;
  /** Which way this bot goes at the break-off, compass degrees: out from the middle of the round. */
  private outDeg: number;
  /** Which way the round is from us, compass degrees; null until we are there to form on. */
  private roundDeg: number | null = null;
  /** Nobody holds a slot to the centimetre: where this one wanders, and how fast. */
  private readonly wander: [number, number, number];
  private time = 0;

  constructor(
    rig: RigParams,
    env: Environment,
    private readonly plan: BotPlan,
  ) {
    const random = plan.random ?? Math.random;
    this.model = new FlightModel(rig);
    const others = EXIT_SPOTS.filter((s) => s !== plan.spot);
    const spot = others[plan.index % others.length]!;
    this.jump = new Jump(this.model, plan.run, env, plan.groundAt, random, { ...plan.options, malfunction: null, spot });
    const heights = botHeights(plan.run.height);
    this.pullAt = heights.pull + PULL_STEP * plan.index;
    this.breakOffAt = heights.breakOff;
    this.trackDeg = plan.run.headingDeg + TRACK_OFF_RUN;
    this.outDeg = plan.run.headingDeg + 180 + (360 * plan.index) / plan.of;
    this.wander = [random() * 6.28, random() * 6.28, 0.5 + 0.4 * random()];
  }

  /** Leading the track: the others, and we, follow this one. */
  get leads(): boolean {
    return this.plan.mode === 'track' && this.plan.index === 0;
  }

  /** As a lead for the bots that follow this one. */
  get lead(): Lead {
    const s = this.model.state;
    const phase = this.jump.phase;
    return { pos: s.pos, vel: s.vel, out: phase !== 'plane', falling: phase === 'freefall' && this.away === null, drive: this.input.forward };
  }

  /**
   * Flies on by `seconds`. `us`: the player. `leader`: the bot leading the
   * track, for those behind it. The brain looks once, the sim then steps as ours does.
   */
  step(seconds: number, env: Environment, us: Lead, leader: Lead | null = null): void {
    if (this.touchdown) {
      this.landedFor += seconds;
      return;
    }
    if (this.jump.impact) return;
    this.think(seconds, env, us, leader);
    let left = seconds;
    while (left > 1e-5 && !this.touchdown && !this.jump.impact) {
      const dt = Math.min(SIM_DT, left);
      left -= dt;
      this.advance(dt, env);
    }
  }

  private advance(dt: number, env: Environment): void {
    const jump = this.jump;
    const flying = jump.phase === 'canopy';
    jump.trackIt(this.tracking);
    jump.step(dt, this.input, env);
    const c = this.controls;
    if (!flying) {
      // The canopy comes out on its stowed brakes.
      Object.assign(c, neutralControls());
      Object.assign(this.hands, c);
      jump.holdStows(c);
      return;
    }
    const w = this.wanted;
    for (const k of ['brakeL', 'brakeR'] as const) c[k] = this.hands[k] += clamp(w[k] - this.hands[k], -HAND_RATE * dt, HAND_RATE * dt);
    jump.holdStows(c);
    this.model.step(dt, c, env);
    this.flown += dt;
    this.touchdown = detectTouchdown(this.model, this.plan.options.solidAt ?? this.plan.groundAt);
    if (this.touchdown) {
      // Stood where the feet came down.
      const s = this.model.state;
      set(s.vel, 0, 0, 0);
      set(s.omega, 0, 0, 0);
      set(s.pilotOmega, 0, 0, 0);
    }
  }

  private think(dt: number, env: Environment, us: Lead, leader: Lead | null): void {
    const jump = this.jump;
    const input = this.input;
    this.time += dt;
    input.turn = input.forward = input.slide = input.fall = 0;
    if (jump.phase === 'plane') {
      const first = leader ?? us;
      if (this.exitIn === null && first.out) this.exitIn = EXIT_AFTER + (leader ? 0 : EXIT_GAP * this.plan.index);
      if (this.exitIn !== null && (this.exitIn -= dt) <= 0) jump.act();
    } else if (jump.phase === 'freefall') this.fall(dt, us, leader);
    else if (jump.phase === 'canopy') this.steer(env);
  }

  /** Freefall: into the slot and held there, then away and the pull. */
  private fall(dt: number, us: Lead, leader: Lead | null): void {
    const jump = this.jump;
    const height = jump.height();
    // Cut away, or on the way to the pull: nothing more to fly.
    if (jump.cutawayAt !== null || jump.pullWhenFlat) return;
    if (height < this.pullAt) {
      this.tracking = false;
      return jump.act();
    }
    const heading = jump.body.headingDeg();
    const input = this.input;
    if (this.leads) {
      // Flat down the hill, then onto the track, easing off for whoever is left behind.
      if (jump.time < TRACK_FROM) return;
      this.tracking = true;
      input.turn = this.turn(heading, this.trackDeg);
      if (us.falling) {
        const t = this.trackDeg * DEG;
        const p = this.model.state.pos;
        const behind = (p.x - us.pos.x) * Math.sin(t) - (p.z - us.pos.z) * Math.cos(t);
        input.forward = TRACK_EASY - (1 + TRACK_EASY - TRACK_MARGIN) * clamp((behind - WAIT_FROM) / WAIT_SPAN, 0, 1);
      } else input.forward = TRACK_EASY;
      return;
    }
    const with_ = leader ?? us;
    if (this.away === null && (height < this.breakOffAt || !with_.falling) && jump.time > 1) this.away = 0;
    if (this.away !== null) {
      // The break-off: turn away from the others and track, then flat until the pull.
      this.away += dt;
      const side = this.plan.index % 2 ? -1 : 1;
      const out = leader ? this.trackDeg + side * 30 * Math.ceil(this.plan.index / 2) : this.outDeg;
      input.turn = this.turn(heading, out);
      this.tracking = leader ? true : this.away < AWAY_FOR && Math.abs(turnTo(heading, out)) < 60;
      return;
    }
    if (!with_.out) return;
    const slot = this.slot;
    const sway = this.wander;
    const k = Math.sin(this.time * sway[2] + sway[0]) * 0.25;
    if (leader) {
      // Behind the leader and out to one side, a little above: left, right, left, a row further back.
      const row = Math.ceil(this.plan.index / 2);
      const side = this.plan.index % 2 ? -1 : 1;
      const t = this.trackDeg * DEG;
      const back = TRACK_ROW * row;
      const across = side * TRACK_ROW * row + k;
      set(
        slot,
        leader.pos.x - Math.sin(t) * back + Math.cos(t) * across,
        leader.pos.y + TRACK_STEP_UP * row,
        leader.pos.z + Math.cos(t) * back + Math.sin(t) * across,
      );
      this.tracking = this.leaderTracks(leader);
      this.chase(slot, leader.vel, heading, this.trackDeg, this.tracking, leader.drive);
    } else {
      // A round: all of us on a circle, facing its middle, which is in front of us.
      const facing = us.headingDeg ?? this.plan.run.headingDeg;
      const round = (this.roundDeg = this.roundDeg === null ? facing : this.roundDeg + clamp(turnTo(this.roundDeg, facing), -ROUND_FOLLOWS * dt, ROUND_FOLLOWS * dt));
      const radius = roundRadius(this.plan.of + 1);
      const cx = us.pos.x + Math.sin(round * DEG) * radius;
      const cz = us.pos.z - Math.cos(round * DEG) * radius;
      // We are at the back of it; the bots take the other places, evenly round.
      this.outDeg = round + 180 + (360 * (this.plan.index + 1)) / (this.plan.of + 1);
      const a = this.outDeg * DEG;
      const r = radius + k;
      set(slot, cx + Math.sin(a) * r, us.pos.y + Math.cos(this.time * sway[2] * 0.7 + sway[1]) * 0.15, cz - Math.cos(a) * r);
      const p = this.model.state.pos;
      // Facing the middle, once near enough to tell.
      const far = Math.hypot(cx - p.x, cz - p.z);
      this.chase(slot, us.vel, heading, far > 0.5 ? bearing(cx - p.x, cz - p.z) : heading, false);
    }
  }

  /** The leader is going forward fast enough to be on a track. */
  private leaderTracks(leader: Lead): boolean {
    const t = this.trackDeg * DEG;
    return leader.vel.x * Math.sin(t) - leader.vel.z * Math.cos(t) > 12;
  }

  private turn(headingDeg: number, toDeg: number): number {
    return clamp(K_TURN * turnTo(headingDeg, toDeg) * DEG, -1, 1);
  }

  /** The PD: towards `slot`, which moves at `vel`, facing `faceDeg`. */
  private chase(slot: Vec3, vel: Vec3, headingDeg: number, faceDeg: number, tracking: boolean, drive = 0): void {
    const s = this.model.state;
    const input = this.input;
    const h = headingDeg * DEG;
    const ex = slot.x - s.pos.x;
    const ey = slot.y - s.pos.y;
    const ez = slot.z - s.pos.z;
    const vx = s.vel.x - vel.x;
    const vy = s.vel.y - vel.y;
    const vz = s.vel.z - vel.z;
    // Along where the body looks, and to its right.
    const ahead = ex * Math.sin(h) - ez * Math.cos(h);
    const across = ex * Math.cos(h) + ez * Math.sin(h);
    const closing = vx * Math.sin(h) - vz * Math.cos(h);
    const drifting = vx * Math.cos(h) + vz * Math.sin(h);
    const kp = tracking ? KP_TRACK : KP;
    const kd = tracking ? KD_TRACK : KD;
    // Diving a track to catch up ends far below it: no harder than the leader unless above the slot.
    input.forward = clamp((tracking ? drive : 0) + kp * ahead - kd * closing, -1, tracking ? clamp(-ey / 5, 0, 1) : 1);
    input.slide = clamp(kp * across - kd * drifting, -1, 1);
    // Above the slot: tuck in to fall faster.
    input.fall = clamp(-(KP_FALL * ey - KD_FALL * vy), -1, 1);
    // A wing goes sideways by turning: a little towards the slot, then back onto the heading.
    const face = tracking ? faceDeg + clamp(across * 2.5 - drifting * 6, -30, 30) : faceDeg;
    input.turn = this.turn(headingDeg, face);
  }

  /** Under canopy: to the start of the final, round it until low enough, then in and a flare. */
  private steer(env: Environment): void {
    const w = this.wanted;
    w.brakeL = w.brakeR = 0;
    if (this.flown < UNSTOW_AT) return;
    if (this.flown < UNSTOW_AT + UNSTOW_FOR) {
      w.brakeL = w.brakeR = 0.7;
      return;
    }
    const s = this.model.state;
    const height = feetHeight(this.model, this.plan.groundAt);
    if (height < FLARE_HEIGHT) {
      w.brakeL = w.brakeR = 1;
      return;
    }
    const fwd = rotate(this.tmp, s.att, set(this.tmp, 0, 0, -1));
    const heading = bearing(fwd.x, fwd.z);
    const { landing } = this.plan;
    const l = landing.headingDeg * DEG;
    // Each bot its own lane, side by side across the final.
    const lane = (this.plan.index - (this.plan.of - 1) / 2) * 18;
    const tx = landing.x + Math.cos(l) * lane;
    const tz = landing.z + Math.sin(l) * lane;
    // Against the wind the final is shorter over the ground.
    const head = -(env.wind.x * Math.sin(l) - env.wind.z * Math.cos(l));
    const back = FINAL_HEIGHT * FINAL_GLIDE * clamp(1 - head / CANOPY_SPEED, 0.15, 1.5);
    let to: number;
    if (height > FINAL_HEIGHT) {
      const gx = tx - Math.sin(l) * back - s.pos.x;
      const gz = tz + Math.cos(l) * back - s.pos.z;
      to = bearing(gx, gz);
      // There with height to spare: round it.
      if (Math.hypot(gx, gz) < HOLD_RADIUS) to += 80;
    } else {
      // On final: at the target while it is ahead, else straight on into the wind.
      to = bearing(tx - s.pos.x, tz - s.pos.z);
      if (Math.abs(turnTo(landing.headingDeg, to)) > 50) to = landing.headingDeg;
    }
    const off = turnTo(heading, to);
    // Low, no more turning than a touch: wings level for the flare.
    const most = height > WINGS_LEVEL ? 0.55 : 0.12;
    const pull = clamp((off * DEG) / 0.9, -1, 1) * most;
    w.brakeR = Math.max(0, pull);
    w.brakeL = Math.max(0, -pull);
  }
}
