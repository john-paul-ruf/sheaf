

<!-- durable-home-backup SESSION-02 CP3 a93a87c -->
## M36 / M47 / M54 — CP3 confirmation component
DurabilityServices, durabilityMachine and BundleSaveRoute provide transient preparing/delivering/awaiting-confirmation/confirming/native-saved/user-saved/cancelled/failed/interrupted states. BundleSaveDialog uses the accepted MOD-025 copy and a keyboard-dismissible, non-backdrop-dismissible modal. SecurityWiring.durability is composed from the current AppRuntime. CP4 still owns mounting the full home/vault/save journey and supplying authoritative receipt/count readers.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M41 / M42 / M44 / M47 / M54 — mounted durability and security surfaces

`/app/:appId/backup` mounts SCR-038/SCR-039 with real home services, vault creation/reuse, separate labelled recovery cards, secret-confirmed vault-code review, and the existing operation-bound save flow. App home links to this route. Library and readable reset display the same confirmed timestamp and pending count. Reset offers the app backup route and re-enumerates on return. Recovery codes lists authenticated connected homes and links to scoped review. The countdown disables premature UI submission and clears entered codes.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.
