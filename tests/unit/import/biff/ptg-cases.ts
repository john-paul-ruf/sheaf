/**
 * The Ptg token-stream fixtures shared by the unit and property tests: a
 * decoding context and one `(bytes, expected text)` case per token class.
 */

import type { PtgContextV1, PtgFormatV1 } from "../../../../src/import/formats/biff/ptg.js";
import { ptg, type PtgWriter } from "../../../fixtures/workbooks/biff/ptg-writer.js";

/** The shared decoding context: this workbook, an add-in book and one external book. */
export const contextFor = (format: PtgFormatV1, cell: PtgContextV1["cell"] = { row: 5, column: 2 }): PtgContextV1 => ({
  format,
  sheetNames: ["Jobs", "Customers", "Q1 Report", "Q2 Report"],
  supbooks: [
    { kind: "self", bookIndex: 0, sheetNames: [], names: [] },
    { kind: "addin", bookIndex: 0, sheetNames: [], names: ["_xlfn.XLOOKUP"] },
    { kind: "external", bookIndex: 1, sheetNames: ["Rates"], names: ["TaxRate"] },
  ],
  externSheets: [
    { supbook: 0, firstSheet: 1, lastSheet: 1 },
    { supbook: 0, firstSheet: 2, lastSheet: 3 },
    { supbook: 1, firstSheet: -2, lastSheet: -2 },
    { supbook: 2, firstSheet: 0, lastSheet: 0 },
    { supbook: 0, firstSheet: -1, lastSheet: -1 },
    { supbook: 0, firstSheet: 0, lastSheet: 0 },
  ],
  definedNames: ["MaterialList", "Rate"],
  cell,
  isSharedFormula: false,
});

const LAST_ROW = { biff8: 65_535, biff12: 1_048_575 } as const;
const LAST_COLUMN = { biff8: 255, biff12: 16_383 } as const;
const ABS = { rowAbsolute: true, columnAbsolute: true } as const;

/** `(format) → [token writer, expected text]`, one per token class. */
export const CASES: readonly [string, (format: PtgFormatV1) => PtgWriter, string][] = [
  [
    "VLOOKUP into another sheet's whole columns",
    (f) => ptg(f).ref(1, 1).area3d(0, 0, 0, LAST_ROW[f], 1).int(2).bool(false).funcVar(102, 4),
    "VLOOKUP(B2,Customers!A:B,2,FALSE)",
  ],
  ["subtraction", (f) => ptg(f).ref(1, 4).ref(1, 5).sub(), "E2-F2"],
  ["tAttrSum shorthand", (f) => ptg(f).area3d(5, 1, 4, 60, 4).attrSum(), "SUM(Jobs!E2:E61)"],
  ["SUM through PtgFuncVar", (f) => ptg(f).area(1, 4, 60, 4).funcVar(4, 1), "SUM(E2:E61)"],
  [
    "IF with tAttrIf/Goto/Space bookkeeping skipped",
    (f) =>
      ptg(f)
        .ref(0, 0, ABS)
        .int(0)
        .op(0x0d)
        .attr(0x02, 7)
        .attrSpace(1)
        .str("yes")
        .attr(0x08, 3)
        .str("no")
        .attr(0x08, 3)
        .funcVar(1, 3),
    'IF($A$1>0,"yes","no")',
  ],
  ["fixed-arity ROUND and a number literal", (f) => ptg(f).ref(5, 1).num(1.5).op(0x05).int(2).func(27), "ROUND(B6*1.5,2)"],
  ["unary minus and percent", (f) => ptg(f).ref(0, 0).op(0x13).op(0x14), "-A1%"],
  ["unary plus", (f) => ptg(f).ref(0, 0).op(0x12), "+A1"],
  ["parentheses", (f) => ptg(f).ref(0, 0).ref(0, 1).add().paren().int(2).op(0x05), "(A1+B1)*2"],
  ["power, concat and comparisons", (f) => ptg(f).int(2).int(3).op(0x07).str("x").op(0x08).str("x5").op(0x0e), '2^3&"x"<>"x5"'],
  ["every comparison", (f) => ptg(f).int(1).int(2).op(0x09).int(3).op(0x0a).int(4).op(0x0b).int(5).op(0x0c), "1<2<=3=4>=5"],
  ["3-D span with quoted sheet names", (f) => ptg(f).ref3d(1, 2, 2), "'Q1 Report:Q2 Report'!C3"],
  ["external book reference", (f) => ptg(f).ref3d(3, 1, 1, ABS), "[1]Rates!$B$2"],
  [
    "a future function through PtgNameX and PtgFuncVar 255",
    (f) => ptg(f).nameX(2, 1).ref(0, 0).area(0, 1, LAST_ROW[f], 1).area(0, 2, LAST_ROW[f], 2).funcVar(255, 4),
    "_xlfn.XLOOKUP(A1,B:B,C:C)",
  ],
  ["an external defined name", (f) => ptg(f).nameX(3, 1), "[1]!TaxRate"],
  ["this workbook's name through PtgNameX", (f) => ptg(f).nameX(0, 2), "Rate"],
  ["a defined name", (f) => ptg(f).name(1), "MaterialList"],
  ["reference errors", (f) => ptg(f).refErr().areaErr().op(0x03), "#REF!+#REF!"],
  ["3-D reference errors", (f) => ptg(f).refErr3d(0).areaErr3d(0).op(0x03), "Customers!#REF!+Customers!#REF!"],
  ["a deleted sheet", (f) => ptg(f).ref3d(4, 0, 0).area3d(4, 0, 0, 1, 1).refErr3d(4).funcVar(4, 3), "SUM(#REF!,#REF!,#REF!)"],
  ["an array constant", (f) => ptg(f).array([[1, 2], ["a", true]]), '{1,2;"a",TRUE}'],
  ["array errors and booleans", (f) => ptg(f).array([[{ error: 0x2a }, false]]), "{#N/A,FALSE}"],
  ["a missing argument", (f) => ptg(f).ref(0, 0).missArg().int(3).funcVar(1, 3), "IF(A1,,3)"],
  ["PtgRefN relative to the formula's cell", (f) => ptg(f).refN(-1, 0), "C5"],
  ["PtgRefN with an absolute part", (f) => ptg(f).refN(3, -1, { rowAbsolute: true }), "B$4"],
  ["PtgAreaN relative to the formula's cell", (f) => ptg(f).areaN(0, -2, 0, -1), "A6:B6"],
  ["PtgMemFunc is transparent", (f) => ptg(f).memFunc(f === "biff8" ? 11 : 15).area3d(0, 0, 0, 1, 1).funcVar(4, 1), "SUM(Customers!A1:B2)"],
  [
    "PtgMemArea's extra data is consumed before an array constant",
    (f) => ptg(f).memArea(f === "biff8" ? 9 : 13, [[0, 1, 0, 1]]).area(0, 0, 1, 1).array([[7]]).funcVar(4, 2),
    "SUM(A1:B2,{7})",
  ],
  ["union", (f) => ptg(f).ref(0, 0).ref(0, 1).op(0x10).paren(), "(A1,B1)"],
  ["range and intersection operators", (f) => ptg(f).ref(0, 0).ref(1, 1).op(0x11).ref(0, 0).op(0x0f), "A1:B2 A1"],
  ["whole rows", (f) => ptg(f).area(1, 0, 2, LAST_COLUMN[f], ABS), "$2:$3"],
  ["quotes inside a string", (f) => ptg(f).str('say "hi"'), '"say ""hi"""'],
  ["error, integer and decimal literals", (f) => ptg(f).err(0x2a).int(7).num(0.1).funcVar(4, 2).funcVar(4, 2), "SUM(#N/A,SUM(7,0.1))"],
  ["a zero-argument function", (f) => ptg(f).func(221), "TODAY()"],
  ["PtgRef3d outside a shared formula is absolute", (f) => ptg(f).ref3d(0, 1, 1), "Customers!B2"],
];
