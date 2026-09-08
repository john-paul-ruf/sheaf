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
