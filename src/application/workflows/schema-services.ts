/**
 * The machine-facing edge of the structure column (M36 → M32; CAP-35, CA-28).
 *
 * Like the records and charts adapters there is no machine: reading the
 * structure, previewing a change and applying it are three request/response
 * pairs, and the only thing to remember between the last two — the revision
 * the preview counted at — is a value the caller holds, not a state.
 *
 * Every refusal stays a result: `stale-preview`, `refused`, `too-large` and
 * `unknown-app` come back as the outcome S03 sent, for the view model to say.
 */

import type {
  ApplySchemaChangeResponseV1,
  GetAppStructureResponseV1,
  PreviewSchemaChangeResponseV1,
  SchemaChangeWireV1,
} from "../../workers/protocol/messages.js";
import type { RecordsWorkerPort } from "./records-services.js";

export interface SchemaServices {
  /** SCR-035's read: tables, fields, rules, relationships and formulas in current names. */
  readonly getAppStructure: (input: { readonly appId: string }) => Promise<GetAppStructureResponseV1>;
  /** MOD-014's exact counts for one change, at the revision it names. */
  readonly previewSchemaChange: (input: {
    readonly appId: string;
    readonly change: SchemaChangeWireV1;
  }) => Promise<PreviewSchemaChangeResponseV1>;
  /** Applies a previewed change; the worker refuses it if the revision moved. */
  readonly applySchemaChange: (input: {
    readonly appId: string;
    readonly change: SchemaChangeWireV1;
    readonly previewedSchemaRevision: number;
  }) => Promise<ApplySchemaChangeResponseV1>;
}

export function createSchemaServices(port: RecordsWorkerPort): SchemaServices {
  return {
    getAppStructure: ({ appId }) => port.send({ kind: "getAppStructure", appId }),
    previewSchemaChange: ({ appId, change }) => port.send({ kind: "previewSchemaChange", appId, change }),
    applySchemaChange: ({ appId, change, previewedSchemaRevision }) =>
      port.send({ kind: "applySchemaChange", appId, change, previewedSchemaRevision }),
  };
}
