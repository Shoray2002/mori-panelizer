import * as THREE from "three";
import type { PlateFit, Vec2 } from "./types";
import { area as ringArea, orient, pointInRing, simplifyRing } from "./geometry2d";
import { IDENTITY_MATRIX, planeBasis, projectToPlane } from "./geometry3d";
import {
  FACE_CONE,
  MIN_FACE_AREA_FRACTION,
  NORMAL_HISTOGRAM_Q,
  SIMPLIFY_EPS,
  WELD_EPS,
} from "./constants";

interface FitOpts {
  weldEps?: number;
  simplifyEps?: number;
}

/**
 * Fold a normal to a canonical hemisphere so n and -n bucket together: make the
 * largest-magnitude component positive (deterministic, basis-free).
 */
export function foldNormal(n: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const dominant = ax >= ay && ax >= az ? n.x : ay >= az ? n.y : n.z;
  return dominant < 0 ? n.clone().negate() : n.clone();
}

/** Apply a transform to a flat positions array, yielding world-space vertices. */
function bakeVertices(
  positions: ArrayLike<number>,
  transform: THREE.Matrix4,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const isIdentity = transform.equals(IDENTITY_MATRIX);
  for (let i = 0; i < positions.length; i += 3) {
    const v = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    if (!isIdentity) v.applyMatrix4(transform);
    out.push(v);
  }
  return out;
}

/** Triangle index triples; synthesizes sequential triples when none are given. */
function triangles(
  indices: ArrayLike<number> | undefined,
  vertexCount: number,
): number[][] {
  const tris: number[][] = [];
  if (indices) {
    for (let i = 0; i < indices.length; i += 3)
      tris.push([indices[i], indices[i + 1], indices[i + 2]]);
  } else {
    for (let i = 0; i < vertexCount; i += 3) tris.push([i, i + 1, i + 2]);
  }
  return tris;
}

/**
 * Walk boundary edges (those used by exactly one triangle) into closed loops of
 * vertex indices. A clean plate face yields one outer loop (+ any mesh holes).
 */
export function extractBoundaryLoops(tris: number[][]): number[][] {
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const count = new Map<string, { a: number; b: number; n: number }>();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(p, q);
      const e = count.get(k);
      if (e) e.n++;
      else count.set(k, { a: p, b: q, n: 1 });
    }
  }

  const adj = new Map<number, number[]>();
  for (const { a, b, n } of count.values()) {
    if (n !== 1) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }

  const used = new Set<string>();
  const loops: number[][] = [];
  for (const start of adj.keys()) {
    const neighbours = adj.get(start)!;
    for (const first of neighbours) {
      if (used.has(key(start, first))) continue;
      const loop = [start];
      let prev = start;
      let cur = first;
      used.add(key(start, first));
      while (cur !== start) {
        loop.push(cur);
        const next = (adj.get(cur) ?? []).find(
          (x) => x !== prev && !used.has(key(cur, x)),
        );
        if (next === undefined) break; // open chain (non-manifold) — abandon
        used.add(key(cur, next));
        prev = cur;
        cur = next;
      }
      if (cur === start && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/**
 * Fit a thin extruded plate to one element's mesh: dominant plane, thickness,
 * and the largest face's outline projected into a stable in-plane UV basis.
 * Returns null if the geometry isn't plate-like (no two dominant faces).
 */
export function fitPlate(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | undefined,
  transform: THREE.Matrix4,
  localId: number,
  opts: FitOpts = {},
): PlateFit | null {
  const weldEps = opts.weldEps ?? WELD_EPS;
  const simplifyEps = opts.simplifyEps ?? SIMPLIFY_EPS;

  const verts = bakeVertices(positions, transform);
  if (verts.length < 3) return null;
  const tris = triangles(indices, verts.length);
  if (!tris.length) return null;

  // Area-weighted, ±-folded normal histogram. The two big faces dominate area,
  // so the heaviest bucket is the plate plane — robust to the thin rim and tilt.
  const buckets = new Map<string, { sum: THREE.Vector3; area: number }>();
  let totalArea = 0;
  const triData = tris.map(([a, b, c]) => {
    const cross = new THREE.Vector3()
      .subVectors(verts[b], verts[a])
      .cross(new THREE.Vector3().subVectors(verts[c], verts[a]));
    const triArea = cross.length() / 2;
    const normal = triArea > 1e-12 ? cross.clone().normalize() : new THREE.Vector3();
    totalArea += triArea;
    if (triArea > 1e-12) {
      const folded = foldNormal(normal);
      const q = NORMAL_HISTOGRAM_Q;
      const k = `${Math.round(folded.x / q)},${Math.round(folded.y / q)},${Math.round(folded.z / q)}`;
      const slot = buckets.get(k) ?? { sum: new THREE.Vector3(), area: 0 };
      slot.sum.add(folded.clone().multiplyScalar(triArea));
      slot.area += triArea;
      buckets.set(k, slot);
    }
    return { a, b, c, normal, triArea };
  });

  let best: { sum: THREE.Vector3; area: number } | null = null;
  for (const slot of buckets.values())
    if (!best || slot.area > best.area) best = slot;
  if (!best || best.area / totalArea < MIN_FACE_AREA_FRACTION) return null;

  const n = best.sum.clone().normalize();

  // Thickness = spread of all vertices along the normal.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of verts) {
    const d = v.dot(n);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const thickness = hi - lo;

  // Split plate-parallel triangles into the two faces; keep the larger one.
  const plus: number[][] = [];
  const minus: number[][] = [];
  let plusArea = 0;
  let minusArea = 0;
  for (const t of triData) {
    const align = t.normal.dot(n);
    if (Math.abs(align) < FACE_CONE) continue;
    if (align > 0) {
      plus.push([t.a, t.b, t.c]);
      plusArea += t.triArea;
    } else {
      minus.push([t.a, t.b, t.c]);
      minusArea += t.triArea;
    }
  }
  const faceTris = plusArea >= minusArea ? plus : minus;
  if (!faceTris.length) return null;

  // Weld face vertices, then recover the boundary loop.
  const canon = new Map<string, number>();
  const canonVerts: THREE.Vector3[] = [];
  const idxOf = (vi: number): number => {
    const v = verts[vi];
    const k = `${Math.round(v.x / weldEps)}_${Math.round(v.y / weldEps)}_${Math.round(v.z / weldEps)}`;
    let id = canon.get(k);
    if (id === undefined) {
      id = canonVerts.length;
      canon.set(k, id);
      canonVerts.push(v);
    }
    return id;
  };
  const weldedTris = faceTris.map((t) => t.map(idxOf));
  const loops = extractBoundaryLoops(weldedTris);
  if (!loops.length) return null;

  // origin = centroid of face verts; UV basis derived from the plate normal.
  const origin = new THREE.Vector3();
  for (const v of canonVerts) origin.add(v);
  origin.multiplyScalar(1 / canonVerts.length);
  const { u, v } = planeBasis(n);

  // Outer loop = largest by UV area; smaller loops inside it are openings.
  const uvLoops = loops.map((loop) =>
    loop.map((vi) => projectToPlane(canonVerts[vi], origin, u, v)),
  );
  let outline: Vec2[] = [];
  let outlineArea = 0;
  for (const uv of uvLoops) {
    const a = ringArea(uv);
    if (a > outlineArea) {
      outlineArea = a;
      outline = uv;
    }
  }
  const holes = uvLoops
    .filter((uv) => uv !== outline && uv.length >= 3 && pointInRing(uv[0], outline))
    .map((uv) => orient(simplifyRing(uv, simplifyEps), false))
    .filter((uv) => uv.length >= 3);
  outline = orient(simplifyRing(outline, simplifyEps), true);
  if (outline.length < 3) return null;

  // Planarity: RMS distance of face verts to the fitted plane.
  const faceOffset = origin.dot(n);
  let sse = 0;
  for (const cv of canonVerts) {
    const e = cv.dot(n) - faceOffset;
    sse += e * e;
  }
  const planarityResidual = Math.sqrt(sse / canonVerts.length);

  return {
    localId,
    normal: n,
    offset: n.dot(origin),
    thickness,
    origin,
    outlineUV: outline,
    holesUV: holes,
    u,
    v,
    area: ringArea(outline),
    planarityResidual,
  };
}
