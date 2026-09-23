/**
 * Every durable root of the one app in the store, decoded straight out of
 * IndexedDB with the app key read from the catalog (CA-20, CA-22, Roshi
 * CL-04) — so the journey's assertions read the stored bytes, never what the
 * worker chose to report about them. Beside `readAppRoots` in `runtime.ts`,
 * which states F02's roots; this states the workbook app's: the checkpoint's
 * F03 keys, every record page, the event segment, the source manifest and one
 * of its chunks, every baseline page, and every snapshot manifest with one
 * chunk each — each digest recomputed from the bytes it names.
 */

import type { Page } from "@playwright/test";

export interface WorkbookRootsReportV1 {
  readonly appCount: number;
  readonly head: {
    readonly semanticMatches: boolean;
    readonly sourceManifestCount: number;
    readonly snapshotManifestCount: number;
    readonly conflictPageCount: number;
    readonly auditPageCount: number;
    readonly baselinePageCount: number;
  };
  readonly checkpoint: {
    readonly semanticMatches: boolean;
    readonly keys: readonly string[];
    readonly tables: readonly { readonly name: string; readonly key: string | null; readonly label: string | null }[];
    readonly relationships: readonly {
      readonly from: string;
      readonly field: string;
      readonly to: string;
      readonly key: string;
      readonly source: string;
    }[];
    readonly inert: readonly { readonly kind: string; readonly reason: string; readonly sheet: string }[];
    readonly decisions: readonly { readonly kind: string | null; readonly subject: string; readonly disposition: string }[];
    readonly lineages: readonly {
      readonly importKind: string;
      readonly ordinal: number;
      readonly sourceName: string;
      readonly matchesSourceManifest: boolean;
    }[];
    readonly sheets: readonly {
      readonly name: string;
      readonly classification: readonly string[];
      readonly listedInHead: boolean;
    }[];
    /** F04: each formula as stored — its text, target, disposition, and the field or label it fills. */
    readonly formulas: readonly { readonly text: string; readonly target: string; readonly disposition: string; readonly name: string | null }[];
    /** F04: each chart as stored (CA-30). */
    readonly charts: readonly { readonly name: string; readonly type: string; readonly provenance: string; readonly pinned: boolean }[];
    /** `Table.Field` of every computed field (it names a formula, D51). */
    readonly computedFields: readonly string[];
  };
  /** `valued`: how many record-page values each `Table.Field` holds; a live column holds none (invariant 7). */
  readonly pages: {
    readonly count: number;
    readonly records: number;
    readonly digestsMatch: boolean;
    readonly valued: Readonly<Record<string, number>>;
  };
  /** Every baseline page the head lists, decoded, with the largest one's decoded size. */
  readonly baselines: {
    readonly count: number;
    readonly entries: number;
    readonly digestsMatch: boolean;
    readonly largestDecodedBytes: number;
  };
  readonly events: {
    readonly commits: number;
    readonly kinds: readonly (readonly string[])[];
    readonly chainOk: boolean;
    readonly digestMatches: boolean;
  };
  readonly source: {
    readonly fileName: string;
    readonly byteLength: number;
    readonly chunkCount: number;
    readonly firstChunkBytes: number;
    readonly firstChunkDigestMatches: boolean;
    readonly manifestDigestMatches: boolean;
  };
  readonly snapshots: readonly {
    readonly name: string;
    readonly rowCount: number;
    readonly chunkCount: number;
    readonly manifestDigestMatches: boolean;
    readonly firstChunkRows: number;
    readonly firstChunkDigestMatches: boolean;
  }[];
}

export async function readWorkbookRoots(page: Page, passphrase: string): Promise<WorkbookRootsReportV1> {
  return page.evaluate(async (secret): Promise<WorkbookRootsReportV1> => {
    const harness = window.__sheafHarness;
    const load = <T>(path: string) => harness.module<T>(path);
    const bytes = await load<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts");
    const envelope = await load<typeof import("../../../src/crypto/envelope.js")>("/src/crypto/envelope.ts");
    const keys = await load<typeof import("../../../src/crypto/keys.js")>("/src/crypto/keys.ts");
    const kdf = await load<typeof import("../../../src/crypto/kdf.js")>("/src/crypto/kdf.ts");
    const hash = await load<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts");
    const store = await load<typeof import("../../../src/persistence/envelope-store/read.js")>(
      "/src/persistence/envelope-store/read.ts",
    );
    const boot = await load<typeof import("../../../src/persistence/envelope-store/bootstrap.js")>(
      "/src/persistence/envelope-store/bootstrap.ts",
    );
    const catalog = await load<typeof import("../../../src/workers/data/catalog.js")>("/src/workers/data/catalog.ts");
    const roots = await load<typeof import("../../../src/import/staging/roots.js")>("/src/import/staging/roots.ts");
    const frames = await load<typeof import("../../../src/persistence/codecs/envelope-frame.js")>(
      "/src/persistence/codecs/envelope-frame.ts",
    );
    const commits = await load<typeof import("../../../src/persistence/codecs/event-commit.js")>(
      "/src/persistence/codecs/event-commit.ts",
    );
    const sources = await load<typeof import("../../../src/import/snapshots/source-chunks.js")>(
      "/src/import/snapshots/source-chunks.ts",
    );
    const sheets = await load<typeof import("../../../src/import/snapshots/sheet-snapshot.js")>(
      "/src/import/snapshots/sheet-snapshot.ts",
    );

    const hex = (value: Uint8Array): string => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const same = (left: Uint8Array, right: Uint8Array): boolean => hex(left) === hex(right);

    const row = await boot.readBootstrap();
    if (row === undefined) throw new Error("no bootstrap row");
    const wrappingKey = await kdf.deriveWrappingKeyFromPassphrase(secret, row.passphraseKdf);
    const root = await keys.unwrapRoot(row.passphraseWrappedRoot, wrappingKey);
    const catalogFrame = await store.getEnvelope(bytes.decodeStorageId16(row.catalogStorageId));
    if (catalogFrame === undefined) throw new Error("no catalog");
    const decodedCatalog = catalog.decodeLocalCatalog(
      (await envelope.decryptEnvelope(catalogFrame, "local.catalog", root, "local.catalog")).payload,
    );
    const entry = decodedCatalog.apps[0];
    if (entry === undefined || entry.wrappedAppKey === null) throw new Error("no app in the catalog");
    const appKey = keys.createSecretKey(
      (
        await envelope.decryptEnvelope(
          frames.parseEnvelopeTransport(entry.wrappedAppKey),
          "local.catalog",
          root,
          "local.catalog",
        )
      ).payload,
      "envelope",
    );
    const open = async (storageId: string, scope: string, kind: string): Promise<Uint8Array> => {
      const frame = await store.getEnvelope(bytes.decodeStorageId16(storageId));
      if (frame === undefined) throw new Error(`missing root ${storageId}`);
      return (
        await envelope.decryptEnvelope(
          frame,
          scope as Parameters<typeof envelope.decryptEnvelope>[1],
          appKey,
          kind as Parameters<typeof envelope.decryptEnvelope>[3],
        )
      ).payload;
    };

    const head = roots.decodeAppHead(await open(entry.appHeadStorageId as string, "app.head", "app.head"));
    const { semanticSha256: headDigest, ...headBody } = head;
    const checkpointBytes = await open(head.checkpoint.storageId, "app.checkpoint", "app.checkpoint-manifest");
    const checkpoint = roots.decodeCheckpointManifest(checkpointBytes);
    const rawCheckpoint = (await load<typeof import("../../../src/persistence/codecs/canonical-cbor.js")>(
      "/src/persistence/codecs/canonical-cbor.ts",
    )).decodeCanonical(checkpointBytes) as Map<string, unknown>;

    const fieldName = (fieldId: Uint8Array | null): string | null => {
      if (fieldId === null) return null;
      for (const table of checkpoint.tables) {
        const found = table.fields.find((field) => same(field.fieldId, fieldId));
        if (found !== undefined) return found.displayName;
      }
      return "?";
    };
    const tableName = (tableId: Uint8Array): string =>
      checkpoint.tables.find((table) => same(table.tableId, tableId))?.displayName ?? "?";
    const sheetName = (sheetId: Uint8Array): string =>
      checkpoint.sheetSnapshots.find((sheet) => same(sheet.sheetId, sheetId))?.displayName ?? "?";

    // Record pages, each checked against its manifest digest.
    let records = 0;
    let digestsMatch = true;
    const valued: Record<string, number> = {};
    const qualified = (fieldId: Uint8Array): string => {
      const table = checkpoint.tables.find((candidate) => candidate.fields.some((field) => same(field.fieldId, fieldId)));
      return `${table?.displayName ?? "?"}.${fieldName(fieldId) ?? "?"}`;
    };
    for (const ref of checkpoint.recordPages) {
      const payload = await open(ref.storageId, "app.records", "app.record-page");
      digestsMatch &&= same(await hash.sha256(payload), ref.semanticSha256);
      const decoded = roots.decodeRecordPage(payload).records;
      records += decoded.length;
      for (const record of decoded) {
        for (const entry of record.values) valued[qualified(entry.fieldId)] = (valued[qualified(entry.fieldId)] ?? 0) + 1;
      }
    }

    // Every baseline page, each checked against the digest the head holds.
    let baselineEntries = 0;
    let baselineDigestsMatch = true;
    let largestBaseline = 0;
    for (const ref of head.baselinePages) {
      const payload = await open(ref.storageId, "app.baselines", "app.baseline-page");
      baselineDigestsMatch &&= same(await hash.sha256(payload), ref.semanticSha256);
      baselineEntries += roots.decodeBaselinePage(payload).entries.length;
      largestBaseline = Math.max(largestBaseline, payload.byteLength);
    }

    // Every event segment, and the chain over all their commits.
    const segmentCommits = [];
    let segmentDigestsMatch = true;
    for (const segmentRef of head.eventSegments) {
      const segmentBytes = await open(segmentRef.storageId, "app.events", "app.event-segment");
      segmentDigestsMatch &&= same(await hash.sha256(segmentBytes), segmentRef.semanticSha256);
      segmentCommits.push(...commits.decodeEventSegment(segmentBytes).commits);
    }
    let chainOk = true;
    try {
      await commits.verifyCommitChain(segmentCommits, hash.sha256);
    } catch {
      chainOk = false;
    }

    // The source manifest (Roshi CL-04's source half) and its first chunk.
    const sourceRef = head.sourceManifests[0];
    if (sourceRef === undefined) throw new Error("no source manifest");
    const sourceBytes = await open(sourceRef.storageId, "app.source-manifest", "app.source-manifest");
    const source = sources.decodeSourceManifest(sourceBytes);
    const firstSource = source.chunks[0];
    const firstSourceBytes =
      firstSource === undefined ? new Uint8Array() : await open(firstSource.storageId, "app.source-chunk", "app.source-chunk");

    // Every snapshot manifest the checkpoint names, and one chunk of each.
    const listed = new Set(head.snapshotManifests.map((ref) => ref.storageId));
    const snapshots = [];
    for (const sheet of checkpoint.sheetSnapshots) {
      const ref = head.snapshotManifests.find((candidate) => candidate.storageId === sheet.snapshotManifestStorageId);
      const manifestBytes = await open(sheet.snapshotManifestStorageId, "app.snapshot-manifest", "app.snapshot-manifest");
      const manifest = sheets.decodeSheetSnapshotManifest(manifestBytes);
      const chunk = manifest.chunks[0];
      const chunkBytes =
        chunk === undefined ? null : await open(chunk.storageId, "app.snapshot-chunk", "app.snapshot-chunk");
      snapshots.push({
        name: manifest.displayName,
        rowCount: manifest.rowCount,
        chunkCount: manifest.chunks.length,
        manifestDigestMatches: ref !== undefined && same(await hash.sha256(manifestBytes), ref.semanticSha256),
        firstChunkRows: chunkBytes === null ? 0 : sheets.decodeSheetSnapshotChunk(chunkBytes).rows.length,
        firstChunkDigestMatches:
          chunk === undefined || (chunkBytes !== null && same(await hash.sha256(chunkBytes), chunk.sha256)),
      });
    }

    const report: WorkbookRootsReportV1 = {
      appCount: decodedCatalog.apps.length,
      head: {
        semanticMatches: same(await hash.sha256(roots.encodeAppHeadBody(headBody)), headDigest),
        sourceManifestCount: head.sourceManifests.length,
        snapshotManifestCount: head.snapshotManifests.length,
        conflictPageCount: head.conflictPages.length,
        auditPageCount: head.auditPages.length,
        baselinePageCount: head.baselinePages.length,
      },
      checkpoint: {
        semanticMatches: same(await hash.sha256(roots.checkpointSemanticBody(checkpointBytes)), checkpoint.semanticSha256),
        keys: [...rawCheckpoint.keys()].sort(),
        tables: checkpoint.tables.map((table) => ({
          name: table.displayName,
          key: fieldName(table.keyFieldId),
          label: fieldName(table.labelFieldId),
        })),
        relationships: checkpoint.relationships.map((relationship) => ({
          from: tableName(relationship.fromTableId),
          field: fieldName(relationship.fromFieldId) ?? "?",
          to: tableName(relationship.toTableId),
          key: fieldName(relationship.toKeyFieldId) ?? "?",
          source: relationship.detectionSource,
        })),
        inert: checkpoint.inertItems.map((item) => ({ kind: item.kind, reason: item.reasonKey, sheet: sheetName(item.sheetId) })),
        decisions: checkpoint.inferenceDecisions.map((decision) => ({
          kind: decision.decisionKind,
          subject: decision.subject,
          disposition: decision.disposition,
        })),
        lineages: checkpoint.importLineages.map((lineage) => ({
          importKind: lineage.importKind,
          ordinal: lineage.importOrdinal,
          sourceName: lineage.sourceDisplayName,
          matchesSourceManifest: same(lineage.sourceSha256, source.chunkedSha256),
        })),
        sheets: checkpoint.sheetSnapshots.map((sheet) => ({
          name: sheet.displayName,
          classification: [...sheet.classification],
          listedInHead: listed.has(sheet.snapshotManifestStorageId),
        })),
        formulas: checkpoint.formulas.map(({ formula }) => ({
          text: formula.originalText,
          target: formula.target.kind,
          disposition: formula.disposition,
          name: formula.target.kind === "computed-column" ? fieldName(formula.target.fieldId) : formula.displayName,
        })),
        charts: checkpoint.charts.map((chart) => ({
          name: chart.definition.name,
          type: chart.definition.type,
          provenance: chart.provenance,
          pinned: chart.definition.pinned,
        })),
        computedFields: checkpoint.tables.flatMap((table) =>
          table.fields.filter((field) => field.formulaId !== undefined).map((field) => `${table.displayName}.${field.displayName}`),
        ),
      },
      pages: { count: checkpoint.recordPages.length, records, digestsMatch, valued },
      baselines: {
        count: head.baselinePages.length,
        entries: baselineEntries,
        digestsMatch: baselineDigestsMatch,
        largestDecodedBytes: largestBaseline,
      },
      events: {
        commits: segmentCommits.length,
        kinds: segmentCommits.map((commit) => commit.events.map((event) => event.kind)),
        chainOk,
        digestMatches: segmentDigestsMatch,
      },
      source: {
        fileName: source.fileName,
        byteLength: source.byteLength,
        chunkCount: source.chunks.length,
        firstChunkBytes: firstSourceBytes.byteLength,
        firstChunkDigestMatches: firstSource !== undefined && same(await hash.sha256(firstSourceBytes), firstSource.sha256),
        manifestDigestMatches: same(await hash.sha256(sourceBytes), sourceRef.semanticSha256),
      },
      snapshots,
    };
    keys.destroySecretKey(appKey);
    keys.destroySecretKey(root);
    keys.destroySecretKey(wrappingKey);
    return report;
  }, passphrase);
}
