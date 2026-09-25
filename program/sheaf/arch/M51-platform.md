# M51 — Platform (`src/platform/`)

Extracted from specs/architecture.md §Module Structure + §Supported Runtime
Baseline. Reconciled against the tree at `425562d` (F03 final; code ≡
`30396a9`).

- **Owns (full target):** file/open-in acquisition, save/share handoff,
  install prompt, visibility, storage-estimate adapters, and (F03) clipboard.
- **Landed:** `capabilities.ts` → `probeCapabilities(): CapabilityReport`,
  `CapabilityEntry {id, classification, detected, reason}`,
  `CapabilityClassificationV1`, `CAPABILITY_IDS`; `file-pick.ts` →
  `WORKBOOK_FILE_EXTENSIONS`, `PickedWorkbookV1`, `pickWorkbookFile(files)`;
  `clipboard.ts` (F03) → `copyText(text) → Promise<"copied"|"unavailable">`;
  `file-save.ts` (F05 full CP3) → `createFileSavePort`.
- **Depends on:** browser APIs only.
- **Must not:** user-agent sniff (feature-gate only); treat an optional
  capability as required; invent a device class.

## Capability set (D14 / AD-9 — authoritative)

Thirteen ids in report order, as they exist in `capabilities.ts`, unchanged
by F03:

| classification | ids |
|---|---|
| `baseline-required` | `secure-context`, `indexeddb`, `web-crypto`, `webassembly`, `dedicated-worker`, `service-worker`, `transferable-array-buffer`, `blob-slice-stream`, `platform-file-input` |
| `required-by-implementation` | `structured-clone` (RPC transfer), `broadcast-channel` (M11 revision signal), `compression-streams` (M09 `deflate-raw-v1`) |
| `advisory` | `storage-persistence` — reported, never gates |

No service worker is registered yet (F08); `service-worker` is a baseline
*availability* gate only.

## File acquisition (F02, S07)

`file-pick.ts` → `WORKBOOK_FILE_EXTENSIONS`, `PickedWorkbookV1`,
`pickWorkbookFile(files)`. The accept list is deliberately **wide**: FR-1
decides format from content. `.xlsx`/`.xlsb`/`.xls`/`.ods` were offered from
F02 for exactly the reason F03 now parses them (was D19's later-release card,
now the real workbook flow).

**Choosing a maps provider is this module's decision, not M37's.**

## Clipboard (F03, S07)

`clipboard.ts` → `copyText(text) → Promise<"copied"|"unavailable">`; injected
by the route (`app-runtime.tsx`/route table), **never imported by
`src/ui/**`** — the handoff card's "Copy instructions" button (SCR-019's
handoff variant) reads the result through `COPY_HANDOFF{result}` instead.

## Durable-home implementation (F05, current)

`createFileSavePort` feature-detects the native picker and invokes it in the gesture before awaiting prepared ciphertext. Only fulfilled write plus close returns `saved`; cancellation and errors return `cancelled`/`failed`. Aborts reject pending work, request stream abort and clear the writable handle.

Without a picker, the adapter awaits the verified Blob, creates a temporary download anchor/object URL, delivers it and cleans both resources. It returns `unconfirmed`, never saved from a click or download start. Approved DEC-72 is completed by M53's live operation-bound explicit confirmation, not by this adapter. Native destination doubles and real browser downloads prove these branches; actual OS durability remains unqualified.

Source: production `47a633b`, current STATE/Final Report; [F05 boundaries](F05-boundaries.md) records proof limits and owners.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`); probe set reconciled to
  the architecture baseline under D14/AD-9.
- 2026-09-08 — CAP-08 proven through the real entry by SESSION-07
  (`9174b6d`, re-run at `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass) against `2c0248a`: head
  contract replaced with the landed set; staple merged.
- 2026-09-08 — F02 `file-pick.ts` landed by SESSION-07 (`3861101`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-07 staple
  folded in; the M61 e2e paragraphs moved to `M61-e2e-tests.md`.
- 2026-09-23 — F03: `clipboard.ts` landed by SESSION-07 (`2185774`..`e062f41`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-07 staple
  folded into a new "Clipboard" section.
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
