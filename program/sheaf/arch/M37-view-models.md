# M37 — View models (`src/application/view-models/`)

Extracted from specs/architecture.md §Module Contracts (View models). F01 scope.

- **Owns:** Minimum-data projections for approved surfaces + announcements.
- **F01 exports:** one discriminated VM per SCR-001..009 and MOD-022/032/033/
  037 content; `library.ts` empty-state VM (`{kind:'empty'}`, D5 disabled
  action tokens); aria-live announcement strings per state.
- **Depends on:** M36 states + protocol-safe types.
- **Must not:** include app names/counts/backup times/silhouettes in any
  locked-state VM — the *types* forbid the fields, not just the values; ask
  for "your passphrase" unqualified (exact-secret scope strings live in the
  VM per design Content Patterns).

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-06.

<!-- foundation-first-unlock SESSION-06 -->
- 2026-09-08 — SESSION-06 landed (final revision `883f815`). Delta:

## M37 — View models (`src/application/view-models/`) — implemented

**Landed exports.** `security.ts`: `selectWelcomeVm(report)` (SCR-001, incl.
the CAP-08 `unsupported` variant), `selectSetupVm`, `selectUnlockVm`,
`selectRecoveryVm`, `selectSecuritySettingsVm`, `selectPassphraseChangeVm`,
`selectRevealCodeVm`, `selectResetVm` — each taking the corresponding machine
snapshot — plus `ErrorVm`/`toErrorVm`/`announceRefusal`,
`IDLE_TIMEOUT_OPTION_VMS`, and the scope constants
`LOCAL_PASSPHRASE_SCOPE`, `CURRENT_LOCAL_PASSPHRASE_SCOPE`,
`NEW_LOCAL_PASSPHRASE_SCOPE`, `LOCAL_RECOVERY_CODE_SCOPE`,
`LOCAL_RECOVERY_CODE_REACH`. `library.ts`: `selectEmptyLibraryVm()`,
`EmptyLibraryVm`, `LibraryActionVm`, `LibraryActionReason`.

**Dependency edges (new).** M37 → M36 (machine snapshot types + the ordering
and phrase constants), M37 → M32 protocol **types only**, M37 → M51
`CapabilityReport` **type only**. No runtime import from `src/workers/**`;
asserted by `tests/unit/workflows/module-boundaries.test.ts`.

**Must-nots now enforced by types, not review.** The locked models
(`UnlockVm`'s `locked`/`delayed` variants, `LockedResetVm`) declare no field
for an app name, record count, backup time, or inventory, so a future writer
cannot fill one; the boundary test also asserts no view-model file names a
passphrase-bearing field. Every prompt-bearing variant carries its exact
secret scope string, per design.md § Content Patterns.

**Truthful enumeration.** `ReadableResetVm.inventory` is
`"loading" | "none" | rows` — there is deliberately no `"unknown"`. F01's
readable reset always enumerates nothing, and "none" is a fact where "unknown"
would be a different (and false) claim.
