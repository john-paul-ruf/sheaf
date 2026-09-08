# M54 — Routes (`src/routes/`)

Extracted from specs/architecture.md §Module Contracts (Routes). F01 scope.

- **Owns:** URL ↔ approved-SCR mapping, lock-state guards, (later) OAuth
  return routing.
- **F01 exports:** hash-route table (`#/welcome`, `#/setup`, `#/unlock`,
  `#/recover`, `#/reset`, `#/library`, `#/settings/security`,
  `#/settings/security/passphrase`, `#/settings/security/recovery-codes`,
  `#/settings/security/reset`), `RouteGuardResult` guards per CA-07:
  locked → only welcome/setup/unlock/recover/reset(locked); unlocked
  redirects those to library; unknown → library|unlock; first-run (no
  bootstrap row) → welcome.
- **Depends on:** UI feature modules + M37 VMs + M53 state.
- **Must not:** implement commands; infer state from provider availability;
  compose a surface missing from specs/design.md.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-07.
