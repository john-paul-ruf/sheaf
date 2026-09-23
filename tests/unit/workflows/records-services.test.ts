/**
 * CA-21 / CA-22 consumer binding (M36): every F03 read is sent under S03's
 * wire name with S03's fields, and nothing else is added on the way past.
 */

import { describe, expect, it } from "vitest";
import {
  createRecordsServices,
  type RecordsWorkerPort,
} from "../../../src/application/workflows/records-services.js";
import type { DataWorkerRequestV1 } from "../../../src/workers/protocol/messages.js";

function recordingPort(): { readonly port: RecordsWorkerPort; readonly sent: DataWorkerRequestV1[] } {
  const sent: DataWorkerRequestV1[] = [];
  const port: RecordsWorkerPort = {
    send: (request) => {
      sent.push(request);
      return Promise.resolve({ kind: request.kind } as never);
    },
  };
  return { port, sent };
}

describe("the F03 reads (CA-21, CA-22)", () => {
  it("sends each request verbatim under its wire name", async () => {
    const { port, sent } = recordingPort();
    const services = createRecordsServices(port);

    await services.getRelatedRecords({ appId: "a", recordId: "r" });
    await services.getRelatedChildren({ appId: "a", relationshipId: "rel", parentRecordId: "p", after: 7, limit: 50 });
    await services.searchReferenceCandidates({ appId: "a", fieldId: "f", text: "har" });
    await services.getDeletedRecord({ appId: "a", recordId: "r" });
    await services.listTables({ appId: "a" });
    await services.listSheetSnapshots({ appId: "a" });
    await services.getSnapshotPage({ appId: "a", sheetId: "s", firstRow: 50, rowCount: 50 });
    await services.findInSnapshot({ appId: "a", sheetId: "s", text: "J-1055", afterRow: null });
    await services.listInertItems({ appId: "a", sheetId: null });

    expect(sent).toEqual([
      { kind: "getRelatedRecords", appId: "a", recordId: "r" },
      { kind: "getRelatedChildren", appId: "a", relationshipId: "rel", parentRecordId: "p", after: 7, limit: 50 },
      { kind: "searchReferenceCandidates", appId: "a", fieldId: "f", text: "har" },
      { kind: "getDeletedRecord", appId: "a", recordId: "r" },
      { kind: "listTables", appId: "a" },
      { kind: "listSheetSnapshots", appId: "a" },
      { kind: "getSnapshotPage", appId: "a", sheetId: "s", firstRow: 50, rowCount: 50 },
      { kind: "findInSnapshot", appId: "a", sheetId: "s", text: "J-1055", afterRow: null },
      { kind: "listInertItems", appId: "a", sheetId: null },
    ]);
  });

  it("authors a reference through the ordinary create command (SHT-002)", async () => {
    const { port, sent } = recordingPort();
    await createRecordsServices(port).createRecord({
      appId: "a",
      tableId: "t",
      values: [{ fieldId: "f", value: { kind: "reference", recordId: "r-c8" } }],
    });
    expect(sent).toEqual([
      {
        kind: "createRecord",
        appId: "a",
        tableId: "t",
        values: [{ fieldId: "f", value: { kind: "reference", recordId: "r-c8" } }],
      },
    ]);
  });
});
