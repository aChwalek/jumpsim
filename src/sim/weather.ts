// The weather chosen before a jump: the sky, and the wind the flight model
// flies in. The wind is given as forecasts give it, at 10 m above the ground;
// it is weaker lower down and stronger higher up, and gusts come and go.

import { DEG, set, type Vec3 } from './vec';

export type SkyKind = 'clear' | 'hazy' | 'overcast';
export type GustLevel = 'none' | 'light' | 'strong';

export interface Weather {
  sky: SkyKind;
  /** Where the wind comes from, compass degrees. */
  windFromDeg: number;
  /** Mean wind 10 m above the ground, km/h. */
  windKmh: number;
  gusts: GustLevel;
}

export const WIND_MAX_KMH = 40;

/** How much stronger than the mean wind the strongest gusts blow. */
const GUST_EXCESS: Record<GustLevel, number> = { none: 0, light: 0.35, strong: 0.75 };
/** And how far they swing its direction, degrees. */
const GUST_VEER: Record<GustLevel, number> = { none: 0, light: 10, strong: 20 };

/** Strongest gust, km/h, as a forecast would give it. */
export const gustPeakKmh = (w: Weather): number => Math.round(w.windKmh * (1 + GUST_EXCESS[w.gusts]));

/**
 * Wind speed at a height above the ground as a fraction of the wind at 10 m:
 * the 1/7 power law for open, flat country. About 0.8 at 2 m, 1.4 at 100 m,
 * 1.6 at 300 m.
 */
export function windGradient(heightM: number): number {
  return (Math.max(0.5, heightM) / 10) ** (1 / 7);
}

/** Smooth random value between 0 and 1 that wanders as `t` goes up. */
function wander(t: number): number {
  const hash = (n: number): number => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(t);
  const f = t - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Gust strength at a time, 0 (lull) to 1 (strongest gust): one comes along
 * every half-minute or so, builds up over a few seconds and lasts a few
 * more, with a flutter on top.
 */
export function gustAt(seconds: number): number {
  const swell = smoothstep(0.4, 1, wander(seconds / 8));
  return swell * (0.75 + 0.25 * wander(seconds / 1.6 + 40));
}

/**
 * Velocity of the air (the way it moves) at a height above the ground and a
 * time, m/s, world frame (+X east, -Z north).
 */
export function windAt(out: Vec3, w: Weather, heightM: number, seconds: number): Vec3 {
  const gust = w.gusts === 'none' ? 0 : gustAt(seconds);
  const speed = (w.windKmh / 3.6) * windGradient(heightM) * (1 + GUST_EXCESS[w.gusts] * gust);
  // The gusts veer one way or the other, not always the same.
  const veer = GUST_VEER[w.gusts] * gust * (wander(seconds / 9 + 70) * 2 - 1);
  const to = (w.windFromDeg + 180 + veer) * DEG;
  return set(out, Math.sin(to) * speed, 0, -Math.cos(to) * speed);
}

/** Compass point a wind comes from, in French: N, NNE, NE... */
export function compassPoint(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return points[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}
