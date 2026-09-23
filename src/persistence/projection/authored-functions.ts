/**
 * The SQL functions the projection adds to SQLite.
 *
 * A record's authoritative state is its authored blob, and three of its
 * states — missing, blank, and a value preserved exactly as imported — have no
 * typed lane at all (CA-13(b)). A filter that asks "is this field empty?" or
 * "does this reference hold a key that resolves nowhere?" therefore cannot be
 * answered from `cells` without guessing: the absence of a lane row means
 * missing, blank, invalid-preserved, or out-of-domain alike.
 * `sheaf_authored_kind` reads the answer from the blob itself, so the SQL
 * states the rule rather than approximating it. It returns a closed value kind
 * (M01's `CellValueV1` discriminant) and nothing else — never the value.
 *
 * Text filters compare case-insensitively over NFC, the convention every text
 * comparison and search in Sheaf uses (`foldText`). `sheaf_fold_text` is that
 * fold applied to a lane's text, so a filter compares folded text with a
 * folded, bound operand.
 *
 * Both are deterministic, so SQLite may evaluate them once per row.
 */

import type { Database } from "@sqlite.org/sqlite-wasm";
import { foldText } from "../../domain/formulas/scalars.js";
import { decodeAuthoredRecord } from "./cbor-values.js";
import { idKey } from "./record-rows.js";

/** The names `filter-sql.ts` calls; constants, never composed from input. */
export const AUTHORED_KIND_FUNCTION = "sheaf_authored_kind";
export const FOLD_TEXT_FUNCTION = "sheaf_fold_text";

/** The authored value kind a record holds for one field; `missing` when it holds none. */
export function authoredValueKind(authored: Uint8Array, fieldId: Uint8Array): string {
  const wanted = idKey(fieldId);
  for (const [candidate, value] of decodeAuthoredRecord(authored).values) {
    if (idKey(candidate) === wanted) {
      return value.kind;
    }
  }
  return "missing";
}

export function registerAuthoredFunctions(database: Database): void {
  database.createFunction(AUTHORED_KIND_FUNCTION, {
    arity: 2,
    deterministic: true,
    xFunc: (_context, authored, fieldId) =>
      authored instanceof Uint8Array && fieldId instanceof Uint8Array
        ? authoredValueKind(authored, fieldId)
        : null,
  });
  database.createFunction(FOLD_TEXT_FUNCTION, {
    arity: 1,
    deterministic: true,
    xFunc: (_context, text) => (typeof text === "string" ? foldText(text) : null),
  });
}
