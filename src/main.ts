import * as THREE from 'three';
import { Altisonic } from './audio/altisonic';
import { Sound } from './audio/sound';
import { T, lang, num, setLanguage } from './i18n';
import { InputDevices, type Action } from './input/devices';
import { keyLabel, readKeyboardLayout } from './input/keyLabels';
import { rampControls } from './input/ramp';
import { CANOPY_COLORS } from './render/canopyColors';
import { CLOUD_BASE, CLOUD_DEPTH } from './render/clouds';
import { daylight, sunPosition } from './render/daylight';
import { PlaneView } from './render/planeView';
import { CanopyView, type SliderState } from './render/canopyView';
import { ChaseCamera, type ChaseTarget } from './render/chaseCamera';
import { FREEFALL_STANCES, LegSwing, Posture, type LegCues, type Stance } from './render/posture';
import { RigView, type RigFrame } from './render/rigView';
import { TopView } from './render/topView';
import { GEAR_LAYER, OUTSIDE_LAYER, Resolution, createCamera, createGearCamera, createRenderer, createScene } from './render/scene';
import { logJump, type Outcome } from './logbook';
import { QUALITY_LEVELS, loadSettings, saveSettings } from './settings';
import {
  MALFUNCTION_ODDS,
  cloneSetup,
  kindName,
  loadSetup,
  loadingLabel,
  reserveRigFor,
  rigFor,
  runHeading,
  sameFlight,
  type Setup,
  type Start,
} from './setup';
import { Arrival } from './sim/arrival';
import { airDensityAt } from './sim/atmosphere';
import { FlightModel, neutralControls, type Environment } from './sim/flightModel';
import { noBodyInputs, type BodyPosition } from './sim/freefall';
import { Jump } from './sim/jump';
import { detectTouchdown, feetHeight, type Touchdown } from './sim/landing';
import { AIR_DENSITY_SEA_LEVEL } from './sim/rig';
import { SIM_DT, emptyTelemetry, initTrimmed, readTelemetry } from './sim/telemetry';
import { DEG, rotateInv, vec3 } from './sim/vec';
import { gustPeakKmh, windAt } from './sim/weather';
import { Hud } from './ui/hud';
import type { KeysPhase } from './ui/keys';
import { Menu } from './ui/menu';
import { buildWorld, type World } from './world/build';
import { isWet, spawnsFor, type DzPack } from './world/dz';
import { dzInfo } from './world/dzs';
import { MAP_HALF } from './ui/dzMap';

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
/** How the sim runs here: quality, sound, mouse. Shared with the menu, which changes it. */
const settings = loadSettings();
setLanguage(settings.language);
// The help names keys the way the keyboard in use prints them.
await readKeyboardLayout();
let dz: DzPack = await dzInfo(setup.dz).load();
let world: World = buildWorld(dz, light);
scene.add(world.object);

let rig = rigFor(setup.gear);
let reserveRig = reserveRigFor(setup.gear);
let model = new FlightModel(rig);
let rigView = new RigView(rig, CANOPY_COLORS[setup.gear.color].cells, light);
scene.add(rigView.object);
/** A reserve's seven cells: white, with a darker band either side of the middle. */
const RESERVE_PALETTE = [0xf2f2ee, 0x1f3f78, 0xf2f2ee, 0xf2f2ee, 0xf2f2ee, 0x1f3f78, 0xf2f2ee];
/** The main once cut away, drifting down on its own; drawn until the next jump. */
let releasedView: CanopyView | null = null;
/** What the main's slider is doing. */
let sliderState: SliderState = 'open';
/** Where the camera is: the pilot's eyes, or outside following them. */
let view: 'eyes' | 'outside' = 'eyes';
const chase = new ChaseCamera();
const chaseTarget: ChaseTarget = { focus: new THREE.Vector3(), heading: 0, distance: 10, above: 0.2 };
const legSwing = new LegSwing();
const legCues: LegCues = { prep: 0, fore: 0, side: 0 };
/** A short message over the HUD's cue, until a time (performance.now ms). */
let flash: { text: string; until: number } | null = null;
const planeView = new PlaneView();
scene.add(planeView.object);
const menu = new Menu(setup, settings);

const env: Environment = { wind: vec3(), airDensity: AIR_DENSITY_SEA_LEVEL };
/** Seconds of sim time since the start, which drives the gusts. */
let airTime = 0;

/** Height of the canopy above the feet, m: where the wind the canopy flies in is taken. */
const canopyAboveFeet = (): number => model.rig.canopyPos.y - model.rig.feetPos.y;

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
  light.set(daylight(sunPosition(dz.lat, dz.lon, setup.hour, dz.utcOffsetH), setup.weather.sky));
  world.setDaylight(light);
  world.setWind(setup.weather.windFromDeg, setup.weather.windKmh / 3.6);
  windAt(cloudWind, { ...setup.weather, gusts: 'none' }, CLOUD_BASE + CLOUD_DEPTH / 2, 0);
}

/** Moves to another drop zone, which must have been loaded. */
function applyDz(): void {
  const next = dzInfo(setup.dz).loaded();
  if (!next || next === dz) return;
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
  if (!sameFlight(gear, previous)) {
    rig = rigFor(gear);
    reserveRig = reserveRigFor(gear);
    model = new FlightModel(rig);
  }
  newRigView();
}

/** A fresh pilot under a fresh main, packed: after a change of gear, or a jump that used the reserve. */
function newRigView(): void {
  scene.remove(rigView.object);
  rigView.dispose();
  rigView = new RigView(rig, CANOPY_COLORS[setup.gear.color].cells, light);
  scene.add(rigView.object);
}

/** Back under the main, whatever the last jump did with it. */
function resetCanopies(): void {
  if (releasedView) {
    scene.remove(releasedView.object, releasedView.shadow, releasedView.deployment.object);
    releasedView.dispose();
    releasedView = null;
  }
  if (rigView.detached || rigView.canopy.reserve) newRigView();
  model.rig = rig;
  sliderState = 'open';
  rigView.canopy.setSlider('open', true);
  applySliderDrag();
}

/**
 * The slider's drag on the flight: the calibration flies it open on the
 * links, a pocket of fabric of some 0.15 m² of drag on a 170; collapsed it
 * drags a third as much, and taken off not at all. It scales with the canopy.
 */
function applySliderDrag(): void {
  const scale = model.rig.area / (170 * 0.0929);
  const reserve = model.rig !== rig;
  model.dragAreaDelta = reserve ? 0 : sliderState === 'collapsed' ? -0.1 * scale : sliderState === 'stowed' ? -0.15 * scale : 0;
}

/** The main is cut away: its view goes on drawing it, on its own. */
function releaseMain(): void {
  releasedView = rigView.detachCanopy();
  scene.add(releasedView.object, releasedView.shadow, releasedView.deployment.object);
}

/** The reserve comes out: the pilot will hang from it. */
function attachReserve(): void {
  // Fired by the AAD with the main still packed: that main is never drawn again.
  if (!rigView.detached) rigView.detachCanopy().dispose();
  rigView.attachCanopy(new CanopyView(reserveRig, RESERVE_PALETTE, light, true));
  applySliderDrag();
}

function showGear(): void {
  const { gear } = setup;
  const loading = `${num(rig.wingLoading, 2)} lb/ft² · ${loadingLabel(rig.wingLoading)}`;
  const kind = gear.kind === 'classic' ? '' : ` ${kindName(gear.kind)}`;
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

const resolution = new Resolution(renderer, QUALITY_LEVELS[settings.quality]!.ratio);

/** Puts the settings to work, and keeps them for next time. */
function applySettings(): void {
  resolution.setMaxPixelRatio(QUALITY_LEVELS[settings.quality]!.ratio);
  if (!settings.autoResolution && resolution.scale !== 1) {
    resolution.scale = 1;
    resolution.apply();
  }
  hud.showFps = settings.showFps;
  hud.showKeys(settings.showKeys);
  sound.set(settings.sound, settings.volume);
  devices.sensitivity = settings.mouseSensitivity;
  devices.invertLook = settings.invertLook;
  if (settings.language !== lang) setLanguage(settings.language);
  hud.applyLanguage();
  showGear();
  saveSettings(settings);
}
applySettings();

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
/** Seconds flown under canopy on this jump, for the logbook. */
let canopyTime = 0;

/** Writes the jump that just ended in the logbook. */
function logThisJump(outcome: Outcome, sink: number, groundSpeed: number, distance?: number, wet?: boolean): void {
  const { gear, weather } = setup;
  const log = jump?.log;
  logJump({
    time: Date.now(),
    dz: setup.dz,
    dzName: dz.name,
    start: scenario,
    hour: setup.hour,
    weather: { ...weather },
    canopy: { kind: gear.kind, areaFt2: gear.canopyAreaFt2, exitWeightKg: gear.exitWeightKg, wingLoading: rig.wingLoading },
    emergency:
      log && (log.cutawayHeight !== null || log.reserveBy !== null || log.malfunction)
        ? { malfunction: log.malfunction, cutawayHeight: log.cutawayHeight, reserveHeight: log.reserveHeight, reserveBy: log.reserveBy }
        : undefined,
    freefall:
      jump && log && jump.phase !== 'plane'
        ? {
            exitHeight: log.exitHeight,
            pullHeight: log.pullHeight,
            // Until the pull; to the ground when there was none.
            seconds: jump.opening ? log.freefallSeconds : jump.time,
            topSpeed: log.topSpeed,
            aad: log.aad,
          }
        : undefined,
    canopySeconds: canopyTime,
    outcome,
    sink,
    groundSpeed,
    distance,
    wet,
  });
}

function spawn(kind: Start): void {
  scenario = kind;
  airTime = 0;
  resetCanopies();
  const spots = spawnsFor(dz, setup.weather.windFromDeg, { headingDeg: runHeading(setup), height: setup.jump.exitHeight });
  if (kind === 'plane') {
    windAt(env.wind, setup.weather, spots.plane.height, airTime);
    const rate = setup.jump.malfunction;
    const malfunction = rate === 'always' || (rate === 'sometimes' && Math.random() < 1 / MALFUNCTION_ODDS) ? 'streamer' : null;
    jump = new Jump(model, spots.plane, env, dz.groundAt, Math.random, { reserve: reserveRig, rsl: setup.gear.rsl, malfunction });
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
  canopyTime = 0;
  posture.reset();
  legSwing.reset();
  chase.reset();
  rigView.body.setHandles(true, true);
  lastVel.x = Number.NaN;
  flash = null;
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
  toggleSound: () => {
    settings.sound = !settings.sound;
    applySettings();
    menu.refresh();
  },
  recentre: () => devices.recentre(),
  toggleKeys: () => {
    settings.showKeys = !settings.showKeys;
    applySettings();
    menu.refresh();
  },
  cutaway: () => {
    if (!paused && jump && !touchdown && !arrival) jump.cutaway();
  },
  slider: () => {
    if (paused) return;
    const underMain = (!jump || (jump.phase === 'canopy' && jump.canopy === 'main')) && !touchdown && !arrival;
    if (!underMain || sliderState !== 'open') return;
    if (setup.gear.slider === 'fixed') {
      flash = { text: `${T.cue.sliderFixed}<small>${T.cue.sliderStays}</small>`, until: performance.now() + 2000 };
      return;
    }
    sliderState = setup.gear.slider === 'collapsible' ? 'collapsed' : 'stowed';
    rigView.canopy.setSlider(sliderState);
    applySliderDrag();
  },
  camera: () => {
    view = view === 'eyes' ? 'outside' : 'eyes';
    chase.reset();
    devices.recentre();
  },
  cycleQuality: () => {
    settings.quality = (settings.quality + 1) % QUALITY_LEVELS.length;
    resolution.scale = 1;
    applySettings();
    menu.refresh();
  },
  openMenu: () => {
    if (menu.isOpen) return menu.cancel();
    // The jump waits behind the menu, and the mouse goes back to the page.
    waiting = true;
    devices.release();
    menu.open(true);
  },
  padMenu: () => {
    if (!menu.isOpen) actions.openMenu();
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
/** Counts the menu's requests: one answered after the drop zone has loaded may be stale. */
let request = 0;
menu.onStart = async (chosen, start) => {
  const mine = ++request;
  await dzInfo(chosen.dz).load();
  if (mine !== request) return;
  apply(chosen, true);
  spawn(start);
  fly();
};
// The scenery follows the menu. Another drop zone puts the jump at its start,
// to be seen from there, and it can no longer be resumed.
menu.onPreview = async (chosen) => {
  const mine = ++request;
  await dzInfo(chosen.dz).load();
  // Loaded: the menu stops saying it is loading.
  menu.refresh();
  if (mine !== request) return;
  if (!apply(chosen, false)) {
    spawn(scenario);
    menu.setResumable(false);
  }
};
menu.onCancel = fly;
menu.onSettings = applySettings;
// Escape opens the menu too; in the menu it goes back, and may close it:
// that press is spent (the menu takes it first and marks it).
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !e.repeat && !e.defaultPrevented && !menu.isOpen) actions.openMenu();
});

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
    canopyTime += dt;
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
      logThisJump(landed.rating, landed.sink, landed.groundSpeed, distance, wet);
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
  hud.showImpact(j.log, j.phase === 'opening', speed, j.opening?.malfunction ?? null);
  logThisJump('impact', speed, 0);
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
      return jump.plane.type.doorSide < 0 ? 'door' : 'doorRight';
    case 'freefall':
      // Just cut away: the hands are still on the handles.
      if (jump.cutawayAt !== null && jump.time - jump.cutawayAt < 0.45) return 'cutaway';
      return jump.body.position;
    case 'opening':
      if (jump.inflation !== null) return 'hanging';
      if (jump.canopy === 'reserve') return jump.log.reserveBy === 'hand' ? 'reserve' : 'belly';
      return jump.opening?.stage === 'throw' ? 'throw' : 'belly';
    default:
      return 'hanging';
  }
}

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Where the pilot chute and bag of the canopy overhead are. */
function deployStage(out: RigFrame): void {
  out.bagOut = 0;
  out.deployTime = 0;
  if (!jump) {
    // Started under canopy: it has long been open.
    out.deploy = 'canopy';
    out.deployTime = 10;
    out.bagOut = 1;
    return;
  }
  const reserve = jump.canopy === 'reserve';
  const o = jump.opening;
  if (jump.phase === 'canopy') {
    out.deploy = reserve ? 'free' : 'canopy';
    out.deployTime = 10;
    out.bagOut = 1;
  } else if (jump.phase !== 'opening' || !o) {
    out.deploy = 'stowed';
  } else if (o.stage === 'throw') {
    out.deploy = 'hand';
    out.deployTime = o.time;
  } else if (o.stage === 'bag') {
    // The pilot chute inflates and the bridle comes tight, then the bag lifts off.
    const lift = o.timing.throwOut + (reserve ? 0.15 : 0.45);
    if (o.time < lift) {
      out.deploy = 'tow';
      out.deployTime = o.time - o.timing.throwOut;
    } else {
      out.deploy = 'bag';
      out.deployTime = o.time - lift;
      out.bagOut = ease((o.time - lift) / Math.max(0.1, o.timing.lineStretch - lift));
    }
  } else {
    // A reserve's free bag lets go once the canopy is out of it and filling.
    out.deploy = reserve && o.inflation > 0.6 ? 'free' : 'canopy';
    out.deployTime = o.time - o.timing.lineStretch;
    out.bagOut = 1;
  }
}

const rigFrame: RigFrame = {
  time: 0,
  dt: 0,
  wind: new THREE.Vector3(),
  airDensity: 1.2,
  deploy: 'stowed',
  deployTime: 0,
  bagOut: 0,
};
const releasedPos = new THREE.Vector3();
const releasedAtt = new THREE.Quaternion();
const releasedAir = new THREE.Vector3();
const releasedTop = new THREE.Vector3();
const fallTo = new THREE.Vector3();
const heapFrom = new THREE.Vector3();
const noHands = neutralControls();
const releasedRisers = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
/** The pilot's velocity last frame, to feel the harness push the legs about. */
const lastVel = vec3(Number.NaN);
const push = vec3();

/** The main once cut away, drawn where it drifts, then in a heap where it lands. */
function drawReleased(dt: number): void {
  const free = jump?.released;
  if (!releasedView || !free) return;
  releasedPos.set(free.pos.x, free.pos.y, free.pos.z);
  releasedAtt.set(free.att.x, free.att.y, free.att.z, free.att.w);
  releasedAir.copy(rigFrame.wind).sub(releasedTop.set(free.vel.x, free.vel.y, free.vel.z));
  releasedView.setCrumple(free.crumple);
  if (free.landedFor !== null) {
    fallTo.set(free.fallTo.x, 0, free.fallTo.z);
    releasedView.setHeap(ease(free.landedFor / 1.8), releasedPos, fallTo);
  }
  const ground = dz.groundAt(free.pos.x, free.pos.z);
  releasedView.update(
    releasedPos,
    releasedAtt,
    { time: airTime, dt, air: releasedAir, controls: noHands, hands: noHands, pilotAtt: null, ground },
    light,
  );
  releasedView.topAttach(releasedTop);
  releasedView.deployment.update({
    stage: 'canopy',
    dt,
    wind: rigFrame.wind,
    airDensity: env.airDensity,
    hand: releasedTop,
    pin: releasedTop,
    vel: releasedPos,
    launch: releasedPos,
    bagOut: releasedTop,
    canopyTop: releasedTop,
    canopy: releasedView,
    pilotChuteOpen: 0,
    stageTime: 10,
    risers: releasedRisers,
    ground,
  });
}

/**
 * What the legs do under canopy: get ready to land low down, and swing as
 * the harness pushes the body about.
 */
function updateLegs(dt: number, hanging: boolean): void {
  const s = model.state;
  if (dt > 0 && hanging && !Number.isNaN(lastVel.x)) {
    // What the harness does beyond holding the pilot up, in the pilot's axes.
    rotateInv(push, s.pilotAtt, vec3((s.vel.x - lastVel.x) / dt, (s.vel.y - lastVel.y) / dt + 9.81, (s.vel.z - lastVel.z) / dt));
    legSwing.update(dt, Math.max(-15, Math.min(15, -push.z)), Math.max(-15, Math.min(15, push.x)));
  } else if (!hanging) legSwing.reset();
  if (dt > 0) {
    lastVel.x = s.vel.x;
    lastVel.y = s.vel.y;
    lastVel.z = s.vel.z;
  }
  const height = feetHeight(model, dz.groundAt);
  legCues.prep = hanging ? ease((6 - height) / 4) : 0;
  legCues.fore = legSwing.fore;
  legCues.side = legSwing.side;
}

/** What the outside camera frames: pilot and canopy under canopy, the jumper alone in freefall. */
function aimChase(): ChaseTarget {
  const t = chaseTarget;
  const s = model.state;
  t.focus.set(s.pos.x, s.pos.y, s.pos.z);
  const inflation = jump ? jump.inflation : 1;
  const falling = jump !== null && (jump.phase === 'freefall' || (jump.phase === 'opening' && inflation === null));
  if (jump && jump.phase === 'plane') {
    // From behind the wing on the door's side, to see the jumper in it.
    t.heading = (runHeading(setup) - 38 * jump.plane.type.doorSide) * DEG;
    t.distance = 9;
    t.above = 0.1;
  } else if (falling && jump) {
    t.heading = jump.body.headingDeg() * DEG;
    t.distance = 5.5;
    t.above = 0.55;
  } else {
    // Halfway up the lines, so canopy and pilot are both in the picture.
    const k = arrival ? 1 - ease(arrival.time / 2) : (inflation ?? 0);
    const up = releasedTop.set(0, model.rig.canopyPos.y * 0.42 * k, 0).applyQuaternion(rigView.canopy.object.quaternion);
    t.focus.add(up);
    // On the ground the canopy tips over: the pilot's own heading then.
    if (arrival) {
      const q = model.state.pilotAtt;
      const ahead = releasedAir.set(0, 0, -1).applyQuaternion(releasedAtt.set(q.x, q.y, q.z, q.w));
      t.heading = Math.atan2(ahead.x, -ahead.z);
    } else t.heading = telemetry.headingDeg * DEG;
    t.distance = arrival ? 9 : 6 + 8 * k;
    t.above = arrival ? 0.3 : 0.16;
  }
  return t;
}

/** Which keys the side of the screen shows: what can be done right now. */
function keysPhase(): KeysPhase | null {
  if (menu.isOpen) return null;
  if (touchdown || arrival || impact) return 'ground';
  if (!jump || jump.phase === 'canopy' || jump.phase === 'opening') return 'canopy';
  return jump.phase === 'plane' ? 'plane' : 'freefall';
}

/** What the HUD says to do next. */
function cue(): string {
  if (flash && performance.now() < flash.until) return flash.text;
  const mainOut = jump !== null && jump.canopy === 'main' && (jump.phase === 'canopy' || (jump.phase === 'opening' && jump.inflation !== null));
  if (devices.cutawayHeld > 0 && devices.cutawayHeld < 1 && mainOut && !touchdown) {
    return `${T.cue.cuttingAway}<small>${T.cue.keepHolding(keyLabel('KeyX'))}</small>`;
  }
  if (!jump || impact) return '';
  const c = T.cue;
  if (jump.phase === 'freefall' && jump.cutawayAt !== null && jump.canopy === 'main') {
    return `${c.mainReleased}<small>${setup.gear.rsl ? c.rslPulls : c.pullReserve}</small>`;
  }
  const o = jump.opening;
  if (jump.phase === 'opening' && o?.malfunction === 'streamer' && o.stage === 'inflation' && o.time > o.timing.lineStretch + 1.2) {
    return `${c.streamer}<small>${c.holdToCutaway(keyLabel('KeyX'))}</small>`;
  }
  if (jump.phase === 'plane') {
    const exit = c.exitIn[jump.body.position];
    return `${c.greenLight}<small>${exit ? `${exit} · ` : ''}${c.spaceToExit}</small>`;
  }
  if (jump.phase === 'freefall') {
    if (jump.pullWhenFlat) return `${c.flat}<small>${c.toPull}</small>`;
    const name = c.positions[jump.body.position];
    if (jump.time > 1.5) return `${name}<small>${c.spaceToPull}</small>`;
    return name;
  }
  if (jump.stowed && !touchdown) {
    const which = jump.stowedL && jump.stowedR ? c.stowedBoth : jump.stowedL ? c.stowedLeft : c.stowedRight;
    return `${which}<small>${c.release}</small>`;
  }
  return '';
}

/** The drop zone from above for the menu's map, and what it was last drawn with. */
const topView = new TopView(renderer, scene, light.fog);
let mapDrawn = '';
let mapDrawnAt = -1e9;

/**
 * Draws the map's picture again when the scenery behind it has changed: the
 * drop zone, its photos coming in, the hour, the sky. Not more than five
 * times a second while a slider moves. Before the frame's own render.
 */
function drawMap(now: number): void {
  const size = menu.map.wantedSize();
  if (!menu.isOpen || !size || dz !== dzInfo(setup.dz).loaded()) return;
  const key = `${setup.dz}|${world.ready()}|${setup.hour}|${setup.weather.sky}|${size}`;
  if (key === mapDrawn || now - mapDrawnAt < 200) return;
  const groundY = dz.groundAt(dz.target.x, dz.target.z);
  // The pilot, the canopy and its shadows all hang from the rig's object; a cut-away canopy is on its own.
  const released = releasedView ? [releasedView.object, releasedView.shadow, releasedView.deployment.object] : [];
  const hide = [sky, light.clouds.layer, rigView.object, planeView.object, ...released];
  if (!topView.draw(menu.map.canvas, dz.target.x, dz.target.z, groundY, MAP_HALF, hide)) return;
  mapDrawn = key;
  mapDrawnAt = now;
  menu.map.pictureDrawn(setup.dz);
}

let last = performance.now();
let frameAverage = 1 / 60;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000;
  last = now;
  frameAverage += (elapsed - frameAverage) * 0.05;
  if (elapsed < 0.25 && settings.autoResolution) resolution.track(elapsed);

  devices.poll();
  // After the devices: Start may just have opened the menu, which then ignores it until let go.
  menu.poll();
  hud.setMenuOpen(menu.isOpen);
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

  // The main cut away goes its own way; the reserve takes its place overhead.
  if (jump?.released && !releasedView) releaseMain();
  if (jump && jump.canopy === 'reserve' && !rigView.canopy.reserve) attachReserve();
  const inflation = jump ? jump.inflation : 1;
  rigView.setInflation(inflation);
  // The hands are on the risers from line stretch until they let go on the
  // ground; otherwise they are free, and the body shows them.
  const onRisers = inflation !== null && !(arrival && arrival.time >= 0.25);
  rigView.setArms(onRisers);
  const pose = stance();
  const moving = live ? Math.min(elapsed, 0.1) : 0;
  const legs: [number, number] | undefined = arrival ? [arrival.legL, arrival.legR] : undefined;
  updateLegs(moving, pose === 'hanging' && !touchdown);
  rigView.body.setPose(posture.update(moving, pose, FREEFALL_STANCES.has(pose) ? devices.body : still, legs, legCues));
  rigView.body.showArms(!onRisers);
  rigView.body.setHeight(feetHeight(model, dz.groundAt));
  if (jump) rigView.body.setHandles(jump.cutawayAt === null, !(jump.canopy === 'reserve' && jump.log.reserveBy === 'hand'));
  // On the ground the canopy empties and goes down in a heap.
  if (arrival && !rigView.detached) {
    if (arrival.time < 0.05) heapFrom.set(model.state.pos.x, model.state.pos.y, model.state.pos.z);
    fallTo.set(arrival.fallTo.x, 0, arrival.fallTo.z);
    rigView.canopy.setHeap(ease((arrival.time - 0.3) / 2.2), heapFrom, fallTo);
  } else if (!rigView.detached) rigView.canopy.setHeap(0);
  rigFrame.time = airTime;
  rigFrame.dt = moving;
  rigFrame.wind.set(env.wind.x, env.wind.y, env.wind.z);
  rigFrame.airDensity = env.airDensity;
  deployStage(rigFrame);
  rigView.update(model, applied, dz.groundAt, light, hands, rigFrame);
  drawReleased(moving);
  if (jump) planeView.update(jump.plane);
  model.pilotPoint(eye, model.rig.eyePos);
  if (view === 'outside') {
    camera.layers.enable(GEAR_LAYER);
    camera.layers.enable(OUTSIDE_LAYER);
    chase.update(camera, aimChase(), Math.min(elapsed, 0.1), devices.lookYaw, devices.lookPitch, devices.zoom, dz.groundAt);
  } else {
    camera.layers.set(0);
    camera.position.set(eye.x, eye.y, eye.z);
    aimCamera(moving);
  }
  sky.position.copy(camera.position);
  // The windsock and the flags follow the gusts at their own height.
  if (live && setup.weather.gusts !== 'none') {
    const gust = windAt(air, setup.weather, 6, airTime);
    world.setWind(Math.atan2(-gust.x, gust.z) / DEG, Math.hypot(gust.x, gust.z));
  }
  if (!paused) light.clouds.drift(cloudWind.x, cloudWind.z, Math.min(elapsed, 0.1));
  world.update(camera.position, now / 1000);
  drawMap(now);
  renderer.render(scene, camera);
  if (view === 'eyes') {
    // The gear in the hands goes on top, from the same eye.
    gearCamera.position.copy(camera.position);
    gearCamera.quaternion.copy(camera.quaternion);
    // Keeping the colours and clearing only the depth puts it over the picture.
    renderer.autoClearColor = false;
    renderer.render(scene, gearCamera);
    renderer.autoClearColor = true;
  }

  // The air past the head, in the head's own axes. On the ground that is
  // what is left of the speed, then only the wind.
  model.pilotPointVelocity(eyeVel, model.rig.eyePos);
  air.set(env.wind.x - eyeVel.x, env.wind.y - eyeVel.y, env.wind.z - eyeVel.z);
  const airspeed = air.length();
  air.applyQuaternion(unlook.copy(camera.quaternion).invert());
  // The slider is most of the flapping: much less of it collapsed, none once off.
  const streamer = jump?.phase === 'opening' && jump.opening?.malfunction === 'streamer' && inflation !== null;
  const flapping = sliderState === 'open' || rigView.canopy.reserve ? 1 : sliderState === 'collapsed' ? 0.35 : 0.15;
  sound.update({
    airspeed: impact ? 0 : airspeed,
    fromRight: airspeed > 0.1 ? -air.x / airspeed : 0,
    live,
    canopy: streamer ? 1 : (inflation ?? 0) * flapping,
  });
  if (jump) {
    // The plane: how far, which way, and how fast it is going away, heard
    // from its nearest propeller.
    const plane = jump.plane;
    let near = Infinity;
    for (const hub of plane.type.propellers) {
      plane.point(toPlane, hub);
      const d = (toPlane.x - eye.x) ** 2 + (toPlane.y - eye.y) ** 2 + (toPlane.z - eye.z) ** 2;
      if (d < near) {
        near = d;
        propeller.x = toPlane.x;
        propeller.y = toPlane.y;
        propeller.z = toPlane.z;
      }
    }
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
  hud.setKeys(keysPhase(), devices.lastUsed, devices.padKind);
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
  const sim = { spawn, ramped, devices, camera, renderer, scene, sound, menu, fly, light, apply, resolution, settings };
  Object.defineProperties(sim, {
    model: { get: () => model },
    rig: { get: () => rig },
    setup: { get: () => setup },
    dz: { get: () => dz },
    world: { get: () => world },
    env: { get: () => env },
    jump: { get: () => jump },
    rigView: { get: () => rigView },
    releasedView: { get: () => releasedView },
    view: { get: () => view, set: (v: 'eyes' | 'outside') => (view = v) },
    arrival: { get: () => arrival },
  });
  Object.assign(window, { sim });
}
