# FORGE-CONFIG — Sheaf

> **Created:** 2026-09-08 by Forge (first run, Genesis handoff)
> **Authority:** This file is authoritative for stack, registry, conventions,
> and verification defaults. `specs/architecture.md` is the approved source it
> was parsed from; on conflict, the spec wins and this file must be corrected.

## Program

| Field | Value |
|---|---|
| P_NAME | Sheaf |
| P_SLUG | sheaf |
| Root | /program/sheaf/ |
| Product shape | Static, installable, local-first PWA. All logic in-browser. No backend, no Sheaf API, no telemetry. |
| Repo state at config creation | Pre-scaffold. Only `src/migrations/` (DB-phase output) exists. No package.json, no build toolchain. |

## Stack

Parsed from `specs/architecture.md` § Stack Decision (approved 2026-09-08). Do not re-derive.

| Field | Value |
|---|---|
| Language | TypeScript 6.0, strict, ESM only |
| Runtime | Browser (secure context). Node.js 24 LTS for build/test tooling only |
| UI framework | React 19.2 (client-only; no RSC) |
| Routing | React Router 8, declarative hash-history mode |
| Accessible primitives | React Aria Components 1.x, selectively wrapped |
| Styling | Vanilla CSS + CSS Modules + cascade layers + custom properties. No Tailwind, no CSS-in-JS runtime |
| Workflow state | XState 5 for long-running flows; React state for ephemeral view state |
| Local DB | IndexedDB via Dexie 4 — encrypted opaque envelopes only |
| Query projection | Official SQLite 3 WASM, in-memory only, dedicated worker, FTS5 enabled |
| Crypto | libsodium.js/WASM: Argon2id, XChaCha20-Poly1305, HKDF/HMAC, CSPRNG |
| Binary encoding | Canonical CBOR, explicit codec version; compress before encrypt |
| Containers | zip.js (OPC/ODS); custom bounded CFB reader (legacy XLS) — **F03 planning note:** the container reader is a native fallback (`src/import/source/{zip,xml,cfb,opc}.ts`), not `@zip.js/zip.js`; see the F03 landed-modules note below (D30) |
| Import parsers | Sheaf-owned format adapters (OOXML, XLSB, BIFF, ODS, delimited, html-table). SheetJS is export-only, never import |
| Formula engine | Sheaf-owned parser/IR/graph/evaluator. No eval, no dynamic Function |
| Charts | Chart.js 4.x + Sheaf-owned accessible text/table alternative |
| Export | SheetJS CE (export-only), pdf-lib, Canvas/Blob |
| PWA | Web App Manifest + Workbox InjectManifest |
| Package manager | pnpm, frozen lockfile, exact-pinned direct deps |
| Build | Vite 8.2, static output only. WASM/fonts/assets vendored — no runtime CDN |
| Unit/property tests | Vitest 5 + fast-check |
| Browser/E2E tests | Playwright + axe-core + real-device smoke |
| Deployment | Static-only Cloudflare Pages reference deploy; portable static artifact |

## Architecture

| Field | Value |
|---|---|
| Pattern | Ports & adapters over a pure domain; event-sourced encrypted local store; ephemeral relational projection; four representations kept separate (encrypted envelopes → domain events/baselines → in-memory SQLite → view models) |
| Dependency flow | entry → presentation → application → domain; infra → ports + domain; workers → application + infra. Domain imports nothing outward. Presentation never imports infra. Provider types stop inside their adapter |
| DI | Constructor/composition in `src/bootstrap/` and per-worker composition roots. Interfaces live in `src/application/ports/` |
| State management | Local encrypted event store is the source of truth. XState machines for lifecycle flows. No global client-state store |
| Entry points | `src/main.tsx` (page), `src/workers/data.worker.ts`, `src/workers/import.worker.ts`, `src/workers/io.worker.ts`, `src/workers/export.worker.ts`, service worker in `src/pwa/` |
| Invariants | The 12 architectural invariants in `specs/architecture.md` § Architectural Invariants are binding on every session. Highest-frequency ones: local commit precedes acknowledgement; plaintext lives only in unlocked workers + minimal view models; one validator owns every acceptance path; one reconciler owns every divergence path; no imported behavior executes; no egress by default |
| Providers | Dropbox (primary), OneDrive (secondary), encrypted bundle (manual). Google Drive is **dropped** — the mock's conditional Drive card is never enabled |

## Module Registry

IDs are stable and never reused. Ordered by dependency depth, leaves first.
The **Path** column is the leasing unit — session `Owns` globs are derived from
it. Per-module public API, contracts, and must-nots live in
`specs/architecture.md` § Module Contracts (authoritative detail source) as
supplemented and superseded, per landed module, by that module's
`arch/M##-*.md` fragment.

**Arch fragment policy (lazy seeding):** `/program/sheaf/arch/M##-<module>.md`
fragments are seeded by Forge at feature-planning time, for exactly the modules
that feature's sessions touch — mechanically extracted from § Module Contracts
(exports, dependency edges, must-nots) plus an empty Change History section.
Session Module Context tables and Jikijitsu's Orchestration Envelope reference
the fragment, not the 87KB spec. Jikijitsu owns and maintains fragments during
runs (never in any Mu `Owns`); untouched modules get fragments when first
touched. A full 64-fragment build-out before code exists is deliberately
avoided: it would duplicate the spec and immediately drift.

**Arch fragment reconciliation (added after F01):** Jikijitsu's mid-run appends
are deltas, stapled under a `<!-- {F_NAME} SESSION-NN -->` marker while sessions
are in flight — correct for a running wave. At the end of a feature, Roshi
merges each fragment's deltas into its head contract and removes the markers, so
the fragment reads as one description of the module as it now stands. **The head
contract is the authoritative statement; a delta that supersedes it is folded
in, not left below it.** F01 produced four fragments whose head contract had
been silently superseded by a delta (M32, M38, M51) or left carrying a defect
already fixed (M42) — see `ROSHI-LOG.md` 2026-09-08. F03's final pass repeated
this reconciliation over thirty-one touched fragments (the seven new-module
fragments seeded at F03 planning, plus twenty-four extended F01/F02
fragments), closing three fragments that still recorded an F02 gap their own
F03 sessions had already resolved (M12's unconstructible import-lineage
input, M37's live-region pluralization and stale `promotionIssues` mapping,
M44's missing deleted-record read and single-table change history) — see
`ROSHI-LOG.md` 2026-09-23.

**A delta that describes a *different* module belongs in that module's
fragment** (added after F02). A session writes its delta into the fragment it
was reading, so test-module and neighbouring-module facts arrive stapled inside
someone else's contract. At reconciliation Roshi moves them, seeding the missing
fragment if there is none — F02 needed three moves (M58's fixture-byte contract
out of M19, M61's e2e contract out of M51, and M54's CA-07 amendment 2 out of
M44). A fragment may therefore be created by the final pass, not only by Forge
at planning time. F03 needed no such move: every session's delta landed in the
fragment its own module owns.

### F01 landed modules (git-verified at `2c0248a`)

Nineteen modules exist in code: M01 (subset), M07 (subset: ClockPort +
EntropyPort), M08, M09, M11, M32, M33 (`data.worker` only), M36, M37, M38, M39,
M40, M41, M42 (SCR-011 only), M50, M51, M53, M54, M55. Everything else in the
registry below is still planned. `src/migrations/` (M10) pre-exists and is
DB-phase-owned.

### F02 landed modules (git-verified at `5ab3b07`)

Thirty-one product modules now exist in code (plus DB-phase-owned M10). F02
added twelve and extended thirteen:

| | modules |
|---|---|
| **New in F02** | M02, M12, M13, M14, M19, M21, M22, M23, M34, M35, M43, M44 |
| **Extended in F02** | M01 (ids/values/schema/provenance/events), M07 (five ports), M08 (`hash.ts`), M09 (`event-commit.ts`), M11 (`deleteStorageIds` only), M32 (import + app protocol, channel), M33 (`import.worker` + `data/` growth), M36 (import machine + services), M37 (import/records VM families), M42 (SCR-010/012 + the D5 flip), M51 (`file-pick.ts`), M53 (`import-worker.ts`), M54 (both CA-07 amendments) |
| **Unchanged in F02** | M38, M39, M40, M41, M50, M55 (`src/main.tsx` byte-identical; only the sqlite-wasm pin moved in the root manifests) |
| **Still planned (at F02 close)** | M03–M06, M15–M18, M20, M24–M31, M45–M49, M52 |

Test modules: M56, M57, M58, M60, M61 all grew; M59, M62, M63, M64 are still
planned. Arch fragments now exist for M58 and M61 (created by Roshi at the F02
final pass, see the fragment-reconciliation note above).

### F04 planning note (2026-09-23)

F04 `formulas-queries-charts` adds two UI modules, **M45** (`src/ui/charts/`) and **M46** (`src/ui/schema/`). Their fragments were seeded at planning. F04 also adds **Chart.js** as the only new runtime dependency (the approved stack; pinned in S05). The `schema_fields` currency-code round-trip carried from F02 was **disproved as a schema defect**: the code lives in the encrypted field definition, and the projection caches definitions per session. No DB re-entry was needed.

### F03 landed modules (git-verified at `425562d`, code ≡ `30396a9`)

Thirty-eight product modules now exist in code (plus DB-phase-owned M10). F03
added seven — all in the import subtree — and extended twenty-four:

| | modules |
|---|---|
| **New in F03** | M03 (formulas — parser/reference-extraction subset only, D34), M15 (OOXML), M16 (XLSB), M17 (BIFF), M18 (ODS), M20 (HTML-table), M65 (workbook facts, new ID) |
| **Extended in F03** | M01 (relationship/sheet/inert/decision ids+types, `snapshots.ts`), M02 (relationship schema checks, D36 reference severity), M07 (`projection.ts` restated over the F03 query surface), M12 (checkpoint evolution D37, relationship/snapshot/inert/decision queries, the append-table tail handler), M13 (native container readers — `bounds`/`zip`/`xml`/`cfb`/`opc`, the D30 fallback), M14 (`preflightWorkbook`, D31 budgets), M19 (V2 emission; `facts.ts` migrated away, D32), M21 (the full workbook inference tier — `inferWorkbook` and six sibling files), M22 (per-sheet snapshot format v2 + writer), M23 (workbook staging, promotion, append — D38), M32 (import protocol v2, additive app RPCs, `reference` becomes authorable), M33 (the workbook import worker, `import/adapters.ts`, nine relationship/snapshot RPCs), M34 (real reference resolver), M35 (`relationships.ts`, `snapshots.ts`), M36 (the import machine rewritten two-branch for workbooks; `RecordsServices`' nine reads), M37 (`import.ts` rewritten multi-table; relationships + snapshots VMs added to `records.ts` — no `view-models/snapshots.ts` was created, see below), M38 (`checkbox.tsx`, `TextField.inputId`), M43 (`workbook-preflight-screen.tsx`, the multi-table review screen), M44 (reference picker, table switcher, snapshot screens), M51 (`clipboard.ts`), M53 (confirmed unchanged — `import-worker.ts` needed no edit), M54 (CA-07 amendment 3 — the snapshot routes), M58 (the workbook fixture corpus), M61 (four new e2e specs, 57 total) |
| **Unchanged in F03** | M08, M09, M11, M39, M40, M41, M42, M50, M55 |
| **Still planned (at F03 close)** | M04, M05, M06, M24–M31, M45–M49, M52 |

Test modules: M56, M57, M58, M60, M61 all grew again; M59, M62, M63, M64
remain planned.

**Planning note superseded by landed fact (D30).** F03 planning recorded "M13
→ `@zip.js/zip.js` from exactly one file (`src/import/source/zip.ts`, D30)" as
the *primary* plan, with a native fallback named as a pre-decided contingency
if S01's CP0 probe found the package unsuitable. The probe found exactly that
(zip.js 2.17.0 bundles blob-URL `new Worker` creation and default-export WASM,
both forbidden by the pipeline sweep), so **the fallback is what shipped**:
`src/import/source/{zip,xml,cfb,opc}.ts` is a from-scratch reader with **no
third-party package** anywhere in the import pipeline. The Stack table above
is corrected accordingly; `@zip.js/zip.js` was never installed
(`package.json`/`pnpm-lock.yaml` carry no such dependency at `30396a9`).

### Domain (pure; no outward imports)

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M01 | Domain model | src/domain/model/ | Stable opaque IDs, event unions, provenance, baseline refs, domain errors | — | ids.ts, events.ts, provenance.ts |
| M02 | Validation | src/domain/validation/ | The one shared validator: rules, referential integrity, schema impact | M01, M03 (result types) | validate-record.ts, schema-transition.ts |
| M03 | Formulas | src/domain/formulas/ | Parser, stable-ref IR, function catalog, dependency graph, evaluator | M01 | parser.ts, ir.ts, catalog.ts, evaluator.ts |
| M04 | Capacity | src/domain/capacity/ | Five independent budgets, calibration, degradation states | M01 | budgets.ts, estimates.ts |
| M05 | Policy | src/domain/policy/ | Cross-cutting pure policies: freshness, reminders, removal, allowed actions | M01, M04 | allowed-actions.ts, backup-freshness.ts |
| M06 | Reconciliation | src/domain/reconciliation/ | Three-way merge, conflict classification, applied log | M01, M02, M05 | reconcile.ts, decision-table.ts |

### Ports

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M07 | Application ports | src/application/ports/ | All dependency-inversion interfaces (repo, projection, crypto, provider, file, clock, entropy, capacity probe, lifecycle) | M01 | ports.ts (or one file per port) |

### Infrastructure — crypto and persistence

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M08 | Crypto | src/crypto/ | KDF, key hierarchy, recovery codes, envelope/stream AEAD, wrapping, suite versioning | libsodium, M07 (implements CryptoPort) | keys.ts, envelope.ts, kdf.ts |
| M09 | Codecs | src/persistence/codecs/ | Canonical CBOR, compression, framing, versioned decode | — | canonical-cbor.ts, framing.ts |
| M10 | Migrations | src/migrations/ | Every durable format transition. **DB-phase owned, permanently. No session's `Owns` may include this path.** | M09 (old/new codecs), transactional ports | 001–006 + index.ts (exist) |
| M11 | Envelope store | src/persistence/envelope-store/ | The only persistent local DB connection; encrypted transactions, staging, revisions, quota | Dexie, M09, M10 (runner), M07 | store.ts, staging.ts |
| M12 | Projection | src/persistence/projection/ | Unlocked in-memory SQLite lifecycle, replay, hydration, FTS, invalidation. Runs only in data worker | SQLite WASM, M01, M02, M03 | hydrate.ts, query-exec.ts |

### Infrastructure — import

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M13 | Import source | src/import/source/ | Random-access source over File/Blob/staged chunks; content sniffing; **landed F03:** the native container readers (zip/XML/CFB/OPC), no third-party package | M07 (FilePort) | source.ts, sniff.ts |
| M14 | Pre-flight | src/import/preflight/ | Metadata-only sizing, safety bounds, macro detection, selection plan. Never iterates cells; **landed F03:** `preflightWorkbook` (multi-sheet) beside the F02 delimited path | M13, M04 | preflight.ts, refusal.ts |
| M15 | OOXML adapter | src/import/formats/ooxml/ | Streaming XLSX/OPC facts. **Landed F03** | M13, M65 | index.ts (landed) |
| M16 | XLSB adapter | src/import/formats/xlsb/ | Streaming XLSB records, macro-sheet detection. **Landed F03** | M13, M65, M17 (`ptg.ts`) | index.ts (landed) |
| M17 | BIFF adapter | src/import/formats/biff/ | Bounded CFB + BIFF/XLS records, VBA/XLM refusal signals, the shared `Ptg` decoder. **Landed F03** | M13, M65 | index.ts, ptg.ts (landed) |
| M18 | ODS adapter | src/import/formats/ods/ | Streaming ODS facts. **Landed F03** | M13, M65 | index.ts (landed) |
| M19 | Delimited adapter | src/import/formats/delimited/ | Chunked CSV/TSV detection and row facts | M13, M65 (F03) | — |
| M20 | HTML-table adapter | src/import/formats/html-table/ | Non-executing tokenizer for legacy HTML-as-XLS. **Landed F03** | M13, M65 | index.ts (landed) |
| M21 | Inference | src/import/inference/ | Evidence-weighted schema/type/relationship proposals, rejection memory; **landed F03:** the full multi-sheet workbook tier | M01, M03, M65 | — |
| M22 | Snapshots | src/import/snapshots/ | Normalized read-only sheet snapshots, encrypted source chunks, inert inventory; **landed F03:** the per-sheet v2 format + writer | M08, M11 (via ports) | — |
| M23 | Staging | src/import/staging/ | Provisional encrypted import model, atomic promotion, no-partial-app guarantee; **landed F03:** multi-sheet promotion + append-into-existing-app (D38) | M08, M11 (via ports), M65 (F03) | — |
| M65 | Workbook facts | src/import/facts/ | The format-neutral `WorkbookFact` stream vocabulary every adapter emits (v2: sheets, typed values, formats, formulas, declared tables, validations, merges, preserved parts), the adapter/inventory interfaces, and the fact→canonical-CBOR value mapping. **Landed F03** — sole home of the vocabulary since D32 closed (the F02 `formats/delimited/facts.ts` copy is deleted) | M01 (`values` only) | workbook-facts.ts, adapter.ts (landed) |

### Infrastructure — sync and export

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M24 | Sync protocol | src/sync/protocol/ | Provider-neutral vault layout, generation head, CAS, tombstones, adoption manifests | M08, M09, M07 | vault-index.ts, publish-plan.ts |
| M25 | Dropbox adapter | src/sync/providers/dropbox/ | Dropbox PKCE/tokens, App Folder ops, error translation. Implements DurableHomePort | M50 (config), M07 | — |
| M26 | OneDrive adapter | src/sync/providers/onedrive/ | Microsoft SPA PKCE, approot/Graph ops, 24h renewal, error translation. Implements DurableHomePort | M50 (config), M07 | — |
| M27 | Bundle adapter | src/sync/providers/bundle/ | Manual encrypted bundle assembly/open, staleness semantics | M24, M07 | — |
| M28 | Adoption | src/sync/adoption/ | Index-only discovery, sizing, selective transfer, atomic adoption | M24, M25–M27, M04, M08, M11, M09, M02 | — |
| M29 | Sync scheduler | src/sync/scheduler/ | Debounce, manual/visibility triggers, resume retry, truthful status | M24, M30, M07 | — |
| M30 | Sync coordinator | src/sync/coordinator/ | Pull/push orchestration, baseline selection, reconciliation invocation, confirmed heads | M24–M27, M06, M02, M11 | — |
| M31 | Export | src/export/ | Plaintext XLSX/CSV/PNG/PDF generation, complete-local-data scope, delivery | projection cursors, SheetJS, pdf-lib, M51 | — |

### Workers

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M32 | Worker protocol | src/workers/protocol/ | Versioned typed RPC, cancellation, progress, transfer, error redaction | M01 (safe types) | messages.ts, client.ts |
| M33 | Worker entries | src/workers/*.worker.ts **+ src/workers/<name>/** (leasing unit: `src/workers/**` minus `protocol/`) | Per-worker composition: data (keys+DB+projection), import (parse, all formats since F03), io (ciphertext+OAuth I/O), export (plaintext, no network) | M32 + composed app/infra per worker | data.worker.ts + data/{handlers,catalog,session}.ts (landed); import.worker.ts + import/{parse-session,adapters}.ts (landed); io.worker.ts, export.worker.ts |

> M33 path correction (Roshi, post-F01): the entry file is a composition root
> only; every command body lives beside it in `src/workers/data/` so it is
> unit-testable without spawning a worker. `src/workers/*.worker.ts` alone was
> never the shipped leasing unit. Later worker entries should assume the same
> shape.

### Application

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M34 | Commands | src/application/commands/ | The only user-authored mutation entrance; atomic commit + CommitConfirmed | M01–M06, M07 | execute-command.ts |
| M35 | Queries | src/application/queries/ | Typed queries, pagination, truthful partial scope, chart datasets | M01, M04, M07 | — |
| M36 | Workflows | src/application/workflows/ | XState machines: setup, unlock, import, re-upload, OAuth, backup, adoption, export, removal, reset | M34, M35, M07, M05 | — |
| M37 | View models | src/application/view-models/ | Plaintext-minimized per-surface models and announcements | M35, M36, M01 (safe types) | — |

### UI

| ID | Module | Path | Owns (approved surfaces) | Imports From | Key Files (planned) |
|----|--------|------|--------------------------|--------------|---------------------|
| M38 | UI primitives | src/ui/primitives/ | CTL-001–120 wrappers, semantic states | React Aria, M37 (types) | — |
| M39 | UI layout | src/ui/layout/ | Compact/wide/tablet/desktop shells, safe areas, focus order | M38 | — |
| M40 | UI theme | src/ui/theme/ | Shell tokens, app token mapping, contrast enforcement | — | tokens.css, theme.ts |
| M41 | UI security | src/ui/security/ | SCR-001–009; MOD-020–024, 032–033, 037 | M38–M40, M37 | — |
| M42 | UI library | src/ui/library/ | SCR-010–015; MOD-003; SHT-011 | M38–M40, M37 | — |
| M43 | UI import | src/ui/import/ | SCR-016–023, 043–045; MOD-004–008, 034–035; SHT-013 | M38–M40, M37 | — |
| M44 | UI records | src/ui/records/ | SCR-024–032; MOD-009–011; SHT-001–010, 016 | M38–M40, M37 | — |
| M45 | UI charts | src/ui/charts/ | SCR-033–034; MOD-012–013; SHT-012, 017 | M38–M40, M37, Chart.js | — |
| M46 | UI schema | src/ui/schema/ | SCR-035–037; MOD-014–015; SHT-014 | M38–M40, M37 | — |
| M47 | UI durability | src/ui/durability/ | SCR-038–042; MOD-001–002, 016–019, 025–026, 036; SHT-015 | M38–M40, M37 | — |
| M48 | UI reconciliation | src/ui/reconciliation/ | SCR-046–048; SHT-018 | M38–M40, M37 | — |
| M49 | UI ownership | src/ui/ownership/ | SCR-049–052; MOD-027–031 | M38–M40, M37 | — |

### Entry, platform, and composition

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M50 | Config | src/config/ | Validated public build config, provider IDs, origin allowlist, format flags | — | public-config.ts |
| M51 | Platform | src/platform/ | File acquisition, save/share handoff, install prompt, visibility, storage estimate; **landed F03:** clipboard | browser APIs | — |
| M52 | PWA | src/pwa/ | Manifest, service worker, precache, Chromium share-target inbox, safe update | Workbox, M50 | sw.ts, manifest |
| M53 | Bootstrap | src/bootstrap/ | Capability checks, lock/unlock lifetime, composition, worker startup/termination | M50–M52, M32 | — |
| M54 | Routes | src/routes/ | Hash routes, guards, approved screen composition, OAuth return routing; **landed F03:** CA-07 amendment 3 (snapshot routes) | M41–M49, M37 | — |
| M55 | Entry | src/main.tsx | Minimal browser entry + fatal bootstrap handling | M53, M54 | main.tsx |

### Tests

| ID | Module | Path | Owns |
|----|--------|------|------|
| M56 | Unit tests | tests/unit/ | Pure domain/workflow/codec/policy/adapter units |
| M57 | Property tests | tests/property/ | Reconciliation, validation, crypto-envelope, event-order, parser bounds |
| M58 | Workbook fixtures | tests/fixtures/workbooks/ | Fidelity + refusal corpus per format |
| M59 | Vault fixtures | tests/fixtures/vaults/ | Versioned encrypted known-answer vaults, migration fixtures |
| M60 | Browser tests | tests/browser/ | Real-browser DB/worker/SW/offline/quota/multi-tab |
| M61 | E2E tests | tests/e2e/ | Approved flows, responsive + accessibility assertions |
| M62 | Provider contract | tests/provider-contract/ | Protocol doubles + opt-in live Dropbox/OneDrive qualification |
| M63 | Performance | tests/performance/ | Reference-device budget tests |
| M64 | Security tests | tests/security/ | Egress allowlist, CSP, malicious workbooks, tamper, plaintext-at-rest probes |

### Root manifests (owner-seam paths)

`package.json`, `.npmrc`, `pnpm-lock.yaml`, `tsconfig*.json`, `vite.config.ts`,
`vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `index.html`,
`src/vite-env.d.ts`, `public/` have no module ID. They are **owner-seam
paths**: the scaffolding session owns them at creation; afterwards, changes ride
in the session whose work requires them, listed explicitly in that session's
`Owns`. Two concurrent sessions may never both lease a root manifest.

**`harness.html` + `src/harness/**` are owner-seam paths too (D11, F01).** The
browser-test harness is a second Vite rollup input and a *test-toolchain*
artifact — no module ID, never a product surface, never imported by
`src/main.tsx`. It resolves modules and workers by `import.meta.glob`, so new
`src/**` files are reachable from built output without any later session editing
a build input. Its build products (`harness.html`, `dist/assets/harness-*.js`,
`dist/assets/probe.worker-*.js`, ~534 kB) must be excluded from the F08
precache. Details in `arch/M55-entry.md`. F03 added no new build input; every
new F03 module was reachable through the existing glob with zero edits here,
confirming the property this owner-seam path was built for.

## Conventions

- **Naming**: kebab-case files, PascalCase types/components, camelCase values. Migrations use `NNN_snake_case` (DB-owned idiom — do not imitate elsewhere).
- **Imports**: ESM with explicit `.js` extensions in relative TS imports (matches `src/migrations/index.ts`). No default exports in domain/application code.
- **Types**: strict mode, exhaustive discriminated unions with `never` checks; `readonly`/`Object.freeze` for shared constants; opaque ID types.
- **Error handling**: typed domain errors in `src/domain/model/`; throw `Error` with actionable messages at infra boundaries; worker-crossing errors redact cell values.
- **Logging**: opaque IDs and redacted error classes only. Never a name, value, token, or key.
- **Docs**: JSDoc on exported symbols stating the contract, not the implementation.
- **Forbidden everywhere**: `eval`/`new Function`, `dangerouslySetInnerHTML`, runtime CDN loads, plaintext user data in any persistent store, key material outside worker memory.

Added by Roshi after F01 (each crossed Vow 4's in-cycle recurrence bar — three
or more distinct sessions in one feature cycle; instances cited):

- **A dependency must-not ships as a test, not a review note.** Every module whose arch fragment states a forbidden import owns a `module-boundaries.test.ts` (or equivalent) asserting it mechanically. F01 grew five independently: `tests/unit/crypto/module-boundaries.test.ts` (M09 has no third-party import, S02), `tests/unit/ui/architecture.test.ts` (`src/ui/**` imports only `react` + `react-aria-components`, S03), `tests/unit/envelope-store/module-boundaries.test.ts` (Dexie confined to three files, S04), `tests/unit/workers/module-boundaries.test.ts` (`messages.ts` imports nothing, S05), `tests/unit/workflows/module-boundaries.test.ts` (M36/M37 import no React/crypto/persistence, S06). Two cross-lease violations were prevented by these tests rather than caught in review. F03 grew the pattern further without a new instance count needed: the pipeline sweep gained M03/M15–M20/M65's directories (S01/S02/S04/S05), and the staging sweep gained the workbook codec files (S06) — each session extending an existing mechanical sweep rather than writing a new one, exactly as the rule anticipates.
- **Encode a must-not as a type or a runtime throw wherever the language allows it.** Precedents to follow: `ButtonProps` requires `disabledReason` when `isDisabled` (S03); `applyShellTheme` throws on a system-owned property (S03); the RPC union names no byte or key type at all, so key bytes are type-excluded rather than merely absent (S05); locked view models declare no inventory field, so a future writer cannot fill one (S06); `frameToRow` refuses a frame sealed at another revision (S04). F03 added `ReferenceCellVm`'s broken variant (cannot be constructed without `originalKey`), `SheetEstimateVm` (no exact member), and `CheckboxProps` (mirrors `ButtonProps`'s `disabledReason` requirement). Prefer this to a comment every time; state in the fragment which contract is type-held.
- **Test filters take no bare `--`.** `pnpm test:browser <filter>` and `pnpm test:e2e <filter>` filter; `pnpm test:browser -- <filter>` silently runs the **whole** suite — the mirror image of a zero-selected run, and it passes vacuously. Observed and re-confirmed across S01, S05 and S06. (The Verification Commands table below was corrected to the no-`--` forms by Forge at F02 planning, 2026-09-08.) No F03 instance.

Added by Roshi at the F02 interim pass (crossed Vow 4's **in-cycle** axis —
three distinct instances inside one feature cycle; instances cited):

- **A lease and a boundary sweep are drawn over the module map, never over the directory tree.** `src/import` is not one module: it is M13/M14/M19/M21 (S03) plus M22/M23 (S04), and their arch fragments declare *opposite* dependency edges. Three concrete rules, each paid for:
  1. **Name module directories, never the shared parent** — in a session's `Owns` and in any recursive `module-boundaries` sweep. S03's `tests/unit/import/module-boundaries.test.ts` swept all of `src/import` and asserted no `/persistence/` import; S04's landed M23 correctly imports M09's canonical CBOR, so `pnpm verify` went red on a file outside the failing session's lease and S04 **returned blocked at CP1**. The re-scoped sweep at `978f4ff` now lists the four directories and says so in its own header comment.
  2. **A lease must contain every path its own checkpoint proofs write** — fixtures, config manifests, test directories — checked at planning against each checkpoint's stated gate, not against the Files table. F02 needed two pre-dispatch lease amendments for exactly this (PC-01: `tests/browser/fixtures/**`, which S01's own CP1 sqlite proof had to create; PC-07: the five test/toolchain configs D16 required).
  3. **A fixture corpus is owned by one session and unreachable to every later one.** Plan the later session's fixtures inside its own lease, or name the corpus owner as a supplier. S04 could not add to `tests/fixtures/workbooks/**` (S03's) and built synthetic in-page fixtures for its volume cases instead — truthful, but a workaround a lease boundary forced.
  This is the same class as F01's replan F-01 (harness entry in no lease) and F-08 (test deps in no lease): **four instances across two cycles, three inside F02 alone.** F03 held this rule without a new instance: S01's fixture-builder toolkit (`tests/fixtures/workbooks/build/`) was planned into S01's own lease from the start and reused unmodified by S02/S04/S05, exactly rule 3's better path.

Added by Roshi at the F02 final pass (crossed Vow 4's **in-cycle** axis — three
distinct sessions inside one feature cycle; instances cited):

- **A closed union and every exhaustive map over it are one lease.** `DATA_WORKER_ERROR_KINDS_V1` (M32, `src/workers/protocol/messages.ts`) is keyed exhaustively by `REFUSAL_ANNOUNCEMENT` (M37, `src/application/view-models/security.ts`), so *any* extension of the union is a compile error in a file some other session owns. F02's plan put the producer (S04, then S05) and the exhaustive consumer (S06) in different sessions, in that order, and the constraint fired three times:
  1. **S04** needed `import-stage-missing`/`conflict` kinds, could not add them, and shipped idempotent reads instead — a recorded CA-12 deviation rather than a contract extension.
  2. **S05** was explicitly instructed not to extend the union (auto-decision, wave 4) so a serial-chain typecheck break could not land between it and S06 — a plan constraint standing in for a lease.
  3. **S06** cleared the seam by gating every mutating stage call on `getImportStage`, because it was the first session holding *both* files. Between (1) and (3) the shipped copy for an ordinary reload-mid-import said "the local store did not pass its integrity check", which is false — found by the interim drift check, not by a session.
  **The rule:** when decomposition splits a closed union from a map that must stay exhaustive over it, co-lease them, sequence them so the consumer leads, or state in the plan which session may extend the union. Treat it exactly like a serial lease takeover, because that is what it is. (Also recorded as a framework recommendation for `FORGE.md`, where it binds every program.) **F03 held this rule and produced positive evidence it works when followed at planning time:** D42 named the sole extender (`PROMOTION_REJECTIONS` gains `append-too-large`, S06 only, co-leased with `M37`'s `import.ts`) before any session started, and the union never bit a session mid-run — zero new instances.

## Verification Commands

> **Status: proven.** Baseline first proven at F01 S01 (`7767341`), all rows
> re-verified at the F02 final revision `5ab3b07` (F02 STATE.md Verification Baseline; previously F01 `2c0248a` — see that cycle's
> Verification Baseline). The active feature's STATE.md Verification Baseline
> supersedes this table whenever they disagree; Forge/Jikijitsu reconcile this
> table after each feature's baseline lands. **No filter form takes a bare
> `--`:** `pnpm test <path>` and `pnpm test:browser <filter>` filter;
> `pnpm test:browser -- <filter>` silently runs the whole suite.
>
> **Archivist note (not an edit — this section is outside Archivist's
> charter):** this table still names its last re-verification as the F02
> revision `5ab3b07`. F03's STATE.md Verification Baseline (revision `30396a9`
> / `425562d`) supersedes it per the table's own rule, above — typecheck 0,
> lint 0, `pnpm test` 155 files / 1728 passed / 3 skipped, full e2e 57 passed.
> Reported for Forge/Jikijitsu to reconcile at the next feature's planning,
> not corrected here.
>
> **Reconciled at F04 planning (Planner, 2026-09-23):** every command row
> above is unchanged in form. Re-verified at `21946c7` (code ≡ `30396a9`):
> typecheck 0, lint 0, `pnpm test` 155 files / 1728 passed / 3 skipped. Build,
> browser and e2e are inherited from F03 (57 e2e passed @ `30396a9`). The F04
> STATE.md Verification Baseline is the active record.

| Check | Command | Scope |
|---|---|---|
| Typecheck | `pnpm typecheck` (`tsc --noEmit -p tsconfig.json && -p tsconfig.node.json`) | all |
| Lint | `pnpm lint` (`eslint .`, type-checked; eval/new Function/dangerouslySetInnerHTML bans proven to fire) | all |
| Unit + property | `pnpm test` (`vitest run`; projects `node` + `jsdom`, `css: true`) | tests/unit, tests/property |
| Focused tests | `pnpm test <path>` (no bare `--`) | per-session gate |
| Browser tests | `SHEAF_PW_PORT=<envelope port> pnpm test:browser [filter]` (webServer = `pnpm build && pnpm preview --port $SHEAF_PW_PORT --strictPort`, `reuseExistingServer:false`; served identity `window.__sheafBuildId` vs `git rev-parse HEAD`) | scheduled, not per-checkpoint |
| E2E | `SHEAF_PW_PORT=<envelope port> pnpm test:e2e [filter]` (same webServer; real `index.html` entry, never the harness) | scheduled, not per-checkpoint |
| Build | `pnpm build` (`vite build`; emits `dist/index.html` + `dist/harness.html`) | all |
| Full gate | `pnpm verify` = typecheck + lint + test + build | session close |

Live provider qualification (`tests/provider-contract/` live suites) is opt-in,
needs real Dropbox/OneDrive test accounts, and is never a checkpoint gate.

## Git

| Field | Value |
|---|---|
| Branch | `main` (all Genesis phases committed directly to main; continue unless user redirects) |
| Commit style | Lowercase imperative summary, phase/scope prefix optional (matches existing history) |
| Checkpoint commits | Mu commits its own lease: `git add -- <Owns pathspec> && git commit` per checkpoint |
| Never | `git reset --hard`, force push, history rewrite |
| Note | `/program/sheaf/prompts/` and `/.forge/` are gitignored by user intent — session prompts and orchestration scratch are not tracked. FORGE-CONFIG, STATE snapshots under prompts/ are therefore local-only artifacts. |

## Session Defaults

| Field | Value |
|---|---|
| Sessions per feature | 3–8 unless capability dependencies or context ceilings force more |
| Checkpoints per session | 2–6, each a real commit with a mechanically checkable condition |
| Owns discipline | Exact globs covering the Files table and nothing more; never `specs/`, `mocks/`, `src/migrations/`, `STATE.md`, `MASTER.md`, arch files |
| Concurrency | Only sessions with literally disjoint `Owns` path sets |
| Slicing | Column-wise (capability end-to-end) over layer-wise |
| First journey | After minimum bootstrap, one connected path from real entry through worker RPC, command, validator, encrypted commit, and restart read |

## Custom Rules

1. **Genesis artifacts are read-only.** `specs/*.md`, `mocks/*.html`, and `src/migrations/` are owned by their Genesis authors. Changes route through Genesis re-entry (design-fill → Designer via Jikijitsu; design-change → Designer; requirements-change → Spec; schema-change → DB). Only design-fill is auto-dispatchable.
2. **The 12 architectural invariants bind every session.** Cite the relevant invariant in any session touching commit paths, plaintext lifetime, validation, reconciliation, import safety, or egress.
3. **Google Drive is settled: not a durable home.** Sessions building `src/ui/durability/` must not enable the mock's conditional Drive card. Reopening this is a provider-contract re-entry, not a session.
4. **Share/open-in is platform-conditional.** Chromium share-target only; WebKit gets the file picker and must not claim share-target status (approved clarification in architecture.md).
5. **UI surfaces come from the design inventory.** A missing surface is a design-fill seam for Jikijitsu, never an invention. Mock Tailwind classes are reference only — production styling is CSS Modules + tokens.
6. **Format versions come from `src/migrations/index.ts`** (`CURRENT_FORMAT_VERSIONS`). No session redeclares them; consume the export.
7. **A session's `Owns` glob is authoritative; its Files table is indicative.** A worker may create a file inside its lease that the plan did not name, provided it (a) names the file and the reason in its return, and (b) records it in the arch delta. This is not lease widening and needs no amendment. F01 saw it in four of seven sessions, each time for a real structural reason: `src/ui/primitives/class-names.ts` (S03), `src/workers/data/handlers.ts` (S05 — so commands are testable without a worker), `tests/unit/workflows/fakes.ts` + `module-boundaries.test.ts` (S06), `src/routes/app-runtime.tsx` + `src/ui/security/{frames,verdict}.tsx` (S07). F02 added seven more (S03 +1, S04 +3, S07 +3, S08 +2, each disclosed). F03 added at least a dozen more across nearly every session (each format adapter's internal file split, `M23`'s `roots.ts`/`events.ts`/`theme.ts`/`fact-codec.ts`/`row-plan.ts`/`import-commit.ts`, `M54`'s `app-area-hooks.tsx`/`snapshot-routes.tsx`), **and F03 also produced the mirror case for the first time**: S08's Files table listed `src/application/view-models/snapshots.ts`, which its own checkpoint proof never needed — the snapshot VMs landed in `records.ts` instead. The rule already covers this direction too (the Files table is indicative, not binding, in *either* direction); no amendment needed, recorded here as the first observed instance. *(Added by Roshi after F01; extended by Archivist at the F03 final pass.)*
8. **The program runs on demo gates.** `/program/sheaf/ROADMAP.md` sequences features F01–F08; every Forge run plans exactly one roadmap feature. Each feature ends demoable, its STATE.md carries a standing `GATE-F0N` human blocker, and Jikijitsu dispatches nothing from the next feature until the gate verdict lands. Gate feedback routes per the roadmap's Gate Protocol (approve / approve-with-notes / revise / redirect→Genesis re-entry). Forge runs for feature N+1 start only after GATE-F0N. GATE-F03 was approved on 2026-09-23 (ROADMAP Gate Log, revision `30396a9`). F04 `formulas-queries-charts` is planned (Planner, base `21946c7`), and it halts at GATE-F04.

## Genesis Sources

| Source | Path | Consumed by |
|---|---|---|
| Idea | /program/sheaf/specs/idea.md | Context |
| Requirements | /program/sheaf/specs/requirements.md | FR/EXT acceptance text for capability plans |
| Design | /program/sheaf/specs/design.md + /program/sheaf/mocks/*.html (56 mocks; SCR/MOD/SHT/CTL/STA inventories) | Every UI session |
| Architecture | /program/sheaf/specs/architecture.md | Stack, module contracts, invariants (parsed into this file) |
| Database | /program/sheaf/specs/database.md + /src/migrations/ | Any session touching the data layer |
