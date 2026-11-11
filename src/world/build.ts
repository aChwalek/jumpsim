import * as THREE from 'three';
import type { Lighting } from '../render/scene';
import type { DzPack } from './dz';
import { buildGrass } from './grass';
import { buildDisc, buildSurfaces, buildTerrain, buildWater } from './ground';
import { buildBuildings, buildCars, buildFlags, buildPeople, buildTrees, buildWindsock } from './objects';

export interface World {
  object: THREE.Group;
  /** Shows the wind on the windsock and the flags: where it comes from, m/s. */
  setWind(fromDeg: number, speed: number): void;
  /** Lays the shadows for the current light. */
  setDaylight(light: Lighting): void;
  /** Call every frame with the eye position and the time in seconds. */
  update(eye: THREE.Vector3, seconds: number): void;
  /** Frees what the world holds on the graphics card, once it has left the scene. */
  dispose(): void;
}

/** Turn a drop zone pack into a scene graph, lit by `light`. */
export function buildWorld(dz: DzPack, light: Lighting): World {
  const object = new THREE.Group();
  const { groundAt } = dz;
  const windsock = buildWindsock(dz.windsock.x, dz.windsock.z, dz.windsock.height, groundAt);
  // The grass round the eye takes the light where the eye is: sun or cloud shadow.
  const grassLight = new THREE.Color().copy(light.ground);
  const grass = buildGrass({ ...dz.grass, target: dz.target }, grassLight);
  const water = buildWater(dz.water, light.horizon, dz.waterAreas);
  const flags = buildFlags(dz.flags, light.fabric, groundAt);
  const trees = buildTrees(dz.trees, groundAt);
  object.add(
    buildTerrain(dz.grass.area.color, groundAt, dz.landColor),
    buildSurfaces(dz.surfaces, dz.areas),
    buildDisc(dz.target.x, dz.target.z, dz.target.radius, 0xcdbf9a, dz.targetLayer ?? 4),
    buildDisc(dz.target.x, dz.target.z, 0.6, 0xe0452a, (dz.targetLayer ?? 4) + 1),
    buildBuildings(dz.buildings, groundAt),
    trees.object,
    buildCars(dz.cars, groundAt),
    buildPeople(dz.people, groundAt),
    windsock.object,
    grass.object,
    water.object,
    flags.object,
  );
  // Whatever the sun lights loses it under a cloud, and cast shadows fade there.
  const shaded = new Set<THREE.Material>();
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (shaded.has(m)) continue;
      shaded.add(m);
      if (m instanceof THREE.MeshLambertMaterial) light.clouds.shade(m, 'light');
      else if (m.userData.castShadow) light.clouds.shade(m, 'shadow');
    }
  });
  return {
    object,
    setWind(fromDeg, speed) {
      windsock.setWind(fromDeg, speed);
      flags.setWind(fromDeg, speed);
    },
    setDaylight(l) {
      trees.setSun(l.sun, l.shadow);
    },
    update(eye, seconds) {
      grassLight.lerpColors(light.groundShade, light.ground, light.clouds.sunThrough(eye.x, groundAt(eye.x, eye.z), eye.z));
      grass.update(eye, seconds);
      water.update(seconds);
      flags.update(seconds);
    },
    dispose() {
      object.traverse((node) => {
        const { geometry, material } = node as THREE.Mesh;
        geometry?.dispose();
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
      });
    },
  };
}
