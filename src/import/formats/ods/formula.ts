/**
 * OpenFormula text (ODF 1.2 `of:=…`) restated in the Excel syntax M03 parses —
 * only where the mapping is mechanical (M18; D33, D34).
 *
 * Mechanical means a token-for-token rewrite with no semantic decision:
 *
 * - a bracketed reference `[.A1]`, `[.A1:.B2]`, `[$Sheet.$A$1:.$B$2]`,
 *   `['Job list'.A1]` becomes `A1`, `A1:B2`, `Sheet!$A$1:$B$2`, `'Job list'!A1`;
 * - the argument separator `;` becomes `,`; inside an inline array `{…}` the
 *   column separator `;` becomes `,` and the row separator `|` becomes `;`;
 * - strings, numbers, operators and function names are copied as written.
 *
 * Anything else — a reference spanning two sheets, an external document
 * (`'file:…'#$Sheet.A1`), the union `~` or intersection `!` operators, a
 * namespaced function (`COM.MICROSOFT.…`, `ORG.OPENOFFICE.…`), `#REF!` inside a
 * reference — has no mechanical Excel spelling, and the result is `null`: the
 * formula is then still a `formula` fact, with `text: null` (M65's
 * "undecodable" form). Formulas are text here; nothing is evaluated (D33).
 */

import { odfAddressToExcel } from "./vocabulary.js";

export interface ConvertedFormulaV1 {
  /** Excel-syntax text without the leading `=`, or `null` when not mechanical. */
  readonly text: string | null;
  readonly isExternal: boolean;
}

const NOT_MECHANICAL: ConvertedFormulaV1 = Object.freeze({ text: null, isExternal: false });

/** The `[…]` reference starting at `open`; returns the index past `]`. */
const referenceEnd = (body: string, open: number): number => {
  let isQuoted = false;
  for (let at = open + 1; at < body.length; at += 1) {
    const character = body[at];
    if (character === "'") {
      if (isQuoted && body[at + 1] === "'") {
        at += 1;
      } else {
        isQuoted = !isQuoted;
      }
    } else if (character === "]" && !isQuoted) {
      return at + 1;
    }
  }
  return -1;
};

/**
 * Converts `of:=…` (also the older `oooc:=…`); `msoxl:=…` is already Excel
 * syntax and is returned as written. `raw` is the `table:formula` attribute.
 */
export function convertOpenFormula(raw: string): ConvertedFormulaV1 {
  const prefixed = /^([A-Za-z][\w-]*):=(.*)$/s.exec(raw.trim());
  const namespace = prefixed?.[1]?.toLowerCase() ?? null;
  const body = prefixed === null ? (raw.trim().startsWith("=") ? raw.trim().slice(1) : null) : (prefixed[2] as string);
  if (body === null || body.trim() === "") return NOT_MECHANICAL;
  if (namespace === "msoxl") return { text: body, isExternal: false };
  if (namespace !== null && namespace !== "of" && namespace !== "oooc") return NOT_MECHANICAL;

  let text = "";
  let arrayDepth = 0;
  for (let at = 0; at < body.length; ) {
    const character = body[at] as string;
    if (character === '"') {
      let end = at + 1;
      for (;;) {
        if (end >= body.length) return NOT_MECHANICAL;
        if (body[end] === '"') {
          if (body[end + 1] === '"') {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      text += body.slice(at, end + 1);
      at = end + 1;
    } else if (character === "[") {
      const end = referenceEnd(body, at);
      if (end === -1) return NOT_MECHANICAL;
      const inner = body.slice(at + 1, end - 1);
      if (inner.includes("#REF!")) return NOT_MECHANICAL;
      if (inner.includes("'#")) return { text: null, isExternal: true };
      const reference = odfAddressToExcel(inner);
      if (reference === null) return NOT_MECHANICAL;
      text += reference.text;
      at = end;
    } else if (character === "{") {
      arrayDepth += 1;
      text += character;
      at += 1;
    } else if (character === "}") {
      arrayDepth = Math.max(0, arrayDepth - 1);
      text += character;
      at += 1;
    } else if (character === ";") {
      text += ",";
      at += 1;
    } else if (character === "|") {
      if (arrayDepth === 0) return NOT_MECHANICAL;
      text += ";";
      at += 1;
    } else if (character === "~" || character === "!" || character === "'" || character === "]") {
      return NOT_MECHANICAL;
    } else if (/[A-Za-z_]/.test(character)) {
      const name = /^[A-Za-z_][\w.]*/.exec(body.slice(at))?.[0] as string;
      const next = body.slice(at + name.length).trimStart()[0];
      if (next === "(" && name.includes(".")) return NOT_MECHANICAL;
      text += name;
      at += name.length;
    } else {
      text += character;
      at += 1;
    }
  }
  return { text, isExternal: false };
}
