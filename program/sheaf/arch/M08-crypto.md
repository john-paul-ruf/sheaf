# M08 — Cryptography (`src/crypto/`)

Extracted from specs/architecture.md §Module Contracts (Cryptography) + §Local
Key Hierarchy and At-Rest Format. F01 scope. Reconciled against the tree at
`2c0248a`.

- **Owns:** All clear-key creation/derivation/use and every encrypted envelope.
- **Depends on:** libsodium (`libsodium-wrappers-sumo@0.8.4`), platform
  entropy, M09 (canonical CBOR — see the dependency note), M01 (errors,
  `StorageId16`), M07 (`ClockPort`, `EntropyPort`), M10 (constants +
  `migrateEnvelope`).
- **Must not:** export key bytes (opaque handles only); persist anything;
  import Dexie/envelope-store/UI. The same passphrase across scopes must derive
  unrelated keys via independent salts + domain contexts.
- **AAD (CA-02, D6):** canonical CBOR `["sheaf", scope(tstr),
  storageId(bstr16), codecVersion(uint), cipherSuiteVersion(uint),
  logicalRevision(uint64)]`, locked by
  `tests/fixtures/vaults/local-v1/envelope-kat.json`. `buildEnvelopeAad()`
  (M09) is the single AAD producer; M11's `frame-row.ts` calls it rather than
  keeping a copy.

## Public API (landed)

- `sodium.ts` — `loadSodium()`, `wipe(view)`, type `Sodium`.
- `keys.ts` — opaque `SecretKeyHandle` / `LocalRootKeyHandle` (bytes in a
  module-private `WeakMap`; a handle carries only `purpose`),
  `createSecretKey`, `destroySecretKey`, `generateLocalRoot(entropy)`,
  `wrapRoot(root, wrappingKey)`, `unwrapRoot(wrapped, wrappingKey)`,
  `SECRET_KEY_BYTES`. Wrap AAD is canonical CBOR `["sheaf","local.wrap",wrapId]`;
  `wrapId` is 22-character base64url of 16 random bytes. `readKeyBytes` is
  `@internal` to M08 — which is why M33 stores the D10 recovery-code view as a
  nested envelope rather than as wrapped bytes it would have to read back.
- `kdf.ts` — `ARGON2ID_FLOOR`, `ARGON2ID_MEMORY_CEILING_KIB`,
  `ARGON2ID_ITERATION_CEILING`, `PASSPHRASE_KDF_CONTEXT`,
  `RECOVERY_KDF_CONTEXT`, `KDF_OUTPUT_BYTES`, `KDF_SALT_BYTES`,
  `createPassphraseKdfDescriptor`, `createRecoveryKdfDescriptor`,
  `deriveWrappingKeyFromPassphrase`, `deriveWrappingKeyFromRecoveryCode`,
  `calibrateKdf(clock, options?)`, `hkdfExtract`, `hkdfExpand`, `hkdfSha256`,
  types `Argon2idParams`, `CalibrationOptions`. Floor is 65536 KiB / 3 iter /
  1 lane / 32B out, calibrated toward ~500–800ms and never below the floor.
- `recovery-code.ts` — `generateRecoveryCode(entropy)`, `formatRecoveryCode`,
  `parseRecoveryCode`, `normalizeRecoveryCode`, `recoveryCodesEqual`,
  `RECOVERY_CODE_BYTES`/`_DATA_CHARS`/`_CHECKSUM_CHARS`/`_GROUP_SIZE`.
- `envelope.ts` — `encryptEnvelope(input)`, `decryptEnvelope(frame, scope, key,
  expectedPayloadKind?)`, types `EncryptEnvelopeInput`, `DecryptedEnvelopeV1`.
- `hash.ts` (F02) — `sha256(bytes): Promise<Uint8Array>`, `SHA256_BYTES` (32),
  via the single `loadSodium()` bootstrap and `crypto_hash_sha256`. **Every
  durable Sheaf hash is this function over a canonical encoding** — M09's commit
  digest, M23's `semanticSha256` and chunked source identity, and M21's evidence
  fingerprints all route through it. Pinned to the FIPS 180-4 vectors.

## Dependency edge M08 → M09 (added at implementation)

The AAD tuple, inner frame and padding are canonical-CBOR representation, and
D2 allows exactly one canonical codec, so crypto composes the codec rather than
duplicating it. M09 remains a leaf, so no dependency is inverted.

## Two format decisions owned by M08

1. **Argon2id context binding.** libsodium's Argon2id takes a fixed 16-byte
   salt and has no personalisation input, so the descriptor's `context` is
   folded into the salt: `argon2Salt = HMAC-SHA-256(key = descriptor.salt,
   message = UTF-8(context))[0..16]`. Stored salts may therefore be any length
   ≥ 16.
2. **Recovery-code format v1.** 32 CSPRNG bytes → 52 Crockford Base32
   characters (MSB-first; the trailing 4 bits are padding and must be zero) +
   4 checksum characters carrying the first 20 bits of
   `SHA-256("sheaf/local/recovery-code/v1" ‖ secret)`, displayed as 8 groups of
   7 separated by `-`. Parsing is case-insensitive, ignores `-`/whitespace,
   applies the Crockford `I`/`L`→`1`, `O`→`0` substitutions, and compares the
   checksum in constant time. **There is no `LCL-` prefix** — the mocks' sample
   is a stale illustration and a display prefix would corrupt parsing (AD-10).

## D3 outcome

The pinned `libsodium-wrappers-sumo@0.8.4` exposes the
`crypto_kdf_hkdf_sha256_*` size constants but **not** the functions, so the
RFC 5869 fallback shipped, implemented over
`crypto_auth_hmacsha256_{init,update,final}` (the multi-part API, which unlike
the one-shot form accepts arbitrary-length keys as extract requires). KATs
cover the shipped path either way.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-02 (`acca5a8`). CA-02 producer side
  verified: `envelope-kat.json` committed (2 vectors incl. a max-uint64
  revision), byte-exact AAD + ciphertext re-derived through the production
  `encryptEnvelope`, D6 element-type decomposition asserted, full tamper matrix
  + per-byte property mutations rejecting with `IntegrityError`.
- 2026-09-08 — consumed through the real entry and real WASM by SESSION-07
  (`9174b6d`, re-run at `2c0248a`); M54 reaches `parseRecoveryCode` through a
  dynamic import so a page that never sees SCR-004 never loads the chunk.
- 2026-09-08 — reconciled by Roshi (F01 final pass): session-delta staple merged;
  AD-10's no-prefix fact recorded here alongside the format it constrains.
- 2026-09-08 — F02 `hash.ts` implemented by SESSION-01 (`3ffee63`); consumed by
  M09 (injected `Sha256Fn`), M21, M23 and M33.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the `hash.ts` staple folded
  into the landed API; heading de-scoped from "F01 public API".

<!-- durable-home-backup SESSION-01 -->
## M08 — cryptography

`kdf.ts` adds migration-006 descriptors and `deriveVaultPassphraseKey` /
`deriveVaultRecoveryKey`; context labels are exactly `sheaf/vault/passphrase/v1`
and `sheaf/vault/recovery/v1`. Local descriptors and known-answer bytes are
unchanged. Vault salt binding reuses the established local Argon2id mechanism.

`vault.ts`: `VaultKeyHandle`, generate/create vault secrets, vault/app wraps and
local protection. Wrap AAD is canonical CBOR `["sheaf", scope, vaultId,
wrapId, context]`: vault.wrap context is the complete KDF descriptor map;
vault.app-wrap context is appId; local.vault-wrap context is null. All use fresh
16-byte wrap IDs and 24-byte nonces, and 32-byte keys behind the existing WeakMap.
App wrapping consumes the existing opaque envelope key without rewriting data.
Purpose, dimensions, vault/app identity and authentication are checked on open.
Intermediate derivation handles and recovery bytes are destroyed on completion
or failure. Recovery-code formatting is unchanged; independently generated vault
secrets use vault-specific HKDF. `vault-port.ts#createVaultCrypto(entropy)` is the
production M07 adapter, including scoped open and cleanup on rejected secrets.


