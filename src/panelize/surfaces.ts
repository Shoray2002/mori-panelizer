import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type {
  FragmentsModel,
  ItemAttribute,
  ItemData,
  MeshData,
} from "@thatopen/fragments";
import { type ModelIdMap, mergeInto } from "../modelIdMap";
import type {
  PanelizableSurface,
  PlateFit,
  Polygon2D,
  SurfaceClass,
  Vec2,
} from "./types";
import { fitPlate } from "./plateFit";
import { matchCatalogThickness } from "../data";
import { unionRegions } from "./geometry2d";
import { planeBasis, projectToPlane, IDENTITY_MATRIX } from "./geometry3d";
import {
  FLAT_NZ,
  MAX_PLATE_THICKNESS_FT,
  METRES_PER_FOOT,
  MM_PER_FOOT,
  NONPLANAR_RESIDUAL,
  NORMAL_Q,
  OFFSET_Q,
  PROXY_CATEGORY,
  SLAB_CATEGORY,
  WALL_CATEGORY,
  WALL_NZ,
} from "./constants";

/** Vertical [min, max] Y extent of a storey. */
type Band = { min: number; max: number };

export interface PanelizeContext {
  fragments: OBC.FragmentsManager;
  categoryMaps: Map<string, ModelIdMap>;
  storeyMaps: Map<string, ModelIdMap>;
  boxesForMap: (map: ModelIdMap) => Promise<THREE.Box3[]>;
}

/** Per-extraction config: which categories, id prefix, and how to classify. */
interface PlanarConfig {
  pattern: RegExp;
  idPrefix: string;
  fallbackKind: SurfaceClass;
  classify?: (
    model: FragmentsModel,
    ids: number[],
  ) => Promise<Map<number, SurfaceClass>>;
  /**
   * Classify from the fitted plate rather than from IFC attributes, for files
   * that carry no element types. Applied after plate fitting.
   */
  classifyPlate?: (plate: PlateFit) => SurfaceClass;
  /** Reject fitted plates that aren't panel-like, before grouping. */
  keepPlate?: (plate: PlateFit, feetPerUnit: number) => boolean;
  /**
   * Fit each mesh piece separately instead of merging an element's pieces into
   * one mesh. Required when a single IFC element contains many independent
   * solids — the IFC2x3 Sterling export puts the whole building inside one
   * IfcBuildingElementProxy holding 52 closed shells, and merging them would
   * fit one plate to the entire building.
   */
  splitPieces?: boolean;
}

/**
 * Extract floor/ceiling slab surfaces: fit each slab element to a flat plate,
 * merge coplanar plates into whole-floor regions, and classify each by storey.
 */
export function extractSlabSurfaces(
  ctx: PanelizeContext,
): Promise<PanelizableSurface[]> {
  return extractPlanarSurfaces(ctx, {
    pattern: SLAB_CATEGORY,
    idPrefix: "slab",
    fallbackKind: "floor",
    classify: slabKinds,
  });
}

export function extractWallSurfaces(
  ctx: PanelizeContext,
): Promise<PanelizableSurface[]> {
  return extractPlanarSurfaces(ctx, {
    pattern: WALL_CATEGORY,
    idPrefix: "wall",
    fallbackKind: "wall",
  });
}

/**
 * Fallback for models with no semantic element types.
 *
 * SketchUp-authored IFCs — including the Sterling sample set — ship every
 * element as IfcBuildingElementProxy with no IfcWall/IfcSlab/IfcRoof anywhere,
 * so the category-name extractors above find nothing. The geometry is still
 * good, so we fit plates and classify each by its own orientation.
 *
 * Only worth running when the typed extractors came back empty; a well-formed
 * BIM export can also contain proxies (furniture, site objects, generic models)
 * which are not panelizable and would pollute the result.
 */
export function extractProxySurfaces(
  ctx: PanelizeContext,
): Promise<PanelizableSurface[]> {
  return extractPlanarSurfaces(ctx, {
    pattern: PROXY_CATEGORY,
    idPrefix: "surface",
    fallbackKind: "floor",
    classifyPlate: classifyByOrientation,
    keepPlate: (plate, feetPerUnit) =>
      plate.thickness * feetPerUnit <= MAX_PLATE_THICKNESS_FT,
    splitPieces: true,
  });
}

/**
 * Classify a plate from the direction it faces.
 *
 * `fitPlate` folds normals into a canonical hemisphere, so only the magnitude
 * of the up-component is meaningful. Dead flat reads as a floor; anything
 * pitched but not upright reads as a roof; upright is a wall.
 *
 * A flat roof therefore reads as "floor" — the two are indistinguishable from a
 * single plate, and resolving them needs storey context (topmost band) rather
 * than geometry alone. Floor-vs-roof only affects labelling and overlay colour,
 * not the panel layout, so the simple rule is left in place deliberately.
 */
export function classifyByOrientation(plate: PlateFit): SurfaceClass {
  const nz = Math.abs(plate.normal.y);
  if (nz >= FLAT_NZ) return "floor";
  return nz <= WALL_NZ ? "wall" : "roof";
}

/** Shared plate-fit → coplanar-merge → storey-classify pipeline. */
async function extractPlanarSurfaces(
  ctx: PanelizeContext,
  cfg: PlanarConfig,
): Promise<PanelizableSurface[]> {
  const map = mergeCategories(ctx.categoryMaps, cfg.pattern);
  if (!Object.keys(map).length) return [];

  const fitted = await fitPlates(
    ctx.fragments,
    map,
    cfg.classify,
    cfg.splitPieces,
  );
  const { kinds } = fitted;
  if (!fitted.plates.length) return [];


  const feetPerUnit = FEET_PER_UNIT;

  // Shape-based filtering and classification need the plate, and the filter
  // needs the unit scale, so both run after fitting rather than inside it.
  const plates = cfg.keepPlate
    ? fitted.plates.filter((p) => cfg.keepPlate!(p, feetPerUnit))
    : fitted.plates;
  if (!plates.length) return [];

  // Keyed by plate identity, not localId: with splitPieces many plates share
  // one element id, and they can legitimately differ in class (a single proxy
  // may hold both walls and floors).
  const plateKinds = new Map<PlateFit, SurfaceClass>();
  if (cfg.classifyPlate)
    for (const p of plates) plateKinds.set(p, cfg.classifyPlate(p));

  const bands = await storeyBands(ctx);
  const groups = groupCoplanar(plates);

  const surfaces: PanelizableSurface[] = [];
  let counter = 0;
  for (const group of groups) {
    for (const surface of buildSurfaces(
      group,
      kinds,
      plateKinds,
      bands,
      feetPerUnit,
      counter,
      cfg.idPrefix,
      cfg.fallbackKind,
    )) {
      surfaces.push(surface);
      counter++;
    }
  }

  logSummary(surfaces, feetPerUnit);
  return surfaces;
}

/** Console sanity check that the feet conversion is sane. */
function logSummary(surfaces: PanelizableSurface[], feetPerUnit: number) {
  if (!surfaces.length) return;
  const s = surfaces[0];
  const xs = s.region.outer.map((p) => p.x);
  const ys = s.region.outer.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  console.log(
    `[panelize] ${surfaces.length} surfaces · feetPerUnit=${feetPerUnit.toFixed(4)} · ` +
      `sample ${w.toFixed(1)}×${h.toFixed(1)} ft · thickness ${(s.thickness * 12).toFixed(2)} in`,
  );

  // A wrong unit scale is invisible downstream: the overlay divides the same
  // factor back out, so the model looks right while every region is off by
  // orders of magnitude and the layout silently yields nothing. Thickness is
  // the cheapest tell, because a panel is always a layup we can buy.
  const match = matchCatalogThickness(s.thickness * MM_PER_FOOT, 6);
  if (!match.withinTolerance || w < 1 || h < 1) {
    console.warn(
      `[panelize] scale looks wrong: a sample surface is ${w.toFixed(2)}×${h.toFixed(2)} ft ` +
        `at ${(s.thickness * 12).toFixed(3)} in thick, which is no catalog layup. ` +
        `Panel layout will produce little or nothing.`,
    );
  }
}

function attr(d: ItemData, key: string): ItemAttribute | undefined {
  const v = d[key];
  return v && !Array.isArray(v) ? v : undefined;
}

/**
 * Feet per unit of the geometry the fragments engine hands back.
 *
 * It normalises to metres regardless of what the IFC declares, so this is a
 * constant rather than something to read off the file.
 *
 * This used to detect the file's own length unit, which is correct for a
 * metre-declared export by coincidence and wrong for anything else. The 52-shell
 * 1702 export declares millimetres, so every region came out 304.8x too small,
 * every tile fell below MIN_PANEL_AREA, and the layout produced zero panels on a
 * model whose surfaces had extracted perfectly. The overlay still looked right,
 * because worldFromUV multiplies the same factor back out — the error cancelled
 * itself everywhere except the one place that mattered.
 */
const FEET_PER_UNIT = 1 / METRES_PER_FOOT;


/** Merge every category whose display name matches `pattern` into one map. */
function mergeCategories(
  categoryMaps: Map<string, ModelIdMap>,
  pattern: RegExp,
): ModelIdMap {
  const merged: ModelIdMap = {};
  for (const [name, map] of categoryMaps) {
    if (pattern.test(name)) mergeInto(merged, map);
  }
  return merged;
}

/** Pull geometry for every slab element, fit each to a plate, and read its type. */
async function fitPlates(
  fragments: OBC.FragmentsManager,
  elementMap: ModelIdMap,
  classify?: (
    model: FragmentsModel,
    ids: number[],
  ) => Promise<Map<number, SurfaceClass>>,
  splitPieces = false,
): Promise<{ plates: PlateFit[]; kinds: Map<number, SurfaceClass> }> {
  const plates: PlateFit[] = [];
  const kinds = new Map<number, SurfaceClass>();
  for (const [, model] of fragments.list) {
    const ids = [...(elementMap[model.modelId] ?? [])];
    if (!ids.length) continue;

    const perElement = await model.getItemsGeometry(ids);
    perElement.forEach((pieces, i) => {
      const localId = pieces.find((p) => p.localId != null)?.localId ?? ids[i];
      // One plate per element, or one per solid when the element is a bag of
      // unrelated shells. Keep the element's localId either way so selection
      // and isolation still resolve back to a real IFC item.
      const meshes = splitPieces
        ? pieces.map((piece) => combinePieces([piece]))
        : [combinePieces(pieces)];
      for (const { positions, indices } of meshes) {
        if (positions.length < 9) continue;
        const fit = fitPlate(positions, indices, IDENTITY_MATRIX, localId);
        if (fit) plates.push(fit);
      }
    });

    if (classify) for (const [id, kind] of await classify(model, ids)) kinds.set(id, kind);
  }
  return { plates, kinds };
}

/** Classify each slab from IfcSlab.PredefinedType: .ROOF. -> roof, else floor. */
async function slabKinds(
  model: FragmentsModel,
  ids: number[],
): Promise<Map<number, SurfaceClass>> {
  const kinds = new Map<number, SurfaceClass>();
  const data = await model.getItemsData(ids, {
    attributesDefault: false,
    attributes: ["PredefinedType", "_localId"],
  });
  data.forEach((d, i) => {
    const localId = (attr(d, "_localId")?.value as number | undefined) ?? ids[i];
    const type = String(attr(d, "PredefinedType")?.value ?? "").toUpperCase();
    kinds.set(localId, type.includes("ROOF") ? "roof" : "floor");
  });
  return kinds;
}

/** Bake each mesh piece to world space and concatenate into one mesh. */
function combinePieces(pieces: MeshData[]): {
  positions: number[];
  indices: number[];
} {
  const positions: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  for (const piece of pieces) {
    if (!piece.positions) continue;
    const base = positions.length / 3;
    for (let i = 0; i < piece.positions.length; i += 3) {
      v.set(piece.positions[i], piece.positions[i + 1], piece.positions[i + 2]);
      v.applyMatrix4(piece.transform);
      positions.push(v.x, v.y, v.z);
    }
    const count = piece.positions.length / 3;
    if (piece.indices) {
      for (let i = 0; i < piece.indices.length; i++)
        indices.push(piece.indices[i] + base);
    } else {
      for (let i = 0; i < count; i++) indices.push(base + i);
    }
  }
  return { positions, indices };
}

/** Bucket plates into coplanar groups by quantized (normal, plane offset). */
function groupCoplanar(plates: PlateFit[]): PlateFit[][] {
  const groups = new Map<string, PlateFit[]>();
  for (const p of plates) {
    const n = p.normal;
    const key =
      `${Math.round(n.x / NORMAL_Q)},${Math.round(n.y / NORMAL_Q)},${Math.round(n.z / NORMAL_Q)}` +
      `:${Math.round(p.offset / OFFSET_Q)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  return [...groups.values()];
}

/** Reconstruct a member ring's world points from its own UV basis. */
function ringWorldPoints(p: PlateFit, ring: Vec2[]): THREE.Vector3[] {
  return ring.map((uv) =>
    p.origin
      .clone()
      .addScaledVector(p.u, uv.x)
      .addScaledVector(p.v, uv.y),
  );
}

/** Build one or more PanelizableSurfaces from a coplanar plate group. */
function buildSurfaces(
  group: PlateFit[],
  kinds: Map<number, SurfaceClass>,
  plateKinds: Map<PlateFit, SurfaceClass>,
  bands: Map<string, Band>,
  feetPerUnit: number,
  startId: number,
  idPrefix: string,
  fallbackKind: SurfaceClass,
): PanelizableSurface[] {
  const modelPerFoot = 1 / feetPerUnit;

  // Shared plane: area-weighted normal + centroid, with a deterministic basis.
  const normal = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let totalArea = 0;
  for (const p of group) {
    normal.addScaledVector(p.normal, p.area);
    origin.addScaledVector(p.origin, p.area);
    totalArea += p.area;
  }
  normal.normalize();
  origin.multiplyScalar(1 / totalArea);
  const { u, v } = planeBasis(normal);

  // Members re-projected into the shared basis, openings included: a hole
  // survives the union only where no other plate covers it.
  const toShared = (p: PlateFit, ring: Vec2[]) =>
    ringWorldPoints(p, ring).map((pt) => projectToPlane(pt, origin, u, v));
  const regions = unionRegions(
    group.map((p) => ({
      outer: toShared(p, p.outlineUV),
      holes: p.holesUV.map((h) => toShared(p, h)),
    })),
  );

  const worstResidual = Math.max(...group.map((p) => p.planarityResidual));
  const tiltDeg = THREE.MathUtils.radToDeg(
    Math.acos(Math.min(1, Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))))),
  );

  const klass = majorityKind(group, kinds, plateKinds, fallbackKind);

  return regions.map((region, i) => {
    // Region centroid in world, for storey assignment by elevation.
    const c = region.outer.reduce(
      (acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }),
      { x: 0, y: 0 },
    );
    const n = region.outer.length;
    const centroidWorld = origin
      .clone()
      .addScaledVector(u, c.x / n)
      .addScaledVector(v, c.y / n);

    const storey = storeyAt(centroidWorld.y, bands);

    // Output region/thickness in feet; bake model-units-per-foot into the UV
    // basis so the overlay still lands correctly in the model-unit scene.
    const regionFt = scaleRegion(region, feetPerUnit);
    const worldFromUV = new THREE.Matrix4().makeBasis(
      u.clone().multiplyScalar(modelPerFoot),
      v.clone().multiplyScalar(modelPerFoot),
      normal,
    );
    worldFromUV.setPosition(origin);

    const thicknessFt = Math.max(...group.map((p) => p.thickness)) * feetPerUnit;

    const flags: string[] = [];
    if (worstResidual > NONPLANAR_RESIDUAL) flags.push("nonplanar");

    // Does the measured thickness correspond to anything we can actually buy?
    // A miss is not fatal — the surface still panelizes — but it is the tell for
    // a unit error (a plate 3.28x out is feet read as metres) or for a model
    // drawn to a layup outside the catalog, so it must be visible rather than
    // silently carried into the layout.
    const match = matchCatalogThickness(thicknessFt * MM_PER_FOOT);
    if (!match.withinTolerance) {
      flags.push(
        `off-catalog thickness ${(thicknessFt * 12).toFixed(2)} in` +
          (match.product ? ` (nearest ${match.product.layup})` : ""),
      );
    }

    return {
      id: `${idPrefix}-${startId + i}`,
      klass,
      storey,
      plane: { origin: origin.clone(), normal: normal.clone(), u: u.clone(), v: v.clone() },
      region: regionFt,
      thickness: thicknessFt,
      sourceLocalIds: group.map((p) => p.localId),
      worldFromUV,
      diagnostics: { tiltDeg, planarityResidual: worstResidual, mergeCount: group.length, flags },
    };
  });
}

/** Scale a region's coordinates (e.g. model units -> feet). */
function scaleRegion(region: Polygon2D, s: number): Polygon2D {
  const scaleRing = (r: Vec2[]) => r.map((p) => ({ x: p.x * s, y: p.y * s }));
  return { outer: scaleRing(region.outer), holes: region.holes.map(scaleRing) };
}

/** A coplanar group's kind = the majority member kind (fallback if unclassified). */
function majorityKind(
  group: PlateFit[],
  kinds: Map<number, SurfaceClass>,
  plateKinds: Map<PlateFit, SurfaceClass>,
  fallback: SurfaceClass,
): SurfaceClass {
  const tally = new Map<SurfaceClass, number>();
  for (const p of group) {
    // Per-plate (geometric) classification wins over per-element (IFC attribute).
    const k = plateKinds.get(p) ?? kinds.get(p.localId) ?? fallback;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  let best = fallback;
  let bestN = 0;
  for (const [k, n] of tally)
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  return best;
}

/** Storey whose vertical band contains `y` (nearest band if none contain it). */
function storeyAt(y: number, bands: Map<string, Band>): string | null {
  let nearest: string | null = null;
  let nearestDist = Infinity;
  for (const [name, b] of bands) {
    if (y >= b.min - 1e-6 && y <= b.max + 1e-6) return name;
    const d = Math.min(Math.abs(y - b.min), Math.abs(y - b.max));
    if (d < nearestDist) {
      nearestDist = d;
      nearest = name;
    }
  }
  return nearest;
}

/** Vertical Y extent of each storey, for assigning surfaces to storeys. */
async function storeyBands(ctx: PanelizeContext): Promise<Map<string, Band>> {
  const bands = new Map<string, Band>();
  for (const [name, map] of ctx.storeyMaps) {
    const boxes = (await ctx.boxesForMap(map)).filter((b) => !b.isEmpty());
    if (!boxes.length) continue;
    bands.set(name, {
      min: Math.min(...boxes.map((b) => b.min.y)),
      max: Math.max(...boxes.map((b) => b.max.y)),
    });
  }
  return bands;
}
