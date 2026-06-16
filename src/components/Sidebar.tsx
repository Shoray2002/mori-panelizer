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
  onSetProjection: (projection: CameraProjection) => void;
  onSelectSurface: (id: string) => void;
  onSelectStorey: (name: string) => void;
  onShowAll: () => void;
}

/** Surface-type groups: horizontal (slab/roof, blue) vs vertical (wall, green). */
const SURFACE_TYPES = [
  { key: "showHorizontal", label: "Horizontal", dot: "bg-blue-500", member: (k: string) => k !== "wall" },
  { key: "showVertical", label: "Vertical", dot: "bg-green-500", member: (k: string) => k === "wall" },
] as const;

/** Left control rail: file, projection, storey/surface navigation, filters. */
export function Sidebar({
  onApplyView,
  onFile,
  onExtractSurfaces,
  onSetProjection,
  onSelectSurface,
  onSelectStorey,
  onShowAll,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
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
    showHorizontal,
    showVertical,
    selectedSurfaceId,
    set,
  } = useStore();
  const typeOn = { showHorizontal, showVertical };

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

  const hideAllCategories = () =>
    update({
      categoryVisible: Object.fromEntries(categories.map((c) => [c, false])),
    });

  const setProjection = (projection: CameraProjection) => {
    set({ cameraProjection: projection });
    onSetProjection(projection);
  };

  const toggleType = (key: "showHorizontal" | "showVertical") =>
    update({ [key]: !typeOn[key] });

  const toggleTypeOpen = (key: string) =>
    setOpenTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  // Clicking a level isolates it and expands its surfaces.
  const selectStorey = (name: string) => {
    setExpanded(name);
    onSelectStorey(name);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-200 bg-neutral-100 p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Mori Panelizer
          </h1>
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="rounded p-1 text-sm text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
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
        className="rounded-md bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        {ready ? "Load another IFC" : "Open IFC"}
      </button>

      {ready && (
        <>
          <Section title="Camera">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-neutral-200 p-1 dark:bg-neutral-900">
              {PROJECTIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProjection(p.id)}
                  className={`rounded px-2 py-1 text-xs font-medium transition ${
                    cameraProjection === p.id
                      ? "bg-sky-500 text-white"
                      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Section>

          <button
            onClick={onShowAll}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Show all
          </button>

          <Section
            title="Filters"
            action={
              anyFiltered ? (
                <button
                  onClick={showAllCategories}
                  className="text-[0.65rem] font-medium uppercase tracking-wider text-sky-500 hover:text-sky-400"
                >
                  Show all
                </button>
              ) : (
                <button
                  onClick={hideAllCategories}
                  className="text-[0.65rem] font-medium uppercase tracking-wider text-sky-500 hover:text-sky-400"
                >
                  Hide all
                </button>
              )
            }
          >
            <div className="flex flex-col gap-1.5">
              {categories.map((cat) => (
                <label
                  key={cat}
                  className="flex cursor-pointer items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300"
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
                : "Extract surfaces"}
            </button>
            {panelizeStatus === "ready" && (
              <>
                <p className="text-xs text-neutral-500">
                  {surfaceList.length} surface
                  {surfaceList.length === 1 ? "" : "s"} found
                </p>
                <div className="flex flex-col gap-1.5">
                  {SURFACE_TYPES.map((t) => (
                    <label
                      key={t.key}
                      className="flex cursor-pointer items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300"
                    >
                      <input
                        type="checkbox"
                        checked={typeOn[t.key]}
                        onChange={() => toggleType(t.key)}
                        className="accent-sky-500"
                      />
                      <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </>
            )}
            {panelizeStatus === "error" && (
              <p className="text-xs text-red-500 dark:text-red-400">
                Extraction failed — see console
              </p>
            )}
          </Section>

          <Section title="Storeys">
            <div className="flex flex-col gap-1">
              {stories.map((st) => {
                const surfaces = surfaceList.filter(
                  (s) => s.storey === st.name,
                );
                const isOpen = expanded === st.name;
                const active = soloStory === st.name && !selectedSurfaceId;
                return (
                  <div key={st.name} className="flex flex-col">
                    <button
                      onClick={() => selectStorey(st.name)}
                      className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-xs transition ${
                        active
                          ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                          : "text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-900"
                      }`}
                    >
                      <span>{st.name}</span>
                      <span className="text-neutral-400 dark:text-neutral-600">
                        {isOpen ? "▾" : "▸"} {surfaces.length}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="ml-2 flex flex-col gap-1 border-l border-neutral-200 pl-2 dark:border-neutral-800">
                        {surfaces.length === 0 && (
                          <p className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-600">
                            No surfaces — extract first
                          </p>
                        )}
                        {surfaces.length > 0 &&
                          SURFACE_TYPES.map((t) => {
                            const typeSurfaces = surfaces.filter((s) =>
                              t.member(s.klass),
                            );
                            const on = typeOn[t.key];
                            const tkey = `${st.name}|${t.key}`;
                            const tOpen = openTypes.has(tkey) && on;
                            return (
                              <div
                                key={t.key}
                                className={on ? "" : "opacity-40"}
                              >
                                <button
                                  disabled={!on}
                                  onClick={() => toggleTypeOpen(tkey)}
                                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-900"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span
                                      className={`h-2 w-2 rounded-full ${t.dot}`}
                                    />
                                    {t.label}
                                  </span>
                                  <span className="text-neutral-400 dark:text-neutral-600">
                                    {tOpen ? "▾" : "▸"} {typeSurfaces.length}
                                  </span>
                                </button>
                                {tOpen && (
                                  <div className="ml-2 flex flex-col gap-0.5">
                                    {typeSurfaces.length === 0 && (
                                      <p className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-600">
                                        None
                                      </p>
                                    )}
                                    {typeSurfaces.map((s) => (
                                      <button
                                        key={s.id}
                                        onClick={() => onSelectSurface(s.id)}
                                        className={`flex justify-between rounded px-2 py-1 text-left text-xs transition ${
                                          selectedSurfaceId === s.id
                                            ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                            : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-900"
                                        }`}
                                      >
                                        <span>{s.id}</span>
                                        <span className="text-neutral-400 dark:text-neutral-600">
                                          {s.klass}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
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
