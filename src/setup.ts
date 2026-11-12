// Everything chosen before a jump: the drop zone, the hour and the weather,
// the gear and the weight under it, and how the jump starts. Remembered from
// one visit to the next.

import { T } from './i18n';
import { HOUR_MAX, HOUR_MIN } from './render/daylight';
import { CANOPY_COLORS, isCanopyColor, type CanopyColorId } from './render/canopyColors';
import { isSmoke, type SmokeKind } from './render/smoke';
import type { Container } from './sim/jump';
import { DEFAULT_RIG, deriveRig, reserveConfig, rigConfig, type CanopyKind, type RigParams } from './sim/rig';
import { isSuitKind, isSuitLevel, type Suit, type SuitKind, type SuitLevel } from './sim/suit';
import { WIND_MAX_KMH, type GustLevel, type SkyKind, type Weather } from './sim/weather';
import { DZS, dzInfo, type DzId } from './world/dzs';

/** Canopy sizes on offer, ft², largest first. Cross-braced ones only come small. */
export const CANOPY_SIZES: Record<CanopyKind, number[]> = {
  classic: [260, 230, 210, 190, 170, 150, 135, 120, 107, 96, 84],
  triCell: [120, 107, 96, 84, 75, 67],
};
/** The kind of canopy as the language in use names it. */
export const kindName = (kind: CanopyKind): string => T.setup.kinds[kind];
/** Pilot plus all gear, kg. */
export const WEIGHT_MIN = 50;
export const WEIGHT_MAX = 130;

/** What shows the height: nothing, a dial on the wrist, or digits. */
export type AltimeterKind = 'none' | 'analog' | 'digital';

/**
 * The main's slider: fixed (it stays on the links, flapping), collapsible
 * (pulled in tight there), or removable (taken off and stowed).
 */
export type SliderKind = 'fixed' | 'collapsible' | 'removable';
export const SLIDER_KINDS: readonly SliderKind[] = ['fixed', 'collapsible', 'removable'];

export const CONTAINERS: readonly Container[] = ['sport', 'base'];

/** How often the main goes wrong as it opens. */
export type MalfunctionRate = 'none' | 'sometimes' | 'always';
export const MALFUNCTION_RATES: readonly MalfunctionRate[] = ['none', 'sometimes', 'always'];
/** "Sometimes": one opening in this many. */
export const MALFUNCTION_ODDS = 5;

export interface Gear {
  kind: CanopyKind;
  canopyAreaFt2: number;
  exitWeightKg: number;
  color: CanopyColorId;
  altimeter: AltimeterKind;
  /** An audible altimeter in the helmet, beeping at the circuit heights. */
  audible: boolean;
  slider: SliderKind;
  /** A skydiving container, with a reserve, or a BASE one, with one canopy only. */
  container: Container;
  /** A reserve static line: cutting the main away pulls the reserve. */
  rsl: boolean;
  /** A smoke canister on the right ankle, lit on leaving: its colour, or none. */
  smoke: SmokeKind;
  /** A plain jumpsuit, a tracking suit or a wingsuit. */
  suit: SuitKind;
  /** Of the tracking suit or the wingsuit, 1 to 3. */
  suitLevel: SuitLevel;
}

/** The suit as the jump flies it. */
export const suitOf = (gear: Gear): Suit => ({ kind: gear.suit, level: gear.suitLevel });

/** Whether two gears fall the same: same suit (a plain jumpsuit has no level). */
export const sameSuit = (a: Gear, b: Gear): boolean =>
  a.suit === b.suit && (a.suit === 'jumpsuit' || a.suitLevel === b.suitLevel);

/** The wings of a suit match the canopy: its main colour. */
export const suitColor = (color: CanopyColorId): number => CANOPY_COLORS[color].cells[1]!;

/**
 * Where the jump starts: in the plane, already under canopy (on downwind or
 * on final), or on top of a BASE object, where the drop zone has one.
 */
export type Start = 'plane' | 'pattern' | 'final' | 'base';
export const STARTS: readonly Start[] = ['plane', 'pattern', 'final', 'base'];

/** The starts on offer at a drop zone. */
export const startsAt = (dz: DzId): Start[] => STARTS.filter((s) => s !== 'base' || !!dzInfo(dz).base);

/** Exit heights on offer, above the drop zone, m: from a hop and pop to a high one. */
export const EXIT_HEIGHT_MIN = 1000;
export const EXIT_HEIGHT_MAX = 4500;
export const EXIT_HEIGHT_STEP = 100;

export interface JumpPlan {
  start: Start;
  /** Exit height above the drop zone, m. */
  exitHeight: number;
  /** Compass heading of jump run, degrees, or null to fly it into the wind. */
  runDeg: number | null;
  /** How often the main goes wrong. */
  malfunction: MalfunctionRate;
}

export interface Setup {
  dz: DzId;
  /** Local clock time at the drop zone, hours. */
  hour: number;
  weather: Weather;
  gear: Gear;
  jump: JumpPlan;
}

export const rigFor = (gear: Gear): RigParams =>
  deriveRig(rigConfig(gear.kind, gear.canopyAreaFt2, gear.exitWeightKg));

/** The reserve packed with this gear, sized for the weight. */
export const reserveRigFor = (gear: Gear): RigParams => deriveRig(reserveConfig(gear.exitWeightKg));

/** Whether two gears fly the same: same canopy, same weight. */
export const sameFlight = (a: Gear, b: Gear): boolean =>
  a.kind === b.kind && a.canopyAreaFt2 === b.canopyAreaFt2 && a.exitWeightKg === b.exitWeightKg;

export const nearestSize = (kind: CanopyKind, area: number): number =>
  CANOPY_SIZES[kind].reduce((best, size) => (Math.abs(size - area) < Math.abs(best - area) ? size : best));

export const validWeight = (kg: number): number => Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(kg)));

export const validExitHeight = (m: number): number =>
  Math.min(EXIT_HEIGHT_MAX, Math.max(EXIT_HEIGHT_MIN, Math.round(m / EXIT_HEIGHT_STEP) * EXIT_HEIGHT_STEP));

/** A compass heading in whole degrees, 0 to 359. */
export const validHeading = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

/** Heading jump run is flown on: the one chosen, or into the wind. */
export const runHeading = (setup: Setup): number => setup.jump.runDeg ?? setup.weather.windFromDeg;

/** Who usually flies a canopy loaded like this, lb/ft². */
export function loadingLabel(wingLoading: number): string {
  const level = [0.8, 1.1, 1.35, 1.7, 2.1].findIndex((top) => wingLoading < top);
  return T.setup.loading[level < 0 ? 5 : level]!;
}

/** The usual wind of a drop zone, as the weather of a first visit. */
export function usualWeather(dz: DzId, sky: SkyKind = 'clear'): Weather {
  const { wind } = dzInfo(dz);
  return { sky, windFromDeg: wind.fromDeg, windKmh: Math.round(wind.speed * 3.6), gusts: 'none' };
}

export function defaultSetup(): Setup {
  const dz = DZS[0]!.id;
  return {
    dz,
    hour: 10,
    weather: usualWeather(dz),
    gear: {
      kind: 'classic',
      canopyAreaFt2: DEFAULT_RIG.canopyAreaFt2,
      exitWeightKg: DEFAULT_RIG.exitWeightKg,
      color: 'blue',
      altimeter: 'digital',
      audible: false,
      slider: 'collapsible',
      container: 'sport',
      rsl: true,
      smoke: 'none',
      suit: 'jumpsuit',
      suitLevel: 1,
    },
    jump: { start: 'plane', exitHeight: 4000, runDeg: null, malfunction: 'none' },
  };
}

const STORE = 'setup';
/** Where the gear menu used to keep the canopy and weight. */
const OLD_STORE = 'gear';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(v: unknown, options: readonly T[]): v is T => options.includes(v as T);

/** Brings anything saved, possibly by an older version, back to a valid setup. */
export function validSetup(saved: unknown): Setup {
  const setup = defaultSetup();
  const s = (saved ?? {}) as Partial<Record<keyof Setup, unknown>>;
  if (oneOf(s.dz, DZS.map((d) => d.id))) {
    setup.dz = s.dz;
    setup.weather = usualWeather(s.dz);
  }
  if (finite(s.hour)) setup.hour = Math.min(HOUR_MAX, Math.max(HOUR_MIN, s.hour));
  const w = (s.weather ?? {}) as Partial<Record<keyof Weather, unknown>>;
  if (oneOf(w.sky, ['clear', 'cumulus', 'hazy', 'overcast'] as const satisfies readonly SkyKind[])) setup.weather.sky = w.sky;
  if (finite(w.windFromDeg)) setup.weather.windFromDeg = ((Math.round(w.windFromDeg) % 360) + 360) % 360;
  if (finite(w.windKmh)) setup.weather.windKmh = Math.min(WIND_MAX_KMH, Math.max(0, Math.round(w.windKmh)));
  if (oneOf(w.gusts, ['none', 'light', 'strong'] as const satisfies readonly GustLevel[])) setup.weather.gusts = w.gusts;
  const g = (s.gear ?? {}) as Partial<Record<keyof Gear, unknown>>;
  const gear = setup.gear;
  if (g.kind === 'triCell') {
    gear.kind = 'triCell';
    gear.color = 'red';
  }
  if (finite(g.canopyAreaFt2)) gear.canopyAreaFt2 = g.canopyAreaFt2;
  gear.canopyAreaFt2 = nearestSize(gear.kind, gear.canopyAreaFt2);
  if (finite(g.exitWeightKg)) gear.exitWeightKg = validWeight(g.exitWeightKg);
  if (isCanopyColor(g.color)) gear.color = g.color;
  if (oneOf(g.altimeter, ['none', 'analog', 'digital'] as const)) gear.altimeter = g.altimeter;
  if (typeof g.audible === 'boolean') gear.audible = g.audible;
  if (oneOf(g.slider, SLIDER_KINDS)) gear.slider = g.slider;
  if (oneOf(g.container, CONTAINERS)) gear.container = g.container;
  if (typeof g.rsl === 'boolean') gear.rsl = g.rsl;
  if (isSmoke(g.smoke)) gear.smoke = g.smoke;
  if (isSuitKind(g.suit)) gear.suit = g.suit;
  if (isSuitLevel(g.suitLevel)) gear.suitLevel = g.suitLevel;
  const j = (s.jump ?? {}) as Partial<Record<keyof JumpPlan, unknown>>;
  if (oneOf(j.start, startsAt(setup.dz))) setup.jump.start = j.start;
  if (finite(j.exitHeight)) setup.jump.exitHeight = validExitHeight(j.exitHeight);
  if (finite(j.runDeg)) setup.jump.runDeg = validHeading(j.runDeg);
  if (oneOf(j.malfunction, MALFUNCTION_RATES)) setup.jump.malfunction = j.malfunction;
  return setup;
}

/** The setup chosen last time, or the default one. */
export function loadSetup(): Setup {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) return validSetup(JSON.parse(saved));
    // The canopy and weight chosen in the old gear menu are kept.
    const gear = localStorage.getItem(OLD_STORE);
    if (gear) return validSetup({ gear: JSON.parse(gear) });
  } catch {
    // Nothing usable saved: keep the default.
  }
  return defaultSetup();
}

export function saveSetup(setup: Setup): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(setup));
  } catch {
    // Private browsing or storage full: the setup is just not remembered.
  }
}

export const cloneSetup = (s: Setup): Setup => ({ ...s, weather: { ...s.weather }, gear: { ...s.gear }, jump: { ...s.jump } });
