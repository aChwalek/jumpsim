import * as THREE from 'three';
import { Sound } from './audio/sound';
import { InputDevices, type Action } from './input/devices';
import { rampControls } from './input/ramp';
import { RigView } from './render/rigView';
import {
  GROUND_LIGHT,
  HORIZON,
  Resolution,
  SUN,
  createCamera,
  createGearCamera,
  createRenderer,
  createScene,
} from './render/scene';
import { Arrival, LEGS_HANGING } from './sim/arrival';
import { FlightModel, neutralControls, type Environment } from './sim/flightModel';
import { detectTouchdown, feetHeight, type Touchdown } from './sim/landing';
import { AIR_DENSITY_SEA_LEVEL } from './sim/rig';
import { SIM_DT, emptyTelemetry, initTrimmed, readTelemetry } from './sim/telemetry';
import { DEG, vec3 } from './sim/vec';
import { Hud } from './ui/hud';
import { KIND_NAMES, Menu, loadGear, loadingLabel, rigFor, type Gear, type Start } from './ui/menu';
import { buildWorld } from './world/build';
import { createValbrise, inRect } from './world/dz';

const QUALITY_RATIOS = [1, 1.5, 2, 3];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const camera = createCamera();
const gearCamera = createGearCamera();
const { scene, sky } = createScene();
const hud = new Hud();
const devices = new InputDevices(canvas);
const sound = new Sound();

const dz = createValbrise();
const world = buildWorld(dz, { sun: SUN, ground: GROUND_LIGHT, sky: HORIZON });
scene.add(world.object);

let gear = loadGear();
let rig = rigFor(gear);
let model = new FlightModel(rig);
let rigView = new RigView(rig);
scene.add(rigView.object, rigView.pilot, rigView.shadow);
const menu = new Menu(gear);

function showGear(): void {
  const loading = `${rig.wingLoading.toFixed(2)} lb/ft² · ${loadingLabel(rig.wingLoading)}`;
  const kind = gear.kind === 'classic' ? '' : ` ${KIND_NAMES[gear.kind]}`;
  hud.setGear(`${gear.canopyAreaFt2} ft²${kind} · ${gear.exitWeightKg} kg · ${loading}`);
}

/** Swaps the canopy and the pilot's weight for the next jump. */
function equip(next: Gear): void {
  const same =
    next.kind === gear.kind && next.canopyAreaFt2 === gear.canopyAreaFt2 && next.exitWeightKg === gear.exitWeightKg;
  if (same) return;
  gear = next;
  scene.remove(rigView.object, rigView.pilot, rigView.shadow);
  rigView.dispose();
  rig = rigFor(gear);
  model = new FlightModel(rig);
  rigView = new RigView(rig);
  scene.add(rigView.object, rigView.pilot, rigView.shadow);
  showGear();
}

// Wind is given by where it comes from; the air moves the other way.
const windTo = (dz.wind.fromDeg + 180) * DEG;
const env: Environment = {
  wind: vec3(Math.sin(windTo) * dz.wind.speed, 0, -Math.cos(windTo) * dz.wind.speed),
  airDensity: AIR_DENSITY_SEA_LEVEL,
};

let quality = Number(localStorage.getItem('quality') ?? 2);
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

function spawn(kind: Start): void {
  scenario = kind;
  const s = dz.spawns[kind];
  const y = dz.groundAt(s.x, s.z) + s.height - rig.feetPos.y;
  initTrimmed(model, vec3(s.x, y, s.z), s.headingDeg, env);
  Object.assign(ramped, neutralControls());
  touchdown = null;
  arrival = null;
  verdict = null;
  stepsHeard = 0;
  rigView.setLegs(LEGS_HANGING, LEGS_HANGING);
  rigView.setArms(true);
  paused = false;
  devices.recentre();
  hud.showResult(null);
}

const actions: Record<Action, () => void> = {
  reset: () => spawn(scenario),
  spawnPattern: () => spawn('pattern'),
  spawnFinal: () => spawn('final'),
  toggleHud: () => hud.toggle(),
  togglePause: () => (paused = !paused),
  toggleSound: () => sound.toggleMute(),
  recentre: () => devices.recentre(),
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
  equip(chosen);
  spawn(start);
  fly();
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
  while (left > 1e-5 && !touchdown) {
    // Whole steps, then one short step so the sim lands exactly on the frame.
    const dt = Math.min(SIM_DT, left);
    left -= dt;
    rampControls(ramped, devices.pulls, dt);
    applied.brakeL = Math.max(ramped.brakeL, devices.analogBrakeL);
    applied.brakeR = Math.max(ramped.brakeR, devices.analogBrakeR);
    applied.frontL = ramped.frontL;
    applied.frontR = ramped.frontR;
    model.step(dt, applied, env);
    touchdown = detectTouchdown(model, dz.groundAt);
    if (touchdown) {
      const landed = touchdown;
      const feet = model.pilotPoint(vec3(), rig.feetPos);
      const wet = dz.water.some((pond) => inRect(pond, feet.x, feet.z));
      const distance = Math.hypot(feet.x - dz.target.x, feet.z - dz.target.z);
      arrival = new Arrival(model, landed, { groundAt: dz.groundAt, wet, wind: env.wind });
      verdict = () => hud.showResult(landed, distance, wet);
      sound.land({ sink: landed.sink, groundSpeed: landed.groundSpeed, wet });
      // What is left of the frame is spent on the ground.
      arrival.update(left);
    }
  }
}

const eye = vec3();
const eyeVel = vec3();
const air = new THREE.Vector3();
const unlook = new THREE.Quaternion();
const look = new THREE.Quaternion();
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const head = new THREE.Euler(0, 0, 0, 'YXZ');
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
let last = performance.now();
let frameAverage = 1 / 60;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000;
  last = now;
  frameAverage += (elapsed - frameAverage) * 0.05;
  if (elapsed < 0.25) resolution.track(elapsed);

  devices.poll();
  if (!waiting && !paused) {
    const seconds = Math.min(elapsed, 0.1);
    if (arrival) arrival.update(seconds);
    else simulate(seconds);
    if (arrival) {
      rigView.setLegs(arrival.legL, arrival.legR);
      rigView.setArms(arrival.time < 0.25);
      for (; stepsHeard < arrival.steps; stepsHeard++) sound.step(arrival.speed);
      if (arrival.done && verdict) {
        verdict();
        verdict = null;
      }
    }
  }

  rigView.update(model, applied, dz.groundAt, SUN);
  model.pilotPoint(eye, rig.eyePos);
  camera.position.set(eye.x, eye.y, eye.z);
  // The head turns and banks with the harness but steadies its own pitch:
  // eyes stay on the ground ahead when the pilot swings forward in the flare.
  const att = model.state.pilotAtt;
  head.setFromQuaternion(look.set(att.x, att.y, att.z, att.w), 'YXZ');
  head.x = headPitch(head.x);
  camera.quaternion.setFromEuler(head);
  // The resting pitch goes after the look yaw, so that glancing sideways
  // in level flight does not tilt the horizon.
  lookEuler.set(HEAD_PITCH + devices.lookPitch, -devices.lookYaw, 0);
  camera.quaternion.multiply(look.setFromEuler(lookEuler));
  sky.position.copy(camera.position);
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
  sound.update({ airspeed, fromRight: airspeed > 0.1 ? -air.x / airspeed : 0, live: !waiting && !paused });

  readTelemetry(model, env, telemetry);
  hud.update(
    {
      height: Math.max(0, feetHeight(model, dz.groundAt)),
      verticalSpeed: telemetry.verticalSpeed,
      groundSpeed: telemetry.groundSpeed,
      headingDeg: telemetry.headingDeg,
      controls: applied,
      held: devices.pulls.hold,
      fps: 1 / frameAverage,
      renderScale: resolution.scale,
      windFromDeg: dz.wind.fromDeg,
      windSpeed: dz.wind.speed,
      muted: sound.muted,
    },
    elapsed,
  );
}

showGear();
spawn('pattern');
menu.open(false);
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // The rig can change between jumps: these always give the current one.
  const sim = { spawn, ramped, devices, camera, renderer, scene, sound, menu, equip, fly };
  Object.defineProperties(sim, { model: { get: () => model }, rig: { get: () => rig }, gear: { get: () => gear } });
  Object.assign(window, { sim });
}
