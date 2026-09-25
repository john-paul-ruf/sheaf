# SESSION-02 — Create a vault and save the first encrypted bundle through the real app

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M01 M07 M12 M23 M27 M30 M32 M33 M36 M37 M41 M42 M44 M46 M47 M51 M53 M54 M56 M60 M61
> **Depends on:** SESSION-01
> **Concurrent with:** —
> **Owns:** `src/application/commands/home-commands.ts`, `src/application/ports/event-repository.ts`, `src/application/ports/file-save.ts`, `src/application/ports/projection.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/recovery.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/domain/model/events.ts`, `src/domain/model/ids.ts`, `src/import/staging/roots.ts`, `src/persistence/projection/**`, `src/platform/file-save.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/bundle.ts`, `src/sync/providers/bundle/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/recovery-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/bundle.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/fixtures/app.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/recovery-countdown.spec.ts`, `tests/unit/bootstrap/file-save.test.ts`, `tests/unit/bootstrap/lifecycle.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/commands/home-commands.test.ts`, `tests/unit/domain/events.test.ts`, `tests/unit/domain/ids.test.ts`, `tests/unit/projection/**`, `tests/unit/staging/roots.test.ts`, `tests/unit/sync/bundle/**`, `tests/unit/ui/architecture.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/recovery-screen.test.tsx`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/recovery.machine.test.ts`, `tests/unit/workflows/reset.machine.test.ts`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`, `program/sheaf/mocks/local-recovery.html`, `src/application/workflows/unlock.machine.ts`, `tests/unit/workflows/unlock.machine.test.ts`
> **Resources:** dist:build, playwright:output
> **Checkpoints:** 6

## Module Context

| ID | Module | Read | Why |
|---|---|---|---|
| M01 | Domain model | `program/sheaf/arch/M01-domain-model.md` | Contract, producer and boundary tests in this lease |
| M07 | Application ports | `program/sheaf/arch/M07-ports.md` | Contract, producer and boundary tests in this lease |
| M12 | Projection | `program/sheaf/arch/M12-projection.md` | Contract, producer and boundary tests in this lease |
| M23 | Staging | `program/sheaf/arch/M23-staging.md` | Contract, producer and boundary tests in this lease |
| M27 | Bundle adapter | `program/sheaf/arch/M27-bundle.md` | Contract, producer and boundary tests in this lease |
| M30 | Sync coordinator | `program/sheaf/arch/M30-sync-coordinator.md` | Contract, producer and boundary tests in this lease |
| M32 | Worker protocol | `program/sheaf/arch/M32-worker-protocol.md` | Contract, producer and boundary tests in this lease |
| M33 | Worker entries | `program/sheaf/arch/M33-workers.md` | Contract, producer and boundary tests in this lease |
| M36 | Workflows | `program/sheaf/arch/M36-workflows.md` | Contract, producer and boundary tests in this lease |
| M37 | View models | `program/sheaf/arch/M37-view-models.md` | Contract, producer and boundary tests in this lease |
| M41 | UI security | `program/sheaf/arch/M41-ui-security.md` | Contract, producer and boundary tests in this lease |
| M42 | UI library | `program/sheaf/arch/M42-ui-library.md` | Contract, producer and boundary tests in this lease |
| M44 | UI records | `program/sheaf/arch/M44-ui-records.md` | Contract, producer and boundary tests in this lease |
| M46 | UI schema | `program/sheaf/arch/M46-ui-schema.md` | Contract, producer and boundary tests in this lease |
| M47 | UI durability | `program/sheaf/arch/M47-ui-durability.md` | Contract, producer and boundary tests in this lease |
| M51 | Platform | `program/sheaf/arch/M51-platform.md` | Contract, producer and boundary tests in this lease |
| M53 | Bootstrap | `program/sheaf/arch/M53-bootstrap.md` | Contract, producer and boundary tests in this lease |
| M54 | Routes | `program/sheaf/arch/M54-routes.md` | Contract, producer and boundary tests in this lease |
| M56 | Unit tests | `tests/unit/` | Contract, producer and boundary tests in this lease |
| M60 | Browser tests | `tests/browser/` | Contract, producer and boundary tests in this lease |
| M61 | E2E tests | `program/sheaf/arch/M61-e2e-tests.md` | Contract, producer and boundary tests in this lease |

## Context

The current library wire carries isScratch but no receipt; reset has no confirmed backup timestamp. Local app heads already contain checkpoint/tail/source/snapshot/baseline refs, but no exporter, IO worker, home writer or file-save implementation exists. This session owns those missing constructors and the first real journey together.

Plan HEAD `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

Inherited CAP-05 countdown is required here at CP5, with real-route proof; it is not discharged by vault recovery.

CAP-39 and CAP-40 complete; CAP-41 shared receipt producer. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-34, CA-35, CA-36, CA-37, CA-40. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Planned command boundary

These are new command responsibilities owned here, not symbols claimed to exist at plan HEAD. Final request spellings must be reflected in CA-34–37 before S03 dispatch:

```ts
// Page-safe boundary: no key, provider token, frontier or arbitrary receipt supplied by UI.
type BundleIntent =
  | { kind: "prepareBundle"; appId: string }
  | { kind: "completeBundleSave"; operationId: string;
      outcome: "saved" | "cancelled" | "failed" | "unconfirmed" };
```

The data worker creates the operation ID and retains its authenticated app/home/vault, snapshot frontier and artifact digest. Completion is accepted only from the composed platform-save callback for that active operation, at most once, and only while the corresponding unlocked session remains live. The page cannot claim arbitrary counts, generations or hashes. DEC-72 controls any user-confirmed fallback, which must be distinguished from native write completion in evidence. Missing operation, other session/app/home, stale snapshot or replay fails without advancing a receipt. Wrong secret does not assign a home. Read/status operations are read-only; assignment uses the committed durable-home event kind. Vault-code review reads encrypted home state only while unlocked; never persist a plaintext review code for convenience.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `src/application/commands/home-commands.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/ports/event-repository.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/ports/file-save.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/ports/projection.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/durability.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/view-models/library.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/records.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/security.ts` | Modify/extend | CP5: recovery remaining delay/expiry and reset receipt facts |
| `src/application/workflows/durability-services.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/workflows/durability.machine.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/workflows/import.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/reset.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/bootstrap/app-bootstrap.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/bootstrap/io-worker.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/domain/model/events.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/domain/model/ids.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/import/staging/roots.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/persistence/projection/**` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/platform/file-save.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/app-area-hooks.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/app-runtime.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/durability-routes.tsx` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/guards.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/route-table.tsx` | Modify/extend | CP4: home routes; CP5: RecoveryRoute injects wiring.clock |
| `src/routes/schema-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/theme-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/sync/coordinator/bundle.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/providers/bundle/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/ui/durability/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/ui/library/library-screen.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/library/library.module.css` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/records/app-frame.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/records/app-home-screen.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/records/records.module.css` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/schema/app-settings-screen.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/security/recovery-codes-screen.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/security/reset-readable-screen.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/ui/security/vault-dialogs.tsx` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data.worker.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/app-session.ts` | Modify/extend | CP4: persisted receipt-relative count before J1; keep absolute chain sequence distinct |
| `src/workers/data/backup-graph.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/backup-handlers.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/catalog.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/event-store.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/home-state.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/import-handlers.ts` | Modify/extend | CP4: listLibrary receipt/count reader before J1 |
| `src/workers/data/record-event-payloads.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/record-handlers.ts` | Modify/extend | CP4: toSessionView and open/closed count readers before J1 |
| `src/workers/io.worker.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/io/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/client.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-channel.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-client.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-messages.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/messages.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/redact.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `tests/browser/projection/fixtures/projection.entry.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/projection/fixtures/projection.worker.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/sync/bundle.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/sync/fixtures/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/worker/app.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/worker/usage-journey.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/bundle-backup.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/app.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/durability.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/bootstrap/file-save.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/bootstrap/lifecycle.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/commands/fakes.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/commands/home-commands.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/domain/events.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/domain/ids.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/projection/**` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/staging/roots.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/sync/bundle/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/architecture.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/durability/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/library/fixtures.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/library/library-screens.test.tsx` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/records/app-home-screen.test.tsx` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/records/fixtures.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/records/route-guards.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/schema/harness.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/schema/settings.test.tsx` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/security-surfaces.test.tsx` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/shells.test.tsx` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/view-models/durability.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/view-models/library.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/view-models/records.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/view-models/security.test.ts` | Modify/extend | CP5: co-adapt every recovery actor constructor for ClockPort and assert remaining-delay/expiry meaning |
| `tests/unit/workers/backup*.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/catalog.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/chart-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/data-worker.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/event-store.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/handlers.test.ts` | Modify/extend | CP4/5: receipt/reset and direct premature recovery attempt rejection without mutation |
| `tests/unit/workers/home-state.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/import-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/io*.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/projection-port.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/protocol.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/query-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/record-event-payloads.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/redact.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/reset.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/structure-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/theme-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/durability.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/fakes.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/import.machine.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/reset.machine.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `src/application/workflows/recovery.machine.ts` | Modify/extend | CP5: worker-authoritative ticking delay with cancellation and no retained secret |
| `tests/unit/workflows/recovery.machine.test.ts` | Modify/extend | CP5: controlled-clock countdown, expiry, no early service call and actor-stop regression |
| `src/ui/security/recovery-screen.tsx` | Modify/extend | CP5: render remaining delay and prevent retry until expiry |
| `tests/unit/ui/recovery-screen.test.tsx` | Create (planned) | CP5: new paired rendered countdown/disabled-submit regression |
| `tests/e2e/recovery-countdown.spec.ts` | Create (planned) | CP5: new real recovery route/worker throttle integration |

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — Local home assignment and immutable backup snapshot

Read createDataWorkerHandler, createEventStore, openAppKey, loadApp and validateLocalCatalog. Build home-state codec and encrypted local.home-state storage; its catalog reference, existing app-key wrap and durable-home.assigned event commit atomically. Extend event union, encoder, projection handler and exhaustive tests together (migration 004 already permits the event). Wrong app/home or duplicate vault/account location writes nothing. Create a pinned backup snapshot before returning control to editing; replace event-store.ts immediate deletion of a head that an in-flight backup still references with retained-root/ticket handling. Home assignment ends scratch but does not fabricate a confirmed time.

**Commit when:** Home-assignment and snapshot-race tests pass; old scratch catalogs decode unchanged; rejection leaves head/catalog/rows unchanged; typecheck and lint pass.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Complete app graph, frontier and semantic-state projection

Implement the bounded authenticated graph exporter over checkpoint, tail, baseline, audit/conflict, source/snapshot manifests and their chunks, plus retained roots. Extend the projection port and implementation with the minimum deterministic authored-state cursor needed to calculate remote semantic hash; co-update both-direction assignability test and fakes. Never export SQLite bytes or volatile computed results. Include schema/rules/formulas/chart definitions/theme and provenance; preserve baseline absence and original lineage roots. Construct migration-006 references using authenticated-parent scope and expected payload-kind mapping, then authenticate each frame to obtain its revision/padded length and ciphertext hash; reject scope/kind substitution even when ID/dimensions/digest match. Build references and build a complete graph from the pinned revision while new edits remain possible.

**Commit when:** tests/unit/workers/backup-graph.test.ts and projection/port tests pass, including omission/tamper rejection and differing state with identical record counts. Exported frontier describes the pinned snapshot, not later edits.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — IO worker, bundle writer and observable save outcomes

Construct IO worker in bootstrap/io-worker.ts and wire it through app-bootstrap plus a dedicated MessageChannel. Data worker supplies ciphertext and opaque references; IO has neither app keys nor record objects. Reuse import channel lifecycle patterns without widening the page RPC byte union. Bundle assembly writes footer then verifies the second pass before offering a Blob. Implement FileSavePort saved/cancelled/failed/unconfirmed outcomes; retained writable handles are forbidden. Browser save picker close can confirm its write; share/download only confirms what the platform actually reports. Apply DEC-72 after user decision, never infer durable success from a click or Blob creation. Correlate save completion to snapshot ID/hash/app/home and discard stale/replayed/wrong-app receipts.

**Commit when:** Bundle byte/offset/hash tests and IO boundary self-tests pass. Cancel, disk failure, lock and a forged or old completion leave confirmed frontier/time unchanged. No page or IO token message contains an app key.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 4 — First narrow journey: choose home, create vault, save, cold reopen

Implement SCR-038 and minimum SCR-039 plus MOD-020/021/022/025 using design sources and DF-F05-1 where required. Routes construct real durability services; vault choice uses separate labelled secrets and offers reuse by asking for the local secret again rather than retaining it. Create/show/acknowledge and re-view the separate vault recovery code. Apply confirmed frontier/time atomically only after the exact save outcome. Before J1, implement the minimum durable receipt/count readers in src/workers/data/app-session.ts, record-handlers.ts (toSessionView), import-handlers.ts (listLibrary), messages.ts and the leased library/records/durability view models and paired fixtures/tests. Read the persisted HomeState after unlock and distinguish absolute chain sequence from outstanding count. Render zero device-only changes only from these real readers; CP4 must not borrow CP5 work or fabricate a DTO. CP5 extends reset and broader surface coverage. Implement J1 in tests/e2e/bundle-backup.spec.ts: real setup/import/edit → choose bundle → vault → actual platform-boundary save → read saved bytes with production decoder → close page/open new page in same isolated context → local unlock → same record and backup facts.

**Commit when:** J1 passes under VB-02 with built revision evidence; tampered output fails authentication; local recovery code cannot unlock vault and vault code cannot unlock local root. DEC-72 and design-fill must be resolved before this checkpoint.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 5 — Receipt readers, recovery and reset consequences

Keep CP4’s listLibrary, toSessionView and app-session receipt/count readers current; extend inventoryOf in handlers and security view models to the same confirmed HomeState fact. Do not change chainState semantics: keep absolute local commit sequence separate from count relative to a confirmed frontier. Closed app count and readable reset recompute from durable heads. Keep prior timestamp on a new edit; bundle becomes stale immediately. Add real readable-reset backup remedy and refresh inventory after save, with stale confirm token rejected. Preserve local passphrase-change and local recovery paths; neither changes the vault secret.

Close inherited CAP-05 countdown (PC-F05-02) here, not in a later feature. Read recovery.machine.ts and its test, unlock.machine.ts and its controlled-clock test as the existing pattern, selectRecoveryVm in security.ts, RecoveryRoute in route-table.tsx, recovery-screen.tsx, and worker handlers assertAttemptAllowed/refuseAttempt behavior before edits. Follow the existing ClockPort pattern: supply wiring.clock at RecoveryRoute, retain the worker-returned retryAfterMs as authority, compute remaining delay from a deadline, tick, clamp at zero, cancel the timer on state exit/stop, and refuse SUBMIT_CODE/RETRY while waiting. Handle both invalid-recovery-code with positive retryAfterMs and rate-limited errors; no client attempt schedule or durable countdown is introduced. Clear secret drafts after refusal. Extend the already leased security VM and its paired test for remaining delay and expiry; add the paired recovery-screen test and new real-entry recovery-countdown spec in this lease. Preserve mandatory replacement-passphrase installation and worker throttling: expiry enables another request, never authorizes an unlock.


**Commit when:** Bundle new-edit count = exactly one, confirmed time unchanged; cancelled new save keeps it one, accepted fresh save resets it to zero; cold reopen reproduces all three states. Reset inventory and library agree; stale reset token changes nothing. Controlled-clock machine/VM/UI checks prove 4000→3000→0, no early worker call, nonnegative expiry, cleanup on stop and no secret retention; the real-entry recovery countdown proof below passes while direct premature worker attempts remain refused.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 6 — Interrupted bundle recovery and complete user-facing delivery

Finish retry/cancel/failure states, lock teardown, no retained file handle, and responsive/keyboard behavior. Re-read output using only vault passphrase or its recovery code in fresh decoder state, verifying schema/theme/charts/snapshots/baselines and frontier without any local-root material. This is artifact recovery proof, not F06 adoption UI. Close byte leak and race counterexamples in production code; preserve prior good file on failure.

**Commit when:** pnpm typecheck, pnpm lint, pnpm test pass; SHEAF_PW_PORT=<port> pnpm test:e2e bundle-backup and pnpm test:browser sync/bundle pass under resource locks; all J1 assertions include saved output hash, current build ID and reopen evidence.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

## Verification

Inherited CAP-05 / CA-40 recovery proof (owner S02 CP5): run `pnpm test tests/unit/workflows/recovery.machine.test.ts tests/unit/view-models/security.test.ts tests/unit/ui/recovery-screen.test.tsx tests/unit/workers/handlers.test.ts` (existing node/jsdom discovery) and `SHEAF_PW_PORT=<port> pnpm test:e2e recovery-countdown`. Planned e2e file uses real `/` → RecoveryRoute → recoveryMachine → SecurityServices → RPC → data worker attempt limiter, not a mocked rate-limit response. Seed local protection with protectDevice in an isolated context; obtain a well-formed wrong code by protecting a second isolated context, then close the second context. Submit that other-device code until the existing worker policy produces a bounded delay, assert decreasing displayed seconds and disabled retry, then expiry and continued refusal of the wrong code; direct-worker unit assertions confirm premature attempts are still rejected without mutation. Follow with the correct local code and mandatory replacement passphrase. Use controlled-clock component tests for exact 4000→3000→0 and stop cleanup, and a bounded real-clock UI test (300s case, 15m suite cap) for the actual connection. No rate-limit policy changes or new persistent timer. Close pages/contexts/workers in finally; record current build/config identity under test-results/f05/s02. Existing route clock and worker authority survive unchanged; countdown is ephemeral on restart and the next worker response is authoritative.

J1 specification is STATE.md §Proof J1. New files under tests/browser/sync/fixtures adapt the existing built-worker harness pattern; browser proof imports production graph/bundle code and validates captured bytes. E2E uses real index.html, startApp, data.worker and new io.worker. Seed through protectDevice and importDemoWorkbook from existing fixtures; edit through records UI. Use a fresh Playwright context and its IndexedDB sheaf-local; page close then new page in the SAME context proves worker restart, not a fresh empty profile. Save picker is the sole deterministic external platform double when native picker automation is unavailable; retain the exact bytes and decode with real crypto. A separate real download case captures download.saveAs and must not itself assert save-confirmed unless DEC-72 permits confirmation. Record manual native save/share debt distinctly. Per-test timeout 180s (KDF tests 300s), action timeout 20s, suite cap 15m; close pages/context, terminate workers and preview in finally. Source/test harness outputs live in tests/browser/sync/fixtures, ignored built outputs in dist and evidence in test-results/f05/s02. Owns is the git-add lease; ignored outputs are locked resources, never git-added. Read-only snapshot loaders must use bounded batches, not all ciphertext in memory.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.

**Recheck after landing:** Orchestrator rechecks every directly dependent session in the dependency graph for constructor inputs, return-type assignability, account/frontier/digest meaning, actual transport and harness registration. Invalidate only affected evidence, retain historical outcomes, and amend provisional CA mappings before dispatch.
