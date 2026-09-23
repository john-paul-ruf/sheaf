/**
 * Page-side plumbing for the workbook column's browser suites (F03), beside
 * `runtime.ts` and in the same spirit: every step is the production path — the
 * real import worker (spawned by `src/bootstrap/import-worker.ts`), the page's
 * own `MessageChannel`, the real data worker — and nothing here parses,
 * encrypts, or reads a fact.
 *
 * {@link runWorkbookImport} drives one run exactly as S07's machine will: it
 * declares the flows the page accepts (D48), answers `workbook-preflight` with
 * a workbook `beginImportStage` carrying the inventory and the selection, and
 * says `proceed{selectedSheets}`. A delimited file still gets F02's answer.
 */

import type { Page } from "@playwright/test";
import type {
  ImportFlowV1,
  ImportWorkerEventV1,
} from "../../../src/workers/protocol/import-messages.js";

export interface WorkbookRunOptionsV1 {
  readonly flows?: readonly ImportFlowV1[];
  /** Sheet indexes to import; default: the report's default selection. */
  readonly selection?: readonly number[];
  readonly cancelAfterBatches?: number;
  readonly timeoutMs?: number;
  /** An existing app to add a delimited file to (D38); default: a new app. */
  readonly destinationAppId?: string;
}

export interface WorkbookRunV1 {
  readonly events: readonly ImportWorkerEventV1[];
  readonly stageId: string | null;
  /** Milliseconds from sending `cancelImport` to the parser's `cancelled`; `null` when not cancelled. */
  readonly cancelLatencyMs: number | null;
}

export async function runWorkbookImport(page: Page, options: WorkbookRunOptionsV1 = {}): Promise<WorkbookRunV1> {
  return page.evaluate(async (settings): Promise<WorkbookRunV1> => {
    const app = window.__sheafApp;
    const file = window.__sheafFixture;
    if (app === undefined || file === undefined) {
      throw new Error("the runtime or the fixture is missing");
    }
    const spawn = await window.__sheafHarness.module<typeof import("../../../src/bootstrap/import-worker.js")>(
      "/src/bootstrap/import-worker.ts",
    );
    const client = spawn.createImportWorkerClient();
    const events: ImportWorkerEventV1[] = [];
    let stageId: string | null = null;
    let cancelSentAt: number | null = null;
    let cancelLatencyMs: number | null = null;
    const destination =
      settings.destinationAppId === undefined
        ? undefined
        : ({ kind: "existing-app", appId: settings.destinationAppId } as const);

    // The page owns the channel and never reads from either port.
    const channel = new MessageChannel();

    const begin = async (request: Parameters<typeof app.client.send>[0], selectedSheets?: readonly number[]) => {
      const response = await app.client.send(request, [channel.port2]);
      if (response.kind !== "beginImportStage") throw new Error("beginImportStage did not answer");
      stageId = response.stageId;
      client.send(
        selectedSheets === undefined
          ? { kind: "proceed", stageId: response.stageId }
          : { kind: "proceed", stageId: response.stageId, selectedSheets },
      );
    };

    const terminal = new Promise<void>((resolve) => {
      client.on((event) => {
        events.push(event);
        if (event.kind === "progress" && settings.cancelAfterBatches !== undefined && cancelSentAt === null) {
          if (event.batchesAcked >= settings.cancelAfterBatches) {
            cancelSentAt = performance.now();
            client.send({ kind: "cancelImport" });
          }
        }
        if (event.kind === "cancelled" && cancelSentAt !== null) {
          cancelLatencyMs = performance.now() - cancelSentAt;
        }
        if (["refused", "completed", "cancelled", "failed"].includes(event.kind)) {
          resolve();
        }
        if (event.kind === "workbook-preflight") {
          const { report } = event;
          const selection = settings.selection ?? report.defaultSelection;
          void begin(
            {
              kind: "beginImportStage",
              fileName: file.name,
              detected: { kind: "workbook", format: report.format },
              preflight: {
                kind: "workbook",
                sheets: report.sheets.map((sheet) => ({
                  sheetIndex: sheet.sheetIndex,
                  name: sheet.name,
                  sheetKind: sheet.kind,
                  visibility: sheet.visibility,
                  estimatedRowCount: sheet.estimatedRowCount,
                  estimatedCellCount: sheet.estimatedCellCount,
                })),
                selectedSheets: [...selection],
                sourceByteLength: report.sourceByteLength,
                isEstimate: true,
              },
            },
            selection,
          );
        }
        if (event.kind === "preflight") {
          const detected = event.detected;
          if (detected.kind !== "delimited") throw new Error("a preflight event carried a workbook");
          void begin({
            kind: "beginImportStage",
            fileName: file.name,
            detected: {
              kind: "delimited",
              delimiter: detected.delimiter,
              encoding: detected.encoding,
              bomByteLength: detected.bomByteLength,
              newline: detected.newline,
            },
            preflight: {
              columnCount: event.report.columnCount,
              estimatedRowCount: event.report.estimatedRowCount,
              estimatedCellCount: event.report.estimatedCellCount,
              isEstimate: true,
              sampleRows: event.report.sampleRows.map((row) => [...row]),
              bytesSampled: event.report.bytesSampled,
              sourceByteLength: event.report.sourceByteLength,
            },
            ...(destination === undefined ? {} : { destination }),
          });
        }
      });
    });

    client.send(
      settings.flows === undefined
        ? { kind: "startImport", file, fileName: file.name }
        : { kind: "startImport", file, fileName: file.name, acceptedFlows: [...settings.flows] },
      [channel.port1],
    );
    await Promise.race([terminal, new Promise<void>((resolve) => setTimeout(resolve, settings.timeoutMs ?? 90_000))]);
    client.dispose();
    return { events, stageId, cancelLatencyMs };
  }, options);
}

/** Installs arbitrary bytes as the picked file (a fixture altered node-side). */
export async function installBytes(page: Page, bytes: Uint8Array, fileName: string): Promise<void> {
  await page.evaluate(
    ([content, name]) => {
      window.__sheafFixture = new File([Uint8Array.from(content)], name);
    },
    [[...bytes], fileName] as [readonly number[], string],
  );
}

/**
 * Where one zip entry lives, read from the central directory: its central
 * record, its local header, and the byte range of its compressed data.
 */
export function zipEntryLayout(
  bytes: Uint8Array,
  entryName: string,
): { readonly centralOffset: number; readonly localOffset: number; readonly start: number; readonly end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === entryName) {
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      return { centralOffset: cursor, localOffset, start, end: start + compressedSize };
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`no entry named ${entryName}`);
}

/**
 * Damages one entry so that only a *complete* read can tell: its declared
 * CRC-32 (central record and local header) no longer matches its bytes. A
 * metadata read that stops early never reaches the check; the parse does.
 */
export function corruptZipEntryCrc(bytes: Uint8Array, entryName: string): Uint8Array {
  const damaged = Uint8Array.from(bytes);
  const { centralOffset, localOffset } = zipEntryLayout(damaged, entryName);
  for (const at of [centralOffset + 16, localOffset + 14]) damaged[at] = (damaged[at] as number) ^ 0xff;
  return damaged;
}
