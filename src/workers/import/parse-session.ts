/**
 * The import worker's pipeline driver (M33).
 *
 * It exists beside `import.worker.ts` rather than inside it so the whole
 * run — sniff, size, refuse or parse, stream, cancel — is unit-testable
 * without spawning a worker, the same split `data/handlers.ts` uses.
 *
 * **Routing (D35, D48).** Content decides the format, never the name: PDF,
 * iWork, binary and unrecognised containers are refused as in F02; delimited
 * text is sized by `preflightDelimited`; a workbook container (CFB, OOXML/ODS
 * zip, HTML table) is sized by `preflightWorkbook` through this worker's
 * registry (`adapters.ts`) — but only for a page that accepts the `workbook`
 * flow. Any other page gets F02's `workbook-format-later-release`, which is
 * still the only thing a delimited-only surface can render.
 *
 * **Backpressure is a `await`.** Every batch is sent and then waited on: the
 * generator does not advance until the data worker's `{ackSeq}` arrives, so
 * "batch n + 1 is not sent before ack n" is the control flow rather than a
 * rule about it. A `nack` or a closed channel ends the run instead of
 * retrying, because the stage that refused the batch is the only thing that
 * could have held it.
 *
 * **Cancellation is cooperative and checked between batches.** An adapter
 * never abandons a half-emitted row, and a cancelled run ends *without* a
 * terminal summary — which is precisely the signal inference refuses to guess
 * past. Only the selected sheets of a workbook are ever read (D39).
 */

import type {
  CancellationTokenV1,
  ContainerHandleV1,
  WorkbookFactStreamItemV2,
  WorkbookFormatV1,
} from "../../import/facts/index.js";
import { parseDelimited } from "../../import/formats/delimited/parse.js";
import { IMPORT_BUDGET_V1 } from "../../import/preflight/budgets.js";
import {
  isDelimitedSniff,
  preflightDelimited,
  type DelimitedSniffV1,
  type PreflightReportV1,
} from "../../import/preflight/preflight.js";
import {
  classifyRefusal,
  laterReleaseRefusal,
  unreadable,
  type RefusalV1,
} from "../../import/preflight/refusal.js";
import { preflightWorkbook, type WorkbookPreflightReportV1 } from "../../import/preflight/workbook.js";
import { isBoundExceeded } from "../../import/source/bounds.js";
import { openCfbContainer } from "../../import/source/cfb.js";
import { sniffContent, type SniffResultV1 } from "../../import/source/sniff.js";
import { MAX_SLICE_BYTES, blobSource, type RandomAccessSource } from "../../import/source/source.js";
import { openZipContainer } from "../../import/source/zip.js";
import type {
  ImportFailureDetailV1,
  ImportFlowV1,
  ImportWorkerEventV1,
  ImportWorkerPhaseV1,
} from "../protocol/import-messages.js";
import {
  isStageChannelOutboundV1,
  stageAbort,
  stageBatch,
  stageSource,
  type StageChannelOutboundV1,
} from "../protocol/stage-channel.js";
import { WORKBOOK_REGISTRY, type WorkbookRegistryV1 } from "./adapters.js";

export type EmitEvent = (event: ImportWorkerEventV1) => void;

export type PreflightOutcomeForRunV1 =
  | {
      readonly kind: "proceed";
      readonly sniff: DelimitedSniffV1;
      readonly report: PreflightReportV1;
      readonly source: RandomAccessSource;
    }
  | {
      readonly kind: "workbook";
      readonly sniff: SniffResultV1;
      readonly report: WorkbookPreflightReportV1;
      readonly source: RandomAccessSource;
    }
  | { readonly kind: "refused"; readonly refusal: RefusalV1 };

/**
 * Sniffs and sizes one file. A delimited file reads at most the sniff sample
 * plus pre-flight's 64 KiB window; a workbook reads its container's metadata
 * and never a cell part or record (CA-18). Nothing is staged here.
 */
export async function preflightFile(
  file: Blob,
  fileName: string,
  emit: EmitEvent,
  acceptedFlows: readonly ImportFlowV1[] = ["delimited"],
  registry: WorkbookRegistryV1 = WORKBOOK_REGISTRY,
): Promise<PreflightOutcomeForRunV1> {
  const source = blobSource(file);

  emit(progress("sniffing", 0, 0));
  const sniff = await sniffContent(source, fileName);

  const refusal = classifyRefusal(sniff);
  if (refusal !== null) {
    return { kind: "refused", refusal };
  }

  if (isDelimitedSniff(sniff)) {
    emit(progress("sizing", 0, 0));
    const outcome = await preflightDelimited(source, sniff);
    return outcome.kind === "refused"
      ? { kind: "refused", refusal: outcome.refusal }
      : { kind: "proceed", sniff, report: outcome.report, source };
  }

  if (!acceptedFlows.includes("workbook")) {
    // D48: this page renders no workbook flow, so the F02 truth stands. A
    // container `classifyRefusal` let through is always a workbook family,
    // so the fallback is unreachable; it fails closed rather than parsing.
    return {
      kind: "refused",
      refusal: laterReleaseRefusal(sniff) ?? unreadable(fileName, "unrecognized-content"),
    };
  }

  emit(progress("sizing", 0, 0));
  const outcome = await preflightWorkbook(source, sniff, registry.readers);
  return outcome.kind === "refused"
    ? { kind: "refused", refusal: outcome.refusal }
    : { kind: "workbook", sniff, report: outcome.report, source };
}

/**
 * The selected sheets a workbook `proceed` may carry, normalised ascending, or
 * `null` when the selection is not one the report allows: empty, naming a
 * sheet the inventory does not have, or over the estimated-cell budget
 * (D31). A `handoff` report allows none — no sheet fits this device.
 */
export function acceptedSelection(
  report: WorkbookPreflightReportV1,
  selection: readonly number[] | undefined,
): readonly number[] | null {
  if (selection === undefined || selection.length === 0 || report.route === "handoff") return null;
  const unique = [...new Set(selection)].sort((left, right) => left - right);
  if (unique.length !== selection.length) return null;
  let cells = 0;
  for (const index of unique) {
    const sheet = report.sheets.find((candidate) => candidate.sheetIndex === index);
    if (sheet === undefined) return null;
    cells += sheet.estimatedCellCount ?? 0;
  }
  return cells <= report.budgets.maxEstimatedCells && cells <= IMPORT_BUDGET_V1.maxEstimatedCells ? unique : null;
}

interface SheetProgressV1 {
  readonly sheetOrdinal: number;
  readonly sheetCount: number;
  readonly sheetName: string;
}

const progress = (
  phase: ImportWorkerPhaseV1,
  rowsSoFar: number,
  batchesAcked: number,
  sheet: SheetProgressV1 | null = null,
): ImportWorkerEventV1 => ({
  kind: "progress",
  phase,
  currentAction: phase,
  rowsSoFar,
  batchesAcked,
  ...(sheet ?? {}),
});

/** One ack, or the reason there will not be one. */
type AckOutcome = { readonly ok: true } | { readonly ok: false };

/**
 * Waits for the ack of `seq`. An out-of-order ack is a protocol violation and
 * ends the run: the channel guarantees one ack per batch, in order, so a
 * mismatch means the two ends disagree about what is durable.
 */
function awaitAck(port: MessagePort, seq: number): Promise<AckOutcome> {
  return new Promise<AckOutcome>((resolve) => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isStageChannelOutboundV1(event.data)) {
        return;
      }
      const message: StageChannelOutboundV1 = event.data;
      port.removeEventListener("message", onMessage);
      resolve({ ok: message.kind === "ack" && message.ackSeq === seq });
    };
    port.addEventListener("message", onMessage);
  });
}

export interface StreamFactsResultV1 {
  readonly outcome: "completed" | "cancelled" | "stage-rejected" | "parse-failed";
  readonly batchesSent: number;
  readonly rowsSoFar: number;
  /** Where a failed run stopped; `null` for a completed or cancelled one. */
  readonly detail: ImportFailureDetailV1 | null;
}

/** `field-log-messy` from `field-log-messy.csv`: the one sheet a delimited file is. */
export const fileStemOf = (fileName: string): string =>
  fileName.replace(/\.[^.]*$/, "") || fileName;

interface SendItemsInputV1 {
  readonly items: AsyncIterable<WorkbookFactStreamItemV2>;
  readonly port: MessagePort;
  readonly emit: EmitEvent;
  /** The selected sheets, for a workbook: progress then names the sheet being read. */
  readonly selection: readonly number[] | null;
}

/**
 * Sends a fact stream to the data worker, one acked batch at a time — the one
 * loop both flows share. The terminal summary is sent like any other item and
 * is acked like one, so "the stage holds every fact the parser produced" is
 * durable before the run reports completion.
 */
async function sendItems(input: SendItemsInputV1): Promise<StreamFactsResultV1> {
  const { items, port, emit, selection } = input;
  // A `MessagePort` only begins delivering once it is started, and
  // `addEventListener` — unlike assigning `onmessage` — does not start it
  // implicitly. Without this the first ack never arrives and the parser waits
  // forever, which is the one failure mode backpressure can turn into a hang.
  port.start();
  let seq = 0;
  let rowsSoFar = 0;
  let sawSummary = false;
  let sheet: SheetProgressV1 | null = null;

  const failed = (stage: ImportFailureDetailV1["stage"], diagnostic: ImportFailureDetailV1["diagnostic"]) => ({
    detail: { stage, sheetOrdinal: sheet?.sheetOrdinal ?? null, diagnostic },
    batchesSent: seq,
    rowsSoFar,
  });

  try {
    for await (const item of items) {
      // A batch may open several small sheets; each is named once it is durable.
      const opened: SheetProgressV1[] = [];
      if (item.kind === "batch") {
        for (const fact of item.facts) {
          if (fact.kind === "row") {
            rowsSoFar += 1;
          } else if (fact.kind === "sheet" && selection !== null) {
            opened.push({
              sheetOrdinal: selection.indexOf(fact.sheetIndex) + 1,
              sheetCount: selection.length,
              sheetName: fact.name,
            });
          }
        }
      } else {
        sawSummary = true;
        rowsSoFar = item.rowCount;
      }

      const pending = awaitAck(port, seq);
      port.postMessage(stageBatch(seq, item));
      if (!(await pending).ok) {
        port.postMessage(stageAbort("failed"));
        return { outcome: "stage-rejected", ...failed("stage", "parse-failed") };
      }
      seq += 1;
      for (const each of opened.slice(0, -1)) emit(progress("parsing", rowsSoFar, seq, each));
      sheet = opened.at(-1) ?? sheet;
      emit(progress("parsing", rowsSoFar, seq, sheet));
    }
  } catch (cause) {
    port.postMessage(stageAbort("failed"));
    return {
      outcome: "parse-failed",
      ...failed("sheet-stream", isBoundExceeded(cause) ? cause.detail : "parse-failed"),
    };
  }

  if (!sawSummary) {
    // The parser stopped without a summary: that absence *is* the cancel
    // signal. Nothing synthesises one, here or anywhere.
    port.postMessage(stageAbort("cancelled"));
    return { outcome: "cancelled", batchesSent: seq, rowsSoFar, detail: null };
  }

  emit(progress("done", rowsSoFar, seq, sheet));
  return { outcome: "completed", batchesSent: seq, rowsSoFar, detail: null };
}

export interface StreamFactsInputV1 {
  readonly source: RandomAccessSource;
  readonly sniff: DelimitedSniffV1;
  readonly port: MessagePort;
  readonly cancellation: CancellationTokenV1;
  readonly emit: EmitEvent;
}

/** Streams a delimited file: its one sheet, opened with its `sheet` fact. */
export function streamFacts(input: StreamFactsInputV1): Promise<StreamFactsResultV1> {
  const { source, sniff, port, cancellation, emit } = input;
  return sendItems({
    items: parseDelimited(source, sniff.format, {
      cancellation,
      sheetName: fileStemOf(sniff.declaredName),
    }),
    port,
    emit,
    selection: null,
  });
}

/** The container the report's format lives in, opened again for the parse. */
export async function openContainer(format: WorkbookFormatV1, source: RandomAccessSource): Promise<ContainerHandleV1> {
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
}

export interface StreamWorkbookInputV1 {
  readonly source: RandomAccessSource;
  readonly report: WorkbookPreflightReportV1;
  readonly selection: readonly number[];
  readonly port: MessagePort;
  readonly cancellation: CancellationTokenV1;
  readonly emit: EmitEvent;
  readonly registry?: WorkbookRegistryV1;
}

/**
 * Streams the selected sheets of a workbook through its format's adapter, in
 * workbook order. A container that no longer opens, or a sheet body that hits
 * a bound its metadata hid, ends the run with that closed detail.
 */
export async function streamWorkbookFacts(input: StreamWorkbookInputV1): Promise<StreamFactsResultV1> {
  const { source, report, selection, port, cancellation, emit } = input;
  const adapter = (input.registry ?? WORKBOOK_REGISTRY).adapters.get(report.format);
  let container: ContainerHandleV1;
  try {
    if (adapter === undefined) throw new Error("no adapter is registered for this format");
    container = await openContainer(report.format, source);
  } catch (cause) {
    port.start();
    port.postMessage(stageAbort("failed"));
    return {
      outcome: "parse-failed",
      batchesSent: 0,
      rowsSoFar: 0,
      detail: {
        stage: "container",
        sheetOrdinal: null,
        diagnostic: isBoundExceeded(cause) ? cause.detail : "parse-failed",
      },
    };
  }
  return sendItems({
    items: adapter.parseSheets(container, selection, { cancellation }),
    port,
    emit,
    selection,
  });
}

/**
 * Streams the original file for retention (D21), in slices no larger than the
 * source's own 1 MiB read bound — so the file is never in memory whole here
 * either. Acked like a batch, for the same reason: the data worker commits
 * each slice before asking for the next.
 */
export async function streamSource(
  input: {
    readonly source: RandomAccessSource;
    readonly port: MessagePort;
    readonly startSeq: number;
    readonly cancellation: CancellationTokenV1;
  },
): Promise<{ readonly ok: boolean; readonly nextSeq: number }> {
  const { source, port, cancellation } = input;
  let seq = input.startSeq;
  let sequence = 0;

  for (let offset = 0; offset < source.byteLength; offset += MAX_SLICE_BYTES) {
    if (cancellation.aborted) {
      return { ok: false, nextSeq: seq };
    }
    const bytes = await source.slice(
      offset,
      Math.min(MAX_SLICE_BYTES, source.byteLength - offset),
    );
    const pending = awaitAck(port, seq);
    port.postMessage(stageSource(seq, sequence, bytes));
    if (!(await pending).ok) {
      return { ok: false, nextSeq: seq };
    }
    seq += 1;
    sequence += 1;
  }
  return { ok: true, nextSeq: seq };
}
