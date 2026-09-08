import { defineConfig } from "vitest/config";

const TEST_FILES = ["*.test.ts", "*.test.tsx"];

const globs = (...directories: string[]): string[] =>
  directories.flatMap((directory) =>
    TEST_FILES.map((file) => `${directory}/**/${file}`),
  );

/**
 * Environments are chosen by path, not per test file: `tests/unit/ui/**` and
 * `tests/unit/bootstrap/**` need a DOM (and computed styles, hence `css`),
 * everything else runs on node. Consuming sessions rely on this mapping.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: globs("tests/unit", "tests/property"),
          exclude: globs("tests/unit/ui", "tests/unit/bootstrap"),
        },
      },
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          css: true,
          include: [
            ...globs("tests/unit/ui", "tests/unit/bootstrap"),
            // S01's own smoke test also runs here: it is the only in-lease
            // file that can prove this project resolves.
            "tests/unit/toolchain.smoke.test.ts",
          ],
        },
      },
    ],
  },
});
