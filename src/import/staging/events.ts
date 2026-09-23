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
 * text, or an integer. A table or field is written by the checkpoint's own
 * encoders (`roots.ts`), so a computed field's `formulaId` (D51) is carried
 * wherever the field is, and an authored field's bytes are the F03 bytes. Nothing here is a float, a `Date`, or an object with a
 * prototype: a payload has to survive canonical encode/decode byte-identically
 * or the commit hash it is folded into stops meaning anything.
 */

import type {
  AppThemeV1,
  InferenceDispositionV1,
} from "../../domain/model/events.js";
import type { FieldId, LineageId } from "../../domain/model/ids.js";
import type { StorageId16 } from "../../domain/model/bytes.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  RelationshipDefV1,
  TableDefV1,
} from "../../domain/model/schema.js";
import type { SheetDescriptorV1 } from "../../domain/model/snapshots.js";
import type { CborValue } from "../../persistence/codecs/canonical-cbor.js";
import type { WorkbookStatementV1 } from "../inference/statements.js";
import type { ProposedWorkbookV1 } from "../inference/workbook-proposal.js";
import { cborMap } from "./proposal-codec.js";
import { encodeAppTheme, encodeFieldDef, encodeRelationship, encodeSheetDescriptor, encodeTableDef } from "./roots.js";
import { encodeWorkbookEvidence, encodeWorkbookStatement } from "./workbook-proposal-codec.js";

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
 * without the rows. The rows are in the checkpoint and the snapshots; a copy
 * inside an immutable event would be a third representation to keep true.
 * Each imported sheet names its snapshot, so every sheet's snapshot is
 * reachable from the ledger as well as from the head.
 */
const evidenceLedger = (
  proposal: ProposedWorkbookV1,
  sheetSnapshots: readonly { readonly sheetKey: string; readonly snapshotManifestStorageId: StorageId16 }[],
): CborValue =>
  cborMap([
    ["fileName", proposal.fileName],
    ["appName", proposal.appName],
    [
      "sheets",
      proposal.sheets.map((sheet) =>
        cborMap([
          ["sheetKey", sheet.sheetKey],
          ["name", sheet.name],
          ["isSelected", sheet.isSelected],
          ["classification", [...sheet.classification]],
          [
            "snapshotManifestStorageId",
            sheetSnapshots.find((entry) => entry.sheetKey === sheet.sheetKey)?.snapshotManifestStorageId ?? null,
          ],
        ]),
      ),
    ],
    [
      "tables",
      proposal.tables.map((table) =>
        cborMap([
          ["tableKey", table.tableKey],
          ["tableName", table.tableName],
          ["headerRowIndex", table.headerRowIndex],
          ["rowCount", table.rowCount],
          ["discardedRowCount", table.discardedRowCount],
          ["joinedToTableKey", table.joinedToTableKey],
        ]),
      ),
    ],
    ["statements", proposal.statements.map(encodeWorkbookStatement)],
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

/**
 * A decision's statement and evidence as `inference-decision.recorded` carries
 * them and the checkpoint's decision list repeats them: the same values, so
 * the materialized decision and its authority cannot disagree.
 */
export const decisionStatement = (statement: WorkbookStatementV1): CborValue => encodeWorkbookStatement(statement);
export const decisionEvidence = (statement: WorkbookStatementV1): CborValue =>
  statement.evidence.map(encodeWorkbookEvidence);

export const encodeImportEventPayload = {
  appCreated(payload: {
    readonly displayName: string;
    readonly tables: readonly TableDefV1[];
    readonly enumOptions: readonly EnumOptionDefV1[];
    readonly relationships: readonly RelationshipDefV1[];
    readonly theme: AppThemeV1;
    readonly importLineageId: LineageId;
    readonly schemaRevision: bigint;
  }): CborValue {
    return cborMap([
      ["displayName", payload.displayName],
      ["tables", payload.tables.map(encodeTableDef)],
      ["enumOptions", payload.enumOptions.map(enumOption)],
      ["relationships", payload.relationships.map(encodeRelationship)],
      ["theme", encodeAppTheme(payload.theme)],
      ["importLineageId", payload.importLineageId],
      ["schemaRevision", payload.schemaRevision],
    ]);
  },

  /**
   * The table and its sheet's whole descriptor (D38's "source provenance"),
   * so a tail that creates a table can build its sheet row too (CA-23).
   */
  tableCreated(payload: {
    readonly table: TableDefV1;
    readonly sourceSheet: SheetDescriptorV1;
  }): CborValue {
    return cborMap([
      ["table", encodeTableDef(payload.table)],
      ["sourceSheetId", payload.sourceSheet.sheetId],
      ["sourceSheet", encodeSheetDescriptor(payload.sourceSheet)],
    ]);
  },

  fieldCreated(payload: {
    readonly field: FieldDefV1;
    /** Which review statement explains this field's type, when one does. */
    readonly statementId: string | null;
  }): CborValue {
    return cborMap([
      ["field", encodeFieldDef(payload.field)],
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
    readonly statement: WorkbookStatementV1;
    readonly disposition: InferenceDispositionV1;
  }): CborValue {
    return cborMap([
      ["evidenceFingerprint", payload.evidenceFingerprint],
      ["statement", decisionStatement(payload.statement)],
      ["evidence", decisionEvidence(payload.statement)],
      ["disposition", payload.disposition],
    ]);
  },

  importAccepted(payload: {
    readonly lineageId: LineageId;
    readonly sourceManifestStorageId: StorageId16;
    readonly snapshotManifestStorageId: StorageId16;
    readonly checkpointManifestStorageId: StorageId16;
    readonly originalBaselineStorageId: StorageId16;
    readonly proposal: ProposedWorkbookV1;
    readonly sheetSnapshots: readonly { readonly sheetKey: string; readonly snapshotManifestStorageId: StorageId16 }[];
    readonly acceptedSchemaRevision: bigint;
  }): CborValue {
    return cborMap([
      ["lineageId", payload.lineageId],
      ["sourceManifestStorageId", payload.sourceManifestStorageId],
      ["snapshotManifestStorageId", payload.snapshotManifestStorageId],
      ["checkpointManifestStorageId", payload.checkpointManifestStorageId],
      ["originalBaselineStorageId", payload.originalBaselineStorageId],
      ["evidenceLedger", evidenceLedger(payload.proposal, payload.sheetSnapshots)],
      ["acceptedSchemaRevision", payload.acceptedSchemaRevision],
    ]);
  },
} as const;
