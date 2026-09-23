/**
 * The machine-facing edge of the import column (M36 → M32; D17).
 *
 * Two workers, one run. The **page** owns the `MessageChannel` between them,
 * which is why it is created here rather than in either worker: `port1` rides
 * `startImport` to the parser, `port2` rides `beginImportStage` to the data
 * worker, and neither end can hand a port back (a response never carries one).
 * Facts therefore travel parser → data worker and are never seen by the page.
 *
 * **Spawn and terminate are this layer's job.** The import worker is spawned at
 * {@link ImportServices.startImport} — a session that never imports never pays
 * for a second worker — and terminated on every terminal state of the machine.
 * The spawn function is *injected*: application code may not import
 * `src/bootstrap/`, so S07 supplies the constructor.
 *
 * Parse events are a **stream**, not a response: {@link ImportServices.subscribe}
 * is what the machine's event-source actor attaches to.
 */

import {
  ImportWorkerClient,
  type ImportEventListener,
} from "../../workers/protocol/import-client.js";
import type {
  ImportWorkerEventV1,
} from "../../workers/protocol/import-messages.js";
import type {
  BeginImportStageRequestV1,
  BeginImportStageResponseV1,
  CancelImportStageResponseV1,
  DataWorkerRequestV1,
  GetImportStageResponseV1,
  ListLibraryResponseV1,
  ListTablesResponseV1,
  PromoteImportResponseV1,
  ProposedAppWireV1,
  ProposedWorkbookWireV1,
  ResponseForV1,
  ReviewEditWireV1,
  ApplyReviewEditResponseV1,
  WorkbookReviewEditWireV1,
} from "../../workers/protocol/messages.js";

/**
 * The part of the data-worker client the import flow uses. It is wider than
 * {@link import("./services.js").SecurityWorkerPort} by exactly one parameter:
 * `beginImportStage` must transfer a port, and a port cannot be cloned.
 */
export interface ImportWorkerPort {
  send<R extends DataWorkerRequestV1>(
    request: R,
    transfer?: readonly Transferable[],
  ): Promise<ResponseForV1<R["kind"]>>;
}

export interface ImportServicesOptions {
  readonly dataWorker: ImportWorkerPort;
  /** Constructs the import worker. Injected — never imported from bootstrap. */
  readonly spawnImportWorker: () => Worker;
}

/**
 * Everything the {@link import("./import.machine.js").importMachine} may do.
 * Each member is one named RPC or one worker-lifetime step; no member decides
 * anything, so the machine holds the whole of the flow's logic.
 */
export interface ImportServices {
  /** Attaches to the parse event stream. Survives across runs. */
  readonly subscribe: (listener: ImportEventListener) => () => void;
  /**
   * Spawns the parser, creates the run's channel, and sends the file with
   * `port1` transferred. The parser sniffs and sizes, then stops.
   */
  readonly startImport: (input: {
    readonly file: Blob;
    readonly fileName: string;
  }) => void;
  /**
   * Creates the durable stage and hands the data worker `port2` in the
   * request's transfer list (D17). Answers with the stage id and nothing else.
   * A delimited stage may land in an existing app (D38); a workbook's never.
   */
  readonly beginStage: (
    input: Omit<BeginImportStageRequestV1, "kind">,
  ) => Promise<BeginImportStageResponseV1>;
  /**
   * "The stage exists, start streaming." A workbook names the sheets to read
   * (D39); a delimited file names none.
   */
  readonly proceed: (input: {
    readonly stageId: string;
    readonly selectedSheets?: readonly number[];
  }) => void;
  /** Cooperative: the parser stops at the next batch boundary. */
  readonly cancelParse: () => void;
  readonly getStage: (input: {
    readonly stageId: string;
  }) => Promise<GetImportStageResponseV1>;
  readonly runInference: (input: {
    readonly stageId: string;
  }) => Promise<ResponseForV1<"runInference">>;
  readonly applyReviewEdit: (input: {
    readonly stageId: string;
    readonly edit: WorkbookReviewEditWireV1;
  }) => Promise<ApplyReviewEditResponseV1>;
  readonly promoteImport: (input: {
    readonly stageId: string;
    readonly acceptedName: string;
  }) => Promise<PromoteImportResponseV1>;
  /** The apps on this device: SCR-017's existing-app destination (D38). */
  readonly listLibrary: () => Promise<ListLibraryResponseV1>;
  /**
   * An app's tables, freshly read. An append reads them either side of its
   * one commit, so the landing is the table the commit created (CAP-26).
   */
  readonly listTables: (input: {
    readonly appId: string;
  }) => Promise<ListTablesResponseV1>;
  /** The four-step cleanup. Idempotent: a receipt comes back either way. */
  readonly cancelStage: (input: {
    readonly stageId: string;
  }) => Promise<CancelImportStageResponseV1>;
  /** Ends the parser and releases an unsent port. Safe to call twice. */
  readonly terminate: () => void;
}

// --- the one-table view (mechanical, until S07's workbook review) ------------
//
// The page declares only the delimited flow (D48), so every proposal it can
// receive is S02's one-sheet, one-table case. The F02 review renders that
// table through F02's shape; these two functions are the whole adaptation,
// and they fail closed — anything that is not exactly one table of F02's
// members has no F02 rendering, so the run ends rather than showing part of it.

const F02_SUBJECTS: readonly string[] = [
  "app-name",
  "table-name",
  "header-row",
  "discarded-rows",
  "field-name",
  "field-type",
  "enum-options",
];
const F02_EDIT_KINDS: readonly string[] = [
  "rename-app",
  "rename-table",
  "rename-field",
  "override-type",
  "set-header-row",
  "edit-enum-options",
];
const F02_EVIDENCE_KINDS: readonly string[] = [
  "value-pattern",
  "distinct-values",
  "header-text",
  "file-name",
  "row-shape",
  "value-conflict",
];
const F02_DIAGNOSTIC_CODES: readonly string[] = [
  "text-normalized-nfc",
  "unterminated-quote",
  "quote-inside-unquoted-field",
  "ragged-row",
  "replacement-character",
  "row-length-bound-reached",
];

/**
 * The proposal's one table in F02's review shape, or `null` when the proposal
 * is not one table of F02's members (a workbook, which only S07's surfaces
 * render).
 */
export function singleTableProposal(proposal: ProposedWorkbookWireV1): ProposedAppWireV1 | null {
  const [table] = proposal.tables;
  if (table === undefined || proposal.tables.length !== 1) return null;
  type F02 = ProposedAppWireV1;
  const fields: F02["table"]["fields"][number][] = [];
  for (const field of table.fields) {
    if (field.type.kind === "reference" || field.sourceFormat.kind === "serial-date") return null;
    fields.push({
      columnIndex: field.columnIndex,
      fieldName: field.fieldName,
      isNameGenerated: field.isNameGenerated,
      type: field.type,
      sourceFormat: field.sourceFormat,
      enumOptions: field.enumOptions,
      violations: field.violations,
    });
  }
  const statements: F02["statements"][number][] = [];
  for (const statement of proposal.statements) {
    const editKind = statement.editKind;
    if (
      !F02_SUBJECTS.includes(statement.subject) ||
      (editKind !== null && !F02_EDIT_KINDS.includes(editKind)) ||
      statement.evidence.some((evidence) => !F02_EVIDENCE_KINDS.includes(evidence.kind))
    ) {
      return null;
    }
    statements.push({
      // Projected, never reshaped (CA-16): the worker's own identity.
      statementId: statement.statementId,
      subject: statement.subject as F02["statements"][number]["subject"],
      editKind: editKind as F02["statements"][number]["editKind"],
      columnIndex: statement.columnIndex,
      evidence: statement.evidence as F02["statements"][number]["evidence"],
      evidenceFingerprint: statement.evidenceFingerprint,
      disposition: statement.disposition,
    });
  }
  const discardedRows: F02["discardedRows"][number][] = [];
  for (const row of table.discardedRows) {
    if (row.reason === "totals-row") return null;
    discardedRows.push({ rowIndex: row.rowIndex, reason: row.reason, cells: row.cells });
  }
  if (proposal.diagnostics.some((diagnostic) => !F02_DIAGNOSTIC_CODES.includes(diagnostic.code))) return null;
  return {
    fileName: proposal.fileName,
    appName: proposal.appName,
    table: { tableName: table.tableName, fields },
    headerRowIndex: table.headerRowIndex,
    leadingRows: table.leadingRows,
    discardedRows,
    discardedRowCount: table.discardedRowCount,
    rowCount: table.rowCount,
    isRowCountExact: true,
    statements,
    diagnostics: proposal.diagnostics as F02["diagnostics"],
  };
}

/**
 * An F02 review edit, addressed to the proposal's one table by its keys
 * (CA-19): what the worker applies. A column the table does not have gets a
 * key the worker refuses as unknown — the refusal stays the worker's.
 */
export function workbookEditOf(proposal: ProposedWorkbookWireV1, edit: ReviewEditWireV1): WorkbookReviewEditWireV1 {
  const table = proposal.tables[0];
  const tableKey = table?.tableKey ?? "";
  const columnKey = (columnIndex: number): string =>
    table?.fields.find((field) => field.columnIndex === columnIndex)?.columnKey ?? `${tableKey}.c${String(columnIndex)}`;
  switch (edit.kind) {
    case "rename-app":
      return edit;
    case "rename-table":
      return { kind: "rename-table", tableKey, tableName: edit.tableName };
    case "rename-field":
      return { kind: "rename-field", tableKey, columnKey: columnKey(edit.columnIndex), fieldName: edit.fieldName };
    case "override-type":
      return { kind: "override-type", tableKey, columnKey: columnKey(edit.columnIndex), type: edit.type };
    case "set-header-row":
      return { kind: "set-header-row", regionKey: tableKey, rowIndex: edit.rowIndex };
    case "edit-enum-options":
      return { kind: "edit-enum-options", tableKey, columnKey: columnKey(edit.columnIndex), options: edit.options };
    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
}

export function createImportServices(
  options: ImportServicesOptions,
): ImportServices {
  const listeners = new Set<ImportEventListener>();
  let client: ImportWorkerClient | undefined;
  /** Held between `startImport` and `beginStage`; transferred, then dropped. */
  let stagePort: MessagePort | undefined;

  const emit = (event: ImportWorkerEventV1): void => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const releasePort = (): void => {
    stagePort?.close();
    stagePort = undefined;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    startImport({ file, fileName }) {
      // A terminated client never spawns another, so every run gets its own.
      client?.dispose();
      releasePort();

      const fresh = new ImportWorkerClient({
        spawn: options.spawnImportWorker,
      });
      fresh.on(emit);
      client = fresh;

      const channel = new MessageChannel();
      stagePort = channel.port2;
      fresh.send({ kind: "startImport", file, fileName }, [channel.port1]);
    },

    beginStage(input) {
      const port = stagePort;
      stagePort = undefined;
      return options.dataWorker.send(
        { kind: "beginImportStage", ...input },
        port === undefined ? [] : [port],
      );
    },

    proceed({ stageId, selectedSheets }) {
      client?.send({
        kind: "proceed",
        stageId,
        ...(selectedSheets === undefined ? {} : { selectedSheets }),
      });
    },

    cancelParse() {
      client?.send({ kind: "cancelImport" });
    },

    getStage({ stageId }) {
      return options.dataWorker.send({ kind: "getImportStage", stageId });
    },

    runInference({ stageId }) {
      return options.dataWorker.send({ kind: "runInference", stageId });
    },

    applyReviewEdit({ stageId, edit }) {
      return options.dataWorker.send({
        kind: "applyReviewEdit",
        stageId,
        edit,
      });
    },

    promoteImport({ stageId, acceptedName }) {
      return options.dataWorker.send({
        kind: "promoteImport",
        stageId,
        acceptedName,
      });
    },

    listLibrary() {
      return options.dataWorker.send({ kind: "listLibrary" });
    },

    listTables({ appId }) {
      return options.dataWorker.send({ kind: "listTables", appId });
    },

    cancelStage({ stageId }) {
      return options.dataWorker.send({ kind: "cancelImportStage", stageId });
    },

    terminate() {
      client?.dispose();
      client = undefined;
      releasePort();
    },
  };
}
