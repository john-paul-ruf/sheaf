# State Tracker — Sheaf / durable-home-backup

## Program / Feature / Intent / Sessions

- Program: Sheaf; existing repository-relative root `program/sheaf/` (the config's `/program/sheaf/` is its logical path, not a new filesystem root).
- Feature: F05 `durable-home-backup`; FR-24–28, flows 4/5, with local/vault recovery distinction from FR-23 and provider isolation from FR-21.
- Intent: make a scratch app recoverable as an encrypted bundle or provider vault, expose confirmed backup truth and reminders, and compact history without losing reconciliation or restoration facts.
- Plan revision: `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`, 2026-09-24. Seven sessions, 28 checkpoint commits planned (3+6+4+3+3+4+5). Replan base `309313170b997d2546794c6173ebcabfbd44ac5f`: S01 done; S02 CP1 03ee571 and CP2 c7e6507 accepted after independent receive checks.
- User instruction `plan feature f05` authorizes F05 planning despite the previous roadmap planning gate. It is not evidence that a demo was viewed and does not silently resolve the F04 review debt.
- Readiness: resumed by user approval 2026-09-24. S02 CP2 and partial CP3 remain accepted; DEC-71/72 and recommended GRAPH-CONTRACT direction approved. Designer save/reminder fill accepted 4c31ded; policy-plan reconciliation precedes S02 continuation. S06 still requires exact DB/Author contract and S02/S03; provider registrations remain unavailable. No new implementation or capability proof claimed.

## Resume authorization — 2026-09-24

User: “i trust youyr recommendations”. This approves the three recommendations already presented: DEC-71 first authored change then 10m/1h/24h/daily after successive dismissals; DEC-72 explicit “I saved this bundle” after delivery on unobservable-save platforms; GRAPH-CONTRACT recommended typed retained references plus bounded conflict/audit pages with explicit backward-reader/version rules. Historical questions and handoffs below remain verbatim. No provider registration, account, live qualification or demo verdict is inferred. Graph direction approval is not an exact wire specification: DB/Author remains supplier before S06. Orchestrator may proceed with approved save/reminder design fill and S02/S03 implementation. Prior final report 4cf629a is the previous blocked-boundary report and will be refreshed at this continuation's close.

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| S01 | Vault keys and authenticated transport contracts | M07 M08 M09 M24 M56 M57 M59 M62 | `src/application/ports/backup.ts`, `src/application/ports/durable-home.ts`, `src/application/ports/vault-crypto.ts`, `src/crypto/**`, `src/persistence/codecs/vault.ts`, `src/sync/protocol/**`, `tests/fixtures/vaults/f05/**`, `tests/property/sync/**`, `tests/provider-contract/shared/**`, `tests/unit/codecs/vault.test.ts`, `tests/unit/crypto/**`, `tests/unit/sync/protocol/**` | done | 3/3 | 2026-09-24 | CP1 694c741, CP2 13e83f1, CP3 8674766; producer contribution accepted, composed proofs remain S02/S06 |
| S02 | Create a vault and save the first encrypted bundle through the real app | M01 M07 M08 M09 M12 M23 M24 M27 M30 M32 M33 M36 M37 M41 M42 M44 M46 M47 M51 M53 M54 M56 M60 M61 | `src/application/commands/home-commands.ts`, `src/application/ports/backup.ts`, `src/application/ports/event-repository.ts`, `src/application/ports/file-save.ts`, `src/application/ports/projection.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/recovery.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/crypto/hash.ts`, `src/domain/model/events.ts`, `src/domain/model/ids.ts`, `src/import/staging/append.ts`, `src/import/staging/roots.ts`, `src/persistence/codecs/canonical-cbor.ts`, `src/persistence/projection/**`, `src/platform/file-save.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/bundle.ts`, `src/sync/protocol/frontier.ts`, `src/sync/protocol/publication.ts`, `src/sync/providers/bundle/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/recovery-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/bundle.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/fixtures/app.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/recovery-countdown.spec.ts`, `tests/fixtures/vaults/f05/generate.ts`, `tests/fixtures/vaults/f05/publication.ts`, `tests/unit/bootstrap/file-save.test.ts`, `tests/unit/bootstrap/lifecycle.test.ts`, `tests/unit/codecs/canonical-cbor.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/commands/home-commands.test.ts`, `tests/unit/crypto/hash.test.ts`, `tests/unit/domain/events.test.ts`, `tests/unit/domain/ids.test.ts`, `tests/unit/projection/**`, `tests/unit/staging/append.test.ts`, `tests/unit/staging/roots.test.ts`, `tests/unit/sync/bundle/**`, `tests/unit/sync/protocol/fixtures.test.ts`, `tests/unit/sync/protocol/frontier.test.ts`, `tests/unit/sync/protocol/publication.test.ts`, `tests/unit/ui/architecture.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/recovery-screen.test.tsx`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/recovery.machine.test.ts`, `tests/unit/workflows/reset.machine.test.ts` | blocked | 2/6 + partial CP3 | — | CP1 03ee571, CP2 c7e6507 accepted; partial CP3 d75830d verified; DEC-72/design prevents full CP3 and CP4; no implementation residual |
| S03 | Scratch reminders and consistent backup status at every entry | M05 M32 M33 M36 M37 M42 M44 M47 M54 M56 M61 | `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/records-services.ts`, `src/application/workflows/reset.machine.ts`, `src/application/workflows/schema-services.ts`, `src/application/workflows/theme-services.ts`, `src/domain/policy/**`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data/app-session.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/protocol/client.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/append-import.spec.ts`, `tests/e2e/backup-status.spec.ts`, `tests/e2e/charts.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/fixtures/records.ts`, `tests/e2e/fixtures/structure.ts`, `tests/e2e/fixtures/workbook.ts`, `tests/e2e/gate-f02-demo.spec.ts`, `tests/e2e/gate-f04-demo.spec.ts`, `tests/e2e/records-crud.spec.ts`, `tests/e2e/relationships.spec.ts`, `tests/e2e/scratch-reminders.spec.ts`, `tests/e2e/structure.spec.ts`, `tests/e2e/theme.spec.ts`, `tests/unit/policy/**`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/chart-services.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/records-services.test.ts`, `tests/unit/workflows/reset.machine.test.ts`, `tests/unit/workflows/schema-services.test.ts`, `tests/unit/workflows/theme-services.test.ts` | blocked | — | — | Requires S02 and DEC-71 |
| S04 | Dropbox App Folder backup transport | M25 M56 M62 | `src/sync/providers/dropbox/**`, `tests/provider-contract/dropbox/**`, `tests/unit/sync/dropbox/**` | blocked | — | — | Requires S01/S02 and INPUT-DROPBOX before live premise; no configured provider claim |
| S05 | OneDrive App Folder backup transport | M26 M56 M62 | `src/sync/providers/onedrive/**`, `tests/provider-contract/onedrive/**`, `tests/unit/sync/onedrive/**` | blocked | — | — | Requires S01/S02 and INPUT-ONEDRIVE; CA-38 conditional-write qualification |
| S06 | Compact encrypted history without losing restart or restoration | M07 M09 M12 M23 M24 M33 M35 M37 M44 M56 M57 M60 M61 | `src/application/ports/backup.ts`, `src/application/ports/projection.ts`, `src/application/queries/history.ts`, `src/application/view-models/records.ts`, `src/import/staging/roots.ts`, `src/persistence/codecs/event-commit.ts`, `src/persistence/projection/**`, `src/sync/protocol/frontier.ts`, `src/sync/protocol/publication.ts`, `src/ui/records/change-history-screen.tsx`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/compaction.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `tests/browser/projection/fixtures/projection.entry.ts`, `tests/browser/projection/fixtures/projection.worker.ts`, `tests/browser/sync/bundle.spec.ts`, `tests/browser/sync/compaction.spec.ts`, `tests/browser/sync/fixtures/**`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/compaction-backup.spec.ts`, `tests/fixtures/vaults/f05/compaction/**`, `tests/fixtures/vaults/f05/generate.ts`, `tests/fixtures/vaults/f05/publication.ts`, `tests/property/codecs/event-commit.test.ts`, `tests/property/compaction/**`, `tests/unit/codecs/event-commit.test.ts`, `tests/unit/commands/fakes.ts`, `tests/unit/projection/**`, `tests/unit/queries/history.test.ts`, `tests/unit/staging/roots.test.ts`, `tests/unit/sync/protocol/fixtures.test.ts`, `tests/unit/sync/protocol/frontier.test.ts`, `tests/unit/sync/protocol/publication.test.ts`, `tests/unit/ui/records/change-history-screen.test.tsx`, `tests/unit/view-models/records.test.ts`, `tests/unit/workers/backup-graph.test.ts`, `tests/unit/workers/backup-handlers.test.ts`, `tests/unit/workers/compaction.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/projection-port.test.ts` | blocked | — | — | GRAPH-CONTRACT Author input plus S02/S03 prerequisites; S06 CP1 co-owns first nonempty writer/reader/proof, CP2 installs, CP4 closes J3/J1 |
| S07 | Connect cloud homes and confirm automatic backups without blocking local work | M07 M24 M25 M26 M29 M30 M32 M33 M36 M37 M47 M50 M51 M53 M54 M56 M60 M61 M62 M64 | `docs/provider-setup.md`, `index.html`, `package.json`, `playwright.config.ts`, `pnpm-lock.yaml`, `src/application/ports/backup.ts`, `src/application/ports/durable-home.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/config/public-config.ts`, `src/main.tsx`, `src/platform/provider-auth.ts`, `src/platform/provider-fetch.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/**`, `src/sync/protocol/**`, `src/sync/providers/dropbox/**`, `src/sync/providers/onedrive/**`, `src/sync/scheduler/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/vite-env.d.ts`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/sync/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/backup-status.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/cloud-backup.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/fixtures/no-network.ts`, `tests/e2e/fixtures/provider.ts`, `tests/e2e/gate-f05-demo.spec.ts`, `tests/provider-contract/dropbox/**`, `tests/provider-contract/onedrive/**`, `tests/provider-contract/shared/**`, `tests/security/f05/**`, `tests/unit/bootstrap/**`, `tests/unit/config/**`, `tests/unit/sync/**`, `tests/unit/toolchain.smoke.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/reset.machine.test.ts`, `vite.config.ts`, `vitest.config.ts` | blocked | — | — | Requires all predecessors; integrates actual configuration/token/worker/scheduler path |

## Wave Plan

| Wave | Sessions | Why concurrent |
|---|---|---|
| 0 | Scoped Archivist planning-completeness + Designer DF-F05-1 under Orchestrator | Review is read-only; Designer alone owns its author inputs. Clear prerequisites only for affected work. |
| 1 | S01 | Produces actual vault/transport contract required by every consumer. |
| 2 | S02 | First connected bundle journey; owns shared worker, projection and UI composition. No fan-out until J1 passes. |
| 3 | S03 | Takes S02 shared status/worker/UI paths and paired tests; must finish reminder fixture adaptations before later browser acceptance. |
| 4 | S04 / S05 / S06 (source-disjoint; resources serialize) | Dropbox directory/tests, OneDrive directory/tests, and local compaction paths/tests are literally disjoint. Their dist:build and playwright:output full-session reservations overlap, so dispatch serially under current envelopes; concurrency requires a reviewed output-isolation envelope, not just different ports. Provider sessions need their protected registration input. S06 may proceed alone if provider inputs are absent, once GRAPH-CONTRACT and S02/S03 are cleared. |
| 5 | S07 | Takes provider directories/tests and shared composition paths serially; needs both adapter contracts and compacted graph semantics. |

No other pair is declared concurrent. A session in a wave waits only for its explicit dependencies and input readiness; a blocked provider does not block S06. S06 now serially owns the backup graph port/frontier/publication contract and paired fixtures after S02/S03; S04/S05 do not write them or construct publication candidates. Provider durable-home port and S02 IO protocol remain read-only in this wave. S06 changes no provider port or adapter. Shared assertions are in the producer lease or the explicitly serialized consumer lease; no stub-retirement window is permitted.

## Dependency Graph

`S01 → S02 → S03 → S06 → S07`; `S02 → S04 → S07`; `S02 → S05 → S07`; `S01 → S04,S05`.

Serial handoffs carry tests too:
- Crypto/hash/canonical primitives: S01 → S02 CP2 bounded correction; shared backup port/frontier/publication and paired fixtures: S01 → S02 → S06 → S07. S04/S05 do not write these paths.
- Worker data/catalog/event-store, page messages, security error maps and worker tests: S02 → S03 → S06 (only explicit subset) → S07.
- Projection/port, roots codec, projection unit tests/fixtures and assignability/fakes: S02 → S06.
- Routes, durability UI, library/records VM and UI/unit/e2e fixture tests: S02 → S03 → S06 (records VM/history screen and paired tests only) → S07. Recovery machine/screen/countdown proofs belong to S02 CP5; later consumers read them.
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

Original-plan F05 gaps included absent sync/vault/home/exporter implementations. Current graph replan: S01 vault/protocol and S02 CP1 home/pin writers are committed; exporter/cursor/publication corrections accepted at S02 CP2 c7e6507 (current producers only). IO/native save and encrypted receipt writer landed in partial CP3 d75830d. General receipt/count/status readers, real-entry confirmed-save journey and compactor remain future work; provider registrations remain absent. Catalog reminder/home fields alone are not producers. `deviceOnlyChangeCount` currently returns local device absolute sequence; chainState also calls it. `inventoryOf` has names/counts but no confirmed time. `LibraryAppV1` has only scratch status. These are implementation assignments below, not checkpoint-0 investigations.

**Inspection limits:** no live provider account/registration was supplied or contacted; no native platform-save result or current visual parity was observed. F04 screenshots and real-Excel input remain unavailable review evidence. Primary provider docs were inspected, but do not establish browser CORS or race semantics on a live account. Broader F04 history is retained by reference; no claim of independently re-running its 2339/141/71 tests is made.

## Design Decisions

| ID | Choice / status | Rationale and owners |
|---|---|---|
| DEC-66 | Existing stack and repository-relative program root retained | Config is authoritative; no stack redetection or package installation. |
| DEC-67 | User authorizes F05 planning, no fabricated demo verdict | Record explicit instruction; inherited product decisions remain with their existing owners. |
| DEC-68 | Bundle first; real index.html→RPC→workers→file boundary→encrypted receipt→restart | Earliest complete capability needs no provider account and exposes missing graph/count semantics early. S02 CP4. |
| DEC-69 | Preserve local storage hash semantics; add separate canonical authored-state proof | Existing app-head hash covers references. A different remote semantic hash is not evidence that old local data is corrupt. S02 graph exporter, S06 equivalence. |
| DEC-70 | CAS divergence fails closed until F06; no scope/permission expansion | F05 push never invents reconciliation. Same-vault unaffected entries/markers preserved. S07; F06 owns actual merge/resume after divergent writers. |
| DEC-71 | **Approved by user 2026-09-24** | Proposal: immediate after first authored change; after successive dismissals no sooner than 10m, 1h, 24h, then daily while scratch. Alternative: user-specified schedule. S03 CP1–2 implementation/proof; CAP-42/CA-37 blocked. |
| DEC-72 | **Approved by user 2026-09-24** | Proposal: on a platform without observable saved completion, require explicit “I saved this bundle” after file delivery; alternative: leave backup unconfirmed there. Neither download start nor share handoff proves durable save. S02 CP3–4 and Designer copy; CAP-40/CA-37 affected fallback proof blocked. Native confirmed-save path is independently implementable. |
| DEC-73 | Internal scheduling defaults: 1500ms debounce, 128 tail commits before compaction | Reversible performance choices, injectable under test, no changes to accepted retention/security policy. S06/S07. |
| DEC-74 | No remote garbage collection or age-based baseline pruning | Narrowest reversible implementation of immutable backup; retain exact reachable roots. This does not defer compaction or history read support. S06. |
| DEC-75 | No automatic schema migration invented | Existing encrypted payload evolution follows F04 convention. If new durable constraints are required, DB re-entry receives demonstrated reader/writer mismatch and regression, before dependent dispatch. |
| DEC-76 | Opaque ports frozen before independent provider workers | S01 actual symbols replace sketches in CA at receive; shared correction belongs to serialized owner, never concurrent self-widening. |
| DEC-77 | Scope M05 by approved feature | Backup/reminder policy in F05; removal and capacity policy remain F07, account adoption/merge policy F06. “M05 complete” in roadmap does not authorize unrelated features. |

Graph sequencing decision (REPLAN-F05-GRAPH): S02 proves the complete graph current producers can emit; S06 co-owns nonempty producer/reader/gate before pointer use. This reversible checkpoint boundary preserves all required positive proofs. Protected nonempty wire choice stays unresolved in GRAPH-CONTRACT, not auto-decided here.

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

S02 owns the IO/file harness before J1; S06 owns compaction threshold control before J3; S07 owns worker-aware context HTTP routing, OAuth popup/callback and CSP checks before J4. There is no existing native application: the actual transport is browser MessagePort/RPC. External save/provider endpoints may be fixtures; encryption, mapping, commands, enforced identity, local storage and internal workers remain real.

Per-case 180s, KDF cases 300s, action timeout 20s; whole focused browser suite 15m. Use test-runner deadlines and AbortController for transfers; Orchestrator terminates the owned server/test child on overrun, captures output and releases resources in finally. Never leave an indefinite retry/sleep. New e2e files may use the existing 600s limit only for the aggregate gate journey and must identify that in evidence. Evidence root `test-results/f05/sNN/` includes build/config/fixture identities, exact assertions, traces, screenshots and captured artifact hashes. These ignored outputs are exclusive resources, not staged source paths.

### VB-03 — bounded replan inspection, 2026-09-24

REPLAN-F05-PREFLIGHT inspected the raw ARCHIVIST-F05-PLANNING result and current ledger/blockers, F04 countdown/split records, actual recovery/history sources and paired tests, frame/AAD implementation, and runner discovery. Source identities are in PLAN-CHECK. VB-01 “actual” results belong to the original planning run and were not rerun by this correction. New evidence here is plan consistency checking only; no implementation, build, browser/security journey or provider call was executed. Local security discovery does not exist at HEAD: S07 CP1 creates J6’s project/script, three specs and negative-control self-tests before relying on them. Shared dist and Playwright output remain exclusive; serialize S04/S05/S06 reservations. Protected choices/inputs and future proofs retain their prior statuses.

### VB-04 — GRAPH bounded replan evidence

Base `309313170b997d2546794c6173ebcabfbd44ac5f` plus preserved r4 working tree; checked-source identities and mechanical outcomes in PLAN-CHECK. Actual work here is read-only source comparison, plan edits and DAG/lease/checkpoint validation; no application tests/build/provider/browser probe executed. Attempt4 reports typecheck/lint/diff-check exit 0 and 22 files/178 tests passed; retain as inherited evidence for its recorded source inventory `448408d1c2bf4ea2bef560b67b99ba079c6cf166f9fde75f1f78b136e39a1def`, not current acceptance or nonempty graph proof. S02 CP2 is uncommitted; its remaining cursor/lifecycle and complete graph assertions must run before acceptance. Proposed API documentation is unaccepted.

Package scripts, Vitest node discovery and Playwright webServer implementation re-inspected. GRAPH-S02 and GRAPH-S06 in session Verification give exact selectors/owners; existing Vitest runs tests/unit + tests/property, no new runner needed. Browser proofs still require fresh build/source/config identity and exclusive dist/output under VB-02. No vendor assumption changed or new external probe prescribed. Relevant gaps retain owners: S02 cursor/lifecycle/bounded gate at CP2; DB/Author protected mapping; S06 nonempty candidate/reader/gate at CP1, installed proof CP2 and J3/J1 CP4. No old passing gate closes these gaps. Inspection is scoped to graph sources/referenced r4 and existing F05 records, not a new audit of unrelated F04 findings or external review sources.

## Capability Readiness

| ID | Approved behavior / entry point | Required facts + producer owners | CA IDs / prerequisites | Integration owner / checkpoint | Status | Proof / checked sources | Open gaps + correction owners |
|---|---|---|---|---|---|---|---|
| CAP-05 (inherited) | Local recovery displays decreasing worker-imposed retry delay and correct expiry | worker assertAttemptAllowed/refuseAttempt; S02 CP5 clock actor/VM/screen | CA-40; existing CA-05 throttling preserved | S02 CP5 | planned | F04 STATE + M36 gap; S02 Verification exact unit/e2e checks | missing ticking actor and proof → S02 CP5; required F05 work |
| CAP-39 | Create a vault, separate recovery, attach scratch app without re-encrypting data | existing local app key; S01 vault KDF/wrap; S02 home writer | CA-34/35/40; S01 ready | S02 CP4–5 | planned | J1; keys.ts/catalog.ts/migration006 | S01 crypto and S02 home/channel landed; UI/recovery/J1 proof remains S02 CP4–6 |
| CAP-40 | Save complete encrypted bundle, report true completion, reuse it after device loss | Current-producer graph S02 CP2 c7e6507 verified; native component partial CP3 d75830d landed; actual browser/OS proof planned | CA-35/36/37; DEC-72 fallback | S02 CP4/6 current graph; S06 CP4 nonempty extension | blocked | GRAPH-S02 independently 25 files/209 pass, typecheck/lint 0 at c7e6507; J1/J3 planned | DEC-72 approved; Designer/S02; GRAPH-CONTRACT Author/S06; S02 full CP3 after DEC-72/Designer; CP4/6 J1 and recovery |
| CAP-41 | Same confirmed time/count/remedy on tile/app/detail/reset | S02 receipt writer + all reader replacements; S03 UI | CA-36/40; S02 | S03 CP3/4; cloud extension S07 CP2–4 | planned | J1/J2/J4 | current absolute count/hardcoded reader → S02; surface update S03 |
| CAP-42 | Nonblocking reminder for every authored scratch change, persistent badge, escalating dismissal | createEventStore commit + encrypted ScratchReminderState + ClockPort; S03 | CA-37; DEC-71 + design-fill | S03 CP2/4 | blocked | J2; FR-25, catalog reminder type | timing approved; Designer fill then S03 producer/consumer/proof |
| CAP-43 | Dropbox/OneDrive home connection and automatic/manual confirmed backup, usable offline | auth identity/tokens/input IDs S04/05; IO composition/scheduler S07 | CA-38/39; INPUT-DROPBOX/ONEDRIVE; first J1 | S07 CP2–5 | blocked | J4/J5; official docs; no live evidence | human registrations; adapters S04/05; actual launcher/config/receipt S07 |
| CAP-44 | Periodic compaction preserves authored state, baselines, history and restoration after reopen/backup | S02 graph/state cursor; S06 writer, retained chain/audit readers | CA-35/36/41 | S06 CP4 | blocked | J3 planned; GRAPH mapping below and attempt4 evidence | GRAPH-CONTRACT DB/Author input; S06 CP1 writers/readers, CP2 chain/history install, CP4 J3/J1 |
| CAP-45 | Only selected-provider protocol/ciphertext egress; locks isolate secrets | S07 configured fetch/CSP; IO/data channels S02 | CA-38/39 | S07 CP1/5 | planned | J4/J5/J6; local security project/controls S07 CP1; no-network fixture currently observational only | real egress guard absent → S07 before first provider use |

### Inherited CAP-05 — local recovery countdown (required F05 work)

Status **planned**, integration/proof owner **S02 CP5**, CA-40; source F04 STATE inherited obligations and M36 Known gaps. Actual path: recovery UI → RecoveryRoute/recoveryMachine → SecurityServices → RPC → worker attempt limiter → error.retryAfterMs → ephemeral clock deadline → security VM → recovery screen. Worker remains the delay authority; presentation expiry never unlocks or changes durable data. A valid code still requires a new passphrase before adopting the session. Countdown is not persisted; after restart the worker response supplies current authority. Missing ticking actor and paired UI proof are assigned in SESSION-02 CP5 and its Verification (controlled clock plus real-entry recovery-countdown.spec.ts). Required completion cannot be deferred out of F05 or inferred from vault recovery tests. No new CAP identifier or competing historical backlog is created.

### Action and fact traces

- CAP-39: SCR-038 → planned assign-home command in application/commands/home-commands.ts → backup-handlers → existing openAppKey + S01 opaque wrapper → HomeState/assigned event/catalog CAS transaction → reload catalog/home in worker → labelled vault status. App/key/home/vault IDs come from CSPRNG and authenticated roots; human passphrase is transient input; created time comes from injected ClockPort, never authority. Wrong secret/home/app, cancelled issuance or stale local revision changes nothing. Vault recovery decode must succeed without local-root key, while local code must fail there.
- CAP-40: Save bundle → snapshot operation → graph exporter → SHF1 objects with actual frame versions/digests → IO bundle second-pass verification → FileSavePort → correlated completion → atomic confirmed frontier/time → restart read. Imported commit and multi-event authored commit identities come from event log, not a DTO count. File authentication proves recoverability; J1 explicitly verifies the downloaded bytes with a fresh vault-only decoder. F06 owns adoption UI, not the F05 obligation to write a complete recoverable bundle.
- CAP-41: immutable HomeState receipt is authority; app head supplies latest contiguous per-device frontier and distinct commit identity. Count = distinct locally held commits not covered by this home's confirmed frontier, including import/reconciliation commits. A configured home with no receipt has null time, never “current”. chainState always uses absolute sequence, not outstanding count. Every status action is assigned: scratch choose home; bundle save; cloud back up/reconnect/retry. Readable reset recomputes count/time and invalidates stale confirmation; locked reset gets no inventory. Read-only display mutations are N/A; reset remains existing explicit destructive flow.
- CAP-42: accepted user commit → catalog reminder state in same transaction → post-ack prompt → dismissal operational write → reopen eligibility. Rejected/no-op/draft/query/last-opened/clock recalculation have no trigger. Reminder timing is not derived from event sequence; DEC-71 supplies policy. Assignment removes reminder state but preserves future receipt truth. Badge persists through dismissal.
- CAP-43: selected account registration + OAuth state/verifier → provider-authenticated stable account → encrypted home token state → dedicated IO adapter → immutable chunks/index → exact head CAS receipt → local receipt transaction → readers. During offline edit, local acknowledgement never waits for IO; resume derives pending work from encrypted state. Snapshot E uploaded while E+1 commits leaves exactly one pending. No internal port is faked in J4. F06 owns remote divergence reconciliation; F05 must preserve prior remote head and surface interruption/divergence without claiming success.
- CAP-44: committed authenticated head/frontier → bounded checkpoint/audit export → independent replay equivalence → compare-revision pointer swap → retained-root-aware cleanup → worker restart/hydrate/history/restore → new commit → subsequent bundle. Save acknowledged before background compaction starts. Existing bytes/hashes are sources, not inferred row counts. Baselines, deletion restoration and source lineage are retention authorities; age alone never prunes them.
- CAP-45: validated public config creates exact provider policy/CSP and IO constructor; active account/home binds every request. Session lock stops IO and destroys handles; stored tokens remain encrypted. No provider configured/contacted on local launch. Browser redirects, popup source and provider-issued transfer URLs require validation before use; no arbitrary allowedOrigins bypass.

## Contract Agreements

| ID | Required meaning / authority | Producer → boundary → consumer | Mapping / constraints | Correction + proof owners / checkpoints | Agreement | Producer | Proof / evidence / checked sources |
|---|---|---|---|---|---|---|---|
| CA-34 | Independent local/vault/app protection, existing app ciphertext preserved | M08 committed vault wraps → migration006 header/index → S02 home writer/recovery UI | exact scoped KDF + independent salts; opaque existing app key wrapped; separate recovery | S01 CP1–3; S02 CP1/4/6 | agreed | S01 crypto CP1–3 694c741/13e83f1/8674766 and S02 CP1 home assignment 03ee571 landed | S01 scope/crypto proofs plus S02 worker/IndexedDB atomic home and retention proof independently checked (11 files/119 pass, tc/lint 0); page/recovery J1 S02 CP4/6 remains planned |
| CA-35 | Complete authenticated graph and distinct digests | roots + authenticated parent → exporter/publication → vault-only decoder | Current producer complete at c7e6507; nonempty extension provisional | S02 CP2/6 current graph; DB/Author GRAPH-CONTRACT; S06 CP1/2/4 nonempty graph | current-producer verified; future nonempty unresolved | S02 CP2 c7e6507 bounded readers, hash/canonical stream, worker lifecycle landed | GRAPH-S02 independently 25 files/209 tests, typecheck/lint 0; source/config/fixture hashes checked; GRAPH-S06 blocked; J1/J3 unverified |
| CA-36 | Confirmation, count and absolute sequence remain distinct | event-store + S02 HomeState receipt → protocol/VM/reset | captured frontier only; null never→zero/current; edits during backup stay pending | S02 partial CP3/CP4–5; S03 CP3; S06 CP2; S07 CP2/3 | agreed | native receipt writer and atomic pin release landed d75830d; general count/status readers planned S02 CP4/5 | native saved/failed/stale/quota/restart/concurrent-edit component assertions passed in closing 214-file/2402-pass suite; J1/J2/J3/J4 remain planned |
| CA-37 | Dismissal never blocks; bundle attempted is not saved | committed authored change / external save → encrypted operational state → approved UX | DEC-71 schedule and DEC-72 fallback approved 2026-09-24; explicit confirmation only after delivery | approved policy; S02 CP3/4; S03 CP1/2; Designer DF-F05-1 | fallback/reminder policy agreed 2026-09-24; implementation/proofs pending | native saved/cancelled/failed/unconfirmed adapter landed partial CP3 d75830d; fallback/reminder planned | native destination doubles and real MessageChannel component checks passed; no real OS save or J1; DEC-71/72 approved; dependent design and implementation pending |
| CA-38 | AppFolder account isolation and exact-byte atomic head | registered provider + S04/S05 adapter → DurableHomePort receipt → S07 | stable account/vault binding; null=create-if-absent, stale=conflict; never unconditional overwrite | human registrations; S04/S05 CP0–3; S07 CP1/2/5 | agreed | S01 CP2–3 DurableHomePort/publishCandidate landed 13e83f1/8674766; S04/S05 real provider adapters/qualification planned | Orchestrator focused protocol gates pass at 8674766, exact CAS/hash/readback on stateful double; live scope/CORS/CAS still blocked INPUT-DROPBOX/ONEDRIVE; J4/J5 S07 planned |
| CA-39 | Actual transport, lifecycle and egress preserve authority | S02 IO channel + S07 config/bootstrap/token writer → adapters/scheduler → receipt | tokens/keys separated; lock/cancel correlated; selected-provider-only network | S02 CP3; S07 CP1–5 | agreed | native IO/bootstrap/channel producer partial CP3 d75830d landed; provider config/tokens/egress S07 planned | production handlers/MessageChannel with Worker constructor doubles, cancellation/disposal and no-key component tests passed; actual browser transport and J4/J5/J6 planned; local security discovery owner S07 CP1 |
| CA-40 | Approved status/recovery/remedy meaning on every surface | S02 receipt + S03 policy → worker DTO → VM → routes/UI | scratch badge vs home configured vs confirmed vs stale; every status has remedy | S02 CP4/5 (CAP-05 countdown CP5); S03 CP3/4; S06 CP2/4 history; S07 CP4; Designer | agreed | receipt producer d75830d landed; status/recovery/reminder readers and UI planned | planned J1/J2/J3/J4 plus CAP-05 S02 CP5 proof; design-fill dependency separate |
| CA-41 | Compaction preserves identity/provenance/chain/history | S06 candidate writer + graph reader → publication/hydrate/chainState/history/restore | GRAPH-CONTRACT mapping below; original covered commit evidence, no count-derived chain | DB/Author input; S06 CP1 candidate/reader, CP2 install/readers, CP3 schedule, CP4 J3/J1 | unresolved nonempty wire/traversal; retention meaning agreed | planned | blocked GRAPH-S06; provisional against accepted Author source and S06 CP1/2, no positive nonempty proof yet |

### CA-34/35 mapping and comparison

Approved FR-24 vault key is implemented as random vault root wrapped by passphrase-derived wrapping key, per database.md and migration006; that is an intentional hierarchy, not a contradiction requiring enum/schema correction. Existing `wrapRoot` is local-scope only and cannot be reused as if already vault-scoped. New wrap functions are S01 outputs.

`StorageRefV1.storageId` is base64url text; migration006 EnvelopeReference.storageId is the decoded random 16 bytes. Local semanticSha256 verifies decoded payload; remote ciphertextSha256 hashes the exact frame ciphertext according to migration003 reference contract. Reference scope comes from the already-authenticated parent graph reference (or the fixed authenticated bootstrap context), participates in AEAD AAD, and must agree with the expected payload kind. Scope is absent from EnvelopeFrameV1. Reference logicalRevision and paddedBytes come from the authenticated frame, not the current transaction revision. Existing `head.semanticSha256` = hash(encodeAppHeadBody); never relabel this as reconstructed-state hash. S02 creates the latter from canonical authored state; source hash remains unchanged. This is a new producer seam, not a demonstrated need to rewrite historical hashes.

Complete graph mapping: checkpoint→record pages and all schema/theme/formula/chart roots; head tail→event segments; baseline/conflict/audit roots; source manifest→all original chunks; snapshot manifests→all sheet chunks; retained roots→their exact necessary descendants. Current vault-index retention roots are authoritative; historical vault-index retention lists are not recursively authoritative. Do not extend that rule to silently omit local app-head descendants; GRAPH-CONTRACT must settle their exact traversal. A parent reference without a reader for its descendants blocks publication. Deleted rows remain restorable and baseline absence is explicit. Migration006 type optional recordCount means unknown, not zero. No DB column/FK change is planned; all durable local facts remain encrypted envelopes.

### CA-36 exact accounting

Compare current `deviceOnlyChangeCount(frontier, deviceId)` with database.md AppHeadV1: it returns the absolute local sequence because F02 had no homes. That result is also used by createEventStore.chainState and must not be globally changed to outstanding count. Split absolute sequence lookup from backup-relative count; adapt app-session, open/closed record-handlers readers, listLibrary/import-handlers, reset inventoryOf, status DTOs, view models and their fixtures. All are S02 lease paths. A schema change containing K events is one distinct commit. Import/reconciliation commits count before coverage; volatile derived values/last-opened/dismissal do not. Count all local held device frontiers against the matching authenticated home frontier; reject ahead-of-local or mismatched app/home receipt. Snapshot confirmation moves only its covered frontier and timestamp together, after exact receipt; after concurrent extra commit pending count is one, not zero. Hash/account/app/vault/generation identity mismatch rejects with no mutation.

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

Existing mocks cover SCR-038/039/014 and atlas MOD-001/002/016–026, but most overlay cards are generic placeholders and omit the fields/actions required by the approved behavior. Designer DF-F05-1 fills named-vault create/recovery/re-view, saved/cancelled/failed/unconfirmed, account reconnect/disconnect and reminder surfaces without changing approved product behavior. DEC-71/72 require human resolution first for their policy/copy. MOD-022 is local code reveal; do not mislabel it as a vault code dialog. Vault code reveal needs scoped design-fill. Do not enable conditional Google Drive card. Don't copy “prior copy remains current” literally when newer local changes exist; retain confirmed time with pending count per design.md's authoritative backup language.

CA-40 inherited CAP-05 mapping: worker error.retryAfterMs (including invalid-recovery-code with a positive delay) is the only delay input. RecoveryMachine deadline/remainingMs is ephemeral presentation state; zero/absent delay enables a fresh request, positive delay disables it, stop cancels the timer, and the worker still rejects premature attempts. S02 CP5 updates RecoveryRoute clock injection, machine/VM/screen and tests together; proposed input/type changes are provisional until that checkpoint. Exact assertions and commands are in S02 Verification. CA-40 also covers S06 CP2 retained-history presentation: scope, counts and empty announcements must describe retained authored events, not a cutoff at the newest checkpoint.

### CA-41 compaction mismatch and preservation

Current chainState requires local frontier sequence equal last decoded tail commit. After removing covered tail events this fails unless retained checkpoint chain evidence is consumed. Current record-page shape also cannot alone reconstruct all history/provenance; S06 owns complete checkpoint export plus retained audit/chain readers, not simply array truncation. CP2 owns the required history/restore reconstruction before its two-compaction equivalence gate, and the records VM/history screen plus paired tests land at that same checkpoint; CP3 schedules and exercises them, CP4 proves the real UI restore. Current selectChangeHistoryVm and ChangeHistoryScreen hardcode since-last-checkpoint and their tests pin it; PC-F05-01 corrects this presentation alongside the reader, preserving empty-import and pagination meaning without inventing historical events. The approved retention meaning exists but concrete nonempty audit/retained wire mapping is unresolved: GRAPH-CONTRACT below supplies the DB/Author handoff. S06 owns accepted writer and all graph/chain/history readers together before CP2 pointer installation; no future reader is silently assumed present. F06's originalBaselineStorageId/lineage gaps are preserved as existing identities, not erased by checkpoint rewrite. Baseline present/deleted/absent remain distinct; full history and restore assertions must pass after reopen and subsequent backup.

## Seam Preflight

| Construction / injection | (a) existence and owner | (b) response fit | (c) meaning / CA | (d) production proof and owner |
|---|---|---|---|---|
| Vault crypto into home writer | local/vault crypto committed S01 CP1–3; home writer03ee571 | migration006 wrappers differ from WrappedLocalRootV1 | CA-34 independent scope/salt/app key | J1 S02 CP4/6 |
| App graph into manifest builder | bounded pin/current graph/cursor/publication c7e6507 committed; future nonempty mappings S06 | StorageRef != EnvelopeReference; use authenticated-parent scope plus frame-derived dimensions | CA-35 three hashes distinct | J1 captured artifact S02 CP6 |
| HomeState into library/app/reset | home writer03ee571 and native receipt writerd75830d committed; minimum readers CP4, reset extensions CP5 planned | DTO fields and reader maps co-leased | CA-36/40 confirmed frontier vs absolute sequence | J1 S02 CP4; reset S02 CP5; J2 S03 CP3 |
| Data↔IO and platform save | IO worker/channel/native file-save partial CP3 d75830d landed; full CP3 afterDEC72/design | dedicated byte channel, page safe IDs | CA-37/39 exact operation identity and saved outcome | J1 S02 CP4 |
| Reminder into all authored commands | event-store commit committed; trigger/dismiss missing S03 CP1 | persisted catalog state, not callback-only DTO | CA-37 one commit/many events; DEC-71 | J2 S03 CP2/4 |
| HTTP adapters into IO constructor | S04/S05 CP3 planned | S01 common port frozen; revision/ack exact bytes | CA-38 account identity/CAS | J4 S07 CP2/5 |
| Public config + token store + callback | empty PUBLIC_CONFIG, no OAuth return; S07 CP1 | build input validator→real IO constructor | CA-39 selected provider only, tokens encrypted | J4/J5 S07 CP1/2 |
| Lifecycle into scheduler | app-bootstrap visibility currently idle-only; S07 CP3 | real commit signals + typed lifecycle channel | CA-39 resume pending, manual-only bundle | J4 S07 CP3 |
| Compaction into replay/append/history | S06 writer/reader planned together at CP1; GRAPH-CONTRACT missing | approved nonempty payload → exporter/publication/chain/history | CA-35/41 mapping below; CP1 candidate proof before CP2 installation, CP2 presentation | GRAPH-S06 then J3/J1 S06 CP4 |

Required predecessor inputs are ready only after committed implementation and relevant boundary proof; the table above distinguishes committed component producers from planned composed proofs. Orchestrator rechecks actual landed constructor signatures/config fields and updates these CAs before consumer dispatch.

## Executable Proof Specifications

### J1 — first narrow journey, CAP-39/40/41, CA-34/35/36/37/40

Owner S02 CP3 harness, CP4 minimum persisted receipt/count readers plus first success, CP5 expanded reset/recovery and inherited CAP-05 countdown, CP6 complete errors/artifact recovery. Planned test `tests/e2e/bundle-backup.spec.ts`; exact invocation `SHEAF_PW_PORT=<port> pnpm test:e2e bundle-backup`, discovered by e2e/**/*.spec.ts. Use real entry and real built data+IO workers, sodium/IndexedDB/SQLite; only platform destination may be deterministic. Seed `protectDevice(page)` then `importDemoWorkbook(page)` from committed fixtures, then a real record edit. Assert exactly one additional unconfirmed commit relative to seeded import frontier, then zero after captured graph is confirmed. Create vault and distinct recovery; compare original encrypted app object bytes before/after assignment. Capture bundle bytes/hash, verify entire graph and reconstructed semantic state with production reader under vault secret only. Close page, open new page in same context, unlock, assert record value/time/count/home; edit again => exactly one pending, unchanged confirmed time. Cancelled/failed/forged save cannot advance anything. Confirm policy fallback only after DEC-72. Inspect ciphertext for known sentinel names/values; parse allowed clear fields structurally. Decoder rejects wrong scope/secret, missing/extra/truncated/reordered objects and wrong identity. Finally dispose context and workers. Native file-save verification is distinct optional platform evidence, never inferred from fixture pass.

### J2 — reminder and status action coverage, CAP-41/42, CA-36/37/40

Owner S03 CP1 producer, CP2 harness, CP4 integration. Planned `tests/e2e/scratch-reminders.spec.ts` and `tests/e2e/backup-status.spec.ts`, commands as exact filename stems under test:e2e. Real setup/import and UI mutations for record create/edit/delete, schema change, chart save/pin, theme. Each accepted authored command triggers once, not each internal event. Dismiss is nonblocking, persisted and respects DEC-71 after reopen; permanent scratch badge remains. No prompt on rejected command/draft/filter/TODAY refresh. Status+action assertions at shell tile/app frame/app home/settings/detail/readable reset; nullable time and literal zero covered. Save through J1 path updates all readers and stale reset confirmation is refused. Clock-controlled boundary tests in production worker harness supplement a real-entry UI clock test; no hours-long waits.

### J3 — compaction→restart→restore→backup, CAP-44, CA-35/36/41

Owner S06 CP1 accepted nonempty writer/descendant reader/exporter/publication gate (GRAPH-CONTRACT prerequisite), CP2 pointer/chain plus retained-history/restore readers and paired VM/screen presentation, CP3 scheduling/integration, CP4 proof. Planned `tests/browser/sync/compaction.spec.ts` and `tests/e2e/compaction-backup.spec.ts`; exact filters `pnpm test:browser sync/compaction` and `pnpm test:e2e compaction-backup`, envelope port. Seed through real import/commands, include schema conversion, delete restoration, chart/theme and baseline-absent fixture. Capture precompact canonical authored digest/frontier/history, run real composed periodic trigger (test threshold injection only), terminate worker/page and reopen. All preserved distinctions/IDs/history match; the real history UI displays retained pre-compaction entries with truthful scope/count/announcements and pagination, then restores the deletion through its UI action; next append chain is contiguous, bundle rebuilt from compacted graph authenticates with same state. Inject stale revision, quota, crash before and after swap; old graph remains usable before swap and new graph after. Unconfirmed backup pins prevent cleanup of referenced roots. GRAPH-S06 in SESSION-06 supplies positive nonempty conflict/audit/retained fixtures, descendant omission/substitution checks and post-compaction publication proof. S06 CP4 reruns J1 with leased bundle browser/e2e assertions before S07. Resource locks and isolation per VB-02; no external provider required.

### J4 — actual provider connection and scheduler, CAP-43/45, CA-38/39

Owner S07 CP1 harness/config/constructors, CP2 manual journey, CP3 scheduling, CP5 acceptance. Planned `tests/e2e/cloud-backup.spec.ts`, exact `SHEAF_PW_PORT=<port> pnpm test:e2e cloud-backup`. Built public fixture client IDs/redirects activate actual Dropbox/OneDrive adapters and their real PKCE/URL/CAS mapping; context-wide HTTP fixtures replace only provider servers. Popup callback/state/account handlers are real. Setup/import/edit → home picker→auth→vault→manual backup→exact receipt→UI zero. Offline edit and restart remain usable and pending; resume publishes automatically; visibility attempt failure preserves time. Confirm exact one-event-during-upload remainder, no receipt on token/quota/CAS failure, wrong account/replayed callback rejected, lock cancels stale completion. The fixture's stateful conditional-write negative control must fail a deliberately unconditional adapter write. Finally close popup/context/workers/server; no provider secrets in logs/URLs/storage outside encrypted envelopes. J4 passing is local implementation proof, not live vendor qualification.

### J5 — live external qualification and gate, CAP-43/45

S04/S05 CP0 probes + CP3 recordings, S07 CP5 live integration. Planned live files `tests/provider-contract/dropbox/dropbox.live.spec.ts` and `tests/provider-contract/onedrive/onedrive.live.spec.ts`, initially discovered by each owning provider-local playwright.config.ts and exact --config command in S04/S05 Verification; S07 later registers them in provider project and test:providers. CP0 probe harness construction belongs to the same provider lease and precedes its protocol implementation; it does not depend on S07. Use two authorized accounts and two sessions of one account, dedicated opaque namespace, actual configured SPA origin; verify discovery/isolation, narrow scopes, CORS, conditional create/replace races and final bytes. Inputs missing => blocked live result, not skip-as-pass. Gate test `tests/e2e/gate-f05-demo.spec.ts` drives roadmap flow at 320px, captures/view-checks screens and uses current built revision/config. Orchestrator records GATE-F05 and writes committed final report with explicit residual proof debt.

### J6 — credential-free local security gate, CAP-45 / CA-39

Owner S07 CP1 harness/config/guard and three discovered specs; CP3 lifecycle extensions; CP5 rerun. SESSION-07 Verification specifies exact commands, isolated builds/context, actual workers/CSP/fetch boundary, seeds, teardown, evidence and negative controls. Planned root project security-f05 discovers tests/security/f05/{network,csp,secret-lifetime}.spec.ts; package script test:security:f05 invokes that project. Discovery must list all three specs and execute nonzero unskipped assertions without live opt-in. Real forbidden-origin rejection and lock/cancel secret cleanup are tested; deliberately forbidden events and leaked sentinel controls must be caught by the same assertions. No internal implementation under test is replaced by a double. This local gate remains required even when provider accounts are unavailable; live qualification is separate J5.

## Current Blockers

| ID | Affected CAP/CA/session | Required next action / owner | Evidence to clear |
|---|---|---|---|
| PLAN-REVIEW | scoped preflight cleared 2026-09-24 | Archivist AO787 received; REPLAN-F05-PREFLIGHT P7OBZ committed 5e38ca7; Orchestrator checked all twelve committed paths, corrected scope/AAD mapping, producer-before-proof ordering, added history/recovery leases and local security discovery route | All five planning findings assigned in corrected plan; S01 eligible. This is planning coverage, not implementation proof; DEC-71/72/design/provider gates remain |
| GRAPH-CONTRACT | CAP-40 nonempty extension, CAP-44 / CA-35/41 / S06 CP1–4, S07 compacted graph | User approved recommended typed retained-reference and bounded conflict/audit direction on 2026-09-24; DB/Author still supplies exact protected mapping, S06 implements | Accepted authenticated local retained scope/kind + conflict/audit wire/descendant + covered-chain mapping; Orchestrator amends CA then S06 proves before installation. Does not block GRAPH-S02 current graph |
| GRAPH-S02 | CAP-40 / CA-35 / S02 CP2 | cleared at c7e6507; Orchestrator independently verified 26 leased paths, source/config/fixture hashes, exact gate | 25 files/209 tests, typecheck/lint exit 0; bounded pin/export, all current branches, provenance/covered chain and lifecycle assertions; J1 remains future |
| DEC-71 | CAP-42 / CA-37 / S03 CP1–2 | Approved: first authored change, then after successive dismissals 10m, 1h, 24h, then daily while scratch; S03 implements and proves | answer recorded and all copied checkpoint/CAs amended |
| DEC-72 | CAP-40 / CA-37 / S02 save fallback | Approved: require explicit “I saved this bundle” after delivery when saved completion is unobservable; Designer supplies copy, S02 implements and proves | answer + scoped mock details; native confirmed-save work independent |
| DF-F05-1 | CAP-39–43 / CA-40 / S02–S03–S07 UI checkpoints | Fixed vault/security portion accepted58bffc8; Orchestrator/Designer retains only save outcomes, reminders and provider authorization/reconnect/disconnect after relevant decisions/inputs | new missing detail only; accepted fixed mock is not reopened; no flow/product change |
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

## Graph correction — REPLAN-F05-GRAPH (2026-09-24)

### Source-backed comparison and complete input map (CA-35/41)

Checked committed base `3093131`, accepted CP1 `03ee571`, and separately the preserved r4 working files. `exportBackupGraph`, `ProjectionAuthoredStatePort`, bounded publication/hash/canonical APIs are now committed at c7e6507; initial comparison below records the r4 inspection basis. `PLAN-CHECK.md` records source hashes. Relevant authoritative text: database.md Envelope plaintext/AAD, AppHeadV1, Checkpoint/page boundaries, Replay guards, Baselines/Conflicts/Audit, Retention floor, VaultIndexV1 and AppManifestV1; architecture.md Persistence and Compaction; migrations 003/004/006. No same-named-field test establishes semantic disagreement.

| Input / axis (a) producer | Axis (b/c) mapping and authority | Axis (d) correction/proof owner |
|---|---|---|
| Authenticated HomeState pin + catalog app wrap: home-state.ts/backup-handlers.ts, CP1 committed | operation/app/home/head identity fixed by worker; open app key via catalog. Pinned head has fixed app.head / app.head. Remote manifest retainedRoots can contain this known head via migration006 EnvelopeReference; this does NOT type local arbitrary retainedRoots | S02 CP2 preserve pinned source head and all its covered evidence; wrong app/session/pin rejects; lifecycle to handlers.lock/dispose and reset owned S02 |
| AppHead checkpoint + CheckpointManifest recordPages: roots.ts, promotion.ts committed | authenticated parent role fixes app.checkpoint / app.checkpoint-manifest then app.records / app.record-page; semantic digest/count/ranges validated, schema/theme/formulas/charts kept | S02 CP2 current full closure and cursor; S06 CP1 accepted candidate shape and reader, CP2 installed replay |
| AppHead eventSegments / EventSegmentV1: promotion/append/event-store committed | app.events / app.event-segment; committed import segment is still in local head despite checkpoint coverage. Remote tail is strictly after checkpoint. Covered original segments stay reachable via retained pinned head; original commit app/device/id/hash/sequence/previous hash/hybrid time supply chain evidence | S02 CP2 authenticate full covered chain before checkpointChains; S06 CP1/2 reconstruct covered chain from accepted retained/audit evidence, verify next append after two compactions |
| AppHead baselinePages: promotion + roots.decodeBaselinePage committed | app.baselines / app.baseline-page. Preserve scope/lineage identity and explicit present/deleted/absent; missing page is corruption, not absent. Projection is not authority to synthesize missing baseline | S02 CP2 baseline digest+closure regression; S06 CP1/2 preservation/restore; no baseline policy change |
| sourceManifests and snapshotManifests: source-chunks.ts, delimited-snapshot.ts, sheet-snapshot.ts, promotion/append committed | app.source-manifest and app.snapshot-manifest each same-named kind; authenticated chunks use app.source-chunk / app.snapshot-chunk, same-named kinds. Parent chunk hash/ordinal/length plus source/sheet identity remains authority. Support existing delimited and sheet snapshot forms | S02 CP2 all descendants, omit/tamper/chunk order and pinned-append regressions; S06 CP1/2 preserves lineage, original source and sheet versions |
| Local AppHead retainedRoots: StorageRefV1 + encodeRef/decodeRef committed; only empty producers found | storageId + plaintext semanticSha256 has neither scope nor kind. Named branch role is unavailable for arbitrary old app objects; database.md specifies reasons, not one universal target kind. Frame omits scope. Migration006 remote refs already carry scope, so no remote-field defect demonstrated. A duplicate of a typed current ref could be resolved from that authenticated edge, but that does not resolve a unique old root or its descendants | S02 CP2 reject unsupported nonempty list atomically; DB/Author GRAPH-CONTRACT maps it; S06 CP1 first writer + decoder/exporter, CP2 install, CP4 backup proof |
| conflictPages/auditPages roots: names + scope/kind enums committed, nonempty codecs/writers absent | root roles DO fix app.conflicts / app.conflict-page and app.audit / app.audit-page. database.md specifies immutable source versions, status/resolution proof, merge evidence and history/restoration meaning, not exact canonical page keys or whether children are embedded/referenced. Migration004 EventCommit is NOT an AuditPage wire definition; do not cast one to the other | DB/Author specifies nonempty layout/descendants while preserving meaning; S06 CP1 codec, candidate fixture/writer, descendant reader and publication gate co-owned; CP2 history/restore and chain consumers, CP4 J3. No new F06 conflict action promised |
| ProjectionAuthoredStatePort + authoredState + publication hash stream: r4 working proposal | fresh pinned projection and explicit baselines produce canonical authored bytes; no SQLite serialization/computed results; field/value provenance and deletion restoration remain required. Head body digest, local payload digest and remote reconstructed-state digest are different | S02 CP2 cursor both-direction/behavior tests, bounded hash/CBOR self-tests, omission/tamper/race; S06 CP1/2 nonempty preservation; current producer/proof accepted c7e6507, independent GRAPH-S02 209 pass; future nonempty proof S06 planned |
| Publication verifyGraph/frontier: r4 proposal; existing references authenticator committed | exporter owns payload-specific descendants; publication cannot discover omitted children from caller metadata alone. Root frame auth plus supplied-edge walk alone is insufficient. Full graph closure is proven at producer boundary, followed by reread-byte verification | S02 CP2 real exporter→publication gate; S06 CP1 extends that exact reader/gate with first nonempty writer. Backup port/frontier/publication/fixtures and J1 assertions serially leased to S06 |

No SQL CHECK/FK correction is demonstrated by the scope gap; no migration change is authorized. Nonempty conflict projections must preserve existing pending/resolution constraints, not add a state merely to match a DTO. Original per-device chain proof is distinct from a checkpoint frontier, latest row commit, outstanding count, or an unauthenticated supplied hash. Current-index historical-retention authority from database.md applies to vault indexes; arbitrary local-head traversal still needs an accepted mapping and cannot be pruned by analogy.

### GRAPH-CONTRACT — concrete Author handoff, not a Coder investigation

Observed mismatch: complete backup/compaction must preserve every required old object and history/restoration source; unique local retained refs cannot supply expected AAD/kind, and no accepted nonempty conflict/audit codec enumerates descendants. Safe source trace: roots.ts decodeRef accepts exactly two keys; migration003 frame has no scope; promotion initializes all three lists empty; append/event-store preserve those lists; r4 exporter rejects them. Thus current success is possible without those producers, but positive future nonempty proof cannot be claimed. Attempt4's valid mapping gap is retained; its implication that S02 must itself build future S06 producers is corrected by the co-owned boundary below.

**Recommendation for human decision:** authorize DB/Author to complete the local authenticated graph contract, preserving all retention/history meaning, using a backward-readable typed retained-reference payload variant (storage identity/plaintext digest plus authenticated scope and expected kind) for previously untyped unique roots, and concrete bounded conflict/audit pages with explicit child-reference rules and original commit/restoration evidence. This is a proposal, NOT an approved field list/version or permission for Coder to write protected inputs. DB must specify exact canonical layout, version/reader gate, sorting/page limits, embedded-vs-referenced evidence, scope/kind allowlist, app ownership, local historical traversal and unknown/malformed behavior. Preserve legacy empty-list/known typed-root readability; never guess unique legacy-root AAD or silently coerce a legacy ref. Existing migration006 remote scoped refs and migration004 original commits should be reused without changing their semantics.

Alternative: DB establishes a fixed target role for each retained entry from an existing authoritative invariant (for example an explicitly approved head-only retention wrapper whose descendants cover every required object), with compatibility proof that existing/future valid inputs are not lost. No inspected source currently establishes that invariant, so Planner has not chosen it. Simply trying decrypt scopes or omitting unsupported branches is not an option. Exact human choice: authorize the recommended scoped DB contract completion, or require the fixed-role alternative with its demonstrated coverage. DB, not Planner/Coder, determines whether protected format/version artifacts need amendment. No change to retention floor, user actions, provider, cadence, save policy or deletion semantics is requested.

Compatibility consequences: old readers with exactKeys cannot automatically accept an extended local shape; DB must define explicit supported-shape/version rejection and old-reader gating before a writer emits it. New readers must retain old empty fixtures; ambiguous legacy nonempty roots remain rejected and bytes preserved unless Author supplies a proven migration. No existing remote wire-field addition is justified. Database/Author owns protected docs/migrations if required; S06 owns all non-protected implementation paths and tests already enumerated in its lease. After accepted source arrives, Orchestrator amends CA-35/41 and SESSION-06 before dispatch; if that source requires additional mechanical paths, Controlled Lease Revision precedes implementation. S06 CP1 proves candidate closure with writer+reader; Coder rechecks that committed mapping before CP2 and reports it in Handoff, without waiting for Orchestrator or editing shared STATE. Orchestrator updates canonical agreement text on receive before downstream dispatch. CP2 alone installs after replay/chain/history equivalence; CP4 proves J3 and reruns J1. S07 and F05 completion remain blocked on that evidence. S02's complete supported graph proof and independent work do not await this human input.

### Inherited disposition and resumption

- r2 pinned-head deletion/append seam: accepted CP1 `03ee571` preserved. No reopen of its commit; pin release must still respect all accepted retained roots after S06.
- r3 whole-graph accumulation and r4 hash/CBOR seam: S02 CP2 remains correction owner; current proposed bounded implementation is preserved, not accepted by this plan.
- attempt4 retained/audit/conflict gap: S02 CP2 compatibility guard + S06 CP1 writer/reader/publication proof after GRAPH-CONTRACT; S06 CP2/4 complete integration. No ownerless future debt and no unsafe success stub.
- attempt4 remaining cursor-port coverage, lifecycle/cancellation and current complete-graph proof: assigned S02 CP2 in GRAPH-S02 with exact existing paths. `backup.exportGraph` currently returns a dispose callback, while handlers.lock/dispose clear records/imports/session but do not own exported handles; production closure and stale-read rejection remain required.
- Raw attempt4 and unaccepted arch remain read-only in `.program/results/`; recovery patch preserved. Older ledger text saying no uncommitted work/sole active r4 is stale against actual working tree and ended CaVon. Orchestrator refreshes ledger from this canonical state; Planner does not edit it. Existing raw STATE handoffs below remain byte-for-byte.
- Resume S02 after Orchestrator accepts bounded planning recheck and issues corrected exact lease/envelope: validate and finish the preserved CP2, commit only on GRAPH-S02 success. Do not require S06's future writer before this producer. No worker spawned by Planner. DEC-71/72/design/provider inputs unchanged; J1 remains S02 CP4/6 before fan-out.

## Granularity Note

Graph correction retains seven sessions/28 checkpoints. Repeated CP2 seams were a decomposition defect: first nonempty production and the backup reader/gate were assigned across time without a complete mapping. S06 now co-owns those connections at CP1 before its CP2 pointer swap, with positive nonempty proof before any consumer sees the format. S02 keeps the coherent current-producer graph/cursor/lifecycle working set. No verification-only or bookkeeping session added.

Seven sessions because there are three genuine artifact boundaries: shared vault/transport crypto before bundle; the first working bundle graph/IO column before fan-out; and ready vendor adapters plus compaction-compatible readers before cloud composition. S02 keeps all overlapping first-journey files in one six-checkpoint conversation. S06 is split for the independent checkpoint/history/replay working set, not because it lives in another layer. Vendor adapters have disjoint source/test leases and frozen shared inputs. No verification-only, bookkeeping-only or conflict-avoidance foundations session exists. The first complete path is J1, S02 CP4/6; S03 owns reminders/status, S06 compaction, S07 cloud/lifecycle/egress integration. Planned tests remain planned.


### Current CP2 receive — 2026-09-24

CAZU0/h-mQLm ended by end_turn. Raw attempt5 saved; 26 checkpoint paths verified within r5, no implementation residual. Root independently ran exact GRAPH-S02 (25 files/209 tests), typecheck and lint, all exit 0, and checked source/config/fixture hashes. Architecture delta consumed in 5a977e6. The earlier r4 proposed APIs, callback-only lifecycle gap, cursor gap and eager pin/hash/CBOR shortfalls above are closed by c7e6507; historical planning descriptions are retained as evidence, not current blockers. Provenance regression fixed in the same checkpoint. S02 is not done: CP3 native-save work remains independently implementable; DEC-72/design blocks fallback and CP4. Continue same worker context with unchanged lease, fresh r6 envelope. No nonempty graph/J1/native-save proof claimed.


### Partial CP3 receive and quiet boundary — 2026-09-24

CfLns/h-1hdD ended by end_turn. Raw attempt6 saved verbatim. Commit d75830df961fc9713b12539312594b4f16d78693 has exactly 21 leased paths matching tested inventory; recorded source/config/fixture/build hashes verified before doc updates. Root independently ran `pnpm verify` at d75830d: typecheck 0, lint 0, all 214 test files / 2402 passed / 3 inherited skipped, build 0. This includes native branch and GRAPH-S02 tests. Build retains large-chunk warning. Native destination and Worker constructors are doubles, IndexedDB is isolated fake-indexeddb; no actual browser/OS/J1 proof. Partial CP3 architecture consumed in 385e794. No uncommitted implementation or pending arch delta remains. Slot/port/build resources released. CA-36/37/39 native contributions updated, not promoted to complete capability readiness.

All remaining branches depend on unanswered DEC-72/design, DEC-71, GRAPH-CONTRACT, provider inputs or their predecessors. Native independent work completed to the actual protected boundary; no mechanical lease blocker remains. No recovery attempt ceiling was used to stop safe work. DEC-72 human → Designer → S02 full CP3/CP4; DEC-71 human → Designer/S03; GRAPH-CONTRACT human/DB Author → S06; registrations human → S04/S05/S07. CAP-05 countdown remains S02 CP5, not retired. GATE-F05 demo not ready. Final report records incomplete/blocked result and final Archivist only; no F06 dispatch authorized.

Pre-existing PROGRAM-CONFIG.md, ROADMAP.md modifications and remaining untracked arch seeds are preserved. A globally clean `git status` cannot be claimed without including unrelated work; only orchestration/implementation residual is clear. Archive records and checkpoint commits remain the durable evidence.

### Final Archivist receive — 2026-09-24

AIs8k/h-dRdf ended; one final pass, no content retry. Documentation commit5959ca4184e315ccc0d9903dbd005633e859e284:25 allowed arch/log/cleanup paths independently checked; protected PROGRAM-CONFIG/ROADMAP hashes unchanged. Reconciled bounded graph APIs, native producer versus unfinished readers/J1, M56/M57 placement and source-derived module registry. Complete prerequisite tracing convention promoted in arch/PROGRAM-CONVENTIONS.md; pre-existing external config stayed untouched. Full return preserved verbatim in FINAL-REPORT.md. Archivist's two stale present-tense summaries and DF-F05-1 scope are corrected above; historical handoffs unchanged. No new implementation counterexample or proof invalidation found. CL03/05 export classification remains Planner-owned optional cleanup, not removal authorization; AR-1 transcript grammar validation remains Orchestrator/Archivist debt until its source is available. All required F05 capability blockers and named proof owners remain unchanged.

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
