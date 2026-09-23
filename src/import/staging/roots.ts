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
 * **The checkpoint manifest has two readable shapes (D37).** F03 added the
 * workbook roots — relationships, validation rules, inert items, inference
 * decisions, import lineages, and each sheet's classification and snapshot
 * revision — as payload evolution inside the encrypted envelope, not as a new
 * version. The encoder always writes the F03 key set. The decoder accepts
 * exactly the F02 key set (and fills the F02-true defaults: every list empty,
 * each sheet `["table"]` at the manifest's schema revision) or exactly the F03
 * key set; any other key set is a `CodecError`. So every GATE-F02 app keeps
 * opening, and a manifest with a stray or missing key still does not.
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
import type { AppThemeV1 } from "../../domain/model/events.js";
import { INFERENCE_DISPOSITIONS } from "../../domain/model/events.js";
import type {
  CommitId,
  DecisionId,
  EventId,
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
  VALIDATION_SEVERITIES,
  type MessageParameterV1,
  type RuleConditionV1,
  type ValidationRuleIR,
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

const encodeFieldDef = (definition: FieldDefV1): CborValue =>
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
  ]);

export const decodeFieldDef = (value: DecodedValue): FieldDefV1 => {
  const map = exactKeys(
    asMap(value, "a field definition"),
    [
      "fieldId",
      "tableId",
      "displayName",
      "fieldOrdinal",
      "type",
      "isRequired",
      "isActive",
      "schemaRevision",
    ],
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
  };
};

const encodeTableDef = (table: TableDefV1): CborValue =>
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

const encodeEnumOption = (option: EnumOptionDefV1): CborValue =>
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

export function encodeBaselinePage(page: BaselinePageV1): Uint8Array {
  const bytes = encodeCanonical(
    cborMap([
      ["pageVersion", page.pageVersion],
      ["scopeId", page.scopeId],
      [
        "entries",
        page.entries.map((entry) =>
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
          ]),
        ),
      ],
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
  readonly rule: ValidationRuleIR;
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

const encodeRelationship = (relationship: RelationshipDefV1): CborValue =>
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

const decodeRelationship = (value: DecodedValue): RelationshipDefV1 => {
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

const encodeCondition = (condition: RuleConditionV1): CborValue => {
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
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
};

const CONDITION_KINDS = Object.freeze([
  "field-present",
  "field-absent",
  "field-equals",
  "all",
  "any",
  "not",
] as const);

const decodeCondition = (value: DecodedValue): RuleConditionV1 => {
  const map = asMap(value, "a rule condition");
  const kind = oneOf(field(map, "kind"), CONDITION_KINDS, "a rule condition");
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
      return {
        kind,
        conditions: list(field(map, "conditions"), "rule conditions").map(
          decodeCondition,
        ),
      };
    case "not":
      exactKeys(map, ["kind", "condition"], "a rule condition");
      return { kind, condition: decodeCondition(field(map, "condition")) };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

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

const encodeValidationRule = (rule: CheckpointValidationRuleV1): CborValue =>
  cborMap([
    ["tableId", rule.tableId],
    ["displayName", rule.displayName],
    [
      "rule",
      cborMap([
        ["irVersion", rule.rule.irVersion],
        ["ruleId", rule.rule.ruleId],
        ["condition", encodeCondition(rule.rule.condition)],
        ["severity", rule.rule.severity],
        ["messageKey", rule.rule.messageKey],
        ["messageParameters", encodeMessageParameters(rule.rule.messageParameters)],
      ]),
    ],
    ["isActive", rule.isActive],
    ["schemaRevision", rule.schemaRevision],
  ]);

const decodeValidationRule = (value: DecodedValue): CheckpointValidationRuleV1 => {
  const map = exactKeys(
    asMap(value, "a validation rule"),
    ["tableId", "displayName", "rule", "isActive", "schemaRevision"],
    "a validation rule",
  );
  const ir = exactKeys(
    asMap(field(map, "rule"), "a rule IR"),
    ["irVersion", "ruleId", "condition", "severity", "messageKey", "messageParameters"],
    "a rule IR",
  );
  if (count(field(ir, "irVersion"), "a rule IR version") !== 1) {
    throw new CodecError("a rule declares an unsupported IR version");
  }
  return {
    tableId: id16<TableId>(field(map, "tableId"), "a table id"),
    displayName: nfcText(field(map, "displayName"), "a rule name"),
    rule: {
      irVersion: 1,
      ruleId: id16<RuleId>(field(ir, "ruleId"), "a rule id"),
      condition: decodeCondition(field(ir, "condition")),
      severity: oneOf(field(ir, "severity"), VALIDATION_SEVERITIES, "a rule severity"),
      messageKey: text(field(ir, "messageKey"), "a message key"),
      messageParameters: decodeMessageParameters(field(ir, "messageParameters")),
    },
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: revision(field(map, "schemaRevision"), "a schema revision"),
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
 * Always the F03 key set — an F02 writer's absent roots are written as their
 * defaults.
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
  const map = exactKeys(
    raw,
    isF02 ? [...F02_MANIFEST_KEYS] : [...F03_MANIFEST_KEYS],
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
