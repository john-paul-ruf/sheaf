/**
 * The formula dependency graph (M03; architecture § Formula IR, D60).
 *
 * Nodes are formulas. An edge `A → B` means B reads A: directly, through a
 * `formula` dependency, or through a `field` dependency on A's computed
 * column. The order is Kahn's algorithm, layer by layer with IDs sorted
 * bytewise, so it is the same on every device. A formula left over when no
 * node is ready belongs to a cycle or reads one; it is reported in `cycles`
 * and is never evaluated.
 */

import { compareDomainIds, encodeDomainId, type FieldId, type FormulaId } from "../model/ids.js";
import type { FormulaDependencyV1 } from "./ir.js";

export interface FormulaNodeV1 {
  readonly formulaId: FormulaId;
  /** The computed column this formula fills, or `null` for a metric or dashboard value. */
  readonly targetFieldId: FieldId | null;
  readonly dependencies: readonly FormulaDependencyV1[];
}

export interface DependencyGraphV1 {
  /** Every evaluable formula, each after everything it reads. */
  readonly order: readonly FormulaId[];
  /** Cycle members and everything downstream of them: never evaluated. */
  readonly cycles: readonly FormulaId[];
  /** The formulas that read each field (keyed by `encodeDomainId`). */
  readonly readersOfField: ReadonlyMap<string, readonly FormulaId[]>;
  /** The formulas that read each formula (keyed by `encodeDomainId`). */
  readonly readersOfFormula: ReadonlyMap<string, readonly FormulaId[]>;
}

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

export function buildDependencyGraph(formulas: readonly FormulaNodeV1[]): DependencyGraphV1 {
  const nodes = new Map<string, FormulaNodeV1>();
  for (const formula of formulas) nodes.set(encodeDomainId(formula.formulaId), formula);
  const byTarget = new Map<string, string>();
  for (const [key, formula] of nodes) {
    if (formula.targetFieldId !== null) byTarget.set(encodeDomainId(formula.targetFieldId), key);
  }

  const readersOfField = new Map<string, FormulaId[]>();
  const readersOfFormula = new Map<string, FormulaId[]>();
  const upstream = new Map<string, Set<string>>();
  for (const [key, formula] of nodes) {
    const reads = new Set<string>();
    for (const dependency of formula.dependencies) {
      if (dependency.kind === "field") {
        const fieldKey = encodeDomainId(dependency.fieldId);
        push(readersOfField, fieldKey, formula.formulaId);
        const producer = byTarget.get(fieldKey);
        if (producer !== undefined) reads.add(producer);
      } else {
        const producer = encodeDomainId(dependency.formulaId);
        // A formula that is not in the graph reads as nothing yet.
        if (nodes.has(producer)) reads.add(producer);
      }
    }
    for (const producer of reads) push(readersOfFormula, producer, formula.formulaId);
    upstream.set(key, reads);
  }

  const remaining = new Map([...upstream].map(([key, reads]) => [key, reads.size]));
  const order: FormulaId[] = [];
  const idOf = (key: string): FormulaId => (nodes.get(key) as FormulaNodeV1).formulaId;
  const sorted = (keys: Iterable<string>): string[] => [...keys].sort((left, right) => compareDomainIds(idOf(left), idOf(right)));
  let layer = sorted([...remaining].filter(([, count]) => count === 0).map(([key]) => key));
  while (layer.length > 0) {
    const next: string[] = [];
    for (const key of layer) {
      remaining.delete(key);
      order.push(idOf(key));
      for (const reader of readersOfFormula.get(key) ?? []) {
        const readerKey = encodeDomainId(reader);
        const count = (remaining.get(readerKey) ?? 0) - 1;
        remaining.set(readerKey, count);
        if (count === 0) next.push(readerKey);
      }
    }
    layer = sorted(next);
  }

  return {
    order,
    cycles: sorted(remaining.keys()).map(idOf),
    readersOfField,
    readersOfFormula,
  };
}

export function isCycleMember(graph: DependencyGraphV1, formulaId: FormulaId): boolean {
  const key = encodeDomainId(formulaId);
  return graph.cycles.some((member) => encodeDomainId(member) === key);
}

/**
 * The minimal set of evaluable formulas a change can affect, in evaluation
 * order (D60): every formula that reads a changed field or formula, and
 * everything that reads those, transitively. Cycle members are excluded —
 * they are never evaluated.
 */
export function downstreamOf(
  graph: DependencyGraphV1,
  changedFieldIds: readonly FieldId[],
  changedFormulaIds: readonly FormulaId[] = [],
): readonly FormulaId[] {
  const affected = new Set<string>();
  const pending: FormulaId[] = [
    ...changedFieldIds.flatMap((fieldId) => graph.readersOfField.get(encodeDomainId(fieldId)) ?? []),
    ...changedFormulaIds.flatMap((formulaId) => graph.readersOfFormula.get(encodeDomainId(formulaId)) ?? []),
  ];
  for (let formulaId = pending.pop(); formulaId !== undefined; formulaId = pending.pop()) {
    const key = encodeDomainId(formulaId);
    if (affected.has(key)) continue;
    affected.add(key);
    pending.push(...(graph.readersOfFormula.get(key) ?? []));
  }
  return graph.order.filter((formulaId) => affected.has(encodeDomainId(formulaId)));
}
