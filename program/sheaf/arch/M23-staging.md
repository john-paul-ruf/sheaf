# M23 — Staging (`src/import/staging/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Snapshots and staging + `specs/database.md` § Import
> staging. Reconciled against the tree at `5ab3b07` (F02 final).

## Contract

- **Owns:** Provisional encrypted import model, cancellation cleanup, review
  edits, explicit-accept promotion, and the no-partial-app guarantee.
- **Exports:** `ImportStageV1` codec + stage lifecycle functions,
  `ProvisionalImport`, `PromotionReceipt`, `cleanupImport`.
- **Depends on:** M08/M11 **via injected ports**, M09 codecs, M01/M02 for
  promotion validation, M22 for retained chunks.
- **Contract (database.md, binding):**
  - At pre-flight acceptance the data worker generates a random provisional
    app key + `ImportStageId`; the provisional key **becomes the app key on
    promotion** (no re-encryption of retained chunks at review).
  - The wrapped provisional key is reachable only through the encrypted
    workflow reference in the current local catalog; no app catalog entry
    exists before promotion.
  - Cancellation/refusal/failure follows the four-step ticket order verbatim:
    catalog-without-workflow + delete key-wrap + cleanup ticket + bootstrap
    advance in ONE transaction; then bounded ticketed deletes with persisted
    cursor; ticket deleted only when every row is absent; cleanup receipt
    returned. The shell never had a partial app to display.
  - Promotion follows the four-step order verbatim: validate with the shared
    validator + allocate permanent IDs; build roots outside the write
    transaction; ONE transaction adds roots, wraps the app key under the local
    root, adds the catalog entry/head, removes staging, tickets temporaries,
    replaces catalog, advances bootstrap; acknowledge only after commit.
- **Unlock-time sweep:** a catalog holding a stale workflow reference or
  cleanup tickets resumes cleanup (bounded) before the library is reported.

## Landed surface (F02, S04 @ `cd74e6d`, incl. the lease-r2 correction)

- `stage.ts` → `ImportStageV1` + `encodeImportStage` / `decodeImportStage` /
  `validateImportStage`; `IMPORT_STAGE_VERSION = 1`, `IMPORT_STAGE_SCOPE =
  "app.import-stage"`, `IMPORT_STAGE_PAYLOAD_KIND = "app.import-stage"`,
  `IMPORT_STAGE_STATUSES` (`staging|staged|reviewing|promoting|promoted|
  cancelled|failed`), `IMPORT_PHASES` (`preflight|parsing|inferring|reviewing|
  promoting|done`), `StagedChunkRefV1`, `ImportStageProgressV1`.
- `proposal-codec.ts` (added beyond the plan's Files table, Custom Rule 7 —
  the S03-shape CBOR mapping is a separable concern from the stage envelope and
  would have doubled `stage.ts`) → canonical-CBOR encode/decode for
  `ProposedAppV1`, `InferenceStatementV1`, `EvidenceV1`, `ImportDiagnosticV1`,
  `ProposedFieldTypeV1`, `SourceValueFormatV1`, `ReviewEditV1`, plus the shared
  typed decode primitives (`asMap`, `exactKeys`, `oneOf`, `count`, `nfcText`, …)
  that `stage.ts` reuses.
- `lifecycle.ts` → `createImportStage`, `readImportStage`, `writeImportStage`,
  `stageWithProposal`, `stageWithReviewEdit`, `readProvisionalKeyBytes`,
  `stagedChunkStorageIds`, `PROVISIONAL_KEY_BYTES = 32`, `StagingPortsV1`,
  `LoadedImportStageV1`, `ImportWorkflowResumeV1`.
- `cleanup.ts` → `cancelImportStage`, `processCleanupTickets`,
  `sweepStaleImports`, `encodeCleanupTicket`/`decodeCleanupTicket`,
  `CLEANUP_BATCH_SIZE = 32`, `CLEANUP_REASONS`, `CleanupReceiptV1`.
- `promotion.ts` → `promoteImport`, `PromotionResultV1`,
  `PROMOTION_REJECTIONS` (`schema-invalid | record-invalid | no-proposal |
  empty-table`), `PromotionReceiptV1`.
- `roots.ts` (added beyond the plan, Custom Rule 7 — the durable-root codecs
  are a separable concern from the promotion order) → `AppHeadV1`,
  `CheckpointManifestV1`, `RecordPageV1`, `BaselinePageV1`, their
  encode/decode pairs, `encodeAppHeadBody`/`encodeCheckpointBody` (the exact
  bytes each `semanticSha256` covers), `compareRecordKeys`,
  `RECORD_PAGE_MAX_RECORDS = 1024`, `PAGE_MAX_DECODED_BYTES = 524288`,
  `encodeAppTheme`/`decodeAppTheme`.
- `events.ts` (added, Custom Rule 7) → `encodeImportEventPayload`: the semantic
  payload↔CBOR mapping for `app.created`, `table.created`, `field.created`,
  `enum.changed`, `inference-decision.recorded`, `import.accepted`. M09 owns
  the envelope; the commit's author owns its payloads, and this is that.
- `theme.ts` (added, Custom Rule 7) → `DEFAULT_APP_THEME`,
  `DEFAULT_THEME_KEY = "sheaf.built-in.v1"`, `APP_ACCENT_ORDER`,
  `accentForApp`, `glyphForApp`.

## Contracts held by the code, not by its callers

- **Chunk lists are contiguous from zero.** A gap is a decode failure, never a
  silently shorter file.
- **Every provisional storage ID is classified.** `retainedStorageIds` and
  `temporaryStorageIds` partition the chunk lists exactly; a row belonging to
  neither cannot be encoded.
- **`isEstimate` is deliberately not on the wire**: it is the literal `true` in
  M14's `PreflightReportV1`, so no stored byte can claim a bounded sample was
  exact (D24). A `null` violation count decodes as `null`, never `0` — "not
  measured yet" and "none" stay different facts.
- **Epoch days decode signed.** `roots.ts:129` reads the negative integer
  canonical CBOR faithfully wrote and bounds it by the same `MIN/MAX_EPOCH_DAY`
  `dateValue()` enforces: what the domain refuses to author, the decoder refuses
  to admit. The nonnegative reader that shipped at `cd74e6d` made every pre-1970
  date a page this module wrote and could not open; corrected by
  **OWNER-M23-EPOCHDAY** at `3a8499e` with a round-trip regression and a decode
  negative.
- **Reachability, as landed.** The provisional key exists in exactly one place —
  a `local.workflow` envelope sealed under the local root — and that envelope is
  named only by the catalog's `activeWorkflowStorageIds`. Removing the reference
  and the envelope in one transaction is what makes cancellation step 2 a fact
  about the data rather than a promise about the code. On promotion the same key
  **becomes the app key**: nothing staged is re-encrypted at the review boundary.
- **Pointer-swap deletion.** A stage rewrite adds a new stage and workflow
  envelope and deletes the pair it supersedes in the same transaction — they are
  unreachable the moment the new catalog lands, so no ticket protects them.
  Superseded *catalogs* are deliberately left alone, exactly as F01's
  `updateSettings` leaves its own; collecting those is F05's mark-and-sweep.
- **One import-class commit (CA-11).** `app.created` first, then the
  `field.created` set, `enum.changed`, `inference-decision.recorded` for EDITED
  and REJECTED statements only, and `import.accepted` last. **No
  `record.created`** — rows live in the checkpoint's record pages. The pairing of
  `app.created` with the initial checkpoint is load-bearing: M12 disposes on an
  unknown table or field arriving in a tail commit.
- **D29 resolved, not raised.** Every one of the six app tokens is a colour
  `src/ui/theme/tokens.css` already declares (`--ink-950`, `--paper-50`,
  `--white`, `--leaf-700`, `--leaf-500`, `--paper-200`), pinned by
  `tests/unit/staging/theme.test.ts`, which reads `tokens.css` as text and never
  imports `src/ui/**`. No palette was invented and no `needsDesignSource` was
  required.
- **Cleanup sweep triggers:** unlock (frees the reference when the store is
  already clean), cancel, and post-promotion temporaries.

## Dependency edges as landed

M01 (`bytes`, `ids`, `errors`, `values`, `events`), M09 (`canonical-cbor`,
`event-commit`), M13/M14/M19/M21 shapes, M22 chunking, and the M07 ports —
nothing else. No `src/crypto/`, no `src/persistence/envelope-store/`, no
`dexie`, no `src/ui/`, no `src/workers/`.

## Dependency must-nots (ship as tests)

- No import from `src/ui/`, `src/workers/`, `dexie`, direct
  `src/persistence/envelope-store/` or `src/crypto/` implementations — port
  injection only, composed by the data worker. Asserted by
  `tests/unit/staging/module-boundaries.test.ts`, which also fails on a
  zero-file sweep so it cannot pass vacuously. The SHA-256 byte length is stated
  locally rather than imported from M08, so a length constant is not what pulls
  libsodium into the staging graph.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-04 CP1 (`82c38fc`), completed 5/5 at
  `cd74e6d` after the lease-r2 correction (`978f4ff`) that added M11's
  exact-key delete path the four-step cancellation needs. CAP-11 and CAP-13
  verified at the worker tier: every durable root decoded from raw IndexedDB
  with `semanticSha256` recomputed and 40 page keys globally sorted.
- 2026-09-08 — pre-1970 date decode corrected by OWNER-M23-EPOCHDAY (`3a8499e`),
  a defect SESSION-05 found at its own restart leg.
- 2026-09-08 — reconciled by Roshi (F02 final pass): SESSION-04's two-part staple
  (which carried its own "part 2 supersedes part 1" instruction, a superseded
  "Not landed" note, and a superseded "M11 has no delete today" aside) folded
  into one description of the module as it now stands; the epochDay correction
  recorded where the decoder is described.

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**M23 — Staging (`roots.ts`)**
- `CheckpointManifestV1` evolution (D37): F03 roots optional for a writer, `ResolvedCheckpointManifestV1` returned by the decoder; `resolveCheckpointManifest` holds the F02-true defaults (the one place). Decoder accepts exactly the F02 key set or exactly the F03 key set (per-sheet keys must match the manifest's set); encoder always writes F03. `checkpointSemanticBody(payload)` = body bytes *as written* (F02 digest verifies; KAT in `tests/unit/staging/roots.test.ts`).
- New exported codecs: `encodeCellRange/decodeCellRange`, `encodeSheetDescriptor/decodeSheetDescriptor`, `decodeFieldDef/decodeTableDef/decodeEnumOption`; relationship, validation-rule (`CheckpointValidationRuleV1`), inert, decision, lineage codecs (internal).
