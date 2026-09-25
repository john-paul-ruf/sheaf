# SESSION-01 — Vault keys and authenticated transport contracts

> **Program:** Sheaf
> **Feature:** durable-home-backup (F05)
> **Modules:** M07 M08 M09 M24 M56 M57 M59 M62
> **Depends on:** —
> **Concurrent with:** —
> **Owns:** `src/application/ports/backup.ts`, `src/application/ports/durable-home.ts`, `src/application/ports/vault-crypto.ts`, `src/crypto/**`, `src/persistence/codecs/vault.ts`, `src/sync/protocol/**`, `tests/fixtures/vaults/f05/**`, `tests/property/sync/**`, `tests/provider-contract/shared/**`, `tests/unit/codecs/vault.test.ts`, `tests/unit/crypto/**`, `tests/unit/sync/protocol/**`
> **Reads:** `program/sheaf/PROGRAM-CONFIG.md`, `program/sheaf/prompts/durable-home-backup/STATE.md`, `program/sheaf/specs/requirements.md`, `program/sheaf/specs/design.md`, `program/sheaf/specs/architecture.md`, `program/sheaf/specs/database.md`, `src/migrations/**`, `program/sheaf/mocks/durable-home.html`, `program/sheaf/mocks/backup-detail.html`, `program/sheaf/mocks/durable-homes.html`, `program/sheaf/mocks/dialog-atlas.html`, `program/sheaf/mocks/state-atlas.html`, `program/sheaf/mocks/control-atlas.html`
> **Resources:** dist:build
> **Checkpoints:** 3

## Module Context

| ID | Module | Read | Why |
|---|---|---|---|
| M07 | Application ports | `program/sheaf/arch/M07-ports.md` | Contract, producer and boundary tests in this lease |
| M08 | Crypto | `program/sheaf/arch/M08-crypto.md` | Contract, producer and boundary tests in this lease |
| M09 | Codecs | `program/sheaf/arch/M09-codecs.md` | Contract, producer and boundary tests in this lease |
| M24 | Sync protocol | `program/sheaf/arch/M24-sync-protocol.md` | Contract, producer and boundary tests in this lease |
| M56 | Unit tests | `tests/unit/` | Contract, producer and boundary tests in this lease |
| M57 | Property tests | `tests/property/` | Contract, producer and boundary tests in this lease |
| M59 | Vault fixtures | `program/sheaf/arch/M59-vault-fixtures.md` | Contract, producer and boundary tests in this lease |
| M62 | Provider contract | `program/sheaf/arch/M62-provider-contract.md` | Contract, producer and boundary tests in this lease |

## Context

M08 already protects local roots; vault key purposes and the M24 implementation are absent. Migration 006 is the committed wire authority. This is the minimum shared artifact needed by bundle and both provider paths, not a conflict-avoidance layer.

Plan HEAD `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. Read the target before each modification. Author-owned specs, mocks and migrations are read-only. New paths in this prompt are planned outputs, not existing APIs. Only Owns may be written; ignored dist/test-results are declared build/evidence resources. Never edit shared STATE/MASTER/arch files. Return evidence for Orchestrator to apply.

## Capabilities

CAP-39, CAP-40, CAP-44 producer contribution only. Full action/producer/storage/restart/proof mapping is in STATE Capability Readiness. Each checkpoint below is an implementation assignment. A passing component check is not completion of the later composed journey.

## Contract Agreements

CA-34, CA-35, CA-38. Recheck axes (a) existence, (b) response fit, (c) meaning and (d) production proof using STATE Seam Preflight. Required predecessor outputs must be committed and ready; this session's own future outputs may remain planned. Orchestrator must replace provisional CA text with landed mapping before dispatch. If a known prerequisite is blocked, do not start its dependent checkpoint. A new mechanical seam gets Controlled Lease Revision after ownership checks, with implementation preserved; no self-widened lease.

## Planned API sketches (not committed symbols)
S01 chooses final names at its checkpoint and Orchestrator amends CA mappings before consumers dispatch. These sketches state meaning; existing symbols elsewhere in this prompt have been inspected at plan HEAD.

```ts
interface HeadReceipt {
  readonly candidateSha256: Uint8Array;
  readonly revision: string; // opaque provider revision, never an app sequence
}
interface DurableHomePort {
  readHead(signal: AbortSignal): Promise<null | { bytes: Uint8Array; revision: string }>;
  createObject(id: string, ciphertext: Uint8Array, signal: AbortSignal): Promise<void>;
  compareAndSwapHead(expectedRevision: string | null, bytes: Uint8Array,
                     signal: AbortSignal): Promise<HeadReceipt>;
}
// Additional list/read/resume methods must keep bytes + opaque metadata only.
// The instance is bound to a provider-authenticated account and vault location.
// A null expected revision is create-if-absent, never unconditional overwrite.
```

Vault-crypto port returns opaque handles and wrapped ciphertext. Backup snapshot identity includes app/home/vault IDs, generation, frontier, exact candidate digest, retained roots and per-device chain evidence. FileSavePort is a discriminated saved/cancelled/failed/unconfirmed result; only accepted completion can authorize its exact snapshot receipt. No key/token appears in a page view model.

## Files to Create/Modify

| File / exact lease glob | Action | What Changes |
|---|---|---|
| `src/application/ports/backup.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/ports/durable-home.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/application/ports/vault-crypto.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/crypto/**` | Modify/extend | Production contract, composition or behavior assigned below |
| `src/persistence/codecs/vault.ts` | Create (planned) | Production contract, composition or behavior assigned below |
| `src/sync/protocol/**` | Create (planned) | Production contract, composition or behavior assigned below |
| `tests/fixtures/vaults/f05/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/property/sync/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/provider-contract/shared/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/codecs/vault.test.ts` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/crypto/**` | Modify/extend | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |
| `tests/unit/sync/protocol/**` | Create (planned) | Behavioral proof/fixture adaptation or owning runner/config mechanism assigned below |

## Implementation

### Checkpoint 0 — Read and recheck (not a separate commit)

Read all Module Context and Files targets that exist. Confirm clean lease ownership without discarding unrelated work. Recheck the CA inputs and current baseline. Probe the riskiest external premise before code depends on it; provider scopes/CAS/CORS are CA-38 and platform save is CA-37. Report a genuine protected-input blocker with its exact dependent checkpoint, not a fabricated successful stub.

### Checkpoint 1 — Independent vault secrets and opaque key rewrapping

Read keys.ts, kdf.ts, recovery-code.ts and migration 006 first. Add vault-scoped KDF descriptors and opaque vault handles; local descriptors/known-answer bytes remain unchanged. Same human passphrase must use independent salts and the exact vault context labels from migration 006. Wrap the existing app handle without exporting bytes; provide local-root protection of the vault handle. Generate distinct local/vault recovery secrets, authenticate scope before returning a handle, and zeroize failed/intermediate handles. Existing scratch ciphertext is never re-encrypted merely to assign a home.

**Commit when:** Crypto KATs, cross-scope/wrong-secret/tamper tests and existing local KDF/key tests pass; typecheck and lint pass.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 2 — Canonical vault graph and bounded bundle framing contracts

Implement migration-006 codecs and typed ports as proposed below; reject duplicate/unknown critical fields, invalid dimensions, noncontiguous frontiers, app/vault/generation mismatches, overlapping ranges and future versions. Define immutable object and exact-byte CAS receipts, not provider SDK types. Reference scope comes from the already-authenticated parent graph reference (or the fixed authenticated bootstrap context), participates in AEAD AAD, and must agree with the expected payload kind. Scope is absent from EnvelopeFrameV1. Reference logicalRevision and paddedBytes come from the authenticated frame, not the current transaction revision. Reference conversion reads actual SHF1 frames: local StorageRefV1.semanticSha256 is a plaintext-payload digest and is never copied into ciphertextSha256. Keep local head-body hash distinct from canonical reconstructed-state digest. Build a stateful provider double whose failed CAS changes nothing and whose interrupted upload cannot change the head.

**Commit when:** pnpm test tests/unit/crypto tests/unit/codecs/vault.test.ts tests/unit/sync/protocol tests/property/sync passes with rejection assertions and exact byte round trips. Reference substitution under a different scope or expected payload kind is rejected even with matching storage ID, dimensions and ciphertext digest; tests authenticate with decryptEnvelope, not only parse the frame.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

### Checkpoint 3 — Authenticated publication candidate and fixture contract

Create candidate generation/index/manifest builder over supplied authenticated app graph; increment generation exactly once, preserve other apps and permanent markers, distinguish first create from replace, bind expected predecessor hash and provider revision. Preserve current-index retention roots without recursively promoting historical retention lists. Fixture generator writes only tests/fixtures/vaults/f05; generator self-test regenerates byte-identical known-answer fixtures using deterministic entropy only in tests. Complete producer contract proofs; no UI or storage readiness claim.

**Commit when:** All focused tests and full pnpm test pass; pnpm typecheck, pnpm lint and pnpm build pass. Orchestrator rechecks CA-34/35/38 against the landed APIs before S02 or provider consumers dispatch.

Coder commits this checkpoint itself with `git add -- <the exact Owns pathspecs above>` then `git commit`; inspect staged names and exclude everything outside the lease. No unimplemented success path may be consumed.

## Verification

Unit discovery is VB-01. New tests: tests/unit/crypto/vault.test.ts, tests/unit/codecs/vault.test.ts, tests/unit/sync/protocol/publication.test.ts; property tests under tests/property/sync. Run the exact directory commands in each checkpoint. Check forged receipts, same bytes/different app, altered header KDF, missing graph object, deletion-marker resurrection and stale predecessor. tests/provider-contract/shared/double.test.ts is not currently discovered by Vitest: S01 must put its behavioral self-tests under tests/unit/sync/protocol/provider-double.test.ts, importing the shared helper. No provider request occurs. Fixtures are test-only; storage/restart and platform save are S02 proofs.

VB-01/VB-02 in STATE are authoritative for commands, discovery and bounded execution. Tests named as new are planned, not passing. Every checkpoint requires a building tree and its relevant tests; source/fixture/runner changes land together. Invoke architecture-boundary tests covering every changed module and their negative controls. Browser artifact builds and test-results share exclusive resources even where source leases are disjoint.

## State Update

Return Handoff with session ID/status, last checkpoint and commits; notes and followUp verbatim-ready; filesTouched; actual commands/counts/exit codes; CAP/CA evidence and revisions; proposed mapping changes; unresolved gaps and next proof owner; needsOwnerCorrection/needsDesignSource/blockedReason. Orchestrator updates canonical STATE and arch fragments.

**Recheck after landing:** Orchestrator rechecks every directly dependent session in the dependency graph for constructor inputs, return-type assignability, account/frontier/digest meaning, actual transport and harness registration. Invalidate only affected evidence, retain historical outcomes, and amend provisional CA mappings before dispatch.
