/**
 * The RPC registrations for an open app (M33; CA-12, CAP-15/16/17).
 *
 * This file is the boundary between the wire and the domain, and it is thin on
 * purpose: it opens an app, translates values, and hands the work to
 * `executeCommand` and the query plans. Every decision — what is valid, what is
 * durable, what a page may claim — lives one layer in.
 *
 * **The wire→domain mapping is the D28 entry boundary.** Authored text is
 * NFC-normalized here, silently: a keyboard, an input method, and a paste
 * buffer disagree about how to spell the same character, and the two spellings
 * render identically. The import parser normalizes too, but it emits a
 * diagnostic, because there the difference is a fact about someone's file.
 *
 * **An app that is not open opens itself.** Every app-scoped request resolves
 * its session first, hydrating if it must — so a page that reloaded and asked
 * for a record before it asked for the app gets the record rather than a
 * protocol complaint. An id no catalog entry carries answers `null` or
 * `unknown-subject`, never an error: a stale link is ordinary (CA-12's
 * idempotent-read pattern).
 *
 * **A refusal is a result.** Validation failures come back as typed command
 * results carrying the whole report (D23). No `DataWorkerErrorV1` kind was
 * added for them, and none is needed.
 */

import { decodeBase64Url, encodeBase64Url } from "../../domain/model/bytes.js";
import type { FilterV1 } from "../../domain/model/filters.js";
import { CodecError } from "../../domain/model/errors.js";
import {
  decodeDomainId,
  encodeDomainId,
  type FieldId,
  type RecordId,
  type RelationshipId,
  type SheetId,
  type TableId,
} from "../../domain/model/ids.js";
import {
  BLANK_VALUE,
  MISSING_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../domain/model/values.js";
import type { ValidationReport } from "../../domain/validation/rules.js";
import {
  executeCommand,
  type CommandResultV1,
} from "../../application/commands/execute-command.js";
import {
  planRecordPage,
  recordQuery,
} from "../../application/queries/records.js";
import { compileRecordQuery, readTableDefinition } from "../../application/queries/filters.js";
import { isRestorable, planHistoryPage } from "../../application/queries/history.js";
import {
  planInertItems,
  planSheetSnapshots,
  planSnapshotSheet,
} from "../../application/queries/snapshots.js";
import {
  findInSnapshot,
  readSnapshotPage,
} from "../../import/snapshots/sheet-snapshot.js";
import {
  planDeletedRecord,
  planRecordReferences,
  planReferenceCandidates,
  planRelatedChildrenPage,
  planRelatedRecords,
  type RelatedParentV1,
} from "../../application/queries/relationships.js";
import type {
  ProjectionComputedCellV1,
  ProjectionFilterTermV1,
  ProjectionRecordSortV1,
  ProjectionSortValueV1,
  ProjectionIssueRowV1,
  ProjectionLabeledRecordV1,
  ProjectionRecordSummaryV1,
} from "../../application/ports/projection.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import { sha256 } from "../../crypto/hash.js";
import { parseEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";
import type {
  AppFieldViewV1,
  AppSessionViewV1,
  AppTableViewV1,
  AuthoredCellWireEntryV1,
  AuthoredCellWireValueV1,
  CellWireEntryV1,
  CellWireValueV1,
  ChangeHistoryEntryViewV1,
  CloseAppRequestV1,
  CreateRecordRequestV1,
  DataWorkerResponseV1,
  DeleteRecordRequestV1,
  FilterWireV1,
  FindInSnapshotRequestV1,
  GetChangeHistoryRequestV1,
  GetSnapshotPageRequestV1,
  ListInertItemsRequestV1,
  ListSheetSnapshotsRequestV1,
  GetDeletedRecordRequestV1,
  GetRecordRequestV1,
  GetRelatedChildrenRequestV1,
  GetRelatedRecordsRequestV1,
  ListTablesRequestV1,
  NoteAppOpenedRequestV1,
  OpenAppRequestV1,
  PatchRecordRequestV1,
  QueryRecordsRequestV1,
  RecordCommandOutcomeV1,
  RecordDetailViewV1,
  RecordIssueViewV1,
  RecordReferenceViewV1,
  RecordSummaryViewV1,
  RelatedRecordViewV1,
  RestoreRecordRequestV1,
  SearchReferenceCandidatesRequestV1,
  SortCursorWireV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import {
  AppSessionRegistry,
  localClockReading,
  openAppSession,
  type AppSessionV1,
} from "./app-session.js";

/** How long a `TODAY()` result may stand before a read refreshes it (D60). */
const VOLATILE_MAX_AGE_MS = 60_000;
import type { WorkerSessionContextV1 } from "./event-store.js";
import {
  openAppKey,
  type AppStoragePortsV1,
} from "./event-store.js";
import { encodeAuthoredRecordBytes } from "./record-event-payloads.js";
import type { LocalCatalogAppEntryV1, LocalCatalogV1 } from "./catalog.js";
import { toThemeWire } from "./theme-handlers.js";
import { readAppDurability } from "./home-state.js";
import type { AppDurabilityViewV1 } from "../protocol/messages.js";

export interface RecordHandlerDependenciesV1 {
  readonly clock: ClockPort;
  readonly entropy: EntropyPort;
  readonly ports: AppStoragePortsV1;
  /** The live unlocked session; throws `locked` once the session is gone. */
  readonly getContext: () => WorkerSessionContextV1;
  /** Reseals the catalog for an operational write (`noteAppOpened`). */
  readonly commitCatalog: (next: LocalCatalogV1) => Promise<void>;
}

export interface RecordHandlersV1 {
  openApp(request: OpenAppRequestV1): Promise<DataWorkerResponseV1>;
  closeApp(request: CloseAppRequestV1): DataWorkerResponseV1;
  noteAppOpened(request: NoteAppOpenedRequestV1): Promise<DataWorkerResponseV1>;
  queryRecords(request: QueryRecordsRequestV1): Promise<DataWorkerResponseV1>;
  getRecord(request: GetRecordRequestV1): Promise<DataWorkerResponseV1>;
  createRecord(request: CreateRecordRequestV1): Promise<DataWorkerResponseV1>;
  patchRecord(request: PatchRecordRequestV1): Promise<DataWorkerResponseV1>;
  deleteRecord(request: DeleteRecordRequestV1): Promise<DataWorkerResponseV1>;
  restoreRecord(request: RestoreRecordRequestV1): Promise<DataWorkerResponseV1>;
  getChangeHistory(
    request: GetChangeHistoryRequestV1,
  ): Promise<DataWorkerResponseV1>;
  getRelatedRecords(request: GetRelatedRecordsRequestV1): Promise<DataWorkerResponseV1>;
  getRelatedChildren(request: GetRelatedChildrenRequestV1): Promise<DataWorkerResponseV1>;
  searchReferenceCandidates(
    request: SearchReferenceCandidatesRequestV1,
  ): Promise<DataWorkerResponseV1>;
  getDeletedRecord(request: GetDeletedRecordRequestV1): Promise<DataWorkerResponseV1>;
  listTables(request: ListTablesRequestV1): Promise<DataWorkerResponseV1>;
  listSheetSnapshots(request: ListSheetSnapshotsRequestV1): Promise<DataWorkerResponseV1>;
  getSnapshotPage(request: GetSnapshotPageRequestV1): Promise<DataWorkerResponseV1>;
  findInSnapshot(request: FindInSnapshotRequestV1): Promise<DataWorkerResponseV1>;
  listInertItems(request: ListInertItemsRequestV1): Promise<DataWorkerResponseV1>;
  /** Durable heads and home receipts, including apps whose projections are closed. */
  appDurabilityFacts(
    localRoot: EnvelopeKeyRefV1,
    catalog: LocalCatalogV1,
  ): Promise<ReadonlyMap<string, AppDurabilityViewV1>>;
  /** Lock: every projection destroyed, every app key zeroized. */
  disposeAll(): void;
  /**
   * The open session of a catalog app, hydrating it if needed; `undefined`
   * when no app carries the id. The import tier appends through it (D38).
   */
  appSession(appId: string): Promise<AppSessionV1 | undefined>;
  /** Drops an app's session, so the next read hydrates from the head as it now is. */
  closeAppSession(appId: string): void;
}

export function createRecordHandlers(
  deps: RecordHandlerDependenciesV1,
): RecordHandlersV1 {
  const registry = new AppSessionRegistry();

  const deviceIdOf = (context: WorkerSessionContextV1) =>
    decodeDomainId("device", context.catalog.deviceId);

  const entryOf = (
    context: WorkerSessionContextV1,
    appId: string,
  ): LocalCatalogAppEntryV1 | undefined =>
    context.catalog.apps.find((app) => app.appId === appId);

  /** The open session for this app, hydrating it if it is not open yet. */
  async function withApp(appId: string): Promise<AppSessionV1 | undefined> {
    const open = registry.get(appId);
    if (open !== undefined) {
      return open;
    }
    const context = deps.getContext();
    const entry = entryOf(context, appId);
    if (entry === undefined || entry.appHeadStorageId === null) {
      return undefined;
    }

    const appKey = await openAppKey(
      deps.ports,
      context.localRoot,
      entry,
      parseEnvelopeTransport,
    );
    const session = await openAppSession({
      ports: deps.ports,
      clock: deps.clock,
      session: deps.getContext,
      deviceId: deviceIdOf(context),
      appKey,
      appHeadStorageId: entry.appHeadStorageId,
      hydratedAtMs: deps.clock.nowEpochMs(),
    });
    registry.set(appId, session);
    return session;
  }

  /** The sheet's snapshot, opened; null when the app or the sheet is not there. */
  async function openSheetSnapshot(appId: string, sheetText: string) {
    const session = await withApp(appId);
    if (session === undefined) {
      return null;
    }
    const listing = planSnapshotSheet(session.projection, sheetIdOf(sheetText));
    return listing === null
      ? null
      : session.openSnapshot(listing.sheet.snapshotManifestStorageId);
  }

  const commandDeps = (session: AppSessionV1) => ({
    clock: deps.clock,
    entropy: deps.entropy,
    projection: session.projection,
    repository: session.repository,
    recordDigest: (record: Parameters<typeof encodeAuthoredRecordBytes>[0]) =>
      sha256(encodeAuthoredRecordBytes(record)),
    formulaClock: () => localClockReading(deps.clock),
  });

  async function runCommand<K extends string>(
    kind: K,
    appId: string,
    run: (session: AppSessionV1) => Promise<CommandResultV1>,
  ): Promise<{ readonly kind: K } & RecordCommandOutcomeV1> {
    const session = await withApp(appId);
    if (session === undefined) {
      return { kind, outcome: "unknown-subject", subject: "app" };
    }

    let result: CommandResultV1;
    try {
      result = await run(session);
    } catch (cause) {
      // A replay guard failing after the commit landed disposes the whole
      // projection (S02's contract). The commit is durable, so the recovery is
      // to hydrate again from the bytes that now include it — but only if this
      // dead session is dropped first, or every later request would be
      // answered from a database that is already closed.
      registry.close(appId);
      throw cause;
    }

    switch (result.outcome) {
      case "accepted":
        return {
          kind,
          outcome: "accepted",
          receipt: {
            recordId: encodeDomainId(result.recordId),
            tableId: encodeDomainId(result.tableId),
            recordRevision: Number(result.recordRevision),
            commitId:
              result.commit === null
                ? null
                : encodeBase64Url(result.commit.commit.commitId),
            headRevision:
              result.commit === null ? null : Number(result.commit.headRevision),
          },
          // D60: which computed columns moved, never their values.
          recalculated: {
            fieldIds: result.recalculatedFieldIds.map((fieldId) => encodeDomainId(fieldId)),
          },
        };
      case "rejected":
        return { kind, outcome: "rejected", report: toReportView(result.report) };
      case "unknown-subject":
        return { kind, outcome: "unknown-subject", subject: result.subject };
      default: {
        const unreachable: never = result;
        return unreachable;
      }
    }
  }

  return {
    async openApp(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "openApp", session: null };
      }
      const entry = entryOf(deps.getContext(), request.appId);
      const durability = await session.durability();
      return {
        kind: "openApp",
        session: toSessionView(session, entry, durability),
      };
    },

    closeApp(request): DataWorkerResponseV1 {
      // Closing an app that is not open is the same request already answered.
      registry.close(request.appId);
      return { kind: "closeApp", closed: true };
    },

    /**
     * An operational write, not an authored event: database.md § Events that
     * do not exist rules out a last-opened event, so the fact lives in the
     * catalog's cache and nowhere else.
     */
    async noteAppOpened(request): Promise<DataWorkerResponseV1> {
      const context = deps.getContext();
      const entry = entryOf(context, request.appId);
      if (entry === undefined) {
        return { kind: "noteAppOpened", lastOpenedAtEpochMs: null };
      }
      const lastOpenedAtEpochMs = deps.clock.nowEpochMs();
      await deps.commitCatalog({
        ...context.catalog,
        catalogRevision: context.catalog.catalogRevision + 1,
        apps: context.catalog.apps.map((app) =>
          app.appId === request.appId ? { ...app, lastOpenedAtEpochMs } : app,
        ),
      });
      return { kind: "noteAppOpened", lastOpenedAtEpochMs };
    },

    async queryRecords(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "queryRecords", page: null };
      }
      const tableId = knownTableId(session, request.tableId);
      if (tableId === undefined) {
        return { kind: "queryRecords", page: null };
      }
      await session.projection.refreshVolatile(VOLATILE_MAX_AGE_MS);

      // CA-29: filters and the sort are checked against the table as it
      // stands, and a refusal names the field rather than matching nothing.
      const filters = (request.filters ?? []).map(toDomainFilter);
      const sort = request.sort == null ? null : { fieldId: fieldIdOf(request.sort.fieldId), direction: request.sort.direction };
      let compiled: { readonly filters: readonly ProjectionFilterTermV1[]; readonly sort: ProjectionRecordSortV1 | null } = {
        filters: [],
        sort: null,
      };
      if (filters.length > 0 || sort !== null) {
        const definition = readTableDefinition(session.projection, tableId);
        if (definition === null) {
          return { kind: "queryRecords", page: null };
        }
        const outcome = compileRecordQuery(definition.table, definition.enumOptions, filters, sort);
        if (outcome.outcome === "refused") {
          return {
            kind: "queryRecords",
            page: null,
            refusal: { reason: outcome.refusal.reason, fieldId: encodeDomainId(outcome.refusal.fieldId) },
          };
        }
        compiled = outcome;
      }

      const page = planRecordPage(
        session.projection,
        recordQuery({
          tableId,
          cursor: request.cursor ?? null,
          cursorSortValue: toSortValue(request.sortCursor ?? null),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
          search: request.search ?? null,
          filters: compiled.filters,
          sort: compiled.sort,
        }),
      );

      return {
        kind: "queryRecords",
        page: {
          tableId: request.tableId,
          scope: page.scope,
          records: page.records.map(toSummaryView),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          totalCount: page.totalCount,
          isTotalExact: true,
          nextSortCursor: page.nextCursor === null ? null : toSortCursor(page.nextSortValue),
          total: page.total,
          partial: page.partial,
        },
      };
    },

    async getRecord(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "getRecord", record: null };
      }
      await session.projection.refreshVolatile(VOLATILE_MAX_AGE_MS);
      const detail = session.projection.execute({
        kind: "record-by-id",
        recordId: recordIdOf(request.recordId),
      });
      if (detail === null) {
        return { kind: "getRecord", record: null };
      }
      const record: RecordDetailViewV1 = {
        ...toSummaryView(detail),
        createdCommitId: encodeDomainId(detail.createdCommitId),
        updatedCommitId: encodeDomainId(detail.updatedCommitId),
        issues: detail.issues.map(toIssueView),
        indexedFieldIds: detail.cells.map((cell) => encodeDomainId(cell.fieldId)),
        references: planRecordReferences(session.projection, detail).map(toReferenceView),
      };
      return { kind: "getRecord", record };
    },

    createRecord(request): Promise<DataWorkerResponseV1> {
      return runCommand("createRecord", request.appId, (session) =>
        executeCommand(commandDeps(session), {
          kind: "create-record",
          tableId: tableIdOf(request.tableId),
          values: toDomainValues(request.values),
        }),
      );
    },

    patchRecord(request): Promise<DataWorkerResponseV1> {
      return runCommand("patchRecord", request.appId, (session) =>
        executeCommand(commandDeps(session), {
          kind: "patch-record",
          recordId: recordIdOf(request.recordId),
          changes: toDomainValues(request.changes),
        }),
      );
    },

    deleteRecord(request): Promise<DataWorkerResponseV1> {
      return runCommand("deleteRecord", request.appId, (session) =>
        executeCommand(commandDeps(session), {
          kind: "delete-record",
          recordId: recordIdOf(request.recordId),
        }),
      );
    },

    restoreRecord(request): Promise<DataWorkerResponseV1> {
      return runCommand("restoreRecord", request.appId, (session) =>
        executeCommand(commandDeps(session), {
          kind: "restore-record",
          recordId: recordIdOf(request.recordId),
        }),
      );
    },

    async getChangeHistory(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "getChangeHistory", page: null };
      }
      const page = planHistoryPage(session.projection, {
        cursor:
          request.cursor === undefined || request.cursor === null
            ? null
            : {
                wallTimeMs: request.cursor.wallTimeMs,
                logicalCounter: request.cursor.logicalCounter,
                eventId: decodeDomainId("event", request.cursor.eventId),
              },
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });

      const entries: readonly ChangeHistoryEntryViewV1[] = page.entries.map(
        (entry) => ({
          eventId: encodeDomainId(entry.eventId),
          commitId: encodeDomainId(entry.commitId),
          eventKind: entry.eventKind,
          subjectKind: entry.subjectKind,
          subjectId: encodeBase64Url(entry.subjectId),
          wallTimeMs: entry.wallTimeMs,
          logicalCounter: entry.logicalCounter,
          recordRevision:
            entry.summary.recordRevision === null
              ? null
              : Number(entry.summary.recordRevision),
          // Which fields moved; the values themselves stay out of a listing.
          changedFieldIds: entry.summary.fieldChanges.map((change) =>
            encodeDomainId(change.fieldId),
          ),
          isRestorable: isRestorable(entry),
          tableId:
            entry.summary.tableId === null ? null : encodeDomainId(entry.summary.tableId),
        }),
      );

      return {
        kind: "getChangeHistory",
        page: {
          entries,
          hasMore: page.hasMore,
          nextCursor:
            page.nextCursor === null
              ? null
              : {
                  wallTimeMs: page.nextCursor.wallTimeMs,
                  logicalCounter: page.nextCursor.logicalCounter,
                  eventId: encodeDomainId(page.nextCursor.eventId),
                },
        },
      };
    },

    async getRelatedRecords(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "getRelatedRecords", related: null };
      }
      const related = planRelatedRecords(session.projection, recordIdOf(request.recordId));
      return {
        kind: "getRelatedRecords",
        related:
          related === null
            ? null
            : {
                parents: related.parents.map(toReferenceView),
                children: related.children.map((group) => ({
                  relationshipId: encodeDomainId(group.relationshipId),
                  tableId: encodeDomainId(group.tableId),
                  tableName: group.tableName,
                  count: group.count,
                  first: group.first.map(toRelatedView),
                })),
              },
      };
    },

    async getRelatedChildren(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "getRelatedChildren", page: null };
      }
      const page = planRelatedChildrenPage(session.projection, {
        relationshipId: relationshipIdOf(request.relationshipId),
        parentRecordId: recordIdOf(request.parentRecordId),
        after: request.after ?? null,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return {
        kind: "getRelatedChildren",
        page:
          page === null
            ? null
            : {
                children: page.children.map((child) => ({
                  ...toRelatedView(child),
                  cursor: child.recordPk,
                })),
                hasMore: page.hasMore,
                nextCursor: page.nextRecordPk,
              },
      };
    },

    async searchReferenceCandidates(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "searchReferenceCandidates", candidates: null };
      }
      const candidates = planReferenceCandidates(session.projection, {
        fieldId: fieldIdOf(request.fieldId),
        text: request.text,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return {
        kind: "searchReferenceCandidates",
        candidates: candidates === null ? null : candidates.map(toRelatedView),
      };
    },

    async getDeletedRecord(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "getDeletedRecord", deleted: null };
      }
      const deleted = planDeletedRecord(session.projection, recordIdOf(request.recordId));
      return {
        kind: "getDeletedRecord",
        deleted:
          deleted === null
            ? null
            : {
                recordId: encodeDomainId(deleted.restoration.recordId),
                tableId: encodeDomainId(deleted.tableId),
                values: [...deleted.restoration.values].map(
                  ([fieldId, value]): CellWireEntryV1 => ({
                    fieldId: encodeDomainId(fieldId),
                    value: toWireValue(value),
                  }),
                ),
                deletedEventId: encodeDomainId(deleted.deletedEventId),
                deletedAtEpochMs: deleted.deletedAtMs,
                keyValue: deleted.keyValue === null ? null : toWireValue(deleted.keyValue),
              },
      };
    },

    async listTables(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      return {
        kind: "listTables",
        tables: session === undefined ? null : toTableViews(session),
      };
    },

    async listSheetSnapshots(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      return {
        kind: "listSheetSnapshots",
        sheets:
          session === undefined
            ? null
            : planSheetSnapshots(session.projection).map(({ sheet, inertCounts }) => ({
                sheetId: encodeDomainId(sheet.sheetId),
                displayName: sheet.displayName,
                sheetOrdinal: sheet.sheetOrdinal,
                classification: sheet.classification,
                declaredRowCount: sheet.declaredRowCount,
                declaredColumnCount: sheet.declaredColumnCount,
                snapshotRevision: Number(sheet.snapshotRevision),
                inertCounts,
              })),
      };
    },

    async getSnapshotPage(request): Promise<DataWorkerResponseV1> {
      const opened = await openSheetSnapshot(request.appId, request.sheetId);
      if (opened === null) {
        return { kind: "getSnapshotPage", page: null };
      }
      let page: Awaited<ReturnType<typeof readSnapshotPage>>;
      try {
        page = await readSnapshotPage(opened.manifest, opened.loadChunk, {
          firstRow: request.firstRow,
          rowCount: request.rowCount,
        });
      } catch (cause) {
        if (cause instanceof RangeError) {
          throw new DataWorkerCommandError("malformed-request");
        }
        throw cause;
      }
      return {
        kind: "getSnapshotPage",
        page: {
          sheetId: request.sheetId,
          format: page.format,
          displayName: page.displayName,
          rowCount: page.rowCount,
          columnCount: page.columnCount,
          firstRow: page.firstRow,
          rows: page.rows,
          merges: page.merges,
          inertAnchors: page.inertAnchors.map((anchor) => ({
            inertItemId: encodeDomainId(anchor.inertItemId),
            range: anchor.range,
          })),
          discardedRows: page.discardedRows,
        },
      };
    },

    async findInSnapshot(request): Promise<DataWorkerResponseV1> {
      const opened = await openSheetSnapshot(request.appId, request.sheetId);
      if (opened === null) {
        return { kind: "findInSnapshot", result: null };
      }
      const match = await findInSnapshot(opened.manifest, opened.loadChunk, {
        text: request.text,
        afterRow: request.afterRow,
      });
      return {
        kind: "findInSnapshot",
        result: match === null ? { outcome: "not-found" } : { outcome: "found", ...match },
      };
    },

    async listInertItems(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      const listed =
        session === undefined
          ? null
          : planInertItems(
              session.projection,
              request.sheetId === null ? null : sheetIdOf(request.sheetId),
            );
      return {
        kind: "listInertItems",
        items:
          listed === null
            ? null
            : listed.map(({ item, sheetName }) => ({
                inertItemId: encodeDomainId(item.inertItemId),
                sheetId: encodeDomainId(item.sheetId),
                sheetName,
                kind: item.kind,
                location: item.location,
                reasonKey: item.reasonKey,
                anchor: item.anchor,
              })),
      };
    },

    /**
     * CAP-18: the count comes from each app's decrypted head frontier, not from
     * a catalog cache — check 7's rule that nothing cached authorizes a
     * destructive action.
     */
    async appDurabilityFacts(localRoot, catalog): Promise<ReadonlyMap<string, AppDurabilityViewV1>> {
      const facts = new Map<string, AppDurabilityViewV1>();
      for (const entry of catalog.apps) {
        facts.set(entry.appId, await readAppDurability(deps.ports, { localRoot, catalog }, entry));
      }
      return facts;
    },

    disposeAll(): void {
      registry.disposeAll();
    },

    appSession: withApp,

    closeAppSession(appId: string): void {
      registry.close(appId);
    },
  };
}

// ---------------------------------------------------------------- the views --

function toSessionView(
  session: AppSessionV1,
  entry: LocalCatalogAppEntryV1 | undefined,
  durability: AppDurabilityViewV1,
): AppSessionViewV1 {
  const state = session.projection.execute({ kind: "app-state" });
  const tables = toTableViews(session);

  return {
    appId: encodeDomainId(state.appId),
    displayName: state.displayName,
    theme: toThemeWire(state.theme),
    ...(entry === undefined ? {} : { accentId: entry.identity.accentId, glyph: entry.identity.glyph }),
    schemaRevision: Number(state.schemaRevision),
    createdAtEpochMs: state.createdAtMs,
    lastOpenedAtEpochMs: entry?.lastOpenedAtEpochMs ?? state.lastOpenedAtMs,
    // No home means scratch — the persistent fact, until F05 (D26).
    isScratch: (entry?.homeId ?? null) === null,
    durability,
    deviceOnlyChangeCount: durability.deviceOnlyChangeCount,
    tables,
  };
}

/** Every active table, its schema, and its exact live row count (CA-14). */
function toTableViews(session: AppSessionV1): readonly AppTableViewV1[] {
  return session.projection
    .execute({ kind: "list-tables" })
    .map((table) => ({
      tableId: encodeDomainId(table.tableId),
      displayName: table.displayName,
      tableOrdinal: table.tableOrdinal,
      recordCount: session.projection.execute({
        kind: "count-records",
        tableId: table.tableId,
      }),
      isRecordCountExact: true,
      fields: session.projection
        .execute({ kind: "list-fields", tableId: table.tableId })
        .map((field): AppFieldViewV1 => ({
          fieldId: encodeDomainId(field.fieldId),
          displayName: field.displayName,
          fieldOrdinal: field.fieldOrdinal,
          // `FieldTypeV1` and the wire union are the same closed list.
          type: field.type,
          isRequired: field.isRequired,
          isActive: field.isActive,
          enumOptions:
            field.type.kind !== "enum"
              ? []
              : session.projection
                  .execute({ kind: "list-enum-options", fieldId: field.fieldId })
                  .map((option) => ({
                    optionId: encodeDomainId(option.optionId),
                    label: option.displayLabel,
                    optionOrdinal: option.optionOrdinal,
                    isActive: option.isActive,
                  })),
        })),
    }));
}

const toRelatedView = (record: ProjectionLabeledRecordV1): RelatedRecordViewV1 => ({
  recordId: encodeDomainId(record.recordId),
  label: record.label,
});

const toReferenceView = (reference: RelatedParentV1): RecordReferenceViewV1 => {
  const common = {
    fieldId: encodeDomainId(reference.fieldId),
    relationshipId: encodeDomainId(reference.relationshipId),
  };
  return reference.parent.status === "resolved"
    ? {
        ...common,
        status: "resolved",
        recordId: encodeDomainId(reference.parent.recordId),
        tableId: encodeDomainId(reference.parent.tableId),
        label: reference.parent.label,
      }
    : { ...common, status: "broken", originalKey: reference.parent.originalKey };
};

/**
 * A record on the wire: its authored values, then every computed column's
 * result with its CA-26 state. A computed field's authored literal (frozen,
 * unsupported) is not sent twice — it is the computed entry's value.
 */
const toSummaryView = (
  record: ProjectionRecordSummaryV1,
): RecordSummaryViewV1 => {
  const computed = new Set([...record.computed.keys()].map((fieldId) => encodeDomainId(fieldId)));
  return {
    recordId: encodeDomainId(record.recordId),
    tableId: encodeDomainId(record.tableId),
    recordRevision: Number(record.recordRevision),
    cursor: record.recordPk,
    values: [
      ...[...record.authoredValues]
        .filter(([fieldId]) => !computed.has(encodeDomainId(fieldId)))
        .map(
          ([fieldId, value]): CellWireEntryV1 => ({
            fieldId: encodeDomainId(fieldId),
            value: toWireValue(value),
          }),
        ),
      ...[...record.computed].map(([fieldId, cell]): CellWireEntryV1 => toComputedEntry(fieldId, cell)),
    ],
    blockingIssueCount: record.blockingIssueCount,
    warningIssueCount: record.warningIssueCount,
  };
};

/** CA-26 on the wire: the value (or `missing`) and the state that produced it. */
function toComputedEntry(fieldId: FieldId, cell: ProjectionComputedCellV1): CellWireEntryV1 {
  const fieldText = encodeDomainId(fieldId);
  switch (cell.state) {
    case "ok":
    case "frozen":
    case "unsupported":
      return { fieldId: fieldText, value: toWireValue(cell.value), computed: { state: cell.state } };
    case "error":
      return { fieldId: fieldText, value: { kind: "missing" }, computed: { state: "error", code: cell.code } };
    case "type":
    case "empty":
    case "cycle":
    case "unsupported-new-row":
      return { fieldId: fieldText, value: { kind: "missing" }, computed: { state: cell.state } };
    default: {
      const unreachable: never = cell;
      return unreachable;
    }
  }
}

const toIssueView = (issue: ProjectionIssueRowV1): RecordIssueViewV1 => ({
  fieldId: issue.fieldId === null ? null : encodeDomainId(issue.fieldId),
  kind: issue.issueKind,
  severity: issue.severity,
  messageKey: issue.messageKey,
  messageParameters: toWireParameters(issue.messageParameters),
});

const toReportView = (report: ValidationReport) => ({
  isValid: false as const,
  issues: report.issues.map((issue) => ({
    fieldId: issue.fieldId === null ? null : encodeDomainId(issue.fieldId),
    kind: issue.kind,
    severity: issue.severity,
    messageKey: issue.messageKey,
    messageParameters: toWireParameters(issue.messageParameters),
  })),
});

const toWireParameters = (
  parameters: Readonly<Record<string, string | number | bigint | boolean>>,
): Readonly<Record<string, string | number | boolean>> =>
  Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => [
      name,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );

// -------------------------------------------------------- values on the wire --

/** Domain → wire. Total over the union, so no value can fail to render. */
export function toWireValue(value: CellValueV1): CellWireValueV1 {
  switch (value.kind) {
    case "text":
      return { kind: "text", text: value.text };
    case "decimal":
      // A number crosses as its exact authored text; a float would round it.
      return { kind: "number", decimal: value.decimal };
    case "boolean":
      return { kind: "boolean", boolean: value.boolean };
    case "enum":
      return { kind: "option", optionId: encodeDomainId(value.optionId) };
    case "date":
      return { kind: "date", epochDay: value.epochDay };
    case "blank":
      return { kind: "blank" };
    case "missing":
      return { kind: "missing" };
    case "invalid-preserved":
      // The authored source text, preserved so the person who has to fix it
      // can see what they actually wrote (FR-6).
      return { kind: "invalid", sourceText: value.sourceText };
    case "reference":
      return { kind: "reference", recordId: encodeDomainId(value.recordId) };
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/**
 * Wire → domain, and the D28 entry boundary for authored text. A malformed
 * value is a malformed *request*: the shape was legal but the content is not
 * something the domain can hold, and the caller is told which, not why.
 */
export function toDomainValue(value: AuthoredCellWireValueV1): CellValueV1 {
  try {
    switch (value.kind) {
      case "text":
        // Silent: two spellings of the same character render identically, so
        // there is nothing here for a person to decide (D28).
        return textValue(value.text.normalize("NFC"));
      case "number":
        return decimalValue(value.decimal);
      case "boolean":
        return booleanValue(value.boolean);
      case "option":
        return enumValue(decodeDomainId("option", value.optionId));
      case "date":
        return dateValue(value.epochDay);
      case "blank":
        return BLANK_VALUE;
      case "missing":
        return MISSING_VALUE;
      case "reference":
        // Resolved by the command against the field's relationship; an id no
        // live parent carries is refused there as a typed result.
        return referenceValue(decodeDomainId("record", value.recordId));
      default: {
        const unreachable: never = value;
        return unreachable;
      }
    }
  } catch (cause) {
    if (cause instanceof CodecError) {
      throw new DataWorkerCommandError("malformed-request");
    }
    throw cause;
  }
}

const toDomainValues = (
  entries: readonly AuthoredCellWireEntryV1[],
): ReadonlyMap<FieldId, CellValueV1> =>
  new Map(
    entries.map((entry) => [fieldIdOf(entry.fieldId), toDomainValue(entry.value)]),
  );

const idOrRefuse = <T>(read: () => T): T => {
  try {
    return read();
  } catch {
    throw new DataWorkerCommandError("malformed-request");
  }
};

const fieldIdOf = (text: string): FieldId =>
  idOrRefuse(() => decodeDomainId("field", text));

const tableIdOf = (text: string): TableId =>
  idOrRefuse(() => decodeDomainId("table", text));

const recordIdOf = (text: string): RecordId =>
  idOrRefuse(() => decodeDomainId("record", text));

const relationshipIdOf = (text: string): RelationshipId =>
  idOrRefuse(() => decodeDomainId("relationship", text));

const sheetIdOf = (text: string): SheetId =>
  idOrRefuse(() => decodeDomainId("sheet", text));

/**
 * A wire filter as M01's `FilterV1`. Ids that do not decode are a malformed
 * request; filter text is NFC-normalized here, as all authored text is (D28).
 * Whether the filter fits the field is `compileRecordQuery`'s to say.
 */
export function toDomainFilter(filter: FilterWireV1): FilterV1 {
  const fieldId = fieldIdOf(filter.fieldId);
  const operand = filter.operand;
  switch (operand.kind) {
    case "enum-in":
      return {
        fieldId,
        operand: { kind: "enum-in", optionIds: operand.optionIds.map((id) => idOrRefuse(() => decodeDomainId("option", id))) },
      };
    case "reference-in":
      return { fieldId, operand: { kind: "reference-in", recordIds: operand.recordIds.map(recordIdOf) } };
    case "text-contains":
    case "text-equals":
      return { fieldId, operand: { kind: operand.kind, text: operand.text.normalize("NFC") } };
    case "date-range":
      return { fieldId, operand: { kind: "date-range", from: operand.from, to: operand.to } };
    case "number-range":
      return { fieldId, operand: { kind: "number-range", min: operand.min, max: operand.max } };
    case "boolean-is":
      return { fieldId, operand: { kind: "boolean-is", value: operand.value } };
    case "reference-broken":
    case "is-empty":
    case "not-empty":
      return { fieldId, operand: { kind: operand.kind } };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

const toSortValue = (cursor: SortCursorWireV1 | null): ProjectionSortValueV1 => {
  if (cursor === null) return null;
  switch (cursor.kind) {
    case "none":
      return null;
    case "integer":
      return cursor.value;
    case "key":
      return idOrRefuse(() => decodeBase64Url(cursor.base64Url));
    default: {
      const unreachable: never = cursor;
      return unreachable;
    }
  }
};

const toSortCursor = (value: ProjectionSortValueV1): SortCursorWireV1 =>
  value === null
    ? { kind: "none" }
    : typeof value === "number"
      ? { kind: "integer", value }
      : { kind: "key", base64Url: encodeBase64Url(value) };

/** The table id, if the open app actually holds it; `undefined` otherwise. */
function knownTableId(
  session: AppSessionV1,
  text: string,
): TableId | undefined {
  const wanted = idOrRefuse(() => decodeDomainId("table", text));
  return session.projection
    .execute({ kind: "list-tables" })
    .find((table) => encodeDomainId(table.tableId) === encodeDomainId(wanted))
    ?.tableId;
}
