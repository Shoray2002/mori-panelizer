import { useRef, useState, type DragEvent } from "react";
import { useStore } from "../store";

/** Full-viewport overlay shown until a model is ready: drag-drop or pick an IFC. */
export function UploadDropzone({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { status, progress, error, fileName } = useStore();

  const pick = (file?: File | null) => {
    if (file) onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-neutral-50/80 backdrop-blur-sm dark:bg-neutral-950/80">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex w-[26rem] cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-10 py-14 text-center transition ${
          dragging
            ? "border-sky-400 bg-sky-400/10"
            : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".ifc"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {status === "loading" ? (
          <>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Parsing {fileName}…</p>
            <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-300 dark:bg-neutral-800">
              <div
                className="h-full bg-sky-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-neutral-500">{progress}%</p>
          </>
        ) : (
          <>
            <p className="text-base font-medium text-neutral-800 dark:text-neutral-200">
              Drop an IFC file
            </p>
            <p className="text-xs text-neutral-500">or click to browse</p>
            {status === "error" && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
