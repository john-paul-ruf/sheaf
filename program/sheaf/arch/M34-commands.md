# M34 — Commands (`src/application/commands/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Commands. Reconciled against the tree at `5ab3b07`
> (F02 final).

## Contract

- **Owns:** The only user-authored mutation entrance.
- **Exports:** `executeCommand`, `CommandV1`, `CommandResultV1`,
  `buildValidationContext`, `rekeyByFields`, `buildAuthoredCommit`,
  `nextHybridTime`, `AuthoredEventDraftV1`.
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
`ValidationReport` — no event is written, and the rejection is a **result**,
not a transport error (D23). Import promotion is `eventClass: 'import'` and
lives on the staging path (M23) — but it calls the same `validateRecord`
(invariant 5).

## Landed surface (F02, S05)

`executeCommand(deps, command)`, `CommandV1` (`create-record` |
`patch-record` | `delete-record` | `restore-record`), `CommandResultV1`
(`accepted` | `rejected` | `unknown-subject`), `buildValidationContext`,
`rekeyByFields`; `buildAuthoredCommit`, `nextHybridTime`,
`AuthoredEventDraftV1`.

- `CommandResultV1.accepted.commit` is `CommitReceiptV1 | null`. **Null means a
  truthful no-op** — a patch in which no field moved, or a restore of a record
  that is already present — and no event was written. `rejected` carries the
  whole `ValidationReport` (D23); `unknown-subject` names `table` | `record` |
  `deleted-record` and is a result, not an error.
- Order inside `executeCommand`: resolve real state → `validateRecord` (a
  blocking issue ends it, **no event is built**) → `repository.append` (durable)
  → `projection.applyEvents` → acknowledge (invariant 1).
- **Identity re-keying is part of the contract.** `validateRecord` reads values
  and enum option sets through `Map.get(field.fieldId)`, which matches on object
  identity, and every projection query returns freshly decoded ids. `rekeyByFields`
  puts every map on the validation context's own field instances and leaves an
  unknown id as it arrived so the validator's unknown-field check still fires.
- `nextHybridTime` never emits a reading below its predecessor; equal wall
  clocks advance the logical counter, because the chain guard verifies commits
  in canonical `(wall time, logical counter, …)` order.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/import/`, `dexie`, `react`, or sqlite — effects go through the port
  interfaces only. Shipped as `tests/unit/commands/module-boundaries.test.ts`,
  which sweeps `commands/`, `queries/` and `ports/`; ports may name only the
  domain, migrations, and each other.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-05 (`d47b3d2`): CAP-16/17 verified at the
  worker tier, restart re-read included; consumed at the surface tier by
  SESSION-08 (`5ab3b07`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-05 staple folded
  in; the seeded export list corrected to the landed names (`Command`,
  `CommandResult`, `CommitConfirmed` never shipped under those spellings).

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**M34 — Commands**
- `buildValidationContext` uses the real resolver + `referenceTargets`; exported `projectionReferenceResolver(projection): ReferenceResolver`, `validateAgainstProjection(projection, record)`, `changeProvenance(changes)`. Patch validates with the provenance of the moved fields only; create/restore with the record's provenance.
