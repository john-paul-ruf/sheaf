/**
 * A hydrated projection for the records-query suites (CA-29): real SQLite
 * WASM on node, real migration 005, real recalculation.
 *
 * Jobs, eight records, one of every lane and every absent state:
 *
 * | job | Name                 | Status    | Due          | Quoted  | Paid | Urgent  | Customer         | Balance |
 * |-----|----------------------|-----------|--------------|---------|------|---------|------------------|---------|
 * | j1  | Patio lighting       | Scheduled | 20000        | 1850.00 | 925  | true    | c1 Priya Ellis   | 925.00  |
 * | j2  | Courtyard irrigation | Waiting   | 20000        | 3240    | 0    | false   | c2 Devon Moss    | 3240    |
 * | j3  | Maple pruning        | Scheduled | 20001        | 780     | 390  | true    | c1               | 390     |
 * | j4  | Bed refresh          | Done      | 20003        | 1420    | 1420 | false   | key "C-882" (invalid) | 0  |
 * | j5  | Fence planting       | Scheduled | missing      | 2900    | 0    | missing | a record nowhere | 2900    |
 * | j6  | Front walk           | Scheduled | blank        | 2120    | 1060 | false   | c2               | 1060    |
 * | j7  | Rain garden Été      | Waiting   | "next week" (invalid) | 4600 | 0 | true | c3 Avery Kim | 4600  |
 * | j8  | patio lights         | Done      | 19990        | 1850    | 0    | true    | c3               | 1850    |
 *
 * Balance is a live computed column, `[Quoted]-[Paid]`.
 */

import type { FormulaDefinitionV1 } from "../../../src/domain/formulas/ir.js";
import { sha256 } from "../../../src/crypto/hash.js";
import { asDomainId, type RecordId } from "../../../src/domain/model/ids.js";
import type { FieldDefV1 } from "../../../src/domain/model/schema.js";
import {
  BLANK_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../../src/domain/model/values.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import {
  hydrateApp,
  openProjection,
  type ProjectionCheckpointV1,
  type ProjectionHandleV1,
} from "../../../src/persistence/projection/index.js";

const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);

export const APP = asDomainId("app", bytes(1));
export const JOBS = asDomainId("table", bytes(2));
export const CUSTOMERS = asDomainId("table", bytes(3));
const GENESIS = asDomainId("commit", bytes(4));

const field = (
  fill: number,
  tableId: typeof JOBS,
  displayName: string,
  fieldOrdinal: number,
  type: FieldDefV1["type"],
  formulaFill?: number,
): FieldDefV1 => ({
  fieldId: asDomainId("field", bytes(fill)),
  tableId,
  displayName,
  fieldOrdinal,
  type,
  isRequired: false,
  isActive: true,
  schemaRevision: 1n,
  ...(formulaFill === undefined ? {} : { formulaId: asDomainId("formula", bytes(formulaFill)) }),
});

export const F = {
  name: field(0x10, JOBS, "Name", 0, { kind: "text" }),
  status: field(0x11, JOBS, "Status", 1, { kind: "enum" }),
  due: field(0x12, JOBS, "Due", 2, { kind: "date" }),
  quoted: field(0x13, JOBS, "Quoted", 3, { kind: "currency", currencyCode: "USD" }),
  paid: field(0x14, JOBS, "Paid", 4, { kind: "number" }),
  urgent: field(0x15, JOBS, "Urgent", 5, { kind: "boolean" }),
  customer: field(0x16, JOBS, "Customer", 6, { kind: "reference" }),
  balance: field(0x17, JOBS, "Balance", 7, { kind: "number" }, 0x40),
  customerName: field(0x18, CUSTOMERS, "Name", 0, { kind: "text" }),
  customerCode: field(0x19, CUSTOMERS, "Code", 1, { kind: "text" }),
} as const;

export const OPTION = {
  scheduled: asDomainId("option", bytes(0x20)),
  waiting: asDomainId("option", bytes(0x21)),
  done: asDomainId("option", bytes(0x22)),
} as const;

export const CUSTOMER = {
  c1: asDomainId("record", bytes(0x31)),
  c2: asDomainId("record", bytes(0x32)),
  c3: asDomainId("record", bytes(0x33)),
} as const;

/** A record id no table holds: a reference to it is broken. */
export const GHOST = asDomainId("record", bytes(0x3f));

export const JOB = {
  j1: asDomainId("record", bytes(0x51)),
  j2: asDomainId("record", bytes(0x52)),
  j3: asDomainId("record", bytes(0x53)),
  j4: asDomainId("record", bytes(0x54)),
  j5: asDomainId("record", bytes(0x55)),
  j6: asDomainId("record", bytes(0x56)),
  j7: asDomainId("record", bytes(0x57)),
  j8: asDomainId("record", bytes(0x58)),
} as const;

export type JobName = keyof typeof JOB;

/** `j1`…`j8` for a record id, so a result reads as the table above. */
export function jobName(recordId: Uint8Array): string {
  const entry = Object.entries(JOB).find(([, id]) => id.every((byte, index) => byte === recordId[index]));
  return entry?.[0] ?? "unknown";
}

const record = (recordId: RecordId, tableId: typeof JOBS, entries: readonly (readonly [FieldDefV1, CellValueV1])[]) => ({
  record: {
    recordId,
    tableId,
    values: new Map(entries.map(([definition, value]) => [definition.fieldId, value])),
    provenance: new Map(),
  },
  recordRevision: 0n,
  createdCommitId: GENESIS,
  updatedCommitId: GENESIS,
  issues: [],
});

const job = (
  recordId: RecordId,
  name: string,
  status: Uint8Array,
  due: CellValueV1 | null,
  quoted: string,
  paid: string,
  urgent: boolean | null,
  customer: CellValueV1,
) =>
  record(recordId, JOBS, [
    [F.name, textValue(name)],
    [F.status, enumValue(asDomainId("option", status))],
    ...(due === null ? [] : [[F.due, due] as const]),
    [F.quoted, decimalValue(quoted)],
    [F.paid, decimalValue(paid)],
    ...(urgent === null ? [] : [[F.urgent, booleanValue(urgent)] as const]),
    [F.customer, customer],
  ]);

const BALANCE: FormulaDefinitionV1 = {
  formulaId: F.balance.formulaId as NonNullable<FieldDefV1["formulaId"]>,
  target: { kind: "computed-column", tableId: JOBS, fieldId: F.balance.fieldId },
  displayName: null,
  originalText: "[Quoted]-[Paid]",
  document: {
    irVersion: 1,
    root: {
      kind: "binary",
      operator: "-",
      left: { kind: "field", fieldId: F.quoted.fieldId },
      right: { kind: "field", fieldId: F.paid.fieldId },
    },
  },
  disposition: "live",
  determinism: "deterministic",
  dependencies: [
    { kind: "field", fieldId: F.quoted.fieldId },
    { kind: "field", fieldId: F.paid.fieldId },
  ],
};

export function queryCheckpoint(): ProjectionCheckpointV1 {
  const theme = {
    themeKey: "sheaf.built-in.v1",
    tokens: {
      "app-ink": "#000",
      "app-canvas": "#fff",
      "app-surface": "#fff",
      "app-primary": "#000",
      "app-accent": "#000",
      "app-muted": "#888",
    },
  } as const;
  const table = (tableId: typeof JOBS, displayName: string, tableOrdinal: number, fields: readonly FieldDefV1[], keyFieldId: FieldDefV1["fieldId"] | null, labelFieldId: FieldDefV1["fieldId"] | null) => ({
    tableId,
    displayName,
    tableOrdinal,
    fields,
    keyFieldId,
    labelFieldId,
    sourceSheetId: null,
    isActive: true,
    schemaRevision: 1n,
  });
  const option = (optionId: typeof OPTION.done, displayLabel: string, optionOrdinal: number) => ({
    optionId,
    fieldId: F.status.fieldId,
    displayLabel,
    optionOrdinal,
    isActive: true,
    schemaRevision: 1n,
  });
  return {
    appId: APP,
    checkpointStorageId: asStorageId16(bytes(5)),
    checkpointSemanticSha256: new Uint8Array(32).fill(6),
    frontier: [{ deviceId: bytes(7), commitSequence: 1n }],
    hydratedAtMs: 1_728_000_000_000,
    appState: {
      appId: APP,
      displayName: "Fieldbook",
      createdAtMs: 0,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 0,
      theme,
      stateRevision: 1n,
    },
    sheetSnapshots: [],
    tables: [
      table(CUSTOMERS, "Customers", 0, [F.customerName, F.customerCode], F.customerCode.fieldId, F.customerName.fieldId),
      table(JOBS, "Jobs", 1, [F.name, F.status, F.due, F.quoted, F.paid, F.urgent, F.customer, F.balance], null, F.name.fieldId),
    ],
    enumOptions: [option(OPTION.scheduled, "Scheduled", 0), option(OPTION.waiting, "Waiting", 1), option(OPTION.done, "Done", 2)],
    relationships: [
      {
        relationshipId: asDomainId("relationship", bytes(0x60)),
        fromTableId: JOBS,
        fromFieldId: F.customer.fieldId,
        toTableId: CUSTOMERS,
        toKeyFieldId: F.customerCode.fieldId,
        detectionSource: "declared",
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    validationRules: [],
    formulas: [
      {
        formula: BALANCE,
        metadata: { catalogVersion: 1, functionVersions: [], source: "authored", importedValuePolicy: "none" },
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    inertItems: [],
    importLineages: [],
    inferenceDecisions: [],
    recordPages: [
      {
        records: [
          record(CUSTOMER.c1, CUSTOMERS, [[F.customerName, textValue("Priya Ellis")], [F.customerCode, textValue("C-104")]]),
          record(CUSTOMER.c2, CUSTOMERS, [[F.customerName, textValue("Devon Moss")], [F.customerCode, textValue("C-211")]]),
          record(CUSTOMER.c3, CUSTOMERS, [[F.customerName, textValue("Avery Kim")], [F.customerCode, textValue("C-305")]]),
        ],
      },
      {
        records: [
          job(JOB.j1, "Patio lighting", OPTION.scheduled, dateValue(20_000), "1850.00", "925", true, referenceValue(CUSTOMER.c1)),
          job(JOB.j2, "Courtyard irrigation", OPTION.waiting, dateValue(20_000), "3240", "0", false, referenceValue(CUSTOMER.c2)),
          job(JOB.j3, "Maple pruning", OPTION.scheduled, dateValue(20_001), "780", "390", true, referenceValue(CUSTOMER.c1)),
          job(JOB.j4, "Bed refresh", OPTION.done, dateValue(20_003), "1420", "1420", false, invalidPreservedValue("C-882")),
          job(JOB.j5, "Fence planting", OPTION.scheduled, null, "2900", "0", null, referenceValue(GHOST)),
          job(JOB.j6, "Front walk", OPTION.scheduled, BLANK_VALUE, "2120", "1060", false, referenceValue(CUSTOMER.c2)),
          job(JOB.j7, "Rain garden Été", OPTION.waiting, invalidPreservedValue("next week"), "4600", "0", true, referenceValue(CUSTOMER.c3)),
          job(JOB.j8, "patio lights", OPTION.done, dateValue(19_990), "1850", "0", true, referenceValue(CUSTOMER.c3)),
        ],
      },
    ],
  };
}

export async function openQueryProjection(): Promise<ProjectionHandleV1> {
  const handle = await openProjection({
    sha256,
    clock: () => ({ epochDay: 20_000, epochMs: 1_728_000_000_000 }),
  });
  await hydrateApp(handle, queryCheckpoint());
  return handle;
}
