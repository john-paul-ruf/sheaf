/**
 * Real fact streams for the staging suites: a fixture read the way the import
 * worker reads it — sniffed, sized by `preflightWorkbook` through the worker's
 * own registry, then streamed by that format's adapter. Nothing here is a
 * hand-built fact, so a staging test over these streams is a test over what
 * S01/S04/S05's adapters actually emit.
 */

import { readdir } from "node:fs/promises";
import type { ContainerHandleV1, WorkbookFactStreamItemV2, WorkbookFormatV1 } from "../../../src/import/facts/index.js";
import { preflightWorkbook, type WorkbookPreflightReportV1 } from "../../../src/import/preflight/workbook.js";
import { isBoundExceeded, type UnreadableDetailV1 } from "../../../src/import/source/bounds.js";
import { openCfbContainer } from "../../../src/import/source/cfb.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import type { RandomAccessSource } from "../../../src/import/source/source.js";
import { openZipContainer } from "../../../src/import/source/zip.js";
import { WORKBOOK_REGISTRY } from "../../../src/workers/import/adapters.js";
import { fixtureSource } from "../import/fixtures.js";

export const WORKBOOK_FIXTURE_DIRECTORIES = Object.freeze(["ooxml", "xlsb", "biff", "ods", "html-table"] as const);

const WORKBOOK_EXTENSIONS = /\.(xlsx|xlsm|xlsb|xls|ods|html?)$/i;

export const containerOf = async (format: WorkbookFormatV1, source: RandomAccessSource): Promise<ContainerHandleV1> => {
  switch (format) {
    case "xlsx":
    case "xlsb":
    case "ods":
      return { kind: "zip", zip: await openZipContainer(source) };
    case "xls":
      return { kind: "cfb", cfb: await openCfbContainer(source) };
    case "html-table":
      return { kind: "text", source };
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
};

export interface WorkbookStreamV1 {
  readonly path: string;
  readonly report: WorkbookPreflightReportV1;
  readonly items: readonly WorkbookFactStreamItemV2[];
  /** The bound the adapter hit mid-stream (a hostile body its metadata hid); `null` when it completed. */
  readonly failure: UnreadableDetailV1 | null;
}

/**
 * Streams the selected sheets (default: pre-flight's default selection) of a
 * readable fixture, or returns `null` for one pre-flight refuses. A bound hit
 * mid-stream ends the stream with its detail, as the worker would report it.
 */
export async function streamWorkbookFixture(
  path: string,
  options: { readonly selection?: readonly number[]; readonly factsPerBatch?: number } = {},
): Promise<WorkbookStreamV1 | null> {
  const source = await fixtureSource(path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const outcome = await preflightWorkbook(source, await sniffContent(source, name), WORKBOOK_REGISTRY.readers);
  if (outcome.kind === "refused") return null;
  const { report } = outcome;
  const adapter = WORKBOOK_REGISTRY.adapters.get(report.format);
  if (adapter === undefined) throw new Error(`no adapter is registered for ${report.format}`);
  const container = await containerOf(report.format, source);
  const items: WorkbookFactStreamItemV2[] = [];
  const cancellation = { aborted: false };
  try {
    for await (const item of adapter.parseSheets(
      container,
      options.selection ?? report.defaultSelection,
      options.factsPerBatch === undefined ? { cancellation } : { cancellation, factsPerBatch: options.factsPerBatch },
    )) {
      items.push(item);
    }
  } catch (cause) {
    if (!isBoundExceeded(cause)) throw cause;
    return { path, report, items, failure: cause.detail };
  }
  return { path, report, items, failure: null };
}

/** Every workbook fixture file of one adapter's corpus directory. */
export async function workbookFixturePaths(directory: string): Promise<readonly string[]> {
  const names = await readdir(`tests/fixtures/workbooks/${directory}`);
  return names.filter((name) => WORKBOOK_EXTENSIONS.test(name)).sort().map((name) => `${directory}/${name}`);
}
