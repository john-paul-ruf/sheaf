# SESSION-04 — Dropbox App Folder backup transport

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M25 M56 M62
> **Depends on:** SESSION-01, SESSION-02
> **Concurrent with:** S05, S06
> **Owns:** `src/sync/providers/dropbox/**`, `tests/provider-contract/dropbox/**`, `tests/unit/sync/dropbox/**`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`
> **Resources:** dist:build (live probe), playwright:output (live probe), provider:dropbox:test-account (live only)
> **Checkpoints:** 3

## Module Context

| ID | Module | Read | Why |
|---|---|---|---|
| M25 | Dropbox adapter | `program/sheaf/arch/M25-dropbox.md` | Contract, producer and boundary tests in this lease |
| M56 | Unit tests | `tests/unit/` | Contract, producer and boundary tests in this lease |
| M62 | Provider contract | `program/sheaf/arch/M62-provider-contract.md` | Contract, producer and boundary tests in this lease |

## Resource scheduling

Concurrent with denotes disjoint source leases only. S04/S05/S06 all require dist:build and playwright:output. Conservatively serialize their full-session resource reservations; do not dispatch them simultaneously under the current envelopes. S06 may proceed while provider inputs are blocked. Concurrent execution needs a separately reviewed envelope with isolated build and runner outputs, not merely distinct ports.

## Context

No provider adapter exists at plan HEAD. S01 produces the common byte/receipt port; S02 establishes real IO and bundle transport. This session owns only its vendor adapter and tests so Dropbox and OneDrive can run concurrently without racing the common contract or config. S07 owns production registration and UI OAuth return wiring.

Plan HEAD `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

CAP-43 provider contribution; S07 owns complete cloud user action. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-38, CA-39. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `src/sync/providers/dropbox/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `tests/provider-contract/dropbox/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/sync/dropbox/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — Qualify the external premise and bind the account

Checkpoint 0, before building upload logic: first construct the in-lease standalone qualification runner described in Verification, then execute the bounded provider probe from CA-38 using human-supplied registration and two authorized test accounts; retain redacted endpoint identity, granted scopes and observed result. Dropbox /2 + OAuth S256 PKCE, App Folder permissions, update revision and strict conflict handling. Build auth/token and stable-account adapter over S01 ports, never localStorage/sessionStorage or app-secret config. Cancel/mismatched OAuth state/incorrect redirect/account change returns a typed refusal. Do not expand scopes or silently fall back to nonconditional writes. Missing credentials keeps qualification blocked; local fixtures are not live evidence.

**Commit when:** Authenticated account identity and cancellation tests pass; exact live premise evidence is recorded or session remains blocked before dependent cloud use. New adapter compiles without modifying frozen common ports.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Immutable objects, pagination, resumable transfer and head CAS

Implement opaque relative-path enumeration/download/upload with bounded chunks, cancellation, resume cursors, and create-only collision verification. Page/cursor loops are bounded; arbitrary paths/roots and cross-account cursors fail closed. Content filenames never use app names. Exact receipt carries candidate head digest and revision; transport retries reuse immutable bytes, but stale head is divergence, never blind retry. Normalize offline, revoked/expired token, quota, rate limit, interruption, integrity and CAS states without exposing raw response/token text.

**Commit when:** pnpm test tests/unit/sync/dropbox passes, including two-writer race exactly one winner, old generation readable after interruption, stale account cursor rejected, cursor resume not counted as backup.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — Provider contract fixtures and isolation qualification

Build recorded protocol doubles for both same-account second-device discovery and different-account isolation; test pagination, malformed response, non-JSON failure and abrupt disconnect. Use synthetically generated encrypted payloads only. Complete the opt-in live qualification entry and standalone config in the same lease; S07 later adds shared script registration; require explicit test-account configuration and unique test namespace. Never delete unrelated remote objects. Document compatibility outcomes for CA-38; S07 consumes the real adapter, not a substituted DurableHomePort in its integration proof.

**Commit when:** pnpm typecheck, pnpm lint, focused provider tests and shared-double self-tests pass; adapter handoff lists exact constructor/config/token port requirements and endpoint revisions. Live proof is separate, opt-in, and blocked if registration unavailable.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

## Verification

Run pnpm test tests/unit/sync/dropbox. Vitest currently ignores tests/provider-contract, so behavioral test wrappers live in the unit path and import fixture assets from the provider-contract path. Do not rely on undiscovered *.test.ts there. Live opt-in entry is planned tests/provider-contract/dropbox/dropbox.live.spec.ts and is discovered immediately by a planned tests/provider-contract/dropbox/playwright.config.ts in this lease. That config imports the checked-in root config, replaces testDir/testMatch/projects with this provider-only live suite, preserves build-before-preview/reuseExistingServer=false, and requires explicit live opt-in. The CP0 command is SHEAF_LIVE_PROVIDER_TESTS=1 SHEAF_PW_PORT=<port> pnpm exec playwright test --config tests/provider-contract/dropbox/playwright.config.ts --global-timeout 600000. First run the same command with --list to prove nonzero discovery. Author the bounded probe against browser fetch at the configured SPA origin with ephemeral public-PKCE authorization in this harness; it is external qualification, not the future product OAuth composition. Tests must include a two-writer barrier at final publication, not merely test a stale session-creation request. If callback host input is absent, record the named input blocker before probing. S07 consumes these exact live entries in its later shared project; no prerequisite depends on that future runner. No live tests run by default. CA-38 lists exact probe assertions and primary sources. External identity is endpoint API version, client registration and account scope; there is no vendor CLI binary. Record sanitized recordings under tests/provider-contract/dropbox; tokens stay in transient worker memory/encrypted test profile. Use a 120s per-probe timeout, abort controllers and finally cleanup of owned test namespace; never blanket-delete a provider folder. Live tests require test account resource locks. Recheck after landing: S07 token-store constructor, account binding, origin allowlist, exact receipt mapper and CORS/redirect behavior. Any common API correction goes to Orchestrator, which serially leases S01 paths and their tests before S07.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.
