import { create } from "zustand";

export type ViewMode = "normal" | "solo";
export type Status = "idle" | "loading" | "ready" | "error";
export type PanelizeStatus = "idle" | "working" | "ready" | "error";
export type CameraProjection = "ortho" | "perspective";

/** A building storey discovered in the IFC model. */
export interface Story {
  name: string;
}

interface ViewerState {
  status: Status;
  fileName: string | null;
  error: string | null;
  progress: number;

  stories: Story[];
  viewMode: ViewMode;
  soloStory: string | null;
  cameraProjection: CameraProjection;

  categories: string[];
  categoryVisible: Record<string, boolean>;

  panelizeStatus: PanelizeStatus;
  surfaceCount: number;
  showSurfaceOverlay: boolean;

  set: (partial: Partial<ViewerState>) => void;
  reset: () => void;
}

const initial: Omit<ViewerState, "set" | "reset"> = {
  status: "idle",
  fileName: null,
  error: null,
  progress: 0,
  stories: [],
  viewMode: "normal",
  soloStory: null,
  cameraProjection: "ortho",
  categories: [],
  categoryVisible: {},
  panelizeStatus: "idle",
  surfaceCount: 0,
  showSurfaceOverlay: false,
};

export const useStore = create<ViewerState>((set) => ({
  ...initial,
  set: (partial) => set(partial),
  reset: () => set({ ...initial }),
}));
