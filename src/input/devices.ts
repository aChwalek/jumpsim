// Keyboard, mouse and gamepad. Keys are matched by physical position
// (KeyboardEvent.code), so the layout is the same hand shape on AZERTY and
// QWERTY: the AZERTY letters are given in the comments.

import { noBodyInputs, type BodyInputs } from '../sim/freefall';
import { noPulls, type Pulls } from './ramp';

export type Action =
  | 'reset'
  | 'toggleHud'
  | 'togglePause'
  | 'toggleSound'
  | 'recentre'
  | 'spawnPattern'
  | 'spawnFinal'
  | 'spawnPlane'
  | 'jump'
  | 'openMenu'
  | 'cycleQuality'
  | 'toggleKeys'
  | 'flyBelly'
  | 'flyBack'
  | 'flySit'
  | 'flyHeadDown';

const ACTIONS: Record<string, Action> = {
  KeyR: 'reset',
  KeyH: 'toggleHud',
  KeyP: 'togglePause',
  KeyC: 'recentre',
  KeyG: 'cycleQuality',
  KeyK: 'toggleKeys',
  // M sits in a different place on AZERTY and QWERTY: take both.
  KeyM: 'toggleSound',
  Semicolon: 'toggleSound',
  Digit1: 'spawnPattern',
  Digit2: 'spawnFinal',
  Digit3: 'spawnPlane',
  Space: 'jump',
  KeyV: 'openMenu',
  // Positions in freefall: head up, head down, belly, back.
  ArrowUp: 'flySit',
  ArrowDown: 'flyHeadDown',
  ArrowLeft: 'flyBelly',
  ArrowRight: 'flyBack',
};

/** The gamepad's cross does the same as the arrows: up, down, left, right. */
const PAD_ACTIONS: [number, Action][] = [
  [12, 'flySit'],
  [13, 'flyHeadDown'],
  [14, 'flyBelly'],
  [15, 'flyBack'],
];

const MOUSE_SENSITIVITY = 0.0022;
const MAX_YAW = 2.6;
const MAX_PITCH_UP = 1.45;
const MAX_PITCH_DOWN = 1.5;
const STICK_DEADZONE = 0.12;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const deadzone = (v: number): number =>
  Math.abs(v) < STICK_DEADZONE ? 0 : (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE);

export class InputDevices {
  /** Digital pulls from keys and gamepad bumpers, to be fed to the ramp. */
  readonly pulls: Pulls = noPulls();
  /**
   * The same keys in freefall, where they move the body: Q / D turn, Z / S
   * forward and back, A / E slide sideways, R / F up and down (AZERTY letters).
   */
  readonly body: BodyInputs = noBodyInputs();
  /** Analogue brake travel from the gamepad triggers, 0..1. */
  analogBrakeL = 0;
  analogBrakeR = 0;
  /** Where the pilot looks relative to straight ahead, radians. */
  lookYaw = 0;
  lookPitch = 0;
  gamepadConnected = false;
  /** The device last touched, so the help on screen shows its keys. */
  lastUsed: 'keyboard' | 'gamepad' = 'keyboard';
  onAction: (action: Action) => void = () => {};

  private readonly keys = new Set<string>();
  /** The gamepad's A button was down at the last poll. */
  private padJump = false;
  /** The gamepad's cross, as at the last poll. */
  private readonly padCross = PAD_ACTIONS.map(() => false);
  private mouseYaw = 0;
  private mousePitch = 0;

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      this.lastUsed = 'keyboard';
      this.keys.add(e.code);
      const action = ACTIONS[e.code];
      if (action) this.onAction(action);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('click', () => this.capture());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== surface) return;
      this.mouseYaw = clamp(this.mouseYaw + e.movementX * MOUSE_SENSITIVITY, -MAX_YAW, MAX_YAW);
      this.mousePitch = clamp(
        this.mousePitch - e.movementY * MOUSE_SENSITIVITY,
        -MAX_PITCH_DOWN,
        MAX_PITCH_UP,
      );
    });
  }

  get mouseCaptured(): boolean {
    return document.pointerLockElement === this.surface;
  }

  /** Takes the mouse for looking around. Only works from a click or a key press. */
  capture(): void {
    if (document.pointerLockElement === this.surface) return;
    // Refused when the page is not in front: looking around then waits for a click.
    void Promise.resolve(this.surface.requestPointerLock()).catch(() => {});
  }

  /** Gives the mouse back, for a menu. */
  release(): void {
    if (document.pointerLockElement === this.surface) document.exitPointerLock();
  }

  recentre(): void {
    this.mouseYaw = 0;
    this.mousePitch = 0;
  }

  /** Read the current state of every device. Call once per frame. */
  poll(): void {
    const k = this.keys;
    const p = this.pulls;
    const both = k.has('KeyS'); // S: both toggles
    const bothFront = k.has('KeyW'); // Z on AZERTY: both front risers
    p.brakeL = both || k.has('KeyA'); // Q on AZERTY
    p.brakeR = both || k.has('KeyD'); // D
    p.frontL = bothFront || k.has('KeyQ'); // A on AZERTY
    p.frontR = bothFront || k.has('KeyE'); // E
    p.hold = k.has('ShiftLeft') || k.has('ShiftRight');
    const key = (code: string): number => (k.has(code) ? 1 : 0);
    const b = this.body;
    b.turn = key('KeyD') - key('KeyA');
    b.forward = key('KeyW') - key('KeyS');
    b.slide = key('KeyE') - key('KeyQ');
    // R up (spread out, slower), F down (tucked in, faster).
    b.fall = key('KeyF') - key('KeyR');

    let stickYaw = 0;
    let stickPitch = 0;
    this.analogBrakeL = 0;
    this.analogBrakeR = 0;
    const pad = navigator.getGamepads?.().find((g) => g?.connected && g.mapping === 'standard');
    this.gamepadConnected = !!pad;
    if (!pad) this.lastUsed = 'keyboard';
    else if (pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.3)) this.lastUsed = 'gamepad';
    if (pad) {
      this.analogBrakeL = pad.buttons[6]?.value ?? 0;
      this.analogBrakeR = pad.buttons[7]?.value ?? 0;
      p.frontL ||= pad.buttons[4]?.pressed ?? false;
      p.frontR ||= pad.buttons[5]?.pressed ?? false;
      stickYaw = deadzone(pad.axes[2] ?? 0) * 1.7;
      stickPitch = -deadzone(pad.axes[3] ?? 0) * 1.2;
      // In freefall the triggers turn and the left stick drives.
      b.turn = clamp(b.turn + this.analogBrakeR - this.analogBrakeL, -1, 1);
      b.forward = clamp(b.forward - deadzone(pad.axes[1] ?? 0), -1, 1);
      b.slide = clamp(b.slide + deadzone(pad.axes[0] ?? 0), -1, 1);
      // The bumpers go up and down, the cross picks the position.
      b.fall = clamp(b.fall + (pad.buttons[5]?.pressed ? 1 : 0) - (pad.buttons[4]?.pressed ? 1 : 0), -1, 1);
      PAD_ACTIONS.forEach(([button, action], i) => {
        const down = pad.buttons[button]?.pressed ?? false;
        if (down && !this.padCross[i]) this.onAction(action);
        this.padCross[i] = down;
      });
      const jump = pad.buttons[0]?.pressed ?? false;
      if (jump && !this.padJump) this.onAction('jump');
      this.padJump = jump;
    }
    this.lookYaw = clamp(this.mouseYaw + stickYaw, -MAX_YAW, MAX_YAW);
    this.lookPitch = clamp(this.mousePitch + stickPitch, -MAX_PITCH_DOWN, MAX_PITCH_UP);
  }
}
