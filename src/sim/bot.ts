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
import { noBodyInputs, type BodyInputs, type BodyPosition } from './freefall';
import { Jump, type JumpOptions } from './jump';
import { detectTouchdown, feetHeight, type Touchdown } from './landing';
import { EXIT_SPOTS, type ExitSpot, type JumpRun } from './plane';
import type { RigParams } from './rig';
import { hasWings, type Suit } from './suit';
import { SIM_DT } from './telemetry';
import { DEG, clamp, rotate, set, vec3, type Vec3 } from './vec';

/**
 * Round us and close: flat, belly to earth, or upright, sitting or head down;
 * or a track, the first bot leading. Round us they fly as we do: flat or
 * upright is how they leave the plane, and they take our position if we change.
 */
export type BotMode = 'formation' | 'vertical' | 'track';
export const BOT_MODES: readonly BotMode[] = ['formation', 'vertical', 'track'];
export const BOTS_MAX = 4;
/** Who the others fly on: us, or the first of the bots. */
export type BotLead = 'us' | 'bot';
export const BOT_LEADS: readonly BotLead[] = ['us', 'bot'];

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
  /** The position it flies in: round it, the bots take the same, to fall as fast as it does. */
  position?: BodyPosition;
  /** Stretched out into a track, for those behind to do the same; taken as so if not said. */
  tracking?: boolean;
  /** Where it means to go, compass degrees, when it knows: else it is taken to go where it is going. */
  goingDeg?: number;
}

export interface BotPlan {
  /** Which of the bots this is, from 0, and how many there are. */
  index: number;
  of: number;
  mode: BotMode;
  /** Who the round forms on: us, the bots then flying as we do; or the first bot, which flies as it likes. A track always has a bot leading. */
  lead?: BotLead;
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
/** Stretched out, the leader stays on jump run this long, s, then comes off it this fast, degrees per second. */
const ON_RUN_FOR = 3;
const OFF_RUN_TURNS = 6;
/** Those behind stretch out once the lead goes forward this fast, m/s. */
const TRACK_SPEED = 12;
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

/** The leader goes round the landing area this far from it, m: a canopy still gets home from there. It starts turning this much before. */
const LEASH = 1100;
const LEASH_EASE = 300;
/** How fast the leader's line comes round, degrees per second: slow enough for the outside of the V to keep up. */
const LEADER_TURNS = 4;
/** Leading a round upright, a bot changes position this long after the exit at the soonest, s, then every so often. */
const CHANGE_FROM = 18;
const CHANGE_EVERY = 12;
/** We have to hold a position this long, s, for the bots round us to take it: not for one we only pass through. */
const LIKE_AFTER = 0.5;
/** How fast the line of those behind swings round to the leader's, degrees per second. */
const FLOCK_FOLLOWS = 40;

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
/** Level with the slot, a track is driven this much harder than its lead at most; each metre under or over it changes that by 1 / DIVE_SPAN. */
const DIVE_SPARE = 0.5;
const DIVE_SPAN = 4;
/** In a track, the most turn and slide asked: more, and a wing rolls over into a dive. */
const TRACK_TURN = 0.4;
const TRACK_SLIDE = 0.5;
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

/**
 * Whether the first bot leads and the others follow it: a track, and whatever is flown in wings.
 * A wing cannot hold a place on someone who flies theirs as well as it flies: it needs a lead
 * that flies easy, and we do not.
 */
export const leaderLed = (mode: BotMode, suit: Suit | undefined): boolean => mode === 'track' || hasWings(suit);

/**
 * How far we are from our place by a leader, m: to go up, and forward and to the right, along
 * its line behind the leader of a track, the way we face in a round.
 */
export interface Guide {
  up: number;
  ahead: number;
  right: number;
  /** A round, where forward is the way we face; else a line behind the leader, where it is the way it goes. */
  round?: boolean;
  /** In a round, the position the leader flies in when it is not ours: the one to take. */
  position?: BodyPosition;
}

/** Where round a round the place of this rank is, degrees from the way the round faces: whoever it forms on first, at the back. */
export const roundPlace = (rank: number, jumpers: number): number => 180 + (360 * rank) / jumpers;

/**
 * Our place in a round formed on a bot: the last one round, the bots having the others. `bots`
 * is how many they are, the leader among them.
 */
export function roundGuide(us: Lead, leader: Lead, bots: number): Guide {
  const facing = (leader.headingDeg ?? 0) * DEG;
  const radius = roundRadius(bots + 1);
  const a = facing + roundPlace(bots, bots + 1) * DEG;
  const dx = leader.pos.x + Math.sin(facing) * radius + Math.sin(a) * radius - us.pos.x;
  const dz = leader.pos.z - Math.cos(facing) * radius - Math.cos(a) * radius - us.pos.z;
  const h = (us.headingDeg ?? 0) * DEG;
  return {
    up: leader.pos.y - us.pos.y,
    ahead: dx * Math.sin(h) - dz * Math.cos(h),
    right: dx * Math.cos(h) + dz * Math.sin(h),
    round: true,
    position: leader.position !== undefined && leader.position !== us.position ? leader.position : undefined,
  };
}

/**
 * Our place behind a leader: in the middle of the first row of the V, behind it and a little
 * above, along where it goes.
 */
export function guideTo(us: Pick<Lead, 'pos'>, leader: Lead): Guide {
  const speed = Math.hypot(leader.vel.x, leader.vel.z);
  const t = (speed > TRACK_SPEED ? bearing(leader.vel.x, leader.vel.z) : (leader.goingDeg ?? 0)) * DEG;
  const dx = leader.pos.x - us.pos.x;
  const dz = leader.pos.z - us.pos.z;
  return {
    up: leader.pos.y + TRACK_STEP_UP - us.pos.y,
    ahead: dx * Math.sin(t) - dz * Math.cos(t) - TRACK_ROW,
    right: dx * Math.cos(t) + dz * Math.sin(t),
  };
}

/**
 * Where in the plane a bot waits: the places at the door we left free first, then in the cabin,
 * and all those past that in the cabin too, where one more behind another does not show.
 */
export function botSpot(index: number, ours: ExitSpot): ExitSpot {
  const free = EXIT_SPOTS.filter((s) => s !== ours && s !== 'inside');
  return free[index] ?? 'inside';
}

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
  /** Which way the round is from us, or the flock goes, compass degrees; null until there is someone to form on. */
  private lineDeg: number | null = null;
  /** Leading a round: the position it is going into next, and when it changes again, s after the exit. */
  private next: BodyPosition | null = null;
  private changeAt = 0;
  /** The heading it holds, compass degrees; null until out. */
  private holdDeg: number | null = null;
  /** The position we are seen in, and for how long, s. */
  private like: BodyPosition | null = null;
  private likeFor = 0;
  /** Leading a track: which way round the landing area it goes once far enough out (1 clockwise), 0 before; and where it goes now. */
  private round: -1 | 0 | 1 = 0;
  private goingDeg: number;
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
    const spot = botSpot(plan.index, plan.spot);
    this.jump = new Jump(this.model, plan.run, env, plan.groundAt, random, { ...plan.options, malfunction: null, spot });
    const heights = botHeights(plan.run.height);
    this.pullAt = heights.pull + PULL_STEP * plan.index;
    this.breakOffAt = heights.breakOff;
    this.trackDeg = plan.run.headingDeg + TRACK_OFF_RUN;
    this.goingDeg = plan.run.headingDeg;
    this.outDeg = plan.run.headingDeg + 180 + (360 * plan.index) / plan.of;
    this.wander = [random() * 6.28, random() * 6.28, 0.5 + 0.4 * random()];
  }

  /** A track, or whatever is flown in wings: a line behind a leader, where round us or round a bot is a round. */
  private get line(): boolean {
    return leaderLed(this.plan.mode, this.plan.options.suit);
  }

  /** Leading: the others, and we, follow this one. */
  get leads(): boolean {
    return this.plan.index === 0 && (this.line || this.plan.lead === 'bot');
  }

  /** As a lead for the bots that follow this one. */
  get lead(): Lead {
    const s = this.model.state;
    const phase = this.jump.phase;
    const falling = phase === 'freefall' && this.away === null;
    const b = this.jump.body;
    return {
      pos: s.pos,
      vel: s.vel,
      out: phase !== 'plane',
      falling,
      drive: this.input.forward,
      tracking: this.tracking,
      goingDeg: this.line ? this.goingDeg : undefined,
      headingDeg: b.headingDeg(),
      // The one it is going into, so that those round it go with it.
      position: this.next ?? b.position,
    };
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
      // Upright from the door, where that is how the jump is flown.
      if (this.plan.mode === 'vertical' && !jump.wings) jump.fly('sit');
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
    const p = this.model.state.pos;
    if (this.leads && this.line) {
      // Flat down the hill, then onto the track, easing off for whoever is left behind.
      if (jump.time < TRACK_FROM) return;
      this.tracking = true;
      // Out off jump run, then round the landing area at a canopy's reach from it: a long easy
      // turn, which those behind can hold, where turning back for it would scatter them.
      const { landing } = this.plan;
      const from = Math.hypot(p.x - landing.x, p.z - landing.z);
      if (this.round === 0 && from > LEASH - LEASH_EASE) {
        // Whichever way round is the lesser turn from here.
        this.round = turnTo(this.goingDeg, bearing(p.x - landing.x, p.z - landing.z)) < 0 ? 1 : -1;
      }
      if (this.round !== 0) {
        // Along the circle, and in or out towards it.
        const out = bearing(p.x - landing.x, p.z - landing.z);
        const wanted = out + this.round * (90 + 60 * clamp((from - LEASH) / LEASH_EASE, -1, 1));
        this.goingDeg += clamp(turnTo(this.goingDeg, wanted), -LEADER_TURNS * dt, LEADER_TURNS * dt);
      } else if (jump.time > TRACK_FROM + ON_RUN_FOR) {
        // Along jump run a moment, for whoever follows to line up behind, then off it.
        this.goingDeg += clamp(turnTo(this.goingDeg, this.trackDeg), -OFF_RUN_TURNS * dt, OFF_RUN_TURNS * dt);
      }
      input.turn = this.turn(heading, this.goingDeg);
      input.forward = TRACK_EASY;
      if (us.falling) {
        const v = this.model.state.vel;
        const behind = ((p.x - us.pos.x) * v.x + (p.z - us.pos.z) * v.z) / (Math.hypot(v.x, v.z) || 1);
        input.forward -= (1 + TRACK_EASY - TRACK_MARGIN) * clamp((behind - WAIT_FROM) / WAIT_SPAN, 0, 1);
      }
      return;
    }
    const with_ = leader ?? us;
    // Behind the leader of a track there is no round: a V, going where the leader goes.
    const flock = leader !== null && this.line;
    // Leading a round, there is nobody to lose: the height alone says when to go.
    const alone = this.leads;
    if (this.away === null && (height < this.breakOffAt || (!alone && !with_.falling)) && jump.time > 1) this.away = 0;
    if (this.away !== null) {
      // The break-off: flat again, turn away from the others and track, then flat until the pull.
      this.away += dt;
      if (jump.body.position !== 'belly') jump.fly('belly');
      input.turn = this.turn(heading, this.outDeg);
      this.tracking = flock || (this.away < AWAY_FOR && Math.abs(turnTo(heading, this.outDeg)) < 60);
      return;
    }
    if (alone) return this.please(heading);
    if (!with_.out) return;
    const slot = this.slot;
    const sway = this.wander;
    const k = Math.sin(this.time * sway[2] + sway[0]) * 0.25;
    if (flock) {
      // Where the leader means to go, which swings round as it turns.
      const going = with_.goingDeg ?? this.trackDeg;
      const along = (this.lineDeg = this.lineDeg === null ? going : this.lineDeg + clamp(turnTo(this.lineDeg, going), -FLOCK_FOLLOWS * dt, FLOCK_FOLLOWS * dt));
      // A V behind it: left, right, left, a row further back and a little above.
      const row = Math.ceil(this.plan.index / 2);
      const side = this.plan.index % 2 ? -1 : 1;
      const ahead = -TRACK_ROW * row;
      const across = side * TRACK_ROW * row + k;
      const t = along * DEG;
      set(
        slot,
        with_.pos.x + Math.sin(t) * ahead + Math.cos(t) * across,
        with_.pos.y + TRACK_STEP_UP * row,
        with_.pos.z - Math.cos(t) * ahead + Math.sin(t) * across,
      );
      // Stretched out once the lead is, and going forward for it: a track entered down the hill goes nowhere good.
      const forward = with_.vel.x * Math.sin(t) - with_.vel.z * Math.cos(t);
      this.tracking = (with_.tracking ?? true) && (this.tracking || (forward > TRACK_SPEED && jump.time > TRACK_FROM));
      this.outDeg = along + side * 30 * row;
      this.chase(slot, with_.vel, heading, along, this.tracking || jump.wings, with_.drive);
    } else {
      // In our position once we have held it a moment: any other falls at another speed, and
      // nobody stays close to someone going past at 50 km/h.
      const like = with_.position ?? jump.body.position;
      this.likeFor = like === this.like ? this.likeFor + dt : 0;
      this.like = like;
      if (this.likeFor > LIKE_AFTER && jump.body.position !== like && !jump.body.maneuvering) jump.fly(like);
      // A round: all of us on a circle, facing its middle, which is in front of us.
      const facing = with_.headingDeg ?? this.plan.run.headingDeg;
      const round = (this.lineDeg = this.lineDeg === null ? facing : this.lineDeg + clamp(turnTo(this.lineDeg, facing), -ROUND_FOLLOWS * dt, ROUND_FOLLOWS * dt));
      const radius = roundRadius(this.plan.of + 1);
      const cx = with_.pos.x + Math.sin(round * DEG) * radius;
      const cz = with_.pos.z - Math.cos(round * DEG) * radius;
      // Whoever it forms on is at the back of it; the bots take the next places, evenly round,
      // and round a bot the last one is ours.
      this.outDeg = round + roundPlace(leader ? this.plan.index : this.plan.index + 1, this.plan.of + 1);
      const a = this.outDeg * DEG;
      const r = radius + k;
      set(slot, cx + Math.sin(a) * r, with_.pos.y + Math.cos(this.time * sway[2] * 0.7 + sway[1]) * 0.15, cz - Math.cos(a) * r);
      // Facing the middle, once near enough to tell.
      const far = Math.hypot(cx - p.x, cz - p.z);
      this.chase(slot, with_.vel, heading, far > 0.5 ? bearing(cx - p.x, cz - p.z) : heading, false);
    }
  }

  /**
   * Leading a round: as it pleases. It holds its heading, for the round not to spin, and
   * upright goes from sitting to head down and back every so often.
   */
  private please(headingDeg: number): void {
    const jump = this.jump;
    this.holdDeg ??= headingDeg;
    this.input.turn = this.turn(headingDeg, this.holdDeg);
    if (this.plan.mode !== 'vertical' || jump.wings) return;
    const random = this.plan.random ?? Math.random;
    if (this.changeAt === 0) this.changeAt = CHANGE_FROM + CHANGE_EVERY * random();
    if (jump.time < this.changeAt || jump.body.maneuvering) return;
    this.changeAt = jump.time + CHANGE_EVERY * (0.7 + 0.6 * random());
    this.next = jump.body.position === 'sit' ? 'headDown' : 'sit';
    jump.fly(this.next);
  }

  private turn(headingDeg: number, toDeg: number): number {
    return clamp(K_TURN * turnTo(headingDeg, toDeg) * DEG * this.mirror(), -1, 1);
  }

  /**
   * -1 head down, else 1. Upside down the air runs along the body the other way, and turn and
   * slide go the other way round from what they do head up: the brain thinks in compass, so it
   * asks the other way.
   */
  private mirror(): number {
    const body = this.jump.body;
    if (body.position === 'belly' || body.position === 'back') return 1;
    // The head, below the feet: on the way down onto it as much as there.
    return rotate(this.tmp, body.state.att, set(this.tmp, 0, 1, 0)).y < 0 ? -1 : 1;
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
    // Diving a track to catch up ends far below it, and height is slow to win back: level with the
    // slot a little harder than the lead, under it no harder, all of it only from above.
    const most = tracking ? clamp(Math.max(0, drive) + DIVE_SPARE - ey / DIVE_SPAN, Math.max(0, drive), 1) : 1;
    input.forward = clamp((tracking ? drive : 0) + kp * ahead - kd * closing, -1, most);
    const side = tracking ? TRACK_SLIDE : 1;
    input.slide = clamp((kp * across - kd * drifting) * this.mirror(), -side, side);
    // Above the slot: tuck in to fall faster.
    input.fall = clamp(-(KP_FALL * ey - KD_FALL * vy), -1, 1);
    // A wing goes sideways by turning: a little towards the slot, then back onto the heading.
    const face = tracking ? faceDeg + clamp(across * 2.5 - drifting * 6, -30, 30) : faceDeg;
    input.turn = this.turn(headingDeg, face);
    if (tracking) input.turn = clamp(input.turn, -TRACK_TURN, TRACK_TURN);
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
