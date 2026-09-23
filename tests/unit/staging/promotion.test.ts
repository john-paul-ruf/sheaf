/**
 * CA-19 / CA-20 / CA-22 at M23's own boundary: the demo workbook, promoted.
 *
 * Everything upstream is real — the OOXML adapter's facts through the worker's
 * registry, S02's `inferWorkbook`, a review edit that rejects the Visits→Jobs
 * relationship — and promotion writes into the staging fakes' store. Every
 * assertion then reads the **stored bytes back** (decrypted by the fake
 * crypto, decoded by M23/M22's own decoders), never promotion's own report.
 * The browser journey (`tests/browser/worker/workbook-journey.spec.ts`) runs
 * the same promotion on real crypto and IndexedDB and hydrates it.
 */

import { describe, expect, it } from "vitest";
import { asStorageId16, decodeStorageId16, encodeStorageId16 } from "../../../src/domain/model/bytes.js";
import { compareDomainIds, encodeDomainId } from "../../../src/domain/model/ids.js";
import { INERT_REASON_KEYS } from "../../../src/domain/model/snapshots.js";
import { PRESERVED_REASON_KEYS } from "../../../src/import/facts/index.js";
import { applyWorkbookReviewEdit } from "../../../src/import/inference/review-edits.js";
import { inferWorkbook } from "../../../src/import/inference/workbook.js";
import type { ProposedWorkbookV1 } from "../../../src/import/inference/workbook-proposal.js";
import { decodeSheetSnapshotChunk, decodeSheetSnapshotManifest } from "../../../src/import/snapshots/sheet-snapshot.js";
import { decodeSourceManifest } from "../../../src/import/snapshots/source-chunks.js";
import { encodeCleanupTicket } from "../../../src/import/staging/cleanup.js";
import {
  createImportStage,
  stageWithProposal,
  writeImportStage,
  type LoadedImportStageV1,
} from "../../../src/import/staging/lifecycle.js";
import {
  allocateSchema,
  buildRecords,
  INERT_REASON_OF,
  paginate,
  paginateBaseline,
  promoteImport,
  PROMOTION_REJECTIONS,
} from "../../../src/import/staging/promotion.js";
import {
  checkpointSemanticBody,
  decodeAppHead,
  decodeCheckpointManifest,
  decodeRecordPage,
  encodeBaselinePage,
  encodeRecordPage,
  PAGE_MAX_DECODED_BYTES,
  RECORD_PAGE_MAX_RECORDS,
  type BaselineEntryV1,
  type StoredRecordV1,
} from "../../../src/import/staging/roots.js";
import { IMPORT_STAGE_PAYLOAD_KIND, IMPORT_STAGE_SCOPE } from "../../../src/import/staging/stage.js";
import { decodeEventSegment } from "../../../src/persistence/codecs/event-commit.js";
import type { EnvelopeKeyRefV1 } from "../../../src/application/ports/envelope-crypto.js";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { SequenceEntropy, stagingHarness, type StagingHarnessV1 } from "./fakes.js";
import { WORKBOOK_FIXTURE_DIRECTORIES, streamWorkbookFixture, workbookFixturePaths } from "./workbook-streams.js";

const SELECTED = [0, 1, 2, 3, 4, 5];

interface PromotedDemoV1 {
  readonly harness: StagingHarnessV1;
  readonly key: EnvelopeKeyRefV1;
  readonly proposal: ProposedWorkbookV1;
  readonly result: Awaited<ReturnType<typeof promoteImport>>;
}

async function stageDemo(harness: StagingHarnessV1): Promise<{ loaded: LoadedImportStageV1; facts: WorkbookFactStreamItemV2[]; proposal: ProposedWorkbookV1 }> {
  const stream = await streamWorkbookFixture("ooxml/fieldwork-q3.xlsx", { selection: SELECTED });
  if (stream === null) throw new Error("the demo workbook did not size");
  const inventory = stream.report.sheets.map((sheet) => ({
    sheetIndex: sheet.sheetIndex,
    name: sheet.name,
    sheetKind: sheet.kind,
    visibility: sheet.visibility,
    estimatedRowCount: sheet.estimatedRowCount,
    estimatedCellCount: sheet.estimatedCellCount,
  }));
  const inferred = inferWorkbook(stream.items, {
    fileName: "fieldwork-q3.xlsx",
    sheetSelection: inventory.map((sheet) => ({ ...sheet, isSelected: SELECTED.includes(sheet.sheetIndex) })),
    rejectionMemory: new Set(),
    fingerprintOf: (input) => input,
    existingApp: null,
  });
  const edited = applyWorkbookReviewEdit(inferred, { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" });
  if (edited.kind !== "applied") throw new Error(`edit rejected: ${edited.reason}`);

  const created = await createImportStage(harness.ports, harness.localRoot, {
    fileName: "fieldwork-q3.xlsx",
    format: "xlsx",
    destination: { kind: "new-app" },
    detected: { kind: "zip-container", container: "ooxml" },
    contradiction: null,
    preflight: null,
    inventory,
    sourceByteLength: 3,
    selectedSheets: SELECTED,
  });
  // One retained source chunk, sealed like the data worker seals one.
  const revision = harness.catalog.expectation().transactionRevision + 1;
  const sourceId = asStorageId16(harness.ports.entropy.randomBytes(16));
  const sourceBytes = new Uint8Array([1, 2, 3]);
  const sourceFrame = await harness.crypto.seal({
    scope: "app.source-chunk",
    storageId: sourceId,
    logicalRevision: BigInt(revision),
    payloadKind: "app.source-chunk",
    payload: sourceBytes,
    compression: "none",
    key: created.loaded.provisionalKey,
  });
  const withSource = {
    ...created.loaded.stage,
    stageRevision: created.loaded.stage.stageRevision + 1,
    sourceChunks: [
      { storageId: encodeStorageId16(sourceId), sequence: 0, decodedByteLength: 3, sha256: await harness.crypto.sha256(sourceBytes) },
    ],
    retainedStorageIds: [encodeStorageId16(sourceId)],
    status: "staged" as const,
  };
  const sourced = await writeImportStage(harness.ports, harness.localRoot, created.loaded, withSource, {
    addFrames: [sourceFrame],
  });
  const reviewed = await writeImportStage(
    harness.ports,
    harness.localRoot,
    sourced.loaded,
    stageWithProposal(sourced.loaded.stage, edited.proposal),
  );
  return { loaded: reviewed.loaded, facts: [...stream.items], proposal: edited.proposal };
}

async function promoteDemo(): Promise<PromotedDemoV1> {
  const harness = stagingHarness();
  const { loaded, facts, proposal } = await stageDemo(harness);
  const result = await promoteImport(
    {
      ports: harness.ports,
      clock: { nowEpochMs: () => 1_790_000_000_000 },
      localRoot: harness.localRoot,
      commitCatalog: async (input) => {
        const refs = harness.catalog.readRefs();
        return harness.catalog.sealWithRefs(
          {
            activeWorkflowStorageIds: refs.activeWorkflowStorageIds.filter((id) => id !== input.removeWorkflowStorageId),
            cleanupTicketStorageIds: [...refs.cleanupTicketStorageIds, input.addCleanupTicketStorageId],
          },
          BigInt(input.logicalRevision),
        );
      },
      sealCleanupTicket: (input) =>
        harness.crypto.seal({
          scope: "local.cleanup",
          storageId: input.storageId,
          logicalRevision: BigInt(input.logicalRevision),
          payloadKind: "local.cleanup-ticket",
          payload: encodeCleanupTicket({
            ticketVersion: 1,
            ticketId: input.ticketId,
            reason: "import-promoted",
            storageIds: [...input.storageIds].sort(),
            cursor: 0,
            createdAtRevision: input.logicalRevision,
          }),
          compression: "deflate-raw-v1",
          key: harness.localRoot,
        }),
    },
    {
      loaded,
      facts,
      sourceChunks: loaded.stage.sourceChunks,
      acceptedName: "Fieldwork Q3",
      deviceId: Uint8Array.from({ length: 16 }, (_, index) => index + 9) as never,
    },
  );
  return { harness, key: loaded.provisionalKey, proposal, result };
}

let cached: PromotedDemoV1 | undefined;
const promoted = async (): Promise<PromotedDemoV1> => (cached ??= await promoteDemo());

/** Each root's scope and payload kind, as promotion seals it. */
const KIND_OF = {
  "app.head": "app.head",
  "app.checkpoint": "app.checkpoint-manifest",
  "app.records": "app.record-page",
  "app.source-manifest": "app.source-manifest",
  "app.snapshot-manifest": "app.snapshot-manifest",
  "app.snapshot-chunk": "app.snapshot-chunk",
  "app.events": "app.event-segment",
} as const;

const open = async (demo: PromotedDemoV1, storageId: string, scope: keyof typeof KIND_OF) => {
  const frame = await demo.harness.store.getEnvelope(decodeStorageId16(storageId));
  if (frame === undefined) throw new Error(`no row ${storageId}`);
  return (await demo.harness.crypto.open(frame, scope, demo.key, KIND_OF[scope])).payload;
};

const roots = async (demo: PromotedDemoV1) => {
  if (demo.result.kind !== "promoted") throw new Error(`not promoted: ${demo.result.reason}`);
  const head = decodeAppHead(await open(demo, demo.result.receipt.appHeadStorageId, "app.head"));
  const checkpointBytes = await open(demo, head.checkpoint.storageId, "app.checkpoint");
  const checkpoint = decodeCheckpointManifest(checkpointBytes);
  const records = (
    await Promise.all(checkpoint.recordPages.map(async (page) => decodeRecordPage(await open(demo, page.storageId, "app.records"))))
  ).flatMap((page) => page.records);
  return { head, checkpoint, checkpointBytes, records };
};

describe("promoting the demo workbook (CA-19/20/22)", () => {
  it("creates one table per promoted table, keyed and labelled as reviewed", async () => {
    const demo = await promoted();
    const { checkpoint } = await roots(demo);

    expect(demo.result).toMatchObject({ kind: "promoted", receipt: { tableCount: 5 } });
    expect(checkpoint.tables.map((table) => table.displayName)).toEqual(["Jobs", "Customers", "Crew", "Visits", "Materials"]);
    const byName = new Map(checkpoint.tables.map((table) => [table.displayName, table]));
    for (const name of ["Jobs", "Customers"]) {
      const table = byName.get(name);
      expect(table?.keyFieldId, name).not.toBeNull();
      expect(table?.labelFieldId, name).not.toBeNull();
    }
  });

  it("writes each table's rows as the review counted them, a joined region inside its head", async () => {
    const demo = await promoted();
    const { checkpoint, records } = await roots(demo);
    for (const table of checkpoint.tables) {
      const proposed = demo.proposal.tables.filter(
        (candidate) =>
          candidate.tableName === table.displayName ||
          demo.proposal.tables.find((head) => head.tableName === table.displayName)?.tableKey === candidate.joinedToTableKey,
      );
      const expected = proposed.reduce((sum, candidate) => sum + candidate.rowCount, 0);
      expect(records.filter((record) => compareDomainIds(record.tableId, table.tableId) === 0), table.displayName).toHaveLength(
        expected,
      );
    }
    expect(demo.result.kind === "promoted" && demo.result.receipt.rowCount).toBe(records.length);
  });

  it("turns a matched key into a reference, and an unmatched one into the flagged original key (D36)", async () => {
    const demo = await promoted();
    const { checkpoint, records } = await roots(demo);
    const jobs = checkpoint.tables.find((table) => table.displayName === "Jobs");
    const customers = checkpoint.tables.find((table) => table.displayName === "Customers");
    const relationship = checkpoint.relationships.find(
      (candidate) => jobs !== undefined && compareDomainIds(candidate.fromTableId, jobs.tableId) === 0,
    );
    if (jobs === undefined || customers === undefined || relationship === undefined) throw new Error("expected Jobs → Customers");
    expect(compareDomainIds(relationship.toTableId, customers.tableId)).toBe(0);
    expect(compareDomainIds(relationship.toKeyFieldId, customers.keyFieldId as never)).toBe(0);
    expect(relationship.detectionSource).toBe("lookup-formula");

    const customerIds = new Set(
      records.filter((record) => compareDomainIds(record.tableId, customers.tableId) === 0).map((record) => encodeDomainId(record.recordId)),
    );
    const references = records
      .filter((record) => compareDomainIds(record.tableId, jobs.tableId) === 0)
      .map((record) => record.values.find((entry) => compareDomainIds(entry.fieldId, relationship.fromFieldId) === 0));
    const resolved = references.filter((entry) => entry?.value.kind === "reference");
    const broken = references.filter((entry) => entry?.value.kind === "invalid-preserved");
    expect(resolved.length).toBeGreaterThan(0);
    for (const entry of resolved) {
      expect(customerIds.has(encodeDomainId((entry?.value as { recordId: Uint8Array }).recordId as never))).toBe(true);
    }
    // S02's pin: one distinct unmatched key.
    expect(new Set(broken.map((entry) => (entry?.value as { sourceText: string }).sourceText)).size).toBe(1);
    const flagged = records.filter((record) =>
      record.issues.some((issue) => issue.kind === "broken-reference" && issue.severity === "warning"),
    );
    expect(flagged).toHaveLength(broken.length);
  });

  it("keeps the rejected relationship out, the child a text field, and the rejection a decision", async () => {
    const demo = await promoted();
    const { checkpoint } = await roots(demo);
    const visits = checkpoint.tables.find((table) => table.displayName === "Visits");
    expect(checkpoint.relationships).toHaveLength(1);
    expect(visits?.fields.find((field) => field.displayName === "Job ID")?.type).toEqual({ kind: "text" });
    const rejection = checkpoint.inferenceDecisions.find((decision) => decision.decisionKind === "relationship");
    expect(rejection).toMatchObject({ subject: "relationship", disposition: "rejected" });
    expect(rejection?.evidenceFingerprint.byteLength).toBe(32);
  });

  it("writes every F03 root: inert items with M01 reasons, lineage, one snapshot per selected sheet", async () => {
    const demo = await promoted();
    const { head, checkpoint, checkpointBytes } = await roots(demo);

    expect(checkpoint.inertItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["chart", "drawing", "formula", "cell-styling"]),
    );
    for (const item of checkpoint.inertItems) expect(INERT_REASON_KEYS).toContain(item.reasonKey);

    expect(checkpoint.importLineages).toHaveLength(1);
    const source = decodeSourceManifest(await open(demo, head.sourceManifests[0]?.storageId as string, "app.source-manifest"));
    expect(checkpoint.importLineages[0]?.sourceSha256).toEqual(source.chunkedSha256);

    // Six selected sheets, six snapshots; Archive 2018 was not selected (D39).
    expect(checkpoint.sheetSnapshots.map((sheet) => sheet.displayName)).toEqual([
      "Jobs",
      "Customers",
      "Crew",
      "Visits",
      "Materials",
      "Overview",
    ]);
    expect(head.snapshotManifests).toHaveLength(6);
    const listed = new Set(head.snapshotManifests.map((ref) => ref.storageId));
    for (const sheet of checkpoint.sheetSnapshots) {
      expect(listed.has(sheet.snapshotManifestStorageId)).toBe(true);
      const manifest = decodeSheetSnapshotManifest(await open(demo, sheet.snapshotManifestStorageId, "app.snapshot-manifest"));
      expect(manifest.classification).toEqual(sheet.classification);
      for (const chunk of manifest.chunks) {
        const decoded = decodeSheetSnapshotChunk(await open(demo, chunk.storageId, "app.snapshot-chunk"));
        expect(decoded.rows[0]?.rowIndex).toBe(chunk.firstRow);
        expect(decoded.rows.at(-1)?.rowIndex).toBe(chunk.lastRow);
      }
    }
    expect(checkpoint.sheetSnapshots.find((sheet) => sheet.displayName === "Overview")?.classification).toEqual(
      expect.arrayContaining(["summary"]),
    );

    // The digest covers the body as written.
    expect(await demo.harness.crypto.sha256(checkpointSemanticBody(checkpointBytes))).toEqual(checkpoint.semanticSha256);
  });

  it("commits one import-class commit of schema events, decisions, and no record.created", async () => {
    const demo = await promoted();
    const { head } = await roots(demo);
    const segment = decodeEventSegment(await open(demo, head.eventSegments[0]?.storageId as string, "app.events"));
    const kinds = segment.commits[0]?.events.map((event) => event.kind) ?? [];
    expect(segment.commits).toHaveLength(1);
    expect(segment.commits[0]?.eventClass).toBe("import");
    expect(kinds[0]).toBe("app.created");
    expect(kinds.at(-1)).toBe("import.accepted");
    expect(kinds.filter((kind) => kind === "table.created")).toHaveLength(5);
    expect(kinds).toContain("inference-decision.recorded");
    expect(kinds).not.toContain("record.created");
  });

  it("maps every M65 preserved reason onto an M01 inert reason (auto-decision (a))", () => {
    expect(Object.keys(INERT_REASON_OF).sort()).toEqual([...PRESERVED_REASON_KEYS].sort());
    for (const key of PRESERVED_REASON_KEYS) expect(INERT_REASON_KEYS).toContain(INERT_REASON_OF[key]);
    expect(INERT_REASON_OF).toMatchObject({
      "formula-not-live-yet": "formula-not-live-yet",
      "pivot-not-live-yet": "chart-not-live-yet",
      "visual-only": "object-not-rendered",
      "external-source-not-fetched": "link-not-followed",
      "script-not-run": "script-never-runs",
    });
  });

  it("refuses a proposal whose rows the plan reads differently, and writes nothing", async () => {
    const harness = stagingHarness();
    const { loaded, facts } = await stageDemo(harness);
    const lying = {
      ...loaded,
      stage: {
        ...loaded.stage,
        proposal: {
          ...(loaded.stage.proposal as ProposedWorkbookV1),
          tables: (loaded.stage.proposal as ProposedWorkbookV1).tables.map((table, index) =>
            index === 0 ? { ...table, rowCount: table.rowCount + 1 } : table,
          ),
        },
      },
    };
    const before = harness.store.rows.size;
    await expect(
      promoteImport(
        {
          ports: harness.ports,
          clock: { nowEpochMs: () => 0 },
          localRoot: harness.localRoot,
          commitCatalog: () => Promise.reject(new Error("must not commit")),
          sealCleanupTicket: () => Promise.reject(new Error("must not seal")),
        },
        { loaded: lying, facts, sourceChunks: [], acceptedName: "X", deviceId: new Uint8Array(16) as never },
      ),
    ).rejects.toThrow(/row plan/);
    expect(harness.store.rows.size).toBe(before);
    expect(PROMOTION_REJECTIONS).toContain("empty-table");
    // The stage payload is untouched and still readable.
    expect(harness.store.has(loaded.stageStorageId)).toBe(true);
    void IMPORT_STAGE_SCOPE;
    void IMPORT_STAGE_PAYLOAD_KIND;
  });
});

describe("the row plan (CA-19)", () => {
  it("places every readable fixture's rows exactly as inference counted them, in all five corpora", async () => {
    let planned = 0;
    for (const directory of WORKBOOK_FIXTURE_DIRECTORIES) {
      for (const path of await workbookFixturePaths(directory)) {
        const sized = await streamWorkbookFixture(path);
        if (sized === null) continue;
        const stream = await streamWorkbookFixture(path, { selection: sized.report.sheets.map((sheet) => sheet.sheetIndex) });
        if (stream === null || stream.failure !== null) continue;
        const proposal = inferWorkbook(stream.items, {
          fileName: path,
          sheetSelection: null,
          rejectionMemory: new Set(),
          fingerprintOf: (input) => input,
          existingApp: null,
        });
        const entropy = new SequenceEntropy();
        // `buildRecords` refuses a plan whose counts differ from the proposal's.
        const built = await buildRecords(entropy, proposal, allocateSchema(entropy, proposal), stream.items);
        const expected = proposal.tables.reduce((sum, table) => sum + table.rowCount, 0);
        expect(built.records, path).toHaveLength(expected);
        planned += 1;
      }
    }
    expect(planned).toBeGreaterThan(40);
  });

  it("follows the stream: the ODS pair's tables, declared before their rows, take every row, as inference did", async () => {
    // The ODS adapter states each sheet's database range before the sheet's
    // rows (S02's ordering rule), so the review proposes one declared table
    // per sheet holding all its data rows, and the app must be that proposal —
    // not a second reading of the rows.
    const stream = await streamWorkbookFixture("ods/fieldwork-jobs-customers.ods");
    if (stream === null) throw new Error("the ODS pair did not size");
    const proposal = inferWorkbook(stream.items, {
      fileName: "fieldwork-jobs-customers.ods",
      sheetSelection: null,
      rejectionMemory: new Set(),
      fingerprintOf: (input) => input,
      existingApp: null,
    });
    expect(proposal.tables.map((table) => `${table.tableKey}:${String(table.rowCount)}`)).toEqual([
      "s0.t0:60",
      "s1.t0:12",
    ]);
    const entropy = new SequenceEntropy();
    const built = await buildRecords(entropy, proposal, allocateSchema(entropy, proposal), stream.items);
    expect(built.records).toHaveLength(72);
  });
});

// ------------------------------------ pages inside their caps (the full demo) --

/** Distinct ids however many are drawn (`SequenceEntropy` repeats after 256). */
const countingEntropy = () => {
  let next = 0;
  return {
    randomBytes(byteLength: number): Uint8Array {
      next += 1;
      const bytes = new Uint8Array(byteLength);
      new DataView(bytes.buffer).setUint32(0, next);
      return bytes;
    },
  };
};

const baselineOf = (records: readonly StoredRecordV1[]): BaselineEntryV1[] =>
  records.map((record) => ({ tableId: record.tableId, recordId: record.recordId, state: "present", values: record.values }));

const SCOPE = new Uint8Array(16).fill(7);

/** Every page encodes inside both caps, and each is as full as they allow: the next item would not have fit. */
function expectFullPages<T>(pages: readonly (readonly T[])[], encode: (items: readonly T[]) => Uint8Array): void {
  pages.forEach((page, index) => {
    expect(encode(page).byteLength).toBeLessThanOrEqual(PAGE_MAX_DECODED_BYTES);
    const next = pages[index + 1]?.[0];
    if (next !== undefined) expect(() => encode([...page, next])).toThrow(/exceeds/);
  });
}

describe("pages inside their caps: the demo's full selection, Archive 2018 included", () => {
  it("splits records and the original-import baseline into full pages under 512 KiB, every row once, in order", async () => {
    const stream = await streamWorkbookFixture("ooxml/fieldwork-q3.xlsx", { selection: [0, 1, 2, 3, 4, 5, 6] });
    if (stream === null) throw new Error("the demo workbook did not size");
    const proposal = inferWorkbook(stream.items, {
      fileName: "fieldwork-q3.xlsx",
      sheetSelection: null,
      rejectionMemory: new Set(),
      fingerprintOf: (input) => input,
      existingApp: null,
    });
    const entropy = countingEntropy();
    const built = await buildRecords(entropy, proposal, allocateSchema(entropy, proposal), stream.items);
    expect(built.records.length).toBeGreaterThan(2_000);
    const entries = baselineOf(built.records);

    // The counterexample: the one baseline page promotion used to write does
    // not fit its cap, and the data worker answered `integrity`.
    expect(() => encodeBaselinePage({ pageVersion: 1, scopeId: SCOPE, entries })).toThrow(/512 KiB/);

    const baseline = paginateBaseline(SCOPE, entries);
    expect(baseline.length).toBeGreaterThan(1);
    expect(baseline.flat()).toEqual(entries);
    expectFullPages(baseline, (items) => encodeBaselinePage({ pageVersion: 1, scopeId: SCOPE, entries: items }));

    const pages = paginate(built.records);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat()).toEqual(built.records);
    expectFullPages(pages, (records) => encodeRecordPage({ pageVersion: 1, records }));
  });

  it("fills a record page to the byte cap when its rows are wide, and to 1,024 rows when they are narrow", () => {
    const entropy = countingEntropy();
    const tableId = entropy.randomBytes(16) as StoredRecordV1["tableId"];
    const fieldId = entropy.randomBytes(16) as StoredRecordV1["values"][number]["fieldId"];
    const recordsOf = (count: number, width: number): StoredRecordV1[] =>
      Array.from({ length: count }, () => ({
        recordId: entropy.randomBytes(16) as StoredRecordV1["recordId"],
        tableId,
        values: [{ fieldId, value: { kind: "text" as const, text: "x".repeat(width) } }],
        issues: [],
      }));

    const wide = paginate(recordsOf(200, 10_000));
    expect(wide.length).toBeGreaterThan(1);
    expect(wide.every((page) => page.length < RECORD_PAGE_MAX_RECORDS)).toBe(true);
    expectFullPages(wide, (records) => encodeRecordPage({ pageVersion: 1, records }));

    const narrow = paginate(recordsOf(2_500, 1));
    expect(narrow.map((page) => page.length)).toEqual([1_024, 1_024, 452]);
    expectFullPages(narrow, (records) => encodeRecordPage({ pageVersion: 1, records }));

    const wideBaseline = paginateBaseline(SCOPE, baselineOf(recordsOf(200, 10_000)));
    expect(wideBaseline.length).toBeGreaterThan(1);
    expectFullPages(wideBaseline, (items) => encodeBaselinePage({ pageVersion: 1, scopeId: SCOPE, entries: items }));
    expect(paginateBaseline(SCOPE, [])).toEqual([[]]);
  });
});
