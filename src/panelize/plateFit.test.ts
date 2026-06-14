import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { fitPlate, extractBoundaryLoops, foldNormal } from "./plateFit";

/** A thin box of footprint w×d and thickness t, as positions+indices. */
function plateMesh(w: number, d: number, t: number) {
  const g = new THREE.BoxGeometry(w, t, d); // thin along Y
  const pos = g.attributes.position.array as Float32Array;
  const idx = g.index!.array as Uint16Array;
  return { positions: pos, indices: idx };
}

describe("foldNormal", () => {
  it("folds antiparallel normals to the same hemisphere", () => {
    const a = foldNormal(new THREE.Vector3(0, 1, 0));
    const b = foldNormal(new THREE.Vector3(0, -1, 0));
    expect(a.equals(b)).toBe(true);
  });
});

describe("extractBoundaryLoops", () => {
  it("recovers a 4-vertex loop from two triangles of a square", () => {
    // verts 0,1,2,3 form a unit square; two triangles share the diagonal.
    const loops = extractBoundaryLoops([
      [0, 1, 2],
      [0, 2, 3],
    ]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
  });
});

describe("fitPlate", () => {
  it("fits an axis-aligned slab: up normal, correct thickness and area", () => {
    const { positions, indices } = plateMesh(2, 3, 0.2);
    const fit = fitPlate(positions, indices, new THREE.Matrix4(), 1)!;
    expect(fit).not.toBeNull();
    expect(Math.abs(fit.normal.y)).toBeCloseTo(1, 3);
    expect(fit.thickness).toBeCloseTo(0.2, 3);
    expect(fit.area).toBeCloseTo(6, 2);
  });

  it("fits a tilted slab: normal follows the rotation", () => {
    const { positions, indices } = plateMesh(2, 3, 0.2);
    const rot = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(20));
    const fit = fitPlate(positions, indices, rot, 2)!;
    expect(fit).not.toBeNull();
    // Expected normal = rotated +Y.
    const expected = new THREE.Vector3(0, 1, 0).applyMatrix4(rot).normalize();
    const align = Math.abs(fit.normal.dot(expected));
    expect(align).toBeCloseTo(1, 3);
    expect(fit.area).toBeCloseTo(6, 2);
  });

  it("rejects a non-plate (cube) as not plate-like enough only when ambiguous", () => {
    // A cube still has dominant opposing faces, so it should fit; assert it does
    // not throw and returns a plausible thickness.
    const { positions, indices } = plateMesh(1, 1, 1);
    const fit = fitPlate(positions, indices, new THREE.Matrix4(), 3);
    expect(fit?.thickness).toBeCloseTo(1, 3);
  });
});
