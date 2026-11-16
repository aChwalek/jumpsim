import * as THREE from 'three';

/** A slender stickman limb with round joints that keep their radius when posed. */
export function limbMesh(radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), material);
  const joint = new THREE.SphereGeometry(radius, 12, 8);
  for (const y of [-0.5, 0.5]) {
    const cap = new THREE.Mesh(joint, material);
    cap.position.y = y;
    mesh.add(cap);
  }
  mesh.userData.roundLimb = true;
  return mesh;
}

/** Cancel the parent's length scale on its spherical endpoints. */
export function roundLimbEnds(mesh: THREE.Mesh, length: number): void {
  if (!mesh.userData.roundLimb) return;
  for (const cap of mesh.children) cap.scale.y = 1 / length;
}

/** Rounded trainers, with the toes pointing towards -Z. */
export function shoeGeometry(): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(0.055, 0.16, 4, 12)
    .rotateX(Math.PI / 2).scale(1, 0.82, 1).translate(0, 0, -0.065);
}
