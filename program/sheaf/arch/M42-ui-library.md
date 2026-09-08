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

<!-- foundation-first-unlock SESSION-07 -->
- 2026-09-08 — SESSION-07 landed (final revision `9174b6d`). Delta:

**M42 — UI library (`src/ui/library/`)**
- **Exports:** `EmptyLibraryScreen` (SCR-011 only). Both actions render
  disabled with a stated reason (D5); the F02/F06 routes are absent, not
  stubbed.

**Known gap outside this lease (M39, `src/ui/layout/app-shell.module.css`):**
between 900px and 1199px `.railLabel` is `display: none`, which removes it from
the accessibility tree as well as the page, leaving each rail link with no
accessible name (axe `link-name`, WCAG 2.0 A). Desktop and compact are clean.
Recorded as a self-correcting expected-failure in
`tests/e2e/accessibility.spec.ts` and reported as an owner correction.
