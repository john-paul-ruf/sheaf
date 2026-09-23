/**
 * The BIFF (`.xls`) fixtures, by path under `tests/fixtures/workbooks/` (M58).
 * `tests/unit/import/biff/corpus.test.ts` asserts each committed file is
 * exactly what its generator writes (`SHEAF_WRITE_FIXTURES=1` rewrites them).
 */

import { buildBiffWorkbook, type BiffBuildOptions, type BiffWorkbookSpec } from "./build-biff.js";
import { BIFF_FIDELITY } from "./build-fidelity.js";

/** Error codes as BIFF stores them (MS-XLS §2.5.10). */
export const ERR = Object.freeze({ NA: 0x2a, VALUE: 0x0f, DIV0: 0x07, REF: 0x17 });

/** A plain two-sheet BIFF8 workbook: text, whole and fractional numbers, runs, a boolean, an error. */
export const PLAIN: BiffWorkbookSpec = {
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
        ["Linus", null, null, { value: 0.07, style: 1 }, { error: ERR.NA }],
      ],
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

const VBA_STREAMS = [
  { path: "_VBA_PROJECT_CUR/PROJECT", data: new TextEncoder().encode('ID="{00000000-0000-0000-0000-000000000000}"\r\n') },
  { path: "_VBA_PROJECT_CUR/VBA/dir", data: Uint8Array.from({ length: 64 }, (_, index) => index) },
];

export const BIFF_CORPUS: ReadonlyMap<string, () => Uint8Array> = new Map<string, () => Uint8Array>([
  ["biff/plain.xls", () => buildBiffWorkbook(PLAIN)],
  ["biff/macro-vba.xls", () => buildBiffWorkbook({ ...PLAIN, streams: VBA_STREAMS })],
  [
    "biff/xlm-macrosheet.xls",
    () => buildBiffWorkbook({ ...PLAIN, sheets: [...PLAIN.sheets, { name: "Macro1", type: "macro", rows: [["=HALT()"]] }] }),
  ],
  ["biff/xlm-fngroup.xls", () => buildBiffWorkbook({ ...PLAIN, fnGroupName: true })],
  ["biff/encrypted.xls", () => buildBiffWorkbook({ ...PLAIN, encrypted: true })],
  ["biff/cfb-loop.xls", () => buildBiffWorkbook(PLAIN, { cfb: { directoryLoop: true } } satisfies BiffBuildOptions)],
  [
    "biff/biff5-book.xls",
    () =>
      buildBiffWorkbook({
        version: "biff5",
        codePage: 1252,
        sheets: [
          {
            name: "Café",
            rows: [
              ["Item", "Price"],
              ["Crème brûlée — small", 4.5],
              ["Espresso", 2],
            ],
          },
        ],
      }),
  ],
  ...[...BIFF_FIDELITY].map(([name, spec]): [string, () => Uint8Array] => [`biff/${name}`, () => buildBiffWorkbook(spec)]),
]);
