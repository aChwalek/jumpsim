import * as THREE from 'three';
import type { DzPack } from './dz';
import { buildGrass } from './grass';
import { buildDisc, buildSurfaces, buildTerrain, buildWater } from './ground';
import { buildBuildings, buildCars, buildFlags, buildPeople, buildTrees, buildWindsock, type Windsock } from './objects';

export interface World {
  object: THREE.Group;
  windsock: Windsock;
  /** Call every frame with the eye position and the time in seconds. */
  update(eye: THREE.Vector3, seconds: number): void;
}

export interface Daylight {
  /** Direction towards the sun. */
  sun: THREE.Vector3;
  /** What flat ground sends back of its own colour. */
  ground: THREE.Color;
  /** Colour of the sky low down, which water mirrors. */
  sky: THREE.Color;
}

/** Turn a drop zone pack into a scene graph. */
export function buildWorld(dz: DzPack, light: Daylight): World {
  const object = new THREE.Group();
  const windsock = buildWindsock(dz.windsock.x, dz.windsock.z, dz.windsock.height);
  windsock.setWind(dz.wind.fromDeg, dz.wind.speed);
  const grass = buildGrass({ ...dz.grass, target: dz.target }, light.ground);
  const water = buildWater(dz.water, light.sky);
  const flags = buildFlags(dz.flags);
  flags.setWind(dz.wind.fromDeg, dz.wind.speed);
  object.add(
    buildTerrain(dz.grass.area.color),
    buildSurfaces(dz.surfaces),
    buildDisc(dz.target.x, dz.target.z, dz.target.radius, 0xcdbf9a, 4),
    buildDisc(dz.target.x, dz.target.z, 0.6, 0xe0452a, 5),
    buildBuildings(dz.buildings),
    buildTrees(dz.trees, light.sun),
    buildCars(dz.cars),
    buildPeople(dz.people),
    windsock.object,
    grass.object,
    water.object,
    flags.object,
  );
  return {
    object,
    windsock,
    update(eye, seconds) {
      grass.update(eye, seconds);
      water.update(seconds);
      flags.update(seconds);
    },
  };
}
