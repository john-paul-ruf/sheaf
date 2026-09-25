export type FileSaveOutcomeV1 = "saved" | "cancelled" | "failed" | "unconfirmed";

/** Transient callbacks belong to one save invocation, never a durable receipt. */
export interface BundleSaveInteractionV1 {
  readonly signal: AbortSignal;
  readonly delivering: () => void;
  readonly confirmDelivery: (signal: AbortSignal) => Promise<boolean>;
}

/** Opens the destination during the gesture; bytes may still be preparing. */
export interface FileSavePort {
  save(blob: Promise<Blob>, signal: AbortSignal): Promise<FileSaveOutcomeV1>;
}
