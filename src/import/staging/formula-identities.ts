/**
 * The identities an imported formula's translation names (M23; CA-25).
 *
 * M21 decides what each workbook formula becomes by translating it through
 * M03, whose IR names stable IDs — and M21 may make none. Staging owns both
 * supplies:
 *
 * - {@link reviewFormulaIdentities}: fresh CSPRNG stand-ins, one per key, for
 *   the review. They exist only while a proposal is inferred or edited and
 *   are never written anywhere; only the outcome (live, frozen, unsupported)
 *   leaves the translation.
 */

import { createDomainId, type DomainEntropy, type DomainId, type DomainIdKind } from "../../domain/model/ids.js";
import type { FormulaIdentitiesV1 } from "../inference/formulas.js";

/** Stand-in identities for review: one fresh id per key, stable for this object's life. */
export function reviewFormulaIdentities(entropy: DomainEntropy): FormulaIdentitiesV1 {
  const minter = <K extends DomainIdKind>(kind: K): ((key: string) => DomainId<K>) => {
    const minted = new Map<string, DomainId<K>>();
    return (key) => {
      const id = minted.get(key) ?? createDomainId(kind, entropy);
      minted.set(key, id);
      return id;
    };
  };
  return {
    tableId: minter("table"),
    fieldId: minter("field"),
    relationshipId: minter("relationship"),
    formulaId: minter("formula"),
  };
}
