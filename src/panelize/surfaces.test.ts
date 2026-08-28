import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { classifyByOrientation } from "./surfaces";
import type { PlateFit } from "./types";

/** A PlateFit stub carrying only what the orientation classifier reads. */
function plate(normal: THREE.Vector3): PlateFit {
  return { normal: normal.normalize() } as PlateFit;
}

/** Unit normal of a plate pitched `deg` from horizontal. */
function pitched(deg: number) {
  const r = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(Math.sin(r), Math.cos(r), 0);
}

describe("classifyByOrientation", () => {
  it("calls a dead-flat plate a floor", () => {
    expect(classifyByOrientation(plate(new THREE.Vector3(0, 1, 0)))).toBe("floor");
  });

  it("calls an upright plate a wall", () => {
    expect(classifyByOrientation(plate(new THREE.Vector3(1, 0, 0)))).toBe("wall");
    expect(classifyByOrientation(plate(new THREE.Vector3(0, 0, 1)))).toBe("wall");
  });

  it("classifies regardless of which way the normal points", () => {
    // fitPlate folds normals to a canonical hemisphere, so only |n.y| matters.
    expect(classifyByOrientation(plate(new THREE.Vector3(0, -1, 0)))).toBe("floor");
    expect(classifyByOrientation(plate(new THREE.Vector3(-1, 0, 0)))).toBe("wall");
  });

  it("calls the 7.125 deg Sterling roof a roof, not a floor", () => {
    // Regression guard. The 1702 E 38th roof sits at 7.125 deg, 1.5 in 12 (|n.y| = 0.99228),
    // so a loose flat threshold silently folds the whole roof into the floors.
    const roof = classifyByOrientation(plate(pitched(7.125)));
    expect(roof).toBe("roof");
  });

  it("separates a shallow pitch from flat", () => {
    expect(classifyByOrientation(plate(pitched(0)))).toBe("floor");
    expect(classifyByOrientation(plate(pitched(2)))).toBe("roof");
    expect(classifyByOrientation(plate(pitched(45)))).toBe("roof");
    expect(classifyByOrientation(plate(pitched(88)))).toBe("wall");
    expect(classifyByOrientation(plate(pitched(90)))).toBe("wall");
  });

  it("covers the full pitch range with no unclassified gap", () => {
    for (let deg = 0; deg <= 90; deg += 0.5) {
      expect(["floor", "roof", "wall"]).toContain(
        classifyByOrientation(plate(pitched(deg))),
      );
    }
  });
});
