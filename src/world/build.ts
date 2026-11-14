import * as THREE from 'three';
import type { Lighting } from '../render/scene';
import { buildBridges } from './bridge';
import { buildCliffTop, rockTexture, type RockMask } from './cliffTop';
import { facetedHeight, surfaceColorAt } from './cover';
import { isWet, type DzPack } from './dz';
import { buildGrass } from './grass';
import { TERRAIN_SPACING, buildDisc, buildSurfaces, buildTerrain, buildWater, loadPhotos } from './ground';
import { buildBuildings, buildCars, buildFlags, buildLedgeMarks, buildPeople, buildTrees, buildVines, buildWindsock } from './objects';

export interface World {
  object: THREE.Group;
  /** Shows the wind on the windsock and the flags: where it comes from, m/s. */
  setWind(fromDeg: number, speed: number): void;
  /** Lays the shadows for the current light. */
  setDaylight(light: Lighting): void;
  /** Call every frame with the eye position and the time in seconds. */
  update(eye: THREE.Vector3, seconds: number): void;
  /** Whether the aerial photos, if any, have all come in. */
  ready(): boolean;
  /** Frees what the world holds on the graphics card, once it has left the scene. */
  dispose(): void;
}

/** Whether the rock is mostly bare at the point. */
function bareRock(rock: RockMask, x: number, z: number): boolean {
  const i = Math.round((x - rock.x0) / rock.spacing);
  const j = Math.round((z - rock.z0) / rock.spacing);
  return i >= 0 && j >= 0 && i < rock.n && j < rock.n && rock.values[j * rock.n + i]! > 96;
}

/** Turn a drop zone pack into a scene graph, lit by `light`. */
export function buildWorld(dz: DzPack, light: Lighting): World {
  const object = new THREE.Group();
  const { groundAt } = dz;
  const windsock = buildWindsock(dz.windsock.x, dz.windsock.z, dz.windsock.height, groundAt);
  // The grass round the eye takes the light where the eye is: sun or cloud shadow.
  const grassLight = new THREE.Color().copy(light.ground);
  // Aerial photos, where the drop zone has some: they show as they come in.
  const photos = dz.imagery ? loadPhotos(dz.imagery, dz.grass.area.color, dz.imageryGain, dz.rockTint) : undefined;
  const grass = buildGrass(
    {
      ...dz.grass,
      target: dz.target,
      // The blades stand on the terrain as it is drawn, in the colour of what lies there.
      groundAt: facetedHeight(groundAt, TERRAIN_SPACING, dz.terrainDetail),
      photos,
      // Nor does it grow in water, or on the bare rock of a cliff top, which has its own tussocks.
      wet: (x, z) => isWet(dz, x, z) || (!!dz.cliffTop && bareRock(dz.cliffTop.rock, x, z)),
      colorAt: surfaceColorAt(dz.landColor ?? (() => dz.grass.area.color), dz.surfaces, dz.areas ?? []),
    },
    grassLight,
  );
  const water = buildWater(dz.water, light.horizon, dz.waterAreas, photos);
  const flags = buildFlags(dz.flags, light.fabric, groundAt);
  const trees = buildTrees(dz.trees, groundAt);
  // Bare rock about a BASE exit on a cliff, which the photos taken from above miss.
  const rock = dz.cliffTop ? rockTexture(dz.cliffTop.rock) : undefined;
  const cliffTop = dz.cliffTop ? buildCliffTop(dz.cliffTop, groundAt, dz.base?.pad) : undefined;
  // Named for the bench (?bench), which hides each in turn.
  const named = <T extends THREE.Object3D>(name: string, o: T): T => Object.assign(o, { name });
  object.add(
    named('terrain', buildTerrain(dz.grass.area.color, groundAt, dz.landColor, photos, dz.terrainDetail, rock)),
    named('surfaces', buildSurfaces(dz.surfaces, dz.areas)),
    named('buildings', buildBuildings(dz.buildings, groundAt)),
    named('trees', trees.object),
    named('cars', buildCars(dz.cars, groundAt)),
    named('people', buildPeople(dz.people, groundAt)),
    named('windsock', windsock.object),
    named('grass', grass.object),
    named('water', water.object),
    named('flags', flags.object),
  );
  const vines = dz.vineRows?.length ? buildVines(dz.vineRows, groundAt) : undefined;
  if (vines) object.add(named('vines', vines.object));
  if (dz.bridges) object.add(named('bridges', buildBridges(dz.bridges, groundAt)));
  if (cliffTop) object.add(named('cliffTop', cliffTop.object));
  // The run is painted on a tower's roof; a cliff has nothing on it, and off a bridge there is no run.
  if (dz.base?.marked && dz.topAt && dz.base.runUp > 0) object.add(buildLedgeMarks(dz.base, dz.topAt(dz.base.x, dz.base.z)));
  if (dz.targetShown !== false) {
    object.add(buildDisc(dz.target.x, dz.target.z, dz.target.radius, dz.targetColor ?? 0xcdbf9a, dz.targetLayer ?? 4));
    if (dz.targetCentre !== false) object.add(buildDisc(dz.target.x, dz.target.z, 0.6, 0xe0452a, (dz.targetLayer ?? 4) + 1));
  }
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
      trees.update(eye);
      water.update(seconds);
      flags.update(seconds);
      cliffTop?.update(seconds);
      vines?.update(eye);
    },
    ready() {
      const done = photos?.uniforms.photoReady?.value as THREE.Vector3 | undefined;
      return !done || done.x + done.y + done.z >= 3;
    },
    dispose() {
      photos?.dispose();
      rock?.texture.dispose();
      object.traverse((node) => {
        const { geometry, material } = node as THREE.Mesh;
        geometry?.dispose();
        // Where each copy stands, held apart from the geometry.
        if (node instanceof THREE.InstancedMesh) node.dispose();
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
      });
    },
  };
}
