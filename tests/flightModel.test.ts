import { describe, expect, test } from 'vitest';
import { BRAKE_DEEP, FlightModel, calmAir, neutralControls, type Controls } from '../src/sim/flightModel';
import { DEFAULT_RIG, deriveRig, rigConfig, type CanopyKind, type RigConfig } from '../src/sim/rig';
import { SIM_DT, emptyTelemetry, initTrimmed, readTelemetry, simulate } from '../src/sim/telemetry';
import { CANOPY_SIZES, WEIGHT_MAX, WEIGHT_MIN } from '../src/setup';
import { DEG, rotate, vec3 } from '../src/sim/vec';

const env = calmAir();

function trimmed(cfg: Partial<RigConfig> = {}, headingDeg = 0, e = env): FlightModel {
  const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, ...cfg }));
  initTrimmed(model, vec3(0, 3000, 0), headingDeg, e);
  return model;
}

const controls = (c: Partial<Controls>): Controls => ({ ...neutralControls(), ...c });

/** Steady state after holding the controls for a while. */
function steady(c: Partial<Controls> = {}, cfg: Partial<RigConfig> = {}) {
  const model = trimmed(cfg);
  simulate(model, 25, controls(c), env);
  const { vel } = model.state;
  const forward = Math.hypot(vel.x, vel.z);
  return { forward, sink: -vel.y, glide: forward / -vel.y, alphaDeg: model.alphaCentre / DEG };
}

/** Hold the controls and report how the turn developed. */
function turn(c: Partial<Controls>, seconds: number, cfg: Partial<RigConfig> = {}) {
  const model = trimmed(cfg);
  const tel = emptyTelemetry();
  let turned = 0;
  let previous = 0;
  for (let i = 0; i < seconds * 10; i++) {
    simulate(model, 0.1, controls(c), env);
    readTelemetry(model, env, tel);
    let d = tel.headingDeg - previous;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    turned += d;
    previous = tel.headingDeg;
  }
  // How far the pilot-to-canopy axis leans from the vertical.
  const lines = Math.acos(Math.cos(tel.bankDeg * DEG) * Math.cos(tel.pitchDeg * DEG)) / DEG;
  return { turned, bank: tel.bankDeg, lines, sink: -model.state.vel.y, x: model.state.pos.x };
}

/** Height lost by the time the held controls have turned the canopy through `degrees`. */
function heightLost(c: Partial<Controls>, degrees: number) {
  const model = trimmed();
  const tel = emptyTelemetry();
  const start = model.state.pos.y;
  let turned = 0;
  let previous = 0;
  for (let i = 0; i < 600 && Math.abs(turned) < degrees; i++) {
    simulate(model, 0.1, controls(c), env);
    readTelemetry(model, env, tel);
    let d = tel.headingDeg - previous;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    turned += d;
    previous = tel.headingDeg;
  }
  return start - model.state.pos.y;
}

/** Hold the controls through a turn of `degrees`, let go, and watch the next 3 s. */
function released(c: Partial<Controls>, degrees: number) {
  const model = trimmed();
  const tel = emptyTelemetry();
  const held = controls(c);
  const none = neutralControls();
  let turned = 0;
  let previous = 0;
  let letGo = -1;
  let atLetGo = 0;
  let before = 0;
  for (let i = 0; letGo < 0 || i < letGo + 30; i++) {
    if (letGo < 0 && (turned >= degrees || i > 600)) {
      letGo = i;
      atLetGo = turned;
    }
    simulate(model, 0.1, letGo < 0 ? held : none, env);
    readTelemetry(model, env, tel);
    let d = tel.headingDeg - previous;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    turned += d;
    previous = tel.headingDeg;
    if (letGo >= 0 && i === letGo + 24) before = turned;
  }
  // Turn rate over the last half second, degrees per second.
  return { overshoot: turned - atLetGo, rate: (turned - before) / 0.5 };
}

describe('steady flight', () => {
  test('a 170 at 90 kg flies like a sport canopy', () => {
    const s = steady();
    expect(s.forward).toBeGreaterThan(11);
    expect(s.forward).toBeLessThan(15);
    expect(s.sink).toBeGreaterThan(4);
    expect(s.sink).toBeLessThan(6);
    expect(s.glide).toBeGreaterThan(2.2);
    expect(s.glide).toBeLessThan(3);
  });

  test('hands up, it flies straight and stays trimmed', () => {
    const model = trimmed({}, 90);
    const before = { ...model.state.vel };
    simulate(model, 30, neutralControls(), env);
    expect(model.state.vel.x).toBeCloseTo(before.x, 2);
    expect(model.state.vel.y).toBeCloseTo(before.y, 2);
    expect(Math.abs(model.state.vel.z)).toBeLessThan(0.01);
    expect(model.state.pos.x).toBeGreaterThan(300); // heading 90 is east, +X
  });

  test('speed scales with the square root of wing loading', () => {
    const light = steady({}, { exitWeightKg: 75 });
    const heavy = steady({}, { exitWeightKg: 105 });
    expect(heavy.forward / light.forward).toBeCloseTo(Math.sqrt(105 / 75), 1);
    expect(heavy.glide).toBeCloseTo(light.glide, 1);
  });

  test('a smaller canopy is faster and sinks faster', () => {
    const small = steady({}, { canopyAreaFt2: 120 });
    const big = steady({}, { canopyAreaFt2: 230 });
    expect(small.forward).toBeGreaterThan(big.forward + 2);
    expect(small.sink).toBeGreaterThan(big.sink + 1);
  });

  test('brakes slow the canopy progressively without stalling it', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map((b) => steady({ brakeL: b, brakeR: b }));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.forward).toBeLessThan(levels[i - 1]!.forward - 0.5);
      expect(levels[i]!.glide).toBeLessThan(levels[i - 1]!.glide);
    }
    const full = levels[4]!;
    expect(full.forward).toBeLessThan(8);
    expect(full.sink).toBeLessThan(levels[0]!.sink);
    expect(full.alphaDeg).toBeLessThan(17);
  });

  test('wraps past full brakes stall the canopy, progressively', () => {
    const full = steady({ brakeL: 1, brakeR: 1 });
    const first = steady({ brakeL: 1.05, brakeR: 1.05 });
    const deep = steady({ brakeL: BRAKE_DEEP, brakeR: BRAKE_DEEP });
    // The first wraps take up stretch: still flying.
    expect(first.alphaDeg).toBeLessThan(17);
    // All the way: the wing is well past the stall, barely going forward and sinking fast.
    expect(deep.alphaDeg).toBeGreaterThan(40);
    expect(deep.forward).toBeLessThan(full.forward / 2);
    expect(deep.sink).toBeGreaterThan(full.sink + 2.5);
  });

  test('letting the toggles up recovers a stall, with a dive', () => {
    const model = trimmed({}, 0, env);
    simulate(model, 8, controls({ brakeL: BRAKE_DEEP, brakeR: BRAKE_DEEP }), env);
    const tel = emptyTelemetry();
    let lowest = 0;
    for (let t = 0; t < 600; t++) {
      simulate(model, 0.01, neutralControls(), env);
      lowest = Math.min(lowest, readTelemetry(model, env, tel).pitchDeg);
    }
    expect(lowest).toBeLessThan(-30);
    expect(model.alphaCentre / DEG).toBeLessThan(12);
    expect(Math.hypot(model.state.vel.x, model.state.vel.z)).toBeGreaterThan(12);
  });

  test('front risers dive: faster, steeper', () => {
    const base = steady();
    const dive = steady({ frontL: 1, frontR: 1 });
    expect(dive.forward).toBeGreaterThan(base.forward + 1.5);
    expect(dive.sink).toBeGreaterThan(base.sink + 3);
    expect(dive.glide).toBeLessThan(base.glide - 0.5);
  });

  test('wind moves the ground track, not the airspeed', () => {
    const windy = { ...calmAir(), wind: vec3(0, 0, 5) }; // blowing south: headwind when flying north
    const model = trimmed({}, 0, windy);
    const tel = readTelemetry(model, windy, emptyTelemetry());
    const calm = readTelemetry(trimmed(), env, emptyTelemetry());
    expect(tel.airspeed).toBeCloseTo(calm.airspeed, 5);
    expect(tel.groundSpeed).toBeCloseTo(calm.groundSpeed - 5, 5);
    simulate(model, 10, neutralControls(), windy);
    readTelemetry(model, windy, tel);
    expect(tel.groundSpeed).toBeCloseTo(calm.groundSpeed - 5, 1);
  });
});

describe('turns', () => {
  test('a toggle turns, banks and dives towards its side', () => {
    const right = turn({ brakeR: 0.6 }, 4);
    expect(right.turned).toBeGreaterThan(90);
    expect(right.turned).toBeLessThan(260);
    expect(right.bank).toBeGreaterThan(20);
    expect(right.sink).toBeGreaterThan(steady().sink + 2);
  });

  test('left and right are mirror images', () => {
    const right = turn({ brakeR: 0.5 }, 3);
    const left = turn({ brakeL: 0.5 }, 3);
    expect(left.turned).toBeCloseTo(-right.turned, 3);
    expect(left.bank).toBeCloseTo(-right.bank, 3);
    expect(left.x).toBeCloseTo(-right.x, 3);
  });

  test('more toggle turns faster', () => {
    const gentle = turn({ brakeR: 0.3 }, 3).turned;
    const medium = turn({ brakeR: 0.6 }, 3).turned;
    const hard = turn({ brakeR: 1 }, 3).turned;
    expect(gentle).toBeGreaterThan(30);
    expect(medium).toBeGreaterThan(gentle * 1.4);
    expect(hard).toBeGreaterThan(medium * 1.2);
  });

  test('a held toggle winds up into a steep spiral', () => {
    const spiral = turn({ brakeR: 1 }, 6);
    expect(spiral.turned).toBeGreaterThan(400);
    expect(spiral.lines).toBeGreaterThan(60);
    expect(spiral.sink).toBeGreaterThan(14);
    expect(turn({ brakeR: 1 }, 12).lines).toBeGreaterThan(60);
  });

  test('two buried-toggle 360s cannot be flown from 100 m', () => {
    // The pull-out takes another 20 m at the very least.
    const two = heightLost({ brakeR: 1 }, 720);
    expect(two).toBeGreaterThan(82);
    expect(two).toBeLessThan(110);
    expect(heightLost({ brakeR: 1 }, 360)).toBeLessThan(55);
  });

  test('the turn stops soon after the toggle goes back up', () => {
    const full = released({ brakeR: 1 }, 360);
    expect(full.overshoot).toBeLessThan(100);
    expect(Math.abs(full.rate)).toBeLessThan(10);
    const half = released({ brakeR: 0.5 }, 180);
    expect(half.overshoot).toBeLessThan(70);
    expect(Math.abs(half.rate)).toBeLessThan(10);
    expect(released({ brakeR: 0.3 }, 45).overshoot).toBeLessThan(25);
  });

  test('a front riser carves a diving turn towards its side', () => {
    const right = turn({ frontR: 1 }, 4);
    expect(right.turned).toBeGreaterThan(70);
    expect(right.sink).toBeGreaterThan(steady().sink + 6);
    expect(turn({ frontL: 1 }, 4).turned).toBeCloseTo(-right.turned, 3);
  });
});

describe('flare', () => {
  function flare(rampSeconds: number, holdSeconds: number) {
    const model = trimmed();
    const c = neutralControls();
    let minSink = Infinity;
    let maxLoad = 0;
    const steps = Math.round((rampSeconds + holdSeconds) / SIM_DT);
    for (let i = 0; i < steps; i++) {
      c.brakeL = c.brakeR = Math.min(1, (i * SIM_DT) / rampSeconds);
      model.step(SIM_DT, c, env);
      minSink = Math.min(minSink, -model.state.vel.y);
      maxLoad = Math.max(maxLoad, model.loadFactor);
    }
    return { minSink, maxLoad, endSink: -model.state.vel.y };
  }

  test('a brisk flare planes out', () => {
    const f = flare(1.5, 1.5);
    expect(f.minSink).toBeLessThan(0.8);
    expect(f.minSink).toBeGreaterThan(-1.5);
    expect(f.maxLoad).toBeGreaterThan(1.2);
    expect(f.maxLoad).toBeLessThan(2.5);
  });

  test('the plane-out does not last: flared too high, it drops again', () => {
    expect(flare(1.5, 3.5).endSink).toBeGreaterThan(3);
  });

  test('a slow flare is less effective than a brisk one', () => {
    expect(flare(4, 1).minSink).toBeGreaterThan(flare(1.5, 1.5).minSink + 0.3);
  });
});

describe('every canopy and weight on the menu', () => {
  const kinds = Object.keys(CANOPY_SIZES) as CanopyKind[];
  const corners = (kind: CanopyKind): RigConfig[] => {
    const sizes = CANOPY_SIZES[kind];
    const ends = [sizes[0]!, sizes[sizes.length - 1]!];
    return ends.flatMap((size) => [rigConfig(kind, size, WEIGHT_MIN), rigConfig(kind, size, WEIGHT_MAX)]);
  };

  /** Seconds a buried toggle takes to turn the canopy once round the vertical. */
  function fullTurn(cfg: RigConfig): number {
    const model = trimmed(cfg);
    const c = controls({ brakeR: 1 });
    const spin = vec3();
    let turned = 0;
    let steps = 0;
    // The turn is read off the angular velocity: a heading means nothing once
    // the nose points at the ground, which it does under the small canopies.
    while (turned < 2 * Math.PI && steps < 20 / SIM_DT) {
      model.step(SIM_DT, c, env);
      turned -= rotate(spin, model.state.att, model.state.omega).y * SIM_DT;
      steps++;
    }
    return steps * SIM_DT;
  }

  function flared(cfg: RigConfig): number {
    const model = trimmed(cfg);
    const c = neutralControls();
    let minSink = Infinity;
    for (let i = 0; i < 3 / SIM_DT; i++) {
      c.brakeL = c.brakeR = Math.min(1, (i * SIM_DT) / 1.5);
      model.step(SIM_DT, c, env);
      minSink = Math.min(minSink, -model.state.vel.y);
    }
    return minSink;
  }

  test.each(kinds)('%s: the smaller the canopy, the faster it flies, sinks and turns', (kind) => {
    const flown = CANOPY_SIZES[kind].map((size) => {
      const cfg = rigConfig(kind, size, 90);
      return { ...steady({}, cfg), turn: fullTurn(cfg), dive: steady({ frontL: 1, frontR: 1 }, cfg).sink };
    });
    for (let i = 1; i < flown.length; i++) {
      const [bigger, smaller] = [flown[i - 1]!, flown[i]!];
      expect(smaller.forward).toBeGreaterThan(bigger.forward + 0.3);
      expect(smaller.sink).toBeGreaterThan(bigger.sink + 0.15);
      expect(smaller.turn).toBeLessThan(bigger.turn * 0.97);
      expect(smaller.dive).toBeGreaterThan(bigger.dive);
    }
    for (const f of flown) {
      // The pilot's own drag weighs on the glide of the smallest canopies.
      expect(f.glide).toBeGreaterThan(1.7);
      expect(f.glide).toBeLessThan(3.1);
    }
  });

  test.each(kinds)('%s: a brisk flare planes out under all of them', (kind) => {
    const rigs = [...CANOPY_SIZES[kind].map((size) => rigConfig(kind, size, 90)), ...corners(kind)];
    for (const cfg of rigs) {
      // The fastest ones climb for a moment when flared this hard from full flight.
      const minSink = flared(cfg);
      expect(minSink).toBeLessThan(1);
      expect(minSink).toBeGreaterThan(-3);
    }
  });

  test.each(kinds)('%s: wild inputs never blow up at the ends of the range', (kind) => {
    for (const cfg of corners(kind)) {
      const model = trimmed(cfg);
      const c = neutralControls();
      let seed = 777;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 60 / SIM_DT; i++) {
        if (i % 120 === 0) {
          c.brakeL = random();
          c.brakeR = random();
          c.frontL = random() < 0.3 ? random() : 0;
          c.frontR = random() < 0.3 ? random() : 0;
        }
        model.step(SIM_DT, c, env);
      }
      const { vel, att, pilotAtt } = model.state;
      expect(Math.hypot(vel.x, vel.y, vel.z)).toBeLessThan(70);
      expect(Math.hypot(att.x, att.y, att.z, att.w)).toBeCloseTo(1, 6);
      expect(Math.hypot(pilotAtt.x, pilotAtt.y, pilotAtt.z, pilotAtt.w)).toBeCloseTo(1, 6);
      expect(Math.abs(model.state.twist)).toBeLessThan(Math.PI / 2);
    }
  });
});

describe('a tri-cell against a classic canopy of the same size and load', () => {
  const classic = rigConfig('classic', 96, 90);
  const triCell = rigConfig('triCell', 96, 90);

  /** Height lost between letting go of a 360 under 0.6 of toggle and sinking no faster than in full flight. */
  function recovery(cfg: RigConfig): number {
    const trimSink = steady({}, cfg).sink;
    const model = trimmed(cfg);
    const held = controls({ brakeR: 0.6 });
    const spin = vec3();
    let turned = 0;
    while (turned < 2 * Math.PI) {
      model.step(SIM_DT, held, env);
      turned -= rotate(spin, model.state.att, model.state.omega).y * SIM_DT;
    }
    const top = model.state.pos.y;
    const none = neutralControls();
    for (let i = 0; i < 20 / SIM_DT && -model.state.vel.y > trimSink; i++) model.step(SIM_DT, none, env);
    return top - model.state.pos.y;
  }

  /** Ground covered while a brisk flare holds the sink under 1.5 m/s. */
  function carry(cfg: RigConfig): number {
    const model = trimmed(cfg);
    const c = neutralControls();
    let distance = 0;
    for (let i = 0; i < 8 / SIM_DT; i++) {
      c.brakeL = c.brakeR = Math.min(1, (i * SIM_DT) / 1.5);
      model.step(SIM_DT, c, env);
      const { vel } = model.state;
      if (-vel.y < 1.5) distance += Math.hypot(vel.x, vel.z) * SIM_DT;
    }
    return distance;
  }

  test('it flies faster and steeper', () => {
    const [plain, braced] = [steady({}, classic), steady({}, triCell)];
    expect(braced.forward).toBeGreaterThan(plain.forward * 1.1);
    expect(braced.sink).toBeGreaterThan(plain.sink * 1.15);
    expect(braced.glide).toBeLessThan(plain.glide);
    expect(braced.glide).toBeGreaterThan(plain.glide - 0.3);
  });

  test('it is the cleaner wing: in deep brakes it glides better', () => {
    const deep = { brakeL: 1, brakeR: 1 };
    expect(steady(deep, triCell).glide).toBeGreaterThan(steady(deep, classic).glide + 0.1);
  });

  test('its recovery arc is longer', () => {
    expect(recovery(triCell)).toBeGreaterThan(recovery(classic) * 1.25);
  });

  test('it carries further in the flare', () => {
    expect(carry(triCell)).toBeGreaterThan(carry(classic) * 1.3);
  });
});

describe('robustness', () => {
  test('wild inputs never blow up', () => {
    const model = trimmed();
    const c = neutralControls();
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 120 / SIM_DT; i++) {
      if (i % 120 === 0) {
        c.brakeL = random();
        c.brakeR = random();
        c.frontL = random() < 0.3 ? random() : 0;
        c.frontR = random() < 0.3 ? random() : 0;
      }
      model.step(SIM_DT, c, env);
    }
    const { vel, omega, att } = model.state;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    expect(Number.isFinite(speed)).toBe(true);
    expect(speed).toBeLessThan(45);
    expect(Math.hypot(omega.x, omega.y, omega.z)).toBeLessThan(8);
    expect(Math.hypot(att.x, att.y, att.z, att.w)).toBeCloseTo(1, 6);
  });
});
