import * as THREE from "three";

// --- Surface selection ------------------------------------------------------

/** Categories that contribute panelizable surfaces. */
export const SLAB_CATEGORY = /slab|roof/i;
export const WALL_CATEGORY = /^wall/i;

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

// --- Panel layout (feet) ----------------------------------------------------

export const MM_PER_FOOT = 304.8;
/** Default row-to-row seam stagger (half-panel brick pattern). */
export const DEFAULT_STAGGER = 0.5;
/** Drop clip slivers smaller than this (ft²). */
export const MIN_PANEL_AREA = 0.01;
/** A panel clipped shorter/narrower than nominal by more than this is an offcut. */
export const OFFCUT_EPS = 0.02;

// --- Panel overlay ----------------------------------------------------------

export const PANEL_GROUP = "panel-overlay";
export const PANEL_OPACITY = 0.6;
/** Cycled per panel index so adjacent panels and their seams read apart. */
export const PANEL_PALETTE = [
  0xf59e0b, 0x10b981, 0x8b5cf6, 0xec4899, 0x14b8a6, 0xf97316,
];
/** Fill for panels that fail the span lookup. */
export const PANEL_COLOR_OVERSPAN = 0xef4444;
/** Panel seam/outline color. */
export const PANEL_SEAM_COLOR = 0x111111;

// --- Debug overlay ----------------------------------------------------------

export const OVERLAY_GROUP = "panelize-overlay";
export const OVERLAY_OPACITY = 0.25;
/** Overlay colors by orientation: horizontal (slab/roof) blue, vertical (wall) green. */
export const OVERLAY_COLOR_H = 0x3b82f6;
export const OVERLAY_COLOR_V = 0x22c55e;
/** Vertical surfaces are walls; everything else is horizontal. */
export const isVertical = (klass: string) => klass === "wall";
