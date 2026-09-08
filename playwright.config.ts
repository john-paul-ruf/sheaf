import { defineConfig, devices } from "@playwright/test";

/** Jikijitsu assigns one port per slot; every consumer session passes it here. */
const PORT = Number(process.env["SHEAF_PW_PORT"] ?? 8080);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Suites run against built output. `vite preview` never rebuilds, so the
 * command builds first, and a preview left behind by another slot must not
 * answer (`reuseExistingServer: false`).
 */
export default defineConfig({
  testDir: "tests",
  // Files run in parallel; tests inside a file share one worker, so per-file
  // `beforeAll` setup (building test fixtures into `dist/`) cannot race itself.
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "browser",
      testMatch: "browser/**/*.spec.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "e2e",
      testMatch: "e2e/**/*.spec.ts",
      use: devices["Desktop Chrome"],
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
