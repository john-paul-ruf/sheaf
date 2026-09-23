/**
 * The formula function catalog, v1 (M03; D49). Closed and versioned: a name
 * outside it is `unsupported` — its imported value is kept, never
 * approximated — and each entry states its arity, how it coerces arguments,
 * its determinism class, and its cost class.
 *
 * Lookup functions are listed so their cost and determinism are stated, but a
 * lookup never reaches the evaluator as a call: translation turns one that
 * goes through an accepted relationship into a `related` node and every other
 * one into `unsupported` (D49).
 */

export const CATALOG_VERSION = 1;

export const CATALOG_FUNCTION_NAMES = Object.freeze([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "COUNTIF",
  "COUNTIFS",
  "SUMIF",
  "SUMIFS",
  "AVERAGEIF",
  "IF",
  "IFS",
  "IFERROR",
  "IFNA",
  "AND",
  "OR",
  "NOT",
  "XOR",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "ABS",
  "INT",
  "MOD",
  "POWER",
  "SQRT",
  "CEILING",
  "FLOOR",
  "TODAY",
  "NOW",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
  "WEEKDAY",
  "EDATE",
  "EOMONTH",
  "DATEDIF",
  "DAYS",
  "LEN",
  "LEFT",
  "RIGHT",
  "MID",
  "UPPER",
  "LOWER",
  "PROPER",
  "TRIM",
  "CONCAT",
  "CONCATENATE",
  "TEXTJOIN",
  "SUBSTITUTE",
  "FIND",
  "SEARCH",
  "VALUE",
  "TEXT",
  "ISBLANK",
  "ISNUMBER",
  "ISTEXT",
  "ISERROR",
  "RAND",
  "RANDBETWEEN",
  "VLOOKUP",
  "HLOOKUP",
  "XLOOKUP",
  "INDEX",
  "MATCH",
] as const);

export type CatalogFunctionNameV1 = (typeof CATALOG_FUNCTION_NAMES)[number];

/** `nondeterministic` functions are frozen at import, never re-evaluated (D51). */
export type CatalogDeterminismV1 = "deterministic" | "clock-volatile" | "nondeterministic";

/** `aggregate` reads whole columns; `lookup` is never evaluated (see above). */
export type CatalogCostV1 = "scalar" | "aggregate" | "lookup";

/**
 * How arguments are read. `numeric`, `text`, `logical` and `date` coerce each
 * scalar the way the spreadsheet does; `aggregate` reads columns and skips
 * values of the wrong kind; `criteria` pairs ranges with `COUNTIF`-style
 * criteria; `passthrough` hands values over unconverted.
 */
export type CatalogCoercionV1 = "numeric" | "text" | "logical" | "date" | "aggregate" | "criteria" | "passthrough";

export interface CatalogEntryV1 {
  readonly name: CatalogFunctionNameV1;
  readonly version: number;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly coercion: CatalogCoercionV1;
  readonly determinism: CatalogDeterminismV1;
  readonly cost: CatalogCostV1;
}

type EntrySpec = readonly [
  name: CatalogFunctionNameV1,
  minArgs: number,
  maxArgs: number,
  coercion: CatalogCoercionV1,
  cost?: CatalogCostV1,
  determinism?: CatalogDeterminismV1,
];

const SPECS: readonly EntrySpec[] = [
  ["SUM", 1, 255, "aggregate", "aggregate"],
  ["AVERAGE", 1, 255, "aggregate", "aggregate"],
  ["MIN", 1, 255, "aggregate", "aggregate"],
  ["MAX", 1, 255, "aggregate", "aggregate"],
  ["COUNT", 1, 255, "aggregate", "aggregate"],
  ["COUNTA", 1, 255, "aggregate", "aggregate"],
  ["COUNTBLANK", 1, 1, "aggregate", "aggregate"],
  ["COUNTIF", 2, 2, "criteria", "aggregate"],
  ["COUNTIFS", 2, 254, "criteria", "aggregate"],
  ["SUMIF", 2, 3, "criteria", "aggregate"],
  ["SUMIFS", 3, 255, "criteria", "aggregate"],
  ["AVERAGEIF", 2, 3, "criteria", "aggregate"],
  ["IF", 2, 3, "logical"],
  ["IFS", 2, 254, "logical"],
  ["IFERROR", 2, 2, "passthrough"],
  ["IFNA", 2, 2, "passthrough"],
  ["AND", 1, 255, "logical", "aggregate"],
  ["OR", 1, 255, "logical", "aggregate"],
  ["NOT", 1, 1, "logical"],
  ["XOR", 1, 254, "logical", "aggregate"],
  ["ROUND", 2, 2, "numeric"],
  ["ROUNDUP", 2, 2, "numeric"],
  ["ROUNDDOWN", 2, 2, "numeric"],
  ["ABS", 1, 1, "numeric"],
  ["INT", 1, 1, "numeric"],
  ["MOD", 2, 2, "numeric"],
  ["POWER", 2, 2, "numeric"],
  ["SQRT", 1, 1, "numeric"],
  ["CEILING", 2, 2, "numeric"],
  ["FLOOR", 2, 2, "numeric"],
  ["TODAY", 0, 0, "date", "scalar", "clock-volatile"],
  ["NOW", 0, 0, "date", "scalar", "clock-volatile"],
  ["DATE", 3, 3, "numeric"],
  ["YEAR", 1, 1, "date"],
  ["MONTH", 1, 1, "date"],
  ["DAY", 1, 1, "date"],
  ["WEEKDAY", 1, 2, "date"],
  ["EDATE", 2, 2, "date"],
  ["EOMONTH", 2, 2, "date"],
  ["DATEDIF", 3, 3, "date"],
  ["DAYS", 2, 2, "date"],
  ["LEN", 1, 1, "text"],
  ["LEFT", 1, 2, "text"],
  ["RIGHT", 1, 2, "text"],
  ["MID", 3, 3, "text"],
  ["UPPER", 1, 1, "text"],
  ["LOWER", 1, 1, "text"],
  ["PROPER", 1, 1, "text"],
  ["TRIM", 1, 1, "text"],
  ["CONCAT", 1, 254, "text", "aggregate"],
  ["CONCATENATE", 1, 255, "text"],
  ["TEXTJOIN", 3, 252, "text", "aggregate"],
  ["SUBSTITUTE", 3, 4, "text"],
  ["FIND", 2, 3, "text"],
  ["SEARCH", 2, 3, "text"],
  ["VALUE", 1, 1, "text"],
  ["TEXT", 2, 2, "text"],
  ["ISBLANK", 1, 1, "passthrough"],
  ["ISNUMBER", 1, 1, "passthrough"],
  ["ISTEXT", 1, 1, "passthrough"],
  ["ISERROR", 1, 1, "passthrough"],
  ["RAND", 0, 0, "numeric", "scalar", "nondeterministic"],
  ["RANDBETWEEN", 2, 2, "numeric", "scalar", "nondeterministic"],
  ["VLOOKUP", 3, 4, "passthrough", "lookup"],
  ["HLOOKUP", 3, 4, "passthrough", "lookup"],
  ["XLOOKUP", 3, 6, "passthrough", "lookup"],
  ["INDEX", 2, 4, "passthrough", "lookup"],
  ["MATCH", 2, 3, "passthrough", "lookup"],
];

export const FUNCTION_CATALOG_V1: ReadonlyMap<CatalogFunctionNameV1, CatalogEntryV1> = new Map(
  SPECS.map(([name, minArgs, maxArgs, coercion, cost = "scalar", determinism = "deterministic"]) => [
    name,
    Object.freeze({ name, version: CATALOG_VERSION, minArgs, maxArgs, coercion, determinism, cost }),
  ]),
);

/** The entry for an upper-cased name, or `undefined` outside the catalog. */
export function catalogEntryOf(name: string): CatalogEntryV1 | undefined {
  return FUNCTION_CATALOG_V1.get(name as CatalogFunctionNameV1);
}
