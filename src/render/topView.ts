// The drop zone seen from straight above, for the map in the menu. Drawn by
// the same renderer and the same scene as the flight, in the light of the
// moment, with no haze, no sky, no clouds and no pilot: then copied onto the
// map's own canvas before the frame is drawn over it.

import * as THREE from 'three';

export class TopView {
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 20000);
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly fog: THREE.FogExp2,
  ) {
    // North at the top: the image's up is -Z, its right +X (east).
    this.camera.up.set(0, 0, -1);
  }

  /**
   * Draws the square `half` metres either side of (x, z) onto `out`, without
   * the objects in `hide`. Call it in the frame, before the frame's own
   * render: it uses the page's canvas for a moment. Returns whether it drew.
   */
  draw(out: HTMLCanvasElement, x: number, z: number, groundY: number, half: number, hide: THREE.Object3D[]): boolean {
    const renderer = this.renderer;
    const buffer = renderer.getDrawingBufferSize(this.size);
    const n = Math.floor(Math.min(out.width, buffer.x, buffer.y));
    const context = out.getContext('2d');
    if (n < 16 || !context) return false;

    const camera = this.camera;
    camera.left = camera.bottom = -half;
    camera.right = camera.top = half;
    camera.updateProjectionMatrix();
    camera.position.set(x, groundY + 6000, z);
    camera.lookAt(x, groundY, z);

    const shown = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const density = this.fog.density;
    this.fog.density = 0;
    const ratio = renderer.getPixelRatio();
    renderer.setViewport(0, 0, n / ratio, n / ratio);
    renderer.render(this.scene, camera);
    // The viewport sits at the bottom left of the drawing buffer.
    context.drawImage(renderer.domElement, 0, buffer.y - n, n, n, 0, 0, out.width, out.height);

    renderer.getSize(this.size);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    this.fog.density = density;
    hide.forEach((o, i) => (o.visible = shown[i]!));
    return true;
  }
}
