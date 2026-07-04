import { create } from "zustand";
import type { LayoutOptions } from "./panelize/types";
import { DEFAULT_STAGGER } from "./panelize/constants";
import { panelCatalog } from "./data";

export type Status = "idle" | "loading" | "ready" | "error";
export type PanelizeStatus = "idle" | "working" | "ready" | "error";
export type CameraProjection = "ortho" | "perspective";

/** A building storey discovered in the IFC model. */
export interface Story {
  name: string;
}

/** Headline numbers from the last panel layout, for the sidebar. */
export interface PanelStats {
  total: number;
  offcuts: number;
  overSpan: number;
  areaFt2: number;
}

interface ViewerState {
  status: Status;
  fileName: string | null;
  error: string | null;
  progress: number;

  stories: Story[];
  soloStory: string | null;
  cameraProjection: CameraProjection;

  categories: string[];
  categoryVisible: Record<string, boolean>;

  panelizeStatus: PanelizeStatus;
  surfaceList: { id: string; klass: string; storey: string | null }[];
  showHorizontal: boolean;
  showVertical: boolean;
  selectedSurfaceId: string | null;

  layout: LayoutOptions;
  panelStats: PanelStats | null;
  showPanels: boolean;

  set: (partial: Partial<ViewerState>) => void;
  reset: () => void;
}

const initial: Omit<ViewerState, "set" | "reset"> = {
  status: "idle",
  fileName: null,
  error: null,
  progress: 0,
  stories: [],
  soloStory: null,
  cameraProjection: "ortho",
  categories: [],
  categoryVisible: {},
  panelizeStatus: "idle",
  surfaceList: [],
  showHorizontal: false,
  showVertical: false,
  selectedSurfaceId: null,
  layout: {
    productId: panelCatalog[0]?.id ?? "",
    grainAngleDeg: 0,
    staggerFraction: DEFAULT_STAGGER,
  },
  panelStats: null,
  showPanels: true,
};

export const useStore = create<ViewerState>((set) => ({
  ...initial,
  set: (partial) => set(partial),
  reset: () => set({ ...initial }),
}));
