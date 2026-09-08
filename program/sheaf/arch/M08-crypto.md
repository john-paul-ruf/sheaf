# M08 — Cryptography (`src/crypto/`)

Extracted from specs/architecture.md §Module Contracts (Cryptography) + §Local
Key Hierarchy and At-Rest Format. F01 scope.

- **Owns:** All clear-key creation/derivation/use and every encrypted envelope.
- **F01 exports:** sodium bootstrap + `wipe`; Argon2id derive + `calibrateKdf`
  (floor 65536 KiB / 3 iter / 1 lane / 32B out, calibrated to ~500–800ms);
  HKDF-SHA-256 (D3: `crypto_kdf_hkdf_sha256` or RFC 5869 over hmacsha256);
  `generateLocalRoot` → opaque `LocalRootKeyHandle`; `wrapRoot`/`unwrapRoot`
  (XChaCha20-Poly1305, `WrappedLocalRootV1` shape from migration 001);
  recovery-code generate/format/parse (256-bit grouped Base32 + checksum);
  `encryptEnvelope`/`decryptEnvelope` (migration-003 frame, padding buckets,
  AAD per CA-02).
- **Depends on:** libsodium (`libsodium-wrappers-sumo`) and platform entropy
  only. Constants imported from `src/migrations/003_envelope_format_v1.js`.
- **Must not:** export key bytes (opaque handles only); persist anything;
  import Dexie/envelope-store/UI. Same passphrase across scopes must derive
  unrelated keys via independent salts + domain contexts.
- **AAD (CA-02, D6):** canonical CBOR `["sheaf", scope(tstr),
  storageId(bstr16), codecVersion(uint), cipherSuiteVersion(uint),
  logicalRevision(uint64)]`; locked by
  `tests/fixtures/vaults/local-v1/envelope-kat.json`.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-02.
