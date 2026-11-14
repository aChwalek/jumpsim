// The jumper and the others jumping with them, on the menu, ready to board:
// the gear as chosen (jumpsuit, tracking suit or wings, helmet, smoke on the
// ankle), the others in a V behind, and behind them all the plane they will
// jump from. Drawn by a small renderer of its own on a transparent canvas, so
// that the drop zone behind the menu shows through, and only while on screen.
// It turns slowly by itself; a drag turns it round, to see the container.

import * as THREE from 'three';
import { outfitOf, rigFor, suitOf, wingColor, type Gear } from '../setup';
import { noBodyInputs } from '../sim/freefall';
import { Plane, type AircraftId } from '../sim/plane';
import { vec3 } from '../sim/vec';
import { toView } from '../viewport';
import { Body, copyPose, makePose, type Pose } from './body';
import { PlaneView } from './planeView';
import { Posture } from './posture';

export interface CrewMember {
  gear: Gear;
  /** Over the head, in a room; none for the bots. */
  name?: string;
  ready?: boolean;
}

export interface CrewLook {
  /** Us first, then the others. */
  members: CrewMember[];
  /** The plane behind them; none under canopy already, or off a BASE object. */
  aircraft: AircraftId | null;
  /** Dark at the hour chosen: the glow sticks are lit. */
  night?: boolean;
}

/** Lens, degrees from top to bottom of the picture. */
const FOV = 34;
/** Each rank of the V: this far to the side and this far back of the one before, m. */
const ACROSS = 0.7;
const BACK = 0.5;
/** Space left either side of the crew in the picture, m. */
const MARGIN = 0.35;
/** Top of a helmet, m above the ground, about. */
const TALL = 1.75;
/** The crew's height, as a share of the picture's at most: the plane shows over their heads. */
const CREW_SHARE = 0.46;
/** The soles this far up from the foot of the picture, as a share of its height. */
const FEET_UP = 0.07;
/** Where the camera looks from, round from straight in front, rad: a little from the left. */
const VIEW = -0.2;
/** How much the camera looks down: the tangent of the angle (8°). */
const PITCH = 0.14;
/** The top of the plane at most this far over the camera's height, seen from it (a tangent, 5°): under the name. */
const PLANE_TOP = 0.0875;
/** The plane's nose at most this far from the middle of the picture, as a share of half its width. */
const NOSE_EDGE = 0.72;
/** The slow turn on its own: how far either way, rad, and how long it takes, s. */
const SWAY = 0.16;
const SWAY_PERIOD = 26;
/** The camera on its way to a new framing: time to get most of the way, s. */
const SETTLE = 0.35;
/** A drag across the whole picture turns it this far, rad. */
const DRAG_TURN = 4;
/** Drawn at most this often, s: it moves slowly, and the scenery behind is drawn too. */
const FRAME_EVERY = 1 / 30;
/** The propellers turning on the ground, rad/s: slow enough to see the blades. */
const IDLE_PROP = 9;

/** Where the i-th of the crew stands: across and along, the first in front. */
function slot(i: number): [number, number] {
  if (i === 0) return [0, 0];
  const rank = Math.ceil(i / 2);
  return [(i % 2 ? -1 : 1) * rank * ACROSS, -rank * BACK];
}

/** A soft dark round, for the shadows on the ground. */
function shadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const fill = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fill.addColorStop(0, 'rgba(0,0,0,0.55)');
  fill.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  fill.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** One of the crew, standing, as the gear makes them. */
class Member {
  readonly group = new THREE.Group();
  readonly body: Body;
  /** From the soles to the top of the helmet, m. */
  height = TALL;
  private look = '';
  private readonly box = new THREE.Box3();
  private readonly toGroup = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();

  constructor(gear: Gear, shadow: THREE.Material) {
    this.body = new Body(rigFor(gear));
    this.group.add(this.body.group);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8).rotateX(-Math.PI / 2), shadow);
    blob.position.y = 0.002;
    blob.renderOrder = -1;
    this.group.add(blob);
  }

  set(gear: Gear, pose: Pose): void {
    const look = [gear.helmetColor, gear.suitColor, gear.glowColor, gear.suit, gear.suitLevel, gear.color, gear.smoke, gear.container].join();
    if (look === this.look) return;
    this.look = look;
    const body = this.body;
    body.setOutfit(outfitOf(gear));
    body.setSuit(suitOf(gear), wingColor(gear.color));
    body.setSmoke(gear.smoke);
    // A BASE container has no handles: one canopy, no reserve.
    const handles = gear.container !== 'base';
    body.setHandles(handles, handles);
    body.setPose(pose);
    this.stand();
  }

  /** Puts the soles on the ground. */
  private stand(): void {
    const body = this.body.group;
    body.position.y = 0;
    this.group.updateMatrixWorld(true);
    this.toGroup.copy(this.group.matrixWorld).invert();
    let lowest = Infinity;
    let highest = -Infinity;
    body.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      this.box.copy(mesh.geometry.boundingBox!).applyMatrix4(this.m.multiplyMatrices(this.toGroup, mesh.matrixWorld));
      lowest = Math.min(lowest, this.box.min.y);
      highest = Math.max(highest, this.box.max.y);
    });
    if (!Number.isFinite(lowest)) return;
    body.position.y = -lowest;
    this.height = highest - lowest;
  }
}

/** A name over a head. */
interface Tag {
  el: HTMLElement;
  at: THREE.Vector3;
}

export class CrewView {
  /** The picture, and the names over it: put it where it shows. */
  readonly el = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly tags = document.createElement('div');
  private renderer: THREE.WebGLRenderer | null = null;
  private failed = false;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 600);
  /** Everything on the ground: the crew, the ring round us, the plane. The camera goes round it. */
  private readonly world = new THREE.Group();
  private readonly crew = new THREE.Group();
  private readonly members: Member[] = [];
  private readonly shadow: THREE.MeshBasicMaterial;
  /** A ring on the ground round us, when there are others. */
  private readonly you = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.53, 56).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  private readonly planeView = new PlaneView();
  private readonly planeHolder = new THREE.Group();
  /** The plane's shadow, stretched to it. */
  private readonly planeShadow: THREE.Mesh;
  private plane: Plane | null = null;
  private readonly pose = makePose();
  private readonly poses: Pose[] = [];
  private tagList: Tag[] = [];
  /** What `show` was last given, to do nothing when it is the same. */
  private shown = '';
  private active = false;
  private frame = 0;
  private last = 0;
  private time = 0;
  /** How far a drag has turned it, rad. */
  private turn = 0;
  private dragFrom: number | null = null;
  /** Where the camera stands back, m, and how high it looks: now, and where it is going. */
  private distance = 7;
  private aim = 1;
  private wantedDistance = 7;
  private wantedAim = 1;
  private crewHalfWidth = 0.5;
  private crewDepth = 0;
  private readonly v = new THREE.Vector3();
  /** The camera where it stands before any turn, to place the plane by. */
  private readonly still = new THREE.PerspectiveCamera(FOV, 1, 0.1, 600);
  /** The picture's width for its height. */
  private aspect = 1;

  constructor() {
    this.el.className = 'crew';
    this.canvas.className = 'crew-picture';
    this.tags.className = 'crew-tags';
    this.el.append(this.canvas, this.tags);

    // Everything the body draws: the gear near the eyes and the head seen from outside too.
    this.camera.layers.enableAll();
    this.scene.add(new THREE.HemisphereLight(0xe6eeff, 0x5d6450, 2.1));
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.3);
    sun.position.set(-4, 9, 7);
    this.scene.add(sun);
    // Far off, the plane fades a little into the air between.
    this.scene.fog = new THREE.Fog(0x9fb0c2, 20, 320);
    this.shadow = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
    this.you.position.y = 0.004;
    this.world.add(this.crew, this.you, this.planeHolder);
    this.planeShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadow);
    this.planeShadow.position.y = 0.01;
    this.planeHolder.add(this.planeView.object, this.planeShadow);
    this.scene.add(this.world);

    const stand = new Posture().update(0, 'ground', noBodyInputs(), [0.02, -0.02]);
    copyPose(this.pose, stand);

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Across the picture, which a phone held upright shows on its side.
      this.dragFrom = toView(e.clientX, e.clientY).x;
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.dragFrom === null) return;
      const x = toView(e.clientX, e.clientY).x;
      this.turn += ((x - this.dragFrom) / (this.el.clientWidth || 1)) * DRAG_TURN;
      this.dragFrom = x;
    });
    const drop = (): void => {
      this.dragFrom = null;
    };
    this.el.addEventListener('pointerup', drop);
    this.el.addEventListener('pointercancel', drop);
  }

  /** Who is there, in what, and in front of which plane. */
  show(look: CrewLook): void {
    const key = JSON.stringify(look);
    if (key === this.shown) return;
    this.shown = key;
    const n = Math.max(1, look.members.length);
    while (this.members.length < n) {
      const m = new Member(look.members[this.members.length]?.gear ?? look.members[0]!.gear, this.shadow);
      this.members.push(m);
      this.crew.add(m.group);
      // Each stands a little their own way.
      const k = this.members.length - 1;
      const pose = copyPose(makePose(), this.pose);
      if (k > 0) {
        const s = Math.sin(k * 12.9898) * 0.5;
        pose.handL.y += 0.04 * s;
        pose.handR.y -= 0.03 * s;
        pose.spread += 0.03 * s;
        pose.lean = 0.03 * s;
      }
      this.poses.push(pose);
    }
    this.members.forEach((m, i) => {
      const member = look.members[i];
      m.group.visible = member !== undefined;
      if (!member) return;
      const [x, z] = slot(i);
      m.group.position.set(x, 0, z);
      // Facing the camera; the others turned a little in towards the first.
      m.group.rotation.y = Math.PI + (i === 0 ? 0 : -Math.sign(x) * 0.18);
      m.set(member.gear, this.poses[i]!);
      m.body.setGlow(look.night === true);
    });

    this.you.visible = look.members.length > 1;
    const ranks = Math.ceil((look.members.length - 1) / 2);
    this.crewHalfWidth = ranks * ACROSS + 0.35;
    this.crewDepth = ranks * BACK;
    this.setPlane(look.aircraft);
    this.setTags(look.members);
    this.frameCrew(this.el.clientWidth / Math.max(1, this.el.clientHeight) || 1);
  }

  /** Draws while on screen; stops when not. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      cancelAnimationFrame(this.frame);
      return;
    }
    this.last = performance.now();
    // Straight to the framing, not swooping in from the last one.
    this.distance = this.wantedDistance;
    this.aim = this.wantedAim;
    const tick = (now: number): void => {
      if (!this.active) return;
      this.frame = requestAnimationFrame(tick);
      this.draw(now);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private setPlane(id: AircraftId | null): void {
    this.planeHolder.visible = id !== null;
    if (id === null || this.plane?.type.id === id) return;
    const plane = new Plane({ x: 0, z: 0, height: 0, headingDeg: 0, indicatedAirspeed: 30, aircraft: id }, vec3());
    plane.att.x = plane.att.y = plane.att.z = 0;
    plane.att.w = 1;
    plane.pos.x = plane.pos.y = plane.pos.z = 0;
    this.planeView.update(plane);
    // Its middle over the holder, its wheels (or skids) on the ground: measured in the holder's frame.
    this.planeHolder.position.set(0, 0, 0);
    this.planeHolder.rotation.set(0, 0, 0);
    this.world.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.planeView.object);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    plane.pos.x = -centre.x;
    plane.pos.y = -box.min.y;
    plane.pos.z = -centre.z;
    this.planeView.update(plane);
    this.plane = plane;
    // The front of the body itself, without the propellers' or the rotor's discs, in the holder's frame.
    this.world.updateMatrixWorld(true);
    const body = new THREE.Box3().setFromObject(this.planeView.object.children[0] ?? this.planeView.object);
    this.planeHolder.userData.nose = new THREE.Vector3((body.min.x + body.max.x) / 2, body.min.y + (body.max.y - body.min.y) * 0.35, body.min.z);
    this.planeShadow.scale.set(size.x * 0.9, 1, size.z * 0.9);
    // Three-quarters from the front, nose towards the camera, the door's side (or a Hercules' nose) seen.
    const type = plane.type;
    this.planeHolder.rotation.y = VIEW + (type.ramp ? Math.PI - 0.6 : -type.doorSide * (Math.PI / 2 + 0.5));
    this.planeHolder.userData.reach = Math.max(size.x, size.z) / 2;
    this.planeHolder.userData.tall = size.y;
    this.planeHolder.userData.size = size;
    this.placePlane();
  }

  /**
   * Behind the crew as the camera sees them: far enough to be seen whole, or
   * nearly, and for its top (a Hercules' fin) to stay under the name.
   */
  private placePlane(): void {
    const reach = (this.planeHolder.userData.reach as number | undefined) ?? 8;
    const tall = (this.planeHolder.userData.tall as number | undefined) ?? 3;
    const eye = this.wantedAim + PITCH * this.wantedDistance;
    const away = Math.max(this.wantedDistance + 5 + reach * 1.5, (tall - eye) / PLANE_TOP);
    const behind = away - this.wantedDistance;
    const at = (aside: number): void => {
      this.planeHolder.position.set(
        -Math.sin(VIEW) * behind + Math.cos(VIEW) * aside,
        0,
        -this.crewDepth / 2 - Math.cos(VIEW) * behind - Math.sin(VIEW) * aside,
      );
    };
    at(0);
    // Moved across to the middle of the picture as seen, three-quarters from
    // the front, the nose nearer and bigger than the tail; and if it is too
    // long to be seen whole, the tail cut rather than the nose.
    const size = this.planeHolder.userData.size as THREE.Vector3 | undefined;
    if (!size) return;
    const camera = this.still;
    camera.aspect = this.aspect;
    camera.position.set(Math.sin(VIEW) * this.wantedDistance, eye, -this.crewDepth / 2 + Math.cos(VIEW) * this.wantedDistance);
    camera.lookAt(0, this.wantedAim, -this.crewDepth / 2);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.planeHolder.updateMatrix();
    let left = Infinity;
    let right = -Infinity;
    for (const x of [-size.x / 2, size.x / 2])
      for (const y of [0, size.y])
        for (const z of [-size.z / 2, size.z / 2]) {
          const p = this.v.set(x, y, z).applyMatrix4(this.planeHolder.matrix).project(camera);
          left = Math.min(left, p.x);
          right = Math.max(right, p.x);
        }
    const front = (this.planeHolder.userData.nose as THREE.Vector3 | undefined) ?? this.v.set(0, size.y * 0.3, -size.z / 2);
    const nose = this.v.copy(front).applyMatrix4(this.planeHolder.matrix).project(camera).x;
    let shift = (left + right) / 2;
    const seen = nose - shift;
    if (Math.abs(seen) > NOSE_EDGE) shift += seen - Math.sign(seen) * NOSE_EDGE;
    // Half the picture's width, m, as far away as the plane.
    const across = away * Math.tan(((FOV / 2) * Math.PI) / 180) * this.aspect;
    at(-shift * across);
  }

  private setTags(members: CrewMember[]): void {
    this.tags.replaceChildren();
    this.tagList = [];
    members.forEach((m, i) => {
      if (!m.name) return;
      const el = document.createElement('span');
      el.className = `crew-tag${m.ready ? ' ready' : ''}`;
      el.innerHTML = '<i></i>';
      el.append(m.name);
      this.tags.append(el);
      const [x, z] = slot(i);
      this.tagList.push({ el, at: new THREE.Vector3(x, (this.members[i]?.height ?? TALL) + 0.12, z) });
    });
  }

  /** Where the camera has to stand to have the whole crew in the picture, at this width for a height. */
  private frameCrew(aspect: number): void {
    this.aspect = aspect;
    const half = Math.tan(((FOV / 2) * Math.PI) / 180);
    const high = TALL / CREW_SHARE / 2 / half;
    const wide = (this.crewHalfWidth + MARGIN) / (half * Math.max(0.3, aspect));
    const distance = Math.max(high, wide);
    this.wantedDistance = distance + this.crewDepth / 2;
    // The crew low in the picture, the plane over their heads: the middle of
    // the picture this high, at the crew's distance, leaves the feet near its foot.
    this.wantedAim = (0.5 - FEET_UP) * 2 * distance * half;
    this.placePlane();
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      // No WebGL to spare: the menu does without the picture.
      this.failed = true;
      this.el.classList.add('off');
    }
    return this.renderer;
  }

  private draw(now: number): void {
    const width = this.el.clientWidth;
    const height = this.el.clientHeight;
    if (width < 8 || height < 8) return;
    const renderer = this.ensureRenderer();
    if (!renderer) return;
    const elapsed = (now - this.last) / 1000;
    if (elapsed < FRAME_EVERY * 0.9) return;
    const dt = Math.min(0.1, elapsed);
    this.last = now;
    this.time += dt;

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) {
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.frameCrew(width / height);
    }

    const k = 1 - Math.exp(-dt / SETTLE);
    this.distance += (this.wantedDistance - this.distance) * k;
    this.aim += (this.wantedAim - this.aim) * k;
    // Seen a little from the left, turning slowly either way, and as far round as dragged.
    const angle = VIEW + SWAY * Math.sin((this.time * 2 * Math.PI) / SWAY_PERIOD) + this.turn;
    const middle = -this.crewDepth / 2;
    const camera = this.camera;
    camera.position.set(Math.sin(angle) * this.distance, this.aim + PITCH * this.distance, middle + Math.cos(angle) * this.distance);
    camera.lookAt(0, this.aim, middle);

    if (this.plane && this.planeHolder.visible) {
      this.plane.prop = (this.plane.prop + IDLE_PROP * dt) % (2 * Math.PI);
      this.planeView.update(this.plane);
    }
    renderer.render(this.scene, camera);

    for (const tag of this.tagList) {
      const p = this.v.copy(tag.at).project(camera);
      tag.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }
}
