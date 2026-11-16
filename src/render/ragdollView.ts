// The body as the ragdoll throws it about: the same jumpsuit, harness,
// container, helmet and shoes as the pilot's own body, but each piece hung
// between two of the ragdoll's joints rather than posed.

import * as THREE from 'three';
import { limbMesh, roundLimbEnds, shoeGeometry } from './characterParts';
import { rigPack } from './rigPack';
import { CharacterHead, ClothStyle } from './characterStyle';
import { J, JOINT_COUNT } from '../sim/ragdoll';
import { DEFAULT_SUIT, OUTFIT_COLORS, type Outfit } from './outfit';
import { OUTSIDE_LAYER } from './scene';

const UP = new THREE.Vector3(0, 1, 0);

/** A capsule of unit length along Y, stretched between two joints each frame. */
interface Bone {
  mesh: THREE.Mesh;
  a: number;
  b: number;
}

export class RagdollView {
  /** World frame: add it to the scene. */
  readonly object = new THREE.Group();
  private readonly bones: Bone[] = [];
  private readonly trunk = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoes: THREE.Mesh[] = [];
  private readonly hands: THREE.Mesh[] = [];
  private readonly at = Array.from({ length: JOINT_COUNT }, () => new THREE.Vector3());
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly clothStyle = new ClothStyle();
  private readonly headStyle = new CharacterHead();
  private readonly suit = this.clothStyle.material(OUTFIT_COLORS[DEFAULT_SUIT]);
  private readonly pants = this.clothStyle.material(OUTFIT_COLORS[DEFAULT_SUIT]);
  private readonly shoe = new THREE.MeshLambertMaterial({ color: 0xe4e4e0 });

  constructor() {
    const suit = this.suit;
    const webbing = new THREE.MeshLambertMaterial({ color: 0x33363b, emissive: 0x0d0e10 });
    const glove = new THREE.MeshLambertMaterial({ color: 0x6f747c, emissive: 0x1d1f23 });
    const shoe = this.shoe;

    const bone = (a: number, b: number, radius: number): void => {
      const mesh = limbMesh(radius, a === J.hipL || a === J.hipR || a === J.kneeL || a === J.kneeR ? this.pants : suit);
      this.bones.push({ mesh, a, b });
      this.object.add(mesh);
    };
    bone(J.shoulderL, J.elbowL, 0.052);
    bone(J.elbowL, J.handL, 0.042);
    bone(J.shoulderR, J.elbowR, 0.052);
    bone(J.elbowR, J.handR, 0.042);
    bone(J.hipL, J.kneeL, 0.075);
    bone(J.kneeL, J.footL, 0.06);
    bone(J.hipR, J.kneeR, 0.075);
    bone(J.kneeR, J.footR, 0.06);
    bone(J.neck, J.head, 0.058);

    // The trunk in its own frame: X to the right shoulder, Y up the spine,
    // Z out of the back. Its origin is half way down the spine.
    // Where the pilot's body has them, from the spine half way between the
    // base of the neck and the pelvis.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.32, 4, 14), suit);
    torso.scale.set(1.35, 1, 0.85);
    torso.position.set(0, -0.075, 0.03);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) =>
      new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m);
    this.trunk.add(
      torso,
      box(0.045, 0.48, 0.01, -0.1, -0.055, -0.078, webbing),
      box(0.045, 0.48, 0.01, 0.1, -0.055, -0.078, webbing),
      box(0.25, 0.035, 0.012, 0, 0.025, -0.084, webbing),
    );
    const pack = rigPack();
    pack.position.set(0, -0.075, 0.207);
    this.trunk.add(pack);
    this.object.add(this.trunk);

    // Head, in the helmet: Y up through the crown, -Z out of the visor.
    this.head.add(this.headStyle.group);
    // Not from the inside of the helmet, seen through the eyes.
    this.head.traverse((o) => o.layers.set(OUTSIDE_LAYER));
    this.object.add(this.head);

    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(shoeGeometry(), shoe);
      this.shoes.push(s);
      const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.046, 2).scale(0.85, 1.15, 0.9), glove);
      this.hands.push(h);
      this.object.add(s, h);
    }
    this.object.visible = false;
  }

  /** The colours of the jumpsuit and of the helmet. */
  setOutfit(outfit: Outfit): void {
    this.suit.color.setHex(outfit.suit);
    this.headStyle.set(outfit);
    this.clothStyle.set(outfit);
    this.pants.color.setHex(outfit.pants ?? outfit.suit);
    this.shoe.color.setHex(outfit.shoes ?? 0xe4e4e0);
  }

  /** The materials, to be lit like the rest of the pilot. */
  materials(): THREE.Material[] {
    const all = new Set<THREE.Material>();
    this.object.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m)) all.add(m);
    });
    return [...all];
  }

  /** Where the joints are, world frame, in the order of JOINTS; null hides the body. */
  update(joints: ArrayLike<number> | null): void {
    this.object.visible = joints !== null;
    if (!joints) return;
    for (let i = 0; i < JOINT_COUNT; i++) this.at[i]!.set(joints[3 * i]!, joints[3 * i + 1]!, joints[3 * i + 2]!);
    const p = this.at;
    for (const bone of this.bones) this.span(bone.mesh, p[bone.a]!, p[bone.b]!);

    // The trunk: up the spine, across the shoulders, out of the back.
    const up = this.a.subVectors(p[J.neck]!, p[J.pelvis]!).normalize();
    const right = this.b.subVectors(p[J.shoulderR]!, p[J.shoulderL]!);
    right.addScaledVector(up, -right.dot(up)).normalize();
    const back = this.c.crossVectors(right, up);
    this.basis.makeBasis(right, up, back);
    this.trunk.quaternion.setFromRotationMatrix(this.basis);
    this.trunk.position.lerpVectors(p[J.neck]!, p[J.pelvis]!, 0.5);

    // The head looks the way the belly faces, its crown away from the neck.
    const crown = this.a.subVectors(p[J.head]!, p[J.neck]!).normalize();
    const face = this.c.multiplyScalar(-1);
    face.addScaledVector(crown, -face.dot(crown)).normalize();
    const side = this.b.crossVectors(crown, face).multiplyScalar(-1);
    this.basis.makeBasis(side, crown, face.multiplyScalar(-1));
    this.head.quaternion.setFromRotationMatrix(this.basis);
    this.head.position.copy(p[J.head]!);

    // Shoes square to the shin, toes the way the knee points.
    for (let i = 0; i < 2; i++) {
      const [knee, foot, hip, hand, elbow] =
        i === 0 ? [J.kneeL, J.footL, J.hipL, J.handL, J.elbowL] : [J.kneeR, J.footR, J.hipR, J.handR, J.elbowR];
      const shin = this.a.subVectors(p[knee]!, p[foot]!).normalize();
      const toes = this.b.subVectors(p[knee]!, p[hip]!);
      toes.addScaledVector(shin, -toes.dot(shin));
      if (toes.lengthSq() < 1e-6) toes.copy(right).cross(shin);
      toes.normalize().multiplyScalar(-1);
      const across = this.c.crossVectors(shin, toes);
      this.basis.makeBasis(across, shin, toes);
      const s = this.shoes[i]!;
      s.quaternion.setFromRotationMatrix(this.basis);
      s.position.copy(p[foot]!);
      const h = this.hands[i]!;
      h.position.copy(p[hand]!);
      h.quaternion.setFromUnitVectors(UP, this.a.subVectors(p[hand]!, p[elbow]!).normalize());
    }
  }

  private span(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = this.c.subVectors(b, a);
    const length = dir.length() || 1e-6;
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.scale.y = length;
    roundLimbEnds(mesh, length);
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  }
}
