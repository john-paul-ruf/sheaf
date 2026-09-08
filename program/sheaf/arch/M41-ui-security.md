# M41 — UI security (`src/ui/security/`)

Extracted from specs/architecture.md §Module Structure (UI modules). F01 scope.

- **Owns surfaces:** SCR-001–009; MOD-022, MOD-032, MOD-033, MOD-037 (F01 set;
  MOD-020/021/023/024 arrive with vaults in F05).
- **F01 exports:** welcome/setup/unlock/recovery/security-settings/
  passphrase-change/recovery-codes/reset-locked/reset-readable screens.
- **Depends on:** M38/M39/M40 + M36 machines + M37 VMs only.
- **Must not:** import worker/persistence/crypto internals; acknowledge any
  state the machine has not confirmed; imply the unlock delay persists across
  termination (CA-05); offer reset before recovery (FR-22); render an
  inventory in locked reset (FR-23 generic variant); invent copy — every
  screen's mock is its contract, gaps are design-fill seams.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-07.

<!-- foundation-first-unlock SESSION-07 -->
- 2026-09-08 — SESSION-07 landed (final revision `9174b6d`). Delta:

**M41 — UI security (`src/ui/security/`)**
- **Exports:** `WelcomeScreen`, `SetupScreen`, `UnlockScreen`, `RecoveryScreen`,
  `SecuritySettingsScreen`, `PassphraseChangeScreen`, `RecoveryCodesScreen` +
  `RevealCodeDialog`, `ResetLockedScreen`, `ResetReadableScreen`; plus
  `LockedFrame`, `UnlockedFrame`, `SecurityNavigation`, `ShellArea`
  (`frames.tsx`) and `PassphraseVerdict` (`verdict.tsx`).
- Every screen is **presentational**: a view model in, callbacks out, no actor
  and no navigation of its own. Destinations arrive as `SecurityNavigation`
  hrefs because the URL scheme is M54's.
- `LockedFrame`/`UnlockedFrame` own the per-screen `role="status"` live region
  that carries M37's `announcement`, so no surface can forget it.
- **Must not (added):** submit a security form with native constraint
  validation. Every form is `noValidate`: CTL-023 marks a field invalid from a
  *typed worker refusal*, which makes the form natively invalid, and the
  browser then silently swallows the next submit — the retry.
