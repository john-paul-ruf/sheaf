# M23 — Staging (`src/import/staging/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Snapshots and staging + `specs/database.md` § Import
> staging. Reconciled against the tree at `425562d` (F03 final; code ≡
> `30396a9`).

## Contract

- **Owns:** Provisional encrypted import model (delimited and, since F03,
  multi-sheet workbook), cancellation cleanup, review edits, explicit-accept
  promotion, append-into-existing-app, and the no-partial-app guarantee.
- **Exports:** `ImportStageV1` codec + stage lifecycle functions,
  `ProvisionalImport`, `PromotionReceipt`, `cleanupImport`, and (F03)
  `promoteImport`, `appendTable`, `sealImportCommit`, `RowPlan`.
- **Depends on:** M08/M11 **via injected ports**, M09 codecs, M01/M02 for
  promotion validation, M22 for retained chunks, M21 for the workbook
  proposal shapes, M65 for the fact stream.
- **Contract (database.md, binding):**
  - At pre-flight acceptance the data worker generates a random provisional
    app key + `ImportStageId`; the provisional key **becomes the app key on
    promotion** (no re-encryption of retained chunks at review).
  - The wrapped provisional key is reachable only through the encrypted
    workflow reference in the current local catalog; no app catalog entry
    exists before promotion.
  - Cancellation/refusal/failure follows the four-step ticket order verbatim.
  - Promotion follows the four-step order verbatim: validate with the shared
    validator + allocate permanent IDs; build roots outside the write
    transaction; ONE transaction adds roots, wraps the app key under the local
    root, adds the catalog entry/head, removes staging, tickets temporaries,
    replaces catalog, advances bootstrap; acknowledge only after commit.
  - **F03: one import-class commit (CA-11, amended).** `app.created` (now
    carrying `relationships`) first; then per table `table.created` (with
    `sourceSheet`), `field.created`×n, `enum.changed`×k;
    `inference-decision.recorded` for EDITED/REJECTED statements only; then
    `import.accepted` last (evidence ledger lists every sheet with its
    snapshot). No `record.created` — rows live in the checkpoint's record
    pages. A commit is never split across segments; append (D38, below) is
    bounded by the same 10,000-event / 16 MiB segment cap.
- **Unlock-time sweep:** a catalog holding a stale workflow reference or
  cleanup tickets resumes cleanup (bounded) before the library is reported. An
  F02 (v1) stage found during the sweep is stale and collected with a
  receipt, never treated as an integrity error (F03, `readStageRows`).

## Landed surface (delimited, F02, incl. the lease-r2 correction)

- `stage.ts` → `ImportStageV1` + codec; `IMPORT_STAGE_STATUSES`,
  `IMPORT_PHASES`, `StagedChunkRefV1`, `ImportStageProgressV1`.
- `proposal-codec.ts` → canonical-CBOR encode/decode for the F02 proposal
  shapes; shared typed decode primitives (`asMap`, `exactKeys`, `oneOf`,
  `count`, `nfcText`, …) that `stage.ts` and F03's workbook codec reuse.
- `lifecycle.ts` → `createImportStage`, `readImportStage`, `writeImportStage`,
  `stageWithProposal`, `stageWithReviewEdit`, `readProvisionalKeyBytes`,
  `stagedChunkStorageIds`, `PROVISIONAL_KEY_BYTES = 32`, `StagingPortsV1`,
  `LoadedImportStageV1`, `ImportWorkflowResumeV1`.
- `cleanup.ts` → `cancelImportStage`, `processCleanupTickets`,
  `sweepStaleImports`, cleanup-ticket codec, `CLEANUP_BATCH_SIZE = 32`,
  `CLEANUP_REASONS`, `CleanupReceiptV1`.
- `promotion.ts` → `promoteImport`, `PromotionResultV1`,
  `PROMOTION_REJECTIONS` (F02: `schema-invalid | record-invalid | no-proposal
  | empty-table`; F03 adds `append-too-large`), `PromotionReceiptV1`.
- `roots.ts` → `AppHeadV1`, `CheckpointManifestV1`, `RecordPageV1`,
  `BaselinePageV1`, their encode/decode pairs, `encodeAppHeadBody`/
  `encodeCheckpointBody`, `compareRecordKeys`, `RECORD_PAGE_MAX_RECORDS =
  1024`, `PAGE_MAX_DECODED_BYTES = 524288`, `encodeAppTheme`/`decodeAppTheme`.
- `events.ts` → `encodeImportEventPayload`: the semantic payload↔CBOR mapping
  for every import-class event.
- `theme.ts` → `DEFAULT_APP_THEME`, `DEFAULT_THEME_KEY`, `APP_ACCENT_ORDER`,
  `accentForApp`, `glyphForApp`.

## F03: workbook staging (SESSION-06, unless noted)

- `stage.ts`: `IMPORT_STAGE_VERSION = 2`; `ImportStageV1` gains
  `format: ImportFormatV1` (`"delimited" | WorkbookFormatV1`,
  `IMPORT_FORMATS`), `destination: ImportDestinationV1` (`new-app |
  existing-app{appId}` — existing-app only for delimited), `selectedSheets:
  number[]`, `preflight: PreflightReportV1 | null` +
  `inventory: StagedSheetSummaryV1[] | null` (exactly one set),
  `proposal: ProposedWorkbookV1 | null`, `reviewEdits:
  WorkbookReviewEditV1[]`.
- `lifecycle.ts`: `stageWithProposal`/`stageWithReviewEdit` take the workbook
  shapes. New `readStageRows(ports, root, workflow)` — the rows a stage names
  even when its payload no longer decodes (see the unlock-sweep contract,
  above).
- NEW `fact-codec.ts`: `encodeFactStreamItem`/`decodeFactStreamItem` — the
  exact-key inverse of M65's canonical mapping (CA-17 stage round trip).
- NEW `workbook-proposal-codec.ts`: exact-key codec for `ProposedWorkbookV1`
  and its statement/evidence/edit types (reuses `proposal-codec.ts`
  primitives and the F02 mappings; rule values refuse enum/reference).
- NEW `row-plan.ts`: `RowPlan(proposal, extents)` + `walkRows(items, visitor)`
  — places each staged row as inference did, **in stream order**;
  `assertMatches(proposal)` refuses a plan whose data-row counts differ from
  the reviewed exact counts; `sourceTextAt`.
- NEW `import-commit.ts`: `sealImportCommit(...)` — the one import-class
  commit builder (M09 `sealEventCommit`, one segment per commit, accumulated-
  set chain check). Promotion and append both use it.
- `promotion.ts` rewritten for workbooks: `allocateSchema`, `buildRecords`
  (two passes: keyed tables' ids + parent key-text maps, then records;
  references `reference{recordId}` or `invalid-preserved{key}`), `writeSnapshots`,
  `inertItemsOf`, `decisionsOf`, `tableEvents`, `decisionEvent`, `rootSealer`,
  `sealRecordPages`; `INERT_REASON_OF` (M65 → M01, total, test-pinned).
  Checkpoint written with every F03 root; head lists every snapshot manifest.
  Memory bound: one RecordId per keyed-table row + one entry per distinct
  parent key text, ≤ the D31 250,000-cell budget.
- NEW `append.ts`: `appendTable(deps, {loaded, facts, target, deviceId})`
  (D38, CA-23): one import commit (`table.created{table, sourceSheet}`,
  `field.created`, `enum.changed`, `record.created`×rows,
  `inference-decision.recorded`; no `import.accepted`); caps
  `APPEND_MAX_EVENTS = 10_000`, `APPEND_MAX_SEGMENT_BYTES = 16_777_216` →
  `append-too-large`; source and snapshot re-sealed under the app key; head
  grows `sourceManifests`/`snapshotManifests`/`eventSegments`, `schemaRevision
  + 1`; one transaction deleting the superseded head and the workflow.
- `events.ts`: `appCreated` carries `relationships`; `tableCreated({table,
  sourceSheet})` writes the F03 form; `inferenceDecision` takes a
  `WorkbookStatementV1`; `importAccepted` evidence ledger lists every sheet
  with its snapshot manifest id.
- `roots.ts`: `encodeRelationship`, `encodeValidationRule` exported. **F03
  roots stay optional on `CheckpointManifestV1`** — the F02 decode branch
  needs it (carried debt, owner: next M01/M02 lease, see below).

**F03: `CheckpointManifestV1` evolution (D37, SESSION-03).**
`ResolvedCheckpointManifestV1` is what the decoder returns;
`resolveCheckpointManifest` holds the F02-true defaults (the one place). The
decoder accepts exactly the F02 key set or exactly the F03 key set (per-sheet
keys must match the manifest's set); the encoder always writes F03.
`checkpointSemanticBody(payload)` = body bytes *as written* (F02 digest
verifies; KAT in `tests/unit/staging/roots.test.ts`). New codecs:
`encodeCellRange`/`decodeCellRange`, `encodeSheetDescriptor`/
`decodeSheetDescriptor`, `decodeFieldDef`/`decodeTableDef`/`decodeEnumOption`;
relationship, validation-rule, inert, decision, lineage codecs (internal).

## Contracts held by the code, not by its callers

- **Chunk lists are contiguous from zero.** A gap is a decode failure.
- **Every provisional storage ID is classified.** `retainedStorageIds` and
  `temporaryStorageIds` partition the chunk lists exactly.
- **`isEstimate` is deliberately not on the wire** (D24 as a literal type).
- **Epoch days decode signed** (`roots.ts:129`), matching `MIN/MAX_EPOCH_DAY`
  — corrected by OWNER-M23-EPOCHDAY (F02, `3a8499e`).
- **Reachability, as landed.** The provisional key exists in exactly one
  place; removing the reference and the envelope in one transaction is what
  makes cancellation step 2 a fact about the data. On promotion the same key
  **becomes the app key**.
- **Pointer-swap deletion.** A stage rewrite adds a new stage/workflow
  envelope and deletes the pair it supersedes in the same transaction.
- **D29 resolved, not raised.** All six app tokens are colours
  `src/ui/theme/tokens.css` already declares, pinned by
  `tests/unit/staging/theme.test.ts` (reads `tokens.css` as text, never
  imports `src/ui/**`).
- **Cleanup sweep triggers:** unlock, cancel, post-promotion temporaries, and
  (F03) an abandoned F02-era stage found by the unlock sweep.
- **F03: the baseline is one or more pages.** Promotion writes the original-
  import baseline as **one or more** `BaselinePageV1` pages (each ≤ 512 KiB
  decoded CBOR, record-page key order), via `paginateBaseline(scopeId,
  entries)`. `AppHeadV1.baselinePages` lists every page.
  `import.accepted.originalBaselineStorageId` (an M01 single-id field) names
  only the **first** page — a known single-id gap, carried to F06/M01's
  owner (below); it is not a bug in F03's writer, which correctly emits every
  page. Fixed by OWNER-PROMOTION-SEAMS (`cd4fe9d`): before this fix promotion
  wrote exactly one page and threw `CodecError` once a selection's rows
  exceeded the cap (the 7-sheet demo). `paginate(records)` is now linear
  (`recordPageEntryByteLength`, one measurement per record); the caps are
  unchanged (1,024 records / 512 KiB); pages are greedy-maximal.
- **F03: promotion/append rejections share `PromotionRejectedV1 {kind,
  reason, report, columnKeys}`**, built by `rejectedPromotion(reason, report?,
  schema?)`. `columnKeys` maps `encodeDomainId(fieldId)` → the reviewed
  `columnKey` the field was allocated for (empty when there is no schema).
  `roots.ts` exports `recordPageEntryByteLength` and
  `baselinePageEntryByteLength` for this (OWNER-PROMOTION-SEAMS `0634e81`).

## Dependency edges as landed

M01 (`bytes`, `ids`, `errors`, `values`, `events`, `schema` — F03), M09
(`canonical-cbor`, `event-commit`), M13/M14/M19/M21 shapes, M22 chunking, M65
(F03, fact stream), and the M07 ports — nothing else. No `src/crypto/`, no
`src/persistence/envelope-store/`, no `dexie`, no `src/ui/`, no
`src/workers/`.

## Dependency must-nots (ship as tests)

- No import from `src/ui/`, `src/workers/`, `dexie`, direct
  `src/persistence/envelope-store/` or `src/crypto/` implementations — port
  injection only. Asserted by `tests/unit/staging/module-boundaries.test.ts`,
  which also fails on a zero-file sweep.

## Carried debt (open at `30396a9`, owners named — not defects)

- **F03 roots stay optional on `CheckpointManifestV1`,** and
  `ValidationContext.referenceTargets` (M02) stays optional — both because
  the F02 decode KAT depends on it. Owner: next M01/M02 lease, to tighten
  once the F02 decode path is no longer load-bearing.
- **`import.accepted.originalBaselineStorageId` is single-id** while
  `AppHeadV1.baselinePages` lists every page. Owner: M01/database owner at F06
  planning (re-upload must read `baselinePages`, not the single field).
- **`inferProposal` is removable** once S02's own tests stop calling it
  directly. Owner: next session leasing `src/import/inference/**`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-04 CP1 (`82c38fc`), completed 5/5 at
  `cd74e6d` after the lease-r2 correction (`978f4ff`).
- 2026-09-08 — pre-1970 date decode corrected by OWNER-M23-EPOCHDAY (`3a8499e`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): SESSION-04's two-part
  staple folded into one description; the epochDay correction recorded where
  the decoder is described.
- 2026-09-23 — F03: `CheckpointManifestV1` evolution (D37) by SESSION-03
  (`f29ac33`..`a2c4cf0`); workbook staging, promotion and append by SESSION-06
  (`4287569`..`677b947`); baseline paging and rejection `columnKey` mapping by
  OWNER-PROMOTION-SEAMS (`cd4fe9d`, `0634e81`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three SESSION/owner
  staples folded into "F03: workbook staging", the D37 paragraph, and the
  "Contracts held by the code" section; the baseline-paging fix and the
  original single-page defect are stated as one history rather than as a
  standalone owner-correction note the reader has to reconstruct; carried
  debt consolidated into one list with owners.
