/**
 * Cell styles, reduced to what the fact stream states (M15): each `cellXfs`
 * entry's number format (built-in ids 0–49 or a custom `numFmt`) with its
 * class, and whether it carries visual styling (a non-default font, fill or
 * border). Visual styling itself is never reproduced — a sheet that uses any
 * becomes one `cell-styling` preserved part (D40).
 */

import {
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
  type FormatClassV1,
} from "../../facts/index.js";
import { partEvents } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { attribute, isSheetElement } from "./parts.js";

export interface CellStyleV1 {
  readonly numberFormat: string;
  readonly formatClass: FormatClassV1;
  readonly currencySymbol: string | null;
  readonly isVisuallyStyled: boolean;
}

export const DEFAULT_CELL_STYLE: CellStyleV1 = Object.freeze({
  numberFormat: "General",
  formatClass: "general",
  currencySymbol: null,
  isVisuallyStyled: false,
});

const idOf = (value: string | null): number =>
  value !== null && /^\d{1,6}$/.test(value) ? Number(value) : 0;

/** Every `cellXfs` entry in order; index = a cell's `s` attribute. */
export async function readCellStyles(
  zip: ZipContainerHandleV1,
  partName: string | null,
): Promise<readonly CellStyleV1[]> {
  if (partName === null || !zip.has(partName)) {
    return [];
  }
  const custom = new Map<number, string>();
  const formats: { numFmtId: number; isVisuallyStyled: boolean }[] = [];
  let inCellXfs = false;
  for await (const event of partEvents(zip, partName)) {
    if (event.kind === "start" && isSheetElement(event.uri)) {
      if (event.local === "numFmt") {
        custom.set(idOf(attribute(event, "numFmtId")), (attribute(event, "formatCode") ?? "General").normalize("NFC"));
      } else if (event.local === "cellXfs") {
        inCellXfs = true;
      } else if (event.local === "xf" && inCellXfs) {
        formats.push({
          numFmtId: idOf(attribute(event, "numFmtId")),
          isVisuallyStyled:
            idOf(attribute(event, "fontId")) !== 0 ||
            idOf(attribute(event, "fillId")) !== 0 ||
            idOf(attribute(event, "borderId")) !== 0,
        });
      }
    } else if (event.kind === "end" && event.local === "cellXfs") {
      inCellXfs = false;
    }
  }
  return formats.map(({ numFmtId, isVisuallyStyled }) => {
    const code = custom.get(numFmtId);
    if (code !== undefined) {
      return { numberFormat: code, ...classifyNumberFormat(code), isVisuallyStyled };
    }
    const builtin = BUILTIN_NUMBER_FORMATS.get(numFmtId);
    return builtin === undefined
      ? { ...DEFAULT_CELL_STYLE, isVisuallyStyled }
      : {
          numberFormat: builtin.code,
          formatClass: builtin.formatClass,
          currencySymbol: builtin.currencySymbol,
          isVisuallyStyled,
        };
  });
}
