/**
 * Every generated fixture in the workbook corpus, by path under
 * `tests/fixtures/workbooks/` (M58).
 *
 * The committed bytes are the test subject; this map is the evidence of how
 * each was made. `tests/unit/import/containers/corpus.test.ts` asserts every
 * generator reproduces its committed file exactly, and rewrites them when run
 * with `SHEAF_WRITE_FIXTURES=1`.
 */

import { buildDemoWorkbook } from "../ooxml/build-demo.js";
import { FIDELITY_WORKBOOKS } from "../ooxml/build-fidelity.js";
import { writeCfb } from "./cfb-writer.js";
import { buildOoxml, CONTENT_TYPES, ooxmlEntries, type WorkbookSpec } from "./ooxml-builder.js";
import { bytesOf, writeZip, type ZipEntrySpec } from "./zip-writer.js";

/** The small, ordinary workbook each unsafe fixture corrupts one way. */
export const PAYROLL: WorkbookSpec = {
  sheets: [
    {
      name: "Payroll",
      rows: [
        ["Name", "Hours", "Rate"],
        ["Ada", 38, 41.5],
        ["Grace", 40, 44],
      ],
    },
  ],
};

const WORKBOOK_PART = "xl/workbook.xml";

/** The payroll parts with one part's data replaced. */
const withPart = (
  name: string,
  change: (entry: ZipEntrySpec) => ZipEntrySpec,
  spec: WorkbookSpec = PAYROLL,
): ZipEntrySpec[] =>
  ooxmlEntries(spec).map((entry) => (entry.name === name ? change(entry) : entry));

const text = (entry: ZipEntrySpec): string => new TextDecoder().decode(bytesOf(entry.data));

const withWorkbookText = (edit: (xml: string) => string): Uint8Array =>
  writeZip(withPart(WORKBOOK_PART, (entry) => ({ ...entry, data: edit(text(entry)) })));

/** Two megabytes of whitespace compresses past 150:1 with the fixed encoder. */
const BOMB_PADDING = " ".repeat(2_000_000);

const encryptedPackage = (): Uint8Array =>
  writeCfb([
    { path: "EncryptionInfo", data: Uint8Array.from({ length: 248 }, (_, index) => index % 256) },
    { path: "EncryptedPackage", data: Uint8Array.from({ length: 6000 }, (_, index) => (index * 31) % 256) },
  ]);

const legacyStreams = [
  { path: "Workbook", data: Uint8Array.from({ length: 5000 }, (_, index) => (index * 7) % 256) },
  { path: "\u0005SummaryInformation", data: Uint8Array.from({ length: 200 }, (_, index) => index % 256) },
];

export const CORPUS: ReadonlyMap<string, () => Uint8Array> = new Map([
  ["unsafe/truncated.xlsx", () => buildOoxml(PAYROLL).slice(0, 700)],
  [
    "unsafe/zip-bomb.xlsx",
    () => withWorkbookText((xml) => xml.replace("<workbookPr/>", `<workbookPr/>${BOMB_PADDING}`)),
  ],
  [
    "unsafe/lying-size.xlsx",
    () =>
      writeZip(
        withPart(WORKBOOK_PART, (entry) => ({
          ...entry,
          declaredUncompressedSize: bytesOf(entry.data).length - 40,
        })),
      ),
  ],
  [
    "unsafe/doctype.xlsx",
    () =>
      withWorkbookText((xml) =>
        xml.replace(
          "?>\n",
          '?>\n<!DOCTYPE workbook [<!ENTITY bomb "boom">]>\n',
        ),
      ),
  ],
  [
    "unsafe/entity-reference.xlsx",
    () => withWorkbookText((xml) => xml.replace('name="Payroll"', 'name="&payroll;"')),
  ],
  [
    "unsafe/deep-nesting.xlsx",
    () =>
      withWorkbookText((xml) =>
        xml.replace("<workbookPr/>", `<workbookPr/>${"<x>".repeat(300)}${"</x>".repeat(300)}`),
      ),
  ],
  [
    "unsafe/path-traversal.xlsx",
    () => writeZip([...ooxmlEntries(PAYROLL), { name: "../outside.xml", data: "<x/>" }]),
  ],
  ["unsafe/entry-count.xlsx", () => writeZip(ooxmlEntries(PAYROLL), { entryCount: 10_001 })],
  [
    "unsafe/zip-encrypted.xlsx",
    () => writeZip(withPart(WORKBOOK_PART, (entry) => ({ ...entry, encrypted: true }))),
  ],
  [
    "unsafe/unknown-method.xlsx",
    () => {
      const bytes = buildOoxml(PAYROLL);
      // Rewrite every compression method (local and central) from 8 to 9
      // (Deflate64): a valid directory naming a method Sheaf does not read.
      for (let at = 0; at + 4 <= bytes.length; at += 1) {
        const signature = bytes[at] === 0x50 && bytes[at + 1] === 0x4b;
        if (signature && bytes[at + 2] === 0x03 && bytes[at + 3] === 0x04 && bytes[at + 8] === 8) bytes[at + 8] = 9;
        if (signature && bytes[at + 2] === 0x01 && bytes[at + 3] === 0x02 && bytes[at + 10] === 8) bytes[at + 10] = 9;
      }
      return bytes;
    },
  ],
  ["unsafe/encrypted.xlsx", encryptedPackage],
  ["unsafe/cfb-loop.xls", () => writeCfb(legacyStreams, { directoryLoop: true })],
  ["unsafe/cfb-chain-loop.xls", () => writeCfb(legacyStreams, { chainLoopPath: "Workbook" })],
  [
    "unsafe/cfb-size-mismatch.xls",
    () => writeCfb(legacyStreams, { declaredSizes: { Workbook: 4500 } }),
  ],
  ["unsafe/cfb-truncated.xls", () => writeCfb(legacyStreams).slice(0, 2000)],
  ["unsafe/payroll.xlsm", () => buildOoxml({ ...PAYROLL, vbaProject: true })],
  [
    "unsafe/renamed-macro.xlsx",
    () => buildOoxml({ ...PAYROLL, workbookContentType: CONTENT_TYPES.macroWorkbook }),
  ],
  [
    "unsafe/xlm-macrosheet.xlsx",
    () =>
      buildOoxml({
        sheets: [
          ...PAYROLL.sheets,
          { name: "Macro1", kind: "macrosheet", rows: [[{ formula: { text: "HALT()" } }]] },
        ],
      }),
  ],
  [
    "unsafe/far-corner.xlsx",
    () =>
      buildOoxml({
        sheets: [{ ...(PAYROLL.sheets[0] as WorkbookSpec["sheets"][number]), dimension: "A1:XFE1048577" }],
      }),
  ],
  ...[...FIDELITY_WORKBOOKS].map(
    ([name, spec]) => [`ooxml/${name}`, () => buildOoxml(spec)] as [string, () => Uint8Array],
  ),
  ["ooxml/contradiction.xls", () => buildOoxml(PAYROLL)],
  ["ooxml/fieldwork-q3.xlsx", buildDemoWorkbook],
]);
