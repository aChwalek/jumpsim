// Where the sun is at a given hour, and what light that makes with the sky
// chosen: colours of the sky and the haze, strength of sunlight and skylight,
// how dark the shadows are.

import * as THREE from 'three';
import { T } from '../i18n';
import type { MoonPhase, SkyKind } from '../sim/weather';

const DEG = Math.PI / 180;

/** The jumps happen in the season: early July. */
const DAY_OF_YEAR = 185;
/** French summer time, UTC+2, unless the drop zone keeps another clock. */
const UTC_OFFSET_H = 2;

export interface SunPosition {
  /** Above the horizon, degrees. */
  elevationDeg: number;
  /** Compass bearing, degrees clockwise from north. */
  azimuthDeg: number;
}

/**
 * Position of the sun at a local clock time and place, from NOAA's
 * approximate formulas: good to a fraction of a degree.
 */
export function sunPosition(
  latDeg: number,
  lonDeg: number,
  clockHour: number,
  utcOffsetH = UTC_OFFSET_H,
  dayOfYear = DAY_OF_YEAR,
): SunPosition {
  const utc = clockHour - utcOffsetH;
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

/**
 * Where the moon is on a night with this phase: it trails the sun round the
 * sky by the phase angle (a quarter: 90°, full: 180°, opposite the sun), and
 * rides as high as the sun does at the time of year that far round, so a
 * full moon of July hangs low, like the sun in January. The 5° tilt of its
 * orbit is left out.
 */
export function moonPosition(
  latDeg: number,
  lonDeg: number,
  clockHour: number,
  phase: MoonPhase,
  utcOffsetH = UTC_OFFSET_H,
): SunPosition {
  const angle = MOON_ANGLE[phase] ?? MOON_ANGLE.full;
  // The sky turns 15° an hour, and the sun goes 360° round the year.
  return sunPosition(latDeg, lonDeg, clockHour - angle / 15, utcOffsetH, DAY_OF_YEAR + (angle / 360) * 365.25);
}

/** How far round the sky the moon is from the sun, degrees. */
const MOON_ANGLE: Record<MoonPhase, number> = { new: 0, quarter: 90, full: 180 };

export interface Daylight {
  /**
   * Direction towards the light that casts the shadows: the sun, or the moon
   * once the sun is down. The fields below that say "sun" mean that light.
   */
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
  /** Towards the sun itself, wherever it is, even below the horizon: the sky's glow and the moon's phase. */
  realSun: THREE.Vector3;
  /** Towards the moon. */
  moon: THREE.Vector3;
  /** How bright the moon's disc shows in the sky, 0 when it is not there. */
  moonDisc: number;
  /** How many stars show, 0 to 1. */
  stars: number;
  /** How far the eyes see in the dark, 0 by day, 1 at night: colours go, a cold grey is left. */
  night: number;
  /** Lamps lit in the towns and on the drop zone, 0 to 1. */
  lamps: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SKY: Record<SkyKind, { sun: number; sky: number; skyHex: number; horizon: number; zenith: number; fog: number; shadow: number; disc: number; stars: number }> = {
  clear: { sun: 1, sky: 1, skyHex: 0xdbe8ff, horizon: 0xc4d6e6, zenith: 0x3f7fd0, fog: 0.00011, shadow: 1, disc: 1, stars: 1 },
  // Fair-weather cumulus: full sun between them, a little more light from
  // the sky off their white sides, and the air clear under them.
  cumulus: { sun: 1, sky: 1.12, skyHex: 0xe0eafa, horizon: 0xc8d8e6, zenith: 0x3a7ad0, fog: 0.0001, shadow: 1, disc: 1, stars: 1 },
  // High thin cloud: the sun shows through, softened, and the sky goes milky.
  hazy: { sun: 0.55, sky: 1.2, skyHex: 0xe2e8f0, horizon: 0xd3dbe2, zenith: 0x86a9d2, fog: 0.00022, shadow: 0.5, disc: 0.45, stars: 0.3 },
  // Low grey cloud: no sun, light from everywhere, shadows all but gone.
  overcast: { sun: 0.05, sky: 1.35, skyHex: 0xeef0f2, horizon: 0xb7bdc3, zenith: 0x98a0a8, fog: 0.0003, shadow: 0.12, disc: 0, stars: 0 },
};

const SUN_WHITE = new THREE.Color(0xfff1dc);
const SUN_LOW = new THREE.Color(0xffa860);
const HORIZON_LOW = new THREE.Color(0xe9c39c);
const ZENITH_LOW = new THREE.Color(0x2c5aa0);
const GLOW = new THREE.Color(0xffa65c);
/** The glow left on the horizon once the sun has set, deeper red. */
const GLOW_SET = new THREE.Color(0xd8603c);
/** Sun and sky light the default (clear, mid-morning) scene was tuned with. */
const SUN_INTENSITY = 2.6;
const SKY_INTENSITY = 1.7;
const FABRIC_REFERENCE = new THREE.Color(0xdbe8ff)
  .multiplyScalar(SKY_INTENSITY)
  .add(SUN_WHITE.clone().multiplyScalar(SUN_INTENSITY));

/**
 * The night as eyes used to the dark see it, not as a light meter would: the
 * moon is some 400 000 times dimmer than the sun, which no screen can show.
 * These are what the picture is drawn with, in the units of the day's light.
 * Moonlight on a cloudless night: direct, and off the sky.
 */
const MOON_LIGHT: Record<MoonPhase, number> = { new: 0, quarter: 0.16, full: 0.5 };
const MOON_SKY: Record<MoonPhase, number> = { new: 0, quarter: 0.045, full: 0.12 };
/** How dark a moon's shadows are against its skylight. */
const MOON_SHADOW: Record<MoonPhase, number> = { new: 0, quarter: 0.45, full: 0.8 };
/** How bright its disc is, and how much it drowns the stars. */
const MOON_DISC: Record<MoonPhase, number> = { new: 0, quarter: 0.7, full: 1 };
/** Starlight and the glow of the towns far off, with no moon: just enough to make out the ground's shapes. */
const STARLIGHT = 0.065;
const MOON_COLOR = new THREE.Color(0xc4d2ee);
const NIGHT_SKY = new THREE.Color(0x8796c0);
/** The sky after sunset, before it goes dark, and at night with and without a moon. */
const TWILIGHT_HORIZON = new THREE.Color(0x8c90a8);
const TWILIGHT_ZENITH = new THREE.Color(0x24427c);
const NIGHT_HORIZON = new THREE.Color(0x121a2a);
const NIGHT_ZENITH = new THREE.Color(0x05080f);
const MOONLIT_HORIZON = new THREE.Color(0x2a3954);
const MOONLIT_ZENITH = new THREE.Color(0x0d1830);

/**
 * The light of a sun at this position under this sky, and once it is down,
 * of the moon there with this phase.
 */
export function daylight(p: SunPosition, sky: SkyKind, moon?: { position: SunPosition; phase: MoonPhase }): Daylight {
  const s = SKY[sky];
  const el = p.elevationDeg;
  // How low and warm the sun is: 0 from 25 degrees up, 1 on the horizon.
  const low = 1 - smoothstep(3, 25, el);
  const up = smoothstep(-1, 12, el);
  const realSun = sunVector(p);
  const sunColor = SUN_WHITE.clone().lerp(SUN_LOW, low);
  const sunIntensity = SUN_INTENSITY * s.sun * up * (1 - 0.3 * low);
  // The sky goes on lighting the ground after sunset, less and less through
  // twilight, until the sun is some 10 degrees down.
  const twilight = smoothstep(-10, 0, el) ** 1.5;
  const skyColor = new THREE.Color(s.skyHex);
  let skyIntensity = SKY_INTENSITY * s.sky * (0.45 + 0.55 * smoothstep(0, 25, el)) * twilight;

  // The moon, and the stars: they count once the sky has gone dark enough.
  // A room's player on an older version sends no moon.
  const phase: MoonPhase = moon && moon.phase in MOON_LIGHT ? moon.phase : 'new';
  const moonDir = moon ? sunVector(moon.position) : new THREE.Vector3(0, -1, 0);
  const moonEl = moon?.position.elevationDeg ?? -90;
  const dark = 1 - twilight;
  const moonUp = smoothstep(-1, 10, moonEl);
  const moonIntensity = MOON_LIGHT[phase] * moonUp * s.sun * dark;
  // A cloud deck spreads the moonlight about rather than taking it away.
  const nightSky = (STARLIGHT + MOON_SKY[phase] * smoothstep(-3, 15, moonEl) * (sky === 'overcast' ? 1.6 : 1)) * dark;
  skyColor.lerp(NIGHT_SKY, nightSky / (skyIntensity + nightSky));
  skyIntensity += nightSky * s.sky;

  // The light that casts the shadows: the sun, or the moon once it outshines the sun.
  const byMoon = moonIntensity > sunIntensity;
  const key = byMoon ? moonDir.clone() : realSun.clone();
  const keyColor = byMoon ? MOON_COLOR.clone() : sunColor;
  const keyIntensity = byMoon ? moonIntensity : sunIntensity;
  const shadow = byMoon ? s.shadow * MOON_SHADOW[phase] * smoothstep(0, 10, moonEl) : s.shadow * smoothstep(0, 10, el);

  // Clouds hide the colours of a low sun.
  const tint = low * s.disc;
  const dayHorizon = new THREE.Color(s.horizon).lerp(HORIZON_LOW, 0.55 * tint);
  const dayZenith = new THREE.Color(s.zenith).lerp(ZENITH_LOW, 0.6 * tint);
  // Day, then twilight, then night, with the moon lightening it.
  const moonlit = MOON_DISC[phase] * smoothstep(-5, 20, moonEl) * (0.4 + 0.6 * s.disc);
  const nightHorizon = NIGHT_HORIZON.clone().lerp(MOONLIT_HORIZON, moonlit);
  const nightZenith = NIGHT_ZENITH.clone().lerp(MOONLIT_ZENITH, moonlit);
  // Under cloud the night sky is a flat dark grey.
  if (sky === 'overcast' || sky === 'hazy') {
    const grey = sky === 'overcast' ? 1 : 0.5;
    nightHorizon.lerp(new THREE.Color(0x1c1f25).lerp(new THREE.Color(0x343a44), moonlit), grey);
    nightZenith.lerp(new THREE.Color(0x111318).lerp(new THREE.Color(0x262b33), moonlit), grey);
  }
  const toTwilight = 1 - smoothstep(-4, 6, el);
  const toNight = 1 - smoothstep(-13, -3, el);
  const horizon = dayHorizon.lerp(TWILIGHT_HORIZON.clone().lerp(new THREE.Color(s.horizon).multiplyScalar(0.55), 1 - s.disc), toTwilight * 0.8).lerp(nightHorizon, toNight);
  const zenith = dayZenith.lerp(TWILIGHT_ZENITH, toTwilight * 0.85).lerp(nightZenith, toNight);

  const ground = skyColor
    .clone()
    .multiplyScalar(skyIntensity)
    .add(keyColor.clone().multiplyScalar(keyIntensity * Math.max(0, key.y)))
    .multiplyScalar(1 / Math.PI);
  const skylight = skyColor.clone().multiplyScalar(skyIntensity);
  const groundShade = skylight.clone().multiplyScalar(1 / Math.PI);
  // Fabric lit through is never darker than 0.3 by day; at night it is as dark as the night.
  const floor = 0.3 * smoothstep(-8, 2, el);
  /** Brightness of fabric under this light, against the reference. */
  const onFabric = (light: THREE.Color): THREE.Color =>
    light.setRGB(
      Math.min(1, Math.max(floor, light.r / FABRIC_REFERENCE.r)),
      Math.min(1, Math.max(floor, light.g / FABRIC_REFERENCE.g)),
      Math.min(1, Math.max(floor, light.b / FABRIC_REFERENCE.b)),
    );
  // A low moon shines through little fabric: seen from under it, a canopy at night is mostly a dark shape.
  const throughFabric = byMoon ? keyIntensity * Math.max(0, key.y) : keyIntensity;
  const fabric = onFabric(skylight.clone().add(keyColor.clone().multiplyScalar(throughFabric)));
  const fabricShade = onFabric(skylight.clone());
  const setGlow = smoothstep(-8, -1, el);
  return {
    sun: key,
    sunColor: keyColor,
    sunIntensity: keyIntensity,
    skyColor,
    skyIntensity,
    horizon,
    zenith,
    glow: GLOW.clone().lerp(GLOW_SET, 1 - smoothstep(-6, 1, el)),
    glowStrength: 0.75 * tint * setGlow,
    disc: s.disc * up,
    fogDensity: s.fog,
    // Long shadows of a sun on the horizon are faint against the skylight.
    shadow,
    ground,
    fabric,
    groundShade,
    fabricShade,
    clouds: sky === 'cumulus',
    // White in full sun, grey-blue in their own shade.
    cloudSun: keyColor.clone().multiplyScalar((0.8 * keyIntensity) / SUN_INTENSITY),
    cloudShade: skyColor.clone().multiplyScalar((0.55 * skyIntensity) / SKY_INTENSITY),
    realSun,
    moon: moonDir,
    // A pale disc by day, bright at night.
    moonDisc: MOON_DISC[phase] * (0.35 + 1.25 * dark) * (0.15 + 0.85 * s.disc) * smoothstep(-1, 1, moonEl),
    // A moon well up drowns all but the brightest.
    stars: s.stars * (1 - smoothstep(-14, -6, el)) * (1 - 0.7 * MOON_DISC[phase] * smoothstep(-3, 12, moonEl)),
    night: 1 - smoothstep(-9, -1, el),
    lamps: 1 - smoothstep(-5, 2, el),
  };
}

/** Hours on offer: the whole day and night, by quarters, from 0:00 to 23:45. */
export const HOUR_MIN = 0;
export const HOUR_MAX = 23.75;

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return T.hour(h, String(m).padStart(2, '0'));
}
