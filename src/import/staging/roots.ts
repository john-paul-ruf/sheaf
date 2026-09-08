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
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import {
  asMap,
  boolean,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
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

export function decodeCellValue(value: DecodedValue): CellValueV1 {
  const map = asMap(value, "a cell value");
  const kind = oneOf(field(map, "kind"), CELL_KINDS, "a cell value kind");

  switch (kind) {
    case "text":
      return { kind, text: nfcText(field(map, "text"), "cell text") };
    case "decimal":
      return { kind, decimal: text(field(map, "decimal"), "a decimal") };
    case "date":
      return { kind, epochDay: Number(count(field(map, "epochDay"), "an epoch day")) };
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

const decodeFieldDef = (value: DecodedValue): FieldDefV1 => {
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

const decodeTableDef = (value: DecodedValue): TableDefV1 => {
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

const decodeEnumOption = (value: DecodedValue): EnumOptionDefV1 => {
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

export interface CheckpointManifestV1 {
  readonly manifestVersion: typeof VERSION;
  readonly appId: AppId;
  readonly schemaRevision: bigint;
  readonly frontier: readonly FrontierEntryV1[];
  readonly appState: AppStateRootV1;
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly sheetSnapshots: readonly {
    readonly sheetId: SheetId;
    readonly displayName: string;
    readonly sheetOrdinal: number;
    readonly snapshotManifestStorageId: string;
    readonly declaredRowCount: number | null;
    readonly declaredColumnCount: number | null;
  }[];
  readonly recordPages: readonly PageRefV1[];
  readonly semanticSha256: Uint8Array;
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

/** The exact bytes `semanticSha256` is computed over: the manifest sans hash. */
export function encodeCheckpointBody(
  manifest: Omit<CheckpointManifestV1, "semanticSha256">,
): Uint8Array {
  return encodeCanonical(
    cborMap([
      ["manifestVersion", manifest.manifestVersion],
      ["appId", manifest.appId],
      ["schemaRevision", manifest.schemaRevision],
      ["frontier", encodeFrontier(manifest.frontier)],
      ["appState", encodeAppState(manifest.appState)],
      ["tables", manifest.tables.map(encodeTableDef)],
      ["enumOptions", manifest.enumOptions.map(encodeEnumOption)],
      [
        "sheetSnapshots",
        manifest.sheetSnapshots.map((sheet) =>
          cborMap([
            ["sheetId", sheet.sheetId],
            ["displayName", sheet.displayName],
            ["sheetOrdinal", sheet.sheetOrdinal],
            ["snapshotManifestStorageId", sheet.snapshotManifestStorageId],
            ["declaredRowCount", integerOrNull(sheet.declaredRowCount)],
            ["declaredColumnCount", integerOrNull(sheet.declaredColumnCount)],
          ]),
        ),
      ],
      ["recordPages", manifest.recordPages.map(encodePageRef)],
    ]),
  );
}

export function encodeCheckpointManifest(manifest: CheckpointManifestV1): Uint8Array {
  const body = decodeCanonical(encodeCheckpointBody(manifest));
  const map = asMap(body, "a checkpoint manifest") as Map<string, CborValue>;
  map.set("semanticSha256", manifest.semanticSha256);
  return encodeCanonical(map);
}

export function decodeCheckpointManifest(payload: Uint8Array): CheckpointManifestV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a checkpoint manifest"),
    [
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
    ],
    "a checkpoint manifest",
  );
  if (count(field(map, "manifestVersion"), "a manifest version") !== VERSION) {
    throw new CodecError("checkpoint manifest declares an unsupported version");
  }

  return {
    manifestVersion: VERSION,
    appId: bytesOfLength(field(map, "appId"), ID_BYTES, "an app id") as AppId,
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
    frontier: decodeFrontier(field(map, "frontier")),
    appState: decodeAppState(field(map, "appState")),
    tables: list(field(map, "tables"), "tables").map(decodeTableDef),
    enumOptions: list(field(map, "enumOptions"), "enum options").map(decodeEnumOption),
    sheetSnapshots: list(field(map, "sheetSnapshots"), "sheet snapshots").map(
      (value) => {
        const sheet = exactKeys(
          asMap(value, "a sheet snapshot"),
          [
            "sheetId",
            "displayName",
            "sheetOrdinal",
            "snapshotManifestStorageId",
            "declaredRowCount",
            "declaredColumnCount",
          ],
          "a sheet snapshot",
        );
        return {
          sheetId: bytesOfLength(
            field(sheet, "sheetId"),
            ID_BYTES,
            "a sheet id",
          ) as SheetId,
          displayName: nfcText(field(sheet, "displayName"), "a sheet name"),
          sheetOrdinal: count(field(sheet, "sheetOrdinal"), "a sheet ordinal"),
          snapshotManifestStorageId: text(
            field(sheet, "snapshotManifestStorageId"),
            "a snapshot manifest id",
          ),
          declaredRowCount: optionalCount(
            field(sheet, "declaredRowCount"),
            "a declared row count",
          ),
          declaredColumnCount: optionalCount(
            field(sheet, "declaredColumnCount"),
            "a declared column count",
          ),
        };
      },
    ),
    recordPages: list(field(map, "recordPages"), "record pages").map(decodePageRef),
    semanticSha256: bytesOfLength(
      field(map, "semanticSha256"),
      SHA256_BYTES,
      "a semantic digest",
    ),
  };
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
