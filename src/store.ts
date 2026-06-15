import { create } from "zustand";

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
  soloStory: string | null;
  cameraProjection: CameraProjection;

  categories: string[];
  categoryVisible: Record<string, boolean>;

  panelizeStatus: PanelizeStatus;
  surfaceList: { id: string; klass: string; storey: string | null }[];
  showSurfaceOverlay: boolean;
  selectedSurfaceId: string | null;

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
  showSurfaceOverlay: false,
  selectedSurfaceId: null,
};

export const useStore = create<ViewerState>((set) => ({
  ...initial,
  set: (partial) => set(partial),
  reset: () => set({ ...initial }),
}));
