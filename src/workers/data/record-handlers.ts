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

import { encodeBase64Url } from "../../domain/model/bytes.js";
import { CodecError } from "../../domain/model/errors.js";
import {
  decodeDomainId,
  encodeDomainId,
  type FieldId,
  type RecordId,
  type TableId,
} from "../../domain/model/ids.js";
import {
  BLANK_VALUE,
  MISSING_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
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
import { isRestorable, planHistoryPage } from "../../application/queries/history.js";
import type {
  ProjectionIssueRowV1,
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
  GetChangeHistoryRequestV1,
  GetRecordRequestV1,
  NoteAppOpenedRequestV1,
  OpenAppRequestV1,
  PatchRecordRequestV1,
  QueryRecordsRequestV1,
  RecordCommandOutcomeV1,
  RecordDetailViewV1,
  RecordIssueViewV1,
  RecordSummaryViewV1,
  RestoreRecordRequestV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import { AppSessionRegistry, openAppSession, type AppSessionV1 } from "./app-session.js";
import type { WorkerSessionContextV1 } from "./event-store.js";
import {
  deviceOnlyChangeCount,
  loadApp,
  openAppKey,
  type AppStoragePortsV1,
} from "./event-store.js";
import { encodeAuthoredRecordBytes } from "./record-event-payloads.js";
import type { LocalCatalogAppEntryV1, LocalCatalogV1 } from "./catalog.js";

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
  /** The device-only count for every catalog app, from its decrypted head. */
  deviceOnlyChangeCounts(
    localRoot: EnvelopeKeyRefV1,
    catalog: LocalCatalogV1,
  ): Promise<ReadonlyMap<string, number>>;
  /** Lock: every projection destroyed, every app key zeroized. */
  disposeAll(): void;
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
      session: deps.getContext,
      deviceId: deviceIdOf(context),
      appKey,
      appHeadStorageId: entry.appHeadStorageId,
      hydratedAtMs: deps.clock.nowEpochMs(),
    });
    registry.set(appId, session);
    return session;
  }

  const commandDeps = (session: AppSessionV1) => ({
    clock: deps.clock,
    entropy: deps.entropy,
    projection: session.projection,
    repository: session.repository,
    recordDigest: (record: Parameters<typeof encodeAuthoredRecordBytes>[0]) =>
      sha256(encodeAuthoredRecordBytes(record)),
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
    const result = await run(session);
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
      return {
        kind: "openApp",
        session: toSessionView(session, entry),
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

      const page = planRecordPage(
        session.projection,
        recordQuery({
          tableId,
          cursor: request.cursor ?? null,
          ...(request.limit === undefined ? {} : { limit: request.limit }),
          search: request.search ?? null,
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
        },
      };
    },

    async getRecord(request): Promise<DataWorkerResponseV1> {
      const session = await withApp(request.appId);
      if (session === undefined) {
        return { kind: "getRecord", record: null };
      }
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

    /**
     * CAP-18: the count comes from each app's decrypted head frontier, not from
     * a catalog cache — check 7's rule that nothing cached authorizes a
     * destructive action.
     */
    async deviceOnlyChangeCounts(
      localRoot: EnvelopeKeyRefV1,
      catalog: LocalCatalogV1,
    ): Promise<ReadonlyMap<string, number>> {
      const counts = new Map<string, number>();
      const deviceId = decodeDomainId("device", catalog.deviceId);
      for (const entry of catalog.apps) {
        const open = registry.get(entry.appId);
        if (open !== undefined) {
          counts.set(entry.appId, open.deviceOnlyChangeCount());
          continue;
        }
        if (entry.appHeadStorageId === null) {
          // A listed-only app holds no local head; there is nothing here to
          // count and saying zero would be the same claim as "none".
          counts.set(entry.appId, 0);
          continue;
        }
        const appKey = await openAppKey(
          deps.ports,
          localRoot,
          entry,
          parseEnvelopeTransport,
        );
        try {
          const loaded = await loadApp(
            deps.ports,
            appKey,
            entry.appHeadStorageId,
          );
          counts.set(
            entry.appId,
            deviceOnlyChangeCount(loaded.head.frontier, deviceId),
          );
        } finally {
          deps.ports.crypto.destroyKey(appKey);
        }
      }
      return counts;
    },

    disposeAll(): void {
      registry.disposeAll();
    },
  };
}

// ---------------------------------------------------------------- the views --

function toSessionView(
  session: AppSessionV1,
  entry: LocalCatalogAppEntryV1 | undefined,
): AppSessionViewV1 {
  const state = session.projection.execute({ kind: "app-state" });
  const tables: readonly AppTableViewV1[] = session.projection
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

  return {
    appId: encodeDomainId(state.appId),
    displayName: state.displayName,
    theme: state.theme,
    schemaRevision: Number(state.schemaRevision),
    createdAtEpochMs: state.createdAtMs,
    lastOpenedAtEpochMs: entry?.lastOpenedAtEpochMs ?? state.lastOpenedAtMs,
    // No home means scratch — the persistent fact, until F05 (D26).
    isScratch: (entry?.homeId ?? null) === null,
    deviceOnlyChangeCount: session.deviceOnlyChangeCount(),
    tables,
  };
}

const toSummaryView = (
  record: ProjectionRecordSummaryV1,
): RecordSummaryViewV1 => ({
  recordId: encodeDomainId(record.recordId),
  tableId: encodeDomainId(record.tableId),
  recordRevision: Number(record.recordRevision),
  cursor: record.recordPk,
  values: [...record.authoredValues].map(
    ([fieldId, value]): CellWireEntryV1 => ({
      fieldId: encodeDomainId(fieldId),
      value: toWireValue(value),
    }),
  ),
  blockingIssueCount: record.blockingIssueCount,
  warningIssueCount: record.warningIssueCount,
});

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
