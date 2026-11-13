// A phone held upright: the jump is drawn on its side, a quarter turn round,
// and the fingers are read in the picture, not on the screen.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSideways, toView, updateSideways, viewSize } from '../src/viewport';

function screen(width: number, height: number, coarse: boolean) {
  const classes = new Set<string>();
  vi.stubGlobal('window', { innerWidth: width, innerHeight: height });
  vi.stubGlobal('matchMedia', () => ({ matches: coarse }));
  vi.stubGlobal('document', {
    documentElement: {
      classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
      style: { setProperty: () => {} },
    },
  });
  return classes;
}

afterEach(() => {
  // Back to a screen that is drawn as it is.
  screen(844, 390, false);
  updateSideways();
  vi.unstubAllGlobals();
});

describe('a phone held upright', () => {
  it('draws everything on its side, until the phone itself is turned', () => {
    const classes = screen(390, 664, true);
    expect(updateSideways()).toBe(true);
    expect(isSideways()).toBe(true);
    expect(classes.has('sideways')).toBe(true);
    expect(viewSize()).toEqual({ width: 664, height: 390 });
    // Nothing new on the next frame.
    expect(updateSideways()).toBe(false);
    // The page turns with the phone: as it is again.
    const turned = screen(664, 390, true);
    expect(updateSideways()).toBe(true);
    expect(turned.has('sideways')).toBe(false);
    expect(viewSize()).toEqual({ width: 664, height: 390 });
  });

  it('reads a finger in the turned picture: its left is the top of the screen', () => {
    screen(390, 664, true);
    updateSideways();
    // The top right corner of the screen is the top left of the picture.
    expect(toView(390, 0)).toEqual({ x: 0, y: 0 });
    // The bottom left of the screen, its bottom right.
    expect(toView(0, 664)).toEqual({ x: 664, y: 390 });
  });
});

describe('otherwise', () => {
  it('a phone on its side, or a computer in a tall window, is drawn as it is', () => {
    screen(844, 390, true);
    expect(updateSideways()).toBe(false);
    expect(viewSize()).toEqual({ width: 844, height: 390 });
    expect(toView(100, 50)).toEqual({ x: 100, y: 50 });
    screen(600, 900, false);
    expect(updateSideways()).toBe(false);
    expect(isSideways()).toBe(false);
  });
});
