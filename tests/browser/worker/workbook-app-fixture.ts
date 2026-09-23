/**
 * A synthetic **durable** workbook app, sealed into the real store (CA-20/21).
 *
 * Until S06's promotion writes multi-table apps, the only way to put one in
 * front of the real data worker is to write its roots the way promotion does:
 * page-side, through the production crypto and envelope-store modules, from
 * the passphrase — exactly how `runtime.ts`'s `readAppRoots` reads them back.
 * Nothing here is a mock: the head, checkpoint manifest, record pages, the
 * genesis commit's segment, the wrapped app key, and the catalog entry are real
 * envelopes in the real IndexedDB, committed in one transaction at the next
 * transaction revision. The worker then opens it like any other app.
 *
 * The data worker must be **locked** while this runs (its catalog is cached in
 * its session); unlock afterwards and it reads the catalog this wrote.
 *
 * The record pages' issues are the one shared validator's verdict over the
 * checkpoint, with a resolver over the pages' own records — the decision
 * `app-session.ts` re-derives at open and requires to agree.
 *
 * The app: `Suppliers` (key `Code`, label `Name`) and `Orders` (label
 * `Order`, reference `Supplier` → Suppliers.Code, detected from a lookup
 * formula). `Washers` carries an imported key that matched no supplier
 * (`SUP-404`, D36). Three sheets carry real v2 snapshots, sealed like every
 * other root and listed in the head: `Suppliers` (two chunks, a discarded
 * title row, a merge, a comment), `Orders` (a preserved formula column), and
 * `Overview` (a summary + chart sheet with an inert chart).
 */

import type { Page } from "@playwright/test";

export interface SeededWorkbookAppV1 {
  readonly appId: string;
  readonly suppliersTableId: string;
  readonly ordersTableId: string;
  readonly codeFieldId: string;
  readonly supplierNameFieldId: string;
  readonly orderNameFieldId: string;
  readonly supplierFieldId: string;
  readonly relationshipId: string;
  readonly sheets: {
    readonly suppliers: string;
    readonly orders: string;
    readonly overview: string;
  };
  readonly inert: {
    readonly comment: string;
    readonly formula: string;
    readonly chart: string;
  };
  readonly records: {
    readonly acme: string;
    readonly globex: string;
    readonly bolts: string;
    readonly nuts: string;
    readonly gears: string;
    readonly washers: string;
  };
}

export async function seedWorkbookApp(
  page: Page,
  passphrase: string,
): Promise<SeededWorkbookAppV1> {
  return page.evaluate(async (secret): Promise<SeededWorkbookAppV1> => {
    const harness = window.__sheafHarness;
    const [
      bytesModule,
      envelope,
      keys,
      kdf,
      read,
      bootstrap,
      commitStore,
      db,
      catalog,
      roots,
      frame,
      eventCommit,
      hash,
      ids,
      values,
      validator,
      theme,
      snapshots,
    ] = await Promise.all([
      harness.module<typeof import("../../../src/domain/model/bytes.js")>(
        "/src/domain/model/bytes.ts",
      ),
      harness.module<typeof import("../../../src/crypto/envelope.js")>(
        "/src/crypto/envelope.ts",
      ),
      harness.module<typeof import("../../../src/crypto/keys.js")>("/src/crypto/keys.ts"),
      harness.module<typeof import("../../../src/crypto/kdf.js")>("/src/crypto/kdf.ts"),
      harness.module<typeof import("../../../src/persistence/envelope-store/read.js")>(
        "/src/persistence/envelope-store/read.ts",
      ),
      harness.module<typeof import("../../../src/persistence/envelope-store/bootstrap.js")>(
        "/src/persistence/envelope-store/bootstrap.ts",
      ),
      harness.module<typeof import("../../../src/persistence/envelope-store/commit.js")>(
        "/src/persistence/envelope-store/commit.ts",
      ),
      harness.module<typeof import("../../../src/persistence/envelope-store/db.js")>(
        "/src/persistence/envelope-store/db.ts",
      ),
      harness.module<typeof import("../../../src/workers/data/catalog.js")>(
        "/src/workers/data/catalog.ts",
      ),
      harness.module<typeof import("../../../src/import/staging/roots.js")>(
        "/src/import/staging/roots.ts",
      ),
      harness.module<typeof import("../../../src/persistence/codecs/envelope-frame.js")>(
        "/src/persistence/codecs/envelope-frame.ts",
      ),
      harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>(
        "/src/persistence/codecs/event-commit.ts",
      ),
      harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
      harness.module<typeof import("../../../src/domain/model/ids.js")>(
        "/src/domain/model/ids.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/values.js")>(
        "/src/domain/model/values.ts",
      ),
      harness.module<typeof import("../../../src/domain/validation/validate-record.js")>(
        "/src/domain/validation/validate-record.ts",
      ),
      harness.module<typeof import("../../../src/import/staging/theme.js")>(
        "/src/import/staging/theme.ts",
      ),
      harness.module<typeof import("../../../src/import/snapshots/sheet-snapshot.js")>(
        "/src/import/snapshots/sheet-snapshot.ts",
      ),
    ]);

    type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
    type TableDefV1 = import("../../../src/domain/model/schema.js").TableDefV1;
    type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;
    type FieldId = import("../../../src/domain/model/ids.js").FieldId;
    type StoredRecordV1 = import("../../../src/import/staging/roots.js").StoredRecordV1;
    type StorageRefV1 = import("../../../src/import/staging/roots.js").StorageRefV1;
    type Scope = Parameters<typeof envelope.encryptEnvelope>[0]["scope"];
    type Kind = Parameters<typeof envelope.encryptEnvelope>[0]["payloadKind"];

    const entropy = {
      randomBytes: (length: number): Uint8Array =>
        crypto.getRandomValues(new Uint8Array(length)),
    };
    const freshStorageId = () => bytesModule.asStorageId16(entropy.randomBytes(16));

    // --- the local root, from the passphrase --------------------------------
    const row = await bootstrap.readBootstrap();
    if (row === undefined) {
      throw new Error("no bootstrap row: run setup first");
    }
    const wrappingKey = await kdf.deriveWrappingKeyFromPassphrase(secret, row.passphraseKdf);
    const root = await keys.unwrapRoot(row.passphraseWrappedRoot, wrappingKey);
    const catalogFrame = await read.getEnvelope(
      bytesModule.decodeStorageId16(row.catalogStorageId),
    );
    const current = catalog.decodeLocalCatalog(
      (
        await envelope.decryptEnvelope(
          catalogFrame as NonNullable<typeof catalogFrame>,
          "local.catalog",
          root,
          "local.catalog",
        )
      ).payload,
    );

    const revision = row.transactionRevision + 1;
    const logicalRevision = BigInt(revision);
    const appKeyBytes = entropy.randomBytes(32);
    const appKeyCopy = Uint8Array.from(appKeyBytes);
    const appKey = keys.createSecretKey(appKeyBytes, "envelope");
    const frames: Awaited<ReturnType<typeof envelope.encryptEnvelope>>[] = [];

    const sealRoot = async (scope: Scope, kind: Kind, payload: Uint8Array): Promise<StorageRefV1> => {
      const storageId = freshStorageId();
      frames.push(
        await envelope.encryptEnvelope({
          scope,
          storageId,
          logicalRevision,
          payloadKind: kind,
          payload,
          compression: "deflate-raw-v1",
          key: appKey,
        }),
      );
      return {
        storageId: bytesModule.encodeStorageId16(storageId),
        semanticSha256: await hash.sha256(payload),
      };
    };

    // --- the schema ----------------------------------------------------------
    const appId = ids.createDomainId("app", entropy);
    const deviceId = ids.decodeDomainId("device", current.deviceId);
    const suppliersId = ids.createDomainId("table", entropy);
    const ordersId = ids.createDomainId("table", entropy);
    const suppliersSheet = ids.createDomainId("sheet", entropy);
    const ordersSheet = ids.createDomainId("sheet", entropy);

    const field = (tableId: typeof suppliersId, displayName: string, fieldOrdinal: number, kind: "text" | "reference"): FieldDefV1 => ({
      fieldId: ids.createDomainId("field", entropy),
      tableId,
      displayName,
      fieldOrdinal,
      type: { kind },
      isRequired: false,
      isActive: true,
      schemaRevision: 1n,
    });
    const code = field(suppliersId, "Code", 0, "text");
    const supplierName = field(suppliersId, "Name", 1, "text");
    const orderName = field(ordersId, "Order", 0, "text");
    const supplier = field(ordersId, "Supplier", 1, "reference");

    const tables: TableDefV1[] = [
      {
        tableId: suppliersId,
        displayName: "Suppliers",
        tableOrdinal: 0,
        fields: [code, supplierName],
        keyFieldId: code.fieldId,
        labelFieldId: supplierName.fieldId,
        sourceSheetId: suppliersSheet,
        isActive: true,
        schemaRevision: 1n,
      },
      {
        tableId: ordersId,
        displayName: "Orders",
        tableOrdinal: 1,
        fields: [orderName, supplier],
        keyFieldId: null,
        labelFieldId: orderName.fieldId,
        sourceSheetId: ordersSheet,
        isActive: true,
        schemaRevision: 1n,
      },
    ];
    const relationship = {
      relationshipId: ids.createDomainId("relationship", entropy),
      fromTableId: ordersId,
      fromFieldId: supplier.fieldId,
      toTableId: suppliersId,
      toKeyFieldId: code.fieldId,
      detectionSource: "lookup-formula" as const,
      isActive: true,
      schemaRevision: 1n,
    };

    // --- the records, and the one validator's verdict on them ----------------
    const acme = ids.createDomainId("record", entropy);
    const globex = ids.createDomainId("record", entropy);
    const bolts = ids.createDomainId("record", entropy);
    const nuts = ids.createDomainId("record", entropy);
    const gears = ids.createDomainId("record", entropy);
    const washers = ids.createDomainId("record", entropy);

    const rows: readonly (readonly [typeof acme, TableDefV1, readonly (readonly [FieldId, CellValueV1])[]])[] = [
      [acme, tables[0] as TableDefV1, [[code.fieldId, values.textValue("SUP-1")], [supplierName.fieldId, values.textValue("Acme")]]],
      [globex, tables[0] as TableDefV1, [[code.fieldId, values.textValue("SUP-2")], [supplierName.fieldId, values.textValue("Globex")]]],
      [bolts, tables[1] as TableDefV1, [[orderName.fieldId, values.textValue("Bolts")], [supplier.fieldId, values.referenceValue(acme)]]],
      [nuts, tables[1] as TableDefV1, [[orderName.fieldId, values.textValue("Nuts")], [supplier.fieldId, values.referenceValue(acme)]]],
      [gears, tables[1] as TableDefV1, [[orderName.fieldId, values.textValue("Gears")], [supplier.fieldId, values.referenceValue(globex)]]],
      [washers, tables[1] as TableDefV1, [[orderName.fieldId, values.textValue("Washers")], [supplier.fieldId, values.invalidPreservedValue("SUP-404")]]],
    ];
    const key = (tableId: Uint8Array, recordId: Uint8Array) =>
      `${ids.encodeDomainId(tableId as typeof acme)}:${ids.encodeDomainId(recordId as typeof acme)}`;
    const live = new Set(rows.map(([recordId, table]) => key(table.tableId, recordId)));

    const stored: StoredRecordV1[] = rows
      .map(([recordId, table, entries]): StoredRecordV1 => {
        const report = validator.validateRecord(
          {
            table,
            enumOptions: new Map(),
            rules: [],
            referenceExists: (tableId, id) => live.has(key(tableId, id)),
            referenceTargets:
              table.tableId === ordersId
                ? [{ fieldId: supplier.fieldId, tableId: suppliersId, tableLabel: "Suppliers" }]
                : [],
          },
          { recordId, tableId: table.tableId, values: new Map(entries) },
        );
        return {
          recordId,
          tableId: table.tableId,
          values: entries.map(([fieldId, value]) => ({ fieldId, value })),
          issues: report.issues.map((issue) => ({
            fieldId: issue.fieldId,
            kind: issue.kind,
            severity: issue.severity,
            messageKey: issue.messageKey,
          })),
        };
      })
      .sort(roots.compareRecordKeys);

    const pagePayload = roots.encodeRecordPage({ pageVersion: 1, records: stored });
    const pageRef = await sealRoot("app.records", "app.record-page", pagePayload);
    const pageKey = (record: StoredRecordV1) => {
      const joined = new Uint8Array(32);
      joined.set(record.tableId, 0);
      joined.set(record.recordId, 16);
      return joined;
    };

    // --- the genesis commit, covered by the checkpoint ----------------------
    const nowMs = Date.now();
    const genesis = await eventCommit.sealEventCommit(
      {
        eventFormatVersion: 1,
        commitId: ids.createDomainId("commit", entropy),
        appId,
        deviceId,
        deviceCommitSequence: 1n,
        previousDeviceCommitSha256: null,
        basisFrontier: [],
        hybridTime: { wallTimeMs: BigInt(nowMs - 60_000), logicalCounter: 0 },
        eventClass: "import",
        schemaRevisionBefore: 0n,
        schemaRevisionAfter: 1n,
        events: [
          {
            eventId: ids.createDomainId("event", entropy),
            eventIndex: 0,
            kind: "app.created",
            subject: { appId },
            payload: new Map([["displayName", "Supply"]]),
            provenance: { source: "initial-import" },
          },
        ],
      },
      hash.sha256,
    );
    const segmentRef = await sealRoot(
      "app.events",
      "app.event-segment",
      eventCommit.encodeEventSegment({
        eventFormatVersion: 1,
        segmentId: ids.createDomainId("segment", entropy),
        appId,
        commits: [genesis],
        resultingFrontier: [{ deviceId, commitSequence: 1n }],
        semanticSha256: await hash.sha256(genesis.commitSha256),
      }),
    );

    // --- the snapshots and the inert inventory ---------------------------------
    type SheetClassificationV1 = import("../../../src/domain/model/snapshots.js").SheetClassificationV1;
    type RowSpec = readonly (readonly [number, readonly string[]])[];
    const overviewSheet = ids.createDomainId("sheet", entropy);
    const commentItem = ids.createDomainId("inert-item", entropy);
    const formulaItem = ids.createDomainId("inert-item", entropy);
    const chartItem = ids.createDomainId("inert-item", entropy);
    const snapshotRefs: StorageRefV1[] = [];

    const writeSnapshot = async (
      sheetId: typeof suppliersSheet,
      displayName: string,
      sheetOrdinal: number,
      classification: readonly SheetClassificationV1[],
      chunkRows: readonly RowSpec[],
      extra: Pick<
        Parameters<typeof snapshots.encodeSheetSnapshotManifest>[0],
        "merges" | "inertAnchors" | "discardedRows"
      >,
    ) => {
      const chunkRefs = [];
      for (const [sequence, rowsOfChunk] of chunkRows.entries()) {
        const firstRow = rowsOfChunk[0]?.[0] ?? 0;
        const payload = snapshots.encodeSheetSnapshotChunk({
          chunkVersion: 2,
          firstRow,
          rows: rowsOfChunk.map(([rowIndex, cells]) => ({
            rowIndex,
            cells: cells.flatMap((cellText, columnIndex) =>
              cellText === "" ? [] : [{ columnIndex, text: cellText, kind: "text" as const }],
            ),
          })),
        });
        const ref = await sealRoot("app.snapshot-chunk", "app.snapshot-chunk", payload);
        chunkRefs.push({
          storageId: ref.storageId,
          sequence,
          decodedByteLength: payload.byteLength,
          sha256: ref.semanticSha256,
          firstRow,
          lastRow: rowsOfChunk.at(-1)?.[0] ?? firstRow,
        });
      }
      const rowCount = chunkRows.reduce((total, rowsOfChunk) => total + rowsOfChunk.length, 0);
      const manifestRef = await sealRoot(
        "app.snapshot-manifest",
        "app.snapshot-manifest",
        snapshots.encodeSheetSnapshotManifest({
          manifestVersion: 2,
          sheetId,
          sheetOrdinal,
          displayName,
          classification,
          rowCount,
          columnCount: 3,
          chunks: chunkRefs,
          ...extra,
        }),
      );
      snapshotRefs.push(manifestRef);
      return {
        sheetId,
        displayName,
        sheetOrdinal,
        classification,
        snapshotManifestStorageId: manifestRef.storageId,
        declaredRowCount: rowCount,
        declaredColumnCount: 3,
        snapshotRevision: 1n,
      };
    };

    const sheets = [
      await writeSnapshot(
        suppliersSheet,
        "Suppliers",
        0,
        ["table", "lookup"],
        [
          [
            [0, ["Supplier list"]],
            [1, ["Code", "Name"]],
            [2, ["SUP-1", "Acme"]],
          ],
          [
            [3, ["SUP-2", "Globex"]],
            [5, ["", "Two suppliers"]],
          ],
        ],
        {
          merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 1 }],
          inertAnchors: [
            {
              inertItemId: commentItem,
              range: { firstRow: 2, firstColumn: 1, lastRow: 2, lastColumn: 1 },
            },
          ],
          discardedRows: [{ rowIndex: 0, reason: "above-header" }],
        },
      ),
      await writeSnapshot(
        ordersSheet,
        "Orders",
        1,
        ["table"],
        [
          [
            [0, ["Order", "Supplier", "Total"]],
            [1, ["Bolts", "SUP-1", "12"]],
            [2, ["Nuts", "SUP-1", "7"]],
            [3, ["Gears", "SUP-2", "30"]],
            [4, ["Washers", "SUP-404", "3"]],
          ],
        ],
        {
          merges: [],
          inertAnchors: [
            {
              inertItemId: formulaItem,
              range: { firstRow: 1, firstColumn: 2, lastRow: 4, lastColumn: 2 },
            },
          ],
          discardedRows: [],
        },
      ),
      await writeSnapshot(
        overviewSheet,
        "Overview",
        2,
        ["summary", "chart"],
        [[[0, ["Spend by supplier"]]]],
        {
          merges: [],
          inertAnchors: [
            {
              inertItemId: chartItem,
              range: { firstRow: 1, firstColumn: 0, lastRow: 8, lastColumn: 2 },
            },
          ],
          discardedRows: [],
        },
      ),
    ];
    const inertItems = [
      { inertItemId: commentItem, sheetId: suppliersSheet, kind: "comment" as const, location: "Suppliers!B3", reasonKey: "kept-in-source" as const, anchor: { firstRow: 2, firstColumn: 1, lastRow: 2, lastColumn: 1 }, preservedManifestStorageId: null },
      { inertItemId: formulaItem, sheetId: ordersSheet, kind: "formula" as const, location: "Orders!C2:C5", reasonKey: "formula-not-live-yet" as const, anchor: { firstRow: 1, firstColumn: 2, lastRow: 4, lastColumn: 2 }, preservedManifestStorageId: null },
      { inertItemId: chartItem, sheetId: overviewSheet, kind: "chart" as const, location: "Overview!A2:C9", reasonKey: "chart-not-live-yet" as const, anchor: { firstRow: 1, firstColumn: 0, lastRow: 8, lastColumn: 2 }, preservedManifestStorageId: null },
    ];

    // --- the checkpoint and the head ------------------------------------------
    const body = {
      manifestVersion: 1 as const,
      appId,
      schemaRevision: 1n,
      frontier: [{ deviceId, commitSequence: 1n }],
      appState: {
        appId,
        displayName: "Supply",
        createdAtMs: nowMs,
        lastOpenedAtMs: null,
        schemaRevision: 1n,
        locality: "present" as const,
        durableHomeId: null,
        lastSuccessfulBackupMs: null,
        deviceOnlyChangeCount: 1,
        theme: theme.DEFAULT_APP_THEME,
        stateRevision: 1n,
      },
      tables,
      enumOptions: [],
      sheetSnapshots: sheets,
      relationships: [relationship],
      validationRules: [],
      inertItems,
      inferenceDecisions: [],
      importLineages: [],
      recordPages: [
        {
          storageId: pageRef.storageId,
          firstKey: pageKey(stored[0] as StoredRecordV1),
          lastKey: pageKey(stored.at(-1) as StoredRecordV1),
          decodedCount: stored.length,
          decodedByteLength: pagePayload.byteLength,
          semanticSha256: pageRef.semanticSha256,
        },
      ],
    };
    const checkpointRef = await sealRoot(
      "app.checkpoint",
      "app.checkpoint-manifest",
      roots.encodeCheckpointManifest({
        ...body,
        semanticSha256: await hash.sha256(roots.encodeCheckpointBody(body)),
      }),
    );

    const headBody = {
      headVersion: 1 as const,
      appId,
      headRevision: 1n,
      schemaRevision: 1n,
      checkpoint: checkpointRef,
      eventSegments: [segmentRef],
      frontier: [{ deviceId, commitSequence: 1n }],
      baselinePages: [],
      conflictPages: [],
      auditPages: [],
      sourceManifests: [],
      snapshotManifests: snapshotRefs,
      retainedRoots: [],
    };
    const headStorageId = freshStorageId();
    frames.push(
      await envelope.encryptEnvelope({
        scope: "app.head",
        storageId: headStorageId,
        logicalRevision,
        payloadKind: "app.head",
        payload: roots.encodeAppHead({
          ...headBody,
          semanticSha256: await hash.sha256(roots.encodeAppHeadBody(headBody)),
        }),
        compression: "deflate-raw-v1",
        key: appKey,
      }),
    );

    // --- the catalog entry, and one transaction --------------------------------
    const wrappedAppKey = frame.serializeEnvelopeTransport(
      await envelope.encryptEnvelope({
        scope: "local.catalog",
        storageId: freshStorageId(),
        logicalRevision,
        payloadKind: "local.catalog",
        payload: appKeyCopy,
        compression: "none",
        key: root,
      }),
    );
    const nextCatalog = {
      ...current,
      catalogRevision: current.catalogRevision + 1,
      apps: [
        ...current.apps,
        {
          appId: ids.encodeDomainId(appId),
          locality: "present" as const,
          wrappedAppKey,
          appHeadStorageId: bytesModule.encodeStorageId16(headStorageId),
          homeId: null,
          scratchReminder: null,
          displayName: "Supply",
          identity: { accentId: catalog.APP_ACCENT_IDS[0], glyph: "S" },
          createdAtEpochMs: nowMs,
          lastOpenedAtEpochMs: null,
          rowCountCache: stored.length,
          tableCount: tables.length,
        },
      ],
    };
    const catalogStorageId = freshStorageId();
    frames.push(
      await envelope.encryptEnvelope({
        scope: "local.catalog",
        storageId: catalogStorageId,
        logicalRevision,
        payloadKind: "local.catalog",
        payload: catalog.encodeLocalCatalog(nextCatalog),
        compression: "deflate-raw-v1",
        key: root,
      }),
    );
    await commitStore.commitEnvelopes({
      expectedRevision: row.transactionRevision,
      expectedWriterEpoch: row.writerEpoch,
      addFrames: frames,
      bootstrapPatch: { catalogStorageId: bytesModule.encodeStorageId16(catalogStorageId) },
    });
    db.closeLocalDatabase();

    keys.destroySecretKey(appKey);
    keys.destroySecretKey(root);
    keys.destroySecretKey(wrappingKey);

    const text = (id: Uint8Array) => ids.encodeDomainId(id as typeof acme);
    return {
      appId: text(appId),
      suppliersTableId: text(suppliersId),
      ordersTableId: text(ordersId),
      codeFieldId: text(code.fieldId),
      supplierNameFieldId: text(supplierName.fieldId),
      orderNameFieldId: text(orderName.fieldId),
      supplierFieldId: text(supplier.fieldId),
      relationshipId: text(relationship.relationshipId),
      sheets: {
        suppliers: text(suppliersSheet),
        orders: text(ordersSheet),
        overview: text(overviewSheet),
      },
      inert: {
        comment: text(commentItem),
        formula: text(formulaItem),
        chart: text(chartItem),
      },
      records: {
        acme: text(acme),
        globex: text(globex),
        bolts: text(bolts),
        nuts: text(nuts),
        gears: text(gears),
        washers: text(washers),
      },
    };
  }, passphrase);
}
