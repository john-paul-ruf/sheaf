/**
 * The semantic payload ↔ canonical CBOR mapping for the commit promotion
 * writes (M23; CA-08 consumer, CA-11 producer).
 *
 * M09 carries `EventCommitV1.payload` as **opaque** canonical CBOR — it types
 * it `unknown` on purpose — so the author of a commit owns the meaning of what
 * it contains. Promotion is that author for the import commit, and this file
 * is the mapping.
 *
 * Everything a payload names is either a 16-byte domain ID, a 32-byte digest,
 * text, or an integer. Nothing here is a float, a `Date`, or an object with a
 * prototype: a payload has to survive canonical encode/decode byte-identically
 * or the commit hash it is folded into stops meaning anything.
 */

import type {
  AppThemeV1,
  InferenceDispositionV1,
} from "../../domain/model/events.js";
import type { FieldId, LineageId, SheetId } from "../../domain/model/ids.js";
import type { StorageId16 } from "../../domain/model/bytes.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../../domain/model/schema.js";
import type { CborValue } from "../../persistence/codecs/canonical-cbor.js";
import type { InferenceStatementV1 } from "../inference/statements.js";
import type { ProposedAppV1 } from "../inference/infer.js";
import { cborMap } from "./proposal-codec.js";
import { encodeAppTheme } from "./roots.js";
import { encodeStatement } from "./proposal-codec.js";

const fieldType = (type: FieldDefV1["type"]): CborValue =>
  type.kind === "currency"
    ? cborMap([
        ["kind", "currency"],
        ["currencyCode", type.currencyCode],
      ])
    : cborMap([["kind", type.kind]]);

const fieldDef = (definition: FieldDefV1): CborValue =>
  cborMap([
    ["fieldId", definition.fieldId],
    ["tableId", definition.tableId],
    ["displayName", definition.displayName],
    ["fieldOrdinal", definition.fieldOrdinal],
    ["type", fieldType(definition.type)],
    ["isRequired", definition.isRequired],
    ["isActive", definition.isActive],
    ["schemaRevision", definition.schemaRevision],
  ]);

const tableDef = (table: TableDefV1): CborValue =>
  cborMap([
    ["tableId", table.tableId],
    ["displayName", table.displayName],
    ["tableOrdinal", table.tableOrdinal],
    ["fields", table.fields.map(fieldDef)],
    ["keyFieldId", table.keyFieldId],
    ["labelFieldId", table.labelFieldId],
    ["sourceSheetId", table.sourceSheetId],
    ["isActive", table.isActive],
    ["schemaRevision", table.schemaRevision],
  ]);

const enumOption = (option: EnumOptionDefV1): CborValue =>
  cborMap([
    ["optionId", option.optionId],
    ["fieldId", option.fieldId],
    ["displayLabel", option.displayLabel],
    ["optionOrdinal", option.optionOrdinal],
    ["isActive", option.isActive],
    ["schemaRevision", option.schemaRevision],
  ]);

/**
 * The evidence ledger `import.accepted` carries: what was proposed and why,
 * without the rows. The rows are in the checkpoint and the snapshot; a copy
 * inside an immutable event would be a third representation to keep true.
 */
const evidenceLedger = (proposal: ProposedAppV1): CborValue =>
  cborMap([
    ["fileName", proposal.fileName],
    ["appName", proposal.appName],
    ["tableName", proposal.table.tableName],
    ["headerRowIndex", proposal.headerRowIndex === null ? null : proposal.headerRowIndex],
    ["rowCount", proposal.rowCount],
    ["discardedRowCount", proposal.discardedRowCount],
    ["statements", proposal.statements.map(encodeStatement)],
    [
      "diagnostics",
      proposal.diagnostics.map((diagnostic) =>
        cborMap([
          ["code", diagnostic.code],
          ["severity", diagnostic.severity],
          ["occurrences", diagnostic.occurrences],
        ]),
      ),
    ],
  ]);

export const encodeImportEventPayload = {
  appCreated(payload: {
    readonly displayName: string;
    readonly tables: readonly TableDefV1[];
    readonly enumOptions: readonly EnumOptionDefV1[];
    readonly theme: AppThemeV1;
    readonly importLineageId: LineageId;
    readonly schemaRevision: bigint;
  }): CborValue {
    return cborMap([
      ["displayName", payload.displayName],
      ["tables", payload.tables.map(tableDef)],
      ["enumOptions", payload.enumOptions.map(enumOption)],
      ["theme", encodeAppTheme(payload.theme)],
      ["importLineageId", payload.importLineageId],
      ["schemaRevision", payload.schemaRevision],
    ]);
  },

  tableCreated(payload: {
    readonly table: TableDefV1;
    readonly sourceSheetId: SheetId;
  }): CborValue {
    return cborMap([
      ["table", tableDef(payload.table)],
      ["sourceSheetId", payload.sourceSheetId],
    ]);
  },

  fieldCreated(payload: {
    readonly field: FieldDefV1;
    /** Which review statement explains this field's type, when one does. */
    readonly statementId: string | null;
  }): CborValue {
    return cborMap([
      ["field", fieldDef(payload.field)],
      ["evidence", payload.statementId],
    ]);
  },

  enumChanged(payload: {
    readonly fieldId: FieldId;
    readonly priorOptionSetSha256: Uint8Array | null;
    readonly options: readonly EnumOptionDefV1[];
  }): CborValue {
    return cborMap([
      ["fieldId", payload.fieldId],
      ["priorOptionSetSha256", payload.priorOptionSetSha256],
      ["options", payload.options.map(enumOption)],
    ]);
  },

  inferenceDecision(payload: {
    readonly evidenceFingerprint: Uint8Array;
    readonly statement: InferenceStatementV1;
    readonly disposition: InferenceDispositionV1;
  }): CborValue {
    return cborMap([
      ["evidenceFingerprint", payload.evidenceFingerprint],
      ["statement", encodeStatement(payload.statement)],
      ["evidence", payload.statement.evidence.length],
      ["disposition", payload.disposition],
    ]);
  },

  importAccepted(payload: {
    readonly lineageId: LineageId;
    readonly sourceManifestStorageId: StorageId16;
    readonly snapshotManifestStorageId: StorageId16;
    readonly checkpointManifestStorageId: StorageId16;
    readonly originalBaselineStorageId: StorageId16;
    readonly proposal: ProposedAppV1;
    readonly acceptedSchemaRevision: bigint;
  }): CborValue {
    return cborMap([
      ["lineageId", payload.lineageId],
      ["sourceManifestStorageId", payload.sourceManifestStorageId],
      ["snapshotManifestStorageId", payload.snapshotManifestStorageId],
      ["checkpointManifestStorageId", payload.checkpointManifestStorageId],
      ["originalBaselineStorageId", payload.originalBaselineStorageId],
      ["evidenceLedger", evidenceLedger(payload.proposal)],
      ["acceptedSchemaRevision", payload.acceptedSchemaRevision],
    ]);
  },
} as const;
