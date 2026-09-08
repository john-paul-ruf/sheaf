# M38 — UI primitives (`src/ui/primitives/`)

Extracted from specs/architecture.md §Module Contracts (UI primitives, layout,
and theme). F01 scope.

- **Owns:** Accessible interactions and semantic visual states for CTL IDs.
- **F01 exports:** button, text-field, passphrase-field (CTL-026/027),
  recovery-code-field (CTL-028), confirmation-phrase-field (CTL-029),
  recovery-code-card (CTL-096), secret-scope-label (CTL-097), strength-meter
  (CTL-098), encryption-callout (CTL-099), consequences-list (CTL-100),
  dialog (trap/restore, destructive no-outside-close), status-banner.
- **Depends on:** React Aria, React, screen-safe view-model types only.
- **Must not:** import persistence/crypto/parser/provider/worker code; carry
  product workflow; allow app themes to recolor safety semantics; ship a
  control state without a text equivalent; targets under 44px.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-03.
