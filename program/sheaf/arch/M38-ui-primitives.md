# M38 — UI primitives (`src/ui/primitives/`)

Extracted from specs/architecture.md §Module Contracts (UI primitives, layout,
and theme). F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Accessible interactions and semantic visual states for CTL IDs.
- **F01 exports (landed):** `button` (CTL-014), `text-field`,
  `passphrase-field` (CTL-026/027), `recovery-code-field` (CTL-028),
  `confirmation-phrase-field` (CTL-029), `recovery-code-card` (CTL-096),
  `secret-scope-label` (CTL-097), `strength-meter` (CTL-098),
  `encryption-callout` (CTL-099), `consequences-list` (CTL-100), `dialog`
  (trap/restore, destructive no-outside-close), `status-banner` — **plus the
  four primitives added by replan finding F-03**: `error-state` (CTL-087,
  *recoverable variant only*), `select-field` (CTL-038), `inline-link`
  (CTL-020), `busy-indicator` (CTL-022/088).
- **Shared internals:** `class-names.ts` (`cx`) reconciles CSS-Module lookups
  (`string | undefined` under `noUncheckedIndexedAccess`) with React Aria
  `className` props (which reject `undefined` under
  `exactOptionalPropertyTypes`); `visually-hidden.module.css` is the one
  visually-hidden treatment, shared by `busy-indicator`, `passphrase-field`
  and M41's `frames.tsx`.
- `text-field` is the field skeleton that `passphrase-field`,
  `recovery-code-field` and `confirmation-phrase-field` compose; only it talks
  to React Aria's `TextField`/`FieldError` wiring.
- **Depends on:** React Aria, React, screen-safe view-model types only.
- **Must not:** import persistence/crypto/parser/provider/worker code; carry
  product workflow; allow app themes to recolor safety semantics; ship a
  control state without a text equivalent; targets under 44px.

## Fail-closed contracts encoded in types

Later features may widen these; none may quietly drop them.

- `ButtonProps` — `isDisabled: true` *requires* `disabledReason: string`. The
  must-not "ship a control state without a text equivalent" is a compile error,
  not a review note.
- `BusyIndicatorProps.cancellation` accepts only `"unavailable"`, so no F01
  screen can render a cancel affordance for a KDF derivation that cannot be
  cancelled.
- `InlineLink` throws on the `externalHandoff` variant: no F01 surface has an
  approved external-handoff affordance (invariant 10).
- Dependency edges are **verified as a test, not a grep**:
  `tests/unit/ui/architecture.test.ts` asserts `src/ui/**` imports exactly
  `react` and `react-aria-components` and nothing else non-relative — no
  persistence, crypto, workers, sync, import, export, migrations, and no
  state-machine runtime.

## States deliberately not built (later features, stated in file headers)

Not design-fill seams: CTL-087's blocked-input / provider / storage /
unknown-local variants; CTL-022's cancellation-available variant; CTL-088's
determinate progress; CTL-014's busy state (routed to `BusyIndicator`);
CTL-020's external handoff (throws).

## Cross-cutting note for later UI sessions

`*.module.css` must avoid **multi-value shorthands containing `var()`**
(e.g. `padding: var(--a) var(--b)`). jsdom's CSSOM drops such declarations
entirely, so any unit assertion about them silently passes against a rule that
was never parsed. Longhands with `var()` survive. Real browsers are unaffected;
this is a test-visibility constraint only.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-03 via Enso (`7c9e2f3`). All four F-03
  primitives gated at CP3; 171 unit tests green. Evidence is jsdom-only by
  envelope decree — axe, 320px, 200% text and live breakpoint switching are
  SESSION-07's e2e evidence.
- 2026-09-08 — consumed unchanged by SESSION-07 (`9174b6d`, re-run at
  `2c0248a`); no primitive needed amendment.
- 2026-09-08 — reconciled by Roshi (final pass): head export list corrected to
  include the four F-03 primitives (the seeded list predated the replan);
  session-delta staple merged.
