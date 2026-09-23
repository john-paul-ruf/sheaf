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

export type XlsbCellInput =
  | number
  | string
  | boolean
  | null
  | { readonly error: number }
  /** Text stored in the cell itself (`BrtCellSt`), not the shared-string table. */
  | { readonly inline: string };

/** Range as `[firstRow, lastRow, firstColumn, lastColumn]`. */
export type XlsbRange = readonly [number, number, number, number];

export type XlsbFormulaSpec =
  | { readonly tokens: Uint8Array; readonly extra?: Uint8Array }
  /** A shared formula's master; `tokens` use `PtgRefN`/`PtgAreaN` relative to each member. */
  | { readonly shared: { readonly range: XlsbRange; readonly tokens: Uint8Array } }
  /** A shared- or array-formula member: `PtgExp` naming its master's row. */
  | { readonly member: number }
  | { readonly array: { readonly range: XlsbRange; readonly tokens: Uint8Array; readonly extra?: Uint8Array } };

export interface XlsbCellSpec {
  /** For a formula cell: the cached result. */
  readonly value?: XlsbCellInput;
  readonly style?: number;
  readonly formula?: XlsbFormulaSpec;
}

export interface XlsbValidationSpec {
  /** `valType`: 1 whole, 2 decimal, 3 list, 4 date, 5 time, 6 text length, 7 custom. */
  readonly type: number;
  readonly operator?: number;
  readonly isStringList?: boolean;
  readonly formula1: Uint8Array;
  readonly formula2?: Uint8Array;
  readonly ranges: readonly XlsbRange[];
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
  readonly merges?: readonly XlsbRange[];
  readonly validations?: readonly XlsbValidationSpec[];
  /** External hyperlinks (`BrtHLink` + a `TargetMode="External"` relationship). */
  readonly hyperlinks?: readonly { readonly range: XlsbRange; readonly target: string }[];
  readonly conditionalFormats?: number;
  /** Anchored drawing objects, written to a DrawingML part as XLSB keeps them. */
  readonly charts?: readonly XlsbRange[];
  readonly pictures?: readonly XlsbRange[];
  readonly shapes?: readonly XlsbRange[];
  /** Cells carrying a comment (`comments.bin`). */
  readonly comments?: readonly (readonly [number, number])[];
}

export interface XlsbWorkbookSpec {
  readonly date1904?: boolean;
  readonly formats?: readonly { readonly id: number; readonly code: string }[];
  /** Cell XFs by index; defaults to one General XF. */
  readonly xfs?: readonly { readonly formatId: number; readonly font?: number }[];
  readonly sheets: readonly XlsbSheetSpec[];
  readonly vbaProject?: boolean;
  /** Supporting books; defaults to this workbook alone when `xti` is given. */
  readonly supbooks?: readonly ({ readonly kind: "self" } | { readonly kind: "addin"; readonly names: readonly string[] })[];
  /** `BrtExternSheet` entries: supbook index and sheet span. */
  readonly xti?: readonly { readonly supbook: number; readonly first: number; readonly last: number }[];
  readonly names?: readonly {
    readonly name: string;
    readonly sheetIndex?: number;
    readonly isFunction?: boolean;
    readonly rgce: Uint8Array;
    readonly rgcb?: Uint8Array;
  }[];
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
  CELL_ST: 6,
  CELL_ISST: 7,
  FMLA_STRING: 8,
  FMLA_NUM: 9,
  FMLA_BOOL: 10,
  FMLA_ERROR: 11,
  SHORT_BLANK: 12,
  SHORT_RK: 13,
  SHORT_ERROR: 14,
  SHORT_BOOL: 15,
  SHORT_REAL: 16,
  SHORT_ST: 17,
  SHORT_ISST: 18,
  DVAL: 64,
  MERGE_CELL: 176,
  BEGIN_MERGE_CELLS: 177,
  END_MERGE_CELLS: 178,
  ARR_FMLA: 425,
  SHR_FMLA: 426,
  BEGIN_COND_FORMATTING: 461,
  END_COND_FORMATTING: 462,
  HLINK: 494,
  BEGIN_DVALS: 573,
  END_DVALS: 574,
  BEGIN_COMMENT: 635,
  END_COMMENT: 636,
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
  NAME: 39,
  BEGIN_EXTERNALS: 353,
  END_EXTERNALS: 354,
  SUP_SELF: 357,
  PLACEHOLDER_NAME: 361,
  EXTERN_SHEET: 362,
  SUP_ADDIN: 666,
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

interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly isExternal?: boolean;
}

const relsXml = (relationships: readonly RelationshipSpec[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships
    .map(
      ({ id, type, target, isExternal }) =>
        `<Relationship Id="${id}" Type="${type}" Target="${target}"${isExternal === true ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;

const cellOf = (input: XlsbCellSpec | XlsbCellInput | undefined): XlsbCellSpec | undefined =>
  input === undefined
    ? undefined
    : input !== null && typeof input === "object" && !("error" in input) && !("inline" in input)
      ? input
      : { value: input };

const DRAWING_NS =
  'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

const anchorXml = ([r1, r2, c1, c2]: XlsbRange, body: string): string =>
  `<xdr:twoCellAnchor><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

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

  const u32 = (value: number): number[] => [...new Bytes().u32(value).finish()];

  /** `BrtFmla*` with its cached result, then `BrtShrFmla`/`BrtArrFmla` for a group master. */
  const formulaRecords = (row: number, column: number, style: number, cached: XlsbCellInput, formula: XlsbFormulaSpec): number[] => {
    const head = [...new Bytes().u32(column).u32(style).finish()];
    let type: number;
    let result: number[];
    if (typeof cached === "number") [type, result] = [B.FMLA_NUM, [...new Bytes().f64(cached).finish()]];
    else if (typeof cached === "boolean") [type, result] = [B.FMLA_BOOL, [cached ? 1 : 0]];
    else if (cached !== null && typeof cached === "object" && "error" in cached) [type, result] = [B.FMLA_ERROR, [cached.error]];
    else [type, result] = [B.FMLA_STRING, wide(cached === null ? "" : typeof cached === "string" ? cached : cached.inline)];
    const exp = (masterRow: number): number[] => [0x01, ...u32(masterRow)];
    let tokens: number[];
    let extra: number[] = [];
    const following: number[] = [];
    if ("tokens" in formula) {
      tokens = [...formula.tokens];
      extra = [...(formula.extra ?? [])];
    } else if ("shared" in formula) {
      tokens = exp(row);
      const [r1, r2, c1, c2] = formula.shared.range;
      following.push(...brt(B.SHR_FMLA, [...rfx(r1, r2, c1, c2), ...u32(formula.shared.tokens.length), ...formula.shared.tokens, ...u32(0)]));
    } else if ("member" in formula) {
      tokens = exp(formula.member);
    } else {
      tokens = exp(row);
      const [r1, r2, c1, c2] = formula.array.range;
      const arrayExtra = [...(formula.array.extra ?? [])];
      following.push(
        ...brt(B.ARR_FMLA, [...rfx(r1, r2, c1, c2), 0, ...u32(formula.array.tokens.length), ...formula.array.tokens, ...u32(arrayExtra.length), ...arrayExtra]),
      );
    }
    return [...brt(type, [...head, ...result, 0, 0, ...u32(tokens.length), ...tokens, ...u32(extra.length), ...extra]), ...following];
  };

  const cellRecords = (rowIndex: number, row: XlsbRowSpec, isShort: boolean): number[] => {
    const out: number[] = [];
    row.forEach((input, column) => {
      const cell = cellOf(input);
      if (cell === undefined) return;
      const value = cell.value ?? null;
      if (cell.formula !== undefined) {
        out.push(...formulaRecords(rowIndex, column, cell.style ?? 0, value, cell.formula));
        return;
      }
      const head = isShort
        ? [...new Bytes().u16(cell.style ?? 0).u8(0).u8(0).finish()]
        : [...new Bytes().u32(column).u32(cell.style ?? 0).finish()];
      if (value === null) out.push(...brt(isShort ? B.SHORT_BLANK : B.CELL_BLANK, head));
      else if (typeof value === "number") {
        const rk = rkOf(value);
        out.push(
          ...(rk === null
            ? brt(isShort ? B.SHORT_REAL : B.CELL_REAL, [...head, ...new Bytes().f64(value).finish()])
            : brt(isShort ? B.SHORT_RK : B.CELL_RK, [...head, ...u32(rk)])),
        );
      } else if (typeof value === "string") {
        out.push(...brt(isShort ? B.SHORT_ISST : B.CELL_ISST, [...head, ...u32(sstIndexOf(value))]));
      } else if (typeof value === "boolean") {
        out.push(...brt(isShort ? B.SHORT_BOOL : B.CELL_BOOL, [...head, value ? 1 : 0]));
      } else if ("inline" in value) {
        out.push(...brt(isShort ? B.SHORT_ST : B.CELL_ST, [...head, ...wide(value.inline)]));
      } else {
        out.push(...brt(isShort ? B.SHORT_ERROR : B.CELL_ERROR, [...head, value.error]));
      }
    });
    return out;
  };

  /** Merges, conditional formats, validations and hyperlinks, after the sheet data. */
  const structureRecords = (sheet: XlsbSheetSpec, hyperlinkIds: readonly string[]): number[] => {
    const out: number[] = [];
    const merges = sheet.merges ?? [];
    if (merges.length > 0) {
      out.push(...brt(B.BEGIN_MERGE_CELLS, u32(merges.length)));
      for (const [r1, r2, c1, c2] of merges) out.push(...brt(B.MERGE_CELL, rfx(r1, r2, c1, c2)));
      out.push(...brt(B.END_MERGE_CELLS));
    }
    for (let index = 0; index < (sheet.conditionalFormats ?? 0); index += 1) {
      out.push(...brt(B.BEGIN_COND_FORMATTING, [...u32(1), ...u32(1), ...rfx(0, 0, 0, 0)]), ...brt(B.END_COND_FORMATTING));
    }
    const validations = sheet.validations ?? [];
    if (validations.length > 0) {
      out.push(...brt(B.BEGIN_DVALS, [0, 0, ...u32(0), ...u32(0), ...u32(validations.length)]));
      for (const validation of validations) {
        const flags = validation.type | (validation.isStringList === true ? 0x80 : 0) | 0x100 | ((validation.operator ?? 0) << 20);
        const formula2 = [...(validation.formula2 ?? [])];
        out.push(
          ...brt(B.DVAL, [
            ...u32(flags),
            ...u32(validation.ranges.length),
            ...validation.ranges.flatMap(([r1, r2, c1, c2]) => rfx(r1, r2, c1, c2)),
            ...NULL_WIDE,
            ...NULL_WIDE,
            ...NULL_WIDE,
            ...NULL_WIDE,
            ...u32(validation.formula1.length),
            ...validation.formula1,
            ...u32(0),
            ...u32(formula2.length),
            ...formula2,
            ...u32(0),
          ]),
        );
      }
      out.push(...brt(B.END_DVALS));
    }
    (sheet.hyperlinks ?? []).forEach(({ range: [r1, r2, c1, c2] }, index) => {
      out.push(...brt(B.HLINK, [...rfx(r1, r2, c1, c2), ...wide(hyperlinkIds[index] ?? ""), ...wide(""), ...wide(""), ...wide("")]));
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
  const workbookRels: RelationshipSpec[] = [];
  let tableCount = 0;
  let drawingCount = 0;
  let chartCount = 0;
  let imageCount = 0;
  let commentsCount = 0;

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

    const sheetRels: RelationshipSpec[] = [];
    const nextId = (): string => `rId${sheetRels.length + 1}`;
    for (const table of sheet.tables ?? []) {
      tableCount += 1;
      const tablePart = `xl/tables/table${tableCount}.bin`;
      sheetRels.push({ id: nextId(), type: REL("table"), target: `../tables/table${tableCount}.bin` });
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
        ...brt(B.BEGIN_LIST_COLS, u32(table.columns.length)),
      ];
      table.columns.forEach((column, columnIndex) => {
        list.push(
          ...brt(B.BEGIN_LIST_COL, [...u32(columnIndex + 1), ...new Array<number>(5 * 4).fill(0), ...wide(column), ...NULL_WIDE, ...NULL_WIDE]),
          ...brt(B.END_LIST_COL),
        );
      });
      list.push(...brt(B.END_LIST_COLS), ...brt(B.END_LIST));
      entries.push({ name: tablePart, data: Uint8Array.from(list) });
    }

    const charts = sheet.charts ?? [];
    const pictures = sheet.pictures ?? [];
    const shapes = sheet.shapes ?? [];
    if (charts.length + pictures.length + shapes.length > 0) {
      drawingCount += 1;
      const drawingRels: RelationshipSpec[] = [];
      const anchors: string[] = [];
      for (const range of charts) {
        chartCount += 1;
        const id = `rId${drawingRels.length + 1}`;
        drawingRels.push({ id, type: REL("chart"), target: `../charts/chart${chartCount}.xml` });
        entries.push({ name: `xl/charts/chart${chartCount}.xml`, data: '<?xml version="1.0" encoding="UTF-8"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' });
        overrides.push([`/xl/charts/chart${chartCount}.xml`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"]);
        anchors.push(anchorXml(range, `<xdr:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${id}"/></a:graphicData></a:graphic></xdr:graphicFrame>`));
      }
      for (const range of pictures) {
        imageCount += 1;
        const id = `rId${drawingRels.length + 1}`;
        drawingRels.push({ id, type: REL("image"), target: `../media/image${imageCount}.png` });
        entries.push({ name: `xl/media/image${imageCount}.png`, data: PNG, method: "stored" });
        anchors.push(anchorXml(range, `<xdr:pic><xdr:blipFill><a:blip r:embed="${id}"/></xdr:blipFill></xdr:pic>`));
      }
      for (const range of shapes) anchors.push(anchorXml(range, "<xdr:sp/>"));
      const drawingPart = `xl/drawings/drawing${drawingCount}.xml`;
      entries.push({ name: drawingPart, data: `<?xml version="1.0" encoding="UTF-8"?>\n<xdr:wsDr ${DRAWING_NS}>${anchors.join("")}</xdr:wsDr>` });
      entries.push({ name: `xl/drawings/_rels/drawing${drawingCount}.xml.rels`, data: relsXml(drawingRels) });
      overrides.push([`/${drawingPart}`, "application/vnd.openxmlformats-officedocument.drawing+xml"]);
      sheetRels.push({ id: nextId(), type: REL("drawing"), target: `../drawings/drawing${drawingCount}.xml` });
    }

    const comments = sheet.comments ?? [];
    if (comments.length > 0) {
      commentsCount += 1;
      const commentsPart = `xl/comments${commentsCount}.bin`;
      entries.push({
        name: commentsPart,
        data: Uint8Array.from(
          comments.flatMap(([row, column]) => [...brt(B.BEGIN_COMMENT, [...rfx(row, row, column, column), ...u32(0), ...new Array<number>(16).fill(0)]), ...brt(B.END_COMMENT)]),
        ),
      });
      overrides.push([`/${commentsPart}`, "application/vnd.ms-excel.comments"]);
      sheetRels.push({ id: nextId(), type: REL("comments"), target: `../comments${commentsCount}.bin` });
    }

    const hyperlinkIds = (sheet.hyperlinks ?? []).map(({ target }) => {
      const id = nextId();
      sheetRels.push({ id, type: REL("hyperlink"), target, isExternal: true });
      return id;
    });

    const out: number[] = [...brt(B.BEGIN_SHEET), ...brt(B.WS_PROP, new Array<number>(27).fill(0))];
    if (kind !== "chartsheet") {
      const dimension = sheet.dimension === undefined ? extentOf(sheet) : sheet.dimension;
      if (dimension !== null) out.push(...brt(B.WS_DIM, rfx(dimension[0], dimension[1], dimension[2], dimension[3])));
      out.push(...brt(B.BEGIN_SHEET_DATA));
      (sheet.rows ?? []).forEach((row, rowIndex) => {
        if (row === undefined) return;
        out.push(...brt(B.ROW_HDR, new Bytes().u32(rowIndex).u32(0).u16(300).u16(0).u8(0).u32(0).finish()));
        out.push(...cellRecords(rowIndex, row, (sheet.shortRows ?? []).includes(rowIndex)));
      });
      out.push(...brt(B.END_SHEET_DATA), ...structureRecords(sheet, hyperlinkIds));
    }
    out.push(...brt(B.END_SHEET));
    entries.push({ name: part, data: Uint8Array.from(out) });
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
  book.push(...brt(B.END_BUNDLE_SHS));
  if (spec.xti !== undefined || spec.supbooks !== undefined) {
    book.push(...brt(B.BEGIN_EXTERNALS));
    for (const supbook of spec.supbooks ?? [{ kind: "self" as const }]) {
      if (supbook.kind === "self") book.push(...brt(B.SUP_SELF));
      else {
        book.push(...brt(B.SUP_ADDIN));
        for (const name of supbook.names) book.push(...brt(B.PLACEHOLDER_NAME, wide(name)));
      }
    }
    const xti = new Bytes().u32((spec.xti ?? []).length);
    for (const entry of spec.xti ?? []) xti.u32(entry.supbook).u32(entry.first).u32(entry.last);
    book.push(...brt(B.EXTERN_SHEET, xti.finish()), ...brt(B.END_EXTERNALS));
  }
  for (const name of spec.names ?? []) {
    book.push(
      ...brt(B.NAME, [
        ...new Bytes().u32(name.isFunction === true ? 0x0002 : 0).u8(0).u32(name.sheetIndex ?? 0xffffffff).finish(),
        ...wide(name.name),
        ...new Bytes().u32(name.rgce.length).finish(),
        ...name.rgce,
        ...new Bytes().u32((name.rgcb ?? []).length).finish(),
        ...(name.rgcb ?? []),
        ...NULL_WIDE,
      ]),
    );
  }
  book.push(...brt(B.END_BOOK));

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

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="${BINARY_MAIN}"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides
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
