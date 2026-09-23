/**
 * `xl/workbook.bin` (M16): the sheet list with visibility, the 1904 flag,
 * defined names and the external-reference context the `Ptg` decoder needs —
 * read by both the inventory reader and the adapter.
 */

import { BoundExceededError } from "../../source/bounds.js";
import { readRelationships, relationshipKind, type OpcRelationshipV1 } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import type { DefinedNameSummaryV1, MacroSignalV1, SheetKindV1, SheetVisibilityV1 } from "../../facts/index.js";
import {
  decodePtgFormula,
  type PtgCellV1,
  type PtgContextV1,
  type PtgExternSheetV1,
  type PtgSupbookV1,
} from "../biff/ptg.js";
import { BodyReaderV1, BRT, openXlsbRecords } from "./records.js";

export interface XlsbSheetEntryV1 {
  readonly sheetIndex: number;
  readonly name: string;
  readonly kind: SheetKindV1;
  readonly visibility: SheetVisibilityV1;
  readonly partName: string;
}

export interface XlsbNameV1 {
  readonly name: string;
  readonly sheetIndex: number | null;
  readonly isFunction: boolean;
  readonly rgce: Uint8Array;
  readonly rgcb: Uint8Array;
}

export interface XlsbWorkbookV1 {
  readonly partName: string;
  readonly is1904: boolean;
  readonly sheets: readonly XlsbSheetEntryV1[];
  readonly names: readonly XlsbNameV1[];
  readonly supbooks: readonly PtgSupbookV1[];
  readonly externSheets: readonly PtgExternSheetV1[];
  readonly relationships: readonly OpcRelationshipV1[];
  /** A macro sheet the workbook declares; the import is refused, never parsed. */
  readonly macroSheet: MacroSignalV1 | null;
}

const SHEET_KINDS = new Map<string, SheetKindV1>([
  ["worksheet", "worksheet"],
  ["chartsheet", "chartsheet"],
  ["dialogsheet", "dialogsheet"],
]);
const MACRO_SHEET_KINDS = new Set(["xlmacrosheet", "xlintlmacrosheet"]);

const NAME_FUNCTION = 0x0002;
const NAME_PROCEDURE = 0x0008;
const SHEET_SCOPE_WORKBOOK = 0xffffffff;

const visibilityOf = (state: number): SheetVisibilityV1 =>
  state === 1 ? "hidden" : state === 2 ? "very-hidden" : "visible";

/** A `CellParsedFormula`-shaped pair: 32-bit counted token bytes, then extra bytes. */
export const parsedFormula = (reader: BodyReaderV1): { readonly rgce: Uint8Array; readonly rgcb: Uint8Array } => {
  const rgce = reader.bytesOf(reader.u32());
  const rgcb = reader.bytesOf(reader.u32());
  return { rgce, rgcb };
};

export async function readXlsbWorkbook(zip: ZipContainerHandleV1): Promise<XlsbWorkbookV1> {
  const office = (await readRelationships(zip, null)).find(
    (relationship) => relationshipKind(relationship.type) === "officedocument" && !relationship.isExternal,
  );
  if (office === undefined || !zip.has(office.target)) {
    throw new BoundExceededError("malformed-structure");
  }
  let is1904 = false;
  const bundles: { name: string; visibility: SheetVisibilityV1; relId: string | null }[] = [];
  const names: XlsbNameV1[] = [];
  const supbooks: { kind: PtgSupbookV1["kind"]; sheetNames: string[]; names: string[] }[] = [];
  const externSheets: PtgExternSheetV1[] = [];

  const records = openXlsbRecords(zip.streamEntry(office.target));
  try {
    for (let record = await records.next(); record !== null; record = await records.next()) {
      const reader = new BodyReaderV1(record.body);
      switch (record.type) {
        case BRT.WB_PROP:
          is1904 = (reader.u32() & 1) !== 0;
          break;
        case BRT.BUNDLE_SH: {
          const state = reader.u32();
          reader.u32();
          const relId = reader.nullableWide();
          bundles.push({ visibility: visibilityOf(state), relId, name: reader.wide().normalize("NFC") });
          break;
        }
        case BRT.NAME: {
          const flags = reader.u32();
          reader.u8();
          const itab = reader.u32();
          const name = reader.wide().normalize("NFC");
          const { rgce, rgcb } = parsedFormula(reader);
          names.push({
            name,
            sheetIndex: itab === SHEET_SCOPE_WORKBOOK ? null : itab,
            isFunction: (flags & (NAME_FUNCTION | NAME_PROCEDURE)) !== 0,
            rgce,
            rgcb,
          });
          break;
        }
        case BRT.SUP_SELF:
        case BRT.SUP_SAME:
          supbooks.push({ kind: "self", sheetNames: [], names: [] });
          break;
        case BRT.SUP_ADDIN:
          supbooks.push({ kind: "addin", sheetNames: [], names: [] });
          break;
        case BRT.SUP_BOOK_SRC:
          supbooks.push({ kind: "external", sheetNames: [], names: [] });
          break;
        case BRT.SUP_TABS: {
          const book = supbooks.at(-1);
          const count = reader.u32();
          if (count > reader.remaining / 4) throw new BoundExceededError("malformed-structure");
          for (let index = 0; index < count; index += 1) book?.sheetNames.push(reader.wide().normalize("NFC"));
          break;
        }
        case BRT.PLACEHOLDER_NAME:
          supbooks.at(-1)?.names.push(reader.wide().normalize("NFC"));
          break;
        case BRT.EXTERN_SHEET: {
          const count = reader.u32();
          if (count > reader.remaining / 12) throw new BoundExceededError("malformed-structure");
          for (let index = 0; index < count; index += 1) {
            externSheets.push({ supbook: reader.u32(), firstSheet: reader.i32(), lastSheet: reader.i32() });
          }
          break;
        }
      }
    }
  } finally {
    await records.close();
  }

  const relationships = await readRelationships(zip, office.target);
  const byId = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  let macroSheet: MacroSignalV1 | null = null;
  const sheets: XlsbSheetEntryV1[] = [];
  for (const [sheetIndex, bundle] of bundles.entries()) {
    const relationship = bundle.relId === null ? undefined : byId.get(bundle.relId);
    const relKind = relationship === undefined ? "" : relationshipKind(relationship.type);
    if (relationship !== undefined && MACRO_SHEET_KINDS.has(relKind)) {
      macroSheet ??= { kind: "xlm-macro-sheet", partPath: relationship.target };
      continue;
    }
    const kind = SHEET_KINDS.get(relKind);
    if (relationship === undefined || relationship.isExternal || kind === undefined || !zip.has(relationship.target)) {
      throw new BoundExceededError("malformed-structure");
    }
    sheets.push({ sheetIndex, name: bundle.name, kind, visibility: bundle.visibility, partName: relationship.target });
  }
  return {
    partName: office.target,
    is1904,
    sheets,
    names,
    supbooks: supbooks.map((book, index) => ({
      ...book,
      bookIndex: supbooks.slice(0, index + 1).filter((each) => each.kind === "external").length,
    })),
    externSheets,
    relationships,
    macroSheet,
  };
}

/** The `Ptg` decoding context of an XLSB workbook, for a formula at `cell`. */
export const ptgContextOf = (workbook: XlsbWorkbookV1, cell: PtgCellV1 | null, isSharedFormula = false): PtgContextV1 => ({
  format: "biff12",
  sheetNames: workbook.sheets.map((sheet) => sheet.name),
  supbooks: workbook.supbooks,
  externSheets: workbook.externSheets,
  definedNames: workbook.names.map((name) => name.name),
  cell,
  isSharedFormula,
});

/**
 * Defined names with their references decompiled to text. Function and
 * macro names are not ranges and are left out; a name whose formula does not
 * decode is left out rather than guessed.
 */
export function definedNamesOf(workbook: XlsbWorkbookV1): DefinedNameSummaryV1[] {
  const context = ptgContextOf(workbook, null);
  return workbook.names.flatMap((name) => {
    if (name.isFunction) return [];
    const decoded = decodePtgFormula(name.rgce, context, name.rgcb);
    return "text" in decoded ? [{ name: name.name, ref: decoded.text.normalize("NFC"), sheetIndex: name.sheetIndex }] : [];
  });
}
