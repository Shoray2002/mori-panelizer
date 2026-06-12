import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { useStore, type CategoryName } from "../store";

/** ModelId -> set of localIds, the universal selection currency in fragments v3. */
type ModelIdMap = { [modelId: string]: Set<number> };

/** RegExp matchers for the categories we expose as filters. */
const CATEGORY_REGEX: Record<CategoryName, RegExp[]> = {
  Slabs: [/SLAB/, /ROOF/],
  Walls: [/WALL/],
};

const MODEL_ID = "model";
const WASM_VERSION = "0.0.77";

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

  /** storeyName -> items in that storey. */
  private storeyMaps = new Map<string, ModelIdMap>();
  /** category -> items in that category. */
  private categoryMaps = new Map<CategoryName, ModelIdMap>();

  async init(container: HTMLElement) {
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

    world.camera.controls.addEventListener("update", () =>
      this.fragments.core.update(),
    );
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
      store.set({ status: "ready", stories, viewMode: "normal", soloStory: null });
      await this.applyView();
      await this.zoomExtents();
    } catch (err) {
      console.error(err);
      store.set({ status: "error", error: (err as Error).message });
    }
  }

  /** Build storey and category ModelIdMaps from the loaded model. */
  private async buildClassifications() {
    this.storeyMaps.clear();
    this.categoryMaps.clear();

    await this.classifier.byIfcBuildingStorey({ classificationName: "Levels" });
    const levels = this.classifier.list.get("Levels");
    if (levels) {
      for (const [name, group] of levels) {
        this.storeyMaps.set(name, (await group.get()) as ModelIdMap);
      }
    }

    for (const [cat, regexes] of Object.entries(CATEGORY_REGEX) as [
      CategoryName,
      RegExp[],
    ][]) {
      const map: ModelIdMap = {};
      for (const [, model] of this.fragments.list) {
        const items = await model.getItemsOfCategories(regexes);
        const ids = Object.values(items).flat();
        if (ids.length) map[model.modelId] = new Set(ids);
      }
      this.categoryMaps.set(cat, map);
    }
  }

  /**
   * Reconcile the scene with the current store state: view mode, solo storey,
   * and category visibility. Called after any UI change.
   */
  async applyView() {
    const { viewMode, soloStory, categoryVisible } = useStore.getState();

    // Base visibility: solo isolates one storey; otherwise show everything.
    if (viewMode === "solo" && soloStory && this.storeyMaps.has(soloStory)) {
      await this.hider.isolate(this.storeyMaps.get(soloStory)!);
    } else {
      await this.hider.set(true);
    }

    // Apply category filters on top (hide any disabled category).
    for (const [cat, map] of this.categoryMaps) {
      if (!categoryVisible[cat]) await this.hider.set(false, map);
    }

    this.fragments.core.update(true);
  }

  /** Merge the slab + wall items into a single ModelIdMap for framing. */
  private buildContentMap(): ModelIdMap {
    const merged: ModelIdMap = {};
    for (const map of this.categoryMaps.values()) {
      for (const [modelId, set] of Object.entries(map)) {
        merged[modelId] ??= new Set();
        for (const id of set) merged[modelId].add(id);
      }
    }
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

  /** Frame the building from a 3/4 iso angle and cap how far the user can dolly out. */
  async zoomExtents() {
    const box = await this.getContentBox();
    if (!box) return;

    const controls = this.world.camera.controls;
    const center = box.getCenter(new THREE.Vector3());
    const diagonal = box.getSize(new THREE.Vector3()).length();

    // Cap dolly-out to ~2x the model size so the user can't fly off to infinity.
    controls.minDistance = diagonal * 0.05;
    controls.maxDistance = diagonal * 2;

    // Orient to a front-top-right 3/4 view, then dolly in to frame the box tightly.
    const dir = new THREE.Vector3(1, 0.7, 1).normalize();
    await controls.setLookAt(
      center.x + dir.x * diagonal,
      center.y + dir.y * diagonal,
      center.z + dir.z * diagonal,
      center.x,
      center.y,
      center.z,
      false,
    );
    await controls.fitToBox(box, true);
  }

  private async clearModel() {
    const model = this.fragments.list.get(MODEL_ID);
    if (model) {
      this.world.scene.three.remove(model.object);
      await this.fragments.core.disposeModel(MODEL_ID);
    }
    this.storeyMaps.clear();
    this.categoryMaps.clear();
  }

  dispose() {
    this.components.dispose();
  }
}
