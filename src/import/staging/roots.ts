/**
 * The durable roots promotion writes (M23; CA-11; D21/D29).
 *
 * `AppHeadV1`, its checkpoint manifest, and the pages they name are format
 * law, not feature scope: the head's obligations in database.md § `AppHeadV1`
 * are complete or the app is not well-formed. So every root this file encodes
 * is present at promotion, including the ones F02 has nothing to put in —
 * conflict and audit pages are written as **explicitly empty** rather than
 * omitted, because "no conflicts" and "this app has no conflict root" are
 * different claims and only one of them is true.
 *
 * **Page order and caps are the contract.** Records are sorted by
 * `(TableId, RecordId)` and a page holds at most
 * {@link RECORD_PAGE_MAX_RECORDS} of them or
 * {@link PAGE_MAX_DECODED_BYTES} decoded bytes, whichever comes first
 * (database.md § Checkpoint and page boundaries). The manifest records each
 * page's first and last key, its decoded count, and its semantic hash, so a
 * reader can tell a truncated page from a short one.
 *
 * **The theme is a root, not a default.** `app_state.theme_cbor` is NOT NULL
 * in migration 005, so hydration structurally requires the fact; a projection
 * that invented a palette would be showing a colour nobody authored (D29).
 *
 * **The checkpoint manifest has three readable shapes (D37).** F03 added the
 * workbook roots — relationships, validation rules, inert items, inference
 * decisions, import lineages, and each sheet's classification and snapshot
 * revision — as payload evolution inside the encrypted envelope, not as a new
 * version; F04 added the `formulas` root (CA-25) and then the `charts` root
 * (CA-30) the same way. The encoder always writes the full F04 key set. The
 * decoder accepts exactly the F02 key set (and fills the F02-true defaults:
 * every list empty, each sheet `["table"]` at the manifest's schema
 * revision), exactly the F03 key set (no formulas), exactly the F03 key set
 * plus `formulas` (no charts), or exactly the full F04 key set; any other key
 * set is a `CodecError`. So every
 * GATE-F02 and GATE-F03 app keeps opening, and a manifest with a stray or
 * missing key still does not.
 *
 * Rules decode at IR v1 or v2 (CA-27), and a field definition carries
 * `formulaId` only when it is computed (D51).
 */

import { CodecError } from "../../domain/model/errors.js";
import { compareDomainIds } from "../../domain/model/ids.js";
import type {
  AppId,
  FieldId,
  OptionId,
  RecordId,
  SheetId,
  TableId,
} from "../../domain/model/ids.js";
import type { AppThemeV1, ChartProvenanceV1, FormulaMetadataV1 } from "../../domain/model/events.js";
import {
  CHART_PROVENANCES,
  FORMULA_IMPORTED_VALUE_POLICIES,
  FORMULA_SOURCES,
  INFERENCE_DISPOSITIONS,
} from "../../domain/model/events.js";
import {
  CATALOG_FUNCTION_NAMES,
  FORMULA_DEPENDENCY_KINDS,
  FORMULA_DETERMINISMS,
  FORMULA_DISPOSITIONS,
  FORMULA_ERROR_CODES,
  FORMULA_TARGET_KINDS,
  IR_BINARY_OPERATORS,
  MAX_EVALUATION_DEPTH,
  isAllowedClassification,
  type FormulaDefinitionV1,
  type FormulaDependencyV1,
  type FormulaErrorLiteralV1,
  type FormulaIRDocumentV1,
  type FormulaIRV1,
  type FormulaLiteralV1,
  type FormulaTargetV1,
} from "../../domain/formulas/index.js";
import {
  CHART_TYPES,
  DATE_GROUPING_UNITS,
  type ChartDefinitionV1,
  type GroupingV1,
  type MeasureV1,
} from "../../domain/model/charts.js";
import type { FilterOperandV1, FilterV1 } from "../../domain/model/filters.js";
import type {
  ChartId,
  CommitId,
  DecisionId,
  EventId,
  FormulaId,
  InertItemId,
  LineageId,
  RelationshipId,
  RuleId,
} from "../../domain/model/ids.js";
import {
  RELATIONSHIP_DETECTION_SOURCES,
  type EnumOptionDefV1,
  type FieldDefV1,
  type RelationshipDefV1,
  type TableDefV1,
} from "../../domain/model/schema.js";
import {
  DECISION_KINDS,
  IMPORT_KINDS,
  INERT_ITEM_KINDS,
  INERT_REASON_KEYS,
  SHEET_CLASSIFICATIONS,
  type CellRangeV1,
  type ImportLineageV1,
  type InertItemV1,
  type InferenceDecisionRecordV1,
  type SheetDescriptorV1,
} from "../../domain/model/snapshots.js";
import {
  COMPARE_OPERATORS,
  VALIDATION_SEVERITIES,
  type MessageParameterV1,
  type RuleConditionV1,
  type RuleConditionV2,
  type ValidationRuleIR,
  type ValidationRuleIRV2,
} from "../../domain/validation/rules.js";
import {
  MAX_EPOCH_DAY,
  MIN_EPOCH_DAY,
  type CellValueV1,
} from "../../domain/model/values.js";
import type { FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedKey,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import {
  asMap,
  boolean,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  optionalText,
  field,
  integer,
  integerOrNull,
  list,
  nfcText,
  oneOf,
  optionalCount,
  text,
} from "./proposal-codec.js";
import { decodeChunkRef, encodeChunkRef, type ManifestChunkRefV1 } from "../snapshots/source-chunks.js";

const ID_BYTES = 16;
const SHA256_BYTES = 32;
const VERSION = 1;

/** database.md: at most 1,024 live records per record page. */
export const RECORD_PAGE_MAX_RECORDS = 1_024;

/** database.md: at most 512 KiB decoded CBOR per page. */
export const PAGE_MAX_DECODED_BYTES = 524_288;

// ------------------------------------------------------------- cell values --

export function encodeCellValue(value: CellValueV1): CborValue {
  switch (value.kind) {
    case "text":
      return cborMap([["kind", "text"], ["text", value.text]]);
    case "decimal":
      return cborMap([["kind", "decimal"], ["decimal", value.decimal]]);
    case "date":
      return cborMap([["kind", "date"], ["epochDay", value.epochDay]]);
    case "boolean":
      return cborMap([["kind", "boolean"], ["boolean", value.boolean]]);
    case "enum":
      return cborMap([["kind", "enum"], ["optionId", value.optionId]]);
    case "reference":
      return cborMap([["kind", "reference"], ["recordId", value.recordId]]);
    case "missing":
      return cborMap([["kind", "missing"]]);
    case "blank":
      return cborMap([["kind", "blank"]]);
    case "invalid-preserved":
      return cborMap([
        ["kind", "invalid-preserved"],
        ["sourceText", value.sourceText],
      ]);
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

const CELL_KINDS = Object.freeze([
  "text",
  "decimal",
  "date",
  "boolean",
  "enum",
  "reference",
  "missing",
  "blank",
  "invalid-preserved",
] as const);

/**
 * Epoch days are **signed** — a date before 1970-01-01 is an ordinary date, and
 * canonical CBOR writes its negative integer faithfully. Reading it back with
 * the nonnegative reader would make every pre-1970 date a page this decoder
 * wrote and cannot open, so the signed reader is used and the range is the same
 * one `dateValue()` enforces (`values.ts`): what the domain refuses to author,
 * the decoder refuses to admit.
 */
const epochDay = (value: DecodedValue): number => {
  const decoded = integer(value, "an epoch day");
  if (decoded < MIN_EPOCH_DAY || decoded > MAX_EPOCH_DAY) {
    throw new CodecError("an epoch day is outside the representable range");
  }
  return decoded;
};

export function decodeCellValue(value: DecodedValue): CellValueV1 {
  const map = asMap(value, "a cell value");
  const kind = oneOf(field(map, "kind"), CELL_KINDS, "a cell value kind");

  switch (kind) {
    case "text":
      return { kind, text: nfcText(field(map, "text"), "cell text") };
    case "decimal":
      return { kind, decimal: text(field(map, "decimal"), "a decimal") };
    case "date":
      return { kind, epochDay: epochDay(field(map, "epochDay")) };
    case "boolean":
      return { kind, boolean: boolean(field(map, "boolean"), "a boolean") };
    case "enum":
      return {
        kind,
        optionId: bytesOfLength(
          field(map, "optionId"),
          ID_BYTES,
          "an option id",
        ) as OptionId,
      };
    case "reference":
      return {
        kind,
        recordId: bytesOfLength(
          field(map, "recordId"),
          ID_BYTES,
          "a record id",
        ) as RecordId,
      };
    case "missing":
    case "blank":
      return { kind };
    case "invalid-preserved":
      return {
        kind,
        sourceText: nfcText(field(map, "sourceText"), "preserved source text"),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

// ------------------------------------------------------------------- schema --

const FIELD_TYPE_KINDS = Object.freeze([
  "date",
  "currency",
  "number",
  "phone",
  "email",
  "url",
  "address",
  "boolean",
  "enum",
  "text",
  "reference",
] as const);

const FIELD_DEF_KEYS = Object.freeze([
  "fieldId",
  "tableId",
  "displayName",
  "fieldOrdinal",
  "type",
  "isRequired",
  "isActive",
  "schemaRevision",
] as const);

/**
 * A field definition. `formulaId` (D51) is written only for a computed field,
 * so an authored field's bytes are exactly the F02/F03 bytes; the decoder
 * accepts exactly those two key sets.
 */
export const encodeFieldDef = (definition: FieldDefV1): CborValue =>
  cborMap([
    ["fieldId", definition.fieldId],
    ["tableId", definition.tableId],
    ["displayName", definition.displayName],
    ["fieldOrdinal", definition.fieldOrdinal],
    [
      "type",
      definition.type.kind === "currency"
        ? cborMap([
            ["kind", "currency"],
            ["currencyCode", definition.type.currencyCode],
          ])
        : cborMap([["kind", definition.type.kind]]),
    ],
    ["isRequired", definition.isRequired],
    ["isActive", definition.isActive],
    ["schemaRevision", definition.schemaRevision],
    ...(definition.formulaId === undefined
      ? []
      : [["formulaId", definition.formulaId] as const]),
  ]);

export const decodeFieldDef = (value: DecodedValue): FieldDefV1 => {
  const raw = asMap(value, "a field definition");
  const isComputed = raw.has("formulaId");
  const map = exactKeys(
    raw,
    isComputed ? [...FIELD_DEF_KEYS, "formulaId"] : [...FIELD_DEF_KEYS],
    "a field definition",
  );
  const typeMap = asMap(field(map, "type"), "a field type");
  const kind = oneOf(field(typeMap, "kind"), FIELD_TYPE_KINDS, "a field type");

  return {
    fieldId: bytesOfLength(field(map, "fieldId"), ID_BYTES, "a field id") as FieldId,
    tableId: bytesOfLength(field(map, "tableId"), ID_BYTES, "a table id") as TableId,
    displayName: nfcText(field(map, "displayName"), "a field name"),
    fieldOrdinal: count(field(map, "fieldOrdinal"), "a field ordinal"),
    type:
      kind === "currency"
        ? {
            kind,
            currencyCode: text(field(typeMap, "currencyCode"), "a currency code"),
          }
        : { kind },
    isRequired: boolean(field(map, "isRequired"), "a required flag"),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
    ...(isComputed
      ? { formulaId: bytesOfLength(field(map, "formulaId"), ID_BYTES, "a formula id") as FormulaId }
      : {}),
  };
};

export const encodeTableDef = (table: TableDefV1): CborValue =>
  cborMap([
    ["tableId", table.tableId],
    ["displayName", table.displayName],
    ["tableOrdinal", table.tableOrdinal],
    ["fields", table.fields.map(encodeFieldDef)],
    ["keyFieldId", table.keyFieldId],
    ["labelFieldId", table.labelFieldId],
    ["sourceSheetId", table.sourceSheetId],
    ["isActive", table.isActive],
    ["schemaRevision", table.schemaRevision],
  ]);

const optionalId = <T>(value: DecodedValue, what: string): T | null =>
  value === null ? null : (bytesOfLength(value, ID_BYTES, what) as T);

export const decodeTableDef = (value: DecodedValue): TableDefV1 => {
  const map = exactKeys(
    asMap(value, "a table definition"),
    [
      "tableId",
      "displayName",
      "tableOrdinal",
      "fields",
      "keyFieldId",
      "labelFieldId",
      "sourceSheetId",
      "isActive",
      "schemaRevision",
    ],
    "a table definition",
  );
  return {
    tableId: bytesOfLength(field(map, "tableId"), ID_BYTES, "a table id") as TableId,
    displayName: nfcText(field(map, "displayName"), "a table name"),
    tableOrdinal: count(field(map, "tableOrdinal"), "a table ordinal"),
    fields: list(field(map, "fields"), "table fields").map(decodeFieldDef),
    keyFieldId: optionalId<FieldId>(field(map, "keyFieldId"), "a key field id"),
    labelFieldId: optionalId<FieldId>(field(map, "labelFieldId"), "a label field id"),
    sourceSheetId: optionalId<SheetId>(field(map, "sourceSheetId"), "a sheet id"),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
  };
};

export const encodeEnumOption = (option: EnumOptionDefV1): CborValue =>
  cborMap([
    ["optionId", option.optionId],
    ["fieldId", option.fieldId],
    ["displayLabel", option.displayLabel],
    ["optionOrdinal", option.optionOrdinal],
    ["isActive", option.isActive],
    ["schemaRevision", option.schemaRevision],
  ]);

export const decodeEnumOption = (value: DecodedValue): EnumOptionDefV1 => {
  const map = exactKeys(
    asMap(value, "an enum option"),
    [
      "optionId",
      "fieldId",
      "displayLabel",
      "optionOrdinal",
      "isActive",
      "schemaRevision",
    ],
    "an enum option",
  );
  return {
    optionId: bytesOfLength(field(map, "optionId"), ID_BYTES, "an option id") as OptionId,
    fieldId: bytesOfLength(field(map, "fieldId"), ID_BYTES, "a field id") as FieldId,
    displayLabel: nfcText(field(map, "displayLabel"), "an option label"),
    optionOrdinal: count(field(map, "optionOrdinal"), "an option ordinal"),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
  };
};

// -------------------------------------------------------------- app state --

/** The `app_state` root, theme included (D29). */
export interface AppStateRootV1 {
  readonly appId: AppId;
  readonly displayName: string;
  readonly createdAtMs: number;
  readonly lastOpenedAtMs: number | null;
  readonly schemaRevision: bigint;
  readonly locality: "present" | "oversized-local";
  readonly durableHomeId: Uint8Array | null;
  readonly lastSuccessfulBackupMs: number | null;
  readonly deviceOnlyChangeCount: number;
  readonly theme: AppThemeV1;
  readonly stateRevision: bigint;
}

const APP_THEME_TOKENS = Object.freeze([
  "app-ink",
  "app-canvas",
  "app-surface",
  "app-primary",
  "app-accent",
  "app-muted",
] as const);

export const encodeAppTheme = (theme: AppThemeV1): CborValue =>
  cborMap([
    ["themeKey", theme.themeKey],
    [
      "tokens",
      cborMap(APP_THEME_TOKENS.map((token) => [token, theme.tokens[token]])),
    ],
  ]);

export const decodeAppTheme = (value: DecodedValue): AppThemeV1 => {
  const map = exactKeys(
    asMap(value, "a theme"),
    ["themeKey", "tokens"],
    "a theme",
  );
  const tokens = exactKeys(
    asMap(field(map, "tokens"), "theme tokens"),
    [...APP_THEME_TOKENS],
    "theme tokens",
  );
  return {
    themeKey: text(field(map, "themeKey"), "a theme key"),
    tokens: Object.fromEntries(
      APP_THEME_TOKENS.map((token) => [
        token,
        text(field(tokens, token), "a theme token"),
      ]),
    ) as AppThemeV1["tokens"],
  };
};

const encodeAppState = (state: AppStateRootV1): CborValue =>
  cborMap([
    ["appId", state.appId],
    ["displayName", state.displayName],
    ["createdAtMs", state.createdAtMs],
    ["lastOpenedAtMs", integerOrNull(state.lastOpenedAtMs)],
    ["schemaRevision", state.schemaRevision],
    ["locality", state.locality],
    ["durableHomeId", state.durableHomeId],
    ["lastSuccessfulBackupMs", integerOrNull(state.lastSuccessfulBackupMs)],
    ["deviceOnlyChangeCount", state.deviceOnlyChangeCount],
    ["theme", encodeAppTheme(state.theme)],
    ["stateRevision", state.stateRevision],
  ]);

const decodeAppState = (value: DecodedValue): AppStateRootV1 => {
  const map = exactKeys(
    asMap(value, "app state"),
    [
      "appId",
      "displayName",
      "createdAtMs",
      "lastOpenedAtMs",
      "schemaRevision",
      "locality",
      "durableHomeId",
      "lastSuccessfulBackupMs",
      "deviceOnlyChangeCount",
      "theme",
      "stateRevision",
    ],
    "app state",
  );
  return {
    appId: bytesOfLength(field(map, "appId"), ID_BYTES, "an app id") as AppId,
    displayName: nfcText(field(map, "displayName"), "an app name"),
    createdAtMs: count(field(map, "createdAtMs"), "a creation time"),
    lastOpenedAtMs: optionalCount(field(map, "lastOpenedAtMs"), "a last-opened time"),
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
    locality: oneOf(
      field(map, "locality"),
      ["present", "oversized-local"] as const,
      "an app locality",
    ),
    durableHomeId: optionalId<Uint8Array>(field(map, "durableHomeId"), "a home id"),
    lastSuccessfulBackupMs: optionalCount(
      field(map, "lastSuccessfulBackupMs"),
      "a backup time",
    ),
    deviceOnlyChangeCount: count(
      field(map, "deviceOnlyChangeCount"),
      "a device-only change count",
    ),
    theme: decodeAppTheme(field(map, "theme")),
    stateRevision: BigInt(count(field(map, "stateRevision"), "a state revision")),
  };
};

// -------------------------------------------------------------- record page --

export interface RecordIssueV1 {
  readonly fieldId: FieldId | null;
  readonly kind: string;
  readonly severity: "warning" | "blocking";
  readonly messageKey: string;
}

export interface StoredRecordV1 {
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly values: readonly { readonly fieldId: FieldId; readonly value: CellValueV1 }[];
  readonly issues: readonly RecordIssueV1[];
}

export interface RecordPageV1 {
  readonly pageVersion: typeof VERSION;
  readonly records: readonly StoredRecordV1[];
}

/** `(TableId, RecordId)` bytewise — the sort every record page is stored in. */
export function compareRecordKeys(left: StoredRecordV1, right: StoredRecordV1): number {
  const byTable = compareDomainIds(left.tableId, right.tableId);
  return byTable === 0 ? compareDomainIds(left.recordId, right.recordId) : byTable;
}

const encodeIssue = (issue: RecordIssueV1): CborValue =>
  cborMap([
    ["fieldId", issue.fieldId],
    ["kind", issue.kind],
    ["severity", issue.severity],
    ["messageKey", issue.messageKey],
  ]);

const decodeIssue = (value: DecodedValue): RecordIssueV1 => {
  const map = exactKeys(
    asMap(value, "a record issue"),
    ["fieldId", "kind", "severity", "messageKey"],
    "a record issue",
  );
  return {
    fieldId: optionalId<FieldId>(field(map, "fieldId"), "a field id"),
    kind: text(field(map, "kind"), "an issue kind"),
    severity: oneOf(
      field(map, "severity"),
      ["warning", "blocking"] as const,
      "an issue severity",
    ),
    messageKey: text(field(map, "messageKey"), "a message key"),
  };
};

const encodeRecord = (record: StoredRecordV1): CborValue =>
  cborMap([
    ["recordId", record.recordId],
    ["tableId", record.tableId],
    [
      "values",
      record.values.map((entry) =>
        cborMap([
          ["fieldId", entry.fieldId],
          ["value", encodeCellValue(entry.value)],
        ]),
      ),
    ],
    ["issues", record.issues.map(encodeIssue)],
  ]);

const decodeRecord = (value: DecodedValue): StoredRecordV1 => {
  const map = exactKeys(
    asMap(value, "a record"),
    ["recordId", "tableId", "values", "issues"],
    "a record",
  );
  return {
    recordId: bytesOfLength(field(map, "recordId"), ID_BYTES, "a record id") as RecordId,
    tableId: bytesOfLength(field(map, "tableId"), ID_BYTES, "a table id") as TableId,
    values: list(field(map, "values"), "record values").map((entry) => {
      const cell = exactKeys(
        asMap(entry, "a record value"),
        ["fieldId", "value"],
        "a record value",
      );
      return {
        fieldId: bytesOfLength(field(cell, "fieldId"), ID_BYTES, "a field id") as FieldId,
        value: decodeCellValue(field(cell, "value")),
      };
    }),
    issues: list(field(map, "issues"), "record issues").map(decodeIssue),
  };
};

/**
 * The decoded bytes one record adds to a record page: its own canonical
 * encoding, exactly as it sits inside the page's `records` array. Lets a
 * writer fill pages to the cap by measuring each record once.
 */
export const recordPageEntryByteLength = (record: StoredRecordV1): number =>
  encodeCanonical(encodeRecord(record)).byteLength;

export function encodeRecordPage(page: RecordPageV1): Uint8Array {
  if (page.records.length > RECORD_PAGE_MAX_RECORDS) {
    throw new CodecError("a record page exceeds 1,024 records");
  }
  for (let index = 1; index < page.records.length; index += 1) {
    if (
      compareRecordKeys(
        page.records[index - 1] as StoredRecordV1,
        page.records[index] as StoredRecordV1,
      ) >= 0
    ) {
      throw new CodecError("record page is not sorted by (tableId, recordId)");
    }
  }

  const bytes = encodeCanonical(
    cborMap([
      ["pageVersion", page.pageVersion],
      ["records", page.records.map(encodeRecord)],
    ]),
  );
  if (bytes.byteLength > PAGE_MAX_DECODED_BYTES) {
    throw new CodecError("a record page exceeds the 512 KiB decoded cap");
  }
  return bytes;
}

export function decodeRecordPage(payload: Uint8Array): RecordPageV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a record page"),
    ["pageVersion", "records"],
    "a record page",
  );
  if (count(field(map, "pageVersion"), "a page version") !== VERSION) {
    throw new CodecError("record page declares an unsupported version");
  }
  return {
    pageVersion: VERSION,
    records: list(field(map, "records"), "page records").map(decodeRecord),
  };
}

// ------------------------------------------------------------ baseline page --

/**
 * The original-import baseline: the row exactly as this import accepted it.
 * F06's re-upload compares against it, so it is written now even though
 * nothing in F02 reads it — a baseline that only appears when it is first
 * needed is a baseline that does not exist.
 */
export interface BaselineEntryV1 {
  readonly tableId: TableId;
  readonly recordId: RecordId;
  readonly state: "present" | "deleted" | "absent";
  readonly values: readonly { readonly fieldId: FieldId; readonly value: CellValueV1 }[];
}

export interface BaselinePageV1 {
  readonly pageVersion: typeof VERSION;
  readonly scopeId: Uint8Array;
  readonly entries: readonly BaselineEntryV1[];
}

const encodeBaselineEntry = (entry: BaselineEntryV1): CborValue =>
  cborMap([
    ["tableId", entry.tableId],
    ["recordId", entry.recordId],
    ["state", entry.state],
    [
      "values",
      entry.values.map((value) =>
        cborMap([
          ["fieldId", value.fieldId],
          ["value", encodeCellValue(value.value)],
        ]),
      ),
    ],
  ]);

/** The decoded bytes one entry adds to a baseline page, as {@link recordPageEntryByteLength} for records. */
export const baselinePageEntryByteLength = (entry: BaselineEntryV1): number =>
  encodeCanonical(encodeBaselineEntry(entry)).byteLength;

export function encodeBaselinePage(page: BaselinePageV1): Uint8Array {
  const bytes = encodeCanonical(
    cborMap([
      ["pageVersion", page.pageVersion],
      ["scopeId", page.scopeId],
      ["entries", page.entries.map(encodeBaselineEntry)],
    ]),
  );
  if (bytes.byteLength > PAGE_MAX_DECODED_BYTES) {
    throw new CodecError("a baseline page exceeds the 512 KiB decoded cap");
  }
  return bytes;
}

export function decodeBaselinePage(payload: Uint8Array): BaselinePageV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a baseline page"),
    ["pageVersion", "scopeId", "entries"],
    "a baseline page",
  );
  if (count(field(map, "pageVersion"), "a page version") !== VERSION) {
    throw new CodecError("baseline page declares an unsupported version");
  }
  return {
    pageVersion: VERSION,
    scopeId: bytesOfLength(field(map, "scopeId"), ID_BYTES, "a baseline scope id"),
    entries: list(field(map, "entries"), "baseline entries").map((value) => {
      const entry = exactKeys(
        asMap(value, "a baseline entry"),
        ["tableId", "recordId", "state", "values"],
        "a baseline entry",
      );
      return {
        tableId: bytesOfLength(field(entry, "tableId"), ID_BYTES, "a table id") as TableId,
        recordId: bytesOfLength(
          field(entry, "recordId"),
          ID_BYTES,
          "a record id",
        ) as RecordId,
        state: oneOf(
          field(entry, "state"),
          ["present", "deleted", "absent"] as const,
          "a baseline state",
        ),
        values: list(field(entry, "values"), "baseline values").map((item) => {
          const cell = exactKeys(
            asMap(item, "a baseline value"),
            ["fieldId", "value"],
            "a baseline value",
          );
          return {
            fieldId: bytesOfLength(
              field(cell, "fieldId"),
              ID_BYTES,
              "a field id",
            ) as FieldId,
            value: decodeCellValue(field(cell, "value")),
          };
        }),
      };
    }),
  };
}

// ------------------------------------------------------- checkpoint manifest --

export interface PageRefV1 {
  readonly storageId: string;
  readonly firstKey: Uint8Array | null;
  readonly lastKey: Uint8Array | null;
  readonly decodedCount: number;
  readonly decodedByteLength: number;
  readonly semanticSha256: Uint8Array;
}

/** One sheet as a checkpoint lists it; the F03 fields are defaulted for F02. */
export type CheckpointSheetV1 = Omit<
  SheetDescriptorV1,
  "classification" | "snapshotRevision"
> & {
  readonly classification?: SheetDescriptorV1["classification"];
  readonly snapshotRevision?: bigint;
};

/**
 * A table's record-level rule, as the checkpoint carries it and the
 * projection's `validation_rules` row holds it.
 */
export interface CheckpointValidationRuleV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  /** IR v1 or v2 (CA-27); v1 bytes keep decoding unchanged. */
  readonly rule: ValidationRuleIR | ValidationRuleIRV2;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

/**
 * The checkpoint manifest. The F03 roots are optional **only for a writer** that
 * predates them (F02 promotion): the encoder writes each absent one as its
 * F02-true default, and {@link decodeCheckpointManifest} always returns every
 * one of them — see {@link ResolvedCheckpointManifestV1}.
 */
export interface CheckpointManifestV1 {
  readonly manifestVersion: typeof VERSION;
  readonly appId: AppId;
  readonly schemaRevision: bigint;
  readonly frontier: readonly FrontierEntryV1[];
  readonly appState: AppStateRootV1;
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly sheetSnapshots: readonly CheckpointSheetV1[];
  readonly relationships?: readonly RelationshipDefV1[];
  readonly validationRules?: readonly CheckpointValidationRuleV1[];
  readonly inertItems?: readonly InertItemV1[];
  readonly inferenceDecisions?: readonly InferenceDecisionRecordV1[];
  readonly importLineages?: readonly ImportLineageV1[];
  /** F04 (CA-25): every formula definition, active or removed; absent before F04. */
  readonly formulas?: readonly CheckpointFormulaV1[];
  /** F04 (CA-30): every live chart, imported or made here; absent before charts. */
  readonly charts?: readonly CheckpointChartV1[];
  readonly recordPages: readonly PageRefV1[];
  readonly semanticSha256: Uint8Array;
}

/** A manifest with every root present; what the decoder returns. */
export interface ResolvedCheckpointManifestV1 extends CheckpointManifestV1 {
  readonly sheetSnapshots: readonly SheetDescriptorV1[];
  readonly relationships: readonly RelationshipDefV1[];
  readonly validationRules: readonly CheckpointValidationRuleV1[];
  readonly inertItems: readonly InertItemV1[];
  readonly inferenceDecisions: readonly InferenceDecisionRecordV1[];
  readonly importLineages: readonly ImportLineageV1[];
  readonly formulas: readonly CheckpointFormulaV1[];
  readonly charts: readonly CheckpointChartV1[];
}

/**
 * Fills the F03 roots a manifest does not state with their F02-true defaults:
 * no relationships, rules, inert items, decisions, or lineages, and each sheet
 * a single `table` at the manifest's schema revision — which is exactly what a
 * delimited import is. The one place those defaults are written down.
 */
export function resolveCheckpointManifest<
  M extends Omit<CheckpointManifestV1, "semanticSha256">,
>(
  manifest: M,
): M & Omit<ResolvedCheckpointManifestV1, "semanticSha256"> {
  return {
    ...manifest,
    sheetSnapshots: manifest.sheetSnapshots.map((sheet) => ({
      ...sheet,
      classification: sheet.classification ?? ["table"],
      snapshotRevision: sheet.snapshotRevision ?? manifest.schemaRevision,
    })),
    relationships: manifest.relationships ?? [],
    validationRules: manifest.validationRules ?? [],
    inertItems: manifest.inertItems ?? [],
    inferenceDecisions: manifest.inferenceDecisions ?? [],
    importLineages: manifest.importLineages ?? [],
    // F02/F03 checkpoints hold no formula: an app before F04 had none live.
    formulas: manifest.formulas ?? [],
    // No app before S05 could hold a chart (D50: F03 charts stayed inert).
    charts: manifest.charts ?? [],
  };
}

const encodePageRef = (page: PageRefV1): CborValue =>
  cborMap([
    ["storageId", page.storageId],
    ["firstKey", page.firstKey],
    ["lastKey", page.lastKey],
    ["decodedCount", page.decodedCount],
    ["decodedByteLength", page.decodedByteLength],
    ["semanticSha256", page.semanticSha256],
  ]);

const decodePageRef = (value: DecodedValue): PageRefV1 => {
  const map = exactKeys(
    asMap(value, "a page ref"),
    [
      "storageId",
      "firstKey",
      "lastKey",
      "decodedCount",
      "decodedByteLength",
      "semanticSha256",
    ],
    "a page ref",
  );
  const first = field(map, "firstKey");
  const last = field(map, "lastKey");
  return {
    storageId: text(field(map, "storageId"), "a page storage id"),
    firstKey: first === null ? null : bytesOfLength(first, ID_BYTES * 2, "a page key"),
    lastKey: last === null ? null : bytesOfLength(last, ID_BYTES * 2, "a page key"),
    decodedCount: count(field(map, "decodedCount"), "a page count"),
    decodedByteLength: count(field(map, "decodedByteLength"), "a page length"),
    semanticSha256: bytesOfLength(
      field(map, "semanticSha256"),
      SHA256_BYTES,
      "a page digest",
    ),
  };
};

const encodeFrontier = (frontier: readonly FrontierEntryV1[]): CborValue =>
  frontier.map((entry) =>
    cborMap([
      ["commitSequence", entry.commitSequence],
      ["deviceId", entry.deviceId],
    ]),
  );

const decodeFrontier = (value: DecodedValue): readonly FrontierEntryV1[] =>
  list(value, "a frontier").map((item) => {
    const map = exactKeys(
      asMap(item, "a frontier entry"),
      ["commitSequence", "deviceId"],
      "a frontier entry",
    );
    return {
      commitSequence: BigInt(count(field(map, "commitSequence"), "a sequence")),
      deviceId: bytesOfLength(field(map, "deviceId"), ID_BYTES, "a device id"),
    };
  });

// ----------------------------------------------------- workbook roots (D37) --

export const encodeCellRange = (range: CellRangeV1): CborValue =>
  cborMap([
    ["firstRow", range.firstRow],
    ["firstColumn", range.firstColumn],
    ["lastRow", range.lastRow],
    ["lastColumn", range.lastColumn],
  ]);

/** A range whose last corner precedes its first is refused, not reordered. */
export const decodeCellRange = (value: DecodedValue): CellRangeV1 => {
  const map = exactKeys(
    asMap(value, "a cell range"),
    ["firstRow", "firstColumn", "lastRow", "lastColumn"],
    "a cell range",
  );
  const range = {
    firstRow: count(field(map, "firstRow"), "a first row"),
    firstColumn: count(field(map, "firstColumn"), "a first column"),
    lastRow: count(field(map, "lastRow"), "a last row"),
    lastColumn: count(field(map, "lastColumn"), "a last column"),
  };
  if (range.lastRow < range.firstRow || range.lastColumn < range.firstColumn) {
    throw new CodecError("a cell range ends before it starts");
  }
  return range;
};

const id16 = <T>(value: DecodedValue, what: string): T =>
  bytesOfLength(value, ID_BYTES, what) as T;

const revision = (value: DecodedValue, what: string): bigint =>
  BigInt(count(value, what));

export const encodeRelationship = (relationship: RelationshipDefV1): CborValue =>
  cborMap([
    ["relationshipId", relationship.relationshipId],
    ["fromTableId", relationship.fromTableId],
    ["fromFieldId", relationship.fromFieldId],
    ["toTableId", relationship.toTableId],
    ["toKeyFieldId", relationship.toKeyFieldId],
    ["detectionSource", relationship.detectionSource],
    ["isActive", relationship.isActive],
    ["schemaRevision", relationship.schemaRevision],
  ]);

export const decodeRelationship = (value: DecodedValue): RelationshipDefV1 => {
  const map = exactKeys(
    asMap(value, "a relationship"),
    [
      "relationshipId",
      "fromTableId",
      "fromFieldId",
      "toTableId",
      "toKeyFieldId",
      "detectionSource",
      "isActive",
      "schemaRevision",
    ],
    "a relationship",
  );
  return {
    relationshipId: id16<RelationshipId>(field(map, "relationshipId"), "a relationship id"),
    fromTableId: id16<TableId>(field(map, "fromTableId"), "a table id"),
    fromFieldId: id16<FieldId>(field(map, "fromFieldId"), "a field id"),
    toTableId: id16<TableId>(field(map, "toTableId"), "a table id"),
    toKeyFieldId: id16<FieldId>(field(map, "toKeyFieldId"), "a field id"),
    detectionSource: oneOf(
      field(map, "detectionSource"),
      RELATIONSHIP_DETECTION_SOURCES,
      "a detection source",
    ),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: revision(field(map, "schemaRevision"), "a schema revision"),
  };
};

const encodeCondition = (condition: RuleConditionV2): CborValue => {
  switch (condition.kind) {
    case "field-present":
    case "field-absent":
      return cborMap([
        ["kind", condition.kind],
        ["fieldId", condition.fieldId],
      ]);
    case "field-equals":
      return cborMap([
        ["kind", condition.kind],
        ["fieldId", condition.fieldId],
        ["value", encodeCellValue(condition.value)],
      ]);
    case "all":
    case "any":
      return cborMap([
        ["kind", condition.kind],
        ["conditions", condition.conditions.map(encodeCondition)],
      ]);
    case "not":
      return cborMap([
        ["kind", condition.kind],
        ["condition", encodeCondition(condition.condition)],
      ]);
    case "compare":
      return cborMap([
        ["kind", condition.kind],
        ["left", condition.left],
        ["op", condition.op],
        [
          "right",
          "field" in condition.right
            ? cborMap([["field", condition.right.field]])
            : cborMap([["value", encodeCellValue(condition.right.value)]]),
        ],
        ...(condition.measure === undefined ? [] : [["measure", condition.measure] as const]),
      ]);
    case "between":
    case "not-between":
      return cborMap([
        ["kind", condition.kind],
        ["fieldId", condition.fieldId],
        ["low", encodeCellValue(condition.low)],
        ["high", encodeCellValue(condition.high)],
        ...(condition.measure === undefined ? [] : [["measure", condition.measure] as const]),
      ]);
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
};

const V1_CONDITION_KINDS = Object.freeze([
  "field-present",
  "field-absent",
  "field-equals",
  "all",
  "any",
  "not",
] as const);

/** IR v2 (D52, CA-27) adds comparisons; a v1 rule may not name them. */
const V2_CONDITION_KINDS = Object.freeze([
  ...V1_CONDITION_KINDS,
  "compare",
  "between",
  "not-between",
] as const);

const RULE_MEASURES = Object.freeze(["text-length"] as const);

/** Deep enough for any clause a person can build; bounds decoder recursion. */
const MAX_RULE_DEPTH = 64;

const measureOf = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
): { readonly measure?: "text-length" } =>
  map.has("measure") ? { measure: oneOf(field(map, "measure"), RULE_MEASURES, "a rule measure") } : {};

function decodeCondition(value: DecodedValue, irVersion: 1, depth?: number): RuleConditionV1;
function decodeCondition(value: DecodedValue, irVersion: 1 | 2, depth?: number): RuleConditionV2;
function decodeCondition(value: DecodedValue, irVersion: 1 | 2, depth = 0): RuleConditionV2 {
  if (depth > MAX_RULE_DEPTH) {
    throw new CodecError("a rule condition is nested too deeply");
  }
  const map = asMap(value, "a rule condition");
  const kind = oneOf(
    field(map, "kind"),
    irVersion === 1 ? V1_CONDITION_KINDS : V2_CONDITION_KINDS,
    "a rule condition",
  );
  const nested = (entry: DecodedValue): RuleConditionV2 => decodeCondition(entry, irVersion, depth + 1);
  const withMeasure = (names: readonly string[]): readonly string[] =>
    map.has("measure") ? [...names, "measure"] : names;
  switch (kind) {
    case "field-present":
    case "field-absent":
      exactKeys(map, ["kind", "fieldId"], "a rule condition");
      return { kind, fieldId: id16<FieldId>(field(map, "fieldId"), "a field id") };
    case "field-equals":
      exactKeys(map, ["kind", "fieldId", "value"], "a rule condition");
      return {
        kind,
        fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
        value: decodeCellValue(field(map, "value")),
      };
    case "all":
    case "any":
      exactKeys(map, ["kind", "conditions"], "a rule condition");
      return { kind, conditions: list(field(map, "conditions"), "rule conditions").map(nested) };
    case "not":
      exactKeys(map, ["kind", "condition"], "a rule condition");
      return { kind, condition: nested(field(map, "condition")) };
    case "compare": {
      exactKeys(map, withMeasure(["kind", "left", "op", "right"]), "a rule condition");
      const right = asMap(field(map, "right"), "a comparison operand");
      if (right.size !== 1) {
        throw new CodecError("a comparison operand names exactly one side");
      }
      return {
        kind,
        left: id16<FieldId>(field(map, "left"), "a field id"),
        op: oneOf(field(map, "op"), COMPARE_OPERATORS, "a comparison operator"),
        right: right.has("field")
          ? { field: id16<FieldId>(field(right, "field"), "a field id") }
          : { value: decodeCellValue(field(right, "value")) },
        ...measureOf(map),
      };
    }
    case "between":
    case "not-between":
      exactKeys(map, withMeasure(["kind", "fieldId", "low", "high"]), "a rule condition");
      return {
        kind,
        fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
        low: decodeCellValue(field(map, "low")),
        high: decodeCellValue(field(map, "high")),
        ...measureOf(map),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Labels, types, and counts: text, whole numbers, and booleans only. */
const encodeMessageParameters = (
  parameters: Readonly<Record<string, MessageParameterV1>>,
): CborValue =>
  cborMap(
    Object.entries(parameters).map(([name, value]) => {
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new CodecError("a message parameter number must be a whole number");
      }
      return [name, value] as const;
    }),
  );

const decodeMessageParameters = (
  value: DecodedValue,
): Readonly<Record<string, MessageParameterV1>> => {
  const parameters: Record<string, MessageParameterV1> = {};
  for (const [name, entry] of asMap(value, "message parameters")) {
    if (typeof name !== "string") {
      throw new CodecError("a message parameter name is not text");
    }
    if (typeof entry === "bigint") {
      parameters[name] = integer(entry, "a message parameter");
    } else if (typeof entry === "string" || typeof entry === "boolean") {
      parameters[name] = entry;
    } else {
      throw new CodecError("a message parameter is not a safe scalar");
    }
  }
  return parameters;
};

export const encodeValidationRule = (rule: CheckpointValidationRuleV1): CborValue =>
  cborMap([
    ["tableId", rule.tableId],
    ["displayName", rule.displayName],
    ["rule", encodeRuleIR(rule.rule)],
    ["isActive", rule.isActive],
    ["schemaRevision", rule.schemaRevision],
  ]);

const decodeValidationRule = (value: DecodedValue): CheckpointValidationRuleV1 => {
  const map = exactKeys(
    asMap(value, "a validation rule"),
    ["tableId", "displayName", "rule", "isActive", "schemaRevision"],
    "a validation rule",
  );
  return {
    tableId: id16<TableId>(field(map, "tableId"), "a table id"),
    displayName: nfcText(field(map, "displayName"), "a rule name"),
    rule: decodeRuleIR(field(map, "rule")),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: revision(field(map, "schemaRevision"), "a schema revision"),
  };
};

/**
 * One rule IR, v1 or v2 (CA-27). v1 bytes decode exactly as they always did;
 * a v1 rule that names a v2 condition is refused rather than upgraded.
 */
export const encodeRuleIR = (rule: ValidationRuleIR | ValidationRuleIRV2): CborValue =>
  cborMap([
    ["irVersion", rule.irVersion],
    ["ruleId", rule.ruleId],
    ["condition", encodeCondition(rule.condition)],
    ["severity", rule.severity],
    ["messageKey", rule.messageKey],
    ["messageParameters", encodeMessageParameters(rule.messageParameters)],
  ]);

export const decodeRuleIR = (value: DecodedValue): ValidationRuleIR | ValidationRuleIRV2 => {
  const ir = exactKeys(
    asMap(value, "a rule IR"),
    ["irVersion", "ruleId", "condition", "severity", "messageKey", "messageParameters"],
    "a rule IR",
  );
  const irVersion = count(field(ir, "irVersion"), "a rule IR version");
  const common = {
    ruleId: id16<RuleId>(field(ir, "ruleId"), "a rule id"),
    severity: oneOf(field(ir, "severity"), VALIDATION_SEVERITIES, "a rule severity"),
    messageKey: text(field(ir, "messageKey"), "a message key"),
    messageParameters: decodeMessageParameters(field(ir, "messageParameters")),
  };
  if (irVersion === 1) {
    return { irVersion: 1, ...common, condition: decodeCondition(field(ir, "condition"), 1) };
  }
  if (irVersion === 2) {
    return { irVersion: 2, ...common, condition: decodeCondition(field(ir, "condition"), 2) };
  }
  throw new CodecError("a rule declares an unsupported IR version");
};

// ---------------------------------------------------------- formulas (CA-25) --

const IR_NODE_KINDS = Object.freeze([
  "literal",
  "error",
  "field",
  "column",
  "related",
  "formula",
  "unary",
  "binary",
  "call",
] as const);

const UNARY_OPERATORS = Object.freeze(["+", "-", "%"] as const);
const LITERAL_KINDS = Object.freeze(["text", "decimal", "boolean"] as const);
const ERROR_LITERALS = FORMULA_ERROR_CODES.filter(
  (code): code is FormulaErrorLiteralV1 => code !== "#BUDGET",
);

/** The interpreter's own depth ceiling bounds the decoder too. */
const MAX_IR_DEPTH = MAX_EVALUATION_DEPTH;

/** One IR node, exactly as the interpreter reads it: IDs, never names. */
export const encodeFormulaIR = (node: FormulaIRV1): CborValue => {
  switch (node.kind) {
    case "literal":
      return cborMap([
        ["kind", node.kind],
        ["value", encodeCellValue(node.value)],
      ]);
    case "error":
      return cborMap([
        ["kind", node.kind],
        ["code", node.code],
      ]);
    case "field":
      return cborMap([
        ["kind", node.kind],
        ["fieldId", node.fieldId],
      ]);
    case "column":
      return cborMap([
        ["kind", node.kind],
        ["tableId", node.tableId],
        ["fieldId", node.fieldId],
      ]);
    case "related":
      return cborMap([
        ["kind", node.kind],
        ["relationshipId", node.relationshipId],
        ["referenceFieldId", node.referenceFieldId],
        ["fieldId", node.fieldId],
      ]);
    case "formula":
      return cborMap([
        ["kind", node.kind],
        ["formulaId", node.formulaId],
      ]);
    case "unary":
      return cborMap([
        ["kind", node.kind],
        ["operator", node.operator],
        ["operand", encodeFormulaIR(node.operand)],
      ]);
    case "binary":
      return cborMap([
        ["kind", node.kind],
        ["operator", node.operator],
        ["left", encodeFormulaIR(node.left)],
        ["right", encodeFormulaIR(node.right)],
      ]);
    case "call":
      return cborMap([
        ["kind", node.kind],
        ["name", node.name],
        ["version", node.version],
        ["args", node.args.map((argument) => (argument === null ? null : encodeFormulaIR(argument)))],
      ]);
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
};

export const decodeFormulaIR = (value: DecodedValue, depth = 0): FormulaIRV1 => {
  if (depth > MAX_IR_DEPTH) {
    throw new CodecError("a formula is nested too deeply");
  }
  const map = asMap(value, "a formula node");
  const kind = oneOf(field(map, "kind"), IR_NODE_KINDS, "a formula node kind");
  const node = (entry: DecodedValue): FormulaIRV1 => decodeFormulaIR(entry, depth + 1);
  switch (kind) {
    case "literal": {
      exactKeys(map, ["kind", "value"], "a formula literal");
      const literal = decodeCellValue(field(map, "value"));
      if (!(LITERAL_KINDS as readonly string[]).includes(literal.kind)) {
        throw new CodecError("a formula literal is not text, a decimal or a boolean");
      }
      return { kind, value: literal as FormulaLiteralV1 };
    }
    case "error":
      exactKeys(map, ["kind", "code"], "a formula error");
      return { kind, code: oneOf(field(map, "code"), ERROR_LITERALS, "a formula error code") };
    case "field":
      exactKeys(map, ["kind", "fieldId"], "a formula field");
      return { kind, fieldId: id16<FieldId>(field(map, "fieldId"), "a field id") };
    case "column":
      exactKeys(map, ["kind", "tableId", "fieldId"], "a formula column");
      return {
        kind,
        tableId: id16<TableId>(field(map, "tableId"), "a table id"),
        fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
      };
    case "related":
      exactKeys(map, ["kind", "relationshipId", "referenceFieldId", "fieldId"], "a related field");
      return {
        kind,
        relationshipId: id16<RelationshipId>(field(map, "relationshipId"), "a relationship id"),
        referenceFieldId: id16<FieldId>(field(map, "referenceFieldId"), "a field id"),
        fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
      };
    case "formula":
      exactKeys(map, ["kind", "formulaId"], "a formula reference");
      return { kind, formulaId: id16<FormulaId>(field(map, "formulaId"), "a formula id") };
    case "unary":
      exactKeys(map, ["kind", "operator", "operand"], "a unary formula");
      return {
        kind,
        operator: oneOf(field(map, "operator"), UNARY_OPERATORS, "a unary operator"),
        operand: node(field(map, "operand")),
      };
    case "binary":
      exactKeys(map, ["kind", "operator", "left", "right"], "a binary formula");
      return {
        kind,
        operator: oneOf(field(map, "operator"), IR_BINARY_OPERATORS, "a binary operator"),
        left: node(field(map, "left")),
        right: node(field(map, "right")),
      };
    case "call":
      exactKeys(map, ["kind", "name", "version", "args"], "a formula call");
      return {
        kind,
        name: oneOf(field(map, "name"), CATALOG_FUNCTION_NAMES, "a catalog function"),
        version: count(field(map, "version"), "a function version"),
        args: list(field(map, "args"), "call arguments").map((argument) =>
          argument === null ? null : node(argument),
        ),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

const encodeFormulaTarget = (target: FormulaTargetV1): CborValue =>
  cborMap([
    ["kind", target.kind],
    ["tableId", target.tableId],
    ["fieldId", target.kind === "computed-column" ? target.fieldId : null],
  ]);

const decodeFormulaTarget = (value: DecodedValue): FormulaTargetV1 => {
  const map = exactKeys(asMap(value, "a formula target"), ["kind", "tableId", "fieldId"], "a formula target");
  const kind = oneOf(field(map, "kind"), FORMULA_TARGET_KINDS, "a formula target kind");
  const tableId = optionalId<TableId>(field(map, "tableId"), "a table id");
  const fieldId = optionalId<FieldId>(field(map, "fieldId"), "a field id");
  // migration 005's target CHECK, restated so a payload the SQL would refuse
  // is refused here first.
  switch (kind) {
    case "computed-column":
      if (tableId === null || fieldId === null) {
        throw new CodecError("a computed column names its table and its field");
      }
      return { kind, tableId, fieldId };
    case "table-metric":
      if (tableId === null || fieldId !== null) {
        throw new CodecError("a table metric names its table and no field");
      }
      return { kind, tableId };
    case "dashboard-value":
      if (fieldId !== null) {
        throw new CodecError("a dashboard value names no field");
      }
      return { kind, tableId };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

const encodeDependency = (dependency: FormulaDependencyV1): CborValue =>
  cborMap([
    ["kind", dependency.kind],
    ["id", dependency.kind === "field" ? dependency.fieldId : dependency.formulaId],
  ]);

const decodeDependency = (value: DecodedValue): FormulaDependencyV1 => {
  const map = exactKeys(asMap(value, "a formula dependency"), ["kind", "id"], "a formula dependency");
  const kind = oneOf(field(map, "kind"), FORMULA_DEPENDENCY_KINDS, "a dependency kind");
  return kind === "field"
    ? { kind, fieldId: id16<FieldId>(field(map, "id"), "a field id") }
    : { kind, formulaId: id16<FormulaId>(field(map, "id"), "a formula id") };
};

/**
 * A formula definition (CA-25): target, text, IR, disposition, determinism,
 * dependencies. `formula.changed` and the checkpoint's `formulas` root carry
 * the same map, so a definition reads the same from either. It has no key for
 * a value: nothing here can hold an evaluated result (invariant 7).
 */
export const encodeFormulaDefinition = (formula: FormulaDefinitionV1): CborValue =>
  cborMap([
    ["formulaId", formula.formulaId],
    ["target", encodeFormulaTarget(formula.target)],
    ["displayName", formula.displayName],
    ["originalText", formula.originalText],
    [
      "document",
      formula.document === null
        ? null
        : cborMap([
            ["irVersion", formula.document.irVersion],
            ["root", encodeFormulaIR(formula.document.root)],
          ]),
    ],
    ["disposition", formula.disposition],
    ["determinism", formula.determinism],
    ["dependencies", formula.dependencies.map(encodeDependency)],
  ]);

export const decodeFormulaDefinition = (value: DecodedValue): FormulaDefinitionV1 => {
  const map = exactKeys(
    asMap(value, "a formula definition"),
    ["formulaId", "target", "displayName", "originalText", "document", "disposition", "determinism", "dependencies"],
    "a formula definition",
  );
  const disposition = oneOf(field(map, "disposition"), FORMULA_DISPOSITIONS, "a formula disposition");
  const determinism = oneOf(field(map, "determinism"), FORMULA_DETERMINISMS, "a formula determinism");
  if (!isAllowedClassification(disposition, determinism)) {
    throw new CodecError("a formula's disposition and determinism are not a legal pair");
  }
  const documentValue = field(map, "document");
  let document: FormulaIRDocumentV1 | null = null;
  if (documentValue !== null) {
    const documentMap = exactKeys(asMap(documentValue, "a formula document"), ["irVersion", "root"], "a formula document");
    if (count(field(documentMap, "irVersion"), "a formula IR version") !== 1) {
      throw new CodecError("a formula declares an unsupported IR version");
    }
    document = { irVersion: 1, root: decodeFormulaIR(field(documentMap, "root")) };
  }
  if (document === null && disposition !== "unsupported") {
    throw new CodecError("only an unsupported formula may lack its IR");
  }
  const displayName = field(map, "displayName");
  return {
    formulaId: id16<FormulaId>(field(map, "formulaId"), "a formula id"),
    target: decodeFormulaTarget(field(map, "target")),
    displayName: displayName === null ? null : nfcText(displayName, "a formula name"),
    originalText: nfcText(field(map, "originalText"), "formula text"),
    document,
    disposition,
    determinism,
    dependencies: list(field(map, "dependencies"), "formula dependencies").map(decodeDependency),
  };
};

export const encodeFormulaMetadata = (metadata: FormulaMetadataV1): CborValue =>
  cborMap([
    ["catalogVersion", metadata.catalogVersion],
    [
      "functionVersions",
      metadata.functionVersions.map((entry) =>
        cborMap([
          ["name", entry.name],
          ["version", entry.version],
        ]),
      ),
    ],
    ["source", metadata.source],
    ["importedValuePolicy", metadata.importedValuePolicy],
  ]);

export const decodeFormulaMetadata = (value: DecodedValue): FormulaMetadataV1 => {
  const map = exactKeys(
    asMap(value, "formula metadata"),
    ["catalogVersion", "functionVersions", "source", "importedValuePolicy"],
    "formula metadata",
  );
  return {
    catalogVersion: count(field(map, "catalogVersion"), "a catalog version"),
    functionVersions: list(field(map, "functionVersions"), "function versions").map((entry) => {
      const version = exactKeys(asMap(entry, "a function version"), ["name", "version"], "a function version");
      return {
        name: text(field(version, "name"), "a function name"),
        version: count(field(version, "version"), "a function version"),
      };
    }),
    source: oneOf(field(map, "source"), FORMULA_SOURCES, "a formula source"),
    importedValuePolicy: oneOf(
      field(map, "importedValuePolicy"),
      FORMULA_IMPORTED_VALUE_POLICIES,
      "an imported-value policy",
    ),
  };
};

/** One formula as the checkpoint's `formulas` root holds it (CA-25). */
export interface CheckpointFormulaV1 {
  readonly formula: FormulaDefinitionV1;
  readonly metadata: FormulaMetadataV1;
  /** A removed formula stays, inactive: its computed field still names it. */
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

const encodeCheckpointFormula = (entry: CheckpointFormulaV1): CborValue =>
  cborMap([
    ["formula", encodeFormulaDefinition(entry.formula)],
    ["metadata", encodeFormulaMetadata(entry.metadata)],
    ["isActive", entry.isActive],
    ["schemaRevision", entry.schemaRevision],
  ]);

const decodeCheckpointFormula = (value: DecodedValue): CheckpointFormulaV1 => {
  const map = exactKeys(
    asMap(value, "a checkpoint formula"),
    ["formula", "metadata", "isActive", "schemaRevision"],
    "a checkpoint formula",
  );
  return {
    formula: decodeFormulaDefinition(field(map, "formula")),
    metadata: decodeFormulaMetadata(field(map, "metadata")),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: revision(field(map, "schemaRevision"), "a schema revision"),
  };
};

// ------------------------------------------------------------ charts (CA-30) --

const FILTER_OPERAND_KINDS = Object.freeze([
  "enum-in",
  "date-range",
  "number-range",
  "boolean-is",
  "reference-in",
  "reference-broken",
  "text-contains",
  "text-equals",
  "is-empty",
  "not-empty",
] as const);

const encodeFilterOperand = (operand: FilterOperandV1): CborValue => {
  switch (operand.kind) {
    case "enum-in":
      return cborMap([["kind", operand.kind], ["optionIds", [...operand.optionIds]]]);
    case "date-range":
      return cborMap([["kind", operand.kind], ["from", operand.from], ["to", operand.to]]);
    case "number-range":
      return cborMap([["kind", operand.kind], ["min", operand.min], ["max", operand.max]]);
    case "boolean-is":
      return cborMap([["kind", operand.kind], ["value", operand.value]]);
    case "reference-in":
      return cborMap([["kind", operand.kind], ["recordIds", [...operand.recordIds]]]);
    case "text-contains":
    case "text-equals":
      return cborMap([["kind", operand.kind], ["text", operand.text]]);
    case "reference-broken":
    case "is-empty":
    case "not-empty":
      return cborMap([["kind", operand.kind]]);
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
};

const optionalInteger = (value: DecodedValue, what: string): number | null =>
  value === null ? null : integer(value, what);

const decodeFilterOperand = (value: DecodedValue): FilterOperandV1 => {
  const map = asMap(value, "a filter operand");
  const kind = oneOf(field(map, "kind"), FILTER_OPERAND_KINDS, "a filter operand kind");
  const keys = (...names: string[]): void => {
    exactKeys(map, ["kind", ...names], "a filter operand");
  };
  switch (kind) {
    case "enum-in":
      keys("optionIds");
      return { kind, optionIds: list(field(map, "optionIds"), "option ids").map((id) => id16<OptionId>(id, "an option id")) };
    case "date-range":
      keys("from", "to");
      return { kind, from: optionalInteger(field(map, "from"), "a day"), to: optionalInteger(field(map, "to"), "a day") };
    case "number-range":
      keys("min", "max");
      return { kind, min: optionalText(field(map, "min"), "a decimal"), max: optionalText(field(map, "max"), "a decimal") };
    case "boolean-is":
      keys("value");
      return { kind, value: boolean(field(map, "value"), "a filter boolean") };
    case "reference-in":
      keys("recordIds");
      return { kind, recordIds: list(field(map, "recordIds"), "record ids").map((id) => id16<RecordId>(id, "a record id")) };
    case "text-contains":
    case "text-equals":
      keys("text");
      return { kind, text: nfcText(field(map, "text"), "filter text") };
    case "reference-broken":
    case "is-empty":
    case "not-empty":
      keys();
      return { kind };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

/** A records filter (CA-29) as a chart stores it: ids as bytes, values exact. */
export const encodeFilter = (filter: FilterV1): CborValue =>
  cborMap([
    ["fieldId", filter.fieldId],
    ["operand", encodeFilterOperand(filter.operand)],
  ]);

export const decodeFilter = (value: DecodedValue): FilterV1 => {
  const map = exactKeys(asMap(value, "a filter"), ["fieldId", "operand"], "a filter");
  return {
    fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
    operand: decodeFilterOperand(field(map, "operand")),
  };
};

const GROUPING_KINDS = Object.freeze(["field", "related-field", "date"] as const);
const MEASURE_KINDS = Object.freeze(["count", "sum", "average", "min", "max"] as const);
const CHART_SORTS = Object.freeze(["category", "measure-desc"] as const);

const encodeGrouping = (group: GroupingV1): CborValue => {
  switch (group.kind) {
    case "field":
      return cborMap([["kind", group.kind], ["fieldId", group.fieldId]]);
    case "related-field":
      return cborMap([
        ["kind", group.kind],
        ["relationshipId", group.relationshipId],
        ["referenceFieldId", group.referenceFieldId],
        ["fieldId", group.fieldId],
      ]);
    case "date":
      return cborMap([["kind", group.kind], ["fieldId", group.fieldId], ["unit", group.unit]]);
    default: {
      const unreachable: never = group;
      return unreachable;
    }
  }
};

const decodeGrouping = (value: DecodedValue): GroupingV1 => {
  const map = asMap(value, "a chart grouping");
  const kind = oneOf(field(map, "kind"), GROUPING_KINDS, "a grouping kind");
  switch (kind) {
    case "field":
      exactKeys(map, ["kind", "fieldId"], "a chart grouping");
      return { kind, fieldId: id16<FieldId>(field(map, "fieldId"), "a field id") };
    case "related-field":
      exactKeys(map, ["kind", "relationshipId", "referenceFieldId", "fieldId"], "a chart grouping");
      return {
        kind,
        relationshipId: id16<RelationshipId>(field(map, "relationshipId"), "a relationship id"),
        referenceFieldId: id16<FieldId>(field(map, "referenceFieldId"), "a field id"),
        fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
      };
    case "date":
      exactKeys(map, ["kind", "fieldId", "unit"], "a chart grouping");
      return {
        kind,
        fieldId: id16<FieldId>(field(map, "fieldId"), "a field id"),
        unit: oneOf(field(map, "unit"), DATE_GROUPING_UNITS, "a date unit"),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

const encodeMeasure = (measure: MeasureV1): CborValue =>
  measure.kind === "count"
    ? cborMap([["kind", measure.kind]])
    : cborMap([["kind", measure.kind], ["fieldId", measure.fieldId]]);

const decodeMeasure = (value: DecodedValue): MeasureV1 => {
  const map = asMap(value, "a chart measure");
  const kind = oneOf(field(map, "kind"), MEASURE_KINDS, "a measure kind");
  if (kind === "count") {
    exactKeys(map, ["kind"], "a chart measure");
    return { kind };
  }
  exactKeys(map, ["kind", "fieldId"], "a chart measure");
  return { kind, fieldId: id16<FieldId>(field(map, "fieldId"), "a field id") };
};

const CHART_COMMON_KEYS = Object.freeze(["chartVersion", "chartId", "name", "tableId", "filters", "pinned", "type"] as const);

/**
 * A chart definition (D54) as `chart.saved` and the checkpoint's `charts`
 * root carry it — stable IDs only, never a label. Exported for S07, which
 * writes imported charts into the same root with `provenance: "imported"`.
 */
export const encodeChartDefinition = (definition: ChartDefinitionV1): CborValue => {
  const common: (readonly [string, CborValue])[] = [
    ["chartVersion", definition.chartVersion],
    ["chartId", definition.chartId],
    ["name", definition.name],
    ["tableId", definition.tableId],
    ["filters", definition.filters.map(encodeFilter)],
    ["pinned", definition.pinned],
    ["type", definition.type],
  ];
  return definition.type === "scatter"
    ? cborMap([...common, ["x", definition.x], ["y", definition.y]])
    : cborMap([
        ...common,
        ["groupBy", encodeGrouping(definition.groupBy)],
        ["seriesBy", definition.seriesBy === null ? null : encodeGrouping(definition.seriesBy)],
        ["measure", encodeMeasure(definition.measure)],
        ["sort", definition.sort],
      ]);
};

export const decodeChartDefinition = (value: DecodedValue): ChartDefinitionV1 => {
  const map = asMap(value, "a chart definition");
  const type = oneOf(field(map, "type"), CHART_TYPES, "a chart type");
  if (count(field(map, "chartVersion"), "a chart version") !== 1) {
    throw new CodecError("chart definition declares an unsupported version");
  }
  const common = {
    chartVersion: 1 as const,
    chartId: id16<ChartId>(field(map, "chartId"), "a chart id"),
    name: nfcText(field(map, "name"), "a chart name"),
    tableId: id16<TableId>(field(map, "tableId"), "a table id"),
    filters: list(field(map, "filters"), "chart filters").map(decodeFilter),
    pinned: boolean(field(map, "pinned"), "a pin flag"),
  };
  if (type === "scatter") {
    exactKeys(map, [...CHART_COMMON_KEYS, "x", "y"], "a chart definition");
    return {
      ...common,
      type,
      x: id16<FieldId>(field(map, "x"), "a field id"),
      y: id16<FieldId>(field(map, "y"), "a field id"),
    };
  }
  exactKeys(map, [...CHART_COMMON_KEYS, "groupBy", "seriesBy", "measure", "sort"], "a chart definition");
  const series = field(map, "seriesBy");
  return {
    ...common,
    type,
    groupBy: decodeGrouping(field(map, "groupBy")),
    seriesBy: series === null ? null : decodeGrouping(series),
    measure: decodeMeasure(field(map, "measure")),
    sort: oneOf(field(map, "sort"), CHART_SORTS, "a chart sort"),
  };
};

/**
 * One chart as the checkpoint's `charts` root holds it (CA-30): its
 * definition (which carries its name and pin state) and the three facts the
 * `charts` row keeps beside it. A deleted chart is simply absent.
 */
export interface CheckpointChartV1 {
  readonly definition: ChartDefinitionV1;
  readonly ordinal: number;
  readonly provenance: ChartProvenanceV1;
  readonly chartRevision: bigint;
}

export const encodeCheckpointChart = (chart: CheckpointChartV1): CborValue =>
  cborMap([
    ["definition", encodeChartDefinition(chart.definition)],
    ["ordinal", chart.ordinal],
    ["provenance", chart.provenance],
    ["chartRevision", chart.chartRevision],
  ]);

export const decodeCheckpointChart = (value: DecodedValue): CheckpointChartV1 => {
  const map = exactKeys(
    asMap(value, "a checkpoint chart"),
    ["definition", "ordinal", "provenance", "chartRevision"],
    "a checkpoint chart",
  );
  return {
    definition: decodeChartDefinition(field(map, "definition")),
    ordinal: count(field(map, "ordinal"), "a chart ordinal"),
    provenance: oneOf(field(map, "provenance"), CHART_PROVENANCES, "a chart provenance"),
    chartRevision: revision(field(map, "chartRevision"), "a chart revision"),
  };
};

const encodeInertItem = (item: InertItemV1): CborValue =>
  cborMap([
    ["inertItemId", item.inertItemId],
    ["sheetId", item.sheetId],
    ["kind", item.kind],
    ["location", item.location],
    ["reasonKey", item.reasonKey],
    ["anchor", item.anchor === null ? null : encodeCellRange(item.anchor)],
    ["preservedManifestStorageId", item.preservedManifestStorageId],
  ]);

const decodeInertItem = (value: DecodedValue): InertItemV1 => {
  const map = exactKeys(
    asMap(value, "an inert item"),
    [
      "inertItemId",
      "sheetId",
      "kind",
      "location",
      "reasonKey",
      "anchor",
      "preservedManifestStorageId",
    ],
    "an inert item",
  );
  const anchor = field(map, "anchor");
  return {
    inertItemId: id16<InertItemId>(field(map, "inertItemId"), "an inert item id"),
    sheetId: id16<SheetId>(field(map, "sheetId"), "a sheet id"),
    kind: oneOf(field(map, "kind"), INERT_ITEM_KINDS, "an inert item kind"),
    location: nfcText(field(map, "location"), "an inert item location"),
    reasonKey: oneOf(field(map, "reasonKey"), INERT_REASON_KEYS, "an inert reason"),
    anchor: anchor === null ? null : decodeCellRange(anchor),
    preservedManifestStorageId: optionalText(
      field(map, "preservedManifestStorageId"),
      "a preserved object root",
    ),
  };
};

const encodeDecision = (decision: InferenceDecisionRecordV1): CborValue =>
  cborMap([
    ["decisionId", decision.decisionId],
    ["subject", decision.subject],
    ["decisionKind", decision.decisionKind],
    ["evidenceFingerprint", decision.evidenceFingerprint],
    ["disposition", decision.disposition],
    ["statement", decision.statement as CborValue],
    ["evidence", decision.evidence as CborValue],
    ["recordedEventId", decision.recordedEventId],
  ]);

const decodeDecision = (value: DecodedValue): InferenceDecisionRecordV1 => {
  const map = exactKeys(
    asMap(value, "an inference decision"),
    [
      "decisionId",
      "subject",
      "decisionKind",
      "evidenceFingerprint",
      "disposition",
      "statement",
      "evidence",
      "recordedEventId",
    ],
    "an inference decision",
  );
  const kind = field(map, "decisionKind");
  return {
    decisionId: id16<DecisionId>(field(map, "decisionId"), "a decision id"),
    subject: text(field(map, "subject"), "a decision subject"),
    decisionKind: kind === null ? null : oneOf(kind, DECISION_KINDS, "a decision kind"),
    evidenceFingerprint: bytesOfLength(
      field(map, "evidenceFingerprint"),
      SHA256_BYTES,
      "an evidence fingerprint",
    ),
    disposition: oneOf(
      field(map, "disposition"),
      INFERENCE_DISPOSITIONS,
      "a decision disposition",
    ),
    statement: field(map, "statement"),
    evidence: field(map, "evidence"),
    recordedEventId: id16<EventId>(field(map, "recordedEventId"), "an event id"),
  };
};

const encodeLineage = (lineage: ImportLineageV1): CborValue =>
  cborMap([
    ["lineageId", lineage.lineageId],
    ["importKind", lineage.importKind],
    ["importOrdinal", lineage.importOrdinal],
    ["sourceDisplayName", lineage.sourceDisplayName],
    ["sourceSha256", lineage.sourceSha256],
    ["acceptedAtMs", lineage.acceptedAtMs],
    ["identityDecisions", lineage.identityDecisions as CborValue],
    ["acceptedCommitId", lineage.acceptedCommitId],
  ]);

const decodeLineage = (value: DecodedValue): ImportLineageV1 => {
  const map = exactKeys(
    asMap(value, "an import lineage"),
    [
      "lineageId",
      "importKind",
      "importOrdinal",
      "sourceDisplayName",
      "sourceSha256",
      "acceptedAtMs",
      "identityDecisions",
      "acceptedCommitId",
    ],
    "an import lineage",
  );
  return {
    lineageId: id16<LineageId>(field(map, "lineageId"), "a lineage id"),
    importKind: oneOf(field(map, "importKind"), IMPORT_KINDS, "an import kind"),
    importOrdinal: count(field(map, "importOrdinal"), "an import ordinal"),
    sourceDisplayName: nfcText(field(map, "sourceDisplayName"), "a source name"),
    sourceSha256: bytesOfLength(
      field(map, "sourceSha256"),
      SHA256_BYTES,
      "a source fingerprint",
    ),
    acceptedAtMs: count(field(map, "acceptedAtMs"), "an acceptance time"),
    identityDecisions: field(map, "identityDecisions"),
    acceptedCommitId: id16<CommitId>(field(map, "acceptedCommitId"), "a commit id"),
  };
};

const F02_SHEET_KEYS = Object.freeze([
  "sheetId",
  "displayName",
  "sheetOrdinal",
  "snapshotManifestStorageId",
  "declaredRowCount",
  "declaredColumnCount",
] as const);

const F03_SHEET_KEYS = Object.freeze([
  ...F02_SHEET_KEYS,
  "classification",
  "snapshotRevision",
] as const);

/** The descriptor's canonical form; `table.created` carries the same map. */
export const encodeSheetDescriptor = (sheet: SheetDescriptorV1): CborValue =>
  cborMap([
    ["sheetId", sheet.sheetId],
    ["displayName", sheet.displayName],
    ["sheetOrdinal", sheet.sheetOrdinal],
    ["snapshotManifestStorageId", sheet.snapshotManifestStorageId],
    ["declaredRowCount", integerOrNull(sheet.declaredRowCount)],
    ["declaredColumnCount", integerOrNull(sheet.declaredColumnCount)],
    ["classification", [...sheet.classification]],
    ["snapshotRevision", sheet.snapshotRevision],
  ]);

const decodeClassification = (
  value: DecodedValue,
): SheetDescriptorV1["classification"] => {
  const roles = list(value, "a sheet classification").map((role) =>
    oneOf(role, SHEET_CLASSIFICATIONS, "a sheet role"),
  );
  if (roles.length === 0 || new Set(roles).size !== roles.length) {
    throw new CodecError("a sheet classification must name distinct roles");
  }
  return roles;
};

const decodeSheetFields = (
  sheet: ReadonlyMap<DecodedKey, DecodedValue>,
): CheckpointSheetV1 => ({
  sheetId: id16<SheetId>(field(sheet, "sheetId"), "a sheet id"),
  displayName: nfcText(field(sheet, "displayName"), "a sheet name"),
  sheetOrdinal: count(field(sheet, "sheetOrdinal"), "a sheet ordinal"),
  snapshotManifestStorageId: text(
    field(sheet, "snapshotManifestStorageId"),
    "a snapshot manifest id",
  ),
  declaredRowCount: optionalCount(field(sheet, "declaredRowCount"), "a declared row count"),
  declaredColumnCount: optionalCount(
    field(sheet, "declaredColumnCount"),
    "a declared column count",
  ),
});

/** A sheet descriptor in its F03 form (the only form `table.created` has). */
export const decodeSheetDescriptor = (value: DecodedValue): SheetDescriptorV1 => {
  const sheet = exactKeys(asMap(value, "a sheet"), [...F03_SHEET_KEYS], "a sheet");
  return {
    ...decodeSheetFields(sheet),
    classification: decodeClassification(field(sheet, "classification")),
    snapshotRevision: revision(field(sheet, "snapshotRevision"), "a snapshot revision"),
  };
};

// ------------------------------------------------------- checkpoint manifest --

const F02_MANIFEST_KEYS = Object.freeze([
  "manifestVersion",
  "appId",
  "schemaRevision",
  "frontier",
  "appState",
  "tables",
  "enumOptions",
  "sheetSnapshots",
  "recordPages",
  "semanticSha256",
] as const);

const F03_MANIFEST_KEYS = Object.freeze([
  ...F02_MANIFEST_KEYS,
  "relationships",
  "validationRules",
  "inertItems",
  "inferenceDecisions",
  "importLineages",
] as const);

/** F04 adds the `formulas` root (CA-25) as payload evolution, exactly as D37 did. */
const F04_FORMULA_MANIFEST_KEYS = Object.freeze([...F03_MANIFEST_KEYS, "formulas"] as const);

/** Then the `charts` root (CA-30), the same way: the shape every writer now emits. */
const F04_MANIFEST_KEYS = Object.freeze([...F04_FORMULA_MANIFEST_KEYS, "charts"] as const);

/**
 * True when `map` holds exactly `names`. Used only to choose between the two
 * legal key sets; the chosen set is then enforced by `exactKeys`.
 */
const hasExactly = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  names: readonly string[],
): boolean => map.size === names.length && names.every((name) => map.has(name));

/**
 * The exact bytes `semanticSha256` is computed over: the manifest sans hash.
 * Always the F04 key set — an older writer's absent roots are written as
 * their defaults.
 */
export function encodeCheckpointBody(
  manifest: Omit<CheckpointManifestV1, "semanticSha256">,
): Uint8Array {
  const resolved = resolveCheckpointManifest(manifest);
  return encodeCanonical(
    cborMap([
      ["manifestVersion", resolved.manifestVersion],
      ["appId", resolved.appId],
      ["schemaRevision", resolved.schemaRevision],
      ["frontier", encodeFrontier(resolved.frontier)],
      ["appState", encodeAppState(resolved.appState)],
      ["tables", resolved.tables.map(encodeTableDef)],
      ["enumOptions", resolved.enumOptions.map(encodeEnumOption)],
      ["sheetSnapshots", resolved.sheetSnapshots.map(encodeSheetDescriptor)],
      ["relationships", resolved.relationships.map(encodeRelationship)],
      ["validationRules", resolved.validationRules.map(encodeValidationRule)],
      ["inertItems", resolved.inertItems.map(encodeInertItem)],
      ["inferenceDecisions", resolved.inferenceDecisions.map(encodeDecision)],
      ["importLineages", resolved.importLineages.map(encodeLineage)],
      ["formulas", resolved.formulas.map(encodeCheckpointFormula)],
      ["charts", resolved.charts.map(encodeCheckpointChart)],
      ["recordPages", resolved.recordPages.map(encodePageRef)],
    ]),
  );
}

export function encodeCheckpointManifest(manifest: CheckpointManifestV1): Uint8Array {
  const body = decodeCanonical(encodeCheckpointBody(manifest));
  const map = asMap(body, "a checkpoint manifest") as Map<string, CborValue>;
  map.set("semanticSha256", manifest.semanticSha256);
  return encodeCanonical(map);
}

/**
 * The body bytes `semanticSha256` covers, **as they were written**: the
 * payload's own map without its hash, re-encoded canonically (which is
 * byte-exact). An F02 manifest's body therefore stays the F02 bytes it was
 * hashed over — decoding and re-encoding through the F03 encoder would add the
 * defaulted keys and break the digest.
 */
export function checkpointSemanticBody(payload: Uint8Array): Uint8Array {
  const map = new Map(asMap(decodeCanonical(payload), "a checkpoint manifest"));
  if (!map.delete("semanticSha256")) {
    throw new CodecError("a checkpoint manifest is missing semanticSha256");
  }
  return encodeCanonical(map);
}

export function decodeCheckpointManifest(
  payload: Uint8Array,
): ResolvedCheckpointManifestV1 {
  const raw = asMap(decodeCanonical(payload), "a checkpoint manifest");
  const isF02 = hasExactly(raw, F02_MANIFEST_KEYS);
  const isF03 = hasExactly(raw, F03_MANIFEST_KEYS);
  const isF04Formulas = hasExactly(raw, F04_FORMULA_MANIFEST_KEYS);
  const map = exactKeys(
    raw,
    isF02
      ? [...F02_MANIFEST_KEYS]
      : isF03
        ? [...F03_MANIFEST_KEYS]
        : isF04Formulas
          ? [...F04_FORMULA_MANIFEST_KEYS]
          : [...F04_MANIFEST_KEYS],
    "a checkpoint manifest",
  );
  if (count(field(map, "manifestVersion"), "a manifest version") !== VERSION) {
    throw new CodecError("checkpoint manifest declares an unsupported version");
  }

  const sheetKeys = isF02 ? [...F02_SHEET_KEYS] : [...F03_SHEET_KEYS];
  const base: CheckpointManifestV1 = {
    manifestVersion: VERSION,
    appId: bytesOfLength(field(map, "appId"), ID_BYTES, "an app id") as AppId,
    schemaRevision: revision(field(map, "schemaRevision"), "a schema revision"),
    frontier: decodeFrontier(field(map, "frontier")),
    appState: decodeAppState(field(map, "appState")),
    tables: list(field(map, "tables"), "tables").map(decodeTableDef),
    enumOptions: list(field(map, "enumOptions"), "enum options").map(decodeEnumOption),
    sheetSnapshots: list(field(map, "sheetSnapshots"), "sheet snapshots").map(
      (value) => {
        const sheet = exactKeys(asMap(value, "a sheet snapshot"), sheetKeys, "a sheet snapshot");
        return isF02
          ? decodeSheetFields(sheet)
          : {
              ...decodeSheetFields(sheet),
              classification: decodeClassification(field(sheet, "classification")),
              snapshotRevision: revision(
                field(sheet, "snapshotRevision"),
                "a snapshot revision",
              ),
            };
      },
    ),
    ...(isF02
      ? {}
      : {
          relationships: list(field(map, "relationships"), "relationships").map(
            decodeRelationship,
          ),
          validationRules: list(field(map, "validationRules"), "validation rules").map(
            decodeValidationRule,
          ),
          inertItems: list(field(map, "inertItems"), "inert items").map(decodeInertItem),
          inferenceDecisions: list(
            field(map, "inferenceDecisions"),
            "inference decisions",
          ).map(decodeDecision),
          importLineages: list(field(map, "importLineages"), "import lineages").map(
            decodeLineage,
          ),
        }),
    ...(isF02 || isF03
      ? {}
      : { formulas: list(field(map, "formulas"), "formulas").map(decodeCheckpointFormula) }),
    ...(isF02 || isF03 || isF04Formulas
      ? {}
      : { charts: list(field(map, "charts"), "charts").map(decodeCheckpointChart) }),
    recordPages: list(field(map, "recordPages"), "record pages").map(decodePageRef),
    semanticSha256: bytesOfLength(
      field(map, "semanticSha256"),
      SHA256_BYTES,
      "a semantic digest",
    ),
  };
  return { ...resolveCheckpointManifest(base), semanticSha256: base.semanticSha256 };
}

// ----------------------------------------------------------------- app head --

export interface StorageRefV1 {
  readonly storageId: string;
  readonly semanticSha256: Uint8Array;
}

export interface AppHeadV1 {
  readonly headVersion: typeof VERSION;
  readonly appId: AppId;
  readonly headRevision: bigint;
  readonly schemaRevision: bigint;
  readonly checkpoint: StorageRefV1;
  readonly eventSegments: readonly StorageRefV1[];
  readonly frontier: readonly FrontierEntryV1[];
  /**
   * Explicitly present, always. An empty array says "this app has no conflicts
   * and no audit pages"; an absent field would say nothing at all, and
   * database.md calls a missing entry corruption rather than absence.
   */
  readonly baselinePages: readonly StorageRefV1[];
  readonly conflictPages: readonly StorageRefV1[];
  readonly auditPages: readonly StorageRefV1[];
  readonly sourceManifests: readonly StorageRefV1[];
  readonly snapshotManifests: readonly StorageRefV1[];
  readonly retainedRoots: readonly StorageRefV1[];
  readonly semanticSha256: Uint8Array;
}

const encodeRef = (ref: StorageRefV1): CborValue =>
  cborMap([
    ["storageId", ref.storageId],
    ["semanticSha256", ref.semanticSha256],
  ]);

const decodeRef = (value: DecodedValue): StorageRefV1 => {
  const map = exactKeys(
    asMap(value, "a storage ref"),
    ["storageId", "semanticSha256"],
    "a storage ref",
  );
  return {
    storageId: text(field(map, "storageId"), "a storage id"),
    semanticSha256: bytesOfLength(
      field(map, "semanticSha256"),
      SHA256_BYTES,
      "a semantic digest",
    ),
  };
};

const HEAD_REF_LISTS = Object.freeze([
  "eventSegments",
  "baselinePages",
  "conflictPages",
  "auditPages",
  "sourceManifests",
  "snapshotManifests",
  "retainedRoots",
] as const);

export function encodeAppHeadBody(
  head: Omit<AppHeadV1, "semanticSha256">,
): Uint8Array {
  return encodeCanonical(
    cborMap([
      ["headVersion", head.headVersion],
      ["appId", head.appId],
      ["headRevision", head.headRevision],
      ["schemaRevision", head.schemaRevision],
      ["checkpoint", encodeRef(head.checkpoint)],
      ["frontier", encodeFrontier(head.frontier)],
      ...HEAD_REF_LISTS.map(
        (name) => [name, head[name].map(encodeRef)] as const,
      ),
    ]),
  );
}

export function encodeAppHead(head: AppHeadV1): Uint8Array {
  const map = asMap(
    decodeCanonical(encodeAppHeadBody(head)),
    "an app head",
  ) as Map<string, CborValue>;
  map.set("semanticSha256", head.semanticSha256);
  return encodeCanonical(map);
}

export function decodeAppHead(payload: Uint8Array): AppHeadV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "an app head"),
    [
      "headVersion",
      "appId",
      "headRevision",
      "schemaRevision",
      "checkpoint",
      "frontier",
      ...HEAD_REF_LISTS,
      "semanticSha256",
    ],
    "an app head",
  );
  if (count(field(map, "headVersion"), "a head version") !== VERSION) {
    throw new CodecError("app head declares an unsupported version");
  }

  const refsIn = (name: (typeof HEAD_REF_LISTS)[number]): readonly StorageRefV1[] =>
    list(field(map, name), name).map(decodeRef);

  return {
    headVersion: VERSION,
    appId: bytesOfLength(field(map, "appId"), ID_BYTES, "an app id") as AppId,
    headRevision: BigInt(count(field(map, "headRevision"), "a head revision")),
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
    checkpoint: decodeRef(field(map, "checkpoint")),
    frontier: decodeFrontier(field(map, "frontier")),
    eventSegments: refsIn("eventSegments"),
    baselinePages: refsIn("baselinePages"),
    conflictPages: refsIn("conflictPages"),
    auditPages: refsIn("auditPages"),
    sourceManifests: refsIn("sourceManifests"),
    snapshotManifests: refsIn("snapshotManifests"),
    retainedRoots: refsIn("retainedRoots"),
    semanticSha256: bytesOfLength(
      field(map, "semanticSha256"),
      SHA256_BYTES,
      "a semantic digest",
    ),
  };
}

/** Re-exported for promotion's manifest assembly. */
export type { ManifestChunkRefV1 };
export { encodeChunkRef, decodeChunkRef };
