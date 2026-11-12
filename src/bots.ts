import * as THREE from 'three';
import { T } from './i18n';
import { Markers, type MarkerTarget } from './net/markers';
import { RemoteJumper, type RemoteFrame } from './net/remote';
import { emptySnapshot, type Snapshot } from './net/snapshot';
import { CANOPY_COLORS, type CanopyColorId } from './render/canopyColors';
import { deployStage, jumpStance } from './render/jumpPose';
import { OUTFIT_COLOR_IDS } from './render/outfit';
import type { Lighting } from './render/scene';
import { reserveRigFor, rigFor, type Gear } from './setup';
import { airDensityAt } from './sim/atmosphere';
import { Bot, guideTo, type BotMode, type Guide, type Lead } from './sim/bot';
import type { Environment } from './sim/flightModel';
import { feetHeight } from './sim/landing';
import type { ExitSpot, JumpRun } from './sim/plane';
import { vec3 } from './sim/vec';
import { windAt, type Weather } from './sim/weather';

/** The others in the air with us, whoever flies them: who can be looked at, locked on, and tagged. */
export interface Others {
  has(id: string): boolean;
  whereIs(id: string, out: THREE.Vector3): THREE.Vector3 | null;
  inSight(): { id: string; name: string; pos: THREE.Vector3 }[];
  nameOf(id: string): string;
  drawMarkers(camera: THREE.PerspectiveCamera, targeted?: string | null): void;
}

export interface BotsSpec {
  count: number;
  mode: BotMode;
  /** Ours: the bots weigh what we do and fly a canopy like ours, so that they fall and fly as we do. */
  gear: Gear;
  run: JumpRun;
  spot: ExitSpot;
  landing: { x: number; z: number; headingDeg: number };
  weather: Weather;
  groundAt: (x: number, z: number) => number;
  solidAt: (x: number, z: number, y?: number) => number;
}

const NAMES = ['Léa', 'Tom', 'Inès', 'Max', 'Zoé', 'Sam', 'Nora', 'Hugo', 'Jade', 'Liam'];
/** Stood on the landing area this long, a bot packs up and goes, s. */
const GONE_AFTER = 15;

const pick = <T>(from: readonly T[]): T => from[Math.floor(Math.random() * from.length)]!;

interface Flown {
  id: string;
  name: string;
  bot: Bot;
  jumper: RemoteJumper;
  env: Environment;
  /** Out of the plane already at the last frame. */
  out: boolean;
}

/**
 * Jumpers flown by the sim on a jump on our own: each a jump like ours, drawn
 * as another player's is.
 */
export class Bots implements Others {
  private readonly flown: Flown[] = [];
  private readonly markers = new Markers(document.getElementById('hud') ?? document.body);
  private readonly targets: MarkerTarget[] = [];
  /** Those who have left the plane since last asked: to take away once said. */
  readonly exited: string[] = [];

  constructor(
    scene: THREE.Scene,
    light: Lighting,
    env: Environment,
    private readonly plan: BotsSpec,
  ) {
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    const colors = (Object.keys(CANOPY_COLORS) as CanopyColorId[]).filter((c) => c !== plan.gear.color).sort(() => Math.random() - 0.5);
    for (let index = 0; index < plan.count; index++) {
      const gear: Gear = {
        ...plan.gear,
        color: colors[index % colors.length]!,
        helmetColor: pick(OUTFIT_COLOR_IDS),
        suitColor: pick(OUTFIT_COLOR_IDS),
        smoke: 'none',
        container: 'sport',
        rsl: true,
      };
      const bot = new Bot(rigFor(gear), env, {
        index,
        of: plan.count,
        mode: plan.mode,
        run: plan.run,
        spot: plan.spot,
        landing: plan.landing,
        groundAt: plan.groundAt,
        options: { solidAt: plan.solidAt, reserve: reserveRigFor(gear), rsl: true, suit: { kind: gear.suit, level: gear.suitLevel } },
      });
      const jumper = new RemoteJumper(scene);
      jumper.setGear(gear, light);
      jumper.live = emptySnapshot();
      this.flown.push({ id: `bot-${index}`, name: names[index % names.length]!, bot, jumper, env: { wind: vec3(), airDensity: env.airDensity }, out: false });
    }
  }

  /** Flies them on. `us`: where we are in our jump. `time`: of the air, for the gusts. */
  step(seconds: number, us: Lead, time: number): void {
    const leader = this.flown.find((f) => f.bot.leads)?.bot;
    for (const f of this.flown) {
      const { bot, env } = f;
      const s = bot.model.state;
      const flying = bot.jump.phase === 'canopy';
      const height = Math.max(0, feetHeight(bot.model, this.plan.groundAt)) + (flying ? bot.model.rig.canopyPos.y - bot.model.rig.feetPos.y : 0);
      env.airDensity = airDensityAt(s.pos.y);
      windAt(env.wind, this.plan.weather, height, time);
      bot.step(seconds, env, us, leader && leader !== bot ? leader.lead : null);
      const out = bot.jump.phase !== 'plane';
      if (out && !f.out) this.exited.push(f.name);
      f.out = out;
    }
  }

  /** Draws them as they are now. */
  update(frame: Omit<RemoteFrame, 'now' | 'light'>, light: Lighting): void {
    const f: RemoteFrame = { ...frame, now: performance.now(), light };
    for (const { bot, jumper } of this.flown) {
      fill(jumper.live!, bot);
      // Gone in without a canopy (which the AAD sees to), or packed up and off the landing area.
      jumper.update(f, !bot.jump.impact && bot.landedFor < GONE_AFTER);
    }
  }

  /** The bot that leads, if one does: who to keep an eye on. */
  get leader(): string | null {
    return this.flown.find((f) => f.bot.leads)?.id ?? null;
  }

  /** How far we are from our place behind the bot that leads, while it is there to follow; null with no leader. */
  guide(us: Lead): Guide | null {
    const leader = this.flown.find((f) => f.bot.leads)?.bot;
    return leader && leader.jump.phase === 'freefall' ? guideTo(us, leader.lead) : null;
  }

  has(id: string): boolean {
    return this.flown.some((f) => f.id === id);
  }

  whereIs(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    return this.flown.find((f) => f.id === id)?.jumper.where(out) ?? null;
  }

  inSight(): { id: string; name: string; pos: THREE.Vector3 }[] {
    const seen: { id: string; name: string; pos: THREE.Vector3 }[] = [];
    for (const { id, name, jumper } of this.flown) {
      const pos = jumper.where(new THREE.Vector3());
      if (pos) seen.push({ id, name, pos });
    }
    return seen;
  }

  nameOf(id: string): string {
    return this.flown.find((f) => f.id === id)?.name ?? '…';
  }

  drawMarkers(camera: THREE.PerspectiveCamera, targeted: string | null = null): void {
    const targets = this.targets;
    let n = 0;
    for (const { id, name, jumper, bot } of this.flown) {
      const target = (targets[n] ??= { id, name: '', pos: new THREE.Vector3(), color: '' });
      if (!jumper.where(target.pos)) continue;
      target.id = id;
      target.name = bot.leads ? `${name} · ${T.cue.botLeads}` : name;
      target.color = jumper.color;
      n++;
    }
    targets.length = n;
    this.markers.update(camera, targets, targeted);
  }

  dispose(): void {
    this.markers.dispose();
    for (const { jumper } of this.flown) jumper.dispose();
    this.flown.length = 0;
  }
}

/** A bot as another player's jumper is sent: what the views draw from. */
function fill(o: Snapshot, bot: Bot): void {
  const { jump, model } = bot;
  const s = model.state;
  const landed = bot.touchdown !== null;
  o.phase = jump.phase;
  o.stance = landed ? 'ground' : jumpStance(jump);
  deployStage(jump, o);
  o.reserve = jump.canopy === 'reserve';
  o.cutaway = jump.cutawayAt !== null;
  o.inflation = jump.inflation;
  // On the risers from line stretch until let go on the ground.
  o.onRisers = o.inflation !== null && bot.landedFor < 0.25;
  o.mainHandle = jump.cutawayAt === null;
  o.reserveHandle = !(jump.canopy === 'reserve' && jump.log.reserveBy === 'hand');
  o.landed = landed;
  o.deflationL = model.deflationL;
  o.deflationR = model.deflationR;
  Object.assign(o.controls, bot.controls);
  Object.assign(o.hands, bot.hands);
  Object.assign(o.pos, s.pos);
  Object.assign(o.vel, s.vel);
  Object.assign(o.att, s.att);
  Object.assign(o.pilotAtt, s.pilotAtt);
}
