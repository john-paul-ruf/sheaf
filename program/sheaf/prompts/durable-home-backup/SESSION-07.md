# SESSION-07 — Connect cloud homes and confirm automatic backups without blocking local work

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M07 M24 M25 M26 M29 M30 M32 M33 M36 M37 M47 M50 M51 M53 M54 M56 M60 M61 M62 M64
> **Depends on:** SESSION-03, SESSION-04, SESSION-05, SESSION-06
> **Concurrent with:** —
> **Owns:** `docs/provider-setup.md`, `index.html`, `package.json`, `playwright.config.ts`, `pnpm-lock.yaml`, `src/application/ports/backup.ts`, `src/application/ports/durable-home.ts`, `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/reset.machine.ts`, `src/bootstrap/app-bootstrap.ts`, `src/bootstrap/io-worker.ts`, `src/config/public-config.ts`, `src/main.tsx`, `src/platform/provider-auth.ts`, `src/platform/provider-fetch.ts`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/sync/coordinator/**`, `src/sync/protocol/**`, `src/sync/providers/dropbox/**`, `src/sync/providers/onedrive/**`, `src/sync/scheduler/**`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/vite-env.d.ts`, `src/workers/data.worker.ts`, `src/workers/data/app-session.ts`, `src/workers/data/backup-graph.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/io.worker.ts`, `src/workers/io/**`, `src/workers/protocol/client.ts`, `src/workers/protocol/io-channel.ts`, `src/workers/protocol/io-client.ts`, `src/workers/protocol/io-messages.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/sync/**`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/backup-status.spec.ts`, `tests/e2e/bundle-backup.spec.ts`, `tests/e2e/cloud-backup.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/fixtures/no-network.ts`, `tests/e2e/fixtures/provider.ts`, `tests/e2e/gate-f05-demo.spec.ts`, `tests/provider-contract/dropbox/**`, `tests/provider-contract/onedrive/**`, `tests/provider-contract/shared/**`, `tests/security/f05/**`, `tests/unit/bootstrap/**`, `tests/unit/config/**`, `tests/unit/sync/**`, `tests/unit/toolchain.smoke.test.ts`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/backup*.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/home-state.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/io*.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/reset.machine.test.ts`, `vite.config.ts`, `vitest.config.ts`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`
> **Resources:** dist:build, playwright:output, provider:dropbox:test-account (live), provider:onedrive:test-account (live)
> **Checkpoints:** 5

## Module Context

| ID | Module | Read | Why |
|---|---|---|---|
| M07 | Application ports | `program/sheaf/arch/M07-ports.md` | Contract, producer and boundary tests in this lease |
| M24 | Sync protocol | `program/sheaf/arch/M24-sync-protocol.md` | Contract, producer and boundary tests in this lease |
| M25 | Dropbox adapter | `program/sheaf/arch/M25-dropbox.md` | Contract, producer and boundary tests in this lease |
| M26 | OneDrive adapter | `program/sheaf/arch/M26-onedrive.md` | Contract, producer and boundary tests in this lease |
| M29 | Sync scheduler | `program/sheaf/arch/M29-sync-scheduler.md` | Contract, producer and boundary tests in this lease |
| M30 | Sync coordinator | `program/sheaf/arch/M30-sync-coordinator.md` | Contract, producer and boundary tests in this lease |
| M32 | Worker protocol | `program/sheaf/arch/M32-worker-protocol.md` | Contract, producer and boundary tests in this lease |
| M33 | Worker entries | `program/sheaf/arch/M33-workers.md` | Contract, producer and boundary tests in this lease |
| M36 | Workflows | `program/sheaf/arch/M36-workflows.md` | Contract, producer and boundary tests in this lease |
| M37 | View models | `program/sheaf/arch/M37-view-models.md` | Contract, producer and boundary tests in this lease |
| M47 | UI durability | `program/sheaf/arch/M47-ui-durability.md` | Contract, producer and boundary tests in this lease |
| M50 | Config | `program/sheaf/arch/M50-config.md` | Contract, producer and boundary tests in this lease |
| M51 | Platform | `program/sheaf/arch/M51-platform.md` | Contract, producer and boundary tests in this lease |
| M53 | Bootstrap | `program/sheaf/arch/M53-bootstrap.md` | Contract, producer and boundary tests in this lease |
| M54 | Routes | `program/sheaf/arch/M54-routes.md` | Contract, producer and boundary tests in this lease |
| M56 | Unit tests | `tests/unit/` | Contract, producer and boundary tests in this lease |
| M60 | Browser tests | `tests/browser/` | Contract, producer and boundary tests in this lease |
| M61 | E2E tests | `program/sheaf/arch/M61-e2e-tests.md` | Contract, producer and boundary tests in this lease |
| M62 | Provider contract | `program/sheaf/arch/M62-provider-contract.md` | Contract, producer and boundary tests in this lease |
| M64 | Security tests | `program/sheaf/arch/M64-security-tests.md` | Contract, producer and boundary tests in this lease |

## Context

Adapters alone cannot publish an app. This session owns their actual IO construction, encrypted token/config inputs, OAuth return path, scheduler notifications, exact receipt transaction and all status consumers. S04/S05 provide vendor artifacts and S06 establishes compaction-compatible graph/chain readers. Shared paths are handed over serially with paired tests.

Plan HEAD `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

CAP-43 complete cloud journey; CAP-41/45 integration; F05 gate. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-34 through CA-41 as applicable; especially CA-38/39. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `docs/provider-setup.md` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `index.html` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `package.json` | Modify/extend | CP1: register test:security:f05 and opt-in provider script |
| `playwright.config.ts` | Modify/extend | CP1: discover security-f05 specs and provider project; preserve fresh build/preview isolation |
| `pnpm-lock.yaml` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `src/application/ports/backup.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/ports/durable-home.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/view-models/durability.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/view-models/library.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/records.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/security.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/durability-services.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/workflows/durability.machine.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/workflows/import.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/reset.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/bootstrap/app-bootstrap.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/bootstrap/io-worker.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/config/public-config.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/main.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/platform/provider-auth.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/platform/provider-fetch.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/app-area-hooks.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/app-runtime.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/durability-routes.tsx` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/guards.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/route-table.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/schema-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/theme-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/sync/coordinator/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/protocol/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/providers/dropbox/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/providers/onedrive/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/scheduler/**` | Create (planned) | Production contract, composition or behavior assigned below |
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
| `src/vite-env.d.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data.worker.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/app-session.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/backup-graph.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/backup-handlers.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/catalog.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/event-store.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/home-state.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/data/import-handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/record-event-payloads.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/record-handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/io.worker.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/io/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/client.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-channel.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-client.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/io-messages.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/workers/protocol/messages.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/redact.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `tests/browser/sync/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/worker/app.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/worker/usage-journey.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/backup-status.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/bundle-backup.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/cloud-backup.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/durability.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/no-network.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/provider.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/gate-f05-demo.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/provider-contract/dropbox/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/provider-contract/onedrive/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/provider-contract/shared/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/security/f05/**` | Create (planned) | CP1: network.spec.ts, csp.spec.ts, secret-lifetime.spec.ts and probe-assertions.ts with negative controls; CP3/5 extend/rerun |
| `tests/unit/bootstrap/**` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/config/**` | Modify/extend | CP1: f05-security.test.ts guard/probe negative controls and existing config checks |
| `tests/unit/sync/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/toolchain.smoke.test.ts` | Modify/extend | CP1: local security script/project/discovery self-tests and controls |
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
| `tests/unit/view-models/security.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/backup*.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/catalog.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/chart-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/data-worker.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/event-store.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/home-state.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/import-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/io*.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
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
| `vite.config.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `vitest.config.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — Public registration, network boundary and real provider composition

Consume supplied public client IDs, exact SPA redirects and approved app-folder scopes through validated build config; never add a client secret. Wire io-worker constructor to S04/S05 adapters, encrypted token-state persistence through dedicated channel, and same-origin OAuth return routing in bootstrap/routes. State/verifier/nonce belong to encrypted workflow or worker memory, not URL/sessionStorage; clear authorization response from URL promptly. Use popup/same-origin callback with strict origin/source/state checks while opener data worker remains unlocked; fallback redirect resumes from encrypted workflow after unlock. Compile CSP connect-src and a restrictive fetch guard from the same validated provider policy. Validate provider-issued upload/download URLs and redirects; never forward bearer token to another origin. Add config/guard/runner self-tests and provider project test registration.

PC-F05-05 local security discovery is an explicit CP1 output. In playwright.config.ts add project `security-f05`, testMatch `security/f05/**/*.spec.ts`, with the same Desktop Chrome and fresh build-before-preview mechanism. In package.json add `test:security:f05` = `playwright test --project=security-f05`. Keep the existing default scripts' scopes unchanged; this local gate runs explicitly at CP1 and CP5 without SHEAF_LIVE_PROVIDER_TESTS or credentials. Planned files under the already leased tests/security/f05/**: network.spec.ts, csp.spec.ts, secret-lifetime.spec.ts and probe-assertions.ts. Each spec executes its named protection through the actual built app/worker boundary. Add runner registration/script/discovery assertions and behavioral negative controls to tests/unit/toolchain.smoke.test.ts and tests/unit/config/f05-security.test.ts (both already leased). Do not count a source-string match as behavioral security proof.

Use a public fixture configuration and context-wide interception only for external provider HTTP. network.spec.ts proves unconfigured local launch makes no external request and production fetch policy rejects a forbidden transfer/redirect origin before credentials leave; the observer itself must detect an intentionally attempted forbidden request in an isolated negative-control page. csp.spec.ts checks effective served CSP in page and worker, observes securitypolicyviolation for forbidden connect attempts, and proves a same-origin request succeeds so a dead transport cannot pass. secret-lifetime.spec.ts drives real lock/cancel teardown, late IO result rejection, and absence of sentinel token/passphrase from URL, localStorage/sessionStorage, page DTOs and logs; opaque key-handle destruction is proved by the real crypto/worker unit tests rather than a claim of inspecting browser heap bytes. Negative controls feed a deliberately leaked sentinel and a forbidden-origin event to the same assertions and require rejection; the observer/control suite must fail if either rejection is disabled. No production bypass switch, real outbound forbidden request or live credential is needed. CP1 constructs the harness and proves these boundaries using the lifecycle available through S02; CP3 extends scheduler lock races and CP5 reruns the local gate.


**Commit when:** typecheck/lint and tests/unit/config, tests/unit/bootstrap, tests/unit/sync plus toolchain self-tests pass. `pnpm exec playwright test --project=security-f05 --list` lists all three named security specs with nonzero tests; `SHEAF_PW_PORT=<port> pnpm test:security:f05 --global-timeout 900000` and the tooling/config negative controls pass. Zero tests, skipped local assertions or missing controls fail CP1. Unconfigured provider remains clearly unavailable, no egress on local launch; configured constructor instantiates the real adapter. CA-38 live premise must be ready before enabling that provider.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Manual cloud publication column with crash-safe receipts

Choose provider through SCR-038/MOD-016 → OAuth → authenticated stable account → create/unlock named vault → publish authenticated graph → conditional exact-byte head acknowledgement → commit HomeState/catalog receipt → refresh shell/app status. Preserve other apps and current deletion markers in shared vault. Receipt transaction failure triggers read-back of exact candidate head on resume rather than invented local success. Recompute count against latest local frontier so edits during upload remain device-only. Retry safe immutable uploads; on moved remote state preserve local work and return divergence-required pending F06 instead of overwrite.

**Commit when:** J4 manual provider journey passes for each real adapter against HTTP fixture only at external endpoints, with exact confirmed time/count; forged receipt, wrong account/app/vault, stale generation and concurrent edit assertions pass with no unauthorized change.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — Debounce, visibility and resume through production lifecycle

Implement scheduler over committed-change notifications, manual action, document visibility and unlocked resume. Default internal debounce 1500ms; bounded hidden attempt, cancellation and backoff; do not depend on unload or background wakeup. Bundle homes are manual-only. Serialize publications per home/account while local data-worker commands stay responsive; lock terminates IO and invalidates late messages. On resume re-read encrypted pending work and retry; clock never authorizes a frontier. Connect createEventStore commit notifications and bootstrap visibility hooks, not a test-only service call.

**Commit when:** J4 proves offline edit→acknowledged local data→page close/reopen→online retry→confirmation, with timestamps unchanged on queue/start/failure. Test quota, expired token, disconnect, two tabs and lock races; no network call in data worker or UI.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 4 — Home management, named recovery and failure remedies

Complete SCR-014 durable homes, SCR-039 detail, SHT-015 and MOD-017/018/019/023/026 as designed. Second-home secret is prompted once then locally wrapped; reveal each scope-labelled recovery code while unlocked. Reconnect verifies stored stable account before resuming, and disconnect follows approved consequence flow without deleting remote data or silently converting durable apps to scratch. Adoption/discovery UI beyond home connection remains F06; no fake listed app or merge success. Update reset/home counts/status consumers and accessible failure announcements.

**Commit when:** Provider UI/recovery tests pass, first-vault/second-vault secrets remain separate, reconnect wrong account changes nothing, disconnect interrupts correctly and no remote deletion occurs. Required design sources must exist; source gaps route to Designer rather than improvised semantics.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 5 — Interrupted-backup resilience and GATE-F05 deliverable

Close failure/race findings in coordinator and scheduler and implement tests/e2e/gate-f05-demo.spec.ts for roadmap flow. Qualify both provider account-isolation/discovery contracts with opted-in test accounts; name any unrun live proof as blocked rather than done. Re-run J1/J2/J3 after final composition. Capture 320px light/dark screens, inspect images and run axe/clipping/target checks. Produce demo recipe and built artifact identity in handoff; Orchestrator writes final report and GATE-F05 blocker.

**Commit when:** pnpm typecheck, pnpm lint, pnpm test, full pnpm test:browser, pnpm test:e2e and pnpm test:security:f05 pass under locks; required CA proofs current; live unavailability is explicitly incomplete CAP-43, never a full F05 success. Coder commits its own exact lease at this checkpoint.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

## Verification

Local security proof J6 / CAP-45 / CA-39: S07 CP1 owns discovery, harness, guard and assertions; CP3 extends lifecycle races, CP5 reruns. Exact commands: `pnpm test tests/unit/toolchain.smoke.test.ts tests/unit/config/f05-security.test.ts`; `pnpm exec playwright test --project=security-f05 --list`; `SHEAF_PW_PORT=<port> pnpm test:security:f05 --global-timeout 900000`. Assert discovery includes network.spec.ts, csp.spec.ts, secret-lifetime.spec.ts, all under tests/security/f05, then execute every case without skip or live opt-in. Run local unconfigured and public-fixture configured cases in separately fresh builds with effective config digest and window.__sheafBuildId recorded; the existing preview cannot be reused. Seed via real setup/import where needed. Fresh context isolates IndexedDB, same-context page replacement tests restart; close all popup/pages/workers/context and server in finally. Tests cap 180s (KDF 300s), suite 15m, exclusive dist:build/playwright:output, sanitized evidence test-results/f05/s07/security. Context HTTP fixture is external-only; real CSP/fetch guard, IO channel, lock/cancel and secret clearing are under test. The CP1 negative controls above must demonstrate detector rejection, including a forbidden-origin event and retained sentinel. These are planned tests, not passing security evidence.

J4/J5 specifications in STATE.md. Run pnpm test tests/unit/config tests/unit/bootstrap tests/unit/sync tests/unit/workers and explicit tooling self-tests. Browser/E2E use VB-02; test:e2e cloud-backup and gate-f05-demo are real UI→RPC→data worker→dedicated IO channel→actual provider adapter→fixture HTTP→receipt→IndexedDB. Network fixtures intercept browser CONTEXT requests (including worker/popup traffic), never replace internal service/port implementations. Add provider project in playwright.config.ts with testMatch provider-contract/**/*.live.spec.ts (name planned live files consistently); opt-in script test:providers, command SHEAF_LIVE_PROVIDER_TESTS=1 SHEAF_PW_PORT=<port> pnpm test:providers. Default scripts remain node/jsdom/browser/e2e only. Live credentials are supplied out of git and never recorded in evidence. Live tests limited to unique opaque namespaces and authorized accounts. Build with exact effective config; record public-config digest and served build hash plus dirty-tree digest if testing before commit, then rerun artifact identity after commit. CSP blocks unexpected origins; wrong-provider requests fail locally. Evidence test-results/f05/s07, recordings sanitized under tests/provider-contract. Runner/guard fixture behavior has negative-control tests; no generic approval to widen scopes or hosts.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.

**Recheck after landing:** Orchestrator rechecks every directly dependent session in the dependency graph for constructor inputs, return-type assignability, account/frontier/digest meaning, actual transport and harness registration. Invalidate only affected evidence, retain historical outcomes, and amend provisional CA mappings before dispatch.
