# F05 — Current implementation and proof boundaries

Final reconciliation, 2026-09-24. Sources: `prompts/durable-home-backup/FINAL-REPORT.md`, complete STATE at receive `95a539d`, sessions and graph replan `f1eae46`, implementation through `d75830d`. Approved behavior remains `specs/requirements.md` FR-25–28 and `specs/database.md` HomeState, local graph, vault publication and bundle sections; migrations 003/004/006 are unchanged.

**BLOCKED / INCOMPLETE.** S01 is done (3/3). S02 has two accepted checkpoints and a partial CP3 contribution. S03–S07 remain blocked. No full CAP-39–45, J1, actual OS-save qualification, live provider qualification, or GATE-F05 is established. Inherited CAP-05 countdown remains assigned but unfinished.

## Landed facts and their limits

| Agreement | Current producer/proof | Remaining consumer or proof owner |
| --- | --- | --- |
| CA-34 | `src/crypto/vault.ts` and `ports/vault-crypto.ts`: independent vault derivation/recovery; `03ee571` atomic bundle-home assignment and local wrapping. | S02 CP4 vault/home UI and real-entry J1; supplied secret is not an already mounted user journey. |
| CA-35 | `backup-graph.ts`, projection authored-state cursor, shared backup port and publication/frontier at `c7e6507`: complete **current-producer** closure, bounded payload reads, original covered-chain authentication, independently reconstructed authored digest. Root GRAPH-S02: 25 files / 209 pass. | Nonempty local retained/conflict/audit layouts await GRAPH-CONTRACT and S06 CP1/2/4 positive proof. J1 remains S02 CP4. |
| CA-36 | `home-state.ts` / `backup-handlers.ts`: encrypted pins and home assignment at `03ee571`; native receipt plus pin-release transaction at `d75830d`. | S02 CP4/5 durable receipt/count/reset/status readers and CP6 interrupted-pin recovery. |
| CA-37 | `platform/file-save.ts`: only fulfilled native write and close returns saved; cancellation/failure/absent picker do not. | Human DEC-72 supplies fallback semantics; Designer supplies dependent states; S02 finishes CP3 and proves CP4/6. DEC-71 reminder policy separately gates S03. |
| CA-38 | Provider-neutral immutable object/CAS port, candidate checks/readback and stateful external double. | Human supplies registrations, exact redirect origins and authorized accounts; S04/S05 qualify actual Dropbox/OneDrive scope, browser CORS and final-publication CAS. Doubles do not establish these facts. |
| CA-39 | Dedicated ciphertext IO entry/channel and bootstrap lifetime at `d75830d`, without app/vault keys in IO. | S07 CP1 production provider constructors/config/token/egress composition and security discovery, CP3 lifecycle races, CP5 J6. |
| CA-40 | Native receipt producer exists; matched app/home/operation/artifact, live session and frontier bounds/regression checked before durable transaction. | S02 CP4 minimum readers, CP5 broader surfaces/reset and inherited CAP-05 recovery countdown; S03 reminders/status, S07 cloud composition. |
| CA-41 | Current empty-list producers remain supported; unsupported nonempty roots reject without publication/receipt/cleanup mutation. | DB/Author GRAPH-CONTRACT supplies typed authenticated local retained-reference meaning (or approved fixed-role alternative), conflict/audit layouts, descendants/version and chain evidence. S06 owns writer, reader, fixtures and publication together at CP1, install/reopen/history at CP2, J3 plus J1 regression at CP4. |

Source names in the table are under `src/workers/data/` unless qualified. Port paths are under `src/application/`. Mapping evidence is not a replacement for the owning session's executable acceptance.

## Graph and native-save contracts

The S01 eager graph byte arrays were superseded by `c7e6507`. `BackupGraphObjectV1` is metadata; `readObject` and `canonicalAuthoredState` are lifetime-bound readers. Publication retains references/hashes and rereads one object at a time. Hashing uses exact ordered bytes, not page-hash aggregation. Necessary graph metadata and the SQLite projection still occupy memory; this is bounded payload processing, not a claim of constant total memory.

Local plaintext semantic hashes, head-body hashes, ciphertext hashes and reconstructed authored-state hashes are distinct. Envelope scope comes from authenticated parent/bootstrap meaning and participates in AAD; SHF1 does not contain scope. Covered import commits authenticate device/app identity, sequence and predecessor hash before seeding checkpoint chains. Source/snapshot manifests and chunks, baseline distinctions, per-value provenance and deleted restoration remain part of current graph coverage. Volatile calculated TODAY/NOW output is excluded from authored state.

The pinned source head in the remote manifest has known `app.head` meaning from the authenticated pin/catalog/app-key context. This does **not** authorize interpreting arbitrary local `retainedRoots` as heads. Current promotion/append/event writers emit or preserve empty retained/conflict/audit lists. Their nonempty guard is a compatibility boundary, not completed compaction or a removal of approved future behavior.

`AppRuntime.saveBundle` invokes the picker synchronously before awaiting prepared bytes, then constructs IO lazily. Data-worker `connectBundle` pins, exports, authenticates publication and sends ciphertext through the dedicated channel. IO assembles Blob parts and performs a second framing/hash pass before offering the artifact. It cannot decrypt. Saved completion commits the captured receipt and releases its pin atomically; cancelled/failed/unconfirmed completions never advance confirmation. Invalid/aborted transfers can retain pins, whose user-facing recovery is still CP6. General `messages.ts` RPC remains byte-free; separate IO attach messages transfer ports.

The production status readers in `app-session.ts` and `record-handlers.ts` still derive device-only counts from absolute local sequence; library/reset paths consume those existing facts. A landed receipt writer cannot make these readers receipt-relative. S02 CP4/5 must prove exact one/zero outstanding counts, unchanged time on failure, and restart agreement. Native component tests inspect persisted receipts after worker reopen and exact remaining frontier difference, but use fake-indexeddb and doubled constructors/destination. They do not cross the real browser entry or an actual OS save.

## Record corrections for Orchestrator

Current CA/CAP rows correctly keep the feature incomplete. Older STATE **Inspected inheritance** and **Seam Preflight** prose still describes missing home/IO/save producers now landed at `03ee571`/`d75830d`. These summaries should be qualified by revision or refreshed at the next receive; preserve the historical handoffs. This is a machine-actionable documentation correction owned by Orchestrator, not a new implementation blocker or authority for Archivist to change STATE.

`58bffc8` delivered the fixed named-vault/recovery mock and five inventory rows (80 design renders: 16 states × 5 widths). DF-F05-1's remaining work is decision-dependent outcome/reminder design, not redoing that delivery. DEC-71/72 and GRAPH-CONTRACT are product/author decisions; test discovery and subsequent leases are mechanical owner work. Native await transport timeouts were reattachments to existing handles, not Coder crashes. No context exhaustion or checkpoint re-slice occurred.

AR-1 remains format-transcript validation debt: the cited `program/demiurge/specs/database.md` source is absent. Orchestrator/Archivist must retain that limitation rather than treat it as runtime or format proof. This pass did not create or change protected specifications.

## Evidence inspected

Inspected source and sampled assertions in `workers/backup-graph.test.ts`, `workers/backup-handlers.test.ts`, projection, publication, bundle and save tests; full STATE/raw handoffs, original planning findings and graph review. Initial five findings were dispositioned by `5e38ca7`; the bounded graph replan is `f1eae46`. Their future proofs remain owned future work, not passing evidence.

The Final Report records root `pnpm verify` at `d75830d`: typecheck/lint/build exit 0, 214 files / 2402 passing / 3 inherited skips. Native selected 19 files / 106 passing is worker-reported and included in that full suite. Archivist ran no implementation tests, browser journeys, provider requests, OS-save probes or new format qualification. Aggregate green results do not close the gaps above.


<!-- durable-home-backup APPROVAL-2026-09-24 -->
## Approval continuation — 2026-09-24

Supersedes prior-close references to pending DEC-71/72 and missing save/reminder design, while preserving that historical evidence. User approved the proposed schedule (first authored change, then 10m/1h/24h/daily after successive dismissals) and explicit “I saved this bundle” after unobservable delivery, recorded in 27e9a34. Designer save/reminder mocks and inventory landed 4c31ded. S02 CP3/4 still owns delivery, operation-bound confirmation and J1 proof; S03 CP1/2 owns encrypted reminder scheduling and J2. Approval/design readiness is not implementation or capability verification. Exact graph DB/Author contract and provider inputs remain separate owned prerequisites. Current plan 9749c76 governs continuation.
