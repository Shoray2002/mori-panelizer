import * as THREE from "three";
import type { Panel, PanelizableSurface, Vec2 } from "./types";
import {
  PANEL_COLOR_OVERSPAN,
  PANEL_GROUP,
  PANEL_OPACITY,
  PANEL_PALETTE,
  PANEL_SEAM_COLOR,
} from "./constants";

const toPath = (ring: Vec2[]): THREE.Vector2[] =>
  ring.map((p) => new THREE.Vector2(p.x, p.y));

/**
 * Build a filled + seam-outlined overlay for the laid-out panels, placed in
 * world via each surface's worldFromUV. Fills cycle a palette so neighbouring
 * panels read apart; over-span panels render red. Offsets sit above the
 * surface overlay (-2/-3) so the two never z-fight.
 */
export function buildPanelOverlay(
  panels: Panel[],
  surfaces: PanelizableSurface[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = PANEL_GROUP;
  const byId = new Map(surfaces.map((s) => [s.id, s]));

  for (const p of panels) {
    const s = byId.get(p.surfaceId);
    if (!s) continue;

    const color = p.spanOK
      ? PANEL_PALETTE[(p.index - 1) % PANEL_PALETTE.length]
      : PANEL_COLOR_OVERSPAN;

    const shape = new THREE.Shape(toPath(p.polygon.outer));
    for (const hole of p.polygon.holes) shape.holes.push(new THREE.Path(toPath(hole)));

    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: PANEL_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    fill.applyMatrix4(s.worldFromUV);
    fill.userData.surfaceId = s.id;
    fill.userData.storey = s.storey;
    fill.userData.klass = s.klass;
    fill.userData.panelId = p.id;
    group.add(fill);

    for (const ring of [p.polygon.outer, ...p.polygon.holes]) {
      const pts = ring.map((q) => new THREE.Vector3(q.x, q.y, 0));
      pts.push(pts[0].clone());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: PANEL_SEAM_COLOR,
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5,
        }),
      );
      line.applyMatrix4(s.worldFromUV);
      line.userData.surfaceId = s.id;
      line.userData.storey = s.storey;
      line.userData.klass = s.klass;
      group.add(line);
    }
  }
  return group;
}
