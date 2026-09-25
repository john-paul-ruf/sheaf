export type FileSaveOutcomeV1 = "saved" | "cancelled" | "failed" | "unconfirmed";

/** Opens the destination during the gesture; bytes may still be preparing. */
export interface FileSavePort {
  save(blob: Promise<Blob>, signal: AbortSignal): Promise<FileSaveOutcomeV1>;
}
