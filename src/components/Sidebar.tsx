import { useRef, useState, type ReactNode } from "react";
import { useStore, type CameraProjection } from "../store";

const PROJECTIONS: { id: CameraProjection; label: string }[] = [
  { id: "ortho", label: "Ortho" },
  { id: "perspective", label: "Perspective" },
];

interface Props {
  onApplyView: () => void;
  onFile: (file: File) => void;
  onExtractSurfaces: () => void;
  onToggleOverlay: (show: boolean) => void;
  onSetProjection: (projection: CameraProjection) => void;
  onSelectSurface: (id: string) => void;
  onSelectStorey: (name: string) => void;
  onShowAll: () => void;
}

/** Left control rail: file, projection, storey/surface navigation, filters. */
export function Sidebar({
  onApplyView,
  onFile,
  onExtractSurfaces,
  onToggleOverlay,
  onSetProjection,
  onSelectSurface,
  onSelectStorey,
  onShowAll,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const {
    status,
    fileName,
    stories,
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

  // Clicking a level isolates it and expands its surfaces.
  const selectStorey = (name: string) => {
    setExpanded(name);
    onSelectStorey(name);
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
          <Section title="Camera">
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
            onClick={onShowAll}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
          >
            Show all
          </button>

          <Section title="Filters" action={
            anyFiltered && (
              <button
                onClick={showAllCategories}
                className="text-[0.65rem] font-medium uppercase tracking-wider text-sky-400 hover:text-sky-300"
              >
                clear
              </button>
            )
          }>
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
              </>
            )}
            {panelizeStatus === "error" && (
              <p className="text-xs text-red-400">Extraction failed — see console</p>
            )}
          </Section>

          <Section title="Storeys">
            <div className="flex flex-col gap-1">
              {stories.map((st) => {
                const surfaces = surfaceList.filter((s) => s.storey === st.name);
                const isOpen = expanded === st.name;
                const active = soloStory === st.name && !selectedSurfaceId;
                return (
                  <div key={st.name} className="flex flex-col">
                    <button
                      onClick={() => selectStorey(st.name)}
                      className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-xs transition ${
                        active
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-300 hover:bg-neutral-900"
                      }`}
                    >
                      <span>{st.name}</span>
                      <span className="text-neutral-600">
                        {isOpen ? "▾" : "▸"} {surfaces.length}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="ml-2 flex flex-col gap-0.5 border-l border-neutral-800 pl-2">
                        {surfaces.length === 0 && (
                          <p className="px-2 py-1 text-xs text-neutral-600">
                            No surfaces — extract first
                          </p>
                        )}
                        {surfaces.map((s) => (
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
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
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
