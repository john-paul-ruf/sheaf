/**
 * `inferWorkbook` — a completed V2 fact stream → {@link ProposedWorkbookV1}
 * (M21; CA-19, FR-4–FR-8; architecture § Stage 3).
 *
 * Synchronous over an iterable, so the data worker can feed staged batches as
 * in F02, and it **throws on a stream without a summary**: a cancelled parse
 * has no exact counts to propose from.
 *
 * Per selected sheet, in the order the rules do not bend:
 *
 * 1. **Declared tables win outright.** A `declared-table` fact is one table
 *    with the declared header and totals rows; nothing inside it is inferred.
 * 2. Everything else is **regions**: runs of consecutive non-blank rows, split
 *    into column groups at wholly empty columns within the region's first
 *    rows. A group with a heading row and data is a table; a region's rows
 *    above its heading are discarded `above-header`. Consecutive regions whose
 *    heading rows match exactly are one table (`table-merge`); other tables on
 *    one sheet are split (`table-split`).
 * 3. **Types**: a validation rule over the column, else its dominant number
 *    format, else F02's value typing (`types.ts`).
 * 4. A column with formulas keeps its cached values as authored literals and
 *    gets a `formula` statement — preserved, not live (D33).
 * 5. A validation M02's rule IR can state becomes a proposed record rule; any
 *    other is an inert `unsupported-validation` item — never a guessed rule.
 * 6. Keys and labels (`keys.ts`), relationships — lookup formulas first, key
 *    matches second (`relationships.ts`) — and sheet roles (`classify.ts`);
 *    every preserved part and formula column is an inert item (FR-9).
 * 7. Stored rejections are proposed rejected, with their effect (D44).
 *
 * A stream with no `sheet` fact is a delimited file: one sheet, one table,
 * measured exactly as F02 did (`inferProposal` is now this path's adapter).
 *
 * **Bounded state**, per structure: each table keeps its builder's window,
 * discards and column stats (`regions.ts`, `types.ts`); each open region keeps
 * at most {@link PROPOSAL_LEADING_ROWS} undecided rows; each sheet keeps its
 * current number format per column, at most {@link SHEET_VALIDATION_LIMIT}
 * validations, {@link SHEET_PRESERVED_PART_LIMIT} preserved parts and
 * {@link SHEET_REGION_LIMIT} regions; the row being assembled holds at most one
 * row's cells. Nothing holds a whole sheet.
 */

import { extractReferences, findLookups, parseFormula, type FormulaReferenceV1 } from "../../domain/formulas/index.js";
import { dateValue, decimalValue, type CellValueV1 } from "../../domain/model/values.js";
import {
  PRESERVED_PART_KINDS,
  type DateSystemV1,
  type ImportDiagnosticV2,
  type PreservedPartKindV1,
  type WorkbookFactStreamItemV2,
  type WorkbookStructureFactV1,
} from "../facts/index.js";
import { classifySheet } from "./classify.js";
import { chooseKey, chooseLabel, type KeyedColumnV1 } from "./keys.js";
import {
  PROPOSAL_LEADING_ROWS,
  TableBuilder,
  fieldNamesFrom,
  locationText,
  titleize,
  type CellInputV1,
  type MeasuredTableV1,
  type ProposedRowV1,
} from "./regions.js";
import { applyRejectionMemory, type RejectionMemoryV1 } from "./rejection-memory.js";
import { detectRelationships, type RelatableTableV1 } from "./relationships.js";
import {
  EVIDENCE_EXAMPLE_LIMIT,
  evidenceFingerprintInput,
  workbookFingerprintInput,
  workbookStatementIdOf,
  type EvidenceV1,
  type InferenceSubjectV1,
  type WorkbookEvidenceV1,
  type WorkbookInferenceSubjectV1,
  type WorkbookReviewEditKindV1,
  type WorkbookStatementV1,
} from "./statements.js";
import {
  chooseDeclaredType,
  chooseValueType,
  inlineOptionsOf,
  mergeStats,
  validationEvidence,
  type CellFormatV1,
  type ColumnStats,
} from "./types.js";
import { readDecimal, serialToEpochDay, sourceTextOfCellValue } from "./values.js";
import {
  type ProposedInertItemV1,
  type ProposedRecordRuleV1,
  type ProposedSheetV1,
  type ProposedTableV2,
  type ProposedWorkbookFieldV1,
  type ProposedWorkbookV1,
  type SheetRoleV1,
} from "./workbook-proposal.js";

export type { RejectionMemoryV1 } from "./rejection-memory.js";

/** Validations kept per sheet; more are left to the snapshot. */
export const SHEET_VALIDATION_LIMIT = 256;

/** Regions tabled per sheet; later ones stay in the snapshot, counted. */
export const SHEET_REGION_LIMIT = 32;

/** Preserved parts listed per sheet; the adapters already aggregate per-cell kinds. */
export const SHEET_PRESERVED_PART_LIMIT = 4096;

/** One sheet of the workbook and whether the user selected it (D39, D47). */
export interface WorkbookSheetChoiceV1 {
  readonly sheetIndex: number;
  readonly name: string;
  readonly sheetKind: ProposedSheetV1["sheetKind"];
  readonly visibility: ProposedSheetV1["visibility"];
  readonly isSelected: boolean;
}

export interface WorkbookInferenceContextV1 {
  readonly fileName: string;
  /**
   * Every sheet, selected or not, from pre-flight; unselected sheets are never
   * parsed and appear as `excluded`. `null` lists only the streamed sheets.
   */
  readonly sheetSelection: readonly WorkbookSheetChoiceV1[] | null;
  /** Stored rejections the proposal must honour (D44); empty for a first import. */
  readonly rejectionMemory: RejectionMemoryV1;
  /**
   * Hex digest of a fingerprint input. M21 stays digest-free: the caller
   * supplies M08's SHA-256 (tests use a deterministic fake).
   */
  readonly fingerprintOf: (input: string) => string;
  /** The app a delimited file is appended to; its table names stay unique. */
  readonly existingApp: { readonly tableNames: readonly string[] } | null;
}

type DeclaredTableFact = Extract<WorkbookStructureFactV1, { kind: "declared-table" }>;
type ValidationFact = Extract<WorkbookStructureFactV1, { kind: "validation" }>;
type DefinedNameFact = Extract<WorkbookStructureFactV1, { kind: "defined-name" }>;
type PreservedPartFact = Extract<WorkbookStructureFactV1, { kind: "preserved-part" }>;

interface BoxV1 {
  firstRow: number;
  firstColumn: number;
  lastRow: number;
  lastColumn: number;
}

const grow = (box: BoxV1 | null, row: number, column: number): BoxV1 =>
  box === null
    ? { firstRow: row, firstColumn: column, lastRow: row, lastColumn: column }
    : {
        firstRow: Math.min(box.firstRow, row),
        firstColumn: Math.min(box.firstColumn, column),
        lastRow: Math.max(box.lastRow, row),
        lastColumn: Math.max(box.lastColumn, column),
      };

interface SheetInfo {
  readonly sheetIndex: number;
  readonly name: string;
  readonly sheetKind: ProposedSheetV1["sheetKind"];
  readonly visibility: ProposedSheetV1["visibility"];
  readonly declaredRange: ProposedSheetV1["declaredRange"];
  readonly dateSystem: DateSystemV1 | null;
}

interface RegionState {
  readonly ordinal: number;
  readonly firstRow: number;
  lastRow: number;
  /** Undecided rows (≤ {@link PROPOSAL_LEADING_ROWS}); empty once the groups are fixed. */
  readonly window: { readonly rowIndex: number; readonly cells: readonly CellInputV1[] }[];
  groups: { firstColumn: number; lastColumn: number; readonly builder: TableBuilder }[] | null;
  /** Where its formulas are, for the inert item of a region that yields no table. */
  formulaBox: BoxV1 | null;
}

interface SheetState {
  readonly info: SheetInfo;
  readonly declared: { readonly fact: DeclaredTableFact; readonly builder: TableBuilder }[];
  readonly regions: RegionState[];
  open: RegionState | null;
  /** The last row of a region past {@link SHEET_REGION_LIMIT}, while it runs. */
  skippedThrough: number | null;
  omittedRegionCount: number;
  readonly formats: Map<number, CellFormatV1>;
  readonly validations: ValidationFact[];
  readonly preserved: PreservedPartFact[];
  rowCount: number;
  usedCellCount: number;
  formulaCellCount: number;
  numericCellCount: number;
  formulaNumericCount: number;
  crossSheetFormulaCount: number;
  row: { readonly rowIndex: number; readonly cellCount: number; readonly cells: Map<number, MutableCell> } | null;
}

interface MutableCell {
  text: string;
  isNumeric: boolean;
  format: CellFormatV1 | null;
  formula: CellInputV1["formula"];
}

/** One table as measured, before typing. */
interface Candidate {
  readonly sheet: SheetState;
  readonly tableKey: string;
  /** Declared name, or the region ordinal: what fingerprints call the table. */
  readonly identity: string;
  readonly declared: DeclaredTableFact | null;
  readonly regionOrdinal: number;
  readonly measured: MeasuredTableV1;
  readonly names: readonly { readonly name: string; readonly isGenerated: boolean }[];
  joinedTo: Candidate | null;
  splitEvidence: WorkbookEvidenceV1 | null;
  mergeEvidence: WorkbookEvidenceV1 | null;
}

/** One field as typed, with what its statements will say. */
interface FieldDraft {
  field: ProposedWorkbookFieldV1;
  readonly stats: ColumnStats;
  readonly typeEvidence: WorkbookEvidenceV1[];
  readonly optionsEvidence: readonly WorkbookEvidenceV1[];
  readonly nameEvidence: WorkbookEvidenceV1;
}

interface TableDraft {
  readonly candidate: Candidate;
  readonly tableName: string;
  readonly declaredEvidence: WorkbookEvidenceV1 | null;
  readonly fields: FieldDraft[];
  /** Its own data rows plus those of every table joined to it. */
  readonly rowCount: number;
  keyColumnKey: string | null;
  labelColumnKey: string | null;
}

const newSheet = (info: SheetInfo): SheetState => ({
  info,
  declared: [],
  regions: [],
  open: null,
  skippedThrough: null,
  omittedRegionCount: 0,
  formats: new Map(),
  validations: [],
  preserved: [],
  rowCount: 0,
  usedCellCount: 0,
  formulaCellCount: 0,
  numericCellCount: 0,
  formulaNumericCount: 0,
  crossSheetFormulaCount: 0,
  row: null,
});

const relativeRow = (rowIndex: number, firstColumn: number, cells: readonly CellInputV1[]): ProposedRowV1 => {
  const last = cells.at(-1);
  const texts = last === undefined ? [] : Array.from({ length: last.column - firstColumn + 1 }, () => "");
  for (const cell of cells) texts[cell.column - firstColumn] = cell.text;
  return { rowIndex, cells: texts };
};

const within = (cells: readonly CellInputV1[], first: number, last: number): CellInputV1[] =>
  cells.filter((cell) => cell.column >= first && cell.column <= last);

/** Column groups: occupied columns split at every wholly empty column. */
const groupsOf = (rows: readonly { readonly cells: readonly CellInputV1[] }[]): { firstColumn: number; lastColumn: number }[] => {
  const occupied = [...new Set(rows.flatMap((row) => row.cells.map((cell) => cell.column)))].sort((a, b) => a - b);
  const groups: { firstColumn: number; lastColumn: number }[] = [];
  for (const column of occupied) {
    const current = groups.at(-1);
    if (current !== undefined && column === current.lastColumn + 1) current.lastColumn = column;
    else groups.push({ firstColumn: column, lastColumn: column });
  }
  return groups;
};

const feedGroup = (
  group: { firstColumn: number; lastColumn: number; readonly builder: TableBuilder },
  rowIndex: number,
  cells: readonly CellInputV1[],
): void => {
  const mine = within(cells, group.firstColumn, group.lastColumn);
  if (mine.length > 0) group.builder.add(relativeRow(rowIndex, group.firstColumn, mine), mine);
};

const decideRegion = (region: RegionState, dateSystem: DateSystemV1 | null): void => {
  if (region.groups !== null) return;
  region.groups = groupsOf(region.window).map((group) => ({
    ...group,
    builder: new TableBuilder(group.firstColumn, { kind: "region" }, dateSystem),
  }));
  for (const { rowIndex, cells } of region.window) {
    for (const group of region.groups) feedGroup(group, rowIndex, cells);
  }
  for (const group of region.groups) group.builder.decide();
  region.window.length = 0;
};

/** After the groups are fixed, a cell in no group widens the group to its left. */
const addRegionRow = (region: RegionState, rowIndex: number, cells: readonly CellInputV1[], dateSystem: DateSystemV1 | null): void => {
  region.lastRow = rowIndex;
  for (const cell of cells) {
    if (cell.formula !== null) region.formulaBox = grow(region.formulaBox, rowIndex, cell.column);
  }
  if (region.groups === null) {
    region.window.push({ rowIndex, cells });
    if (region.window.length >= PROPOSAL_LEADING_ROWS) decideRegion(region, dateSystem);
    return;
  }
  const groups = region.groups;
  for (const cell of cells) {
    if (groups.some((group) => cell.column >= group.firstColumn && cell.column <= group.lastColumn)) continue;
    const left = [...groups].reverse().find((group) => group.firstColumn <= cell.column) ?? groups[0];
    if (left === undefined) continue;
    if (cell.column > left.lastColumn) left.lastColumn = cell.column;
  }
  for (const group of groups) feedGroup(group, rowIndex, cells);
};

const flushRow = (sheet: SheetState): void => {
  const row = sheet.row;
  if (row === null) return;
  sheet.row = null;
  const cells: CellInputV1[] = [...row.cells.entries()]
    .filter(([, cell]) => cell.text !== "" || cell.formula !== null)
    .sort(([left], [right]) => left - right)
    .map(([column, cell]) => {
      if (cell.isNumeric) {
        sheet.numericCellCount += 1;
        if (cell.formula !== null) sheet.formulaNumericCount += 1;
      }
      return { column, text: cell.text, format: cell.format, formula: cell.formula };
    });

  const loose: CellInputV1[] = [];
  for (const cell of cells) {
    const table = sheet.declared.find(
      ({ fact }) =>
        row.rowIndex >= fact.range.firstRow &&
        row.rowIndex <= fact.range.lastRow &&
        cell.column >= fact.range.firstColumn &&
        cell.column <= fact.range.lastColumn,
    );
    if (table === undefined) loose.push(cell);
  }
  for (const { fact, builder } of sheet.declared) {
    if (row.rowIndex < fact.range.firstRow || row.rowIndex > fact.range.lastRow) continue;
    const mine = within(cells, fact.range.firstColumn, fact.range.lastColumn);
    if (mine.length > 0) builder.add(relativeRow(row.rowIndex, fact.range.firstColumn, mine), mine);
  }

  const open = sheet.open;
  if (loose.length === 0) {
    closeRegion(sheet);
    return;
  }
  if (open !== null && row.rowIndex === open.lastRow + 1) {
    addRegionRow(open, row.rowIndex, loose, sheet.info.dateSystem);
    return;
  }
  if (sheet.skippedThrough !== null && row.rowIndex === sheet.skippedThrough + 1) {
    sheet.skippedThrough = row.rowIndex;
    return;
  }
  closeRegion(sheet);
  if (sheet.regions.length >= SHEET_REGION_LIMIT) {
    sheet.omittedRegionCount += 1;
    sheet.skippedThrough = row.rowIndex;
    return;
  }
  const region: RegionState = {
    ordinal: sheet.regions.length,
    firstRow: row.rowIndex,
    lastRow: row.rowIndex,
    window: [],
    groups: null,
    formulaBox: null,
  };
  sheet.regions.push(region);
  sheet.open = region;
  addRegionRow(region, row.rowIndex, loose, sheet.info.dateSystem);
};

function closeRegion(sheet: SheetState): void {
  if (sheet.open !== null) decideRegion(sheet.open, sheet.info.dateSystem);
  sheet.open = null;
  sheet.skippedThrough = null;
}

/** The rows a delimited stream is: F02's single table, measured by one builder. */
interface DelimitedState {
  readonly builder: TableBuilder;
  row: { readonly rowIndex: number; readonly cells: string[] } | null;
  rowCount: number;
  usedCellCount: number;
}

const flushDelimitedRow = (state: DelimitedState): void => {
  const row = state.row;
  if (row === null) return;
  state.row = null;
  const cells: CellInputV1[] = row.cells.flatMap((text, column) =>
    text === "" ? [] : [{ column, text, format: null, formula: null }],
  );
  state.builder.add({ rowIndex: row.rowIndex, cells: row.cells }, cells);
};

const statement = (
  subject: WorkbookInferenceSubjectV1,
  targetKey: string | null,
  columnIndex: number | null,
  editKind: WorkbookReviewEditKindV1 | null,
  evidence: readonly WorkbookEvidenceV1[],
  evidenceFingerprint: string,
): WorkbookStatementV1 => ({
  statementId: workbookStatementIdOf(subject, targetKey),
  subject,
  editKind,
  targetKey,
  columnIndex,
  evidence,
  evidenceFingerprint,
  disposition: "accepted",
});

const rowShape = (row: ProposedRowV1): EvidenceV1 => ({
  kind: "row-shape",
  rowIndex: row.rowIndex,
  cellCount: row.cells.length,
  valueCount: row.cells.filter((cell) => cell !== "").length,
});

const headerEvidence = (measured: MeasuredTableV1): readonly EvidenceV1[] =>
  measured.headerRowIndex === null
    ? measured.leadingRows.slice(0, 1).map(rowShape)
    : [{ kind: "header-text", rowIndex: measured.headerRowIndex, text: (measured.headerCells ?? []).join(" · ") }];

const discardEvidence = (measured: MeasuredTableV1): readonly EvidenceV1[] =>
  measured.discardedRows.slice(0, EVIDENCE_EXAMPLE_LIMIT).map(({ rowIndex, cells }) => rowShape({ rowIndex, cells }));

/** A unique name among `taken`, by F02's suffix rule. */
const uniqueName = (name: string, taken: Set<string>): string => {
  let candidate = name;
  for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix += 1) candidate = `${name} ${suffix}`;
  taken.add(candidate.toLowerCase());
  return candidate;
};

const sameHeading = (left: MeasuredTableV1, right: MeasuredTableV1): boolean =>
  left.firstColumn === right.firstColumn &&
  left.columnCount === right.columnCount &&
  left.headerCells !== null &&
  right.headerCells !== null &&
  left.headerCells.length === right.headerCells.length &&
  left.headerCells.every((cell, index) => cell === right.headerCells?.[index]);

const headOf = (candidate: Candidate): Candidate => (candidate.joinedTo === null ? candidate : headOf(candidate.joinedTo));

const sameName = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/** The cell or area a list source names, following one defined name, and the sheet it is on. */
const listRangeOf = (
  ref: string,
  sheet: SheetState,
  sheets: readonly SheetState[],
  definedNames: readonly DefinedNameFact[],
  depth = 0,
): { readonly sheet: SheetState; readonly reference: Extract<FormulaReferenceV1, { kind: "cell" | "area" | "columns" }> } | null => {
  const parsed = parseFormula(ref);
  if (parsed.kind !== "parsed" || parsed.ast.kind !== "reference") return null;
  const reference = parsed.ast.reference;
  if (reference.kind === "name") {
    const named =
      definedNames.find((name) => sameName(name.name, reference.name) && name.sheetIndex === sheet.info.sheetIndex) ??
      definedNames.find((name) => sameName(name.name, reference.name) && name.sheetIndex === null);
    return named === undefined || depth > 0 ? null : listRangeOf(named.ref, sheet, sheets, definedNames, depth + 1);
  }
  if (reference.kind !== "cell" && reference.kind !== "area" && reference.kind !== "columns") return null;
  const scope = reference.scope;
  if (scope !== null && (scope.workbook !== null || scope.lastSheet !== null)) return null;
  const target = scope === null ? sheet : sheets.find((candidate) => sameName(candidate.info.name, scope.firstSheet));
  return target === undefined ? null : { sheet: target, reference };
};

const referencedSheetOf = (
  ref: string,
  sheet: SheetState,
  sheets: readonly SheetState[],
  definedNames: readonly DefinedNameFact[],
): SheetState | null => listRangeOf(ref, sheet, sheets, definedNames)?.sheet ?? null;

/**
 * A list validation's options read from its source range, out of the rows
 * inference kept (each table's leading rows). `null` when the range is not a
 * bounded area, or any of its rows was not kept — the options then come from
 * the column's own values.
 */
const resolveListOptions = (
  ref: string,
  sheet: SheetState,
  sheets: readonly SheetState[],
  candidates: readonly Candidate[],
  definedNames: readonly DefinedNameFact[],
): readonly string[] | null => {
  const found = listRangeOf(ref, sheet, sheets, definedNames);
  if (found === null || found.reference.kind === "columns") return null;
  const { reference } = found;
  const [first, last] = reference.kind === "cell" ? [reference.cell, reference.cell] : [reference.first, reference.last];
  const rows = [Math.min(first.row, last.row), Math.max(first.row, last.row)] as const;
  const columns = [Math.min(first.column, last.column), Math.max(first.column, last.column)] as const;
  if ((rows[1] - rows[0] + 1) * (columns[1] - columns[0] + 1) > 1_000) return null;
  const kept = candidates
    .filter((candidate) => candidate.sheet === found.sheet)
    .flatMap((candidate) => candidate.measured.leadingRows.map((row) => ({ row, firstColumn: candidate.measured.firstColumn })));
  const options: string[] = [];
  for (let rowIndex = rows[0]; rowIndex <= rows[1]; rowIndex += 1) {
    const held = kept.filter(({ row }) => row.rowIndex === rowIndex);
    if (held.length === 0) return null;
    for (let column = columns[0]; column <= columns[1]; column += 1) {
      const holder = held.find(({ row, firstColumn }) => column >= firstColumn && column - firstColumn < row.cells.length);
      options.push(holder === undefined ? "" : (holder.row.cells[column - holder.firstColumn] ?? ""));
    }
  }
  return options;
};

const coversColumn = (validation: ValidationFact, column: number, measured: MeasuredTableV1): boolean =>
  column >= validation.range.firstColumn &&
  column <= validation.range.lastColumn &&
  validation.range.lastRow > (measured.headerRowIndex ?? measured.firstRowIndex - 1) &&
  validation.range.firstRow <= measured.lastRowIndex;

/** A record rule's comparison value, when the rule's first formula is a literal. */
const ruleValueOf = (validation: ValidationFact, dateSystem: DateSystemV1 | null): CellValueV1 | null => {
  const text = validation.formula1?.trim() ?? "";
  if (validation.rule === "date") {
    const epochDay = dateSystem === null ? null : serialToEpochDay(text, dateSystem);
    return epochDay === null ? null : dateValue(epochDay);
  }
  const decimal = readDecimal(text);
  return decimal === null || (validation.rule === "whole" && decimal.includes(".")) ? null : decimalValue(decimal);
};

/**
 * Reads a completed V2 fact stream and proposes a multi-table app.
 *
 * @throws when the stream carries no terminal summary.
 */
export function inferWorkbook(
  items: Iterable<WorkbookFactStreamItemV2>,
  context: WorkbookInferenceContextV1,
): ProposedWorkbookV1 {
  const sheets: SheetState[] = [];
  const definedNames: DefinedNameFact[] = [];
  let delimited: DelimitedState | null = null;
  let current: SheetState | null = null;
  let diagnostics: readonly ImportDiagnosticV2[] | null = null;
  let hasSeenFact = false;

  for (const item of items) {
    if (item.kind === "summary") {
      diagnostics = item.diagnostics;
      continue;
    }
    for (const fact of item.facts) {
      if (!hasSeenFact) {
        hasSeenFact = true;
        if (fact.kind !== "sheet") {
          delimited = { builder: new TableBuilder(0, { kind: "delimited" }, null), row: null, rowCount: 0, usedCellCount: 0 };
        }
      }
      if (delimited !== null) {
        if (fact.kind === "row") {
          flushDelimitedRow(delimited);
          delimited.rowCount += 1;
          delimited.row = { rowIndex: fact.rowIndex, cells: Array.from({ length: fact.cellCount }, () => "") };
        } else if (fact.kind === "value" && delimited.row?.rowIndex === fact.rowIndex) {
          delimited.usedCellCount += 1;
          delimited.row.cells[fact.columnIndex] = sourceTextOfCellValue(fact.value);
        }
        continue;
      }
      if (fact.kind === "sheet") {
        if (current !== null) {
          flushRow(current);
          closeRegion(current);
        }
        current = newSheet({
          sheetIndex: fact.sheetIndex,
          name: fact.name,
          sheetKind: fact.sheetKind,
          visibility: fact.visibility,
          declaredRange: fact.declaredRange,
          dateSystem: fact.dateSystem,
        });
        sheets.push(current);
        continue;
      }
      const sheet = current;
      if (sheet === null) continue;
      switch (fact.kind) {
        case "row":
          flushRow(sheet);
          sheet.rowCount += 1;
          sheet.row = { rowIndex: fact.rowIndex, cellCount: fact.cellCount, cells: new Map() };
          break;
        case "cell-format":
          sheet.formats.set(fact.columnIndex, {
            numberFormat: fact.numberFormat,
            formatClass: fact.formatClass,
            currencySymbol: fact.currencySymbol,
          });
          break;
        case "formula":
        case "value": {
          const row = sheet.row;
          if (row === null || row.rowIndex !== fact.rowIndex) break;
          const cell = row.cells.get(fact.columnIndex) ?? { text: "", isNumeric: false, format: null, formula: null };
          if (fact.kind === "formula") {
            sheet.formulaCellCount += 1;
            const parsed = fact.text === null ? null : parseFormula(fact.text);
            const ast = parsed?.kind === "parsed" ? parsed.ast : null;
            if (
              ast !== null &&
              extractReferences(ast).some(
                (reference) => "scope" in reference && reference.scope !== null && reference.scope.firstSheet !== sheet.info.name,
              )
            ) {
              sheet.crossSheetFormulaCount += 1;
            }
            cell.formula = { text: fact.text, isArray: fact.isArray, isExternal: fact.isExternal, lookups: ast === null ? [] : findLookups(ast) };
          } else {
            sheet.usedCellCount += 1;
            cell.text = sourceTextOfCellValue(fact.value);
            cell.isNumeric = fact.value.kind === "decimal";
            cell.format = sheet.formats.get(fact.columnIndex) ?? null;
          }
          row.cells.set(fact.columnIndex, cell);
          break;
        }
        case "declared-table": {
          const range = fact.range;
          const headerRowIndex = fact.headerRowCount > 0 ? range.firstRow + fact.headerRowCount - 1 : null;
          sheet.declared.push({
            fact,
            builder: new TableBuilder(
              range.firstColumn,
              { kind: "declared", headerRowIndex, firstHeaderRow: range.firstRow, lastDataRow: range.lastRow - fact.totalsRowCount },
              sheet.info.dateSystem,
              range.lastColumn - range.firstColumn + 1,
            ),
          });
          break;
        }
        case "validation":
          if (sheet.validations.length < SHEET_VALIDATION_LIMIT) sheet.validations.push(fact);
          break;
        case "defined-name":
          definedNames.push(fact);
          break;
        case "preserved-part":
          if (sheet.preserved.length < SHEET_PRESERVED_PART_LIMIT) sheet.preserved.push(fact);
          break;
        case "diagnostic":
        case "merge":
          break;
        default: {
          const unreachable: never = fact;
          return unreachable;
        }
      }
    }
  }
  if (current !== null) {
    flushRow(current);
    closeRegion(current);
  }
  if (delimited !== null) flushDelimitedRow(delimited);

  if (diagnostics === null) {
    throw new Error("inference needs a completed fact stream with its summary");
  }

  return delimited !== null || sheets.length === 0
    ? proposeDelimited(
        delimited ?? { builder: new TableBuilder(0, { kind: "delimited" }, null), row: null, rowCount: 0, usedCellCount: 0 },
        diagnostics,
        context,
      )
    : proposeWorkbook(sheets, definedNames, diagnostics, context);
}

/** F02's single-table proposal in the workbook shape, statements and fingerprints unchanged. */
function proposeDelimited(
  state: DelimitedState,
  diagnostics: readonly ImportDiagnosticV2[],
  context: WorkbookInferenceContextV1,
): ProposedWorkbookV1 {
  const measured = state.builder.finish();
  const tableKey = "s0.r0";
  const name = titleize(context.fileName);
  const tableName = uniqueName(name, new Set((context.existingApp?.tableNames ?? []).map((taken) => taken.toLowerCase())));
  const fileEvidence: EvidenceV1 = { kind: "file-name", fileName: context.fileName };
  const f02 = (
    subject: InferenceSubjectV1,
    targetKey: string | null,
    columnIndex: number | null,
    editKind: WorkbookReviewEditKindV1,
    evidence: readonly EvidenceV1[],
  ): WorkbookStatementV1 =>
    statement(subject, targetKey, columnIndex, editKind, evidence, evidenceFingerprintInput(subject, columnIndex, evidence));

  const names = fieldNamesFrom(measured.headerCells, measured.columnCount);
  const statements: WorkbookStatementV1[] = [
    f02("app-name", null, null, "rename-app", [fileEvidence]),
    f02("table-name", tableKey, null, "rename-table", [fileEvidence]),
    f02("header-row", tableKey, null, "set-header-row", headerEvidence(measured)),
  ];
  if (measured.discardedRowCount > 0) {
    statements.push(f02("discarded-rows", tableKey, null, "set-header-row", discardEvidence(measured)));
  }
  const fields = names.map(({ name: fieldName, isGenerated }, columnIndex): ProposedWorkbookFieldV1 => {
    const stats = measured.columns[columnIndex] as ColumnStats;
    const choice = chooseValueType(stats);
    const columnKey = `${tableKey}.c${columnIndex}`;
    statements.push(
      f02("field-name", columnKey, columnIndex, "rename-field", [
        measured.headerRowIndex === null || isGenerated
          ? fileEvidence
          : { kind: "header-text", rowIndex: measured.headerRowIndex, text: fieldName },
      ]),
      f02("field-type", columnKey, columnIndex, "override-type", choice.evidence),
    );
    if (choice.type.kind === "enum") {
      statements.push(f02("enum-options", columnKey, columnIndex, "edit-enum-options", choice.optionsEvidence));
    }
    return {
      columnKey,
      columnIndex,
      fieldName,
      isNameGenerated: isGenerated,
      type: choice.type,
      valueType: choice.type,
      sourceFormat: choice.sourceFormat,
      enumOptions: choice.enumOptions,
      violations: choice.violations,
      formulaText: null,
    };
  });

  return {
    fileName: context.fileName,
    appName: name,
    sheets: [
      {
        sheetKey: "s0",
        sheetIndex: 0,
        name: context.fileName,
        sheetKind: "worksheet",
        visibility: "visible",
        isSelected: true,
        classification: ["table"],
        declaredRange: null,
        dateSystem: null,
        rowCount: state.rowCount,
        usedCellCount: state.usedCellCount,
        formulaCellCount: 0,
        omittedRegionCount: 0,
      },
    ],
    tables: [
      {
        tableKey,
        sheetKey: "s0",
        tableName,
        source: { kind: "region" },
        firstColumn: 0,
        lastColumn: Math.max(0, measured.columnCount - 1),
        headerRowIndex: measured.headerRowIndex,
        leadingRows: measured.leadingRows,
        discardedRows: measured.discardedRows,
        discardedRowCount: measured.discardedRowCount,
        rowCount: measured.dataRowCount,
        joinedToTableKey: null,
        fields,
        keyColumnKey: null,
        labelColumnKey: null,
      },
    ],
    relationships: [],
    recordRules: [],
    inertItems: [],
    inertCounts: countInert([]),
    statements,
    diagnostics,
    isRowCountExact: true,
  };
}

const countInert = (items: readonly ProposedInertItemV1[]): Readonly<Record<PreservedPartKindV1, number>> => {
  const counts = Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;
  for (const item of items) counts[item.kind] += 1;
  return counts;
};

function proposeWorkbook(
  sheets: readonly SheetState[],
  definedNames: readonly DefinedNameFact[],
  diagnostics: readonly ImportDiagnosticV2[],
  context: WorkbookInferenceContextV1,
): ProposedWorkbookV1 {
  // Pass 1 — every sheet measured, merges and splits decided.
  const candidates: Candidate[] = [];
  for (const sheet of sheets) {
    const sheetKey = `s${sheet.info.sheetIndex}`;
    for (const [ordinal, { fact, builder }] of sheet.declared.entries()) {
      const measured = builder.finish();
      candidates.push({
        sheet,
        tableKey: `${sheetKey}.t${ordinal}`,
        identity: fact.name,
        declared: fact,
        regionOrdinal: -1,
        measured,
        names: fieldNamesFrom(fact.columns, measured.columnCount),
        joinedTo: null,
        splitEvidence: null,
        mergeEvidence: null,
      });
    }
    let ordinal = 0;
    let previousRegion: Candidate[] = [];
    let previousRegionLastRow = -1;
    let previous: Candidate | null = null;
    for (const region of sheet.regions) {
      const inRegion: Candidate[] = [];
      for (const group of region.groups ?? []) {
        const measured = group.builder.finish();
        if (measured.headerRowIndex === null || measured.dataRowCount === 0) continue;
        const candidate: Candidate = {
          sheet,
          tableKey: `${sheetKey}.r${ordinal}`,
          identity: `r${ordinal}`,
          declared: null,
          regionOrdinal: region.ordinal,
          measured,
          names: fieldNamesFrom(measured.headerCells, measured.columnCount),
          joinedTo: null,
          splitEvidence: null,
          mergeEvidence: null,
        };
        ordinal += 1;
        const match = previousRegion.find((earlier) => sameHeading(earlier.measured, measured));
        if (match !== undefined) {
          candidate.joinedTo = headOf(match);
          candidate.mergeEvidence = {
            kind: "matching-headings",
            headings: measured.headerCells ?? [],
            rowIndex: measured.headerRowIndex,
          };
        } else if (previous !== null) {
          candidate.splitEvidence =
            previous.regionOrdinal === region.ordinal
              ? { kind: "column-gap", afterColumnIndex: previous.measured.firstColumn + previous.measured.columnCount - 1, beforeColumnIndex: measured.firstColumn }
              : { kind: "blank-row-gap", afterRowIndex: previousRegionLastRow, beforeRowIndex: region.firstRow };
        }
        if (match === undefined) previous = candidate;
        inRegion.push(candidate);
        candidates.push(candidate);
      }
      if (inRegion.length > 0) {
        previousRegion = inRegion;
        previousRegionLastRow = region.lastRow;
      }
    }
  }

  // Pass 2 — every table typed and named.
  const takenNames = new Set((context.existingApp?.tableNames ?? []).map((name) => name.toLowerCase()));
  const drafts: TableDraft[] = [];
  for (const sheet of sheets) {
    const onSheet = candidates.filter((candidate) => candidate.sheet === sheet);
    const standalone = onSheet.filter((candidate) => candidate.joinedTo === null);
    for (const [position, candidate] of onSheet.entries()) {
      const { measured, tableKey, declared } = candidate;
      const joined = onSheet.filter((other) => other.joinedTo === candidate);
      const declaredEvidence: WorkbookEvidenceV1 | null =
        declared === null
          ? null
          : { kind: "declared-table", name: declared.name, range: declared.range, headerRowCount: declared.headerRowCount, totalsRowCount: declared.totalsRowCount };
      const fields = candidate.names.map(({ name: fieldName, isGenerated }, relative): FieldDraft => {
        const columnIndex = measured.firstColumn + relative;
        const stats = joined.reduce(
          (merged, other) => mergeStats(merged, other.measured.columns[relative] as ColumnStats),
          measured.columns[relative] as ColumnStats,
        );
        const validation = sheet.validations.find((rule) => coversColumn(rule, columnIndex, measured)) ?? null;
        const listOptions =
          validation?.rule !== "list"
            ? null
            : (inlineOptionsOf(validation.listSource) ??
              (validation.listSource?.kind === "range"
                ? resolveListOptions(validation.listSource.ref, sheet, sheets, candidates, definedNames)
                : null));
        const choice = chooseDeclaredType(stats, validation, listOptions) ?? chooseValueType(stats);
        return {
          field: {
            columnKey: `${tableKey}.c${columnIndex}`,
            columnIndex,
            fieldName,
            isNameGenerated: isGenerated,
            type: choice.type,
            valueType: choice.type,
            sourceFormat: choice.sourceFormat,
            enumOptions: choice.enumOptions,
            violations: choice.violations,
            formulaText: stats.formulaCount > 0 ? (stats.firstFormula?.text ?? null) : null,
          },
          stats,
          typeEvidence: [...choice.evidence],
          optionsEvidence: choice.optionsEvidence,
          nameEvidence:
            measured.headerRowIndex === null || isGenerated
              ? (declaredEvidence ?? { kind: "file-name", fileName: context.fileName })
              : { kind: "header-text", rowIndex: measured.headerRowIndex, text: fieldName },
        };
      });
      drafts.push({
        candidate,
        tableName: uniqueName(
          standalone.length === 1 && candidate === standalone[0] ? sheet.info.name : (declared?.name ?? `${sheet.info.name} ${position + 1}`),
          takenNames,
        ),
        declaredEvidence,
        fields,
        rowCount: measured.dataRowCount + joined.reduce((sum, other) => sum + other.measured.dataRowCount, 0),
        keyColumnKey: null,
        labelColumnKey: null,
      });
    }
  }

  // Pass 3 — keys, relationships (which may settle a parent's key), labels.
  const keyedColumns = (draft: TableDraft): KeyedColumnV1[] =>
    draft.fields.map(({ field, stats }) => ({ columnKey: field.columnKey, fieldName: field.fieldName, type: field.type, stats }));
  const keys = new Map<string, string | null>(
    drafts.map((draft) => [draft.candidate.tableKey, chooseKey(keyedColumns(draft), draft.rowCount)?.columnKey ?? null]),
  );
  const standaloneDrafts = drafts.filter((draft) => draft.candidate.joinedTo === null);
  const relatable = standaloneDrafts.map(
    (draft): RelatableTableV1 => ({
      tableKey: draft.candidate.tableKey,
      sheetIndex: draft.candidate.sheet.info.sheetIndex,
      sheetName: draft.candidate.sheet.info.name,
      tableName: draft.tableName,
      declaredName: draft.candidate.declared?.name ?? null,
      firstColumn: draft.candidate.measured.firstColumn,
      lastColumn: draft.candidate.measured.firstColumn + draft.candidate.measured.columnCount - 1,
      rowCount: draft.rowCount,
      columns: draft.fields.map(({ field, stats }) => ({
        columnKey: field.columnKey,
        columnIndex: field.columnIndex,
        fieldName: field.fieldName,
        type: field.type,
        stats,
      })),
    }),
  );
  const detected = detectRelationships(relatable, keys, definedNames);
  for (const draft of drafts) {
    draft.keyColumnKey = keys.get(draft.candidate.tableKey) ?? null;
    for (const entry of draft.fields) {
      if (detected.relationships.some((relationship) => relationship.fromColumnKey === entry.field.columnKey)) {
        entry.field = { ...entry.field, type: { kind: "reference" } };
      }
      const note = detected.notes.get(entry.field.columnKey);
      if (note !== undefined) entry.typeEvidence.push(note);
    }
    const columns = keyedColumns(draft);
    draft.labelColumnKey = chooseLabel(columns, columns.find((column) => column.columnKey === draft.keyColumnKey) ?? null)?.columnKey ?? null;
  }

  // Sheets whose cells a validation list elsewhere draws its options from.
  const listSources = new Map<SheetState, ValidationFact>();
  for (const sheet of sheets) {
    for (const validation of sheet.validations) {
      if (validation.rule !== "list" || validation.listSource?.kind !== "range") continue;
      const target = referencedSheetOf(validation.listSource.ref, sheet, sheets, definedNames);
      if (target !== null && !listSources.has(target)) listSources.set(target, validation);
    }
  }

  // Pass 4 — per sheet: roles, inert inventory, record rules, statements.
  const statements: WorkbookStatementV1[] = [
    statement("app-name", null, null, "rename-app", [{ kind: "file-name", fileName: context.fileName }], workbookFingerprintInput("app-name", [], [{ kind: "file-name", fileName: context.fileName }])),
  ];
  const tables: ProposedTableV2[] = [];
  const recordRules: ProposedRecordRuleV1[] = [];
  const inertItems: ProposedInertItemV1[] = [];
  const roles = new Map<SheetState, readonly SheetRoleV1[]>();

  for (const sheet of sheets) {
    const sheetName = sheet.info.name;
    const sheetKey = `s${sheet.info.sheetIndex}`;
    const onSheet = drafts.filter((draft) => draft.candidate.sheet === sheet);
    const standalone = onSheet.filter((draft) => draft.candidate.joinedTo === null);
    const say = (
      scope: readonly (string | number)[],
      subject: WorkbookInferenceSubjectV1,
      targetKey: string | null,
      columnIndex: number | null,
      editKind: WorkbookReviewEditKindV1 | null,
      evidence: readonly WorkbookEvidenceV1[],
    ): void => {
      statements.push(statement(subject, targetKey, columnIndex, editKind, evidence, workbookFingerprintInput(subject, scope, evidence)));
    };
    const shape: WorkbookEvidenceV1 = {
      kind: "sheet-shape",
      sheetName,
      sheetKind: sheet.info.sheetKind,
      usedCellCount: sheet.usedCellCount,
      formulaCellCount: sheet.formulaCellCount,
      tableCount: standalone.length,
    };
    const chartParts = (kind: PreservedPartKindV1): number => sheet.preserved.filter((part) => part.partKind === kind).length;

    const sheetRoles = classifySheet({
      sheetKind: sheet.info.sheetKind,
      tableWidths: standalone.map((draft) => draft.fields.length),
      isListSource: listSources.has(sheet),
      chartPartCount: chartParts("chart") + chartParts("pivot-table"),
      usedCellCount: sheet.usedCellCount,
      numericCellCount: sheet.numericCellCount,
      formulaNumericCount: sheet.formulaNumericCount,
      crossSheetFormulaCount: sheet.crossSheetFormulaCount,
    });
    roles.set(sheet, sheetRoles);
    for (const role of sheetRoles) {
      if (role === "table" || role === "snapshot") continue;
      const listSource = listSources.get(sheet);
      const evidence: readonly WorkbookEvidenceV1[] =
        role === "lookup" && listSource !== undefined
          ? [validationEvidence(listSource, null)]
          : role === "chart" && sheet.info.sheetKind !== "chartsheet"
            ? (["chart", "pivot-table"] as const)
                .filter((kind) => chartParts(kind) > 0)
                .map((kind) => ({ kind: "preserved-part", partKind: kind, count: chartParts(kind) }))
            : [shape];
      say([sheetName, role], "sheet-classification", `${sheetKey}.${role}`, null, "reject-statement", evidence);
    }

    for (const part of sheet.preserved) {
      inertItems.push({ kind: part.partKind, sheetKey, location: part.location, reasonKey: part.reasonKey, anchor: part.anchor });
    }

    for (const draft of onSheet) {
      const { candidate } = draft;
      const { measured, tableKey } = candidate;
      const scope = [sheetName, candidate.identity];
      say(scope, "table-name", tableKey, null, "rename-table", [draft.declaredEvidence ?? shape]);
      say(scope, "header-row", tableKey, null, "set-header-row", draft.declaredEvidence === null ? headerEvidence(measured) : [draft.declaredEvidence]);
      if (measured.discardedRowCount > 0) say(scope, "discarded-rows", tableKey, null, "set-header-row", discardEvidence(measured));
      if (candidate.mergeEvidence !== null) say(scope, "table-merge", tableKey, null, "reject-statement", [candidate.mergeEvidence]);
      if (candidate.splitEvidence !== null) say(scope, "table-split", tableKey, null, "reject-statement", [candidate.splitEvidence]);
      const columnEvidence = (columnKey: string | null): readonly WorkbookEvidenceV1[] => {
        const entry = draft.fields.find(({ field }) => field.columnKey === columnKey);
        return entry === undefined
          ? []
          : [entry.nameEvidence, { kind: "distinct-values", distinct: entry.stats.distinct.size, sampled: entry.stats.nonEmpty, options: [] }];
      };
      say(scope, "table-key", tableKey, null, "set-key", columnEvidence(draft.keyColumnKey));
      say(scope, "table-label", tableKey, null, "set-label", columnEvidence(draft.labelColumnKey));

      const firstDataRow = (measured.headerRowIndex ?? measured.firstRowIndex - 1) + 1;
      for (const { field, stats, typeEvidence, optionsEvidence, nameEvidence } of draft.fields) {
        const columnScope = [...scope, field.columnIndex];
        say(columnScope, "field-name", field.columnKey, field.columnIndex, "rename-field", [nameEvidence]);
        say(columnScope, "field-type", field.columnKey, field.columnIndex, "override-type", typeEvidence);
        if (field.valueType.kind === "enum") say(columnScope, "enum-options", field.columnKey, field.columnIndex, "edit-enum-options", optionsEvidence);
        if (stats.formulaCount > 0) {
          say(columnScope, "formula", field.columnKey, field.columnIndex, null, [
            {
              kind: "formula-text",
              text: stats.firstFormula?.text ?? null,
              isArray: stats.firstFormula?.isArray ?? false,
              isExternal: stats.firstFormula?.isExternal ?? false,
              formulaCount: stats.formulaCount,
            },
          ]);
          const anchor = { firstRow: firstDataRow, firstColumn: field.columnIndex, lastRow: measured.lastRowIndex, lastColumn: field.columnIndex };
          inertItems.push({
            kind: "formula",
            sheetKey,
            location: locationText(sheetName, anchor.firstRow, anchor.firstColumn, anchor.lastRow, anchor.lastColumn),
            reasonKey: "formula-not-live-yet",
            anchor,
          });
        }
      }

      tables.push({
        tableKey,
        sheetKey,
        tableName: draft.tableName,
        source:
          candidate.declared === null
            ? { kind: "region" }
            : {
                kind: "declared-table",
                name: candidate.declared.name,
                range: candidate.declared.range,
                headerRowCount: candidate.declared.headerRowCount,
                totalsRowCount: candidate.declared.totalsRowCount,
              },
        firstColumn: measured.firstColumn,
        lastColumn: measured.firstColumn + Math.max(0, measured.columnCount - 1),
        headerRowIndex: measured.headerRowIndex,
        leadingRows: measured.leadingRows,
        discardedRows: measured.discardedRows,
        discardedRowCount: measured.discardedRowCount,
        rowCount: measured.dataRowCount,
        joinedToTableKey: candidate.joinedTo?.tableKey ?? null,
        fields: draft.fields.map(({ field }) => field),
        keyColumnKey: draft.keyColumnKey,
        labelColumnKey: draft.labelColumnKey,
      });
    }

    // Formulas in regions that became no table: one item for the sheet (D33).
    const tabled = new Set(onSheet.map((draft) => draft.candidate.regionOrdinal));
    const loose = sheet.regions
      .filter((region) => !tabled.has(region.ordinal) && region.formulaBox !== null)
      .reduce<BoxV1 | null>((box, region) => {
        const found = region.formulaBox as BoxV1;
        return grow(grow(box, found.firstRow, found.firstColumn), found.lastRow, found.lastColumn);
      }, null);
    if (loose !== null) {
      inertItems.push({
        kind: "formula",
        sheetKey,
        location: locationText(sheetName, loose.firstRow, loose.firstColumn, loose.lastRow, loose.lastColumn),
        reasonKey: "formula-not-live-yet",
        anchor: { ...loose },
      });
    }

    for (const validation of sheet.validations) {
      const isExpressible =
        (validation.rule === "whole" || validation.rule === "decimal" || validation.rule === "date") &&
        (validation.operator === "equal" || validation.operator === "not-equal");
      const value = isExpressible ? ruleValueOf(validation, sheet.info.dateSystem) : null;
      const covered = onSheet.flatMap((draft) =>
        draft.fields.flatMap(({ field }) =>
          coversColumn(validation, field.columnIndex, draft.candidate.measured) ? [{ draft, field }] : [],
        ),
      );
      if (validation.rule === "list" && covered.length > 0) continue;
      if (value === null || covered.length === 0) {
        const range = validation.range;
        inertItems.push({
          kind: "unsupported-validation",
          sheetKey,
          location: locationText(sheetName, range.firstRow, range.firstColumn, range.lastRow, range.lastColumn),
          reasonKey: "validation-not-expressible",
          anchor: range,
        });
        continue;
      }
      for (const { draft, field } of covered) {
        const ruleKey = `rule:${field.columnKey}`;
        if (recordRules.some((rule) => rule.ruleKey === ruleKey)) continue;
        const equals = { kind: "field-equals", columnKey: field.columnKey, value } as const;
        recordRules.push({
          ruleKey,
          tableKey: draft.candidate.tableKey,
          columnKey: field.columnKey,
          condition: validation.operator === "equal" ? equals : { kind: "not", condition: equals },
          isActive: true,
        });
        say([sheetName, draft.candidate.identity, field.columnIndex], "record-rule", ruleKey, field.columnIndex, "reject-statement", [
          validationEvidence(validation, null),
        ]);
      }
    }
  }

  for (const relationship of detected.relationships) {
    const draft = drafts.find((candidate) => candidate.candidate.tableKey === relationship.fromTableKey) as TableDraft;
    const column = draft.fields.find(({ field }) => field.columnKey === relationship.fromColumnKey)?.field.columnIndex ?? null;
    const evidence = [detected.evidence.get(relationship.relationshipKey) as WorkbookEvidenceV1];
    statements.push(
      statement(
        "relationship",
        relationship.relationshipKey,
        column,
        "reject-relationship",
        evidence,
        workbookFingerprintInput("relationship", [draft.candidate.sheet.info.name, draft.candidate.identity, column ?? -1], evidence),
      ),
    );
  }

  const streamed = new Map(sheets.map((sheet) => [sheet.info.sheetIndex, sheet]));
  const choices: readonly WorkbookSheetChoiceV1[] = context.sheetSelection ?? sheets.map((sheet) => ({ ...sheet.info, isSelected: true }));
  const listed = [
    ...choices,
    ...sheets
      .filter((sheet) => !choices.some((choice) => choice.sheetIndex === sheet.info.sheetIndex))
      .map((sheet) => ({ ...sheet.info, isSelected: true })),
  ].sort((left, right) => left.sheetIndex - right.sheetIndex);

  const proposedSheets = listed.map((choice): ProposedSheetV1 => {
    const sheet = streamed.get(choice.sheetIndex);
    const sheetKey = `s${choice.sheetIndex}`;
    if (sheet === undefined || !choice.isSelected) {
      return {
        sheetKey,
        sheetIndex: choice.sheetIndex,
        name: choice.name,
        sheetKind: choice.sheetKind,
        visibility: choice.visibility,
        isSelected: false,
        classification: ["excluded"],
        declaredRange: null,
        dateSystem: null,
        rowCount: null,
        usedCellCount: null,
        formulaCellCount: null,
        omittedRegionCount: 0,
      };
    }
    return {
      sheetKey,
      sheetIndex: choice.sheetIndex,
      name: sheet.info.name,
      sheetKind: sheet.info.sheetKind,
      visibility: sheet.info.visibility,
      isSelected: true,
      classification: roles.get(sheet) ?? ["snapshot"],
      declaredRange: sheet.info.declaredRange,
      dateSystem: sheet.info.dateSystem,
      rowCount: sheet.rowCount,
      usedCellCount: sheet.usedCellCount,
      formulaCellCount: sheet.formulaCellCount,
      omittedRegionCount: sheet.omittedRegionCount,
    };
  });

  return applyRejectionMemory(
    {
      fileName: context.fileName,
      appName: titleize(context.fileName),
      sheets: proposedSheets,
      tables,
      relationships: detected.relationships,
      recordRules,
      inertItems,
      inertCounts: countInert(inertItems),
      statements,
      diagnostics,
      isRowCountExact: true,
    },
    context.rejectionMemory,
    context.fingerprintOf,
  );
}
