# State Tracker — Sheaf / durable-home-backup

## Program / Feature / Intent / Sessions

- Program: Sheaf; existing repository-relative root `program/sheaf/` (the config's `/program/sheaf/` is its logical path, not a new filesystem root).
- Feature: F05 `durable-home-backup`; FR-24–28, flows 4/5, with local/vault recovery distinction from FR-23 and provider isolation from FR-21.
- Intent: make a scratch app recoverable as an encrypted bundle or provider vault, expose confirmed backup truth and reminders, and compact history without losing reconciliation or restoration facts.
- Original plan revision: `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`, 2026-09-24. Seven sessions, 28 checkpoint commits planned (3+6+4+3+3+4+5). Replan base `309313170b997d2546794c6173ebcabfbd44ac5f`: S01 done; S02 CP1 03ee571 and CP2 c7e6507 accepted after independent receive checks.
- User instruction `plan feature f05` authorizes F05 planning despite the previous roadmap planning gate. It is not evidence that a demo was viewed and does not silently resolve the F04 review debt.
- Approval-reconciliation base: `87a4278c7e9918e93158ba58ac7125bef20cca38`; source identities and actual scoped checks in PLAN-CHECK.
- Readiness: S01/S02/S03 done, accepted through implementation47a633b; inherited independent typecheck/lint,2461unit+11browser passes remain current for those sources. Author GRAPH-CONTRACT supplied/accepted at afe37f3. S06 pending implementation0/4; scoped PLAN-REVIEW-GRAPH-APPROVED received and its codec seam assigned lease r2; candidate/installed/J3 proofs planned, not verified. S04/S05 blocked registrations; S07 blocked provider and S06 proofs. Provider design98ee79c remains ready.

## Resume authorization — 2026-09-24

User: “i trust youyr recommendations”. This approves the three recommendations already presented: DEC-71 first authored change then 10m/1h/24h/daily after successive dismissals; DEC-72 explicit “I saved this bundle” after delivery on unobservable-save platforms; GRAPH-CONTRACT recommended typed retained references plus bounded conflict/audit pages with explicit backward-reader/version rules. Historical questions and handoffs below remain verbatim. No provider registration, account, live qualification or demo verdict is inferred. Direction approval was followed by explicit DB/Author re-entry authorization; exact Author input is now committed at afe37f3. No graph product question remains; implementation/proofs remain S06. Save/reminder design fill is accepted at 4c31ded; S02 and S03 are now accepted; do not redispatch them. FINAL-REPORT.md records the prior continuation boundary; its exact-graph-input paragraph is superseded by this accepted source. Report refresh belongs to Orchestrator and is outside this plan lease.

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| S01 | Vault keys and authenticated transport contracts | M07 M08 M09 M24 M56 M57 M59 M62 | `src/application/ports/backup.ts`, `src/application/ports/durable-home.ts`, `src/application/ports/vault-crypto.ts`, `src/crypto/**`, `src/persistence/codecs/vault.ts`, `src/sync/protocol/**`, `tests/fixtures/vaults/f05/**`, `tests/property/sync/**`, `tests/provider-contract/shared/**`, `tests/unit/codecs/vault.test.ts`, `tests/unit/crypto/**`, `tests/unit/sync/protocol/**` | done | 3/3 | 2026-09-24 | CP1 694c741, CP2 13e83f1, CP3 8674766; producer contribution accepted, composed proofs remain S02/S06 |
| S02 | Create a vault and save the first encrypted bundle through the real app | M01 M07 M08 M09 M12 M23 M24 M27 M30 M32 M33 M36 M37 M41 M42 M44 M46 M47 M51 M53 M54 M56 M60 M61 | `src/application/commands/home-commands.ts`, `src/application/ports/backup.ts`, `src/application/ports/event-repository.ts`, `src/application/ports/file-save.ts`, `src/application/ports/projection.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/recovery.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/crypto/hash.ts`, `src/domain/model/events.ts`, `src/domain/model/ids.ts`, `src/import/staging/append.ts`, `src/import/staging/roots.ts`, `src/persistence/codecs/canonical-cbor.ts`, `src/persistence/projection/**`, `src/platform/file-save.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/bundle.ts`, `src/sync/protocol/frontier.ts`, `src/sync/protocol/publication.ts`, `src/sync/providers/bundle/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/recovery-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/bundle.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/fixtures/app.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/recovery-countdown.spec.ts`, `tests/fixtures/vaults/f05/generate.ts`, `tests/fixtures/vaults/f05/publication.ts`, `tests/unit/bootstrap/file-save.test.ts`, `tests/unit/bootstrap/lifecycle.test.ts`, `tests/unit/codecs/canonical-cbor.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/commands/home-commands.test.ts`, `tests/unit/crypto/hash.test.ts`, `tests/unit/domain/events.test.ts`, `tests/unit/domain/ids.test.ts`, `tests/unit/projection/**`, `tests/unit/staging/append.test.ts`, `tests/unit/staging/roots.test.ts`, `tests/unit/sync/bundle/**`, `tests/unit/sync/protocol/fixtures.test.ts`, `tests/unit/sync/protocol/frontier.test.ts`, `tests/unit/sync/protocol/publication.test.ts`, `tests/unit/ui/architecture.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/recovery-screen.test.tsx`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/recovery.machine.test.ts`, `tests/unit/workflows/reset.machine.test.ts` | done | 6/6 | 2026-09-25 | CP1 03ee571, CP2 c7e6507, CP3 a93a87c, CP4 7b1bb58, CP5 f978eb3, CP6 7ee5ce8; corrections2cd5ad4/823012b accepted; independent full unit2438 and four browser proofs pass |
| S03 | Scratch reminders and consistent backup status at every entry | M05 M32 M33 M36 M37 M42 M44 M47 M54 M56 M61 | `src/application/commands/chart-commands.ts`, `src/application/commands/schema-commands.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/schema.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/records-services.ts`, `src/application/workflows/reset.machine.ts`, `src/application/workflows/schema-services.ts`, `src/application/workflows/theme-services.ts`, `src/domain/policy/**`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data/app-session.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/data/structure-handlers.ts`, `src/workers/protocol/client.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/append-import.spec.ts`, `tests/e2e/backup-status.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/charts.spec.ts`, `tests/e2e/dark-semantics.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/fixtures/records.ts`, `tests/e2e/fixtures/structure.ts`, `tests/e2e/fixtures/workbook.ts`, `tests/e2e/gate-f02-demo.spec.ts`, `tests/e2e/gate-f04-demo.spec.ts`, `tests/e2e/offline-guard.spec.ts`, `tests/e2e/records-crud.spec.ts`, `tests/e2e/relationships.spec.ts`, `tests/e2e/scratch-reminders.spec.ts`, `tests/e2e/structure.spec.ts`, `tests/e2e/theme.spec.ts`, `tests/e2e/workbook-import.spec.ts`, `tests/unit/policy/**`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/schema/structure-screen.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/schema.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/chart-services.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/records-services.test.ts`, `tests/unit/workflows/reset.machine.test.ts`, `tests/unit/workflows/schema-services.test.ts`, `tests/unit/workflows/theme-services.test.ts` | done | 4/4 | 2026-09-25 | CP1 59caafb, CP2 a016752, CP3 d8b4e14, CP4 47a633b; independent2461unit+11browser, typecheck/lint0; no-op counterexample closed |
| S04 | Dropbox App Folder backup transport | M25 M56 M62 | `src/sync/providers/dropbox/**`, `tests/provider-contract/dropbox/**`, `tests/unit/sync/dropbox/**` | blocked | — | — | Requires S01/S02 and INPUT-DROPBOX before live premise; no configured provider claim |
| S05 | OneDrive App Folder backup transport | M26 M56 M62 | `src/sync/providers/onedrive/**`, `tests/provider-contract/onedrive/**`, `tests/unit/sync/onedrive/**` | blocked | — | — | Requires S01/S02 and INPUT-ONEDRIVE; CA-38 conditional-write qualification |
| S06 | Compact encrypted history without losing restart or restoration | M07 M09 M12 M23 M24 M27 M33 M35 M37 M44 M56 M57 M59 M60 M61 | `src/application/ports/backup.ts`, `src/application/ports/projection.ts`, `src/application/queries/history.ts`, `src/application/view-models/records.ts`, `src/import/staging/append.ts`, `src/import/staging/cleanup.ts`, `src/import/staging/roots.ts`, `src/persistence/codecs/event-commit.ts`, `src/persistence/codecs/vault.ts`, `src/persistence/projection/**`, `src/sync/protocol/frontier.ts`, `src/sync/protocol/publication.ts`, `src/sync/providers/bundle/reader.ts`, `src/ui/records/change-history-screen.tsx`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/compaction.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/bundle.spec.ts`, `tests/browser/sync/compaction.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/browser/worker/runtime.ts`, `tests/e2e/append-import.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/compaction-backup.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/gate-f02-demo.spec.ts`, `tests/e2e/records-crud.spec.ts`, `tests/fixtures/vaults/f05/compaction/**`, `tests/fixtures/vaults/f05/generate.ts`, `tests/fixtures/vaults/f05/publication.ts`, `tests/property/codecs/event-commit.test.ts`, `tests/property/compaction/**`, `tests/unit/codecs/event-commit.test.ts`, `tests/unit/codecs/vault.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/projection/**`, `tests/unit/queries/history.test.ts`, `tests/unit/staging/append.test.ts`, `tests/unit/staging/cleanup.test.ts`, `tests/unit/staging/roots.test.ts`, `tests/unit/sync/bundle/reader.test.ts`, `tests/unit/sync/protocol/fixtures.test.ts`, `tests/unit/sync/protocol/frontier.test.ts`, `tests/unit/sync/protocol/publication.test.ts`, `tests/unit/ui/records/change-history-screen.test.tsx`, `tests/unit/view-models/records.test.ts`, `tests/unit/workers/backup-app-session.test.ts`, `tests/unit/workers/backup-graph.test.ts`, `tests/unit/workers/backup-handlers.test.ts`, `tests/unit/workers/backup-recovery.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/compaction.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts`, `tests/unit/workers/record-event-payloads.test.ts` | in-progress | — | — | 0/4;23-file partialCP1 preserved24d6b6d895d6; Author91ad694 and reviewA-j3X ready; lease r4 instructionr6 resumed |
| S07 | Connect cloud homes and confirm automatic backups without blocking local work | M07 M24 M25 M26 M29 M30 M32 M33 M36 M37 M47 M50 M51 M53 M54 M56 M60 M61 M62 M64 | `docs/provider-setup.md`, `index.html`, `package.json`, `playwright.config.ts`, `pnpm-lock.yaml`, `src/application/ports/backup.ts`, `src/application/ports/durable-home.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/config/public-config.ts`, `src/main.tsx`, `src/platform/provider-auth.ts`, `src/platform/provider-fetch.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/**`, `src/sync/protocol/**`, `src/sync/providers/dropbox/**`, `src/sync/providers/onedrive/**`, `src/sync/scheduler/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/vite-env.d.ts`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/sync/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/backup-status.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/cloud-backup.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/fixtures/no-network.ts`, `tests/e2e/fixtures/provider.ts`, `tests/e2e/gate-f05-demo.spec.ts`, `tests/provider-contract/dropbox/**`, `tests/provider-contract/onedrive/**`, `tests/provider-contract/shared/**`, `tests/security/f05/**`, `tests/unit/bootstrap/**`, `tests/unit/config/**`, `tests/unit/sync/**`, `tests/unit/toolchain.smoke.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/reset.machine.test.ts`, `vite.config.ts`, `vitest.config.ts` | blocked | — | — | Requires all predecessors; integrates actual configuration/token/worker/scheduler path |

## Wave Plan

| Wave | Sessions | Why concurrent |
|---|---|---|
| 0 | Scoped PLAN-REVIEW-GRAPH-APPROVED under Orchestrator | All F05 design inputs and exact graph Author input supplied. Review current S06 mapping/lease/harness before dispatch; no new human decision. |
| 1 | S01 | Produces actual vault/transport contract required by every consumer. |
| 2 | S02 | First connected bundle journey; owns shared worker, projection and UI composition. No fan-out until J1 passes. |
| 3 | S03 | Takes S02 shared status/worker/UI paths and paired tests; must finish reminder fixture adaptations before later browser acceptance. |
| 4 | S04 / S05 / S06 (source-disjoint; resources serialize) | Dropbox directory/tests, OneDrive directory/tests, and local compaction paths/tests are literally disjoint. Their dist:build and playwright:output full-session reservations overlap, so dispatch serially under current envelopes; concurrency requires a reviewed output-isolation envelope, not just different ports. Provider sessions need their protected registration input. S06 may proceed alone if provider inputs are absent, after scoped review; GRAPH-CONTRACT and S02/S03 inputs are supplied. |
| 5 | S07 | Takes provider directories/tests and shared composition paths serially; needs both adapter contracts and compacted graph semantics. |

No other pair is declared concurrent. A session in a wave waits only for its explicit dependencies and input readiness; a blocked provider does not block S06. S06 now serially owns the backup graph port/frontier/publication contract and paired fixtures after S02/S03; S04/S05 do not write them or construct publication candidates. Provider durable-home port and S02 IO protocol remain read-only in this wave. S06 changes no cloud provider port/adapter; its bundle reader is explicitly leased. Shared assertions are in the producer lease or the explicitly serialized consumer lease; no stub-retirement window is permitted.

## Dependency Graph

`S01 → S02 → S03 → S06 → S07`; `S02 → S04 → S07`; `S02 → S05 → S07`; `S01 → S04,S05`.

Serial handoffs carry tests too:
- Crypto/hash/canonical primitives: S01 → S02 CP2 bounded correction; shared backup port/frontier/publication and paired fixtures: S01 → S02 → S06 → S07. S04/S05 do not write these paths.
- Worker data/catalog/event-store, page messages, security error maps and worker tests: S02 → S03 → S06 (only explicit subset) → S07.
- Projection/port, roots codec, projection unit tests/fixtures and assignability/fakes: S02 → S06.
- Routes, durability UI, library/records VM and UI/unit/e2e fixture tests: S02 → S03 → S06 (records/history plus explicit durability decoder/append fixtures) → S07. Recovery machine/screen/countdown proofs belong to S02 CP5; later consumers read them.
- IO worker/channel/bootstrap and platform save: S02 → S07 (save implementation remains read-only unless an explicit lease amendment is needed).
- Each provider adapter and its unit/live fixture paths: S04/S05 → S07.
- Root package/lock/build/runner configs: S07 only. S01–S06 new tests deliberately use existing discovered locations; no new package is needed.

## Architecture Reference

Keys and local persistence stay in data.worker; IO worker handles ciphertext/OAuth/provider tokens and never sees an app key or records. Page-side save/auth UI has only user-entered secrets transiently, opaque operation identifiers and ciphertext artifact handles. Data↔IO uses dedicated transferable MessagePorts; the page view-model protocol stays free of byte/key/token fields.

Migration 006 fixes wire format and migration 003 fixes frame/AAD fields. Those files are read-only. New local home/scheduler/reminder payloads use existing encrypted `local.home`/`local.workflow` scopes. Public provider config is supplied at build time. F05 implements the necessary egress guard with first egress; F08 still owns release-wide hardening.

Per-module detail files are in `program/sheaf/arch/`. `IMPORT-EDGES.md` contains AST-derived file evidence at plan HEAD; PROGRAM-CONFIG distinguishes [R] and [D]. Expected but absent edges remain declared, not realized. M33 lease paths are explicit entry/data/io paths, never `src/workers/**` including protocol by accident.

## Scope Summary

| Modules | F05 change | Boundary |
|---|---|---|
| M07/M08/M09/M24 | vault keys, canonical graph, immutable publication and ports | No migration edits; local key/codec KATs preserved |
| M12/M23/M33/M35 | graph export, checkpoint/authored-state digest, receipts, counts, compaction/history | No loss of original source/snapshot/baseline/restoration evidence |
| M25/M26/M27/M29/M30 | bundle + two provider transports + push/scheduling | F06 owns adoption UI and divergent merge; failed CAS cannot overwrite |
| M05/M32/M36/M37/M41/M42/M44/M46/M47/M51/M53/M54 | reminders, recovery, status/remedies and actual composition | Protected design sources; Google Drive/iCloud not offered |
| M50/root configs | validated public registration, CSP/fetch, runner discovery | No credentials, backend or vendor SDK added by default |
| M56/M57/M59/M60/M61/M62/M64 | KAT/property/worker/real-entry/provider/egress proofs | Live provider and native-platform qualification reported separately |

### Inspected inheritance and dispositions

Canonical inherited record: F04 STATE/FINAL-REPORT plus `.program/ledger.md`, `.program/blockers.md`, `.program/decisions.md`, `program/sheaf/ROSHI-LOG.md` and `.program/results/ARCHIVIST-FINAL.result.md`. Their latest passing evidence is at 5bc19fb, not the older demo revision 3cdf1e7. The report opening says two capabilities have partial entry proof while the corrected completion table says all CAP-28–38 verified; retain the explicitly named proof limits (canvas click, non-OOXML formats, real Excel, capacity and visuals), not a blanket full-parity inference.

`INHERITED-RECONCILIATION.md` preserves every F04 follow-up ledger row and its current disposition by reference. Its assigned records.ts copy fix belongs to S03 CP3/CA-40; checkpoint-reader tightening belongs to S02 CP2/S06 CP1/CA-35/41. Exhaustive file lists, error maps, test doubles and codec pairing are leased from first producer checkpoint. F06/F07 and F04-review obligations retain named owners and resumption conditions; no competing backlog is created.

Original-plan gaps are now closed for S01 and S02 current-producer behavior: complete bounded graph, native and explicit fallback save, receipt/count/status readers, mounted J1, reset/countdown and vault-only recovery are committed and independently proved at823012b. All-held-device pending counts were corrected2cd5ad4. Reminder producer/proofs accepted47a633b; nonempty compaction graph S06 has accepted Author input afe37f3 and needs implementation/proof; provider registrations remain absent. Historical earlier gaps are preserved in handoffs, not current prerequisite claims.

**Inspection limits:** no live provider account/registration was supplied or contacted; no native platform-save result or current visual parity was observed. F04 screenshots and real-Excel input remain unavailable review evidence. Primary provider docs were inspected, but do not establish browser CORS or race semantics on a live account. Broader F04 history is retained by reference; no claim of independently re-running its 2339/141/71 tests is made.

## Design Decisions

| ID | Choice / status | Rationale and owners |
|---|---|---|
| DEC-66 | Existing stack and repository-relative program root retained | Config is authoritative; no stack redetection or package installation. |
| DEC-67 | User authorizes F05 planning, no fabricated demo verdict | Record explicit instruction; inherited product decisions remain with their existing owners. |
| DEC-68 | Bundle first; real index.html→RPC→workers→file boundary→encrypted receipt→restart | Earliest complete capability needs no provider account and exposes missing graph/count semantics early. S02 CP4. |
| DEC-69 | Preserve local storage hash semantics; add separate canonical authored-state proof | Existing app-head hash covers references. A different remote semantic hash is not evidence that old local data is corrupt. S02 graph exporter, S06 equivalence. |
| DEC-70 | CAS divergence fails closed until F06; no scope/permission expansion | F05 push never invents reconciliation. Same-vault unaffected entries/markers preserved. S07; F06 owns actual merge/resume after divergent writers. |
| DEC-71 | **Approved by user 2026-09-24** | Approved schedule: immediate after first authored change; after successive dismissals no sooner than 10m, 1h, 24h, then daily while scratch. Design accepted 4c31ded. S03 producer59caafb and query/dismissal a016752 landed; independent current J2 at47a633b passed every required interval/restart/negative-control assertion. |
| DEC-72 | **Approved by user 2026-09-24** | Approved fallback: on a platform without observable saved completion, require explicit “I saved this bundle” after delivery. Download start/share handoff alone never confirms. Design accepted 4c31ded; S02 CP3 owns delivery, pending confirmation and lifecycle/no-change tests; CP4 real-entry J1. Native partial CP3 d75830d preserved historically; full fallback CP3a93a87c and current J1 at47a633b accepted. |
| DEC-73 | Cloud debounce1500ms; S06 periodic idle check1500ms and128 post-checkpoint commits | Reversible performance defaults, no retention/policy change. Private component timer/threshold injection only; J3 uses actual production defaults and fresh real-clock worker. S06/S07. |
| DEC-74 | No remote garbage collection or age-based baseline pruning | Narrowest reversible implementation of immutable backup; retain exact reachable roots. This does not defer compaction or history read support. S06. |
| DEC-75 | No automatic schema migration invented | Existing encrypted payload evolution follows F04 convention. If new durable constraints are required, DB re-entry receives demonstrated reader/writer mismatch and regression, before dependent dispatch. |
| DEC-76 | Opaque ports frozen before independent provider workers | S01 actual symbols replace sketches in CA at receive; shared correction belongs to serialized owner, never concurrent self-widening. |
| DEC-77 | Scope M05 by approved feature | Backup/reminder policy in F05; removal and capacity policy remain F07, account adoption/merge policy F06. “M05 complete” in roadmap does not authorize unrelated features. |

Graph sequencing decision (REPLAN-F05-GRAPH): S02 proves the complete graph current producers can emit; S06 co-owns nonempty producer/reader/gate before pointer use. This reversible checkpoint boundary preserves all required positive proofs. Exact nonempty graph wire/version/backward-reader specification is accepted at afe37f3. CA-35/41 agreements are agreed; implementation mappings remain provisional against S06 CP1/2 and their proofs remain planned.

## Approval planning review disposition — current closure

Scoped read-only Archivist AO6jT reviewed plan9749c76 and implementationd75830d at the approval boundary. Both findings are now closed: F05-APPROVAL-01 actual-worker mechanism planned37303ce, implementeda016752, independently proved47a633b; F05-APPROVAL-02 pending-policy arch text superseded70f640c and reconciled3ea3606. S02 completed all six checkpoints and S03 all four. The original reviewed source/results remain in raw handoffs; their lack of J1 at that time is historical, not current readiness. Current verification is223files2461unitpass3skips, typecheck/lint0 and11composed browserpass at47a633b. No new policy input is pending; future nonempty/provider proofs remain separately assigned.

## Verification Baseline

### VB-01 — effective local commands and evidence

Source: package.json, pnpm-lock.yaml, tsconfig.json/tsconfig.node.json, vitest.config.ts, eslint.config.js at plan HEAD. pnpm path `/Users/the.phoenix/.nvm/versions/node/v24.20.0/bin/pnpm` = 10.15.0; Node at sibling `/node` = v24.20.0; local Playwright executable resolves through node_modules/.bin/playwright = 1.63.0. `pnpm exec playwright test --help` was also inspected and confirms --config, --list and --global-timeout. No vendor CLI is used; provider identity is HTTP endpoint/API+registration/scope, not a made-up version.

| Command | Effective scope | Evidence at planning | Execution constraint / owner |
|---|---|---|---|
| `pnpm typecheck` | both source/tests TS project and root tool configs | **actual pass**, exit 0 at plan HEAD | 2m cap; each checkpoint |
| `pnpm lint` | eslint . with checked-in exclusions | inherited exit 0 @ 5bc19fb; not rerun here | 2m cap; each checkpoint |
| `pnpm test` | Vitest node tests/unit+tests/property, jsdom UI/bootstrap | inherited 197 files / 2339 pass / 3 skipped @ 5bc19fb | 10m cap; feature affected checkpoint/full close; no bare `--` filters |
| `pnpm test tests/unit/workers/catalog.test.ts tests/unit/workers/event-store.test.ts tests/unit/workflows/module-boundaries.test.ts tests/unit/config/public-config.test.ts` | actual current producers/pins/config | **actual 4 files / 47 pass**, 340ms, exit 0 | Already run; not a backup proof |
| `pnpm exec playwright test --list` | configured browser and e2e discovery, no server launch | **actual 212 tests / 46 files**, exit 0 (141 browser + 71 e2e) | 1m cap; after adding new specs ensure nonzero discovery |
| `pnpm build` | Vite production index + harness output to dist | inherited pass @ 5bc19fb | dist:build lock, 3m cap |
| `pnpm verify` | typecheck→lint→test→build | not rerun; inherited component results | Includes build: requires dist lock; never run concurrently with preview |

Vitest does not discover tests/provider-contract or tests/security by default. S01/S04/S05 put executable self-tests in tests/unit and import outside fixture data. S04/S05 own independent --config live-probe runners in their leased provider directories before CP0, with build/isolation/negative-control tests. S07 owns shared runner discovery changes, root manifests/lock if needed, negative controls and default-off live project. Tests must assert expected test counts/selectors; empty selection cannot satisfy a gate.

No known current hang was found in inspected F04 summaries; this statement is limited to those sources. Three inherited skipped tests stay skipped debt, not passed checks. F04 transient owner-seam reds and one unidentified non-recurring failure were closed by later full runs; no repeated broad rerun is required to reconfirm them. Shared dist/Playwright output collisions remain a scheduling hazard, not a closed issue.

### VB-02 — browser launch, isolation and artifact evidence

`SHEAF_PW_PORT=<envelope port> pnpm test:browser <filter>` and `... pnpm test:e2e <filter>` (no bare `--`). playwright.config.ts webServer runs `pnpm build && pnpm preview --port <port> --strictPort`, reuseExistingServer=false, startup cap 180s. S07's new provider project must preserve this behavior. Build emits dist/index.html and dist/harness.html; real-entry tests use `/`, never harness.html. `window.__sheafBuildId` is defined by vite.config.ts from HEAD (or explicit SHEAF_BUILD_ID); compare it to the intended revision and record effective public config digest. For a precommit tree record source diff digest and rerun against the committed artifact before capability readiness is declared.

BrowserContext creates isolated origin storage (actual sheaf-local IndexedDB). New page within the same context after page close demonstrates destroyed/restarted workers with persistent storage; do not close the context then claim preserved storage unless using a separately specified persistent profile. Cleanup must close pages/workers/database before deleting the test context/profile. Existing deleteLocalStore helper resolves on blocked deletion, so S02 owns its correction or uses guaranteed context disposal; blocked deletion is never evidence of erasure.

S03 CP2 implemented REMINDER-CLOCK-S03 planned at37303ce and committeda016752; current accepted mechanism: worker.evaluate controls the actual built data-worker Date.now, exact dismissal boundaries and page-replacement/daily proofs, independent readback and page-only-clock negative control; separate real-clock journey retained. Fixture/spec are committed, no production test API. Landed S02 input recheck and independent J2 at47a633b passed; no pending clock-harness proof.

S02 owns the IO/file harness before J1; S06 owns actual periodic-trigger isolation and oracle/asset identity before J3 (production128 threshold, no build injection); S07 owns worker-aware context HTTP routing, OAuth popup/callback and CSP checks before J4. There is no existing native application: the actual transport is browser MessagePort/RPC. External save/provider endpoints may be fixtures; encryption, mapping, commands, enforced identity, local storage and internal workers remain real.

Per-case 180s, KDF cases 300s, action timeout 20s; whole focused browser suite 15m. Use test-runner deadlines and AbortController for transfers; Orchestrator terminates the owned server/test child on overrun, captures output and releases resources in finally. Never leave an indefinite retry/sleep. New e2e files may use the existing 600s limit only for the aggregate gate journey and must identify that in evidence. Evidence root `test-results/f05/sNN/` includes build/config/fixture identities, exact assertions, traces, screenshots and captured artifact hashes. These ignored outputs are exclusive resources, not staged source paths.

### VB-03 — bounded replan inspection, 2026-09-24

REPLAN-F05-PREFLIGHT inspected the raw ARCHIVIST-F05-PLANNING result and current ledger/blockers, F04 countdown/split records, actual recovery/history sources and paired tests, frame/AAD implementation, and runner discovery. Source identities are in PLAN-CHECK. VB-01 “actual” results belong to the original planning run and were not rerun by this correction. New evidence here is plan consistency checking only; no implementation, build, browser/security journey or provider call was executed. Local security discovery does not exist at HEAD: S07 CP1 creates J6’s project/script, three specs and negative-control self-tests before relying on them. Shared dist and Playwright output remain exclusive; serialize S04/S05/S06 reservations. Protected choices/inputs and future proofs retain their prior statuses.

### VB-04 — GRAPH bounded replan evidence

Base `309313170b997d2546794c6173ebcabfbd44ac5f` plus preserved r4 working tree; checked-source identities and mechanical outcomes in PLAN-CHECK. Actual work here is read-only source comparison, plan edits and DAG/lease/checkpoint validation; no application tests/build/provider/browser probe executed. Attempt4 reports typecheck/lint/diff-check exit 0 and 22 files/178 tests passed; retain as inherited evidence for its recorded source inventory `448408d1c2bf4ea2bef560b67b99ba079c6cf166f9fde75f1f78b136e39a1def`, not current acceptance or nonempty graph proof. At that historical base CP2 was uncommitted. Those current-producer gaps are now closed by c7e6507 and independently received GRAPH-S02 evidence; future nonempty proof remains S06.

Package scripts, Vitest node discovery and Playwright webServer implementation re-inspected. GRAPH-S02 and GRAPH-S06 in session Verification give exact selectors/owners; existing Vitest runs tests/unit + tests/property, no new runner needed. Browser proofs still require fresh build/source/config identity and exclusive dist/output under VB-02. No vendor assumption changed or new external probe prescribed. Historical S02 cursor/lifecycle/bounded gaps closedc7e6507; remaining extension owners: DB/Author mapping suppliedafe37f3; S06 nonempty candidate/reader/gate at CP1, installed proof CP2 and J3/J1 CP4. No old passing gate closes these gaps. Inspection is scoped to graph sources/referenced r4 and existing F05 records, not a new audit of unrelated F04 findings or external review sources.

### VB-05 — approval reconciliation at 87a4278, 2026-09-24

Actual evidence for this replan is scoped source inspection and plan validation in PLAN-CHECK only; no application build/tests/browser/native/live-provider proof was rerun. Preserve independently received c7e6507 GRAPH-S02 25 files/209 tests and d75830d close `pnpm verify` 214 files/2402 passed/3 inherited skipped, typecheck/lint/build exit 0. Those are component results, not J1. Existing large-chunk warning and shared dist/Playwright-output exclusion remain. Package/Vitest/Playwright implementations still discover the assigned tests and build before preview; SAVE-S02 gives the exact new fallback gate and J1 assertions. New tests are planned, not passing. PLAN-CHECK records source identities and outside-change preservation; historical results above refer to their original revisions.

### VB-06 — accepted DB graph bounded replan, 2026-09-25

Actual this run: read-only committed source/Author comparison, consumer/constructor/lease/harness inspection and plan consistency checks; **no application test/build/browser/provider execution**. Plan HEADafe37f3; source identity inventory and exact mechanical outcomes in PLAN-CHECK. Accepted application source47a633b remains unchanged. Its independently received223files2461pass3skips/typecheck/lint and11browser passes are **inherited**, not re-run here and not V2 proof. Current final report/historical results retain their evidence. Known earlier hydration/no-op/worker-clock defects remain closed by their recorded corrections, not by this documentation.

Package scripts, Vitest projects, Playwright webServer and separate bundle-reader Vite config inspected. Existing main build before strict preview plus no server reuse remains; decoder fixture needs its separate build after main output. J3 uses production128-tail threshold and real timer, no new root config/dependency. S06 CP1 decoder/port/fixture/generator self-tests, CP2 cleanup/replay tests, CP3 scheduler/fixture self-tests and CP4 real-entry proof are leased **before use**. Commands/assertions/isolated live versus empty decoder contexts and deadlines are in SESSION-06 Verification. Exclusive dist:build/playwright:output and envelope8081 remain mandatory; source disjointness does not permit shared output races. Changed renderer build after CP4 commit is re-proved before readiness.

Original VB-01 actual results retain their original run identity; source unchanged does not turn an unexecuted V2 test into passed. Three inherited skips, chunk-size warning, optional native-host qualification and external-provider input/qualification remain debt. No recorded hanging gate is newly prescribed. Scoped PLAN-REVIEW-GRAPH-APPROVED is process readiness, not product evidence. No installed proof exists yet.

## Capability Readiness

| ID | Approved behavior / entry point | Required facts + producer owners | CA IDs / prerequisites | Integration owner / checkpoint | Status | Proof / checked sources | Open gaps + correction owners |
|---|---|---|---|---|---|---|---|
| CAP-05 (inherited) | Local recovery countdown and replacement passphrase | worker retryAfterMs; clock; S02 CP5 f978eb3 | CA-40 | S02 CP5 | verified | Independent fresh-build recovery-countdown at823012b; controlled4→3→0 and negative controls in full2438-pass suite | none for countdown |
| CAP-39 | Create vault, separate recovery, attach scratch preserving data | S01 crypto; S02 home03ee571, mounted7b1bb58, recovery7ee5ce8, concurrency823012b | CA-34/35/40 | S02 CP4–6 | verified | Independent current-build J1 download/native and sync/bundle pass823012b; artifact/hash/source identity checked | none for current capability; nonempty extension separately CAP-40/44 |
| CAP-40 | Complete encrypted bundle, truthful confirmation, vault-only recovery | graphc7e6507; fullsavea93a87c; decoder7ee5ce8; hydration823012b | CA-35/36/37 | S02 current graph; S06 nonempty extension | current-producer capability verified; nonempty extension planned | Independent J1 two destinations and sync/bundle pass823012b including malformed/interrupted/restart/authenticated all-current-branch recovery | Author mapping suppliedafe37f3; S06 CP1/2/4 positive nonempty graph proof remains planned |
| CAP-41 | Same backup time/count/remedy across tile/app/detail/reset | S02 receipt/readers7b1bb58/f978eb3/2cd5ad4; S03 statusd8b4e14/47a633b | CA-36/40 | S03 CP3/4; cloud S07 CP2–4 | scratch/bundle verified; cloud extension pending | Independent backup-status/J1 at47a633b proves reopened consistent facts, explicit zero and reachable remedies;2461unit pass | S07 cloud status integration/J4 remains required |
| CAP-42 | Nonblocking authored scratch reminder, persistent badge, escalating dismissal | atomic encrypted producer59caafb; query/dismiss/machine/routea016752; accessibility47a633b | CA-37; DEC-71 approved | S03 CP1–4 | verified | Independent J2 at47a633b: exact10m/1h/24h/repeateddaily, worker replacement after each dismissal, page-only negative control, real-clock path, authored families and assignment suppression; unit no-op/stale/duplicate/reopen regressions | none for required reminder behavior |
| CAP-43 | Dropbox/OneDrive home connection and automatic/manual confirmed backup, usable offline | auth identity/tokens/input IDs S04/05; IO composition/scheduler S07 | CA-38/39; INPUT-DROPBOX/ONEDRIVE; first J1 | S07 CP2–5 | blocked | J4/J5; official docs; no live evidence | human registrations; adapters S04/05; actual launcher/config/receipt S07 |
| CAP-44 | Periodic compaction preserves authored state, baselines, history and restoration after reopen/backup | S02 graph/state cursor; S06 writer, retained chain/audit readers | CA-35/36/41 | S06 CP4 | planned | J3 planned; accepted DB graph sourceafe37f3, source preflight below | Scoped plan review before S06; CP1 candidate, CP2 install/edit/import/history, CP3 timer, CP4 J3/J1 |
| CAP-45 | Only selected-provider protocol/ciphertext egress; locks isolate secrets | S07 configured fetch/CSP; IO/data channels S02 | CA-38/39 | S07 CP1/5 | planned | J4/J5/J6; local security project/controls S07 CP1; no-network fixture currently observational only | real egress guard absent → S07 before first provider use |

### Inherited CAP-05 — local recovery countdown (required F05 work)

Status **verified** at f978eb3/823012b, integration/proof owner **S02 CP5**, CA-40; source F04 STATE inherited obligations and M36 Known gaps. Actual path: recovery UI → RecoveryRoute/recoveryMachine → SecurityServices → RPC → worker attempt limiter → error.retryAfterMs → ephemeral clock deadline → security VM → recovery screen. Worker remains the delay authority; presentation expiry never unlocks or changes durable data. A valid code still requires a new passphrase before adopting the session. Countdown is not persisted; after restart the worker response supplies current authority. Ticking actor and paired UI proof landed in S02 CP5; controlled clock and real-entry recovery-countdown independently pass at823012b. Required completion cannot be deferred out of F05 or inferred from vault recovery tests. No new CAP identifier or competing historical backlog is created.

### Action and fact traces

- CAP-39: SCR-038 → committed assign-home command03ee571 and mounted RPC7b1bb58 in application/commands/home-commands.ts → backup-handlers → existing openAppKey + S01 opaque wrapper → HomeState/assigned event/catalog CAS transaction → reload catalog/home in worker → labelled vault status. App/key/home/vault IDs come from CSPRNG and authenticated roots; human passphrase is transient input; created time comes from injected ClockPort, never authority. Wrong secret/home/app, cancelled issuance or stale local revision changes nothing. Vault recovery decode must succeed without local-root key, while local code must fail there.
- CAP-40: Save bundle → snapshot operation → graph exporter → SHF1 objects with actual frame versions/digests → IO bundle second-pass verification → FileSavePort → correlated completion → atomic confirmed frontier/time → restart read. Imported commit and multi-event authored commit identities come from event log, not a DTO count. File authentication proves recoverability; J1 explicitly verifies the downloaded bytes with a fresh vault-only decoder. F06 owns adoption UI, not the F05 obligation to write a complete recoverable bundle.
- CAP-41: immutable HomeState receipt is authority; app head supplies latest contiguous per-device frontier and distinct commit identity. Count = distinct locally held commits not covered by this home's confirmed frontier, including import/reconciliation commits. A configured home with no receipt has null time, never “current”. chainState always uses absolute sequence, not outstanding count. Every status action is assigned: scratch choose home; bundle save; cloud back up/reconnect/retry. Readable reset recomputes count/time and invalidates stale confirmation; locked reset gets no inventory. Read-only display mutations are N/A; reset remains existing explicit destructive flow.
- CAP-42: accepted user commit → catalog reminder state in same transaction → post-ack prompt → dismissal operational write → reopen eligibility. Rejected/no-op/draft/query/last-opened/clock recalculation have no trigger. Reminder timing is not derived from event sequence; DEC-71 supplies policy. Assignment removes reminder state but preserves future receipt truth. Badge persists through dismissal.
- CAP-43: selected account registration + OAuth state/verifier → provider-authenticated stable account → encrypted home token state → dedicated IO adapter → immutable chunks/index → exact head CAS receipt → local receipt transaction → readers. During offline edit, local acknowledgement never waits for IO; resume derives pending work from encrypted state. Snapshot E uploaded while E+1 commits leaves exactly one pending. No internal port is faked in J4. F06 owns remote divergence reconciliation; F05 must preserve prior remote head and surface interruption/divergence without claiming success.
- CAP-44: committed authenticated head/frontier → bounded checkpoint/audit export → independent replay equivalence → compare-revision pointer swap → retained-root-aware cleanup → worker restart/hydrate/history/restore → new commit → subsequent bundle. Save acknowledged before background compaction starts. Existing bytes/hashes are sources, not inferred row counts. Baselines, deletion restoration and source lineage are retention authorities; age alone never prunes them.
- CAP-45: validated public config creates exact provider policy/CSP and IO constructor; active account/home binds every request. Session lock stops IO and destroys handles; stored tokens remain encrypted. No provider configured/contacted on local launch. Browser redirects, popup source and provider-issued transfer URLs require validation before use; no arbitrary allowedOrigins bypass.

## Contract Agreements

| ID | Required meaning / authority | Producer → boundary → consumer | Mapping / constraints | Correction + proof owners / checkpoints | Agreement | Producer | Proof / evidence / checked sources |
|---|---|---|---|---|---|---|---|
| CA-34 | Independent local/vault/app protection, existing app ciphertext preserved | M08 committed vault wraps → migration006 header/index → S02 home writer/recovery UI | exact scoped KDF + independent salts; opaque existing app key wrapped; separate recovery | S01 CP1–3; S02 CP1/4/6 | agreed | S01 crypto CP1–3 694c741/13e83f1/8674766 and S02 CP1 home assignment 03ee571 landed | S01 scope/crypto proofs plus S02 worker/IndexedDB atomic home and retention proof independently checked (11 files/119 pass, tc/lint 0); mounted creation/review7b1bb58 and independent J1 download/native passed at7ee5ce8; import counterexample closed823012b; independent current J1 + sync/bundle pass |
| CA-35 | Complete authenticated graph; distinct head/payload/commit/reconstructed/ciphertext digests | accepted V2/evidence contract → S06 exporter/publication → vault-only nested decoder | Exact Author mapping below; API mapping provisional against S06 CP1/2; current graphc7e6507 preserved | S06 CP1 candidate, CP2 installed, CP4 J3/J1; S07 consumption after receive | agreed | current producer readyc7e6507; V2/nonempty producer planned | Author suppliedafe37f3; inherited GRAPH-S02/J1 verified823012b/47a633b; GRAPH-S06 candidate/installed/composed proofs planned |
| CA-36 | Confirmation, count and absolute sequence remain distinct | event-store + S02 HomeState receipt → protocol/VM/reset | captured frontier only; null never→zero/current; edits during backup stay pending | S02 partial CP3/CP4–5; S03 CP3 d8b4e14; S06 CP2; S07 CP2/3 | agreed | native receipt writer and atomic pin release landed d75830d; readAppDurability/listLibrary/toSessionView/reset readers landed7b1bb58/f978eb3, all-held-device correction2cd5ad4 | native saved/failed/stale/quota/restart/concurrent-edit component assertions passed in closing 214-file/2402-pass suite; J1 independently passed7ee5ce8; import counterexample closed823012b; independent current J1 passed; J2/status independently passed47a633b; J3/J4 planned |
| CA-37 | Dismissal never blocks; attempted bundle is not saved | authored commit/external save → encrypted state → approved UX | approved DEC-71 schedule; DEC-72 explicit post-delivery confirmation | S02 CP3/4; S03 CP1–4 | agreed | native d75830d/fallbacka93a87c; no-op/atomic reminder59caafb; dismissal/RPC/UIa016752 landed | Independent SAVE-S02 and current J1/J2 at47a633b pass; unchanged schema/chart no-commit counterexample closed59caafb with reopen/stale guards; exact worker deadlines and negative control passed; no pending S03 proof |
| CA-38 | AppFolder account isolation and exact-byte atomic head | registered provider + S04/S05 adapter → DurableHomePort receipt → S07 | stable account/vault binding; null=create-if-absent, stale=conflict; never unconditional overwrite | human registrations; S04/S05 CP0–3; S07 CP1/2/5 | agreed | S01 CP2–3 DurableHomePort/publishCandidate landed 13e83f1/8674766; S04/S05 real provider adapters/qualification planned | Orchestrator focused protocol gates pass at 8674766, exact CAS/hash/readback on stateful double; live scope/CORS/CAS still blocked INPUT-DROPBOX/ONEDRIVE; J4/J5 S07 planned |
| CA-39 | Actual transport, lifecycle and egress preserve authority | S02 IO channel + S07 config/bootstrap/token writer → adapters/scheduler → receipt | tokens/keys separated; lock/cancel correlated; selected-provider-only network | S02 CP3; S07 CP1–5 | agreed | IO/bootstrap/channel d75830d plus confirmation lifecycle full CP3 a93a87c landed; provider config/tokens/egress S07 planned | production handlers/MessageChannel with Worker constructor doubles, cancellation/disposal and no-key component tests passed; actual built data/IO/MessagePort J1 passed823012b; J4/J5/J6 planned; local security discovery owner S07 CP1 |
| CA-40 | Approved status/recovery/remedy meaning on every surface | S02 receipt/countdown + S03 policy → DTO → VM → routes/UI | scratch/configured/confirmed/stale distinct; remedy for each displayed state | S02 CP4/5; S03 CP3/4; S06 history; S07 provider | agreed | S02 mounted/readers/countdown7b1bb58/f978eb3; S03 consistent local/bundle statusd8b4e14/47a633b landed | Independent current J1/CAP05/J2/status at47a633b pass; inherited provenance copy corrected and tested; provider design ready98ee79c; S06/S07 future history/cloud proofs remain planned |
| CA-41 | Compaction preserves original identity/provenance/chain/history and V2 writer continuity | S06 export/audit + authenticated origin checkpoint → projection/history/append/recovery | Author afe37f3 supplied; exact mappings below, runtime APIs provisional against CP1/2 | S06 CP1 codecs/candidate, CP2 install/history/edit/import/ticket, CP3 timer, CP4 J3; S07 dependent | agreed | planned | candidate/installed/composed proofs planned; no execution proof from this replan |

### CA-34/35 mapping and comparison

Approved FR-24 vault key is implemented as random vault root wrapped by passphrase-derived wrapping key, per database.md and migration006; that is an intentional hierarchy, not a contradiction requiring enum/schema correction. Existing `wrapRoot` is local-scope only and cannot be reused as if already vault-scoped. New wrap functions are S01 outputs.

`StorageRefV1.storageId` is base64url text; migration006 EnvelopeReference.storageId is the decoded random 16 bytes. Local semanticSha256 verifies decoded payload; remote ciphertextSha256 hashes the exact frame ciphertext according to migration003 reference contract. Reference scope comes from the already-authenticated parent graph reference (or the fixed authenticated bootstrap context), participates in AEAD AAD, and must agree with the expected payload kind. Scope is absent from EnvelopeFrameV1. Reference logicalRevision and paddedBytes come from the authenticated frame, not the current transaction revision. Existing `head.semanticSha256` = hash(encodeAppHeadBody); never relabel this as reconstructed-state hash. S02 creates the latter from canonical authored state; source hash remains unchanged. This is a new producer seam, not a demonstrated need to rewrite historical hashes.

Complete graph mapping: checkpoint→record pages and all schema/theme/formula/chart roots; head tail→event segments; baseline/conflict/audit roots; source manifest→all original chunks; snapshot manifests→all sheet chunks; retained roots→their exact necessary descendants. Current vault-index retention roots are authoritative; historical vault-index retention lists are not recursively authoritative. Do not extend that rule to silently omit local app-head descendants; Author afe37f3 requires recursive traversal of every local historical head edge; the remote historical-index exception does not apply. A parent reference without a reader for its descendants blocks publication. Deleted rows remain restorable and baseline absence is explicit. Migration006 type optional recordCount means unknown, not zero. No DB column/FK change is planned; all durable local facts remain encrypted envelopes.

### CA-36 exact accounting

The inherited F02 `deviceOnlyChangeCount(frontier, deviceId)` returned absolute sequence, also used by chainState. S02 now separates that chain authority from receipt-relative pending counts in readAppDurability and the app/library/reset readers (7b1bb58/f978eb3, all-held-device correction2cd5ad4). S03d8b4e14/47a633b consumers share those facts; current J1/J2/status proofs passed. Do not change absolute chain sequence into a pending count. A schema change containing K events is one distinct commit. Import/reconciliation commits count before coverage; volatile derived values/last-opened/dismissal do not. Count all local held device frontiers against the matching authenticated home frontier; reject ahead-of-local or mismatched app/home receipt. Snapshot confirmation moves only its covered frontier and timestamp together, after exact receipt; after concurrent extra commit pending count is one, not zero. Hash/account/app/vault/generation identity mismatch rejects with no mutation.

### CA-37 approved save/reminder mapping — current reconciliation

Agreement **agreed**; fallback producera93a87c and reminder producer59caafb/query-dismissala016752 landed; independent real-entry J1/J2 proof **verified** at47a633b. Approval27e9a34/design4c31ded are inputs, not proof; implementation and current browser evidence establish readiness.

Save path: real UI → AppRuntime.saveBundle → prepareBundle → data backup.connectBundle → authenticated pinned graph/publication → receiveBundle second-pass verification → FileSavePort → native completed write/close OR verified fallback delivery then explicit “I saved this bundle” → the existing correlated completion → atomic encrypted HomeState receipt/pin release → reopened status reader. Facts come from worker-owned pin, app/home identity, artifact hash and captured frontier; confirmation time is worker ClockPort. No caller supplies an invented frontier. No SQL/schema change is required for the existing receipt. The original no-picker branch returned before delivery; full CP3 a93a87c corrected it, with independent J1 acceptance823012b. S02 CP3 delivered the complete correction across port/platform/bootstrap, leased workflow/routes/UI, IO/control and backup handler tests; SAVE-S02 specifies test paths, runner and assertions. CP4 owns minimum readers and composed J1, CP5 reset/countdown, CP6 full artifact/recovery.

Native saved and explicit user-confirmed saved can both reach the existing terminal saved outcome, but only after their distinct actual predicates; UI must truthfully label the source. Preparing, delivering and awaiting confirmation are transient workflow states, not saved receipts. Dismissed, cancelled, failed, timed-out, locked, disposed, replaced, replayed or mismatched operations leave receipt/frontier/time unchanged; reopening cannot revive confirmation authority. Snapshot E confirmed after E+1 keeps E+1 pending. No protected durable format expansion is prescribed.

Reminder path: accepted authored commit → same-transaction encrypted ScratchReminderStateV1 → query/policy → post-ack reminder → encrypted operational dismissal → restart eligibility. First authored change prompts immediately; successive dismissals schedule 10m, 1h, 24h, then daily while scratch. ClockPort supplies time; accepted commit/app/home supplies trigger identity. Rejected/no-op/draft/query/recalculation never triggers; badge remains, edits stay nonblocking, assignment suppresses reminders. S03 CP1 59caafb constructs producer/policy, CP2 a016752 wires dismissal/restart, CP4 47a633b closes J2. Independent11-test current-build gate proves exact boundaries/restarts and no-op/stale guards; no policy or reminder proof remains open.

### CA-38 external-premise comparison and probe

The required account/atomic-publication meaning is agreed. External compatibility and producer/proof readiness are unresolved, independently of agreement status. A provider owner may construct its assigned qualification harness after registration is supplied; it may not enable the provider or dispatch S07 against an unqualified implementation.

Primary sources inspected 2026-09-24:
- [Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth): public PKCE/offline-token flow; no client secret in a static browser application.
- [Microsoft AppFolder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder): application folder scoped access.
- [Graph content upload](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0): page lists content upload but does not document If-Match in its request-header table.
- [Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0): documents If-Match at session creation. That alone does not prove atomic conflict checking at final content publication.
- [Microsoft browser authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow): SPA redirect/PKCE requirements.

Therefore OneDrive exact-byte head CAS is **unverified**, not an established implementation fact. The plan does not prescribe an undocumented PUT flag as proven. Probe with two independent sessions that read head H, publish different candidates, and verify exactly one publication wins; read final bytes and prove the losing write cannot replace the winner or corrupt the previous generation. Also test create-if-absent races, read-after-write, CORS from the actual configured SPA origin, expired/revoked token, session resumption, account-scoped enumeration on device B, and separate-account exclusion. Endpoint family/API version, effective scopes, account type, redirect and redacted request/response behavior are evidence. Account credentials and tokens are never evidence artifacts. Client inputs identify exact builds/configuration even though there is no provider CLI.

S04/S05 CP0 owns its probe before implementation relies on a premise; human registration is a protected input, not an absent engineering owner. A failed premise routes a concrete Architect/Spec provider-contract re-entry (human for changed vendor/security/product behavior), with S04/S05 correction and S07 consumer still named. No broad scopes, silent overwrite, or stubbed successful receipt is an acceptable fallback. Shared protocol fixtures can be implemented without live credentials but do not mark producer ready for cloud dispatch.

### CA-40 design-fill boundaries

Accepted `f05-vault-security.html` at 58bffc8 covers named-vault create/recovery/re-view and remains unchanged. Designer 4c31ded adds `f05-bundle-save.html` and `f05-scratch-reminders.html` with four design inventory rows, resolving save/reminder DF-F05-1 coverage under approved DEC-71/72. These inputs are ready for S02 CP3/4 and S03 CP1/2; they do not verify application behavior. Provider authorization/reconnect/disconnect coverage is now accepted98ee79c in f05-provider-states.html; S07 CP2/4 consumes it after separate required inputs. MOD-022 is local code reveal; use the accepted vault-specific source for vault recovery. Do not enable conditional Google Drive card. Don't copy “prior copy remains current” literally when newer local changes exist; retain confirmed time with pending count per design.md's authoritative backup language.

CA-40 inherited CAP-05 mapping: worker error.retryAfterMs (including invalid-recovery-code with a positive delay) is the only delay input. RecoveryMachine deadline/remainingMs is ephemeral presentation state; zero/absent delay enables a fresh request, positive delay disables it, stop cancels the timer, and the worker still rejects premature attempts. S02 CP5 f978eb3 landed RecoveryRoute clock injection, machine/VM/screen and paired tests; current independent recovery-countdown at47a633b verifies those inputs and behavior. Exact assertions and commands are in S02 Verification. CA-40 also covers S06 CP2 retained-history presentation: scope, counts and empty announcements must describe retained authored events, not a cutoff at the newest checkpoint.

### CA-41 compaction mismatch and preservation

The current V1 import shortcut cannot hydrate compacted authored records: `toProjectionRecord` supplies zero revision/empty provenance, `chainState` searches the tail, and covered history is skipped by `replayTail`. Accepted afe37f3 supplies the format correction; S06 CP1 now owns **candidate history reconstruction too**, CP2 wires that same implementation to installed sessions before pointer swap. PC-F05-01's retained-history UI correction remains CP2. Both ordinary edit and import append preserve V2 roots; import origin checkpoint pages remain reachable because initial import contains no record.created events. Required graph/evidence, consumer, cleanup and harness mappings are enumerated below, with exact expanded lease in SESSION-06/LEASES. All are planned implementations/proofs, not supplied producers. No F06 action or altered retention policy is authorized.

## Seam Preflight

| Construction / injection | (a) existence and owner | (b) response fit | (c) meaning / CA | (d) production proof and owner |
|---|---|---|---|---|
| Vault crypto into home writer | local/vault crypto committed S01 CP1–3; home writer03ee571 | migration006 wrappers differ from WrappedLocalRootV1 | CA-34 independent scope/salt/app key | J1 S02 CP4/6 |
| App graph into manifest builder | bounded pin/current graph/cursor/publication c7e6507 committed; future nonempty mappings S06 | StorageRef != EnvelopeReference; use authenticated-parent scope plus frame-derived dimensions | CA-35 three hashes distinct | J1 captured artifact S02 CP6 |
| HomeState into library/app/reset | home03ee571, receipt a93a87c, readers7b1bb58/resetf978eb3/all-device2cd5ad4 and surfacesd8b4e14 landed | DTO/reader/VM maps committed | CA-36/40 frontier versus absolute sequence | independent J1/reset/J2/status passed47a633b; cloud S07 pending |
| Data↔IO and platform save | full native/fallbackCP3 a93a87c landed; mounted7b1bb58 | dedicated byte channel, page-safe IDs | CA-37/39 operation identity, distinct native/explicit saved predicates | independent both-destination J1 passed47a633b; OS qualification remains separate |
| Reminder into all authored commands | atomic trigger/no-op correction59caafb; query/dismissala016752; integration47a633b | encrypted catalog plus production protocol/route | CA-37 one commit/many events, approvedDEC-71 | independent J2 exact worker-clock/restart/negative controls47a633b; no pending local proof |
| HTTP adapters into IO constructor | S04/S05 CP3 planned | S01 common port frozen; revision/ack exact bytes | CA-38 account identity/CAS | J4 S07 CP2/5 |
| Public config + token store + callback | empty PUBLIC_CONFIG, no OAuth return; S07 CP1 | build input validator→real IO constructor | CA-39 selected provider only, tokens encrypted | J4/J5 S07 CP1/2 |
| Lifecycle into scheduler | app-bootstrap visibility currently idle-only; S07 CP3 | real commit signals + typed lifecycle channel | CA-39 resume pending, manual-only bundle | J4 S07 CP3 |
| Compaction into replay/append/history | Author suppliedafe37f3; S06 CP1/2 implementation planned | V1/V2 union, original evidence→direct V2 row metadata/history/chain; both writers and vault decoder leased | CA-35/41 mapping below; no new schema or F06 action | CP1 candidate then CP2 installed, CP3 actual timer, CP4 J3/J1; planned |

Required predecessor inputs are ready only after committed implementation and relevant boundary proof; the table above distinguishes committed component producers from planned composed proofs. Orchestrator rechecks actual landed constructor signatures/config fields and updates these CAs before consumer dispatch.

## Executable Proof Specifications

### J1 — first narrow journey, CAP-39/40/41, CA-34/35/36/37/40

Owner S02 CP3 harness, CP4 minimum persisted receipt/count readers plus first success, CP5 expanded reset/recovery and inherited CAP-05 countdown, CP6 complete errors/artifact recovery. Planned test `tests/e2e/bundle-backup.spec.ts`; exact invocation `SHEAF_PW_PORT=<port> pnpm test:e2e bundle-backup`, discovered by e2e/**/*.spec.ts. Use real entry and real built data+IO workers, sodium/IndexedDB/SQLite; only platform destination may be deterministic. Seed `protectDevice(page)` then `importDemoWorkbook(page)` from committed fixtures, then a real record edit. Assert exactly one additional unconfirmed commit relative to seeded import frontier, then zero after captured graph is confirmed. Create vault and distinct recovery; compare original encrypted app object bytes before/after assignment. Capture bundle bytes/hash, verify entire graph and reconstructed semantic state with production reader under vault secret only. Close page, open new page in same context, unlock, assert record value/time/count/home; edit again => exactly one pending, unchanged confirmed time. Cancelled/failed/forged save cannot advance anything. Exercise approved DEC-72 through actual download delivery, then the real “I saved this bundle” action; download alone leaves the receipt unchanged. SAVE-S02 in SESSION-02 assigns CP3 construction and CP4 J1 proof, including dismiss/restart and newer-edit remainder. Inspect ciphertext for known sentinel names/values; parse allowed clear fields structurally. Decoder rejects wrong scope/secret, missing/extra/truncated/reordered objects and wrong identity. Finally dispose context and workers. Native file-save verification is distinct optional platform evidence, never inferred from fixture pass.

### J2 — reminder and status action coverage, CAP-41/42, CA-36/37/40

Owner S03 CP1 producer, CP2 harness, CP4 integration. Planned `tests/e2e/scratch-reminders.spec.ts` and `tests/e2e/backup-status.spec.ts`, commands as exact filename stems under test:e2e. Real setup/import and UI mutations for record create/edit/delete, schema change, chart save/pin, theme. Each accepted authored command triggers once, not each internal event. Dismiss is nonblocking, persisted and respects DEC-71 after reopen; permanent scratch badge remains. No prompt on rejected command/draft/filter/TODAY refresh. Status+action assertions at shell tile/app frame/app home/settings/detail/readable reset; nullable time and literal zero covered. Save through J1 path updates all readers and stale reset confirmation is refused. REMINDER-CLOCK-S03 at37303ce specifies actual worker-realm control through Playwright Worker.evaluate in tests/e2e/fixtures/durability.ts, with browser self-tests and page-only negative control in scratch-reminders.spec.ts before CP2 proof. Exact 10m/1h/24h/daily pairs survive page replacement; separate unmodified real-clock journey retained. No hours-long waits. Mechanism and proof landed a016752/47a633b; independent current-build J2 passed. This specification remains the acceptance contract.

### J3 — compaction→restart→restore→append→backup, CAP-44, CA-35/36/40/41

Owner S06 CP1 candidate and decoder/oracle reports, CP2 installed replay/history/chain/edit/import/cleanup, CP3 production scheduler plus harness self-tests, CP4 actual-entry proof. The full executable specification is **SESSION-06, Verification / J3 and J1**, including selectors, source/build identity, decoded oracle, authoritative seeds, port8081, resources, bounds and cleanup. Tests `tests/browser/sync/compaction.spec.ts` and `tests/e2e/compaction-backup.spec.ts` are planned, with existing bundle/append/status regressions preserved.

Use the real worker-owned 1500ms periodic check and default128 post-checkpoint commit threshold in an isolated fresh context; no test build flag/threshold, clock override, forced helper, new protocol or release debug API. Prove127 stays below threshold over two tick opportunities and128 compacts, then another128 proves recurrence. Head/frontier/audit observation comes from real saved artifact decoding, not local page state. Harness self-tests distinguish the served production worker from a harness and reject stale assets. Fresh main build followed by separate decoder build under exclusive dist/output locks; capture revision/diff/config/fixture/served main+data+IO+decoder identities. Save is not a force trigger.

After two compactions close page/await worker termination, reopen same encrypted IndexedDB context, check real history scope/count/pagination and restore a pre-compaction deletion via UI. Perform edit and delimited import append, reopen and prove V2 roots/original metadata and exact next chain continue. Save/confirm fresh bundle through real data↔IO MessagePorts; a separate empty decoder context uses only vault secret, production openBundle→recoverBackupGraph, and verifies all nested versions/descendants plus independent authored/history/restoration/provenance/chain facts. Physical compaction does not advance receipts/counts; subsequent real mutation does. Component CP2 covers stale/quota/crash/pin adversarial boundaries, and CP4 reruns J1. No provider input is required; no proof is verified by this planning change.

### J4 — actual provider connection and scheduler, CAP-43/45, CA-38/39

Owner S07 CP1 harness/config/constructors, CP2 manual journey, CP3 scheduling, CP5 acceptance. Planned `tests/e2e/cloud-backup.spec.ts`, exact `SHEAF_PW_PORT=<port> pnpm test:e2e cloud-backup`. Built public fixture client IDs/redirects activate actual Dropbox/OneDrive adapters and their real PKCE/URL/CAS mapping; context-wide HTTP fixtures replace only provider servers. Popup callback/state/account handlers are real. Setup/import/edit → home picker→auth→vault→manual backup→exact receipt→UI zero. Offline edit and restart remain usable and pending; resume publishes automatically; visibility attempt failure preserves time. Confirm exact one-event-during-upload remainder, no receipt on token/quota/CAS failure, wrong account/replayed callback rejected, lock cancels stale completion. The fixture's stateful conditional-write negative control must fail a deliberately unconditional adapter write. Finally close popup/context/workers/server; no provider secrets in logs/URLs/storage outside encrypted envelopes. J4 passing is local implementation proof, not live vendor qualification.

### J5 — live external qualification and gate, CAP-43/45

S04/S05 CP0 probes + CP3 recordings, S07 CP5 live integration. Planned live files `tests/provider-contract/dropbox/dropbox.live.spec.ts` and `tests/provider-contract/onedrive/onedrive.live.spec.ts`, initially discovered by each owning provider-local playwright.config.ts and exact --config command in S04/S05 Verification; S07 later registers them in provider project and test:providers. CP0 probe harness construction belongs to the same provider lease and precedes its protocol implementation; it does not depend on S07. Use two authorized accounts and two sessions of one account, dedicated opaque namespace, actual configured SPA origin; verify discovery/isolation, narrow scopes, CORS, conditional create/replace races and final bytes. Inputs missing => blocked live result, not skip-as-pass. Gate test `tests/e2e/gate-f05-demo.spec.ts` drives roadmap flow at 320px, captures/view-checks screens and uses current built revision/config. Orchestrator records GATE-F05 and writes committed final report with explicit residual proof debt.

### J6 — credential-free local security gate, CAP-45 / CA-39

Owner S07 CP1 harness/config/guard and three discovered specs; CP3 lifecycle extensions; CP5 rerun. SESSION-07 Verification specifies exact commands, isolated builds/context, actual workers/CSP/fetch boundary, seeds, teardown, evidence and negative controls. Planned root project security-f05 discovers tests/security/f05/{network,csp,secret-lifetime}.spec.ts; package script test:security:f05 invokes that project. Discovery must list all three specs and execute nonzero unskipped assertions without live opt-in. Real forbidden-origin rejection and lock/cancel secret cleanup are tested; deliberately forbidden events and leaked sentinel controls must be caught by the same assertions. No internal implementation under test is replaced by a double. This local gate remains required even when provider accounts are unavailable; live qualification is separate J5.

## Current Blockers

| ID | Affected CAP/CA/session | Required next action / owner | Evidence to clear |
|---|---|---|---|
| PLAN-REVIEW | cleared affected S02/S03 review | ARCHIVIST-F05-APPROVAL accepted8c8a53d; reminder-clock assignment37303ce; S02 actual producer inputs rechecked823012b | S03 implementation and actual-worker clock proof accepted47a633b; scoped review remains separate from executable proof |
| PLAN-REVIEW-GRAPH-APPROVED (closed for dispatch; finding assigned S06 CP1) | S06 dispatch / CAP-44,CA-35/41 | Adw4M review received; baf4b56 assigns the one manifest codec/test gap to S06 CP1 under lease r2 | Dispatch review complete; required logical-order implementation/regression still planned S06 CP1, not verified |
| GRAPH-CONTRACT | CA-35/41 / CAP-40 extension,CAP-44 / S06 | **Author input supplied/cleared** at afe37f3; no human question remains | Exact DB section accepted; does not verify S06 producer or candidate/installed/composed proofs |
| GRAPH-S02 | CAP-40 / CA-35 / S02 CP2 | cleared at c7e6507; Orchestrator independently verified 26 leased paths, source/config/fixture hashes, exact gate | 25 files/209 tests, typecheck/lint exit 0; bounded pin/export, all current branches, provenance/covered chain and lifecycle assertions; J1 and current vault-only sync/bundle now independently passed823012b |
| DEC-71 | cleared policy/design/implementation proof | approval27e9a34; design4c31ded; S03 CP1–4 accepted47a633b | independent actual-worker J2 exact intervals and restart passed |
| DEC-72 | cleared policy/design and S02 proof | approved27e9a34, design4c31ded, fullCP3 a93a87c, J1 accepted823012b | native/write-close and fallback delivered-then-explicit-confirmation both independently passed; no OS durability claim |
| DF-F05-1 | cleared design inputs; S07 application remains pending | Vault58bffc8, save/reminder4c31ded, provider98ee79c accepted | all approved required F05 design surfaces now have detailed sources; provider registration/qualification and actual application proofs still S04/05/S07 |
| INPUT-DROPBOX | CAP-43 / CA-38 / S04 live + S07 provider enablement | Human supplies public registered client ID, exact redirect URIs, production/public-client/AppFolder configuration and authorized test accounts; S04 consumes, S07 wires | redacted input identity + narrow scope/discovery/isolation/CAS/CORS probe |
| INPUT-ONEDRIVE | CAP-43 / CA-38 / S05 live + S07 provider enablement | Human supplies Entra SPA registration/client ID/redirects/account type and test accounts; S05 consumes, S07 wires | same, plus actual final-publication CAS qualification |
| GATE-F05 | next-feature F06 dispatch | Human demo verdict after implementation; Orchestrator prepares built revision package | verdict with build/config identity; no approval presumed |

Protected inputs do not erase their engineering owners. A failed OneDrive CAS premise creates a scoped author/provider-contract correction before dependent enablement; unrelated bundle/compaction work may proceed. The optional native-host checks remain explicit final-report debt and are not authority to claim platform behavior verified.

### PC-F05 planning review dispositions — 2026-09-24

Raw source `.program/results/ARCHIVIST-F05-PLANNING.result.md`, base 2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51. All five findings accepted as planning defects and corrected; implementation/proofs remain planned. Startup go clears the orchestration objection only, not DEC-71/72 or GATE-F05.

| Finding | Disposition and implementation/proof owner | Affected dependents |
|---|---|---|
| PC-F05-01 | S06 CP2 owns retained-history readers, records VM, history screen and paired tests; CP3 integration, CP4 J3 real UI history/restore | CAP-44/CA-41/CA-40; S07 waits for current J3 |
| PC-F05-02 | Required inherited CAP-05 countdown assigned S02 CP5 with machine, route/VM/screen and unit/e2e leases; optional chart split intentionally retained, exhaustive adaptations remain assigned separately | CA-40; F05 completion requires countdown proof; no chart cleanup dependency |
| PC-F05-03 | CA-35 now takes scope from authenticated parent/AAD plus expected kind; only frame dimensions/revision from frame; S01 CP2 rejection contract, S02 CP2 graph conversion | S02/S06 graph consumers; amend provisional mapping after S01 |
| PC-F05-04 | Minimum J1 receipt/count readers moved to S02 CP4 before first journey; broader reset remains CP5. S06 CP2 receives audit history/restore readers before equivalence | J1 gates S03/S04/S05; J3 gates S07 |
| PC-F05-05 | S07 CP1 explicitly creates local security project/script/specs and negative controls; CP3 extends races, CP5 reruns J6 | CAP-45/CA-39 and F05 acceptance; independent of live credentials |

PLAN-CHECK records lease/DAG checks and input identities. PLAN-REVIEW remains Orchestrator’s dispatch decision; no passing implementation proof is asserted. Historical handoffs and inherited source rows are preserved verbatim.

## Accepted graph reconciliation — REPLAN-F05-GRAPH-APPROVED (2026-09-25)

### Authority and readiness

Plan HEAD and Author revision `afe37f391bb73e35a85d3c9631c632cd7d024bf9`; entire database.md “F05 graph contract — DB re-entry, 2026-09-25” accepted after explicit human authorization. It closes GRAPH-CONTRACT input and supersedes earlier unspecified-layout alternatives. CA-35/41 **agreement agreed**; V2 producer **planned**; candidate/installed/composed proof **planned**. API mappings are provisional against S06 CP1/2. Orchestrator amends them from committed source before S07, not merely via a relay. S06 pending0/4 after scoped review; S01–03 accepted checkpoints unchanged. No migration/global registry edits or product question remain.

### Complete meaning and constructor preflight (CA-35/41)

| Input / current producer (axis a) | Exact meaning and fit (axes b/c) | Implementation and proof (axis d) |
|---|---|---|
| `roots.ts` V1 head/page codecs; planned V2 variants | Same head keys/version2/typed retainedRoots; same page outer keys/version2; checkpoint versions unchanged. V1 reader bytes unchanged, legacy independently typed identical aliases only; ambiguous roots and legacy evidence reject/preserve | S06 CP1 discriminated codecs + fixtures/negative old reader; both current writer/caller type adaptations CP1, installed proofCP2; roots/codecs tests |
| Authenticated graph pin/app key via `backup-handlers.ts` and `home-state.ts` | App/home/head identity worker-owned. TypedStorageRef exact storageId,semanticSha256,scope,payloadKind; approved eleven pairs only. Parent supplies AAD/kind, frame supplies revision/padded length. AppId/key/owning descriptor authority never inferred from DTO | S06 CP1 backup-graph traversal/pin boundary; CP2 reachability; backup-graph/handlers/home-state tests |
| `backup-graph.ts` current queue/owning PageRef/manifest readers | Every declared local historical head edge recursively walked; identical children dedup, cycles/alias conflicts reject. Leaf requires authenticated PageRef count/range/length or manifest source/sheet/ordinal/length/digest. Current checkpoint snapshot lookup uses root head; historical heads need their own context. Global traversed baselineCount must not size the selected-head baseline stream; retained history is not additional current rows/commits | S06 CP1 queue/context and descendants; missing/changed/wrong-owner/shared-child fixtures; no bare-leaf waiver |
| Original commits in `event-commit.ts`, initial `promotion.ts` and `append.ts` | AuditPageV1 exact version/app/entries; CommitEvidenceRef exact segment/commitId/commitSha256, segment typed app.events. Original bytes/hashes/event IDs/sequence/hybrid/provenance preserved. Ordered by original compare tuple, not SHF1 revision; all covered commits including import, tail strictly later | S06 CP1 writer/resolver/pages; caps1024/524288bytes, segments10000events/16MiB; reject oversized original rather than split |
| `promotion.ts` initial import; `import.accepted` checkpoint/source/snapshot/baseline IDs | Initial rows are pages, **no record.created events**. Preserve authenticated original import checkpoint and all PageRefs needed to reconstruct imported origins/history, matched to original event identity and existing typed digest authority. Carry exact required roots through later compactions, not all prior heads | S06 CP1 candidate/retained origin/history adapter; CP2 installed replay/restore; original V1 promotion remains read-only and byte-compatible |
| `verifyBackupFrontier` and repository `chainState` | Current frontier check already rejects nonnull genesis via encodeCommitBody (decoder also enforces); preserve and add frontier regression. Basis coverage is missing; chainState tail-only. Derive all contiguous original chains1→checkpoint→tail, original terminal hashes/hybrid times, basis coverage. Duplicate physical reachability differs from duplicate logical audit entry; supplied anchor alone not proof | S06 CP1 frontier/export/publication tests; CP2 repository and append chain, multi-device/two-compaction regression |
| ConflictPageV1/EventEvidenceRefV1 first concrete forms | Exact page version/app/entries; entry conflictId/detected/resolved; event ref commit/eventId. Same app/conflict/kind; pending iff null; complete original alternatives/baseline/source/time/report/resolution preserved. Existing005 conflict status/FK/report/baseline constraints remain, no lifecycle addition | S06 CP1 codec/resolver and storage fixtures; separate conflict assertions, no successful F06 command double; CP2 preservation; CP4 vault report |
| RecordPageV2 producer from projection SQL/port (planned) | Existing fields plus actual recordRevision/createdCommitId/updatedCommitId/provenance. EventProvenance optional-field presence and canonical evidence retained. V1 import-only defaults never applied to V2. Per-row IDs/history and original import origins agree | S06 CP1 bounded projection export, roots and event-provenance codecs, paired types/fixtures/selftests; CP2 app-session hydration |
| `record-event-payloads.ts` and projection `cbor-values.ts` | Existing record-event map uses explicit optional nulls/frozen subset; EventProvenanceV1 is required source + absent optional fields/arbitrary evidence. These are distinct encodings, not an Author contradiction. Keep old event bytes, factor proper V2 codec and lossless projection adapter | S06 CP1/2 code/test lease covers both; optional absence/present evidence/null/bytes/nested canonical value round trips; no invented provenance |
| `authoredState`, `apply-events`, `hydrate`, `toProjectionCheckpoint/toProjectionRecord/replayTail` | Current hash includes row metadata and deletion restoration but not full history/conflicts. Build candidate history from original evidence and retained import origin; never reapply covered mutations to current rows. Direct V2 hydration + original chain anchors before tail restore | S06 CP1 candidate cursor/history and independent digest plus full reports; CP2 installed adapters/queries/VM/screen and restore handler tests |
| `event-store.ts` bodyOf/append and `append.ts` AppTarget/headBody through `import-handlers.ts` | Preserve discriminant and all roots after authored edit AND appended import. Preserve absolute frontier, old byte meaning, new table identity and session invalidation. Direct pin predicate alone does not prove historical-root reachability | S06 CP1 both writers/caller union adaptation, CP2 installed paired tests, ordinary edit→append→reopen after two compactions; no later owner assumption |
| catalog/SessionCatalogPort, cleanup.ts and unlock imports.sweep | Existing compaction requirement mandates exact encrypted obsolete-ID ticket atomic with pointer; current enum/helper import-only. Mechanical `compaction` reason + generic preparation in existing ticket keyset/scope, preserving import cancellation. Drain rechecks all live/pinned closure under CAS | S06 CP2 exact catalog/import/cleanup source+tests; no fake import workflow, broad sweep or new migration; crash/quota/empty-cursor/pin races prove no reachable deletion |
| publication.buildPublicationCandidate → bundle.openBundle → recoverBackupGraph | Vault/container006/minimumReaderVersion1 unchanged. Remote exact-source-head wrapper can remain one app.head; **local** typed retained list is arbitrary graph. Decode V2/nested versions before projection/receipt/install/cleanup; listing auth alone insufficient | S06 CP1 reader/graph/publication/backup handlers+tests and independent decoder fixture; CP2 installed proof; CP4 separate empty-context vault-only recovery |
| receipt/count readers `readAppDurability`/pendingChangeCount | All held local device frontiers versus matching authenticated confirmed frontier; compaction itself changes neither count/time nor authored sequence/reminder. Confirmed E plus editE+1 leaves one | S06 CP2 home-state/catalog/backup tests; CP4 reopened actual status; accepted S02/S03 semantics unchanged |
| real createDataWorkerHandler/data.worker composition and durability fixture | No compactor/scheduler at HEAD. Planned bounded worker scheduler128-tail/1500ms; actual real-clock J3 rather than a force call. Current decoder report lacks complete history and fixture evidence hardcodes s02 | S06 CP1 report adapter, CP3 constructor/lifecycle/harness self-tests, CP4 J3 identity and oracle; exact lease covers all; root runner unchanged |

Canonical constraints: TypedStorageRef allows app.head/head, app.checkpoint/checkpoint-manifest, app.records/record-page, app.events/event-segment, app.baselines/baseline-page, app.conflicts/conflict-page, app.audit/audit-page and same-named app.source-manifest/source-chunk/snapshot-manifest/snapshot-chunk. Storage IDs canonical16-byte text; hashes32 bytes; typed roots sorted decoded IDs. Audit page roots remain logical commit tuple order; conflict roots binary conflictID order. Named legacy head edges retain StorageRefV1. Record V2 provenance sorted field-ID maps `{fieldId,value}` using EventProvenanceV1; live rows only. Every map exact keys, overflow/caps reject. Semantic payload hash includes inner self-hash; head body hash excludes its self-hash; commit canonical body hash and reconstructed authored-state hash are separate; remote ciphertext hash is never used as a local plaintext digest. Unknown/missing/bad identity/version cannot become empty/success.

No schema discrepancy is demonstrated: 003 already permits scopes/kinds,004 includes original conflict/merge events,005 allows existing pending/resolved and history subjects,006 remains container-compatible. Import-only cleanup enum is a code limitation relative to the existing authorized compaction ticket operation, not a missing protected layout; S06 owns its narrow additive implementation and tests. Existing conflict vocabulary and record-event versus EventProvenance encodings describe different subjects/representations and are preserved. Coder cannot change Author inputs. Further source-backed contradictions must be batched with exact evidence; none is left as a CP0 investigation assignment.

### Findings and inherited disposition

- Historical attempt4 nonempty format gap: **Author input closedafe37f3**, implementation assigned S06 CP1/2/4. Prior unresolved alternatives remain verbatim in historical handoffs/old PLAN-CHECK only.
- r2 pin/append; r3/r4 bounded hash/CBOR/cursor/lifecycle/current graph; r9 hydration/count corrections: accepted S02 commits and evidence unchanged. S06 new-format preservation extends them; it does not reopen accepted checkpoints.
- PC-F05-01 and PC-F05-04 history/restore seam: S06 CP1 candidate history, CP2 installed reader+UI, CP4 J3. PC-F05-02 countdown closedS02; PC-F05-03 parent-scope mapping retained; PC-F05-05 local security remains S07 CP1/5. F05-APPROVAL-01 actual-worker clock and -02 stale prose closedS03/documentation; J3 independently owns actual timer isolation.
- New source-backed seams above (V1-only append, original import checkpoint origin, history hash incompleteness, logical-versus-physical audit order, genesis/basis validation, cleanup, nested decoder and fixture identities) are assigned within S06 CP1–4 with all consumer/test paths in its71-path lease r4 (instruction revision r5). No competing finding backlog or deferred generic owner correction.
- Provider registration/qualification INPUT-DROPBOX/ONEDRIVE and S07 cloud/J6 remain required. Design98ee79c ready. No live credential, OS save qualification or GATE-F05 verdict is inferred. Prior FINAL-REPORT input paragraph and .program/blockers historical summaries are superseded here; Orchestrator updates scratch/report after receive, outside this lease.
- Broader F04 review debt, CL-03/05 export classification, AR-1 unavailable grammar source, M46/M39 inherited layout observations retain prior owners/resumption conditions. No unrelated cleanup or visual parity claim. Inspected review sources and limitations are in PLAN-CHECK.

## Granularity Note

Graph correction retains seven sessions/28 checkpoints. Repeated CP2 seams were a decomposition defect: first nonempty production and the backup reader/gate were assigned across time without a complete mapping. S06 now co-owns those connections at CP1 before its CP2 pointer swap, with positive nonempty proof before any consumer sees the format. S02 keeps the coherent current-producer graph/cursor/lifecycle working set. No verification-only or bookkeeping session added.

Seven sessions because there are three genuine artifact boundaries: shared vault/transport crypto before bundle; the first working bundle graph/IO column before fan-out; and ready vendor adapters plus compaction-compatible readers before cloud composition. S02 keeps all overlapping first-journey files in one six-checkpoint conversation. S06 is split for the independent checkpoint/history/replay working set, not because it lives in another layer. Vendor adapters have disjoint source/test leases and frozen shared inputs. No verification-only, bookkeeping-only or conflict-avoidance foundations session exists. The first complete path is J1, S02 CP4/6; S03 owns reminders/status, S06 compaction, S07 cloud/lifecycle/egress integration. Planned tests remain planned.


### Historical CP2 receive — 2026-09-24

CAZU0/h-mQLm ended by end_turn. Raw attempt5 saved; 26 checkpoint paths verified within r5, no implementation residual. Root independently ran exact GRAPH-S02 (25 files/209 tests), typecheck and lint, all exit 0, and checked source/config/fixture hashes. Architecture delta consumed in 5a977e6. The earlier r4 proposed APIs, callback-only lifecycle gap, cursor gap and eager pin/hash/CBOR shortfalls above are closed by c7e6507; historical planning descriptions are retained as evidence, not current blockers. Provenance regression fixed in the same checkpoint. S02 is not done: CP3 native-save work remains independently implementable; DEC-72/design blocks fallback and CP4. Continue same worker context with unchanged lease, fresh r6 envelope. No nonempty graph/J1/native-save proof claimed.


### Historical Partial CP3 receive and quiet boundary — 2026-09-24

CfLns/h-1hdD ended by end_turn. Raw attempt6 saved verbatim. Commit d75830df961fc9713b12539312594b4f16d78693 has exactly 21 leased paths matching tested inventory; recorded source/config/fixture/build hashes verified before doc updates. Root independently ran `pnpm verify` at d75830d: typecheck 0, lint 0, all 214 test files / 2402 passed / 3 inherited skipped, build 0. This includes native branch and GRAPH-S02 tests. Build retains large-chunk warning. Native destination and Worker constructors are doubles, IndexedDB is isolated fake-indexeddb; no actual browser/OS/J1 proof. Partial CP3 architecture consumed in 385e794. No uncommitted implementation or pending arch delta remains. Slot/port/build resources released. CA-36/37/39 native contributions updated, not promoted to complete capability readiness.

All remaining branches depend on unanswered DEC-72/design, DEC-71, GRAPH-CONTRACT, provider inputs or their predecessors. Native independent work completed to the actual protected boundary; no mechanical lease blocker remains. No recovery attempt ceiling was used to stop safe work. DEC-72 human → Designer → S02 full CP3/CP4; DEC-71 human → Designer/S03; GRAPH-CONTRACT human/DB Author → S06; registrations human → S04/S05/S07. CAP-05 countdown remains S02 CP5, not retired. GATE-F05 demo not ready. Final report records incomplete/blocked result and final Archivist only; no F06 dispatch authorized.

Pre-existing PROGRAM-CONFIG.md, ROADMAP.md modifications and remaining untracked arch seeds are preserved. A globally clean `git status` cannot be claimed without including unrelated work; only orchestration/implementation residual is clear. Archive records and checkpoint commits remain the durable evidence.

### Historical Final Archivist receive — 2026-09-24

AIs8k/h-dRdf ended; one final pass, no content retry. Documentation commit5959ca4184e315ccc0d9903dbd005633e859e284:25 allowed arch/log/cleanup paths independently checked; protected PROGRAM-CONFIG/ROADMAP hashes unchanged. Reconciled bounded graph APIs, native producer versus unfinished readers/J1, M56/M57 placement and source-derived module registry. Complete prerequisite tracing convention promoted in arch/PROGRAM-CONVENTIONS.md; pre-existing external config stayed untouched. Full return preserved verbatim in FINAL-REPORT.md. Archivist's two stale present-tense summaries and DF-F05-1 scope are corrected above; historical handoffs unchanged. No new implementation counterexample or proof invalidation found. CL03/05 export classification remains Planner-owned optional cleanup, not removal authorization; AR-1 transcript grammar validation remains Orchestrator/Archivist debt until its source is available. All required F05 capability blockers and named proof owners remain unchanged.



### S02 r10 independent receive — 2026-09-25

Raw result `.program/results/F05-SESSION-02.attempt10.result.md`; worker ended. Correction823012b has exactly four leased paths, no residual source changes. All six CP commits reconciled plus corrections2cd5ad4/823012b. Independent typecheck/lint exit0; pnpm test220files/2438passed/3inherited skips exit0. Exact fresh-build browser command `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e --project=browser bundle-backup recovery-countdown sync/bundle --workers=1 --global-timeout 900000` selected4 and passed4 exit0. BuildId823012b, source/config identities and saved artifact hashes verified; evidence copied `.program/recovery/F05-S02-r10-independent/`. Real workers, ports, IndexedDB and same-context restart exercised; native destination doubled, no OS claim. Relevant deterministic concurrency regressions failed before correction. r9 import counterexample closed by823012b. Architecture delta consumed8876404; no pending receive. S03 inputs ready; future nonempty graph/provider proofs remain owned and blocked.

### S03 controlled lease r2 and preflight

S02 fully received5333da8, source base823012b. Add `tests/e2e/accessibility.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/dark-semantics.spec.ts`, `tests/e2e/offline-guard.spec.ts`, `tests/e2e/workbook-import.spec.ts` for expected reminder dismissal at accepted scratch-save boundaries in CP2/CP4; retain original assertions. Owns/Files/checkpoints/LEASES/session table updated together. No active worker, overlapping owner or residual source edits. S02 produced real readAppDurability/AppDurabilityViewV1, all-device count correction2cd5ad4, mounted J1 and tests/e2e/fixtures/durability.ts. Actual data.worker ClockPort still dynamically calls Date.now;37303ce REMINDER-CLOCK-S03 mechanism remains applicable. Future reminder writer/policy/clock fixture are S03 outputs, not missing predecessor inputs. Accepted vault/save/reminder mocks ready. Current J1 verified823012b; no pending receive or arch fragment. Only S03 eligible; port8081/dist/playwright reserved at launch.


### S03 r2 receive and r3 controlled amendment

Ended h-z_uR/CqY3I, raw `.program/results/F05-SESSION-03.attempt1.result.md`; declared-blocked0/4, no commits/source residual/arch delta. Eight-case production-handler diagnostic at2a87de3 is investigation, not acceptance; archived `.program/recovery/F05-S03-r2/cp0-noop-diagnostic.json`. Existing schema commands unconditionally commit unchanged drafts; zero drafts throw. Identical chart save also commits. S03 CP1 explicitly requires no-op authored-count/reminder suppression; correction belongs to command producer, not downstream hiding. r3 adds six exact paths listed SESSION03, co-updates Owns/Files/CP1/LEASES; existing handler/protocol/route fixtures cover other consumers, chart null-commit mapping already ready. Same-context continuation chosen over separate owner to keep producer and reminder proof together; no protected format/product change or history rewrite. Completed S02 receipt/count proofs remain valid for actual durable commit identities. S03 must prove no new writes/counts/history/reminders for unchanged input and retain stale/invalid refusal. No source change means prior baseline remains valid; no acceptance gates claimed for CP0.


### S03 r3 complete receive — 2026-09-25

Endedh-S9Em/C6lAC, raw `.program/results/F05-SESSION-03.attempt2.result.md`; done4/4. CP1 59caafb(17paths), CP2 a016752(25), CP3 d8b4e14(19), CP4 47a633b(11);58unique paths all withinr3; no residual code. Independent typecheck/lint0;223files2461unitpass3inheritedskips0; fresh-build command `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e --project=browser bundle-backup recovery-countdown sync/bundle scratch-reminders backup-status --workers=1 --global-timeout=900000` selected11passed11exit0/no retries/skips. Build/source/config/served-worker identities47a633b checked; new evidence `.program/recovery/F05-S03-r3-independent/`, prior full evidence preserved `.program/recovery/F05-S03-r3/`. Coder full e2e81/81pass at identical final source,6.7m; root reviewed changed-file/config digests and independently reran required composed gates rather than repeating full slow suite. Short-phone reminder and desktop stale-home screenshots inspected; Coder37screens/36axevariants reported. Architecture delta consumed27dd483; M05/M47 pre-existing seeds untouched, tracked F05 delta files used. No-op producer defect closed59caafb; existing author edits retain exact-count/stale/reopen assertions. No pending receive or worker.

Follow-up disposition: cloud/provider status and J4 carried S07; nonempty graph/J3 carried DB/Author+S06; inherited cramped600px Settings rows carried M46 next Planner UI maintenance assignment, clipped900px rail branding carried M39 next Planner UI maintenance assignment (not introduced by S03). Prior ERR_NETWORK_CHANGED startup failure retained as environmental event, closed by same-configuration final and independent current-build passes without timeout/retry changes. Owned320px toolbar interference fixed47a633b, original gate unchanged and fullsuite81passed. These are named obligations, not unowned completion claims.

### Provider design receive and seam recheck — 2026-09-25

DESIGN-F05-PROVIDER-STATES h-djr8/DRxZj ended done; commit98ee79c exactly new mocks/f05-provider-states.html and two added design.md inventory rows, no existing mock/row edits. Root inspected diff, source/account/disconnect/no-receipt mapping and desktop wrong-account/320px200%-text disconnect images. Designer80renders/fivewidths and30a11yaudits0violations; no application/provider proof. All assigned provider states plus adjacent cancellation/error/quota/unavailable states have sources; no second design gap found. Raw result `.program/results/DESIGN-F05-PROVIDER-STATES.result.md`, source/evidence digest checked. S07 Reads/source instructions updated. No running worker/pending receive. Only exact protected graph input and provider registrations block remaining Coder branches; final Archivist next.

### Final Archivist receive and current-summary closure — 2026-09-25

AaO0_ ended; raw `.program/results/ARCHIVIST-F05-CONTINUATION-FINAL.result.md`, commit3ea3606 contains25authorized docs (23arch+ARCHIVIST-LOG+CLEANUP-LEDGER), no outside writes. Root matched20protected file hashes. Orchestrator corrected reported stale DEC71/72, approval-review, VB02, CAP39 action trace, CA36/37/40 prose, seam preflight and graph resumption summaries against47a633b/98ee79c, preserving historical handoffs byte-for-byte. CA/CAP current tables and current prose now agree on accepted local behavior and owned future graph/provider/J6 proofs. No implementation or gate changes; no new tests needed for this documentation receive. Convention/framework recommendations and212export classification brief remain named Planner/framework-maintainer obligations; no cleanup executed. Final report receives raw note verbatim once. No worker, pending receive, unresolved handle or arch fragment remains.

## Graph planning review receive — 2026-09-25

Adw4M reviewed Author afe37f3/plan109513b. F05-GRAPH-APPROVED-01 independently confirmed in vault.ts refs/readManifest, shared encode/decode physical-order gate. Assigned S06 CP1 with source+paired test under lease r2, all 68 paths mirrored in Files/LEASES/STATE. CA-35/41 remain agreed with planned nonempty implementation/proofs. Review dispatch hold cleared by exact mechanical assignment; required regression remains due, not verified. Typecheck/lint baseline exit0; historical producer proof retained. No additional schema choice or root harness gap. Provider inputs remain blocked.




## Original evidence mapping clarification — 2026-09-25

S06 r5 declared-blocked with23uncommitted files; exact full-file recovery snapshot/inventory in .program/recovery/F05-S06-r5, source digest24d6b6d895d68cf7317c2285626e154a4b7425deee2f456a2dd7d6e88d99b2d1. No checkpoint/arch accepted. Root DB under existing explicit approval supplied91ad694: closed maps for detection/resolution/merge, lossless alternatives, baseline/report/status and same-commit effect mapping, no SQL/outer-event change. CA35/41 agreement now includes afe37f3+91ad694; producers/proofs remain planned S06CP1/2/4. Scoped delta review A-j3X received: no additional gap; changed boundary ready for S06 resumed implementation, all proofs still pending. Partial typecheck/lint217tests/build are worker-reported component evidence, not full acceptance.


## S06 recovery at open checkpoint — 2026-09-25

r6 ended context-exhausted, first nondeclarative exhaustion on this CP1 shape. No checkpoint commit;25file partial inventory3bf69d9f465e8ecfbbee9c0af807f38dde603eb537acb55b2517b64f8d727a44 independently matched and preserved in .program/recovery/F05-S06-r6.tar.gz, including additions and unaccepted arch. Prior r5 recovery directory was archived and byte-verified then removed from scratch to avoid root lint scanning copied TS; original source untouched. Fresh recovery1 under unchanged71path lease r4/instructionr7 owns remaining CP1 evidence replay/effects/proof and CP2–4. No new Author/lease input missing. All nonempty capability proof remains pending.

## Baseline Author clarification receive — 2026-09-25

Recovery1 r7 returned a declared Author seam before writing; all25files still match3bf69d9f465e. This is not a second context exhaustion. Root DB under standing explicit approval committed17a73ae: V1 reason-not-recorded compatibility, actual original import-scope authority, V2 complete encrypted baseline scope/entry, consumer assertion cannot supply missing facts, ambiguous legacy non-import reconstruction rejects/preserves. CA35/41 accepted source now afe37f3+91ad694+17a73ae. S06CP1 codec/real projection/vault-only proof, CP2continuity remain planned; F06 owns real durable-home baseline establishment. Delta review pending before resumed dispatch; no new product or destructive choice.

## Handoff Notes

### Orchestrator preflight receive — 2026-09-24

Read-only Archivist review AO787 returned five findings PC-F05-01–05; raw note preserved in .program/results/ARCHIVIST-F05-PLANNING.result.md and append-only archivist-notes. Bounded Planner correction P7OBZ landed 5e38ca77701df0d61c4b231446f6b6e55ce2d430, all twelve committed files inside its plan-only envelope. No application changes or arch delta. Orchestrator rechecked the affected checkpoint contracts and exact new history/recovery source/test leases, current migration003 scope origin, and S07 security discovery route; planning review cleared for S01. All implementation/CAP proofs remain planned or blocked. Typecheck and lint independently rerun at unchanged application source 2c35bfb, both exit 0; no build/browser/live proof claimed. User go clears startup objection; product questions DEC-71/72 remain pending.

### SESSION-01 receive — accepted 2026-09-24

Raw final reply saved .program/results/F05-SESSION-01.result.md. Three explicit checkpoint commits inspected individually; all 31 filesTouched paths within r1; leased tree clean, no residual commit. Orchestrator ran typecheck/lint (both 0) and exact focused crypto/codec/protocol/property selector (16 files, 71 passed, one inherited skip, exit 0) against CP3 8674766. Due production assertion sources inspected, including actual AEAD scope/kind rejection, fixture regeneration and forged exact-hash receipt readback rejection. Full 2364/3-skip suite and build were reported by Coder, not independently rerun at receive. No browser/live gate due here. Architecture delta consumed in 5d73ba2 and preserved under results. Native transport await timed out repeatedly but same handle reattached; final lifecycle endedBy=end_turn, no recovery or checkpoint shortfall. Future graph descendant/semantic reconstruction and storage/save evidence remain S02, compaction S06, real provider qualification S04/S05/S07. No capability promoted to complete. Pre-existing outside plan edits remain untouched.

I’ll read the exact envelope and required program context, then check the session’s prerequisites and write set before making changes.


This session owns crypto and transport contracts, with no UI work or live provider calls. The lease is clear. I’m checking the migration and existing key handling before adding vault protection.


The source check confirms the corrected CA-35 mapping: scope comes from authenticated parent context, while revision and padded length come from SHF1. Local reference digests hash plaintext, not ciphertext.

Checkpoint 1 will add independent vault derivation and opaque key wrapping, with rejection tests and the existing local crypto vectors kept unchanged.


The vault wrapping code and initial rejection tests are in place. App wraps bind both app and vault IDs; vault wraps bind the KDF descriptor; local protection uses a separate scope. The tests also check that the rewrapped app key opens the original scratch ciphertext.


Checkpoint 1 is committed as `694c741`: 49 crypto tests passed, one inherited slow calibration test remained skipped, and typecheck/lint passed.

Checkpoint 2 will add strict vault codecs, SHF1 reference authentication, bundle framing contracts, and a stateful provider double. Its tests will check that failed uploads and stale CAS attempts leave the head unchanged.


The codec and reference tests are running. Scope and payload-kind substitution tests call the real AEAD decryption path. The provider double exercises atomic create/replace races, immutable-object conflicts, and interrupted uploads. Next I’m checking continuity from checkpoint chain evidence through decoded event segments.


Checkpoint 2 is committed as `13e83f1`: 63 tests passed across 14 files, one inherited slow test skipped, and typecheck/lint passed. The new boundary check initially misclassified an import between ports; I corrected the path rule and reran it with negative controls.

Checkpoint 3 will bind publication candidates to the authenticated predecessor, preserve unchanged apps and permanent markers, and verify deterministic fixture regeneration. Complete application-graph export and storage/restart proof remain assigned to S02/S06.


The candidate builder is implemented. It re-authenticates supplied graph objects, checks checkpoint-to-tail continuity, hashes the supplied canonical authored state, and holds private copies of candidate bytes. Publication uploads immutable objects before attempting the head CAS; the new tests check stale predecessors, interruptions, and forged receipts.

I’m now finishing fixture regeneration and the full verification pass.


The focused suite passes: 70 tests across 16 files, with one inherited slow test skipped. Fixture regeneration matched every committed byte, and the recovery test opened the checkpoint from the vault secret alone.

The full suite, typecheck, and lint are running. I’m reviewing the final diff and documenting which graph-export and integration proofs remain with later sessions.


The full suite passed: 2,363 tests across 207 files, with the three inherited skips unchanged. Typecheck and lint passed too. The production build is running.

These results verify the shared producer contracts. S02 still owns complete graph export, save confirmation and restart proof; S06 owns compaction integration; S04/S05/S07 own provider qualification and composition.


Self-review found a receipt case worth strengthening: the correct candidate hash alone does not prove the head was written. Publication now also reads back matching head bytes and revision, with a test that rejects a forged exact-hash receipt. I’m rerunning the required gates after that change before committing checkpoint 3.


All three checkpoints are committed. Final verification passed: 71 focused tests across 16 files, 2,364 tests across the full 207-file suite, plus typecheck, lint and build. The three inherited full-suite skips remain, and Vite reported a large-chunk warning.

I’m recording the final evidence and checking that every checkpoint commit stayed inside the lease.


## Handoff

- **session:** F05 SESSION-01
- **status:** done
- **checkpoint:** 3 of 3, committed separately.
- **notes:** Shared producer contributions for CAP-39/40/44 completed. CA-34 lands `createVaultCrypto`; CA-35 lands `referenceFromLocal`, `authenticateReference`, `verifyBackupFrontier`, and `buildPublicationCandidate`; CA-38 lands `DurableHomePort` and `publishCandidate`. Complete user capabilities remain unverified.
- **delivered:** Independent vault secrets and opaque app-key wrapping; strict migration-006 codecs and bundle framing; authenticated references and frontier checks; immutable publication candidates, conditional publication and receipt/readback validation; stateful provider double; reproducible encrypted fixtures. Existing scratch ciphertext and local crypto vectors remain unchanged. Commits:
  - CP1: `694c741e3882c7a238eeba20459516d1f71b800d`
  - CP2: `13e83f15b6438406fef1b088e85d3600691a831c`
  - CP3: `8674766580be6be7a5b846371c797b2c9e73201c`
- **verification:**
  - CP1 `pnpm test tests/unit/crypto`: 7 files, 49 passed, 1 inherited skip; exit 0.
  - CP2 focused crypto/codec/protocol/property command: 14 files, 63 passed, 1 inherited skip; exit 0.
  - Final `pnpm test tests/unit/crypto tests/unit/codecs/vault.test.ts tests/unit/sync/protocol tests/property/sync`: 16 files, 71 passed, 1 inherited skip; exit 0. Discovery matched intended scope.
  - Final `pnpm test`: 207 files, 2,364 passed, 3 inherited skips; exit 0.
  - `pnpm typecheck`, `pnpm lint`, and `pnpm build`: exit 0.
  - Crypto tests reject wrong secrets, altered KDFs, app/vault substitution and destroyed handles. Reference tests use real `decryptEnvelope` to reject scope/kind substitution and distinguish plaintext from ciphertext hashes.
  - Protocol tests reject missing/extra objects, broken chains, resurrection, stale predecessors, forged receipts—including a correct hash without a published head—and cancellation during readback. Failed CAS/interrupted-upload tests preserve the prior head.
  - Fixture self-tests regenerate all four files byte-identically, detect corruption, and recover the checkpoint through real crypto/codecs. Provider storage is a stateful double; application storage/restart and platform save were not exercised.
  - All three commit path sets verified inside lease; leased tree clean. Final build source matches CP3, with patch identity recorded in [evidence.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s01/evidence.json).
- **surprises:** Lease r1 used throughout. Corrected a boundary-test false positive for imports between ports. Self-review added exact head readback and cancellation checks. A newer concurrent head during readback conservatively rejects confirmation. Vite reports chunks above 500 kB. No outside-lease source changes caused.
- **followUp:** Orchestrator must update CA-34/35/38 mappings before consumer dispatch. S02 owns authenticated descendant extraction, independent authored-state reconstruction, complete bundle assembly, save receipts and J1 restart proof. S06 owns compaction/J3. S04/S05 own live provider qualification; S07 owns account-bound composition and lifecycle integration. DEC-71/72 remain with their existing owners. Architecture delta: [F05-SESSION-01.arch.md](/Users/the.phoenix/WebstormProjects/sheaf/.program/signal/F05-SESSION-01.arch.md). No server started.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** —
- **filesTouched:**
  - `src/application/ports/backup.ts`
  - `src/application/ports/durable-home.ts`
  - `src/application/ports/vault-crypto.ts`
  - `src/crypto/kdf.ts`
  - `src/crypto/keys.ts`
  - `src/crypto/recovery-code.ts`
  - `src/crypto/vault-port.ts`
  - `src/crypto/vault.ts`
  - `src/persistence/codecs/vault.ts`
  - `src/sync/protocol/frontier.ts`
  - `src/sync/protocol/publication.ts`
  - `src/sync/protocol/references.ts`
  - `tests/fixtures/vaults/f05/README.md`
  - `tests/fixtures/vaults/f05/checkpoint.shf`
  - `tests/fixtures/vaults/f05/generate.ts`
  - `tests/fixtures/vaults/f05/head.cbor`
  - `tests/fixtures/vaults/f05/helpers.ts`
  - `tests/fixtures/vaults/f05/index.shf`
  - `tests/fixtures/vaults/f05/manifest.shf`
  - `tests/fixtures/vaults/f05/publication.ts`
  - `tests/property/sync/vault.test.ts`
  - `tests/provider-contract/shared/double.ts`
  - `tests/unit/codecs/vault.test.ts`
  - `tests/unit/crypto/vault-port.test.ts`
  - `tests/unit/crypto/vault.test.ts`
  - `tests/unit/sync/protocol/fixtures.test.ts`
  - `tests/unit/sync/protocol/frontier.test.ts`
  - `tests/unit/sync/protocol/module-boundaries.test.ts`
  - `tests/unit/sync/protocol/provider-double.test.ts`
  - `tests/unit/sync/protocol/publication.test.ts`
  - `tests/unit/sync/protocol/references.test.ts`

### DESIGN-F05-VAULT receive — 2026-09-24

Accepted commit 58bffc8897f9de0326ff9f94380ad84a80733789: exact new mock and five added inventory rows only; no existing mock changed. Orchestrator inspected diff, required states, evidence manifest and compact screenshot. Designer reports 80 rendered states across five classes and keyboard/200%-text checks. Fixed vault-secret/recovery portion of DF-F05-1 ready; save/reminder/provider surfaces still owned by Orchestrator/Designer, policy gates unresolved. No application capability proof or arch delta. Native lifecycle endedBy=end_turn; lease released.

I’ll read the design-fill envelope and existing design sources, then build and verify the scoped mocks. I’m using the frontend-design skill for this work.


The existing mocks establish the shell styling and separate local and vault recovery scopes. I’ll preserve those contracts and add detail only in the new file. Your no-delegation instruction takes precedence over the skill’s agent workflow; I’ll inspect the renders myself using the agent-browser skill.


The fixed contract offers either a new named-vault passphrase or reuse of the local passphrase, entered again. Recovery issuance must label each code’s scope and show both codes together when the passphrase is reused. I’m adding those states, named-vault unlock errors and cancellation, and vault-code re-view. Reminder and save-confirmation surfaces remain outside this fill.


The mock and inventory additions are written. The compact render keeps the two recovery scopes distinct in a full-height sheet. I’m now checking all five widths, including scroll access to the code warnings and actions, error focus, keyboard behavior, and cancellation return.


The first pass exposed an inherited input-focus rule that suppressed the specified Leaf outline. I corrected it in the new mock. The 320px create and wrong-secret states fit without horizontal overflow, and Escape restores focus to the launcher.


The browser CLI stalled during repeated modal previews, so I’m switching to the Playwright skill to finish the render checks. Evidence will stay in the fill’s private directory; application build and test outputs remain untouched.


All five layout classes rendered successfully in Playwright. Inspection caught an extra background scrollbar at 320px; I’ve fixed that in the new file and am rechecking the final version. The remaining checks cover acknowledgment, retry, re-view, focus return, and enlarged text.


Verification is complete: 80 state/viewport renders fit horizontally, all measured buttons meet the 44px minimum, and the 320px layout remains scrollable at 200% text size. I also tightened Tab/Shift+Tab containment and verified error focus, draft clearing, acknowledgment, re-view, and focus restoration. I’m committing the two authorized files now.


## Handoff

- **session:** DESIGN-F05-VAULT
- **status:** done
- **checkpoint:** 1
- **commit:** `58bffc8897f9de0326ff9f94380ad84a80733789`
- **notes:** Filled named-vault secret and recovery details within the exact write set.
- **delivered:** MOD-020 choice/create/reuse; MOD-021 issuance and acknowledgment; MOD-023 unlock/error/cancel; distinct vault-code re-view. Added four component rows and one screen row.
- **verification:** Playwright Chromium rendered 16 states at 320×740, 430×932, 768×1024, 1024×768 and 1440×1000. Visually inspected every class. Verified overflow, 200% text, keyboard containment, error focus, acknowledgment and cancellation. Commit contains exactly the two authorized files. [Evidence](/Users/the.phoenix/WebstormProjects/sheaf/.program/design-f05-vault/README.md).
- **surprises:** Browser CLI stalled; completed verification with Playwright. No design-policy deviations.
- **followUp:** SESSION-02/07 can consume these scoped designs. Orchestrator/Designer retains reminders, saved/cancelled/failed/unconfirmed outcomes, and provider authorization/reconnect/disconnect. DEC-71/72 remain unresolved; this fill does not clear those checkpoint gates.
- **blockedReason:** —
- **filesTouched:**
  - [f05-vault-security.html](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/mocks/f05-vault-security.html)
  - [design.md](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/specs/design.md)

### SESSION-02 attempt 1 receive and r2 amendment — 2026-09-24

Declared-blocked at CP0, no commits or writes; raw final preserved .program/results/F05-SESSION-02.attempt1.result.md. Runtime CQwhv endedBy=end_turn. Orchestrator inspected appendTable deleteStorageIds and existing paired unpinned-deletion assertion, production appendIntoApp caller and import-only cleanup/workflow lists. Exact added paths src/import/staging/append.ts and tests/unit/staging/append.test.ts are clean and unowned by any active worker; no product/author/schema change. Existing caller/catalog/event-store and worker tests remain within S02 lease. r1→r2 changes future CP1 only; no accepted checkpoint or recovery artifact. Existing fast gates remain green at unchanged source 8674766; no code changed so no redundant rerun. Worker targeted preflight 4 files/50 tests passed. Before redispatch retain import cleanup reason/sweep contract, prove pin/append/read/release and preserve unpinned/rejected behavior. Same-context native resume requested; no separate correction worker. CA-35/36 readiness remains planned for S02, S01 evidence unaffected. Policy boundary still open.

I’ll read the envelope and program records, then execute S02 within its lease and protected-input boundary.


The envelope permits CP1 and CP2 before the unresolved save policy. I’m tracing home assignment, encrypted storage, and backup-root retention now; the save fallback and dependent UI journey remain gated.


The preflight found a second head-deletion path: CSV append deletes the superseded app head in `src/import/staging/append.ts`, outside this lease. That path also needs to respect backup pins. I’m checking its caller and tests to consolidate the ownership gap before any writes.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked
- **checkpoint:** 0; no implementation commits.
- **notes:** Lease r1 inspected at `9454755ce40e4c9ee8637dad26823ecdb5105768`. CP1 snapshot retention has an additional writer outside the lease. CAP-39/40 and CA-34/35/36 remain unproved.
- **delivered:** Read-only preflight identified the append-table deletion path and its existing regression assertion. No files changed.
- **verification:** `PATH=/Users/the.phoenix/.nvm/versions/node/v24.20.0/bin:$PATH pnpm test tests/unit/staging/append.test.ts tests/unit/staging/cleanup.test.ts tests/unit/workers/event-store.test.ts tests/unit/workers/catalog.test.ts` → **4 files, 50 passed, exit 0**. These verify existing behavior, not backup retention. No build, browser, or capability proof claimed.
- **surprises:** CP1 names immediate deletion in `createEventStore`, but `appendTable` independently deletes `target.headStorageId` in [append.ts](/Users/the.phoenix/WebstormProjects/sheaf/src/import/staging/append.ts:370). Production `appendIntoApp` supplies that current head and calls this writer directly; it then closes the app session. The existing [append test](/Users/the.phoenix/WebstormProjects/sheaf/tests/unit/staging/append.test.ts:222) explicitly asserts that the old head disappears. Neither file is leased.
- **followUp:** Resume CP1 after owner correction. Required regression: pin the current head, append a CSV through the production append path, verify the pinned graph remains readable while the current head advances, then verify safe release/cleanup. Preserve the existing unpinned deletion and rejected-append no-change assertions. Related constraint: existing cleanup reasons are import-only, and `sweepStaleImports` treats every active workflow as an import; backup retention must not register incompatible tickets/workflows there. DEC-72 and save-design prerequisites remain unchanged for later checkpoints; they are not this immediate blocker.
- **needsOwnerCorrection:** Mechanical owner seam. Orchestrator should issue lease r2 adding:
  - `src/import/staging/append.ts` — make superseded-head deletion honor the same backup-retention contract as `createEventStore`.
  - `tests/unit/staging/append.test.ts` — add pinned/unpinned append retention coverage and preserve rejection assertions.
  
  This closes CP1’s existing retention requirement without changing product policy. No accepted checkpoint or pending implementation needs recovery.
- **needsDesignSource:** Existing DF-F05-1 save-outcome detail remains with Orchestrator/Designer before dependent UI work.
- **blockedReason:** CP1’s immutable-snapshot acceptance cannot cover the independent append writer with the current write set. Returning before dependent implementation, as required by checkpoint-0 lease checking.
- **filesTouched:** —

### SESSION-02 attempt 2 receive and r3 amendment — 2026-09-24

Declared-blocked CP0, no commits/writes; C9rR1 endedBy=end_turn. Source-backed CA-35 counterexample: graph.objects eagerly carries bytes; publication clones full graph, retains decrypted payload map and clones candidate objects. Passing authentication tests do not prove bounded processing. CA-35 affected readiness stale; historical evidence retained. S02 r3 adds exact shared backup/publication/frontier and paired test/fixture paths; source consumer sweep found only those current callers, frontier included to avoid a sequential segment-accumulation seam. No active owner or unrelated edits on these paths. CP1 independent; CP2 owns bounded-read correction, batch negative control, immutable validation and fixture preservation. S01 completed history remains 3/3; corrective integration work must pass before future consumers. Two distinct declared ownership/contract findings, not context crashes. No residual/arch delta. No redundant gates on unchanged source. Raw final follows.

I’ll read the complete r2 envelope and current records before writing, then resume within its lease and protected-input boundary.


I acknowledge lease r2 at HEAD `9466660feaaed3fa303106554d2e14df66da5689`. It adds the append writer and its tests, and confirms the previous worker ended. I’ll recheck CP1’s assignment and retention paths; DEC-72 and the dependent UI acceptance remain gated.


The append seam is covered by r2. I’m now checking that S01’s vault-key API accepts the handles produced by the existing worker, and that home assignment can commit atomically with its event and catalog update.


I found a separate predecessor mismatch for CP2: the approved exporter must use bounded reads, but `BackupAppGraphV1` requires every object’s bytes in one array. `buildPublicationCandidate` then clones that graph and retains all decrypted payloads during verification. These S01 files are outside r2. I’m checking the affected consumers and tests to return one concrete correction request.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked
- **checkpoint:** 0; no implementation commits.
- **notes:** Replacement lease r2 acknowledged at `9466660feaaed3fa303106554d2e14df66da5689`. Append writer/test ownership is corrected. Predecessor recheck found a separate CA-35 contract mismatch affecting CAP-40 and CP2.
- **delivered:** Read-only trace of snapshot retention, vault-key composition, and publication contracts. No files changed.
- **verification:** With the prescribed Node PATH, `pnpm test tests/unit/sync/protocol/publication.test.ts tests/unit/sync/protocol/references.test.ts tests/unit/sync/protocol/frontier.test.ts tests/unit/sync/protocol/fixtures.test.ts tests/unit/staging/append.test.ts tests/unit/workers/event-store.test.ts` → **6 files, 21 passed, exit 0**. Existing assertions cover authentication, publication identity, rejection, fixture recovery, append deletion, and event-store transactions. They do **not** prove bounded graph processing. No build, browser, or capability proof claimed.
- **surprises:** S02 requires bounded snapshot loaders, explicitly excluding holding all ciphertext in memory. However, [BackupAppGraphV1](/Users/the.phoenix/WebstormProjects/sheaf/src/application/ports/backup.ts:30) requires an array containing every object’s bytes. [buildPublicationCandidate](/Users/the.phoenix/WebstormProjects/sheaf/src/sync/protocol/publication.ts:108) clones that entire graph; `verifyGraph` retains every decrypted payload; candidate storage and `readPublicationCandidate` clone complete object collections again. Sequential store reads cannot resolve this downstream accumulation. This is source-backed evidence, not a measured peak-memory result.
- **followUp:** Correct the shared bounded-read contract before CP2 implementation. Preserve authenticated references, immutable snapshot identity, exact-byte publication, and existing rejection assertions. Add a multi-batch regression with a negative control detecting eager whole-graph loading. CP1 remains unimplemented; this return follows the checkpoint-0 inherited-prerequisite correction rule. DEC-72 and dependent CP3/CP4 boundaries remain unchanged.
- **needsOwnerCorrection:** Orchestrator should route a bounded S01 contract correction, or issue r3 covering these exact implementation and consumer paths:
  - `src/application/ports/backup.ts`
  - `src/sync/protocol/publication.ts`
  - `tests/unit/sync/protocol/publication.test.ts`
  - `tests/fixtures/vaults/f05/publication.ts`
  - `tests/fixtures/vaults/f05/generate.ts`
  - `tests/unit/sync/protocol/fixtures.test.ts`

  Acceptance: publication consumes pinned objects through bounded reads without retaining the complete ciphertext/plaintext graph; authentication, cancellation, immutable-byte and fixture checks remain green. Preserve existing fixture bytes unless an independently justified format change requires otherwise. No accepted checkpoint or pending implementation needs recovery.
- **needsDesignSource:** Existing save-outcome detail remains with Orchestrator/Designer before dependent UI work.
- **blockedReason:** CA-35’s required bounded graph path cannot be satisfied through the current S01 publication contract within r2. Both the port and accumulating consumer are outside the lease.
- **filesTouched:** —

### SESSION-02 attempt 3 receive — CP1 accepted; r4 amendment

C4l0k endedBy=end_turn. One checkpoint commit 03ee571, all 16 paths inside r3; source/test tree clean. Orchestrator independently ran typecheck/lint exit 0 and scoped backup/append/event/ID/projection gate: 11 files, 119 passed, exit 0. Inspected pin→edit/CSV append→multiple pin→restart/release and wrong-secret/no-change assertions using real crypto/SQLite/IndexedDB, plus harness rejection control. CP1 accepted as producer contribution only; full user capabilities stay unverified. Arch fragment consumed c25742f and preserved attempt-qualified. Worker attempted to stage ignored authorized arch fragment and failed; no foreign commit or residual. Restated: scratch arch fragment is never a Coder commit.

CP2 blocked by one-shot shared hash and CBOR encoder, exact source verified. r4 adds src/crypto/hash.ts, tests/unit/crypto/hash.test.ts, src/persistence/codecs/canonical-cbor.ts, tests/unit/codecs/canonical-cbor.test.ts. No active owner or unrelated changes; existing API compatibility, byte equivalence, chunk KAT/cancellation/eager-load negative controls required. Current publication/exporter dependency path is owned; retain narrow injected integration rather than unnecessary crypto-port changes. CA-35 remains stale for bounded processing, correction owner S02 CP2; CA-34 home producer now landed. r3 historical CP1 preserved. Raw handoff follows.

I’ll read and acknowledge r3, recheck the current records, and proceed with the independent assigned checkpoints within the protected-input boundary.


I acknowledge lease r3 at HEAD `760dae1f9ccf56a7d6974e93705c55aa6c24b4fa`. CP2 now owns the bounded-publication correction, so it no longer blocks CP1. I’m continuing the assignment and snapshot-retention trace; DEC-72 and the dependent UI acceptance remain gated.


The current event-store and CSV append writers both delete superseded heads. Retention must cover both through one shared decision, while keeping backup state out of the import-only cleanup queues. The vault adapter also accepts the opaque key handles produced by the existing worker.


CP1 is complete when home assignment commits the home state, assignment event, and catalog together, and a pinned head survives both record edits and CSV append until safe release. I’m checking those transaction and restart paths before making the first edit.


The first CP1 changes are in place: a worker-owned home writer, the typed assignment event and replay handler, and encrypted snapshot pins shared by both head-deletion paths. I’m checking compilation now, then I’ll add atomicity, restart, and pin-release tests before committing.


The CP1 integration test passes through home assignment, edits, CSV append, restart, and pin release. Two existing tests need their event/ID lists updated. I’m also tightening cleanup before running the full CP1 checks.


The targeted CP1 run passed 184 tests across 16 files. Cleanup now preserves a head while another pin references it and removes the superseded home-state envelope when adding an app to an existing home. I’m rerunning the affected checks before committing CP1.


CP1 is committed as `03ee571`; all commit paths are inside r3. Typecheck, lint, and the 16-file/184-test gate passed.

CP2 must now export the pinned graph with bounded reads, authenticate its descendants, and derive authored state independently. Publication will consume one object at a time and verify reread bytes against the captured references.


CP2’s bounded-state path has another lease gap: the shared SHA-256 API accepts only a complete byte array, and the canonical CBOR encoder builds one complete buffer. Their implementations and tests are outside r3. I’m checking the available APIs and module rules before deciding whether the assigned cursor can satisfy the contract without changing digest semantics.


The installed libsodium exposes incremental SHA-256, but Sheaf’s shared hash API does not. Bounded canonical encoding is also missing. CP2 therefore needs a small lease addition for those two implementations and their self-tests; using per-page hashes would change the required digest semantics.

CP1 is preserved and verified. I’ll return the exact amendment request and architecture delta, without claiming CP2 or the later save journey complete.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked
- **checkpoint:** 1 completed — `03ee57104dbe10e99351e2e1808a2be5aacf21bd`. CP2 not implemented.
- **notes:** Lease r3 acknowledged. CAP-39/CA-34 producer contribution landed: atomic encrypted home assignment and durable snapshot retention. CAP-40/CA-35 bounded export and subsequent user journeys remain unproved.
- **delivered:** Worker-owned bundle-home creation/reuse, vault wrapping of the existing app key, typed assignment event and replay, encrypted pins, shared retention checks in event-store and production CSV append, and safe release after restart. Assignment ends scratch without fabricating successful-backup time. Architecture delta written to `.program/signal/F05-SESSION-02.arch.md`.
- **verification:** Prescribed Node PATH used throughout.
  - `pnpm typecheck` and `pnpm lint` → exit 0.
  - Focused CP1 gate → **16 files, 184 passed, exit 0**: backup handlers, event store, payload codecs, domain events/IDs, staging append, catalog, projection, and worker/command/staging boundaries. Real crypto, SQLite and IndexedDB assertions cover assignment, edits, production CSV append, multiple pins, restart/release, and rejected operations leaving durable state unchanged. MessagePort rejection negative control passed.
  - Hash/CBOR/boundary and publication/frontier/fixture gate → **6 files, 34 passed, exit 0**. Existing fixture bytes remain identical; this does **not** prove bounded processing.
  - Commit paths verified inside r3. No browser/build or complete capability proof claimed.
- **surprises:** CP2’s shared hashing/encoding dependencies remain one-shot: `sha256(Uint8Array)` and `encodeCanonical` require complete buffers. The installed libsodium exposes incremental SHA-256, but Sheaf has no corresponding public adapter. Architecture routes durable hashes through M08 and canonical representation through M09. The ignored architecture fragment could not be staged; its documentation commit failed with an unmatched pathspec. It remains available for Orchestrator. An accidental empty `/tmp/sheaf-bounded-note` was immediately removed.
- **followUp:** Resume CP2 after the bounded primitive amendment below. The r3 publication/frontier correction remains S02-owned. DEC-72 and dependent save/UI design boundaries remain unchanged; CP3–6 and J1 are unverified. No pending implementation changes require recovery.
- **needsOwnerCorrection:** Request r4 adding:
  - `src/crypto/hash.ts`
  - `tests/unit/crypto/hash.test.ts`
  - `src/persistence/codecs/canonical-cbor.ts`
  - `tests/unit/codecs/canonical-cbor.test.ts`

  Add bounded incremental hashing and canonical encoding while preserving exact existing bytes/digests. Acceptance: chunk-boundary-independent known answers, byte equivalence with the existing encoder, cancellation/error propagation, and an eager-loading negative control. Bind these through already-leased publication/exporter paths. Do not substitute a hash-of-page-hashes for the canonical authored-state digest.
- **needsDesignSource:** Existing save/reminder/provider design remains with Orchestrator/Designer before dependent UI work.
- **blockedReason:** CA-35’s bounded authored-state hashing path requires changes to shared crypto/codec implementations and their self-tests outside r3. CP1 is committed; no CP2 success is claimed.
- **filesTouched:** Committed implementation/test paths:
  - `src/application/commands/home-commands.ts`
  - `src/domain/model/events.ts`
  - `src/domain/model/ids.ts`
  - `src/import/staging/append.ts`
  - `src/persistence/projection/apply-events.ts`
  - `src/workers/data/backup-handlers.ts`
  - `src/workers/data/event-store.ts`
  - `src/workers/data/handlers.ts`
  - `src/workers/data/home-state.ts`
  - `src/workers/data/import-handlers.ts`
  - `src/workers/data/record-event-payloads.ts`
  - `tests/unit/domain/ids.test.ts`
  - `tests/unit/staging/append.test.ts`
  - `tests/unit/workers/backup-handlers.test.ts`
  - `tests/unit/workers/module-boundaries.test.ts`
  - `tests/unit/workers/record-event-payloads.test.ts`

### SESSION-02 attempt4 and graph replan receive — 2026-09-24

CaVon ended; raw reply and full patch including new files preserved. CP2 not committed or accepted; no residual commit. Proposed arch fragment remains explicitly unaccepted, preserved, not appended. No pending runtime ownership. Planner PK74w ended and committed f1eae46 within exact six plan paths; source files/patch unchanged. Orchestrator inspected revised input map, GRAPH-S02/GRAPH-S06 gates and exact S06 producer+reader+fixture leases. Existing complete current-producer graph proof remains required; nonempty future graph writer/readers/proofs now co-owned S06 CP1/2/4 after GRAPH-CONTRACT Author input. No future obligation waived. User asked scoped DB direction asynchronously; no answer presumed. Scoped affected planning review follows before redispatch. CP1 remains accepted; CA35 graph proof stays stale/planned until actual assertions close.

I’ll read the complete r4 envelope and current records, acknowledge its lease, then resume CP2 from accepted CP1 `03ee571`.


I acknowledge lease r4 at HEAD `309313170b997d2546794c6173ebcabfbd44ac5f`. CP1 remains accepted at `03ee571`; r4 now covers the incremental hash and canonical encoding work. CP2’s acceptance is bounded authenticated export from the pinned revision, with independent authored-state hashing and unchanged fixture bytes.


The current `loadApp` reader eagerly collects record pages and commits. CP2 needs a separate bounded path for the pinned snapshot so the exporter does not move that accumulation upstream. I’m checking projection hydration and replay so the semantic digest can use that same pinned state.


I found a separate contract gap in the required retained-root path: local `AppHeadV1.retainedRoots` stores only an ID and plaintext digest, while remote references require a scope supplied by the authenticated parent. SHF1 deliberately omits scope. I’m checking the approved retention mapping and producers to determine whether a fixed scope is defined before treating this as a blocker.


The current writers produce empty retained-root lists; nonempty retention and audit production belongs to S06. That absence alone does not block the bounded primitives and current graph path. I’ll keep unsupported roots fail-closed and preserve the requirement that scope come from authenticated context.


The bounded hash/CBOR APIs and publication reader changes are in place. Publication now retains references and byte hashes, then rereads and verifies one object at a time. I’m checking compatibility before wiring the pinned graph exporter and adding the eager-loading negative controls.


The first compatibility gate passed: 5 files, 33 tests, including byte-identical vault fixtures. The exporter and authored-state cursor are now wired into the worker’s backup handler. I’m testing a real imported workbook through pinning, concurrent edits, graph publication, and omission/tamper rejection.


The current-workbook path passed, including a stable hash for the pinned revision while a later theme edit changed the current state’s hash. The multi-batch publication test and eager-collection negative control also passed.

CP2’s broader acceptance remains unresolved: nonempty retained roots lack an authenticated scope mapping, and conflict/audit payload readers are not defined in the current codecs. Those branches fail closed; these tests do not prove their support. I’m finishing checks on the implemented portion and will preserve CP2 as an open checkpoint for a bounded contract correction.


The final focused gate passed: 22 files, 178 tests. The retained-root regression uses an authenticated head containing the existing two-field reference and confirms that the exporter refuses to guess its scope.

CP1 remains intact. CP2 changes are preserved uncommitted because its full CA-35 acceptance is not met. The handoff will distinguish the verified current-workbook path from the missing retained-root and conflict/audit contracts.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked
- **checkpoint:** CP1 accepted — `03ee57104dbe10e99351e2e1808a2be5aacf21bd`. CP2 remains open; no new commits.
- **notes:** Replacement lease r4 acknowledged at `309313170b997d2546794c6173ebcabfbd44ac5f`. Independent CP2 implementation progressed. CAP-39/CA-34 contribution remains intact; CAP-40/CA-35 bounded export/publication acceptance remains incomplete.
- **delivered:** Preserved uncommitted implementation of incremental SHA-256, streaming canonical CBOR, a SQLite authored-state cursor, pinned-graph export, sequential graph authentication, and publication-object reread verification. Current-workbook tests exercise immutable pins and authored-state changes. Unsupported retained-root and conflict/audit branches fail closed.
- **verification:**
  - `pnpm typecheck`, `pnpm lint`, and `git diff --check -- src tests` → exit 0.
  - Focused gate → **22 files, 178 tests passed, exit 0**. Selected crypto hash/boundaries, canonical CBOR, sync protocol, projection, backup graph/handlers, projection port, event store, worker boundaries, and staging roots.
  - Assertions cover chunk-independent hashes, canonical byte equivalence, cancellation/error propagation, eager-buffer-retention negative controls, changed-object rejection, stable pinned export after edits, and changed authored-state digests for subsequent pins.
  - Worker integration uses real crypto, SQLite, and MessageChannel with **fake-indexeddb**. No native-browser persistence or complete user journey is claimed.
  - Existing fixture bytes remain unchanged. An authenticated head containing a nonempty two-field retained reference is explicitly rejected because scope metadata is unavailable.
  - Tested CP2 source inventory SHA-256: `448408d1c2bf4ea2bef560b67b99ba079c6cf166f9fde75f1f78b136e39a1def`.
- **surprises:** `StorageRefV1` contains only `storageId` and `semanticSha256`; `AppHeadV1.retainedRoots` uses that type. Envelope scope is absent from the encrypted frame and must originate from an authenticated parent. No approved mapping supplies it for arbitrary retained roots. Concrete conflict/audit page descendant codecs are also absent. Current producers emit empty branches, but that does not prove CP2’s required nonempty graph traversal. Publication and projection port changes remain proposed, uncommitted contracts.
- **followUp:** Preserve the recovery inventory below. After the bounded contract correction, finish retained-root and conflict/audit traversal, cursor-port coverage, exporter key disposal across worker lifecycle/cancellation, and remaining graph proofs before committing CP2. Future S06 producer proofs remain separate. DEC-72, dependent save/UI checkpoints, and J1 remain gated. Proposed architecture delta is preserved in the ignored fragment; it is explicitly marked unaccepted.
- **needsOwnerCorrection:** Orchestrator should obtain a bounded Planner/database contract correction covering:
  - `src/import/staging/roots.ts` — approve authenticated scope/kind resolution for `StorageRefV1` used by `AppHeadV1.retainedRoots`.
  - SESSION-02/SESSION-06 and the database specification — provide concrete conflict/audit page wire mappings and descendant-reader ownership.
  
  Acceptance must either supply these mappings for CP2’s required nonempty-branch proofs or explicitly revise the checkpoint boundary and assign the deferred proofs. The relevant implementation paths are already leased; this requires approved contract meaning, not an invented format or broader implementation lease.
- **needsDesignSource:** Existing DF-F05-1 save/reminder/provider design remains with Orchestrator/Designer before dependent UI work.
- **blockedReason:** Full CA-35 graph acceptance requires authenticated retained-root resolution and conflict/audit descendant readers whose approved mappings are unavailable. Current-workbook success cannot substitute for those required proofs. CP2 is preserved uncommitted.
- **filesTouched:** No new committed paths. Uncommitted recovery inventory:
  - `src/application/ports/backup.ts`
  - `src/application/ports/projection.ts`
  - `src/crypto/hash.ts`
  - `src/persistence/codecs/canonical-cbor.ts`
  - `src/persistence/projection/apply-events.ts`
  - `src/persistence/projection/authored-state.ts` — new
  - `src/persistence/projection/engine.ts`
  - `src/persistence/projection/hydrate.ts`
  - `src/persistence/projection/index.ts`
  - `src/sync/protocol/frontier.ts`
  - `src/sync/protocol/publication.ts`
  - `src/workers/data/app-session.ts`
  - `src/workers/data/backup-graph.ts` — new
  - `src/workers/data/backup-handlers.ts`
  - `tests/fixtures/vaults/f05/generate.ts`
  - `tests/fixtures/vaults/f05/publication.ts`
  - `tests/unit/codecs/canonical-cbor.test.ts`
  - `tests/unit/crypto/hash.test.ts`
  - `tests/unit/projection/authored-state.test.ts` — new
  - `tests/unit/sync/protocol/publication.test.ts`
  - `tests/unit/workers/backup-graph.test.ts` — new
  - `.program/signal/F05-SESSION-02.arch.md` — ignored architecture fragment; not staged.

### REPLAN-F05-GRAPH raw return

I’ll read the bounded replan envelope and repository instructions, then update only the permitted planning files while preserving uncommitted implementation.


The preserved exporter rejects nonempty retained, conflict, and audit branches. Current writers emit empty lists, so I’m checking whether the approved contracts define enough to implement those readers now or require an Author decision. S02’s current-graph proof and S06’s future nonempty-graph proof will remain separate obligations.


The contracts define scope/kind mappings for named branches, but not for arbitrary two-field retained roots. They also specify conflict/audit contents without a concrete page wire layout.

I’ll assign the nonempty writers, readers, and integration proofs together to S06, gated on a scoped DB/Author contract decision. S02 can resume its complete current-producer graph proof with explicit rejection of unsupported branches, plus the remaining cursor and key-lifecycle tests.


The plan keeps seven sessions and 28 checkpoints. S06 now owns the publication/frontier changes, fixtures, and bundle regression tests needed alongside its nonempty graph readers.

Lease, dependency, and checkpoint checks pass. I’m finishing the evidence record and verifying that all uncommitted implementation and historical handoffs remain unchanged before committing the six authorized plan files.


## Handoff

- **Worker:** REPLAN-F05-GRAPH
- **Status:** Bounded plan correction completed.
- **Commit:** `f1eae462cba3383690986d357b4bf9029edc87d9`
- **Committed paths:** Only `STATE.md`, `MASTER.md`, `SESSION-02.md`, `SESSION-06.md`, `LEASES.json`, and `PLAN-CHECK.md` under [durable-home-backup](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/prompts/durable-home-backup).

**Disposition:** Named branches supply authenticated scope/kind; arbitrary two-field retained references lack that mapping. S02 retains complete current-producer graph acceptance, rejecting unsupported branches without publishing or discarding content. S06 now co-owns nonempty writers, descendant readers, publication integration, fixtures, and regression gates before pointer installation.

**Remaining protected choice:** `GRAPH-CONTRACT` records the concrete DB/Author recommendation, fixed-role alternative, and compatibility consequences. Human authorization is needed for that scoped contract completion. S06 and downstream compacted-graph acceptance remain blocked; DEC-71/72 and design/provider choices remain unchanged.

**Resume:** Orchestrator rechecks the amended plan and lease, then resumes preserved S02 CP2 after accepted CP1 `03ee571`. Cursor coverage, production key disposal/cancellation, and complete current-graph proofs must pass before committing CP2. J1 remains unverified.

**Verification:** Exact leases, DAG, concurrency, checkpoint order, and historical handoff preservation passed. Seven sessions and 28 checkpoints retained. All 31 pre-existing modified/untracked files remain byte-identical. No application tests, workers, or protected Author edits were performed.

### Scoped graph completeness receive — 2026-09-24

AJwdH ended read-only; no new plan ownership gap. Current-producer/first-nonempty boundary accepted as planning coverage, not implementation proof. S02 CP2 must correct upstream backup-handlers pin loadApp eager reads and production exported-key/cursor cleanup on abort/release/lock/reset/session replacement, plus full GRAPH-S02 assertions. These paths and tests are already leased. GRAPH-CONTRACT remains pending human DB/Author direction; S06 positive nonempty proofs blocked. Operational ledger and blocker current disposition refreshed; older append-only pending entries retain history only. No repeated full review necessary; source/code remains unaccepted until gates. Raw note follows.

I’ll read the envelope and scoped evidence, then return an Archivist Note without editing files or spawning agents.


The revised plan keeps the nonempty-graph obligations with S06 and leaves them gated on GRAPH-CONTRACT. I’m checking the current producers and proof paths to confirm S02’s narrower boundary preserves all existing content and covers cursor and key teardown.


The source supports the split: current writers initialize the three branches empty, while S06 owns their first nonempty writers, readers, and proofs. The preserved CP2 code still leaves exported-key disposal to its caller; GRAPH-S02 explicitly assigns that lifecycle fix and the missing cursor assertions. The operational ledger also still says the Planner is live and the replan pending, contrary to the received STATE record.


## Archivist Note

- **role:** archivist
- **mode:** planning-completeness
- **registryUpdated:** false
- **reconciled:** []
- **conventionsAdded:** []
- **proposedForFramework:** —
- **cleanupBriefs:** []
- **logEntry:**

  **2026-09-24 — Scoped F05 graph review.** Reviewed replan `f1eae46`, receive `90bf704`, accepted CP1 `03ee571`, and preserved, unaccepted CP2 source. Compared attempt4’s original findings and unaccepted architecture fragment with the revised CA-35/41, CAP-40/44, SESSION-02/06 checkpoints and leases, approved database/architecture sources, migrations 003/004/006, current producers, exporter, cursor, lifecycle handlers, sampled tests, runner configuration, and scoped ledger/blockers.

  **Conclusion:** The current-producer versus first-nonempty-producer boundary is source-backed and adequately assigned. No additional planning ownership gap was identified in this scope. This does **not** accept CP2, verify either capability, clear GRAPH-CONTRACT, or authorize dispatch.

  **Consolidated findings and dispositions:**

  1. **CA-35/41; CAP-40/44 — Nonempty contract remains unresolved, with an explicit owner and compatibility gate.**  
     `src/import/staging/roots.ts:2312–2358` defines local references as storage ID plus plaintext digest; migration003 explicitly excludes scope from the frame. Promotion initializes retained/conflict/audit lists empty (`promotion.ts:1242–1247`); subsequent writers preserve them. Named conflict/audit branches establish root scope/kind, but neither migration004’s event contract nor database retention prose supplies their concrete page/descendant layout. Migration006 remote references already carry scope.

     The revised disposition in `STATE.md:287–315` preserves required content without inventing schema semantics: S02 rejects unsupported branches; DB/Author supplies the protected mapping; S06 CP1 co-owns the first nonempty writers, codecs, descendant readers, publication integration and fixtures. CP2 installs only after equivalence; CP4 proves J3 and reruns J1. Existing exact-key readers make the explicit compatibility gate necessary.

     **Owner/correction route:** Human DB/Author direction remains pending under GRAPH-CONTRACT; Orchestrator incorporates accepted source before S06 dispatch.  
     **Closure assertion:** Approved layouts preserve all required descendants and original chain/history/restoration evidence; legacy empty fixtures remain readable; unsupported layouts reject without mutation; omission/substitution fails; candidate publication passes before installation, followed by installed-head reopen, two-compaction/next-append and vault-only recovery proofs.

  2. **CA-35; CAP-40 — Bounded current-graph acceptance remains unproved, but S02 CP2 owns the remaining work.**  
     Preserved `backup-graph.ts` traverses named roots and rejects unsupported retained/conflict/audit content. Its existing test demonstrates a pinned workbook, later theme edit, one retained-root rejection and limited publication corruption checks. It does not establish every GRAPH-S02 assertion. Additionally, `backup-handlers.ts:135–136` still calls eager `loadApp` during pinning, so bounded export cannot be inferred from the new exporter alone.

     **Affected consumers:** Publication, bundle assembly and J1; subsequently S06.  
     **Owner/correction route:** S02 CP2, explicitly assigned by `SESSION-02.md:242–252,292–296`, including the upstream pin/load path. No new lease is needed for the inspected paths.  
     **Closure assertion:** Execute the real pin→export→publication path across multiple batches, detect eager payload accumulation, prove every current branch and covered-chain dependency, reject omission/substitution/reread changes, preserve fixture bytes, and leave receipts and rejected content unchanged. The inherited 178 passing tests remain component evidence.

  3. **CA-35; CAP-40 — Cursor and exported-key lifecycle are still incomplete, explicitly assigned before CP2 acceptance.**  
     `backup-handlers.ts:143–155` returns caller-owned disposal; `handlers.ts:531–538,930–933` does not dispose exported handles. The sampled graph test closes them directly. `projection-port.test.ts` covers existing port shapes but lacks the proposed cursor assertions.

     **Affected consumers:** Graph reads, authored-state hashing and publication after cancellation, release, lock, reset or session replacement.  
     **Owner/correction route:** S02 CP2; `SESSION-02.md:250,294–296` leases production teardown and paired boundary/behavior tests.  
     **Closure assertion:** Production lifecycle events destroy keys and close cursors idempotently; late reads/publication reject; active readers cannot lose required storage; abort/error paths finalize resources without writes. Preserve existing bidirectional port assertions and add executable cursor cancellation/failure coverage.

  4. **CA-35/41; CAP-40/44 — Operational ledger still contradicts the received plan.**  
     `.program/ledger.md:16–20` describes Planner PK74w as live and the replan pending; `.program/blockers.md:44` also retains “pending replan.” Canonical STATE at `90bf704` records both workers ended and the corrected ownership boundary received.

     **Owner/correction route:** Orchestrator refreshes these operational records from canonical STATE. This is machine-actionable bookkeeping, not a product decision.  
     **Closure assertion:** Records consistently show no live implementation owner, CP1 accepted, CP2 preserved/unaccepted, GRAPH-S02 assigned to S02, and GRAPH-CONTRACT/nonempty proof assigned to DB/Author and S06.

  **Proof-path assessment:** Inspected package scripts and discovery configuration cover the planned unit/property/browser/e2e locations. Playwright builds before preview and prohibits server reuse. The plan assigns isolation, restart, cleanup, artifact identity, resource locks and J1/J3 harness work before their acceptance gates. Future S06 implementation need not exist for S02’s current-graph checkpoint.

  **Limits:** Read-only inspection; no tests, builds, browser journeys, edits, staging, commits or agents. No full-history reconciliation, cleanup audit, unrelated capability review or live-provider qualification. DEC-71/72 and design/provider decisions remain unchanged. No log file was written.


### F05 SESSION-02 r5 receive — verbatim final

I’ll read r5 and the current records, acknowledge the corrected proof boundary, then resume the preserved CP2 work without delegation.


I acknowledge r5 at `2b6522e3c9f9a01527e79592a4933604958017cc`. CP2 now proves every current producer branch and rejects unsupported retained/conflict/audit branches without publishing or discarding data. Future nonempty-producer proofs belong to S06. I’ll finish bounded pinning, cursor coverage, and lifecycle cleanup before committing CP2.


The preserved exporter reads objects sequentially, but pin creation still calls the eager `loadApp` reader, and exported keys remain caller-owned. I’m replacing the pin read with authenticated head-only validation and connecting export cleanup to the worker lifecycle.


Pin creation now validates only the encrypted head. Lock, reset, session replacement, and worker disposal cancel owned exports. I’m extending cancellation through graph readers and publication candidates, including a cursor paused between reads, so stale work cannot continue after teardown.


The focused checks caught an assertion mismatch: crypto reports a destroyed key as an authentication failure. The cursor cancellation tests pass. I’ve added checks that remove or corrupt every reachable graph object, plus persisted unsupported-root cases that must remain intact after reopening.


The current-graph and lifecycle tests pass, including CSV append, all reachable-object omissions, and unsupported branches surviving restart. I’m finishing the authored-state and covered-chain checks, then I’ll run the exact GRAPH-S02 gate and record its source and fixture identities.


The restoration check exposed a real replay bug: the projection encoder matched provenance by JavaScript object identity, but the durable decoder creates separate byte arrays for equal field IDs. I’m fixing the encoder within the leased projection module and keeping the failing regression. This preserves provenance during replay without changing the durable format.


CP2’s final graph gate passed: 25 files, 209 tests. The tests cover current graph branches, bounded reads, lifecycle cancellation, preserved provenance, and rejection of unsupported branches. I’m recording the evidence and reviewing the checkpoint diff before committing.


CP2 is committed as `c7e6507`; all 26 paths are inside r5. Typecheck and lint also passed. I’m checking CP3’s native-save boundary next; the unresolved fallback policy remains protected.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked — CP2 complete; session incomplete.
- **checkpoint:** CP2 committed as `c7e6507f87347461afd82c39497ed6eef9df67d5`. CP1 remains accepted at `03ee571`.
- **notes:** r5 acknowledged. CA-35 current-producer component proof completed; CAP-40’s saved-bundle journey remains unproved.
- **delivered:** Bounded pinning, graph export, canonical encoding, incremental hashing, independent SQLite authored-state reconstruction, authenticated publication rereads, cursor-port coverage, and worker-owned key/cursor cleanup. Unsupported retained/conflict/audit branches reject without durable changes.
- **verification:** GRAPH-S02 → **25 files, 209 tests passed**. Typecheck, lint, and diff checks passed. Assertions cover omissions, substitutions, corruption, covered-chain authentication, eager-loading negative controls, immutable pins, cancellation, release, lock, reset, replacement, and teardown. Existing fixture bytes remain unchanged. Real crypto/SQLite/MessageChannel with isolated fake-indexeddb; no native-browser or save proof claimed. Exact command, source/config/fixture hashes and logs: [evidence.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s02/graph-current/evidence.json).
- **surprises:** A failing restoration regression exposed provenance loss from matching decoded field IDs by object identity. Canonical byte-ID lookup fixes it; the regression now passes. All 26 committed paths are within r5; outside changes remain untouched.
- **followUp:** CP3 native-save implementation remains independently implementable and was not completed in this return. DEC-72 and Designer save-outcome coverage still gate the fallback and CP4. S06 owns future nonempty graph mappings and positive proofs after GRAPH-CONTRACT. CP3–6 and J1 remain unverified.
- **needsOwnerCorrection:** —
- **needsDesignSource:** Existing DF-F05-1 save/reminder/provider coverage remains with Orchestrator/Designer.
- **blockedReason:** Full session acceptance remains blocked by the recorded DEC-72/design boundary. This does not block or invalidate CP2, nor independently implementable native-save work.
- **filesTouched:** Committed:
  - `src/application/ports/backup.ts`
  - `src/application/ports/projection.ts`
  - `src/crypto/hash.ts`
  - `src/persistence/codecs/canonical-cbor.ts`
  - `src/persistence/projection/apply-events.ts`
  - `src/persistence/projection/authored-state.ts`
  - `src/persistence/projection/cbor-values.ts`
  - `src/persistence/projection/engine.ts`
  - `src/persistence/projection/hydrate.ts`
  - `src/persistence/projection/index.ts`
  - `src/sync/protocol/frontier.ts`
  - `src/sync/protocol/publication.ts`
  - `src/workers/data/app-session.ts`
  - `src/workers/data/backup-graph.ts`
  - `src/workers/data/backup-handlers.ts`
  - `src/workers/data/event-store.ts`
  - `src/workers/data/handlers.ts`
  - `tests/fixtures/vaults/f05/generate.ts`
  - `tests/fixtures/vaults/f05/publication.ts`
  - `tests/unit/codecs/canonical-cbor.test.ts`
  - `tests/unit/crypto/hash.test.ts`
  - `tests/unit/projection/authored-state.test.ts`
  - `tests/unit/sync/protocol/publication.test.ts`
  - `tests/unit/workers/backup-graph.test.ts`
  - `tests/unit/workers/backup-handlers.test.ts`
  - `tests/unit/workers/projection-port.test.ts`

  Ignored accepted-checkpoint architecture delta: `.program/signal/F05-SESSION-02.arch.md`. No pending implementation changes.



### F05 SESSION-02 r6 receive — verbatim final

I’ll read the r6 sources and current CP3 contracts, then implement and verify the native-save branch without choosing the unresolved fallback policy. I won’t delegate or redo CP1/CP2.


I acknowledge r6 and the unchanged lease. CP1 `03ee571` and CP2 `c7e6507` remain accepted. CP3 will connect the real IO channel, verify bundle bytes, and accept only a correlated native-save result; DEC-72 and CP4 remain gated.


The data worker already owns the authenticated publication graph. I’ll stream its ciphertext over a dedicated channel and verify the finished bundle against that exact object set. The native picker must open during the user gesture, before preparation awaits; only a completed write and close can produce `saved`.


The native branch is wired through bootstrap, data worker, and IO worker. It compiles. I’m now testing the failure boundaries: interrupted transfers, mismatched completions, picker cancellation, write/close failure, and lock during save. These must leave the last confirmed receipt unchanged.


The receipt tests now pass through real MessageChannels and encrypted storage: a save records the pinned frontier, a later edit remains pending, and forged or old completions leave the receipt unchanged. A lifecycle test also exposed an unhandled rejection in its save double; I’m correcting that harness before rerunning the gate.


The native-save checks are passing, and the production build emits the new IO worker. I also made receipt advancement and pin release one transaction, so cleanup cannot fail after separately recording success. I’ll run the final focused gate and commit this as partial CP3; fallback policy and save-outcome design remain unresolved.


The final gate passed: 19 files, 106 tests, plus typecheck, lint, and build. Evidence records the exact source, configuration, fixtures, and worker artifacts. I’m committing the verified native branch as partial CP3; no fallback or CP4 completion is claimed.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked — native-save branch committed; full CP3 and session remain incomplete.
- **checkpoint:** CP2 accepted. **Partial CP3** committed without claiming full checkpoint completion.
- **commits:** `d75830df961fc9713b12539312594b4f16d78693` — `durable-home-backup SESSION-02: checkpoint 3 — partial CP3 native observable save`. Accepted CP1 `03ee571` and CP2 `c7e6507` preserved.
- **notes:** r6 acknowledged at `61b442d`. CA-36/37/39 native component contribution landed through `AppRuntime.saveBundle`, `backup.connectBundle`, `receiveBundle`, and encrypted HomeState receipts. CAP-40/J1 remains unproved.
- **delivered:** Real IO worker constructor and bootstrap wiring; dedicated ciphertext/control channels; bundle assembly and second-pass verification; native saved/cancelled/failed/unconfirmed outcomes; exact operation/app/home/artifact correlation; atomic receipt/frontier/time advancement and pin release; lifecycle cancellation and key cleanup. No fallback confirmation UI or policy added.
- **verification:**
  - Focused gate: **19 files, 106 tests passed, exit 0**. Selectors cover bundle format, IO, file-save, bootstrap lifecycle, backup handlers/graph, HomeState, protocol, redaction, reset, and module boundaries.
  - Typecheck, lint, build, and diff checks: **exit 0**.
  - Assertions cover framing/hash corruption, transport refusal and stalled-peer cancellation, disposal, picker cancellation, write/close failure, quota rejection, forged/replayed/old completions, lock, restart, and a concurrent edit remaining outside the confirmed frontier.
  - Real production handlers, MessageChannels, crypto and SQLite; isolated **fake-indexeddb**, Worker-constructor doubles, and native-destination doubles. **No native-browser persistence, actual OS save, or J1 claim.**
  - Native completion semantics checked against the [File System standard](https://fs.spec.whatwg.org/#api-filesystemwritablefilestream).
  - Exact commands, source/configuration/fixture/build hashes and logs: [evidence.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s02/native-save/evidence.json). All **21 committed paths** match the tested inventory and r6 lease.
- **surprises:** Transport testing exposed an unhandled rejection in an incomplete save double; corrected before acceptance. Pending-transfer disposal now explicitly rejects instead of abandoning its promise. Build reports the existing large-chunk warning but succeeds. No unrelated files changed.
- **followUp:** Orchestrator should retain partial-CP3 status. After DEC-72 and Designer outcome coverage arrive, S02 completes fallback behavior and full CP3 acceptance, then CP4’s real-entry J1. CP4/5 still own receipt/count/status readers; CP6 owns interrupted-operation recovery and complete artifact recovery. Interrupted or rejected operations retain encrypted pins for recovery/release. S06’s nonempty-graph obligations remain separate.
- **needsOwnerCorrection:** —
- **needsDesignSource:** Existing DF-F05-1 save-outcome coverage remains with Designer/Orchestrator.
- **blockedReason:** DEC-72 fallback policy and dependent save-outcome design remain unresolved. Independently assigned native implementation is committed and verified; no mechanical lease blocker remains.
- **filesTouched:**
  - `src/application/ports/file-save.ts`
  - `src/bootstrap/app-bootstrap.ts`
  - `src/bootstrap/io-worker.ts`
  - `src/platform/file-save.ts`
  - `src/sync/providers/bundle/format.ts`
  - `src/workers/data.worker.ts`
  - `src/workers/data/backup-handlers.ts`
  - `src/workers/data/home-state.ts`
  - `src/workers/io.worker.ts`
  - `src/workers/io/bundle.ts`
  - `src/workers/protocol/client.ts`
  - `src/workers/protocol/io-channel.ts`
  - `src/workers/protocol/io-client.ts`
  - `src/workers/protocol/io-messages.ts`
  - `tests/unit/bootstrap/file-save.test.ts`
  - `tests/unit/bootstrap/lifecycle.test.ts`
  - `tests/unit/sync/bundle/format.test.ts`
  - `tests/unit/workers/backup-handlers.test.ts`
  - `tests/unit/workers/home-state.test.ts`
  - `tests/unit/workers/io.test.ts`
  - `tests/unit/workers/module-boundaries.test.ts`

  Ignored architecture delta: `.program/signal/F05-SESSION-02.arch.md`. No pending implementation changes.



### F05 DESIGN-F05-SAVE-REMINDERS receive — 2026-09-24

Accepted commit 4c31ded: exactly two new mocks and four added design inventory rows; no existing mocks or sections changed. Orchestrator checked commit paths, clean lease status, diff check exit 0, evidence report and sampled desktop/mobile images. No application code/proof change; no arch delta applicable. Save/reminder design input ready, provider design remains DF-F05-1 owner Designer. Raw final follows verbatim.

I’ll read the Design-Fill Envelope and existing design references, then create the scoped mocks and verify them at the required layouts.


The envelope fixes both policies: reminders escalate after successive dismissals, and an unobservable download needs explicit confirmation after delivery. I’m using the frontend-design and agent-browser skills, with your envelope’s no-delegation rule taking precedence.


I’ll add two interactive detail mocks: one for bundle save outcomes and one for scratch reminders. Both will show the last confirmed backup and current pending count, with review controls for stepping through each state.


The mocks now cover native confirmation, explicit confirmation after delivery, cancellation, failures, and reminder dismissal. I’m checking all five widths, keyboard focus, and whether newer edits remain pending after an older snapshot is confirmed.


The rendered states fit all five widths without horizontal overflow. I found and fixed a reverse-Tab issue in the modal. I also verified that confirming a delivered snapshot leaves two newer edits pending and keeps “Bundle out of date” visible.


Keyboard wrapping, focus return, and 200% text at a 320px-wide short viewport now work in both mocks. The accessibility checks reported no violations. I’m recording the evidence and checking the exact three-file commit, while preserving the existing mocks and unrelated edits.


## Handoff

- **session:** DESIGN-F05-SAVE-REMINDERS
- **status:** done
- **checkpoint:** 1
- **commit SHA:** `4c31ded2f016a7205664511d7875b6898b972b24`
- **notes:** Completed save/reminder design sources for CA-37/40 and CAP-40/41/42 using approved DEC-71/72. Production capability proofs remain with Coder.
- **delivered:** Two interactive standalone mocks; two added control rows and two added screen rows. Includes save outcomes, post-delivery confirmation, escalating reminders, persistent badges, truthful receipt/count displays, and keyboard/error/cancel contracts.
- **verification:** Rendered 85 states across 320/430/768/1024/1440px; no horizontal overflow; actions ≥44px. Verified focus containment/return, dismissal, concurrent-change counts, and 200% text. Three accessibility audits reported zero violations. Existing mocks and unrelated edits preserved. Verified commit contains exactly the three authorized files. [Evidence](/Users/the.phoenix/WebstormProjects/sheaf/.program/design-f05-save-reminders/verification.md).
- **surprises:** Provider authorization/reconnect/disconnect designs remain adjacent DF-F05-1 gaps outside this envelope.
- **followUp:** SESSION-02 can consume the save design for CP3/4; SESSION-03 can consume reminders for CP1/2. They retain responsibility for actual save receipts, persisted scheduling, and J1/J2 proofs.
- **needsOwnerCorrection:** —
- **needsDesignSource:** No remaining gap within this envelope.
- **blockedReason:** —
- **filesTouched:**
  - [program/sheaf/mocks/f05-bundle-save.html](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/mocks/f05-bundle-save.html)
  - [program/sheaf/mocks/f05-scratch-reminders.html](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/mocks/f05-scratch-reminders.html)
  - [program/sheaf/specs/design.md](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/specs/design.md)


### REPLAN-F05-APPROVAL receive — 2026-09-24

Accepted plan-only 9749c76. Orchestrator independently verified seven exact paths, all seven sessions’ unchanged leases/dependencies/resources/checkpoint counts and byte-identical prior Handoff Notes; diff check passed. Current app typecheck and lint rerun exit 0 during this boundary. No application change, no arch delta, no new capability proof. Scoped review precedes S02 full CP3. Raw final follows verbatim.

I’ll read the replan prompt, current STATE, and Designer handoff, then update the planning artifacts and return a full Handoff.


The saved plan still contains active instructions to resume CP2 and wait for DEC-71/72. Both checkpoints and approvals are already recorded, and Designer’s save/reminder fill is accepted. I’m reconciling those instructions while preserving the historical handoffs and the remaining DB/provider gates.


The fallback has a concrete implementation gap: without a native picker, `createFileSavePort` returns `unconfirmed` before delivering a file, and bootstrap then disposes the transfer. S02 CP3 will own delivery, operation-bound confirmation, and lifecycle tests; CP4 will prove that path through the real app and restart. No lease expansion or S06 graph producer is needed.


The plan now resumes S02 at full CP3, preserves CP1/CP2 and partial CP3, and assigns S03 the approved reminder schedule. I’m checking that leases, dependencies, checkpoint counts, and historical handoffs are unchanged, then I’ll commit the seven authorized planning files.


Committed the bounded replan as `9749c76`. S02 resumes full CP3; accepted checkpoints and historical handoffs are preserved.

## Handoff

- **status:** done — planning reconciliation only.
- **checkpoint:** 1/1.
- **commit:** `9749c76`
- **filesTouched:** Under `program/sheaf/prompts/durable-home-backup/`: `MASTER.md`, `STATE.md`, `SESSION-02.md`, `SESSION-03.md`, `SESSION-06.md`, `SESSION-07.md`, `PLAN-CHECK.md`.
- **verification:** Lease/dependency/resource invariants, Files/STATE agreement, checkpoint counts, DAG, concurrent-source disjointness, historical handoff preservation and diff checks passed. Commit contains exactly seven authorized files. No application tests or capability proofs run.
- **notes:** DEC-71/72 and accepted Designer sources reconciled throughout active instructions. S02 owns fallback delivery/explicit confirmation at CP3 and real-entry J1 at CP4. S03 owns persisted reminders. Seven sessions/28 checkpoints retained; no lease expansion.
- **surprises:** Current no-picker path returns `unconfirmed` without delivery, then bootstrap disposes the transfer. The complete correction and lifecycle tests are explicitly assigned to S02.
- **followUp:** Orchestrator receives this commit, refreshes operational records, requests scoped Archivist planning-completeness review, then resumes S02 full CP3 under its unchanged lease.
- **blockers:** Exact DB/Author GRAPH-CONTRACT still gates S06; provider registrations, qualification and provider design remain outstanding. J1 remains unverified and gates dependent execution. Outside config, roadmap and arch changes were preserved.


### ARCHIVIST-F05-APPROVAL receive — verbatim final

I’ll read the scoped envelope and repository instructions, then review the specified records without editing files.


The replan assigns fallback delivery and confirmation to S02 CP3, with receipt readers and the first restart journey at CP4. I’m checking those assignments against the actual channel lifetime, test harness, and leased files for any prerequisites the plan still misses.


The save path uses real data-to-IO channels and binds completion to the operation, app, home, and artifact. Its existing tests use worker and destination doubles, so they do not prove J1. I also found architecture text that still calls DEC-71/72 pending; the current plan correctly records those approvals and assigns the remaining implementation.


One S03 proof prerequisite needs clarification: CP2 requires exact reminder intervals through the production worker, but the plan does not name the browser clock-control mechanism. The existing fake clock belongs to node handler tests; the browser harness starts the production worker with `Date.now()`. I’ll report this separately from S02’s assigned save work.


## Archivist Note

- **role:** archivist
- **mode:** planning-completeness
- **registryUpdated:** false
- **reconciled:** []
- **conventionsAdded:** []
- **cleanupBriefs:** []
- **logEntry:**

  **2026-09-24 — Scoped approval-continuation review.** Reviewed plan `9749c76`, receive HEAD `37aef4f`, approval `27e9a34`, Designer delivery `4c31ded`, and implementation through `d75830d`. **Two actionable documentation/planning findings remain; neither establishes a missing S02 implementation owner.** No files, logs, readiness records, or dispatch status were changed.

  **Scope:** CAP-39/40/41/42; CA-36/37/39/40; S02 CP3–6; S03 approved reminder inputs; S06 only for future graph ownership. Inspected the supplied raw results, current PLAN-CHECK, affected STATE agreements/readiness/blockers, session leases, scoped operational records, relevant architecture and approved requirements/database/design sources, production save composition, receipt enforcement, sampled tests, runner configuration, and restart fixtures.

  **Consolidated findings**

  1. **F05-APPROVAL-01 — S03’s exact-time browser proof needs a concrete worker-clock mechanism.**

     **CAP/CA:** CAP-42; CA-37.

     **Evidence:** [SESSION-03.md:161](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/prompts/durable-home-backup/SESSION-03.md:161) requires interval-boundary assertions through a controlled browser clock propagated into the worker. Its [verification instructions](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/prompts/durable-home-backup/SESSION-03.md:183) offer a “typed test-only ClockPort injection in the owned worker harness,” but do not identify that browser mechanism.

     The production constructor supplies `Date.now()` directly in [data.worker.ts:47](/Users/the.phoenix/WebstormProjects/sheaf/src/workers/data.worker.ts:47). The existing [browser harness:104](/Users/the.phoenix/WebstormProjects/sheaf/tests/browser/worker/runtime.ts:104) calls ordinary `startApp()`. The leased [node helper:74](/Users/the.phoenix/WebstormProjects/sheaf/tests/unit/workers/data-worker.ts:74) injects `FakeClock` into handlers with fake-indexeddb; it does not control the real-entry browser worker. S03 does not lease the production worker entry or existing browser runtime helper.

     **Affected consumer:** S03 CP2/J2 exact 10m/1h/24h/daily and restart assertions.

     **Owner/correction:** Planner/Orchestrator should name the concrete browser-worker clock-control mechanism and assign its implementation and self-test to S03 before CP2. It may fit the already-leased `tests/e2e/fixtures/durability.ts`; otherwise amend the exact required paths. The future mechanism need not exist now, but its production-worker connection must be explicit. This is a mechanical planning correction, not a new policy question or S02 prerequisite.

     **Closure assertion:** Through the real entry and actual worker, demonstrate no reminder immediately before each deadline and eligibility exactly at it, persisted dismissal progression after page replacement, and repeated daily dismissal. Include a negative control proving that changing only the page clock cannot falsely satisfy the worker assertion, plus the retained real-clock journey.

  2. **F05-APPROVAL-02 — Referenced architecture still presents settled approvals as missing inputs.**

     **CAP/CA:** CAP-40/42; CA-37/40.

     **Evidence:** [M51-platform.md:52](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/arch/M51-platform.md:52) says fallback implementation is “pending DEC-72.” [F05-boundaries.md:14](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/arch/F05-boundaries.md:14) still assigns fallback semantics to a human and reminder policy as a gate; [line 38](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/arch/F05-boundaries.md:38) calls save/reminder design decision-dependent outstanding work.

     These describe the prior close, while approval `27e9a34`, design `4c31ded`, and current CA-37/40 establish those inputs as ready. The implementation remains unfinished.

     **Affected consumers:** S02/S03 agents reading their architecture references.

     **Owner/correction:** Orchestrator should add a narrowly scoped supersession clarification or route reconciliation to the authorized documentation pass: approvals/design are complete; S02 CP3/4 and S03 CP1/2 retain implementation/proof ownership. Preserve the historical close evidence.

     **Closure assertion:** Current architecture instructions no longer request DEC-71/72 or save/reminder design again, and do not promote their approval into capability verification. No product decision is required.

  **Assigned implementation gaps confirmed, without additional ownership findings**

  - **Fallback delivery and confirmation — S02 CP3, CAP-40/CA-37/39.** `createFileSavePort` currently returns `unconfirmed` without delivering bytes; `saveBundle` then aborts/disposes its transfer. The replan explicitly assigns verified download delivery, pending-operation lifetime, typed callers, confirmation UI, teardown, and paired tests inside S02’s lease. A later button over the disposed operation is expressly prohibited.

  - **Receipt authority — S02 CP3/4, CAP-40/41/CA-36/37.** `connectBundle` validates operation/app/home/artifact identity, live session, pin ownership, and frontier bounds/regression before atomically writing the receipt and releasing its pin. Sampled tests cover non-saved outcomes, forged identities, old completion, quota failure, lock/reopen, replay, and a newer edit remaining outside the captured frontier. SAVE-S02 appropriately requires additional fallback, timeout, and lifecycle assertions; those future tests are not yet passing evidence.

  - **Readers and first composed journey — S02 CP4.** Current app-session/record readers still use absolute sequence, and reset inventory lacks confirmed backup time. The minimum receipt-relative readers and fixtures are assigned before J1, with broader reset coverage at CP5. This resolves inherited PC-F05-04’s checkpoint-order problem without altering chain-sequence meaning.

  - **Recovery obligations — S02 CP5/6.** The inherited CAP-05 countdown has machine, route, VM, screen, and test ownership at CP5. Interrupted-pin handling and vault-only complete artifact recovery remain CP6 obligations. Neither is discharged by native component results.

  - **Reminder policy — S03 CP1/2.** Approved escalation, encrypted operational dismissal state, authored-commit identity, no-op/rejection exclusions, restart persistence, and home-assignment suppression have named implementation owners. Finding 1 concerns the concrete browser proof mechanism, not the approved behavior.

  **SAVE-S02/J1 proof-path assessment**

  Package scripts resolve directly to Vitest and Playwright. Existing discovery covers the assigned unit/UI and planned e2e locations. Playwright builds before preview, uses a strict assigned port, and disallows server reuse. Vite embeds build identity.

  J1 specifies real `/` entry, built data/IO workers, actual MessagePorts and IndexedDB, `protectDevice`/`importDemoWorkbook` seeding, captured artifact decoding, and page replacement within the same isolated context. Native destination doubles are separated from the actual fallback-download case. Download capture alone cannot confirm a receipt.

  S02 owns the planned harness/spec/fixture paths, deadlines, output evidence, and cleanup before acceptance. VB-02 correctly identifies `deleteLocalStore`’s blocked-deletion weakness and requires correction or guaranteed context disposal. Shared `dist:build` and `playwright:output` remain exclusive resources.

  The first real-entry bundle proof remains **CP4**, before dependent fan-out; CP3 component results do not substitute for it. Full artifact/error coverage remains CP6.

  **Inherited dispositions and boundaries**

  The original planning findings concerning minimum J1 readers and recovery countdown have explicit current assignments. S06 retains nonempty graph producer/reader/publication ownership behind exact DB/Author mapping; it is not a prerequisite for S02’s supported bundle journey. Provider registrations, provider design, live qualification, and demo verdict remain separate obligations.

  **Verification limits:** This pass performed read-only inspection. It ran no application tests, builds, browser journeys, or provider calls. Reported typecheck/lint and the prior 2402-test close remain inherited evidence. No full-history review, cleanup scout, full graph audit, or visual re-verification was performed. Existing modified configuration/roadmap and untracked architecture files were left untouched. This note does not clear dispatch or verify any capability.


### Resume-1 dispatch — 2026-09-24

S02 r7 h-cUhZ/CQ52t launched at base8c8a53d under unchanged exact lease; accepted CP1/2 and partial CP3 preserved, full CP3–6 assigned. Port8081/dist/playwright exclusively held. Plan-only REPLAN-F05-REMINDER-CLOCK h-DwLP/P-LDJ owns SESSION-03/LEASES.json/PLAN-CHECK and no implementation/resources. Native binding cap3; all wave members launched before collection. Frozen prompts/digests in scratch; no live lease change.


### F05 SESSION-02 r7 receive — 2026-09-24

Full CP3 a93a87c accepted as component contribution; session remains incomplete at3/6. Declared blocked because context exhausted before CP4, no external prerequisite or residual. Orchestrator independently checked19leased paths, clean implementation, source/config hashes, SAVE-S02 10files/70pass, typecheck/lint exit0, and sampled320/1200px component screenshots. J1/browser/OS proof not claimed. Architecture consumed9850d14; original untracked M47 seed preserved by dedicated M47 delta document. Resume fresh unchanged lease at CP4; no checkpoint re-slice needed because progress committed at boundary. Raw final follows verbatim.

I’ll read the exact envelope, current state, and checkpoint history, then resume SESSION-02 within its assigned lease.


I’ve acknowledged lease r7 and confirmed the accepted checkpoint commits. The fallback still returns `unconfirmed` before delivering bytes, and bootstrap then disposes the operation. I’m checking the transport, receipt authority, and test harness before changing that lifecycle.


The data worker already validates the operation, app, home, and artifact hash, and writes the captured frontier with its timestamp atomically. CP3 will keep that authority intact and hold a delivered fallback operation open until confirmation, cancellation, or timeout.


The fallback now delivers prepared bytes and cleans up its temporary anchor and URL. The focused platform, lifecycle, and IO checks pass: 3 files, 21 tests. I’m adding the workflow that exposes confirmation only after delivery and invalidates it when the operation ends.


The expanded checks pass: 10 files, 60 tests, plus typecheck and lint. CP3 still needs runtime invalidation tests and visual inspection. I’m using the agent-browser skill to inspect the confirmation dialog across the required layout sizes.


The runtime tests now cover confirmation, dismissal, lock, pagehide, disposal, and timeout. I also inspected the dialog at 320, 600, 900, and 1200 pixels; controls remain readable and reachable. Escape restores focus to the launcher. These are component checks—CP4’s real-entry journey remains unproved.


The fallback storage test exposed a harness defect: its Worker double passed MessagePorts by reference, so disposal closed the receiver before cancellation arrived. I corrected it to transfer the ports. The real handler test now passes both confirmation and dismissal, including receipt checks after reopening the encrypted store.


CP3’s focused gate passes: 10 files, 70 tests, with typecheck, lint, and build also passing. I’ll commit the delivery and confirmation work now, then continue with CP4’s receipt readers, vault flow, and real-entry restart proof.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked — CP3 committed; full session incomplete.
- **checkpoint:** 3/6.
- **commits:** `a93a87c013c7298d89057aa4f434929b268e2b3b` — checkpoint 3, deliver and explicitly confirm verified bundles. Accepted CP1 `03ee571`, CP2 `c7e6507`, and partial CP3 `d75830d` preserved.
- **notes:** Lease r7 acknowledged. CA-37 delivery/confirmation component implemented through `createFileSavePort`, `AppRuntime.saveBundle`, `durabilityMachine`, and `BundleSaveRoute`. Existing worker-owned CA-36 receipt authority preserved. CAP-39/40/41 and J1 remain unverified.
- **delivered:** Verified-Blob download fallback; temporary URL/anchor cleanup; operation-bound explicit confirmation; cancellation, timeout, replacement, and lifecycle invalidation; separate native/user-confirmed presentation; confirmation dialog and route component. Full home/vault journey is not mounted.
- **verification:**
  - SAVE-S02 selectors plus workflow/UI architecture checks: **10 files, 70 tests passed, exit 0**. Exact selectors and output are in [tests.log](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s02/save-confirmation/tests.log).
  - Typecheck, lint, build, and diff checks passed.
  - Production data/IO handlers, MessagePorts, crypto, and encrypted **fake-indexeddb** exercised. Confirmation/dismissal receipt distinctions survive worker reopen. Existing forged identity, replay, failure, and concurrent-edit assertions pass.
  - Bootstrap lifecycle tests use Worker/destination doubles. Actual browser download, native OS durability, and real-entry J1 were **not verified**.
  - Component screenshots inspected at 320/600/900/1200 pixels. Escape restores launcher focus; no residual dialog or inert element.
  - All 19 tested source digests match the commit. Configuration/build identities: [evidence.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s02/save-confirmation/evidence.json).
- **surprises:** Worker double originally passed ports by reference, causing cancellation to stall; corrected to actual transferable-port semantics. Superseded stalled runs were terminated. Existing large-chunk build warning remains. Unrelated changes preserved; owned browser and preview stopped.
- **followUp:** Resume S02 at CP4: authoritative receipt/count readers, vault creation/recovery UI, mounted routes, and actual-download/native-destination J1 with same-context reopen. CP5 retains reset consequences and CAP-05 countdown proof; CP6 retains interrupted-pin and complete vault-only artifact recovery. S06 nonempty-graph proofs remain separate. Architecture delta is `.program/signal/F05-SESSION-02.arch.md`.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** Context exhausted at CP4. Required CAP-39/40 J1, CAP-41 reader integration, and CAP-05 proofs remain incomplete, owned by S02. No external prerequisite or lease blocker established.
- **filesTouched:**
  - `src/application/ports/file-save.ts`
  - `src/application/workflows/durability-services.ts`
  - `src/application/workflows/durability.machine.ts`
  - `src/bootstrap/app-bootstrap.ts`
  - `src/platform/file-save.ts`
  - `src/routes/app-runtime.tsx`
  - `src/routes/durability-routes.tsx`
  - `src/ui/durability/bundle-save-dialog.tsx`
  - `src/ui/durability/durability.module.css`
  - `src/workers/protocol/io-client.ts`
  - `tests/browser/sync/fixtures/save-dialog.config.ts`
  - `tests/browser/sync/fixtures/save-dialog.entry.tsx`
  - `tests/browser/sync/fixtures/save-dialog.html`
  - `tests/unit/bootstrap/file-save.test.ts`
  - `tests/unit/bootstrap/lifecycle.test.ts`
  - `tests/unit/ui/durability/bundle-save.test.tsx`
  - `tests/unit/workers/backup-handlers.test.ts`
  - `tests/unit/workflows/durability.test.ts`
  - `tests/unit/workflows/module-boundaries.test.ts`


### REPLAN-F05-REMINDER-CLOCK receive — 2026-09-24

Accepted37303ce: two authorized plan files, all lease/dependency/resource/checkpoint invariants independently checked, diff check0. Specified future bridge uses current dynamic worker Date.now through Playwright actual-worker evaluation; no code, new lease or passing proof. F05-APPROVAL-01 planning closure; S03 CP2/4 still implements and proves after S02/J1. No arch delta. Raw final follows verbatim.

I’ll read the replan envelope and repository instructions, then update only the authorized planning files while preserving S02’s active lease.


The gap is in J2’s test harness: the production worker reads `Date.now()`, and the planned fixture does not yet exist. I’ll specify control through Playwright’s actual worker handle, with browser self-tests in S03’s existing lease. S02’s lease and instructions will stay unchanged.


The revised prompt now specifies worker-realm `Date.now` control, exact deadline pairs, restart checks after every dismissal, and a page-only clock negative control. It also retains a separate real-clock journey. Both the mechanism and its browser self-tests fit S03’s existing lease; I’m checking plan consistency before committing.


## Handoff

- **Worker:** REPLAN-F05-REMINDER-CLOCK
- **Status:** completed bounded replan
- **Commit:** `37303ce3f45c8e84ca707c273b157caf979d784f`
- **filesTouched:**
  - `program/sheaf/prompts/durable-home-backup/SESSION-03.md`
  - `program/sheaf/prompts/durable-home-backup/PLAN-CHECK.md`
- **verification:** Mechanical checks passed: seven unchanged session front matters; Owns/Files/LEASES agreement; checkpoint counts and commit conditions; exact deadline arithmetic; `git diff --check`. Commit contains exactly the two authorized paths. No application tests, builds, or browser proofs executed.
- **notes:** F05-APPROVAL-01 now has concrete actual-worker clock control, browser self-tests, exact deadlines, restart persistence, repeated daily dismissal, page-only negative control, and a separate real-clock journey. S03 retains four checkpoints and S02/J1 dependencies. Seven sessions remain.
- **surprises:** Durability fixture is a future S02 output. Existing S03 ownership covers its extension and browser tests; `LEASES.json` remains unchanged.
- **followUp:** Orchestrator reconciles STATE’s VB-02/J2, CAP-42, CA-37, and finding disposition. After fully receiving S02 r7, recheck landed worker/bootstrap/protocol/fixture contracts before S03 dispatch. S03 CP2 implements and proves the mechanism; CP4 reruns J2.
- **needsOwnerCorrection:** none
- **needsDesignSource:** none new
- **blockedReason:** none for this replan; S03 still awaits S02/J1. Production reminder evidence remains planned.


### S02 r8 recovery dispatch

Fresh Native Cc094/h-llH3 at95c3515, unchanged file lease, CP4–6 assigned after acceptedCP3a93a87c. Prior context terminal after committed checkpoint; no reset/re-slice/unfinished receive. Exact frozen envelope and source digests in scratch. Port8081/dist/playwright reserved, sole worker.


### F05 SESSION-02 r8 receive — execution shortfall

Cc094 ended with parseable declared-blocked handoff, no commit or changed file. Git log/status confirm acceptedCP3a93a87c unchanged and no implementation residual/arch delta. This is an execution shortfall, not missing input or new planning defect; no new acceptance/gate claim. CP4 shape has one no-progress return. Recovery under unchanged lease is agent-owned; do not ask user to solve it. Raw final follows verbatim.

I’ll read the recovery prompt and program state, confirm the CP4 lease and accepted commits, then execute the assigned checkpoint and verification.


I acknowledge revision r8 and the unchanged lease. The log confirms CP1–3 are committed, and the recovery record confirms the prior worker ended. I’ll preserve those checkpoints and work toward CP4’s mounted home/vault flow, authoritative receipt readers, and real-entry save/reopen proof.


The home and receipt writers are present, but home creation has no page RPC yet, and the displayed counts still use absolute sequence. CP4 needs to connect those assigned pieces. I’m also checking the existing reader and fixture contracts before changing them.


## Handoff

- **session:** F05 SESSION-02
- **status:** blocked — incomplete execution.
- **checkpoint:** 3/6; CP4 not completed.
- **commits:** None this attempt. Accepted CP1 `03ee571`, CP2 `c7e6507`, and CP3 `a93a87c` preserved.
- **notes:** Revision r8 acknowledged. Recovery ownership and checkpoint history checked at `c216f87`. No implementation changes made.
- **delivered:** Read-only inspection of recovery instructions, relevant contracts, home/receipt producers, current readers, routes, and test configuration.
- **verification:** `pnpm typecheck` passed, exit 0. No tests, builds, browser journeys, or visual verification performed this attempt.
- **surprises:** No external prerequisite or lease blocker established. This attempt did not fulfill the requested implementation.
- **followUp:** S02 still owns CP4 home/vault RPC and mounted UI, receipt-relative readers, and J1; CP5 reset/status integration and CAP-05 countdown; CP6 interrupted-pin handling and complete vault-only artifact recovery. CAP-39/40/41 and applicable CA-34/35/36/37/40 integration proofs remain incomplete.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** CP4–6 implementation and required acceptance proofs were not completed. This is an execution shortfall, not an identified planning or input defect.
- **filesTouched:** None. Existing configuration, roadmap, and untracked architecture changes preserved.


### S02 r9 recovery dispatch

Native h-4o7t/CwVdy, resume requested from ended h-llH3, complete revised envelope r9 at56589da. Exact file lease unchanged; CP4 execution recovery after unexplained no-progress return. No new approvals needed; port8081/dist/playwright reserved; sole active worker.


### F05 SESSION-02 r9 receive — required gate failed

Coder reports done6/6, but Orchestrator does not accept done. CP4 7b1bb58, CP5 f978eb3, correction2cd5ad4 and CP6 7ee5ce8 all inspected and within lease; no residual. Independent typecheck/lint0; full219files2433pass3skip exit0. Exact combined committed-build browser gate selected4tests: J1download/native and CAP05countdown passed; sync/bundle failed exit1 at importDemoWorkbook fixture line83 waitingSCR-024. Error context shows local-store integrity refusal and app unavailable. Counterexample is not waived as flaky or pre-existing; source identity7ee5ce8. Trace/context/pass-evidence preserved .program/recovery/F05-S02-r9-receive. Root did not diagnose or fix implementation. API arch delta integrated0d9c143 with explicit failed-gate qualification, no pending delta. Recovery retains unchanged lease and must investigate/classify/close exact failure without test weakening. Required capability acceptance/dependent dispatch remains blocked. Raw final follows verbatim.

I’ll read the r9 replacement envelope, confirm the recovery state, and resume CP4 implementation within its lease.


I acknowledge r9 and its unchanged lease. The recovery record confirms the prior worker ended, and CP1–3 remain accepted. CP4 is done only when the mounted home/vault flow, persisted receipt readers, and save/reopen journey pass together.


The existing worker can create a bundle home and store its recovery code encrypted, but those actions are not exposed to the page. I’ll add typed RPC requests for creation and code review, using the existing local-passphrase check for the reuse option.


The new RPC tests pass: reuse rejects the wrong local secret without assigning a home, vault-code review rejects the local secret, and the distinct vault code survives restart. I’m now wiring app and library reads to the persisted, app-scoped receipt so later edits remain pending.


The home/vault flow is now mounted at the app’s backup route, with a link from app home. Typecheck and the focused worker tests pass. I’m adding the real-entry download/reopen test next to check the complete flow through the built workers and IndexedDB.


I’m using the Playwright skill for browser verification, with the session’s prescribed runner, port 8081, and fresh-build settings.


The first browser journey passed: it downloaded a bundle, confirmed the receipt, and recovered the same receipt after replacing the page in the same browser context. I’m extending that proof to decode the downloaded bytes using only the vault secret and to verify that later edits remain pending.


Vault-only decoding now passes against the actual download. The same bytes reject the local passphrase, local recovery code, and a tampered artifact; the vault recovery code produces the same decoded state as the vault passphrase. The reopened app also reports exactly one pending change after a new edit, retaining its earlier backup time.


Both destination paths reached the expected save and reopen behavior. I’m checking the capture-versus-edit case through a second real app page, so the proof also exercises concurrent IndexedDB updates. The focused worker, UI, and architecture checks now pass: 74 tests across eight files.


The concurrent-page check found and reproduced a stale-catalog failure during confirmation. I corrected the confirmation path to reread the authenticated catalog before validating and committing the captured receipt. The browser regression now passes: the earlier bundle is confirmed, while the later edit remains pending. Accessibility and keyboard checks are also passing for the vault flow.


CP4 is committed as `7b1bb58`. Its gates passed: 166 focused tests, typecheck, lint, and both real-entry browser journeys, including vault-only decoding, concurrent edits, dismissal, cold reopen, accessibility, and focus behavior.

CP5 is next: make reset and library status use the same durable receipt facts, then implement and prove the worker-imposed recovery countdown.


CP5’s readers now use the authenticated home receipt for reset counts and backup time, including closed apps. The countdown uses the worker’s delay with an injected clock; controlled tests pass for 4→3→0 seconds, blocked early retries, draft clearing, and timer cleanup. I’m running the real recovery journey and checking the save-before-reset remedy next.


The real journeys pass: reset and library show the same durable receipt, saving from reset refreshes the count to zero after reopening, and recovery enforces the worker’s countdown before requiring a replacement passphrase. I’m reviewing the rendered surfaces and committing CP5, then moving to full artifact recovery and interrupted-save handling.


CP5 is committed as `f978eb3`. For CP6, I’m extending the vault-only decoder to reconstruct and verify the complete authored state from saved bytes. I’m also checking interrupted pin recovery without clearing another live save’s retention, and finishing failure-state and responsive checks.


The next browser run is blocked by an unrelated Vite server from `/Users/the.phoenix/WebstormProjects/shard-breaker` on assigned port 8081 (PID 76533). I’ll leave that process alone and continue CP6’s decoder and unit verification; the required fresh-build browser gate needs the assigned port to become available.


The port is available again, and the required browser gate has started. Full vault-only reconstruction now passes with local storage deleted: schema, theme, charts, snapshots, baselines, and frontier are verified. Missing graph branches and altered manifests are rejected; cancellation and restart tests also pass without advancing a receipt or pruning another export’s pin.


The full suite passes: 219 files, 2,433 tests, with three inherited skips. The browser recovery test also passes after correcting a harness race that navigated before unlock completed. I’m finishing the J1/countdown run and visual review, then I’ll commit CP6 and rerun the capability journeys from the committed build.


Self-review found a count mismatch with CA-36: the reader counted only this device’s commits, but the approved contract covers every device frontier held locally. The single-device journeys did not expose it. I’m adding a failing regression test, correcting the shared reader, and rerunning the affected gates before committing CP6.


The CA-36 regression reproduced the undercount—1 instead of 3—and passes with the corrected reader. The full suite is green again, and both save destinations pass with the correction. I’ll preserve it in a separate correction commit, then commit CP6 and verify the final built revision.


CP6 is committed as `7ee5ce8`, with the CA-36 correction separately preserved in `2cd5ad4`. The committed-build browser recovery proof has passed. The remaining run is verifying both save destinations and the real recovery countdown; source files are clean, and the pre-existing program and architecture changes remain untouched.


## Handoff

- **session:** F05 SESSION-02
- **status:** done
- **checkpoint:** 6/6
- **commits:** CP4 `7b1bb58`; CP5 `f978eb3`; CA-36 correction `2cd5ad4`; CP6 `7ee5ce8`. Accepted CP1–3 preserved.
- **notes:** Revision r9 completed. CAP-39/current-producer CAP-40 J1 verified; CAP-41 shared receipt readers delivered; inherited CAP-05 countdown verified. CA-34/35/36/37/40 boundaries exercised through `createBundleHome`, `readAppDurability`, `connectBundle`, `recoverBackupGraph`, and `recoveryMachine`.
- **delivered:** Mounted home/vault creation, scoped recovery-code review, confirmed bundle saves, durable receipt/count readers, reset backup remedy, worker-authoritative countdown, complete vault-only artifact recovery, and interrupted-save recovery proofs. Architecture delta: [.program/signal/F05-SESSION-02.arch.md](/Users/the.phoenix/WebstormProjects/sheaf/.program/signal/F05-SESSION-02.arch.md).
- **verification:** `pnpm typecheck` and `pnpm lint` exit 0. `pnpm test`: **219 files, 2,433 passed, 3 inherited skipped**, exit 0. Final committed-build command `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e --project=browser bundle-backup recovery-countdown sync/bundle --workers=1 --global-timeout 900000`: **3 files, 4 passed**, exit 0, revision `7ee5ce8e686d121c3658f56bd18b3931663da51f`. Real index/data/IO workers, MessagePorts, IndexedDB, actual downloads, concurrent edits, same-context page replacement, reset refresh, scoped-secret rejection, complete authored-state recovery, malformed-output rejection, and countdown/replacement-passphrase enforcement passed. Responsive screenshots inspected at 320/600/900/1200; keyboard/focus and accessibility assertions passed. Source/configuration/fixture/output hashes and artifact hashes are recorded in [verification evidence](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s02/verification.json). Owned preview and browser resources closed; port 8081 released.
- **surprises:** Self-review exposed CA-36 undercount across multiple locally held device frontiers: regression reproduced **1 instead of 3**, then passed after `2cd5ad4`. Countdown negative controls failed both intended cases against the old implementation. Temporary unrelated port occupation resolved without intervention. Browser harness navigation-before-unlock race corrected. Existing large-chunk warning remains. Native destination is doubled; no OS durability claim is made. Pre-existing configuration, roadmap, and architecture changes preserved.
- **followUp:** S03 owns CAP-41 consumer/reminder integration and J2; S06 owns nonempty conflict/audit/retained-graph extensions and J3/J1 reruns. Crash-retained pins remain conservatively recoverable through worker `exportGraph`/`release`; no blind startup sweep or restored confirmation authority. Existing-home adoption remains future work. Inherited empty-library unavailable copy remains outside this lease.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** —
- **filesTouched:**
  - `src/application/view-models/durability.ts`
  - `src/application/view-models/library.ts`
  - `src/application/view-models/security.ts`
  - `src/application/workflows/durability-services.ts`
  - `src/application/workflows/recovery.machine.ts`
  - `src/routes/durability-routes.tsx`
  - `src/routes/guards.tsx`
  - `src/routes/route-table.tsx`
  - `src/sync/providers/bundle/reader.ts`
  - `src/ui/durability/durability.module.css`
  - `src/ui/durability/home-screen.tsx`
  - `src/ui/library/library-screen.tsx`
  - `src/ui/records/app-home-screen.tsx`
  - `src/ui/security/recovery-codes-screen.tsx`
  - `src/ui/security/recovery-screen.tsx`
  - `src/ui/security/reset-readable-screen.tsx`
  - `src/ui/security/vault-dialogs.tsx`
  - `src/workers/data/app-session.ts`
  - `src/workers/data/backup-graph.ts`
  - `src/workers/data/backup-handlers.ts`
  - `src/workers/data/handlers.ts`
  - `src/workers/data/home-state.ts`
  - `src/workers/data/import-handlers.ts`
  - `src/workers/data/record-handlers.ts`
  - `src/workers/protocol/messages.ts`
  - `tests/browser/sync/bundle.spec.ts`
  - `tests/browser/sync/fixtures/bundle-reader.config.ts`
  - `tests/browser/sync/fixtures/bundle-reader.entry.ts`
  - `tests/browser/sync/fixtures/bundle-reader.html`
  - `tests/browser/sync/fixtures/bundle-reader.worker.ts`
  - `tests/e2e/bundle-backup.spec.ts`
  - `tests/e2e/fixtures/durability.ts`
  - `tests/e2e/recovery-countdown.spec.ts`
  - `tests/unit/ui/durability/vault-dialogs.test.tsx`
  - `tests/unit/ui/library/library-screens.test.tsx`
  - `tests/unit/ui/records/app-home-screen.test.tsx`
  - `tests/unit/ui/recovery-screen.test.tsx`
  - `tests/unit/view-models/library.test.ts`
  - `tests/unit/view-models/security.test.ts`
  - `tests/unit/workers/backup-graph.test.ts`
  - `tests/unit/workers/backup-handlers.test.ts`
  - `tests/unit/workers/backup-recovery.test.ts`
  - `tests/unit/workers/handlers.test.ts`
  - `tests/unit/workers/home-state.test.ts`
  - `tests/unit/workflows/module-boundaries.test.ts`
  - `tests/unit/workflows/recovery.machine.test.ts`


### F05 SESSION-02 r10 — received and accepted 2026-09-25

I’ll read the r10 replacement envelope and preserved failure evidence, trace the import refusal, and verify any correction against the exact counterexample.


I acknowledge r10 and the unchanged lease. The preserved failure occurs before bundle creation: import navigation reaches the app route, but opening the app returns an integrity refusal. I’m using the Playwright trace skill to inspect that boundary before changing code.


The trace records a worker `revision-conflict` immediately after “Create Fieldwork Q3,” with no failed network request. I’m tracing overlapping worker requests and app hydration to determine which operation conflicts and why the app route then reports an integrity refusal.


The exact browser failure reproduced. The failing `openApp` request reaches a projection that another concurrent hydration has already disposed. CP4’s new asynchronous receipt read exposes that existing race. I’m adding a deterministic concurrent-open regression and checking the accompanying `noteAppOpened` conflict so the correction covers both failures.


Both new regression tests failed on the old code and pass with the correction: concurrent readers now share one hydration, and overlapping visit notifications share one catalog write. I’ve added close/lock checks to reject late hydration results, and strengthened the browser journey to catch the console error that a passing UI assertion previously missed.


The corrected `sync/bundle` journey passes, and the full unit suite passed with the concurrent-open and visit regressions. The close/lock tests also pass: an old hydration cannot install itself after closure or replace a newer session. The remaining browser run is checking both save destinations and the recovery countdown before I commit and verify the committed build.


All four browser journeys passed before commit. The source comparison confirms that duplicate hydration and overlapping visit writes predate F05; CP4’s receipt await exposed the disposed-projection failure in `openApp`. I’m committing the correction now, then rebuilding and rerunning the exact receive command against that commit.


Correction `823012b` is committed. The rebuilt `sync/bundle` proof passes with no import errors, and its evidence records the served commit ID and bundle hash. The full unit suite passed **2,438 tests**, with three inherited skips; typecheck and lint also passed. The committed-build save and countdown journeys are still running.


## Handoff

- **session:** F05 SESSION-02
- **status:** done
- **checkpoint:** 6/6; r10 correction and acceptance complete.
- **commits:** `823012b67ac81b8696de7a28b5289358a935feda`. All prior checkpoint commits preserved.
- **notes:** r10 acknowledged; unchanged lease respected. Required CAP-39/current-producer CAP-40, CAP-41 receipt, and CAP-05 journeys pass. CA-34/35/36/37/40 meanings remain unchanged.
- **delivered:** Closed the reproduced import refusal. Concurrent route readers independently hydrated the same app; registering another session disposed the projection while `openApp` awaited its receipt read. Hydration is now shared, and close/lock invalidates late results. Overlapping `noteAppOpened` requests share one catalog write, preventing the accompanying revision conflict.
- **verification:**
  - Both deterministic concurrency regressions failed before correction.
  - Focused worker regression, lifecycle, and boundary checks: **3 files, 33 passed**, exit 0.
  - `pnpm test`: **220 files, 2,438 passed, 3 inherited skipped**, exit 0.
  - `pnpm typecheck`, `pnpm lint`: exit 0.
  - Committed fresh-build command: `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e --project=browser bundle-backup recovery-countdown sync/bundle --workers=1 --global-timeout 900000` → **3 files, 4 passed**, exit 0 at `823012b`.
  - Real workers, MessagePorts, IndexedDB, downloads, vault-only recovery, malformed-output rejection, interrupted save, same-context restart, receipt readers, and countdown assertions passed. Import errors were empty; served build identity matched the commit.
  - Source/configuration/output/artifact identities and logs: [r10 verification evidence](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s02/r10-verification.json). Owned resources closed; port 8081 released.
- **surprises:** The concurrency defects existed before CP4; source comparisons confirm unchanged implementations at `a93a87c` and `ee34258`. CP4’s receipt await exposed the disposed-projection failure; it was treated as a regression, not waived. An initial nonexistent test selector was corrected. Temporary trace extraction was removed before final lint. Native destination remains doubled; no OS durability claim.
- **followUp:** Orchestrator can close the r9 receive counterexample using this evidence and consume the [architecture delta](/Users/the.phoenix/WebstormProjects/sheaf/.program/signal/F05-SESSION-02.arch.md). S03 retains J2/consumer integration; S06 retains nonempty graph extensions and J3/J1 reruns. Pre-existing program and architecture changes remain untouched.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** —
- **filesTouched:**
  - `src/workers/data/app-session.ts`
  - `src/workers/data/record-handlers.ts`
  - `tests/browser/sync/bundle.spec.ts`
  - `tests/unit/workers/backup-app-session.test.ts`


### F05 SESSION-03 r2 — declared-blocked CP0 and received

I’ll read the exact envelope and its context files, verify the r2 lease and prerequisites, then execute the checkpoints within that scope.


I acknowledge the r2 lease. The role, config, and session digests match; STATE.md has changed since the envelope digest, so I’m checking its current dispatch record. CP1 must atomically persist reminder eligibility with authored commits while preserving imported-commit counts and receipt authority.


The commit paths share the expected event-store boundary. I found a possible CP1 prerequisite gap: schema apply appears to write an authored commit even when renaming to the current name, and its command result has no no-op variant. I’m checking that behavior and the other command families before deciding whether the lease needs a correction.


The diagnostic confirms the gap: unchanged app/table/field names and an unchanged required flag each add a durable commit. Saving an identical chart does too; reordering fields into their current order throws instead. These conflict with CP1’s no-op requirement. I’m consolidating the affected paths for a bounded lease correction; no source files have been changed.


## Handoff

- **session:** F05 SESSION-03
- **status:** blocked
- **checkpoint:** 0/4; no checkpoint committed.
- **commits:** —
- **notes:** r2 acknowledged at `2a87de3`. CP0 reproduced an inherited prerequisite gap affecting CAP-42/CA-37: unchanged schema/chart requests create authored commits. CAP-41/42 implementation and proofs remain incomplete.
- **delivered:** Read-only production-path investigation and [diagnostic evidence](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s03/cp0-noop-diagnostic.json). No source changes.
- **verification:** Bounded Node diagnostic exited 0 with eight cases using production handlers, commands, crypto, SQLite, and encrypted persistence over fake-indexeddb:
  - Unchanged app/table/field names and required flag each incremented pending commits by one.
  - Identical chart save incremented pending count and chart revision.
  - Unchanged field ordering produced zero preview events, then threw `an authored commit carries at least one event`.
  - Already-set chart pin correctly authored nothing.
  - Fresh-handler reopen retained the inflated count; confirmation time remained null.
  - Negative assertions detected the unwanted commits. This is diagnostic evidence, **not** checkpoint acceptance or browser proof. No full verification gates ran.
- **sourceChecks:** CODER, UI-CODER, PROGRAM-CONFIG, and SESSION-03 digests matched the envelope. STATE digest differs; current HEAD records this r2 dispatch. Production source remained unchanged.
- **surprises:** `executeSchemaChange` unconditionally commits prepared drafts; `SchemaApplyResultV1` requires a commit for successful application. `saveChart` unconditionally calls `commitSave` after validation. Suppressing reminders downstream would leave the prohibited authored commits intact. Initial diagnostic attempts exposed the zero-draft exception and an invalid assumption about the imported theme; neither was counted as passing evidence.
- **followUp:** Orchestrator should issue a bounded correction and replacement lease, then resume CP1. Preserve S02’s accepted receipt/concurrency behavior. S03 retains all four checkpoints, J2, status integration, accessibility, and full-suite acceptance.
- **needsOwnerCorrection:** Request r3 coverage for:
  - `src/application/commands/schema-commands.ts` — recognize unchanged schema requests before committing; handle zero drafts truthfully.
  - `src/application/commands/chart-commands.ts` — avoid committing identical saved definitions.
  - `src/workers/data/structure-handlers.ts` — map the command’s no-change result without inventing a receipt.
  - `src/application/view-models/schema.ts` and `tests/unit/view-models/schema.test.ts` — co-lease the exhaustive result mapping and regression coverage if introducing a distinct no-change outcome.
  
  Existing leased worker tests can prove unchanged count/history after reopen, unchanged reminder state, and continued rejection of stale requests. This closes CP1’s explicit no-op requirement; no migration or new policy is needed.
- **needsDesignSource:** —
- **blockedReason:** CP1 requires no-op commands to create no authored commit. Reproduced schema/chart counterexamples require command-layer changes outside r2. Dependent implementation stopped under the checkpoint-0 owner-correction rule.
- **filesTouched:** No source files or commits. Only ignored diagnostic evidence created; pre-existing changes preserved.


### F05 SESSION-03 r3 — fully accepted

I’ll read the replacement r3 envelope and the updated session and state files, acknowledge the lease, then resume from checkpoint 0 without delegation.


I acknowledge the complete r3 lease, including the six added no-op correction paths. I’ll preserve the existing changes and S02’s accepted receipt and concurrency behavior. CP1 must prove that unchanged commands create no commit and that accepted authored changes persist reminder eligibility atomically.


The r3 additions cover the reported schema and chart no-op corrections and their exhaustive consumers. Record and theme commands already have no-op handling. I’m checking the remaining command tests and reminder-state constraints before adding regression tests.


The new regression tests reproduce both no-op defects. I’m correcting the command results and their consumers first, then adding reminder persistence at the shared commit boundary.


Both no-op regressions now pass: 29 tests across the schema and chart worker suites. The fixes preserve validation and stale-revision guards, and unchanged schema requests return an explicit result without a receipt.


The reminder trigger now shares the transaction that writes the commit, head, and encrypted catalog. I’m verifying it through independent catalog decryption after shutdown, with exact-count checks for record, schema, chart, and theme changes. The policy tests cover every dismissal interval and clock rollback.


Checkpoint 1 is committed as `59caafb`. Typecheck and lint passed; the checkpoint run passed 576 tests in 48 files, followed by 54 targeted tests and 11 chart tests after the final assertions.

Checkpoint 2 must connect persisted eligibility to the shared UI, acknowledge dismissal without adding a commit, and prove restart timing through the real built worker.


The reminder query and dismissal path is wired into the shared app boundary. I also found that chart saves and pins lacked the refresh used by record, schema, and theme edits. The leased chart service now notifies that boundary only when the worker returns a real commit.


I’m using the Playwright skill for browser verification, following the session’s prescribed test files and build commands. The clock fixture will control only `Date.now` in the verified data worker; queries, dismissals, storage, and page replacement will use the production path.


Both browser clock self-tests passed. They verified the emitted worker asset, independent time readback, restoration, and rejection after worker closure. The page-only clock negative control also passed: renderer time could not advance eligibility. The full restart-and-deadline journey is running now.


The exact reminder deadlines and restart checks passed, including repeated daily reminders. Schema, chart, and theme edits also trigger the shared reminder. I’m now adapting existing browser journeys to dismiss it after their first saved change while preserving their original assertions.


The focused worker and workflow tests passed, including stale dismissal rejection and duplicate-request handling. Typecheck and lint are also green. The compatibility browser run has passed the accessibility journeys so far; it is continuing through backup, CRUD, chart, and theme flows.


J1’s download and native-save journeys passed with the reminder changes, as did CRUD, relationship repair, and the F04 demo. Next, CP3 will carry the same receipt time and pending count into app navigation and Settings, with working backup links. Provider connection behavior remains assigned to S07.


CP2 is committed as `a016752`: all 49 selected browser tests and 573 focused unit tests passed. CP3 is done when the library, app frame, app home, Settings, and backup detail show matching facts after reopen, and each exposed remedy reaches its production route.


The status view-model and UI checks passed. The new backup-status browser test exposed a selector typo, which I corrected. A legacy imported-value assertion also failed after the provenance change; I’m checking the stored source before changing its wording.


The record and responsive structure journeys now pass. The remaining status test needs to select the download destination explicitly, as the existing bundle test does; otherwise Chromium opens its native picker and no download event occurs.


Checkpoint 3 passes: library, app, Settings, and backup detail agree on the persisted receipt time and pending count after reopening. Both backup remedies reach their production routes. Converted authored values now use provenance-aware copy; the legacy import wording remains intact.


Checkpoint 3 is committed as `d8b4e14`. For checkpoint 4, “done” means responsive and keyboard-accessible reminders/status, stale-response and duplicate-dismissal checks, then the full unit and end-to-end gates. I’ll also rerun J1 and J2 from the committed build.


Four new negative controls caught mismatched app/home/trigger responses being accepted by the reminder actor. The actor now rejects them, and all nine workflow tests pass. I’m checking the real browser’s focus behavior and the four required viewport sizes next.


The full unit suite passes: 223 files, 2,461 tests, with three inherited skips. The keyboard test also passes, including Escape, focus restoration, trapped tab order, and short-screen scrolling. One J2 reopen hit the worker-acquisition timeout; I’m inspecting its trace before treating the browser gate as complete.


I’m using the Playwright trace skill to inspect the failed reopen. The 10-second bound stays unchanged; the trace should distinguish a missing worker from a startup failure.


The trace shows `ERR_NETWORK_CHANGED` on three startup modules, so the replacement page never created a worker. I’ve recorded that failure and kept the timeouts unchanged.

The new reminder and status surfaces pass accessibility checks at all four widths. Visual inspection also found inherited Settings wrapping at 600px and app-name clipping in the 900px rail; I’ll report those to their stylesheet owners without expanding this lease.


The full end-to-end run has selected 81 tests and is progressing through the existing journeys. Typecheck, lint, and the focused architecture/consumer checks are green. I’m finishing the contract delta and reviewing the complete session diff while that gate runs.


J1 passes through both download confirmation and the native writable-handle fixture in the full run. The reviewed compatibility changes preserve the old assertions and only dismiss reminders after successful saves. The remaining gate is still running.


The full run has passed 30 tests, including backup status, both J1 destinations, recovery, and readable reset. It is now in the longer F04 journey. I’m waiting for its existing bounded result; no retries or timeout changes have been added.


The live trace identified a real layout regression in the 320px F02 test: the new status line shifts the record link beneath the sticky search area and bottom navigation, so pointer clicks cannot reach it. I’m stopping this run, fixing the owned records layout, and then rerunning the affected test before the full gate.


The 320px journey now passes. Record links reserve scroll space for the measured search toolbar and bottom navigation, keeping them clickable without changing the test’s actions or assertions. I’m running the full verification gates again.

Type checking, lint, and all 223 unit-test files pass: 2,461 tests passed, with the three inherited skips unchanged. The full browser run is progressing through the existing journeys, including compact layouts and 200% text checks.

Both existing J1 backup journeys pass, including receipt recovery after page replacement. The status journey also passes across all four widths, showing the same confirmed time and pending count in the library, app, Settings, and backup detail.

The full run has passed the previously blocked 320px F02 journey, plus F03’s offline journey and readable reset. I’m keeping the source unchanged while the remaining tests run; afterward I’ll commit CP4 and rebuild that commit for final acceptance.

The browser run has passed 53 tests so far, including CRUD, relationship repair, recovery countdown, and offline checks. Source review is complete. Two inherited visual issues remain outside this lease: cramped Settings rows at 600px and a clipped rail label at 900px; I’ll retain them in the handoff.

All six J2 tests pass in the full run: worker-clock isolation, the page-clock negative control, five exact dismissal deadlines across page replacement, the real-clock journey, all authored command families, and keyboard/responsive behavior. Structure and snapshot journeys also pass.

All 81 browser tests pass, with no retries or skipped browser tests. CP4’s gates are complete. I’m committing the checkpoint, then rebuilding it for the required combined J1/J2, countdown, bundle, and status acceptance run.

CP4 is committed as `47a633b`. All four checkpoint commits contain only r3-leased paths. The fresh committed build has passed bundle recovery, status consistency, and J1 download acceptance; native-save, countdown, and J2 checks are still running.

The committed-build acceptance run passed all 11 tests. Evidence matches commit `47a633b`, the build configuration, and the served asset hashes; the earlier full-suite source digests also match that commit. I’m finishing the evidence inventory and confirming server teardown.

## Handoff

- **session:** F05 SESSION-03
- **status:** done
- **checkpoint:** 4/4
- **commits:**
  - `59caafb` — CP1: authored-change reminder producer
  - `a016752` — CP2: persistent reminders and restart proof
  - `d8b4e14` — CP3: consistent backup facts and remedies
  - `47a633b` — CP4: accessible reminder/status integration
- **notes:** r3 acknowledged before writing; no delegation. CAP-42 verified through authored commit → encrypted reminder → dismissal → restart. CAP-41 scratch/bundle surfaces verified under CA-36/40; cloud extension remains S07. CA-37 preserves imported-commit counts, receipt authority, and no-op/rejection invariants.
- **delivered:** Atomic reminder production, persistent escalation, shared reminder UI, truthful no-op schema/chart outcomes, consistent backup status/remedies, provenance-aware preserved-value copy, and responsive/accessibility corrections. Architecture delta: [F05-SESSION-03.arch.md](/Users/the.phoenix/WebstormProjects/sheaf/.program/signal/F05-SESSION-03.arch.md).
- **verification:**
  - `pnpm typecheck` and `pnpm lint`: exit 0.
  - `pnpm test`: **223 files, 2,461 passed, 3 inherited skips**, exit 0.
  - `SHEAF_PW_PORT=8081 pnpm test:e2e --workers=1 --global-timeout=900000`: **81/81 passed**, exit 0.
  - Fresh committed-build command: `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e --project=browser bundle-backup recovery-countdown sync/bundle scratch-reminders backup-status --workers=1 --global-timeout=900000`: **11 tests across 5 files, all passed**, no retries/skips.
  - J2 exercised real workers, MessagePorts, encrypted catalog and browser IndexedDB: all five exact dismissal deadlines, worker replacement after each dismissal, unchanged counts, page-clock negative control, separate real-clock journey, all authored families, and home-assignment suppression.
  - Unit regressions cover no-op persistence after reopen, stale dismissal rejection without durable change, duplicate acknowledgements, and incorrect response identities. Relevant negative controls failed before correction.
  - **37 screenshots inspected**; responsive/axe checks at 320/600/900/1200px, plus short-phone actions, keyboard containment, Escape dismissal and focus restoration.
  - Unit persistence uses fake-indexeddb with production commands/crypto/SQLite. J1’s native destination retains its existing writable-handle fixture; browser download is real.
  - [Verification inventory and evidence](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s03/verification.json).
- **sourceChecks:** Final evidence matches `47a633bde5528de15e0d7bf274f733bf7f4e7159`, configuration digests and served asset hashes. Full-suite worktree digests match committed source. Role/config/session digests matched r3; STATE’s changed dispatch record was read and preserved. Every checkpoint’s paths verified against r3. Source/tests clean; port 8081 released.
- **surprises:** Fixed an owned 320px sticky-toolbar interception exposed by full integration. An earlier browser run encountered `ERR_NETWORK_CHANGED`; retained in evidence, without increasing timeouts or enabling retries. New schema `unchanged` outcome is mapped through command, protocol, handler, route and VM. Legacy absent provenance retains existing import wording.
- **followUp:** Orchestrator should consume the architecture delta and update STATE. S07 retains cloud/provider status and J4 proofs; S06 retains nonempty graph/publication and J3 proofs. Unrelated inherited visual issues remain with M46 (`schema.module.css`, cramped 600px Settings rows) and M39 (`app-shell.module.css`, clipped 900px rail branding). Pre-existing changes preserved.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** —
- **filesTouched:** 58 committed paths:

```text
src/application/commands/chart-commands.ts
src/application/commands/schema-commands.ts
src/application/view-models/durability.ts
src/application/view-models/records.ts
src/application/view-models/schema.ts
src/application/workflows/durability-services.ts
src/application/workflows/durability.machine.ts
src/application/workflows/records-services.ts
src/domain/policy/backup-freshness.ts
src/domain/policy/scratch-reminder.ts
src/routes/durability-routes.tsx
src/routes/route-table.tsx
src/routes/schema-routes.tsx
src/ui/durability/durability.module.css
src/ui/durability/home-screen.tsx
src/ui/durability/scratch-reminder-dialog.tsx
src/ui/library/library-screen.tsx
src/ui/library/library.module.css
src/ui/records/app-frame.tsx
src/ui/records/app-home-screen.tsx
src/ui/records/records.module.css
src/ui/schema/app-settings-screen.tsx
src/workers/data/event-store.ts
src/workers/data/handlers.ts
src/workers/data/record-handlers.ts
src/workers/data/structure-handlers.ts
src/workers/protocol/messages.ts
tests/e2e/accessibility.spec.ts
tests/e2e/backup-status.spec.ts
tests/e2e/bundle-backup.spec.ts
tests/e2e/charts.spec.ts
tests/e2e/dark-semantics.spec.ts
tests/e2e/fixtures/durability.ts
tests/e2e/fixtures/structure.ts
tests/e2e/gate-f02-demo.spec.ts
tests/e2e/gate-f04-demo.spec.ts
tests/e2e/offline-guard.spec.ts
tests/e2e/records-crud.spec.ts
tests/e2e/relationships.spec.ts
tests/e2e/scratch-reminders.spec.ts
tests/e2e/theme.spec.ts
tests/e2e/workbook-import.spec.ts
tests/unit/policy/scratch-reminder.test.ts
tests/unit/ui/durability/status.test.tsx
tests/unit/ui/records/fixtures.ts
tests/unit/ui/schema/harness.ts
tests/unit/ui/schema/settings.test.tsx
tests/unit/view-models/durability.test.ts
tests/unit/view-models/records.test.ts
tests/unit/view-models/schema.test.ts
tests/unit/workers/chart-handlers.test.ts
tests/unit/workers/data-worker.ts
tests/unit/workers/event-store.test.ts
tests/unit/workers/handlers.test.ts
tests/unit/workers/structure-handlers.test.ts
tests/unit/workers/theme-handlers.test.ts
tests/unit/workflows/chart-services.test.ts
tests/unit/workflows/durability.test.ts
```


### DESIGN-F05-PROVIDER-STATES — accepted

I’ll read the envelope and its required context, then build the provider-state mock and add only the permitted inventory rows. I’m using the frontend-design skill for the mock.


The envelope calls for supplemental states within the existing durable-home screens. I’ll keep the same visual language and make sure cancellation, reconnect, quota failure, and disconnect preserve the last confirmed backup time and local-change count.


I’ve confirmed the state contracts: provider consent stays external, reconnect must match the stored account, and disconnect retains both local data and the remote backup. I’ll use labelled preview controls to exercise the return states without contacting either provider, then inspect them with the agent-browser skill.


The mock now covers all requested states, and its first renders fit all five required widths. I’ll inspect the screenshots next, then check keyboard focus, 200% text, and both provider variants before committing the two allowed files.


The visual pass found an unavailable-provider state that still exposed a reconnect button in the surrounding mock. I’ve corrected it. The dialogs fit all five widths; longer phone states scroll as intended. Keyboard, text-size, and accessibility checks are still running.


The 30 accessibility audits reported no violations. Keyboard checks confirmed Tab wrapping and Escape returning focus to the launcher; the OneDrive reconnect and disconnect flows preserved the backup facts. Two automation attempts stalled during fixture changes, so I’m checking the remaining text-size case in a fresh browser session before recording the final evidence.


Verification is complete: 80 state renders inspected across the five widths, 30 accessibility audits with no reported violations, and keyboard and 200% text checks completed. Existing mocks are unchanged, and `design.md` has exactly two added inventory rows. I’m committing the two permitted files now.


## Handoff

- **session:** DESIGN-F05-PROVIDER-STATES
- **status:** done
- **checkpoint:** 1
- **commit SHA:** `98ee79cf7b3654fb7e6a676692557a6a8cd349fd`
- **notes:** Provider-state design fill delivered; existing semantics and mocks preserved.
- **delivered:** Interactive provider/account selection, authorization returns, reconnect/account guard, quota remedy, and disconnect states; two added inventory rows.
- **verification:** Inspected 80 renders at 320/430/768/1024/1440px; 30 accessibility audits reported zero violations. Checked keyboard containment/return, 200% text, and unchanged backup facts. Committed paths verified. [Evidence](/Users/the.phoenix/WebstormProjects/sheaf/.program/design-f05-provider-states/verification.json).
- **surprises:** Automation stalls recorded; fresh-session checks completed. Unrelated workspace changes preserved.
- **followUp:** SESSION-07 CP2/4 can consume this design source. Provider registration, live qualification, and DB inputs remain separate prerequisites.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** —
- **filesTouched:**
  - `program/sheaf/mocks/f05-provider-states.html`
  - `program/sheaf/specs/design.md`


### REPLAN-F05-GRAPH-APPROVED receive — 2026-09-25

Accepted plan-only commit109513b: exact six-file lease, historical handoffs and protected hashes verified; no application changes. Typecheck/lint baseline independently exit0 at afe37f3. Author contract afe37f3 supplied; S06 remains pending scoped completeness review and implementation.

I’ll read the accepted graph contract, current plan, and implementation paths, then reconcile the six allowed planning files and commit only the changed paths.


The accepted contract supplies the V2 head, record-page, and evidence formats. I’m tracing their consumers now so S06 owns the full preservation path, including later edits, import appends, bundle decoding, and recovery proofs.


The source trace shows two concrete lease gaps: import append rebuilds the head using a V1-only type, and the bundle reader assumes a single retained source head. S06 also needs to replace the current revision-zero record mapping and reconstruct history from audit evidence before installing a compacted head.


I’m checking cleanup and recovery alongside the V2 readers so the plan covers the full path through reopen and vault-only recovery. J3 will exercise the real periodic trigger at the production threshold, without adding a release debug API.

The batch now includes import append, projection history/export, bundle-decoder fixtures, counts, cleanup tickets, and scheduler composition. Initial imports store rows in checkpoint pages rather than record-created events, so S06 must also retain the authenticated original checkpoint needed to reconstruct row history. I found no remaining discrepancy requiring a DB/Author edit in this scope.

The lease check passes: S06’s 66 pathspecs match its Files table and LEASES.json, and its source lease remains disjoint from S04/S05. S01–03 and the full historical receive/handoff section are byte-identical. I’m finishing the current readiness summaries and source inventory before committing.

The final check also caught a graph-versus-state counting seam: retained historical baseline pages must not inflate the current-head baseline stream. That correction is now assigned to S06 CP1. Validation passes, protected-file hashes match, and I’ll commit only the six authorized planning files.

## Handoff

- **status:** done — bounded plan-only reconciliation.
- **commits:** `109513b386721927f1c3a7b7b7b58a81780da106`
- **filesTouched:** Under `program/sheaf/prompts/durable-home-backup/`: `MASTER.md`, `STATE.md`, `SESSION-06.md`, `SESSION-07.md`, `PLAN-CHECK.md`, `LEASES.json`.
- **verification:** Lease/Files/STATE consistency, dependency graph, concurrency disjointness and diff checks passed. Historical handoffs, S01–03 acceptance and protected-file hashes unchanged. Commit contains exactly six authorized paths. No application tests or builds run.
- **notes:** CA-35/41 Author input supplied; S06 pending implementation with candidate/installed/composed proofs planned. Expanded S06 to 66 pathspecs covering consumers, cleanup and harness seams.
- **surprises:** Initial-import checkpoint retention, audit ordering, historical baseline counting and provenance mappings needed explicit assignments. No remaining Author/schema discrepancy identified.
- **followUp:** Orchestrator receives scoped completeness review, refreshes current summaries, then dispatches S06 with port8081 and exclusive build/output resources.
- **unresolvedBlockers:** `PLAN-REVIEW-GRAPH-APPROVED` gates S06 dispatch. `INPUT-DROPBOX`, `INPUT-ONEDRIVE`, S07 predecessor proofs and `GATE-F05` remain unchanged.



### ARCHIVIST-F05-GRAPH-APPROVED raw receive — 2026-09-25

I’ll read the scoped record, then trace the approved graph contract through the S06/S07 leases, source paths, and proof harness. I’ll return one read-only Archivist Note with any contradictions and ownership gaps.


The replan assigns the main graph gaps to S06: initial-import checkpoint retention, lossless V2 provenance, original chain anchors, history reconstruction, and both post-compaction writers. I’m checking those assignments against the actual consumers and harness, especially paths outside the lease.


The existing runner does build before preview and refuses server reuse. The decoder runs in a separate worker; S06 owns the fuller evidence report and context isolation it still needs. I’m now checking whether the approved record and checkpoint fields can carry all the facts S06 promises to preserve.


I found a consumer missing from S06’s lease: the vault manifest codec rejects reference arrays unless they are ordered by physical revision/storage ID. S06 explicitly requires logical audit/conflict ordering, but assigns changes only to the exporter and publication paths. I’m tracing both encode and decode so the finding covers the full boundary and its tests.


## Archivist Note

- **role:** archivist
- **mode:** planning-completeness
- **registryUpdated:** false
- **reconciled:** []
- **conventionsAdded:** []
- **cleanupBriefs:** []
- **logEntry:**

  **2026-09-25 — Reviewed Author `afe37f3`, replan `109513b`, receive `a8b13da`, and unchanged application source through `47a633b`. One actionable consumer/lease gap remains.** The accepted DB contract needs no renewed policy approval. This review does not clear dispatch or verify compaction.

  **F05-GRAPH-APPROVED-01 — Logical graph ordering still encounters an unleased physical-order codec.**

  **Affected:** CAP-40/44; CA-35/41. Consumers are S06 CP1 candidate publication and recovery, CP2 installation prerequisites, CP4 J3/J1, and downstream S07 publication.

  **Evidence:** The accepted [audit/conflict contract](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/specs/database.md:627) specifies logical commit ordering and binary conflict-ID ordering. The existing [AppManifest contract](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/specs/database.md:1661) requires arrays ordered by logical lower bound. [S06 CP1 item 6](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/prompts/durable-home-backup/SESSION-06.md:132) consequently prohibits applying physical revision/storage-ID sorting to audit/conflict sequences.

  However, [vault.ts `refs()`](/Users/the.phoenix/WebstormProjects/sheaf/src/persistence/codecs/vault.ts:91) rejects every reference array unless ordered by `logicalRevision`, then storage ID. `readManifest` applies that check to audit/conflict arrays, and **both** `encodeAppManifest` and `decodeAppManifest` invoke it. Correcting only `backup-graph.ts`/publication therefore leaves a rejecting boundary.

  A read-only, in-memory probe of the actual codec confirmed that equal-revision audit and conflict references ordered `[ID9, ID1]` reject during both encoding and decoding; reversing only the IDs passes. This demonstrates the physical-order gate, not a complete authenticated graph test.

  **Ownership gap:** S06’s 66-path lease omits `src/persistence/codecs/vault.ts` and `tests/unit/codecs/vault.test.ts`; S07 also omits them. Their completed S01 ownership cannot satisfy S06’s new CP1 requirement. PLAN-CHECK’s assertion that all affected consumers/tests are leased is therefore incomplete.

  **Smallest correction route:** Planner/Orchestrator should co-assign the manifest-codec correction and paired tests to **S06 CP1**, updating SESSION-06, LEASES, STATE’s copied ownership/mapping, and PLAN-CHECK together. Preserve the accepted payload layouts, migration006 fields, container versions, and legacy bytes. Specify where authenticated payload lower bounds are checked; neither physical sorting nor simply dropping order validation establishes logical correctness.

  **Closure assertion:** Publish and independently recover multiple audit/conflict pages whose logical order differs from physical revision/storage-ID order. Preserve exact local-head order through manifest encode/decode; reject reversed logical ranges, duplicates, overlap, conflicting aliases and substituted descendants. Include the codec tests in the candidate gate and retain legacy known-answer bytes and nested-version refusal.

  **Other scoped assignments are concrete and remain future proof obligations:**

  - CP1 owns initial-import checkpoint/PageRef retention—initial rows have no `record.created` events—plus V2 metadata/provenance, original terminal chains, complete evidence traversal, current-versus-retained baseline accounting, and separate history/conflict assertions.
  - CP2 owns installed hydration/history before tail replay, both ordinary-edit and import-append preservation, receipt-relative counts, atomic exact-ID cleanup tickets, unlock sweeps and full pinned closure.
  - CP3 owns the absent production scheduler and lifecycle/harness mechanisms. CP4 specifies real-clock **127/128 and recurring-threshold** observations, same-context worker replacement, UI restoration, subsequent edit/import, bundle save and separate empty-context vault-only recovery. These are assigned outputs, not missing predecessor inputs.
  - Fresh main build, strict port/no server reuse, separate decoder build, asset identity, exclusive outputs, bounded execution and teardown are specified. No additional root-runner ownership gap was found.

  **Inherited dispositions:** PC-F05-01/04 history presentation and checkpoint timing are assigned before their gates; prior countdown, scope mapping and reminder-clock corrections retain accepted evidence. J6 remains S07-owned. FINAL-REPORT, blocker history and architecture still contain pre-`afe37f3` missing-input language; the replan already assigns their current-summary refresh to Orchestrator. They must not recreate a graph approval gate. Provider registrations remain separate and unrelated.

  **Inspection and verification limits:** Inspected the supplied planning/current records, applicable inherited findings, entire accepted F05 graph section, relevant requirements/architecture, producer-reader paths, sampled boundary tests and actual harness/configuration. The exact S06 Playwright selector currently discovers **8 tests in 4 files**; compaction specs are correctly still planned. Ran discovery and the bounded codec probe only—no build, application suite, browser journey, provider call or visual proof. Root’s typecheck/lint and prior **2461 unit/11 browser** results remain baseline evidence, not compaction proof. No full-repository audit or cleanup scout.

  **No files edited, commits created, or workers spawned. Pre-existing working-tree changes remain untouched.**



### SESSION-06 r2 receive — declared-blocked CP0

No files/commits; native ended. Independent two-file24-test rerun exit0; inspected frontier→encodeCommitBody existing genesis guard. Corrected premise in session/current mapping, basis coverage remains assigned. Same68-path lease; resume same context with instruction r3.

I’ll read the session, program rules, and current evidence, then trace the storage boundaries before starting checkpoint 1.


The accepted plan assigns the missing V2 codecs, graph readers, compactor, and scheduler to this session. I’m checking the original import and event evidence through publication and recovery, including the manifest ordering correction, before changing those paths.


I found one contradicted correction premise: `verifyBackupFrontier` already rejects a genesis commit with a predecessor through `encodeCommitBody`. Basis-frontier coverage is still missing. I’ll verify both with a read-only probe so the handoff distinguishes the existing guard from the work still required.


## Handoff

- **session:** SESSION-06
- **status:** blocked
- **checkpoint:** 0/4; no commits.
- **notes:** Lease r2; source `8e9ab8b64be1824fe6c6760b2b0ff7fe46bc6b49`. Found a contradicted CP1 correction premise affecting CA-35/41. No capability readiness changed.
- **delivered:** Read-only source trace and executable counterexample.
- **verification:** `pnpm exec vitest run tests/unit/sync/protocol/frontier.test.ts tests/unit/codecs/event-commit.test.ts` → **2 files, 24 passed**, exit 0. Read-only Node probe confirmed:
  - Original chain accepted.
  - `verifyBackupFrontier` rejects nonnull genesis predecessor.
  - Commit decoder independently rejects it.
  - Uncovered basis frontier remains accepted—the assigned coverage gap is real.
- **surprises:** CP1 item 6 incorrectly states genesis rejection is absent. [frontier.ts:23](/Users/the.phoenix/WebstormProjects/sheaf/src/sync/protocol/frontier.ts:23) calls `encodeCommitBody`, whose existing guard rejects that pairing; decoding enforces it independently. Initial probe required Node’s `--experimental-transform-types`; corrected probe passed.
- **followUp:** All four implementation checkpoints and candidate/installed/J3/J1 proofs remain pending. Missing V2 implementations remain assigned S06 work, not predecessor blockers.
- **needsOwnerCorrection:** Orchestrator: correct SESSION-06 CP1 item 6 and STATE’s corresponding mapping to **preserve existing genesis enforcement, add frontier-boundary regression coverage, and implement missing basis coverage**. No lease expansion or Author change needed.
- **needsDesignSource:** —
- **blockedReason:** CODER’s checkpoint-0 contradictory-premise rule requires returning evidence for bounded prompt correction before dependent implementation.
- **filesTouched:** —; existing workspace changes preserved.



### SESSION-06 r3 receive — history-copy consumer seam

Native returned/ended CP0, no commits or files. Read-only search confirms exactly two E2E copy assertions outside earlier lease; both are now leased r3 with preserved assertions and required full-file runs. Prior focused checks84pass and discovery4 tests are inherited worker evidence, not product acceptance. Instructions r4 reissued to same context; all compaction proofs remain planned.

I acknowledge instruction revision r3 and the unchanged r2 write lease. I’ll read the refreshed session and evidence, preserve the existing genesis guard, and proceed through the four checkpoints.


All six instruction-source hashes match the r3 envelope. The accepted contract keeps vault format 1 and adds versioned app payloads; I’m tracing how the graph reader, projection, and writers preserve original commit evidence and imported-row origins.


The history-copy change has two test consumers outside the lease: `records-crud.spec.ts` and `gate-f02-demo.spec.ts` assert the checkpoint-only wording that CP2 must remove. I’m finishing the related consumer sweep so any lease correction can cover all known paths at once.


## Handoff

- **session:** SESSION-06
- **status:** blocked
- **checkpoint:** 0/4; no checkpoint commits.
- **notes:** Acknowledged instruction r3, lease r2. Source `4171795ba95f9c2152a04158bb9f276a4611d20e`; all six supplied instruction hashes match. CAP-44 and CA-35/36/40/41 proofs remain pending.
- **delivered:** Read-only contract and consumer inspection identified two omitted regression-test leases for CP2’s required history wording change.
- **verification:**
  - `pnpm exec vitest run tests/unit/ui/records/change-history-screen.test.tsx tests/unit/view-models/records.test.ts` → 2 files, **84 passed**, exit 0; existing behavior only.
  - `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e records-crud gate-f02-demo --list` → **4 tests in 2 files**, exit 0; discovery only.
  - Final working-tree status matches startup; existing changes preserved.
- **surprises:** Two unleased E2E assertions require the checkpoint-only wording CP2 explicitly removes. The corrected genesis premise is accepted and is not a blocker.
- **followUp:** Resume all four checkpoints after the bounded lease amendment. Candidate, installed, scheduler, J3 and J1 proofs remain S06 assignments.
- **needsOwnerCorrection:** Mechanical owner seam; Orchestrator should issue lease r3 adding:
  - `tests/e2e/records-crud.spec.ts:77` — update the empty-history wording assertion while preserving initial-import emptiness, pagination and CRUD/restoration checks.
  - `tests/e2e/gate-f02-demo.spec.ts:219` — update the history-scope wording assertion while preserving the reopened edit and remaining demo checks.
  
  Run both E2E files alongside the assigned gates after correction. No Author change or product decision is needed.
- **needsDesignSource:** —
- **blockedReason:** CP0 found missing consumer-test ownership for the authorized CA-40/41 presentation change. CODER’s lease rule requires a bounded amendment before dependent implementation; retaining misleading copy or leaving known regression failures would not satisfy the session.
- **filesTouched:** —



### SESSION-06 r4 receive — partial CP1 preserved

Native ended, zero commits; exact six-file diff SHA256febdb6437dc30b7540ae9ee5f984eb6c9828c64c3f5ea85999016ffe6ea4271d saved .program/recovery/F05-S06-r4-cp1.patch; unaccepted arch snapshot preserved separately. Protected hashes unchanged. Typecheck red is unfinished checkpoint, no done claim. Exact runtime fixture added under lease r4/instructionr5 with digest assertion preserved and import-journey regression assigned. No accepted checkpoint or arch delta.

I acknowledge lease r3 and instruction revision r4, including both E2E consumers. I’ll read the current session and repository rules, then implement and commit each checkpoint in order.


All six instruction hashes match the envelope. The accepted contract requires preserving original commits and imported-row origins separately from the compacted rows. I’m checking the codec, graph reader, projection, and writer paths together before adding the V2 candidate.


The two previously reported seams are resolved in the current instructions and lease. I’m starting checkpoint 1 with the frontier regression and missing basis-coverage check, followed by the V2 codecs and graph consumers. Checkpoint 1 will remain open until candidate publication and independent recovery pass.


The basis-coverage regression failed on the original code and passes with the new check; the targeted frontier, publication, fixture, and vault tests pass 18 tests. Typecheck found another consumer outside the lease: `tests/browser/worker/runtime.ts` rebuilds a head body field by field, losing the V1/V2 discriminant. I’m checking the remaining consumers before returning the required bounded lease amendment, with checkpoint 1 changes preserved.


The consumer sweep found one additional lease path: `tests/browser/worker/runtime.ts:506`. The mechanical fix is to pass `decodedHead` directly to `encodeAppHeadBody`, which already excludes the self-hash, preserving the V1/V2 relationship and the existing digest assertion.

I’m preserving six uncommitted checkpoint-1 files. Targeted checks pass 78 tests and lint; typecheck is still red on this unleased consumer and the in-lease adaptations not yet completed. No checkpoint or capability proof is complete.


## Handoff

- **session:** SESSION-06
- **status:** blocked
- **checkpoint:** 0/4 committed; CP1 partially implemented, uncommitted. No checkpoint SHAs.
- **notes:** Lease r3/instruction r4 acknowledged. Base `72f25b7105af2fa04c446d4d0d5f39224cddc772`; all six instruction hashes matched. CAP-44 and CA-35/36/40/41 proofs remain pending.
- **delivered:** Preserved partial V2/evidence codecs, shared provenance codec exports, manifest evidence-order preservation, basis-frontier coverage check, and frontier/vault regressions. No candidate installed or scheduler enabled.
- **verification:**
  - `pnpm exec vitest run tests/unit/sync/protocol/frontier.test.ts` before correction → **2 passed, 1 failed**, demonstrating missing basis enforcement.
  - `pnpm exec vitest run tests/unit/staging/roots.test.ts tests/unit/codecs/event-commit.test.ts tests/property/codecs/event-commit.test.ts tests/unit/codecs/vault.test.ts tests/unit/sync/protocol/frontier.test.ts tests/unit/sync/protocol/publication.test.ts tests/unit/sync/protocol/fixtures.test.ts` → **7 files, 78 passed**, exit 0.
  - `pnpm exec eslint src/import/staging/roots.ts src/persistence/codecs/event-commit.ts src/persistence/codecs/vault.ts src/sync/protocol/frontier.ts tests/unit/codecs/vault.test.ts tests/unit/sync/protocol/frontier.test.ts` → exit 0.
  - `pnpm typecheck` → exit 2: unleased runtime consumer plus unfinished in-lease union adaptations.
  - Scoped `git diff --check` → exit 0. No build/browser/candidate acceptance claimed.
- **surprises:** `tests/browser/worker/runtime.ts:506` reconstructs the decoded head field by field, losing the correlation between `headVersion` and typed `retainedRoots`. TypeScript rejects it against the required discriminated `AppHeadBody`. Other inspected unleased encoder consumers preserve the union or explicitly construct V1.
- **followUp:** Preserve these six modified files and resume CP1:
  - `src/import/staging/roots.ts`
  - `src/persistence/codecs/event-commit.ts`
  - `src/persistence/codecs/vault.ts`
  - `src/sync/protocol/frontier.ts`
  - `tests/unit/codecs/vault.test.ts`
  - `tests/unit/sync/protocol/frontier.test.ts`
  
  Scoped diff SHA-256: `febdb6437dc30b7540ae9ee5f984eb6c9828c64c3f5ea85999016ffe6ea4271d`. Partial architecture delta is in `.program/signal/SESSION-06.arch.md`; do not treat it as accepted. V2 tests, consumer adaptations, graph validation, candidate construction, and all subsequent checkpoints remain unfinished. Existing outside work is untouched; no server was started.
- **needsOwnerCorrection:** Mechanical owner seam. Issue lease r4 adding **`tests/browser/worker/runtime.ts`**. In `readAppRoots`, replace the field-by-field argument with `encodeAppHeadBody(decodedHead)`; the encoder already excludes the self-hash. Preserve the digest assertion. Then complete in-lease adaptations, rerun typecheck and candidate gates, and retain the `worker/import-journey` browser regression. No Author or product change needed.
- **needsDesignSource:** —
- **blockedReason:** CP1 requires an unleased consumer adaptation. The checkpoint remains open; partial implementation is preserved without committing an incomplete gate.
- **filesTouched:** — committed; six uncommitted files inventoried above.



### SESSION-06 r5 receive — Author payload-map gap

Native ended; no commits;23file hashes independently checked and full files saved including additions, unaccepted arch copied. Existing outside changes unchanged. Exact contract input supplied91ad694 under previously approved DB re-entry. Await scoped changed-boundary review; same implementation preserved.

I acknowledge lease r4 and instruction revision r5. I’ll inspect the preserved checkpoint-1 work and current instructions, then continue from those files without resetting or reapplying the backup patch.


All six instruction hashes match r5, and the six preserved implementation files are present. I’m reviewing the graph and projection code before completing the V2 consumer adaptations; candidate validation remains the checkpoint-1 acceptance boundary.


The runtime fixture and both head writers now preserve the V1/V2 discriminant. Typecheck’s remaining failure is in the leased graph test, where a legacy malformed-head fixture needs an explicit V1 version. I’m moving on to authenticated graph traversal and its rejection tests.


The graph reader now validates historical head hashes, resolves legacy aliases only through independently typed edges, and checks record-page ownership after collecting all parent constraints. It also counts only the selected head’s baselines when reconstructing state. I’ve added a regression with two historical heads sharing children and an extra historical baseline.


The historical graph regression passes. A new provenance test exposed a cache bug: byte-string evidence was being converted into a map. The cache now preserves byte strings and arrays, and the focused codec/projection checks pass 52 tests. I’m continuing with audit evidence resolution and original-chain validation.


Audit pages now resolve original commits and verify their hashes, logical order, checkpoint coverage, and chains. For V2 state reconstruction, the reader replays from the authenticated original import checkpoint, copies history without reapplying covered mutations, and compares authored state. Existing graph and vault-only recovery tests still pass; candidate construction and its full proof are not complete yet.


Typecheck passes with the runtime consumer fix and the new projection export port. I’m now building the candidate writer: it will preserve original audit evidence, seal bounded V2 pages, and validate the candidate through the graph reader before any installed head can change.


The first real import-and-edit candidate test passes. It produces a V2 head with an empty tail and authenticated audit roots, matches the original authored state, and leaves installed storage unchanged. I’m extending validation to conflict evidence and complete history before treating checkpoint 1 as ready.


The candidate now passes publication and vault-only recovery tests for the imported workbook, including schema, theme, chart, and full history comparisons. The broader component selection passes 216 tests. That is partial evidence: nonempty conflict/merge fixtures, adversarial graph cases, browser proofs, and installation are still outstanding.


I found a contract gap in the required conflict/merge proof. The accepted text defines the new pages and references, but the referenced event payloads remain `unknown`; no producer or decoder defines how their fields map to the existing SQL constraints. I’m checking the remaining sources before returning this as a bounded Author correction, rather than inventing a durable payload layout.


The source sweep found no conflict/merge payload definitions beyond the event names and semantic descriptions. A read-only probe confirms that the outer codec accepts empty payloads for all three kinds, while typed replay excludes them. The missing input is the authoritative payload-to-projection mapping—not a new lifecycle state or F06 action. Typecheck, lint, and 217 component tests pass; I’m preserving the open checkpoint with its source inventory.


## Handoff

- **session:** SESSION-06
- **status:** blocked
- **checkpoint:** 0/4 committed; CP1 remains open. No checkpoint SHAs.
- **notes:** Lease r4/instruction r5 acknowledged. Base `19cfa364f135ef63ee3820be62ae3d8c9b5b3f86`. Preserved original six-file partial implementation and extended it within the lease. CAP-44 and CA-35/36/40/41 acceptance remain pending.
- **delivered:** Partial V2 candidate writer, bounded projection export, original audit/import-checkpoint retention, historical graph validation, original-history reconstruction, consumer adaptations, and candidate publication→vault-only recovery tests. No pointer installation or scheduler enabled.
- **verification:** `pnpm typecheck`, `pnpm lint`, scoped `git diff --check` → exit 0. Candidate component selector → **24 files, 217 passed**, exit 0. `SHEAF_BUILD_ID=19cfa364-S06-r5-open-24d6b6d895d6 pnpm build` → exit 0. Exact test command, file hashes and build artifacts are recorded in [partial-evidence.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s06/partial-evidence.json). No browser, installed, J3 or J1 acceptance claimed.
- **surprises:** The accepted contract defines conflict pages/references, but not the referenced original event payload mappings. [`DomainEventV1.payload`](/Users/the.phoenix/WebstormProjects/sheaf/src/migrations/004_event_format_v1.ts:78) remains `unknown`; repository searches found no producer or decoder for `conflict.detected`, `conflict.resolved`, or `merge.applied`. A read-only probe confirmed all three accept empty/unrelated payload maps through the outer codec and remain excluded from typed replay. This does **not** imply a missing lifecycle enum or justify changing the outer codec.
- **followUp:** Preserve all **23 uncommitted files**, including new files, inventoried with hashes in the evidence document. Source inventory digest: `24d6b6d895d68cf7317c2285626e154a4b7425deee2f456a2dd7d6e88d99b2d1`. Resume CP1 after the mapping correction; conflict/merge validation, remaining adversarial/browser proofs and CP2–4 are unfinished. The unaccepted architecture delta is preserved in `.program/signal/SESSION-06.arch.md`. Existing outside work is untouched; no server remains running.
- **needsOwnerCorrection:** Orchestrator → bounded Author clarification in `program/sheaf/specs/database.md`: supply the original conflict/merge payload maps and variants, subject identity rules, and mappings to migration 005’s baseline/report/status constraints. Specify whether resolution/merge results are applied by these events or accompanying record/schema events. Then refresh SESSION-06’s fixture/replay instructions. The new reference/page layouts need no redesign.
- **needsDesignSource:** —
- **blockedReason:** Required CA-35/41 conflict/merge recovery proofs cannot validate original payloads and reconstructed effects without an authoritative mapping. Inventing that durable contract would exceed Coder’s assignment; passing current-workbook tests cannot substitute for this proof.
- **filesTouched:** — committed. All 23 uncommitted source/test paths and their exact hashes are preserved in the linked recovery inventory.



### ARCHIVIST evidence-map delta receive — 2026-09-25

Read-only result accepted; no additional mapping/lease gap. Source23file hashes checked unchanged. Candidate/installed/composed proofs stay pending. S06 resume same71path lease r4 with instructionr6 and exact original-payload source91ad694.

I’ll read the Archivist instructions and the scoped evidence-mapping records, then check the lease and projection paths for additional gaps. This pass will stay read-only.

The clarification assigns record/schema mutations to earlier events in the same commit; conflict and merge events verify those effects and reconstruct evidence rows. I’m checking that mapping against the existing schema and replay adapters. The partial graph still rejects conflict pages, which remains owned implementation work.

The revised CP1 explicitly owns the evidence decoders, projection reconstruction, and adversarial fixtures within the existing lease. I haven’t found an additional ownership gap. I’m finishing the check of baseline, subject, and validation-report mappings; the reported 217 tests do not establish nonempty conflict/merge preservation.

## Archivist Note

- **role:** archivist
- **registryUpdated:** false
- **reconciled:** []
- **conventionsAdded:** []
- **logEntry:** Scoped planning-completeness delta reviewed at `c9f032e`, against DB `afe37f3` + `91ad694` and preserved inventory `24d6b6d895d6`. **No additional planning gap found for CAP-40/44, CA-35/41.**
  - Reviewed the complete F05 graph contract and original payload clarification, migration004/005 constraints, domain validation, record/schema payload adapters, partial graph/projection reconstruction, SESSION-06 CP1/2, planned assertions, and the 71-path lease. All 23 preserved files match their inventory hashes.
  - The clarification supplies original-source identity, explicit baseline distinctions, complete alternatives/reports, subject mappings, pending/resolved status, and merge-result authority. Earlier same-commit mutation events must produce the declared result exactly once; evidence-only success is forbidden. No outer-payload, lifecycle, or SQL CHECK widening is required.
  - Remaining implementation is explicitly owned by S06 CP1: conflict-page decoding, typed evidence replay, actual `pending_conflicts`/`applied_merges` reconstruction, and preservation tests. The current rejection in `backup-graph.ts:104–146`, replay exclusion in `app-session.ts:604`, and history-only copying in `checkpoint-history.ts` are unfinished assigned work—not additional owner gaps. CP2 owns installed continuity.
  - Closing assertions remain required: nonempty pending/resolved/merge fixtures through actual projection mutations; exact source/baseline/report preservation; conflict history keyed by conflict ID; wrong-subject, missing-effect, missing-baseline and invalid-report rejection without installation, receipt advancement, or cleanup; no duplicate application after reconstruction.
  - Adw4M’s assigned ordering correction was not reopened. F06 actions, full compaction acceptance, unrelated capabilities, and a full-history reconciliation were outside this delta. No tests, builds, file edits, commits, or agent spawning occurred. Reported component passes remain inherited partial evidence; readiness is unchanged.



### SESSION-06 r6 receive — context exhausted, partial work preserved

No commits; native ended;25file hashes checked and complete verified archive created.7 import browser cases and224component tests are partial inherited evidence; no full candidate/installed/J3 proof accepted. Scratch lint interference corrected by archiving own backup copies only. New fresh recovery1 scheduled with unchanged lease and complete original evidence mappings.

I acknowledge lease r4 and instruction revision r6. I’ll read the clarified conflict/merge mapping and preserved implementation, then resume the open checkpoint without resetting or reapplying backups.


The clarification supplies the missing payload contract. Detection preserves alternatives without changing authored data; resolution and merge verify earlier mutations in the same commit. I’m wiring that validation into replay and the graph reader, with tests for reconstructed conflict rows and rejected effects.


The structural decoder is in place and preserves canonical provenance separately from the legacy record-event format. It checks payload keys, baseline states, reports and alternatives. Source authority and mutation effects still need replay validation; decoding alone does not establish those proofs.


The payload tests pass 27 cases, including lossless provenance, distinct absent/deleted baselines, false-success reports and duplicate effects. The graph reader now checks referenced conflict events, subjects and causal source commits. Projection reconstruction is still unfinished, so nonempty conflict/merge recovery is not yet accepted.


The new graph test passes with two conflict pages whose logical order is opposite their physical revisions. Reversed or duplicate pages, wrong subjects, missing source commits and substituted events reject without storage changes. The candidate writer now builds bounded conflict pages from original detections and resolutions; replay and SQL evidence rows remain the next CP1 work.


The evidence-copy test now verifies that baseline distinctions and pending/resolved conflict and merge rows survive copying without changing authored records. The broader run exposed a fixture-ordering error, which I corrected. Root lint also picked up the preserved `.program/recovery` backup files; I’ll rerun it excluding that backup directory without changing the backups or lint configuration.


Typecheck and the 224 component tests pass. I’m using the Playwright skill to check the existing worker import journey against a fresh build on port 8081. This verifies the runtime-fixture regression; it does not substitute for the unfinished compaction journey.


The worker import journey passed all 7 tests on the fresh build, and the served index and worker assets matched the emitted files. CP1 is still open: evidence replay, same-commit effect validation and complete nonempty recovery proofs remain unfinished. I’m preserving the current source inventory and partial evidence for continuation.


## Handoff

- **session:** SESSION-06
- **status:** blocked
- **checkpoint:** 0/4 committed; CP1 remains open. No checkpoint SHAs.
- **notes:** Lease r4/instruction r6 acknowledged; all six instruction hashes matched. Base `e2f21646a4b751afef578de2444adb80a3cd8a51`. CAP-44 and CA-35/36/40/41 acceptance remain pending.
- **delivered:** Extended the preserved implementation with original evidence payload decoding, conflict-reference validation, bounded conflict-page construction, and transactional copying of baseline/conflict/merge/history rows. Production evidence replay and effects validation remain incomplete.
- **verification:**
  - `pnpm typecheck` → exit 0.
  - Candidate component selector → **24 files, 224 passed**, exit 0.
  - History-only negative control → **1 selected test failed**, as intended; source restored and full selector passed.
  - `pnpm lint` → 23 parser errors in preserved recovery backups. `pnpm exec eslint . --ignore-pattern '.program/recovery/**'` → exit 0.
  - `SHEAF_BUILD_ID=e2f2164-S06-r6-open-3bf69d9f465e pnpm build` → exit 0.
  - `SHEAF_PW_PORT=8081 SHEAF_BUILD_ID=e2f2164-S06-r6-open-3bf69d9f465e pnpm exec playwright test --project=browser worker/import-journey --workers=1 --global-timeout=900000` → **7 passed**.
  - Served index/harness/data-worker/IO-worker hashes matched emitted artifacts. Runner stopped; port 8081 is clear.
  - Exact commands, assertions, limitations and hashes: [partial-evidence-r6.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s06/partial-evidence-r6.json).
- **surprises:** Root lint scans Orchestrator’s recovery copies outside the TypeScript projects. Those backups and lint configuration remain untouched. A fixture initially used unsorted random field IDs; corrected before the final passing run.
- **followUp:** Preserve all **25 uncommitted files** inventoried in the evidence document. Inventory SHA-256: `3bf69d9f465e8ecfbbee9c0af807f38dde603eb537acb55b2517b64f8d727a44`. Finish typed evidence replay, authoritative baseline/conflict/merge reconstruction, shared-validator and same-commit effects-once checks, remaining adversarial fixtures and complete candidate recovery before committing CP1. CP2–4 remain unfinished. The architecture fragment is explicitly unaccepted.
- **needsOwnerCorrection:** —
- **needsDesignSource:** —
- **blockedReason:** Context exhausted at CP1. No new Author or lease blocker was identified; remaining implementation and proofs remain assigned to S06. Partial passes do not satisfy checkpoint acceptance.
- **filesTouched:** No committed files. This continuation changed seven leased files:
  - `src/persistence/projection/checkpoint-history.ts`
  - `src/workers/data/backup-graph.ts`
  - `src/workers/data/compaction.ts`
  - `src/workers/data/record-event-payloads.ts`
  - `tests/unit/projection/compaction.test.ts`
  - `tests/unit/workers/backup-graph.test.ts`
  - `tests/unit/workers/record-event-payloads.test.ts`



### SESSION-06 r7 receive — baseline Author seam

Native ended with no code changes or commits;25preserved hashes independently match. Exact probe demonstrates missing baseline metadata, not SQL lifecycle defect. Author supplied17a73ae under existing approval; unchanged lease, scoped review then same recovery context resumes.

I acknowledge lease r4 and instruction revision r7. I’ll read the recovery evidence and current sources, preserve the partial CP1 work, and resume from the open checkpoint without resetting or reapplying it.


The recovery inventory matches the open checkpoint. The payload decoder and conflict-page writer are present, but production replay still rejects those evidence events. I’m tracing replay and SQL reconstruction so the candidate proof uses validated original events rather than copied fixture rows.


I found a possible contract gap in baseline reconstruction: `BaselinePageV1` stores scope ID, row state and values, but SQL reconstruction also requires scope authority, frontier and an absence reason. I’m checking the original import and evidence payloads for those facts before deciding whether this is implementation work or needs an Author clarification.


The import commit supplies authority for original present baselines. The remaining gap is narrower: an accepted legacy `absent` row has no reason in its page and need not have a conflict event supplying one. The existing graph regression accepts that case, while SQL requires a nonempty reason. I’ll return this contract discrepancy for a bounded clarification; the replay adapter remains S06’s assigned work.


## Handoff

- **session:** SESSION-06
- **status:** blocked
- **checkpoint:** 0/4 accepted; CP1 remains open. No checkpoint commits.
- **notes:** Lease r4/instruction r7 acknowledged at `6fc40b311521bbfe6d7de27f592c4af2fcf4c36c`. All six instruction hashes match. All 25 preserved implementation files remain byte-identical to the recovery inventory. CAP-44 and CA-35/36/40/41 acceptance remains pending.
- **delivered:** Read-only recovery inspection and a reproducible baseline-contract discrepancy. Evidence: [recovery1-baseline-contract.json](/Users/the.phoenix/WebstormProjects/sheaf/test-results/f05/s06/recovery1-baseline-contract.json).
- **verification:** `pnpm exec vitest run tests/unit/workers/backup-graph.test.ts -t 'reconstructs authored schema, provenance and restoration'` → exit 0; **1 file, 1 passed, 5 filtered**. Read-only codec probe confirmed an `absent` baseline round-trips without a reason; adding `absentReason` rejects as an unexpected field. No candidate, installed, build or browser acceptance claimed.
- **surprises:** `BaselinePageV1` stores only scope ID and row identity/state/values. An accepted legacy absent row need not have any conflict event supplying its reason. Yet migration005 requires nonempty `baseline_records.absent_reason`. The existing graph regression accepts precisely that reasonless absent-row case. Original import authority is recoverable; this discrepancy concerns missing metadata beyond that mapping.
- **followUp:** Preserve the 25-file partial implementation and unaccepted architecture fragment. Typed evidence replay, effect validation and CP1–4 remain S06 work. Resume after the baseline compatibility disposition is explicit.
- **needsOwnerCorrection:** DB/Author and Planner must specify authoritative origins or a compatibility disposition for:
  - Legacy absent-row reasons missing from `src/import/staging/roots.ts`’s exact baseline wire format.
  - Durable-home baseline scope metadata—home, counterpart and established generation—required by migration005 but absent from both `BaselinePageV1` and `BaselineEvidenceV1`.
  
  Reconcile `program/sheaf/specs/database.md` and SESSION-06’s baseline reconstruction proofs. No SQL relaxation, fabricated defaults or lease expansion is proposed.
- **needsDesignSource:** —
- **blockedReason:** Required CA-35/41 baseline reconstruction cannot preserve facts absent from the authenticated source. Copying fixture SQL rows or treating a conflict’s asserted metadata as independent baseline authority would not establish the required vault-only proof.
- **filesTouched:** No implementation files changed or committed. Created only the allowed administrative evidence file `test-results/f05/s06/recovery1-baseline-contract.json`.

