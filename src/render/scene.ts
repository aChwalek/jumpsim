// Renderer, sky, light and haze.

import * as THREE from 'three';

/**
 * Direction towards the sun: a morning sun, 30 degrees up in the east-south-east.
 * On final into a westerly wind it is behind the pilot, whose shadow lies on
 * the ground ahead and comes up to their feet.
 */
export const SUN = new THREE.Vector3(0.785, 0.5, 0.366).normalize();

const SKY_LIGHT = { color: 0xdbe8ff, intensity: 1.7 };
const SUN_LIGHT = { color: 0xfff1dc, intensity: 2.6 };

/** What flat ground sends back of its own colour, for things drawn without the lights. */
export const GROUND_LIGHT = new THREE.Color(SKY_LIGHT.color)
  .multiplyScalar(SKY_LIGHT.intensity)
  .add(new THREE.Color(SUN_LIGHT.color).multiplyScalar(SUN_LIGHT.intensity * SUN.y))
  .multiplyScalar(1 / Math.PI);

/** Colour of the sky low down, and of the haze. */
export const HORIZON = new THREE.Color(0xc4d6e6);
const ZENITH = new THREE.Color(0x3f7fd0);

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

const FIELD_OF_VIEW = 68;

export function createCamera(): THREE.PerspectiveCamera {
  // Far plane beyond the haze; what is nearer than the near plane is drawn
  // by the gear camera.
  return new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.25, 30000);
}

/** Layer of what the pilot has within arm's reach: risers, toggles, arms. */
export const GEAR_LAYER = 1;

/**
 * Same eye, same lens, but for the gear a hand's width from the face, which
 * the main camera's near plane would cut through. It draws over the picture.
 */
export function createGearCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.02, 20);
  camera.layers.set(GEAR_LAYER);
  return camera;
}

function buildSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      horizon: { value: HORIZON },
      zenith: { value: ZENITH },
      sun: { value: SUN },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sun;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 color = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.5));
        float s = max(dot(dir, sun), 0.0);
        color += vec3(1.0, 0.93, 0.8) * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.22);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

export interface SceneParts {
  scene: THREE.Scene;
  /** Keep centred on the camera. */
  sky: THREE.Mesh;
}

export function createScene(): SceneParts {
  const scene = new THREE.Scene();
  scene.background = HORIZON;
  // Haze: distant ground fades into the horizon colour, which gives depth.
  scene.fog = new THREE.FogExp2(HORIZON, 0.00011);
  scene.add(new THREE.HemisphereLight(SKY_LIGHT.color, 0x6b7a4a, SKY_LIGHT.intensity));
  const sunLight = new THREE.DirectionalLight(SUN_LIGHT.color, SUN_LIGHT.intensity);
  sunLight.position.copy(SUN);
  scene.add(sunLight);
  // Lights only reach what shares a layer with the camera drawing it.
  scene.traverse((node) => {
    if ((node as THREE.Light).isLight) node.layers.enable(GEAR_LAYER);
  });
  const sky = buildSky();
  scene.add(sky);
  return { scene, sky };
}

/**
 * Keeps the frame rate up by lowering the render resolution when frames get
 * slow, and raising it back when there is headroom.
 */
export class Resolution {
  /** Fraction of the display's native pixel density currently rendered. */
  scale = 1;
  private slow = 0;
  private fast = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private maxPixelRatio: number,
  ) {}

  setMaxPixelRatio(ratio: number): void {
    this.maxPixelRatio = ratio;
    this.apply();
  }

  apply(): void {
    const ratio = Math.min(window.devicePixelRatio, this.maxPixelRatio) * this.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  /** Call every frame with the frame duration in seconds. */
  track(frameSeconds: number): void {
    if (frameSeconds > 1 / 48) {
      this.slow += frameSeconds;
      this.fast = 0;
    } else if (frameSeconds < 1 / 57) {
      this.fast += frameSeconds;
      this.slow = 0;
    }
    if (this.slow > 1 && this.scale > 0.5) {
      this.scale = Math.max(0.5, this.scale * 0.85);
      this.slow = 0;
      this.apply();
    } else if (this.fast > 4 && this.scale < 1) {
      this.scale = Math.min(1, this.scale / 0.9);
      this.fast = 0;
      this.apply();
    }
  }
}
