// Where the sun is at a given hour, and what light that makes with the sky
// chosen: colours of the sky and the haze, strength of sunlight and skylight,
// how dark the shadows are.

import * as THREE from 'three';
import type { SkyKind } from '../sim/weather';

const DEG = Math.PI / 180;

/** The jumps happen in the season: early July. */
const DAY_OF_YEAR = 185;
/** French summer time, UTC+2. */
const UTC_OFFSET_H = 2;

export interface SunPosition {
  /** Above the horizon, degrees. */
  elevationDeg: number;
  /** Compass bearing, degrees clockwise from north. */
  azimuthDeg: number;
}

/**
 * Position of the sun at a clock time (French summer time) and place, from
 * NOAA's approximate formulas: good to a fraction of a degree.
 */
export function sunPosition(latDeg: number, lonDeg: number, clockHour: number, dayOfYear = DAY_OF_YEAR): SunPosition {
  const utc = clockHour - UTC_OFFSET_H;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utc - 12) / 24);
  const eqTimeMin =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const solarMin = utc * 60 + eqTimeMin + 4 * lonDeg;
  const hourAngle = (solarMin / 4 - 180) * DEG;
  const lat = latDeg * DEG;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const fromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  );
  return { elevationDeg: Math.asin(sinEl) / DEG, azimuthDeg: (fromSouth / DEG + 180 + 360) % 360 };
}

/** Unit vector towards the sun in world axes (+X east, -Z north, +Y up). */
export function sunVector(p: SunPosition, out = new THREE.Vector3()): THREE.Vector3 {
  const el = p.elevationDeg * DEG;
  const az = p.azimuthDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export interface Daylight {
  /** Direction towards the sun. */
  sun: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** Light from the whole sky, from above. */
  skyColor: THREE.Color;
  skyIntensity: number;
  /** Colour of the sky low down and of the haze, which water mirrors. */
  horizon: THREE.Color;
  zenith: THREE.Color;
  /** Warm band along the horizon on the sun's side when it is low, and how strong. */
  glow: THREE.Color;
  glowStrength: number;
  /** How much of the sun's disc shows through: 1 clear, 0 behind cloud. */
  disc: number;
  fogDensity: number;
  /** Darkness of cast shadows, 1 in full sun, near 0 under cloud. */
  shadow: number;
  /** What flat ground sends back of its own colour, for things drawn without the lights. */
  ground: THREE.Color;
  /** Brightness of thin fabric drawn without the lights (canopy, flags), 1 in full sun. */
  fabric: THREE.Color;
  /** The same two in the shadow of a cloud, with only the skylight. */
  groundShade: THREE.Color;
  fabricShade: THREE.Color;
  /** Cumulus in the sky. */
  clouds: boolean;
  /** Sunlight and skylight on the clouds, as drawn. */
  cloudSun: THREE.Color;
  cloudShade: THREE.Color;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SKY: Record<SkyKind, { sun: number; sky: number; skyHex: number; horizon: number; zenith: number; fog: number; shadow: number; disc: number }> = {
  clear: { sun: 1, sky: 1, skyHex: 0xdbe8ff, horizon: 0xc4d6e6, zenith: 0x3f7fd0, fog: 0.00011, shadow: 1, disc: 1 },
  // Fair-weather cumulus: full sun between them, a little more light from
  // the sky off their white sides, and the air clear under them.
  cumulus: { sun: 1, sky: 1.12, skyHex: 0xe0eafa, horizon: 0xc8d8e6, zenith: 0x3a7ad0, fog: 0.0001, shadow: 1, disc: 1 },
  // High thin cloud: the sun shows through, softened, and the sky goes milky.
  hazy: { sun: 0.55, sky: 1.2, skyHex: 0xe2e8f0, horizon: 0xd3dbe2, zenith: 0x86a9d2, fog: 0.00022, shadow: 0.5, disc: 0.45 },
  // Low grey cloud: no sun, light from everywhere, shadows all but gone.
  overcast: { sun: 0.05, sky: 1.35, skyHex: 0xeef0f2, horizon: 0xb7bdc3, zenith: 0x98a0a8, fog: 0.0003, shadow: 0.12, disc: 0 },
};

const SUN_WHITE = new THREE.Color(0xfff1dc);
const SUN_LOW = new THREE.Color(0xffa860);
const HORIZON_LOW = new THREE.Color(0xe9c39c);
const ZENITH_LOW = new THREE.Color(0x2c5aa0);
const GLOW = new THREE.Color(0xffa65c);
/** Sun and sky light the default (clear, mid-morning) scene was tuned with. */
const SUN_INTENSITY = 2.6;
const SKY_INTENSITY = 1.7;
const FABRIC_REFERENCE = new THREE.Color(0xdbe8ff)
  .multiplyScalar(SKY_INTENSITY)
  .add(SUN_WHITE.clone().multiplyScalar(SUN_INTENSITY));

/** The light of a sun at this position under this sky. */
export function daylight(p: SunPosition, sky: SkyKind): Daylight {
  const s = SKY[sky];
  const el = p.elevationDeg;
  // How low and warm the sun is: 0 from 25 degrees up, 1 on the horizon.
  const low = 1 - smoothstep(3, 25, el);
  const up = smoothstep(-1, 12, el);
  const sun = sunVector(p);
  const sunColor = SUN_WHITE.clone().lerp(SUN_LOW, low);
  const sunIntensity = SUN_INTENSITY * s.sun * up * (1 - 0.3 * low);
  const skyColor = new THREE.Color(s.skyHex);
  const skyIntensity = SKY_INTENSITY * s.sky * (0.45 + 0.55 * smoothstep(0, 25, el));
  // Clouds hide the colours of a low sun.
  const tint = low * s.disc;
  const horizon = new THREE.Color(s.horizon).lerp(HORIZON_LOW, 0.55 * tint);
  const zenith = new THREE.Color(s.zenith).lerp(ZENITH_LOW, 0.6 * tint);
  const ground = skyColor
    .clone()
    .multiplyScalar(skyIntensity)
    .add(sunColor.clone().multiplyScalar(sunIntensity * Math.max(0, sun.y)))
    .multiplyScalar(1 / Math.PI);
  const skylight = skyColor.clone().multiplyScalar(skyIntensity);
  const groundShade = skylight.clone().multiplyScalar(1 / Math.PI);
  /** Brightness of fabric under this light, against the reference. */
  const onFabric = (light: THREE.Color): THREE.Color =>
    light.setRGB(
      Math.min(1, Math.max(0.3, light.r / FABRIC_REFERENCE.r)),
      Math.min(1, Math.max(0.3, light.g / FABRIC_REFERENCE.g)),
      Math.min(1, Math.max(0.3, light.b / FABRIC_REFERENCE.b)),
    );
  const fabric = onFabric(skylight.clone().add(sunColor.clone().multiplyScalar(sunIntensity)));
  const fabricShade = onFabric(skylight.clone());
  return {
    sun,
    sunColor,
    sunIntensity,
    skyColor,
    skyIntensity,
    horizon,
    zenith,
    glow: GLOW.clone(),
    glowStrength: 0.75 * tint,
    disc: s.disc * up,
    fogDensity: s.fog,
    // Long shadows of a sun on the horizon are faint against the skylight.
    shadow: s.shadow * smoothstep(0, 10, el),
    ground,
    fabric,
    groundShade,
    fabricShade,
    clouds: sky === 'cumulus',
    // White in full sun, grey-blue in their own shade.
    cloudSun: sunColor.clone().multiplyScalar((0.8 * sunIntensity) / SUN_INTENSITY),
    cloudShade: skyColor.clone().multiplyScalar((0.55 * skyIntensity) / SKY_INTENSITY),
  };
}

/** Earliest and latest hours on offer: the sun is up, if low, at both ends in July. */
export const HOUR_MIN = 7;
export const HOUR_MAX = 21;

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}
