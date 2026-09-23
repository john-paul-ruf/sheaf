# M38 — UI primitives (`src/ui/primitives/`)

Extracted from specs/architecture.md §Module Contracts (UI primitives, layout,
and theme). Reconciled against the tree at `5bc19fb` (F04 final;
formulas-queries-charts).

- **Owns:** Accessible interactions and semantic visual states for CTL IDs.
- **Exports (landed):** `button` (CTL-014), `text-field`,
  `passphrase-field` (CTL-026/027), `recovery-code-field` (CTL-028),
  `confirmation-phrase-field` (CTL-029), `recovery-code-card` (CTL-096),
  `secret-scope-label` (CTL-097), `strength-meter` (CTL-098),
  `encryption-callout` (CTL-099), `consequences-list` (CTL-100), `dialog`
  (trap/restore, destructive no-outside-close), `status-banner`, `error-state`
  (CTL-087, *recoverable variant only*), `select-field` (CTL-038),
  `inline-link` (CTL-020), `busy-indicator` (CTL-022/088), and (F03)
  `checkbox` (CTL-043).
- **Shared internals:** `class-names.ts` (`cx`); `visually-hidden.module.css`.
- `text-field` is the field skeleton that `passphrase-field`,
  `recovery-code-field` and `confirmation-phrase-field` compose.
- **Depends on:** React Aria, React, screen-safe view-model types only.
- **Must not:** import persistence/crypto/parser/provider/worker code; carry
  product workflow; allow app themes to recolor safety semantics; ship a
  control state without a text equivalent; targets under 44px.

## Fail-closed contracts encoded in types

- `ButtonProps` and (F03) `CheckboxProps` — `isDisabled: true` *requires*
  `disabledReason: string`, the same type-held contract on both controls.
- `BusyIndicatorProps.cancellation` accepts only `"unavailable"`.
- `InlineLink` throws on the `externalHandoff` variant (still true at F04 —
  see the backlog below).
- Dependency edges are **verified as a test, not a grep**:
  `tests/unit/ui/architecture.test.ts` asserts `src/ui/**` imports exactly
  `react` and `react-aria-components` and nothing else non-relative.

## `checkbox.tsx` (F03, SESSION-07)

React Aria `Checkbox` (CTL-043); the whole row is the 44px target;
`isDisabled` requires `disabledReason`, matching `Button`'s contract. No
CTL-068 wrapper was needed for SCR-017's app-choice list — those are CTL-044
radios, a different backlog item (below).

`TextField` (F03, SESSION-08) gains an optional `inputId`, so a caller can
move focus to the input (the SHT-016 "Find in sheet" option).

## States deliberately not built (later features, stated in file headers)

Not design-fill seams: CTL-087's blocked-input / provider / storage /
unknown-local variants; CTL-022's cancellation-available variant; CTL-088's
determinate progress; CTL-014's busy state (routed to `BusyIndicator`).

## Backlog (owners: the next session holding this lease)

F02's UI sessions did not hold `src/ui/primitives/`, so three controls were
composed inside their feature modules instead; neither F03's nor F04's UI
sessions held it either (F03 only touched this module to *add*
`checkbox.tsx` and `TextField.inputId`; F04 confirmed it **unchanged** — no
F04 session leased or edited any file in this directory, per `git diff --stat`
against the base revision):

- **CTL-044** (radio choice with a disabled state) — still composed in M43
  from React Aria's `RadioGroup`/`Radio` for SCR-017's destination choice.
  Unchanged by F03/F04.
- **`TextArea`** — the review screen's enum-options editor, same situation.
  Unchanged by F03/F04.
- **`InlineLink`'s `externalHandoff` still throws.** F03 built its own
  reference-picker and maps-style handoffs (M44) without needing this
  primitive either; F04's charts and schema editors likewise route around it
  (chart-mark filters, structure-editor dialogs). Whoever writes it must keep
  invariant 10's "no unapproved handoff" property the throw stands in for.

## Cross-cutting note for later UI sessions

`*.module.css` must avoid **multi-value shorthands containing `var()`**.
jsdom's CSSOM drops such declarations entirely. Real browsers are unaffected;
this is a test-visibility constraint only.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-03 via Enso (`7c9e2f3`). All four F-03
  primitives gated at CP3; 171 unit tests green.
- 2026-09-08 — consumed unchanged by SESSION-07 (`9174b6d`, re-run at
  `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): head export list
  corrected to include the four replan-finding primitives; staple merged.
- 2026-09-08 — F02: consumed unchanged again by SESSION-07/08; no primitive
  was edited in the whole feature.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the three-item backlog
  recorded from SESSION-07/08's returns.
- 2026-09-23 — F03: `checkbox.tsx` (CTL-043) landed by SESSION-07 (`2185774`..
  `e062f41`); `TextField.inputId` added by SESSION-08 (`eba5790`..`30396a9`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): two staples folded
  into their own sections; the backlog carried forward unchanged with a note
  that F03 added to this module without closing any of its three items —
  each F03 UI session found a different, real reason to touch
  `src/ui/primitives/` without the backlog's three controls being in its way.
- 2026-09-23 — F04: sessions S04/S05/S06 each confirmed this module
  unchanged. **A correction actually describing M02/M32/M33/M34/M37/M46**
  (the Text → Choice list / rule-sentence copy fix, S06 lease r2, CP4a
  `3b7ecfa`) was mistakenly staple-appended to this fragment as well, under a
  bare `## Lease r2` heading with no module content of its own.
- 2026-09-23 — reconciled by Archivist (F04 final pass): the misfiled lease-r2
  delta **removed** from this fragment. Its content covers six modules; four
  (M02, M32, M33, M34) already carried it independently, so only the two that
  did not — `M37-view-models.md` (the `toIssueVm`/rule-sentence copy) and
  `M46-ui-schema.md` (the `field-editor.tsx` named-choices UI) — received it
  during this reconciliation. See PROGRAM-CONFIG's fragment-reconciliation
  note, which now records this as F04's first "delta describing another
  module" instance since F02. `git diff --stat 237732e..5bc19fb --
  src/ui/primitives` confirms zero lines changed in this directory across the
  whole feature, corroborating that the misfile carried no real M38 content
  to lose.
