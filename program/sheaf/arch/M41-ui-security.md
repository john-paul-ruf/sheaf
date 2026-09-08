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
