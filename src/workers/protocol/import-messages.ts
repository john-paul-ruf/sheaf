/**
 * The page ↔ import-worker contract (M32; D17).
 *
 * A second worker needs a second protocol, and it is deliberately *not* the
 * data worker's: this one carries a `Blob` and the data worker's carries none,
 * which is exactly why they are separate unions. `messages.ts` stays free of
 * every byte type — a grep asserts it — and the file's bytes ride here, where
 * they belong, from the page's file picker to the parser and no further.
 *
 * **The shape of a run.** The page creates the `MessageChannel` first, then:
 *
 * 1. `startImport` — carries the picked file and, in its **transfer list**,
 *    the channel's `port1`. The import worker sniffs and sizes, then stops.
 * 2. `refused` or `preflight` comes back. A refusal ends the run with no stage
 *    ever created (FR-2), which is what makes "no refusal leaves a partial
 *    app" structural.
 * 3. The page turns those facts into `beginImportStage` on the *data* worker,
 *    handing it `port2`, and gets a stage id.
 * 4. `proceed` — the page's "the stage exists, start streaming". The parser
 *    waits for it because facts sent before the stage existed would have
 *    nowhere durable to land, and buffering them in a worker would be the
 *    unbounded memory FR-3 forbids.
 * 5. `progress` events, then `completed`, `cancelled`, or `failed`.
 *
 * Progress is an **event**, not a response: it has no request to correlate to
 * and the page renders it as it arrives.
 */

import type { DetectedFormatV1, SniffResultV1 } from "../../import/source/sniff.js";
import type { PreflightReportV1 } from "../../import/preflight/preflight.js";
import type { RefusalV1 } from "../../import/preflight/refusal.js";

export const IMPORT_PROTOCOL_VERSION = 1;

// --- requests ---------------------------------------------------------------

/** `port1` of the page's channel travels in this request's transfer list. */
export interface StartImportRequestV1 {
  readonly kind: "startImport";
  readonly file: Blob;
  /** The declared name. Format is decided by content, never by this (FR-1). */
  readonly fileName: string;
}

export interface ProceedImportRequestV1 {
  readonly kind: "proceed";
  /** Echoed back on every later event so the page can correlate a run. */
  readonly stageId: string;
}

export interface CancelImportRequestV1 {
  readonly kind: "cancelImport";
}

export type ImportWorkerRequestV1 =
  | StartImportRequestV1
  | ProceedImportRequestV1
  | CancelImportRequestV1;

// --- events -----------------------------------------------------------------

export const IMPORT_PHASES_V1 = Object.freeze([
  "sniffing",
  "sizing",
  "waiting-for-stage",
  "parsing",
  "done",
] as const);

export type ImportWorkerPhaseV1 = (typeof IMPORT_PHASES_V1)[number];

/**
 * What SCR-020 renders while an import runs. `currentAction` is a closed
 * token, never a sentence: the user-language copy is the view model's (M37).
 */
export interface ImportProgressEventV1 {
  readonly kind: "progress";
  readonly phase: ImportWorkerPhaseV1;
  readonly rowsSoFar: number;
  readonly currentAction: ImportWorkerPhaseV1;
  /** Batches whose ack has come back — the durable count, not the sent one. */
  readonly batchesAcked: number;
}

export interface ImportPreflightEventV1 {
  readonly kind: "preflight";
  readonly detected: DetectedFormatV1;
  readonly declaredExtension: string | null;
  readonly contradiction: SniffResultV1["contradiction"];
  readonly report: PreflightReportV1;
}

export interface ImportRefusedEventV1 {
  readonly kind: "refused";
  readonly refusal: RefusalV1;
}

export interface ImportCompletedEventV1 {
  readonly kind: "completed";
  readonly rowCount: number;
  readonly batchesSent: number;
}

export interface ImportCancelledEventV1 {
  readonly kind: "cancelled";
  readonly batchesSent: number;
}

/**
 * A parse or channel failure. `reason` is a closed token and never a message:
 * a thrown error may name a file path or a cell, and neither may reach the
 * page (CA-12's redaction rule applies to this boundary too).
 */
export interface ImportFailedEventV1 {
  readonly kind: "failed";
  readonly reason: "parse-failed" | "stage-rejected" | "malformed-request";
}

export type ImportWorkerEventV1 =
  | ImportProgressEventV1
  | ImportPreflightEventV1
  | ImportRefusedEventV1
  | ImportCompletedEventV1
  | ImportCancelledEventV1
  | ImportFailedEventV1;

export type ImportWorkerEventKindV1 = ImportWorkerEventV1["kind"];

// --- envelopes --------------------------------------------------------------

export interface ImportWorkerRequestMessageV1 {
  readonly protocolVersion: typeof IMPORT_PROTOCOL_VERSION;
  readonly request: ImportWorkerRequestV1;
}

export interface ImportWorkerEventMessageV1 {
  readonly protocolVersion: typeof IMPORT_PROTOCOL_VERSION;
  readonly event: ImportWorkerEventV1;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasEnvelope = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && value["protocolVersion"] === IMPORT_PROTOCOL_VERSION;

export function isImportWorkerRequestMessageV1(
  value: unknown,
): value is ImportWorkerRequestMessageV1 {
  if (!hasEnvelope(value)) {
    return false;
  }
  const request: unknown = value["request"];
  return isRecord(request) && typeof request["kind"] === "string";
}

export function isImportWorkerEventMessageV1(
  value: unknown,
): value is ImportWorkerEventMessageV1 {
  if (!hasEnvelope(value)) {
    return false;
  }
  const event: unknown = value["event"];
  return isRecord(event) && typeof event["kind"] === "string";
}
