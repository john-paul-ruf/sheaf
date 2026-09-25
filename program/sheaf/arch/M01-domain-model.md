# M01 — Domain model (`src/domain/model/`)

Extracted from specs/architecture.md §Module Contracts (Domain model).
Reconciled against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

- **Owns:** Stable identities and immutable semantic facts.
- **Exports (full target):** AppId, TableId, FieldId, RecordId, ChartId,
  EventId, DeviceId, DomainEvent, Provenance, BaselineRef, DurableHomeKind,
  LocalityState.
- **Depends on:** nothing outside the domain. `STORAGE_ID_BYTE_LENGTH` is
  stated locally rather than imported from `src/migrations/`, and
  `tests/unit/codecs/bytes.test.ts` pins it equal to migration 003's
  `STORAGE_ID_BYTES` — so the no-outward-import rule is held without the
  constant being free to drift. **F04:** `src/domain/validation/**` and
  `src/domain/formulas/**` may not name each other's concrete types either;
  M01's F04 event payloads are generic exactly so this holds (below).
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

### `ids.ts` (F02, extended F03, F04)

Per-kind branded `DomainId<K>` over 16 CSPRNG bytes: `AppId`, `TableId`,
`FieldId`, `RecordId`, `EventId`, `CommitId`, `DeviceId`, `SegmentId`,
`OptionId`, `RuleId`, `LineageId`, `SheetId`, `RelationshipId`, `InertItemId`,
`DecisionId` (F03), and — added by F04 — `FormulaId`, `ChartId`;
`DOMAIN_ID_KINDS`, `DOMAIN_ID_BYTE_LENGTH` (16), `DOMAIN_ID_TEXT_LENGTH` (22),
`asDomainId` (the only branding path, length-checked), `createDomainId`,
`encodeDomainId` / `decodeDomainId` (**non-durable** text spelling for map
keys and redacted logs — the durable form is always the raw 16 bytes),
`domainIdsEqual`, `compareDomainIds`, interface `DomainEntropy`.

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

### `schema.ts` (F02, extended F03, F04)

`FieldTypeV1` (closed 11-kind union; `currency` carries `currencyCode`),
`FIELD_TYPE_KINDS`, `StorageKindV1`, `STORAGE_KINDS`, `storageKindForFieldType`,
`expectedCellKindForFieldType`, `FieldDefV1`, `EnumOptionDefV1`, `TableDefV1`.
Both mappings are pinned against migration 005's row `CHECK` by test.

`RELATIONSHIP_DETECTION_SOURCES` (F03, = migration 005's CHECK: `declared`,
`lookup-formula`, `key-match`, `user`) and `RelationshipDefV1 {relationshipId,
fromTableId, fromFieldId, toTableId, toKeyFieldId, detectionSource, isActive,
schemaRevision}`.

**F04:** `FieldDefV1.formulaId?: FormulaId` (absent = authored; retires the F02/F03
"deliberately no isComputed" note) and `isComputedField(field)`.

Known gap with an owner (**closed in F04, see below**): `schema_fields`
(migration 005) had no column for a currency's `currencyCode` — disproved as a
schema defect at F04 planning (PROGRAM-CONFIG's F04 planning note): the code
lives in the encrypted field definition, and the projection keeps a per-session
definition cache updated by `field.changed` (S03 CP1). No DB re-entry was
needed.

### `provenance.ts` (F02)

`ProvenanceSourceV1`, `PROVENANCE_SOURCES` (004's closed six),
`ValueProvenanceV1`, structurally assignable to 004's `EventProvenanceV1`.

### `events.ts` (F02, extended F03, F04)

`F02_EVENT_KINDS` (the eleven kinds F02 authors, a proven subset of 004's
closed catalog), `F02EventKindV1`, `F02EventPayloadsV1`, `F02DomainEventV1`
(kind paired with exactly its own payload), `AuthoredRecordV1`,
`FieldChangeV1` (before **and** after), `AppThemeV1` + `APP_THEME_TOKENS`,
`DELETION_SOURCES`, `INFERENCE_DISPOSITIONS`, `Sha256V1`, and one payload
interface per kind. F03 extends this with `TableCreatedPayloadV1.sourceSheet:
SheetDescriptorV1 | null` and `AppCreatedPayloadV1.relationships`.

**F04 schema events.** `F04_SCHEMA_EVENT_KINDS` (`app.renamed`, `table.changed`,
`field.changed`, `relationship.changed`, `relationship.removed`, `rule.changed`,
`rule.removed`, `formula.changed`, `formula.removed`) — all already in
migration 004's closed list; `DomainEventKindV1`; payload types
`AppRenamedPayloadV1`, `TableChangedPayloadV1<Impact>`,
`FieldChangedPayloadV1<Impact>`, `RelationshipChangedPayloadV1`,
`RelationshipRemovedPayloadV1`, `RuleChangedPayloadV1<Rule>`,
`RuleRemovedPayloadV1<Rule, Impact>`, `FormulaChangedPayloadV1<Formula>`,
`FormulaRemovedPayloadV1<Formula, Impact>`; `TableDefinitionV1` (= `TableDefV1`
minus fields); `FormulaMetadataV1` `{catalogVersion, functionVersions, source,
importedValuePolicy}` with closed `FORMULA_SOURCES` /
`FORMULA_IMPORTED_VALUE_POLICIES`; `F04SchemaEventPayloadsV1<Rule, Formula,
Impact>`; `DomainEventOfV1<Rule, Formula, Impact>`.

**Type-held rule.** M01 may not name M02/M03 (`tests/unit/validation/
module-boundaries.test.ts` refuses even a type-only import from M01), so the
F04 schema payloads are **generic** over rule IR, formula definition and
impact report. The concrete union `DomainEventV1` is instantiated by M07
(`event-repository.ts`) and M12 (`types.ts`) with M02's `ValidationRuleIR |
ValidationRuleIRV2`, M03's `FormulaDefinitionV1` and `Omit<ImpactReportV1,
"patches">`; `tests/unit/workers/projection-port.test.ts` pins the two
instantiations mutually. `F02DomainEventV1` stays exported. No payload can
carry an evaluated value (invariant 7).

**F04 chart events.** `F04_CHART_EVENT_KINDS = ["chart.saved", "chart.deleted"]`
(both already in migration 004), folded into `DomainEventKindV1` and
`DomainEventOfV1` (payload map `F04ChartEventPayloadsV1`). `CHART_PROVENANCES =
["imported", "user"]` (migration 005 `charts.provenance` CHECK), `ChartStateV1`
(`definition, displayName, pinned, ordinal, provenance, chartRevision`),
`ChartSavedPayloadV1` (`ChartStateV1 & {chartId, priorSha256|null}`),
`ChartDeletedPayloadV1` (`{chartId, prior: ChartStateV1}`). Chart payloads are
concrete (M01 owns `ChartDefinitionV1`); a chart is not schema — its commit
leaves `schemaRevision` unchanged.

**F04 theme v2 (D56, CA-32).** `AppThemeV1` gains additive optional `mode`
(`APP_THEME_MODES` light|dark|system, absent = light), `density`
(`APP_THEME_DENSITIES` comfortable|compact, absent = comfortable),
`customAccent` (`#rrggbb`, `isThemeColor`), `logo: AppThemeLogoV1
{mediaType:"image/png", bytes, width, height}` (`APP_LOGO_MAX_EDGE` 256,
`APP_LOGO_MAX_BYTES` 64 KiB). `ThemeChangedPayloadV1 {before: AppThemeV1 |
null, after}`.

**The contrast gate lives here** (Orchestrator ruling, S08 r2 — supersedes CA-32's
original "pure, in M40" plan): `contrastRatio`, `themeRenderings(theme,
darkTokens)`, `evaluateThemeContrast(renderings)` → `ThemeContrastCheckV1[]`,
`THEME_CONTRAST_PAIRS`, `TEXT_CONTRAST_MINIMUM` 4.5 / `NON_TEXT_CONTRAST_MINIMUM`
3, `SYSTEM_FOCUS_COLORS` (Leaf 700 / Sprout 300, pinned to `tokens.css` by
`tests/unit/ui/theme.test.ts`). One pure gate; both M37 (editor verdict) and
M34 (`changeTheme`) call it — M34 may not import `src/ui`, and M40 depends on
nothing, so M01 is the one module both can reach. `src/ui/theme/contrast.ts`
does not exist.

**F04, from S07 (CA-33): inert reason keys.** `chart-not-rebuilt` and
`formula-not-supported` are added to `INERT_REASON_KEYS` and `INERT_REASON_OF`
(mirrored in M65's adapter-side keys, the wire unions in M32, and the copy maps
in M37/M43 — see those fragments' own CA-33 sections).

### `snapshots.ts` (new, F03)

`SHEET_CLASSIFICATIONS` (M12 re-exports it), `SheetDescriptorV1` (+
`classification`, `snapshotRevision`; storage id as text), `CellRangeV1`,
`INERT_ITEM_KINDS` (D40, 16), `INERT_REASON_KEYS` (F04: 10, was 8 — see above),
`InertItemV1`, `DECISION_KINDS` (= 005 CHECK),
`InferenceDecisionRecordV1` (`decisionKind: DecisionKindV1 | null` — null =
not projectable), `IMPORT_KINDS`, `ImportLineageV1`. Pinned against migration
005 in `tests/unit/domain/snapshots.test.ts`.

## Durable-home implementation (F05, current)

`HomeId` and `VaultId` are domain ID kinds. `durable-home.assigned` carries home/vault identity, home kind and app-wrap version.

Source: S01 `694c741` / `13e83f1` / `8674766`, S02 `03ee571` / `c7e6507` / `d75830d` (as applicable to this module); F05 STATE at `95a539d` and Final Report. Scope and remaining owners: [F05 boundaries](F05-boundaries.md).

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
- 2026-09-23 — F04: `FormulaId`/`ChartId`, `filters.ts` and `charts.ts` (see
  `M35-queries.md`/`M45-ui-charts.md` for their consumers) by SESSION-01
  (`50d1c51`..`488f49e`); F04 schema event vocabulary + the generic payload
  types by SESSION-03 (`a69e6e0`..`2235cce`); chart event kinds by SESSION-05
  (`6ee204c`..`3dd1d2d`); CA-33 reason keys by SESSION-07 (`978bb77`..`f9a1565`);
  theme v2 + the contrast gate by SESSION-08 (`42decba`..`7df22fb`); dark-mode
  semantic text-ink roles landed in `M40-ui-theme.md` (M01 itself unaffected —
  the gate function signature did not change) by OWNER-THEME-DARK-SEMANTICS.
  The currency-code carried gap was disproved as a defect at F04 planning (see
  PROGRAM-CONFIG's F04 planning note) and closed by S03 CP1's definition-cache
  refresh on `field.changed` — no M01 or migration change was needed.
- 2026-09-23 — reconciled by Archivist (F04 final pass): six SESSION deltas
  folded into the per-file sections above, in landing order; the contrast-gate
  placement recorded as the module's current contract (superseding CA-32's
  original plan) rather than left as a standalone note; the closed
  currency-code gap removed from "known gaps" and its disposition recorded
  where the gap used to be listed, so a reader does not find a defect note for
  something already fixed.
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.
