/**
 * The import worker's pipeline driver (M33).
 *
 * It exists beside `import.worker.ts` rather than inside it so the whole
 * run — sniff, size, refuse or parse, stream, cancel — is unit-testable
 * without spawning a worker, the same split `data/handlers.ts` uses.
 *
 * **Backpressure is a `await`.** Every batch is sent and then waited on: the
 * generator does not advance until the data worker's `{ackSeq}` arrives, so
 * "batch n + 1 is not sent before ack n" is the control flow rather than a
 * rule about it. A `nack` or a closed channel ends the run instead of
 * retrying, because the stage that refused the batch is the only thing that
 * could have held it.
 *
 * **Cancellation is cooperative and checked between batches.** The parser
 * never abandons a half-emitted row, and a cancelled run ends *without* a
 * terminal summary — which is precisely the signal S03's `inferProposal`
 * refuses to guess past.
 */

import type {
  CancellationTokenV1,
  WorkbookFactStreamItemV1,
} from "../../import/formats/delimited/facts.js";
import { parseDelimited } from "../../import/formats/delimited/parse.js";
import { sniffContent, type SniffResultV1 } from "../../import/source/sniff.js";
import {
  isDelimitedSniff,
  preflightDelimited,
  type PreflightReportV1,
} from "../../import/preflight/preflight.js";
import { classifyRefusal, type RefusalV1 } from "../../import/preflight/refusal.js";
import { blobSource, type RandomAccessSource } from "../../import/source/source.js";
import {
  isStageChannelOutboundV1,
  stageAbort,
  stageBatch,
  stageSource,
  type StageChannelOutboundV1,
} from "../protocol/stage-channel.js";
import { MAX_SLICE_BYTES } from "../../import/source/source.js";
import type {
  ImportWorkerEventV1,
  ImportWorkerPhaseV1,
} from "../protocol/import-messages.js";

export type EmitEvent = (event: ImportWorkerEventV1) => void;

export type PreflightOutcomeForRunV1 =
  | {
      readonly kind: "proceed";
      readonly sniff: SniffResultV1;
      readonly report: PreflightReportV1;
      readonly source: RandomAccessSource;
    }
  | { readonly kind: "refused"; readonly refusal: RefusalV1 };

/**
 * Sniffs and sizes one file. Reads at most the sniff sample plus pre-flight's
 * 64 KiB window — never the whole file — and decides only what content shows.
 */
export async function preflightFile(
  file: Blob,
  fileName: string,
  emit: EmitEvent,
): Promise<PreflightOutcomeForRunV1> {
  const source = blobSource(file);

  emit(progress("sniffing", 0, 0));
  const sniff = await sniffContent(source, fileName);

  const refusal = classifyRefusal(sniff);
  if (refusal !== null) {
    return { kind: "refused", refusal };
  }
  if (!isDelimitedSniff(sniff)) {
    // `classifyRefusal` returns null only for delimited, so this is
    // unreachable; it fails closed rather than parsing something unknown.
    return {
      kind: "refused",
      refusal: {
        kind: "binary-unreadable",
        fileName,
        remedy: "choose-another-file",
      },
    };
  }

  emit(progress("sizing", 0, 0));
  const outcome = await preflightDelimited(source, sniff);
  return outcome.kind === "refused"
    ? { kind: "refused", refusal: outcome.refusal }
    : { kind: "proceed", sniff, report: outcome.report, source };
}

const progress = (
  phase: ImportWorkerPhaseV1,
  rowsSoFar: number,
  batchesAcked: number,
): ImportWorkerEventV1 => ({
  kind: "progress",
  phase,
  currentAction: phase,
  rowsSoFar,
  batchesAcked,
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
}

export interface StreamFactsInputV1 {
  readonly source: RandomAccessSource;
  readonly sniff: SniffResultV1 & {
    readonly format: Extract<SniffResultV1["format"], { kind: "delimited" }>;
  };
  readonly port: MessagePort;
  readonly cancellation: CancellationTokenV1;
  readonly emit: EmitEvent;
}

/**
 * Streams the fact stream to the data worker, one acked batch at a time.
 *
 * The terminal summary is sent like any other item and is acked like one, so
 * "the stage holds every fact the parser produced" is durable before the run
 * reports completion.
 */
export async function streamFacts(
  input: StreamFactsInputV1,
): Promise<StreamFactsResultV1> {
  const { source, sniff, port, cancellation, emit } = input;
  // A `MessagePort` only begins delivering once it is started, and
  // `addEventListener` — unlike assigning `onmessage` — does not start it
  // implicitly. Without this the first ack never arrives and the parser waits
  // forever, which is the one failure mode backpressure can turn into a hang.
  port.start();
  let seq = 0;
  let rowsSoFar = 0;
  let sawSummary = false;

  const send = async (item: WorkbookFactStreamItemV1): Promise<boolean> => {
    const pending = awaitAck(port, seq);
    port.postMessage(stageBatch(seq, item));
    const ack = await pending;
    if (!ack.ok) {
      return false;
    }
    seq += 1;
    emit(progress("parsing", rowsSoFar, seq));
    return true;
  };

  try {
    for await (const item of parseDelimited(source, sniff.format, {
      cancellation,
    })) {
      if (item.kind === "batch") {
        rowsSoFar += item.facts.filter((fact) => fact.kind === "row").length;
      } else {
        sawSummary = true;
        rowsSoFar = item.rowCount;
      }

      if (!(await send(item))) {
        port.postMessage(stageAbort("failed"));
        return { outcome: "stage-rejected", batchesSent: seq, rowsSoFar };
      }
    }
  } catch {
    port.postMessage(stageAbort("failed"));
    return { outcome: "parse-failed", batchesSent: seq, rowsSoFar };
  }

  if (!sawSummary) {
    // The parser stopped without a summary: that absence *is* the cancel
    // signal (S03). Nothing synthesises one, here or anywhere.
    port.postMessage(stageAbort("cancelled"));
    return { outcome: "cancelled", batchesSent: seq, rowsSoFar };
  }

  emit(progress("done", rowsSoFar, seq));
  return { outcome: "completed", batchesSent: seq, rowsSoFar };
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
