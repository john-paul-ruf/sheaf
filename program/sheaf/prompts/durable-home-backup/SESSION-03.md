# SESSION-03 — Scratch reminders and consistent backup status at every entry

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M05 M32 M33 M36 M37 M42 M44 M47 M54 M56 M61
> **Depends on:** SESSION-02
> **Concurrent with:** —
> **Owns:** `src/application/view-models/durability.ts`, `src/application/view-models/library.ts`, `src/application/view-models/records.ts`, `src/application/view-models/security.ts`, `src/application/workflows/durability-services.ts`, `src/application/workflows/durability.machine.ts`, `src/application/workflows/import.machine.ts`, `src/application/workflows/records-services.ts`, `src/application/workflows/reset.machine.ts`, `src/application/workflows/schema-services.ts`, `src/application/workflows/theme-services.ts`, `src/domain/policy/**`, `src/routes/app-area-hooks.tsx`, `src/routes/app-runtime.tsx`, `src/routes/durability-routes.tsx`, `src/routes/guards.tsx`, `src/routes/route-table.tsx`, `src/routes/schema-routes.tsx`, `src/routes/theme-routes.tsx`, `src/ui/durability/**`, `src/ui/library/library-screen.tsx`, `src/ui/library/library.module.css`, `src/ui/records/app-frame.tsx`, `src/ui/records/app-home-screen.tsx`, `src/ui/records/records.module.css`, `src/ui/schema/app-settings-screen.tsx`, `src/ui/security/recovery-codes-screen.tsx`, `src/ui/security/reset-readable-screen.tsx`, `src/ui/security/vault-dialogs.tsx`, `src/workers/data/app-session.ts`, `src/workers/data/backup-handlers.ts`, `src/workers/data/catalog.ts`, `src/workers/data/event-store.ts`, `src/workers/data/handlers.ts`, `src/workers/data/home-state.ts`, `src/workers/data/import-handlers.ts`, `src/workers/data/record-event-payloads.ts`, `src/workers/data/record-handlers.ts`, `src/workers/protocol/client.ts`, `src/workers/protocol/messages.ts`, `src/workers/protocol/redact.ts`, `tests/browser/worker/app.spec.ts`, `tests/browser/worker/usage-journey.spec.ts`, `tests/e2e/append-import.spec.ts`, `tests/e2e/backup-status.spec.ts`, `tests/e2e/charts.spec.ts`, `tests/e2e/fixtures/durability.ts`, `tests/e2e/fixtures/records.ts`, `tests/e2e/fixtures/structure.ts`, `tests/e2e/fixtures/workbook.ts`, `tests/e2e/gate-f02-demo.spec.ts`, `tests/e2e/gate-f04-demo.spec.ts`, `tests/e2e/records-crud.spec.ts`, `tests/e2e/relationships.spec.ts`, `tests/e2e/scratch-reminders.spec.ts`, `tests/e2e/structure.spec.ts`, `tests/e2e/theme.spec.ts`, `tests/unit/policy/**`, `tests/unit/ui/durability/**`, `tests/unit/ui/library/fixtures.ts`, `tests/unit/ui/library/library-screens.test.tsx`, `tests/unit/ui/records/app-home-screen.test.tsx`, `tests/unit/ui/records/fixtures.ts`, `tests/unit/ui/records/route-guards.test.ts`, `tests/unit/ui/schema/harness.ts`, `tests/unit/ui/schema/settings.test.tsx`, `tests/unit/ui/security-surfaces.test.tsx`, `tests/unit/ui/shells.test.tsx`, `tests/unit/view-models/durability.test.ts`, `tests/unit/view-models/library.test.ts`, `tests/unit/view-models/records.test.ts`, `tests/unit/view-models/security.test.ts`, `tests/unit/workers/catalog.test.ts`, `tests/unit/workers/chart-handlers.test.ts`, `tests/unit/workers/data-worker.ts`, `tests/unit/workers/event-store.test.ts`, `tests/unit/workers/handlers.test.ts`, `tests/unit/workers/import-handlers.test.ts`, `tests/unit/workers/module-boundaries.test.ts`, `tests/unit/workers/protocol.test.ts`, `tests/unit/workers/query-handlers.test.ts`, `tests/unit/workers/record-event-payloads.test.ts`, `tests/unit/workers/redact.test.ts`, `tests/unit/workers/reset.test.ts`, `tests/unit/workers/structure-handlers.test.ts`, `tests/unit/workers/theme-handlers.test.ts`, `tests/unit/workflows/chart-services.test.ts`, `tests/unit/workflows/durability.test.ts`, `tests/unit/workflows/fakes.ts`, `tests/unit/workflows/import.machine.test.ts`, `tests/unit/workflows/module-boundaries.test.ts`, `tests/unit/workflows/records-services.test.ts`, `tests/unit/workflows/reset.machine.test.ts`, `tests/unit/workflows/schema-services.test.ts`, `tests/unit/workflows/theme-services.test.ts`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`, `program/sheaf/mocks/f05-vault-security.html`, `program/sheaf/mocks/f05-bundle-save.html`, `program/sheaf/mocks/f05-scratch-reminders.html`
> **Resources:** dist:build, playwright:output
> **Checkpoints:** 4

## Module Context

| ID | Module | Read | Why |
|---|---|---|---|
| M05 | Policy | `program/sheaf/arch/M05-policy.md` | Contract, producer and boundary tests in this lease |
| M32 | Worker protocol | `program/sheaf/arch/M32-worker-protocol.md` | Contract, producer and boundary tests in this lease |
| M33 | Worker entries | `program/sheaf/arch/M33-workers.md` | Contract, producer and boundary tests in this lease |
| M36 | Workflows | `program/sheaf/arch/M36-workflows.md` | Contract, producer and boundary tests in this lease |
| M37 | View models | `program/sheaf/arch/M37-view-models.md` | Contract, producer and boundary tests in this lease |
| M42 | UI library | `program/sheaf/arch/M42-ui-library.md` | Contract, producer and boundary tests in this lease |
| M44 | UI records | `program/sheaf/arch/M44-ui-records.md` | Contract, producer and boundary tests in this lease |
| M47 | UI durability | `program/sheaf/arch/M47-ui-durability.md` | Contract, producer and boundary tests in this lease |
| M54 | Routes | `program/sheaf/arch/M54-routes.md` | Contract, producer and boundary tests in this lease |
| M56 | Unit tests | `tests/unit/` | Contract, producer and boundary tests in this lease |
| M61 | E2E tests | `program/sheaf/arch/M61-e2e-tests.md` | Contract, producer and boundary tests in this lease |

## Context

Backup receipt readers arrive in S02. ScratchReminderStateV1 already exists in the encrypted catalog but lacks a producer and policy. This column owns accepted change → persisted reminder → visible dismissal → restart, plus the existing status surfaces that show the same facts.

Plan HEAD `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

CAP-41 backup observability; CAP-42 scratch reminder complete. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-36, CA-37, CA-40. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `src/application/view-models/durability.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/view-models/library.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/records.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/view-models/security.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/durability-services.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/workflows/durability.machine.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/workflows/import.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/records-services.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/reset.machine.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/schema-services.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/application/workflows/theme-services.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/domain/policy/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/app-area-hooks.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/app-runtime.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/durability-routes.tsx` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/routes/guards.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/route-table.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/schema-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/routes/theme-routes.tsx` | Modify/extend | Production contract, composition or behavior assigned below |
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
| `src/workers/data/app-session.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/backup-handlers.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/data/catalog.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/event-store.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/home-state.ts` | Modify/extend committed source | Production contract, composition or behavior assigned below |
| `src/workers/data/import-handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/record-event-payloads.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/data/record-handlers.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/client.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/messages.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/workers/protocol/redact.ts` | Modify/extend | Production contract, composition or behavior assigned below |
| `tests/browser/worker/app.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/browser/worker/usage-journey.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/append-import.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/backup-status.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/charts.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/durability.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/records.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/structure.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/fixtures/workbook.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/gate-f02-demo.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/gate-f04-demo.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/records-crud.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/relationships.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/scratch-reminders.spec.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/structure.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/e2e/theme.spec.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/policy/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
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
| `tests/unit/workers/catalog.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/chart-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/data-worker.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/event-store.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/import-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/protocol.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/query-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/record-event-payloads.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/redact.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/reset.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/structure-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workers/theme-handlers.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/chart-services.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/durability.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/fakes.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/import.machine.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/module-boundaries.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/records-services.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/reset.machine.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/schema-services.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/workflows/theme-services.test.ts` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — One durable authored-change reminder producer

Implement planned scratchReminderSchedule and backupFreshness in policy using approved DEC-71: first authored change prompts immediately after local acknowledgement; successive dismissals defer eligibility by 10 minutes, 1 hour, 24 hours, then daily while scratch. Persist dismissal progression and next eligibility through existing encrypted ScratchReminderStateV1; do not reset escalation on navigation/restart or treat dismissal as an authored event. createEventStore.append persists triggering commit identity and eligible reminder state in the same transaction as accepted authored mutations. Distinguish user commit from import/reconciliation for prompting; imported state still counts for backup. Record create/edit/delete/restore, schema multi-event commands, saved/pinned charts, and theme all use the single commit hook. Rejected/no-op commands, drafts, searches, recalculation, last-opened and dismissal create no authored commit.

**Commit when:** Exact-count unit tests for each command family, multi-event schema = one commit, rejected save = zero; reminder trigger survives immediate worker shutdown. Policy tests cover clock rollback and repeated dismissal without losing the persistent badge.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Dismissal, escalation and restart without blocking edits

Add reminder query/dismiss request and service/machine transitions; dismissal is encrypted operational state, not an event. Compare triggering commit and current app/home to reject stale dismissal; assignment clears scratch state. Use accepted `f05-scratch-reminders.html` (4c31ded) for MOD-001/002 after successful local acknowledgement across record/schema/chart/theme flows; dismiss restores focus and never prevents a save. Reuse shared notice boundary so different routes do not implement different policies.

**Commit when:** tests/e2e/scratch-reminders.spec.ts proves all authored families, dismiss→continue, interval boundaries using a controlled browser clock propagated through worker ClockPort, page restart persistence and home-assignment suppression. Existing CRUD/structure/chart/theme e2e fixtures explicitly dismiss expected prompts while preserving their original assertions.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — Every status pairs authoritative facts with a working remedy

Finish shell tile/app frame/app home/Settings/backup-detail status consumers; zero shown explicitly, null time means no successful backup. Back up now for scratch routes to home choice, bundle leads Save a fresh bundle, cloud states have distinct pending/offline/reconnect/quota/interrupted remedies (network connection supplied S07). Co-update wire fixtures and security maps. Correct inherited S06 preserved-value copy in records.ts so a value kept after conversion does not claim it came unchanged from import; use preserved provenance and the established plain-language style, with VM regression.

**Commit when:** tests/e2e/backup-status.spec.ts and VM/UI tests verify shell and app match after reopen, and every exposed remedy reaches the appropriate production route. No cloud success is synthesized before S07.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 4 — Accessible reminder/status integration and old-journey compatibility

Finish responsive status layouts and stale bundle emphasis from design sources; keep safety semantics system-owned. Add negative controls for reminder deduplication and stale response routing. Update only e2e fixtures/selectors whose expected new reminders otherwise obscure the old capability assertions; record all new file seams through Controlled Lease Revision.

**Commit when:** pnpm typecheck, pnpm lint, pnpm test and pnpm test:e2e pass under locks; J2 passes for record, schema, chart and theme; no inherited behavioral assertions removed. DEC-71 and reminder design are approved/accepted; S02 completion and current J1 remain dispatch prerequisites. Reminder production proof remains this session’s responsibility.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

## Verification

For CA-37, test first-change eligibility and every dismissal boundary at just-before/exactly-due for 10m/1h/24h/daily, repeated daily dismissal, clock rollback, restart, no-op/rejection, duplicate acknowledgements and assignment suppression. Assert encrypted scheduling survives reopen, accepted edits never wait for a prompt, and the badge persists after dismissal. CP1 policy/worker tests and CP2 real-entry assertions own these checks. J2 specification in STATE.md. Focused commands: pnpm test tests/unit/policy tests/unit/workflows tests/unit/view-models tests/unit/workers; SHEAF_PW_PORT=<port> pnpm test:e2e scratch-reminders; same for backup-status. Run full e2e once after all adapted old journeys pass. Fixture changes own their negative controls under tests/unit/workflows/durability.test.ts. Use Playwright clock only where it reaches the worker; otherwise a typed test-only ClockPort injection in the owned worker harness supplies exact epoch values, with at least one real-clock entry journey. Never sleep for hours or use test time as durable authority. Evidence test-results/f05/s03. First-journey proof J1 must be current before dispatch.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.
