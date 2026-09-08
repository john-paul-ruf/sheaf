# M51 — Platform (`src/platform/`)

Extracted from specs/architecture.md §Module Structure + §Supported Runtime
Baseline. F01 scope.

- **Owns (full target):** file/open-in acquisition, save/share handoff,
  install prompt, visibility, storage-estimate adapters.
- **F01 subset:** `probeCapabilities(): CapabilityReport` — required: secure
  context, IndexedDB, WebAssembly, dedicated Worker, structuredClone,
  BroadcastChannel, CompressionStream; optional (report, never gate):
  storage.estimate, Storage Persistence, install-prompt events.
- **Depends on:** browser APIs only.
- **Must not:** user-agent sniff (feature-gate only); treat an optional
  capability as required; invent a device class.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-05.

<!-- foundation-first-unlock SESSION-05 -->
- 2026-09-08 — SESSION-05 landed (final revision `27ba411`). Delta:

### M51 — Platform (`src/platform/`) — first implementation

`capabilities.ts` → `probeCapabilities(): CapabilityReport`, `CapabilityEntry
{id, classification, detected, reason}`, `CapabilityClassificationV1`,
`CAPABILITY_IDS`. Reconciled to architecture § Supported Runtime Baseline
(D14/AD-9). **The fragment's earlier F01 list is superseded**: it omitted
service workers, transferable ArrayBuffers, Blob slicing/streams and platform
file input, and listed the three implementation-required extras without the
baseline. Final ids, in report order — baseline-required: `secure-context`,
`indexeddb`, `web-crypto`, `webassembly`, `dedicated-worker`, `service-worker`,
`transferable-array-buffer`, `blob-slice-stream`, `platform-file-input`;
required-by-implementation (each carrying its reason in the entry):
`structured-clone`, `broadcast-channel`, `compression-streams`; advisory:
`storage-persistence`. Feature-gated only — the transfer probe actually
detaches a buffer and the file-input probe actually creates the element.
