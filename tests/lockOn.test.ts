import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cycle, lockedChase, pickPlayer, pickPoint } from '../src/render/lockOn';

const flat = (): number => 0;
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

describe('pickPoint', () => {
  it('finds the ground ahead and below', () => {
    const p = pickPoint(v(0, 1000, 0), v(0, -1, -1).normalize(), flat);
    expect(p).not.toBeNull();
    expect(p!.y).toBeCloseTo(0, 2);
    expect(p!.z).toBeCloseTo(-1000, 1);
  });

  it('finds nothing looking up', () => {
    expect(pickPoint(v(0, 1000, 0), v(0, 1, -1).normalize(), flat)).toBeNull();
  });

  it('stops at a hill before the flat beyond it', () => {
    const hill = (_x: number, z: number): number => (z < -400 && z > -600 ? 300 : 0);
    const p = pickPoint(v(0, 500, 0), v(0, -1, -2).normalize(), hill);
    expect(p).not.toBeNull();
    expect(p!.y).toBeCloseTo(300, 1);
    expect(p!.z).toBeCloseTo(-400, 0);
  });
});

describe('pickPlayer', () => {
  const others = [
    { id: 'a', pos: v(0, 0, -100) },
    { id: 'b', pos: v(3, 0, -100) },
    { id: 'c', pos: v(100, 0, 0) },
  ];

  it('takes the one nearest the middle of the screen', () => {
    expect(pickPlayer(v(0, 0, 0), v(0.02, 0, -1).normalize(), others)).toBe('b');
    expect(pickPlayer(v(0, 0, 0), v(0, 0, -1), others)).toBe('a');
  });

  it('takes no one too far off it', () => {
    expect(pickPlayer(v(0, 0, 0), v(0, 1, 0), others)).toBeNull();
  });
});

describe('cycle', () => {
  it('goes round both ways', () => {
    expect(cycle(['a', 'b', 'c'], null, 1)).toBe('a');
    expect(cycle(['a', 'b', 'c'], null, -1)).toBe('c');
    expect(cycle(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(cycle(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(cycle(['a', 'b', 'c'], 'gone', 1)).toBe('a');
    expect(cycle([], 'a', 1)).toBeNull();
  });
});

describe('lockedChase', () => {
  it('stands on the far side of the jumper from the target', () => {
    const focus = v(0, 100, 0);
    const target = v(0, 100, -500);
    const line = lockedChase(focus, target)!;
    // The chase camera's offset from the focus, as ChaseCamera places it.
    const h = line.heading!;
    const offset = v(-Math.sin(h), 0, Math.cos(h));
    expect(offset.z).toBeCloseTo(1, 6);
    expect(line.above).toBeGreaterThan(0);
    expect(line.above).toBeLessThan(0.3);
  });

  it('goes up over the jumper for a target below', () => {
    const line = lockedChase(v(0, 1000, 0), v(1000, 0, 0))!;
    expect(line.above).toBeGreaterThan(Math.PI / 4);
    expect(-Math.sin(line.heading!)).toBeCloseTo(-1, 6);
  });

  it('has no heading straight above the target', () => {
    expect(lockedChase(v(0, 1000, 0), v(0, 0, 0))!.heading).toBeNull();
  });
});
