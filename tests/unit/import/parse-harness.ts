import type {
  WorkbookFactStreamItemV1,
  WorkbookSummaryV1,
} from "../../../src/import/formats/delimited/facts.js";
import {
  parseDelimited,
  type DelimitedParseOptionsV1,
} from "../../../src/import/formats/delimited/parse.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import type { RandomAccessSource } from "../../../src/import/source/source.js";
import { fixtureSource, textSource } from "./fixtures.js";

export interface ParsedStream {
  readonly items: readonly WorkbookFactStreamItemV1[];
  readonly summary: WorkbookSummaryV1;
  /** Rows rebuilt from the sparse facts; a blank or missing cell reads as "". */
  readonly rows: readonly (readonly string[])[];
}

export const rowsOf = (
  items: readonly WorkbookFactStreamItemV1[],
): readonly (readonly string[])[] => {
  const rows = new Map<number, string[]>();
  for (const item of items) {
    if (item.kind !== "batch") {
      continue;
    }
    for (const fact of item.facts) {
      if (fact.kind === "row") {
        rows.set(fact.rowIndex, Array.from({ length: fact.cellCount }, () => ""));
      } else if (fact.kind === "value" && fact.value.kind === "text") {
        const row = rows.get(fact.rowIndex);
        if (row !== undefined) {
          row[fact.columnIndex] = fact.value.text;
        }
      }
    }
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, cells]) => cells);
};

export const parseSource = async (
  source: RandomAccessSource,
  declaredName: string,
  options?: DelimitedParseOptionsV1,
): Promise<ParsedStream> => {
  const { format } = await sniffContent(source, declaredName);
  if (format.kind !== "delimited") {
    throw new Error(`${declaredName} did not sniff as delimited`);
  }
  const items: WorkbookFactStreamItemV1[] = [];
  for await (const item of parseDelimited(source, format, options ?? {})) {
    items.push(item);
  }
  const summary = items.at(-1);
  if (summary === undefined || summary.kind !== "summary") {
    throw new Error(`${declaredName} produced no terminal summary`);
  }
  return { items, summary, rows: rowsOf(items) };
};

export const parseFixture = async (
  relativePath: string,
  declaredName: string,
  options?: DelimitedParseOptionsV1,
): Promise<ParsedStream> =>
  parseSource(await fixtureSource(relativePath), declaredName, options);

export const parseText = async (
  text: string,
  options?: DelimitedParseOptionsV1,
): Promise<ParsedStream> =>
  parseSource(textSource(text), "sample.csv", options);
