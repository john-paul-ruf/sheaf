/**
 * Writes XLSB workbooks from a typed description (M58): an OPC package
 * (S01's `writeZip`) whose workbook, sheets, shared strings, styles and tables
 * are BIFF12 record streams (MS-XLSB §2.1.4: variable-length record type and
 * size, then the body).
 *
 * Cell records are chosen as Excel chooses them — `BrtCellIsst` for text,
 * `BrtCellRk` for a number an `RkNumber` holds exactly, `BrtCellReal`
 * otherwise — and a row may be written with the compact `BrtShort*` records
 * whose column is implied by the previous cell.
 */

import { writeZip, type ZipEntrySpec } from "../build/zip-writer.js";
import { Bytes, rkOf } from "../biff/build-biff.js";

export type XlsbCellInput = number | string | boolean | null | { readonly error: number };

export interface XlsbCellSpec {
  readonly value?: XlsbCellInput;
  readonly style?: number;
}

export type XlsbRowSpec = readonly (XlsbCellSpec | XlsbCellInput | undefined)[];

export interface XlsbTableSpec {
  readonly name: string;
  /** `[firstRow, lastRow, firstColumn, lastColumn]`. */
  readonly range: readonly [number, number, number, number];
  readonly columns: readonly string[];
}

export interface XlsbSheetSpec {
  readonly name: string;
  readonly kind?: "worksheet" | "chartsheet" | "macrosheet";
  readonly state?: 0 | 1 | 2;
  /** `[firstRow, lastRow, firstColumn, lastColumn]`; defaults to the populated extent; `null` omits it. */
  readonly dimension?: readonly [number, number, number, number] | null;
  readonly rows?: readonly (XlsbRowSpec | undefined)[];
  /** Rows (by index) written with `BrtShort*` records. */
  readonly shortRows?: readonly number[];
  readonly tables?: readonly XlsbTableSpec[];
}

export interface XlsbWorkbookSpec {
  readonly date1904?: boolean;
  readonly formats?: readonly { readonly id: number; readonly code: string }[];
  /** Cell XFs by index; defaults to one General XF. */
  readonly xfs?: readonly { readonly formatId: number; readonly font?: number }[];
  readonly sheets: readonly XlsbSheetSpec[];
  readonly vbaProject?: boolean;
}

/** One BIFF12 record: variable-length type and size, then the body. */
export const brt = (type: number, body: Iterable<number> = []): number[] => {
  const bytes = [...body];
  const out: number[] = [];
  out.push(type < 0x80 ? type : (type & 0x7f) | 0x80);
  if (type >= 0x80) out.push(type >>> 7);
  let size = bytes.length;
  do {
    const low = size & 0x7f;
    size >>>= 7;
    out.push(size > 0 ? low | 0x80 : low);
  } while (size > 0);
  return [...out, ...bytes];
};

/** `XLWideString`. */
export const wide = (text: string): number[] => {
  const out = [...new Bytes().u32(text.length).finish()];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    out.push(unit & 0xff, unit >>> 8);
  }
  return out;
};

export const NULL_WIDE = [0xff, 0xff, 0xff, 0xff];

export const rfx = (firstRow: number, lastRow: number, firstColumn: number, lastColumn: number): number[] => [
  ...new Bytes().u32(firstRow).u32(lastRow).u32(firstColumn).u32(lastColumn).finish(),
];

export const B = Object.freeze({
  ROW_HDR: 0,
  CELL_BLANK: 1,
  CELL_RK: 2,
  CELL_ERROR: 3,
  CELL_BOOL: 4,
  CELL_REAL: 5,
  CELL_ISST: 7,
  SHORT_BLANK: 12,
  SHORT_RK: 13,
  SHORT_ERROR: 14,
  SHORT_BOOL: 15,
  SHORT_REAL: 16,
  SHORT_ISST: 18,
  SST_ITEM: 19,
  FMT: 44,
  XF: 47,
  BEGIN_SHEET: 129,
  END_SHEET: 130,
  BEGIN_BOOK: 131,
  END_BOOK: 132,
  BEGIN_BUNDLE_SHS: 143,
  END_BUNDLE_SHS: 144,
  BEGIN_SHEET_DATA: 145,
  END_SHEET_DATA: 146,
  WS_PROP: 147,
  WS_DIM: 148,
  WB_PROP: 153,
  BUNDLE_SH: 156,
  BEGIN_SST: 159,
  END_SST: 160,
  BEGIN_STYLE_SHEET: 278,
  END_STYLE_SHEET: 279,
  BEGIN_LIST: 343,
  END_LIST: 344,
  BEGIN_LIST_COLS: 345,
  END_LIST_COLS: 346,
  BEGIN_LIST_COL: 347,
  END_LIST_COL: 348,
  BEGIN_FMTS: 615,
  END_FMTS: 616,
  BEGIN_CELL_XFS: 617,
  END_CELL_XFS: 618,
});

const BINARY_MAIN = "application/vnd.ms-excel.sheet.binary.macroEnabled.main";
const REL = (type: string): string => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}`;
const MS_REL = (type: string): string => `http://schemas.microsoft.com/office/2006/relationships/${type}`;

const relsXml = (relationships: readonly { id: string; type: string; target: string }[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships
    .map(({ id, type, target }) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

const cellOf = (input: XlsbCellSpec | XlsbCellInput | undefined): XlsbCellSpec | undefined =>
  input === undefined ? undefined : input !== null && typeof input === "object" && !("error" in input) ? input : { value: input };

/** Every entry of the package before zipping, so a fixture can add or tamper with parts. */
export const xlsbEntries = (spec: XlsbWorkbookSpec): ZipEntrySpec[] => {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const sstIndexOf = (text: string): number => {
    let index = stringIndex.get(text);
    if (index === undefined) {
      index = strings.length;
      strings.push(text);
      stringIndex.set(text, index);
    }
    return index;
  };

  const cellRecords = (row: XlsbRowSpec, isShort: boolean): number[] => {
    const out: number[] = [];
    row.forEach((input, column) => {
      const cell = cellOf(input);
      if (cell === undefined) return;
      const head = isShort
        ? [...new Bytes().u16(cell.style ?? 0).u8(0).u8(0).finish()]
        : [...new Bytes().u32(column).u32(cell.style ?? 0).finish()];
      const value = cell.value ?? null;
      if (value === null) out.push(...brt(isShort ? B.SHORT_BLANK : B.CELL_BLANK, head));
      else if (typeof value === "number") {
        const rk = rkOf(value);
        out.push(
          ...(rk === null
            ? brt(isShort ? B.SHORT_REAL : B.CELL_REAL, [...head, ...new Bytes().f64(value).finish()])
            : brt(isShort ? B.SHORT_RK : B.CELL_RK, [...head, ...new Bytes().u32(rk).finish()])),
        );
      } else if (typeof value === "string") {
        out.push(...brt(isShort ? B.SHORT_ISST : B.CELL_ISST, [...head, ...new Bytes().u32(sstIndexOf(value)).finish()]));
      } else if (typeof value === "boolean") {
        out.push(...brt(isShort ? B.SHORT_BOOL : B.CELL_BOOL, [...head, value ? 1 : 0]));
      } else {
        out.push(...brt(isShort ? B.SHORT_ERROR : B.CELL_ERROR, [...head, value.error]));
      }
    });
    return out;
  };

  const extentOf = (sheet: XlsbSheetSpec): readonly [number, number, number, number] => {
    let lastRow = 0;
    let lastColumn = 0;
    (sheet.rows ?? []).forEach((row, rowIndex) => {
      if (row === undefined || row.length === 0) return;
      lastRow = rowIndex;
      lastColumn = Math.max(lastColumn, row.length - 1);
    });
    return [0, lastRow, 0, lastColumn];
  };

  const entries: ZipEntrySpec[] = [];
  const overrides: [string, string][] = [];
  const workbookRels: { id: string; type: string; target: string }[] = [];
  let tableCount = 0;

  spec.sheets.forEach((sheet, index) => {
    const kind = sheet.kind ?? "worksheet";
    const folder = kind === "macrosheet" ? "macrosheets" : kind === "chartsheet" ? "chartsheets" : "worksheets";
    const part = `xl/${folder}/sheet${index + 1}.bin`;
    workbookRels.push({
      id: `rId${index + 1}`,
      type: kind === "macrosheet" ? MS_REL("xlMacrosheet") : REL(kind),
      target: `${folder}/sheet${index + 1}.bin`,
    });
    overrides.push([`/${part}`, `application/vnd.ms-excel.${kind === "macrosheet" ? "macrosheet" : kind}`]);
    const out: number[] = [...brt(B.BEGIN_SHEET), ...brt(B.WS_PROP, new Array<number>(27).fill(0))];
    if (kind !== "chartsheet") {
      const dimension = sheet.dimension === undefined ? extentOf(sheet) : sheet.dimension;
      if (dimension !== null) out.push(...brt(B.WS_DIM, rfx(dimension[0], dimension[1], dimension[2], dimension[3])));
      out.push(...brt(B.BEGIN_SHEET_DATA));
      (sheet.rows ?? []).forEach((row, rowIndex) => {
        if (row === undefined) return;
        out.push(...brt(B.ROW_HDR, new Bytes().u32(rowIndex).u32(0).u16(300).u16(0).u8(0).u32(0).finish()));
        out.push(...cellRecords(row, (sheet.shortRows ?? []).includes(rowIndex)));
      });
      out.push(...brt(B.END_SHEET_DATA));
    }
    out.push(...brt(B.END_SHEET));
    entries.push({ name: part, data: Uint8Array.from(out) });

    const sheetRels: { id: string; type: string; target: string }[] = [];
    for (const table of sheet.tables ?? []) {
      tableCount += 1;
      const tablePart = `xl/tables/table${tableCount}.bin`;
      sheetRels.push({ id: `rId${sheetRels.length + 1}`, type: REL("table"), target: `../tables/table${tableCount}.bin` });
      overrides.push([`/${tablePart}`, "application/vnd.ms-excel.table"]);
      const [firstRow, lastRow, firstColumn, lastColumn] = table.range;
      const list = [
        ...brt(B.BEGIN_LIST, [
          ...rfx(firstRow, lastRow, firstColumn, lastColumn),
          ...new Bytes().u32(0).u32(tableCount).u32(1).u32(0).u32(0).finish(),
          ...new Array<number>(7 * 4).fill(0),
          ...wide(table.name),
          ...wide(table.name),
          ...NULL_WIDE,
          ...NULL_WIDE,
          ...NULL_WIDE,
          ...NULL_WIDE,
        ]),
        ...brt(B.BEGIN_LIST_COLS, new Bytes().u32(table.columns.length).finish()),
      ];
      table.columns.forEach((column, columnIndex) => {
        list.push(
          ...brt(B.BEGIN_LIST_COL, [...new Bytes().u32(columnIndex + 1).finish(), ...new Array<number>(5 * 4).fill(0), ...wide(column), ...NULL_WIDE, ...NULL_WIDE]),
          ...brt(B.END_LIST_COL),
        );
      });
      list.push(...brt(B.END_LIST_COLS), ...brt(B.END_LIST));
      entries.push({ name: tablePart, data: Uint8Array.from(list) });
    }
    if (sheetRels.length > 0) {
      entries.push({ name: `xl/${folder}/_rels/sheet${index + 1}.bin.rels`, data: relsXml(sheetRels) });
    }
  });

  const book = [
    ...brt(B.BEGIN_BOOK),
    ...brt(B.WB_PROP, [...new Bytes().u32(spec.date1904 === true ? 1 : 0).u32(0).u32(0).finish(), ...wide("")]),
    ...brt(B.BEGIN_BUNDLE_SHS),
  ];
  spec.sheets.forEach((sheet, index) => {
    book.push(...brt(B.BUNDLE_SH, [...new Bytes().u32(sheet.state ?? 0).u32(index + 1).finish(), ...wide(`rId${index + 1}`), ...wide(sheet.name)]));
  });
  book.push(...brt(B.END_BUNDLE_SHS), ...brt(B.END_BOOK));

  const styles = [...brt(B.BEGIN_STYLE_SHEET), ...brt(B.BEGIN_FMTS, new Bytes().u32((spec.formats ?? []).length).finish())];
  for (const format of spec.formats ?? []) styles.push(...brt(B.FMT, [...new Bytes().u16(format.id).finish(), ...wide(format.code)]));
  styles.push(...brt(B.END_FMTS));
  const xfs = spec.xfs ?? [{ formatId: 0 }];
  styles.push(...brt(B.BEGIN_CELL_XFS, new Bytes().u32(xfs.length).finish()));
  for (const xf of xfs) {
    styles.push(...brt(B.XF, new Bytes().u16(0).u16(xf.formatId).u16(xf.font ?? 0).u16(0).u16(0).u8(0).u8(0).u16(0).u8(0).u8(0).finish()));
  }
  styles.push(...brt(B.END_CELL_XFS), ...brt(B.END_STYLE_SHEET));

  const sst = [...brt(B.BEGIN_SST, new Bytes().u32(strings.length).u32(strings.length).finish())];
  for (const text of strings) sst.push(...brt(B.SST_ITEM, [0, ...wide(text)]));
  sst.push(...brt(B.END_SST));

  const relCount = workbookRels.length;
  workbookRels.push({ id: `rId${relCount + 1}`, type: REL("styles"), target: "styles.bin" });
  workbookRels.push({ id: `rId${relCount + 2}`, type: REL("sharedStrings"), target: "sharedStrings.bin" });
  overrides.push(["/xl/styles.bin", "application/vnd.ms-excel.styles"], ["/xl/sharedStrings.bin", "application/vnd.ms-excel.sharedStrings"]);
  if (spec.vbaProject === true) {
    workbookRels.push({ id: `rId${relCount + 3}`, type: MS_REL("vbaProject"), target: "vbaProject.bin" });
    overrides.push(["/xl/vbaProject.bin", "application/vnd.ms-office.vbaProject"]);
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="${BINARY_MAIN}"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join("")}</Types>`;

  return [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: relsXml([{ id: "rId1", type: REL("officeDocument"), target: "xl/workbook.bin" }]) },
    { name: "xl/workbook.bin", data: Uint8Array.from(book) },
    { name: "xl/_rels/workbook.bin.rels", data: relsXml(workbookRels) },
    ...entries,
    { name: "xl/styles.bin", data: Uint8Array.from(styles) },
    { name: "xl/sharedStrings.bin", data: Uint8Array.from(sst) },
    ...(spec.vbaProject === true ? [{ name: "xl/vbaProject.bin", data: Uint8Array.from({ length: 96 }, (_, index) => index) }] : []),
  ];
};

export const buildXlsb = (spec: XlsbWorkbookSpec): Uint8Array => writeZip(xlsbEntries(spec));
