/**
 * CA-24 / CA-18 at the import worker's pipeline driver, without a browser:
 * routing by accepted flows (D48), workbook pre-flight through the real
 * registry, selection validation, and ack-gated streaming of the selected
 * sheets over a real `MessageChannel` whose far end acks like the data worker.
 * The browser leg (`tests/browser/worker/workbook-staging.spec.ts`) runs the
 * same driver inside the real import worker.
 */

import { describe, expect, it } from "vitest";
import type { ImportWorkerEventV1 } from "../../../src/workers/protocol/import-messages.js";
import {
  isStageChannelInboundV1,
  stageAck,
  type StageChannelInboundV1,
} from "../../../src/workers/protocol/stage-channel.js";
import {
  acceptedSelection,
  preflightFile,
  streamWorkbookFacts,
  type PreflightOutcomeForRunV1,
} from "../../../src/workers/import/parse-session.js";
import { blobSource } from "../../../src/import/source/source.js";
import { fixtureBytes } from "../import/fixtures.js";

const fileOf = async (path: string): Promise<Blob> => new Blob([Uint8Array.from(await fixtureBytes(path))]);

const preflightOf = async (
  path: string,
  name: string,
  flows?: readonly ("delimited" | "workbook")[],
): Promise<{ outcome: PreflightOutcomeForRunV1; events: ImportWorkerEventV1[] }> => {
  const events: ImportWorkerEventV1[] = [];
  const outcome = await preflightFile(await fileOf(path), name, (event) => events.push(event), flows);
  return { outcome, events };
};

const workbookReport = async (path: string, name: string) => {
  const { outcome } = await preflightOf(path, name, ["delimited", "workbook"]);
  if (outcome.kind !== "workbook") throw new Error(`${path} did not size as a workbook`);
  return outcome;
};

/** The data worker's end of the channel: acks every batch in order, records what it saw. */
const ackingPeer = (port: MessagePort): StageChannelInboundV1[] => {
  const received: StageChannelInboundV1[] = [];
  port.onmessage = (event: MessageEvent<unknown>) => {
    if (!isStageChannelInboundV1(event.data)) return;
    received.push(event.data);
    if (event.data.kind === "batch") port.postMessage(stageAck(event.data.seq));
  };
  return received;
};

describe("routing by accepted flows (D48)", () => {
  it("refuses a workbook as a later release for a page that accepts only delimited files", async () => {
    for (const flows of [undefined, ["delimited"] as const]) {
      const { outcome } = await preflightOf("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx", flows);
      expect(outcome).toEqual({
        kind: "refused",
        refusal: {
          kind: "workbook-format-later-release",
          fileName: "fieldwork-q3.xlsx",
          remedy: "await-later-release",
          format: "ooxml",
        },
      });
    }
  });

  it("sizes the demo workbook from metadata when the page accepts workbooks", async () => {
    const { outcome, events } = await preflightOf("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx", [
      "delimited",
      "workbook",
    ]);
    expect(outcome.kind).toBe("workbook");
    if (outcome.kind !== "workbook") return;
    expect(outcome.report).toMatchObject({ format: "xlsx", route: "fits", isEstimate: true });
    expect(outcome.report.sheets.map((sheet) => sheet.name)).toEqual([
      "Jobs",
      "Customers",
      "Crew",
      "Visits",
      "Materials",
      "Overview",
      "Archive 2018",
    ]);
    expect(events.map((event) => (event.kind === "progress" ? event.phase : event.kind))).toEqual([
      "sniffing",
      "sizing",
    ]);
  });

  it("refuses macro content before any stage could exist, whatever the flows", async () => {
    const { outcome } = await preflightOf("unsafe/payroll.xlsm", "payroll.xlsm", ["delimited", "workbook"]);
    expect(outcome).toEqual({
      kind: "refused",
      refusal: { kind: "macro-content", fileName: "payroll.xlsm", remedy: "reupload-macro-free-copy" },
    });
  });

  it("keeps a delimited file on F02's path, flows or not", async () => {
    const { outcome } = await preflightOf("delimited/field-log-messy.csv", "field-log-messy.csv", [
      "delimited",
      "workbook",
    ]);
    expect(outcome.kind).toBe("proceed");
  });
});

describe("the selection a workbook proceed may carry", () => {
  it("accepts inventoried sheets within the budget, ascending", async () => {
    const { report } = await workbookReport("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
    expect(acceptedSelection(report, [5, 0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(acceptedSelection(report, [6])).toEqual([6]);
  });

  it("refuses an empty, duplicated, uninventoried, or over-budget selection", async () => {
    const { report } = await workbookReport("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
    expect(acceptedSelection(report, undefined)).toBeNull();
    expect(acceptedSelection(report, [])).toBeNull();
    expect(acceptedSelection(report, [0, 0])).toBeNull();
    expect(acceptedSelection(report, [0, 9])).toBeNull();
    const tight = { ...report, budgets: { ...report.budgets, maxEstimatedCells: 600 } };
    expect(acceptedSelection(tight, [0])).toBeNull();
    expect(acceptedSelection(tight, [1, 4])).toEqual([1, 4]);
    expect(acceptedSelection({ ...report, route: "handoff" }, [1])).toBeNull();
  });
});

describe("streaming the selected sheets", () => {
  it("sends only the selected sheets, ack-gated, naming each sheet in progress", async () => {
    const outcome = await workbookReport("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
    const channel = new MessageChannel();
    const received = ackingPeer(channel.port2);
    const events: ImportWorkerEventV1[] = [];

    const result = await streamWorkbookFacts({
      source: outcome.source,
      report: outcome.report,
      selection: [0, 1, 2, 3, 4, 5],
      port: channel.port1,
      cancellation: { aborted: false },
      emit: (event) => events.push(event),
    });
    channel.port1.close();

    expect(result).toMatchObject({ outcome: "completed", detail: null });
    const sheets = received.flatMap((message) =>
      message.kind === "batch" && message.batch.kind === "batch"
        ? message.batch.facts.flatMap((fact) => (fact.kind === "sheet" ? [fact.name] : []))
        : [],
    );
    expect(sheets).toEqual(["Jobs", "Customers", "Crew", "Visits", "Materials", "Overview"]);
    const named = events.flatMap((event) =>
      event.kind === "progress" && event.sheetName !== undefined
        ? [`${String(event.sheetOrdinal)}/${String(event.sheetCount)} ${event.sheetName}`]
        : [],
    );
    expect([...new Set(named)]).toEqual([
      "1/6 Jobs",
      "2/6 Customers",
      "3/6 Crew",
      "4/6 Visits",
      "5/6 Materials",
      "6/6 Overview",
    ]);
    const acked = events.flatMap((event) => (event.kind === "progress" ? [event.batchesAcked] : []));
    expect(acked).toEqual([...acked].sort((left, right) => left - right));
    expect(received.at(-1)).toMatchObject({ kind: "batch", batch: { kind: "summary" } });
  });

  it("ends with the sheet-stream detail when a body hits a bound its metadata hid", async () => {
    const outcome = await workbookReport("ods/hostile-repeat.ods", "hostile-repeat.ods");
    const channel = new MessageChannel();
    const received = ackingPeer(channel.port2);

    const result = await streamWorkbookFacts({
      source: outcome.source,
      report: outcome.report,
      selection: outcome.report.defaultSelection,
      port: channel.port1,
      cancellation: { aborted: false },
      emit: () => undefined,
    });
    // Let the abort land before the channel closes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    channel.port1.close();

    expect(result).toMatchObject({
      outcome: "parse-failed",
      // The bound hit before the adapter yielded a batch: which sheet it was
      // reading is not known, and is not guessed.
      detail: { stage: "sheet-stream", sheetOrdinal: null, diagnostic: "expansion-limit" },
    });
    expect(received.at(-1)).toEqual(expect.objectContaining({ kind: "abort", reason: "failed" }));
  });

  it("ends with the container detail when the container no longer opens", async () => {
    const outcome = await workbookReport("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
    const truncated = blobSource(new Blob([Uint8Array.from(await fixtureBytes("ooxml/fieldwork-q3.xlsx")).slice(0, 4096)]));
    const channel = new MessageChannel();
    ackingPeer(channel.port2);

    const result = await streamWorkbookFacts({
      source: truncated,
      report: outcome.report,
      selection: [0],
      port: channel.port1,
      cancellation: { aborted: false },
      emit: () => undefined,
    });
    channel.port1.close();

    expect(result).toMatchObject({
      outcome: "parse-failed",
      batchesSent: 0,
      detail: { stage: "container", sheetOrdinal: null },
    });
  });

  it("stops at a batch boundary on cancel and sends no summary", async () => {
    const outcome = await workbookReport("ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
    const channel = new MessageChannel();
    const received = ackingPeer(channel.port2);
    const cancellation = { aborted: false };

    const result = await streamWorkbookFacts({
      source: outcome.source,
      report: outcome.report,
      selection: [6],
      port: channel.port1,
      cancellation,
      emit: (event) => {
        if (event.kind === "progress" && event.batchesAcked >= 2) cancellation.aborted = true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    channel.port1.close();

    expect(result.outcome).toBe("cancelled");
    expect(received.some((message) => message.kind === "batch" && message.batch.kind === "summary")).toBe(false);
    expect(received.at(-1)).toEqual(expect.objectContaining({ kind: "abort", reason: "cancelled" }));
  });
});
