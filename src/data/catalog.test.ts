import { describe, it, expect } from "vitest";
import {
  manufacturers,
  panelCatalog,
  spanTable,
  catalogThicknessesMm,
  matchCatalogThickness,
} from "./index";

const MM_PER_IN = 25.4;

describe("Sterling catalog", () => {
  const sterling = manufacturers.find((m) => m.id === "sterling")!;

  it("carries all nine TerraLam SKUs", () => {
    expect(sterling.products).toHaveLength(9);
    expect(sterling.products.map((p) => p.sku)).toEqual([
      "TL300S14", "TL300S16", "TL300S18",
      "TL500S14", "TL500S16", "TL500S18",
      "TL700S14", "TL700S16", "TL700S18",
    ]);
  });

  it("cites where the numbers came from", () => {
    expect(sterling.source).toBeTruthy();
  });

  it("uses the true stock lengths, not the nominal foot sizes", () => {
    // The catalog is 164 / 186 / 212 in. Nominal "14 / 16 / 18 ft" would be
    // 168 / 192 / 216, which is what the placeholder data wrongly carried and
    // would overstate every panel by 4 to 6 in.
    const lengths = [...new Set(sterling.products.map((p) => p.maxLength_mm))];
    expect(lengths.map((mm) => Math.round(mm / MM_PER_IN)).sort((a, b) => a - b))
      .toEqual([164, 186, 212]);
  });

  it("is 92 in wide throughout", () => {
    for (const p of sterling.products) {
      expect(p.maxWidth_mm / MM_PER_IN).toBeCloseTo(92, 1);
    }
  });

  it("offers the three TerraLam layup thicknesses", () => {
    const inches = sterling.products.map((p) => +(p.thickness_mm / MM_PER_IN).toFixed(3));
    expect([...new Set(inches)].sort((a, b) => a - b)).toEqual([4.125, 6.875, 9.625]);
  });
});

describe("the ingest guard spans every manufacturer", () => {
  // catalogThicknessesMm is deliberately not Sterling-only: the user can pick
  // Mercer, and a plate matching a Mercer layup is still a plate we can supply.
  it("includes both suppliers' layups", () => {
    const inches = catalogThicknessesMm.map((mm) => +(mm / MM_PER_IN).toFixed(3));
    expect(inches).toEqual([...inches].sort((a, b) => a - b));
    expect(inches).toEqual(expect.arrayContaining([4.125, 6.875, 9.625]));
    expect(inches).toHaveLength(6);
  });
});

describe("span is not panel length", () => {
  // The bug this guards: maxSpan_mm === maxLength_mm in the placeholder data,
  // so the span check could never fail on any panel.
  it("never lets an allowable span exceed the panel it is cut from", () => {
    for (const p of panelCatalog) {
      expect(p.maxSpan_mm).toBeLessThanOrEqual(p.maxLength_mm);
    }
  });

  it("lets stock length bind where it is shorter than the span table allows", () => {
    // 5-ply is good for 16 ft, but a TL500S14 panel is only 13.67 ft long.
    const s14 = panelCatalog.find((p) => p.sku === "TL500S14")!;
    expect(s14.maxSpan_mm).toBe(s14.maxLength_mm);
    // 5-ply at the 18 ft size is the other way round: the table binds first.
    const s18 = panelCatalog.find((p) => p.sku === "TL500S18")!;
    expect(s18.maxSpan_mm).toBeLessThan(s18.maxLength_mm);
  });

  it("derives max_span_ft_by_ply from the permitted-ply matrix", () => {
    // Not a restatement of the file: re-derive the summary from the matrix it
    // summarises, so the two cannot drift apart.
    const dl60 = spanTable.permitted_ply_by_dead_load_psf["60"];
    for (const ply of [3, 5, 7]) {
      const widest = spanTable.span_ft
        .filter((_, i) => dl60[i].includes(ply))
        .reduce((a, b) => Math.max(a, b), 0);
      expect(spanTable.max_span_ft_by_ply[String(ply)]).toBe(widest);
    }
  });

  it("caps every product's span at min(table, stock length)", () => {
    // The central claim of the catalog change, asserted nowhere else.
    const MM_PER_FT = 304.8;
    for (const p of panelCatalog) {
      if (p.manufacturerId !== "sterling") continue;
      const ply = p.layup.split("-")[0];
      const fromTable = spanTable.max_span_ft_by_ply[ply] * MM_PER_FT;
      expect(p.maxSpan_mm).toBeCloseTo(Math.min(fromTable, p.maxLength_mm), 1);
    }
  });

  it("permits fewer plies as dead load rises", () => {
    const at = (psf: number, i: number) =>
      spanTable.permitted_ply_by_dead_load_psf[String(psf)][i];
    // 12 ft column: 3-ply drops out above 30 PSF
    expect(at(30, 2)).toContain(3);
    expect(at(40, 2)).not.toContain(3);
    // 17'8" column: 5-ply drops out above 40 PSF
    expect(at(40, 5)).toContain(5);
    expect(at(50, 5)).not.toContain(5);
  });
});

describe("matchCatalogThickness", () => {
  it("matches a 3-ply plate measured in millimetres", () => {
    const r = matchCatalogThickness(104.775);
    expect(r.withinTolerance).toBe(true);
    expect(r.product?.layup).toBe("3-ply");
  });

  it("tolerates mesh noise inside Sterling's own thickness tolerance", () => {
    expect(matchCatalogThickness(105.8).withinTolerance).toBe(true);
  });

  it("rejects a plate that is nothing in the catalog", () => {
    const r = matchCatalogThickness(300);
    expect(r.withinTolerance).toBe(false);
  });

  it("flags the feet-declared-as-metres case instead of snapping to it", () => {
    // 4.125 in read as feet is 3.28x too large. The nearest layup is still
    // returned, but withinTolerance must be false so the caller can complain.
    const r = matchCatalogThickness(104.775 * 3.28084);
    expect(r.withinTolerance).toBe(false);
    expect(r.product).not.toBeNull();
  });

  it("refuses nonsense input rather than returning a bogus match", () => {
    expect(matchCatalogThickness(0).product).toBeNull();
    expect(matchCatalogThickness(NaN).withinTolerance).toBe(false);
  });
});
