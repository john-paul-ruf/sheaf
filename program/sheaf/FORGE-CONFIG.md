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
| Containers | zip.js (OPC/ODS); custom bounded CFB reader (legacy XLS) |
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
`specs/architecture.md` § Module Contracts (authoritative detail source).

**Arch fragment policy (lazy seeding):** `/program/sheaf/arch/M##-<module>.md`
fragments are seeded by Forge at feature-planning time, for exactly the modules
that feature's sessions touch — mechanically extracted from § Module Contracts
(exports, dependency edges, must-nots) plus an empty Change History section.
Session Module Context tables and Jikijitsu's Orchestration Envelope reference
the fragment, not the 87KB spec. Jikijitsu owns and maintains fragments during
runs (never in any Mu `Owns`); untouched modules get fragments when first
touched. A full 64-fragment build-out before code exists is deliberately
avoided: it would duplicate the spec and immediately drift.

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
| M13 | Import source | src/import/source/ | Random-access source over File/Blob/staged chunks; content sniffing | M07 (FilePort) | source.ts, sniff.ts |
| M14 | Pre-flight | src/import/preflight/ | Metadata-only sizing, safety bounds, macro detection, selection plan. Never iterates cells | M13, M04 | preflight.ts, refusal.ts |
| M15 | OOXML adapter | src/import/formats/ooxml/ | Streaming XLSX/OPC facts | M13, M09 | — |
| M16 | XLSB adapter | src/import/formats/xlsb/ | Streaming XLSB records, macro-sheet detection | M13, M09 | — |
| M17 | BIFF adapter | src/import/formats/biff/ | Bounded CFB + BIFF/XLS records, VBA/XLM refusal signals | M13, M09 | — |
| M18 | ODS adapter | src/import/formats/ods/ | Streaming ODS facts | M13, M09 | — |
| M19 | Delimited adapter | src/import/formats/delimited/ | Chunked CSV/TSV detection and row facts | M13 | — |
| M20 | HTML-table adapter | src/import/formats/html-table/ | Non-executing tokenizer for legacy HTML-as-XLS | M13 | — |
| M21 | Inference | src/import/inference/ | Evidence-weighted schema/type/relationship proposals, rejection memory | M01, M02, M03, workbook facts | — |
| M22 | Snapshots | src/import/snapshots/ | Normalized read-only sheet snapshots, encrypted source chunks, inert inventory | M08, M11 (via ports) | — |
| M23 | Staging | src/import/staging/ | Provisional encrypted import model, atomic promotion, no-partial-app guarantee | M08, M11 (via ports) | — |

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
| M33 | Worker entries | src/workers/*.worker.ts | Per-worker composition: data (keys+DB+projection), import (parse), io (ciphertext+OAuth I/O), export (plaintext, no network) | M32 + composed app/infra per worker | data.worker.ts, import.worker.ts, io.worker.ts, export.worker.ts |

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
| M44 | UI records | src/ui/records/ | SCR-024–032 (non-chart); MOD-009–011; SHT-001–010, 016 | M38–M40, M37 | — |
| M45 | UI charts | src/ui/charts/ | SCR-033–034; MOD-012–013; SHT-012, 017 | M38–M40, M37, Chart.js | — |
| M46 | UI schema | src/ui/schema/ | SCR-035–037; MOD-014–015; SHT-014 | M38–M40, M37 | — |
| M47 | UI durability | src/ui/durability/ | SCR-038–042; MOD-001–002, 016–019, 025–026, 036; SHT-015 | M38–M40, M37 | — |
| M48 | UI reconciliation | src/ui/reconciliation/ | SCR-046–048; SHT-018 | M38–M40, M37 | — |
| M49 | UI ownership | src/ui/ownership/ | SCR-049–052; MOD-027–031 | M38–M40, M37 | — |

### Entry, platform, and composition

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| M50 | Config | src/config/ | Validated public build config, provider IDs, origin allowlist, format flags | — | public-config.ts |
| M51 | Platform | src/platform/ | File acquisition, save/share handoff, install prompt, visibility, storage estimate | browser APIs | — |
| M52 | PWA | src/pwa/ | Manifest, service worker, precache, Chromium share-target inbox, safe update | Workbox, M50 | sw.ts, manifest |
| M53 | Bootstrap | src/bootstrap/ | Capability checks, lock/unlock lifetime, composition, worker startup/termination | M50–M52, M32 | — |
| M54 | Routes | src/routes/ | Hash routes, guards, approved screen composition, OAuth return routing | M41–M49, M37 | — |
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

`package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `vite.config.ts`,
`vitest.config.ts`, `playwright.config.ts`, `index.html`, `public/` have no
module ID. They are **owner-seam paths**: the scaffolding session owns them at
creation; afterwards, changes ride in the session whose work requires them,
listed explicitly in that session's `Owns`. Two concurrent sessions may never
both lease a root manifest.

## Conventions

- **Naming**: kebab-case files, PascalCase types/components, camelCase values. Migrations use `NNN_snake_case` (DB-owned idiom — do not imitate elsewhere).
- **Imports**: ESM with explicit `.js` extensions in relative TS imports (matches `src/migrations/index.ts`). No default exports in domain/application code.
- **Types**: strict mode, exhaustive discriminated unions with `never` checks; `readonly`/`Object.freeze` for shared constants; opaque ID types.
- **Error handling**: typed domain errors in `src/domain/model/`; throw `Error` with actionable messages at infra boundaries; worker-crossing errors redact cell values.
- **Logging**: opaque IDs and redacted error classes only. Never a name, value, token, or key.
- **Docs**: JSDoc on exported symbols stating the contract, not the implementation.
- **Forbidden everywhere**: `eval`/`new Function`, `dangerouslySetInnerHTML`, runtime CDN loads, plaintext user data in any persistent store, key material outside worker memory.

## Verification Commands

> **Status: aspirational — nothing below is executable yet.** No `package.json`
> exists. The scaffolding session must create these scripts *and prove each one
> runs*; until then every session gate referencing them is unverified. Record
> actual first-run results in STATE.md's Verification Baseline.

| Check | Command | Scope |
|---|---|---|
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) | all |
| Lint | `pnpm lint` | all |
| Unit + property | `pnpm test` (`vitest run`) | tests/unit, tests/property |
| Focused tests | `pnpm test -- <path>` | per-session gate |
| Browser tests | `pnpm test:browser` (Playwright projects for tests/browser) | scheduled, not per-checkpoint |
| E2E | `pnpm test:e2e` | scheduled, not per-checkpoint |
| Build | `pnpm build` (`vite build`) | all |
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
7. **The program runs on demo gates.** `/program/sheaf/ROADMAP.md` sequences features F01–F08; every Forge run plans exactly one roadmap feature. Each feature ends demoable, its STATE.md carries a standing `GATE-F0N` human blocker, and Jikijitsu dispatches nothing from the next feature until the gate verdict lands. Gate feedback routes per the roadmap's Gate Protocol (approve / approve-with-notes / revise / redirect→Genesis re-entry). Forge runs for feature N+1 start only after GATE-F0N.

## Genesis Sources

| Source | Path | Consumed by |
|---|---|---|
| Idea | /program/sheaf/specs/idea.md | Context |
| Requirements | /program/sheaf/specs/requirements.md | FR/EXT acceptance text for capability plans |
| Design | /program/sheaf/specs/design.md + /program/sheaf/mocks/*.html (56 mocks; SCR/MOD/SHT/CTL/STA inventories) | Every UI session |
| Architecture | /program/sheaf/specs/architecture.md | Stack, module contracts, invariants (parsed into this file) |
| Database | /program/sheaf/specs/database.md + /src/migrations/ | Any session touching the data layer |
