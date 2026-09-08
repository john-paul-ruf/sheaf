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
