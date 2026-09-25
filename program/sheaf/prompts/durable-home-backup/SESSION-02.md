# SESSION-02 — Create a vault and save the first encrypted bundle through the real app

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M01 M07 M08 M09 M12 M23 M24 M27 M30 M32 M33 M36 M37 M41 M42 M44 M46 M47 M51 M53 M54 M56 M60 M61
> **Depends on:** SESSION-01
> **Concurrent with:** —
> **Owns:** `src/application/commands/home-commands.ts`, `src/application/ports/backup.ts`, `src/application/ports/event-repository.ts`, `src/application/ports/file-save.ts`, `src/application/ports/projection.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/recovery.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/crypto/hash.ts`, `src/domain/model/events.ts`, `src/domain/model/ids.ts`, `src/import/staging/append.ts`, `src/import/staging/roots.ts`, `src/persistence/codecs/canonical-cbor.ts`, `src/persistence/projection/**`, `src/platform/file-save.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/bundle.ts`, `src/sync/protocol/frontier.ts`, `src/sync/protocol/publication.ts`, `src/sync/providers/bundle/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/recovery-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/bundle.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/fixtures/app.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/recovery-countdown.spec.ts`, `tests/fixtures/vaults/f05/generate.ts`, `tests/fixtures/vaults/f05/publication.ts`, `tests/unit/bootstrap/file-save.test.ts`, `tests/unit/bootstrap/lifecycle.test.ts`, `tests/unit/codecs/canonical-cbor.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/commands/home-commands.test.ts`, `tests/unit/crypto/hash.test.ts`, `tests/unit/domain/events.test.ts`, `tests/unit/domain/ids.test.ts`, `tests/unit/projection/**`, `tests/unit/staging/append.test.ts`, `tests/unit/staging/roots.test.ts`, `tests/unit/sync/bundle/**`, `tests/unit/sync/protocol/fixtures.test.ts`, `tests/unit/sync/protocol/frontier.test.ts`, `tests/unit/sync/protocol/publication.test.ts`, `tests/unit/ui/architecture.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/recovery-screen.test.tsx`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/recovery.machine.test.ts`, `tests/unit/workflows/reset.machine.test.ts`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`, `program/sheaf/mocks/local-recovery.html`, `src/application/workflows/unlock.machine.ts`, `tests/unit/workflows/unlock.machine.test.ts`, `program/sheaf/mocks/f05-vault-security.html`, `program/sheaf/mocks/f05-bundle-save.html`, `program/sheaf/mocks/f05-scratch-reminders.html`
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
| M08 | Crypto | `src/crypto/hash.ts` | Graph/hash/chain implementation and paired compatibility proof |
| M09 | Codecs | `src/persistence/codecs/` | Graph/hash/chain implementation and paired compatibility proof |
| M24 | Sync protocol | `src/sync/protocol/` | Graph/hash/chain implementation and paired compatibility proof |

## Context

The current library wire carries isScratch but no receipt; reset has no confirmed backup timestamp. Local app heads contain checkpoint/tail/source/snapshot/baseline refs. Home/pin writer and bounded exporter landed at CP1/2; native IO/file-save and encrypted receipt writer landed at partial CP3. Fallback delivery/confirmation, status readers and first real journey remain assigned here.

Approval reconciliation base `87a4278c7e9918e93158ba58ac7125bef20cca38`; earlier planning bases remain historical in PLAN-CHECK. No pending implementation recovery. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

Inherited CAP-05 countdown is required here at CP5, with real-route proof; it is not discharged by vault recovery.

CAP-39 and current-producer CAP-40 journey owned here; CAP-41 shared receipt producer. CAP-40 extension to S06 nonempty graphs remains required at S06 CP4. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-34, CA-35, CA-36, CA-37, CA-40. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Committed command boundary and remaining extension

Read `AppRuntime.saveBundle(appId: string): Promise<FileSaveOutcomeV1>` in `src/bootstrap/app-bootstrap.ts`, `prepareBundle`/`PreparedBundleV1.complete` in `src/workers/protocol/io-client.ts`, and `createBackupHandlers.connectBundle` in `src/workers/data/backup-handlers.ts`. These landed in partial CP3 d75830d. Use the dedicated control channel and `BundleIdentityV1` operation/app/home/artifact correlation; do not introduce the earlier illustrative page-RPC completeBundleSave command. CP3 may adapt the typed port/runtime callbacks and leased consumers together to carry transient delivery/confirmation state; exact future signatures are implementation outputs, not committed facts.

The data worker retains the authenticated snapshot frontier and artifact digest. Only native write+close or approved explicit post-delivery confirmation may complete the same live operation once. Missing operation, other session/app/home/artifact or replay fails without receipt advancement. An edit after capture does not invalidate the captured backup: preserve that newer edit as pending. Wrong secret never assigns a home. Vault-code review reads encrypted state while unlocked, never persists plaintext codes. CA-37 and SAVE-S02 below own the full extension and proof.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `src/application/commands/home-commands.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/application/ports/event-repository.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/ports/file-save.ts` | Modify/extend committed source | CP3: adapt terminal save contract/typed transient callbacks with all consumers; preserve native outcomes |
| `src/application/ports/projection.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/durability.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/view-models/library.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/records.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/security.ts` | Modify/extend | CP5: recovery remaining delay/expiry and reset receipt facts |
| `src/application/workflows/durability-services.ts` | Create (planned) | CP3: connect explicit confirmation to the same live save operation; CP4 complete journey composition |
| `src/application/workflows/durability.machine.ts` | Create (planned) | CP3: transient preparation/delivery/confirmation/error states; CP4 mounted journey |
| `src/application/workflows/import.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/reset.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/bootstrap/app-bootstrap.ts` | Modify/extend | CP3: own pending delivered-operation lifetime through confirmation/cancellation and teardown |
| `src/bootstrap/io-worker.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/domain/model/events.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/domain/model/ids.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/import/staging/roots.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/persistence/projection/**` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/platform/file-save.ts` | Modify/extend committed source | CP3: verified fallback delivery, temporary URL cleanup and explicit confirmation; native write/close preserved |
| `src/routes/app-area-hooks.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/app-runtime.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/durability-routes.tsx` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/guards.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/route-table.tsx` | Modify/extend | CP4: home routes; CP5: RecoveryRoute injects wiring.clock |
| `src/routes/schema-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/theme-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/sync/coordinator/bundle.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/providers/bundle/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/ui/durability/**` | Create (planned) | CP3: accepted save/confirmation UI; CP4 home/vault/save journey; CP6 recovery states |
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
| `src/workers/data/backup-graph.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/data/backup-handlers.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/data/catalog.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/event-store.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/home-state.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/data/import-handlers.ts` | Modify/extend | CP4: listLibrary receipt/count reader before J1 |
| `src/workers/data/record-event-payloads.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/record-handlers.ts` | Modify/extend | CP4: toSessionView and open/closed count readers before J1 |
| `src/workers/io.worker.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/io/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/client.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-channel.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-client.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-messages.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
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
| `tests/unit/bootstrap/file-save.test.ts` | Modify/extend committed source | CP3: native regression and fallback delivery/confirmation/failure/URL cleanup |
| `tests/unit/bootstrap/lifecycle.test.ts` | Modify/extend | CP3: pending confirmation invalidation on lock/pagehide/dispose and late result |
| `tests/unit/commands/fakes.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/commands/home-commands.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/domain/events.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/domain/ids.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/projection/**` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/staging/roots.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/sync/bundle/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/architecture.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/ui/durability/**` | Create (planned) | CP3: accepted confirmation/focus/cancel/error controls; CP4 complete vault/save UI |
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
| `tests/unit/workers/home-state.test.ts` | Modify/extend committed source | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
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
| `tests/unit/workflows/durability.test.ts` | Create (planned) | CP3: no confirmation before delivery, dismiss/timeout/stale no-change; CP4 journey integration |
| `tests/unit/workflows/fakes.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/import.machine.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/reset.machine.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `src/application/workflows/recovery.machine.ts` | Modify/extend | CP5: worker-authoritative ticking delay with cancellation and no retained secret |
| `tests/unit/workflows/recovery.machine.test.ts` | Modify/extend | CP5: controlled-clock countdown, expiry, no early service call and actor-stop regression |
| `src/ui/security/recovery-screen.tsx` | Modify/extend | CP5: render remaining delay and prevent retry until expiry |
| `tests/unit/ui/recovery-screen.test.tsx` | Create (planned) | CP5: new paired rendered countdown/disabled-submit regression |
| `tests/e2e/recovery-countdown.spec.ts` | Create (planned) | CP5: new real recovery route/worker throttle integration |

| `src/import/staging/append.ts` | Modify | CP1: honor the same backup head-retention decision as event-store in appendTable; preserve unpinned deletion |
| `tests/unit/staging/append.test.ts` | Modify | CP1: pinned/unpinned graph retention and safe release; preserve rejected append no-change |

## Historical lease revision r2 — Orchestrator 2026-09-24

First attempt returned at CP0 with no edits; Native CQwhv ended. Adds exactly the two paths above for the production CSV append head-deletion seam. Import handler/caller, catalog, event-store, home-state and backup tests are already leased. No active conflict. Backup retention must not insert incompatible workflow/cleanup payloads into import-only sweep lists; keep import cleanup contracts unchanged. CP1 owns the same pin decision across createEventStore and appendTable plus paired tests, before CP2 graph export. DEC-72/design boundaries unchanged.

| `src/application/ports/backup.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `src/sync/protocol/publication.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `src/sync/protocol/frontier.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `tests/unit/sync/protocol/publication.test.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `tests/unit/sync/protocol/frontier.test.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `tests/fixtures/vaults/f05/publication.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `tests/fixtures/vaults/f05/generate.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |
| `tests/unit/sync/protocol/fixtures.test.ts` | Modify | CP2: bounded publication contract/consumer or paired regression; preserve authentication/fixtures |

## Historical lease revision r3 — bounded publication correction

Native C9rR1 ended at CP0 with no edits; r2 append correction remains. Adds shared backup port/publication/frontier and exact paired consumer/fixture paths above. CA-35 bounded-processing readiness from S01 is stale: array graph input plus cloned ciphertext/decrypted payload maps accumulate the complete graph. S02 CP2 owns correction and a multi-batch negative control against eager loading; authenticate immutable pinned bytes across reads, retain cancellation/identity/rejection and deterministic fixture bytes. Include frontier traversal in bounded consumption. No live owner; S01 ended and later consumers wait. No protected format/schema/product change. CP1 may proceed independently; CP2 closes this correction before graph consumer acceptance.

| `src/crypto/hash.ts` | Modify | CP2: bounded incremental hash/canonical encoding and exact-byte regression |
| `tests/unit/crypto/hash.test.ts` | Modify | CP2: bounded incremental hash/canonical encoding and exact-byte regression |
| `src/persistence/codecs/canonical-cbor.ts` | Modify | CP2: bounded incremental hash/canonical encoding and exact-byte regression |
| `tests/unit/codecs/canonical-cbor.test.ts` | Modify | CP2: bounded incremental hash/canonical encoding and exact-byte regression |

## Historical lease revision r4 — bounded primitives

C4l0k ended after accepted CP1 03ee571; no CP2 edits. r4 adds hash.ts/canonical-cbor.ts plus paired tests. CP2 owns incremental hashing and bounded canonical encoding preserving exact canonical bytes, digest semantics and cancellation/errors; no hash-of-page-hashes. Chunk-boundary KATs, old encoder byte equivalence and eager-loading negative control required. Existing one-shot API/consumers stay compatible; connect through already-owned exporter/publication interfaces rather than gratuitous envelope port changes. r3 correction remains assigned CP2. Resume CP2, do not redo committed CP1. No author/migration change. No active ownership overlap.

## Graph correction receive — 2026-09-24

Resume base `87a4278c7e9918e93158ba58ac7125bef20cca38`: CP1 `03ee571`, CP2 `c7e6507`, partial CP3 `d75830d` accepted; no uncommitted implementation to recover. Earlier r4 patch and unaccepted arch are historical evidence only. Resume full CP3, not CP2. DEC-72 and Designer save/reminder fill `4c31ded` are accepted. GRAPH-CONTRACT exact DB input gates S06 only; J1 remains required before dependent fan-out.

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — Local home assignment and immutable backup snapshot

Accepted `03ee571`; retain the requirements below as regression history. Do not redo or recommit this checkpoint.

Read createDataWorkerHandler, createEventStore, openAppKey, loadApp and validateLocalCatalog. Build home-state codec and encrypted local.home-state storage; its catalog reference, existing app-key wrap and durable-home.assigned event commit atomically. Extend event union, encoder, projection handler and exhaustive tests together (migration 004 already permits the event). Wrong app/home or duplicate vault/account location writes nothing. Create a pinned backup snapshot before returning control to editing; replace event-store.ts immediate deletion of a head that an in-flight backup still references with retained-root/ticket handling. Home assignment ends scratch but does not fabricate a confirmed time.

**Commit when:** Home-assignment and snapshot-race tests pass, including pin current head → production CSV append → pinned graph still readable/current head advances → safe release cleanup; unpinned deletion and rejected append no-change remain true; old scratch catalogs decode unchanged; rejection leaves head/catalog/rows unchanged; typecheck and lint pass.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Complete current-producer graph, frontier and semantic-state projection

Accepted at `c7e6507`; preserve this checkpoint and its evidence. The following describes its required behavior for regression, not unfinished implementation. REPLAN-F05-GRAPH changes the producer boundary, not the complete-graph assertion: export every reachable object of every supported current-producer graph. STATE CA-35/41 graph mapping is normative. Current promotion/append/event writers emit or preserve empty local retained/conflict/audit lists. Nonempty branches have no accepted producer/reader contract yet; S06 owns those writers, readers, publication integration and proofs together before use, behind GRAPH-CONTRACT. No writer may start emitting them after S02 without that gate. Do not discard a reachable object or publish a partial candidate. An unsupported nonempty list must reject before publication or receipt mutation; preserve its head/bytes/pins for recovery, with no cleanup of rejected content. Do not identify arbitrary retained scopes by trying AAD enums, reading SHF1, or assuming every retained object is a head.

Finish the bounded BackupAppGraphV1/publication/frontier path, incremental hash and canonical encoder while preserving existing one-shot APIs, deterministic fixture bytes and rejection assertions. Keep only bounded payload batches plus necessary reference/identity metadata; do not move eager object collection upstream into pin/loadApp or downstream into publication. Export authenticated checkpoint/record pages, all covered import-chain evidence and strictly post-checkpoint tail, baselines, source/snapshot manifests and every chunk, plus the pinned source head retained in the remote manifest. This remote retained head has a known `app.head` scope/kind from the authenticated HomeState pin and catalog/app-key context; it is not evidence that arbitrary local retainedRoots have that role. AAD authentication and local plaintext-digest comparison precede remote reference construction. Frame revision/paddedBytes and ciphertext hash are distinct from head body hash and reconstructed authored-state hash.

Use real isolated projection hydration/replay for canonical authored state. Cover authored schema/rules/formulas/chart/theme, per-value provenance, baseline present/deleted/absent, lineages, deleted-record restoration and original source/snapshot roots; computed TODAY/NOW results remain excluded. Verify covered commit hashes/subject app/device/contiguity before deriving checkpointChains; never seed chain hashes from an unauthenticated DTO or frontier count. Tail evidence must extend the covered hash. Retaining the original head and covered segments in the graph is required even when the remote eventSegments list excludes covered commits.

Finish `ProjectionAuthoredStatePort` boundary coverage in `tests/unit/workers/projection-port.test.ts`, engine/worker wiring and cursor tests under `tests/unit/projection/`; preserve both-direction assertions for existing ports. Add structural assignability and executable cursor iteration/cancellation/failure tests for the proposed separate cursor. In `backup-handlers.ts` and `handlers.ts`, own the returned exporter key and projection/cursor lifecycle through completion, error, cancellation, pin release, lock, reset/session replacement and worker disposal. Direct `dispose()` by a test is insufficient: the production owner must close it. Prevent late reads/publication after closure, make disposal idempotent, and do not release storage while a live reader still needs it. Wire teardown before this checkpoint; CP3 owns the subsequent IO lifecycle integration.

**Commit when:** typecheck and lint pass; the GRAPH-S02 focused gate below passes, preserving fixture bytes, bounded multi-batch/eager-loading negative controls, complete current-graph omission/tamper checks, covered-chain provenance, cursor coverage and worker key/cursor cleanup. Pinned frontier/hash survive later edits; different authored state with equal row counts hashes differently. Each unsupported nonempty branch rejects with no publication/receipt/cleanup change. No success assertion for those branches is removed or replaced with rejection: their new positive proofs are assigned to S06 CP1/2/4. CP2 accepted evidence is 25 files/209 tests plus typecheck/lint, independently received; the earlier 178-test run is historical.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — IO worker, bundle writer and observable save outcomes

Preserve partial CP3 `d75830d`: IO worker constructor in bootstrap/io-worker.ts is wired through app-bootstrap and dedicated MessageChannels. Data worker supplies ciphertext and opaque references; IO has neither app keys nor record objects. Reuse import channel lifecycle patterns without widening the page RPC byte union. Bundle assembly writes footer then verifies the second pass before offering a Blob. Implement FileSavePort saved/cancelled/failed/unconfirmed outcomes; retained writable handles are forbidden. Browser save picker close can confirm its write; share/download only confirms what the platform actually reports. Apply approved DEC-72: on unobservable-save platforms deliver the verified bundle, then require explicit “I saved this bundle”; never infer durable success from a click, Blob creation, download start or share handoff. Correlate save completion to snapshot ID/hash/app/home and discard stale/replayed/wrong-app receipts.

CP3 remaining implementation is assigned here, inside the unchanged lease. Read `FileSavePort.save(blob: Promise<Blob>, signal: AbortSignal): Promise<FileSaveOutcomeV1>`, `createFileSavePort`, `AppRuntime.saveBundle`, `prepareBundle`/`PreparedBundleV1.complete`, `receiveBundle`, and `createBackupHandlers.connectBundle` before edits. At this base the no-picker branch returns `unconfirmed` immediately without delivery; bootstrap's `finally` aborts/disposes it. A later UI button cannot confirm that disposed operation. Implement verified-Blob delivery and a transient, operation-bound confirmation lifetime before final teardown. Keep preparation, delivery, awaiting confirmation, native saved, user-confirmed saved, cancelled, failed and interrupted states distinct; do not add a durable wire variant merely for UI state. The existing outcome union can remain the terminal port contract: transient awaiting-confirmation belongs in the leased workflow/UI and page composition, not an invented successful receipt. Any necessary typed port/runtime callback adaptations and their callers/doubles land together in this lease.

Use a browser download fallback with temporary object URL/anchor only after preparation verifies the artifact; clean temporary DOM/URLs on every terminal path. Delivery permits the confirmation question, not receipt advancement. Keep native picker invocation in the user gesture and native write+close confirmation. Wire the post-delivery action through `src/application/workflows/durability-services.ts`, `durability.machine.ts`, `src/routes/app-runtime.tsx`, `durability-routes.tsx` and `src/ui/durability/**` to the same pending `saveBundle` operation. CP3 owns this minimum confirmation UI and its tests; CP4 mounts/proves the complete home/save journey. Follow `f05-bundle-save.html` for copy, focus, cancellation, stale/error and pending-count states. “Not now”/Escape, delivery failure, preparation rejection, timeout, lock, reset, pagehide, dispose, replacement and stale/replayed/wrong-app/home/artifact confirmation cannot advance the receipt. Keep existing bounded transfer deadlines; timeout invalidates confirmation and requires a fresh save. No pending confirmation is silently restored as success after restart.

Retain only ciphertext/opaque identity in the page/IO path. `connectBundle` already validates operation/app/home/artifact and writes captured frontier/time atomically with pin release; reuse and test that enforcement. Confirmation of snapshot E after edit E+1 leaves E+1 pending. CP3 tests own transport/receipt/failure/lifecycle behavior; CP4 owns real-entry status/readers and restart. CP5 remains broader receipt/reset plus CAP-05 countdown, CP6 remains interrupted-pin recovery and vault-only full artifact recovery. No S06 nonempty producer or protected schema edit is a prerequisite.

**Commit when:** SAVE-S02 CP3 focused gate, typecheck, lint and build pass; fallback bytes are delivered before the real explicit-confirmation action can advance the matching receipt, and dismiss/failure/timeout/lifecycle cases prove no change. Bundle byte/offset/hash tests and IO boundary self-tests pass. Cancel, disk failure, lock and a forged or old completion leave confirmed frontier/time unchanged. No page or IO token message contains an app key.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 4 — First narrow journey: choose home, create vault, save, cold reopen

Implement SCR-038 and minimum SCR-039 using accepted `f05-vault-security.html` (58bffc8) and `f05-bundle-save.html` (4c31ded), with existing design inventory/atlases. MOD-022 remains local recovery reveal; use the vault-specific source for vault recovery. Save/reminder design-fill is closed; provider design is outside this checkpoint. Routes construct real durability services; vault choice uses separate labelled secrets and offers reuse by asking for the local secret again rather than retaining it. Create/show/acknowledge and re-view the separate vault recovery code. Apply confirmed frontier/time atomically only after the exact save outcome. Before J1, implement the minimum durable receipt/count readers in src/workers/data/app-session.ts, record-handlers.ts (toSessionView), import-handlers.ts (listLibrary), messages.ts and the leased library/records/durability view models and paired fixtures/tests. Read the persisted HomeState after unlock and distinguish absolute chain sequence from outstanding count. Render zero device-only changes only from these real readers; CP4 must not borrow CP5 work or fabricate a DTO. CP5 extends reset and broader surface coverage. Implement J1 in tests/e2e/bundle-backup.spec.ts: real setup/import/edit → choose bundle → vault → actual platform-boundary save → read saved bytes with production decoder → close page/open new page in same isolated context → local unlock → same record and backup facts.

**Commit when:** J1 passes under VB-02 with built revision evidence; tampered output fails authentication; local recovery code cannot unlock vault and vault code cannot unlock local root. DEC-72 and save/vault design prerequisites are resolved; J1 implementation and proof remain required.

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

### SAVE-S02 — approved fallback and confirmation (CP3), real-entry proof (CP4)

CP3 exact focused gate: `pnpm test tests/unit/bootstrap/file-save.test.ts tests/unit/bootstrap/lifecycle.test.ts tests/unit/workers/io.test.ts tests/unit/workers/backup-handlers.test.ts tests/unit/workers/home-state.test.ts tests/unit/sync/bundle/format.test.ts tests/unit/workflows/durability.test.ts tests/unit/ui/durability` plus `pnpm typecheck`, `pnpm lint`, `pnpm build`. Existing Vitest node/jsdom discovery covers these paths; workflow/UI tests are planned additions under the existing lease. Preserve native success/failure assertions and add fallback delivery before confirmation, no confirmation before verified delivery, explicit confirmation exactly once, dismiss/failure/timeout no-change, concurrent-edit remainder, and all lifecycle invalidation cases above. Keep MessageChannels, handlers, crypto and encrypted storage real; external destination doubles prove component behavior only. Close handles/stores in finally; reopen the same isolated fake-indexeddb store for receipt/no-change assertions. Unit deadlines use existing per-test bounds, controlled timers for the 300000ms timeout, never five-minute sleeps. Evidence under `test-results/f05/s02/save-confirmation` records exact source/diff/config/fixture identities, selectors/counts and results.

CP4 extends `tests/e2e/bundle-backup.spec.ts` and `tests/e2e/fixtures/durability.ts` with the actual no-picker download path: capture the emitted download and save bytes to isolated test output, assert receipt remains unchanged while awaiting confirmation, click the real “I saved this bundle” control, then assert captured-frontier count/time through real worker readers after page close/reopen in the same browser context. A separate dismiss case leaves the prior receipt unchanged after reopen. Include a new edit between capture and confirmation; only the captured frontier advances. Run `SHEAF_PW_PORT=<port> pnpm test:e2e bundle-backup --global-timeout 900000`; discovery must find the new cases. Only native destination is doubled in its separate case; fallback download and app UI/transport/storage are real. Build-before-preview, no reused server, artifact identity, production decoder checks, isolated storage and cleanup follow VB-02/J1. A test download capture is not OS durability evidence. All these source/test paths already belong to S02; dist/build and Playwright outputs remain serialized resources.

### GRAPH-S02 — CA-35 current-producer acceptance (CP2)

`pnpm test tests/unit/crypto/hash.test.ts tests/unit/crypto/module-boundaries.test.ts tests/unit/codecs/canonical-cbor.test.ts tests/unit/sync/protocol tests/unit/projection tests/unit/workers/backup-graph.test.ts tests/unit/workers/backup-handlers.test.ts tests/unit/workers/projection-port.test.ts tests/unit/workers/event-store.test.ts tests/unit/workers/handlers.test.ts tests/unit/workers/reset.test.ts tests/unit/workers/module-boundaries.test.ts tests/unit/staging/roots.test.ts tests/unit/staging/append.test.ts` then `pnpm typecheck` and `pnpm lint`. Vitest node project discovers these unit files; record selectors/counts and fail zero discovery. Use existing 120s KDF-worker test timeouts where applicable; abort blocked cursor reads with AbortController and close workers/stores in finally. No external provider or port required. Evidence: `test-results/f05/s02/graph-current` with source revision + working diff digest, selected counts and fixture digests. The c7e6507 run is accepted historical component evidence; a regression rerun after changed source is a new result and does not establish J1.

Production path: real import/append and home assignment through createDataWorkerHandler + MessageChannel, encrypted HomeState pin, backup.exportGraph, exportBackupGraph, real sodium/SQLite and publication builder. Unit storage uses isolated fake-indexeddb; close worker and reopen the same isolated database for pin/rejection persistence assertions, then delete it after all handles close. It does not establish native-browser persistence; J1 still does. Tamper/remove each reachable branch (record/baseline/source/snapshot/covered event), duplicate/substitute app/scope/kind/hash, and change reread bytes: reject with no receipt advance. Build nonempty retained/conflict/audit input only as authenticated adversarial fixtures for the compatibility guard, not purported valid new wire producers. Exercise abort before/within cursor read, thrown producer, double dispose, lock/reset/worker teardown and stale operation read; assert key destruction and no writes. S02 owns harness, fixtures, cursor/teardown and proof at CP2. S06's GRAPH-S06 owns positive nonempty graphs and reruns these assertions before pointer installation.

Inherited CAP-05 / CA-40 recovery proof (owner S02 CP5): run `pnpm test tests/unit/workflows/recovery.machine.test.ts tests/unit/view-models/security.test.ts tests/unit/ui/recovery-screen.test.tsx tests/unit/workers/handlers.test.ts` (existing node/jsdom discovery) and `SHEAF_PW_PORT=<port> pnpm test:e2e recovery-countdown`. Planned e2e file uses real `/` → RecoveryRoute → recoveryMachine → SecurityServices → RPC → data worker attempt limiter, not a mocked rate-limit response. Seed local protection with protectDevice in an isolated context; obtain a well-formed wrong code by protecting a second isolated context, then close the second context. Submit that other-device code until the existing worker policy produces a bounded delay, assert decreasing displayed seconds and disabled retry, then expiry and continued refusal of the wrong code; direct-worker unit assertions confirm premature attempts are still rejected without mutation. Follow with the correct local code and mandatory replacement passphrase. Use controlled-clock component tests for exact 4000→3000→0 and stop cleanup, and a bounded real-clock UI test (300s case, 15m suite cap) for the actual connection. No rate-limit policy changes or new persistent timer. Close pages/contexts/workers in finally; record current build/config identity under test-results/f05/s02. Existing route clock and worker authority survive unchanged; countdown is ephemeral on restart and the next worker response is authoritative.

J1 specification is STATE.md §Proof J1. New files under tests/browser/sync/fixtures adapt the existing built-worker harness pattern; browser proof imports production graph/bundle code and validates captured bytes. E2E uses real index.html, startApp, data.worker and new io.worker. Seed through protectDevice and importDemoWorkbook from existing fixtures; edit through records UI. Use a fresh Playwright context and its IndexedDB sheaf-local; page close then new page in the SAME context proves worker restart, not a fresh empty profile. Save picker is the sole deterministic external platform double when native picker automation is unavailable; retain the exact bytes and decode with real crypto. A separate real download case captures download.saveAs and must not itself assert save-confirmed until the real post-delivery “I saved this bundle” action confirms that exact operation under approved DEC-72. Record manual native save/share debt distinctly. Per-test timeout 180s (KDF tests 300s), action timeout 20s, suite cap 15m; close pages/context, terminate workers and preview in finally. Source/test harness outputs live in tests/browser/sync/fixtures, ignored built outputs in dist and evidence in test-results/f05/s02. Owns is the git-add lease; ignored outputs are locked resources, never git-added. Read-only snapshot loaders must use bounded batches, not all ciphertext in memory.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.

**Recheck after landing:** Orchestrator rechecks every directly dependent session in the dependency graph for constructor inputs, return-type assignability, account/frontier/digest meaning, actual transport and harness registration. Invalidate only affected evidence, retain historical outcomes, and amend provisional CA mappings before dispatch.
