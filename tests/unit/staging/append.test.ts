/**
 * CA-23 at M23's boundary: a delimited file appended into an app that exists
 * (D38), through `appendTable` over the staging fakes' store.
 *
 * The target app is a real promotion of `field-log-messy.csv`; the appended
 * file is `crew-roster.tsv`, parsed, staged and inferred by the real modules.
 * Every assertion reads the stored bytes back — the new head, the new segment
 * and the chain it continues, the re-sealed source — and the oversized case
 * proves the store is untouched. The browser leg (`workbook-journey.spec.ts`)
 * runs the same append on real crypto and IndexedDB, with the tail hydrated.
 */

import { describe, expect, it } from "vitest";
import { testFormulaIdentities } from "../import/delimited-proposal.js";
import { asStorageId16, decodeStorageId16, encodeStorageId16 } from "../../../src/domain/model/bytes.js";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { parseDelimited } from "../../../src/import/formats/delimited/parse.js";
import { delimitedStream } from "../../../src/import/inference/infer.js";
import { applyRejectionMemory } from "../../../src/import/inference/rejection-memory.js";
import { inferWorkbook } from "../../../src/import/inference/workbook.js";
import { isDelimitedSniff, preflightDelimited } from "../../../src/import/preflight/preflight.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import type { RandomAccessSource } from "../../../src/import/source/source.js";
import { APPEND_MAX_EVENTS, appendTable } from "../../../src/import/staging/append.js";
import { encodeCleanupTicket } from "../../../src/import/staging/cleanup.js";
import { encodeImportEventPayload } from "../../../src/import/staging/events.js";
import {
  createImportStage,
  stageWithProposal,
  writeImportStage,
  type LoadedImportStageV1,
} from "../../../src/import/staging/lifecycle.js";
import { promoteImport } from "../../../src/import/staging/promotion.js";
import { decodeAppHead, decodeCheckpointManifest } from "../../../src/import/staging/roots.js";
import type { ImportDestinationV1 } from "../../../src/import/staging/stage.js";
import { decodeEventSegment, verifyCommitChain } from "../../../src/persistence/codecs/event-commit.js";
import { encodeCanonical, decodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import { decodeTailEventPayload, encodeRecordEventPayload } from "../../../src/workers/data/record-event-payloads.js";
import { rejectionMemoryOf, tailDecisionsOf } from "../../../src/workers/data/import-handlers.js";
import { overSegmentCsv } from "../../fixtures/workbooks/append/over-segment.js";
import { fixtureSource, textSource } from "../import/fixtures.js";
import { stagingHarness, type StagingHarnessV1 } from "./fakes.js";

const DEVICE = Uint8Array.from({ length: 16 }, (_, index) => index + 9) as never;

async function stageDelimited(
  harness: StagingHarnessV1,
  source: RandomAccessSource,
  fileName: string,
  destination: ImportDestinationV1,
  tableNames: readonly string[] | null,
): Promise<{ loaded: LoadedImportStageV1; facts: WorkbookFactStreamItemV2[] }> {
  const sniff = await sniffContent(source, fileName);
  if (!isDelimitedSniff(sniff)) throw new Error(`${fileName} is not delimited`);
  const preflight = await preflightDelimited(source, sniff);
  if (preflight.kind !== "proceed") throw new Error(`${fileName} was refused`);
  const facts: WorkbookFactStreamItemV2[] = [];
  for await (const item of parseDelimited(source, sniff.format, { sheetName: fileName.replace(/\.[^.]*$/, "") })) {
    facts.push(item);
  }
  const created = await createImportStage(harness.ports, harness.localRoot, {
    fileName,
    format: "delimited",
    destination,
    detected: sniff.format,
    contradiction: null,
    preflight: preflight.report,
    inventory: null,
    sourceByteLength: source.byteLength,
    selectedSheets: [0],
  });
  const bytes = await source.slice(0, source.byteLength);
  const revision = harness.catalog.expectation().transactionRevision + 1;
  const sourceId = asStorageId16(harness.ports.entropy.randomBytes(16));
  const frame = await harness.crypto.seal({
    scope: "app.source-chunk",
    storageId: sourceId,
    logicalRevision: BigInt(revision),
    payloadKind: "app.source-chunk",
    payload: bytes,
    compression: "none",
    key: created.loaded.provisionalKey,
  });
  const sourced = await writeImportStage(
    harness.ports,
    harness.localRoot,
    created.loaded,
    {
      ...created.loaded.stage,
      stageRevision: created.loaded.stage.stageRevision + 1,
      sourceChunks: [
        { storageId: encodeStorageId16(sourceId), sequence: 0, decodedByteLength: bytes.byteLength, sha256: await harness.crypto.sha256(bytes) },
      ],
      retainedStorageIds: [encodeStorageId16(sourceId)],
      status: "staged",
    },
    { addFrames: [frame] },
  );
  const proposal = inferWorkbook(delimitedStream(facts), {
    fileName,
    sheetSelection: null,
    rejectionMemory: new Set(),
    fingerprintOf: (input) => input,
    formulaIdentities: testFormulaIdentities(),
    existingApp: tableNames === null ? null : { tableNames },
  });
  const reviewed = await writeImportStage(harness.ports, harness.localRoot, sourced.loaded, stageWithProposal(sourced.loaded.stage, proposal));
  return { loaded: reviewed.loaded, facts };
}

const catalogFor = (harness: StagingHarnessV1) => ({
  sealCleanupTicket: (input: { storageId: never; ticketId: string; storageIds: readonly string[]; logicalRevision: number }) =>
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
  commitCatalog: (input: { removeWorkflowStorageId: string; addCleanupTicketStorageId: string; logicalRevision: number }) => {
    const refs = harness.catalog.readRefs();
    return harness.catalog.sealWithRefs(
      {
        activeWorkflowStorageIds: refs.activeWorkflowStorageIds.filter((id) => id !== input.removeWorkflowStorageId),
        cleanupTicketStorageIds: [...refs.cleanupTicketStorageIds, input.addCleanupTicketStorageId],
      },
      BigInt(input.logicalRevision),
    );
  },
});

/** A promoted `field-log-messy.csv` app, and everything an append needs to know about it. */
async function appOf(harness: StagingHarnessV1) {
  const { loaded, facts } = await stageDelimited(
    harness,
    await fixtureSource("delimited/field-log-messy.csv"),
    "field-log-messy.csv",
    { kind: "new-app" },
    null,
  );
  const promoted = await promoteImport(
    { ports: harness.ports, clock: { nowEpochMs: () => 1_790_000_000_000 }, localRoot: harness.localRoot, ...catalogFor(harness) },
    { loaded, facts, sourceChunks: loaded.stage.sourceChunks, acceptedName: "Field Log", deviceId: DEVICE },
  );
  if (promoted.kind !== "promoted") throw new Error("the target app did not promote");
  const appKey = loaded.provisionalKey;
  const open = async (storageId: string, scope: string, kind: string) => {
    const frame = await harness.store.getEnvelope(decodeStorageId16(storageId));
    if (frame === undefined) throw new Error(`no row ${storageId}`);
    return (await harness.crypto.open(frame, scope as never, appKey, kind as never)).payload;
  };
  const headStorageId = promoted.receipt.appHeadStorageId;
  const head = decodeAppHead(await open(headStorageId, "app.head", "app.head"));
  const checkpoint = decodeCheckpointManifest(await open(head.checkpoint.storageId, "app.checkpoint", "app.checkpoint-manifest"));
  const segment = decodeEventSegment(await open(head.eventSegments[0]?.storageId as string, "app.events", "app.event-segment"));
  const commit = segment.commits[0];
  if (commit === undefined) throw new Error("no commit");
  const target = {
    appId: promoted.receipt.appId,
    appKey,
    head,
    headStorageId,
    chain: {
      deviceCommitSequence: 1n,
      lastCommitSha256: commit.commitSha256,
      lastHybridTime: commit.hybridTime,
      frontier: head.frontier,
      commits: [commit],
    },
    tables: checkpoint.tables,
    enumOptions: checkpoint.enumOptions,
    relationships: checkpoint.relationships,
    sheetCount: checkpoint.sheetSnapshots.length,
    referenceExists: () => false,
    rowCountBefore: promoted.receipt.rowCount,
  };
  return { target, open, firstCommit: commit };
}

const appendDeps = (harness: StagingHarnessV1) => ({
  ports: harness.ports,
  clock: { nowEpochMs: () => 1_790_000_100_000 },
  encodeRecordCreated: (record: never, importedInvalid: boolean) =>
    encodeRecordEventPayload({ kind: "record.created", payload: { record, importedInvalid } }),
  ...catalogFor(harness),
});

describe("appending a delimited file into an existing app (D38, CA-23)", () => {
  it.each([false, true])("continues the chain and preserves the old graph exactly when pinned (%s)", async (pinned) => {
    const harness = stagingHarness();
    const { target, open, firstCommit } = await appOf(harness);
    const { loaded, facts } = await stageDelimited(
      harness,
      await fixtureSource("delimited/crew-roster.tsv"),
      "crew-roster.tsv",
      { kind: "existing-app", appId: target.appId },
      target.tables.map((table) => table.displayName),
    );

    const result = await appendTable({ ...appendDeps(harness), isHeadPinned: () => Promise.resolve(pinned) } as never, { loaded, facts, target, deviceId: DEVICE });

    expect(result).toMatchObject({ kind: "appended", receipt: { rowCount: 4 } });
    if (result.kind !== "appended") return;
    const head = decodeAppHead(await open(result.receipt.appHeadStorageId, "app.head", "app.head"));
    expect(head.headRevision).toBe(2n);
    expect(head.schemaRevision).toBe(2n);
    expect(head.eventSegments).toHaveLength(2);
    expect(head.sourceManifests).toHaveLength(2);
    expect(head.snapshotManifests).toHaveLength(2);
    // The checkpoint is the promotion's, untouched: the new table lives in the tail.
    expect(head.checkpoint).toEqual(target.head.checkpoint);
    // The staging workflow is gone; backup retention alone preserves the head.
    expect(harness.store.has(target.headStorageId)).toBe(pinned);
    if (pinned) expect(decodeAppHead(await open(target.headStorageId, "app.head", "app.head"))).toEqual(target.head);
    expect(harness.store.has(loaded.workflowStorageId)).toBe(false);

    const segment = decodeEventSegment(await open(head.eventSegments[1]?.storageId as string, "app.events", "app.event-segment"));
    const commit = segment.commits[0];
    if (commit === undefined) throw new Error("no appended commit");
    expect(commit.eventClass).toBe("import");
    expect(commit.deviceCommitSequence).toBe(2n);
    expect(commit.previousDeviceCommitSha256).toEqual(firstCommit.commitSha256);
    expect([commit.schemaRevisionBefore, commit.schemaRevisionAfter]).toEqual([1n, 2n]);
    await verifyCommitChain([firstCommit, commit], (bytes) => harness.crypto.sha256(bytes));
    const kinds = commit.events.map((event) => event.kind);
    expect(kinds[0]).toBe("table.created");
    expect(kinds.filter((kind) => kind === "field.created")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "record.created")).toHaveLength(4);
    expect(kinds).not.toContain("import.accepted");
    expect(kinds).not.toContain("app.created");

    // The table's sheet descriptor names the snapshot the head now lists.
    const created = decodeTailEventPayload("table.created", decodeCanonical(encodeCanonical(commit.events[0]?.payload as never)));
    if (created.kind !== "table.created" || created.payload.sourceSheet === null) throw new Error("no descriptor");
    expect(head.snapshotManifests.map((ref) => ref.storageId)).toContain(created.payload.sourceSheet.snapshotManifestStorageId);
    expect(created.payload.table.displayName).toBe("Crew Roster");
    expect(created.payload.table.tableOrdinal).toBe(1);
    expect(created.payload.sourceSheet.sheetOrdinal).toBe(1);

    // The source is the app's now: readable under the app key.
    const source = await open(head.sourceManifests[1]?.storageId as string, "app.source-manifest", "app.source-manifest");
    expect(source.byteLength).toBeGreaterThan(0);
  });

  it("names the new table apart from the app's own (D38)", async () => {
    const harness = stagingHarness();
    const { target } = await appOf(harness);
    const { loaded } = await stageDelimited(
      harness,
      await fixtureSource("delimited/crew-roster.tsv"),
      "field-log-messy.tsv",
      { kind: "existing-app", appId: target.appId },
      target.tables.map((table) => table.displayName),
    );
    expect(target.tables.map((table) => table.displayName)).toEqual(["Field Log Messy"]);
    expect(loaded.stage.proposal?.tables[0]?.tableName).toBe("Field Log Messy 2");
  });

  it("refuses an append whose one commit would pass the segment cap, and writes nothing", async () => {
    const harness = stagingHarness();
    const { target } = await appOf(harness);
    const { loaded, facts } = await stageDelimited(
      harness,
      textSource(overSegmentCsv()),
      "over-segment.csv",
      { kind: "existing-app", appId: target.appId },
      target.tables.map((table) => table.displayName),
    );
    expect(loaded.stage.proposal?.tables[0]?.rowCount).toBeGreaterThan(APPEND_MAX_EVENTS);
    const rows = harness.store.rows.size;
    const revision = harness.catalog.expectation().transactionRevision;

    const result = await appendTable(appendDeps(harness) as never, { loaded, facts, target, deviceId: DEVICE });

    expect(result).toEqual({ kind: "rejected", reason: "append-too-large", report: null, columnKeys: new Map() });
    expect(harness.store.rows.size).toBe(rows);
    expect(harness.catalog.expectation().transactionRevision).toBe(revision);
    expect(harness.store.has(target.headStorageId)).toBe(true);
  });
});

describe("rejection memory for an append (D44)", () => {
  it("reads rejected decisions from the projection and from the tail, and marks the statement they name", async () => {
    const harness = stagingHarness();
    const source = await fixtureSource("delimited/crew-roster.tsv");
    const { loaded } = await stageDelimited(harness, source, "crew-roster.tsv", { kind: "new-app" }, null);
    const proposal = loaded.stage.proposal;
    if (proposal === null) throw new Error("no proposal");
    const statement = proposal.statements.find((candidate) => candidate.subject === "field-type");
    if (statement === undefined) throw new Error("no field-type statement");
    const fingerprint = await harness.crypto.sha256(new TextEncoder().encode(statement.evidenceFingerprint));
    const hex = [...fingerprint].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    // An append's decision lives in the tail until a checkpoint materializes it.
    const tail = tailDecisionsOf({
      checkpoint: { frontier: [{ deviceId: DEVICE, commitSequence: 1n }] } as never,
      commits: [
        {
          deviceId: DEVICE,
          deviceCommitSequence: 2n,
          events: [
            {
              kind: "inference-decision.recorded",
              payload: decodeCanonical(
                encodeCanonical(
                  encodeImportEventPayload.inferenceDecision({
                    evidenceFingerprint: fingerprint,
                    statement: { ...statement, disposition: "rejected" },
                    disposition: "rejected",
                  }),
                ),
              ),
            },
          ],
        },
      ] as never,
    });
    expect(tail).toEqual([{ decisionKind: "column-type", evidenceFingerprint: fingerprint, disposition: "rejected" }]);

    const memory = rejectionMemoryOf(
      [
        { decisionKind: "relationship", evidenceFingerprint: new Uint8Array(32).fill(1), disposition: "rejected" },
        { decisionKind: "header", evidenceFingerprint: new Uint8Array(32).fill(2), disposition: "edited" },
      ],
      tail,
    );
    expect(memory).toEqual(new Set([`relationship:${"01".repeat(32)}`, `column-type:${hex}`]));

    const remembered = applyRejectionMemory(proposal, memory, (input) => (input === statement.evidenceFingerprint ? hex : ""));
    const marked = remembered.statements.find((candidate) => candidate.statementId === statement.statementId);
    expect(marked?.disposition).toBe("rejected");
    expect(marked?.evidence).toContainEqual({ kind: "previously-rejected" });
  });
});
