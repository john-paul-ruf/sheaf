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

<!-- foundation-first-unlock SESSION-02 -->
- 2026-09-08 — SESSION-02 landed (final revision `acca5a8`). Delta:

### M08 — Cryptography (`src/crypto/`) — first implementation

**Public API landed**

- `sodium.ts`: `loadSodium()`, `wipe(view)`, type `Sodium`.
- `keys.ts`: opaque `SecretKeyHandle` / `LocalRootKeyHandle` (bytes in a
  module-private `WeakMap`; a handle has only `purpose`), `createSecretKey`,
  `destroySecretKey`, `generateLocalRoot(entropy)`, `wrapRoot(root, wrappingKey)`,
  `unwrapRoot(wrapped, wrappingKey)`, `SECRET_KEY_BYTES`. Wrap AAD is canonical
  CBOR `["sheaf","local.wrap",wrapId]`; `wrapId` is 22-character base64url of 16
  random bytes. `readKeyBytes` is `@internal` to M08.
- `kdf.ts`: `ARGON2ID_FLOOR`, `ARGON2ID_MEMORY_CEILING_KIB`,
  `ARGON2ID_ITERATION_CEILING`, `PASSPHRASE_KDF_CONTEXT`,
  `RECOVERY_KDF_CONTEXT`, `KDF_OUTPUT_BYTES`, `KDF_SALT_BYTES`,
  `createPassphraseKdfDescriptor`, `createRecoveryKdfDescriptor`,
  `deriveWrappingKeyFromPassphrase`, `deriveWrappingKeyFromRecoveryCode`,
  `calibrateKdf(clock, options?)`, `hkdfExtract`, `hkdfExpand`, `hkdfSha256`,
  type `Argon2idParams`, `CalibrationOptions`.
- `recovery-code.ts`: `generateRecoveryCode(entropy)`, `formatRecoveryCode`,
  `parseRecoveryCode`, `normalizeRecoveryCode`, `recoveryCodesEqual`,
  `RECOVERY_CODE_BYTES`/`_DATA_CHARS`/`_CHECKSUM_CHARS`/`_GROUP_SIZE`.
- `envelope.ts`: `encryptEnvelope(input)`, `decryptEnvelope(frame, scope, key,
  expectedPayloadKind?)`, types `EncryptEnvelopeInput`, `DecryptedEnvelopeV1`.

**New dependency edge: M08 → M09.** The AAD tuple, inner frame, and padding are
canonical-CBOR representation, and D2 allows exactly one canonical codec, so
crypto composes the codec rather than duplicating it. M09 remains a leaf, so no
dependency is inverted. M08 also → M01 (errors, `StorageId16`), M07 (ClockPort,
EntropyPort), M10 (constants + `migrateEnvelope`).

**Two documented format decisions owned by M08:**

1. *Argon2id context binding.* libsodium's Argon2id takes a fixed 16-byte salt
   and has no personalisation input, so the descriptor's `context` is folded
   into the salt: `argon2Salt = HMAC-SHA-256(key = descriptor.salt, message =
   UTF-8(context))[0..16]`. Stored salts may therefore be any length ≥ 16.
2. *Recovery-code format v1.* 32 CSPRNG bytes → 52 Crockford Base32 characters
   (MSB-first; the trailing 4 bits are padding and must be zero) + 4 checksum
   characters carrying the first 20 bits of
   `SHA-256("sheaf/local/recovery-code/v1" ‖ secret)`, displayed as 8 groups of
   7 separated by `-`. Parsing is case-insensitive, ignores `-`/whitespace,
   applies the Crockford `I`/`L`→`1`, `O`→`0` substitutions, and compares the
   checksum in constant time.

**D3 outcome:** the pinned `libsodium-wrappers-sumo@0.8.4` exposes the
`crypto_kdf_hkdf_sha256_*` size constants but **not** the functions, so the
RFC 5869 fallback shipped, implemented over
`crypto_auth_hmacsha256_{init,update,final}` (the multi-part API, which unlike
the one-shot form accepts arbitrary-length keys as extract requires).
