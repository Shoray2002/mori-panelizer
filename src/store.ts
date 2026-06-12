import { create } from "zustand";

export type ViewMode = "normal" | "solo";
export type Status = "idle" | "loading" | "ready" | "error";

/** A building storey discovered in the IFC model. */
export interface Story {
  name: string;
}

/** Categories we expose as filter toggles (the MVP surfaces: floor/ceiling slabs + walls). */
export const FILTERABLE_CATEGORIES = ["Slabs", "Walls"] as const;
export type CategoryName = (typeof FILTERABLE_CATEGORIES)[number];

interface ViewerState {
  status: Status;
  fileName: string | null;
  error: string | null;
  progress: number;

  stories: Story[];
  viewMode: ViewMode;
  soloStory: string | null;
  categoryVisible: Record<CategoryName, boolean>;

  set: (partial: Partial<ViewerState>) => void;
  reset: () => void;
}

const initialCategoryVisible: Record<CategoryName, boolean> = {
  Slabs: true,
  Walls: true,
};

export const useStore = create<ViewerState>((set) => ({
  status: "idle",
  fileName: null,
  error: null,
  progress: 0,

  stories: [],
  viewMode: "normal",
  soloStory: null,
  categoryVisible: { ...initialCategoryVisible },

  set: (partial) => set(partial),
  reset: () =>
    set({
      status: "idle",
      fileName: null,
      error: null,
      progress: 0,
      stories: [],
      viewMode: "normal",
      soloStory: null,
      categoryVisible: { ...initialCategoryVisible },
    }),
}));
