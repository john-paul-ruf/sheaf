# M01 — Domain model (`src/domain/model/`)

Extracted from specs/architecture.md §Module Contracts (Domain model).
Reconciled against the tree at `5ab3b07` (F02 final).

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

### `ids.ts` (F02)

Per-kind branded `DomainId<K>` over 16 CSPRNG bytes: `AppId`, `TableId`,
`FieldId`, `RecordId`, `EventId`, `CommitId`, `DeviceId`, `SegmentId`,
`OptionId`, `RuleId`, `LineageId`, `SheetId`, `AnyDomainId`; `DOMAIN_ID_KINDS`,
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

### `schema.ts` (F02)

`FieldTypeV1` (closed 11-kind union; `currency` carries `currencyCode`),
`FIELD_TYPE_KINDS`, `StorageKindV1`, `STORAGE_KINDS`, `storageKindForFieldType`,
`expectedCellKindForFieldType`, `FieldDefV1`, `EnumOptionDefV1`, `TableDefV1`.
Both mappings are pinned against migration 005's row `CHECK` by test.
**`FieldDefV1` deliberately declares no `isComputed`/`formulaId`**: F02 has no
formula engine, so a writer cannot assert a computed field nothing can evaluate
(invariant 7); the projection writes `is_computed = 0` and F04 adds the pair
with its producer.

Known gap with an owner: `schema_fields` (migration 005) has no column for a
currency's `currencyCode`, so the type cannot round-trip through the projection —
`list-fields` refuses rather than guesses. First hurt is F04's schema editor;
routed to a DB re-entry at F04 planning.

### `provenance.ts` (F02)

`ProvenanceSourceV1`, `PROVENANCE_SOURCES` (004's closed six),
`ValueProvenanceV1`, structurally assignable to 004's `EventProvenanceV1`
(asserted by test; the reverse direction is intentionally not assignable, since
widening bytes to a branded ID must go through `asDomainId`).

### `events.ts` (F02)

`F02_EVENT_KINDS` (the eleven kinds this feature authors, a proven subset of
004's closed catalog), `F02EventKindV1`, `F02EventPayloadsV1`,
`F02DomainEventV1` (kind paired with exactly its own payload),
`AuthoredRecordV1`, `FieldChangeV1` (before **and** after, so a patch reads
backwards), `AppThemeV1` + `APP_THEME_TOKENS` (design.md's six semantic app
tokens; safety semantics are absent by construction), `DELETION_SOURCES`,
`INFERENCE_DISPOSITIONS`, `Sha256V1`, and one payload interface per kind.
Events that must not exist have no type here.

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
