# M51 — Platform (`src/platform/`)

Extracted from specs/architecture.md §Module Structure + §Supported Runtime
Baseline. F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns (full target):** file/open-in acquisition, save/share handoff,
  install prompt, visibility, storage-estimate adapters.
- **F01 subset (landed):** `capabilities.ts` → `probeCapabilities():
  CapabilityReport`, `CapabilityEntry {id, classification, detected, reason}`,
  `CapabilityClassificationV1`, `CAPABILITY_IDS`.
- **Depends on:** browser APIs only.
- **Must not:** user-agent sniff (feature-gate only); treat an optional
  capability as required; invent a device class.

## Capability set (D14 / AD-9 — authoritative)

The probe set is architecture.md §Supported Runtime Baseline, not an ad-hoc
list. Thirteen ids in report order, as they exist in `capabilities.ts`:

| classification | ids |
|---|---|
| `baseline-required` | `secure-context`, `indexeddb`, `web-crypto`, `webassembly`, `dedicated-worker`, `service-worker`, `transferable-array-buffer`, `blob-slice-stream`, `platform-file-input` |
| `required-by-implementation` | `structured-clone` (RPC transfer), `broadcast-channel` (M11 revision signal), `compression-streams` (M09 `deflate-raw-v1`) — each carries its reason in the entry |
| `advisory` | `storage-persistence` — reported, never gates |

Probes are feature-gates that actually exercise the feature: the transfer probe
detaches a buffer, the file-input probe creates the element, and a probe that
throws is recorded as `detected: false`.

F01 registers no service worker (that is F08); `service-worker` is a baseline
*availability* gate and nothing more.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`); probe set reconciled to
  the architecture baseline under D14/AD-9, closing replan finding F-06. The
  seeded fragment's original seven-item list is **superseded** by the table
  above: it omitted service workers, transferable ArrayBuffers, Blob
  slicing/streams and platform file input, and named the three
  implementation-required extras without the baseline.
- 2026-09-08 — CAP-08 proven through the real entry by SESSION-07
  (`9174b6d`, re-run at `2c0248a`): `tests/e2e/capability-gate.spec.ts` stubs
  `indexeddb` and `service-worker`, asserts each stubbed id is a member of
  `CAPABILITY_IDS` (so a renamed probe fails the file), and asserts advisory
  `storage-persistence` never blocks.
- 2026-09-08 — reconciled by Roshi (final pass) against `2c0248a`: head
  contract replaced with the landed set; session-delta staple merged.
