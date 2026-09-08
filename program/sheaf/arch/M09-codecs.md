# M09 — Persistence codecs (`src/persistence/codecs/`)

Extracted from specs/architecture.md §Module Contracts (Persistence codecs) +
specs/database.md §Canonical values. F01 scope.

- **Owns:** Wire/storage representation, not semantic decisions.
- **F01 exports:** `encodeCanonical`/`decodeCanonical` (Sheaf-owned canonical
  CBOR, D2: definite lengths, shortest ints, sorted keys, duplicate/unknown-
  critical rejection, depth+size bounds, uint64 bigint, **no floats in v1**);
  `compressBounded`/`decompressBounded` (`deflate-raw-v1` via
  CompressionStream, declared-length enforced; `none`); envelope inner-frame
  build/parse + bucket padding + `SHF1` transport serialize/parse.
- **Depends on:** nothing third-party (D2). Constants from migration 003.
- **Must not:** make semantic decisions; decode past declared bounds;
  migration of decoded values happens before domain code sees them.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-02.

<!-- foundation-first-unlock SESSION-02 -->
- 2026-09-08 — SESSION-02 landed (final revision `acca5a8`). Delta:

### M09 — Persistence codecs (`src/persistence/codecs/`) — first implementation

**Public API landed**

- `canonical-cbor.ts`: `encodeCanonical(value)`, `decodeCanonical(bytes, budget?)`,
  `decodeCanonicalPrefix(bytes, budget?) → { value, byteLength }`,
  `DEFAULT_DECODE_BUDGET` (maxDepth 32, maxBytes 16,777,216, maxEntries 65,536),
  types `CborValue`, `CborKey`, `DecodedValue`, `DecodedKey`, `DecodeBudget`.
  Integers decode as `bigint`; encoding accepts safe-integer `number` too.
  Map keys are text or integers in v1; byte-string and composite keys are
  rejected. Text must be NFC on both sides. No floats, tags, indefinite
  lengths, or `undefined`.
- `compression.ts`: `compressBounded(input, codec, maxOutputBytes?)`,
  `decompressBounded(input, codec, decodedByteLength)` — `deflate-raw-v1` via
  CompressionStream/DecompressionStream, `none` passthrough. Both async.
- `envelope-frame.ts`: `buildEnvelopeAad(input)` (**the CA-02 6-tuple; S04's
  frame-row adapter rebuilds AAD through this function, not its own copy**),
  `buildEnvelopePlaintext`, `parseEnvelopePlaintext`, `selectPaddedBucket`,
  `isPaddedBucket`, `padToBucket`, `serializeEnvelopeTransport`,
  `parseEnvelopeTransport`, `isEnvelopeScopeV1`, `isEnvelopePayloadKindV1`,
  type `EnvelopeAadInput`.
  `SHF1` transport v1 header is 62 bytes, big-endian: magic(4) │ envelope
  version(2) │ codec version(2) │ cipher version(2) │ storage ID(16) │ logical
  revision(8) │ padded length(4) │ nonce(24) │ ciphertext.

**Dependency edges:** M09 → M01 (`domain/model/errors`, `domain/model/bytes`)
and M09 → M10 constants only. No third-party import (D2, asserted by
`tests/unit/crypto/module-boundaries.test.ts`).
