import { describe, expect, it } from "vitest";
import type { RecordsWorkerPort } from "../../../src/application/workflows/records-services.js";
import { createSchemaServices } from "../../../src/application/workflows/schema-services.js";
import type { DataWorkerRequestV1, SchemaChangeWireV1 } from "../../../src/workers/protocol/messages.js";

/**
 * The structure column's adapters (S06): each names its request and sends it
 * verbatim — the previewed revision included — adding nothing and deciding
 * nothing, and each refusal comes back as the result the worker sent.
 */

function recordingPort(answer: (request: DataWorkerRequestV1) => unknown = (request) => ({ kind: request.kind })): {
  readonly port: RecordsWorkerPort;
  readonly sent: DataWorkerRequestV1[];
} {
  const sent: DataWorkerRequestV1[] = [];
  const port: RecordsWorkerPort = {
    send: (request) => {
      sent.push(request);
      return Promise.resolve(answer(request) as never);
    },
  };
  return { port, sent };
}

const change: SchemaChangeWireV1 = { kind: "change-field-type", fieldId: "field-status", type: { kind: "enum" } };

describe("createSchemaServices", () => {
  it("sends each structure request exactly as named", async () => {
    const { port, sent } = recordingPort();
    const services = createSchemaServices(port);
    await services.getAppStructure({ appId: "app-1" });
    await services.previewSchemaChange({ appId: "app-1", change });
    await services.applySchemaChange({ appId: "app-1", change, previewedSchemaRevision: 7 });
    expect(sent).toEqual([
      { kind: "getAppStructure", appId: "app-1" },
      { kind: "previewSchemaChange", appId: "app-1", change },
      { kind: "applySchemaChange", appId: "app-1", change, previewedSchemaRevision: 7 },
    ]);
  });

  it("returns a stale-preview outcome as a result, not an exception", async () => {
    const { port } = recordingPort(() => ({ kind: "applySchemaChange", outcome: { result: "stale-preview", schemaRevision: 9 } }));
    const answered = await createSchemaServices(port).applySchemaChange({ appId: "app-1", change, previewedSchemaRevision: 7 });
    expect(answered.outcome).toEqual({ result: "stale-preview", schemaRevision: 9 });
  });
});
