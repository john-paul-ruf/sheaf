# M41 — UI security (`src/ui/security/`)

Extracted from specs/architecture.md §Module Structure (UI modules). F01 scope.
Reconciled against the tree at `2c0248a`.

- **Owns surfaces:** SCR-001–009; MOD-022, MOD-032, MOD-033, MOD-037 (F01 set;
  MOD-020/021/023/024 arrive with vaults in F05).
- **F01 exports (landed):** `WelcomeScreen`, `SetupScreen`, `UnlockScreen`,
  `RecoveryScreen`, `SecuritySettingsScreen`, `PassphraseChangeScreen`,
  `RecoveryCodesScreen` + `RevealCodeDialog`, `ResetLockedScreen`,
  `ResetReadableScreen`; plus `LockedFrame`, `UnlockedFrame`,
  `SecurityNavigation`, `ShellArea` (`frames.tsx`) and `PassphraseVerdict`
  (`verdict.tsx`).
- **Depends on:** M38/M39/M40 + M37 VMs only. Machines are **not** imported
  here — see the presentational contract below.
- **Must not:** import worker/persistence/crypto internals **or a state-machine
  runtime**; acknowledge any state the machine has not confirmed; imply the
  unlock delay persists across termination (CA-05/D4); offer reset before
  recovery (FR-22); render an inventory in locked reset (FR-23 generic
  variant); invent copy — every screen's mock is its contract, gaps are
  design-fill seams; **submit a security form with native constraint
  validation** (see below).

## Contracts worth recording

- **Every screen is presentational**: a view model in, callbacks out, no actor
  and no navigation of its own. Destinations arrive as `SecurityNavigation`
  hrefs because the URL scheme is M54's, and the actors live in `src/routes/`
  because `tests/unit/ui/architecture.test.ts` forbids importing
  `@xstate/react` into `src/ui/**`.
- `LockedFrame`/`UnlockedFrame` own the per-screen `role="status"` live region
  that carries M37's `announcement`, so no surface can forget it.
- **Every form is `noValidate`.** React Aria's `TextField` uses *native*
  constraint validation, so the moment CTL-023 marks a field invalid from a
  typed worker refusal the whole form becomes natively invalid and the browser
  **silently swallows the next submit** — which is the retry. Without this,
  every wrong-passphrase screen is a dead end after one attempt and the
  six-attempt delay leg is unreachable. Found and fixed in-lease by SESSION-07;
  the reason is recorded in `unlock-screen.tsx`.
- **MOD-022's dialog is its own component.** The fresh-machine-per-reveal key
  originally sat on the component that also rendered the trigger button, so
  closing the dialog replaced the button and focus had nowhere to return to.
  `RevealCodeDialog` is split out of `RecoveryCodesScreen` so only the dialog
  subtree remounts.

## Recorded design deviations (each from a recorded decision; none invented)

The design-fill list for F01 is **empty**.

- SCR-004/SCR-007: the recovery code renders as 8 groups of 7 Crockford
  characters with **no prefix**, and local-recovery.html's "Starts with LCL" is
  dropped — the landed KAT-pinned format has no prefix and a display prefix
  would corrupt parsing (Crockford `L`→`1`). AD-10.
- SCR-007's vault section renders a truthful "no durable home is connected to
  this device yet" instead of the mock's two fictional vault rows (STA-025
  forbids fictional data; dropping the section would hide a scope the screen
  exists to explain). Per-home rows arrive at F05 and reopen D10 as a schema
  re-entry.
- SCR-002's fields use the VM's scope-naming labels rather than the mock's
  shorter "New passphrase" / "Confirm passphrase", because design.md §Content
  Patterns requires the exact secret to be named.
- Google Drive is removed from setup.html's, local-recovery.html's and
  reset.html's provider sentences (Custom Rule 3); OneDrive is a durable home
  and is still named.
- SCR-001's CAP-08 unsupported variant has **no mock**. It is composed strictly
  from CTL-087 + the probe's own `{id, reason}` + Content Patterns, invents no
  flow or hierarchy, and is therefore not a design-fill seam. It renders no
  retry action, because the remedy — a browser that provides the capability —
  is not a button.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-07 (`9174b6d`, re-run at `2c0248a`).
  axe (wcag2a/2aa/21a/21aa) clean on SCR-001 ready + unsupported, SCR-002–009
  and SCR-011; all four dialogs trap focus; MOD-037 and MOD-022 restore focus
  to the invoking control; MOD-033 refuses an outside click.
- 2026-09-08 — reconciled by Roshi (final pass): the `noValidate` must-not,
  the presentational contract and the recorded design deviations promoted from
  the session return into the fragment; session-delta staple merged.
