import * as THREE from "three";
import type { PanelizableSurface, SurfaceClass, Vec2 } from "./types";

const COLORS: Record<SurfaceClass, number> = {
  floor: 0x3b82f6, // blue
  ceiling: 0x22c55e, // green
  wall: 0xf59e0b, // amber
  roof: 0xa855f7, // purple
};

const GROUP_NAME = "panelize-overlay";

/** A UV ring -> THREE.Shape path (Vector2). */
const toPath = (ring: Vec2[]): THREE.Vector2[] =>
  ring.map((p) => new THREE.Vector2(p.x, p.y));

/**
 * Build a filled + outlined overlay for each extracted surface, placed in world
 * via its worldFromUV transform. Lets us visually confirm extraction (merged
 * floors, correct flattening, floor/ceiling colors) before the grid stage.
 */
export function buildSurfaceOverlay(surfaces: PanelizableSurface[]): THREE.Group {
  const group = new THREE.Group();
  group.name = GROUP_NAME;

  for (const s of surfaces) {
    const shape = new THREE.Shape(toPath(s.region.outer));
    for (const hole of s.region.holes) shape.holes.push(new THREE.Path(toPath(hole)));

    const color = COLORS[s.klass];
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    fill.applyMatrix4(s.worldFromUV);
    group.add(fill);

    // Outer + hole outlines.
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
  const existing = scene.getObjectByName(GROUP_NAME);
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
