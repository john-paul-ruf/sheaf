# M01 — Domain model (`src/domain/model/`)

Extracted from specs/architecture.md §Module Contracts (Domain model). F01
scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Stable identities and immutable semantic facts.
- **Exports (full target):** AppId, TableId, FieldId, RecordId, ChartId,
  EventId, DeviceId, DomainEvent, Provenance, BaselineRef, DurableHomeKind,
  LocalityState.
- **F01 subset (landed):**
  - `errors.ts` — abstract `DomainError` + `CodecError`, `CryptoError`,
    `IntegrityError` (discriminated by `kind`), `AnyDomainError`,
    `isDomainError`. Messages are fixed reason phrases — never user data or key
    material.
  - `bytes.ts` — branded `StorageId16`, `asStorageId16`, `encodeStorageId16`,
    `decodeStorageId16` (canonical 22-character base64url only),
    `encodeBase64Url`, `decodeBase64Url`, `constantTimeEquals`,
    `STORAGE_ID_BYTE_LENGTH`, `STORAGE_ID_TEXT_LENGTH`.
  - Event unions and domain IDs arrive in F02.
- **Depends on:** nothing outside the domain. `STORAGE_ID_BYTE_LENGTH` is
  stated locally rather than imported from `src/migrations/`, and
  `tests/unit/codecs/bytes.test.ts` pins it equal to migration 003's
  `STORAGE_ID_BYTES` — so the no-outward-import rule is held without the
  constant being free to drift.
- **Must not:** import anything outward; user-facing names are values, never
  identifiers; IDs are 16 CSPRNG bytes, stable across rename/re-upload/
  backup/adoption (database.md §Identifiers).

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 subset implemented by SESSION-02 (`acca5a8`).
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged
  into the contract above.
