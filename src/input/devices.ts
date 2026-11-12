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
  | 'spawnBase'
  | 'jump'
  | 'openMenu'
  /** Start on the gamepad: opens the menu, which then takes the gamepad over. */
  | 'padMenu'
  | 'cycleQuality'
  | 'toggleKeys'
  /** Flat, a half roll that way; upright, a half turn. */
  | 'flyLeft'
  | 'flyRight'
  /** Head up or down one step from the current position. */
  | 'flyUp'
  | 'flyDown'
  /** Held a moment: the cutaway handle. */
  | 'cutaway'
  /** Gamepad: left stick pressed, into a track or out of it. */
  | 'track'
  /** Collapse or take off the slider. */
  | 'slider'
  /** Eyes, or outside. */
  | 'camera'
  /** The end of the jump again, in slow motion; or back from it. */
  | 'replay';

const ACTIONS: Record<string, Action> = {
  KeyR: 'reset',
  KeyH: 'toggleHud',
  KeyP: 'togglePause',
  KeyC: 'recentre',
  // G as in glisseur.
  KeyG: 'slider',
  KeyB: 'camera',
  KeyK: 'toggleKeys',
  // M sits in a different place on AZERTY and QWERTY: take both.
  KeyM: 'toggleSound',
  Semicolon: 'toggleSound',
  Digit1: 'spawnPattern',
  Digit2: 'spawnFinal',
  Digit3: 'spawnPlane',
  Digit4: 'spawnBase',
  Space: 'jump',
  KeyV: 'openMenu',
  // Positions in freefall: head up / down a step from where the body is, roll or turn round.
  ArrowUp: 'flyUp',
  ArrowDown: 'flyDown',
  ArrowLeft: 'flyLeft',
  ArrowRight: 'flyRight',
};

/**
 * Gamepad buttons, standard mapping, that act once per press (A jumps, see
 * poll). The cross does the same as the arrows: up, down, left, right.
 */
const PAD_ACTIONS: [number, Action][] = [
  [2, 'slider'], // X
  [3, 'reset'], // Y
  [8, 'camera'], // View / Back / Share
  [10, 'track'], // Left stick pressed
  [9, 'padMenu'], // Start
  [12, 'flyUp'],
  [13, 'flyDown'],
  [14, 'flyLeft'],
  [15, 'flyRight'],
];

/** How long the cutaway key or button has to be held, ms: no cutaway by a slip of the finger. */
export const CUTAWAY_HOLD = 350;
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
  /**
   * On foot, on top of a BASE object: Z / S forward and back, Q / D step
   * left and right, A / E turn (AZERTY letters).
   */
  readonly feet: BodyInputs = noBodyInputs();
  /**
   * Into a track (an angle upright): Shift held on the keyboard, the way
   * the body is held stretched; on the gamepad the thumb is on the stick
   * that drives, so pressing it turns the track on and again off.
   */
  padTrack = false;
  /** Analogue brake travel from the gamepad triggers, 0..1. */
  analogBrakeL = 0;
  analogBrakeR = 0;
  /** Where the pilot looks relative to straight ahead, radians. */
  lookYaw = 0;
  lookPitch = 0;
  gamepadConnected = false;
  /** Multiple of the base mouse speed. */
  sensitivity = 1;
  /** Mouse forward and stick up look down. */
  invertLook = false;
  /** The device last touched, so the help on screen shows its keys. */
  lastUsed: 'keyboard' | 'gamepad' = 'keyboard';
  /** Whose gamepad it is, to name its buttons. */
  padKind: 'xbox' | 'playstation' = 'xbox';
  /** How far an outside camera stands back, as a multiple of its usual distance: the wheel. */
  zoom = 1;
  /** How long the cutaway has been held, 0 to 1 once it goes. */
  cutawayHeld = 0;
  /** A mouse button held to look closer: the right one, or the left once the mouse is captured. */
  magnify = false;
  /** Multiplies how far the mouse turns the head: less while looking closer. */
  lookScale = 1;
  onAction: (action: Action) => void = () => {};

  private readonly keys = new Set<string>();
  /** The gamepad's A button was down at the last poll. */
  private padJump = false;
  /** And the buttons of PAD_ACTIONS. */
  private readonly padDown = new Set<number>();
  private mouseYaw = 0;
  private mousePitch = 0;
  /** When the cutaway key or button went down, ms, and whether this hold has fired. */
  private cutawayFrom: number | null = null;
  private cutawayFired = false;

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      this.lastUsed = 'keyboard';
      this.keys.add(e.code);
      const action = ACTIONS[e.code];
      if (action) this.onAction(action);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.magnify = false;
    });

    surface.addEventListener('click', () => this.capture());
    // Held, a mouse button zooms the eyes in. The left one only once the mouse
    // is captured: before, its click is what captures it.
    surface.addEventListener('mousedown', (e) => {
      if (e.button === 2 || (e.button === 0 && this.mouseCaptured)) this.magnify = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 || e.button === 2) this.magnify = false;
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener(
      'wheel',
      (e) => {
        this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.3, 4);
      },
      { passive: true },
    );
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== surface) return;
      const speed = MOUSE_SENSITIVITY * this.sensitivity * this.lookScale;
      this.mouseYaw = clamp(this.mouseYaw + e.movementX * speed, -MAX_YAW, MAX_YAW);
      this.mousePitch = clamp(
        this.mousePitch - e.movementY * speed * (this.invertLook ? -1 : 1),
        -MAX_PITCH_DOWN,
        MAX_PITCH_UP,
      );
    });
  }

  /** Asked to track. */
  get tracking(): boolean {
    return this.padTrack || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
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
    const f = this.feet;
    f.turn = key('KeyE') - key('KeyQ');
    f.slide = key('KeyD') - key('KeyA');

    let stickYaw = 0;
    let stickPitch = 0;
    this.analogBrakeL = 0;
    this.analogBrakeR = 0;
    const pad = navigator.getGamepads?.().find((g) => g?.connected && g.mapping === 'standard');
    this.gamepadConnected = !!pad;
    if (!pad) this.lastUsed = 'keyboard';
    else if (pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.3)) this.lastUsed = 'gamepad';
    if (pad) {
      this.padKind = /054c|sony|playstation|dualsense|dualshock/i.test(pad.id) ? 'playstation' : 'xbox';
      this.analogBrakeL = pad.buttons[6]?.value ?? 0;
      this.analogBrakeR = pad.buttons[7]?.value ?? 0;
      p.frontL ||= pad.buttons[4]?.pressed ?? false;
      p.frontR ||= pad.buttons[5]?.pressed ?? false;
      stickYaw = deadzone(pad.axes[2] ?? 0) * 1.7;
      stickPitch = -deadzone(pad.axes[3] ?? 0) * 1.2 * (this.invertLook ? -1 : 1);
      // In freefall the triggers turn and the left stick drives.
      b.turn = clamp(b.turn + this.analogBrakeR - this.analogBrakeL, -1, 1);
      b.forward = clamp(b.forward - deadzone(pad.axes[1] ?? 0), -1, 1);
      b.slide = clamp(b.slide + deadzone(pad.axes[0] ?? 0), -1, 1);
      f.turn = clamp(f.turn + this.analogBrakeR - this.analogBrakeL, -1, 1);
      f.slide = clamp(f.slide + deadzone(pad.axes[0] ?? 0), -1, 1);
      // The bumpers go up and down, the cross picks the position.
      b.fall = clamp(b.fall + (pad.buttons[5]?.pressed ? 1 : 0) - (pad.buttons[4]?.pressed ? 1 : 0), -1, 1);
      const jump = pad.buttons[0]?.pressed ?? false;
      if (jump && !this.padJump) this.onAction('jump');
      this.padJump = jump;
      for (const [index, action] of PAD_ACTIONS) {
        const down = pad.buttons[index]?.pressed ?? false;
        if (down && !this.padDown.has(index)) this.onAction(action);
        if (down) this.padDown.add(index);
        else this.padDown.delete(index);
      }
    }
    // The cutaway: X held, or B on the gamepad.
    const cutaway = k.has('KeyX') || (pad?.buttons[1]?.pressed ?? false);
    const now = performance.now();
    if (!cutaway) {
      this.cutawayFrom = null;
      this.cutawayFired = false;
      this.cutawayHeld = 0;
    } else {
      this.cutawayFrom ??= now;
      this.cutawayHeld = Math.min(1, (now - this.cutawayFrom) / CUTAWAY_HOLD);
      if (this.cutawayHeld >= 1 && !this.cutawayFired) {
        this.cutawayFired = true;
        this.onAction('cutaway');
      }
    }
    f.forward = b.forward;
    this.lookYaw = clamp(this.mouseYaw + stickYaw, -MAX_YAW, MAX_YAW);
    this.lookPitch = clamp(this.mousePitch + stickPitch, -MAX_PITCH_DOWN, MAX_PITCH_UP);
  }
}
