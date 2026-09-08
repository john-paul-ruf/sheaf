# M09 — Persistence codecs (`src/persistence/codecs/`)

Extracted from specs/architecture.md §Module Contracts (Persistence codecs) +
specs/database.md §Canonical values. F01 scope. Reconciled against the tree at
`2c0248a`.

- **Owns:** Wire/storage representation, not semantic decisions.
- **Depends on:** M01 (`domain/model/errors`, `domain/model/bytes`) and M10
  constants only. **No third-party import** (D2), asserted by
  `tests/unit/crypto/module-boundaries.test.ts`.
- **Must not:** make semantic decisions; decode past declared bounds;
  migration of decoded values happens before domain code sees them.

## F01 public API (landed)

- `canonical-cbor.ts` — `encodeCanonical(value)`,
  `decodeCanonical(bytes, budget?)`,
  `decodeCanonicalPrefix(bytes, budget?) → { value, byteLength }`,
  `DEFAULT_DECODE_BUDGET` (maxDepth 32, maxBytes 16,777,216, maxEntries
  65,536), types `CborValue`, `CborKey`, `DecodedValue`, `DecodedKey`,
  `DecodeBudget`. Definite lengths, shortest ints, sorted keys,
  duplicate/unknown-critical rejection, depth+size bounds. Integers decode as
  `bigint`; encoding also accepts safe-integer `number`. Map keys are text or
  integers in v1; byte-string and composite keys are rejected. Text must be NFC
  on both sides. **No floats, tags, indefinite lengths, or `undefined` in v1.**
- `compression.ts` — `compressBounded(input, codec, maxOutputBytes?)`,
  `decompressBounded(input, codec, decodedByteLength)`. `deflate-raw-v1` via
  CompressionStream/DecompressionStream with the declared length enforced;
  `none` passthrough. Both async.
- `envelope-frame.ts` — `buildEnvelopeAad(input)` (**the CA-02 6-tuple; M11's
  frame-row adapter rebuilds AAD through this function, not its own copy**),
  `buildEnvelopePlaintext`, `parseEnvelopePlaintext`, `selectPaddedBucket`,
  `isPaddedBucket`, `padToBucket`, `serializeEnvelopeTransport`,
  `parseEnvelopeTransport`, `isEnvelopeScopeV1`, `isEnvelopePayloadKindV1`,
  type `EnvelopeAadInput`.

  `SHF1` transport v1 header is 62 bytes, big-endian: magic(4) │ envelope
  version(2) │ codec version(2) │ cipher version(2) │ storage ID(16) │ logical
  revision(8) │ padded length(4) │ nonce(24) │ ciphertext.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-02 (`acca5a8`).
- 2026-09-08 — composed by M08 (new edge M08 → M09) and by M11's `frame-row.ts`
  and M33's catalog codec; exercised through the real entry at `9174b6d`,
  re-run at `2c0248a`.
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged.
