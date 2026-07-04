import { describe, it, expect } from "vitest";
import {
  signedArea,
  simplifyRing,
  unionOutlines,
  unionRegions,
  pointInRing,
  boundingRect,
  area,
} from "./geometry2d";
import type { Vec2 } from "./types";

const sq = (x0: number, y0: number, s: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x0 + s, y: y0 },
  { x: x0 + s, y: y0 + s },
  { x: x0, y: y0 + s },
];

describe("signedArea", () => {
  it("is positive for CCW, negative for CW", () => {
    const ccw = sq(0, 0, 2);
    expect(signedArea(ccw)).toBeCloseTo(4);
    expect(signedArea([...ccw].reverse())).toBeCloseTo(-4);
  });
});

describe("simplifyRing", () => {
  it("drops collinear midpoints a triangulated edge introduces", () => {
    const ring: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 }, // collinear on the bottom edge
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const out = simplifyRing(ring, 1e-6);
    expect(out).toHaveLength(4);
    expect(area(out)).toBeCloseTo(4);
  });
});

describe("unionOutlines", () => {
  it("merges two abutting squares into one region", () => {
    const regions = unionOutlines([sq(0, 0, 2), sq(2, 0, 2)]);
    expect(regions).toHaveLength(1);
    expect(area(regions[0].outer)).toBeCloseTo(8);
  });

  it("keeps two separated squares as two regions", () => {
    const regions = unionOutlines([sq(0, 0, 2), sq(5, 0, 2)]);
    expect(regions).toHaveLength(2);
  });
});

describe("pointInRing", () => {
  it("distinguishes inside from outside", () => {
    const ring = sq(0, 0, 4);
    expect(pointInRing({ x: 2, y: 2 }, ring)).toBe(true);
    expect(pointInRing({ x: 5, y: 2 }, ring)).toBe(false);
  });
});

describe("unionRegions", () => {
  it("keeps a hole no other plate covers", () => {
    const regions = unionRegions([{ outer: sq(0, 0, 4), holes: [sq(1, 1, 2)] }]);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    expect(area(regions[0].outer) - area(regions[0].holes[0])).toBeCloseTo(12);
  });

  it("fills a hole covered by another plate", () => {
    const regions = unionRegions([
      { outer: sq(0, 0, 4), holes: [sq(1, 1, 2)] },
      { outer: sq(1, 1, 2), holes: [] },
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(0);
  });
});

describe("boundingRect", () => {
  it("wraps points in a CCW rectangle", () => {
    const r = boundingRect([
      { x: -1, y: 3 },
      { x: 4, y: -2 },
    ]);
    expect(signedArea(r)).toBeGreaterThan(0);
    expect(area(r)).toBeCloseTo(25);
  });
});
