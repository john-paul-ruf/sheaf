/**
 * Test doubles for the machine services. Not a test file — the vitest include
 * globs are extension-qualified, so this is never collected as a suite.
 *
 * The fake records every call, which is how the suites prove a *negative*: a
 * locally-rejected recovery code must never reach the worker, and a refused
 * settings write must never arm a timer.
 */

import { DataWorkerRequestError } from "../../../src/workers/protocol/client.js";
import type {
  DataWorkerErrorKindV1,
  GetImportStageResponseV1,
  IdleTimeoutMinutesV1,
  ImportCleanupReceiptViewV1,
  LibraryAppV1,
  ProposedAppWireV1,
  ProposedWorkbookWireV1,
  ResetInventoryViewV1,
  UnlockedSessionViewV1,
} from "../../../src/workers/protocol/messages.js";
import type { ImportWorkerEventV1 } from "../../../src/workers/protocol/import-messages.js";
import type { RefusalV1 } from "../../../src/import/preflight/refusal.js";
import { IMPORT_BUDGET_V1 } from "../../../src/import/preflight/budgets.js";
import {
  preflightWorkbook,
  type WorkbookPreflightReportV1,
} from "../../../src/import/preflight/workbook.js";
import { PRESERVED_PART_KINDS, type SheetInventoryItemV1 } from "../../../src/import/facts/index.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { WORKBOOK_REGISTRY } from "../../../src/workers/import/adapters.js";
import { fixtureSource } from "../import/fixtures.js";
import type { SecurityServices } from "../../../src/application/workflows/services.js";
import type { ImportServices } from "../../../src/application/workflows/import-services.js";
import type { ClockPort } from "../../../src/application/ports/clock.js";

export const SETUP_RECOVERY_CODE =
  "7G4KN8R-D2QPMV6-TX3H9WY-B5C0EFJ-K1MNPQR-STVWXYZ-2468ACD-GHJ57TQ";

export function unlockedSession(
  overrides: Partial<UnlockedSessionViewV1> = {},
): UnlockedSessionViewV1 {
  return {
    state: "unlocked",
    unlockedVia: "passphrase",
    settings: { idleTimeoutMinutes: 0 },
    catalogRevision: 1,
    transactionRevision: 1,
    appCount: 0,
    homeCount: 0,
    ...overrides,
  };
}

export function emptyInventory(): ResetInventoryViewV1 {
  return { apps: [], appCount: 0, homeCount: 0 };
}

/** A refusal shaped exactly like the worker's, so machines see production. */
export function workerError(
  kind: DataWorkerErrorKindV1,
  retryAfterMs?: number,
): DataWorkerRequestError {
  return new DataWorkerRequestError(
    retryAfterMs === undefined ? { kind } : { kind, retryAfterMs },
  );
}

/** Wiring helpers: a service that answers, and one that refuses. */
export function resolves<T>(value: T): () => Promise<T> {
  return () => Promise.resolve(value);
}

export function rejects(error: DataWorkerRequestError): () => Promise<never> {
  return () => Promise.reject(error);
}

export interface ServiceCall {
  readonly name: keyof SecurityServices;
  readonly input: unknown;
}

export interface FakeServices {
  readonly services: SecurityServices;
  readonly calls: ServiceCall[];
  /** Names only, for order assertions that do not care about arguments. */
  names(): string[];
}

type ServiceOverrides = {
  [K in keyof SecurityServices]?: SecurityServices[K];
};

const notWired = (name: string) => (): never => {
  throw new Error(`fake service '${name}' was called but not wired`);
};

/**
 * Every service is unwired by default and throws if called: a machine that
 * reaches the worker when it should not fails loudly rather than quietly
 * resolving.
 */
export function fakeServices(overrides: ServiceOverrides = {}): FakeServices {
  const calls: ServiceCall[] = [];

  const wrap = <K extends keyof SecurityServices>(
    name: K,
  ): SecurityServices[K] => {
    const implementation = overrides[name] ?? notWired(name);
    return ((input: unknown) => {
      calls.push({ name, input });
      return (implementation as (value: unknown) => unknown)(input);
    }) as SecurityServices[K];
  };

  return {
    services: {
      setup: wrap("setup"),
      unlock: wrap("unlock"),
      unlockWithRecoveryCode: wrap("unlockWithRecoveryCode"),
      changePassphrase: wrap("changePassphrase"),
      revealRecoveryCode: wrap("revealRecoveryCode"),
      lock: wrap("lock"),
      updateSettings: wrap("updateSettings"),
      resetLocked: wrap("resetLocked"),
      resetReadable: wrap("resetReadable"),
      getStatus: wrap("getStatus"),
    },
    calls,
    names(): string[] {
      return calls.map((call) => call.name);
    },
  };
}

/** A clock the test advances by hand; nothing here reads wall time. */
export function fakeClock(start = 1_700_000_000_000): ClockPort & {
  advance(ms: number): void;
} {
  let now = start;
  return {
    nowEpochMs: () => now,
    advance(ms: number): void {
      now += ms;
    },
  };
}

export const IDLE_TIMEOUT_CHOICES: readonly IdleTimeoutMinutesV1[] = [
  0, 5, 15, 60,
];

// --- the import column -------------------------------------------------------

export const STAGE_ID = "stage-01H8XG9K7Q";

export function progressEvent(
  overrides: Partial<Omit<Extract<ImportWorkerEventV1, { kind: "progress" }>, "kind">> = {},
): ImportWorkerEventV1 {
  return {
    kind: "progress",
    phase: "parsing",
    currentAction: "parsing",
    rowsSoFar: 0,
    batchesAcked: 0,
    ...overrides,
  };
}

/** A delimited pre-flight exactly as the parser reports it (S03 shapes). */
export function preflightEvent(
  overrides: Partial<Omit<Extract<ImportWorkerEventV1, { kind: "preflight" }>, "kind">> = {},
): ImportWorkerEventV1 {
  return {
    kind: "preflight",
    detected: {
      kind: "delimited",
      delimiter: ",",
      encoding: "utf-8",
      bomByteLength: 0,
      newline: "lf",
    },
    declaredExtension: "csv",
    contradiction: null,
    report: {
      fileName: "field-log-messy.csv",
      sourceByteLength: 4096,
      delimiter: ",",
      encoding: "utf-8",
      newline: "lf",
      columnCount: 9,
      estimatedRowCount: 43,
      estimatedCellCount: 387,
      isEstimate: true,
      sampleRows: [["Site", "Status"]],
      bytesSampled: 4096,
    },
    ...overrides,
  };
}

/** Every preserved-part count at zero; a fixture raises the ones it needs. */
export function noParts(): SheetInventoryItemV1["preservedPartCounts"] {
  return Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as SheetInventoryItemV1["preservedPartCounts"];
}

/** One inventoried sheet in S01's shape (CA-18). */
export function inventoriedSheet(
  sheetIndex: number,
  name: string,
  overrides: Partial<SheetInventoryItemV1> = {},
): SheetInventoryItemV1 {
  return {
    sheetIndex,
    name,
    kind: "worksheet",
    visibility: "visible",
    declaredRange: null,
    declaredTables: [],
    estimatedRowCount: 100,
    estimatedCellCount: 400,
    preservedPartCounts: noParts(),
    ...overrides,
  };
}

/**
 * A workbook report in S01's shape: three sheets that fit (D31) unless a suite
 * says otherwise. The route and default selection are the suite's to state,
 * exactly as `routeOf` would have — the machine obeys the report, it does not
 * recompute it.
 */
export function workbookReport(overrides: Partial<WorkbookPreflightReportV1> = {}): WorkbookPreflightReportV1 {
  const sheets = overrides.sheets ?? [
    inventoriedSheet(0, "Jobs", { declaredTables: [{ name: "JobsTable", range: { firstRow: 0, firstColumn: 0, lastRow: 60, lastColumn: 9 } }] }),
    inventoriedSheet(1, "Crew"),
    inventoriedSheet(2, "Overview", { preservedPartCounts: { ...noParts(), chart: 1, drawing: 2 } }),
  ];
  return {
    fileName: "fieldwork-q3.xlsx",
    sourceByteLength: 48_000,
    format: "xlsx",
    formatContradiction: null,
    sheets,
    sheetListKnown: true,
    dateSystem: "1900",
    totals: {
      sheetCount: sheets.length,
      estimatedRowCount: sheets.reduce((sum, sheet) => sum + (sheet.estimatedRowCount ?? 0), 0),
      estimatedCellCount: sheets.reduce((sum, sheet) => sum + (sheet.estimatedCellCount ?? 0), 0),
      preservedPartCounts: noParts(),
    },
    route: "fits",
    defaultSelection: sheets.map((sheet) => sheet.sheetIndex),
    budgets: { ...IMPORT_BUDGET_V1 },
    isEstimate: true,
    ...overrides,
  };
}

/** The `workbook-preflight` event exactly as the import worker sends it (CA-24). */
export function workbookPreflightEvent(report: WorkbookPreflightReportV1 = workbookReport()): ImportWorkerEventV1 {
  return {
    kind: "workbook-preflight",
    detected: { kind: "zip-container", container: "ooxml" },
    declaredExtension: "xlsx",
    contradiction: null,
    report,
  };
}

/**
 * A real report: the fixture sized by `preflightWorkbook` through the import
 * worker's own registry, as the worker would send it. For suites whose
 * assertion is about what a real workbook's metadata says.
 */
export async function fixtureReport(path: string): Promise<WorkbookPreflightReportV1> {
  const source = await fixtureSource(path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const outcome = await preflightWorkbook(source, await sniffContent(source, name), WORKBOOK_REGISTRY.readers);
  if (outcome.kind !== "proceed") throw new Error(`${path} was refused at pre-flight`);
  return outcome.report;
}

/** One catalog app in the library's shape (CA-09). */
export function libraryApp(appId: string, displayName: string, overrides: Partial<LibraryAppV1> = {}): LibraryAppV1 {
  return {
    appId,
    displayName,
    accentId: "accent-1",
    glyph: "F",
    createdAtEpochMs: 1_700_000_000_000,
    lastOpenedAtEpochMs: null,
    rowCountCache: 60,
    tableCount: 1,
    isScratch: true,
    ...overrides,
  };
}

export function overBudgetRefusal(): RefusalV1 {
  return {
    kind: "over-import-budget",
    fileName: "huge.csv",
    remedy: "use-larger-device",
    exceeded: "estimated-cells",
    sourceByteLength: 90_000_000,
    maxSourceByteLength: 52_428_800,
    estimatedCellCount: 900_000,
    maxEstimatedCellCount: 250_000,
  };
}

export function cleanupReceipt(
  overrides: Partial<ImportCleanupReceiptViewV1> = {},
): ImportCleanupReceiptViewV1 {
  return { reason: "import-cancelled", deletedCount: 3, completed: true, ...overrides };
}

/**
 * A one-table proposal as the worker sends it (CA-19): S02's delimited case,
 * under the keys S02 gives it (`s0`, `s0.r0`, `s0.r0.c<column>`). Written from
 * F02's shape, so a suite states its fixture in the terms the review renders.
 */
export function workbookWire(f02: ProposedAppWireV1): ProposedWorkbookWireV1 {
  const tableKey = "s0.r0";
  const columnKey = (columnIndex: number): string => `${tableKey}.c${String(columnIndex)}`;
  return {
    fileName: f02.fileName,
    isDelimited: true,
    appName: f02.appName,
    sheets: [
      {
        sheetKey: "s0",
        sheetIndex: 0,
        name: f02.fileName,
        sheetKind: "worksheet",
        visibility: "visible",
        isSelected: true,
        classification: ["table"],
        declaredRange: null,
        dateSystem: null,
        rowCount: f02.rowCount,
        usedCellCount: 0,
        formulaCellCount: 0,
        omittedRegionCount: 0,
      },
    ],
    tables: [
      {
        tableKey,
        sheetKey: "s0",
        tableName: f02.table.tableName,
        source: { kind: "region" },
        firstColumn: 0,
        lastColumn: Math.max(0, f02.table.fields.length - 1),
        headerRowIndex: f02.headerRowIndex,
        leadingRows: f02.leadingRows,
        discardedRows: f02.discardedRows,
        discardedRowCount: f02.discardedRowCount,
        rowCount: f02.rowCount,
        lastDataRowIndex: f02.rowCount === 0 ? null : (f02.headerRowIndex ?? -1) + f02.rowCount,
        joinedToTableKey: null,
        fields: f02.table.fields.map((field) => ({
          columnKey: columnKey(field.columnIndex),
          columnIndex: field.columnIndex,
          fieldName: field.fieldName,
          isNameGenerated: field.isNameGenerated,
          type: field.type,
          valueType: field.type,
          sourceFormat: field.sourceFormat,
          enumOptions: field.enumOptions,
          violations: field.violations,
          formulaText: null,
        })),
        keyColumnKey: null,
        labelColumnKey: null,
      },
    ],
    relationships: [],
    recordRules: [],
    formulas: [],
    charts: [],
    inertItems: [],
    inertCounts: {
      formula: 0,
      chart: 0,
      "pivot-table": 0,
      drawing: 0,
      image: 0,
      comment: 0,
      "external-link": 0,
      hyperlink: 0,
      "embedded-object": 0,
      "form-control": 0,
      "data-connection": 0,
      "conditional-formatting": 0,
      "cell-styling": 0,
      sparkline: 0,
      script: 0,
      "unsupported-validation": 0,
    },
    statements: f02.statements.map((statement) => {
      const targetKey =
        statement.columnIndex !== null ? columnKey(statement.columnIndex) : statement.subject === "app-name" ? null : tableKey;
      // The suite's own statement ids stand: the review projects ids unreshaped.
      return { ...statement, targetKey };
    }),
    diagnostics: f02.diagnostics,
    isRowCountExact: true,
  };
}

/** The minimum proposal shape; suites widen it where the assertion needs it. */
export function wireProposal(
  overrides: Partial<ProposedAppWireV1> = {},
): ProposedWorkbookWireV1 {
  return workbookWire({
    fileName: "field-log-messy.csv",
    appName: "Field Log Messy",
    table: { tableName: "Field Log Messy", fields: [] },
    headerRowIndex: 2,
    leadingRows: [],
    discardedRows: [],
    discardedRowCount: 0,
    rowCount: 40,
    isRowCountExact: true,
    statements: [],
    diagnostics: [],
    ...overrides,
  });
}

export interface ImportServiceCall {
  readonly name: keyof ImportServices;
  readonly input: unknown;
}

export interface FakeImportServices {
  readonly services: ImportServices;
  readonly calls: ImportServiceCall[];
  names(): string[];
  /** Pushes one parser event into whatever the machine subscribed with. */
  emit(event: ImportWorkerEventV1): void;
  terminateCount(): number;
}

type ImportOverrides = { [K in keyof ImportServices]?: ImportServices[K] };

/**
 * The one read wired by default: SCR-017 lists the library every time it is
 * shown, and an empty library is the fact a fresh device has.
 */
const IMPORT_DEFAULTS: ImportOverrides = {
  listLibrary: () => Promise.resolve({ kind: "listLibrary", apps: [] }),
};

/**
 * Every service is unwired by default and throws if called, so a machine that
 * reaches a worker it should not have reached fails loudly. `subscribe`,
 * `startImport`, `proceed`, `cancelParse` and `terminate` are always wired —
 * they are the worker lifetime the suites assert *about*.
 */
export function fakeImportServices(
  overrides: ImportOverrides = {},
): FakeImportServices {
  const calls: ImportServiceCall[] = [];
  const listeners = new Set<(event: ImportWorkerEventV1) => void>();
  let terminated = 0;

  const wrap = <K extends keyof ImportServices>(
    name: K,
  ): ImportServices[K] => {
    const implementation = overrides[name] ?? IMPORT_DEFAULTS[name] ?? notWired(name);
    return ((input: unknown) => {
      calls.push({ name, input });
      return (implementation as (value: unknown) => unknown)(input);
    }) as ImportServices[K];
  };

  const record = <K extends keyof ImportServices>(
    name: K,
    run: (input: unknown) => void,
  ): ImportServices[K] =>
    ((input: unknown) => {
      calls.push({ name, input });
      run(input);
    }) as ImportServices[K];

  return {
    services: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      startImport: record("startImport", () => undefined),
      beginStage: wrap("beginStage"),
      proceed: record("proceed", () => undefined),
      cancelParse: record("cancelParse", () => undefined),
      getStage: overrides.getStage ?? wrap("getStage"),
      runInference: wrap("runInference"),
      applyReviewEdit: wrap("applyReviewEdit"),
      promoteImport: wrap("promoteImport"),
      // A read the target screen always makes; an empty library unless a
      // suite says otherwise.
      listLibrary: wrap("listLibrary"),
      listTables: wrap("listTables"),
      cancelStage: wrap("cancelStage"),
      terminate: record("terminate", () => {
        terminated += 1;
      }),
    },
    calls,
    names(): string[] {
      return calls.map((call) => call.name);
    },
    emit(event: ImportWorkerEventV1): void {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    terminateCount(): number {
      return terminated;
    },
  };
}

/** The stage is still there. The D-04 gate reads exactly this. */
export function stagePresent(): () => Promise<GetImportStageResponseV1> {
  return () =>
    Promise.resolve({
      kind: "getImportStage",
      stage: {
        stageId: STAGE_ID,
        fileName: "field-log-messy.csv",
        status: "parsed",
        phase: "parsing",
        rowsSoFar: 40,
        batchesCommitted: 1,
        ackedBatchSeq: 0,
        factChunkCount: 1,
        hasProposal: false,
      },
    });
}

/** The stage is gone — swept, cancelled, or never. */
export function stageAbsent(): () => Promise<GetImportStageResponseV1> {
  return () => Promise.resolve({ kind: "getImportStage", stage: null });
}
