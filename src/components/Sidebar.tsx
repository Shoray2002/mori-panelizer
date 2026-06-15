import { useRef, type ReactNode } from "react";
import { useStore, type CameraProjection, type ViewMode } from "../store";

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "solo", label: "Solo" },
];

const PROJECTIONS: { id: CameraProjection; label: string }[] = [
  { id: "ortho", label: "Ortho" },
  { id: "perspective", label: "Perspective" },
];

interface Props {
  onApplyView: () => void;
  onFile: (file: File) => void;
  onZoomExtents: () => void;
  onExtractSurfaces: () => void;
  onToggleOverlay: (show: boolean) => void;
  onSetProjection: (projection: CameraProjection) => void;
  onSelectSurface: (id: string) => void;
}

/** Left control rail: file, view mode, storey isolation, filters. */
export function Sidebar({
  onApplyView,
  onFile,
  onZoomExtents,
  onExtractSurfaces,
  onToggleOverlay,
  onSetProjection,
  onSelectSurface,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    status,
    fileName,
    stories,
    viewMode,
    soloStory,
    categories,
    categoryVisible,
    cameraProjection,
    panelizeStatus,
    surfaceList,
    showSurfaceOverlay,
    selectedSurfaceId,
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

  const toggleCategory = (cat: string) =>
    update({
      categoryVisible: { ...categoryVisible, [cat]: !categoryVisible[cat] },
    });

  const anyFiltered = categories.some((c) => !categoryVisible[c]);
  const showAllCategories = () =>
    update({
      categoryVisible: Object.fromEntries(categories.map((c) => [c, true])),
    });

  const setProjection = (projection: CameraProjection) => {
    set({ cameraProjection: projection });
    onSetProjection(projection);
  };

  const toggleOverlay = () => {
    const next = !showSurfaceOverlay;
    set({ showSurfaceOverlay: next });
    onToggleOverlay(next);
  };

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
            <div className="grid grid-cols-2 gap-1 rounded-md bg-neutral-900 p-1">
              {PROJECTIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProjection(p.id)}
                  className={`rounded px-2 py-1 text-xs font-medium transition ${
                    cameraProjection === p.id
                      ? "bg-sky-500 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {p.label}
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

          <Section
            title="Filters"
            action={
              anyFiltered && (
                <button
                  onClick={showAllCategories}
                  className="text-[0.65rem] font-medium uppercase tracking-wider text-sky-400 hover:text-sky-300"
                >
                  clear
                </button>
              )
            }
          >
            <div className="flex flex-col gap-1.5">
              {categories.map((cat) => (
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

          <Section title="Panelize">
            <button
              onClick={onExtractSurfaces}
              disabled={panelizeStatus === "working"}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {panelizeStatus === "working"
                ? "Extracting…"
                : "Extract slab surfaces"}
            </button>
            {panelizeStatus === "ready" && (
              <>
                <p className="text-xs text-neutral-500">
                  {surfaceList.length} surface{surfaceList.length === 1 ? "" : "s"} found
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={showSurfaceOverlay}
                    onChange={toggleOverlay}
                    className="accent-sky-500"
                  />
                  Show overlay
                </label>
                <div className="flex flex-col gap-1">
                  {surfaceList.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onSelectSurface(s.id)}
                      className={`flex justify-between rounded px-2 py-1 text-left text-xs transition ${
                        selectedSurfaceId === s.id
                          ? "bg-amber-500/20 text-amber-300"
                          : "text-neutral-400 hover:bg-neutral-900"
                      }`}
                    >
                      <span>{s.id}</span>
                      <span className="text-neutral-600">{s.klass}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {panelizeStatus === "error" && (
              <p className="text-xs text-red-400">Extraction failed — see console</p>
            )}
          </Section>

          <p className="mt-auto text-xs text-neutral-600">
            {stories.length} storey{stories.length === 1 ? "" : "s"}
          </p>
        </>
      )}
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}
