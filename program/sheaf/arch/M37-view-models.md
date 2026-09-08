# M37 — View models (`src/application/view-models/`)

Extracted from specs/architecture.md §Module Contracts (View models). F01
scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Minimum-data projections for approved surfaces + announcements.
- **F01 exports (landed):**
  - `security.ts` — `selectWelcomeVm(report)` (SCR-001, incl. the CAP-08
    `unsupported` variant), `selectSetupVm`, `selectUnlockVm`,
    `selectRecoveryVm`, `selectSecuritySettingsVm`, `selectPassphraseChangeVm`,
    `selectRevealCodeVm`, `selectResetVm` — each taking the corresponding
    machine snapshot — plus `ErrorVm` / `toErrorVm` / `announceRefusal`,
    `IDLE_TIMEOUT_OPTION_VMS`, and the scope constants
    `LOCAL_PASSPHRASE_SCOPE`, `CURRENT_LOCAL_PASSPHRASE_SCOPE`,
    `NEW_LOCAL_PASSPHRASE_SCOPE`, `LOCAL_RECOVERY_CODE_SCOPE`,
    `LOCAL_RECOVERY_CODE_REACH`.
  - `library.ts` — `selectEmptyLibraryVm()`, `EmptyLibraryVm`,
    `LibraryActionVm`, `LibraryActionReason` (D5 disabled action tokens).
- **Depends on:** M36 (machine snapshot types + the ordering and phrase
  constants), M32 protocol **types only**, M51 `CapabilityReport` **type
  only**. No runtime import from `src/workers/**`; asserted by
  `tests/unit/workflows/module-boundaries.test.ts`.
- **Must not:** include app names/counts/backup times/silhouettes in any
  locked-state VM — the *types* forbid the fields, not just the values; ask for
  "your passphrase" unqualified (exact-secret scope strings live in the VM per
  design.md §Content Patterns).

## Contracts worth recording

- **Must-nots enforced by types, not review.** The locked models (`UnlockVm`'s
  `locked`/`delayed` variants, `LockedResetVm`) declare no field for an app
  name, record count, backup time or inventory, so a future writer cannot fill
  one. The boundary test also asserts that no view-model file names a
  passphrase-bearing field. Every prompt-bearing variant carries its exact
  secret scope string.
- **Truthful enumeration.** `ReadableResetVm.inventory` is
  `"loading" | "none" | rows` — there is deliberately no `"unknown"`. F01's
  readable reset always enumerates nothing, and "none" is a fact where
  "unknown" would be a different, and false, claim.
- **Announcement copy provenance.** Mock-quoted strings carry source comments;
  states with no mock sentence are composed from facts in Content Patterns
  style. These are `aria-live` strings, not visible copy — M41 owns visible
  wording but must not remove the scope strings or the D4 delay wording.
- **Mock divergence per Custom Rule 3.** reset.html's survivor line names
  Google Drive; the VM carries "Dropbox, OneDrive, or bundle copies" and a test
  asserts no `/drive|google/i` match. The VMs make no `LCL-` prefix claim
  (AD-10).

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-06 (`883f815`).
- 2026-09-08 — consumed verbatim by SESSION-07 (`9174b6d`, re-run at
  `2c0248a`): field names bound with no adaptation, so CA-04's UI leg needed no
  amendment.
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged;
  copy-provenance and Custom Rule 3 facts promoted from the session return.
