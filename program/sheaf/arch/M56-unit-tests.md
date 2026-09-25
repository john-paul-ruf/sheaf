
<!-- durable-home-backup SESSION-01 -->
## M56 / M57 — unit and property proof

Tests cover local/vault derivation separation even with equal stored salts,
wrong secrets, KDF/app/vault/scope tampering, destroyed handles, unchanged scratch
ciphertext, canonical graph round trips, malformed framing, frontier continuity,
missing/extra graph objects, exact predecessor/receipt rejection and preservation.
Scope/kind substitution uses real decryptEnvelope. Existing local KATs unchanged.
Boundary checks cover M07/M08/M09/M24, including forbidden-import/network negative
controls. Property suite runs 100 uint64 frontier round trips.


