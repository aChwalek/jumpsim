import * as THREE from 'three';
import { SKIN_COLORS, SUIT_PATTERNS, type Outfit } from './outfit';

/** Procedural cloth: no texture downloads; the same motifs work on wings and limbs. */
export class ClothStyle {
  readonly accent = { value: new THREE.Color(0xe4e4e0) };
  readonly pattern = { value: 0 };

  material(color: number, side: THREE.Side = THREE.FrontSide): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({ color, side });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.outfitAccent = this.accent;
      shader.uniforms.outfitPattern = this.pattern;
      shader.vertexShader = 'varying vec3 outfitPoint;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\noutfitPoint = position;');
      shader.fragmentShader = 'varying vec3 outfitPoint;\nuniform vec3 outfitAccent;\nuniform float outfitPattern;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float motif = 0.0;
        if (outfitPattern > 0.5 && outfitPattern < 1.5) {
          float band = abs(fract(outfitPoint.x * 7.0 + 0.5) - 0.5);
          motif = 1.0 - smoothstep(0.12, 0.15, band);
        } else if (outfitPattern < 2.5 && outfitPattern > 1.5) {
          float band = abs(fract((outfitPoint.y + abs(outfitPoint.x) * 0.8) * 5.0) - 0.5);
          motif = 1.0 - smoothstep(0.12, 0.15, band);
        } else if (outfitPattern > 2.5) {
          motif = smoothstep(-0.003, 0.003, outfitPoint.x);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, outfitAccent, motif);
      `);
    };
    material.customProgramCacheKey = () => 'stickman-cloth-v1';
    return material;
  }

  set(outfit: Outfit): void {
    this.accent.value.setHex(outfit.accent ?? 0xe4e4e0);
    this.pattern.value = SUIT_PATTERNS.indexOf(outfit.pattern ?? 'plain');
  }
}

/** Cut a face opening into the shell instead of hiding a face inside a solid sphere. */
function shellGeometry(open: boolean): THREE.BufferGeometry {
  const sphere = new THREE.SphereGeometry(0.122, 32, 24).scale(0.94, 1, 1.08).toNonIndexed();
  const positions = sphere.getAttribute('position');
  const indices: number[] = [];
  for (let i = 0; i < positions.count; i += 3) {
    const y = (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
    const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
    if (z < -0.035 && y < 0.062 && (open || y > -0.072)) continue;
    indices.push(i, i + 1, i + 2);
  }
  sphere.setIndex(indices);
  return sphere;
}

/** Shared between posed characters and ragdolls. Origin: centre of the head, -Z forward. */
export class CharacterHead {
  readonly group = new THREE.Group();
  private readonly shell = new THREE.MeshLambertMaterial({ color: 0xe4e4e0, side: THREE.DoubleSide });
  private readonly skin = new THREE.MeshLambertMaterial({ color: SKIN_COLORS.tan });
  private readonly full = new THREE.Mesh(shellGeometry(false), this.shell);
  private readonly open = new THREE.Mesh(shellGeometry(true), this.shell);
  private readonly features = new THREE.Group();
  private readonly visorPivot = new THREE.Group();
  private readonly goggles = new THREE.Group();

  constructor() {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18).scale(1, 1.07, 1), this.skin);
    const ink = new THREE.MeshBasicMaterial({ color: 0x20242b });
    const white = new THREE.MeshBasicMaterial({ color: 0xfff5dd });
    const pink = new THREE.MeshBasicMaterial({ color: 0xe67179 });
    const feature = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      this.features.add(mesh);
      return mesh;
    };
    for (const x of [-0.034, 0.034]) {
      const left = x < 0;
      feature(new THREE.SphereGeometry(0.019, 16, 12).scale(0.85, left ? 1.22 : 0.96, 0.57), white, x, 0.01, -0.093);
      // Looking a little sideways, with a highlight: curious rather than a blank stare.
      feature(new THREE.SphereGeometry(0.009, 12, 10).scale(0.82, 1.05, 0.45), ink, x + 0.003, 0.009, -0.104);
      feature(new THREE.SphereGeometry(0.0028, 8, 6), white, x + 0.0005, 0.013, -0.108);
      const brow = feature(new THREE.CapsuleGeometry(0.003, 0.025, 3, 8).rotateZ(Math.PI / 2), ink,
        x, left ? 0.047 : 0.038, -0.085);
      brow.rotation.z = left ? -0.28 : 0.13;
      feature(new THREE.SphereGeometry(0.009, 10, 8).scale(1.25, 0.48, 0.3), pink, Math.sign(x) * 0.057, -0.022, -0.083);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.029, 14, 10).scale(1.1, 0.83, 0.3),
        new THREE.MeshLambertMaterial({ color: 0x85ccde, transparent: true, opacity: 0.25, depthWrite: false }));
      lens.position.set(x, 0.01, -0.114);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0035, 6, 24).scale(1.1, 0.83, 1), ink);
      rim.position.copy(lens.position);
      this.goggles.add(lens, rim);
    }
    const grin = feature(new THREE.SphereGeometry(0.025, 18, 12).scale(1.22, 0.72, 0.35), ink, 0.002, -0.034, -0.094);
    grin.rotation.z = -0.12;
    const tooth = feature(new THREE.BoxGeometry(0.012, 0.012, 0.004), white, -0.003, -0.025, -0.104);
    tooth.rotation.z = -0.12;
    feature(new THREE.SphereGeometry(0.01, 12, 8).scale(1.1, 0.45, 0.35), pink, 0.01, -0.043, -0.102);
    // The elastic goes around the back, never across the lenses.
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.102, 0.006, 6, 24, Math.PI).rotateX(Math.PI / 2), ink);
    strap.position.y = 0.01;
    const bridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.003, 0.011, 3, 8).rotateZ(Math.PI / 2), ink);
    bridge.position.set(0, 0.014, -0.114);
    this.goggles.add(strap, bridge);
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(0.128, 24, 12, Math.PI * 1.5 - 1.05, 2.1, 1.02, 1.17).scale(0.94, 1, 1.08),
      new THREE.MeshLambertMaterial({ color: 0x152733, side: THREE.DoubleSide }));
    this.visorPivot.position.y = 0.065;
    glass.position.y = -0.065;
    this.visorPivot.add(glass);
    this.group.add(head, this.full, this.open, this.features, this.visorPivot, this.goggles);
    this.set({ helmet: 0xe4e4e0, suit: 0 });
  }

  set(outfit: Pick<Outfit, 'helmet'> & Partial<Outfit>): void {
    const open = outfit.helmetKind === 'open';
    this.shell.color.setHex(outfit.helmet);
    this.skin.color.setHex(outfit.skin ?? SKIN_COLORS.tan);
    this.full.visible = !open;
    this.open.visible = open;
    this.visorPivot.visible = !open;
    this.visorPivot.rotation.x = outfit.visorRaised ? 1.5 : 0;
    this.features.visible = outfit.face ?? false;
    this.goggles.visible = open && (outfit.goggles ?? true);
  }
}
