import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { useStore } from "../store";
import { extractSlabSurfaces } from "../panelize/surfaces";
import type { PanelizableSurface } from "../panelize/types";
import {
  buildSurfaceOverlay,
  clearSurfaceOverlay,
} from "../panelize/debugOverlay";
import { OVERLAY_COLOR, OVERLAY_GROUP, OVERLAY_OPACITY } from "../panelize/constants";
import { type ModelIdMap, mergeInto } from "../modelIdMap";
import type { CameraProjection } from "../store";
import { Gizmo } from "./Gizmo";

const MODEL_ID = "model";
const WASM_VERSION = "0.0.77";

/**
 * Physical structural element categories we expose as filters. `getCategories`
 * also returns type definitions (IfcWallType), materials, property sets and
 * units — none of which are panelizable geometry — so we allowlist instead of
 * trying to deny-list the long tail of non-physical entities.
 */
const STRUCTURAL_CATEGORIES = new Set([
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCSLAB",
  "IFCROOF",
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCMEMBER",
  "IFCPLATE",
  "IFCFOOTING",
  "IFCPILE",
  "IFCCOVERING",
  "IFCCURTAINWALL",
  "IFCSTAIR",
  "IFCSTAIRFLIGHT",
  "IFCRAILING",
  "IFCBUILDINGELEMENTPROXY",
  "IFCWINDOW",
  "IFCDOOR",
]);

function prettyCategory(raw: string): string {
  const base = raw.replace(/^IFC/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Owns the That Open Engine (v3) setup and all model operations: load IFC,
 * classify by storey/category, and drive the normal / solo views.
 * React only reads state from the zustand store and calls these methods.
 */
export class ViewerManager {
  private components = new OBC.Components();
  private world!: OBC.World & { camera: OBC.OrthoPerspectiveCamera };
  private ifcLoader!: OBC.IfcLoader;
  private fragments!: OBC.FragmentsManager;
  private classifier!: OBC.Classifier;
  private hider!: OBC.Hider;
  private bbox!: OBC.BoundingBoxer;
  private storeyMaps = new Map<string, ModelIdMap>();
  private categoryMaps = new Map<string, ModelIdMap>();
  private surfaces: PanelizableSurface[] = [];
  private gizmo!: Gizmo;
  private container!: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private pointerDownAt: { x: number; y: number } | null = null;
  private selectedFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null =
    null;

  async init(container: HTMLElement) {
    this.container = container;
    const components = this.components;

    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<
      OBC.SimpleScene,
      OBC.OrthoPerspectiveCamera,
      OBC.SimpleRenderer
    >();
    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.scene.three.background = null;
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.renderer.showLogo = false;
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.camera.projection.set("Orthographic"); // ortho by default
    this.world = world;

    components.init();

    // IFC loader -> point web-ifc at its wasm.
    this.ifcLoader = components.get(OBC.IfcLoader);
    await this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: { path: `https://unpkg.com/web-ifc@${WASM_VERSION}/`, absolute: true },
    });

    // Fragments engine worker (required in v3).
    this.fragments = components.get(OBC.FragmentsManager);
    const workerUrl = await OBC.FragmentsManager.getWorker();
    this.fragments.init(workerUrl);
    this.gizmo = new Gizmo(() => world.camera.three, world.camera.controls);
    container.appendChild(this.gizmo.canvas);

    // Click (not drag) on an extracted surface selects it.
    container.addEventListener("pointerdown", this.onPointerDown);
    container.addEventListener("pointerup", this.onPointerUp);

    world.camera.controls.addEventListener("update", () => {
      this.fragments.core.update();
      this.gizmo.update();
    });
    this.gizmo.update();
    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      this.fragments.core.update(true);
    });

    this.classifier = components.get(OBC.Classifier);
    this.hider = components.get(OBC.Hider);
    this.bbox = components.get(OBC.BoundingBoxer);
  }

  /** Parse an IFC file, build classifications, and report discovered storeys. */
  async loadIfc(file: File) {
    const store = useStore.getState();
    store.set({ status: "loading", fileName: file.name, error: null, progress: 0 });

    try {
      await this.clearModel();

      const buffer = new Uint8Array(await file.arrayBuffer());
      await this.ifcLoader.load(buffer, false, MODEL_ID, {
        processData: {
          progressCallback: (p: number) =>
            useStore.getState().set({ progress: Math.round(p * 100) }),
        },
      });

      await this.buildClassifications();

      const stories = [...this.storeyMaps.keys()].map((name) => ({ name }));
      const categories = [...this.categoryMaps.keys()].sort();
      const categoryVisible: Record<string, boolean> = {};
      for (const c of categories) categoryVisible[c] = true;

      store.set({
        status: "ready",
        stories,
        categories,
        categoryVisible,
        soloStory: null,
        selectedSurfaceId: null,
      });
      await this.applyView();
      await this.zoomExtents();
      this.gizmo.setVisible(true);
    } catch (err) {
      console.error(err);
      store.set({ status: "error", error: (err as Error).message });
    }
  }

  /** Build storey and category ModelIdMaps from the loaded model. */
  private async buildClassifications() {
    this.storeyMaps.clear();
    this.categoryMaps.clear();

    // Categories first: discover the structural element categories present in
    // the file (also used to derive the storey height from wall geometry).
    for (const [, model] of this.fragments.list) {
      const raw = await model.getCategories();
      for (const cat of raw) {
        if (!STRUCTURAL_CATEGORIES.has(cat.toUpperCase())) continue;
        const items = await model.getItemsOfCategories([new RegExp(`^${cat}$`)]);
        const ids = Object.values(items).flat();
        if (!ids.length) continue;

        const name = prettyCategory(cat);
        const map = this.categoryMaps.get(name) ?? {};
        const set = (map[model.modelId] ??= new Set());
        for (const id of ids) set.add(id);
        this.categoryMaps.set(name, map);
      }
    }

    await this.buildStoreys();
  }

  /**
   * Group the IFC building storeys into physical floors. IFC has no field that
   * separates an architectural floor from a construction datum (sill/deck/head),
   * so this is purely geometric and naming-agnostic: each storey is placed at
   * its base elevation, and storeys are binned into bands one storey-height tall.
   * A normal architectural file (one storey per floor) yields one floor each; a
   * structural model with many per-floor datums collapses them into real floors.
   */
  private async buildStoreys() {
    this.classifier.list.delete("Levels");
    await this.classifier.byIfcBuildingStorey({ classificationName: "Levels" });
    const levels = this.classifier.list.get("Levels");
    if (!levels) return;

    // Keep storeys that own geometry, tagged with their base elevation (min Y).
    const storeys: { map: ModelIdMap; base: number }[] = [];
    for (const [, group] of levels) {
      const map = (await group.get()) as ModelIdMap;
      const boxes = (await this.boxesForMap(map)).filter((b) => !b.isEmpty());
      if (!boxes.length) continue;
      const base = Math.min(...boxes.map((b) => b.min.y));
      storeys.push({ map, base });
    }
    if (!storeys.length) return;

    storeys.sort((a, b) => a.base - b.base);

    // Band width = storey height derived from the model. Median wall height is
    // the best proxy; fall back to the median gap between storey elevations.
    let storeyHeight = await this.deriveStoreyHeight();
    if (storeyHeight <= 0) {
      const gaps = storeys
        .slice(1)
        .map((s, i) => s.base - storeys[i].base)
        .filter((g) => g > 0.1);
      storeyHeight = median(gaps);
    }

    const minBase = storeys[0].base;
    const bands = new Map<number, ModelIdMap>();
    for (const s of storeys) {
      const idx =
        storeyHeight > 0
          ? Math.floor((s.base - minBase) / storeyHeight)
          : bands.size;
      const target = bands.get(idx) ?? {};
      mergeInto(target, s.map);
      bands.set(idx, target);
    }

    [...bands.keys()]
      .sort((a, b) => a - b)
      .forEach((idx, i) => this.storeyMaps.set(`Level ${i + 1}`, bands.get(idx)!));
  }

  /** Median height (max.y - min.y) of the wall elements, in model units. */
  private async deriveStoreyHeight(): Promise<number> {
    const walls: ModelIdMap = {};
    for (const [name, map] of this.categoryMaps) {
      if (/wall/i.test(name)) mergeInto(walls, map);
    }
    const boxes = (await this.boxesForMap(walls)).filter((b) => !b.isEmpty());
    const heights = boxes.map((b) => b.max.y - b.min.y).filter((h) => h > 0.1);
    return median(heights);
  }

  /** Per-element world-space boxes for every item in a ModelIdMap. */
  private async boxesForMap(map: ModelIdMap): Promise<THREE.Box3[]> {
    const boxes: THREE.Box3[] = [];
    for (const [, model] of this.fragments.list) {
      const ids = map[model.modelId];
      if (!ids?.size) continue;
      boxes.push(...(await model.getBoxes([...ids])));
    }
    return boxes;
  }

  /**
   * Reconcile the scene with the current focus: a selected surface isolates its
   * storey; failing that a solo storey isolates that storey; otherwise show all.
   * Category filters and overlay visibility apply on top. Called after any change.
   */
  async applyView() {
    const { soloStory, selectedSurfaceId, categoryVisible } = useStore.getState();
    const focusStorey = selectedSurfaceId
      ? (this.surfaces.find((s) => s.id === selectedSurfaceId)?.storey ?? null)
      : soloStory;

    // Geometry: isolate the focused storey, else show everything.
    if (focusStorey && this.storeyMaps.has(focusStorey)) {
      await this.hider.isolate(this.storeyMaps.get(focusStorey)!);
    } else {
      await this.hider.set(true);
    }

    // Apply category filters on top (hide any disabled category).
    for (const [cat, map] of this.categoryMaps) {
      if (!categoryVisible[cat]) await this.hider.set(false, map);
    }

    this.reconcileOverlay(selectedSurfaceId, focusStorey);
    this.fragments.core.update(true);
  }

  /** Show only the focused surface's overlay (or the focused storey's, or all). */
  private reconcileOverlay(selectedSurfaceId: string | null, focusStorey: string | null) {
    const group = this.world.scene.three.getObjectByName(OVERLAY_GROUP);
    if (!group) return;
    for (const o of group.children) {
      o.visible = selectedSurfaceId
        ? o.userData.surfaceId === selectedSurfaceId
        : focusStorey
          ? o.userData.storey === focusStorey
          : true;
    }
  }

  /** Merge the slab + wall items into a single ModelIdMap for framing. */
  private buildContentMap(): ModelIdMap {
    const merged: ModelIdMap = {};
    for (const map of this.categoryMaps.values()) mergeInto(merged, map);
    return merged;
  }

  /**
   * World-space bounding box of the building geometry (slabs + walls), via the
   * fragments-aware BoundingBoxer. Limiting to these items keeps stray reference
   * geometry (survey points, levels) from blowing up the box and off-centering.
   */
  private async getContentBox(): Promise<THREE.Box3 | null> {
    this.bbox.list.clear();
    const map = this.buildContentMap();
    if (Object.keys(map).length) await this.bbox.addFromModelIdMap(map);
    else this.bbox.addFromModels();
    const box = this.bbox.get();
    return box.isEmpty() ? null : box;
  }

  /** Switch the camera between orthographic and perspective projection. */
  setProjection(projection: CameraProjection) {
    this.world.camera.projection.set(
      projection === "ortho" ? "Orthographic" : "Perspective",
    );
    this.fragments.core.update(true);
    this.gizmo.update();
  }

  /**
   * Frame a box along `dir`, then fit tightly. Dolly limits are derived from
   * `clampDiagonal` (the building size) so framing a small surface still lets the
   * user zoom back out to the whole model.
   */
  private async frameBox(
    box: THREE.Box3,
    dir: THREE.Vector3,
    animate: boolean,
    clampDiagonal?: number,
  ) {
    const controls = this.world.camera.controls;
    const center = box.getCenter(new THREE.Vector3());
    const diagonal = box.getSize(new THREE.Vector3()).length();
    const clamp = clampDiagonal ?? diagonal;

    controls.minDistance = clamp * 0.05;
    controls.maxDistance = clamp * 2;

    // Snap the orientation instantly, then animate the fit. Fit by sphere, not
    // box: fitToBox rounds the camera to the nearest axis (snapping iso → side);
    // fitToSphere only dollies/zooms, preserving the orientation we just set.
    // The 1.1 factor leaves ~10% padding around the content.
    await controls.setLookAt(
      center.x + dir.x * diagonal,
      center.y + dir.y * diagonal,
      center.z + dir.z * diagonal,
      center.x,
      center.y,
      center.z,
      false,
    );
    const sphere = new THREE.Sphere(center, (diagonal / 2) * 1.1);
    await controls.fitToSphere(sphere, animate);
  }

  /** Frame the whole building from a 3/4 iso angle. */
  async zoomExtents() {
    const box = await this.getContentBox();
    if (!box) return;
    await this.frameBox(box, new THREE.Vector3(1, 0.7, 1).normalize(), true);
  }

  /** Diagonal of the building content box, for dolly clamping. */
  private async contentDiagonal(): Promise<number | undefined> {
    const box = await this.getContentBox();
    return box ? box.getSize(new THREE.Vector3()).length() : undefined;
  }

  /** Isolate a storey and frame it at the 3/4 angle. */
  async frameStorey(name: string) {
    useStore.getState().set({ soloStory: name, selectedSurfaceId: null });
    this.highlightFill(null);
    await this.applyView();

    const map = this.storeyMaps.get(name);
    if (!map) return;
    const box = new THREE.Box3();
    for (const b of await this.boxesForMap(map)) if (!b.isEmpty()) box.union(b);
    if (box.isEmpty()) return;
    await this.frameBox(box, new THREE.Vector3(1, 0.7, 1).normalize(), true);
  }

  /**
   * Flatten the camera onto a surface: frame its world box looking straight down
   * its normal (top-down for floors). Forces ortho — the clean panelization view.
   */
  private async frameSurface(surface: PanelizableSurface) {
    const box = new THREE.Box3();
    for (const p of surface.region.outer) {
      box.expandByPoint(
        new THREE.Vector3(p.x, p.y, 0).applyMatrix4(surface.worldFromUV),
      );
    }
    if (box.isEmpty()) return;

    const dir = surface.plane.normal.clone();
    if (dir.y < 0) dir.negate(); // view floors/ceilings from above

    this.setProjection("ortho");
    useStore.getState().set({ cameraProjection: "ortho" });
    await this.frameBox(box, dir, true, await this.contentDiagonal());
  }

  /**
   * Extract floor/ceiling slab surfaces for panelization, store them, and show
   * the verification overlay. Run on demand (geometry pull is heavier than the
   * box/category queries done at load time).
   */
  async extractSurfaces() {
    useStore.getState().set({ panelizeStatus: "working" });
    try {
      this.surfaces = await extractSlabSurfaces({
        fragments: this.fragments,
        categoryMaps: this.categoryMaps,
        storeyMaps: this.storeyMaps,
        boxesForMap: (map) => this.boxesForMap(map),
      });
      useStore.getState().set({
        panelizeStatus: "ready",
        surfaceList: this.surfaces.map((s) => ({
          id: s.id,
          klass: s.klass,
          storey: s.storey,
        })),
        showSurfaceOverlay: true,
      });
      this.renderSurfaceOverlay(true);
    } catch (err) {
      console.error(err);
      useStore.getState().set({ panelizeStatus: "error" });
    }
  }

  /** Add or remove the slab-surface overlay from the scene. */
  renderSurfaceOverlay(show: boolean) {
    const scene = this.world.scene.three;
    clearSurfaceOverlay(scene);
    this.selectedFill = null; // overlay rebuilt — old mesh refs are stale
    useStore.getState().set({ selectedSurfaceId: null });
    if (show && this.surfaces.length) {
      scene.add(buildSurfaceOverlay(this.surfaces));
    }
    void this.applyView(); // new group must respect the current focus
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDownAt = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // drag, not click
    this.pickSurface(e);
  };

  /** Raycast the overlay; focus the hit surface. A miss leaves focus untouched. */
  private pickSurface(e: PointerEvent) {
    const group = this.world.scene.three.getObjectByName(OVERLAY_GROUP);
    if (!group) return;

    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.world.camera.three);
    const fills = group.children.filter((o) => (o as THREE.Mesh).isMesh && o.visible);
    const hit = this.raycaster.intersectObjects(fills, false)[0];
    const id = hit?.object.userData.surfaceId as string | undefined;
    if (id) void this.selectSurface(id);
  }

  /** Focus a surface: isolate its storey + overlay, highlight, and flatten onto it. */
  async selectSurface(id: string) {
    if (!this.world.scene.three.getObjectByName(OVERLAY_GROUP)) {
      useStore.getState().set({ showSurfaceOverlay: true });
      this.renderSurfaceOverlay(true);
    }
    const surface = this.surfaces.find((s) => s.id === id);
    if (!surface) return;

    const group = this.world.scene.three.getObjectByName(OVERLAY_GROUP);
    const mesh = group?.children.find((o) => o.userData.surfaceId === id);
    useStore.getState().set({ selectedSurfaceId: id, soloStory: surface.storey });
    this.highlightFill((mesh as typeof this.selectedFill) ?? null);
    await this.applyView();
    await this.frameSurface(surface);
  }

  /** Clear all focus: whole building, all overlays, zoom to extents. */
  async showAll() {
    useStore.getState().set({ selectedSurfaceId: null, soloStory: null });
    this.highlightFill(null);
    await this.applyView();
    await this.zoomExtents();
  }

  /** Recolor the given fill as selected, restoring the previously selected one. */
  private highlightFill(fill: typeof this.selectedFill) {
    if (this.selectedFill) {
      const m = this.selectedFill.material;
      m.color.set(OVERLAY_COLOR);
      m.opacity = OVERLAY_OPACITY;
      m.transparent = true;
      m.depthWrite = false;
      m.needsUpdate = true;
    }
    this.selectedFill = fill;
    if (this.selectedFill) {
      // Render the selection solid so it reads the same whether it floats over
      // black or overlaps other slabs (transparent fills sort inconsistently).
      const m = this.selectedFill.material;
      m.color.set(0xfacc15);
      m.opacity = 1;
      m.transparent = false;
      m.depthWrite = true;
      m.needsUpdate = true;
    }
    useStore.getState().set({
      selectedSurfaceId: (this.selectedFill?.userData.surfaceId as string) ?? null,
    });
    this.fragments.core.update(true);
  }

  private async clearModel() {
    this.gizmo.setVisible(false);
    const model = this.fragments.list.get(MODEL_ID);
    if (model) {
      this.world.scene.three.remove(model.object);
      await this.fragments.core.disposeModel(MODEL_ID);
    }
    clearSurfaceOverlay(this.world.scene.three);
    this.surfaces = [];
    this.storeyMaps.clear();
    this.categoryMaps.clear();
    useStore.getState().set({ panelizeStatus: "idle", surfaceList: [] });
  }

  dispose() {
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointerup", this.onPointerUp);
    this.gizmo.dispose();
    this.components.dispose();
  }
}
