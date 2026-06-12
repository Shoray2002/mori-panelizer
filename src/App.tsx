import { useEffect, useRef } from "react";
import { ViewerManager } from "./viewer/ViewerManager";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { UploadDropzone } from "./components/UploadDropzone";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<ViewerManager | null>(null);
  const status = useStore((s) => s.status);

  useEffect(() => {
    if (!containerRef.current || managerRef.current) return;
    const manager = new ViewerManager();
    managerRef.current = manager;
    void manager.init(containerRef.current);
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  const handleFile = (file: File) => managerRef.current?.loadIfc(file);
  const applyView = () => managerRef.current?.applyView();
  const zoomExtents = () => managerRef.current?.zoomExtents();

  return (
    <div className="flex h-full w-full">
      <Sidebar onApplyView={applyView} onFile={handleFile} onZoomExtents={zoomExtents} />
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {status !== "ready" && <UploadDropzone onFile={handleFile} />}
      </div>
    </div>
  );
}
