// The gamepad in freefall: the right stick flies unless LB is held, B / Y / X
// take a position in the door and in freefall, and B pressed for a position
// does not turn into a cutaway once the canopy is out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUTAWAY_HOLD, InputDevices, type Action } from '../src/input/devices';

const on = { addEventListener: () => {} };

function fakePad() {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  return { id: 'Xbox (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0], timestamp: 0 };
}

let pad: ReturnType<typeof fakePad>;
let now = 0;

function devices(): { d: InputDevices; actions: Action[] } {
  const d = new InputDevices(on as unknown as HTMLElement);
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
  vi.stubGlobal('window', on);
  vi.stubGlobal('document', { ...on, pointerLockElement: null });
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
      expect(d.body.turn).toBe(0);
      expect(d.body.fall).toBe(0);
      expect(d.lookYaw).toBeGreaterThan(0);
    }
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
