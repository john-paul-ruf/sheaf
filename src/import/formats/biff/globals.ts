/**
 * The workbook globals substream (M17): everything before the first sheet's
 * `BOF` — the code page, the date epoch, the sheet list, the 3-D reference
 * context (`SUPBOOK`/`EXTERNSHEET`/`EXTERNNAME`), defined names, number
 * formats, cell formats and the shared-string table.
 *
 * Both the inventory reader and the adapter read the globals through here.
 * The inventory asks for no cell data: the SST is then skipped unread, since
 * shared strings are cell content. A `FILEPASS` record ends the read at once —
 * every record after it is encrypted, and Sheaf never decrypts (invariant 8).
 */

import type { MacroSignalV1 } from "../../facts/index.js";
import type { CfbHandleV1 } from "../../source/cfb.js";
import { BoundExceededError } from "../../source/bounds.js";
import { codePageDecoder, type CodePageDecoderV1 } from "./codepage.js";
import {
  BIFF5_VERSION,
  BIFF8_VERSION,
  ContinuedCursorV1,
  i16,
  malformed,
  openRecordStream,
  RT,
  SUBSTREAM,
  u16,
  u32,
  u8,
  unicodeChars,
  unicodeString,
  type BiffRecordStreamV1,
  type BiffVersionV1,
} from "./records.js";
import type { PtgExternSheetV1, PtgSupbookV1 } from "./ptg.js";

/** `BOUNDSHEET8.dt` (MS-XLS §2.4.28). */
export const SHEET_TYPE = Object.freeze({ WORKSHEET: 0, MACRO_SHEET: 1, CHART: 2, VB_MODULE: 6 });

export interface BiffSheetEntryV1 {
  readonly sheetIndex: number;
  readonly name: string;
  /** Stream offset of the sheet's `BOF`. */
  readonly offset: number;
  readonly hiddenState: number;
  readonly sheetType: number;
}

export interface BiffNameV1 {
  readonly name: string;
  /** Zero-based sheet scope; `null` for a workbook-wide name. */
  readonly sheetIndex: number | null;
  readonly isFunction: boolean;
  readonly rgce: Uint8Array;
  readonly rgcb: Uint8Array;
}

export interface BiffCellFormatV1 {
  readonly formatId: number;
  readonly isVisuallyStyled: boolean;
}

export interface BiffGlobalsV1 {
  readonly version: BiffVersionV1;
  readonly streamPath: string;
  readonly streamSize: number;
  readonly codePage: CodePageDecoderV1;
  readonly is1904: boolean;
  readonly sheets: readonly BiffSheetEntryV1[];
  readonly supbooks: readonly PtgSupbookV1[];
  readonly externSheets: readonly PtgExternSheetV1[];
  readonly names: readonly BiffNameV1[];
  readonly dataConnectionCount: number;
  readonly macro: MacroSignalV1 | null;
  readonly isEncrypted: boolean;
  /** Empty unless cell data was asked for. */
  readonly strings: readonly string[];
  readonly formats: ReadonlyMap<number, string>;
  readonly cellFormats: readonly BiffCellFormatV1[];
}

/** Storages that hold a VBA project; any stream inside one refuses the import. */
const VBA_STORAGES = ["_VBA_PROJECT_CUR/", "_VBA_PROJECT/", "MACROS/"];

/** A VBA storage in the CFB directory, or `null`. Reads no stream. */
export function storageMacroSignal(cfb: CfbHandleV1): MacroSignalV1 | null {
  for (const { path } of cfb.listStreams()) {
    const upper = path.toUpperCase();
    const storage = VBA_STORAGES.find((prefix) => upper.startsWith(prefix));
    if (storage !== undefined) {
      return { kind: "vba-project", partPath: path.slice(0, storage.length - 1) };
    }
  }
  return null;
}

/** `Workbook` (BIFF8) or `Book` (BIFF5); `null` when neither exists. */
export function workbookStreamOf(cfb: CfbHandleV1): { readonly path: string; readonly size: number } | null {
  const streams = cfb.listStreams();
  for (const name of ["WORKBOOK", "BOOK"]) {
    const found = streams.find((stream) => stream.path.toUpperCase() === name);
    if (found !== undefined) return { path: found.path, size: found.size };
  }
  return null;
}

/** Built-in name characters (MS-XLS §2.5.114), spelled as OOXML spells them. */
const BUILTIN_NAMES = [
  "Consolidate_Area",
  "Auto_Open",
  "Auto_Close",
  "Extract",
  "Database",
  "Criteria",
  "Print_Area",
  "Print_Titles",
  "Recorder",
  "Data_Form",
  "Auto_Activate",
  "Auto_Deactivate",
  "Sheet_Title",
  "_FilterDatabase",
];

const SUPBOOK_SELF = 0x0401;
const SUPBOOK_ADDIN = 0x3a01;

const LBL_FUNCTION = 0x0002;
const LBL_PROCEDURE = 0x0008;
const LBL_BUILTIN = 0x0020;

/** XF visual styling: a non-default font, any border line, any fill pattern. */
const isStyledXf = (body: Uint8Array, version: BiffVersionV1): boolean => {
  const font = u16(body, 0);
  if (version === "biff8") {
    const borders = u32(body, 10);
    const fill = u32(body, 14);
    return font !== 0 || (borders & 0xffff) !== 0 || ((fill >>> 21) & 0xf) !== 0 || ((fill >>> 26) & 0x3f) !== 0;
  }
  const colors = u32(body, 8);
  const lines = u32(body, 12);
  return font !== 0 || ((colors >>> 16) & 0x3f) !== 0 || ((colors >>> 22) & 0x7) !== 0 || (lines & 0x1ff) !== 0;
};

/** Every body of one record and its `CONTINUE` records. */
const withContinues = async (stream: BiffRecordStreamV1, body: Uint8Array): Promise<Uint8Array[]> => {
  const fragments = [body];
  while ((await stream.peekType()) === RT.CONTINUE) {
    fragments.push(((await stream.next()) ?? malformed()).body);
  }
  return fragments;
};

const readSst = (fragments: readonly Uint8Array[]): string[] => {
  const cursor = new ContinuedCursorV1(fragments);
  cursor.u32();
  const unique = cursor.u32();
  const totalBytes = fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0);
  // Every string costs at least its 3-byte header; a larger claim is a lie.
  if (unique > totalBytes / 3) malformed();
  const strings: string[] = [];
  for (let index = 0; index < unique && !cursor.isAtEnd; index += 1) {
    strings.push(cursor.richExtendedString());
  }
  return strings;
};

export interface ReadGlobalsOptionsV1 {
  /** Read the SST and keep it; the inventory reader never does. */
  readonly withCellData: boolean;
}

/**
 * Opens the workbook stream and reads the globals substream. The returned
 * record stream is positioned just past the globals' `EOF`.
 */
export async function readBiffGlobals(
  cfb: CfbHandleV1,
  options: ReadGlobalsOptionsV1,
): Promise<{ readonly globals: BiffGlobalsV1; readonly stream: BiffRecordStreamV1 }> {
  const located = workbookStreamOf(cfb);
  if (located === null) throw new BoundExceededError("unrecognized-content");
  const stream = openRecordStream(cfb.streamStream(located.path));

  const bof = await stream.next();
  if (bof === null || bof.type !== RT.BOF || bof.body.byteLength < 4 || u16(bof.body, 2) !== SUBSTREAM.GLOBALS) {
    throw new BoundExceededError("unrecognized-content");
  }
  const versionWord = u16(bof.body, 0);
  const version: BiffVersionV1 | null =
    versionWord === BIFF8_VERSION ? "biff8" : versionWord === BIFF5_VERSION ? "biff5" : null;
  if (version === null) throw new BoundExceededError("unrecognized-content");

  let codePageNumber: number | null = null;
  let is1904 = false;
  let isEncrypted = false;
  let macro: MacroSignalV1 | null = null;
  let dataConnectionCount = 0;
  const rawSheets: { offset: number; hiddenState: number; sheetType: number; name: string | Uint8Array }[] = [];
  const supbooks: { kind: PtgSupbookV1["kind"]; sheetNames: string[]; names: string[] }[] = [];
  const externSheets: PtgExternSheetV1[] = [];
  const names: BiffNameV1[] = [];
  const formats = new Map<number, string | Uint8Array>();
  const cellFormats: BiffCellFormatV1[] = [];
  let strings: string[] = [];

  for (;;) {
    const type = await stream.peekType();
    if (type === null) throw new BoundExceededError("truncated-container");
    if (type === RT.SST && !options.withCellData) {
      await stream.next();
      while ((await stream.peekType()) === RT.CONTINUE) await stream.next();
      continue;
    }
    const record = (await stream.next()) ?? malformed();
    const body = record.body;
    if (type === RT.EOF) break;
    switch (type) {
      case RT.FILEPASS:
        isEncrypted = true;
        break;
      case RT.CODEPAGE:
        codePageNumber = u16(body, 0);
        break;
      case RT.DATEMODE:
        is1904 = u16(body, 0) === 1;
        break;
      case RT.BOUNDSHEET: {
        const sheetType = u8(body, 5);
        const name =
          version === "biff8" ? unicodeString(body, 6, 1).text : body.slice(7, 7 + u8(body, 6));
        rawSheets.push({ offset: u32(body, 0), hiddenState: u8(body, 4) & 0x03, sheetType, name });
        if (macro === null && sheetType === SHEET_TYPE.MACRO_SHEET) {
          macro = { kind: "xlm-macro-sheet", partPath: located.path };
        } else if (macro === null && sheetType === SHEET_TYPE.VB_MODULE) {
          macro = { kind: "vba-project", partPath: located.path };
        }
        break;
      }
      case RT.FNGROUPNAME:
        macro ??= { kind: "xlm-macro-sheet", partPath: located.path };
        break;
      case RT.DCONN:
        dataConnectionCount += 1;
        break;
      case RT.SUPBOOK:
        if (version === "biff8") supbooks.push(readSupbook(body));
        break;
      case RT.EXTERNNAME: {
        const book = supbooks.at(-1);
        if (version === "biff8" && book !== undefined) book.names.push(unicodeString(body, 6, 1).text);
        break;
      }
      case RT.EXTERNSHEET:
        if (version === "biff8") {
          for (let index = 0, count = u16(body, 0); index < count; index += 1) {
            const at = 2 + index * 6;
            externSheets.push({ supbook: u16(body, at), firstSheet: i16(body, at + 2), lastSheet: i16(body, at + 4) });
          }
        }
        break;
      case RT.NAME:
        if (version === "biff8") names.push(readName(body));
        break;
      case RT.FORMAT:
        formats.set(
          u16(body, 0),
          version === "biff8" ? unicodeString(body, 2, 2).text : body.slice(3, 3 + u8(body, 2)),
        );
        break;
      case RT.XF:
        cellFormats.push({ formatId: u16(body, 2), isVisuallyStyled: isStyledXf(body, version) });
        break;
      case RT.SST:
        strings = readSst(await withContinues(stream, body));
        break;
    }
    if (isEncrypted) break;
  }

  const codePage = codePageDecoder(codePageNumber);
  const text = (value: string | Uint8Array): string =>
    (typeof value === "string" ? value : codePage.decode(value).text).normalize("NFC");
  return {
    stream,
    globals: {
      version,
      streamPath: located.path,
      streamSize: located.size,
      codePage,
      is1904,
      sheets: rawSheets.map((sheet, sheetIndex) => ({ ...sheet, sheetIndex, name: text(sheet.name) })),
      supbooks: supbooks.map((book, index) => ({
        ...book,
        bookIndex: supbooks.slice(0, index + 1).filter((each) => each.kind === "external").length,
      })),
      externSheets,
      names,
      dataConnectionCount,
      macro,
      isEncrypted,
      strings,
      formats: new Map([...formats].map(([id, code]) => [id, text(code)])),
      cellFormats,
    },
  };
}

function readSupbook(body: Uint8Array): { kind: PtgSupbookV1["kind"]; sheetNames: string[]; names: string[] } {
  const sheetCount = u16(body, 0);
  const marker = u16(body, 2);
  if (marker === SUPBOOK_SELF) return { kind: "self", sheetNames: [], names: [] };
  if (marker === SUPBOOK_ADDIN) return { kind: "addin", sheetNames: [], names: [] };
  const isHighByte = (u8(body, 4) & 1) !== 0;
  let at = 5 + marker * (isHighByte ? 2 : 1);
  const sheetNames: string[] = [];
  for (let index = 0; index < sheetCount; index += 1) {
    const name = unicodeString(body, at, 2);
    sheetNames.push(name.text.normalize("NFC"));
    at = name.end;
  }
  return { kind: "external", sheetNames, names: [] };
}

function readName(body: Uint8Array): BiffNameV1 {
  const flags = u16(body, 0);
  const cch = u8(body, 3);
  const cce = u16(body, 4);
  const itab = u16(body, 8);
  const isHighByte = (u8(body, 14) & 1) !== 0;
  const nameEnd = 15 + cch * (isHighByte ? 2 : 1);
  let name = unicodeChars(body, 15, cch, isHighByte);
  if ((flags & LBL_BUILTIN) !== 0) {
    const builtin = BUILTIN_NAMES[name.charCodeAt(0)];
    name = builtin === undefined ? name : `_xlnm.${builtin}`;
  }
  if (nameEnd + cce > body.byteLength) malformed();
  return {
    name: name.normalize("NFC"),
    sheetIndex: itab === 0 ? null : itab - 1,
    isFunction: (flags & (LBL_FUNCTION | LBL_PROCEDURE)) !== 0,
    rgce: body.slice(nameEnd, nameEnd + cce),
    rgcb: body.slice(nameEnd + cce),
  };
}
