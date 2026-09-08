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
