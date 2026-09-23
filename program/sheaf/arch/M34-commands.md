# M34 — Commands (`src/application/commands/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Commands. Reconciled against the tree at `425562d`
> (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** The only user-authored mutation entrance.
- **Exports:** `executeCommand`, `CommandV1`, `CommandResultV1`,
  `buildValidationContext`, `rekeyByFields`, `buildAuthoredCommit`,
  `nextHybridTime`, `AuthoredEventDraftV1`, and (F03)
  `projectionReferenceResolver`, `validateAgainstProjection`,
  `changeProvenance`.
- **Depends on:** domain model/validation (+policy/formulas when they exist)
  and `src/application/ports/`.
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

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/import/`, `dexie`, `react`, or sqlite — effects go through the port
  interfaces only. Shipped as `tests/unit/commands/module-boundaries.test.ts`.

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

<!-- formulas-queries-charts SESSION-03 -->
### F04 delta — SESSION-03 (M34 — Commands (`src/application/commands/`))

- New `schema-commands.ts`: `previewSchemaChange(deps, request)`, `executeSchemaChange(deps, request, previewedSchemaRevision)`; `SchemaChangeRequestV1` (D59 + `set-table-key`, names/clauses/text, never caller-made IDs); typed `SchemaRefusalV1` (`unknown-subject`, `invalid-change`, `formula` with best-effort position, `transition`, `validation`); `SEGMENT_LIMITS`. One preparation serves both: `analyzeSchemaChange` over the projection's live records, `validateSchemaTransition` (refusing only violations the change introduces), validation of every patched record against the after-schema (invariant 5), frozen once-evaluation, CA-28 event mapping in trigger-safe order (field before formula; field type → reference before relationship).
- New `formula-env.ts`: projection-backed `EvaluationEnvV1`, `frozenLiteral`, `liveResult`.
- `execute-command.ts`: `commitEvents` exported with `{ issues, rowCountAfter, isSchemaChange }`; schema commits advance the revision (`buildAuthoredCommit(…, isSchemaChange)`) and pass `projectionRevalidator`; accepted results carry `recalculatedFieldIds`; computed fields are not completed as `missing`; a new record's frozen columns get their literal (provenance `evidence.frozen`); `formulaClock?` dep (absent → UTC day).
- Commands sweep has a negative control and covers the new files.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M34 commands — `src/application/commands/chart-commands.ts` (new))

- `saveChart` (L91; validated by S01 `validateChartDefinition`, new chart → next free ordinal, revision 0, provenance `user`; edit → `stale-chart` unless `expectedRevision` matches), `setChartPin` (L143; same definition with the pin flipped, no commit when it already stands), `deleteChart` (L160), `readChartSchema`; results `saved | deleted | stale-chart | refused | unknown-chart`. All through `commitEvents` (invariant 1).
