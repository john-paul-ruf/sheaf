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
  `file-save.ts` (F05 partial CP3) → `createFileSavePort`.
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

createFileSavePort feature-detects the native picker, opens it before awaiting bytes, writes and closes once, and never retains a writable handle. Only fulfilled write+close returns saved; cancellation/error/absence return cancelled/failed/unconfirmed. Abort rejects pending work and requests stream abort. No share/download confirmation or UI is implemented pending DEC-72.

Source: S01 `694c741` / `13e83f1` / `8674766`, S02 `03ee571` / `c7e6507` / `d75830d` (as applicable to this module); F05 STATE at `95a539d` and Final Report. Scope and remaining owners: [F05 boundaries](F05-boundaries.md).

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


<!-- durable-home-backup APPROVAL-2026-09-24 -->
## Approval continuation — 2026-09-24

Supersedes prior-close references to pending DEC-71/72 and missing save/reminder design, while preserving that historical evidence. User approved the proposed schedule (first authored change, then 10m/1h/24h/daily after successive dismissals) and explicit “I saved this bundle” after unobservable delivery, recorded in 27e9a34. Designer save/reminder mocks and inventory landed 4c31ded. S02 CP3/4 still owns delivery, operation-bound confirmation and J1 proof; S03 CP1/2 owns encrypted reminder scheduling and J2. Approval/design readiness is not implementation or capability verification. Exact graph DB/Author contract and provider inputs remain separate owned prerequisites. Current plan 9749c76 governs continuation.


<!-- durable-home-backup SESSION-02 CP3 a93a87c -->
## M07 / M51 — CP3 save delivery
BundleSaveInteractionV1 carries an invocation-local AbortSignal, delivery notification, and asynchronous explicit confirmation. FileSavePort's terminal union is unchanged. The no-picker adapter now downloads only the prepared Blob, releases its object URL/anchor, and returns unconfirmed; it never claims download initiation is saved.
