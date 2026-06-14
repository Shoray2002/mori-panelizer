import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type { MeshData } from "@thatopen/fragments";
import type { PanelizableSurface, PlateFit, SurfaceClass, Vec2 } from "./types";
import { fitPlate } from "./plateFit";
import { unionOutlines } from "./geometry2d";

type ModelIdMap = { [modelId: string]: Set<number> };

/** Categories that contribute horizontal panelizable surfaces (Milestone 1). */
const SLAB_CATEGORY = /slab|roof/i;

/** Plane-grouping tolerances (model units; CLT files are in metres or feet). */
const NORMAL_Q = 0.05; // ~3° on each normal component
const OFFSET_Q = 0.015; // below a CLT layer thickness, so stacks stay separate

/** A horizontal surface tilts less than this from world-up to count as flat. */
const HORIZONTAL_COS = Math.cos(THREE.MathUtils.degToRad(20));

export interface PanelizeContext {
  fragments: OBC.FragmentsManager;
  categoryMaps: Map<string, ModelIdMap>;
  storeyMaps: Map<string, ModelIdMap>;
  boxesForMap: (map: ModelIdMap) => Promise<THREE.Box3[]>;
}

/**
 * Extract floor/ceiling slab surfaces: fit each slab element to a flat plate,
 * merge coplanar plates into whole-floor regions, and classify each by storey.
 */
export async function extractSlabSurfaces(
  ctx: PanelizeContext,
): Promise<PanelizableSurface[]> {
  const slabMap = mergeCategories(ctx.categoryMaps, SLAB_CATEGORY);
  if (!Object.keys(slabMap).length) return [];

  const plates = await fitPlates(ctx.fragments, slabMap);
  if (!plates.length) return [];

  const bands = await storeyBands(ctx);
  const groups = groupCoplanar(plates);

  const surfaces: PanelizableSurface[] = [];
  let counter = 0;
  for (const group of groups) {
    for (const surface of buildSurfaces(group, bands, counter)) {
      surfaces.push(surface);
      counter++;
    }
  }
  return surfaces;
}

/** Merge every category whose display name matches `pattern` into one map. */
function mergeCategories(
  categoryMaps: Map<string, ModelIdMap>,
  pattern: RegExp,
): ModelIdMap {
  const merged: ModelIdMap = {};
  for (const [name, map] of categoryMaps) {
    if (!pattern.test(name)) continue;
    for (const [modelId, set] of Object.entries(map)) {
      const into = (merged[modelId] ??= new Set());
      for (const id of set) into.add(id);
    }
  }
  return merged;
}

/** Pull geometry for every slab element and fit each to a plate. */
async function fitPlates(
  fragments: OBC.FragmentsManager,
  slabMap: ModelIdMap,
): Promise<PlateFit[]> {
  const plates: PlateFit[] = [];
  for (const [, model] of fragments.list) {
    const ids = [...(slabMap[model.modelId] ?? [])];
    if (!ids.length) continue;

    const perElement = await model.getItemsGeometry(ids);
    perElement.forEach((pieces, i) => {
      const localId = pieces.find((p) => p.localId != null)?.localId ?? ids[i];
      const { positions, indices } = combinePieces(pieces);
      if (positions.length < 9) return;
      const fit = fitPlate(positions, indices, IDENTITY, localId);
      if (fit) plates.push(fit);
    });
  }
  return plates;
}
const IDENTITY = new THREE.Matrix4();

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

/** Reconstruct a member outline's world points from its own UV basis. */
function memberWorldPoints(p: PlateFit): THREE.Vector3[] {
  return p.outlineUV.map((uv) =>
    p.origin
      .clone()
      .addScaledVector(p.u, uv.x)
      .addScaledVector(p.v, uv.y),
  );
}

/** Build one or more PanelizableSurfaces from a coplanar plate group. */
function buildSurfaces(
  group: PlateFit[],
  bands: Map<string, { min: number; max: number }>,
  startId: number,
): PanelizableSurface[] {
  // Shared plane: area-weighted normal + centroid.
  const normal = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let totalArea = 0;
  for (const p of group) {
    normal.addScaledVector(p.normal, p.area);
    origin.addScaledVector(p.origin, p.area);
    totalArea += p.area;
  }
  normal.normalize();
  origin.multiplyScalar(1 / totalArea); // area-weighted centroid, already on-plane

  // Re-derive a deterministic shared UV basis from the shared normal.
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  const axis = axes.reduce((a, b) =>
    Math.abs(a.dot(normal)) <= Math.abs(b.dot(normal)) ? a : b,
  );
  const u = axis
    .clone()
    .sub(normal.clone().multiplyScalar(axis.dot(normal)))
    .normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  const toShared = (world: THREE.Vector3): Vec2 => {
    const d = new THREE.Vector3().subVectors(world, origin);
    return { x: d.dot(u), y: d.dot(v) };
  };

  const outlines = group.map((p) => memberWorldPoints(p).map(toShared));
  const regions = unionOutlines(outlines);

  const worstResidual = Math.max(...group.map((p) => p.planarityResidual));
  const tiltDeg = THREE.MathUtils.radToDeg(
    Math.acos(Math.min(1, Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))))),
  );

  return regions.map((region, i) => {
    // Region centroid in world, for storey/elevation classification.
    const c = region.outer.reduce(
      (acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }),
      { x: 0, y: 0 },
    );
    const n = region.outer.length;
    const centroidWorld = origin
      .clone()
      .addScaledVector(u, c.x / n)
      .addScaledVector(v, c.y / n);

    const { klass, storey } = classify(normal, centroidWorld.y, bands);

    const worldFromUV = new THREE.Matrix4().makeBasis(u, v, normal);
    worldFromUV.setPosition(origin);

    const flags: string[] = [];
    if (worstResidual > 0.02) flags.push("nonplanar");

    return {
      id: `slab-${startId + i}`,
      klass,
      storey,
      plane: { origin: origin.clone(), normal: normal.clone(), u: u.clone(), v: v.clone() },
      region,
      thickness: Math.max(...group.map((p) => p.thickness)),
      sourceLocalIds: group.map((p) => p.localId),
      worldFromUV,
      diagnostics: { tiltDeg, planarityResidual: worstResidual, mergeCount: group.length, flags },
    };
  });
}

/** Classify a horizontal surface as floor vs ceiling within its storey band. */
function classify(
  normal: THREE.Vector3,
  meanY: number,
  bands: Map<string, { min: number; max: number }>,
): { klass: SurfaceClass; storey: string | null } {
  const horizontal = Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))) >= HORIZONTAL_COS;
  if (!horizontal) return { klass: "roof", storey: storeyAt(meanY, bands) };

  const storey = storeyAt(meanY, bands);
  if (!storey) return { klass: "floor", storey: null };
  const band = bands.get(storey)!;
  const nearTop = meanY - band.min > (band.max - band.min) * 0.5;
  return { klass: nearTop ? "ceiling" : "floor", storey };
}

/** Storey whose vertical band contains `y` (nearest band if none contain it). */
function storeyAt(
  y: number,
  bands: Map<string, { min: number; max: number }>,
): string | null {
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

/** Vertical [min,max] Y extent of each storey, for floor/ceiling classification. */
async function storeyBands(
  ctx: PanelizeContext,
): Promise<Map<string, { min: number; max: number }>> {
  const bands = new Map<string, { min: number; max: number }>();
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
