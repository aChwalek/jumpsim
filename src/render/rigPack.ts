import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Soft harness/container, centred on the back, +Z outwards. Metres like the body. */
export function rigPack(): THREE.Group {
  const pack = new THREE.Group();
  pack.name = 'parachute-container';
  const charcoal = new THREE.MeshLambertMaterial({ color: 0x262d32 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x171d21 });
  const orange = new THREE.MeshLambertMaterial({ color: 0xbf4c28 });
  const binding = new THREE.MeshLambertMaterial({ color: 0xcac9b6 });
  const stitching = new THREE.MeshLambertMaterial({ color: 0x666a63 });

  // Continuous silhouette with a scooped yoke, raised shoulders and rounded hips.
  // There is no horizontal division into separate backpack pockets.
  const outline = new THREE.Shape();
  outline.moveTo(-0.118, -0.245);
  outline.bezierCurveTo(-0.16, -0.245, -0.17, -0.199, -0.165, -0.105);
  outline.bezierCurveTo(-0.168, 0.055, -0.148, 0.16, -0.137, 0.25);
  outline.quadraticCurveTo(-0.132, 0.275, -0.108, 0.268);
  outline.lineTo(-0.084, 0.26);
  outline.bezierCurveTo(-0.068, 0.255, -0.073, 0.22, -0.059, 0.198);
  outline.quadraticCurveTo(0, 0.17, 0.059, 0.198);
  outline.bezierCurveTo(0.073, 0.22, 0.068, 0.255, 0.084, 0.26);
  outline.lineTo(0.108, 0.268);
  outline.quadraticCurveTo(0.132, 0.275, 0.137, 0.25);
  outline.bezierCurveTo(0.148, 0.16, 0.168, 0.055, 0.165, -0.105);
  outline.bezierCurveTo(0.17, -0.199, 0.16, -0.245, 0.118, -0.245);
  outline.quadraticCurveTo(0, -0.26, -0.118, -0.245);
  outline.closePath();
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, {
    depth: 0.09, steps: 1, curveSegments: 16,
    bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.022, bevelSegments: 4,
  }), charcoal);
  shell.name = 'continuous-padded-shell';
  shell.position.z = -0.058;
  pack.add(shell);

  // All the cloth panels lie against one convex surface. Their edges follow
  // its curvature, rather than floating as flat plates above the container.
  const surface = (x: number, y: number) => 0.064 + 0.022 * (1 - (x / 0.19) ** 2) * (1 - (y / 0.34) ** 2);
  const panel = (name: string, shape: THREE.Shape, material: THREE.Material, lift = 0): void => {
    const source = new THREE.ShapeGeometry(shape, 14);
    const pos = source.getAttribute('position');
    const index = source.getIndex()!;
    const points: number[] = [];
    const normals: number[] = [];
    const triangle = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, level: number): void => {
      // Keep the upper cloth fine enough to follow the shoulder taper;
      // coarse triangles can otherwise cut through neighbouring fabric.
      const upper = Math.max(a.y, b.y, c.y) > 0.015;
      const edge = Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a));
      if (level > 0 || (upper && level > -4 && edge > 0.018 ** 2)) {
        const ab = a.clone().add(b).multiplyScalar(0.5);
        const bc = b.clone().add(c).multiplyScalar(0.5);
        const ca = c.clone().add(a).multiplyScalar(0.5);
        triangle(a, ab, ca, level - 1);
        triangle(ab, b, bc, level - 1);
        triangle(ca, bc, c, level - 1);
        triangle(ab, bc, ca, level - 1);
        return;
      }
      for (const p of [a, b, c]) {
        points.push(p.x, p.y, surface(p.x, p.y) + lift);
        const nx = 0.044 * p.x / (0.19 ** 2) * (1 - (p.y / 0.34) ** 2);
        const ny = 0.044 * p.y / (0.34 ** 2) * (1 - (p.x / 0.19) ** 2);
        const n = new THREE.Vector3(nx, ny, 1).normalize();
        normals.push(n.x, n.y, n.z);
      }
    };
    for (let i = 0; i < index.count; i += 3) {
      const at = (j: number) => new THREE.Vector2(pos.getX(index.getX(j)), pos.getY(index.getX(j)));
      triangle(at(i), at(i + 1), at(i + 2), 2);
    }
    source.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    pack.add(mesh);
  };
  const seam = (shape: THREE.Shape, material: THREE.Material, radius = 0.0016, lift = 0.004): void => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const samples = shape.getPoints(18);
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      path.add(new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, surface(a.x, a.y) + lift),
        new THREE.Vector3(b.x, b.y, surface(b.x, b.y) + lift)));
    }
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 96, radius, 5, false), material);
    mesh.name = 'sewn-panel-binding';
    pack.add(mesh);
  };
  panel('curved-container-face', outline, charcoal);

  // Long curved side panels rise into the yoke, as on a sport rig.
  for (const side of [-1, 1]) {
    const sidePanel = new THREE.Shape();
    sidePanel.moveTo(side * 0.084, 0.224);
    sidePanel.bezierCurveTo(side * 0.13, 0.215, side * 0.153, 0.15, side * 0.151, 0.056);
    sidePanel.bezierCurveTo(side * 0.154, 0.004, side * 0.128, -0.054, side * 0.094, -0.09);
    sidePanel.lineTo(side * 0.042, -0.012);
    sidePanel.bezierCurveTo(side * 0.044, 0.068, side * 0.055, 0.162, side * 0.084, 0.224);
    sidePanel.closePath();
    panel('swept-colour-panel', sidePanel, orange, 0.004);
    seam(sidePanel, binding, 0.0022, 0.007);
  }

  // Reserve pin cover flows down from the yoke into the main closing flaps.
  const reserve = new THREE.Shape();
  reserve.moveTo(-0.071, 0.181);
  reserve.quadraticCurveTo(0, 0.165, 0.071, 0.181);
  reserve.bezierCurveTo(0.048, 0.108, 0.052, 0.055, 0.04, 0.002);
  reserve.lineTo(0, -0.035);
  reserve.lineTo(-0.04, 0.002);
  reserve.bezierCurveTo(-0.052, 0.055, -0.048, 0.108, -0.071, 0.181);
  panel('reserve-pin-cover', reserve, dark, 0.003);
  seam(reserve, stitching, 0.001, 0.005);

  const fan = new THREE.Shape();
  fan.moveTo(0.018, -0.018);
  fan.quadraticCurveTo(0.05, -0.045, 0.101, -0.115);
  fan.quadraticCurveTo(0.06, -0.157, -0.005, -0.164);
  fan.quadraticCurveTo(-0.063, -0.157, -0.1, -0.112);
  fan.quadraticCurveTo(-0.049, -0.068, 0.018, -0.018);
  panel('main-closing-fan', fan, orange, 0.004);
  seam(fan, binding, 0.0018, 0.007);
  for (const end of [[-0.071, -0.123], [-0.036, -0.144], [0.004, -0.15]]) {
    const fold = new THREE.Shape();
    fold.moveTo(0.018, -0.026);
    fold.quadraticCurveTo(end[0]! * 0.5, -0.078, end[0]!, end[1]!);
    seam(fold, stitching, 0.0008, 0.008);
  }
  const mainCover = new THREE.Shape();
  mainCover.moveTo(-0.043, -0.141);
  mainCover.quadraticCurveTo(0, -0.15, 0.043, -0.141);
  mainCover.quadraticCurveTo(0.041, -0.198, 0.06, -0.231);
  mainCover.quadraticCurveTo(0, -0.242, -0.06, -0.231);
  mainCover.quadraticCurveTo(-0.041, -0.198, -0.043, -0.141);
  panel('main-pin-cover', mainCover, dark, 0.009);
  seam(mainCover, binding, 0.0018, 0.012);

  // Padded shoulder yoke wraps over into the harness.
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.108, 0.246, 0.005),
      new THREE.Vector3(side * 0.112, 0.27, -0.055),
      new THREE.Vector3(side * 0.118, 0.232, -0.135),
      new THREE.Vector3(side * 0.12, 0.148, -0.165),
    ]);
    const pad = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.021, 8, false), dark);
    pad.name = 'padded-shoulder-yoke';
    pack.add(pad);
  }
  const pouch = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.213, 3, 12).rotateZ(Math.PI / 2), dark);
  pouch.name = 'pilot-chute-pouch';
  pouch.position.set(0, -0.236, 0.05);
  pack.add(pouch);
  // Matches BOC in body.ts: the animated hand still reaches the extraction handle.
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.03, 0.03, 3, 0.009),
    new THREE.MeshLambertMaterial({ color: 0xffd84a }));
  handle.name = 'pilot-chute-handle';
  handle.position.set(0.12, -0.24, 0.083);
  pack.add(handle);
  // Taper the complete upper assembly together: shell, fabric and binding
  // remain fitted, while the shoulder section is narrower and less bulky.
  const normal = new THREE.Vector3();
  for (const child of pack.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.updateMatrix();
    const geometry = child.geometry as THREE.BufferGeometry;
    geometry.applyMatrix4(child.matrix);
    child.position.set(0, 0, 0);
    child.quaternion.identity();
    child.scale.set(1, 1, 1);
    child.updateMatrix();
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const t = THREE.MathUtils.clamp((y - 0.015) / 0.235, 0, 1);
      const ease = t * t * (3 - 2 * t);
      const slope = 6 * t * (1 - t) / 0.235;
      const width = 1 - 0.22 * ease;
      const depth = 1 - 0.4 * ease;
      normal.fromBufferAttribute(normals, i);
      normal.set(normal.x / width,
        normal.y + normal.x * x * 0.22 * slope / width + normal.z * (z + 0.058) * 0.4 * slope / depth,
        normal.z / depth).normalize();
      positions.setXYZ(i, x * width, y, -0.058 + (z + 0.058) * depth);
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return pack;
}
