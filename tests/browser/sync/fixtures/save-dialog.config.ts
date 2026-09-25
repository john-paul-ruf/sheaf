import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../../../../dist/f05-dialog", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("save-dialog.html", import.meta.url)) },
  },
});
