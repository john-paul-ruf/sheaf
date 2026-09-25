/**
 * The machine-facing edge of the app-and-records column (M36 → M32).
 *
 * There is deliberately **no machine here.** Opening an app, paging records,
 * and the four record commands are short-running request/response pairs with
 * no lifecycle to remember: a state machine over them would model nothing the
 * promise does not already model. The long-running flow F02 adds is the import
 * (`import.machine.ts`), and that is the only one.
 *
 * F03 adds the relationship, reference, deleted-record, table and snapshot
 * reads S03 landed (CA-21, CA-22), bound to their wire names verbatim. F04
 * adds the records query's filters and sort (CA-29), the app's structure, and
 * its metrics; and, as their own `ChartServices` over the same port, the
 * charts column's datasets, saves, pins and drafts (CA-30, D61).
 *
 * The adapters add no logic — they name a request, send it, and return the
 * typed response. Every refusal that is a *result* (a validation rejection, an
 * unknown subject, a `null` page) stays a result: it is the view model's job to
 * say what it means, and nothing here collapses one into an exception.
 */

import type {
  AuthoredCellWireEntryV1,
  ChartDefinitionWireV1,
  ChartDraftViewV1,
  DeleteChartResponseV1,
  DiscardChartDraftResponseV1,
  GetChartDatasetRequestV1,
  GetChartDatasetResponseV1,
  GetChartDraftResponseV1,
  GetChartResponseV1,
  ListChartsResponseV1,
  SaveChartDraftResponseV1,
  SaveChartResponseV1,
  SetChartPinResponseV1,
  ChangeHistoryCursorWireV1,
  CloseAppResponseV1,
  CreateRecordResponseV1,
  DataWorkerRequestV1,
  DeleteRecordResponseV1,
  FilterWireV1,
  FindInSnapshotResponseV1,
  GetAppMetricsResponseV1,
  GetAppStructureResponseV1,
  GetChangeHistoryResponseV1,
  GetDeletedRecordResponseV1,
  GetRecordResponseV1,
  GetRelatedChildrenResponseV1,
  GetRelatedRecordsResponseV1,
  GetSnapshotPageResponseV1,
  ListInertItemsResponseV1,
  ListLibraryResponseV1,
  ListSheetSnapshotsResponseV1,
  ListTablesResponseV1,
  NoteAppOpenedResponseV1,
  OpenAppResponseV1,
  PatchRecordResponseV1,
  QueryRecordsResponseV1,
  ResponseForV1,
  RestoreRecordResponseV1,
  SearchReferenceCandidatesResponseV1,
  SortCursorWireV1,
  SortWireV1,
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
   * `cursor` is the previous page's `nextCursor` — a row key, never an offset
   * — and, with a sort, `sortCursor` its `nextSortCursor`. A blank `search`
   * browses the table; text searches within it, and the answer says which
   * scope it used. Filters AND with the search (CA-29); a filter that does not
   * fit the table comes back as a `refusal`, not an exception.
   */
  readonly queryRecords: (input: {
    readonly appId: string;
    readonly tableId: string;
    readonly cursor?: number | null;
    readonly sortCursor?: SortCursorWireV1 | null;
    readonly limit?: number;
    readonly search?: string | null;
    readonly filters?: readonly FilterWireV1[];
    readonly sort?: SortWireV1 | null;
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
  /** A record's parents (resolved or broken) and, per relationship, its children. */
  readonly getRelatedRecords: (input: {
    readonly appId: string;
    readonly recordId: string;
  }) => Promise<GetRelatedRecordsResponseV1>;
  /** `after` is the previous page's `nextCursor` — a row key, never an offset. */
  readonly getRelatedChildren: (input: {
    readonly appId: string;
    readonly relationshipId: string;
    readonly parentRecordId: string;
    readonly after?: number | null;
    readonly limit?: number;
  }) => Promise<GetRelatedChildrenResponseV1>;
  /** SHT-002: blank text browses the related table. */
  readonly searchReferenceCandidates: (input: {
    readonly appId: string;
    readonly fieldId: string;
    readonly text: string;
    readonly limit?: number;
  }) => Promise<SearchReferenceCandidatesResponseV1>;
  /** MOD-010: the values the latest delete preserved; null while it is live. */
  readonly getDeletedRecord: (input: {
    readonly appId: string;
    readonly recordId: string;
  }) => Promise<GetDeletedRecordResponseV1>;
  /** SHT-003: the open app's tables with exact counts, read now. */
  readonly listTables: (input: {
    readonly appId: string;
  }) => Promise<ListTablesResponseV1>;
  /** SCR-030. */
  readonly listSheetSnapshots: (input: {
    readonly appId: string;
  }) => Promise<ListSheetSnapshotsResponseV1>;
  /** SCR-031: at most 1,000 rows per page (CA-22). */
  readonly getSnapshotPage: (input: {
    readonly appId: string;
    readonly sheetId: string;
    readonly firstRow: number;
    readonly rowCount: number;
  }) => Promise<GetSnapshotPageResponseV1>;
  /** The next cell after `afterRow` holding `text`; null searches from the top. */
  readonly findInSnapshot: (input: {
    readonly appId: string;
    readonly sheetId: string;
    readonly text: string;
    readonly afterRow: number | null;
  }) => Promise<FindInSnapshotResponseV1>;
  /** STA-012: one sheet's inert inventory, or the whole app's when null. */
  readonly listInertItems: (input: {
    readonly appId: string;
    readonly sheetId: string | null;
  }) => Promise<ListInertItemsResponseV1>;
  /** The app's structure, including each formula in its current names (D58). */
  readonly getAppStructure: (input: {
    readonly appId: string;
  }) => Promise<GetAppStructureResponseV1>;
  /** SCR-024 "At a glance": table metrics and dashboard values (CA-26). */
  readonly getAppMetrics: (input: {
    readonly appId: string;
  }) => Promise<GetAppMetricsResponseV1>;
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
    getRelatedRecords: ({ appId, recordId }) =>
      port.send({ kind: "getRelatedRecords", appId, recordId }),
    getRelatedChildren: (input) =>
      port.send({ kind: "getRelatedChildren", ...input }),
    searchReferenceCandidates: (input) =>
      port.send({ kind: "searchReferenceCandidates", ...input }),
    getDeletedRecord: ({ appId, recordId }) =>
      port.send({ kind: "getDeletedRecord", appId, recordId }),
    listTables: ({ appId }) => port.send({ kind: "listTables", appId }),
    listSheetSnapshots: ({ appId }) =>
      port.send({ kind: "listSheetSnapshots", appId }),
    getSnapshotPage: (input) =>
      port.send({ kind: "getSnapshotPage", ...input }),
    findInSnapshot: (input) => port.send({ kind: "findInSnapshot", ...input }),
    listInertItems: ({ appId, sheetId }) =>
      port.send({ kind: "listInertItems", appId, sheetId }),
    getAppStructure: ({ appId }) => port.send({ kind: "getAppStructure", appId }),
    getAppMetrics: ({ appId }) => port.send({ kind: "getAppMetrics", appId }),
  };
}

// --- the charts column (CA-30, D61) -----------------------------------------

/**
 * The machine-facing edge of the charts column. Like the records adapters
 * above, there is no machine: every chart request is a short request/response
 * pair, and a refusal (`stale-chart`, `refused`, an unknown chart) stays a
 * result for the view model to say, never an exception.
 */
export interface ChartServices {
  /** Every chart of the app, in display order; null for an unknown app. */
  readonly listCharts: (input: { readonly appId: string }) => Promise<ListChartsResponseV1>;
  readonly getChart: (input: { readonly appId: string; readonly chartId: string }) => Promise<GetChartResponseV1>;
  /** A saved chart's dataset, or a draft's for the live preview (CA-30). */
  readonly getChartDataset: (input: {
    readonly appId: string;
    readonly source: GetChartDatasetRequestV1["source"];
    readonly tableOffset?: number;
  }) => Promise<GetChartDatasetResponseV1>;
  /** A new chart names no `chartId`; an edit names the revision it opened. */
  readonly saveChart: (input: {
    readonly appId: string;
    readonly chartId: string | null;
    readonly expectedRevision: number | null;
    readonly definition: ChartDefinitionWireV1;
  }) => Promise<SaveChartResponseV1>;
  readonly setChartPin: (input: {
    readonly appId: string;
    readonly chartId: string;
    readonly expectedRevision: number;
    readonly pinned: boolean;
  }) => Promise<SetChartPinResponseV1>;
  readonly deleteChart: (input: {
    readonly appId: string;
    readonly chartId: string;
    readonly expectedRevision: number;
  }) => Promise<DeleteChartResponseV1>;
  /** D61: operational state, never an event. */
  readonly getChartDraft: (input: { readonly appId: string }) => Promise<GetChartDraftResponseV1>;
  readonly saveChartDraft: (input: { readonly appId: string; readonly draft: ChartDraftViewV1 }) => Promise<SaveChartDraftResponseV1>;
  readonly discardChartDraft: (input: { readonly appId: string }) => Promise<DiscardChartDraftResponseV1>;
}

export function createChartServices(port: RecordsWorkerPort, onAuthored?: (appId: string) => void): ChartServices {
  async function write<R extends SaveChartResponseV1 | SetChartPinResponseV1 | DeleteChartResponseV1>(
    appId: string, pending: Promise<R>,
  ): Promise<R> {
    const response = await pending;
    const { outcome } = response;
    if ((outcome.result === "saved" && outcome.commitId !== null) || outcome.result === "deleted") onAuthored?.(appId);
    return response;
  }
  return {
    listCharts: ({ appId }) => port.send({ kind: "listCharts", appId }),
    getChart: ({ appId, chartId }) => port.send({ kind: "getChart", appId, chartId }),
    getChartDataset: (input) => port.send({ kind: "getChartDataset", ...input }),
    saveChart: (input) => write(input.appId, port.send({ kind: "saveChart", ...input })),
    setChartPin: (input) => write(input.appId, port.send({ kind: "setChartPin", ...input })),
    deleteChart: (input) => write(input.appId, port.send({ kind: "deleteChart", ...input })),
    getChartDraft: ({ appId }) => port.send({ kind: "getChartDraft", appId }),
    saveChartDraft: ({ appId, draft }) => port.send({ kind: "saveChartDraft", appId, draft }),
    discardChartDraft: ({ appId }) => port.send({ kind: "discardChartDraft", appId }),
  };
}
