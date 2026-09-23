import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { odsAdapter, readOdsInventory } from "../../../src/import/formats/ods/index.js";
import { convertOpenFormula } from "../../../src/import/formats/ods/formula.js";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { BoundExceededError } from "../../../src/import/source/bounds.js";
import { bytesSource } from "../../../src/import/source/source.js";
import { openZipContainer, type ZipContainerHandleV1 } from "../../../src/import/source/zip.js";
import { buildOds, paragraphs, rowXml, type OdsCell } from "../../fixtures/workbooks/ods/build-ods.js";
import { assertConformingStream } from "../../unit/import/facts/conformance.js";

type Plain = string | number | boolean | null;

interface CellRun {
  readonly value: Plain;
  readonly repeat: number;
}

interface RowRun {
  readonly cells: readonly CellRun[];
  readonly repeat: number;
}

const plain: fc.Arbitrary<Plain> = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 6 }).filter((text) => text.trim() !== "" && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/.test(text) && text === text.normalize("NFC") && !/^\s|\s$/.test(text)),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.boolean(),
);

const rows = fc.array(
  fc.record({
    cells: fc.array(fc.record({ value: plain, repeat: fc.integer({ min: 1, max: 4 }) }), { maxLength: 6 }),
    repeat: fc.integer({ min: 1, max: 4 }),
  }),
  { maxLength: 8 },
);

const cellOf = ({ value, repeat }: CellRun): OdsCell => {
  const attrs: Record<string, string | number> = repeat > 1 ? { "table:number-columns-repeated": repeat } : {};
  if (value === null) return { attrs };
  if (typeof value === "string") return { attrs: { "office:value-type": "string", ...attrs }, inner: paragraphs(value) };
  if (typeof value === "number") return { attrs: { "office:value-type": "float", "office:value": value, ...attrs }, inner: paragraphs(String(value)) };
  return { attrs: { "office:value-type": "boolean", "office:boolean-value": String(value), ...attrs }, inner: paragraphs(String(value)) };
};

/** The sparse cells a grid of runs means: `[row, column, value]` for every non-empty cell. */
const expectedCells = (runs: readonly RowRun[]): [number, number, Plain][] => {
  const cells: [number, number, Plain][] = [];
  let row = 0;
  for (const run of runs) {
    for (let offset = 0; offset < run.repeat; offset += 1) {
      let column = 0;
      for (const cell of run.cells) {
        for (let index = 0; index < cell.repeat; index += 1) {
          if (cell.value !== null) cells.push([row + offset, column, cell.value]);
          column += 1;
        }
      }
    }
    row += run.repeat;
  }
  return cells;
};

const parse = async (bytes: Uint8Array): Promise<WorkbookFactStreamItemV2[]> => {
  const zip = await openZipContainer(bytesSource(bytes));
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of odsAdapter.parseSheets({ kind: "zip", zip }, [0], { cancellation: { aborted: false }, factsPerBatch: 7 })) {
    items.push(item);
  }
  return items;
};

describe("ODS adapter on generated grids (property)", () => {
  it("expands every row and column repeat sparsely, exactly, and conformingly", async () => {
    await fc.assert(
      fc.asyncProperty(rows, async (runs) => {
        const bytes = buildOds({
          content: { tables: [{ name: "Grid", rows: runs.map((run) => rowXml(run.cells.map(cellOf), run.repeat > 1 ? { "table:number-rows-repeated": run.repeat } : undefined)) }] },
        });
        const items = await parse(bytes);
        assertConformingStream(items, { factsPerBatch: 7 });
        const facts = items.flatMap((item) => (item.kind === "batch" ? [...item.facts] : []));
        const values = facts.flatMap((fact) =>
          fact.kind !== "value"
            ? []
            : [[fact.rowIndex, fact.columnIndex, fact.value.kind === "text" ? fact.value.text : fact.value.kind === "decimal" ? Number(fact.value.decimal) : fact.value.kind === "boolean" ? fact.value.boolean : null] as [number, number, Plain]],
        );
        expect(values).toEqual(expectedCells(runs));
        // A row's width is exactly where its last populated cell ends.
        for (const fact of facts) {
          if (fact.kind === "row") {
            const last = Math.max(...values.filter(([row]) => row === fact.rowIndex).map(([, column]) => column));
            expect(fact.cellCount).toBe(last + 1);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it("never throws anything but BoundExceededError on a corrupted content.xml", async () => {
    await fc.assert(
      fc.asyncProperty(rows, fc.integer({ min: 0, max: 2000 }), fc.uint8Array({ minLength: 1, maxLength: 8 }), async (runs, at, noise) => {
        const content = new TextEncoder().encode(
          `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="G">${runs.map((run) => rowXml(run.cells.map(cellOf))).join("")}</table:table></office:spreadsheet></office:body></office:document-content>`,
        );
        const cut = at % (content.length + 1);
        const corrupted = new Uint8Array([...content.subarray(0, cut), ...noise, ...content.subarray(cut)]);
        const bytes = buildOds({ content: { tables: [] } });
        const zip = await openZipContainer(bytesSource(bytes));
        // The real package, with content.xml's bytes replaced by the corrupted ones.
        const handle: ZipContainerHandleV1 = {
          entries: zip.entries,
          has: (name) => zip.has(name),
          entry: (name) => zip.entry(name),
          readEntry: (name, options) => zip.readEntry(name, options),
          async *streamEntry(name: string) {
            if (name === "content.xml") yield corrupted;
            else yield* zip.streamEntry(name);
          },
          get expandedByteCount() {
            return zip.expandedByteCount;
          },
        };
        try {
          await readOdsInventory.readInventory({ kind: "zip", zip: handle });
          for await (const item of odsAdapter.parseSheets({ kind: "zip", zip: handle }, [0], { cancellation: { aborted: false } })) {
            void item;
          }
        } catch (cause) {
          expect(cause).toBeInstanceOf(BoundExceededError);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("converts or declines any formula text without throwing", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (body) => {
        const converted = convertOpenFormula(`of:=${body}`);
        expect(converted.text === null || typeof converted.text === "string").toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
