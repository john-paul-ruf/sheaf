# SESSION-06 — Compact encrypted history without losing restart or restoration

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M07 M12 M23 M33 M35 M37 M44 M56 M57 M60 M61
> **Depends on:** SESSION-02, SESSION-03
> **Concurrent with:** S04, S05
> **Owns:** `src/application/ports/projection.ts`, `src/application/queries/history.ts`, `src/application/view-models/records.ts`, `src/import/staging/roots.ts`, `src/persistence/codecs/event-commit.ts`, `src/persistence/projection/**`, `src/ui/records/change-history-screen.tsx`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/compaction.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/compaction.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/e2e/compaction-backup.spec.ts`, `tests/fixtures/vaults/f05/compaction/**`, `tests/property/codecs/event-commit.test.ts`, `tests/property/compaction/**`, `tests/unit/codecs/event-commit.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/projection/**`, `tests/unit/queries/history.test.ts`, `tests/unit/staging/roots.test.ts`, `tests/unit/ui/records/change-history-screen.test.tsx`, `tests/unit/view-models/records.test.ts`, `tests/unit/workers/backup-graph.test.ts`, `tests/unit/workers/compaction.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`, `program/sheaf/mocks/change-history.html`
> **Resources:** dist:build, playwright:output
> **Checkpoints:** 4

## Module Context

| ID | Module | Read | Why |
|---|---|---|---|
| M07 | Application ports | `program/sheaf/arch/M07-ports.md` | Contract, producer and boundary tests in this lease |
| M12 | Projection | `program/sheaf/arch/M12-projection.md` | Contract, producer and boundary tests in this lease |
| M23 | Staging | `program/sheaf/arch/M23-staging.md` | Contract, producer and boundary tests in this lease |
| M33 | Worker entries | `program/sheaf/arch/M33-workers.md` | Contract, producer and boundary tests in this lease |
| M37 | View models | `src/application/view-models/records.ts` | Retained-history scope and announcements |
| M44 | Records UI | `src/ui/records/change-history-screen.tsx` | Presentation paired with audit reader |
| M35 | Queries | `program/sheaf/arch/M35-queries.md` | Contract, producer and boundary tests in this lease |
| M56 | Unit tests | `tests/unit/` | Contract, producer and boundary tests in this lease |
| M57 | Property tests | `tests/property/` | Contract, producer and boundary tests in this lease |
| M60 | Browser tests | `tests/browser/` | Contract, producer and boundary tests in this lease |
| M61 | E2E tests | `program/sheaf/arch/M61-e2e-tests.md` | Contract, producer and boundary tests in this lease |

## Resource scheduling

Concurrent with denotes disjoint source leases only. S04/S05/S06 all require dist:build and playwright:output. Conservatively serialize their full-session resource reservations; do not dispatch them simultaneously under the current envelopes. S06 may proceed while provider inputs are blocked. Concurrent execution needs a separately reviewed envelope with isolated build and runner outputs, not merely distinct ports.

## Context

createEventStore writes one segment per commit and keeps a growing tail. chainState currently requires the last local commit to be in that tail. No checkpoint exporter, compactor or audit replay is present. This is one coherent storage/restart capability, split from first bundle because its projection/history working set and proof matrix are substantially larger.

Plan HEAD `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

CAP-44 complete compaction; preserves CAP-39/40/41. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-35, CA-36, CA-40, CA-41. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `src/application/ports/projection.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/queries/history.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/import/staging/roots.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/persistence/codecs/event-commit.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/persistence/projection/**` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/app-session.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/backup-graph.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/compaction.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/event-store.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/home-state.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `tests/browser/projection/fixtures/projection.entry.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/projection/fixtures/projection.worker.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/sync/compaction.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/sync/fixtures/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/compaction-backup.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/fixtures/vaults/f05/compaction/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/property/codecs/event-commit.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/property/compaction/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/codecs/event-commit.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/commands/fakes.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/projection/**` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/queries/history.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/staging/roots.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/backup-graph.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/compaction.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/data-worker.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/event-store.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/projection-port.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `src/application/view-models/records.ts` | Modify/extend | CP2: retained-history scope, empty state and count announcements paired with reader change |
| `tests/unit/view-models/records.test.ts` | Modify/extend | CP2: truthful retained-history scope and singular/plural/empty assertions |
| `src/ui/records/change-history-screen.tsx` | Modify/extend | CP2: truthful retained-history presentation, no post-checkpoint cutoff claim |
| `tests/unit/ui/records/change-history-screen.test.tsx` | Modify/extend | CP2: scope, counts, empty state, pagination and restore regressions |

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — Bounded complete-state checkpoint production

Read existing checkpoint codecs, toProjectionCheckpoint, projection hydration/replay and page-change-history. Implement background checkpoint export from an authenticated revision with all authored values/provenance, record/field identities, schema/rule/formula/chart/theme state, deleted restoration evidence and original lineage/baseline distinctions. Exclude TODAY/NOW and other calculated results. Preserve original committed events in encrypted audit evidence initially; storage reduction is secondary to truthful history. Do not invent a new migration or silently discard provenance that existing RecordPageV1 does not encode: add compatible encrypted payload fields/readers where established evolution permits; protected format changes route to DB with a demonstrated mismatch.

**Commit when:** Complete-state export/rehydration tests pass, including F02/F03 old checkpoint fixtures and F04 active/deactivated schema, deleted rows, two baselines and unsupported/frozen formula values; no consumer is pointed at new checkpoint yet.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Replay equivalence and atomic replacement

Build fresh in-memory projection from candidate checkpoint plus tail; compare canonical authored-state digest/frontier, history/restoration and current visible results against the original. Adjust chainState to use retained device-chain evidence at the checkpoint frontier; never derive next sequence from device-only count or just post-checkpoint events. Before swapping any pointer, feed retained audit-backed change-history and restore readers after replay in event-store/app-session/projection and application/queries/history.ts. This reconstruction belongs to CP2 because its equivalence gate needs it. In the same checkpoint update ChangeHistoryVm/selectChangeHistoryVm, change-history-screen.tsx and both paired tests: replace since-last-checkpoint scope/empty/count announcements with truthful retained authored-history meaning; do not invent pre-import events or F06 merge history. Preserve pagination, plural counts, table identity and restore affordances. Install new head/catalog only through existing compare-revision commit; retain backup-pinned roots and make old unreachable cleanup exact-ticket based. No crypto/network awaits inside Dexie transaction.

**Commit when:** Property tests prove two consecutive compactions and subsequent command append have unchanged history, correct previous commit hash and sequence. Crash before pointer swap preserves old graph; stale revision/epoch writes nothing; after swap reopen reconstructs equivalent state. Paired VM/screen tests pass for retained history, truthful count/empty announcements and pagination; presentation changes commit with their producer.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — Periodic scheduling and retained history integration

Schedule bounded idle compaction after a conservative internal threshold of 128 tail commits, then retry on next unlock when interrupted; threshold is a performance choice, not a loss/retention policy. Yield between pages and never await it from a save acknowledgement. Exercise the audit-backed change-history/restore readers and truthful VM/screen already landed in CP2 through the periodic trigger; no reader prerequisite is deferred from CP2. Preserve baselinePages, importLineages/originalBaselineStorageId, snapshots/source chunks and all current retention roots; no age-based pruning or remote GC in F05.

**Commit when:** Unit/browser tests cover history pagination, record delete→compact→restore, backup in flight plus edits plus compaction, and local quota refusal with old graph still usable. Actual compaction trigger runs; merely calling an uncomposed helper fails the checkpoint.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 4 — Compacted app remains usable and backs up end to end

Implement J3: seed through real app, make committed edits/delete/theme/chart changes, trigger real periodic mechanism using test threshold injection restricted to harness build, terminate/reopen worker, open the real history UI, assert retained pre-compaction entries, truthful scope/count/announcements and pagination, restore the deleted record through its UI action, save a fresh bundle and validate it with independent decoder state. Repair any discovered projection codec/port/fixture seams within lease, maintaining legacy assertions.

**Commit when:** pnpm typecheck, pnpm lint, pnpm test; pnpm test:browser sync/compaction and pnpm test:e2e compaction-backup pass under locks. Semantic digest stays equal across compaction, next edit increments exactly once, confirmed backup count remains correct. Orchestrator rechecks CA-35/36/41 before S07.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

## Verification

J3 specification in STATE.md. Unit: pnpm test tests/unit/workers/compaction.test.ts tests/unit/workers/event-store.test.ts tests/unit/queries/history.test.ts tests/unit/view-models/records.test.ts tests/unit/ui/records/change-history-screen.test.tsx tests/unit/staging/roots.test.ts tests/unit/projection tests/property/compaction. Browser: SHEAF_PW_PORT=<port> pnpm test:browser sync/compaction. E2E: same variable pnpm test:e2e compaction-backup. Harness owns threshold injection and controls the actual production scheduler; do not expose a release-only force-compaction/debug route. Browser uses real SQLite WASM, sodium, IndexedDB and worker, with fresh context, page shutdown/reopen and finally cleanup. Evidence test-results/f05/s06; 180s tests, 15m suite cap. Preserve the original replay baseline and audit for every deletion, not just current rows. First J1 stays current after the new checkpoint reader lands.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.

**Recheck after landing:** Orchestrator rechecks every directly dependent session in the dependency graph for constructor inputs, return-type assignability, account/frontier/digest meaning, actual transport and harness registration. Invalidate only affected evidence, retain historical outcomes, and amend provisional CA mappings before dispatch.
