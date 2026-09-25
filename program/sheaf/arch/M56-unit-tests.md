
<!-- durable-home-backup SESSION-01 -->
## M56 / M57 — unit and property proof

Tests cover local/vault derivation separation even with equal stored salts,
wrong secrets, KDF/app/vault/scope tampering, destroyed handles, unchanged scratch
ciphertext, canonical graph round trips, malformed framing, frontier continuity,
missing/extra graph objects, exact predecessor/receipt rejection and preservation.
Scope/kind substitution uses real decryptEnvelope. Existing local KATs unchanged.
Boundary checks cover M07/M08/M09/M24, including forbidden-import/network negative
controls. Property suite runs 100 uint64 frontier round trips.




<!-- durable-home-backup SESSION-02 partial CP3 d75830d -->
## M56 — tests
Native component gate: 19 files/106 tests; real MessageChannels and production data/IO/client code with crypto, SQLite and fake-indexeddb. Worker constructors/native destination are doubles; no browser or J1 claim. Boundary, malformed/refused/stalled transport, pending-disposal, footer/offset/hash, quota, cancelled/failed/unconfirmed, forged/old/replayed identity, lock and restart assertions. Production build includes IO worker. Exact source/config/fixture/build identities and logs are under test-results/f05/s02/native-save/evidence.json.
