// A touch screen: what the fingers ask for. No DOM here: the overlay (see
// ui/touchControls) feeds it the fingers going down, moving and lifting, and
// InputDevices reads it at each poll, the way it reads a gamepad.
//
// The screen is cut in three. The left third is the left hand and the right
// third the right hand: under canopy each pulls its toggle down (a finger
// sliding down the glass is the hand coming down), in freefall each is a
// stick that appears under the thumb. The middle looks around, and so does
// whatever a hand is not used for.

/**
 * What the two hands do at this moment of the jump. `canopy`: a toggle each.
 * `freefall`: two sticks, the left one drives and the right one turns and
 * goes up and down. `walk`: the left stick walks (or moves a free camera),
 * the rest of the screen looks around. `look`: the whole screen looks around.
 */
export type TouchMode = 'canopy' | 'freefall' | 'walk' | 'look';

/** What a finger on the glass is doing. `dead`: nothing any more, until it lifts. */
export type TouchRole = 'left' | 'right' | 'look' | 'dead';

export interface Finger {
  role: TouchRole;
  /** Where its control sits, px: where it went down, unless that left no room to pull. */
  x0: number;
  y0: number;
  /** Where it is now, px. */
  x: number;
  y: number;
}

/** How wide a hand's side of the screen is, as a share of its width. */
const SIDE = 0.36;
/** A stick pushed this far from where the thumb went down is pushed all the way, px. */
export const STICK_RADIUS = 56;
const STICK_DEADZONE = 0.14;
/** A toggle's whole travel, px, and at most this share of the screen's height. */
const BRAKE_TRAVEL = 170;
const BRAKE_TRAVEL_SHARE = 0.45;
/** Pushed up this far past where the hand went down, it is on the front riser, px. */
export const FRONT_AFTER = 26;
/** Kept clear at the top and the bottom of the screen, px. */
const MARGIN = 18;
/** How fast a toggle comes down to where the finger is, travel per second: no jolt from a finger landing low. */
const BRAKE_SLEW = 7;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** A toggle's travel on a screen this high, px. */
export const brakeTravel = (height: number): number => Math.min(BRAKE_TRAVEL, height * BRAKE_TRAVEL_SHARE);

export class TouchInput {
  mode: TouchMode = 'look';
  /** The left stick: to the right and ahead, -1 to 1. */
  moveX = 0;
  moveY = 0;
  /** The right stick in freefall: turning to the right, and going up, -1 to 1. */
  turn = 0;
  rise = 0;
  /** The toggles, 0 to 1, and the front risers. */
  brakeL = 0;
  brakeR = 0;
  frontL = false;
  frontR = false;
  /** Buttons held: somersaults (1 forwards) and rolls (1 to the right) one after the other, the cutaway handle. */
  flip = 0;
  roll = 0;
  cutaway = false;
  /** The fingers on the glass, for the overlay to draw. */
  readonly fingers = new Map<number, Finger>();
  /** Where the toggles are asked to be, before the slew. */
  private wantL = 0;
  private wantR = 0;
  /** How far the looking fingers have slid since last taken, px. */
  private lookX = 0;
  private lookY = 0;
  private width = 1;
  private height = 1;

  /** Whose side of a screen `width` wide this is. */
  private sideAt(x: number): TouchRole {
    if (this.mode === 'look') return 'look';
    if (x < this.width * SIDE) return 'left';
    if (x > this.width * (1 - SIDE)) return this.mode === 'walk' ? 'look' : 'right';
    return 'look';
  }

  private taken(role: TouchRole): boolean {
    for (const f of this.fingers.values()) if (f.role === role) return true;
    return false;
  }

  /** A finger goes down on a screen of this size. */
  down(id: number, x: number, y: number, width: number, height: number): void {
    this.width = width;
    this.height = height;
    let role = this.sideAt(x);
    // One finger a hand: a second one on its side looks around.
    if (role !== 'look' && this.taken(role)) role = 'look';
    let y0 = y;
    if (this.mode === 'canopy' && role !== 'look') {
      // Room to pull all the way down, and to reach the front riser: a
      // finger that lands lower than that finds the toggle already pulled.
      const lowest = height - MARGIN - brakeTravel(height);
      y0 = clamp(y, Math.min(MARGIN + FRONT_AFTER, lowest), lowest);
    }
    this.fingers.set(id, { role, x0: x, y0, x, y });
    this.read();
  }

  move(id: number, x: number, y: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    if (f.role === 'look') {
      this.lookX += x - f.x;
      this.lookY += y - f.y;
    }
    f.x = x;
    f.y = y;
    this.read();
  }

  up(id: number): void {
    if (this.fingers.delete(id)) this.read();
  }

  /** Every finger gone: the page lost the screen. */
  clear(): void {
    this.fingers.clear();
    this.flip = this.roll = 0;
    this.cutaway = false;
    this.read();
  }

  /**
   * Another moment of the jump. The hands let go of what they held: a stick
   * pushed over to turn does not become a toggle pulled as the canopy opens.
   * Those fingers do nothing more until they lift.
   */
  setMode(mode: TouchMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const f of this.fingers.values()) if (f.role !== 'look') f.role = 'dead';
    this.read();
  }

  /** How far the looking fingers slid since last asked, px to the right and down. */
  takeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return look;
  }

  /** Brings the toggles to where the fingers ask, over `dt` seconds. Call at each poll. */
  update(dt: number): void {
    const step = BRAKE_SLEW * dt;
    this.brakeL += clamp(this.wantL - this.brakeL, -step, step);
    this.brakeR += clamp(this.wantR - this.brakeR, -step, step);
  }

  /** The controls, from where the fingers are. */
  private read(): void {
    this.moveX = this.moveY = this.turn = this.rise = 0;
    this.wantL = this.wantR = 0;
    this.frontL = this.frontR = false;
    for (const f of this.fingers.values()) {
      if (f.role !== 'left' && f.role !== 'right') continue;
      const left = f.role === 'left';
      if (this.mode === 'canopy') {
        const down = f.y - f.y0;
        const brake = clamp(down / brakeTravel(this.height), 0, 1);
        if (left) this.wantL = brake;
        else this.wantR = brake;
        if (left) this.frontL = -down > FRONT_AFTER;
        else this.frontR = -down > FRONT_AFTER;
        continue;
      }
      // A stick: round, with nothing in the middle.
      let x = (f.x - f.x0) / STICK_RADIUS;
      let y = (f.y0 - f.y) / STICK_RADIUS;
      const length = Math.hypot(x, y);
      const pushed = length < STICK_DEADZONE ? 0 : Math.min(1, (length - STICK_DEADZONE) / (1 - STICK_DEADZONE));
      x = length > 0 ? (x / length) * pushed : 0;
      y = length > 0 ? (y / length) * pushed : 0;
      if (left) {
        this.moveX = x;
        this.moveY = y;
      } else {
        this.turn = x;
        this.rise = y;
      }
    }
  }
}
