/**
 * Relationships between proposed tables (M21; FR-7; CAP-23).
 *
 * **Lookup formulas beat key matching.** The primary signal is the user's own
 * lookup (`VLOOKUP`, `XLOOKUP`, `INDEX`/`MATCH` …, M03): the key argument's
 * column in this table is the reference field, and the lookup range's first
 * column is the parent's key — it must be, or become, the parent table's key.
 * A parent keyed on another column gets no relationship, and the child's type
 * statement says why.
 *
 * The secondary signal runs only where no lookup covers the column: the
 * column's heading matches the parent key's heading or the parent table's
 * name, and at least {@link KEY_MATCH_CONTAINMENT} of at least
 * {@link KEY_MATCH_MINIMUM_VALUES} values are among the parent's keys.
 *
 * Containment is measured on the bounded distinct sketches (`types.ts`,
 * `KEY_SKETCH_LIMIT` values per column). A child column that outgrew its sketch
 * is measured on what was kept and says `isSampled: true` — never a claim of
 * full containment that was not measured. A parent key is always fully
 * measured: an overflowing column is never a key.
 */

import { lookupRangeOf, parseFormula, type LookupRangeV1, type LookupV1 } from "../../domain/formulas/index.js";
import type { WorkbookStructureFactV1 } from "../facts/index.js";
import { isUniqueAndComplete, type KeyedColumnV1 } from "./keys.js";
import type { WorkbookEvidenceV1 } from "./statements.js";
import type { ColumnStats } from "./types.js";
import type { ProposedRelationshipV1, RelationshipCandidateV1 } from "./workbook-proposal.js";

/** The share of child values that must be parent keys for a key match. */
export const KEY_MATCH_CONTAINMENT = 0.98;

/** A key match needs at least this many child values. */
export const KEY_MATCH_MINIMUM_VALUES = 8;

type DefinedNameFact = Extract<WorkbookStructureFactV1, { kind: "defined-name" }>;

export interface RelatableColumnV1 extends KeyedColumnV1 {
  readonly columnIndex: number;
}

/** What relationship detection needs of one standalone table. */
export interface RelatableTableV1 {
  readonly tableKey: string;
  readonly sheetIndex: number;
  readonly sheetName: string;
  readonly tableName: string;
  readonly declaredName: string | null;
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly rowCount: number;
  readonly columns: readonly RelatableColumnV1[];
}

export interface DetectedRelationshipsV1 {
  readonly relationships: readonly ProposedRelationshipV1[];
  /** Evidence per relationship key, for its statement. */
  readonly evidence: ReadonlyMap<string, WorkbookEvidenceV1>;
  /** Why a lookup proposed nothing, per child column key (parent keyed elsewhere). */
  readonly notes: ReadonlyMap<string, WorkbookEvidenceV1>;
}

const same = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();

export interface ContainmentV1 {
  readonly matched: number;
  readonly measured: number;
  /** Distinct child values with no parent key: tomorrow's broken references (D36). */
  readonly broken: number;
  readonly isSampled: boolean;
}

export function containmentOf(child: ColumnStats, parentKey: ColumnStats): ContainmentV1 {
  let matched = 0;
  let measured = 0;
  let broken = 0;
  for (const [value, entry] of child.distinct) {
    measured += entry.count;
    if (parentKey.distinct.has(value)) matched += entry.count;
    else broken += 1;
  }
  return { matched, measured, broken, isSampled: child.distinctOverflow };
}

const meetsContainment = (containment: ContainmentV1): boolean =>
  containment.measured >= KEY_MATCH_MINIMUM_VALUES && containment.matched >= containment.measured * KEY_MATCH_CONTAINMENT;

const resolveParent = (
  range: LookupRangeV1,
  child: RelatableTableV1,
  tables: readonly RelatableTableV1[],
  definedNames: readonly DefinedNameFact[],
  depth = 0,
): { readonly table: RelatableTableV1; readonly column: RelatableColumnV1 } | null => {
  switch (range.kind) {
    case "columns": {
      const scope = range.scope;
      if (scope !== null && (scope.workbook !== null || scope.lastSheet !== null)) return null;
      const sheetName = scope?.firstSheet ?? child.sheetName;
      const table = tables.find(
        (candidate) =>
          candidate !== child &&
          same(candidate.sheetName, sheetName) &&
          range.firstColumn >= candidate.firstColumn &&
          range.firstColumn <= candidate.lastColumn,
      );
      const column = table?.columns.find((candidate) => candidate.columnIndex === range.firstColumn);
      return table === undefined || column === undefined ? null : { table, column };
    }
    case "table-columns": {
      const name = range.table;
      if (name === null) return null;
      const table = tables.find((candidate) => candidate !== child && candidate.declaredName !== null && same(candidate.declaredName, name));
      const first = range.firstColumn;
      const column = first === null ? table?.columns[0] : table?.columns.find((candidate) => same(candidate.fieldName, first));
      return table === undefined || column === undefined ? null : { table, column };
    }
    case "name": {
      if (depth > 0) return null;
      const target = range.name;
      const named =
        definedNames.find((name) => same(name.name, target) && name.sheetIndex === child.sheetIndex) ??
        definedNames.find((name) => same(name.name, target) && name.sheetIndex === null);
      const parsed = named === undefined ? null : parseFormula(named.ref);
      return parsed?.kind !== "parsed" ? null : resolveParent(lookupRangeOf(parsed.ast), child, tables, definedNames, depth + 1);
    }
    case "other":
      return null;
    default: {
      const unreachable: never = range;
      return unreachable;
    }
  }
};

const keyColumnOf = (lookup: LookupV1, child: RelatableTableV1): RelatableColumnV1 | null => {
  for (const reference of lookup.keyReferences) {
    if (reference.kind === "structured") {
      const column = reference.firstColumn;
      const isOwn = reference.table === null || (child.declaredName !== null && same(reference.table, child.declaredName));
      const found = isOwn && column !== null ? child.columns.find((candidate) => same(candidate.fieldName, column)) : undefined;
      if (found !== undefined) return found;
      continue;
    }
    if (reference.kind === "name" || reference.kind === "rows") continue;
    const scope = reference.scope;
    if (scope !== null && (scope.workbook !== null || scope.lastSheet !== null || !same(scope.firstSheet, child.sheetName))) continue;
    const columnIndex =
      reference.kind === "cell" ? reference.cell.column : reference.kind === "area" ? reference.first.column : reference.firstColumn;
    const found = child.columns.find((candidate) => candidate.columnIndex === columnIndex);
    if (found !== undefined) return found;
  }
  return null;
};

/**
 * Proposes relationships among the standalone tables. `keys` holds each
 * table's key column key and is updated when a lookup's parent column becomes
 * its table's key.
 */
export function detectRelationships(
  tables: readonly RelatableTableV1[],
  keys: Map<string, string | null>,
  definedNames: readonly DefinedNameFact[],
): DetectedRelationshipsV1 {
  const found: {
    readonly child: RelatableTableV1;
    readonly column: RelatableColumnV1;
    readonly parent: RelatableTableV1;
    readonly parentColumn: RelatableColumnV1;
    readonly source: "lookup-formula" | "key-match";
    readonly evidence: WorkbookEvidenceV1;
  }[] = [];
  const notes = new Map<string, WorkbookEvidenceV1>();
  const isChild = (columnKey: string): boolean => found.some((entry) => entry.column.columnKey === columnKey);

  for (const child of tables) {
    for (const holder of child.columns) {
      for (const { lookup, formulaText } of holder.stats.lookups) {
        const column = keyColumnOf(lookup, child);
        const target = resolveParent(lookup.lookupRange, child, tables, definedNames);
        if (column === null || target === null || isChild(column.columnKey)) continue;
        const { table: parent, column: parentColumn } = target;
        const parentKey = keys.get(parent.tableKey) ?? null;
        const becomesKey = parentKey === null && isUniqueAndComplete(parentColumn.stats, parent.rowCount);
        const isKey = parentKey === parentColumn.columnKey || becomesKey;
        const evidence: WorkbookEvidenceV1 = {
          kind: "lookup-formula",
          functionName: lookup.functionName,
          formulaText,
          parentSheetName: parent.sheetName,
          parentTableName: parent.tableName,
          parentColumnName: parentColumn.fieldName,
          outcome: isKey ? "relationship" : "parent-key-differs",
        };
        if (!isKey) {
          if (!notes.has(column.columnKey)) notes.set(column.columnKey, evidence);
          continue;
        }
        if (becomesKey) keys.set(parent.tableKey, parentColumn.columnKey);
        found.push({ child, column, parent, parentColumn, source: "lookup-formula", evidence });
      }
    }
  }

  const parentKeyOf = (table: RelatableTableV1): RelatableColumnV1 | undefined => {
    const key = keys.get(table.tableKey) ?? null;
    return key === null ? undefined : table.columns.find((column) => column.columnKey === key);
  };
  const headingMatches = (column: RelatableColumnV1, parent: RelatableTableV1, parentKey: RelatableColumnV1): boolean =>
    same(column.fieldName, parentKey.fieldName) || same(column.fieldName, parent.tableName);

  for (const child of tables) {
    for (const column of child.columns) {
      if (isChild(column.columnKey) || notes.has(column.columnKey) || keys.get(child.tableKey) === column.columnKey) continue;
      let best: { parent: RelatableTableV1; parentKey: RelatableColumnV1; containment: ContainmentV1 } | null = null;
      for (const parent of tables) {
        const parentKey = parent === child ? undefined : parentKeyOf(parent);
        if (parentKey === undefined || !headingMatches(column, parent, parentKey)) continue;
        const containment = containmentOf(column.stats, parentKey.stats);
        if (!meetsContainment(containment)) continue;
        if (best === null || containment.matched * best.containment.measured > best.containment.matched * containment.measured) {
          best = { parent, parentKey, containment };
        }
      }
      if (best === null) continue;
      found.push({
        child,
        column,
        parent: best.parent,
        parentColumn: best.parentKey,
        source: "key-match",
        evidence: {
          kind: "key-match",
          parentTableName: best.parent.tableName,
          parentColumnName: best.parentKey.fieldName,
          matched: best.containment.matched,
          measured: best.containment.measured,
          isSampled: best.containment.isSampled,
        },
      });
    }
  }

  const order = (entry: (typeof found)[number]): number =>
    tables.indexOf(entry.child) * 100_000 + entry.column.columnIndex;
  found.sort((left, right) => order(left) - order(right));

  const evidence = new Map<string, WorkbookEvidenceV1>();
  const relationships = found.map((entry): ProposedRelationshipV1 => {
    const relationshipKey = `rel:${entry.column.columnKey}`;
    evidence.set(relationshipKey, entry.evidence);
    const containment = containmentOf(entry.column.stats, entry.parentColumn.stats);
    const candidates: RelationshipCandidateV1[] = [];
    for (const parent of tables) {
      const parentKey = parent === entry.parent ? entry.parentColumn : parent === entry.child ? undefined : parentKeyOf(parent);
      if (parentKey === undefined) continue;
      const measured = containmentOf(entry.column.stats, parentKey.stats);
      const isHeading = headingMatches(entry.column, parent, parentKey);
      const isContained = meetsContainment(measured);
      const basis: RelationshipCandidateV1["basis"] | null =
        parent === entry.parent && entry.source === "lookup-formula"
          ? "lookup-formula"
          : isHeading && isContained
            ? "heading-and-containment"
            : isHeading
              ? "heading"
              : isContained
                ? "containment"
                : null;
      if (basis === null) continue;
      candidates.push({ toTableKey: parent.tableKey, toColumnKey: parentKey.columnKey, basis, brokenReferenceCount: measured.broken });
    }
    return {
      relationshipKey,
      fromTableKey: entry.child.tableKey,
      fromColumnKey: entry.column.columnKey,
      toTableKey: entry.parent.tableKey,
      toColumnKey: entry.parentColumn.columnKey,
      detectionSource: entry.source,
      isApplied: true,
      brokenReferenceCount: containment.broken,
      isSampled: containment.isSampled,
      candidates,
    };
  });

  return { relationships, evidence, notes };
}
