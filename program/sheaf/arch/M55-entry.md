# M55 — Entry (`src/main.tsx`)

Extracted from specs/architecture.md §Module Structure (Entry). F01 scope.

- **Owns:** Minimal browser entry: apply shell theme, `startApp()`, mount
  router under the React root, fatal bootstrap handling (render the SCR-001
  recoverable state on unsupported capability).
- **Depends on:** M40, M53, M54.
- **Must not:** hold logic beyond composition; import workers/persistence/
  crypto directly; load any external resource.
- **History note:** created as a static placeholder in SESSION-01 (checkpoint
  toolchain proof), replaced with real composition in SESSION-07 — the two
  sessions serialize on this file by dependency order.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Placeholder: SESSION-01; real entry: SESSION-07.

<!-- foundation-first-unlock SESSION-01 -->
- 2026-09-08 — SESSION-01 landed the placeholder (checkpoint 1, final revision
  `7767341`): React 19 root rendering a static "Sheaf" element, no composition.
  It also publishes served-artifact identity that SESSION-07 **must preserve**
  when rewriting `src/main.tsx`: `window.__sheafBuildId = __SHEAF_BUILD_ID__`
  and `document.documentElement.dataset.sheafBuildId`.
- 2026-09-08 — SESSION-01 added a non-product **test-harness entry**
  (`harness.html` + `src/harness/`, no module ID; D11): second Vite rollup
  input, never imported by `src/main.tsx` (proved by
  `tests/browser/harness.smoke.spec.ts`). Public surface
  (`src/harness/main.ts`, exported type `SheafHarness`):
  `window.__sheafHarness = { buildId, listModules(), listWorkers(),
  module<T>(specifier), worker(specifier) }`; specifiers are root-absolute
  source paths (e.g. `/src/workers/data.worker.ts`); resolution via
  `import.meta.glob` over `/src/**/*.ts(x)` (excl. `*.d.ts`, `*.worker.ts`,
  `src/harness/**`, `src/main.tsx`) plus `/src/**/*.worker.ts` with `?worker`
  — new `src/**` files are reachable without editing any S01-owned file.
  Must not: hold product behavior; be imported by the production entry graph;
  be precached by the F08 service worker (`harness.html` + chunks incl. the
  ~534 kB libsodium probe-worker chunk are test artifacts — recorded F08 debt).

<!-- foundation-first-unlock SESSION-07 -->
- 2026-09-08 — SESSION-07 landed (final revision `9174b6d`). Delta:

**M55 — Entry (`src/main.tsx`)**
- Replaced SESSION-01's placeholder with composition only: `import
  "./ui/theme/base.css"` (the shell's single stylesheet, imported exactly once
  in the program), `applyShellTheme(document.documentElement)` with no
  variables, then `<SheafApp/>` under the React root.
- SESSION-01's served-artifact identity is **preserved verbatim**:
  `window.__sheafBuildId = __SHEAF_BUILD_ID__` and
  `document.documentElement.dataset.sheafBuildId` (D15).
- Still imports nothing from `src/harness/**`.
