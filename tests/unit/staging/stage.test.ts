/**
 * CA-10: `ImportStageV1`'s wire form and its constraints.
 *
 * The stage is the only durable record of an import in flight, so two things
 * are proved here: a stage survives encode/decode unchanged and byte-stably —
 * a review edit that changed shape on the way to disk would silently rewrite
 * what the user reviewed — and every constraint database.md § Import staging
 * states is refused rather than stored.
 *
 * The proposals round-tripped below are built by S02's own inference over real
 * fixtures — the delimited file and the pinned demo workbook — not from
 * hand-written literals: the shape this codec must carry is whatever
 * `inferWorkbook` actually produces (CA-19).
 */

import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  encodeBase64Url,
} from "../../../src/domain/model/bytes.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
} from "../../../src/persistence/codecs/canonical-cbor.js";
import {
  IMPORT_STAGE_PAYLOAD_KIND,
  IMPORT_STAGE_SCOPE,
  IMPORT_STAGE_VERSION,
  decodeImportStage,
  encodeImportStage,
  validateImportStage,
  type ImportStageV1,
  type StagedChunkRefV1,
} from "../../../src/import/staging/stage.js";
import {
  ENVELOPE_PAYLOAD_KINDS_V1,
  ENVELOPE_SCOPES_V1,
} from "../../../src/migrations/003_envelope_format_v1.js";
import { parseDelimited } from "../../../src/import/formats/delimited/parse.js";
import { delimitedStream } from "../../../src/import/inference/infer.js";
import { applyWorkbookReviewEdit } from "../../../src/import/inference/review-edits.js";
import { inferWorkbook } from "../../../src/import/inference/workbook.js";
import type { ProposedWorkbookV1 } from "../../../src/import/inference/workbook-proposal.js";
import { streamWorkbookFixture } from "./workbook-streams.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import {
  isDelimitedSniff,
  preflightDelimited,
  type PreflightReportV1,
} from "../../../src/import/preflight/preflight.js";
import type {
  WorkbookFactStreamItemV2,
} from "../../../src/import/facts/index.js";
import { fixtureSource } from "../import/fixtures.js";

const FIXTURE = "delimited/field-log-messy.csv";

const storageIdText = (seed: number): string =>
  encodeBase64Url(Uint8Array.from({ length: 16 }, (_, index) => seed + index));

const digest = (seed: number): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);

const chunk = (seed: number, sequence: number): StagedChunkRefV1 => ({
  storageId: storageIdText(seed),
  sequence,
  decodedByteLength: 1024,
  sha256: digest(seed),
});

interface Fixture {
  readonly preflight: PreflightReportV1;
  readonly proposal: ProposedWorkbookV1;
}

const CONTEXT = {
  sheetSelection: null,
  rejectionMemory: new Set<string>(),
  fingerprintOf: (input: string): string => input,
  existingApp: null,
};

let cached: Fixture | undefined;

/** Runs the real S03 pipeline once; every test below stages its output. */
async function realFixture(): Promise<Fixture> {
  if (cached !== undefined) {
    return cached;
  }
  const source = await fixtureSource(FIXTURE);
  const sniff = await sniffContent(source, "field-log-messy.csv");
  if (!isDelimitedSniff(sniff)) {
    throw new Error("fixture is not delimited");
  }
  const outcome = await preflightDelimited(source, sniff);
  if (outcome.kind !== "proceed") {
    throw new Error("fixture did not pass pre-flight");
  }

  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of parseDelimited(source, sniff.format, { sheetName: "field-log-messy" })) {
    items.push(item);
  }

  cached = {
    preflight: outcome.report,
    proposal: inferWorkbook(delimitedStream(items), { ...CONTEXT, fileName: "field-log-messy.csv" }),
  };
  return cached;
}

async function stage(
  overrides: Partial<ImportStageV1> = {},
): Promise<ImportStageV1> {
  const { preflight, proposal } = await realFixture();
  const source = chunk(1, 0);
  const facts = chunk(40, 0);
  const snapshot = chunk(80, 0);

  return {
    stageVersion: IMPORT_STAGE_VERSION,
    stageId: storageIdText(200),
    stageRevision: 1,
    lineageId: Uint8Array.from({ length: 16 }, (_, index) => 7 + index),
    fileName: "field-log-messy.csv",
    format: "delimited",
    destination: { kind: "new-app" },
    detected: {
      kind: "delimited",
      delimiter: ",",
      encoding: "utf-8",
      bomByteLength: 0,
      newline: "lf",
    },
    contradiction: null,
    sourceSha256: digest(120),
    sourceByteLength: preflight.sourceByteLength,
    preflight,
    inventory: null,
    selectedSheets: [0],
    sourceChunks: [source],
    factChunks: [facts],
    snapshotChunks: [snapshot],
    proposal,
    reviewEdits: [],
    retainedStorageIds: [source.storageId, snapshot.storageId],
    temporaryStorageIds: [facts.storageId],
    progress: {
      phase: "reviewing",
      rowsSoFar: proposal.tables[0]?.rowCount ?? 0,
      batchesCommitted: 1,
      ackedBatchSeq: 0,
    },
    status: "reviewing",
    ...overrides,
  };
}

describe("the stage envelope contract", () => {
  it("names a scope and payload kind migration 003 declares", () => {
    expect(ENVELOPE_SCOPES_V1).toContain(IMPORT_STAGE_SCOPE);
    expect(ENVELOPE_PAYLOAD_KINDS_V1).toContain(IMPORT_STAGE_PAYLOAD_KIND);
  });
});

describe("encodeImportStage / decodeImportStage", () => {
  it("round-trips a real staged import byte-identically", async () => {
    const staged = await stage();
    const encoded = encodeImportStage(staged);

    expect(decodeImportStage(encoded)).toEqual(staged);
    expect(encodeImportStage(decodeImportStage(encoded))).toEqual(encoded);
    expect(encodeImportStage(staged)).toEqual(encoded);
  });

  it("carries review edits and the dispositions they set", async () => {
    const { proposal } = await realFixture();
    const edited = applyWorkbookReviewEdit(proposal, {
      kind: "rename-app",
      appName: "Site Field Log",
    });
    if (edited.kind !== "applied") {
      throw new Error(`edit rejected: ${edited.reason}`);
    }

    const staged = await stage({
      proposal: edited.proposal,
      reviewEdits: [{ kind: "rename-app", appName: "Site Field Log" }],
    });
    const decoded = decodeImportStage(encodeImportStage(staged));

    expect(decoded.proposal?.appName).toBe("Site Field Log");
    expect(
      decoded.proposal?.statements.find(
        (statement) => statement.subject === "app-name",
      )?.disposition,
    ).toBe("edited");
    expect(decoded.reviewEdits).toEqual(staged.reviewEdits);
  });

  it("keeps a null violation count null: nothing measured is not none (S03)", async () => {
    const { proposal } = await realFixture();
    // An override drops the measured count to null rather than leaving it
    // stale. Null and zero are different facts — "not measured yet" versus
    // "none" — and a codec that collapsed them would make the review screen
    // claim a clean column it never checked.
    const overridden = applyWorkbookReviewEdit(proposal, {
      kind: "override-type",
      tableKey: "s0.r0",
      columnKey: "s0.r0.c0",
      type: { kind: "text" },
    });
    if (overridden.kind !== "applied") {
      throw new Error(`edit rejected: ${overridden.reason}`);
    }
    const fields = overridden.proposal.tables[0]?.fields ?? [];
    expect(fields[0]?.violations).toBeNull();
    expect(fields.some((entry) => entry.violations !== null)).toBe(true);

    const decoded = decodeImportStage(
      encodeImportStage(await stage({ proposal: overridden.proposal })),
    );
    expect(decoded.proposal?.tables[0]?.fields.map((entry) => entry.violations)).toEqual(
      fields.map((entry) => entry.violations),
    );
  });

  it("round-trips the demo workbook's reviewed proposal and its keyed edits (CA-19)", async () => {
    const stream = await streamWorkbookFixture("ooxml/fieldwork-q3.xlsx", { selection: [0, 1, 2, 3, 4, 5] });
    if (stream === null) throw new Error("the demo workbook did not size");
    const inferred = inferWorkbook(stream.items, {
      ...CONTEXT,
      fileName: "fieldwork-q3.xlsx",
      sheetSelection: stream.report.sheets.map((sheet) => ({
        sheetIndex: sheet.sheetIndex,
        name: sheet.name,
        sheetKind: sheet.kind,
        visibility: sheet.visibility,
        isSelected: sheet.sheetIndex !== 6,
      })),
    });
    const edits = [
      { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" },
      { kind: "rename-table", tableKey: "s1.t0", tableName: "Clients" },
    ] as const;
    let proposal = inferred;
    for (const edit of edits) {
      const result = applyWorkbookReviewEdit(proposal, edit);
      if (result.kind !== "applied") throw new Error(`edit rejected: ${result.reason}`);
      proposal = result.proposal;
    }
    // Every V2 member is exercised: sheets (one excluded), declared and region
    // tables, a joined region, relationships, rules, inert items, workbook evidence.
    expect(proposal.sheets.some((sheet) => sheet.classification.includes("excluded"))).toBe(true);
    expect(proposal.relationships.length).toBeGreaterThan(0);
    expect(proposal.inertItems.length).toBeGreaterThan(0);

    const staged = await stage({
      format: "xlsx",
      preflight: null,
      inventory: stream.report.sheets.map((sheet) => ({
        sheetIndex: sheet.sheetIndex,
        name: sheet.name,
        sheetKind: sheet.kind,
        visibility: sheet.visibility,
        estimatedRowCount: sheet.estimatedRowCount,
        estimatedCellCount: sheet.estimatedCellCount,
      })),
      selectedSheets: [0, 1, 2, 3, 4, 5],
      proposal,
      reviewEdits: edits,
    });
    const encoded = encodeImportStage(staged);
    expect(decodeImportStage(encoded)).toEqual(staged);
    expect(encodeImportStage(decodeImportStage(encoded))).toEqual(encoded);
  });

  it("refuses trailing bytes, an unknown field, and a missing field", async () => {
    const encoded = encodeImportStage(await stage());

    const extended = new Uint8Array(encoded.byteLength + 1);
    extended.set(encoded);
    expect(() => decodeImportStage(extended)).toThrow(CodecError);

    const decoded = decodeCanonical(encoded) as Map<string, CborValue>;
    decoded.set("surprise", 1);
    expect(() => decodeImportStage(encodeCanonical(decoded))).toThrow(CodecError);

    decoded.delete("surprise");
    decoded.delete("status");
    expect(() => decodeImportStage(encodeCanonical(decoded))).toThrow(CodecError);
  });

  it("cannot decode a report that claims its estimate was exact (D24)", async () => {
    const decoded = decodeImportStage(encodeImportStage(await stage()));
    // `isEstimate` is the literal `true` in the type and is not on the wire,
    // so no stored byte can contradict it.
    expect(decoded.preflight?.isEstimate).toBe(true);
    expect(
      (decodeCanonical(encodeImportStage(await stage())) as Map<string, CborValue>)
        .get("preflight"),
    ).not.toHaveProperty("isEstimate");
  });
});

describe("validateImportStage", () => {
  it("refuses a chunk list with a gap", async () => {
    const facts = [chunk(40, 0), chunk(60, 2)];
    await expect(
      stage({
        factChunks: facts,
        temporaryStorageIds: facts.map((entry) => entry.storageId),
      }).then(validateImportStage),
    ).rejects.toThrow(/not contiguous from zero/);
  });

  it("refuses a chunk that is neither retained nor temporary", async () => {
    const staged = await stage();
    expect(() =>
      validateImportStage({ ...staged, temporaryStorageIds: [] }),
    ).toThrow(/does not cover its chunks/);
  });

  it("refuses one storage id classified both ways", async () => {
    const staged = await stage();
    expect(() =>
      validateImportStage({
        ...staged,
        temporaryStorageIds: [
          ...staged.temporaryStorageIds,
          staged.retainedStorageIds[0] as string,
        ],
      }),
    ).toThrow(/duplicate provisional storage id/);
  });

  it("refuses a storage id that is not canonical base64url", async () => {
    const staged = await stage();
    expect(() =>
      validateImportStage({ ...staged, stageId: "not-a-storage-id" }),
    ).toThrow(CodecError);
  });

  it("refuses digests and ids of the wrong length", async () => {
    const staged = await stage();
    expect(() =>
      validateImportStage({ ...staged, sourceSha256: new Uint8Array(31) }),
    ).toThrow(/source digest must be 32 bytes/);
    // Null is legal and is not a placeholder: it says the source has not been
    // read through yet, which is a different fact from "the digest is zero".
    expect(
      decodeImportStage(
        encodeImportStage({ ...staged, sourceSha256: null }),
      ).sourceSha256,
    ).toBeNull();
    expect(() =>
      validateImportStage({ ...staged, lineageId: new Uint8Array(15) }),
    ).toThrow(/lineage id must be 16 bytes/);
  });

  it("refuses review edits without a proposal, and review without one", async () => {
    const staged = await stage({ proposal: null, status: "staging" });

    expect(() =>
      validateImportStage({
        ...staged,
        reviewEdits: [{ kind: "rename-app", appName: "Anything" }],
      }),
    ).toThrow(/review edits without a proposal/);

    expect(() =>
      validateImportStage({ ...staged, status: "promoting" }),
    ).toThrow(/reached review without a proposal/);
  });

  it("accepts a stage that is still parsing, with nothing proposed yet", async () => {
    const staged = await stage({
      proposal: null,
      reviewEdits: [],
      status: "staging",
      progress: {
        phase: "parsing",
        rowsSoFar: 12,
        batchesCommitted: 0,
        ackedBatchSeq: null,
      },
    });
    expect(decodeImportStage(encodeImportStage(staged))).toEqual(staged);
  });

  it("refuses a stage revision below one", async () => {
    const staged = await stage();
    expect(() => validateImportStage({ ...staged, stageRevision: 0 })).toThrow(
      CodecError,
    );
  });
});
