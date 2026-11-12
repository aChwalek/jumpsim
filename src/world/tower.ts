// A BASE training tower by the Valbrise landing area: a plain concrete tower
// of 300 m with a flat roof, a run marked on it towards the north edge, and
// the landing area some 170 m out from its foot. Everything else is Valbrise.

import { createValbrise, type BaseExit, type Building, type DzPack } from './dz';

/** Height of the tower's roof above the ground, m. */
export const TOWER_HEIGHT = 300;
/** Thickness of the roof slab drawn on top of the walls, m. */
const SLAB = 0.125;

const TOWER: Building = {
  x: 40,
  z: 195,
  // North to south, along the run.
  length: 40,
  width: 30,
  height: TOWER_HEIGHT - SLAB,
  headingDeg: 0,
  color: 0xa7a59f,
  roofColor: 0x7d7b76,
  flatRoof: true,
  hangar: false,
  floors: 3.6,
};

export function createTowerZone(): DzPack {
  const dz = createValbrise();
  const t = TOWER;
  const edge = t.z - t.length / 2;
  const runUp = 25;
  const base: BaseExit = { x: t.x, z: edge + runUp, headingDeg: 0, runUp, width: 4, marked: true, height: TOWER_HEIGHT };
  dz.name = 'Valbrise BASE';
  dz.buildings.push(t);
  dz.base = base;
  dz.topAt = (x, z) => (Math.abs(x - t.x) <= t.width / 2 && Math.abs(z - t.z) <= t.length / 2 ? TOWER_HEIGHT : dz.groundAt(x, z));
  // Nothing grows or parks inside it.
  dz.trees = dz.trees.filter((tree) => Math.abs(tree.x - t.x) > t.width / 2 + 4 || Math.abs(tree.z - t.z) > t.length / 2 + 4);
  return dz;
}
