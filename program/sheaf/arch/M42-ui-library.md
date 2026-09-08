# M42 — UI library (`src/ui/library/`)

Extracted from specs/architecture.md §Module Structure (UI modules). F01 scope.

- **Owns surfaces (full target):** SCR-010–015, MOD-003, SHT-011.
- **F01 subset:** SCR-011 empty state only (`library-empty.html`, STA-025) as
  the post-unlock destination; upload/adopt actions rendered **disabled** with
  mock copy only (D5) until F02/F06 provide their routes.
- **Depends on:** M38/M39/M40 + M37 library VM.
- **Must not:** show fictional data; label a disabled action with invented
  copy; derive anything from decrypted data in a locked state.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-07 (empty state only).
