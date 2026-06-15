import * as THREE from "three";

// --- Surface selection ------------------------------------------------------

/** Categories that contribute horizontal panelizable surfaces (Milestone 1). */
export const SLAB_CATEGORY = /slab|roof/i;

// --- Plate fitting (model units) --------------------------------------------

/** Bucket width for the area-weighted normal histogram (~5°). */
export const NORMAL_HISTOGRAM_Q = 0.08;
/** Triangle normals within this cosine of the plate normal belong to a face. */
export const FACE_CONE = Math.cos(THREE.MathUtils.degToRad(20));
/** The two large faces must hold at least this fraction of total area. */
export const MIN_FACE_AREA_FRACTION = 0.2;
/** Weld vertices closer than this together. */
export const WELD_EPS = 0.001;
/** Collapse outline points within this of a straight edge. */
export const SIMPLIFY_EPS = 0.01;

// --- Coplanar grouping (model units) ----------------------------------------

/** Quantization of each normal component (~3°). */
export const NORMAL_Q = 0.05;
/** Plane-offset quantization; below a CLT layer so stacks stay separate. */
export const OFFSET_Q = 0.015;
/** Planarity residual above which a surface is flagged non-planar. */
export const NONPLANAR_RESIDUAL = 0.02;

// --- Units ------------------------------------------------------------------

export const METRES_PER_FOOT = 0.3048;
/** SI prefixes as a metre multiplier. */
export const PREFIX_M: Record<string, number> = {
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
};
/** Conversion-based length unit names -> metres. */
export const CONV_M: Record<string, number> = {
  FOOT: METRES_PER_FOOT,
  FEET: METRES_PER_FOOT,
  INCH: 0.0254,
};

// --- Debug overlay ----------------------------------------------------------

export const OVERLAY_GROUP = "panelize-overlay";
export const OVERLAY_OPACITY = 0.25;
/** Single overlay color for all surfaces (no per-class coding). */
export const OVERLAY_COLOR = 0x3b82f6;
