import type {
  LayoutOptions,
  Panel,
  PanelizableSurface,
  Polygon2D,
  Vec2,
} from "./types";
import { boundingRect, intersect, polygonArea } from "./geometry2d";
import { MIN_PANEL_AREA, MM_PER_FOOT, OFFCUT_EPS, isVertical } from "./constants";
import { panelCatalog } from "../data";

const productById = (id: string) => panelCatalog.find((p) => p.id === id);

/** Rotate a ring by the angle whose (cos, sin) are given, about the origin. */
function rotateRing(ring: Vec2[], cos: number, sin: number): Vec2[] {
  return ring.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
}

function rotateRegion(region: Polygon2D, cos: number, sin: number): Polygon2D {
  return {
    outer: rotateRing(region.outer, cos, sin),
    holes: region.holes.map((h) => rotateRing(h, cos, sin)),
  };
}

/**
 * Lay CLT panels over one surface: a rule-based staggered grid in the grain
 * frame, each panel clipped to the region (openings and non-rectangular edges
 * fall out of the clip as holes and slanted cuts). No optimization solver.
 */
export function panelizeSurface(
  surface: PanelizableSurface,
  opts: LayoutOptions,
): Panel[] {
  const product = productById(opts.productId);
  if (!product) return [];

  const L = product.maxLength_mm / MM_PER_FOOT; // panel length along grain (ft)
  const W = product.maxWidth_mm / MM_PER_FOOT; // panel width across grain (ft)
  const maxSpan = product.maxSpan_mm / MM_PER_FOOT;
  if (L <= 0 || W <= 0) return [];
  // Walls carry load vertically — the span lookup applies to floors/roofs only.
  const spanChecked = !isVertical(surface.klass);

  // Work in the grain frame: rotate the region so the grain (panel length) runs
  // along +x, tile axis-aligned there, then rotate each panel back to UV.
  const theta = (opts.grainAngleDeg * Math.PI) / 180;
  const fwd = rotateRegion(surface.region, Math.cos(-theta), Math.sin(-theta));

  const bb = boundingRect(fwd.outer); // CCW: [min, +x, max, +y]
  const [minG, minT] = [bb[0].x, bb[0].y];
  const [maxG, maxT] = [bb[1].x, bb[2].y];

  const backCos = Math.cos(theta);
  const backSin = Math.sin(theta);

  const panels: Panel[] = [];
  let index = 0;
  const rows = Math.ceil((maxT - minT) / W);
  for (let r = 0; r < rows; r++) {
    const t0 = minT + r * W;
    // Stagger alternate rows along the grain so end-joints don't align.
    const shift = ((r * opts.staggerFraction) % 1) * L;
    const gStart = minG - shift;
    const cols = Math.ceil((maxG - gStart) / L);
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const g0 = gStart + cIdx * L;
      const rect: Vec2[] = [
        { x: g0, y: t0 },
        { x: g0 + L, y: t0 },
        { x: g0 + L, y: t0 + W },
        { x: g0, y: t0 + W },
      ];
      for (const piece of intersect(fwd, rect)) {
        const areaFt2 = polygonArea(piece);
        if (areaFt2 < MIN_PANEL_AREA) continue;
        const pb = boundingRect(piece.outer);
        const lengthFt = pb[1].x - pb[0].x;
        const widthFt = pb[2].y - pb[0].y;
        panels.push({
          id: `${surface.id}-p${index}`,
          surfaceId: surface.id,
          index: index + 1,
          productId: product.id,
          polygon: rotateRegion(piece, backCos, backSin),
          lengthFt,
          widthFt,
          areaFt2,
          spanFt: lengthFt,
          spanOK: !spanChecked || lengthFt <= maxSpan + OFFCUT_EPS,
          offcut: lengthFt < L - OFFCUT_EPS || widthFt < W - OFFCUT_EPS,
        });
        index++;
      }
    }
  }
  return panels;
}

export function panelizeAll(
  surfaces: PanelizableSurface[],
  opts: LayoutOptions,
): Panel[] {
  return surfaces.flatMap((s) => panelizeSurface(s, opts));
}
