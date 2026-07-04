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
import { unionRegions } from "./geometry2d";
import { planeBasis, projectToPlane, IDENTITY_MATRIX } from "./geometry3d";
import {
  CONV_M,
  METRES_PER_FOOT,
  NONPLANAR_RESIDUAL,
  NORMAL_Q,
  OFFSET_Q,
  PREFIX_M,
  SLAB_CATEGORY,
  WALL_CATEGORY,
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

/** Shared plate-fit → coplanar-merge → storey-classify pipeline. */
async function extractPlanarSurfaces(
  ctx: PanelizeContext,
  cfg: PlanarConfig,
): Promise<PanelizableSurface[]> {
  const map = mergeCategories(ctx.categoryMaps, cfg.pattern);
  if (!Object.keys(map).length) return [];

  const { plates, kinds } = await fitPlates(ctx.fragments, map, cfg.classify);
  if (!plates.length) return [];

  const firstModel = [...ctx.fragments.list.values()][0];
  const feetPerUnit = firstModel ? await detectFeetPerUnit(firstModel) : 1;

  const bands = await storeyBands(ctx);
  const groups = groupCoplanar(plates);

  const surfaces: PanelizableSurface[] = [];
  let counter = 0;
  for (const group of groups) {
    for (const surface of buildSurfaces(
      group,
      kinds,
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
}

function attr(d: ItemData, key: string): ItemAttribute | undefined {
  const v = d[key];
  return v && !Array.isArray(v) ? v : undefined;
}

/**
 * Feet per model coordinate unit, read from the IFC length unit. A
 * conversion-based foot/inch unit wins over the SI metre it's derived from
 * (Eason → 1); a plain SI metre/millimetre yields the metre→foot factor
 * (Duplex → 3.2808). Defaults to 1 (assume feet) when undetected.
 */
async function detectFeetPerUnit(model: FragmentsModel): Promise<number> {
  const cats = await model.getItemsOfCategories([
    /IFCSIUNIT/,
    /IFCCONVERSIONBASEDUNIT/,
  ]);
  const ids = Object.values(cats).flat();
  if (!ids.length) return 1;

  const data = await model.getItemsData(ids, {
    attributesDefault: false,
    attributes: ["UnitType", "Name", "Prefix"],
  });

  let si: number | null = null;
  let conv: number | null = null;
  for (const d of data) {
    if (!String(attr(d, "UnitType")?.value ?? "").toUpperCase().includes("LENGTH"))
      continue;
    const name = String(attr(d, "Name")?.value ?? "").toUpperCase();
    if (CONV_M[name] != null) conv = CONV_M[name];
    else if (name.includes("MET")) {
      const prefix = String(attr(d, "Prefix")?.value ?? "").toUpperCase();
      si = PREFIX_M[prefix] ?? 1;
    }
  }
  const metresPerUnit = conv ?? si ?? METRES_PER_FOOT;
  return metresPerUnit / METRES_PER_FOOT;
}

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
): Promise<{ plates: PlateFit[]; kinds: Map<number, SurfaceClass> }> {
  const plates: PlateFit[] = [];
  const kinds = new Map<number, SurfaceClass>();
  for (const [, model] of fragments.list) {
    const ids = [...(elementMap[model.modelId] ?? [])];
    if (!ids.length) continue;

    const perElement = await model.getItemsGeometry(ids);
    perElement.forEach((pieces, i) => {
      const localId = pieces.find((p) => p.localId != null)?.localId ?? ids[i];
      const { positions, indices } = combinePieces(pieces);
      if (positions.length < 9) return;
      const fit = fitPlate(positions, indices, IDENTITY_MATRIX, localId);
      if (fit) plates.push(fit);
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

  const klass = majorityKind(group, kinds, fallbackKind);

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

    const flags: string[] = [];
    if (worstResidual > NONPLANAR_RESIDUAL) flags.push("nonplanar");

    return {
      id: `${idPrefix}-${startId + i}`,
      klass,
      storey,
      plane: { origin: origin.clone(), normal: normal.clone(), u: u.clone(), v: v.clone() },
      region: regionFt,
      thickness: Math.max(...group.map((p) => p.thickness)) * feetPerUnit,
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
  fallback: SurfaceClass,
): SurfaceClass {
  const tally = new Map<SurfaceClass, number>();
  for (const p of group) {
    const k = kinds.get(p.localId) ?? fallback;
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
