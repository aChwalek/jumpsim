// Renderer, cameras, sky, light and haze.

import * as THREE from 'three';
import { handheld, viewSize } from '../viewport';
import { Clouds } from './clouds';
import type { Daylight } from './daylight';

/**
 * Eyes in the dark: dim things lose their colour and go a cold grey (the
 * rods take over from the cones), while lamps, glow sticks and the moon keep
 * theirs. Done in three.js's custom tone mapping, which every material runs;
 * `toneMappingExposure` carries how dark it is, from 1 by day to 2 at night
 * (see `nightVision`), and changing it compiles nothing.
 */
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
    float night = clamp( toneMappingExposure - 1.0, 0.0, 1.0 );
    if ( night <= 0.0 ) return color;
    float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    float cones = smoothstep( 0.02, 0.3, l );
    vec3 rods = l * vec3( 0.78, 0.92, 1.3 );
    return mix( color, rods, night * ( 1.0 - cones ) );
  }`,
);

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.CustomToneMapping;
  return renderer;
}

/** Sets how dark adapted the eyes are for the next renders, 0 by day to 1 at night (see the tone mapping above). */
export function nightVision(renderer: THREE.WebGLRenderer, night: number): void {
  renderer.toneMappingExposure = 1 + Math.min(1, Math.max(0, night));
}

export const FIELD_OF_VIEW = 68;

export function createCamera(): THREE.PerspectiveCamera {
  // Far plane beyond the haze; what is nearer than the near plane is drawn
  // by the gear camera.
  return new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.25, 30000);
}

/** Layer of what the pilot has within arm's reach: risers, toggles, arms. */
export const GEAR_LAYER = 1;
/** Layer of what only an outside camera sees: the head the eyes are in. */
export const OUTSIDE_LAYER = 2;

/**
 * Same eye, same lens, but for the gear a hand's width from the face, which
 * the main camera's near plane would cut through. It draws over the picture.
 */
export function createGearCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.02, 20);
  camera.layers.set(GEAR_LAYER);
  return camera;
}

/**
 * The light of the moment, shared by everything that needs it: change it with
 * `set` and the sky, the lights, the haze and the materials holding these
 * objects follow.
 */
export class Lighting {
  /** Direction towards the sun. */
  readonly sun = new THREE.Vector3(0, 1, 0);
  /** What flat ground sends back of its own colour. */
  readonly ground = new THREE.Color();
  /** Colour of the sky low down and of the haze. */
  readonly horizon = new THREE.Color();
  /** Brightness of fabric drawn without the lights. */
  readonly fabric = new THREE.Color(1, 1, 1);
  /** The same two in the shadow of a cloud. */
  readonly groundShade = new THREE.Color();
  readonly fabricShade = new THREE.Color(1, 1, 1);
  /** Darkness of cast shadows, 0..1. */
  shadow = 1;
  readonly zenith = new THREE.Color();
  readonly glow = new THREE.Color();
  readonly glowStrength = { value: 0 };
  readonly disc = { value: 1 };
  /** Towards the sun wherever it is, even set; towards the moon; how bright its disc is; how many stars. */
  readonly realSun = new THREE.Vector3(0, 1, 0);
  readonly moon = new THREE.Vector3(0, -1, 0);
  readonly moonDisc = { value: 0 };
  readonly stars = { value: 0 };
  /** How dark adapted the eyes are, 0 by day, 1 at night. */
  night = 0;
  /** Lamps lit, 0 to 1: shared by everything that glows in the dark. */
  readonly lamps = { value: 0 };
  readonly skyLight = new THREE.HemisphereLight(0xffffff, 0x6b7a4a, 1);
  readonly sunLight = new THREE.DirectionalLight(0xffffff, 1);
  readonly fog = new THREE.FogExp2(0xffffff, 0.0001);
  /** Sunlight and skylight on the clouds, and the haze they fade into. */
  private readonly cloudSun = new THREE.Color();
  private readonly cloudShade = new THREE.Color();
  private readonly cloudFog = { value: 0 };
  /** Cumulus, when the sky has them, and their shadows. */
  readonly clouds = new Clouds(this.sun, { sun: this.cloudSun, shade: this.cloudShade, haze: this.horizon, fog: this.cloudFog });

  set(d: Daylight): void {
    this.sun.copy(d.sun);
    this.ground.copy(d.ground);
    this.horizon.copy(d.horizon);
    this.fabric.copy(d.fabric);
    this.shadow = d.shadow;
    this.zenith.copy(d.zenith);
    this.glow.copy(d.glow);
    this.glowStrength.value = d.glowStrength;
    this.disc.value = d.disc;
    this.realSun.copy(d.realSun);
    this.moon.copy(d.moon);
    this.moonDisc.value = d.moonDisc;
    this.stars.value = d.stars;
    this.night = d.night;
    this.lamps.value = d.lamps;
    this.skyLight.color.copy(d.skyColor);
    this.skyLight.intensity = d.skyIntensity;
    this.sunLight.color.copy(d.sunColor);
    this.sunLight.intensity = d.sunIntensity;
    this.sunLight.position.copy(d.sun);
    this.fog.color.copy(d.horizon);
    this.fog.density = d.fogDensity;
    this.groundShade.copy(d.groundShade);
    this.fabricShade.copy(d.fabricShade);
    this.cloudSun.copy(d.cloudSun);
    this.cloudShade.copy(d.cloudShade);
    // The haze lies low: clouds above it fade out farther than the ground.
    this.cloudFog.value = 0.5 * d.fogDensity;
    this.clouds.show(d.clouds);
  }
}

function buildSky(light: Lighting): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      horizon: { value: light.horizon },
      zenith: { value: light.zenith },
      sun: { value: light.realSun },
      glow: { value: light.glow },
      glowStrength: light.glowStrength,
      disc: light.disc,
      moon: { value: light.moon },
      moonDisc: light.moonDisc,
      stars: light.stars,
      lamps: light.lamps,
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
      uniform vec3 glow;
      uniform float glowStrength;
      uniform float disc;
      uniform vec3 moon;
      uniform float moonDisc;
      uniform float stars;
      uniform float lamps;
      varying vec3 vDir;
      vec3 hash3(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }
      void main() {
        vec3 dir = normalize(vDir);
        vec3 color = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.5));
        // A low sun warms a band of sky along the horizon, most on its side.
        float side = max(dot(normalize(dir.xz + 1e-5), normalize(sun.xz + 1e-5)), 0.0);
        float band = exp(-max(dir.y, 0.0) * 7.0);
        color = mix(color, glow, glowStrength * band * (0.25 + 0.75 * side * side * side));
        // The towns' lamps light the haze along the horizon a little.
        color += vec3(0.022, 0.016, 0.01) * lamps * exp(-max(dir.y, 0.0) * 18.0);
        float s = max(dot(dir, sun), 0.0);
        color += vec3(1.0, 0.93, 0.8) * disc * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.22);
        // Width of a pixel, in directions.
        float pixel = length(fwidth(dir));
        if (stars > 0.0) {
          // One star in a cell of the sky here and there, at a random place in it, of a random brightness.
          vec3 p = dir * 260.0;
          vec3 cell = floor(p);
          vec3 h = hash3(cell);
          if (h.x < 0.011) {
            vec3 at = normalize(cell + 0.3 + 0.4 * hash3(cell + 17.0));
            float d = length(dir - at);
            float size = max(pixel, 0.0008) * 0.85;
            float point = 1.0 - smoothstep(size * 0.4, size * 1.4, d);
            // Mostly faint ones, which the moon drowns first; a few bright.
            float bright = pow(h.y, 9.0) * 2.2 + 0.1 * smoothstep(0.3, 1.0, stars) * h.y;
            vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.86, 0.7), h.z);
            // Seen through more air low down, they dim.
            color += tint * point * bright * stars * smoothstep(-0.02, 0.25, dir.y);
          }
        }
        if (moonDisc > 0.0) {
          // The moon, lit on the side the sun is: its phase comes out of where the two are.
          float radius = 0.0045;
          float m = dot(dir, moon);
          vec3 across = (dir - moon * m) / radius;
          float r = length(across);
          float inside = 1.0 - smoothstep(1.0 - pixel / radius, 1.0 + pixel / radius, r);
          if (m > 0.0 && inside > 0.0) {
            vec3 normal = across - moon * sqrt(max(0.0, 1.0 - r * r));
            float lit = smoothstep(-0.08, 0.12, dot(normal, sun));
            // Its seas, a few darker patches.
            float seas = 0.82 + 0.18 * smoothstep(0.3, 0.6, fract(sin(dot(floor(across.xy * 3.0 + 4.0), vec2(12.9, 78.2))) * 43758.5));
            color = mix(color, color + vec3(1.0, 0.98, 0.92) * seas * moonDisc, lit * inside);
          }
          // And a halo about it in the haze.
          float near = max(m, 0.0);
          color += vec3(0.6, 0.66, 0.8) * moonDisc * (pow(near, 4000.0) * 0.12 + pow(near, 90.0) * 0.025) * (1.0 - disc);
        }
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
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
  light: Lighting;
}

export function createScene(): SceneParts {
  const scene = new THREE.Scene();
  const light = new Lighting();
  scene.background = light.horizon;
  // Haze: distant ground fades into the horizon colour, which gives depth.
  scene.fog = light.fog;
  scene.add(light.skyLight, light.sunLight);
  // Lights only reach what shares a layer with the camera drawing it.
  scene.traverse((node) => {
    if ((node as THREE.Light).isLight) {
      node.layers.enable(GEAR_LAYER);
      node.layers.enable(OUTSIDE_LAYER);
    }
  });
  const sky = buildSky(light);
  scene.add(sky, light.clouds.layer);
  return { scene, sky, light };
}

/**
 * Keeps the frame rate up by lowering the render resolution when frames get
 * slow, and raising it back when there is headroom.
 */
export class Resolution {
  /** Fraction of the display's native pixel density currently rendered. */
  scale = 1;
  /**
   * Lowest scale it goes down to. Not far on a phone: its picture is already 1x,
   * and below that the trees break into grain while the frame rate hardly moves.
   */
  private readonly minScale = handheld() ? 0.8 : 0.5;
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
    const { width, height } = viewSize();
    this.renderer.setSize(width, height, false);
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
    if (this.slow > 1 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale * 0.85);
      this.slow = 0;
      this.apply();
    } else if (this.fast > 4 && this.scale < 1) {
      this.scale = Math.min(1, this.scale / 0.9);
      this.fast = 0;
      this.apply();
    }
  }
}
