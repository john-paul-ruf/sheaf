import type { BundleSaveInteractionV1, FileSaveOutcomeV1 } from "../ports/file-save.js";

/** The page composition owns the destination; this service owns no file or key. */
export interface DurabilityServices {
  saveBundle(appId: string, interaction: BundleSaveInteractionV1): Promise<FileSaveOutcomeV1>;
}
