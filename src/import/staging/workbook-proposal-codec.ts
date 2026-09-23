/**
 * The canonical-CBOR mapping for S02's workbook proposal, its statements and
 * its review edits (M23; CA-19).
 *
 * The staged proposal is authoritative for review (D17) and survives a lock or
 * a reload, so it is durable — canonical, byte-stable, and decoded as the
 * constraint layer it is in `proposal-codec.ts`: exact keys, closed sets only,
 * integers as `bigint` on the way in, no defaults and no reordering. So
 * `decode(encode(p))` is `p`, and a tampered or truncated stage fails as a
 * `CodecError` rather than becoming a proposal with an impossible member.
 *
 * It lives beside F02's `proposal-codec.ts` (Custom Rule 7) and reuses its
 * primitives and its F02 evidence/field-type/source-format mappings, because
 * S02's workbook vocabulary is their strict superset (additive, D32).
 */

import {
  FORMULA_DETERMINISMS,
  FORMULA_DISPOSITIONS,
  FORMULA_TARGET_KINDS,
  isAllowedClassification,
} from "../../domain/formulas/index.js";
import { CodecError } from "../../domain/model/errors.js";
import { INFERENCE_DISPOSITIONS } from "../../domain/model/events.js";
import { FIELD_TYPE_KINDS, RELATIONSHIP_DETECTION_SOURCES, type FieldTypeV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { CborValue, DecodedKey, DecodedValue } from "../../persistence/codecs/canonical-cbor.js";
import {
  FORMAT_CLASSES,
  IMPORT_DIAGNOSTIC_CODES,
  PRESERVED_PART_KINDS,
  PRESERVED_REASON_KEYS,
  SHEET_KINDS,
  SHEET_VISIBILITIES,
  VALIDATION_OPERATORS,
  VALIDATION_RULES,
  type ImportDiagnosticV2,
  type PreservedPartKindV1,
  type RangeV1,
  type ValidationListSourceV1,
} from "../facts/index.js";
import { WORKBOOK_DISCARD_REASONS, type ProposedRowV1, type WorkbookDiscardedRowV1 } from "../inference/regions.js";
import type { WorkbookReviewEditV1 } from "../inference/review-edits.js";
import {
  WORKBOOK_INFERENCE_SUBJECTS,
  WORKBOOK_REVIEW_EDIT_KINDS,
  type WorkbookEvidenceV1,
  type WorkbookStatementV1,
} from "../inference/statements.js";
import type { WorkbookSourceValueFormatV1 } from "../inference/values.js";
import {
  FORMULA_KEEP_REASONS,
  PROPOSED_CHART_TYPES,
  SHEET_ROLES,
  type ProposedChartV1,
  type ProposedFormulaV1,
  type ProposedInertItemV1,
  type ProposedRecordRuleV1,
  type ProposedRelationshipV1,
  type ProposedRuleConditionV1,
  type ProposedSheetV1,
  type ProposedTableV2,
  type ProposedWorkbookFieldV1,
  type ProposedWorkbookV1,
  type RelationshipCandidateV1,
} from "../inference/workbook-proposal.js";
import {
  asMap,
  boolean,
  cborMap,
  count,
  decodeEvidence,
  decodeFieldType,
  decodeSourceFormat,
  encodeEvidence,
  encodeFieldType,
  encodeSourceFormat,
  exactKeys,
  field,
  integer,
  integerOrNull,
  list,
  nfcText,
  oneOf,
  optionalCount,
  optionalText,
  text,
} from "./proposal-codec.js";

type DecodedMap = ReadonlyMap<DecodedKey, DecodedValue>;

const texts = (value: DecodedValue, what: string): readonly string[] => list(value, what).map((entry) => text(entry, what));
const optional = <T>(value: DecodedValue, decode: (value: DecodedValue) => T): T | null =>
  value === null ? null : decode(value);
/** A map with exactly `names`, read after its `kind` chose them. */
const keyed = (map: DecodedMap, names: readonly string[], what: string): DecodedMap => exactKeys(map, names, what);

// -------------------------------------------------------------- primitives --

const encodeRange = (range: RangeV1): CborValue =>
  cborMap([
    ["firstRow", range.firstRow],
    ["firstColumn", range.firstColumn],
    ["lastRow", range.lastRow],
    ["lastColumn", range.lastColumn],
  ]);

const decodeRange = (value: DecodedValue): RangeV1 => {
  const map = exactKeys(asMap(value, "a range"), ["firstRow", "firstColumn", "lastRow", "lastColumn"], "a range");
  return {
    firstRow: count(field(map, "firstRow"), "a first row"),
    firstColumn: count(field(map, "firstColumn"), "a first column"),
    lastRow: count(field(map, "lastRow"), "a last row"),
    lastColumn: count(field(map, "lastColumn"), "a last column"),
  };
};

const encodeListSource = (source: ValidationListSourceV1 | null): CborValue =>
  source === null
    ? null
    : source.kind === "inline"
      ? cborMap([
          ["kind", "inline"],
          ["values", [...source.values]],
        ])
      : cborMap([
          ["kind", "range"],
          ["ref", source.ref],
        ]);

const decodeListSource = (value: DecodedValue): ValidationListSourceV1 => {
  const map = asMap(value, "a list source");
  const kind = oneOf(field(map, "kind"), ["inline", "range"] as const, "a list source kind");
  return kind === "inline"
    ? { kind, values: texts(field(keyed(map, ["kind", "values"], "an inline list"), "values"), "a list value") }
    : { kind, ref: text(field(keyed(map, ["kind", "ref"], "a range list"), "ref"), "a list reference") };
};

const DIAGNOSTIC_SEVERITIES = Object.freeze(["info", "warning"] as const);

const encodeDiagnosticV2 = (diagnostic: ImportDiagnosticV2): CborValue =>
  cborMap([
    ["code", diagnostic.code],
    ["severity", diagnostic.severity],
    ["firstRowIndex", integerOrNull(diagnostic.firstRowIndex)],
    ["firstColumnIndex", integerOrNull(diagnostic.firstColumnIndex)],
    ["occurrences", diagnostic.occurrences],
  ]);

const decodeDiagnosticV2 = (value: DecodedValue): ImportDiagnosticV2 => {
  const map = exactKeys(
    asMap(value, "a diagnostic"),
    ["code", "severity", "firstRowIndex", "firstColumnIndex", "occurrences"],
    "a diagnostic",
  );
  return {
    code: oneOf(field(map, "code"), IMPORT_DIAGNOSTIC_CODES, "a diagnostic code"),
    severity: oneOf(field(map, "severity"), DIAGNOSTIC_SEVERITIES, "a diagnostic severity"),
    firstRowIndex: optionalCount(field(map, "firstRowIndex"), "a diagnostic row"),
    firstColumnIndex: optionalCount(field(map, "firstColumnIndex"), "a diagnostic column"),
    occurrences: count(field(map, "occurrences"), "a diagnostic count"),
  };
};

// ------------------------------------------------------------ field typing --

const encodeWorkbookFieldType = (type: FieldTypeV1): CborValue =>
  type.kind === "reference" ? cborMap([["kind", "reference"]]) : encodeFieldType(type);

const decodeWorkbookFieldType = (value: DecodedValue): FieldTypeV1 => {
  const map = asMap(value, "a field type");
  if (oneOf(field(map, "kind"), FIELD_TYPE_KINDS, "a field type") === "reference") {
    exactKeys(map, ["kind"], "a reference field type");
    return { kind: "reference" };
  }
  return decodeFieldType(value);
};

const DATE_SYSTEMS = Object.freeze(["1900", "1904"] as const);

const encodeWorkbookSourceFormat = (format: WorkbookSourceValueFormatV1): CborValue =>
  format.kind === "serial-date"
    ? cborMap([
        ["kind", "serial-date"],
        ["system", format.system],
      ])
    : encodeSourceFormat(format);

const decodeWorkbookSourceFormat = (value: DecodedValue): WorkbookSourceValueFormatV1 => {
  const map = asMap(value, "a source format");
  if (field(map, "kind") === "serial-date") {
    exactKeys(map, ["kind", "system"], "a serial-date format");
    return { kind: "serial-date", system: oneOf(field(map, "system"), DATE_SYSTEMS, "a date system") };
  }
  return decodeSourceFormat(value);
};

// ---------------------------------------------------------------- evidence --

const WORKBOOK_EVIDENCE_KINDS = Object.freeze([
  "declared-table",
  "number-format",
  "validation-rule",
  "lookup-formula",
  "key-match",
  "matching-headings",
  "blank-row-gap",
  "column-gap",
  "formula-text",
  "sheet-shape",
  "preserved-part",
  "previously-rejected",
  "formula-outcome",
  "chart-mapping",
] as const);

type WorkbookOnlyEvidenceKind = (typeof WORKBOOK_EVIDENCE_KINDS)[number];

const CHART_MAPPING_KEYS = [
  "kind",
  "chartType",
  "chartName",
  "tableName",
  "groupFieldName",
  "measure",
  "measureFieldName",
  "xFieldName",
  "yFieldName",
  "categoriesRepeat",
];

const CHART_MEASURE_KINDS = Object.freeze(["count", "sum", "average", "min", "max"] as const);

const FORMULA_OUTCOME_KEYS = [
  "kind",
  "target",
  "disposition",
  "determinism",
  "reason",
  "detail",
  "shapeMatchCount",
  "rowCount",
  "shapeBreakRowIndex",
  "relatedTableName",
];

const isWorkbookOnly = (kind: string): kind is WorkbookOnlyEvidenceKind =>
  (WORKBOOK_EVIDENCE_KINDS as readonly string[]).includes(kind);

export function encodeWorkbookEvidence(evidence: WorkbookEvidenceV1): CborValue {
  switch (evidence.kind) {
    case "declared-table":
      return cborMap([
        ["kind", evidence.kind],
        ["name", evidence.name],
        ["range", encodeRange(evidence.range)],
        ["headerRowCount", evidence.headerRowCount],
        ["totalsRowCount", evidence.totalsRowCount],
      ]);
    case "number-format":
      return cborMap([
        ["kind", evidence.kind],
        ["numberFormat", evidence.numberFormat],
        ["formatClass", evidence.formatClass],
        ["currencySymbol", evidence.currencySymbol],
        ["matched", evidence.matched],
        ["sampled", evidence.sampled],
      ]);
    case "validation-rule":
      return cborMap([
        ["kind", evidence.kind],
        ["rule", evidence.rule],
        ["operator", evidence.operator],
        ["listSource", encodeListSource(evidence.listSource)],
        ["formula1", evidence.formula1],
        ["formula2", evidence.formula2],
        ["listOptions", evidence.listOptions === null ? null : [...evidence.listOptions]],
      ]);
    case "lookup-formula":
      return cborMap([
        ["kind", evidence.kind],
        ["functionName", evidence.functionName],
        ["formulaText", evidence.formulaText],
        ["parentSheetName", evidence.parentSheetName],
        ["parentTableName", evidence.parentTableName],
        ["parentColumnName", evidence.parentColumnName],
        ["outcome", evidence.outcome],
      ]);
    case "key-match":
      return cborMap([
        ["kind", evidence.kind],
        ["parentTableName", evidence.parentTableName],
        ["parentColumnName", evidence.parentColumnName],
        ["matched", evidence.matched],
        ["measured", evidence.measured],
        ["isSampled", evidence.isSampled],
      ]);
    case "matching-headings":
      return cborMap([
        ["kind", evidence.kind],
        ["headings", [...evidence.headings]],
        ["rowIndex", evidence.rowIndex],
      ]);
    case "blank-row-gap":
      return cborMap([
        ["kind", evidence.kind],
        ["afterRowIndex", evidence.afterRowIndex],
        ["beforeRowIndex", evidence.beforeRowIndex],
      ]);
    case "column-gap":
      return cborMap([
        ["kind", evidence.kind],
        ["afterColumnIndex", evidence.afterColumnIndex],
        ["beforeColumnIndex", evidence.beforeColumnIndex],
      ]);
    case "formula-text":
      return cborMap([
        ["kind", evidence.kind],
        ["text", evidence.text],
        ["isArray", evidence.isArray],
        ["isExternal", evidence.isExternal],
        ["formulaCount", evidence.formulaCount],
      ]);
    case "sheet-shape":
      return cborMap([
        ["kind", evidence.kind],
        ["sheetName", evidence.sheetName],
        ["sheetKind", evidence.sheetKind],
        ["usedCellCount", evidence.usedCellCount],
        ["formulaCellCount", evidence.formulaCellCount],
        ["tableCount", evidence.tableCount],
      ]);
    case "preserved-part":
      return cborMap([
        ["kind", evidence.kind],
        ["partKind", evidence.partKind],
        ["count", evidence.count],
      ]);
    case "previously-rejected":
      return cborMap([["kind", evidence.kind]]);
    case "formula-outcome":
      return cborMap([
        ["kind", evidence.kind],
        ["target", evidence.target],
        ["disposition", evidence.disposition],
        ["determinism", evidence.determinism],
        ["reason", evidence.reason],
        ["detail", evidence.detail],
        ["shapeMatchCount", evidence.shapeMatchCount],
        ["rowCount", integerOrNull(evidence.rowCount)],
        ["shapeBreakRowIndex", integerOrNull(evidence.shapeBreakRowIndex)],
        ["relatedTableName", evidence.relatedTableName],
      ]);
    case "chart-mapping":
      return cborMap([
        ["kind", evidence.kind],
        ["chartType", evidence.chartType],
        ["chartName", evidence.chartName],
        ["tableName", evidence.tableName],
        ["groupFieldName", evidence.groupFieldName],
        ["measure", evidence.measure],
        ["measureFieldName", evidence.measureFieldName],
        ["xFieldName", evidence.xFieldName],
        ["yFieldName", evidence.yFieldName],
        ["categoriesRepeat", evidence.categoriesRepeat],
      ]);
    default:
      return encodeEvidence(evidence);
  }
}

export function decodeWorkbookEvidence(value: DecodedValue): WorkbookEvidenceV1 {
  const map = asMap(value, "evidence");
  const kind = text(field(map, "kind"), "an evidence kind");
  if (!isWorkbookOnly(kind)) {
    return decodeEvidence(value);
  }
  switch (kind) {
    case "declared-table": {
      const m = keyed(map, ["kind", "name", "range", "headerRowCount", "totalsRowCount"], "declared-table evidence");
      return {
        kind,
        name: text(field(m, "name"), "a table name"),
        range: decodeRange(field(m, "range")),
        headerRowCount: count(field(m, "headerRowCount"), "a header row count"),
        totalsRowCount: count(field(m, "totalsRowCount"), "a totals row count"),
      };
    }
    case "number-format": {
      const m = keyed(
        map,
        ["kind", "numberFormat", "formatClass", "currencySymbol", "matched", "sampled"],
        "number-format evidence",
      );
      return {
        kind,
        numberFormat: text(field(m, "numberFormat"), "a number format"),
        formatClass: oneOf(field(m, "formatClass"), FORMAT_CLASSES, "a format class"),
        currencySymbol: optionalText(field(m, "currencySymbol"), "a currency symbol"),
        matched: count(field(m, "matched"), "a matched count"),
        sampled: count(field(m, "sampled"), "a sampled count"),
      };
    }
    case "validation-rule": {
      const m = keyed(
        map,
        ["kind", "rule", "operator", "listSource", "formula1", "formula2", "listOptions"],
        "validation evidence",
      );
      const operator = field(m, "operator");
      const listOptions = field(m, "listOptions");
      return {
        kind,
        rule: oneOf(field(m, "rule"), VALIDATION_RULES, "a validation rule"),
        operator: operator === null ? null : oneOf(operator, VALIDATION_OPERATORS, "a validation operator"),
        listSource: optional(field(m, "listSource"), decodeListSource),
        formula1: optionalText(field(m, "formula1"), "a validation formula"),
        formula2: optionalText(field(m, "formula2"), "a validation formula"),
        listOptions: listOptions === null ? null : texts(listOptions, "a list option"),
      };
    }
    case "lookup-formula": {
      const m = keyed(
        map,
        ["kind", "functionName", "formulaText", "parentSheetName", "parentTableName", "parentColumnName", "outcome"],
        "lookup evidence",
      );
      return {
        kind,
        functionName: text(field(m, "functionName"), "a function name"),
        formulaText: text(field(m, "formulaText"), "a formula"),
        parentSheetName: text(field(m, "parentSheetName"), "a sheet name"),
        parentTableName: text(field(m, "parentTableName"), "a table name"),
        parentColumnName: text(field(m, "parentColumnName"), "a column name"),
        outcome: oneOf(field(m, "outcome"), ["relationship", "parent-key-differs"] as const, "a lookup outcome"),
      };
    }
    case "key-match": {
      const m = keyed(
        map,
        ["kind", "parentTableName", "parentColumnName", "matched", "measured", "isSampled"],
        "key-match evidence",
      );
      return {
        kind,
        parentTableName: text(field(m, "parentTableName"), "a table name"),
        parentColumnName: text(field(m, "parentColumnName"), "a column name"),
        matched: count(field(m, "matched"), "a matched count"),
        measured: count(field(m, "measured"), "a measured count"),
        isSampled: boolean(field(m, "isSampled"), "a sampled flag"),
      };
    }
    case "matching-headings": {
      const m = keyed(map, ["kind", "headings", "rowIndex"], "heading evidence");
      return { kind, headings: texts(field(m, "headings"), "a heading"), rowIndex: count(field(m, "rowIndex"), "a row") };
    }
    case "blank-row-gap": {
      const m = keyed(map, ["kind", "afterRowIndex", "beforeRowIndex"], "row-gap evidence");
      return {
        kind,
        afterRowIndex: count(field(m, "afterRowIndex"), "a row"),
        beforeRowIndex: count(field(m, "beforeRowIndex"), "a row"),
      };
    }
    case "column-gap": {
      const m = keyed(map, ["kind", "afterColumnIndex", "beforeColumnIndex"], "column-gap evidence");
      return {
        kind,
        afterColumnIndex: count(field(m, "afterColumnIndex"), "a column"),
        beforeColumnIndex: count(field(m, "beforeColumnIndex"), "a column"),
      };
    }
    case "formula-text": {
      const m = keyed(map, ["kind", "text", "isArray", "isExternal", "formulaCount"], "formula evidence");
      return {
        kind,
        text: optionalText(field(m, "text"), "a formula"),
        isArray: boolean(field(m, "isArray"), "an array flag"),
        isExternal: boolean(field(m, "isExternal"), "an external flag"),
        formulaCount: count(field(m, "formulaCount"), "a formula count"),
      };
    }
    case "sheet-shape": {
      const m = keyed(
        map,
        ["kind", "sheetName", "sheetKind", "usedCellCount", "formulaCellCount", "tableCount"],
        "sheet-shape evidence",
      );
      return {
        kind,
        sheetName: text(field(m, "sheetName"), "a sheet name"),
        sheetKind: oneOf(field(m, "sheetKind"), SHEET_KINDS, "a sheet kind"),
        usedCellCount: count(field(m, "usedCellCount"), "a cell count"),
        formulaCellCount: count(field(m, "formulaCellCount"), "a formula count"),
        tableCount: count(field(m, "tableCount"), "a table count"),
      };
    }
    case "preserved-part": {
      const m = keyed(map, ["kind", "partKind", "count"], "preserved-part evidence");
      return {
        kind,
        partKind: oneOf(field(m, "partKind"), PRESERVED_PART_KINDS, "a part kind"),
        count: count(field(m, "count"), "a part count"),
      };
    }
    case "previously-rejected":
      keyed(map, ["kind"], "rejection evidence");
      return { kind };
    case "formula-outcome": {
      const m = keyed(map, FORMULA_OUTCOME_KEYS, "formula outcome evidence");
      const disposition = oneOf(field(m, "disposition"), FORMULA_DISPOSITIONS, "a formula disposition");
      const determinism = oneOf(field(m, "determinism"), FORMULA_DETERMINISMS, "a formula determinism");
      if (!isAllowedClassification(disposition, determinism)) {
        throw new CodecError("a formula outcome's disposition and determinism are not a legal pair");
      }
      const reason = field(m, "reason");
      return {
        kind,
        target: oneOf(field(m, "target"), FORMULA_TARGET_KINDS, "a formula target"),
        disposition,
        determinism,
        reason: reason === null ? null : oneOf(reason, FORMULA_KEEP_REASONS, "a formula reason"),
        detail: optionalText(field(m, "detail"), "a formula detail"),
        shapeMatchCount: count(field(m, "shapeMatchCount"), "a shape count"),
        rowCount: optionalCount(field(m, "rowCount"), "a row count"),
        shapeBreakRowIndex: optionalCount(field(m, "shapeBreakRowIndex"), "a row"),
        relatedTableName: optionalText(field(m, "relatedTableName"), "a table name"),
      };
    }
    case "chart-mapping": {
      const m = keyed(map, CHART_MAPPING_KEYS, "chart mapping evidence");
      const measure = field(m, "measure");
      return {
        kind,
        chartType: oneOf(field(m, "chartType"), PROPOSED_CHART_TYPES, "a chart type"),
        chartName: text(field(m, "chartName"), "a chart name"),
        tableName: text(field(m, "tableName"), "a table name"),
        groupFieldName: optionalText(field(m, "groupFieldName"), "a field name"),
        measure: measure === null ? null : oneOf(measure, CHART_MEASURE_KINDS, "a chart measure"),
        measureFieldName: optionalText(field(m, "measureFieldName"), "a field name"),
        xFieldName: optionalText(field(m, "xFieldName"), "a field name"),
        yFieldName: optionalText(field(m, "yFieldName"), "a field name"),
        categoriesRepeat: boolean(field(m, "categoriesRepeat"), "a repeat flag"),
      };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

// --------------------------------------------------------------- statements --

export function encodeWorkbookStatement(statement: WorkbookStatementV1): CborValue {
  return cborMap([
    ["statementId", statement.statementId],
    ["subject", statement.subject],
    ["editKind", statement.editKind],
    ["targetKey", statement.targetKey],
    ["columnIndex", integerOrNull(statement.columnIndex)],
    ["evidence", statement.evidence.map(encodeWorkbookEvidence)],
    ["evidenceFingerprint", statement.evidenceFingerprint],
    ["disposition", statement.disposition],
  ]);
}

export function decodeWorkbookStatement(value: DecodedValue): WorkbookStatementV1 {
  const map = exactKeys(
    asMap(value, "a statement"),
    ["statementId", "subject", "editKind", "targetKey", "columnIndex", "evidence", "evidenceFingerprint", "disposition"],
    "a statement",
  );
  const editKind = field(map, "editKind");
  return {
    statementId: text(field(map, "statementId"), "a statement id"),
    subject: oneOf(field(map, "subject"), WORKBOOK_INFERENCE_SUBJECTS, "a statement subject"),
    editKind: editKind === null ? null : oneOf(editKind, WORKBOOK_REVIEW_EDIT_KINDS, "an edit kind"),
    targetKey: optionalText(field(map, "targetKey"), "a statement target"),
    columnIndex: optionalCount(field(map, "columnIndex"), "a statement column"),
    evidence: list(field(map, "evidence"), "statement evidence").map(decodeWorkbookEvidence),
    evidenceFingerprint: text(field(map, "evidenceFingerprint"), "an evidence fingerprint"),
    disposition: oneOf(field(map, "disposition"), INFERENCE_DISPOSITIONS, "a disposition"),
  };
}

// ------------------------------------------------------------------ sheets --

const SHEET_CLASSIFICATIONS_WITH_EXCLUDED = Object.freeze([...SHEET_ROLES, "excluded"] as const);

const encodeSheet = (sheet: ProposedSheetV1): CborValue =>
  cborMap([
    ["sheetKey", sheet.sheetKey],
    ["sheetIndex", sheet.sheetIndex],
    ["name", sheet.name],
    ["sheetKind", sheet.sheetKind],
    ["visibility", sheet.visibility],
    ["isSelected", sheet.isSelected],
    ["classification", [...sheet.classification]],
    ["declaredRange", sheet.declaredRange === null ? null : encodeRange(sheet.declaredRange)],
    ["dateSystem", sheet.dateSystem],
    ["rowCount", integerOrNull(sheet.rowCount)],
    ["usedCellCount", integerOrNull(sheet.usedCellCount)],
    ["formulaCellCount", integerOrNull(sheet.formulaCellCount)],
    ["omittedRegionCount", sheet.omittedRegionCount],
  ]);

const decodeSheet = (value: DecodedValue): ProposedSheetV1 => {
  const map = exactKeys(
    asMap(value, "a proposed sheet"),
    [
      "sheetKey",
      "sheetIndex",
      "name",
      "sheetKind",
      "visibility",
      "isSelected",
      "classification",
      "declaredRange",
      "dateSystem",
      "rowCount",
      "usedCellCount",
      "formulaCellCount",
      "omittedRegionCount",
    ],
    "a proposed sheet",
  );
  const dateSystem = field(map, "dateSystem");
  return {
    sheetKey: text(field(map, "sheetKey"), "a sheet key"),
    sheetIndex: count(field(map, "sheetIndex"), "a sheet index"),
    name: text(field(map, "name"), "a sheet name"),
    sheetKind: oneOf(field(map, "sheetKind"), SHEET_KINDS, "a sheet kind"),
    visibility: oneOf(field(map, "visibility"), SHEET_VISIBILITIES, "a sheet visibility"),
    isSelected: boolean(field(map, "isSelected"), "a selected flag"),
    classification: list(field(map, "classification"), "a classification").map((role) =>
      oneOf(role, SHEET_CLASSIFICATIONS_WITH_EXCLUDED, "a sheet role"),
    ),
    declaredRange: optional(field(map, "declaredRange"), decodeRange),
    dateSystem: dateSystem === null ? null : oneOf(dateSystem, DATE_SYSTEMS, "a date system"),
    rowCount: optionalCount(field(map, "rowCount"), "a row count"),
    usedCellCount: optionalCount(field(map, "usedCellCount"), "a cell count"),
    formulaCellCount: optionalCount(field(map, "formulaCellCount"), "a formula count"),
    omittedRegionCount: count(field(map, "omittedRegionCount"), "an omitted region count"),
  };
};

// ------------------------------------------------------------------ tables --

const encodeRow = (row: ProposedRowV1): CborValue =>
  cborMap([
    ["rowIndex", row.rowIndex],
    ["cells", [...row.cells]],
  ]);

const decodeRow = (value: DecodedValue): ProposedRowV1 => {
  const map = exactKeys(asMap(value, "a row"), ["rowIndex", "cells"], "a row");
  return { rowIndex: count(field(map, "rowIndex"), "a row index"), cells: texts(field(map, "cells"), "a cell") };
};

const encodeDiscarded = (row: WorkbookDiscardedRowV1): CborValue =>
  cborMap([
    ["rowIndex", row.rowIndex],
    ["reason", row.reason],
    ["cells", [...row.cells]],
  ]);

const decodeDiscarded = (value: DecodedValue): WorkbookDiscardedRowV1 => {
  const map = exactKeys(asMap(value, "a discarded row"), ["rowIndex", "reason", "cells"], "a discarded row");
  return {
    rowIndex: count(field(map, "rowIndex"), "a row index"),
    reason: oneOf(field(map, "reason"), WORKBOOK_DISCARD_REASONS, "a discard reason"),
    cells: texts(field(map, "cells"), "a discarded cell"),
  };
};

const encodeViolations = (violations: ProposedWorkbookFieldV1["violations"]): CborValue =>
  violations === null
    ? null
    : cborMap([
        ["count", violations.count],
        [
          "examples",
          violations.examples.map((example) =>
            cborMap([
              ["rowIndex", example.rowIndex],
              ["sourceText", example.sourceText],
            ]),
          ),
        ],
      ]);

const decodeViolations = (value: DecodedValue): ProposedWorkbookFieldV1["violations"] => {
  if (value === null) return null;
  const map = exactKeys(asMap(value, "violations"), ["count", "examples"], "violations");
  return {
    count: count(field(map, "count"), "a violation count"),
    examples: list(field(map, "examples"), "violation examples").map((entry) => {
      const example = exactKeys(asMap(entry, "an example"), ["rowIndex", "sourceText"], "an example");
      return {
        rowIndex: count(field(example, "rowIndex"), "an example row"),
        sourceText: text(field(example, "sourceText"), "an example value"),
      };
    }),
  };
};

const FIELD_KEYS = [
  "columnKey",
  "columnIndex",
  "fieldName",
  "isNameGenerated",
  "type",
  "valueType",
  "sourceFormat",
  "enumOptions",
  "violations",
  "formulaText",
];

const encodeField = (entry: ProposedWorkbookFieldV1): CborValue =>
  cborMap([
    ["columnKey", entry.columnKey],
    ["columnIndex", entry.columnIndex],
    ["fieldName", entry.fieldName],
    ["isNameGenerated", entry.isNameGenerated],
    ["type", encodeWorkbookFieldType(entry.type)],
    ["valueType", encodeFieldType(entry.valueType)],
    ["sourceFormat", encodeWorkbookSourceFormat(entry.sourceFormat)],
    [
      "enumOptions",
      entry.enumOptions.map((option) =>
        cborMap([
          ["label", option.label],
          ["occurrences", option.occurrences],
        ]),
      ),
    ],
    ["violations", encodeViolations(entry.violations)],
    ["formulaText", entry.formulaText],
  ]);

const decodeField = (value: DecodedValue): ProposedWorkbookFieldV1 => {
  const map = exactKeys(asMap(value, "a proposed field"), FIELD_KEYS, "a proposed field");
  return {
    columnKey: text(field(map, "columnKey"), "a column key"),
    columnIndex: count(field(map, "columnIndex"), "a column index"),
    fieldName: nfcText(field(map, "fieldName"), "a field name"),
    isNameGenerated: boolean(field(map, "isNameGenerated"), "a generated flag"),
    type: decodeWorkbookFieldType(field(map, "type")),
    valueType: decodeFieldType(field(map, "valueType")),
    sourceFormat: decodeWorkbookSourceFormat(field(map, "sourceFormat")),
    enumOptions: list(field(map, "enumOptions"), "enum options").map((entry) => {
      const option = exactKeys(asMap(entry, "an enum option"), ["label", "occurrences"], "an enum option");
      return {
        label: nfcText(field(option, "label"), "an option label"),
        occurrences: count(field(option, "occurrences"), "an option count"),
      };
    }),
    violations: decodeViolations(field(map, "violations")),
    formulaText: optionalText(field(map, "formulaText"), "a formula"),
  };
};

const encodeTableSource = (source: ProposedTableV2["source"]): CborValue =>
  source.kind === "region"
    ? cborMap([["kind", "region"]])
    : cborMap([
        ["kind", "declared-table"],
        ["name", source.name],
        ["range", encodeRange(source.range)],
        ["headerRowCount", source.headerRowCount],
        ["totalsRowCount", source.totalsRowCount],
      ]);

const decodeTableSource = (value: DecodedValue): ProposedTableV2["source"] => {
  const map = asMap(value, "a table source");
  const kind = oneOf(field(map, "kind"), ["region", "declared-table"] as const, "a table source");
  if (kind === "region") {
    keyed(map, ["kind"], "a region source");
    return { kind };
  }
  const m = keyed(map, ["kind", "name", "range", "headerRowCount", "totalsRowCount"], "a declared source");
  return {
    kind,
    name: text(field(m, "name"), "a table name"),
    range: decodeRange(field(m, "range")),
    headerRowCount: count(field(m, "headerRowCount"), "a header row count"),
    totalsRowCount: count(field(m, "totalsRowCount"), "a totals row count"),
  };
};

const TABLE_KEYS = [
  "tableKey",
  "sheetKey",
  "tableName",
  "source",
  "firstColumn",
  "lastColumn",
  "headerRowIndex",
  "leadingRows",
  "discardedRows",
  "discardedRowCount",
  "rowCount",
  "joinedToTableKey",
  "fields",
  "keyColumnKey",
  "labelColumnKey",
];

/** F04 adds the last data row, which a formula's references are resolved against. */
const TABLE_KEYS_F04 = [...TABLE_KEYS, "lastDataRowIndex"];

const encodeTable = (table: ProposedTableV2): CborValue =>
  cborMap([
    ["tableKey", table.tableKey],
    ["sheetKey", table.sheetKey],
    ["tableName", table.tableName],
    ["source", encodeTableSource(table.source)],
    ["firstColumn", table.firstColumn],
    ["lastColumn", table.lastColumn],
    ["headerRowIndex", integerOrNull(table.headerRowIndex)],
    ["leadingRows", table.leadingRows.map(encodeRow)],
    ["discardedRows", table.discardedRows.map(encodeDiscarded)],
    ["discardedRowCount", table.discardedRowCount],
    ["rowCount", table.rowCount],
    ["lastDataRowIndex", integerOrNull(table.lastDataRowIndex)],
    ["joinedToTableKey", table.joinedToTableKey],
    ["fields", table.fields.map(encodeField)],
    ["keyColumnKey", table.keyColumnKey],
    ["labelColumnKey", table.labelColumnKey],
  ]);

/**
 * A table staged before F04 has no last data row. Its proposal holds no
 * formula either, so the one reader never needs it: the declared end, or the
 * header plus the rows, stands in.
 */
const f03LastDataRow = (source: ProposedTableV2["source"], headerRowIndex: number | null, rowCount: number): number | null =>
  rowCount === 0
    ? null
    : source.kind === "declared-table"
      ? source.range.lastRow - source.totalsRowCount
      : (headerRowIndex ?? -1) + rowCount;

const decodeTable = (value: DecodedValue): ProposedTableV2 => {
  const raw = asMap(value, "a proposed table");
  const map = exactKeys(raw, raw.has("lastDataRowIndex") ? TABLE_KEYS_F04 : TABLE_KEYS, "a proposed table");
  const source = decodeTableSource(field(map, "source"));
  const headerRowIndex = optionalCount(field(map, "headerRowIndex"), "a header row");
  const rowCount = count(field(map, "rowCount"), "a row count");
  return {
    tableKey: text(field(map, "tableKey"), "a table key"),
    sheetKey: text(field(map, "sheetKey"), "a sheet key"),
    tableName: nfcText(field(map, "tableName"), "a table name"),
    source,
    firstColumn: count(field(map, "firstColumn"), "a first column"),
    lastColumn: count(field(map, "lastColumn"), "a last column"),
    headerRowIndex,
    leadingRows: list(field(map, "leadingRows"), "leading rows").map(decodeRow),
    discardedRows: list(field(map, "discardedRows"), "discarded rows").map(decodeDiscarded),
    discardedRowCount: count(field(map, "discardedRowCount"), "a discarded row count"),
    rowCount,
    lastDataRowIndex: map.has("lastDataRowIndex")
      ? optionalCount(field(map, "lastDataRowIndex"), "a last data row")
      : f03LastDataRow(source, headerRowIndex, rowCount),
    joinedToTableKey: optionalText(field(map, "joinedToTableKey"), "a joined table key"),
    fields: list(field(map, "fields"), "proposed fields").map(decodeField),
    keyColumnKey: optionalText(field(map, "keyColumnKey"), "a key column"),
    labelColumnKey: optionalText(field(map, "labelColumnKey"), "a label column"),
  };
};

// ----------------------------------------------------------- relationships --

const BASES = Object.freeze(["lookup-formula", "heading", "containment", "heading-and-containment"] as const);
const PROPOSED_SOURCES = RELATIONSHIP_DETECTION_SOURCES.filter(
  (source): source is Exclude<(typeof RELATIONSHIP_DETECTION_SOURCES)[number], "declared"> => source !== "declared",
);

const encodeCandidate = (candidate: RelationshipCandidateV1): CborValue =>
  cborMap([
    ["toTableKey", candidate.toTableKey],
    ["toColumnKey", candidate.toColumnKey],
    ["basis", candidate.basis],
    ["brokenReferenceCount", candidate.brokenReferenceCount],
  ]);

const decodeCandidate = (value: DecodedValue): RelationshipCandidateV1 => {
  const map = exactKeys(
    asMap(value, "a candidate"),
    ["toTableKey", "toColumnKey", "basis", "brokenReferenceCount"],
    "a candidate",
  );
  return {
    toTableKey: text(field(map, "toTableKey"), "a table key"),
    toColumnKey: text(field(map, "toColumnKey"), "a column key"),
    basis: oneOf(field(map, "basis"), BASES, "a candidate basis"),
    brokenReferenceCount: count(field(map, "brokenReferenceCount"), "a broken count"),
  };
};

const RELATIONSHIP_KEYS = [
  "relationshipKey",
  "fromTableKey",
  "fromColumnKey",
  "toTableKey",
  "toColumnKey",
  "detectionSource",
  "isApplied",
  "brokenReferenceCount",
  "isSampled",
  "candidates",
];

const encodeRelationship = (relationship: ProposedRelationshipV1): CborValue =>
  cborMap([
    ["relationshipKey", relationship.relationshipKey],
    ["fromTableKey", relationship.fromTableKey],
    ["fromColumnKey", relationship.fromColumnKey],
    ["toTableKey", relationship.toTableKey],
    ["toColumnKey", relationship.toColumnKey],
    ["detectionSource", relationship.detectionSource],
    ["isApplied", relationship.isApplied],
    ["brokenReferenceCount", relationship.brokenReferenceCount],
    ["isSampled", relationship.isSampled],
    ["candidates", relationship.candidates.map(encodeCandidate)],
  ]);

const decodeRelationship = (value: DecodedValue): ProposedRelationshipV1 => {
  const map = exactKeys(asMap(value, "a relationship"), RELATIONSHIP_KEYS, "a relationship");
  return {
    relationshipKey: text(field(map, "relationshipKey"), "a relationship key"),
    fromTableKey: text(field(map, "fromTableKey"), "a table key"),
    fromColumnKey: text(field(map, "fromColumnKey"), "a column key"),
    toTableKey: text(field(map, "toTableKey"), "a table key"),
    toColumnKey: text(field(map, "toColumnKey"), "a column key"),
    detectionSource: oneOf(field(map, "detectionSource"), PROPOSED_SOURCES, "a detection source"),
    isApplied: boolean(field(map, "isApplied"), "an applied flag"),
    brokenReferenceCount: count(field(map, "brokenReferenceCount"), "a broken count"),
    isSampled: boolean(field(map, "isSampled"), "a sampled flag"),
    candidates: list(field(map, "candidates"), "candidates").map(decodeCandidate),
  };
};

// ------------------------------------------------------------ record rules --

/** The values a rule can compare against; an id-bearing value has no meaning here. */
const RULE_VALUE_KINDS = Object.freeze(["text", "decimal", "date", "boolean", "missing", "blank", "invalid-preserved"] as const);

const encodeRuleValue = (value: CellValueV1): CborValue => {
  switch (value.kind) {
    case "text":
      return cborMap([["kind", "text"], ["text", value.text]]);
    case "decimal":
      return cborMap([["kind", "decimal"], ["decimal", value.decimal]]);
    case "date":
      return cborMap([["kind", "date"], ["epochDay", value.epochDay]]);
    case "boolean":
      return cborMap([["kind", "boolean"], ["boolean", value.boolean]]);
    case "missing":
    case "blank":
      return cborMap([["kind", value.kind]]);
    case "invalid-preserved":
      return cborMap([["kind", "invalid-preserved"], ["sourceText", value.sourceText]]);
    case "enum":
    case "reference":
      throw new CodecError("a record rule cannot compare against an identity");
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
};

const decodeRuleValue = (value: DecodedValue): CellValueV1 => {
  const map = asMap(value, "a rule value");
  const kind = oneOf(field(map, "kind"), RULE_VALUE_KINDS, "a rule value kind");
  switch (kind) {
    case "text":
      return { kind, text: nfcText(field(keyed(map, ["kind", "text"], "a text value"), "text"), "rule text") };
    case "decimal":
      return { kind, decimal: text(field(keyed(map, ["kind", "decimal"], "a decimal"), "decimal"), "a decimal") };
    case "date":
      return { kind, epochDay: integer(field(keyed(map, ["kind", "epochDay"], "a date"), "epochDay"), "an epoch day") };
    case "boolean":
      return { kind, boolean: boolean(field(keyed(map, ["kind", "boolean"], "a boolean"), "boolean"), "a boolean") };
    case "missing":
    case "blank":
      keyed(map, ["kind"], "an empty value");
      return { kind };
    case "invalid-preserved":
      return {
        kind,
        sourceText: nfcText(field(keyed(map, ["kind", "sourceText"], "a preserved value"), "sourceText"), "source text"),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

const encodeCondition = (condition: ProposedRuleConditionV1): CborValue =>
  condition.kind === "field-equals"
    ? cborMap([
        ["kind", "field-equals"],
        ["columnKey", condition.columnKey],
        ["value", encodeRuleValue(condition.value)],
      ])
    : cborMap([
        ["kind", "not"],
        ["condition", encodeCondition(condition.condition)],
      ]);

const decodeCondition = (value: DecodedValue): ProposedRuleConditionV1 => {
  const map = asMap(value, "a rule condition");
  const kind = oneOf(field(map, "kind"), ["field-equals", "not"] as const, "a condition kind");
  if (kind === "field-equals") {
    const m = keyed(map, ["kind", "columnKey", "value"], "an equals condition");
    return { kind, columnKey: text(field(m, "columnKey"), "a column key"), value: decodeRuleValue(field(m, "value")) };
  }
  return { kind, condition: decodeCondition(field(keyed(map, ["kind", "condition"], "a not condition"), "condition")) };
};

const encodeRule = (rule: ProposedRecordRuleV1): CborValue =>
  cborMap([
    ["ruleKey", rule.ruleKey],
    ["tableKey", rule.tableKey],
    ["columnKey", rule.columnKey],
    ["condition", encodeCondition(rule.condition)],
    ["isActive", rule.isActive],
  ]);

const decodeRule = (value: DecodedValue): ProposedRecordRuleV1 => {
  const map = exactKeys(
    asMap(value, "a record rule"),
    ["ruleKey", "tableKey", "columnKey", "condition", "isActive"],
    "a record rule",
  );
  return {
    ruleKey: text(field(map, "ruleKey"), "a rule key"),
    tableKey: text(field(map, "tableKey"), "a table key"),
    columnKey: text(field(map, "columnKey"), "a column key"),
    condition: decodeCondition(field(map, "condition")),
    isActive: boolean(field(map, "isActive"), "an active flag"),
  };
};

// ----------------------------------------------------------------- formulas --

const FORMULA_KEYS = [
  "formulaKey",
  "target",
  "displayName",
  "originalText",
  "sheetKey",
  "rowIndex",
  "columnIndex",
  "location",
  "anchor",
  "isArray",
  "shapeMatchCount",
  "shapeBreakRowIndex",
  "disposition",
  "determinism",
  "reason",
  "detail",
  "relationshipKey",
  "isActive",
];

const encodeFormulaTarget = (target: ProposedFormulaV1["target"]): CborValue =>
  target.kind === "dashboard-value"
    ? cborMap([
        ["kind", target.kind],
        ["sheetKey", target.sheetKey],
      ])
    : cborMap([
        ["kind", target.kind],
        ["tableKey", target.tableKey],
        ["columnKey", target.columnKey],
      ]);

const decodeFormulaTarget = (value: DecodedValue): ProposedFormulaV1["target"] => {
  const map = asMap(value, "a formula target");
  const kind = oneOf(field(map, "kind"), FORMULA_TARGET_KINDS, "a formula target");
  if (kind === "dashboard-value") {
    return { kind, sheetKey: text(field(keyed(map, ["kind", "sheetKey"], "a dashboard target"), "sheetKey"), "a sheet key") };
  }
  const m = keyed(map, ["kind", "tableKey", "columnKey"], "a formula target");
  return { kind, tableKey: text(field(m, "tableKey"), "a table key"), columnKey: text(field(m, "columnKey"), "a column key") };
};

const encodeFormula = (formula: ProposedFormulaV1): CborValue =>
  cborMap([
    ["formulaKey", formula.formulaKey],
    ["target", encodeFormulaTarget(formula.target)],
    ["displayName", formula.displayName],
    ["originalText", formula.originalText],
    ["sheetKey", formula.sheetKey],
    ["rowIndex", formula.rowIndex],
    ["columnIndex", formula.columnIndex],
    ["location", formula.location],
    ["anchor", encodeRange(formula.anchor)],
    ["isArray", formula.isArray],
    ["shapeMatchCount", formula.shapeMatchCount],
    ["shapeBreakRowIndex", integerOrNull(formula.shapeBreakRowIndex)],
    ["disposition", formula.disposition],
    ["determinism", formula.determinism],
    ["reason", formula.reason],
    ["detail", formula.detail],
    ["relationshipKey", formula.relationshipKey],
    ["isActive", formula.isActive],
  ]);

const decodeFormula = (value: DecodedValue): ProposedFormulaV1 => {
  const map = exactKeys(asMap(value, "a proposed formula"), FORMULA_KEYS, "a proposed formula");
  const disposition = oneOf(field(map, "disposition"), FORMULA_DISPOSITIONS, "a formula disposition");
  const determinism = oneOf(field(map, "determinism"), FORMULA_DETERMINISMS, "a formula determinism");
  if (!isAllowedClassification(disposition, determinism)) {
    throw new CodecError("a proposed formula's disposition and determinism are not a legal pair");
  }
  const reason = field(map, "reason");
  return {
    formulaKey: text(field(map, "formulaKey"), "a formula key"),
    target: decodeFormulaTarget(field(map, "target")),
    displayName: optionalText(field(map, "displayName"), "a formula name"),
    originalText: text(field(map, "originalText"), "a formula"),
    sheetKey: text(field(map, "sheetKey"), "a sheet key"),
    rowIndex: count(field(map, "rowIndex"), "a row"),
    columnIndex: count(field(map, "columnIndex"), "a column"),
    location: text(field(map, "location"), "a location"),
    anchor: decodeRange(field(map, "anchor")),
    isArray: boolean(field(map, "isArray"), "an array flag"),
    shapeMatchCount: count(field(map, "shapeMatchCount"), "a shape count"),
    shapeBreakRowIndex: optionalCount(field(map, "shapeBreakRowIndex"), "a row"),
    disposition,
    determinism,
    reason: reason === null ? null : oneOf(reason, FORMULA_KEEP_REASONS, "a formula reason"),
    detail: optionalText(field(map, "detail"), "a formula detail"),
    relationshipKey: optionalText(field(map, "relationshipKey"), "a relationship key"),
    isActive: boolean(field(map, "isActive"), "an active flag"),
  };
};

// ------------------------------------------------------------------- charts --

const CHART_KEYS = [
  "chartKey",
  "sheetKey",
  "partKind",
  "location",
  "anchor",
  "name",
  "type",
  "tableKey",
  "groupBy",
  "measure",
  "x",
  "y",
  "categoriesRepeat",
  "isActive",
];

const encodeChart = (chart: ProposedChartV1): CborValue =>
  cborMap([
    ["chartKey", chart.chartKey],
    ["sheetKey", chart.sheetKey],
    ["partKind", chart.partKind],
    ["location", chart.location],
    ["anchor", chart.anchor === null ? null : encodeRange(chart.anchor)],
    ["name", chart.name],
    ["type", chart.type],
    ["tableKey", chart.tableKey],
    [
      "groupBy",
      chart.groupBy === null
        ? null
        : cborMap([
            ["kind", chart.groupBy.kind],
            ["columnKey", chart.groupBy.columnKey],
          ]),
    ],
    [
      "measure",
      chart.measure === null
        ? null
        : chart.measure.kind === "count"
          ? cborMap([["kind", "count"]])
          : cborMap([
              ["kind", chart.measure.kind],
              ["columnKey", chart.measure.columnKey],
            ]),
    ],
    ["x", chart.x],
    ["y", chart.y],
    ["categoriesRepeat", chart.categoriesRepeat],
    ["isActive", chart.isActive],
  ]);

const decodeChartMeasure = (value: DecodedValue): ProposedChartV1["measure"] => {
  const map = asMap(value, "a chart measure");
  const kind = oneOf(field(map, "kind"), CHART_MEASURE_KINDS, "a chart measure");
  if (kind === "count") {
    keyed(map, ["kind"], "a count measure");
    return { kind };
  }
  return { kind, columnKey: text(field(keyed(map, ["kind", "columnKey"], "a chart measure"), "columnKey"), "a column key") };
};

const decodeChart = (value: DecodedValue): ProposedChartV1 => {
  const map = exactKeys(asMap(value, "a proposed chart"), CHART_KEYS, "a proposed chart");
  const groupBy = field(map, "groupBy");
  const measure = field(map, "measure");
  const group = groupBy === null ? null : keyed(asMap(groupBy, "a chart group"), ["kind", "columnKey"], "a chart group");
  return {
    chartKey: text(field(map, "chartKey"), "a chart key"),
    sheetKey: text(field(map, "sheetKey"), "a sheet key"),
    partKind: oneOf(field(map, "partKind"), ["chart", "pivot-table"] as const, "a chart part kind"),
    location: text(field(map, "location"), "a location"),
    anchor: optional(field(map, "anchor"), decodeRange),
    name: nfcText(field(map, "name"), "a chart name"),
    type: oneOf(field(map, "type"), PROPOSED_CHART_TYPES, "a chart type"),
    tableKey: text(field(map, "tableKey"), "a table key"),
    groupBy:
      group === null
        ? null
        : {
            kind: oneOf(field(group, "kind"), ["field", "date"] as const, "a chart group kind"),
            columnKey: text(field(group, "columnKey"), "a column key"),
          },
    measure: measure === null ? null : decodeChartMeasure(measure),
    x: optionalText(field(map, "x"), "a column key"),
    y: optionalText(field(map, "y"), "a column key"),
    categoriesRepeat: boolean(field(map, "categoriesRepeat"), "a repeat flag"),
    isActive: boolean(field(map, "isActive"), "an active flag"),
  };
};

// -------------------------------------------------------------- inert items --

const encodeInert = (item: ProposedInertItemV1): CborValue =>
  cborMap([
    ["kind", item.kind],
    ["sheetKey", item.sheetKey],
    ["location", item.location],
    ["reasonKey", item.reasonKey],
    ["anchor", item.anchor === null ? null : encodeRange(item.anchor)],
  ]);

const decodeInert = (value: DecodedValue): ProposedInertItemV1 => {
  const map = exactKeys(
    asMap(value, "an inert item"),
    ["kind", "sheetKey", "location", "reasonKey", "anchor"],
    "an inert item",
  );
  return {
    kind: oneOf(field(map, "kind"), PRESERVED_PART_KINDS, "an inert kind"),
    sheetKey: text(field(map, "sheetKey"), "a sheet key"),
    location: text(field(map, "location"), "a location"),
    reasonKey: oneOf(field(map, "reasonKey"), PRESERVED_REASON_KEYS, "a reason key"),
    anchor: optional(field(map, "anchor"), decodeRange),
  };
};

const encodeInertCounts = (counts: Readonly<Record<PreservedPartKindV1, number>>): CborValue =>
  cborMap(PRESERVED_PART_KINDS.map((kind) => [kind, counts[kind]] as const));

const decodeInertCounts = (value: DecodedValue): Readonly<Record<PreservedPartKindV1, number>> => {
  const map = exactKeys(asMap(value, "inert counts"), PRESERVED_PART_KINDS, "inert counts");
  return Object.fromEntries(
    PRESERVED_PART_KINDS.map((kind) => [kind, count(field(map, kind), "an inert count")]),
  ) as Record<PreservedPartKindV1, number>;
};

// ---------------------------------------------------------------- proposal --

const PROPOSAL_KEYS = [
  "fileName",
  "isDelimited",
  "appName",
  "sheets",
  "tables",
  "relationships",
  "recordRules",
  "inertItems",
  "inertCounts",
  "statements",
  "diagnostics",
];

/** F04 adds the formulas and charts; a proposal staged before F04 decodes with none. */
const PROPOSAL_KEYS_F04 = [...PROPOSAL_KEYS, "formulas", "charts"];

export function encodeWorkbookProposal(proposal: ProposedWorkbookV1): CborValue {
  return cborMap([
    ["fileName", proposal.fileName],
    ["isDelimited", proposal.isDelimited],
    ["appName", proposal.appName],
    ["sheets", proposal.sheets.map(encodeSheet)],
    ["tables", proposal.tables.map(encodeTable)],
    ["relationships", proposal.relationships.map(encodeRelationship)],
    ["recordRules", proposal.recordRules.map(encodeRule)],
    ["formulas", proposal.formulas.map(encodeFormula)],
    ["charts", proposal.charts.map(encodeChart)],
    ["inertItems", proposal.inertItems.map(encodeInert)],
    ["inertCounts", encodeInertCounts(proposal.inertCounts)],
    ["statements", proposal.statements.map(encodeWorkbookStatement)],
    ["diagnostics", proposal.diagnostics.map(encodeDiagnosticV2)],
  ]);
}

/** `isRowCountExact` is the literal `true` in the type, never a stored byte (D24). */
export function decodeWorkbookProposal(value: DecodedValue): ProposedWorkbookV1 {
  const raw = asMap(value, "a proposal");
  const map = exactKeys(raw, raw.has("formulas") ? PROPOSAL_KEYS_F04 : PROPOSAL_KEYS, "a proposal");
  return {
    fileName: text(field(map, "fileName"), "a file name"),
    isDelimited: boolean(field(map, "isDelimited"), "a delimited flag"),
    appName: nfcText(field(map, "appName"), "an app name"),
    sheets: list(field(map, "sheets"), "sheets").map(decodeSheet),
    tables: list(field(map, "tables"), "tables").map(decodeTable),
    relationships: list(field(map, "relationships"), "relationships").map(decodeRelationship),
    recordRules: list(field(map, "recordRules"), "record rules").map(decodeRule),
    formulas: map.has("formulas") ? list(field(map, "formulas"), "formulas").map(decodeFormula) : [],
    charts: map.has("charts") ? list(field(map, "charts"), "charts").map(decodeChart) : [],
    inertItems: list(field(map, "inertItems"), "inert items").map(decodeInert),
    inertCounts: decodeInertCounts(field(map, "inertCounts")),
    statements: list(field(map, "statements"), "statements").map(decodeWorkbookStatement),
    diagnostics: list(field(map, "diagnostics"), "diagnostics").map(decodeDiagnosticV2),
    isRowCountExact: true,
  };
}

// ------------------------------------------------------------ review edits --

export function encodeWorkbookReviewEdit(edit: WorkbookReviewEditV1): CborValue {
  switch (edit.kind) {
    case "rename-app":
      return cborMap([["kind", edit.kind], ["appName", edit.appName]]);
    case "rename-table":
      return cborMap([["kind", edit.kind], ["tableKey", edit.tableKey], ["tableName", edit.tableName]]);
    case "rename-field":
      return cborMap([
        ["kind", edit.kind],
        ["tableKey", edit.tableKey],
        ["columnKey", edit.columnKey],
        ["fieldName", edit.fieldName],
      ]);
    case "override-type":
      return cborMap([
        ["kind", edit.kind],
        ["tableKey", edit.tableKey],
        ["columnKey", edit.columnKey],
        ["type", encodeFieldType(edit.type)],
      ]);
    case "set-header-row":
      return cborMap([["kind", edit.kind], ["regionKey", edit.regionKey], ["rowIndex", integerOrNull(edit.rowIndex)]]);
    case "edit-enum-options":
      return cborMap([
        ["kind", edit.kind],
        ["tableKey", edit.tableKey],
        ["columnKey", edit.columnKey],
        ["options", [...edit.options]],
      ]);
    case "reject-relationship":
    case "restore-relationship":
      return cborMap([["kind", edit.kind], ["relationshipKey", edit.relationshipKey]]);
    case "retarget-relationship":
      return cborMap([["kind", edit.kind], ["relationshipKey", edit.relationshipKey], ["toTableKey", edit.toTableKey]]);
    case "reject-statement":
    case "restore-statement":
      return cborMap([["kind", edit.kind], ["statementId", edit.statementId]]);
    case "set-key":
      return cborMap([["kind", edit.kind], ["tableKey", edit.tableKey], ["columnKey", edit.columnKey]]);
    case "set-label":
      return cborMap([["kind", edit.kind], ["tableKey", edit.tableKey], ["columnKey", edit.columnKey]]);
    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
}

export function decodeWorkbookReviewEdit(value: DecodedValue): WorkbookReviewEditV1 {
  const map = asMap(value, "a review edit");
  const kind = oneOf(field(map, "kind"), WORKBOOK_REVIEW_EDIT_KINDS, "a review edit kind");
  const read = (names: readonly string[]): DecodedMap => keyed(map, ["kind", ...names], `a ${kind} edit`);
  switch (kind) {
    case "rename-app":
      return { kind, appName: text(field(read(["appName"]), "appName"), "an app name") };
    case "rename-table": {
      const m = read(["tableKey", "tableName"]);
      return { kind, tableKey: text(field(m, "tableKey"), "a table key"), tableName: text(field(m, "tableName"), "a name") };
    }
    case "rename-field": {
      const m = read(["tableKey", "columnKey", "fieldName"]);
      return {
        kind,
        tableKey: text(field(m, "tableKey"), "a table key"),
        columnKey: text(field(m, "columnKey"), "a column key"),
        fieldName: text(field(m, "fieldName"), "a field name"),
      };
    }
    case "override-type": {
      const m = read(["tableKey", "columnKey", "type"]);
      return {
        kind,
        tableKey: text(field(m, "tableKey"), "a table key"),
        columnKey: text(field(m, "columnKey"), "a column key"),
        type: decodeFieldType(field(m, "type")),
      };
    }
    case "set-header-row": {
      const m = read(["regionKey", "rowIndex"]);
      return {
        kind,
        regionKey: text(field(m, "regionKey"), "a region key"),
        rowIndex: optionalCount(field(m, "rowIndex"), "a header row"),
      };
    }
    case "edit-enum-options": {
      const m = read(["tableKey", "columnKey", "options"]);
      return {
        kind,
        tableKey: text(field(m, "tableKey"), "a table key"),
        columnKey: text(field(m, "columnKey"), "a column key"),
        options: texts(field(m, "options"), "an option label"),
      };
    }
    case "reject-relationship":
    case "restore-relationship":
      return { kind, relationshipKey: text(field(read(["relationshipKey"]), "relationshipKey"), "a relationship key") };
    case "retarget-relationship": {
      const m = read(["relationshipKey", "toTableKey"]);
      return {
        kind,
        relationshipKey: text(field(m, "relationshipKey"), "a relationship key"),
        toTableKey: text(field(m, "toTableKey"), "a table key"),
      };
    }
    case "reject-statement":
    case "restore-statement":
      return { kind, statementId: text(field(read(["statementId"]), "statementId"), "a statement id") };
    case "set-key": {
      const m = read(["tableKey", "columnKey"]);
      return {
        kind,
        tableKey: text(field(m, "tableKey"), "a table key"),
        columnKey: optionalText(field(m, "columnKey"), "a column key"),
      };
    }
    case "set-label": {
      const m = read(["tableKey", "columnKey"]);
      return {
        kind,
        tableKey: text(field(m, "tableKey"), "a table key"),
        columnKey: text(field(m, "columnKey"), "a column key"),
      };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
