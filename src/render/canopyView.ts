// A canopy as it is seen: fabric that fills cell by cell as it opens, flies,
// bends under the toggles and the front risers, flutters in the airflow, and
// goes down in a heap on the ground; its lines, which sag when nothing holds
// them tight; the slider, which stays down on the links until the pilot
// collapses or removes it; the risers down to the harness, the toggles and the
// hands on them; and behind it all, the pilot chute and its bag.
//
// The shape is worked out again every frame, point by point, from what the
// canopy is doing: none of it acts on the flight, which the flight model owns.
//
// Canopy frame: origin at the joint (where the risers meet the harness), Y up
// the lines, -Z towards the nose, X to the right.

import * as THREE from 'three';
import type { Controls } from '../sim/flightModel';
import type { RigParams } from '../sim/rig';
import { RING, SHOULDER } from './body';
import { Deployment } from './deployment';
import { GEAR_LAYER, type Lighting } from './scene';

const DEG = Math.PI / 180;
/** Where the surfaces are sampled along the chord, nose (0) to tail (1). The bottom one starts behind the cell openings. */
const TOP_STATIONS = [0, 0.012, 0.04, 0.09, 0.16, 0.25, 0.36, 0.48, 0.6, 0.7, 0.79, 0.87, 0.94, 1];
const BOTTOM_STATIONS = [0.1, 0.16, 0.25, 0.36, 0.48, 0.6, 0.7, 0.79, 0.87, 0.94, 1];
/** Line attachment rows, A to D. */
const LINE_CHORDS = [0.12, 0.32, 0.56, 0.8];
/** Pieces across each chamber, so the fabric can round out between the ribs. */
const SUB = 4;
/** Where the tail starts to bend down under brakes. */
const HINGE = 0.6;
/** Furthest the tail goes down at the tips with the toggles buried. */
const TAIL_DOWN = 62 * DEG;
/** Each line is drawn in this many pieces, to sag when slack. */
const PIECES = 6;
/** Slider grid, pieces each way. */
const SLIDER_PIECES = 6;
/** Half the slider's spread on the lines when it is up against the canopy, m. */
const SLIDER = { x: 0.36, z: 0.4 };
/** How far a fully pulled front riser comes down, m. */
const FRONT_PULL = 0.18;
const FRONT_LINK = new THREE.Vector3(0.21, 0, -0.11);
const REAR_LINK = new THREE.Vector3(0.23, 0, 0.03);
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
/** Elbows point down, out and a little back, as when pulling something down. */
const ELBOW_OUT = new THREE.Vector3(0.6, -0.7, 0.35);
const UP = new THREE.Vector3(0, 1, 0);
/** Riser length hanging free from the links once cut away, m. */
const FREE_RISER = 0.55;

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Half-thickness of a symmetrical airfoil at a fraction of the chord, as a fraction of the chord. */
const airfoil = (c: number): number =>
  0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1015 * c ** 4;

/** What the slider is doing: on the links, collapsed there, or taken off and stowed. */
export type SliderState = 'open' | 'collapsed' | 'stowed';

/** What drives the canopy this frame. */
export interface CanopyLook {
  /** Sim time, s: the fabric moves with it. */
  time: number;
  dt: number;
  /** The air through the canopy, world frame, m/s: wind minus the canopy's own velocity. */
  air: THREE.Vector3;
  /** What the canopy's lines are pulled to (stowed brakes included), and where the hands are. */
  controls: Controls;
  hands: Controls;
  /** The pilot's attitude, for where the risers and the arms meet the body; null once cut away. */
  pilotAtt: THREE.Quaternion | null;
  /** Height of the ground under the canopy, m. */
  ground: number;
}

/** What hangs on one side of the pilot: risers, toggle, and the arm working them. */
interface Side {
  sign: number;
  front: THREE.Mesh;
  rear: THREE.Mesh;
  toggle: THREE.Mesh;
  hand: THREE.Mesh;
  upperArm: THREE.Mesh;
  forearm: THREE.Mesh;
  /** Bottom of the risers, on the harness; tops of the front and rear risers. */
  foot: THREE.Vector3;
  frontLink: THREE.Vector3;
  rearLink: THREE.Vector3;
  /** The guide ring the steering line runs through, and the hand. */
  ring: THREE.Vector3;
  grip: THREE.Vector3;
  shoulder: THREE.Vector3;
  /** Where the front and rear lines of this side pass through the slider. */
  frontGrommet: THREE.Vector3;
  rearGrommet: THREE.Vector3;
}

/** One line, from a point on the risers or the slider to the canopy. */
interface Line {
  from: THREE.Vector3;
  /** Recomputed every frame. */
  to: THREE.Vector3;
  /** Its length, m, when the canopy flies with the slider down. */
  length: number;
  /** The slider it runs through, if it starts there: the line above it gets shorter as it rises. */
  grommet: 'front' | 'rear' | null;
  sign: number;
  s: number;
  c: number;
  /** A steering line: its end is the tail. */
  steering: boolean;
}

export class CanopyView {
  /** Canopy, lines, slider and risers, in the canopy's frame. */
  readonly object = new THREE.Group();
  /** The canopy's shadow on the ground, world frame. */
  readonly shadow = new THREE.Group();
  /** Pilot chute, bridle and bag: world frame. */
  readonly deployment: Deployment;

  private readonly cells: number;
  private readonly chambers: number;
  private readonly palette: number[];
  private readonly fabric: THREE.BufferGeometry;
  private readonly fabricMaterial: THREE.MeshLambertMaterial;
  /** Light coming through the fabric from the sky behind it. */
  private readonly glow = new THREE.Color();
  private readonly linesGeometry: THREE.BufferGeometry;
  private readonly lines: Line[] = [];
  private readonly slider: THREE.BufferGeometry;
  private readonly sliderMesh: THREE.Mesh;
  private readonly sides: Side[] = [];
  private readonly canopyShadow: THREE.Mesh;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;

  // What shapes the canopy this frame.
  /** null while packed, 0 at line stretch, 1 once open. */
  private inflation: number | null = 1;
  private spread = 1;
  private chordScale = 1;
  private readonly fill: Float32Array;
  private readonly flap: Float32Array;
  private flutter = 0;
  private time = 0;
  /** The tail as drawn follows the lines with a little lag and spring, each side. */
  private readonly tail = [0, 0];
  private readonly tailSpeed = [0, 0];
  private front = [0, 0];
  /** Lost its shape in the air, cut away: 0 to 1. */
  private crumple = 0;
  /** Down on the ground: 0 to 1, and which way it lies. */
  private heap = 0;
  private readonly heapAlong = new THREE.Vector3(0, 0, 1);
  private readonly heapAcross = new THREE.Vector3(1, 0, 0);
  private readonly heapCentre = new THREE.Vector3();
  private heapSet = false;
  private released = false;
  private armsShown = true;
  private sliderState: SliderState = 'open';
  /** From one slider state to the next, 0 to 1, with the hands up at it meanwhile. */
  private sliderMove = 1;
  private sliderFrom: SliderState = 'open';

  // Scratch, and the frame of this moment.
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private readonly reach = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly upLocal = new THREE.Vector3(0, 1, 0);
  private readonly flowLocal = new THREE.Vector3(0, 1, 0);
  private readonly inverse = new THREE.Quaternion();
  private readonly relative = new THREE.Quaternion();
  private readonly world = new THREE.Vector3();
  /** The ground's height: up the canopy frame's up from its origin, and in the world. */
  private groundLocal = -1e9;
  private groundLocalWorld = 0;
  /** Where the lines pull each side's tail this frame. */
  private readonly tailTarget = [0, 0];
  private chamberWidth = 0;
  /** The bridle's attachment on top, canopy frame, as last drawn. */
  private readonly top = new THREE.Vector3();
  private readonly liftLocal = new THREE.Vector3();
  private readonly liftSkin = new THREE.Vector3();

  constructor(
    private readonly rig: RigParams,
    palette: number[],
    light: Lighting,
    /** A reserve: its own pilot chute and free bag, a slider that stays put. */
    readonly reserve = false,
  ) {
    this.cells = rig.config.cells;
    this.chambers = rig.config.chambersPerCell;
    this.palette = palette;
    this.fill = new Float32Array(this.cells).fill(1);
    this.flap = new Float32Array(this.cells);
    this.chamberWidth = rig.span / (this.cells * this.chambers);

    // The fabric: every cell a grid of its own for each surface, so colours
    // stay sharp at the seams; tip ribs; stabilisers under the tips.
    this.fabric = new THREE.BufferGeometry();
    const { count, index, colors } = this.buildFabric();
    this.fabric.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.fabric.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.fabric.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.fabric.setIndex(index);
    // Lit by the sun and the sky on the side they reach, and glowing with
    // what comes through the fabric on the other: seen from under it, a
    // canopy is mostly light shining through.
    this.fabricMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      color: 0x8c8c8c,
      emissive: this.glow,
    });
    this.fabricMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #if NUM_DIR_LIGHTS > 0
          float through = max(0.0, dot(-normal, directionalLights[0].direction));
        #else
          float through = 0.5;
        #endif
        totalEmissiveRadiance *= vColor.rgb * (0.55 + 0.6 * through);`,
      );
    };
    this.fabricMaterial.customProgramCacheKey = () => 'canopy-fabric';
    const fabricMesh = new THREE.Mesh(this.fabric, this.fabricMaterial);
    fabricMesh.frustumCulled = false;
    this.object.add(fabricMesh);

    // Risers, toggles and the arms on them: stretched between two points.
    const suit = new THREE.MeshLambertMaterial({ color: 0x1d2a44 });
    // Seen from below against the sky, most of this is in its own shade: a
    // little glow keeps it from going black.
    const webbing = new THREE.MeshLambertMaterial({ color: 0x33363b, emissive: 0x0d0e10 });
    const glove = new THREE.MeshLambertMaterial({ color: 0x6f747c, emissive: 0x1d1f23 });
    const handle = new THREE.MeshLambertMaterial({ color: 0xffd84a });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.layers.set(GEAR_LAYER);
      this.object.add(mesh);
      return mesh;
    };
    const part = (width: number, depth: number, material: THREE.Material, length = 1): THREE.Mesh =>
      add(new THREE.BoxGeometry(width, length, depth), material);
    const limb = (radius: number): THREE.Mesh => add(new THREE.CapsuleGeometry(radius, 1 - 2 * radius, 3, 10), suit);
    for (const sign of [-1, 1]) {
      this.sides.push({
        sign,
        front: part(0.027, 0.006, webbing),
        rear: part(0.027, 0.006, webbing),
        toggle: part(0.024, 0.01, handle, 0.11),
        hand: add(new THREE.IcosahedronGeometry(0.046, 2).scale(0.85, 1.15, 0.9), glove),
        upperArm: limb(0.042),
        forearm: limb(0.034),
        foot: new THREE.Vector3(),
        frontLink: new THREE.Vector3(),
        rearLink: new THREE.Vector3(),
        ring: new THREE.Vector3(),
        grip: new THREE.Vector3(),
        shoulder: new THREE.Vector3(),
        frontGrommet: new THREE.Vector3(),
        rearGrommet: new THREE.Vector3(),
      });
    }

    // The lines: up from the slider's grommets to the four rows on every
    // load-bearing rib, the steering lines to the tail, the bundles from the
    // links up to the slider, and the steering lines down to the toggles.
    const [left, right] = [this.sides[0]!, this.sides[1]!];
    for (let rib = 0; rib <= this.cells; rib++) {
      const s = (rib / this.cells) * 2 - 1;
      const g = s < 0 ? left : right;
      LINE_CHORDS.forEach((c, k) => {
        const front = k < 2;
        this.lines.push({ from: front ? g.frontGrommet : g.rearGrommet, to: new THREE.Vector3(), length: 0, grommet: front ? 'front' : 'rear', sign: g.sign, s, c, steering: false });
      });
      this.lines.push({ from: g.rearGrommet, to: new THREE.Vector3(), length: 0, grommet: 'rear', sign: g.sign, s, c: 1, steering: true });
    }
    for (const g of [left, right]) {
      this.lines.push({ from: g.frontLink, to: g.frontGrommet, length: 0, grommet: null, sign: g.sign, s: 0, c: -1, steering: false });
      this.lines.push({ from: g.rearLink, to: g.rearGrommet, length: 0, grommet: null, sign: g.sign, s: 0, c: -1, steering: false });
      this.lines.push({ from: g.ring, to: g.rearGrommet, length: 0, grommet: null, sign: g.sign, s: 0, c: -1, steering: false });
      this.lines.push({ from: g.grip, to: g.ring, length: 0, grommet: null, sign: g.sign, s: 0, c: -1, steering: false });
    }
    this.linesGeometry = new THREE.BufferGeometry();
    this.linesGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.lines.length * PIECES * 6), 3));
    const lineMesh = new THREE.LineSegments(this.linesGeometry, new THREE.LineBasicMaterial({ color: 0x1c1c1c }));
    lineMesh.frustumCulled = false;
    this.object.add(lineMesh);

    // The slider: a square of fabric on the four line groups.
    this.slider = new THREE.BufferGeometry();
    const n = SLIDER_PIECES + 1;
    this.slider.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const sliderIndex: number[] = [];
    for (let i = 0; i < SLIDER_PIECES; i++) {
      for (let j = 0; j < SLIDER_PIECES; j++) {
        const k = i * n + j;
        sliderIndex.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
      }
    }
    this.slider.setIndex(sliderIndex);
    // Canopy fabric, a shade darker so it reads against the canopy behind
    // it, with the tape round its edge darker still. Lit, and lit through,
    // as the canopy is.
    const sliderColours = new Float32Array(n * n * 3);
    const sliderColour = new THREE.Color(palette[Math.floor(palette.length / 2)]!).multiplyScalar(0.8);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1 ? 0.55 : 1;
        sliderColours.set([sliderColour.r * edge, sliderColour.g * edge, sliderColour.b * edge], (i * n + j) * 3);
      }
    }
    this.slider.setAttribute('color', new THREE.BufferAttribute(sliderColours, 3));
    this.sliderMesh = new THREE.Mesh(this.slider, this.fabricMaterial);
    this.sliderMesh.frustumCulled = false;
    this.object.add(this.sliderMesh);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x08100a,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      // Over every layer of flat ground, and the shadows of the trees.
      polygonOffsetFactor: -22,
      polygonOffsetUnits: -22,
    });
    // The canopy's outline from above: rounded at the nose, narrower at the tips.
    const outline = new THREE.Shape();
    const half = rig.span * 0.46;
    const steps = 24;
    for (let k = 0; k <= steps; k++) {
      const x = -half + (2 * half * k) / steps;
      const a = Math.abs(x / half);
      const chord = rig.chord * (1 - 0.3 * Math.max(0, (a - 0.7) / 0.3) ** 2) * Math.sqrt(Math.max(0, 1 - a ** 8));
      if (k === 0) outline.moveTo(x, -0.35 * chord);
      else outline.lineTo(x, -0.35 * chord);
    }
    for (let k = steps; k >= 0; k--) {
      const x = -half + (2 * half * k) / steps;
      const a = Math.abs(x / half);
      const chord = rig.chord * (1 - 0.3 * Math.max(0, (a - 0.7) / 0.3) ** 2) * Math.sqrt(Math.max(0, 1 - a ** 8));
      outline.lineTo(x, 0.65 * chord);
    }
    this.canopyShadow = new THREE.Mesh(new THREE.ShapeGeometry(outline).rotateX(-Math.PI / 2), this.shadowMaterial);
    this.canopyShadow.renderOrder = 7;
    this.shadow.add(this.canopyShadow);
    light.clouds.shade(this.shadowMaterial, 'shadow');
    light.clouds.shade(this.fabricMaterial, 'light');
    for (const m of [suit, webbing, glove, handle]) light.clouds.shade(m, 'light');

    // The pilot chute in the darkest colour of the canopy, as most come.
    const darkest = palette.reduce((a, b) => (new THREE.Color(a).getHSL({ h: 0, s: 0, l: 0 }).l <= new THREE.Color(b).getHSL({ h: 0, s: 0, l: 0 }).l ? a : b));
    this.deployment = new Deployment(reserve, reserve ? 0xe8e8e2 : darkest);

    // Line lengths: what they measure flying, slider down, hands up.
    this.measureLines();
  }

  /** Vertex count, triangles and colours of the fabric, in the order `reshape` fills it. */
  private buildFabric(): { count: number; index: number[]; colors: Float32Array } {
    const across = this.chambers * SUB + 1;
    const index: number[] = [];
    const colors: number[] = [];
    let v = 0;
    const colour = new THREE.Color();
    const tint = (cell: number, k: number): void => {
      colour.setHex(this.palette[cell % this.palette.length]!).multiplyScalar(k);
      colors.push(colour.r, colour.g, colour.b);
    };
    for (const stations of [TOP_STATIONS, BOTTOM_STATIONS]) {
      const bottom = stations === BOTTOM_STATIONS;
      for (let cell = 0; cell < this.cells; cell++) {
        const base = v;
        for (let i = 0; i < across; i++) {
          // Seams show darker where the ribs are sewn in, the load-bearing
          // ones most: the light coming through has two layers to cross.
          const seam = i === 0 || i === across - 1 ? 0.8 : i % SUB === 0 ? 0.9 : 1;
          for (let j = 0; j < stations.length; j++) {
            tint(cell, (bottom ? 0.88 : 1) * seam);
            v++;
          }
        }
        const m = stations.length;
        for (let i = 0; i < across - 1; i++) {
          for (let j = 0; j < m - 1; j++) {
            const k = base + i * m + j;
            index.push(k, k + 1, k + m, k + 1, k + m + 1, k + m);
          }
        }
      }
    }
    // Tip ribs: the airfoil closed off at each end, fanned from its middle.
    for (const end of [0, this.cells - 1]) {
      const centre = v++;
      tint(end, 0.8);
      const ring = TOP_STATIONS.length + BOTTOM_STATIONS.length;
      for (let k = 0; k < ring; k++) {
        tint(end, 0.8);
        index.push(centre, centre + 1 + k, centre + 1 + ((k + 1) % ring));
      }
      v += ring;
    }
    // Stabilisers: a triangle of fabric under each tip, to the slider stop.
    for (const end of [0, this.cells - 1]) {
      const point = v++;
      tint(end, 0.85);
      for (let k = 0; k < STABILISER.length; k++) tint(end, 0.85);
      for (let k = 0; k < STABILISER.length - 1; k++) index.push(point, point + 1 + k, point + 2 + k);
      v += STABILISER.length;
    }
    return { count: v, index, colors: new Float32Array(colors) };
  }

  /** How far the canopy is out: null while packed, from 0 at line stretch to 1 open. */
  setInflation(inflation: number | null): void {
    this.inflation = inflation;
  }

  /** Lost its shape in the air (cut away), from 0 to 1. */
  setCrumple(k: number): void {
    this.crumple = k;
  }

  /**
   * Down on the ground: from 0 (still standing) to 1 (lying in a heap),
   * falling towards `to` (level, world frame) from the riser ends at `from`.
   */
  setHeap(k: number, from?: THREE.Vector3, to?: THREE.Vector3): void {
    this.heap = k;
    if (k <= 0) {
      this.heapSet = false;
      return;
    }
    if (!this.heapSet && from && to) {
      this.heapSet = true;
      this.heapAlong.set(to.x, 0, to.z).normalize();
      // Across: the canopy's own span, made level and square to the fall.
      this.heapAcross.set(1, 0, 0).applyQuaternion(this.object.quaternion).setY(0);
      this.heapAcross.addScaledVector(this.heapAlong, -this.heapAcross.dot(this.heapAlong));
      if (this.heapAcross.lengthSq() < 1e-4) this.heapAcross.set(-this.heapAlong.z, 0, this.heapAlong.x);
      this.heapAcross.normalize();
      this.heapCentre.copy(from).addScaledVector(this.heapAlong, this.rig.lineLength * 0.85 + 0.6);
    }
  }

  /** The risers are free of the harness: the canopy has been cut away. */
  setReleased(released: boolean): void {
    this.released = released;
    if (released) this.setArms(false);
  }

  /** Shows the hands and arms on the toggles, or not (in freefall, on the ground, once cut away). */
  setArms(visible: boolean): void {
    this.armsShown = visible && !this.released;
    for (const g of this.sides) {
      g.hand.visible = g.upperArm.visible = g.forearm.visible = this.armsShown;
    }
  }

  /** Collapses or takes off the slider, which the hands go up to do; or puts it back for a new jump. */
  setSlider(state: SliderState, now = false): void {
    if (state === this.sliderState) return;
    this.sliderFrom = this.sliderState;
    this.sliderState = state;
    this.sliderMove = now ? 1 : 0;
  }

  /** The hands are up at the slider. */
  get sliderBusy(): boolean {
    return this.sliderMove < 1;
  }

  /** Where the bridle is sewn on top of the canopy, world frame. */
  topAttach(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.top).applyQuaternion(this.object.quaternion).add(this.object.position);
  }

  /** The tops of the four risers, world frame, as the lines leave them. */
  riserTops(out: THREE.Vector3[]): THREE.Vector3[] {
    let k = 0;
    for (const g of this.sides) {
      for (const link of [g.frontLink, g.rearLink]) {
        out[k++]!.copy(link).applyQuaternion(this.object.quaternion).add(this.object.position);
      }
    }
    return out;
  }

  /**
   * Pushes a world point that has got under the top skin back out through
   * it, to `clear` above the fabric, by `most` metres at the most: what keeps
   * the bag, the bridle and the pilot chute lying on top of the canopy.
   * Returns whether it moved the point. A canopy crumpled or lying down
   * holds nothing up.
   */
  liftOut(p: THREE.Vector3, clear: number, most: number): boolean {
    if (!this.object.visible || this.heap > 0 || this.crumple > 0.2) return false;
    const rig = this.rig;
    const local = this.liftLocal.copy(p).sub(this.object.position).applyQuaternion(this.inverse);
    // Round the arc: which way out from the links, and how far.
    const dy = local.y - rig.linksPos.y;
    const r = Math.hypot(local.x, dy);
    const s = (Math.atan2(local.x, dy) * 2 * rig.lineLength) / (this.spread * rig.span);
    if (Math.abs(s) > 1) return false;
    // Along the chord: a first guess from the plain section, then once more
    // from where that put the skin.
    const outer = Math.max(0, (Math.abs(s) - 0.7) / 0.3);
    const scale = rig.chord * (1 - 0.3 * outer * outer) * this.chordScale * Math.cos(rig.config.riggingAngleDeg * DEG);
    const u = this.chamberAt(s);
    let c = 0.25 + local.z / scale;
    if (c < -0.1 || c > 1.1) return false;
    const skin = this.skin(this.liftSkin, s, Math.min(1, Math.max(0, c)), true, u);
    c += (local.z - skin.z) / scale;
    if (c < 0 || c > 1) return false;
    this.skin(skin, s, c, true, u);
    const under = Math.hypot(skin.x, skin.y - rig.linksPos.y) + clear - r;
    if (under <= 0 || r < 1e-6) return false;
    // Straight out from the links, back over the fabric.
    const push = Math.min(under, most) / r;
    local.x += local.x * push;
    local.y += dy * push;
    p.copy(local).applyQuaternion(this.object.quaternion).add(this.object.position);
    return true;
  }

  /** Where a point across the span falls within its chamber: 0 on a rib, towards 1 at the next. */
  private chamberAt(s: number): number {
    const k = ((s + 1) / 2) * this.cells * this.chambers;
    return k - Math.floor(k);
  }

  dispose(): void {
    for (const group of [this.object, this.shadow]) {
      group.traverse((node) => {
        const { geometry, material } = node as THREE.Mesh;
        geometry?.dispose();
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
      });
    }
    this.deployment.dispose();
  }

  /**
   * Point on the canopy skin, canopy frame. `s`: -1 left tip to 1 right
   * tip; `c`: 0 nose to 1 tail; `u`: across the chamber, 0 on a rib.
   */
  private skin(out: THREE.Vector3, s: number, c: number, top: boolean, u: number): THREE.Vector3 {
    const rig = this.rig;
    const a = Math.abs(s);
    const right = ease((s + 0.15) / 0.3);
    const brake = this.tail[0]! + (this.tail[1]! - this.tail[0]!) * right;
    const front = this.front[0]! + (this.front[1]! - this.front[0]!) * right;
    const cell = Math.min(this.cells - 1, Math.max(0, Math.floor(((s + 1) / 2) * this.cells)));
    const fill = this.fill[cell]!;
    const radius = rig.lineLength;

    // Round the arc, the tips curling in and down as the brakes pull them.
    const curl = Math.max(0, (a - 0.55) / 0.45);
    const theta = (s * this.spread * rig.span) / (2 * radius) + Math.sign(s) * brake * 0.11 * curl * curl;
    const outer = Math.max(0, (a - 0.7) / 0.3);
    const chord = rig.chord * (1 - 0.3 * outer * outer) * this.chordScale;

    // The section: along the chord (towards the nose) and up from it.
    let along = (0.25 - c) * chord;
    const thick = 0.7 * airfoil(c) * (0.12 + 0.88 * fill);
    let lift = (top ? thick : -0.25 * thick) * chord;
    // Each chamber bulges between its ribs, the top skin most.
    const middle = Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, c / 0.96))));
    lift += Math.sin(Math.PI * u) * this.chamberWidth * (top ? 0.13 : -0.07) * fill * middle;
    // The tail comes down under brakes, more towards the trailing edge and the tips.
    if (c > HINGE) {
      const w = (c - HINGE) / (1 - HINGE);
      const phi = brake * (0.3 + 0.7 * a ** 0.8) * TAIL_DOWN * w;
      const da = along - (0.25 - HINGE) * chord;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      along = (0.25 - HINGE) * chord + da * cos - lift * sin;
      lift = da * sin + lift * cos;
    }
    // Front risers pull the nose of their side down about the rear lines.
    if (front > 0) {
      const psi = -rig.frontRiserMax * 1.4 * front;
      const pivot = (0.25 - 0.7) * chord;
      const da = along - pivot;
      const cos = Math.cos(psi);
      const sin = Math.sin(psi);
      along = pivot + da * cos - lift * sin;
      lift = da * sin + lift * cos;
    }
    // The trailing edge flutters in the airflow; empty cells flap about.
    const t = this.time;
    const tail = 0.25 + 3 * Math.max(0, c - 0.75);
    lift += this.flutter * tail * (Math.sin(t * 61 + s * 23 + c * 9) * 0.6 + Math.sin(t * 43 - s * 17) * 0.4);

    const incidence = rig.config.riggingAngleDeg * DEG;
    const ci = Math.cos(incidence);
    const si = Math.sin(incidence);
    const r = radius + along * si + lift * ci;
    out.set(r * Math.sin(theta), rig.linksPos.y + r * Math.cos(theta), -along * ci + lift * si);

    const flap = this.flap[cell]!;
    if (flap > 0) {
      const ph = s * 5.3 + c * 3.1 + (top ? 0 : 0.7);
      out.x += flap * 0.45 * Math.sin(t * 7.3 + ph * 1.7);
      out.y += flap * Math.sin(t * 9.1 + ph);
      out.z += flap * 0.7 * Math.sin(t * 6.1 - ph * 2.3);
    }
    return out;
  }

  /** Brings a canopy point onto the heap on the ground, as far as it has got, and above the ground. */
  private settle(out: THREE.Vector3, s: number, c: number, top: boolean): THREE.Vector3 {
    if (this.heap > 0 && this.heapSet) {
      const a = Math.abs(s);
      // The tips go first.
      const k = ease((this.heap - 0.3 * (1 - a)) / 0.7);
      if (k > 0) {
        const chord = this.rig.chord;
        // Folded up across the span like an accordion, bunched along the
        // chord, lumpy where the fabric has heaped up on itself.
        const fold = Math.sin(11 * s + 0.6);
        const x = s * this.rig.span * 0.24 + 0.12 * fold + 0.1 * Math.sin(4.3 * s + 2 * c);
        const z = (c - 0.45) * chord * 0.62 + 0.18 * Math.sin(5.3 * s + 1.1) + 0.06 * Math.sin(9 * c + 3 * s);
        const lump = Math.max(0, Math.sin(4.1 * s + 3 * c) * Math.sin(2.3 * c + 5.7 * s));
        const h = (top ? 0.09 : 0.04) + 0.06 * (fold + 1) * (1 - Math.abs(s) * 0.5) + 0.2 * lump;
        const w = this.world
          .copy(this.heapCentre)
          .addScaledVector(this.heapAcross, x)
          .addScaledVector(this.heapAlong, z);
        w.y = this.groundLocalWorld + h;
        // Into the canopy's frame.
        w.sub(this.object.position).applyQuaternion(this.inverse);
        out.lerp(w, k);
      }
    }
    return this.aboveGround(out, top ? 0.04 : 0.02);
  }

  /** Lifts a canopy-frame point to at least `clear` above the ground. */
  private aboveGround(out: THREE.Vector3, clear: number): THREE.Vector3 {
    const h = out.dot(this.upLocal) - this.groundLocal;
    if (h < clear) out.addScaledVector(this.upLocal, clear - h);
    return out;
  }

  /** Line lengths as the canopy flies with the slider down and the hands up. */
  private measureLines(): void {
    const saved = this.inflation;
    this.inflation = 1;
    this.shapeFor(1, 0);
    for (const g of this.sides) this.rigSide(g, 0, 0, null);
    this.placeSlider(0);
    for (const line of this.lines) {
      if (line.c < 0) continue;
      this.skin(line.to, line.s, line.c, false, 0);
      line.length = line.from.distanceTo(line.to);
    }
    this.inflation = saved;
  }

  /** Spread, chord, fill and flapping of each cell for how far the canopy is out. */
  private shapeFor(inflation: number, dt: number): void {
    const t = inflation;
    this.spread = 0.1 + 0.9 * ease((t - 0.08) / 0.72);
    this.chordScale = 0.45 + 0.55 * ease(t / 0.55);
    for (let i = 0; i < this.cells; i++) {
      const a = Math.abs(((i + 0.5) / this.cells) * 2 - 1);
      // The middle cells fill first, the tips last.
      let fill = ease((t - 0.04 - 0.34 * a) / 0.4);
      let flap = (1 - fill) * 0.28 + (t < 1 ? 0.03 * (1 - t) : 0);
      // Cut away, it lets go of its shape.
      fill *= 1 - 0.85 * this.crumple;
      flap += 0.32 * this.crumple * (0.6 + 0.4 * a);
      // On the ground it empties, the tips first, and soon lies still.
      if (this.heap > 0) {
        fill *= 1 - ease((this.heap * 1.6 - 0.2 * (1 - a)) / 0.8);
        flap *= Math.max(0, 1 - this.heap * 1.4);
      }
      this.fill[i] = fill;
      this.flap[i] = flap;
    }
    if (this.crumple > 0) {
      this.spread *= 1 - 0.5 * this.crumple;
      this.chordScale *= 1 - 0.3 * this.crumple;
    }
    if (dt > 0) {
      // Tail: a second-order follower of the lines, so it lags and springs a little.
      const w = 15;
      const zeta = 0.55;
      for (let k = 0; k < 2; k++) {
        const target = k === 0 ? this.tailTarget[0]! : this.tailTarget[1]!;
        this.tailSpeed[k]! += (w * w * (target - this.tail[k]!) - 2 * zeta * w * this.tailSpeed[k]!) * Math.min(dt, 0.05);
        this.tail[k]! += this.tailSpeed[k]! * Math.min(dt, 0.05);
      }
    }
  }

  /**
   * Puts the risers, the toggle and the arm of one side where the controls
   * have them. `pilot`: canopy frame from the pilot's, to hang the risers on
   * the harness and the arm on the shoulder; null once cut away.
   */
  private rigSide(g: Side, brake: number, front: number, pilot: THREE.Quaternion | null): void {
    const linksY = this.rig.linksPos.y;
    g.rearLink.set(g.sign * REAR_LINK.x, linksY, REAR_LINK.z);
    g.frontLink.set(g.sign * (FRONT_LINK.x + 0.01 * front), linksY - FRONT_PULL * front, FRONT_LINK.z - 0.15 * front);
    if (pilot) {
      g.foot.set(g.sign * RING.x, RING.y, RING.z).applyQuaternion(pilot);
      g.shoulder.set(g.sign * SHOULDER.x, SHOULDER.y, SHOULDER.z).applyQuaternion(pilot);
    } else if (this.released) {
      // Hanging free from the links, trailing in the air and swinging.
      const t = this.time;
      g.foot.set(g.sign * 0.12 + 0.08 * Math.sin(t * 3.1 + g.sign), linksY - FREE_RISER, 0.08 * Math.sin(t * 2.3 + 2 * g.sign));
    } else {
      g.foot.set(g.sign * RING.x, RING.y, RING.z);
      g.shoulder.set(g.sign * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    }
    g.ring.lerpVectors(g.foot, g.rearLink, 0.78);
    this.span(g.rear, g.foot, g.rearLink);
    this.span(g.front, g.foot, g.frontLink);

    if (!this.armsShown) {
      // Stowed on its riser, at the guide ring.
      g.grip.copy(g.ring).addScaledVector(UP, -0.06);
      g.toggle.position.copy(g.grip).addScaledVector(UP, 0.035);
      this.span(g.toggle, g.grip, g.ring, false);
      return;
    }

    // The toggle comes straight down along the rear riser, passes just in
    // front of the shoulder and ends at arm's length beside the thigh.
    const pass = Math.sin(Math.PI * brake);
    g.grip.set(g.sign * (0.24 + 0.03 * brake), 0.34 - 0.97 * brake, -0.05 * brake - 0.075 * pass);
    // The loop of the front riser, just under its link.
    const loop = this.a.set(g.frontLink.x, g.frontLink.y - 0.06, g.frontLink.z - 0.01);
    g.grip.lerp(loop, ease(front / 0.15));
    // Up at the slider, to collapse or take it off.
    const reach = this.sliderBusy ? Math.sin(Math.PI * Math.min(1, this.sliderMove * 1.15)) : 0;
    if (reach > 0) g.grip.lerp(this.b.set(g.sign * 0.12, linksY + 0.08, 0.06), reach);
    g.toggle.position.copy(g.grip).addScaledVector(UP, 0.035);
    this.span(g.toggle, g.grip, g.ring, false);

    // Shoulder, elbow, hand: two bones of fixed length, the elbow kept out.
    const root = g.shoulder;
    const reachTo = this.reach.subVectors(g.grip, root);
    const d = Math.min(reachTo.length(), UPPER_ARM + FOREARM - 0.005);
    reachTo.normalize();
    const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
    const side = this.p.set(g.sign * ELBOW_OUT.x, ELBOW_OUT.y, ELBOW_OUT.z);
    if (pilot) side.applyQuaternion(pilot);
    side.addScaledVector(reachTo, -side.dot(reachTo)).normalize();
    const elbow = this.b.copy(root).addScaledVector(reachTo, along).addScaledVector(side, out);
    this.span(g.upperArm, root, elbow);
    this.span(g.forearm, elbow, g.grip);
    g.hand.position.copy(g.grip);
    g.hand.quaternion.copy(g.forearm.quaternion);
  }

  /** Stretches a box made one metre long from a to b, or just points it that way. */
  private span(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, stretch = true): void {
    const along = this.e.subVectors(b, a);
    const length = along.length() || 1e-6;
    if (stretch) {
      mesh.position.addVectors(a, b).multiplyScalar(0.5);
      mesh.scale.y = length;
    }
    mesh.quaternion.setFromUnitVectors(UP, along.divideScalar(length));
  }

  /**
   * The slider: up against the canopy at line stretch, then down the lines as
   * it opens, until it sits on the links. Its grommets ride the line groups.
   * `k`: 1 up against the canopy, 0 down on the links.
   */
  private placeSlider(k: number): void {
    const rig = this.rig;
    const up = rig.linksPos.y + 0.9 * rig.lineLength * Math.cos((0.5 * this.spread * rig.span) / (2 * rig.lineLength));
    for (const g of this.sides) {
      const top = this.p;
      top.set(g.sign * SLIDER.x, up, -SLIDER.z);
      g.frontGrommet.copy(g.frontLink).addScaledVector(UP, 0.05).lerp(top, k);
      top.set(g.sign * SLIDER.x, up, SLIDER.z);
      g.rearGrommet.copy(g.rearLink).addScaledVector(UP, 0.05).lerp(top, k);
    }
  }

  /** The slider's fabric between its grommets, billowing with the airflow. */
  private drawSlider(k: number): void {
    const [l, r] = [this.sides[0]!, this.sides[1]!];
    // Billow and flapping: full while it comes down, flapping on the links,
    // drawn in tight once collapsed.
    const collapse = this.sliderAmount('collapsed');
    const stow = this.sliderAmount('stowed');
    this.sliderMesh.visible = stow < 0.999 && this.inflation !== null;
    if (!this.sliderMesh.visible) return;
    // On the links its corners are drawn in to the risers' spread and the
    // spare fabric balloons back in the airflow.
    const billow = (0.28 * k + 0.3 * (1 - k)) * (1 - 0.85 * collapse);
    const flap = (0.07 + 0.04 * k) * (1 - 0.85 * collapse);
    // It balloons with the airflow, and up between the line groups.
    const into = this.e.copy(this.flowLocal).addScaledVector(UP, 0.7 * (1 - k)).normalize();
    // Collapsed: the cords across it gather the fabric into a bundle in the
    // middle, with a strip out to each grommet.
    const pinch = 0.82 * collapse;
    const middle = this.centre.set(0, 0, 0);
    for (const g of this.sides) middle.add(g.frontGrommet).add(g.rearGrommet);
    middle.multiplyScalar(0.25);
    const position = this.slider.getAttribute('position') as THREE.BufferAttribute;
    const n = SLIDER_PIECES + 1;
    const t = this.time;
    // Taken off: it goes down behind the head as it comes off the links.
    const neck = this.q.set(0, -0.05, 0.16);
    for (let i = 0; i < n; i++) {
      const u = i / SLIDER_PIECES;
      for (let j = 0; j < n; j++) {
        const v = j / SLIDER_PIECES;
        const p = this.a.lerpVectors(l.frontGrommet, r.frontGrommet, u);
        const back = this.b.lerpVectors(l.rearGrommet, r.rearGrommet, u);
        p.lerp(back, v);
        if (pinch > 0) p.lerp(middle, pinch * Math.min(1, Math.sin(Math.PI * u) + Math.sin(Math.PI * v)));
        const bulge = (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2);
        // Down on the links the back of it is blown furthest.
        const pocket = bulge * (0.55 + 0.45 * (1 - k) * Math.sin(Math.PI * Math.min(1, v * 1.3)));
        p.addScaledVector(into, billow * pocket);
        // Flapping, hardest at the back where the fabric is freest.
        const free = bulge * (0.5 + v);
        const wave = Math.sin(t * 11 + u * 5 + v * 3) * 0.5 + Math.sin(t * 19 - u * 7 + v * 6) * 0.3 + Math.sin(t * 29 + u * 11) * 0.2;
        p.x += flap * free * 0.4 * wave;
        p.y += flap * free * wave;
        p.z += flap * free * 0.6 * Math.sin(t * 13 + v * 6 + u * 2);
        if (stow > 0) p.sub(neck).multiplyScalar(1 - ease(stow)).add(neck);
        this.aboveGround(p, 0.03);
        position.setXYZ(i * n + j, p.x, p.y, p.z);
      }
    }
    position.needsUpdate = true;
    this.slider.computeVertexNormals();
  }

  /** How far the slider is into a state, with its move under way. */
  private sliderAmount(state: SliderState): number {
    const to = this.sliderState === state ? 1 : 0;
    const from = this.sliderFrom === state ? 1 : 0;
    // The hands get there first; then the slider goes.
    return from + (to - from) * ease((this.sliderMove - 0.3) / 0.6);
  }

  /** Every line, in pieces, sagging when slack and lying on the ground. */
  private drawLines(): void {
    const position = this.linesGeometry.getAttribute('position') as THREE.BufferAttribute;
    let n = 0;
    const down = this.q.copy(this.upLocal).negate();
    for (const line of this.lines) {
      const from = line.from;
      const to = line.to;
      let slack = 0;
      // Loaded, every line is tight; only a canopy that has let go of the
      // pilot, or lies on the ground, leaves them slack.
      const unloaded = this.heap > 0 || this.crumple > 0 || this.released;
      if (line.c >= 0 && unloaded) {
        // Above the slider: what the slider's climb has taken off it.
        const g = this.sides[line.sign < 0 ? 0 : 1]!;
        const link = line.grommet === 'front' ? g.frontLink : g.rearLink;
        const climbed = line.grommet ? Math.max(0, from.distanceTo(link) - 0.05) : 0;
        const d = from.distanceTo(to);
        slack = line.length - climbed - d;
      }
      const d = from.distanceTo(to);
      const sag = slack > 0.01 ? Math.sqrt((3 * d * slack) / 8) : 0;
      const across = this.e.subVectors(to, from);
      const along = d > 1e-6 ? down.dot(across) / (d * d) : 0;
      // The way down, square to the line.
      const sagDir = this.reach.copy(down).addScaledVector(across, -along);
      if (sagDir.lengthSq() > 1e-8) sagDir.normalize();
      for (let k = 0; k < PIECES; k++) {
        for (const end of [k, k + 1]) {
          const t = end / PIECES;
          const p = this.p.lerpVectors(from, to, t).addScaledVector(sagDir, sag * 4 * t * (1 - t));
          this.aboveGround(p, 0.015);
          position.setXYZ(n++, p.x, p.y, p.z);
        }
      }
    }
    position.needsUpdate = true;
  }

  /** Every point of the fabric, in the order of `buildFabric`. */
  private reshape(): void {
    const position = this.fabric.getAttribute('position') as THREE.BufferAttribute;
    const p = this.p;
    let v = 0;
    const across = this.chambers * SUB;
    const put = (s: number, c: number, top: boolean, u: number): void => {
      this.skin(p, s, c, top, u);
      this.settle(p, s, c, top);
      position.setXYZ(v++, p.x, p.y, p.z);
    };
    for (const stations of [TOP_STATIONS, BOTTOM_STATIONS]) {
      const top = stations === TOP_STATIONS;
      for (let cell = 0; cell < this.cells; cell++) {
        for (let i = 0; i <= across; i++) {
          const s = ((cell + i / across) / this.cells) * 2 - 1;
          const u = (i % SUB) / SUB;
          for (const c of stations) put(s, c, top, u);
        }
      }
    }
    // Tip ribs: centre, then round the top and back along the bottom.
    for (const s of [-1, 1]) {
      const centre = this.q.set(0, 0, 0);
      const start = v++;
      for (const c of TOP_STATIONS) put(s, c, true, 0);
      for (let k = BOTTOM_STATIONS.length - 1; k >= 0; k--) put(s, BOTTOM_STATIONS[k]!, false, 0);
      for (let k = start + 1; k < v; k++) centre.add(this.a.fromBufferAttribute(position, k));
      centre.divideScalar(v - start - 1);
      position.setXYZ(start, centre.x, centre.y, centre.z);
    }
    // Stabilisers: the point hangs under the middle of the tip.
    for (const s of [-1, 1]) {
      const point = v++;
      for (const c of STABILISER) put(s, c, false, 0);
      const mid = this.skin(this.a, s, 0.5, false, 0);
      const theta = Math.atan2(mid.x, mid.y - this.rig.linksPos.y);
      const drop = 0.42 * (0.4 + 0.6 * this.fill[s < 0 ? 0 : this.cells - 1]!);
      mid.x -= drop * Math.sin(theta);
      mid.y -= drop * Math.cos(theta);
      mid.x += 0.03 * Math.sin(this.time * 9 + s);
      this.settle(mid, s, 0.5, false);
      position.setXYZ(point, mid.x, mid.y, mid.z);
    }
    position.needsUpdate = true;
    this.fabric.computeVertexNormals();
    // The bridle is sewn on the top skin of the middle cell.
    this.skin(this.top, 0, 0.42, true, this.chamberAt(0));
    this.settle(this.top, 0, 0.42, true);
  }

  /**
   * Follow the canopy: where it is (`pos`, the riser ends) and how it is
   * turned, what pulls its lines, the light of the moment.
   */
  update(pos: THREE.Vector3, att: THREE.Quaternion, look: CanopyLook, light: Lighting): void {
    this.object.position.copy(pos);
    this.object.quaternion.copy(att);
    this.object.visible = this.inflation !== null;
    this.canopyShadow.visible = this.inflation !== null && this.inflation >= 1 && this.heap < 0.3;
    this.time = look.time;
    if (this.sliderMove < 1) this.sliderMove = Math.min(1, this.sliderMove + look.dt / 1.1);
    if (!this.object.visible) return;

    this.inverse.copy(att).invert();
    this.upLocal.set(0, 1, 0).applyQuaternion(this.inverse);
    this.groundLocalWorld = look.ground;
    this.groundLocal = look.ground - pos.y;
    const airspeed = look.air.length();
    if (airspeed > 0.5) this.flowLocal.copy(look.air).applyQuaternion(this.inverse).divideScalar(airspeed);
    else this.flowLocal.copy(this.upLocal);
    // Fluttering grows with the airspeed; a canopy lying down stops.
    this.flutter = Math.min(0.03, 0.0012 * airspeed) * (1 - this.heap) * (1 - this.crumple);

    const c = look.controls;
    this.tailTarget[0] = c.brakeL;
    this.tailTarget[1] = c.brakeR;
    this.front = [c.frontL, c.frontR];
    this.shapeFor(this.inflation!, look.dt);

    // Risers, arms and toggles, then the slider and the lines that run through it.
    if (look.pilotAtt) this.relative.copy(this.inverse).multiply(look.pilotAtt);
    const pilot = look.pilotAtt && !this.released ? this.relative : null;
    this.rigSide(this.sides[0]!, look.hands.brakeL, c.frontL, pilot);
    this.rigSide(this.sides[1]!, look.hands.brakeR, c.frontR, pilot);
    const sliderUp = 1 - ease((this.inflation! - 0.15) / 0.75);
    this.placeSlider(sliderUp);
    this.reshape();
    for (const line of this.lines) if (line.c >= 0) this.settle(this.skin(line.to, line.s, line.c, false, 0), line.s, line.c, false);
    this.drawSlider(sliderUp);
    this.drawLines();

    // Light: sun and sky on the fabric, and through it, out of a cloud's shadow or in it.
    const centre = this.a.set(0, this.rig.canopyPos.y, 0).applyQuaternion(att).add(pos);
    this.glow.lerpColors(light.fabricShade, light.fabric, light.clouds.sunThrough(centre.x, centre.y, centre.z));
    this.glow.multiplyScalar(0.78);

    // The shadow, from the sun, on the ground under it.
    const { sun } = light;
    const t = (centre.y - look.ground) / Math.max(0.05, sun.y);
    this.canopyShadow.position.set(centre.x - sun.x * t, look.ground, centre.z - sun.z * t);
    const forward = this.b.set(0, 0, -1).applyQuaternion(att);
    this.canopyShadow.rotation.y = Math.atan2(-forward.x, -forward.z);
    const height = centre.y - look.ground;
    this.shadowMaterial.opacity = (0.12 + 0.36 * Math.max(0, 1 - height / 250)) * light.shadow;
    this.shadow.visible = light.shadow > 0.02;
  }
}

/** Where the stabiliser hangs from along the tip, chord fractions. */
const STABILISER = [0.12, 0.3, 0.5, 0.7, 0.88];
