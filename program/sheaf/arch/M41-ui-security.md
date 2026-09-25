# M41 — UI security (`src/ui/security/`)

Extracted from specs/architecture.md §Module Structure (UI modules).
Reconciled through production `47a633b` (F05 continuation).

- **Owns surfaces:** SCR-001–009; MOD-022, MOD-032, MOD-033, MOD-037 (F01 set;
  F05 adds the accepted named-vault create/reuse/recovery/re-view subset below).
- **F01 exports (landed):** `WelcomeScreen`, `SetupScreen`, `UnlockScreen`,
  `RecoveryScreen`, `SecuritySettingsScreen`, `PassphraseChangeScreen`,
  `RecoveryCodesScreen` + `RevealCodeDialog`, `ResetLockedScreen`,
  `ResetReadableScreen`; plus `LockedFrame`, `UnlockedFrame`,
  `SecurityNavigation`, `ShellArea` (`frames.tsx`) and `PassphraseVerdict`
  (`verdict.tsx`).
- **Runtime imports:** M37/M38/M39, M44 value formatting and M47 durability
  CSS; see the mechanically derived registry. Machines are **not** imported
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
- SCR-007 renders actual connected-home rows in F05, or the truthful no-home
  empty state. Fictional vault rows remain forbidden. The landed home state
  and scoped recovery path resolved this extension without a migration change.
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

## Mounted vault, recovery and reset surfaces (F05)

`vault-dialogs.tsx` supplies named-vault creation/reuse, separate labelled local/vault recovery cards and secret-confirmed vault-code review from accepted `f05-vault-security.html` (`58bffc8`). Recovery codes lists authenticated connected homes and scoped review links; an empty inventory retains truthful empty copy. Existing encrypted formats suffice; no schema re-entry was needed. MOD-022 remains local-code reveal.

Readable reset shows the same app-scoped confirmed time and pending count as library/app, links to its backup route and re-enumerates on return; stale transaction confirmation is refused by the worker. RecoveryScreen renders the deadline VM, disables premature submit and clears entered codes. Mounted proof is accepted; page countdown expiry never grants recovery authority.

Source and current proof scope: [F05 boundaries](F05-boundaries.md), production `47a633b`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-07 (`9174b6d`, re-run at `2c0248a`).
  axe (wcag2a/2aa/21a/21aa) clean on SCR-001 ready + unsupported, SCR-002–009
  and SCR-011; all four dialogs trap focus; MOD-037 and MOD-022 restore focus
  to the invoking control; MOD-033 refuses an outside click.
- 2026-09-08 — reconciled by Roshi (final pass): the `noValidate` must-not,
  the presentational contract and the recorded design deviations promoted from
  the session return into the fragment; session-delta staple merged.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
