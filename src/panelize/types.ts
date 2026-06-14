import * as THREE from "three";

/** A point in a surface's 2D (UV) coordinate system, in model length units. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A plane in world/model space with an in-plane orthonormal basis (u, v). */
export interface Plane3 {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
}

/** A 2D region: one outer ring (CCW) with zero or more holes (CW), in UV units. */
export interface Polygon2D {
  outer: Vec2[];
  holes: Vec2[][];
}

export type SurfaceClass = "floor" | "ceiling" | "wall" | "roof";

/** The flat plate fitted to a single IFC element, in model space. */
export interface PlateFit {
  localId: number;
  normal: THREE.Vector3; // unit, folded to a canonical hemisphere
  offset: number; // signed plane distance: normal · point
  thickness: number; // extent along normal
  origin: THREE.Vector3; // provisional plane origin (face centroid)
  outlineUV: Vec2[]; // largest-face boundary, projected to this plate's basis
  u: THREE.Vector3;
  v: THREE.Vector3;
  area: number; // outline area in UV
  planarityResidual: number; // RMS distance of verts to the fitted plane
}

/** Why a surface may be untrustworthy; surfaced for logging / QA. */
export interface SurfaceDiagnostics {
  tiltDeg: number; // angle of normal from the nearest world axis
  planarityResidual: number; // worst member residual
  mergeCount: number; // how many plates merged into this surface
  flags: string[];
}

/** A flat, panelizable surface ready for the grid-layout stage. */
export interface PanelizableSurface {
  id: string;
  klass: SurfaceClass;
  storey: string | null;
  plane: Plane3;
  region: Polygon2D; // outline + opening holes, in UV
  thickness: number;
  sourceLocalIds: number[];
  /** Maps UV (+ normal offset) to world: columns [u | v | normal | origin]. */
  worldFromUV: THREE.Matrix4;
  diagnostics: SurfaceDiagnostics;
}
