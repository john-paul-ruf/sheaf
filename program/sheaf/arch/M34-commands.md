# M34 — Commands (`src/application/commands/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Commands. Reconciled against the tree at `5bc19fb`
> (F04 final; formulas-queries-charts).

## Contract

- **Owns:** The only user-authored mutation entrance.
- **Exports:** `executeCommand`, `CommandV1`, `CommandResultV1`,
  `buildValidationContext`, `rekeyByFields`, `buildAuthoredCommit`,
  `nextHybridTime`, `AuthoredEventDraftV1`, `projectionReferenceResolver`,
  `validateAgainstProjection`, `changeProvenance` (F03), and (F04)
  `previewSchemaChange`, `executeSchemaChange`, `saveChart`, `setChartPin`,
  `deleteChart`, `changeTheme`.
- **Depends on:** domain model/validation/formulas and `src/application/ports/`.
- **Contract:** Validate current state, authorize, create immutable event(s),
  encrypt and commit atomically (via ports), update the unlocked projection,
  then acknowledge. A provider result is never in this critical path
  (invariants 1–2).

## F02 command set

`createRecord`, `patchRecord`, `deleteRecord`, `restoreRecord`. Each builds an
`EventCommitV1` (event codec, CA-08): correct `deviceCommitSequence`, chain
hash, basis frontier, hybrid time, `eventClass: 'authored'`,
`schemaRevisionBefore === schemaRevisionAfter`, `commitSha256`. A validation
failure produces a typed rejected `CommandResult` carrying the
`ValidationReport` — no event is written (D23). Import promotion is
`eventClass: 'import'` and lives on the staging path (M23) — but it calls the
same `validateRecord` (invariant 5).

## Landed surface

`executeCommand(deps, command)`, `CommandV1`, `CommandResultV1` (`accepted` |
`rejected` | `unknown-subject`), `buildValidationContext`, `rekeyByFields`;
`buildAuthoredCommit`, `nextHybridTime`, `AuthoredEventDraftV1`.

- `CommandResultV1.accepted.commit` is `CommitReceiptV1 | null`. **Null means
  a truthful no-op.** `rejected` carries the whole `ValidationReport` (D23);
  `unknown-subject` names `table` | `record` | `deleted-record`.
- Order inside `executeCommand`: resolve real state → `validateRecord` → 
  `repository.append` (durable) → `projection.applyEvents` → acknowledge.
- **Identity re-keying is part of the contract.** `rekeyByFields` puts every
  map on the validation context's own field instances.
- `nextHybridTime` never emits a reading below its predecessor.

**F03 (SESSION-03):** `buildValidationContext` uses the real reference
resolver + `referenceTargets` (D36). `projectionReferenceResolver(projection):
ReferenceResolver` and `validateAgainstProjection(projection, record)` are the
exported building blocks M33's tail-replay path also uses.
`changeProvenance(changes)` derives the provenance a patch validates with —
only the moved fields' provenance, not the whole record's; create/restore
validate with the record's own provenance.

## F04: schema, formula-environment and chart/theme commands

### `schema-commands.ts` (new, SESSION-03)

`previewSchemaChange(deps, request)`, `executeSchemaChange(deps, request,
previewedSchemaRevision)`; `SchemaChangeRequestV1` (D59's 16 kinds +
`set-table-key`, names/clauses/text, never caller-made IDs); typed
`SchemaRefusalV1` (`unknown-subject`, `invalid-change`, `formula` with
best-effort position, `transition`, `validation`); `SEGMENT_LIMITS`. One
preparation serves both preview and apply: `analyzeSchemaChange` over the
projection's live records, `validateSchemaTransition` (refusing only
violations the change introduces), validation of every patched record against
the after-schema (invariant 5), frozen once-evaluation, CA-28 event mapping in
trigger-safe order (field before formula; field type → reference before
relationship). **Apply re-checks `schemaRevision` and refuses a stale
preview** (D57).

`change-field-type` gains optional `optionLabels` (S06 lease r2, CP4a
`3b7ecfa`): when a non-enum field becomes `enum`, the command allocates one
active option per named label (new ids, ordinals as given); options from an
earlier choice-list life stay, inactive, after them. With no label, the
after-schema has no active option and the transition is refused
`schema.enum-field-without-options`, as before. Events land in one commit:
`field.changed` → `enum.changed` (carrying the prior digest when earlier
options exist) → `record.patched` for each rewritten value.

### `formula-env.ts` (new, SESSION-03)

Projection-backed `EvaluationEnvV1`, `frozenLiteral`, `liveResult` — the
adapter that lets `execute-command.ts` evaluate a formula against the live
projection without M34 depending on M12 directly (the env is built from the
`ProjectionEnginePort`, not the concrete engine).

### `execute-command.ts` extensions (SESSION-03)

`commitEvents` exported with `{ issues, rowCountAfter, isSchemaChange }`;
schema commits advance the revision (`buildAuthoredCommit(…,
isSchemaChange)`) and pass `projectionRevalidator`; accepted results carry
`recalculatedFieldIds`; computed fields are not completed as `missing`; a new
record's frozen columns get their literal (provenance `evidence.frozen`);
optional `formulaClock?` dep (absent → UTC day).

### `chart-commands.ts` (new, SESSION-05)

`saveChart` (validated by S01's `validateChartDefinition`; a new chart takes
the next free ordinal at revision 0, provenance `user`; an edit is refused
`stale-chart` unless `expectedRevision` matches the held revision),
`setChartPin` (same definition with the pin flipped; no commit when it
already stands), `deleteChart`, `readChartSchema`; results `saved | deleted |
stale-chart | refused | unknown-chart`. Actual mutations pass through
`commitEvents` (invariant 1); unchanged definitions/pins return no commit.

### `theme-commands.ts` (new, SESSION-08)

`changeTheme` refuses via `judgeTheme` (palette, accent, M01's contrast gate
over every rendered mode) and `inspectLogo` (PNG signature and IHDR
dimensions only, never decoded); writes nothing when the theme is unchanged.
A legacy `sheaf.built-in.v1` app accepts only a built-in palette key.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/import/`, `dexie`, `react`, or sqlite — effects go through the port
  interfaces only. Shipped as `tests/unit/commands/module-boundaries.test.ts`
  (F04: covers `schema-commands.ts`, `formula-env.ts`, `chart-commands.ts`,
  `theme-commands.ts`, with a negative control).

## Durable-home implementation (F05, current)

`buildHomeAssignment` creates one authored commit and rejects an app that already has a home.

Source: S01 `694c741` / `13e83f1` / `8674766`, S02 `03ee571` / `c7e6507` / `d75830d` (as applicable to this module); F05 STATE at `95a539d` and Final Report. Scope and remaining owners: [F05 boundaries](F05-boundaries.md).

## Authored no-change contract (F05)

`SchemaApplyResultV1` includes `unchanged {schemaRevision}`. Unchanged normalized app/table/field names, required flags and existing field order yield no drafts or commit. Revision and validation guards run before no-op acceptance. Identical canonical chart definitions return `saved` with `commit: null`, as an already-set pin does. M32/M33/M37/M54 map no-change honestly; no authored count, history or reminder is manufactured, and historical commits are untouched. Source `59caafb`; paired structure/chart handler tests verify durable no-change and reopen.

Source and current proof scope: [F05 boundaries](F05-boundaries.md), production `47a633b`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-05 (`d47b3d2`): CAP-16/17 verified at
  the worker tier; consumed at the surface tier by SESSION-08 (`5ab3b07`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-05 staple
  folded in; the seeded export list corrected to the landed names.
- 2026-09-23 — F03: real reference resolver + `referenceTargets` by SESSION-03
  (`f29ac33`..`a2c4cf0`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-03 staple
  folded into Landed surface, with its exports added to the head list.
- 2026-09-23 — F04: `schema-commands.ts` and `formula-env.ts` by SESSION-03
  (`a69e6e0`..`2235cce`); `chart-commands.ts` by SESSION-05
  (`6ee204c`..`3dd1d2d`); the `optionLabels` conversion step by SESSION-06
  lease r2 (`3b7ecfa`); `theme-commands.ts` by SESSION-08 (`42decba`..
  `7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): four SESSION deltas
  folded into a new "F04: schema, formula-environment and chart/theme
  commands" section; the head export list and dependency-must-not test
  description updated to name every F04 file.
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
