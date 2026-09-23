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
 * - {@link allocatedFormulaIdentities}: the identities promotion allocated,
 *   so the formula written is the one the review showed, over the app's IDs.
 */

import {
  createDomainId,
  type DomainEntropy,
  type DomainId,
  type DomainIdKind,
  type FieldId,
  type FormulaId,
  type RelationshipId,
  type TableId,
} from "../../domain/model/ids.js";
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

/** Promotion's identities by key; a key it did not allocate is a defect, never a guess. */
export function allocatedFormulaIdentities(identities: {
  readonly tables: ReadonlyMap<string, TableId>;
  readonly fields: ReadonlyMap<string, FieldId>;
  readonly relationships: ReadonlyMap<string, RelationshipId>;
  readonly formulas: ReadonlyMap<string, FormulaId>;
}): FormulaIdentitiesV1 {
  const known = <T>(map: ReadonlyMap<string, T>, what: string) => (key: string): T => {
    const id = map.get(key);
    if (id === undefined) throw new Error(`promotion allocated no ${what} for a key a formula names`);
    return id;
  };
  return {
    tableId: known(identities.tables, "table"),
    fieldId: known(identities.fields, "field"),
    relationshipId: known(identities.relationships, "relationship"),
    formulaId: known(identities.formulas, "formula"),
  };
}
