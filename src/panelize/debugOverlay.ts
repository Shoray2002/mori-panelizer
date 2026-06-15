import * as THREE from "three";
import type { PanelizableSurface, Vec2 } from "./types";
import { OVERLAY_COLOR, OVERLAY_GROUP, OVERLAY_OPACITY } from "./constants";

const toPath = (ring: Vec2[]): THREE.Vector2[] =>
  ring.map((p) => new THREE.Vector2(p.x, p.y));

/**
 * Build a filled + outlined overlay for each extracted surface, placed in world
 * via its worldFromUV transform — a visual check of extraction before the grid
 * stage.
 */
export function buildSurfaceOverlay(surfaces: PanelizableSurface[]): THREE.Group {
  const group = new THREE.Group();
  group.name = OVERLAY_GROUP;

  for (const s of surfaces) {
    const shape = new THREE.Shape(toPath(s.region.outer));
    for (const hole of s.region.holes) shape.holes.push(new THREE.Path(toPath(hole)));

    const color = OVERLAY_COLOR;
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: OVERLAY_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    fill.applyMatrix4(s.worldFromUV);
    fill.userData.surfaceId = s.id;
    group.add(fill);

    for (const ring of [s.region.outer, ...s.region.holes]) {
      const pts = ring.map((p) => new THREE.Vector3(p.x, p.y, 0));
      pts.push(pts[0].clone());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color }),
      );
      line.applyMatrix4(s.worldFromUV);
      group.add(line);
    }
  }
  return group;
}

/** Remove and dispose a previously added overlay group from a scene. */
export function clearSurfaceOverlay(scene: THREE.Object3D) {
  const existing = scene.getObjectByName(OVERLAY_GROUP);
  if (!existing) return;
  existing.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
  scene.remove(existing);
}
