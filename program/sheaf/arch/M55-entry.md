# M55 — Entry (`src/main.tsx`)

Extracted from specs/architecture.md §Module Structure (Entry). F01 scope.
Reconciled against the tree at `2c0248a`.

- **Owns:** Minimal browser entry: apply shell theme, `startApp()`, mount the
  router under the React root, fatal bootstrap handling (render the SCR-001
  recoverable state on unsupported capability).
- **Depends on:** M40, M53, M54.
- **Must not:** hold logic beyond composition; import workers/persistence/
  crypto directly; load any external resource; import anything from
  `src/harness/**`.

## Landed composition

`import "./ui/theme/base.css"` (the shell's single stylesheet, imported exactly
once in the program), `applyShellTheme(document.documentElement)` with no
variables, then `<SheafApp/>` under the React root.

**Served-artifact identity (D15) is published here and must be preserved by any
future rewrite:** `window.__sheafBuildId = __SHEAF_BUILD_ID__` and
`document.documentElement.dataset.sheafBuildId`. `__SHEAF_BUILD_ID__` is
defined in `vite.config.ts` as `process.env.SHEAF_BUILD_ID ?? git rev-parse
HEAD`, and is asserted equal to `git rev-parse HEAD` from the Node test
process. The `Window` augmentation lives in `src/vite-env.d.ts` because both
the product entry and the harness need it.

## The test-harness entry (no module ID, D11)

`harness.html` + `src/harness/` is a **non-product** second Vite rollup input,
owned by the toolchain session, never imported by `src/main.tsx` — proved by
`tests/browser/harness.smoke.spec.ts`, which also asserts the production page
exposes no harness.

Public surface (`src/harness/main.ts`, exported type `SheafHarness`):

```
window.__sheafHarness = {
  buildId, listModules(), listWorkers(), module<T>(specifier), worker(specifier)
}
```

Specifiers are root-absolute source paths (e.g. `/src/workers/data.worker.ts`).
Resolution is `import.meta.glob` over `/src/**/*.ts(x)` (excluding `*.d.ts`,
`*.worker.ts`, `src/harness/**`, `src/main.tsx`) plus `/src/**/*.worker.ts`
with `?worker` — so **new `src/**` files are reachable without editing any
build-input file**. An unknown specifier throws an error naming the specifier
and listing what is available.

It exists because `dist/` is built from `index.html` → `src/main.tsx`, which
was a static placeholder until SESSION-07; the browser proofs at S04 CP3 and
S05 CP2 would otherwise have had no reachable entry for `envelope-store`,
`bootstrap` or `data.worker.ts` in built output (replan finding F-01).

**Must not:** hold product behavior; be imported by the production entry graph;
be precached by the F08 service worker. `harness.html`, `dist/assets/harness-*.js`
and `dist/assets/probe.worker-*.js` (~534 kB, libsodium sumo) are test
artifacts — **recorded F08 debt**. E2E suites do **not** use the harness; they
run through the real `index.html` entry.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — SESSION-01 (`7767341`) landed the placeholder entry (React 19
  root rendering a static "Sheaf" element, no composition) plus the identity
  hook and the harness entry above.
- 2026-09-08 — SESSION-07 (`9174b6d`) replaced the placeholder with real
  composition and preserved SESSION-01's identity publication verbatim. The two
  sessions serialize on this file by dependency order; it is an owner-seam
  path, never concurrently leased.
- 2026-09-08 — demo revision `2c0248a` (after OWNER-M39-RAIL-LABEL);
  `src/main.tsx` itself is unchanged between `9174b6d` and `2c0248a`.
- 2026-09-08 — reconciled by Roshi (final pass): the SESSION-01 placeholder,
  harness and SESSION-07 entry notes merged into one description.
