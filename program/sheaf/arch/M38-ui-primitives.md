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

<!-- foundation-first-unlock SESSION-03 -->
- 2026-09-08 — SESSION-03 landed (final revision `7c9e2f3`). Delta:

### M38 — UI primitives (`src/ui/primitives/`)

Landed. Delta against the seeded fragment:

- **F01 exports** — the seeded list plus the four primitives added by replan
  finding F-03, which the fragment predates: `error-state` (CTL-087
  *recoverable only*), `select-field` (CTL-038), `inline-link` (CTL-020),
  `busy-indicator` (CTL-022/088).
- New shared helper `cx` (`class-names.ts`): reconciles CSS-Module lookups
  (`string | undefined` under `noUncheckedIndexedAccess`) with React Aria
  `className` props (reject `undefined` under `exactOptionalPropertyTypes`).
- `text-field` is the field skeleton `passphrase-field`,
  `recovery-code-field` and `confirmation-phrase-field` compose; only it
  talks to React Aria's `TextField`/`FieldError` wiring.
- **Two fail-closed contracts encoded in types, for later features to widen:**
  - `ButtonProps` — `isDisabled: true` *requires* `disabledReason: string`.
    The must-not "ship a control state without a text equivalent" is now a
    compile error rather than a review note.
  - `BusyIndicatorProps.cancellation` accepts only `"unavailable"`, so no F01
    screen can render a cancel affordance for a KDF derivation that cannot be
    cancelled.
  - `InlineLink` throws on the `externalHandoff` variant: no F01 surface has
    an approved external-handoff affordance (invariant 10).
- **Dependency edges (verified as a test, not a grep):**
  `src/ui/**` imports exactly `react` and `react-aria-components` and nothing
  else non-relative — no persistence, crypto, workers, sync, import, export or
  migrations.

<!-- foundation-first-unlock SESSION-03 (cross-cutting) -->
### Cross-cutting note for later UI sessions

`*.module.css` must avoid **multi-value shorthands containing `var()`**
(e.g. `padding: var(--a) var(--b)`). jsdom's CSSOM drops such declarations
entirely, so any unit assertion about them silently passes against a rule that
was never parsed. Longhands with `var()` survive. Real browsers are unaffected;
this is a test-visibility constraint only.
