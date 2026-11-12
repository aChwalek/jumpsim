import * as THREE from 'three';
import { Altisonic } from './audio/altisonic';
import { Sound } from './audio/sound';
import { T, lang, num, setLanguage } from './i18n';
import { InputDevices, type Action, type PadMode } from './input/devices';
import { keyLabel, readKeyboardLayout } from './input/keyLabels';
import { noWraps, rampControls, wrapTravel } from './input/ramp';
import { CANOPY_COLORS, RESERVE_PALETTE } from './render/canopyColors';
import { CLOUD_BASE, CLOUD_DEPTH } from './render/clouds';
import { daylight, sunPosition } from './render/daylight';
import { PlaneView } from './render/planeView';
import { CanopyView, type SliderState } from './render/canopyView';
import { ChaseCamera, type ChaseTarget } from './render/chaseCamera';
import { cycle, lockedChase, pickPlayer, pickPoint, type Target } from './render/lockOn';
import { FREEFALL_STANCES, LegSwing, Posture, doorStance, type LegCues, type Stance } from './render/posture';
import { RigView, type RigFrame } from './render/rigView';
import { RagdollView } from './render/ragdollView';
import { SMOKE_BURN, SmokeTrail } from './render/smoke';
import { copyPose, type Pose } from './render/body';
import { TopView } from './render/topView';
import { FIELD_OF_VIEW, GEAR_LAYER, OUTSIDE_LAYER, Resolution, createCamera, createGearCamera, createRenderer, createScene } from './render/scene';
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
  outfitOf,
  sameSuit,
  suitOf,
  wingColor,
  type Setup,
  type Start,
} from './setup';
import { Arrival } from './sim/arrival';
import { hasWings } from './sim/suit';
import { J, JOINT_COUNT, PART, Ragdoll } from './sim/ragdoll';
import { Recorder, type Replay, type ReplayFrame } from './crashReplay';
import { airDensityAt } from './sim/atmosphere';
import { FlightModel, neutralControls, type Environment } from './sim/flightModel';
import { noBodyInputs, stepPosition, type BodyPosition } from './sim/freefall';
import { Jump, type JumpOptions } from './sim/jump';
import { detectTouchdown, feetHeight, type Touchdown } from './sim/landing';
import { AIR_DENSITY_SEA_LEVEL } from './sim/rig';
import type { RunUp } from './sim/runUp';
import { SIM_DT, emptyTelemetry, initTrimmed, readTelemetry } from './sim/telemetry';
import { DEG, quat, rotateInv, vec3 } from './sim/vec';
import { gustPeakKmh, windAt } from './sim/weather';
import { Hud } from './ui/hud';
import type { KeysPhase } from './ui/keys';
import { Menu } from './ui/menu';
import { Markers, type MarkerTarget } from './net/markers';
import { Multiplayer, newRoomName, playersIn, roomFromUrl, roomLink, setRoomInUrl } from './net/multiplayer';
import { cleanName, publicDz, publicRoom, sameShared, sharedPart } from './net/room';
import { buildWorld, type World } from './world/build';
import { isWet, solidOf, spawnsFor, type DzPack } from './world/dz';
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
/** What the feet can stand on or hit: the ground, and roofs and walls where there are some. */
let solid = solidOf(dz);
let world: World = buildWorld(dz, light);
scene.add(world.object);

let rig = rigFor(setup.gear);
let reserveRig = reserveRigFor(setup.gear);
let model = new FlightModel(rig);
let rigView = new RigView(rig, CANOPY_COLORS[setup.gear.color].cells, light);
scene.add(rigView.object);
/** The main once cut away, drifting down on its own; drawn until the next jump. */
let releasedView: CanopyView | null = null;
/** What the main's slider is doing. */
let sliderState: SliderState = 'open';
/** Where the camera is: the pilot's eyes, or outside following them. */
let view: 'eyes' | 'outside' = 'eyes';
const chase = new ChaseCamera();
const chaseTarget: ChaseTarget = { focus: new THREE.Vector3(), heading: 0, distance: 10, above: 0.2 };
/** What the camera can be locked on: another player or a point on the ground; and whether it is. */
let target: Target | null = null;
let locked = false;
/** 0 free, 1 locked: the eyes turn to the target, and back, over a moment. */
let lockBlend = 0;
/** How long the eyes take to turn to the target or back, s. */
const LOCK_TURN = 0.35;
/** Where the target is, or was when last seen. */
const targetAt = new THREE.Vector3();
const lockedView = new THREE.Quaternion();
const lockMatrix = new THREE.Matrix4();
const ahead = new THREE.Vector3();
/** The mark over a point target; players have theirs already. */
let pointMarker: Markers | null = null;
const pointMarks: MarkerTarget[] = [];
const legSwing = new LegSwing();
const legCues: LegCues = { prep: 0, fore: 0, side: 0 };
/** A short message over the HUD's cue, until a time (performance.now ms). */
let flash: { text: string; until: number } | null = null;
const planeView = new PlaneView();
scene.add(planeView.object);
/** The body thrown about by a crash, drawn in place of the pilot's own. */
const ragdollView = new RagdollView();
scene.add(ragdollView.object);
/** The smoke from the canister on the ankle, if there is one, and when it was lit (air time, s). */
const smoke = new SmokeTrail('red', light);
scene.add(smoke.object);
let smokeLitAt: number | null = null;
fitSmoke();
for (const m of ragdollView.materials()) if (m instanceof THREE.MeshLambertMaterial) light.clouds.shade(m, 'light');
const menu = new Menu(setup, settings);
/** Jumping with others, in the room the address names (`?room=name`). */
let net: Multiplayer | null = null;
/** How many were in the room when the HUD last said. */
let playersShown = 0;

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
  solid = solidOf(dz);
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
  fitSmoke();
  fitSuit();
}

/** The suit as the gear has it, its wings of the canopy's colour, in the colours worn. */
function fitSuit(): void {
  const suit = suitOf(setup.gear);
  rigView.body.setSuit(suit, wingColor(setup.gear.color));
  posture.wings = hasWings(suit);
  const outfit = outfitOf(setup.gear);
  rigView.setOutfit(outfit);
  ragdollView.setOutfit(outfit);
}

/** The canister on the ankle as the gear has it, and the colour of its smoke. */
function fitSmoke(): void {
  const kind = setup.gear.smoke;
  rigView.body.setSmoke(kind);
  if (kind !== 'none') smoke.setColor(kind);
}

const smokeFrom = new THREE.Vector3();
const smokeBefore = new THREE.Vector3();
const smokeVel = new THREE.Vector3();
let smokeWasOut = false;

/** The canister is lit on leaving the plane or the object (at once under canopy), and smokes for a while. */
function drawSmoke(dt: number): void {
  const kind = setup.gear.smoke;
  const out = !jump || (jump.phase !== 'plane' && jump.phase !== 'standing');
  if (kind !== 'none' && out && smokeLitAt === null) smokeLitAt = airTime;
  const burning = kind !== 'none' && smokeLitAt !== null && airTime - smokeLitAt < SMOKE_BURN;
  if (!burning || dt <= 0) {
    smokeWasOut = false;
    return smoke.update(dt, null, smokeVel, rigFrame.wind);
  }
  // From the foot thrown about by a crash, or from the canister on the pilot's own.
  if (ragdoll) smokeFrom.fromArray(liveJoints, 3 * J.footR);
  else rigView.body.smokePoint(smokeFrom);
  // Its speed from where it was: right whatever moves it (flight, legs, walking, a crash).
  if (smokeWasOut) smokeVel.subVectors(smokeFrom, smokeBefore).divideScalar(dt);
  else smokeVel.set(model.state.vel.x, model.state.vel.y, model.state.vel.z);
  smokeBefore.copy(smokeFrom);
  smokeWasOut = true;
  smoke.update(dt, smokeFrom, smokeVel, rigFrame.wind);
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
  const together = net ? ` · ${publicDz(net.room) ? T.menu.room.hudPublic : net.room} (${net.players})` : '';
  hud.setGear(`${dz.name} · ${gear.canopyAreaFt2} ft²${kind} · ${gear.exitWeightKg} kg · ${loading}${together}`);
  playersShown = net?.players ?? 0;
  net?.setHello(setup.dz, gear);
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
  fitSmoke();
  fitSuit();
  showGear();
  return setup.dz === before.dz && sameFlight(setup.gear, before.gear) && sameSuit(setup.gear, before.gear);
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

/** The name the others see: made up the first time. */
function playerName(): string {
  if (!settings.playerName) {
    settings.playerName = `${T.menu.room.defaultName} ${10 + Math.floor(Math.random() * 90)}`;
    saveSettings(settings);
  }
  return settings.playerName;
}

/** Goes into a room: its address becomes the page's, to share. */
function joinRoom(name: string): void {
  leaveRoom(false);
  // A public room is at its drop zone, whoever leads it.
  const pinned = publicDz(name);
  if (pinned) menu.chooseDz(pinned);
  setRoomInUrl(name);
  net = new Multiplayer(name, scene, () => light, playerName(), {
    setup: (shared) => {
      // Whoever leads changed the jump: ready for the old one is not ready for this one.
      // A public room's load leaves anyway: who is aboard stays aboard.
      if (sameShared(shared, sharedPart(menu.current))) return;
      if (!net?.isPublic) net?.setReady(false);
      menu.applyShared(shared);
    },
    start: (start, shared) => menu.startShared(shared, start),
    changed: showRoom,
    exited: showExit,
  });
  net.setShared(sharedPart(menu.current));
  showRoom();
  showGear();
}

function leaveRoom(fromUrl = true): void {
  if (!net) return;
  net.dispose();
  net = null;
  if (fromUrl) setRoomInUrl(null);
  showRoom();
  showGear();
}

/** Asks how many are in the public room of the drop zone on the menu, for the menu to say. */
async function countPublic(): Promise<void> {
  if (net || !menu.isOpen) return;
  const { dz } = menu.current;
  const players = await playersIn(publicRoom(dz));
  if (menu.current.dz === dz) menu.setPublicCount(players);
}
setInterval(() => void countPublic(), 15_000);
/** The drop zone last counted: another one is asked at once. */
let countedDz = setup.dz;

/** Who has just left the plane, said over the HUD's cue a moment. */
let exits: string[] = [];
function showExit(name: string): void {
  const now = performance.now();
  if (!flash || now >= flash.until) exits = [];
  exits.push(name.replace(/[<>&"]/g, ''));
  flash = { text: T.cue.exited(exits.join(', ')), until: now + 3000 };
}

/** The room on the menu's home screen. */
function showRoom(): void {
  if (!net) return menu.setRoom(null);
  const { state } = net;
  const host = state.host;
  menu.setRoom({
    room: net.room,
    link: roomLink(net.room),
    online: state.selfId !== null,
    isHost: state.isHost,
    hostName: host?.name ?? '',
    ready: net.isReady,
    players: state.list.map((p) => ({ name: p.name, ready: p.ready, self: p.id === state.selfId, host: p.id === host?.id })),
    publicDz: publicDz(net.room),
    loadAt: net.isPublic ? net.nextLoadAt : null,
  });
}

menu.onCreateRoom = () => joinRoom(newRoomName());
menu.onJoinPublic = () => joinRoom(publicRoom(menu.current.dz));
menu.onLeaveRoom = () => {
  leaveRoom();
  void countPublic();
};
menu.onReady = (ready) => net?.setReady(ready);
menu.onStartNow = () => net?.startNow();
menu.onSetupChange = (chosen) => {
  // In a public room, another drop zone is another room.
  const pinned = net && publicDz(net.room);
  if (pinned && chosen.dz !== pinned) return joinRoom(publicRoom(chosen.dz));
  net?.setShared(sharedPart(chosen));
  if (chosen.dz !== countedDz) {
    countedDz = chosen.dz;
    menu.setPublicCount(null);
    void countPublic();
  }
};
menu.onRename = () => {
  const name = prompt(T.menu.room.renamePrompt, playerName());
  if (name === null || !cleanName(name)) return;
  settings.playerName = cleanName(name);
  saveSettings(settings);
  net?.setName(settings.playerName);
};
applySettings();

const ramped = neutralControls();
const applied = neutralControls();
/** Time each toggle has been kept fully pulled, for wraps. */
const wraps = noWraps();
/** A trigger this far down is fully pulled. */
const FULL_TRIGGER = 0.98;
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
fitSuit();
const still = noBodyInputs();
/** Where the hands have the toggles: stowed brakes keep the canopy's short of them. */
const hands = neutralControls();
/** Seconds flown under canopy on this jump, for the logbook. */
let canopyTime = 0;
/** A crash: the body goes limp and the ground does the rest. */
let ragdoll: Ragdoll | null = null;
/** The ragdoll's hits already heard. */
let hitsHeard = 0;
let cried = 0;
let groaned = false;
/** The last seconds of the jump, and all of a crash. */
const recorder = new Recorder();
/** The end of the jump being shown again, and whether a crash has been once already. */
let replay: Replay | null = null;
let replayed = false;
/** The live state of the pilot, kept while a replay takes the model over. */
const kept = { pos: vec3(), vel: vec3(), att: quat(), pilotAtt: quat(), deflationL: 0, deflationR: 0 };
/** On the ground: how far the canopy has been gathered up into the arms, 0 to 1; null before it starts. */
let gather: number | null = null;
/** Seconds to gather a canopy up off the ground. */
const GATHER_TIME = 3.5;
/** Where the crash happened and the way the pilot was going, for the replay's camera. */
const crashPoint = new THREE.Vector3();
let crashHeading = 0;

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
      jump && log && jump.phase !== 'plane' && jump.phase !== 'standing'
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

/** What the jump gets from the gear: the container, and its reserve if it has one; the suit. */
function rigOptions(): JumpOptions {
  const { container, rsl } = setup.gear;
  return { container, reserve: reserveRig, rsl: container === 'sport' && rsl, solidAt: solid, suit: suitOf(setup.gear) };
}

/** One canopy and no reserve: a BASE container. */
const singleCanopy = (): boolean => (jump ? jump.single : setup.gear.container === 'base');

function spawn(kind: Start): void {
  // No BASE object here: from the plane instead.
  if (kind === 'base' && !dz.base) kind = 'plane';
  scenario = kind;
  airTime = 0;
  resetCanopies();
  const spots = spawnsFor(dz, setup.weather.windFromDeg, { headingDeg: runHeading(setup), height: setup.jump.exitHeight });
  const rate = setup.jump.malfunction;
  const unlucky = rate === 'always' || (rate === 'sometimes' && Math.random() < 1 / MALFUNCTION_ODDS);
  if (kind === 'plane') {
    windAt(env.wind, setup.weather, spots.plane.height, airTime);
    const malfunction = unlucky ? 'streamer' : null;
    jump = new Jump(model, spots.plane, env, dz.groundAt, Math.random, { ...rigOptions(), malfunction, spot: setup.jump.exitSpot });
  } else if (kind === 'base') {
    const b = dz.base!;
    windAt(env.wind, setup.weather, b.height, airTime);
    // Off a bridge, no run: from the lip of the deck.
    const ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg: b.headingDeg, height: b.height, standing: b.runUp === 0 } as const;
    jump = new Jump(model, ledge, env, dz.groundAt, Math.random, { ...rigOptions(), malfunction: unlucky ? 'offHeading' : null });
  } else {
    jump = null;
    const s = spots[kind];
    const y = dz.groundAt(s.x, s.z) + s.height - rig.feetPos.y;
    env.airDensity = airDensityAt(y);
    windAt(env.wind, setup.weather, s.height + canopyAboveFeet(), airTime);
    initTrimmed(model, vec3(s.x, y, s.z), s.headingDeg, env);
  }
  planeView.object.visible = jump?.plane != null;
  impact = false;
  Object.assign(ramped, neutralControls());
  Object.assign(wraps, noWraps());
  Object.assign(applied, ramped);
  Object.assign(hands, ramped);
  touchdown = null;
  arrival = null;
  verdict = null;
  stepsHeard = 0;
  endCrash();
  canopyTime = 0;
  smoke.clear();
  smokeLitAt = null;
  smokeWasOut = false;
  posture.reset();
  legSwing.reset();
  chase.reset();
  // Another drop zone: the point picked on the last one means nothing here.
  if (target?.kind === 'point') {
    target = null;
    locked = false;
  }
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

/**
 * B, Y, X on the gamepad: straight into that position, in freefall or to go
 * out in. The same button again, back to the belly.
 */
function takePosition(position: BodyPosition): void {
  if (!jump) return;
  flyInto(jump.body.position === position ? 'belly' : position);
}

/**
 * On foot, free to walk and turn: on top of the object before the run-up,
 * or on the ground once walking. Then the mouse and the right stick turn
 * the body, as in any first-person game. Not on the lip of a bridge, where
 * nobody turns round, nor with the camera locked on a target.
 */
function feetTurn(): RunUp | null {
  if (locked || replay) return null;
  if (arrival) return gather !== null && gather < 1 ? null : arrival.walker;
  return jump?.phase === 'standing' && jump.runUp && !jump.runUp.standing ? jump.runUp : null;
}

/** What the gamepad's right stick and B, Y, X are for at this moment of the jump. */
function padMode(): PadMode {
  if (!jump || touchdown || arrival || impact) return 'default';
  if (jump.phase === 'freefall') return 'freefall';
  return jump.phase === 'plane' || jump.phase === 'standing' ? 'exit' : 'default';
}

/**
 * ↑ / ↓: in freefall a quarter somersault, forwards or backwards, into the
 * next position; in the door, the position to go out in.
 */
function flyStep(dir: -1 | 1): void {
  if (paused || !jump) return;
  if (jump.phase === 'freefall') jump.flip(dir);
  else flyInto(stepPosition(jump.body.position, dir > 0 ? 'up' : 'down'));
}

/** A short message over the HUD's cue. */
function say(text: string, small = '', ms = 1800): void {
  flash = { text: small ? `${text}<small>${small}</small>` : text, until: performance.now() + ms };
}

/** Where the target is now, if it can be seen: a player is not while in their plane. */
function targetPos(): THREE.Vector3 | null {
  if (!target) return null;
  if (target.kind === 'point') return targetAt.copy(target.pos);
  return net?.whereIs(target.id, targetAt) ?? null;
}

/** A new target, or none (which frees the camera); and the HUD says so. */
function setTarget(next: Target | null): void {
  target = next;
  if (!next) {
    locked = false;
    return say(T.cue.noTarget);
  }
  const what = next.kind === 'point' ? T.cue.targetPoint : (net?.nameOf(next.id) ?? '…');
  say(`${T.cue.target} · ${what}`, locked ? '' : T.cue.lockHint(keyLabel('KeyL')));
}

/** The next or previous player in sight as the target. */
function cycleTarget(step: 1 | -1): void {
  const ids = net?.inSight().map((p) => p.id) ?? [];
  const id = cycle(ids, target?.kind === 'player' ? target.id : null, step);
  if (id) setTarget({ kind: 'player', id });
  else say(T.cue.noPlayer);
}

/** In freefall R goes up: it only starts again once out of it. */
const inFreefall = (): boolean => jump !== null && (jump.phase === 'freefall' || jump.phase === 'opening');

const actions: Record<Action, () => void> = {
  reset: () => {
    if (!inFreefall() || impact) spawn(scenario);
  },
  spawnPattern: () => spawn('pattern'),
  spawnFinal: () => spawn('final'),
  spawnPlane: () => spawn('plane'),
  spawnBase: () => spawn('base'),
  jump: () => {
    if (paused) return;
    // Space skips a replay, and on the ground gathers the canopy up.
    if (replay) stopReplay();
    else if (arrival?.canWalk && gather === null && !rigView.detached && arrival.time > 2) gather = 0;
    else jump?.act();
  },
  flyLeft: () => {
    if (!paused) jump?.roll(-1);
  },
  flyRight: () => {
    if (!paused) jump?.roll(1);
  },
  track: () => {
    if (!paused) devices.padTrack = !devices.padTrack;
  },
  posBack: () => takePosition('back'),
  posSit: () => takePosition('sit'),
  posHeadDown: () => takePosition('headDown'),
  flyUp: () => flyStep(1),
  flyDown: () => flyStep(-1),
  toggleHud: () => hud.toggle(),
  togglePause: () => (paused = !paused),
  replay: () => {
    if (replay) stopReplay();
    else if (canReplay()) playReplay();
  },
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
  pickTarget: () => {
    // What is in the middle of the screen: a player near it, or else the ground there.
    camera.getWorldDirection(ahead);
    const id = net ? pickPlayer(camera.position, ahead, net.inSight()) : null;
    if (id) return setTarget({ kind: 'player', id });
    const point = pickPoint(camera.position, ahead, solid);
    setTarget(point ? { kind: 'point', pos: point } : null);
  },
  nextTarget: () => cycleTarget(1),
  prevTarget: () => cycleTarget(-1),
  lock: () => {
    if (!target) return say(T.cue.noTarget, T.cue.pickHint(keyLabel('KeyT')));
    locked = !locked;
    // The mouse then turns the view about the target, from straight at it.
    devices.recentre();
    say(locked ? T.cue.locked : T.cue.unlocked);
  },
  lockOrRecentre: () => (target ? actions.lock() : devices.recentre()),
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
    void countPublic();
  },
  padMenu: () => {
    if (!menu.isOpen) actions.openMenu();
  },
};
hud.onCard = (action) => {
  if (menu.isOpen) return;
  if (action === 'retry') {
    actions.reset();
    devices.capture();
  }
  else if (action === 'change') actions.openMenu();
  else actions.replay();
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
  // Tab picks the next player: not the next thing on the page.
  if (e.code === 'Tab' && !menu.isOpen) e.preventDefault();
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
      jump.trackIt(devices.tracking);
      // A track the gamepad turned on ends with the freefall, or at the pull.
      if (!jump.body.tracking) devices.padTrack = false;
      jump.step(dt, jump.phase === 'standing' ? devices.feet : devices.body, env);
      if (jump.impact) {
        hitWithoutCanopy(jump);
        return;
      }
    }
    if (!flying && jump) {
      // The same keys move the body in freefall: the toggles wait, and the
      // canopy comes out on its stowed brakes.
      Object.assign(ramped, neutralControls());
      Object.assign(wraps, noWraps());
      Object.assign(applied, ramped);
      Object.assign(hands, ramped);
      jump.holdStows(applied);
      continue;
    }
    rampControls(ramped, devices.pulls, dt);
    const pulls = devices.pulls;
    // Kept pulled all the way, a toggle goes on into wraps and can stall the canopy.
    const fullL = (pulls.brakeL && ramped.brakeL >= 1) || devices.analogBrakeL >= FULL_TRIGGER;
    const fullR = (pulls.brakeR && ramped.brakeR >= 1) || devices.analogBrakeR >= FULL_TRIGGER;
    applied.brakeL = Math.max(ramped.brakeL, devices.analogBrakeL) + wrapTravel(wraps, 'brakeL', fullL, pulls.hold, dt);
    applied.brakeR = Math.max(ramped.brakeR, devices.analogBrakeR) + wrapTravel(wraps, 'brakeR', fullR, pulls.hold, dt);
    applied.frontL = ramped.frontL;
    applied.frontR = ramped.frontR;
    Object.assign(hands, applied);
    jump?.holdStows(applied);
    const s = model.state;
    beforeStep.x = s.pos.x;
    beforeStep.y = s.pos.y;
    beforeStep.z = s.pos.z;
    model.step(dt, applied, env);
    canopyTime += dt;
    touchdown = detectTouchdown(model, solid);
    if (touchdown && hitSide()) {
      touchdown = null;
      return;
    }
    if (touchdown) {
      const landed = touchdown;
      const feet = model.pilotPoint(vec3(), rig.feetPos);
      const wet = isWet(dz, feet.x, feet.z);
      const distance = Math.hypot(feet.x - dz.target.x, feet.z - dz.target.z);
      const log = jump?.log ?? null;
      // On the ground the canopy is blown by the wind at its own height.
      windAt(env.wind, setup.weather, canopyAboveFeet(), airTime);
      arrival = new Arrival(model, landed, { groundAt: solid, wet, wind: vec3(env.wind.x, env.wind.y, env.wind.z) });
      verdict = () => {
        hud.showResult(landed, distance, wet, log);
        // The mouse, for the card's buttons.
        devices.release();
      };
      recorder.crash();
      logThisJump(landed.rating, landed.sink, landed.groundSpeed, distance, wet);
      sound.land({ sink: landed.sink, groundSpeed: landed.groundSpeed, wet });
      // What is left of the frame is spent on the ground.
      arrival.update(left);
      if (landed.rating === 'hard' || landed.rating === 'crash') startRagdoll(true);
    }
  }
}

/** Where the pilot was before the last step under canopy. */
const beforeStep = vec3();
const feetNow = vec3();

/**
 * Under canopy, the feet have come in through the side of what they met (a
 * tower's wall) rather than down onto it: the pilot stops against it.
 */
function hitSide(): boolean {
  const s = model.state;
  const feet = model.pilotPoint(feetNow, rig.feetPos);
  const top = solid(feet.x, feet.z, feet.y);
  if (top - (feet.y - (s.pos.y - beforeStep.y)) <= 0.5) return false;
  impact = true;
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  s.pos.x = beforeStep.x;
  s.pos.z = beforeStep.z;
  s.vel.x = s.vel.y = s.vel.z = 0;
  sound.land({ sink: speed, groundSpeed: 0, wet: false });
  hud.showStrike('canopy', speed, jump?.log ?? null);
  recorder.crash();
  devices.release();
  logThisJump('impact', speed, 0);
  return true;
}

/** The ground came first, or a wall. The pilot stays where they hit, no lower than it. */
function hitWithoutCanopy(j: Jump): void {
  impact = true;
  const s = model.state;
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  s.pos.y -= Math.min(0, j.clearance()) - 0.05;
  // Into open ground, the body goes on without the pilot.
  if (!j.struck) startRagdoll(j.inflation !== null);
  recorder.crash();
  devices.release();
  s.vel.x = s.vel.y = s.vel.z = 0;
  sound.land({ sink: speed, groundSpeed: 0, wet: false });
  if (j.struck) hud.showStrike(j.phase === 'opening' ? 'opening' : 'freefall', speed, j.log);
  else hud.showImpact(j.log, j.phase === 'opening', speed, j.opening?.malfunction ?? null);
  logThisJump('impact', speed, 0);
}

/** Where the hands are on the risers, pilot frame: up by the rings. */
const ON_RISERS = { left: new THREE.Vector3(-0.2, 0.12, -0.02), right: new THREE.Vector3(0.2, 0.12, -0.02) };
/** The trunk's attitude in the pilot frame as the ragdoll took over, and the middle of its spine there. */
const trunkStart = new THREE.Quaternion();
const spineStart = new THREE.Vector3();
const basis = new THREE.Matrix4();
const qa = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const vd = new THREE.Vector3();

/** The trunk's attitude from its neck, pelvis and shoulders. */
function trunkAttitude(out: THREE.Quaternion, neck: THREE.Vector3, pelvis: THREE.Vector3, l: THREE.Vector3, r: THREE.Vector3): THREE.Quaternion {
  const up = va.subVectors(neck, pelvis).normalize();
  const right = vb.subVectors(r, l);
  right.addScaledVector(up, -right.dot(up)).normalize();
  const back = vc.crossVectors(right, up);
  return out.setFromRotationMatrix(basis.makeBasis(right, up, back));
}

/** The body as drawn right now goes limp, with the speed each part of it has. */
function startRagdoll(onRisers: boolean): void {
  const joints = rigView.body.joints(onRisers ? ON_RISERS : null);
  const pos = joints.map((j) => model.pilotPoint(vec3(), j));
  const vel = joints.map((j) => model.pilotPointVelocity(vec3(), j));
  ragdoll = new Ragdoll(pos, vel, solid);
  trunkAttitude(trunkStart, joints[J.neck]!, joints[J.pelvis]!, joints[J.shoulderL]!, joints[J.shoulderR]!);
  spineStart.lerpVectors(joints[J.neck]!, joints[J.pelvis]!, 0.5);
  hitsHeard = 0;
  cried = 0;
  groaned = false;
  replayed = false;
  recorder.crash();
  const s = model.state;
  crashPoint.set(s.pos.x, solid(s.pos.x, s.pos.z, s.pos.y), s.pos.z);
  const over = Math.hypot(s.vel.x, s.vel.z);
  const ahead = over > 0.5 ? va.set(s.vel.x, 0, s.vel.z) : va.set(0, 0, -1).applyQuaternion(qa.set(s.pilotAtt.x, s.pilotAtt.y, s.pilotAtt.z, s.pilotAtt.w));
  crashHeading = Math.atan2(ahead.x, -ahead.z);
}

/** The pilot follows the ragdoll: the flight model's state is put where its trunk is. */
function followRagdoll(r: Ragdoll): void {
  const p = r.pos;
  const at = (i: number, v: THREE.Vector3) => v.set(p[i]!.x, p[i]!.y, p[i]!.z);
  const neck = at(J.neck, new THREE.Vector3());
  const pelvis = at(J.pelvis, new THREE.Vector3());
  trunkAttitude(qa, neck, pelvis, at(J.shoulderL, new THREE.Vector3()), at(J.shoulderR, vd));
  // The pilot frame turned as the trunk has turned since the start.
  qa.multiply(new THREE.Quaternion().copy(trunkStart).invert());
  const s = model.state;
  s.pilotAtt.x = qa.x;
  s.pilotAtt.y = qa.y;
  s.pilotAtt.z = qa.z;
  s.pilotAtt.w = qa.w;
  const spine = neck.lerp(pelvis, 0.5).sub(va.copy(spineStart).applyQuaternion(qa));
  s.pos.x = spine.x;
  s.pos.y = spine.y;
  s.pos.z = spine.z;
  const v = r.velocity(vec3(), J.pelvis);
  s.vel.x = v.x;
  s.vel.y = v.y;
  s.vel.z = v.z;
  s.pilotOmega.x = s.pilotOmega.y = s.pilotOmega.z = 0;
}

/** What the crash sounds like: every knock, the bones that go, and the pilot's comments. */
function hearRagdoll(r: Ragdoll): void {
  const ouch = (kind: 'hit' | 'crack' | 'cry' | 'groan', level: number) => {
    sound.ouch(kind, level);
    recorder.hear(kind, level);
  };
  for (; hitsHeard < r.hits.length; hitsHeard++) {
    const h = r.hits[hitsHeard]!;
    const part = PART[h.joint];
    ouch('hit', Math.min(1, 0.15 + h.speed / 9) * (part === 'arm' ? 0.5 : 1));
    if (h.broke) ouch('crack', 1);
    else if (part !== 'trunk' && h.speed > 4.5 && Math.random() < 0.3) ouch('crack', 0.55);
    // A cry at the first real blow, another at a break, no more than three.
    if (cried < 3 && (h.broke || (cried === 0 && h.speed > 2.5))) {
      ouch('cry', 1);
      cried++;
    }
  }
  if (r.settled && !groaned) {
    groaned = true;
    ouch('groan', 1);
  }
}

/** The crash is over: back to the pilot's own body. */
function endCrash(): void {
  ragdoll = null;
  gather = null;
  if (!rigView.detached) rigView.canopy.setGather(0);
  replay = null;
  replayed = false;
  recorder.clear();
  ragdollView.update(null);
  rigView.body.group.visible = true;
  hud.setReplay(false);
}

/** The jump has ended and all of its end is on record. */
function canReplay(): boolean {
  if (recorder.crashAt === null) return false;
  if (ragdoll) return ragdoll.settled;
  return arrival ? arrival.done : impact;
}

function playReplay(): void {
  replay = recorder.replay();
  replayed = true;
  if (!replay) return;
  const s = model.state;
  Object.assign(kept.pos, s.pos);
  Object.assign(kept.vel, s.vel);
  Object.assign(kept.att, s.att);
  Object.assign(kept.pilotAtt, s.pilotAtt);
  kept.deflationL = model.deflationL;
  kept.deflationR = model.deflationR;
  if (!rigView.detached) rigView.canopy.setGather(0);
  hud.setReplay(true);
  chase.reset();
}

/** Back from the replay to the pilot as they are. */
function stopReplay(): void {
  if (!replay) return;
  replay = null;
  const s = model.state;
  Object.assign(s.pos, kept.pos);
  Object.assign(s.vel, kept.vel);
  Object.assign(s.att, kept.att);
  Object.assign(s.pilotAtt, kept.pilotAtt);
  model.deflationL = kept.deflationL;
  model.deflationR = kept.deflationR;
  hud.setReplay(false);
  chase.reset();
}

const liveJoints = new Float32Array(3 * JOINT_COUNT);
function jointArray(r: Ragdoll, out: Float32Array): Float32Array {
  r.pos.forEach((p, i) => {
    out[3 * i] = p.x;
    out[3 * i + 1] = p.y;
    out[3 * i + 2] = p.z;
  });
  return out;
}

const bundle = new THREE.Vector3();
const walkedTo = new THREE.Vector3();
const carryL = new THREE.Vector3(-0.17, -0.5, -0.3);
const carryR = new THREE.Vector3(0.17, -0.5, -0.3);

/** The canopy gathered up off the ground into the arms, `k` of the way, and held there. */
function carryCanopy(pose: Pose, k: number): void {
  const p = model.pilotPoint(vec3(), vec3(0, -0.55, -0.42));
  rigView.canopy.setGather(k, bundle.set(p.x, p.y, p.z));
  // The hands go out to the lines, then hold the bundle against the belly.
  const hold = Math.min(1, k * 3);
  pose.handL.lerp(carryL, hold);
  pose.handR.lerp(carryR, hold);
  rigView.body.setPose(pose);
}

/** This frame as drawn, for a replay. */
function record(f: ReplayFrame, pose: Pose, inflation: number | null, onRisers: boolean, heap: number): void {
  const s = model.state;
  Object.assign(f.pos, s.pos);
  Object.assign(f.vel, s.vel);
  Object.assign(f.att, s.att);
  Object.assign(f.pilotAtt, s.pilotAtt);
  f.deflationL = model.deflationL;
  f.deflationR = model.deflationR;
  Object.assign(f.controls, applied);
  Object.assign(f.hands, hands);
  copyPose(f.pose, pose);
  f.inflation = inflation;
  f.onRisers = onRisers;
  f.deploy = rigFrame.deploy;
  f.deployTime = rigFrame.deployTime;
  f.bagOut = rigFrame.bagOut;
  f.heap = heap;
  f.hasJoints = ragdoll !== null;
  if (ragdoll) jointArray(ragdoll, f.joints);
}

/** Draws the jumper as the replay has them. */
function showReplay(f: ReplayFrame): void {
  const s = model.state;
  Object.assign(s.pos, f.pos);
  Object.assign(s.vel, f.vel);
  Object.assign(s.att, f.att);
  Object.assign(s.pilotAtt, f.pilotAtt);
  model.deflationL = f.deflationL;
  model.deflationR = f.deflationR;
  rigView.setInflation(f.inflation);
  rigView.setArms(f.onRisers && !f.hasJoints);
  rigView.body.setPose(f.pose);
  rigView.body.showArms(!f.onRisers);
  rigView.body.group.visible = !f.hasJoints;
  ragdollView.update(f.hasJoints ? f.joints : null);
  if (!rigView.detached) rigView.canopy.setHeap(f.heap, heapFrom, fallTo);
  rigFrame.deploy = f.deploy;
  rigFrame.deployTime = f.deployTime;
  rigFrame.bagOut = f.bagOut;
}

/**
 * The replay's camera, as on television: on a tripod beside where it
 * happened, a long lens following the jumper in, turning slowly round once
 * they are down.
 */
function aimReplay(r: Replay): void {
  const s = model.state;
  const focus = va.set(0, model.rig.pilotPos.y, 0).applyQuaternion(qa.set(s.pilotAtt.x, s.pilotAtt.y, s.pilotAtt.z, s.pilotAtt.w));
  focus.add(vb.set(s.pos.x, s.pos.y, s.pos.z));
  const turn = crashHeading + 1.25 + 0.12 * Math.max(0, r.time - r.crashAt);
  const tripod = vc.set(crashPoint.x + Math.sin(turn) * 6, 0, crashPoint.z - Math.cos(turn) * 6);
  tripod.y = solid(tripod.x, tripod.z) + 1.4;
  camera.position.copy(tripod);
  camera.up.set(0, 1, 0);
  camera.lookAt(focus);
  // Framing some 4 m, at any distance.
  const fov = (2 * Math.atan(2 / Math.max(1, tripod.distanceTo(focus)))) / DEG;
  const wanted = Math.max(2, Math.min(FIELD_OF_VIEW, fov));
  if (camera.fov !== wanted) {
    camera.fov = gearCamera.fov = wanted;
    camera.updateProjectionMatrix();
    gearCamera.updateProjectionMatrix();
  }
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
/** Most the neck turns, rad/s: past that it lags behind rather than whip the eyes round. */
const NECK_RATE = 180 * DEG;
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
    // In the door or on top of the object, the eyes are out ahead and down.
    const aboard = !jump || jump.phase === 'plane' || jump.phase === 'standing';
    const position = jump && !aboard ? jump.body.position : 'belly';
    const n = NECKS[position];
    const out = jump && !aboard ? Math.min(1, jump.time / 1.5) : 0;
    const gaze = position === 'belly' ? DOOR_GAZE + (FREEFALL_GAZE - DOOR_GAZE) * out : n.gaze;
    // In a somersault or a roll the neck holds still and the eyes go round
    // with the body: chasing the horizon round the loop, it would whip them
    // one way then the other.
    const spinning = jump !== null && jump.phase === 'freefall' && jump.body.maneuvering;
    const wanted = spinning && neck !== null ? neck : neckFor(face.y, crown.y, gaze, n.prefer, n.lo, n.hi);
    if (neck === null) neck = wanted;
    else {
      const most = NECK_RATE * dt;
      neck += Math.max(-most, Math.min(most, (wanted - neck) * (1 - Math.exp(-dt / NECK_LAG))));
    }
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
    case 'standing':
      return 'ground';
    case 'plane':
      return doorStance(jump.spot, jump.plane!.type.doorSide);
    case 'freefall':
      // Just cut away: the hands are still on the handles.
      if (jump.cutawayAt !== null && jump.time - jump.cutawayAt < 0.45) return 'cutaway';
      return jump.body.track > 0.5 ? 'track' : jump.body.position;
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
  const ground = solid(free.pos.x, free.pos.z, free.pos.y);
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
  const height = feetHeight(model, solid);
  legCues.prep = hanging ? ease((6 - height) / 4) : 0;
  legCues.fore = legSwing.fore;
  legCues.side = legSwing.side;
}

/** The mark over a point target, with how far it is. */
function drawPointMarker(): void {
  if (target?.kind !== 'point') {
    pointMarker?.update(camera, []);
    return;
  }
  pointMarker ??= new Markers(document.getElementById('hud') ?? document.body);
  const mark = (pointMarks[0] ??= { id: 'point', name: '', pos: new THREE.Vector3(), color: '#ffd23f' });
  mark.name = T.cue.targetMark;
  mark.pos.copy(target.pos);
  pointMarker.update(camera, pointMarks, 'point');
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
    t.heading = (runHeading(setup) - 38 * jump.plane!.type.doorSide) * DEG;
    t.distance = 9;
    t.above = 0.1;
  } else if (jump && jump.phase === 'standing') {
    // Behind, a little above: the run and the edge ahead.
    t.heading = jump.headingDeg() * DEG;
    t.distance = 5;
    t.above = 0.3;
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
    if (ragdoll) t.heading = crashHeading + 0.9;
    else if (arrival) {
      const q = model.state.pilotAtt;
      const ahead = releasedAir.set(0, 0, -1).applyQuaternion(releasedAtt.set(q.x, q.y, q.z, q.w));
      t.heading = Math.atan2(ahead.x, -ahead.z);
    } else t.heading = telemetry.headingDeg * DEG;
    t.distance = arrival ? 9 : 6 + 8 * k;
    t.above = arrival ? 0.3 : 0.16;
  }
  // Locked: behind the jumper on the line from the target, which shows past them.
  const at = locked ? targetPos() : null;
  const line = at && lockedChase(t.focus, at);
  if (line) {
    if (line.heading !== null) t.heading = line.heading;
    t.above = line.above;
  }
  return t;
}

/**
 * What the body does in freefall, as the cue names it: the position, the
 * track or the wings (filling, then flown); and once stretched out, how far
 * it goes for every metre down.
 */
function flying(j: Jump): { name: string; glide: string } {
  const c = T.cue;
  const b = j.body;
  if (!b.tracking) return { name: c.positions[b.position], glide: '' };
  if (j.wings && b.track < 0.8) return { name: c.wingsFilling, glide: '' };
  const name = (j.wings ? c.wingsuit : c.tracks)[b.position];
  if (b.track < 0.8) return { name, glide: '' };
  const v = b.state.vel;
  return { name, glide: c.glide(num(Math.hypot(v.x, v.z) / Math.max(1, -v.y), 1)) };
}

/** Which keys the side of the screen shows: what can be done right now. */
function keysPhase(): KeysPhase | null {
  if (menu.isOpen) return null;
  if (touchdown || arrival || impact) return 'ground';
  if (!jump || jump.phase === 'canopy' || jump.phase === 'opening') return singleCanopy() ? 'baseCanopy' : 'canopy';
  if (jump.phase === 'standing') return 'ledge';
  if (jump.phase === 'plane') return 'plane';
  return jump.wings && jump.cutawayAt === null ? 'wingsuit' : 'freefall';
}

/** Aboard a public room's load, out of the menu: the last seconds before it leaves. */
const LOAD_CUE_S = 10;

/** What the HUD says to do next. */
function cue(): string {
  if (flash && performance.now() < flash.until) return flash.text;
  if (net?.isPublic && net.isReady) {
    const left = Math.ceil((net.nextLoadAt - Date.now()) / 1000);
    if (left <= LOAD_CUE_S) return `${T.cue.loadIn(left)}<small>${T.cue.loadAboard}</small>`;
  }
  const mainOut = jump !== null && jump.canopy === 'main' && (jump.phase === 'canopy' || (jump.phase === 'opening' && jump.inflation !== null));
  if (devices.cutawayHeld > 0 && (mainOut || !jump) && !touchdown && !arrival && singleCanopy()) {
    // One canopy and nothing under it: a BASE container has no cutaway handle.
    return `${T.cue.noCutaway}<small>${T.cue.oneCanopy}</small>`;
  }
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
    return `${c.greenLight}<small>${c.spots[jump.spot]} · ${exit ? `${exit} · ` : ''}${c.spaceToExit}</small>`;
  }
  if (jump.phase === 'standing') {
    const exit = c.exitIn[jump.body.position];
    const go = jump.runUp?.standing ? c.jumpOut(keyLabel('KeyW')) : c.runAndJump(keyLabel('KeyW'));
    return `${c.onTop}<small>${exit ? `${exit} · ` : ''}${go}</small>`;
  }
  if (jump.phase === 'freefall' && jump.base) {
    // Off a BASE object, the count is what matters.
    const delay = c.delay(num(jump.time, 1));
    if (jump.pullWhenFlat) return `${delay}<small>${c.flat} · ${c.toPull}</small>`;
    const { name, glide } = flying(jump);
    return `${delay}<small>${[name, glide, c.spaceToPull].filter(Boolean).join(' · ')}</small>`;
  }
  if (jump.phase === 'freefall') {
    if (jump.pullWhenFlat) return `${c.flat}<small>${c.toPull}</small>`;
    const { name, glide } = flying(jump);
    if (jump.time > 1.5) return `${name}<small>${[glide, c.spaceToPull].filter(Boolean).join(' · ')}</small>`;
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

/** Our jumper as the others will draw it. */
function sendJumper(net: Multiplayer, pose: Stance, onRisers: boolean, inflation: number | null, elapsed: number): void {
  const o = net.out;
  const s = model.state;
  o.phase = jump ? jump.phase : 'none';
  o.stance = pose;
  o.deploy = rigFrame.deploy;
  o.deployTime = rigFrame.deployTime;
  o.bagOut = rigFrame.bagOut;
  o.reserve = jump?.canopy === 'reserve';
  o.cutaway = jump !== null && jump.cutawayAt !== null;
  o.onRisers = onRisers;
  const handles = !singleCanopy();
  o.mainHandle = handles && (jump === null || jump.cutawayAt === null);
  o.reserveHandle = handles && (jump === null || !(jump.canopy === 'reserve' && jump.log.reserveBy === 'hand'));
  o.landed = arrival !== null;
  o.inflation = inflation;
  o.deflationL = model.deflationL;
  o.deflationR = model.deflationR;
  Object.assign(o.controls, applied);
  Object.assign(o.hands, hands);
  Object.assign(o.pos, s.pos);
  Object.assign(o.vel, s.vel);
  Object.assign(o.att, s.att);
  Object.assign(o.pilotAtt, s.pilotAtt);
  net.send(elapsed);
}

/** How the altimeter warns in freefall: from 1500 m, then 1000 m; off a BASE object, the last 150 m. */
function heightAlert(height: number): 'none' | 'warn' | 'danger' {
  if (!jump || jump.phase === 'canopy' || jump.phase === 'plane' || jump.phase === 'standing') return 'none';
  const [warn, danger] = jump.base ? [150, 100] : [1500, 1000];
  return height < danger ? 'danger' : height < warn ? 'warn' : 'none';
}

/** How much closer the eyes look with a mouse button held. */
const MAGNIFY = 3.5;
/** Time for the zoom to come in or go out, s. */
const MAGNIFY_LAG = 0.08;
let magnification = 1;

/** Zooms in while a mouse button is held: a narrower view, and a slower mouse to aim it. */
function magnify(dt: number): void {
  const wanted = devices.magnify && !menu.isOpen ? MAGNIFY : 1;
  const next = magnification + (wanted - magnification) * (1 - Math.exp(-dt / MAGNIFY_LAG));
  magnification = Math.abs(next - wanted) < 0.002 ? wanted : next;
  const fov = (2 * Math.atan(Math.tan((FIELD_OF_VIEW * DEG) / 2) / magnification)) / DEG;
  if (fov === camera.fov) return;
  camera.fov = gearCamera.fov = fov;
  camera.updateProjectionMatrix();
  gearCamera.updateProjectionMatrix();
  devices.lookScale = 1 / magnification;
}

let last = performance.now();
let frameAverage = 1 / 60;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000;
  last = now;
  frameAverage += (elapsed - frameAverage) * 0.05;
  if (elapsed < 0.25 && settings.autoResolution) resolution.track(elapsed);

  devices.padMode = padMode();
  const feet = feetTurn();
  devices.feetTurn = feet !== null;
  devices.poll();
  const feetYaw = devices.takeFeetYaw();
  // After the devices: Start may just have opened the menu, which then ignores it until let go.
  menu.poll();
  hud.setMenuOpen(menu.isOpen);
  const live = !waiting && !paused;
  if (live && replay) {
    replay.advance(Math.min(elapsed, 0.1), (kind, level, rate) => sound.ouch(kind, level, rate));
    if (replay.done) stopReplay();
  } else if (live) {
    const seconds = Math.min(elapsed, 0.1);
    feet?.turnBy(feetYaw);
    if (arrival) {
      airTime += seconds;
      // On the feet again: walking, but not while gathering the canopy up.
      const gathering = gather !== null && gather < 1;
      arrival.update(seconds, ragdoll || gathering ? null : devices.feet);
      if (gather !== null) gather = Math.min(1, gather + seconds / GATHER_TIME);
    } else simulate(seconds);
    if (ragdoll) {
      ragdoll.update(seconds);
      followRagdoll(ragdoll);
      hearRagdoll(ragdoll);
      // Once still, the crash is shown again.
      if (ragdoll.settled && !replayed) playReplay();
    }
    if (arrival) {
      for (; stepsHeard < arrival.steps && !ragdoll; stepsHeard++) sound.step(arrival.speed);
      if (arrival.done && verdict && (!ragdoll || (ragdoll.settled && replayed))) {
        verdict();
        verdict = null;
      }
    }
  }

  const moving = live && !replay ? Math.min(elapsed, 0.1) : 0;
  const pose = stance();
  const inflation = replay ? replay.frame.inflation : jump ? jump.inflation : 1;
  // The hands are on the risers from line stretch until they let go on the
  // ground; otherwise they are free, and the body shows them.
  const onRisers = replay ? replay.frame.onRisers : inflation !== null && !(arrival && arrival.time >= 0.25) && !ragdoll;
  if (replay) {
    showReplay(replay.frame);
    rigFrame.time = airTime;
    rigFrame.dt = Math.min(elapsed, 0.1) * replay.speed();
    rigFrame.wind.set(env.wind.x, env.wind.y, env.wind.z);
    rigFrame.airDensity = env.airDensity;
    rigView.update(model, replay.frame.controls, solid, light, replay.frame.hands, rigFrame);
  } else {
    // The main cut away goes its own way; the reserve takes its place overhead.
    if (jump?.released && !releasedView) releaseMain();
    if (jump && jump.canopy === 'reserve' && !rigView.canopy.reserve) attachReserve();
    rigView.setInflation(inflation);
    rigView.setArms(onRisers);
    const run = jump?.phase === 'standing' ? jump.runUp : null;
    const legs: [number, number] | undefined = arrival ? [arrival.legL, arrival.legR] : run ? [run.legL, run.legR] : undefined;
    updateLegs(moving, pose === 'hanging' && !touchdown);
    const shown = posture.update(moving, pose, FREEFALL_STANCES.has(pose) ? devices.body : still, legs, legCues);
    rigView.body.setPose(shown);
    rigView.body.showArms(!onRisers);
    rigView.body.setHeight(feetHeight(model, solid));
    // A BASE container has neither handle.
    if (singleCanopy()) rigView.body.setHandles(false, false);
    else if (jump) rigView.body.setHandles(jump.cutawayAt === null, !(jump.canopy === 'reserve' && jump.log.reserveBy === 'hand'));
    // On the ground the canopy empties and goes down in a heap.
    const heap = arrival ? ease((arrival.time - 0.3) / 2.2) : 0;
    if (arrival && !rigView.detached) {
      if (arrival.time < 0.05) heapFrom.set(model.state.pos.x, model.state.pos.y, model.state.pos.z);
      fallTo.set(arrival.fallTo.x, 0, arrival.fallTo.z);
      rigView.canopy.setHeap(heap, heapFrom, fallTo);
    } else if (!rigView.detached) rigView.canopy.setHeap(0);
    if (arrival?.walker && !rigView.detached) rigView.canopy.dragHeap(walkedTo.set(model.state.pos.x, 0, model.state.pos.z));
    if (gather !== null && !rigView.detached) carryCanopy(shown, gather);
    rigView.body.group.visible = !ragdoll;
    ragdollView.update(ragdoll ? jointArray(ragdoll, liveJoints) : null);
    hud.setCard(canReplay(), !!arrival?.walker);
    rigFrame.time = airTime;
    rigFrame.dt = moving;
    rigFrame.wind.set(env.wind.x, env.wind.y, env.wind.z);
    rigFrame.airDensity = env.airDensity;
    deployStage(rigFrame);
    // The last seconds are kept, in case they end badly; a crash, until the body is still.
    if (moving > 0 && !(recorder.crashAt !== null && canReplay())) record(recorder.next(moving), shown, inflation, onRisers, heap);
    rigView.update(model, applied, solid, light, hands, rigFrame);
    drawReleased(moving);
    drawSmoke(moving);
  }
  // A replay goes back in time: the smoke of now has no place in it.
  if (replay) smoke.object.visible = false;
  if (net) {
    if (!replay) sendJumper(net, pose, onRisers, inflation, elapsed);
    net.update({ dt: moving, time: airTime, wind: rigFrame.wind, airDensity: env.airDensity, groundAt: solid }, setup.dz);
    if (net.players !== playersShown) showGear();
  }
  if (jump?.plane) planeView.update(jump.plane);
  model.pilotPoint(eye, model.rig.eyePos);
  if (replay) {
    camera.layers.enable(GEAR_LAYER);
    camera.layers.enable(OUTSIDE_LAYER);
    aimReplay(replay);
  } else magnify(Math.min(elapsed, 0.1));
  // A player who has left is no longer a target.
  if (target?.kind === 'player' && !net?.has(target.id)) {
    target = null;
    locked = false;
    say(T.cue.targetGone);
  }
  const seen = locked ? targetPos() : null;
  lockBlend = Math.max(0, Math.min(1, lockBlend + ((seen ? 1 : -1) * Math.min(elapsed, 0.1)) / LOCK_TURN));
  if (replay) {
    // Placed above.
  } else if (view === 'outside') {
    camera.layers.enable(GEAR_LAYER);
    camera.layers.enable(OUTSIDE_LAYER);
    chase.update(camera, aimChase(), Math.min(elapsed, 0.1), devices.lookYaw, devices.lookPitch, devices.zoom, solid);
  } else {
    camera.layers.set(0);
    camera.position.set(eye.x, eye.y, eye.z);
    aimCamera(moving);
    // Locked: the eyes on the target, the mouse turning them about it.
    if (lockBlend > 0 && target) {
      lockedView.setFromRotationMatrix(lockMatrix.lookAt(camera.position, targetAt, camera.up.set(0, 1, 0)));
      lookEuler.set(devices.lookPitch, -devices.lookYaw, 0);
      lockedView.multiply(turn.setFromEuler(lookEuler));
      camera.quaternion.slerp(lockedView, ease(lockBlend));
    }
  }
  sky.position.copy(camera.position);
  net?.drawMarkers(camera, target?.kind === 'player' ? target.id : null);
  drawPointMarker();
  // The windsock and the flags follow the gusts at their own height.
  if (live && setup.weather.gusts !== 'none') {
    const gust = windAt(air, setup.weather, 6, airTime);
    world.setWind(Math.atan2(-gust.x, gust.z) / DEG, Math.hypot(gust.x, gust.z));
  }
  if (!paused) light.clouds.drift(cloudWind.x, cloudWind.z, Math.min(elapsed, 0.1));
  world.update(camera.position, now / 1000);
  drawMap(now);
  renderer.render(scene, camera);
  if (view === 'eyes' && !replay) {
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
  if (jump?.plane) {
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
      headingDeg: jump && falling && jump.phase !== 'plane' ? jump.headingDeg() : telemetry.headingDeg,
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
      heightAlert: heightAlert(height),
    },
    elapsed,
  );
}

applyWeather();
showGear();
spawn('pattern');
menu.open(false);
const roomInUrl = roomFromUrl();
if (roomInUrl) joinRoom(roomInUrl);
else void countPublic();
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
    ragdoll: { get: () => ragdoll },
    replay: { get: () => replay },
    gather: { get: () => gather },
    net: { get: () => net },
  });
  Object.assign(window, { sim });
}
