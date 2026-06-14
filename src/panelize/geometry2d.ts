import polygonClipping, {
  type Pair,
  type MultiPolygon,
} from "polygon-clipping";
import type { Polygon2D, Vec2 } from "./types";

const ringToPairs = (ring: Vec2[]): Pair[] => ring.map((p) => [p.x, p.y]);
const pairsToRing = (pairs: Pair[]): Vec2[] =>
  pairs.map(([x, y]) => ({ x, y }));

/** Signed area of a ring (CCW positive). */
export function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (ring: Vec2[]): number => Math.abs(signedArea(ring));

/** Force a ring to the requested winding (true = CCW). */
export function orient(ring: Vec2[], ccw: boolean): Vec2[] {
  const isCcw = signedArea(ring) > 0;
  return isCcw === ccw ? ring : [...ring].reverse();
}

/** Axis-aligned bounding rectangle of a set of points, as a CCW ring. */
export function boundingRect(pts: Vec2[]): Vec2[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * Drop vertices that lie within `eps` of the segment joining their neighbours.
 * Collapses the many collinear points a triangulated straight edge produces.
 */
export function simplifyRing(ring: Vec2[], eps: number): Vec2[] {
  if (ring.length <= 3) return ring;
  let pts = [...ring];
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const keep: Vec2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      if (perpDistance(cur, prev, next) < eps) {
        changed = true; // skip cur
      } else {
        keep.push(cur);
      }
    }
    if (keep.length < 3) break;
    pts = keep;
  }
  return pts;
}

/** Perpendicular distance from point `p` to the line through `a`–`b`. */
function perpDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

const toPolygon2D = (multi: MultiPolygon): Polygon2D[] =>
  multi.map((poly) => ({
    outer: orient(pairsToRing(poly[0]), true),
    holes: poly.slice(1).map((h) => orient(pairsToRing(h), false)),
  }));

/**
 * Union a set of outline rings (each a single, hole-free loop) into one or more
 * disjoint regions. Coplanar slab plates that abut merge into a whole floor;
 * physically separate ones come back as separate regions.
 */
export function unionOutlines(rings: Vec2[][]): Polygon2D[] {
  const valid = rings.filter((r) => r.length >= 3);
  if (!valid.length) return [];
  const multi: MultiPolygon = valid.map((r) => [ringToPairs(r)]);
  return toPolygon2D(polygonClipping.union(multi));
}

/** Subtract hole rings from a region, returning the resulting region(s). */
export function subtractHoles(region: Polygon2D, holes: Vec2[][]): Polygon2D[] {
  const subject: MultiPolygon = [
    [ringToPairs(region.outer), ...region.holes.map(ringToPairs)],
  ];
  const clips: MultiPolygon = holes
    .filter((h) => h.length >= 3)
    .map((h) => [ringToPairs(h)]);
  if (!clips.length) return [region];
  return toPolygon2D(polygonClipping.difference(subject, ...clips));
}
