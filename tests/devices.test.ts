// The gamepad in freefall: the right stick flies unless LB is held, B / Y / X
// take a position in the door and in freefall, and B pressed for a position
// does not turn into a cutaway once the canopy is out. On foot, the mouse and
// the right stick turn the body.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUTAWAY_HOLD, InputDevices, type Action } from '../src/input/devices';
import { RunUp } from '../src/sim/runUp';

/** Something events can be listened to on, and sent to. */
function target() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener: (type: string, f: (e: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), f]),
    send: (type: string, e: unknown) => listeners.get(type)?.forEach((f) => f(e)),
  };
}

let surface: ReturnType<typeof target>;
let doc: ReturnType<typeof target> & { pointerLockElement: unknown };

function fakePad() {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  return { id: 'Xbox (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0], timestamp: 0 };
}

let pad: ReturnType<typeof fakePad>;
let now = 0;

function devices(): { d: InputDevices; actions: Action[] } {
  const d = new InputDevices(surface as unknown as HTMLElement);
  const actions: Action[] = [];
  d.onAction = (a) => actions.push(a);
  return { d, actions };
}

function press(d: InputDevices, button: number): void {
  pad.buttons[button]!.pressed = true;
  d.poll();
  pad.buttons[button]!.pressed = false;
  d.poll();
}

beforeEach(() => {
  pad = fakePad();
  now = 0;
  surface = target();
  doc = Object.assign(target(), { pointerLockElement: surface as unknown });
  vi.stubGlobal('window', target());
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('right stick', () => {
  it('flies in freefall: left / right turns, up spreads out, down tucks in', () => {
    const { d } = devices();
    d.padMode = 'freefall';
    pad.axes[2] = 1;
    pad.axes[3] = -1;
    d.poll();
    expect(d.body.turn).toBe(1);
    expect(d.body.fall).toBe(-1);
    expect(d.lookYaw).toBe(0);
    pad.axes[3] = 1;
    d.poll();
    expect(d.body.fall).toBe(1);
  });

  it('looks around in freefall while LB is held', () => {
    const { d } = devices();
    d.padMode = 'freefall';
    pad.axes[2] = 1;
    pad.buttons[4]!.pressed = true;
    d.poll();
    now += 100;
    d.poll();
    expect(d.body.turn).toBe(0);
    expect(d.lookYaw).toBeGreaterThan(0);
  });

  it('looks around everywhere else', () => {
    const { d } = devices();
    pad.axes[2] = 1;
    pad.axes[3] = -1;
    for (const mode of ['default', 'exit'] as const) {
      d.padMode = mode;
      d.poll();
      now += 100;
      d.poll();
      expect(d.body.turn).toBe(0);
      expect(d.body.fall).toBe(0);
      expect(d.lookYaw).toBeGreaterThan(0);
    }
  });
});

describe('looking with the right stick', () => {
  it('turns the head as fast as it is pushed, and leaves it there', () => {
    const { d } = devices();
    d.poll();
    pad.axes[2] = 1;
    now += 100;
    d.poll();
    const full = d.lookYaw;
    expect(full).toBeCloseTo(0.26);
    pad.axes[2] = 0.5;
    now += 100;
    d.poll();
    // Half way over, well under half the speed, to aim.
    const half = d.lookYaw - full;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full / 3);
    pad.axes[2] = 0;
    now += 1000;
    d.poll();
    expect(d.lookYaw).toBeCloseTo(full + half);
  });

  it('pressed, locks on the target, or with none looks straight ahead again', () => {
    const { d, actions } = devices();
    press(d, 11);
    expect(actions).toEqual(['lockOrRecentre']);
  });
});

describe('B / Y / X', () => {
  it('take a position in the door and in freefall', () => {
    for (const mode of ['exit', 'freefall'] as const) {
      const { d, actions } = devices();
      d.padMode = mode;
      press(d, 1);
      press(d, 3);
      press(d, 2);
      expect(actions).toEqual(['posBack', 'posSit', 'posHeadDown']);
    }
  });

  it('keep their own jobs under canopy and on the ground', () => {
    const { d, actions } = devices();
    press(d, 3);
    press(d, 2);
    expect(actions).toEqual(['reset', 'slider']);
  });
});

describe('cutaway on B', () => {
  it('goes when B is held under canopy', () => {
    const { d, actions } = devices();
    pad.buttons[1]!.pressed = true;
    d.poll();
    now = CUTAWAY_HOLD + 1;
    d.poll();
    expect(actions).toContain('cutaway');
  });

  it('does not go when B went down for a position and is still held as the canopy comes out', () => {
    const { d, actions } = devices();
    d.padMode = 'freefall';
    pad.buttons[1]!.pressed = true;
    d.poll();
    d.padMode = 'default';
    now = CUTAWAY_HOLD + 1;
    d.poll();
    now = 3 * CUTAWAY_HOLD;
    d.poll();
    expect(actions).toEqual(['posBack']);
  });
});

describe('on foot', () => {
  const mouse = (x: number) => doc.send('mousemove', { movementX: x, movementY: 0 });

  it('the mouse turns the body, not the head', () => {
    const { d } = devices();
    d.feetTurn = true;
    mouse(100);
    d.poll();
    expect(d.takeFeetYaw()).toBeGreaterThan(0);
    expect(d.takeFeetYaw()).toBe(0);
    expect(d.lookYaw).toBe(0);
  });

  it('the body turns to where the head was turned', () => {
    const { d } = devices();
    mouse(-100);
    d.poll();
    const head = d.lookYaw;
    expect(head).toBeLessThan(0);
    d.feetTurn = true;
    d.poll();
    expect(d.takeFeetYaw()).toBeCloseTo(head);
    expect(d.lookYaw).toBe(0);
  });

  it('the right stick turns the body', () => {
    const { d } = devices();
    d.feetTurn = true;
    pad.axes[2] = 1;
    d.poll();
    expect(d.feet.turn).toBe(1);
    expect(d.lookYaw).toBe(0);
  });

  it('elsewhere the mouse turns the head', () => {
    const { d } = devices();
    mouse(100);
    d.poll();
    expect(d.lookYaw).toBeGreaterThan(0);
    expect(d.takeFeetYaw()).toBe(0);
  });

  it('turns the walker round, the compass heading kept within 0 to 360', () => {
    const w = new RunUp(() => 0, 0, 0, 350);
    w.turnBy((20 * Math.PI) / 180);
    expect(w.headingDeg).toBeCloseTo(10);
    w.turnBy((-30 * Math.PI) / 180);
    expect(w.headingDeg).toBeCloseTo(340);
  });
});
