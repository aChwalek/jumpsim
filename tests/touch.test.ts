// A touch screen: a toggle under each thumb under canopy, two sticks in
// freefall, the rest of the glass to look around; and what InputDevices
// makes of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUTAWAY_HOLD, InputDevices, type Action } from '../src/input/devices';
import { brakeTravel, FRONT_AFTER, STICK_RADIUS, TouchInput } from '../src/input/touch';

/** A phone held sideways. */
const W = 844;
const H = 390;

function touch(mode: TouchInput['mode']): TouchInput {
  const t = new TouchInput();
  t.setMode(mode);
  return t;
}

describe('under canopy', () => {
  it('a finger sliding down pulls the toggle of its side, all the way at the end of the travel', () => {
    const t = touch('canopy');
    t.down(1, 100, 120, W, H);
    t.update(1);
    expect(t.brakeL).toBe(0);
    t.move(1, 100, 120 + brakeTravel(H) / 2);
    t.update(1);
    expect(t.brakeL).toBeCloseTo(0.5);
    expect(t.brakeR).toBe(0);
    t.move(1, 100, 120 + brakeTravel(H) + 40);
    t.update(1);
    expect(t.brakeL).toBe(1);
    t.down(2, 760, 120, W, H);
    t.move(2, 760, 120 + brakeTravel(H));
    t.update(1);
    expect(t.brakeR).toBe(1);
    t.up(1);
    t.update(1);
    expect(t.brakeL).toBe(0);
    expect(t.brakeR).toBe(1);
  });

  it('pushed up past where it went down, the hand is on the front riser', () => {
    const t = touch('canopy');
    t.down(1, 760, 150, W, H);
    t.move(1, 760, 150 - FRONT_AFTER + 4);
    expect(t.frontR).toBe(false);
    t.move(1, 760, 150 - FRONT_AFTER - 4);
    expect(t.frontR).toBe(true);
    expect(t.frontL).toBe(false);
    t.update(1);
    expect(t.brakeR).toBe(0);
  });

  it('a finger that lands low still has the whole travel, and the toggle comes down to it without a jolt', () => {
    const t = touch('canopy');
    t.down(1, 100, H - 30, W, H);
    t.update(0.02);
    expect(t.brakeL).toBeGreaterThan(0);
    expect(t.brakeL).toBeLessThan(0.2);
    t.update(1);
    expect(t.brakeL).toBeGreaterThan(0.8);
    t.move(1, 100, H);
    t.update(1);
    expect(t.brakeL).toBe(1);
  });

  it('the middle of the screen looks around, and so does a second finger on a side', () => {
    const t = touch('canopy');
    t.down(1, W / 2, 200, W, H);
    t.move(1, W / 2 + 30, 190);
    expect(t.takeLook()).toEqual({ x: 30, y: -10 });
    expect(t.takeLook()).toEqual({ x: 0, y: 0 });
    t.down(2, 100, 100, W, H);
    t.down(3, 120, 100, W, H);
    t.move(3, 140, 100);
    expect(t.takeLook().x).toBe(20);
    t.update(1);
    expect(t.brakeL).toBe(0);
  });
});

describe('in freefall', () => {
  it('the left stick drives and the right one turns and goes up and down', () => {
    const t = touch('freefall');
    t.down(1, 120, 260, W, H);
    t.move(1, 120, 260 - STICK_RADIUS);
    expect(t.moveY).toBeCloseTo(1);
    expect(t.moveX).toBeCloseTo(0);
    t.down(2, 720, 260, W, H);
    t.move(2, 720 + 2 * STICK_RADIUS, 260);
    expect(t.turn).toBeCloseTo(1);
    expect(t.rise).toBeCloseTo(0);
    t.move(2, 720, 260 + STICK_RADIUS);
    expect(t.rise).toBeCloseTo(-1);
    // Barely off the middle: nothing.
    t.move(2, 720 + 4, 260);
    expect(t.turn).toBe(0);
    t.up(1);
    expect(t.moveY).toBe(0);
  });

  it('a stick held as the canopy opens does not become a toggle pulled', () => {
    const t = touch('freefall');
    t.down(1, 720, 200, W, H);
    t.move(1, 720, 200 + STICK_RADIUS);
    expect(t.rise).toBeCloseTo(-1);
    t.setMode('canopy');
    t.update(1);
    expect(t.rise).toBe(0);
    expect(t.brakeR).toBe(0);
    t.move(1, 720, 330);
    t.update(1);
    expect(t.brakeR).toBe(0);
    // Lifted and put down again, it is the toggle.
    t.up(1);
    t.down(2, 720, 100, W, H);
    t.move(2, 720, 100 + brakeTravel(H));
    t.update(1);
    expect(t.brakeR).toBe(1);
  });
});

describe('on foot', () => {
  it('the left stick walks and the rest of the screen looks around', () => {
    const t = touch('walk');
    t.down(1, 100, 260, W, H);
    t.move(1, 100 + STICK_RADIUS, 260);
    expect(t.moveX).toBeCloseTo(1);
    t.down(2, 760, 200, W, H);
    t.move(2, 700, 200);
    expect(t.takeLook().x).toBe(-60);
    expect(t.turn).toBe(0);
  });
});

/** Something events can be listened to on, and sent to. */
function target() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener: (type: string, f: (e: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), f]),
    send: (type: string, e: unknown) => listeners.get(type)?.forEach((f) => f(e)),
  };
}

describe('read by the devices', () => {
  let now = 0;
  let win: ReturnType<typeof target>;
  let surface: ReturnType<typeof target> & { requestPointerLock: ReturnType<typeof vi.fn> };

  function devices(): { d: InputDevices; actions: Action[] } {
    const d = new InputDevices(surface as unknown as HTMLElement);
    const actions: Action[] = [];
    d.onAction = (a) => actions.push(a);
    return { d, actions };
  }

  beforeEach(() => {
    now = 0;
    win = target();
    surface = Object.assign(target(), { requestPointerLock: vi.fn() });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(target(), { pointerLockElement: null }));
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a finger on the page is a touch screen in use, until a key is pressed; and takes no mouse', () => {
    const { d } = devices();
    d.poll();
    expect(d.lastUsed).toBe('keyboard');
    win.send('pointerdown', { pointerType: 'mouse' });
    expect(d.lastUsed).toBe('keyboard');
    win.send('pointerdown', { pointerType: 'touch' });
    d.poll();
    expect(d.lastUsed).toBe('touch');
    d.capture();
    expect(surface.requestPointerLock).not.toHaveBeenCalled();
    win.send('keydown', { code: 'KeyA' });
    expect(d.lastUsed).toBe('keyboard');
    d.capture();
    expect(surface.requestPointerLock).toHaveBeenCalled();
  });

  it('the toggles are analogue brakes, and the fronts the front risers', () => {
    const { d } = devices();
    d.touch.setMode('canopy');
    d.poll();
    d.touch.down(1, 100, 100, W, H);
    d.touch.move(1, 100, 100 + brakeTravel(H) / 2);
    d.touch.down(2, 760, 150, W, H);
    d.touch.move(2, 760, 100);
    now += 1000;
    d.poll();
    now += 1000;
    d.poll();
    expect(d.analogBrakeL).toBeCloseTo(0.5);
    expect(d.analogBrakeR).toBe(0);
    expect(d.pulls.frontR).toBe(true);
    expect(d.pulls.frontL).toBe(false);
    expect(d.body.turn).toBe(0);
  });

  it('the sticks move the body, the feet and a free camera', () => {
    const { d } = devices();
    d.touch.setMode('freefall');
    d.touch.down(1, 120, 260, W, H);
    d.touch.move(1, 120 + STICK_RADIUS, 260 - STICK_RADIUS * 4);
    d.touch.down(2, 720, 260, W, H);
    d.touch.move(2, 720 - STICK_RADIUS, 260 - STICK_RADIUS * 3);
    d.poll();
    expect(d.body.forward).toBeGreaterThan(0.9);
    expect(d.body.slide).toBeGreaterThan(0.2);
    expect(d.body.turn).toBeLessThan(-0.2);
    // Up on the stick is up on the others: spread out.
    expect(d.body.fall).toBeLessThan(-0.9);
    expect(d.feet.forward).toBe(d.body.forward);
    expect(d.feet.slide).toBe(d.body.slide);
    expect(d.free.forward).toBe(d.body.forward);
    expect(d.free.right).toBe(d.body.slide);
  });

  it('a finger sliding in the middle turns the head, or the body on foot, and a free camera', () => {
    const { d } = devices();
    d.touch.setMode('canopy');
    d.touch.down(1, W / 2, 200, W, H);
    d.touch.move(1, W / 2 + 100, 150);
    d.poll();
    expect(d.lookYaw).toBeGreaterThan(0.3);
    expect(d.lookPitch).toBeGreaterThan(0.15);
    expect(d.free.yaw).toBeCloseTo(d.lookYaw);
    d.poll();
    expect(d.free.yaw).toBe(0);
    const yaw = d.lookYaw;
    d.feetTurn = true;
    d.touch.move(1, W / 2 + 200, 150);
    d.poll();
    expect(d.takeFeetYaw()).toBeGreaterThan(yaw);
    expect(d.lookYaw).toBe(0);
  });

  it('the cutaway button has to be held, as the key does', () => {
    const { d, actions } = devices();
    d.poll();
    d.touch.cutaway = true;
    d.poll();
    now += CUTAWAY_HOLD / 2;
    d.poll();
    expect(actions).toEqual([]);
    expect(d.cutawayHeld).toBeCloseTo(0.5);
    now += CUTAWAY_HOLD;
    d.poll();
    expect(actions).toEqual(['cutaway']);
    d.touch.cutaway = false;
    d.poll();
    expect(d.cutawayHeld).toBe(0);
  });

  it('the cross held goes on with somersaults and rolls', () => {
    const { d } = devices();
    d.touch.flip = 1;
    d.touch.roll = -1;
    d.poll();
    expect(d.body.flip).toBe(1);
    expect(d.body.roll).toBe(-1);
    // The page loses the screen: every finger is gone.
    win.send('blur', {});
    d.poll();
    expect(d.body.flip).toBe(0);
    expect(d.body.roll).toBe(0);
  });
});
