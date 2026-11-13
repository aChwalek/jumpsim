// The jump from the plane: freefall belly to earth, the opening, the stowed
// brakes. Numbers checked against what skydivers know: about 200 km/h belly
// to earth, a minute from 4000 m to 1000 m, around 200 m and 3 g to open.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, neutralControls, type Environment } from '../src/sim/flightModel';
import { Freefall, freefallParams, noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { AAD_HEIGHT, AAD_SPEED, Jump, type JumpOptions } from '../src/sim/jump';
import { MAIN_OPENING, Opening, STOWED_BRAKE } from '../src/sim/opening';
import { AIRCRAFT, EXIT_SPOTS, type AircraftId, type ExitSpot } from '../src/sim/plane';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { rotate, rotateInv, set, vec3 } from '../src/sim/vec';

const flat = () => 0;
const calm = (): Environment => ({ wind: vec3(), airDensity: airDensityAt(4000) });

/** At the given height, belly to earth, at terminal speed, facing north. */
function bellyAt(height: number, weight = 90): { body: Freefall; env: Environment } {
  const body = new Freefall(freefallParams(weight));
  const env = calm();
  set(body.state.pos, 0, height, 0);
  set(body.state.vel, 0, -55, 0);
  const a = -Math.PI / 4;
  Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
  // Settle at this height.
  for (let i = 0; i < 6 / SIM_DT; i++) {
    body.state.pos.y = height;
    env.airDensity = airDensityAt(height);
    body.step(SIM_DT, noBodyInputs(), env);
  }
  return { body, env };
}

/** Holds an input at a fixed height and returns the speeds reached. */
function hold(input: Partial<BodyInputs>, seconds = 12) {
  const { body, env } = bellyAt(2000);
  let turned = 0;
  let full = 0;
  for (let i = 0; i < seconds / SIM_DT; i++) {
    body.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    body.state.pos.y = 2000;
    turned += body.state.yawRate * SIM_DT;
    if (!full && Math.abs(turned) >= 2 * Math.PI) full = (i + 1) * SIM_DT;
  }
  const v = body.state.vel;
  return { forward: -v.z, right: v.x, fall: -v.y, fullTurn: full };
}

function jumpFromPlane(pullAt: number | null) {
  const model = new FlightModel(deriveRig(DEFAULT_RIG));
  const env = calm();
  const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, flat, () => 0.5);
  const step = () => {
    env.airDensity = airDensityAt(model.state.pos.y);
    jump.step(SIM_DT, noBodyInputs(), env);
  };
  for (let i = 0; i < 2 / SIM_DT; i++) step();
  const doorX = model.state.pos.x;
  jump.act();
  let hill = 0;
  let to1000 = 0;
  while (jump.phase === 'freefall' && !jump.impact) {
    step();
    const v = model.state.vel;
    if (!hill && Math.hypot(v.x, v.z) < Math.tan((15 * Math.PI) / 180) * -v.y) hill = jump.time;
    if (!to1000 && jump.height() < 1000) to1000 = jump.time;
    if (pullAt !== null && jump.height() < pullAt) jump.act();
  }
  const throwForward = doorX - model.state.pos.x;
  while (jump.phase === 'opening' && !jump.impact) step();
  return { jump, model, env, hill, to1000, throwForward };
}

describe('freefall belly to earth', () => {
  test('falls at about 200 km/h low down and faster up high', () => {
    const low = bellyAt(1000).body.state.vel.y * -3.6;
    const high = bellyAt(3500).body.state.vel.y * -3.6;
    expect(low).toBeGreaterThan(190);
    expect(low).toBeLessThan(215);
    expect(high).toBeGreaterThan(low + 15);
    expect(high).toBeLessThan(245);
  });

  test('heavier jumpers fall a little faster', () => {
    const light = -bellyAt(1500, 60).body.state.vel.y;
    const heavy = -bellyAt(1500, 120).body.state.vel.y;
    expect(heavy / light).toBeGreaterThan(1.05);
    expect(heavy / light).toBeLessThan(1.2);
  });

  test('moves forward, back and sideways at a few metres a second', () => {
    const forward = hold({ forward: 1 });
    const back = hold({ forward: -1 });
    const right = hold({ slide: 1 });
    expect(forward.forward).toBeGreaterThan(5);
    expect(forward.forward).toBeLessThan(10);
    expect(-back.forward).toBeGreaterThan(3);
    expect(-back.forward).toBeLessThan(7);
    expect(right.right).toBeGreaterThan(3);
    expect(right.right).toBeLessThan(7);
    expect(Math.abs(forward.right) + Math.abs(right.forward)).toBeLessThan(0.1);
  });

  test('turns a 360 in about four seconds, either way', () => {
    const right = hold({ turn: 1 });
    const left = hold({ turn: -1 });
    expect(right.fullTurn).toBeGreaterThan(3);
    expect(right.fullTurn).toBeLessThan(5.5);
    expect(left.fullTurn).toBeCloseTo(right.fullTurn, 1);
  });

  test('a turn to the right turns the head to the right', () => {
    const { body, env } = bellyAt(2000);
    for (let i = 0; i < 1 / SIM_DT; i++) body.step(SIM_DT, { ...noBodyInputs(), turn: 1 }, env);
    const head = rotate(vec3(), body.state.att, vec3(0, 1, 0));
    // Facing north at first: a right turn swings the head east.
    expect(head.x).toBeGreaterThan(0.3);
  });
});

describe('out of the plane', () => {
  test('lies on the air chest first, then faces the ground once the fall builds up', () => {
    const { hill, to1000, throwForward } = jumpFromPlane(null);
    expect(hill).toBeGreaterThan(6);
    expect(hill).toBeLessThan(14);
    // About a minute to 1000 m from 4000 m.
    expect(to1000).toBeGreaterThan(48);
    expect(to1000).toBeLessThan(62);
    // Carried on along the run by the plane's speed for a few hundred metres.
    expect(throwForward).toBeGreaterThan(250);
    expect(throwForward).toBeLessThan(500);
  });

  test('a pull at 1000 m flies about 200 m lower, after a firm but comfortable opening', () => {
    const { jump } = jumpFromPlane(1000);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.pullHeight).toBeCloseTo(1000, -1);
    const lost = jump.log.pullHeight! - jump.log.openHeight;
    expect(lost).toBeGreaterThan(150);
    expect(lost).toBeLessThan(250);
    expect(jump.log.openingLoad).toBeGreaterThan(2.5);
    expect(jump.log.openingLoad).toBeLessThan(4);
    expect(jump.log.aad).toBe(false);
  });

  test('without a pull the AAD fires the reserve low, and it is open before the ground', () => {
    const { jump } = jumpFromPlane(null);
    expect(jump.log.aad).toBe(true);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.openHeight).toBeLessThan(AAD_HEIGHT);
    expect(jump.log.openHeight).toBeGreaterThan(60);
  });
});

describe('places at the door', () => {
  /** On jump run in this plane, at this place. */
  function aboard(aircraft: AircraftId, spot?: ExitSpot) {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env = calm();
    const run = { x: 0, z: 0, height: 4000, headingDeg: 90, indicatedAirspeed: 40, aircraft };
    const jump = new Jump(model, run, env, flat, () => 0.5, { spot });
    const step = (input: Partial<BodyInputs> = {}) => {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    };
    /** The eyes, plane frame. */
    const eyes = () => {
      const plane = jump.plane!;
      const e = model.pilotPoint(vec3(), model.rig.eyePos);
      return rotateInv(e, plane.att, set(e, e.x - plane.pos.x, e.y - plane.pos.y, e.z - plane.pos.z));
    };
    return { jump, step, eyes };
  }

  test('a press forward or back moves one place, out to the step or into the cabin, and no further', () => {
    const { jump, step } = aboard('pc6');
    expect(jump.spot).toBe('low');
    // Held, it moves one place only.
    for (let i = 0; i < 1 / SIM_DT; i++) step({ forward: 1 });
    expect(jump.spot).toBe('step');
    step();
    step({ forward: 1 });
    expect(jump.spot).toBe('step');
    for (let k = 0; k < 4; k++) {
      step({ forward: -1 });
      step();
    }
    expect(jump.spot).toBe('inside');
    // A touch of the stick is not a press.
    step({ forward: 0.3 });
    expect(jump.spot).toBe('inside');
  });

  test('the eyes are at the place, eased there from the last, and the plane flies the same run', () => {
    for (const aircraft of ['pc6', 'do28', 'as350'] as const) {
      const spots = AIRCRAFT[aircraft].spots;
      const low = aboard(aircraft);
      for (const spot of EXIT_SPOTS) {
        const { jump, step, eyes } = aboard(aircraft, spot);
        expect(jump.plane!.pos).toEqual(low.jump.plane!.pos);
        step();
        const mm = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((c) => Math.round(c * 1000));
        expect(mm(eyes()), `${aircraft} ${spot}`).toEqual(mm(spots[spot].eye));
      }
      // Halfway from the sill to the step, then there.
      const { jump, step, eyes } = aboard(aircraft);
      step({ forward: 1 });
      for (let i = 0; i < 0.3 / SIM_DT; i++) step();
      const out = (v: number) => AIRCRAFT[aircraft].doorSide * v;
      expect(jump.inPlace).toBe(false);
      expect(out(eyes().x)).toBeGreaterThan(out(spots.low.eye.x) + 0.02);
      expect(out(eyes().x)).toBeLessThan(out(spots.step.eye.x) - 0.02);
      for (let i = 0; i < 0.5 / SIM_DT; i++) step();
      expect(jump.inPlace).toBe(true);
      expect(out(eyes().x)).toBeCloseTo(out(spots.step.eye.x), 3);
    }
  });

  test('out of every place through the door, clear of the frame, harder from the inside than off the step', () => {
    for (const aircraft of ['pc6', 'do28', 'as350'] as const) {
      const a = AIRCRAFT[aircraft];
      const out = (v: number) => a.doorSide * v;
      const away: Partial<Record<ExitSpot, number>> = {};
      for (const spot of EXIT_SPOTS) {
        const { jump, step, eyes } = aboard(aircraft, spot);
        for (let i = 0; i < 0.5 / SIM_DT; i++) step();
        const before = out(eyes().x);
        jump.act();
        expect(jump.phase).toBe('freefall');
        let t = 0;
        // In the doorway the head passes between the front and the back of the frame, under its top.
        while (out(eyes().x) < a.cabin.halfWidth + 0.3 && t < 1) {
          const e = eyes();
          if (out(e.x) > a.cabin.halfWidth - 0.05) {
            expect(e.z, `${aircraft} ${spot}`).toBeGreaterThan(a.door.front);
            expect(e.z, `${aircraft} ${spot}`).toBeLessThan(a.door.back);
            expect(e.y, `${aircraft} ${spot}`).toBeLessThan(a.door.top);
          }
          step();
          t += SIM_DT;
        }
        expect(t, `${aircraft} ${spot}`).toBeLessThan(0.5);
        for (let i = 0; i < 0.2 / SIM_DT; i++) step();
        away[spot] = out(eyes().x) - before;
      }
      expect(away.inside!).toBeGreaterThan(away.low!);
      expect(away.low!).toBeGreaterThan(away.step!);
    }
  });
});

describe('the hover of an AS350', () => {
  /** In a hover, its nose to the east, at this place at the door. */
  function aboard(spot?: ExitSpot, env = calm()) {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const run = { x: 0, z: 0, height: 4000, headingDeg: 90, indicatedAirspeed: 40, aircraft: 'as350' as const };
    const jump = new Jump(model, run, env, flat, () => 0.5, { spot });
    const step = () => {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, noBodyInputs(), env);
    };
    return { jump, model, step };
  }
  const heli = AIRCRAFT.as350;

  test('holds still over the ground whatever the wind, level, its rotor turning', () => {
    const env = calm();
    set(env.wind, 8, 0, -3);
    const { jump, model, step } = aboard('low', env);
    const plane = jump.plane!;
    const at = { ...plane.pos };
    for (let i = 0; i < 5 / SIM_DT; i++) step();
    expect(plane.pos).toEqual(at);
    expect(Math.hypot(model.state.vel.x, model.state.vel.y, model.state.vel.z)).toBe(0);
    // Level: the attitude is its heading alone.
    expect(plane.att).toEqual(plane.level);
    // About 390 rpm: over six turns in a second, the blade a blur of nothing.
    const before = plane.prop;
    step();
    expect((plane.prop - before) / SIM_DT).toBeCloseTo(heli.rotors!.rate, 6);
  });

  test('out of the door there is no relative wind: the jumper drops straight down, slower to get going', () => {
    const { jump, model, step } = aboard('step');
    const door = { ...model.state.pos };
    jump.act();
    expect(jump.phase).toBe('freefall');
    // Letting go of the skid: hardly any speed.
    expect(Math.hypot(model.state.vel.x, model.state.vel.y, model.state.vel.z)).toBeLessThan(1);
    for (let i = 0; i < 3 / SIM_DT; i++) step();
    const p = model.state.pos;
    expect(Math.hypot(p.x - door.x, p.z - door.z)).toBeLessThan(2);
    // A plane's exit carries its forward speed into the hill; here, close to a fall in a vacuum.
    expect(door.y - p.y).toBeGreaterThan(35);
    expect(-model.state.vel.y).toBeGreaterThan(22);
  });

  test('the step is on the skid, outside and below the floor, under the door', () => {
    const step = heli.spots.step.eye;
    expect(-step.x).toBeGreaterThan(heli.cabin.halfWidth + 0.2);
    expect(step.y).toBeLessThan(1);
    expect(step.z).toBeGreaterThan(heli.door.front);
    expect(step.z).toBeLessThan(heli.door.back);
    expect(heli.doorSide).toBe(-1);
  });
});

describe('the hold of a C-130', () => {
  /** On jump run heading east, on foot in the hold. */
  function aboard() {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env = calm();
    const run = { x: 0, z: 0, height: 4000, headingDeg: 90, indicatedAirspeed: 40, aircraft: 'c130' as const };
    const jump = new Jump(model, run, env, flat, () => 0.5, { onFoot: true });
    const step = (input: Partial<BodyInputs> = {}) => {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    };
    /** The feet, plane frame. */
    const feet = () => {
      const plane = jump.plane!;
      const f = model.pilotPoint(vec3(), model.rig.feetPos);
      return rotateInv(f, plane.att, set(f, f.x - plane.pos.x, f.y - plane.pos.y, f.z - plane.pos.z));
    };
    return { jump, model, step, feet };
  }
  const ramp = AIRCRAFT.c130.ramp!;

  test('starts at the front of the hold on the floor, facing the ramp, at its own jump run speed', () => {
    const { jump, model, feet } = aboard();
    expect(jump.walk).not.toBeNull();
    expect(jump.afoot).toBe(true);
    expect(jump.onRamp).toBe(false);
    const f = feet();
    expect(f.z).toBeLessThan(ramp.front + 2);
    expect(Math.abs(f.y)).toBeLessThan(0.02);
    // Facing the tail, the run being flown east.
    expect(jump.headingDeg()).toBeCloseTo(270, 6);
    // Faster than the 40 m/s the drop zone asked for.
    expect(Math.hypot(model.state.vel.x, model.state.vel.z)).toBeGreaterThan(60);
  });

  test('the jump key does nothing in the hold; running down it goes off the end of the ramp with the speed of the run', () => {
    const { jump, model, step, feet } = aboard();
    jump.act();
    expect(jump.phase).toBe('plane');
    const planeVel = { ...jump.plane!.vel };
    let t = 0;
    while (jump.phase === 'plane' && t < 6) {
      step({ forward: 1 });
      t += SIM_DT;
      if (jump.phase === 'plane') expect(feet().z).toBeLessThan(ramp.end + 0.2);
    }
    expect(jump.phase).toBe('freefall');
    // Down 15 m of hold flat out: a few seconds.
    expect(t).toBeGreaterThan(2);
    expect(t).toBeLessThan(4);
    // Out the back faster than the plane goes backwards from under it: the run's speed, aft.
    const s = model.state.vel;
    const aft = -((s.x - planeVel.x) * Math.sin(Math.PI / 2) - (s.z - planeVel.z) * Math.cos(Math.PI / 2));
    expect(aft).toBeGreaterThan(5);
  });

  test('the walls keep the jumper in, and on the ramp the jump key leaps out', () => {
    const { jump, step, feet } = aboard();
    // Sideways into the wall for a while: still inside.
    for (let i = 0; i < 3 / SIM_DT; i++) step({ slide: 1 });
    expect(Math.abs(feet().x)).toBeLessThan(AIRCRAFT.c130.cabin.halfWidth);
    // Back to the middle, then down the hold onto the ramp, and stopped there.
    for (let i = 0; i < 3 / SIM_DT; i++) step({ slide: -1 });
    for (let i = 0; i < 0.5 / SIM_DT; i++) step({ slide: 0.3 });
    while (!jump.onRamp) step({ forward: 0.6 });
    for (let i = 0; i < 2 / SIM_DT; i++) step();
    expect(jump.phase).toBe('plane');
    jump.act();
    expect(jump.phase).toBe('freefall');
    expect(jump.body.state.vel.y - jump.plane!.vel.y).toBeGreaterThan(1);
  });

  test('without being on foot, a jumper waits on the ramp and steps off its end', () => {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const run = { x: 0, z: 0, height: 4000, headingDeg: 0, indicatedAirspeed: 40, aircraft: 'c130' as const };
    const jump = new Jump(model, run, calm(), flat, () => 0.5);
    expect(jump.walk).toBeNull();
    jump.act();
    expect(jump.phase).toBe('freefall');
    // Facing north on a run north, the tail is south: out the back.
    expect(jump.body.state.vel.z - jump.plane!.vel.z).toBeGreaterThan(1);
  });
});

describe('the opening', () => {
  test('stretches the lines after about two seconds and flies after five', () => {
    const { body, env } = bellyAt(1000);
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const opening = new Opening(body, model, MAIN_OPENING);
    let stretched = 0;
    let t = 0;
    while (!opening.done && t < 10) {
      opening.step(SIM_DT, env);
      t += SIM_DT;
      if (!stretched && opening.stage === 'inflation') stretched = t;
    }
    expect(stretched).toBeGreaterThan(1.5);
    expect(stretched).toBeLessThan(2.3);
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(6.5);
  });

  test('ends in steady flight on stowed brakes, which the toggles free one side at a time', () => {
    const { jump, model, env } = jumpFromPlane(1200);
    expect(jump.stowedL && jump.stowedR).toBe(true);
    // Hands up: the canopy still flies on its stowed brakes, straight on.
    const c = neutralControls();
    const flown = { ...c };
    let worst = 0;
    const startVel = { ...model.state.vel };
    for (let i = 0; i < 5 / SIM_DT; i++) {
      Object.assign(flown, c);
      jump.holdStows(flown);
      model.step(SIM_DT, flown, env);
      const v = model.state.vel;
      worst = Math.max(worst, Math.hypot(v.x - startVel.x, v.y - startVel.y, v.z - startVel.z));
    }
    expect(flown.brakeL).toBe(STOWED_BRAKE);
    expect(worst).toBeLessThan(1);
    // A toggle pulled past its stow frees that side only.
    jump.holdStows({ ...c, brakeL: STOWED_BRAKE + 0.1 });
    expect(jump.stowedL).toBe(false);
    expect(jump.stowedR).toBe(true);
    const after = { ...c };
    jump.holdStows(after);
    expect(after.brakeL).toBe(0);
    expect(after.brakeR).toBe(STOWED_BRAKE);
  });
});

describe('cutaway and reserve', () => {
  /** Out of the plane, pulled at 1500 m, flown until the main is overhead (or has had time to be). */
  function underMain(options: JumpOptions) {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env = calm();
    const reserve = deriveRig(reserveConfig(90));
    const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, flat, () => 0.5, {
      reserve,
      ...options,
    });
    const step = () => {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, noBodyInputs(), env);
      if (jump.phase === 'canopy') model.step(SIM_DT, neutralControls(), env);
    };
    for (let i = 0; i < 2 / SIM_DT; i++) step();
    jump.act();
    for (let i = 0; i < 3 / SIM_DT; i++) step();
    jump.body.state.pos.y = 1500;
    jump.act();
    for (let i = 0; i < 9 / SIM_DT && jump.phase !== 'canopy'; i++) step();
    return { jump, model, env, reserve, step };
  }

  test('with an RSL, a cutaway has the reserve flying some fifty metres lower', () => {
    const { jump, model, reserve, step } = underMain({ rsl: true });
    expect(jump.phase).toBe('canopy');
    jump.cutaway();
    expect(jump.phase).toBe('freefall');
    for (let i = 0; i < 8 / SIM_DT && jump.phase !== 'canopy'; i++) step();
    expect(jump.phase).toBe('canopy');
    expect(jump.canopy).toBe('reserve');
    expect(model.rig).toBe(reserve);
    expect(jump.log.reserveBy).toBe('rsl');
    const lost = jump.log.cutawayHeight! - jump.log.openHeight;
    expect(lost).toBeGreaterThan(25);
    expect(lost).toBeLessThan(110);
    // It opens on its own stowed brakes.
    expect(jump.stowedL && jump.stowedR).toBe(true);
  });

  test('without one, the reserve waits for its handle', () => {
    const { jump, step } = underMain({ rsl: false });
    jump.cutaway();
    for (let i = 0; i < 2 / SIM_DT; i++) step();
    expect(jump.phase).toBe('freefall');
    expect(jump.canopy).toBe('main');
    jump.act();
    expect(jump.canopy).toBe('reserve');
    expect(jump.log.reserveBy).toBe('hand');
    for (let i = 0; i < 8 / SIM_DT && jump.phase !== 'canopy'; i++) step();
    expect(jump.phase).toBe('canopy');
  });

  test('the main, once cut away, drifts down slowly and is soon far from the pilot', () => {
    const { jump, model, step } = underMain({ rsl: false });
    jump.cutaway();
    for (let i = 0; i < 4 / SIM_DT; i++) step();
    const main = jump.released!;
    expect(-main.vel.y).toBeLessThan(10);
    const s = model.state.pos;
    expect(Math.hypot(main.pos.x - s.x, main.pos.y - s.y, main.pos.z - s.z)).toBeGreaterThan(40);
  });

  test('a streamer never flies, falls at 70 to 120 km/h, and only a cutaway gets out of it', () => {
    const { jump, model, step } = underMain({ malfunction: 'streamer', rsl: true });
    expect(jump.phase).toBe('opening');
    expect(jump.log.malfunction).toBe('streamer');
    const fall = -model.state.vel.y * 3.6;
    expect(fall).toBeGreaterThan(70);
    expect(fall).toBeLessThan(120);
    // Too slow for the AAD.
    expect(fall / 3.6).toBeLessThan(AAD_SPEED);
    jump.cutaway();
    for (let i = 0; i < 8 / SIM_DT && jump.phase !== 'canopy'; i++) step();
    expect(jump.canopy).toBe('reserve');
    expect(jump.phase).toBe('canopy');
  });

  test('no cutaway before the main is out of its bag, nor of the reserve', () => {
    const { jump, step } = underMain({ rsl: true });
    jump.cutaway();
    for (let i = 0; i < 8 / SIM_DT && jump.phase !== 'canopy'; i++) step();
    jump.cutaway();
    expect(jump.phase).toBe('canopy');
    expect(jump.canopy).toBe('reserve');
  });
});

describe('the slider', () => {
  test('collapsed it glides a little further, taken off further still', () => {
    const glide = (delta: number) => {
      const model = new FlightModel(deriveRig(DEFAULT_RIG));
      model.dragAreaDelta = delta;
      set(model.state.vel, 0, -5, -12);
      for (let i = 0; i < 40 / SIM_DT; i++) model.step(SIM_DT, neutralControls(), calm());
      const v = model.state.vel;
      return { glide: Math.hypot(v.x, v.z) / -v.y, sink: -v.y };
    };
    const open = glide(0);
    const collapsed = glide(-0.1);
    const off = glide(-0.15);
    expect(collapsed.glide / open.glide).toBeGreaterThan(1.02);
    expect(collapsed.glide / open.glide).toBeLessThan(1.08);
    expect(collapsed.sink).toBeLessThan(open.sink);
    expect(off.glide).toBeGreaterThan(collapsed.glide);
  });
});
