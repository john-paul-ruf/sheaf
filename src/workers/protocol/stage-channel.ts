/**
 * The fact channel between the import worker and the data worker (M32; D17;
 * architecture § Import Architecture Stage 2).
 *
 * **The page creates the channel and never sees a fact.** It makes one
 * `MessageChannel`, hands `port2` to the data worker in `beginImportStage`'s
 * transfer list and `port1` to the import worker in `startImport`'s, and then
 * has nothing more to do with it. Cell values therefore never enter the page's
 * heap, which is what keeps invariant 3 ("plaintext lives only in unlocked
 * workers") structural rather than careful.
 *
 * **Commit before ack.** The data worker encrypts a batch, commits it, and
 * only then posts `{ackSeq}`. The parser may not send batch `n + 1` until it
 * has read the ack for `n`, so the number of unpersisted facts in flight is
 * exactly one batch, on either side, at any moment (invariant 1; FR-3). That
 * is backpressure and durability with one mechanism instead of two.
 *
 * Sequence numbers are contiguous from zero. A gap means a lost batch, and a
 * lost batch is a failed import — never a shorter file.
 */

import type { WorkbookFactStreamItemV1 } from "../../import/formats/delimited/facts.js";

export const STAGE_CHANNEL_VERSION = 1;

/** import worker → data worker. One batch, or the terminal summary. */
export interface StageBatchMessageV1 {
  readonly channelVersion: typeof STAGE_CHANNEL_VERSION;
  readonly kind: "batch";
  readonly seq: number;
  readonly batch: WorkbookFactStreamItemV1;
}

/**
 * import worker → data worker: the parse stopped without a summary. Sent on
 * cancellation and on a parser failure, so the data worker learns the stage is
 * terminal instead of waiting forever for a summary that is not coming.
 *
 * An *absent* summary is the cancel signal (S03); this message is the courtesy
 * that makes the absence prompt rather than eventual.
 */
export interface StageAbortMessageV1 {
  readonly channelVersion: typeof STAGE_CHANNEL_VERSION;
  readonly kind: "abort";
  readonly reason: "cancelled" | "failed";
}

export type StageChannelInboundV1 = StageBatchMessageV1 | StageAbortMessageV1;

/** data worker → import worker. Sent only after the batch is durable. */
export interface StageAckMessageV1 {
  readonly channelVersion: typeof STAGE_CHANNEL_VERSION;
  readonly kind: "ack";
  readonly ackSeq: number;
}

/**
 * data worker → import worker: this batch did not commit, so the import is
 * over. The parser stops rather than sending into a stage that cannot hold
 * what it sends.
 */
export interface StageNackMessageV1 {
  readonly channelVersion: typeof STAGE_CHANNEL_VERSION;
  readonly kind: "nack";
  readonly ackSeq: number;
}

export type StageChannelOutboundV1 = StageAckMessageV1 | StageNackMessageV1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isChannelMessage = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && value["channelVersion"] === STAGE_CHANNEL_VERSION;

/** Structured clone delivers `unknown`; both ends parse rather than trust. */
export function isStageChannelInboundV1(
  value: unknown,
): value is StageChannelInboundV1 {
  if (!isChannelMessage(value)) {
    return false;
  }
  if (value["kind"] === "batch") {
    return Number.isSafeInteger(value["seq"]) && isRecord(value["batch"]);
  }
  return (
    value["kind"] === "abort" &&
    (value["reason"] === "cancelled" || value["reason"] === "failed")
  );
}

export function isStageChannelOutboundV1(
  value: unknown,
): value is StageChannelOutboundV1 {
  return (
    isChannelMessage(value) &&
    (value["kind"] === "ack" || value["kind"] === "nack") &&
    Number.isSafeInteger(value["ackSeq"])
  );
}

export const stageBatch = (
  seq: number,
  batch: WorkbookFactStreamItemV1,
): StageBatchMessageV1 => ({
  channelVersion: STAGE_CHANNEL_VERSION,
  kind: "batch",
  seq,
  batch,
});

export const stageAbort = (
  reason: StageAbortMessageV1["reason"],
): StageAbortMessageV1 => ({
  channelVersion: STAGE_CHANNEL_VERSION,
  kind: "abort",
  reason,
});

export const stageAck = (ackSeq: number): StageAckMessageV1 => ({
  channelVersion: STAGE_CHANNEL_VERSION,
  kind: "ack",
  ackSeq,
});

export const stageNack = (ackSeq: number): StageNackMessageV1 => ({
  channelVersion: STAGE_CHANNEL_VERSION,
  kind: "nack",
  ackSeq,
});
