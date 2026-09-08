/**
 * Browser-test harness entry. Test-toolchain only: it is never imported by
 * `src/main.tsx`, ships no product behavior, and exists so browser suites can
 * reach modules and workers that the production entry graph does not import
 * yet. Modules and workers are resolved through globs, so adding files under
 * `src/` never requires editing this file.
 */
const MODULES = import.meta.glob<unknown>([
  "/src/**/*.ts",
  "/src/**/*.tsx",
  "!/src/**/*.d.ts",
  "!/src/**/*.worker.ts",
  "!/src/harness/**",
  "!/src/main.tsx",
]);

const WORKERS = import.meta.glob<new () => Worker>("/src/**/*.worker.ts", {
  query: "?worker",
  import: "default",
  eager: true,
});

export interface SheafHarness {
  readonly buildId: string;
  listModules(): readonly string[];
  listWorkers(): readonly string[];
  module<T = unknown>(specifier: string): Promise<T>;
  worker(specifier: string): Worker;
}

declare global {
  interface Window {
    __sheafHarness: SheafHarness;
  }
}

const listModules = (): readonly string[] => Object.keys(MODULES).sort();
const listWorkers = (): readonly string[] => Object.keys(WORKERS).sort();

const unknownSpecifier = (
  kind: string,
  specifier: string,
  available: readonly string[],
): Error =>
  new Error(
    `Sheaf harness: unknown ${kind} "${specifier}". Available: ${available.join(", ")}`,
  );

const harness: SheafHarness = {
  buildId: __SHEAF_BUILD_ID__,
  listModules,
  listWorkers,
  async module<T = unknown>(specifier: string): Promise<T> {
    const load = MODULES[specifier];
    if (load === undefined) {
      throw unknownSpecifier("module", specifier, listModules());
    }
    return (await load()) as T;
  },
  worker(specifier: string): Worker {
    const WorkerConstructor = WORKERS[specifier];
    if (WorkerConstructor === undefined) {
      throw unknownSpecifier("worker", specifier, listWorkers());
    }
    return new WorkerConstructor();
  },
};

window.__sheafHarness = harness;
window.__sheafBuildId = __SHEAF_BUILD_ID__;
document.documentElement.dataset["sheafBuildId"] = __SHEAF_BUILD_ID__;
