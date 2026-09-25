import type { EnvelopePayloadKindV1, EnvelopeReferenceV1 } from "../../migrations/003_envelope_format_v1.js";
import type { FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import type { AppManifestV1, RetainedGenerationRootV1 } from "../../migrations/006_vault_format_v1.js";

export interface DeviceChainEvidenceV1 {
  readonly deviceId: Uint8Array;
  readonly commitSequence: bigint;
  readonly commitSha256: Uint8Array;
}
/** Captured by the worker graph exporter, never supplied by a page view model. */
export interface BackupSnapshotIdentityV1 {
  readonly appId: Uint8Array;
  readonly homeId: Uint8Array;
  readonly vaultId: Uint8Array;
  readonly generation: bigint;
  readonly confirmedFrontier: readonly FrontierEntryV1[];
  readonly candidateSha256: Uint8Array;
  readonly retainedGenerationRoots: readonly RetainedGenerationRootV1[];
  readonly retainedRoots: readonly EnvelopeReferenceV1[];
  readonly deviceChains: readonly DeviceChainEvidenceV1[];
}
export interface BackupGraphObjectV1 {
  readonly reference: EnvelopeReferenceV1;
  readonly payloadKind: EnvelopePayloadKindV1;
  /** Descendants obtained from this object's authenticated payload by its owner. */
  readonly children: readonly EnvelopeReferenceV1[];
}
/** S02 supplies the complete graph and independently reconstructed authored state. */
export interface BackupAppGraphV1 {
  /** Worker-owned lifetime; closure invalidates reads and publication. */
  readonly signal: AbortSignal;
  readonly manifest: Omit<AppManifestV1, "generation" | "previousManifestSha256" | "semanticSha256" | "totalPaddedBytes">;
  readonly objects: readonly BackupGraphObjectV1[];
  /** Metadata only; readers must keep the pinned source live through publication. */
  readObject(this: void, storageId: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
  readonly authoredAppId: Uint8Array;
  canonicalAuthoredState(this: void, signal: AbortSignal): AsyncIterable<Uint8Array>;
  readonly checkpointChains: readonly DeviceChainEvidenceV1[];
  readonly deviceChains: readonly DeviceChainEvidenceV1[];
}
