/**
 * The XLSB fixtures, by path under `tests/fixtures/workbooks/` (M58).
 * `tests/unit/import/xlsb/corpus.test.ts` asserts each committed file is
 * exactly what its generator writes (`SHEAF_WRITE_FIXTURES=1` rewrites them).
 */

import { XLSB_FIDELITY } from "./build-fidelity.js";
import { buildXlsb, type XlsbWorkbookSpec } from "./build-xlsb.js";

/** A plain two-sheet workbook: text, whole and fractional numbers, a boolean, an error, a declared table. */
export const PLAIN_XLSB: XlsbWorkbookSpec = {
  formats: [{ id: 164, code: '"$"#,##0.00' }],
  xfs: [{ formatId: 0 }, { formatId: 164 }, { formatId: 0, font: 1 }],
  sheets: [
    {
      name: "Crew",
      rows: [
        [
          { value: "Name", style: 2 },
          { value: "Role", style: 2 },
          { value: "Hours", style: 2 },
          { value: "Rate", style: 2 },
          { value: "Active", style: 2 },
        ],
        ["Ada", "Lead", 38, { value: 41.5, style: 1 }, true],
        ["Grace", "Technician", 40, { value: 1 / 3, style: 1 }, false],
        ["Linus", null, null, { value: 0.07, style: 1 }, { error: 0x2a }],
      ],
      tables: [{ name: "CrewTable", range: [0, 3, 0, 4], columns: ["Name", "Role", "Hours", "Rate", "Active"] }],
    },
    {
      name: "Sites",
      rows: [
        ["Site", "Visits"],
        ["North", 12],
        ["South", 7],
      ],
    },
  ],
};

export const XLSB_CORPUS: ReadonlyMap<string, () => Uint8Array> = new Map<string, () => Uint8Array>([
  ["xlsb/plain.xlsb", () => buildXlsb(PLAIN_XLSB)],
  ["xlsb/macro-vba.xlsb", () => buildXlsb({ ...PLAIN_XLSB, vbaProject: true })],
  [
    "xlsb/xlm-macrosheet.xlsb",
    () => buildXlsb({ ...PLAIN_XLSB, sheets: [...PLAIN_XLSB.sheets, { name: "Macro1", kind: "macrosheet", rows: [["=HALT()"]] }] }),
  ],
  ...[...XLSB_FIDELITY].map(([name, spec]): [string, () => Uint8Array] => [`xlsb/${name}`, () => buildXlsb(spec)]),
]);
