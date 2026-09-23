/**
 * Fidelity disposition (M03; D49, D51). Every formula is exactly one of
 * migration 005's disposition ↔ determinism pairs:
 *
 * | disposition   | determinism                           |
 * |---------------|---------------------------------------|
 * | `live`        | `deterministic` or `clock-volatile`   |
 * | `frozen`      | `frozen-nondeterministic`             |
 * | `unsupported` | `unsupported`                         |
 */

import { catalogEntryOf } from "./catalog.js";
import { irNodesOf, type FormulaDeterminismV1, type FormulaDispositionV1, type FormulaIRDocumentV1 } from "./ir.js";

export type FormulaClassificationV1 =
  | { readonly disposition: "live"; readonly determinism: "deterministic" | "clock-volatile" }
  | { readonly disposition: "frozen"; readonly determinism: "frozen-nondeterministic" }
  | { readonly disposition: "unsupported"; readonly determinism: "unsupported" };

export const UNSUPPORTED_CLASSIFICATION: FormulaClassificationV1 = Object.freeze({
  disposition: "unsupported",
  determinism: "unsupported",
});

/**
 * Classifies a translated document; `null` (a formula translation refused)
 * is `unsupported`. A call the catalog does not know at its recorded
 * version, or a lookup call, is `unsupported`; any nondeterministic call
 * freezes the formula; otherwise any clock read makes it clock-volatile.
 */
export function classifyFormula(document: FormulaIRDocumentV1 | null): FormulaClassificationV1 {
  if (document === null) return UNSUPPORTED_CLASSIFICATION;
  let isFrozen = false;
  let readsClock = false;
  for (const node of irNodesOf(document.root)) {
    if (node.kind !== "call") continue;
    const entry = catalogEntryOf(node.name);
    if (entry === undefined || entry.version !== node.version || entry.cost === "lookup") return UNSUPPORTED_CLASSIFICATION;
    if (entry.determinism === "nondeterministic") isFrozen = true;
    if (entry.determinism === "clock-volatile") readsClock = true;
  }
  if (isFrozen) return { disposition: "frozen", determinism: "frozen-nondeterministic" };
  return { disposition: "live", determinism: readsClock ? "clock-volatile" : "deterministic" };
}

/** True exactly for migration 005's allowed pairs. */
export function isAllowedClassification(disposition: FormulaDispositionV1, determinism: FormulaDeterminismV1): boolean {
  switch (disposition) {
    case "live":
      return determinism === "deterministic" || determinism === "clock-volatile";
    case "frozen":
      return determinism === "frozen-nondeterministic";
    case "unsupported":
      return determinism === "unsupported";
    default: {
      const unreachable: never = disposition;
      return unreachable;
    }
  }
}
