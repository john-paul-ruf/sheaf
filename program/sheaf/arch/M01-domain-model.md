# M01 — Domain model (`src/domain/model/`)

Extracted from specs/architecture.md §Module Contracts (Domain model).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

- **Owns:** Stable identities and immutable semantic facts.
- **Exports (full target):** AppId, TableId, FieldId, RecordId, ChartId,
  EventId, DeviceId, DomainEvent, Provenance, BaselineRef, DurableHomeKind,
  LocalityState.
- **Depends on:** nothing outside the domain. `STORAGE_ID_BYTE_LENGTH` is
  stated locally rather than imported from `src/migrations/`, and
  `tests/unit/codecs/bytes.test.ts` pins it equal to migration 003's
  `STORAGE_ID_BYTES` — so the no-outward-import rule is held without the
  constant being free to drift.
- **Must not:** import anything outward; user-facing names are values, never
  identifiers; IDs are 16 CSPRNG bytes, stable across rename/re-upload/
  backup/adoption (database.md §Identifiers).

## Landed surface

### `errors.ts` (F01)

Abstract `DomainError` + `CodecError`, `CryptoError`, `IntegrityError`
(discriminated by `kind`), `AnyDomainError`, `isDomainError`. Messages are
fixed reason phrases — never user data or key material.

### `bytes.ts` (F01)

Branded `StorageId16`, `asStorageId16`, `encodeStorageId16`,
`decodeStorageId16` (canonical 22-character base64url only), `encodeBase64Url`,
`decodeBase64Url`, `constantTimeEquals`, `STORAGE_ID_BYTE_LENGTH`,
`STORAGE_ID_TEXT_LENGTH`.

### `ids.ts` (F02, extended F03)

Per-kind branded `DomainId<K>` over 16 CSPRNG bytes: `AppId`, `TableId`,
`FieldId`, `RecordId`, `EventId`, `CommitId`, `DeviceId`, `SegmentId`,
`OptionId`, `RuleId`, `LineageId`, `SheetId`, and — added by F03 —
`RelationshipId`, `InertItemId`, `DecisionId`; `DOMAIN_ID_KINDS`,
`DOMAIN_ID_BYTE_LENGTH` (16), `DOMAIN_ID_TEXT_LENGTH` (22), `asDomainId` (the
only branding path, length-checked), `createDomainId`, `encodeDomainId` /
`decodeDomainId` (**non-durable** text spelling for map keys and redacted logs —
the durable form is always the raw 16 bytes), `domainIdsEqual`,
`compareDomainIds`, interface `DomainEntropy`.

`DomainEntropy` is stated structurally (M07's `EntropyPort` satisfies it) so M01
keeps importing nothing outward. `compareDomainIds` takes plain `Uint8Array` on
purpose: migration 004's wire IDs sort through this one comparator instead of a
second copy inside M09.

**Consumer note (S02, proven in the projection):** a `Map<DomainId, …>` matches
on **object identity**, not on byte equality. Any code keying a map by a domain
ID must re-key to the schema's own ID instances (M12's `query-exec` does), and
`validateRecord`'s `record.values.get(fieldId)` is subject to the same rule.

### `values.ts` (F02)

`CellValueV1` (text / decimal / date / boolean / enum / reference / **missing /
blank / invalid-preserved as three distinct states**), `CELL_VALUE_KINDS`,
constructors (`textValue`, `decimalValue`, `dateValue`, `booleanValue`,
`enumValue`, `referenceValue`, `invalidPreservedValue`, `MISSING_VALUE`,
`BLANK_VALUE`), `isNfcText`, `isCanonicalDecimal`, `canonicalizeDecimal`,
`isAbsentCellValue`, `cellValuesEqual`, `DECIMAL_SIGNIFICANT_DIGIT_LIMIT` (34),
`MIN_EPOCH_DAY` / `MAX_EPOCH_DAY` (±100,000,000 — a **signed** domain; readers
of the durable form must decode signed, see M23).

Text is refused unless NFC; **normalization machinery lives at the entry
boundaries (D28), not here.** The only decimal rewrite is negative zero losing
its sign; exponent, leading-zero, and bare-point spellings are rejected rather
than reinterpreted.

### `schema.ts` (F02, extended F03)

`FieldTypeV1` (closed 11-kind union; `currency` carries `currencyCode`),
`FIELD_TYPE_KINDS`, `StorageKindV1`, `STORAGE_KINDS`, `storageKindForFieldType`,
`expectedCellKindForFieldType`, `FieldDefV1`, `EnumOptionDefV1`, `TableDefV1`.
Both mappings are pinned against migration 005's row `CHECK` by test.
`FieldDefV1` deliberately declares no `isComputed`/`formulaId` — F04 adds the
pair with its producer.

F03 adds `RELATIONSHIP_DETECTION_SOURCES` (= migration 005's CHECK: `declared`,
`lookup-formula`, `key-match`, `user`) and `RelationshipDefV1 {relationshipId,
fromTableId, fromFieldId, toTableId, toKeyFieldId, detectionSource, isActive,
schemaRevision}`.

Known gap with an owner: `schema_fields` (migration 005) has no column for a
currency's `currencyCode`, so the type cannot round-trip through the projection —
`list-fields` refuses rather than guesses. First hurt is F04's schema editor;
routed to a DB re-entry at F04 planning. Unchanged by F03.

### `provenance.ts` (F02)

`ProvenanceSourceV1`, `PROVENANCE_SOURCES` (004's closed six),
`ValueProvenanceV1`, structurally assignable to 004's `EventProvenanceV1`.

### `events.ts` (F02, extended F03)

`F02_EVENT_KINDS` (the eleven kinds F02 authors, a proven subset of 004's
closed catalog), `F02EventKindV1`, `F02EventPayloadsV1`, `F02DomainEventV1`
(kind paired with exactly its own payload), `AuthoredRecordV1`,
`FieldChangeV1` (before **and** after), `AppThemeV1` + `APP_THEME_TOKENS`,
`DELETION_SOURCES`, `INFERENCE_DISPOSITIONS`, `Sha256V1`, and one payload
interface per kind. F03 extends this with `TableCreatedPayloadV1.sourceSheet:
SheetDescriptorV1 | null` and `AppCreatedPayloadV1.relationships`.

### `snapshots.ts` (new, F03)

`SHEET_CLASSIFICATIONS` (M12 re-exports it), `SheetDescriptorV1` (+
`classification`, `snapshotRevision`; storage id as text), `CellRangeV1`,
`INERT_ITEM_KINDS` (D40, 16), `INERT_REASON_KEYS` (closed: formula-not-live-yet,
chart-not-live-yet, object-not-rendered, link-not-followed,
script-never-runs, formatting-not-reproduced, validation-not-expressible,
kept-in-source), `InertItemV1`, `DECISION_KINDS` (= 005 CHECK),
`InferenceDecisionRecordV1` (`decisionKind: DecisionKindV1 | null` — null =
not projectable), `IMPORT_KINDS`, `ImportLineageV1`. Pinned against migration
005 in `tests/unit/domain/snapshots.test.ts`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 subset implemented by SESSION-02 (`acca5a8`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): session-delta staple merged
  into the contract above.
- 2026-09-08 — F02 `ids.ts`/`values.ts`/`schema.ts`/`provenance.ts`/`events.ts`
  implemented by SESSION-01 (`3ffee63`); `MIN/MAX_EPOCH_DAY`'s signed domain
  re-proven through OWNER-M23-EPOCHDAY (`3a8499e`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the F01 "event unions and
  domain IDs arrive in F02" placeholder is superseded and removed; the landed
  surface is stated once, above.
- 2026-09-23 — F03: `ids.ts`/`schema.ts`/`events.ts` extended and new
  `snapshots.ts` landed by SESSION-03 (`f29ac33`..`a2c4cf0`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-03 staple
  folded into the per-file sections above; nothing contradicted.

<!-- formulas-queries-charts SESSION-01 -->
### F04 delta — SESSION-01 (M01 — Domain model (`arch/M01-domain-model.md`))

- `ids.ts`: `DOMAIN_ID_KINDS` += `formula`, `chart`; `FormulaId`, `ChartId`.
- `schema.ts`: `FieldDefV1.formulaId?: FormulaId` (absent = authored; the "deliberately no isComputed" note is retired);
  `isComputedField(field)`.
- New `filters.ts` (CA-29): `FilterV1 {fieldId, operand: FilterOperandV1}` (enum-in, date-range, number-range, boolean-is,
  reference-in, reference-broken, text-contains, text-equals, is-empty, not-empty), `validateFilter(filter, table,
  enumOptions) → FilterRefusalV1 | null` (`FILTER_REFUSAL_REASONS`), `compareCanonicalDecimals`.
- New `charts.ts` (D54, CA-30): `CHART_TYPES` (pinned to migration 005), `ChartDefinitionV1` (grouped: `groupBy`,
  `seriesBy`, `measure`, `sort`; or `scatter{x, y}`), `GroupingV1` (field | related-field{relationshipId, referenceFieldId,
  fieldId} | date{unit}), `MeasureV1`, `ChartSchemaV1`, `validateChartDefinition(def, schema) → ChartRefusalV1[]`,
  `ChartCategoryV1`, `markFilterIntent(def, category) → FilterV1 | null`.

<!-- formulas-queries-charts SESSION-03 -->
### F04 delta — SESSION-03 (M01 — Domain model (`src/domain/model/events.ts`))

- Adds `F04_SCHEMA_EVENT_KINDS` (app.renamed, table.changed, field.changed, relationship.changed, relationship.removed, rule.changed, rule.removed, formula.changed, formula.removed) — all already in migration 004's closed list; `DomainEventKindV1`; payload types `AppRenamedPayloadV1`, `TableChangedPayloadV1<Impact>`, `FieldChangedPayloadV1<Impact>`, `RelationshipChangedPayloadV1`, `RelationshipRemovedPayloadV1`, `RuleChangedPayloadV1<Rule>`, `RuleRemovedPayloadV1<Rule, Impact>`, `FormulaChangedPayloadV1<Formula>`, `FormulaRemovedPayloadV1<Formula, Impact>`; `TableDefinitionV1` (= TableDefV1 minus fields); `FormulaMetadataV1` {catalogVersion, functionVersions, source, importedValuePolicy} with closed `FORMULA_SOURCES` / `FORMULA_IMPORTED_VALUE_POLICIES`; `F04SchemaEventPayloadsV1<Rule, Formula, Impact>`; `DomainEventOfV1<Rule, Formula, Impact>`.
- **Type-held rule:** M01 may not name M02/M03 (the S01 domain sweep `tests/unit/validation/module-boundaries.test.ts` refuses even a type-only import), so the F04 payloads are **generic** over rule IR, formula definition and impact report. The concrete union `DomainEventV1` is instantiated by M07 (`event-repository.ts`) and M12 (`types.ts`) with M02's `ValidationRuleIR | ValidationRuleIRV2`, M03's `FormulaDefinitionV1` and `Omit<ImpactReportV1, "patches">`; `tests/unit/workers/projection-port.test.ts` pins the two instantiations mutually. `F02DomainEventV1` stays exported. No payload can carry an evaluated value (invariant 7).

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M01 domain model — `src/domain/model/events.ts`)

- `F04_CHART_EVENT_KINDS = ["chart.saved", "chart.deleted"]` (L276, both already in migration 004), folded into `DomainEventKindV1` and `DomainEventOfV1` (payload map `F04ChartEventPayloadsV1`).
- `CHART_PROVENANCES = ["imported", "user"]` (L380, migration 005 `charts.provenance` CHECK), `ChartStateV1` (L389: `definition, displayName, pinned, ordinal, provenance, chartRevision`), `ChartSavedPayloadV1` (L401: `ChartStateV1 & {chartId, priorSha256|null}`), `ChartDeletedPayloadV1` (L408: `{chartId, prior: ChartStateV1}`). Chart payloads are concrete (M01 owns `ChartDefinitionV1`); a chart is not schema — its commit leaves `schemaRevision` unchanged.

<!-- formulas-queries-charts SESSION-07 -->
### F04 delta — SESSION-07 (M01 / M32 / M33 — domain snapshots, worker protocol, data handlers)

- CA-33: `chart-not-rebuilt` and `formula-not-supported` are added to PRESERVED/INERT reason keys, `INERT_REASON_OF`, both wire unions and the copy maps.
- `import-handlers.ts`: refreshes formulas after rejection memory. The proposal wire carries formulas, charts and rules.
