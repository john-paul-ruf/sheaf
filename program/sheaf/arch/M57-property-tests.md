# M57 — Property tests (`tests/property/`)

The F05 addition is `tests/property/sync/vault.test.ts`: fast-check performs
100 uint64 frontier round trips, requiring exact canonical manifest bytes after
decode/re-encode. It imports production vault codecs and is discovered by the
Vitest node project. This is a codec property, not provider qualification,
storage/restart proof, or complete graph restoration.

Existing property suites remain in `tests/property/`; no compaction property
suite has landed. S06 owns positive nonempty graph/compaction properties after
GRAPH-CONTRACT. See [F05 boundaries](F05-boundaries.md).

## Change History

- 2026-09-24 — S01 contribution (`13e83f1` / `8674766`) moved from the combined M56/M57 delta into its own module at final reconciliation; no test code changed.
