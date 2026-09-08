/**
 * The canonical-CBOR mapping for S03's proposal shapes (M23; CA-10/CA-16).
 *
 * A staged import survives a lock, a crash, and a reload, so everything the
 * review screen will read has to be durable — and durable in Sheaf means
 * canonical CBOR, byte-stable, inside an encrypted envelope. This file is that
 * mapping and nothing else: it adds no defaults, drops no field, and reorders
 * nothing, so `decode(encode(p))` is `p` and two equal proposals produce two
 * equal byte strings.
 *
 * It is deliberately explicit rather than reflective. A generic object→CBOR
 * converter would have to guess about `undefined` versus absent, `number`
 * versus `bigint`, and which unions are closed — and every one of those
 * guesses is a place a proposal could come back subtly different from the one
 * the user reviewed.
 *
 * The decoders below are also the **constraint layer**: a closed union decodes
 * only to its declared members, so a tampered or truncated stage payload fails
 * as a `CodecError` rather than becoming a proposal with an impossible field
 * type.
 */

import { CodecError } from "../../domain/model/errors.js";
import { isNfcText } from "../../domain/model/values.js";
import {
  INFERENCE_DISPOSITIONS,
  type InferenceDispositionV1,
} from "../../domain/model/events.js";
import type {
  CborKey,
  CborValue,
  DecodedKey,
  DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import {
  IMPORT_DIAGNOSTIC_CODES,
  type ImportDiagnosticCodeV1,
  type ImportDiagnosticV1,
} from "../formats/delimited/facts.js";
import {
  DISCARD_REASONS,
  type DiscardedRowV1,
  type DiscardReasonV1,
  type ProposedAppV1,
  type ProposedEnumOptionV1,
  type ProposedFieldV1,
  type ProposedRowV1,
  type ProposedTableV1,
  type TypeViolationsV1,
} from "../inference/infer.js";
import {
  INFERENCE_SUBJECTS,
  REVIEW_EDIT_KINDS,
  VALUE_PATTERNS,
  type EvidenceV1,
  type InferenceStatementV1,
  type InferenceSubjectV1,
  type ReviewEditKindV1,
  type ValuePatternV1,
} from "../inference/statements.js";
import type { ReviewEditV1 } from "../inference/review-edits.js";
import { FIELD_TYPE_KINDS } from "../../domain/model/schema.js";
import type { ProposedFieldTypeV1, SourceValueFormatV1 } from "../inference/values.js";

// ------------------------------------------------------------- primitives --

export const cborMap = (
  entries: readonly (readonly [string, CborValue])[],
): CborValue => new Map<CborKey, CborValue>(entries);

export const integerOrNull = (value: number | null): CborValue =>
  value === null ? null : value;

export function asMap(
  value: DecodedValue,
  what: string,
): ReadonlyMap<DecodedKey, DecodedValue> {
  if (!(value instanceof Map)) {
    throw new CodecError(`${what} is not a map`);
  }
  return value;
}

/** Every declared key must be present and no other key may be. */
export function exactKeys(
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  names: readonly string[],
  what: string,
): ReadonlyMap<DecodedKey, DecodedValue> {
  if (map.size !== names.length) {
    throw new CodecError(`${what} has unexpected fields`);
  }
  for (const name of names) {
    if (!map.has(name)) {
      throw new CodecError(`${what} is missing ${name}`);
    }
  }
  return map;
}

export function field(
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  name: string,
): DecodedValue {
  const value = map.get(name);
  if (value === undefined) {
    throw new CodecError(`a staged payload is missing ${name}`);
  }
  return value;
}

export function text(value: DecodedValue, what: string): string {
  if (typeof value !== "string") {
    throw new CodecError(`${what} is not text`);
  }
  return value;
}

/** Text that will re-enter the domain: NFC is the domain's standing rule. */
export function nfcText(value: DecodedValue, what: string): string {
  const decoded = text(value, what);
  if (!isNfcText(decoded)) {
    throw new CodecError(`${what} is not NFC`);
  }
  return decoded;
}

export function optionalText(value: DecodedValue, what: string): string | null {
  return value === null ? null : text(value, what);
}

/** Integers decode as `bigint`, so a decoded stage re-encodes byte-exactly. */
export function integer(value: DecodedValue, what: string): number {
  if (typeof value !== "bigint") {
    throw new CodecError(`${what} is not an integer`);
  }
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new CodecError(`${what} is outside the safe-integer range`);
  }
  return asNumber;
}

export function count(value: DecodedValue, what: string): number {
  const decoded = integer(value, what);
  if (decoded < 0) {
    throw new CodecError(`${what} is negative`);
  }
  return decoded;
}

export function optionalCount(value: DecodedValue, what: string): number | null {
  return value === null ? null : count(value, what);
}

export function boolean(value: DecodedValue, what: string): boolean {
  if (typeof value !== "boolean") {
    throw new CodecError(`${what} is not a boolean`);
  }
  return value;
}

export function bytesOfLength(
  value: DecodedValue,
  length: number,
  what: string,
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new CodecError(`${what} is not bytes`);
  }
  if (value.byteLength !== length) {
    throw new CodecError(`${what} must be ${length} bytes`);
  }
  return value;
}

export function list(
  value: DecodedValue,
  what: string,
): readonly DecodedValue[] {
  if (!Array.isArray(value)) {
    throw new CodecError(`${what} is not a list`);
  }
  return value as readonly DecodedValue[];
}

export function oneOf<T extends string>(
  value: DecodedValue,
  allowed: readonly T[],
  what: string,
): T {
  const candidate = text(value, what);
  const found = allowed.find((option) => option === candidate);
  if (found === undefined) {
    throw new CodecError(`${what} is not a member of its closed set`);
  }
  return found;
}

const textList = (value: DecodedValue, what: string): readonly string[] =>
  list(value, what).map((entry) => text(entry, what));

// -------------------------------------------------------------- diagnostics --

const DIAGNOSTIC_SEVERITIES = Object.freeze(["info", "warning"] as const);

export function encodeDiagnostic(diagnostic: ImportDiagnosticV1): CborValue {
  return cborMap([
    ["code", diagnostic.code],
    ["severity", diagnostic.severity],
    ["firstRowIndex", integerOrNull(diagnostic.firstRowIndex)],
    ["firstColumnIndex", integerOrNull(diagnostic.firstColumnIndex)],
    ["occurrences", diagnostic.occurrences],
  ]);
}

export function decodeDiagnostic(value: DecodedValue): ImportDiagnosticV1 {
  const map = exactKeys(
    asMap(value, "a diagnostic"),
    ["code", "severity", "firstRowIndex", "firstColumnIndex", "occurrences"],
    "a diagnostic",
  );
  return {
    code: oneOf<ImportDiagnosticCodeV1>(
      field(map, "code"),
      IMPORT_DIAGNOSTIC_CODES,
      "a diagnostic code",
    ),
    severity: oneOf(
      field(map, "severity"),
      DIAGNOSTIC_SEVERITIES,
      "a diagnostic severity",
    ),
    firstRowIndex: optionalCount(field(map, "firstRowIndex"), "a diagnostic row"),
    firstColumnIndex: optionalCount(
      field(map, "firstColumnIndex"),
      "a diagnostic column",
    ),
    occurrences: count(field(map, "occurrences"), "a diagnostic count"),
  };
}

// --------------------------------------------------------------- field type --

const PROPOSED_TYPE_KINDS = FIELD_TYPE_KINDS.filter(
  (kind) => kind !== "reference",
) as readonly Exclude<(typeof FIELD_TYPE_KINDS)[number], "reference">[];

export function encodeFieldType(type: ProposedFieldTypeV1): CborValue {
  return type.kind === "currency"
    ? cborMap([
        ["kind", "currency"],
        ["currencyCode", type.currencyCode],
      ])
    : cborMap([["kind", type.kind]]);
}

export function decodeFieldType(value: DecodedValue): ProposedFieldTypeV1 {
  const map = asMap(value, "a field type");
  const kind = oneOf(field(map, "kind"), PROPOSED_TYPE_KINDS, "a field type");
  if (kind === "currency") {
    exactKeys(map, ["kind", "currencyCode"], "a currency field type");
    return { kind, currencyCode: text(field(map, "currencyCode"), "a currency code") };
  }
  exactKeys(map, ["kind"], "a field type");
  return { kind };
}

const SOURCE_FORMAT_KINDS = Object.freeze([
  "text",
  "iso-date",
  "slash-date",
  "decimal",
  "boolean",
  "enum",
] as const);

const SLASH_ORDERS = Object.freeze(["dmy", "mdy"] as const);

export function encodeSourceFormat(format: SourceValueFormatV1): CborValue {
  switch (format.kind) {
    case "slash-date":
      return cborMap([
        ["kind", "slash-date"],
        ["order", format.order],
      ]);
    case "decimal":
      return cborMap([
        ["kind", "decimal"],
        ["currencySymbol", format.currencySymbol],
      ]);
    default:
      return cborMap([["kind", format.kind]]);
  }
}

export function decodeSourceFormat(value: DecodedValue): SourceValueFormatV1 {
  const map = asMap(value, "a source format");
  const kind = oneOf(field(map, "kind"), SOURCE_FORMAT_KINDS, "a source format");
  if (kind === "slash-date") {
    exactKeys(map, ["kind", "order"], "a slash-date format");
    return { kind, order: oneOf(field(map, "order"), SLASH_ORDERS, "a date order") };
  }
  if (kind === "decimal") {
    exactKeys(map, ["kind", "currencySymbol"], "a decimal format");
    return {
      kind,
      currencySymbol: optionalText(
        field(map, "currencySymbol"),
        "a currency symbol",
      ),
    };
  }
  exactKeys(map, ["kind"], "a source format");
  return { kind };
}

// ----------------------------------------------------------------- evidence --

const EVIDENCE_KINDS = Object.freeze([
  "value-pattern",
  "distinct-values",
  "header-text",
  "file-name",
  "row-shape",
  "value-conflict",
] as const);

const encodeConflictExample = (example: {
  readonly rowIndex: number;
  readonly sourceText: string;
}): CborValue =>
  cborMap([
    ["rowIndex", example.rowIndex],
    ["sourceText", example.sourceText],
  ]);

const decodeConflictExample = (
  value: DecodedValue,
): { readonly rowIndex: number; readonly sourceText: string } => {
  const map = exactKeys(
    asMap(value, "an example"),
    ["rowIndex", "sourceText"],
    "an example",
  );
  return {
    rowIndex: count(field(map, "rowIndex"), "an example row"),
    sourceText: nfcText(field(map, "sourceText"), "an example value"),
  };
};

export function encodeEvidence(evidence: EvidenceV1): CborValue {
  switch (evidence.kind) {
    case "value-pattern":
      return cborMap([
        ["kind", "value-pattern"],
        ["pattern", evidence.pattern],
        ["detail", evidence.detail],
        ["matched", evidence.matched],
        ["sampled", evidence.sampled],
        ["examples", [...evidence.examples]],
      ]);
    case "distinct-values":
      return cborMap([
        ["kind", "distinct-values"],
        ["distinct", evidence.distinct],
        ["sampled", evidence.sampled],
        ["options", [...evidence.options]],
      ]);
    case "header-text":
      return cborMap([
        ["kind", "header-text"],
        ["rowIndex", evidence.rowIndex],
        ["text", evidence.text],
      ]);
    case "file-name":
      return cborMap([
        ["kind", "file-name"],
        ["fileName", evidence.fileName],
      ]);
    case "row-shape":
      return cborMap([
        ["kind", "row-shape"],
        ["rowIndex", evidence.rowIndex],
        ["cellCount", evidence.cellCount],
        ["valueCount", evidence.valueCount],
      ]);
    case "value-conflict":
      return cborMap([
        ["kind", "value-conflict"],
        ["count", evidence.count],
        ["examples", evidence.examples.map(encodeConflictExample)],
      ]);
    default: {
      const unreachable: never = evidence;
      return unreachable;
    }
  }
}

export function decodeEvidence(value: DecodedValue): EvidenceV1 {
  const map = asMap(value, "evidence");
  const kind = oneOf(field(map, "kind"), EVIDENCE_KINDS, "an evidence kind");

  switch (kind) {
    case "value-pattern":
      exactKeys(
        map,
        ["kind", "pattern", "detail", "matched", "sampled", "examples"],
        "pattern evidence",
      );
      return {
        kind,
        pattern: oneOf<ValuePatternV1>(
          field(map, "pattern"),
          VALUE_PATTERNS,
          "a value pattern",
        ),
        detail: optionalText(field(map, "detail"), "a pattern detail"),
        matched: count(field(map, "matched"), "a matched count"),
        sampled: count(field(map, "sampled"), "a sampled count"),
        examples: textList(field(map, "examples"), "a pattern example"),
      };
    case "distinct-values":
      exactKeys(
        map,
        ["kind", "distinct", "sampled", "options"],
        "distinct-value evidence",
      );
      return {
        kind,
        distinct: count(field(map, "distinct"), "a distinct count"),
        sampled: count(field(map, "sampled"), "a sampled count"),
        options: textList(field(map, "options"), "an option label"),
      };
    case "header-text":
      exactKeys(map, ["kind", "rowIndex", "text"], "header evidence");
      return {
        kind,
        rowIndex: count(field(map, "rowIndex"), "a header row"),
        text: text(field(map, "text"), "header text"),
      };
    case "file-name":
      exactKeys(map, ["kind", "fileName"], "file-name evidence");
      return { kind, fileName: text(field(map, "fileName"), "a file name") };
    case "row-shape":
      exactKeys(
        map,
        ["kind", "rowIndex", "cellCount", "valueCount"],
        "row-shape evidence",
      );
      return {
        kind,
        rowIndex: count(field(map, "rowIndex"), "a row index"),
        cellCount: count(field(map, "cellCount"), "a cell count"),
        valueCount: count(field(map, "valueCount"), "a value count"),
      };
    case "value-conflict":
      exactKeys(map, ["kind", "count", "examples"], "conflict evidence");
      return {
        kind,
        count: count(field(map, "count"), "a conflict count"),
        examples: list(field(map, "examples"), "a conflict example").map(
          decodeConflictExample,
        ),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------- statements --

export function encodeStatement(statement: InferenceStatementV1): CborValue {
  return cborMap([
    ["statementId", statement.statementId],
    ["subject", statement.subject],
    ["editKind", statement.editKind],
    ["columnIndex", integerOrNull(statement.columnIndex)],
    ["evidence", statement.evidence.map(encodeEvidence)],
    ["evidenceFingerprint", statement.evidenceFingerprint],
    ["disposition", statement.disposition],
  ]);
}

export function decodeStatement(value: DecodedValue): InferenceStatementV1 {
  const map = exactKeys(
    asMap(value, "a statement"),
    [
      "statementId",
      "subject",
      "editKind",
      "columnIndex",
      "evidence",
      "evidenceFingerprint",
      "disposition",
    ],
    "a statement",
  );
  const editKind = field(map, "editKind");
  return {
    statementId: text(field(map, "statementId"), "a statement id"),
    subject: oneOf<InferenceSubjectV1>(
      field(map, "subject"),
      INFERENCE_SUBJECTS,
      "a statement subject",
    ),
    editKind:
      editKind === null
        ? null
        : oneOf<ReviewEditKindV1>(editKind, REVIEW_EDIT_KINDS, "an edit kind"),
    columnIndex: optionalCount(field(map, "columnIndex"), "a statement column"),
    evidence: list(field(map, "evidence"), "statement evidence").map(
      decodeEvidence,
    ),
    evidenceFingerprint: text(
      field(map, "evidenceFingerprint"),
      "an evidence fingerprint",
    ),
    disposition: oneOf<InferenceDispositionV1>(
      field(map, "disposition"),
      INFERENCE_DISPOSITIONS,
      "a disposition",
    ),
  };
}

// -------------------------------------------------------------------- fields --

const encodeEnumOption = (option: ProposedEnumOptionV1): CborValue =>
  cborMap([
    ["label", option.label],
    ["occurrences", option.occurrences],
  ]);

const decodeEnumOption = (value: DecodedValue): ProposedEnumOptionV1 => {
  const map = exactKeys(
    asMap(value, "an enum option"),
    ["label", "occurrences"],
    "an enum option",
  );
  return {
    label: nfcText(field(map, "label"), "an option label"),
    occurrences: count(field(map, "occurrences"), "an option count"),
  };
};

const encodeViolations = (violations: TypeViolationsV1 | null): CborValue =>
  violations === null
    ? null
    : cborMap([
        ["count", violations.count],
        ["examples", violations.examples.map(encodeConflictExample)],
      ]);

const decodeViolations = (value: DecodedValue): TypeViolationsV1 | null => {
  if (value === null) {
    // Null is the measured-nothing-yet state a header move leaves behind
    // (S03): it must never decode to a zero, which would read as "none".
    return null;
  }
  const map = exactKeys(
    asMap(value, "violations"),
    ["count", "examples"],
    "violations",
  );
  return {
    count: count(field(map, "count"), "a violation count"),
    examples: list(field(map, "examples"), "a violation example").map(
      decodeConflictExample,
    ),
  };
};

export function encodeProposedField(field_: ProposedFieldV1): CborValue {
  return cborMap([
    ["columnIndex", field_.columnIndex],
    ["fieldName", field_.fieldName],
    ["isNameGenerated", field_.isNameGenerated],
    ["type", encodeFieldType(field_.type)],
    ["sourceFormat", encodeSourceFormat(field_.sourceFormat)],
    ["enumOptions", field_.enumOptions.map(encodeEnumOption)],
    ["violations", encodeViolations(field_.violations)],
  ]);
}

export function decodeProposedField(value: DecodedValue): ProposedFieldV1 {
  const map = exactKeys(
    asMap(value, "a proposed field"),
    [
      "columnIndex",
      "fieldName",
      "isNameGenerated",
      "type",
      "sourceFormat",
      "enumOptions",
      "violations",
    ],
    "a proposed field",
  );
  return {
    columnIndex: count(field(map, "columnIndex"), "a field column"),
    fieldName: nfcText(field(map, "fieldName"), "a field name"),
    isNameGenerated: boolean(field(map, "isNameGenerated"), "a generated flag"),
    type: decodeFieldType(field(map, "type")),
    sourceFormat: decodeSourceFormat(field(map, "sourceFormat")),
    enumOptions: list(field(map, "enumOptions"), "enum options").map(
      decodeEnumOption,
    ),
    violations: decodeViolations(field(map, "violations")),
  };
}

// ---------------------------------------------------------------------- rows --

const encodeRow = (row: ProposedRowV1): CborValue =>
  cborMap([
    ["rowIndex", row.rowIndex],
    ["cells", [...row.cells]],
  ]);

const decodeRow = (value: DecodedValue): ProposedRowV1 => {
  const map = exactKeys(
    asMap(value, "a row"),
    ["rowIndex", "cells"],
    "a row",
  );
  return {
    rowIndex: count(field(map, "rowIndex"), "a row index"),
    cells: textList(field(map, "cells"), "a cell"),
  };
};

const encodeDiscardedRow = (row: DiscardedRowV1): CborValue =>
  cborMap([
    ["rowIndex", row.rowIndex],
    ["reason", row.reason],
    ["cells", [...row.cells]],
  ]);

const decodeDiscardedRow = (value: DecodedValue): DiscardedRowV1 => {
  const map = exactKeys(
    asMap(value, "a discarded row"),
    ["rowIndex", "reason", "cells"],
    "a discarded row",
  );
  return {
    rowIndex: count(field(map, "rowIndex"), "a discarded row index"),
    reason: oneOf<DiscardReasonV1>(
      field(map, "reason"),
      DISCARD_REASONS,
      "a discard reason",
    ),
    cells: textList(field(map, "cells"), "a discarded cell"),
  };
};

// ------------------------------------------------------------------ proposal --

const encodeTable = (table: ProposedTableV1): CborValue =>
  cborMap([
    ["tableName", table.tableName],
    ["fields", table.fields.map(encodeProposedField)],
  ]);

const decodeTable = (value: DecodedValue): ProposedTableV1 => {
  const map = exactKeys(
    asMap(value, "a proposed table"),
    ["tableName", "fields"],
    "a proposed table",
  );
  return {
    tableName: nfcText(field(map, "tableName"), "a table name"),
    fields: list(field(map, "fields"), "proposed fields").map(decodeProposedField),
  };
};

export function encodeProposal(proposal: ProposedAppV1): CborValue {
  return cborMap([
    ["fileName", proposal.fileName],
    ["appName", proposal.appName],
    ["table", encodeTable(proposal.table)],
    ["headerRowIndex", integerOrNull(proposal.headerRowIndex)],
    ["leadingRows", proposal.leadingRows.map(encodeRow)],
    ["discardedRows", proposal.discardedRows.map(encodeDiscardedRow)],
    ["discardedRowCount", proposal.discardedRowCount],
    ["rowCount", proposal.rowCount],
    ["statements", proposal.statements.map(encodeStatement)],
    ["diagnostics", proposal.diagnostics.map(encodeDiagnostic)],
  ]);
}

/**
 * `isRowCountExact` is not on the wire. It is the literal `true` in S03's
 * type — a proposal only ever comes from a completed stream — so storing it
 * would create a byte a tamperer could flip into a lie the type says cannot
 * exist.
 */
export function decodeProposal(value: DecodedValue): ProposedAppV1 {
  const map = exactKeys(
    asMap(value, "a proposal"),
    [
      "fileName",
      "appName",
      "table",
      "headerRowIndex",
      "leadingRows",
      "discardedRows",
      "discardedRowCount",
      "rowCount",
      "statements",
      "diagnostics",
    ],
    "a proposal",
  );
  return {
    fileName: text(field(map, "fileName"), "a file name"),
    appName: nfcText(field(map, "appName"), "an app name"),
    table: decodeTable(field(map, "table")),
    headerRowIndex: optionalCount(field(map, "headerRowIndex"), "a header row"),
    leadingRows: list(field(map, "leadingRows"), "leading rows").map(decodeRow),
    discardedRows: list(field(map, "discardedRows"), "discarded rows").map(
      decodeDiscardedRow,
    ),
    discardedRowCount: count(
      field(map, "discardedRowCount"),
      "a discarded row count",
    ),
    rowCount: count(field(map, "rowCount"), "a row count"),
    isRowCountExact: true,
    statements: list(field(map, "statements"), "statements").map(decodeStatement),
    diagnostics: list(field(map, "diagnostics"), "diagnostics").map(
      decodeDiagnostic,
    ),
  };
}

// -------------------------------------------------------------- review edits --

export function encodeReviewEdit(edit: ReviewEditV1): CborValue {
  switch (edit.kind) {
    case "rename-app":
      return cborMap([
        ["kind", "rename-app"],
        ["appName", edit.appName],
      ]);
    case "rename-table":
      return cborMap([
        ["kind", "rename-table"],
        ["tableName", edit.tableName],
      ]);
    case "rename-field":
      return cborMap([
        ["kind", "rename-field"],
        ["columnIndex", edit.columnIndex],
        ["fieldName", edit.fieldName],
      ]);
    case "override-type":
      return cborMap([
        ["kind", "override-type"],
        ["columnIndex", edit.columnIndex],
        ["type", encodeFieldType(edit.type)],
      ]);
    case "set-header-row":
      return cborMap([
        ["kind", "set-header-row"],
        ["rowIndex", integerOrNull(edit.rowIndex)],
      ]);
    case "edit-enum-options":
      return cborMap([
        ["kind", "edit-enum-options"],
        ["columnIndex", edit.columnIndex],
        ["options", [...edit.options]],
      ]);
    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
}

export function decodeReviewEdit(value: DecodedValue): ReviewEditV1 {
  const map = asMap(value, "a review edit");
  const kind = oneOf(field(map, "kind"), REVIEW_EDIT_KINDS, "a review edit kind");

  switch (kind) {
    case "rename-app":
      exactKeys(map, ["kind", "appName"], "a rename-app edit");
      return { kind, appName: text(field(map, "appName"), "an app name") };
    case "rename-table":
      exactKeys(map, ["kind", "tableName"], "a rename-table edit");
      return { kind, tableName: text(field(map, "tableName"), "a table name") };
    case "rename-field":
      exactKeys(map, ["kind", "columnIndex", "fieldName"], "a rename-field edit");
      return {
        kind,
        columnIndex: count(field(map, "columnIndex"), "an edit column"),
        fieldName: text(field(map, "fieldName"), "a field name"),
      };
    case "override-type":
      exactKeys(map, ["kind", "columnIndex", "type"], "an override-type edit");
      return {
        kind,
        columnIndex: count(field(map, "columnIndex"), "an edit column"),
        type: decodeFieldType(field(map, "type")),
      };
    case "set-header-row":
      exactKeys(map, ["kind", "rowIndex"], "a set-header-row edit");
      return {
        kind,
        rowIndex: optionalCount(field(map, "rowIndex"), "a header row"),
      };
    case "edit-enum-options":
      exactKeys(map, ["kind", "columnIndex", "options"], "an enum-options edit");
      return {
        kind,
        columnIndex: count(field(map, "columnIndex"), "an edit column"),
        options: textList(field(map, "options"), "an option label"),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
