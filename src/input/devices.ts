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
  /** Gamepad B, Y, X: straight into that position (in freefall, or to go out in); the same again, back to the belly. */
  | 'posBack'
  | 'posSit'
  | 'posHeadDown'
  /** Collapse or take off the slider. */
  | 'slider'
  /** Eyes, or outside. */
  | 'camera'
  /** The end of the jump again, in slow motion; or back from it. */
  | 'replay'
  /** The player or the point in the middle of the screen becomes the target; nothing there, no target. */
  | 'pickTarget'
  /** The next or previous player as the target. */
  | 'nextTarget'
  | 'prevTarget'
  /** The camera locked on the target, or free again. */
  | 'lock'
  /** Gamepad, the right stick tapped: lock on the target, or with none, look straight ahead again. */
  | 'lockOrRecentre';

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
  // T as in target, L as in lock: the same letters on AZERTY.
  KeyT: 'pickTarget',
  KeyL: 'lock',
  Tab: 'nextTarget',
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
const PAD_ACTIONS: Partial<Record<number, Action>> = {
  2: 'slider', // X
  3: 'reset', // Y
  8: 'camera', // View / Back / Share
  9: 'padMenu', // Start
  10: 'track', // Left stick pressed
  12: 'flyUp',
  13: 'flyDown',
  14: 'flyLeft',
  15: 'flyRight',
};

/**
 * In the door, on the ledge and in freefall, B, Y and X take a position
 * instead: B on the back, Y sat up (the top button, the head up), X head down.
 */
const PAD_POSITIONS: Partial<Record<number, Action>> = {
  1: 'posBack', // B
  3: 'posSit', // Y
  2: 'posHeadDown', // X
};

/** B, standard mapping: held, the cutaway handle. */
const PAD_CUTAWAY = 1;

/**
 * What the gamepad is for at this moment of the jump. `exit`: in the door or
 * on the ledge, B, Y and X take the position to go out in. `freefall`: they
 * do the same, and the right stick flies (turns, up and down) unless LB is
 * held to look around.
 */
export type PadMode = 'default' | 'exit' | 'freefall';

/** How long the cutaway key or button has to be held, ms: no cutaway by a slip of the finger. */
export const CUTAWAY_HOLD = 350;
/** The right stick pressed: let go before this, ms, it locks; held this long, it picks a target. */
const PICK_HOLD = 350;
/** The right stick pressed, standard mapping. */
const PAD_LOCK = 11;
const MOUSE_SENSITIVITY = 0.0022;
const MAX_YAW = 2.6;
const MAX_PITCH_UP = 1.45;
const MAX_PITCH_DOWN = 1.5;
const STICK_DEADZONE = 0.12;
/**
 * The right stick all the way over turns the head this fast, rad/s, and
 * leaves it there, as the mouse does. Short of that, slower than in
 * proportion, to aim.
 */
const STICK_YAW_RATE = 2.6;
const STICK_PITCH_RATE = 1.8;
const curve = (v: number): number => v * Math.abs(v);

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
  /** Set from the jump before each poll. */
  padMode: PadMode = 'default';
  /**
   * On foot, set from the jump before each poll: the mouse and the right
   * stick turn the body, as in any first-person game, rather than the head.
   * Where the head was turned, the body turns to face that way.
   */
  feetTurn = false;
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
  /** And the other buttons. */
  private readonly padDown = new Set<number>();
  /**
   * B went down for the cutaway, not for a position: B pressed in freefall
   * and still held as the canopy comes out does not cut it away.
   */
  private padCutawayArmed = false;
  /** Where the head is turned, by the mouse and the right stick, rad. */
  private headYaw = 0;
  private headPitch = 0;
  /** When the devices were last read, ms. */
  private lastPoll: number | null = null;
  /** The mouse's turn of the body since it was last taken, rad to the right. */
  private feetYaw = 0;
  /** When the cutaway key or button went down, ms, and whether this hold has fired. */
  private cutawayFrom: number | null = null;
  private cutawayFired = false;
  /** When the right stick went down, ms, and whether this press has picked a target. */
  private lockFrom: number | null = null;
  private lockPicked = false;

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      this.lastUsed = 'keyboard';
      this.keys.add(e.code);
      const action = e.code === 'Tab' && e.shiftKey ? 'prevTarget' : ACTIONS[e.code];
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
      // The middle button, the wheel pressed: lock on the target, or let go.
      if (e.button === 1) {
        e.preventDefault();
        this.onAction('lock');
      }
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
      if (this.feetTurn) this.feetYaw += e.movementX * speed;
      else this.headYaw = clamp(this.headYaw + e.movementX * speed, -MAX_YAW, MAX_YAW);
      this.headPitch = clamp(
        this.headPitch - e.movementY * speed * (this.invertLook ? -1 : 1),
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
    this.headYaw = 0;
    this.headPitch = 0;
  }

  /** How far the mouse has turned the body since last asked, rad to the right; on foot. */
  takeFeetYaw(): number {
    const yaw = this.feetYaw;
    this.feetYaw = 0;
    return yaw;
  }

  /** Read the current state of every device. Call once per frame. */
  poll(): void {
    const now = performance.now();
    const dt = this.lastPoll === null ? 0 : Math.min(0.1, (now - this.lastPoll) / 1000);
    this.lastPoll = now;
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
    // Arrows held: somersaults and rolls one after the other.
    b.flip = key('ArrowUp') - key('ArrowDown');
    b.roll = key('ArrowRight') - key('ArrowLeft');
    const f = this.feet;
    f.turn = key('KeyE') - key('KeyQ');
    f.slide = key('KeyD') - key('KeyA');

    // On foot the body turns to where the head was turned.
    if (this.feetTurn && this.headYaw !== 0) {
      this.feetYaw += this.headYaw;
      this.headYaw = 0;
    }
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
      const btn = (i: number): number => (pad.buttons[i]?.pressed ? 1 : 0);
      p.frontL ||= btn(4) === 1;
      p.frontR ||= btn(5) === 1;
      const rightX = deadzone(pad.axes[2] ?? 0);
      const rightY = deadzone(pad.axes[3] ?? 0);
      // In freefall the right stick flies, LB held it looks around again.
      const flies = this.padMode === 'freefall' && btn(4) === 0;
      if (!flies) {
        // It turns the head, and leaves it where it turned it; on foot it
        // turns the body instead, at a walker's rate.
        const turn = this.lookScale * dt;
        if (!this.feetTurn) this.headYaw = clamp(this.headYaw + curve(rightX) * STICK_YAW_RATE * turn, -MAX_YAW, MAX_YAW);
        const up = -curve(rightY) * STICK_PITCH_RATE * turn * (this.invertLook ? -1 : 1);
        this.headPitch = clamp(this.headPitch + up, -MAX_PITCH_DOWN, MAX_PITCH_UP);
      }
      // In freefall the left stick drives; the right stick turns, and the
      // triggers too, the way the toggles turn under canopy.
      b.turn = clamp(b.turn + this.analogBrakeR - this.analogBrakeL + (flies ? rightX : 0), -1, 1);
      b.forward = clamp(b.forward - deadzone(pad.axes[1] ?? 0), -1, 1);
      b.slide = clamp(b.slide + deadzone(pad.axes[0] ?? 0), -1, 1);
      f.turn = clamp(f.turn + this.analogBrakeR - this.analogBrakeL + (this.feetTurn ? curve(rightX) : 0), -1, 1);
      f.slide = clamp(f.slide + deadzone(pad.axes[0] ?? 0), -1, 1);
      // The right stick pushed up spreads out (up on the others, the wings
      // wide), pulled down tucks in (down, the wings tight), as far as it goes.
      if (flies) b.fall = clamp(b.fall + rightY, -1, 1);
      // The cross held: somersaults and rolls one after the other.
      b.flip = clamp((b.flip ?? 0) + btn(12) - btn(13), -1, 1);
      b.roll = clamp((b.roll ?? 0) + btn(15) - btn(14), -1, 1);
      const jump = pad.buttons[0]?.pressed ?? false;
      if (jump && !this.padJump) this.onAction('jump');
      this.padJump = jump;
      for (let index = 1; index < pad.buttons.length; index++) {
        const down = pad.buttons[index]?.pressed ?? false;
        if (down && !this.padDown.has(index)) {
          const position = this.padMode === 'default' ? undefined : PAD_POSITIONS[index];
          const action = position ?? PAD_ACTIONS[index];
          if (action) this.onAction(action);
          if (index === PAD_CUTAWAY) this.padCutawayArmed = !position;
        }
        if (down) this.padDown.add(index);
        else this.padDown.delete(index);
      }
    }
    // The cutaway: X held, or B on the gamepad.
    const cutaway = k.has('KeyX') || ((pad?.buttons[PAD_CUTAWAY]?.pressed ?? false) && this.padCutawayArmed);
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
    // The right stick pressed: a tap locks (or with no target, looks straight ahead again), held it picks a target.
    const lock = pad?.buttons[PAD_LOCK]?.pressed ?? false;
    if (lock) {
      this.lockFrom ??= now;
      if (!this.lockPicked && now - this.lockFrom >= PICK_HOLD) {
        this.lockPicked = true;
        this.onAction('pickTarget');
      }
    } else if (this.lockFrom !== null) {
      if (!this.lockPicked) this.onAction('lockOrRecentre');
      this.lockFrom = null;
      this.lockPicked = false;
    }
    f.forward = b.forward;
    this.lookYaw = this.headYaw;
    this.lookPitch = this.headPitch;
  }
}
