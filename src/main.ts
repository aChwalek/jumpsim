import * as THREE from 'three';
import { Altisonic } from './audio/altisonic';
import { Sound } from './audio/sound';
import { InputDevices, type Action } from './input/devices';
import { rampControls } from './input/ramp';
import { CANOPY_COLORS } from './render/canopyColors';
import { CLOUD_BASE, CLOUD_DEPTH } from './render/clouds';
import { daylight, sunPosition } from './render/daylight';
import { PlaneView } from './render/planeView';
import { FREEFALL_STANCES, Posture, type Stance } from './render/posture';
import { RigView } from './render/rigView';
import { Resolution, createCamera, createGearCamera, createRenderer, createScene } from './render/scene';
import { KIND_NAMES, cloneSetup, loadSetup, loadingLabel, rigFor, sameFlight, type Setup } from './setup';
import { Arrival } from './sim/arrival';
import { airDensityAt } from './sim/atmosphere';
import { FlightModel, neutralControls, type Environment } from './sim/flightModel';
import { noBodyInputs, type BodyPosition } from './sim/freefall';
import { Jump } from './sim/jump';
import { PROPELLER } from './sim/plane';
import { detectTouchdown, feetHeight, type Touchdown } from './sim/landing';
import { AIR_DENSITY_SEA_LEVEL } from './sim/rig';
import { SIM_DT, emptyTelemetry, initTrimmed, readTelemetry } from './sim/telemetry';
import { DEG, vec3 } from './sim/vec';
import { gustPeakKmh, windAt } from './sim/weather';
import { Hud } from './ui/hud';
import type { KeysPhase } from './ui/keys';
import { Menu, type Start } from './ui/menu';
import { buildWorld, type World } from './world/build';
import { isWet, spawnsFor, type DzPack } from './world/dz';
import { dzInfo } from './world/dzs';

const QUALITY_RATIOS = [1, 1.5, 2, 3];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const camera = createCamera();
const gearCamera = createGearCamera();
const { scene, sky, light } = createScene();
const hud = new Hud();
const devices = new InputDevices(canvas);
const sound = new Sound();
const altisonic = new Altisonic();

/** What the current jump is set up with. */
let setup = loadSetup();
let dz: DzPack = dzInfo(setup.dz).pack();
let world: World = buildWorld(dz, light);
scene.add(world.object);

let rig = rigFor(setup.gear);
let model = new FlightModel(rig);
let rigView = new RigView(rig, CANOPY_COLORS[setup.gear.color].cells, light);
scene.add(rigView.object, rigView.pilot, rigView.shadow);
const planeView = new PlaneView();
scene.add(planeView.object);
const menu = new Menu(setup);

const env: Environment = { wind: vec3(), airDensity: AIR_DENSITY_SEA_LEVEL };
/** Seconds of sim time since the start, which drives the gusts. */
let airTime = 0;

/** Height of the canopy above the feet, m: where the wind the canopy flies in is taken. */
const canopyAboveFeet = (): number => rig.canopyPos.y - rig.feetPos.y;

/** Brings the wind up to date for the canopy's height and the time. */
function updateWind(): void {
  const height = Math.max(0, feetHeight(model, dz.groundAt)) + canopyAboveFeet();
  windAt(env.wind, setup.weather, height, airTime);
}

/** Altitude above the drop zone, m, as an altimeter zeroed on the landing area reads it. */
const altitude = (): number => feetHeight(model, () => dz.groundAt(dz.target.x, dz.target.z));

/** The wind up at the clouds, which carries them along, m/s. */
const cloudWind = vec3();

/** Puts the sun where the hour has it, under the sky chosen, and the wind on the windsock and the clouds. */
function applyWeather(): void {
  light.set(daylight(sunPosition(dz.lat, dz.lon, setup.hour), setup.weather.sky));
  world.setDaylight(light);
  world.setWind(setup.weather.windFromDeg, setup.weather.windKmh / 3.6);
  windAt(cloudWind, { ...setup.weather, gusts: 'none' }, CLOUD_BASE + CLOUD_DEPTH / 2, 0);
}

/** Moves to another drop zone. */
function applyDz(): void {
  const next = dzInfo(setup.dz).pack();
  if (next === dz) return;
  dz = next;
  scene.remove(world.object);
  world.dispose();
  world = buildWorld(dz, light);
  scene.add(world.object);
}

/** Swaps the canopy, its colours and the pilot's weight. */
function applyGear(previous: Setup['gear']): void {
  const gear = setup.gear;
  if (sameFlight(gear, previous) && gear.color === previous.color) return;
  scene.remove(rigView.object, rigView.pilot, rigView.shadow);
  rigView.dispose();
  if (!sameFlight(gear, previous)) {
    rig = rigFor(gear);
    model = new FlightModel(rig);
  }
  rigView = new RigView(rig, CANOPY_COLORS[gear.color].cells, light);
  scene.add(rigView.object, rigView.pilot, rigView.shadow);
}

function showGear(): void {
  const { gear } = setup;
  const loading = `${rig.wingLoading.toFixed(2)} lb/ft² · ${loadingLabel(rig.wingLoading)}`;
  const kind = gear.kind === 'classic' ? '' : ` ${KIND_NAMES[gear.kind]}`;
  hud.setGear(`${dz.name} · ${gear.canopyAreaFt2} ft²${kind} · ${gear.exitWeightKg} kg · ${loading}`);
}

/**
 * Applies a setup, all of it or only the scenery. Returns whether the jump
 * under way can go on: not if it moved to another drop zone or under another canopy.
 */
function apply(next: Setup, withGear: boolean): boolean {
  const before = setup;
  setup = cloneSetup(next);
  if (!withGear) setup.gear = before.gear;
  applyDz();
  applyWeather();
  if (withGear) applyGear(before.gear);
  showGear();
  return setup.dz === before.dz && sameFlight(setup.gear, before.gear);
}

let quality = Number(localStorage.getItem('quality') ?? 2);
/** The keys down the side of the screen, unless turned off with K. */
let keysShown = true;
try {
  keysShown = localStorage.getItem('keys') !== '0';
} catch {
  // Shown, then.
}
hud.showKeys(keysShown);
if (!(quality >= 0 && quality < QUALITY_RATIOS.length)) quality = 2;
const resolution = new Resolution(renderer, QUALITY_RATIOS[quality]!);

const ramped = neutralControls();
const applied = neutralControls();
const telemetry = emptyTelemetry();
let scenario: Start = 'pattern';
let touchdown: Touchdown | null = null;
/** What the pilot does on the ground after touching down, and its verdict, shown once at rest. */
let arrival: Arrival | null = null;
let verdict: (() => void) | null = null;
let stepsHeard = 0;
let waiting = true;
let paused = false;
/** The jump from the plane, until the landing; null when starting under canopy. */
let jump: Jump | null = null;
/** Hit the ground with no canopy flying. */
let impact = false;
/** How the body is held, eased from one stance to the next. */
const posture = new Posture();
const still = noBodyInputs();
/** Where the hands have the toggles: stowed brakes keep the canopy's short of them. */
const hands = neutralControls();

function spawn(kind: Start): void {
  scenario = kind;
  airTime = 0;
  const spots = spawnsFor(dz, setup.weather.windFromDeg);
  if (kind === 'plane') {
    windAt(env.wind, setup.weather, spots.plane.height, airTime);
    jump = new Jump(model, spots.plane, env, dz.groundAt);
  } else {
    jump = null;
    const s = spots[kind];
    const y = dz.groundAt(s.x, s.z) + s.height - rig.feetPos.y;
    env.airDensity = airDensityAt(y);
    windAt(env.wind, setup.weather, s.height + canopyAboveFeet(), airTime);
    initTrimmed(model, vec3(s.x, y, s.z), s.headingDeg, env);
  }
  planeView.object.visible = jump !== null;
  impact = false;
  Object.assign(ramped, neutralControls());
  Object.assign(applied, ramped);
  Object.assign(hands, ramped);
  touchdown = null;
  arrival = null;
  verdict = null;
  stepsHeard = 0;
  posture.reset();
  neck = null;
  paused = false;
  devices.recentre();
  hud.showResult(null);
  hud.setAltimeter(setup.gear.altimeter, altitude());
  altisonic.reset(setup.gear.audible ? altitude() : 0);
}

/**
 * Into a freefall position. A half turn onto the other side rolls the way
 * the pilot slides, or tips over backwards when backing up.
 */
function flyInto(position: BodyPosition): void {
  if (paused || !jump) return;
  const b = devices.body;
  const flat = position === 'belly' || position === 'back';
  jump.fly(position, (flat ? b.slide : b.forward) < 0 ? -1 : 1);
}

/** In freefall R goes up: it only starts again once out of it. */
const inFreefall = (): boolean => jump !== null && (jump.phase === 'freefall' || jump.phase === 'opening');

const actions: Record<Action, () => void> = {
  reset: () => {
    if (!inFreefall()) spawn(scenario);
  },
  spawnPattern: () => spawn('pattern'),
  spawnFinal: () => spawn('final'),
  spawnPlane: () => spawn('plane'),
  jump: () => {
    if (!paused) jump?.act();
  },
  flyBelly: () => flyInto('belly'),
  flyBack: () => flyInto('back'),
  flySit: () => flyInto('sit'),
  flyHeadDown: () => flyInto('headDown'),
  toggleHud: () => hud.toggle(),
  togglePause: () => (paused = !paused),
  toggleSound: () => sound.toggleMute(),
  recentre: () => devices.recentre(),
  toggleKeys: () => {
    keysShown = !keysShown;
    hud.showKeys(keysShown);
    try {
      localStorage.setItem('keys', keysShown ? '1' : '0');
    } catch {
      // Not remembered, that is all.
    }
  },
  cycleQuality: () => {
    quality = (quality + 1) % QUALITY_RATIOS.length;
    localStorage.setItem('quality', String(quality));
    resolution.scale = 1;
    resolution.setMaxPixelRatio(QUALITY_RATIOS[quality]!);
  },
  openMenu: () => {
    if (menu.isOpen) return menu.cancel();
    // The jump waits behind the menu, and the mouse goes back to the page.
    waiting = true;
    devices.release();
    menu.open(true);
  },
};
// Flight keys do nothing while the menu is up, except the one that closes it.
devices.onAction = (action) => {
  if (!menu.isOpen || action === 'openMenu') actions[action]();
};

function fly(): void {
  waiting = false;
  sound.wake();
  devices.capture();
}
menu.onStart = (chosen, start) => {
  apply(chosen, true);
  spawn(start);
  fly();
};
// The scenery follows the menu. Another drop zone puts the jump at its start,
// to be seen from there, and it can no longer be resumed.
menu.onPreview = (chosen) => {
  if (!apply(chosen, false)) {
    spawn(scenario);
    menu.setResumable(false);
  }
};
menu.onCancel = fly;

function resize(): void {
  camera.aspect = gearCamera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  gearCamera.updateProjectionMatrix();
  resolution.apply();
}
window.addEventListener('resize', resize);
resize();

function simulate(seconds: number): void {
  let left = seconds;
  while (left > 1e-5 && !touchdown && !impact) {
    // Whole steps, then one short step so the sim lands exactly on the frame.
    const dt = Math.min(SIM_DT, left);
    left -= dt;
    airTime += dt;
    env.airDensity = airDensityAt(model.state.pos.y);
    updateWind();
    const flying = !jump || jump.phase === 'canopy';
    if (jump) {
      jump.step(dt, devices.body, env);
      if (jump.impact) {
        hitWithoutCanopy(jump);
        return;
      }
    }
    if (!flying && jump) {
      // The same keys move the body in freefall: the toggles wait, and the
      // canopy comes out on its stowed brakes.
      Object.assign(ramped, neutralControls());
      Object.assign(applied, ramped);
      Object.assign(hands, ramped);
      jump.holdStows(applied);
      continue;
    }
    rampControls(ramped, devices.pulls, dt);
    applied.brakeL = Math.max(ramped.brakeL, devices.analogBrakeL);
    applied.brakeR = Math.max(ramped.brakeR, devices.analogBrakeR);
    applied.frontL = ramped.frontL;
    applied.frontR = ramped.frontR;
    Object.assign(hands, applied);
    jump?.holdStows(applied);
    model.step(dt, applied, env);
    touchdown = detectTouchdown(model, dz.groundAt);
    if (touchdown) {
      const landed = touchdown;
      const feet = model.pilotPoint(vec3(), rig.feetPos);
      const wet = isWet(dz, feet.x, feet.z);
      const distance = Math.hypot(feet.x - dz.target.x, feet.z - dz.target.z);
      const log = jump?.log ?? null;
      // On the ground the canopy is blown by the wind at its own height.
      windAt(env.wind, setup.weather, canopyAboveFeet(), airTime);
      arrival = new Arrival(model, landed, { groundAt: dz.groundAt, wet, wind: vec3(env.wind.x, env.wind.y, env.wind.z) });
      verdict = () => hud.showResult(landed, distance, wet, log);
      sound.land({ sink: landed.sink, groundSpeed: landed.groundSpeed, wet });
      // What is left of the frame is spent on the ground.
      arrival.update(left);
    }
  }
}

/** The ground came first. The pilot stays where they hit, no lower than it. */
function hitWithoutCanopy(j: Jump): void {
  impact = true;
  const s = model.state;
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  s.pos.y -= Math.min(0, j.height()) - 0.05;
  s.vel.x = s.vel.y = s.vel.z = 0;
  sound.land({ sink: speed, groundSpeed: 0, wet: false });
  hud.showImpact(j.log, j.phase === 'opening', speed);
}

const eye = vec3();
const eyeVel = vec3();
const air = new THREE.Vector3();
const unlook = new THREE.Quaternion();
const propeller = vec3();
const toPlane = new THREE.Vector3();
const look = new THREE.Quaternion();
const turn = new THREE.Quaternion();
const flatView = new THREE.Quaternion();
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const head = new THREE.Euler(0, 0, 0, 'YXZ');
const face = new THREE.Vector3();
const crown = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
/** Resting line of sight below the horizon. */
const HEAD_PITCH = -8 * DEG;
/**
 * The neck absorbs most of a small pitch change but only so much of a big one:
 * the head follows 35 % of the swing of a flare, and all but 16 degrees of the
 * dive of a spiral.
 */
const HEAD_PITCH_FOLLOW = 0.35;
const NECK_RANGE = 25 * DEG;
const headPitch = (bodyPitch: number): number =>
  bodyPitch - (1 - HEAD_PITCH_FOLLOW) * NECK_RANGE * Math.tanh(bodyPitch / NECK_RANGE);
/**
 * Flat on the air the head comes up, eyes on the horizon as students are
 * taught, as far as the neck goes; in the door they look out and down.
 */
const FREEFALL_GAZE = -20 * DEG;
const DOOR_GAZE = -12 * DEG;
const NECK_UP = 75 * DEG;
const NECK_DOWN = -40 * DEG;
/** How far up the eyes go to check the canopy as it opens. */
const GLANCE = 62 * DEG;
const MAX_PITCH = 85 * DEG;

/**
 * Where the neck takes the eyes in each freefall position: the pitch of the
 * line of sight it goes for, the neck angle it would rather have when two
 * would do, and how far it goes, rad, positive towards the top of the head.
 */
const NECKS: Record<BodyPosition, { gaze: number; prefer: number; lo: number; hi: number }> = {
  belly: { gaze: FREEFALL_GAZE, prefer: 60 * DEG, lo: NECK_DOWN, hi: NECK_UP },
  // Chin to the chest and the shoulders curled, to look out past the knees
  // at the horizon beyond the feet.
  back: { gaze: FREEFALL_GAZE, prefer: -75 * DEG, lo: -75 * DEG, hi: NECK_UP },
  // The knees just in sight under the horizon.
  sit: { gaze: -20 * DEG, prefer: 0, lo: NECK_DOWN, hi: NECK_UP },
  // The horizon upside down: ground on top, sky underneath.
  headDown: { gaze: -10 * DEG, prefer: 0, lo: NECK_DOWN, hi: NECK_UP },
};
/** Time for the neck to come round when the body changes position, s. */
const NECK_LAG = 0.2;
/** The neck's angle in freefall, rad, eased from one position to the next; null to take it at once. */
let neck: number | null = null;

/**
 * The neck angle that tips the face onto the pitch `gaze`, given how high
 * the face (`f`) and the top of the head (`h`) point: of the two that do, the
 * nearer `prefer`, within the neck's range.
 */
function neckFor(f: number, h: number, gaze: number, prefer: number, lo: number, hi: number): number {
  const r = Math.hypot(f, h);
  let a = prefer;
  if (r > 0.05) {
    // f cos a + h sin a = r cos(a - phi) = sin(gaze)
    const phi = Math.atan2(h, f);
    const c = Math.acos(Math.max(-1, Math.min(1, Math.sin(gaze) / r)));
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    const a1 = wrap(phi + c);
    const a2 = wrap(phi - c);
    a = Math.abs(a1 - prefer) <= Math.abs(a2 - prefer) ? a1 : a2;
  }
  return Math.max(lo, Math.min(hi, a));
}

/** Where the pilot's eyes look, from the body's attitude and the mouse. */
function aimCamera(dt: number): void {
  const att = model.state.pilotAtt;
  look.set(att.x, att.y, att.z, att.w);
  const hang = jump ? jump.hang : 1;
  if (hang > 0) {
    // Hanging: the head turns and banks with the harness but steadies its
    // own pitch, so the eyes stay on the ground ahead in the flare. The
    // resting pitch goes after the look yaw, so that glancing sideways in
    // level flight does not tilt the horizon.
    head.setFromQuaternion(look, 'YXZ');
    head.x = headPitch(head.x);
    camera.quaternion.setFromEuler(head);
    const pitch = HEAD_PITCH + (jump ? jump.glance * GLANCE : 0) + devices.lookPitch;
    lookEuler.set(Math.min(pitch, MAX_PITCH), -devices.lookYaw, 0);
    camera.quaternion.multiply(turn.setFromEuler(lookEuler));
  }
  if (hang < 1) {
    // On the air: flat on it the face looks at the ground and the neck lifts
    // it towards the horizon ahead of the head; on the back it bends to look
    // past the knees; upright, sitting or upside down, the eyes are on the
    // horizon in front of the chest.
    face.set(0, 0, -1).applyQuaternion(look);
    crown.set(0, 1, 0).applyQuaternion(look);
    const position = jump && jump.phase !== 'plane' ? jump.body.position : 'belly';
    const n = NECKS[position];
    const out = jump && jump.phase !== 'plane' ? Math.min(1, jump.time / 1.5) : 0;
    const gaze = position === 'belly' ? DOOR_GAZE + (FREEFALL_GAZE - DOOR_GAZE) * out : n.gaze;
    const wanted = neckFor(face.y, crown.y, gaze, n.prefer, n.lo, n.hi);
    neck = neck === null ? wanted : neck + (wanted - neck) * (1 - Math.exp(-dt / NECK_LAG));
    flatView.copy(look).multiply(turn.setFromAxisAngle(AXIS_X, neck));
    lookEuler.set(devices.lookPitch, -devices.lookYaw, 0);
    flatView.multiply(turn.setFromEuler(lookEuler));
    if (hang <= 0) camera.quaternion.copy(flatView);
    else camera.quaternion.slerpQuaternions(flatView, camera.quaternion, hang);
  }
}

/** How the pilot holds the body right now. */
function stance(): Stance {
  if (arrival) return 'ground';
  if (!jump) return 'hanging';
  switch (jump.phase) {
    case 'plane':
      return 'door';
    case 'freefall':
      return jump.body.position;
    case 'opening':
      if (jump.inflation !== null) return 'hanging';
      return jump.opening?.stage === 'throw' ? 'throw' : 'belly';
    default:
      return 'hanging';
  }
}

/** Which keys the side of the screen shows: what can be done right now. */
function keysPhase(): KeysPhase | null {
  if (menu.isOpen) return null;
  if (touchdown || arrival || impact) return 'ground';
  if (!jump || jump.phase === 'canopy' || jump.phase === 'opening') return 'canopy';
  return jump.phase === 'plane' ? 'plane' : 'freefall';
}

/** Shown while flying anything but belly to earth. */
const POSITION_NAMES: Record<BodyPosition, string> = { belly: '', back: 'SUR LE DOS', sit: 'ASSIS', headDown: 'TÊTE EN BAS' };

/** What the HUD says to do next. */
function cue(): string {
  if (!jump || impact) return '';
  if (jump.phase === 'plane') {
    const name = POSITION_NAMES[jump.body.position].toLowerCase();
    return `FEU VERT<small>${name ? `sortie ${name} · ` : ''}Espace pour sauter</small>`;
  }
  if (jump.phase === 'freefall') {
    if (jump.pullWhenFlat) return 'À PLAT<small>pour ouvrir</small>';
    const name = POSITION_NAMES[jump.body.position];
    if (jump.time > 1.5) return `${name}<small>Espace pour ouvrir</small>`;
    return name;
  }
  if (jump.stowed && !touchdown) {
    const both = jump.stowedL && jump.stowedR;
    const which = both ? 'FREINS' : jump.stowedL ? 'FREIN GAUCHE' : 'FREIN DROIT';
    return `${which} ENCORE CALÉ${both ? 'S' : ''}<small>tire un peu la commande pour libérer</small>`;
  }
  return '';
}

let last = performance.now();
let frameAverage = 1 / 60;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000;
  last = now;
  frameAverage += (elapsed - frameAverage) * 0.05;
  if (elapsed < 0.25) resolution.track(elapsed);

  devices.poll();
  const live = !waiting && !paused;
  if (live) {
    const seconds = Math.min(elapsed, 0.1);
    if (arrival) {
      airTime += seconds;
      arrival.update(seconds);
    } else simulate(seconds);
    if (arrival) {
      for (; stepsHeard < arrival.steps; stepsHeard++) sound.step(arrival.speed);
      if (arrival.done && verdict) {
        verdict();
        verdict = null;
      }
    }
  }

  const inflation = jump ? jump.inflation : 1;
  rigView.setInflation(inflation);
  // The hands are on the risers from line stretch until they let go on the
  // ground; otherwise they are free, and the body shows them.
  const onRisers = inflation !== null && !(arrival && arrival.time >= 0.25);
  rigView.setArms(onRisers);
  const pose = stance();
  const moving = live ? Math.min(elapsed, 0.1) : 0;
  const legs: [number, number] | undefined = arrival ? [arrival.legL, arrival.legR] : undefined;
  rigView.body.setPose(posture.update(moving, pose, FREEFALL_STANCES.has(pose) ? devices.body : still, legs));
  rigView.body.showArms(!onRisers);
  rigView.body.setHeight(feetHeight(model, dz.groundAt));
  rigView.update(model, applied, dz.groundAt, light, hands);
  if (jump) planeView.update(jump.plane);
  model.pilotPoint(eye, rig.eyePos);
  camera.position.set(eye.x, eye.y, eye.z);
  aimCamera(moving);
  sky.position.copy(camera.position);
  // The windsock and the flags follow the gusts at their own height.
  if (live && setup.weather.gusts !== 'none') {
    const gust = windAt(air, setup.weather, 6, airTime);
    world.setWind(Math.atan2(-gust.x, gust.z) / DEG, Math.hypot(gust.x, gust.z));
  }
  if (!paused) light.clouds.drift(cloudWind.x, cloudWind.z, Math.min(elapsed, 0.1));
  world.update(camera.position, now / 1000);
  renderer.render(scene, camera);
  // The gear in the hands goes on top, from the same eye.
  gearCamera.position.copy(camera.position);
  gearCamera.quaternion.copy(camera.quaternion);
  // Keeping the colours and clearing only the depth puts it over the picture.
  renderer.autoClearColor = false;
  renderer.render(scene, gearCamera);
  renderer.autoClearColor = true;

  // The air past the head, in the head's own axes. On the ground that is
  // what is left of the speed, then only the wind.
  model.pilotPointVelocity(eyeVel, rig.eyePos);
  air.set(env.wind.x - eyeVel.x, env.wind.y - eyeVel.y, env.wind.z - eyeVel.z);
  const airspeed = air.length();
  air.applyQuaternion(unlook.copy(camera.quaternion).invert());
  sound.update({
    airspeed: impact ? 0 : airspeed,
    fromRight: airspeed > 0.1 ? -air.x / airspeed : 0,
    live,
    canopy: inflation ?? 0,
  });
  if (jump) {
    // The plane: how far, which way, and how fast it is going away.
    const plane = jump.plane;
    plane.point(propeller, PROPELLER);
    toPlane.set(propeller.x - eye.x, propeller.y - eye.y, propeller.z - eye.z);
    const distance = toPlane.length();
    const away =
      (toPlane.x * (plane.vel.x - eyeVel.x) + toPlane.y * (plane.vel.y - eyeVel.y) + toPlane.z * (plane.vel.z - eyeVel.z)) /
      distance;
    toPlane.applyQuaternion(unlook);
    sound.hearPlane({ distance, closing: -away, fromRight: toPlane.x / distance, live });
  } else {
    sound.hearPlane(null);
  }

  const reading = altitude();
  if (live && !touchdown) {
    const beeps = altisonic.update(reading);
    if (beeps) sound.beep(beeps);
  }
  readTelemetry(model, env, telemetry);
  const height = Math.max(0, feetHeight(model, dz.groundAt));
  const falling = jump !== null && jump.phase !== 'canopy';
  hud.setKeys(keysPhase(), devices.lastUsed);
  hud.update(
    {
      altitude: reading,
      verticalSpeed: telemetry.verticalSpeed,
      groundSpeed: telemetry.groundSpeed,
      headingDeg: jump && falling && jump.phase !== 'plane' ? jump.body.headingDeg() : telemetry.headingDeg,
      controls: applied,
      held: devices.pulls.hold,
      fps: 1 / frameAverage,
      renderScale: resolution.scale,
      windFromDeg: setup.weather.windFromDeg,
      windKmh: setup.weather.windKmh,
      gustKmh: gustPeakKmh(setup.weather),
      muted: sound.muted,
      freefall: falling,
      cue: cue(),
      heightAlert: !jump || !falling || jump.phase === 'plane' ? 'none' : height < 1000 ? 'danger' : height < 1500 ? 'warn' : 'none',
    },
    elapsed,
  );
}

applyWeather();
showGear();
spawn('pattern');
menu.open(false);
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // The rig can change between jumps: these always give the current one.
  const sim = { spawn, ramped, devices, camera, renderer, scene, sound, menu, fly, light, apply, resolution };
  Object.defineProperties(sim, {
    model: { get: () => model },
    rig: { get: () => rig },
    setup: { get: () => setup },
    dz: { get: () => dz },
    world: { get: () => world },
    env: { get: () => env },
    jump: { get: () => jump },
  });
  Object.assign(window, { sim });
}
