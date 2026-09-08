# M01 — Domain model (`src/domain/model/`)

Extracted from specs/architecture.md §Module Contracts (Domain model). F01 scope.

- **Owns:** Stable identities and immutable semantic facts.
- **Exports (full target):** AppId, TableId, FieldId, RecordId, ChartId,
  EventId, DeviceId, DomainEvent, Provenance, BaselineRef, DurableHomeKind,
  LocalityState.
- **F01 subset:** typed error unions (`CodecError`, `CryptoError`,
  `IntegrityError`), branded byte primitives (`StorageId16`, base64url
  helpers, constant-time equals). Event unions and domain IDs arrive in F02.
- **Depends on:** nothing outside the domain.
- **Must not:** import anything outward; user-facing names are values, never
  identifiers; IDs are 16 CSPRNG bytes, stable across rename/re-upload/
  backup/adoption (database.md §Identifiers).

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). No code yet.

<!-- foundation-first-unlock SESSION-02 -->
- 2026-09-08 — SESSION-02 landed (final revision `acca5a8`). Delta:

### M01 — Domain model (`src/domain/model/`) — F01 subset

- `errors.ts`: abstract `DomainError` + `CodecError`, `CryptoError`,
  `IntegrityError` (discriminated by `kind`), `AnyDomainError`, `isDomainError`.
  Messages are fixed reason phrases — never user data or key material.
- `bytes.ts`: branded `StorageId16`, `asStorageId16`, `encodeStorageId16`,
  `decodeStorageId16` (canonical 22-character base64url only),
  `encodeBase64Url`, `decodeBase64Url`, `constantTimeEquals`,
  `STORAGE_ID_BYTE_LENGTH`, `STORAGE_ID_TEXT_LENGTH`.

M01 still imports nothing outward: `STORAGE_ID_BYTE_LENGTH` is stated locally
rather than imported from `src/migrations/`, and
`tests/unit/codecs/bytes.test.ts` pins it equal to migration 003's
`STORAGE_ID_BYTES`.
