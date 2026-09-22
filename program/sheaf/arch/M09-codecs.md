# M09 — Persistence codecs (`src/persistence/codecs/`)

Extracted from specs/architecture.md §Module Contracts (Persistence codecs) +
specs/database.md §Canonical values. Reconciled against the tree at `5ab3b07`
(F02 final).

- **Owns:** Wire/storage representation, not semantic decisions.
- **Depends on:** M01 (`domain/model/errors`, `domain/model/bytes`, `ids`) and
  M10 constants only. **No third-party import** (D2), asserted by
  `tests/unit/crypto/module-boundaries.test.ts`. SHA-256 arrives as an injected
  `Sha256Fn` rather than an import, which is what keeps that true.
- **Must not:** make semantic decisions; decode past declared bounds;
  migration of decoded values happens before domain code sees them.

## Public API (landed)

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

- `event-commit.ts` (F02) — CA-08's producer. `encodeCommitBody` (**the
  canonical commit with `commitSha256` omitted — the exact bytes the hash is
  taken over**), `encodeEventCommit` / `decodeEventCommit`, `encodeEventSegment`
  / `decodeEventSegment`, `sealEventCommit`, `verifyCommitChain`, `sortFrontier`,
  `compareCommits`, `sortCommitsCanonically`, types `Sha256Fn`,
  `EventCommitBodyV1`.
  - SHA-256 arrives as an injected `Sha256Fn`, so **M09 stays third-party-free
    (D2)** — new dependency edge M09 → M01 (`ids`, `errors`) and M10 only.
  - Decode is strict: exact key sets, closed kind/class/source lists, 16-byte
    IDs and 32-byte hashes, contiguous event indexes, subject app ownership,
    per-kind required subject members, frontier sorted with no duplicate
    device, `previousDeviceCommitSha256` null **exactly** at sequence one, and
    migration 004's `migrateEvent` gate last.
  - `verifyCommitChain` throws `IntegrityError` on the first violation and
    never skips a bad commit. A device whose first commit in the given set has
    sequence > 1 has its predecessor in an earlier segment: the function
    verifies nothing there rather than assuming an unseen chain is intact.
    **Callers must feed the accumulated commit set**, not one segment — D27
    writes one commit per segment.
  - Canonical commit order is `(wallTime, logicalCounter, deviceId,
    deviceSequence, commitId)` and is **presentation only** — causality stays
    frontier- and per-device-sequence-based.
  - **Event payloads cross this codec as opaque canonical CBOR.** The semantic
    payload↔typed-event mapping belongs to the caller (M23 promotion, M34
    commands, M12 replay), which is why `ProjectionCommitV1` carries typed
    events alongside the raw commit.
  - Pinned by `tests/fixtures/vaults/local-v1/event-commit-kat.json`: three
    commit vectors (including an import commit moving `schemaRevision` 0 → 1)
    and a two-commit per-device chain inside one `EventSegmentV1`, all byte-
    exact through the production encoder and M08's digest.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-02 (`acca5a8`).
- 2026-09-08 — composed by M08 (new edge M08 → M09) and by M11's `frame-row.ts`
  and M33's catalog codec; exercised through the real entry at `9174b6d`,
  re-run at `2c0248a`.
- 2026-09-08 — reconciled by Roshi (F01 final pass): session-delta staple merged.
- 2026-09-08 — F02 `event-commit.ts` implemented by SESSION-01 (`3ffee63`);
  consumed by M23 promotion (`cd74e6d`), M34 commands (`d47b3d2`) and M12's
  replay guards (`063f35a`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-01 staple
  folded into the public API; heading de-scoped from "F01 public API"; the
  accumulated-set rule and the opaque-payload rule recorded where they bind
  callers.
