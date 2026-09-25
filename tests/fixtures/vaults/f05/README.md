# F05 producer known answers

`head.cbor` points to `index.shf`, which wraps the existing app key and points to
`manifest.shf`; that manifest points to `checkpoint.shf`. The checkpoint is
encoded by the existing production staging codec. All encryption, KDF, wrapping,
reference conversion and publication encoding use production code. Entropy and
nonces are deterministic only in these fixtures. The fixture-only passphrase is
`F05 fixture passphrase`.

Regenerate from the repository root with:

```
SHEAF_WRITE_F05_FIXTURES=1 pnpm test tests/unit/sync/protocol/fixtures.test.ts
```

The generator can write only these four files, under this directory. The normal
test regenerates in memory, checks every byte, exercises a corrupted-answer
negative control, and opens the committed graph using the vault passphrase and
recovery code. No provider, local database, UI, or save completion is simulated
as a passed integration boundary. This empty-app producer fixture does not prove
S02's complete authored-state reconstruction or S06's compaction/restart journey.
