/**
 * The machine-facing edge of the app-and-records column (M36 → M32).
 *
 * There is deliberately **no machine here.** Opening an app, paging records,
 * and the four record commands are short-running request/response pairs with
 * no lifecycle to remember: a state machine over them would model nothing the
 * promise does not already model. The long-running flow F02 adds is the import
 * (`import.machine.ts`), and that is the only one.
 *
 * The adapters add no logic — they name a request, send it, and return the
 * typed response. Every refusal that is a *result* (a validation rejection, an
 * unknown subject, a `null` page) stays a result: it is the view model's job to
 * say what it means, and nothing here collapses one into an exception.
 */

import type {
  AuthoredCellWireEntryV1,
  ChangeHistoryCursorWireV1,
  CloseAppResponseV1,
  CreateRecordResponseV1,
  DataWorkerRequestV1,
  DeleteRecordResponseV1,
  GetChangeHistoryResponseV1,
  GetRecordResponseV1,
  ListLibraryResponseV1,
  NoteAppOpenedResponseV1,
  OpenAppResponseV1,
  PatchRecordResponseV1,
  QueryRecordsResponseV1,
  ResponseForV1,
  RestoreRecordResponseV1,
} from "../../workers/protocol/messages.js";

/** Structural, so a test double is a two-line object (the F01 pattern). */
export interface RecordsWorkerPort {
  send<R extends DataWorkerRequestV1>(
    request: R,
  ): Promise<ResponseForV1<R["kind"]>>;
}

export interface RecordsServices {
  readonly listLibrary: () => Promise<ListLibraryResponseV1>;
  readonly openApp: (input: {
    readonly appId: string;
  }) => Promise<OpenAppResponseV1>;
  readonly closeApp: (input: {
    readonly appId: string;
  }) => Promise<CloseAppResponseV1>;
  /** Operational only: it updates a cache and authors no event. */
  readonly noteAppOpened: (input: {
    readonly appId: string;
  }) => Promise<NoteAppOpenedResponseV1>;
  /**
   * `cursor` is the previous page's `nextCursor` — a row key, never an offset.
   * A blank `search` browses the table; text searches within it, and the
   * answer says which scope it used.
   */
  readonly queryRecords: (input: {
    readonly appId: string;
    readonly tableId: string;
    readonly cursor?: number | null;
    readonly limit?: number;
    readonly search?: string | null;
  }) => Promise<QueryRecordsResponseV1>;
  readonly getRecord: (input: {
    readonly appId: string;
    readonly recordId: string;
  }) => Promise<GetRecordResponseV1>;
  readonly createRecord: (input: {
    readonly appId: string;
    readonly tableId: string;
    readonly values: readonly AuthoredCellWireEntryV1[];
  }) => Promise<CreateRecordResponseV1>;
  readonly patchRecord: (input: {
    readonly appId: string;
    readonly recordId: string;
    readonly changes: readonly AuthoredCellWireEntryV1[];
  }) => Promise<PatchRecordResponseV1>;
  readonly deleteRecord: (input: {
    readonly appId: string;
    readonly recordId: string;
  }) => Promise<DeleteRecordResponseV1>;
  readonly restoreRecord: (input: {
    readonly appId: string;
    readonly recordId: string;
  }) => Promise<RestoreRecordResponseV1>;
  readonly getChangeHistory: (input: {
    readonly appId: string;
    readonly cursor?: ChangeHistoryCursorWireV1 | null;
    readonly limit?: number;
  }) => Promise<GetChangeHistoryResponseV1>;
}

export function createRecordsServices(
  port: RecordsWorkerPort,
): RecordsServices {
  return {
    listLibrary: () => port.send({ kind: "listLibrary" }),
    openApp: ({ appId }) => port.send({ kind: "openApp", appId }),
    closeApp: ({ appId }) => port.send({ kind: "closeApp", appId }),
    noteAppOpened: ({ appId }) => port.send({ kind: "noteAppOpened", appId }),
    queryRecords: (input) => port.send({ kind: "queryRecords", ...input }),
    getRecord: ({ appId, recordId }) =>
      port.send({ kind: "getRecord", appId, recordId }),
    createRecord: ({ appId, tableId, values }) =>
      port.send({ kind: "createRecord", appId, tableId, values }),
    patchRecord: ({ appId, recordId, changes }) =>
      port.send({ kind: "patchRecord", appId, recordId, changes }),
    deleteRecord: ({ appId, recordId }) =>
      port.send({ kind: "deleteRecord", appId, recordId }),
    restoreRecord: ({ appId, recordId }) =>
      port.send({ kind: "restoreRecord", appId, recordId }),
    getChangeHistory: (input) =>
      port.send({ kind: "getChangeHistory", ...input }),
  };
}
