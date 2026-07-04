// Panel-spec and material data for panelization, BOM, and quoting.
//
// This is the whole ingest system: the numbers below live in the two JSON
// files next to this one. To swap the dummy data for real specs, an end user
// edits manufacturers.json / materials.json — no code changes needed.
// ponytail: build-time JSON import; move to fetch-from-public if runtime swap
// (upload without rebuild) is ever needed.

import manufacturersData from "./manufacturers.json";
import materialsData from "./materials.json";

/** A standard CLT panel product. Lengths in millimetres. */
export interface PanelProduct {
  id: string;
  name: string; // manufacturer series name, e.g. "300-8.14"
  layup: string; // e.g. "3-ply"
  thickness_mm: number;
  maxLength_mm: number; // max stock length before cutting
  maxWidth_mm: number; // max stock width before cutting
  maxSpan_mm: number; // allowable simple span — the compliance lookup value
  weight_kg_per_m2: number; // for freight weight estimates
  price_per_m2: number; // material cost
}

export interface Manufacturer {
  id: string;
  name: string;
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
