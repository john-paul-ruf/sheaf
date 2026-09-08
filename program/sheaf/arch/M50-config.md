# M50 — Config (`src/config/`)

Extracted from specs/architecture.md §Module Structure + §Public configuration.
F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Validated public build configuration.
- **F01 exports (landed):** `public-config.ts` → `PublicConfig`,
  `PUBLIC_CONFIG` (format versions passed through from
  `CURRENT_FORMAT_VERSIONS`; empty `providerClientIds`, empty
  `allowedOrigins`), `validatePublicConfig`, `PublicConfigError`.
- **Depends on:** migrations index constants only.
- **Must not:** contain a secret of any kind; fabricate a provider default; be
  bypassed by direct env reads elsewhere (config is the single intake).

## What validation rejects

Secret-shaped names (`/secret|private|token|key$/i`), credential-shaped values
(PEM private keys, `Bearer …`, `sk_/rk_/pk_live|test_`, `ghp_…`, `AIza…`),
non-https origins, and any format version that disagrees with `src/migrations`
(CA-06). The build must fail on anything shaped like a client secret, private
key, bearer token or analytics key.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`).
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged.
