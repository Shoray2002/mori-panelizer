import * as THREE from "three";
import type { Vec2 } from "./types";

export const IDENTITY_MATRIX = new THREE.Matrix4();

const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

/**
 * A deterministic orthonormal in-plane basis for a given normal: u is the world
 * axis least parallel to the normal (projected onto the plane), v = normal × u.
 * Deterministic so coplanar plates share the same basis when merged.
 */
export function planeBasis(normal: THREE.Vector3): {
  u: THREE.Vector3;
  v: THREE.Vector3;
} {
  const axis = AXES.reduce((a, b) =>
    Math.abs(a.dot(normal)) <= Math.abs(b.dot(normal)) ? a : b,
  );
  const u = axis
    .clone()
    .sub(normal.clone().multiplyScalar(axis.dot(normal)))
    .normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

/** Project a world point onto a plane's (u, v) basis relative to its origin. */
export function projectToPlane(
  point: THREE.Vector3,
  origin: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
): Vec2 {
  const d = new THREE.Vector3().subVectors(point, origin);
  return { x: d.dot(u), y: d.dot(v) };
}
