import { describe, it, expect } from "vitest";
import { panelizeSurface } from "./panelize";
import type { LayoutOptions, PanelizableSurface, Polygon2D, Vec2 } from "./types";

// sterling-300-8.14: 2337×4267mm stock -> 7.667×14.0 ft, span placeholder = length.
const STERLING = "sterling-300-8.14";
// mercer-clt-3: 47.2 ft max length but only 10.83 ft allowable span.
const MERCER = "mercer-clt-3";

const rect = (w: number, h: number): Vec2[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

// panelizeSurface only reads .id, .klass and .region, so a partial cast is enough.
const surface = (region: Polygon2D, klass = "floor"): PanelizableSurface =>
  ({ id: "s0", klass, region }) as unknown as PanelizableSurface;

const opts = (o: Partial<LayoutOptions> = {}): LayoutOptions => ({
  productId: STERLING,
  grainAngleDeg: 0,
  staggerFraction: 0,
  ...o,
});

const totalArea = (region: Polygon2D, o: LayoutOptions) =>
  panelizeSurface(surface(region), o).reduce((s, p) => s + p.areaFt2, 0);

describe("panelizeSurface", () => {
  it("tiles a plain rectangle with disjoint panels that cover it exactly", () => {
    const region: Polygon2D = { outer: rect(60, 20), holes: [] };
    const panels = panelizeSurface(surface(region), opts());
    // 5 columns (60/14.0) x 3 rows (20/7.667).
    expect(panels).toHaveLength(15);
    // Disjoint grid clipped to the region -> areas sum to the region area.
    const sum = panels.reduce((s, p) => s + p.areaFt2, 0);
    expect(sum).toBeCloseTo(60 * 20, 1);
  });

  it("keeps full stock panels apart from boundary offcuts", () => {
    const panels = panelizeSurface(surface({ outer: rect(60, 20), holes: [] }), opts());
    expect(panels.some((p) => !p.offcut)).toBe(true);
    expect(panels.some((p) => p.offcut)).toBe(true);
    // Sterling placeholder span == stock length, so nothing flags.
    expect(panels.every((p) => p.spanOK)).toBe(true);
  });

  it("flags floor panels over the allowable span, but exempts walls", () => {
    const region: Polygon2D = { outer: rect(60, 20), holes: [] };
    const floor = panelizeSurface(surface(region, "floor"), opts({ productId: MERCER }));
    expect(floor.some((p) => !p.spanOK)).toBe(true);
    const wall = panelizeSurface(surface(region, "wall"), opts({ productId: MERCER }));
    expect(wall.every((p) => p.spanOK)).toBe(true);
  });

  it("leaves openings uncovered (net area drops by the hole)", () => {
    const hole: Vec2[] = [
      { x: 10, y: 5 },
      { x: 20, y: 5 },
      { x: 20, y: 12 },
      { x: 10, y: 12 },
    ];
    const region: Polygon2D = { outer: rect(60, 20), holes: [hole] };
    expect(totalArea(region, opts())).toBeCloseTo(60 * 20 - 10 * 7, 1);
  });

  it("still covers the region under stagger and grain rotation", () => {
    const region: Polygon2D = { outer: rect(60, 20), holes: [] };
    expect(totalArea(region, opts({ staggerFraction: 0.5 }))).toBeCloseTo(1200, 1);
    expect(totalArea(region, opts({ grainAngleDeg: 30 }))).toBeCloseTo(1200, 1);
  });

  it("returns nothing for an unknown product", () => {
    const region: Polygon2D = { outer: rect(60, 20), holes: [] };
    expect(panelizeSurface(surface(region), opts({ productId: "nope" }))).toEqual([]);
  });
});
