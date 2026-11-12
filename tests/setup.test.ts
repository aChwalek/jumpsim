import { expect, test } from 'vitest';
import { Altisonic, CANOPY_ALARMS } from '../src/audio/altisonic';
import { daylight, sunPosition } from '../src/render/daylight';
import { defaultSetup, runHeading, validSetup } from '../src/setup';
import { FlightModel, calmAir, neutralControls } from '../src/sim/flightModel';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT, emptyTelemetry, initTrimmed, readTelemetry } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { gustAt, gustPeakKmh, windAt, windGradient, type Weather } from '../src/sim/weather';
import { createValbrise, runLeadIn, spawnsFor } from '../src/world/dz';

const calm: Weather = { sky: 'clear', windFromDeg: 270, windKmh: 18, gusts: 'none' };

test('the wind given is the wind at 10 m: weaker below, stronger above', () => {
  expect(windGradient(10)).toBeCloseTo(1, 6);
  expect(windGradient(2)).toBeGreaterThan(0.75);
  expect(windGradient(2)).toBeLessThan(0.85);
  expect(windGradient(300)).toBeGreaterThan(1.55);
  expect(windGradient(300)).toBeLessThan(1.7);
  const w = windAt(vec3(), calm, 10, 0);
  // From the west, the air goes east (+X).
  expect(w.x).toBeCloseTo(18 / 3.6, 6);
  expect(w.z).toBeCloseTo(0, 6);
  const north = windAt(vec3(), { ...calm, windFromDeg: 0 }, 10, 0);
  // From the north, the air goes south (+Z).
  expect(north.z).toBeCloseTo(18 / 3.6, 6);
});

test('gusts come and go, up to the peak given and never below the mean wind', () => {
  const strong: Weather = { ...calm, gusts: 'strong' };
  const mean = 18 / 3.6;
  const peak = gustPeakKmh(strong) / 3.6;
  let top = 0;
  let calmTime = 0;
  const seconds = 1200;
  for (let t = 0; t < seconds; t += 0.25) {
    const w = windAt(vec3(), strong, 10, t);
    const speed = Math.hypot(w.x, w.z);
    expect(speed).toBeGreaterThanOrEqual(mean - 1e-9);
    expect(speed).toBeLessThanOrEqual(peak + 0.05);
    top = Math.max(top, speed);
    if (gustAt(t) < 0.05) calmTime += 0.25;
  }
  expect(top).toBeGreaterThan(mean + 0.8 * (peak - mean));
  // Most of the time there is no gust at all.
  expect(calmTime / seconds).toBeGreaterThan(0.3);
  expect(calmTime / seconds).toBeLessThan(0.8);
});

test('the sun rises in the east, peaks in the south at 13h45 summer time in Provence, sets in the west', () => {
  const lat = 43.99;
  const lon = 4.76;
  const morning = sunPosition(lat, lon, 7);
  const noon = sunPosition(lat, lon, 13.75);
  const evening = sunPosition(lat, lon, 21);
  expect(morning.elevationDeg).toBeGreaterThan(5);
  expect(morning.azimuthDeg).toBeGreaterThan(60);
  expect(morning.azimuthDeg).toBeLessThan(90);
  // 90 - 44 + 22.9 degrees of declination in early July.
  expect(noon.elevationDeg).toBeCloseTo(69, 0);
  expect(Math.abs(noon.azimuthDeg - 180)).toBeLessThan(3);
  expect(evening.elevationDeg).toBeGreaterThan(0);
  expect(evening.elevationDeg).toBeLessThan(8);
  expect(evening.azimuthDeg).toBeGreaterThan(290);
});

test('clouds take the shadows away; a clear sky leaves them and the full light', () => {
  const mid = sunPosition(44, 4.8, 11);
  const clear = daylight(mid, 'clear');
  expect(clear.shadow).toBeCloseTo(1, 6);
  expect(clear.fabric.r).toBeCloseTo(1, 2);
  expect(daylight(mid, 'hazy').shadow).toBeLessThan(0.6);
  expect(daylight(mid, 'overcast').shadow).toBeLessThan(0.15);
  const dusk = daylight(sunPosition(44, 4.8, 21), 'clear');
  expect(dusk.sunIntensity).toBeLessThan(clear.sunIntensity / 2);
  expect(dusk.glowStrength).toBeGreaterThan(0.3);
});

test('the starts are placed with the wind', () => {
  const dz = createValbrise();
  // With the usual westerly they are where they always were.
  const west = spawnsFor(dz, 270);
  expect(west.pattern.x).toBeCloseTo(-180, 6);
  expect(west.pattern.z).toBeCloseTo(160, 6);
  expect(west.pattern.headingDeg).toBe(90);
  expect(west.final.x).toBeCloseTo(260, 6);
  expect(west.final.z).toBeCloseTo(0, 6);
  expect(west.final.headingDeg).toBe(270);
  // A northerly: final comes in from the south, heading north.
  const north = spawnsFor(dz, 0);
  expect(north.final.x).toBeCloseTo(0, 6);
  expect(north.final.z).toBeCloseTo(260, 6);
  expect(north.final.headingDeg).toBe(0);
  // Downwind leg flown south, upwind of the target, on the same (left-hand) side.
  expect(north.pattern.headingDeg).toBe(180);
  expect(north.pattern.z).toBeCloseTo(-180, 6);
  expect(north.pattern.x).toBeCloseTo(-160, 6);
});

test('jump run goes into the wind by default, or on the heading chosen, beside the target', () => {
  const dz = createValbrise();
  // Westerly: the run heads west from 500 m east of the target, the target 60 m off the Porter's right door.
  const west = spawnsFor(dz, 270).plane;
  expect(west.headingDeg).toBe(270);
  expect(west.x).toBeCloseTo(500, 6);
  expect(west.z).toBeCloseTo(60, 6);
  expect(west.height).toBe(4000);
  // Heading north across a westerly at 1500 m: it starts south of the target, the target on the right.
  const north = spawnsFor(dz, 270, { headingDeg: 0, height: 1500 }).plane;
  expect(north.headingDeg).toBe(0);
  expect(north.height).toBe(1500);
  expect(north.x).toBeCloseTo(-60, 6);
  expect(north.z).toBeCloseTo(500, 6);
  // Downwind the run starts further out: the jumpers go before the target and drift back.
  expect(runLeadIn(500, 90, 270)).toBeCloseTo(1500, 6);
  expect(runLeadIn(500, 0, 270)).toBeCloseTo(500, 6);
  const tail = spawnsFor(dz, 270, { headingDeg: 90 }).plane;
  expect(tail.x).toBeCloseTo(-1500, 6);
  // The Dornier's door is on the left: the run passes the target the other way round.
  const dornier = spawnsFor({ ...dz, jumpRun: { ...dz.jumpRun, aircraft: 'do28' } }, 270).plane;
  expect(dornier.aircraft).toBe('do28');
  expect(dornier.z).toBeCloseTo(-60, 6);
});

test('the jump plan is checked when read back, and the run follows the wind until a heading is chosen', () => {
  const setup = validSetup({ jump: { start: 'final', exitHeight: 9000, runDeg: -45 } });
  expect(setup.jump).toEqual({ start: 'final', exitHeight: 4500, runDeg: 315, malfunction: 'none' });
  expect(validSetup({ jump: { start: 'moon', exitHeight: 1234, malfunction: 'often' } }).jump).toEqual({
    start: 'plane',
    exitHeight: 1200,
    runDeg: null,
    malfunction: 'none',
  });
  expect(validSetup({ jump: { malfunction: 'always' } }).jump.malfunction).toBe('always');
  const plan = defaultSetup();
  plan.weather.windFromDeg = 200;
  expect(runHeading(plan)).toBe(200);
  plan.jump.runDeg = 120;
  expect(runHeading(plan)).toBe(120);
});

test('slider and RSL are read back, old setups get a collapsible slider and an RSL', () => {
  expect(validSetup({}).gear).toMatchObject({ slider: 'collapsible', rsl: true });
  expect(validSetup({ gear: { slider: 'removable', rsl: false } }).gear).toMatchObject({ slider: 'removable', rsl: false });
  expect(validSetup({ gear: { slider: 'velcro', rsl: 'yes' } }).gear).toMatchObject({ slider: 'collapsible', rsl: true });
});

test('the audible altimeter sounds each circuit height once on the way down', () => {
  const alti = new Altisonic();
  alti.reset(1000);
  const heard: number[] = [];
  for (let h = 1000; h > 0; h -= 0.5) {
    const beeps = alti.update(h);
    if (beeps) heard.push(beeps.count);
  }
  expect(heard).toEqual(CANOPY_ALARMS.map((a) => a.beeps.count));
  // Started at 300 m, it does not go off straight away.
  alti.reset(300);
  expect(alti.update(299)).toBeNull();
  expect(alti.update(199)?.count).toBe(2);
  // Through two heights in one go, only the lower one sounds.
  alti.reset(500);
  expect(alti.update(150)?.count).toBe(2);
  expect(alti.update(150)).toBeNull();
});

test('a saved setup is checked, and the gear of the old menu is kept', () => {
  expect(validSetup({ dz: 'nowhere', hour: 99, weather: { windKmh: -5 }, gear: { kind: 'x' } })).toEqual({
    ...defaultSetup(),
    hour: 21,
    weather: { ...defaultSetup().weather, windKmh: 0 },
  });
  const old = validSetup({ gear: { kind: 'triCell', canopyAreaFt2: 100, exitWeightKg: 300 } });
  expect(old.gear).toMatchObject({ kind: 'triCell', canopyAreaFt2: 96, exitWeightKg: 130, color: 'red' });
});

test('strong gusts and the wind gradient shake the canopy but do not upset it', () => {
  const model = new FlightModel(deriveRig(DEFAULT_RIG));
  const env = calmAir();
  const gusty: Weather = { sky: 'clear', windFromDeg: 0, windKmh: 30, gusts: 'strong' };
  windAt(env.wind, gusty, 1000, 0);
  initTrimmed(model, vec3(0, 1000, 0), 0, env);
  const tel = emptyTelemetry();
  const trimPitch = readTelemetry(model, env, tel).pitchDeg;
  const hands = neutralControls();
  let worstBank = 0;
  let worstPitch = 0;
  for (let t = 0; t < 150; t += SIM_DT) {
    windAt(env.wind, gusty, model.state.pos.y, t);
    model.step(SIM_DT, hands, env);
    readTelemetry(model, env, tel);
    worstBank = Math.max(worstBank, Math.abs(tel.bankDeg));
    worstPitch = Math.max(worstPitch, Math.abs(tel.pitchDeg - trimPitch));
  }
  expect(Number.isFinite(model.state.pos.y)).toBe(true);
  // 30 km/h gusting to 52: the canopy surges back and forth some 15 degrees
  // as a gust builds and dies, and rocks a little.
  expect(worstBank).toBeLessThan(10);
  expect(worstPitch).toBeLessThan(20);
});
