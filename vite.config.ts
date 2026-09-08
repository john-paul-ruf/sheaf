import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Identity of the artifact this build produces. Tests read it back from the
 * served page (`window.__sheafBuildId`) to prove `dist/` is not stale.
 */
const buildId =
  process.env["SHEAF_BUILD_ID"] ??
  execSync("git rev-parse HEAD").toString().trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __SHEAF_BUILD_ID__: JSON.stringify(buildId),
  },
  worker: {
    format: "es",
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    // Supported Runtime Baseline: Safari 17+, Chromium 120+, Firefox 122+.
    target: ["safari17", "chrome120", "firefox122"],
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        harness: fileURLToPath(new URL("./harness.html", import.meta.url)),
      },
    },
  },
});
