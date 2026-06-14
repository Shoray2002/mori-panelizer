import { useRef, type ReactNode } from "react";
import {
  useStore,
  FILTERABLE_CATEGORIES,
  type ViewMode,
  type CategoryName,
} from "../store";

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "solo", label: "Solo" },
];

interface Props {
  onApplyView: () => void;
  onFile: (file: File) => void;
  onZoomExtents: () => void;
}

/** Left control rail: file, view mode, storey isolation, filters. */
export function Sidebar({ onApplyView, onFile, onZoomExtents }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    status,
    fileName,
    stories,
    viewMode,
    soloStory,
    categoryVisible,
    set,
  } = useStore();

  const ready = status === "ready";

  // Mutate store then reconcile the scene.
  const update = (partial: Parameters<typeof set>[0]) => {
    set(partial);
    queueMicrotask(onApplyView);
  };

  const setMode = (mode: ViewMode) => {
    // Default the solo target to the first storey if none chosen yet.
    const solo =
      mode === "solo" && !soloStory ? (stories[0]?.name ?? null) : soloStory;
    update({ viewMode: mode, soloStory: solo });
  };

  const toggleCategory = (cat: CategoryName) =>
    update({
      categoryVisible: { ...categoryVisible, [cat]: !categoryVisible[cat] },
    });

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-4">
      <div>
        <h1 className="text-sm font-semibold text-neutral-100">
          Mori Panelizer
        </h1>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {fileName ?? "No file loaded"}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
      >
        {ready ? "Load another IFC" : "Open IFC"}
      </button>

      {ready && (
        <>
          <Section title="View">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-neutral-900 p-1">
              {VIEW_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`rounded px-2 py-1 text-xs font-medium transition ${
                    viewMode === m.id
                      ? "bg-sky-500 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Section>

          <button
            onClick={onZoomExtents}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
          >
            Zoom to fit
          </button>

          {viewMode === "solo" && (
            <Section title="Storey">
              <div className="flex flex-col gap-1">
                {stories.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => update({ soloStory: s.name })}
                    className={`truncate rounded px-2 py-1.5 text-left text-xs transition ${
                      soloStory === s.name
                        ? "bg-neutral-800 text-neutral-100"
                        : "text-neutral-400 hover:bg-neutral-900"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Filters">
            <div className="flex flex-col gap-1.5">
              {FILTERABLE_CATEGORIES.map((cat) => (
                <label
                  key={cat}
                  className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300"
                >
                  <input
                    type="checkbox"
                    checked={categoryVisible[cat]}
                    onChange={() => toggleCategory(cat)}
                    className="accent-sky-500"
                  />
                  {cat}
                </label>
              ))}
            </div>
          </Section>

          <p className="mt-auto text-xs text-neutral-600">
            {stories.length} storey{stories.length === 1 ? "" : "s"}
          </p>
        </>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {children}
    </div>
  );
}
