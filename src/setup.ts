// Everything chosen before a jump: the drop zone, the hour and the weather,
// the gear and the weight under it. Remembered from one visit to the next.

import { HOUR_MAX, HOUR_MIN } from './render/daylight';
import { isCanopyColor, type CanopyColorId } from './render/canopyColors';
import { DEFAULT_RIG, deriveRig, rigConfig, type CanopyKind, type RigParams } from './sim/rig';
import { WIND_MAX_KMH, type GustLevel, type SkyKind, type Weather } from './sim/weather';
import { DZS, dzInfo, type DzId } from './world/dzs';

/** Canopy sizes on offer, ft², largest first. Cross-braced ones only come small. */
export const CANOPY_SIZES: Record<CanopyKind, number[]> = {
  classic: [260, 230, 210, 190, 170, 150, 135, 120, 107, 96, 84],
  triCell: [120, 107, 96, 84, 75, 67],
};
export const KIND_NAMES: Record<CanopyKind, string> = { classic: 'classique', triCell: 'tri-cell' };
/** Pilot plus all gear, kg. */
export const WEIGHT_MIN = 50;
export const WEIGHT_MAX = 130;

/** What shows the height: nothing, a dial on the wrist, or digits. */
export type AltimeterKind = 'none' | 'analog' | 'digital';

export interface Gear {
  kind: CanopyKind;
  canopyAreaFt2: number;
  exitWeightKg: number;
  color: CanopyColorId;
  altimeter: AltimeterKind;
  /** An audible altimeter in the helmet, beeping at the circuit heights. */
  audible: boolean;
}

export interface Setup {
  dz: DzId;
  /** Clock time, French summer time, hours. */
  hour: number;
  weather: Weather;
  gear: Gear;
}

export const rigFor = (gear: Gear): RigParams =>
  deriveRig(rigConfig(gear.kind, gear.canopyAreaFt2, gear.exitWeightKg));

/** Whether two gears fly the same: same canopy, same weight. */
export const sameFlight = (a: Gear, b: Gear): boolean =>
  a.kind === b.kind && a.canopyAreaFt2 === b.canopyAreaFt2 && a.exitWeightKg === b.exitWeightKg;

export const nearestSize = (kind: CanopyKind, area: number): number =>
  CANOPY_SIZES[kind].reduce((best, size) => (Math.abs(size - area) < Math.abs(best - area) ? size : best));

export const validWeight = (kg: number): number => Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(kg)));

/** Who usually flies a canopy loaded like this, lb/ft². */
export function loadingLabel(wingLoading: number): string {
  if (wingLoading < 0.8) return 'école';
  if (wingLoading < 1.1) return 'débutant';
  if (wingLoading < 1.35) return 'intermédiaire';
  if (wingLoading < 1.7) return 'confirmé';
  if (wingLoading < 2.1) return 'expert';
  return 'compétition';
}

/** The usual wind of a drop zone, as the weather of a first visit. */
export function usualWeather(dz: DzId, sky: SkyKind = 'clear'): Weather {
  const { wind } = dzInfo(dz).pack();
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
    },
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
  if (oneOf(w.sky, ['clear', 'hazy', 'overcast'] as const)) setup.weather.sky = w.sky;
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

export const cloneSetup = (s: Setup): Setup => ({ ...s, weather: { ...s.weather }, gear: { ...s.gear } });
