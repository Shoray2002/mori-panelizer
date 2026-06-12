import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // web-ifc ships a wasm file; keep it out of dep optimization so the loader can fetch it
  optimizeDeps: {
    exclude: ["web-ifc"],
  },
});
