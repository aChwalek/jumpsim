// The aerial photo round the eye, for what reads it point by point (the grass
// blades take their colour from it, the water its own), where the terrain is
// drawn as tiles and the drop zone's big photos are not loaded: the tiles'
// own photos, drawn from straight above into two small pictures that follow
// the eye. One close, a few hundred metres at half a metre a texel, for the
// grass; one wide, several kilometres, for the rivers and lakes seen from
// up high. They stand in for the photo levels the shaders read (PHOTO_GLSL).

import * as THREE from 'three';
import { loadPhotos, type Photos, type RockTint } from './ground';

/** The two pictures: metres a side, texels a side, how far the eye goes before one is drawn again (m). */
const LEVELS = [
  { size: 256, texels: 512, move: 24, every: 0.5 },
  { size: 8192, texels: 512, move: 1024, every: 2 },
] as const;

export interface LocalPhotos extends Photos {
  /** Draws a picture again where the eye has gone far enough, or the tiles have come in finer. */
  update(eye: THREE.Vector3, seconds: number, tilesChanged: boolean): void;
}

export function localPhotos(
  renderer: THREE.WebGLRenderer,
  tiles: THREE.Object3D,
  fallback: number,
  gain = 1,
  rockTint?: RockTint,
  grassBelow?: number,
): LocalPhotos {
  // The uniforms of photos with no levels yet; the two pictures take levels 0 and 1.
  const base = loadPhotos([], fallback, gain, rockTint, undefined, grassBelow);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  // East to the right; north at the bottom of the frame, which is the
  // picture's first row, as the photos have it: the frame is turned upside
  // down (top < bottom), and the tiles drawn from both sides.
  camera.up.set(0, 0, -1);
  const levels = LEVELS.map((spec, k) => {
    const target = new THREE.WebGLRenderTarget(spec.texels, spec.texels, {
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    base.uniforms[`photo${k}`]!.value = target.texture;
    (base.uniforms.photoSize!.value as THREE.Vector4).setComponent(k, spec.size);
    return { spec, target, k, at: new THREE.Vector2(Infinity, Infinity), drawn: -Infinity };
  });
  // The tiles drawn as their bare photos while they are pictured.
  const flat = new WeakMap<THREE.Mesh, THREE.MeshBasicMaterial>();
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const clear = new THREE.Color();

  const draw = (level: (typeof levels)[number], x: number, y: number, z: number): void => {
    const half = level.spec.size / 2;
    camera.left = camera.top = -half;
    camera.right = camera.bottom = half;
    camera.near = 1;
    camera.far = 20000;
    camera.updateProjectionMatrix();
    camera.position.set(x, y + 9000, z);
    camera.lookAt(x, y, z);
    camera.updateMatrixWorld();
    tiles.traverse((node) => {
      const mesh = node as THREE.Mesh;
      const m = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (!mesh.isMesh || !m?.map) return;
      let basic = flat.get(mesh);
      if (!basic || basic.map !== m.map) {
        basic?.dispose();
        basic = new THREE.MeshBasicMaterial({ map: m.map, fog: false, toneMapped: false, side: THREE.DoubleSide });
        flat.set(mesh, basic);
      }
      swapped.push([mesh, mesh.material]);
      mesh.material = basic;
    });
    const before = renderer.getRenderTarget();
    const clearColor = renderer.getClearColor(clear).getHex();
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(level.target);
    renderer.setClearColor(fallback, 1);
    renderer.clear();
    renderer.render(tiles, camera);
    renderer.setRenderTarget(before);
    renderer.setClearColor(clearColor, clearAlpha);
    for (const [mesh, m] of swapped) mesh.material = m;
    swapped.length = 0;
    (base.uniforms.photoCentre!.value as THREE.Vector2[])[level.k]!.set(x, z);
    (base.uniforms.photoReady!.value as THREE.Vector4).setComponent(level.k, 1);
    level.at.set(x, z);
  };

  return {
    ...base,
    textures: levels.map((l) => l.target.texture),
    ready: () => true,
    update(eye, seconds, tilesChanged) {
      for (const level of levels) {
        const moved = Math.hypot(eye.x - level.at.x, eye.z - level.at.y) > level.spec.move;
        if (!moved && !(tilesChanged && seconds - level.drawn > level.spec.every)) continue;
        // On a grid of a few texels, so that the picture does not swim as the eye moves.
        const step = (level.spec.size / level.spec.texels) * 8;
        draw(level, Math.round(eye.x / step) * step, eye.y, Math.round(eye.z / step) * step);
        level.drawn = seconds;
      }
    },
    dispose() {
      for (const l of levels) l.target.dispose();
      base.dispose();
    },
  };
}
