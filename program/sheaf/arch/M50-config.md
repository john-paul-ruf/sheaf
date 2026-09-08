# M50 — Config (`src/config/`)

Extracted from specs/architecture.md §Module Structure + §Public configuration.
F01 scope.

- **Owns:** Validated public build configuration.
- **F01 exports:** `PublicConfig` (format versions passthrough from
  `CURRENT_FORMAT_VERSIONS`; provider client IDs absent; origin allowlist
  empty), `validatePublicConfig` (rejects secret-shaped names/values —
  build must fail on anything shaped like a client secret/private key/bearer
  token/analytics key).
- **Depends on:** migrations index constants only.
- **Must not:** contain a secret of any kind; fabricate a provider default; be
  bypassed by direct env reads elsewhere (config is the single intake).

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-05.

<!-- foundation-first-unlock SESSION-05 -->
- 2026-09-08 — SESSION-05 landed (final revision `27ba411`). Delta:

### M50 — Config (`src/config/`) — first implementation

`public-config.ts` → `PublicConfig`, `PUBLIC_CONFIG` (format versions passed
through from `CURRENT_FORMAT_VERSIONS`; empty `providerClientIds`, empty
`allowedOrigins`), `validatePublicConfig`, `PublicConfigError`. Rejects
secret-shaped names (`/secret|private|token|key$/i`), credential-shaped values
(PEM private keys, `Bearer …`, `sk_/rk_/pk_live|test_`, `ghp_…`, `AIza…`),
non-https origins, and any format version that disagrees with `src/migrations`.
