// Suspension lines: pale, and as thin as they are. A line cannot be drawn
// thinner than a pixel, so from the distance where it would be, it fades
// instead: close to, lines are plain to see; across the sky, a canopy seems to
// hang over its pilot on next to nothing.

import * as THREE from 'three';

/** Width the lines are drawn as having, m: solid for as long as this covers a pixel. */
const WIDTH = 0.012;
const COLOUR = 0xd2d2cc;
const viewport = new THREE.Vector4();

/**
 * Lines on `geometry`, a pair of points each. `light`: brightness of what is
 * drawn without the lights, followed as it changes.
 */
export function suspensionLines(geometry: THREE.BufferGeometry, light: THREE.Color): THREE.LineSegments {
  const material = new THREE.LineBasicMaterial({ color: COLOUR, transparent: true, depthWrite: false });
  const uniforms = { lineLight: { value: light }, lineScale: { value: 1 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float lineScale;\nvarying float vLineCover;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        // How much of a pixel the line's width covers here.
        vLineCover = lineScale * projectionMatrix[1][1] / max(gl_Position.w, 1e-3);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 lineLight;\nvarying float vLineCover;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= lineLight;
        // Faster than the cover alone: the many lines of a far canopy lie
        // over one another, and would add up to a veil under it.
        diffuseColor.a *= pow(min(vLineCover, 1.0), 1.5);`,
      );
  };
  material.customProgramCacheKey = () => 'suspension-lines';
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  // Over the clouds, which do not know the lines are in front of them.
  lines.renderOrder = 60;
  // The picture's height is that of whatever is being drawn into.
  lines.onBeforeRender = (renderer) => {
    uniforms.lineScale.value = WIDTH * 0.5 * renderer.getCurrentViewport(viewport).w;
  };
  return lines;
}
