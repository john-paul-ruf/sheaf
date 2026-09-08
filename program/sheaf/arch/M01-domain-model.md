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
