/**
 * The shared parsed-formula (`Ptg`) vocabulary of BIFF8 and BIFF12 (M17, D34).
 * M16 (XLSB) imports this file — the only adapter-to-adapter edge.
 */

/** One external workbook reference (`SUPBOOK` / `BrtSupBook*`). */
export interface PtgSupbookV1 {
  /** `self`: this workbook; `addin`: add-in functions; `external`: another file. */
  readonly kind: "self" | "addin" | "external";
  /** 1-based among external books, as formula text writes `[1]`; 0 otherwise. */
  readonly bookIndex: number;
  readonly sheetNames: readonly string[];
  /** `EXTERNNAME`s in order; `PtgNameX` indexes them from 1. */
  readonly names: readonly string[];
}

/** One `XTI`: a 3-D reference's book and sheet span. */
export interface PtgExternSheetV1 {
  readonly supbook: number;
  /** Negative when the sheet was deleted (`#REF!`). */
  readonly firstSheet: number;
  readonly lastSheet: number;
}
