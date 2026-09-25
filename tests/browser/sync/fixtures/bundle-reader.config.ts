import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL(".", import.meta.url)),
  worker: { format: "es" },
  build: { outDir: fileURLToPath(new URL("../../../../dist/f05-reader", import.meta.url)), emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("bundle-reader.html", import.meta.url)) } },
});
