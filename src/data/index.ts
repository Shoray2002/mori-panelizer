// Panel-spec and material data for panelization, BOM, and quoting.
//
// This is the whole ingest system: the numbers below live in the two JSON
// files next to this one. To swap the dummy data for real specs, an end user
// edits manufacturers.json / materials.json — no code changes needed.
// ponytail: build-time JSON import; move to fetch-from-public if runtime swap
// (upload without rebuild) is ever needed.

import manufacturersData from "./manufacturers.json";
import materialsData from "./materials.json";
import spanTableData from "./span-table.json";

/** A standard CLT panel product. Lengths in millimetres. */
export interface PanelProduct {
  id: string;
  sku?: string; // supplier order code, e.g. "TL300S14"
  name: string; // manufacturer series name, e.g. "300S14"
  layup: string; // e.g. "3-ply"
  thickness_mm: number;
  maxLength_mm: number; // max stock length before cutting
  maxWidth_mm: number; // max stock width before cutting
  /**
   * Allowable simple span — the compliance lookup value. This is the distance
   * between supports, NOT the panel length, and for Sterling it is well short
   * of it: a 3-ply panel is 164 in long but only spans 10 ft. Sourced from the
   * span table at the conservative dead load; see span-table.json.
   */
  maxSpan_mm: number;
  weight_kg_per_m2: number; // for freight weight estimates
  price_per_m2: number; // material cost
}

export interface Manufacturer {
  id: string;
  name: string;
  /** Where the numbers came from. Says so explicitly when unverified. */
  source?: string;
  products: PanelProduct[];
}

/** A fixed-list choice (species/grade or finish) for the BOM. */
export interface Option {
  id: string;
  label: string;
}

export const manufacturers = manufacturersData as Manufacturer[];

const materials = materialsData as { speciesGrades: Option[]; finishes: Option[] };
export const speciesGrades = materials.speciesGrades;
export const finishes = materials.finishes;

/** Every panel product flattened with its manufacturer, for catalog lookups. */
export const panelCatalog = manufacturers.flatMap((m) =>
  m.products.map((p) => ({ ...p, manufacturerId: m.id, manufacturerName: m.name })),
);

export interface SpanTable {
  source: string;
  note: string;
  live_load_psf: number;
  span_ft: number[];
  permitted_ply_by_dead_load_psf: Record<string, number[][]>;
  max_span_ft_by_ply: Record<string, number>;
  max_span_basis: string;
}

export const spanTable = spanTableData as SpanTable;

/**
 * Distinct layup thicknesses in the catalog, ascending. Used by the ingest
 * guard: a plate whose measured thickness matches none of these is not a
 * panel we can supply, whatever the geometry says.
 */
export const catalogThicknessesMm = [
  ...new Set(panelCatalog.map((p) => p.thickness_mm)),
].sort((a, b) => a - b);

/**
 * Match a measured thickness against the catalog.
 *
 * The models arrive in whatever units the exporter felt like writing, and one
 * Sterling sample declares FOOT while its coordinates are metres. A plate that
 * lands 3.28x off every layup is the tell, so this returns the nearest product
 * and the miss, and lets the caller decide rather than silently snapping.
 *
 * `toleranceMm` defaults to 2 mm: Sterling's own thickness tolerance is 1/16 in
 * (1.5875 mm), so the window admits the full manufacturing band plus 0.41 mm of
 * mesh error. Do not raise it past 2.73 mm — that is half the smallest gap
 * between two catalog layups, beyond which a plate can match two products at
 * once and the result becomes catalog-order dependent.
 */
export function matchCatalogThickness(
  measuredMm: number,
  toleranceMm = 2,
): { product: PanelProduct | null; deltaMm: number; withinTolerance: boolean } {
  if (!Number.isFinite(measuredMm) || measuredMm <= 0) {
    return { product: null, deltaMm: NaN, withinTolerance: false };
  }
  let best: PanelProduct | null = null;
  let bestDelta = Infinity;
  for (const p of panelCatalog) {
    const d = Math.abs(p.thickness_mm - measuredMm);
    if (d < bestDelta) {
      bestDelta = d;
      best = p;
    }
  }
  return {
    product: best,
    deltaMm: bestDelta,
    withinTolerance: bestDelta <= toleranceMm,
  };
}
