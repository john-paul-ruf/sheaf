import type { BundleSaveInteractionV1, FileSaveOutcomeV1 } from "../ports/file-save.js";
import type { SecurityWorkerPort } from "./services.js";
import type { CreateBundleHomeRequestV1, CreateBundleHomeResponseV1, RevealVaultRecoveryCodeResponseV1 } from "../../workers/protocol/messages.js";

/** The page composition owns the destination; this service owns no file or key. */
export interface DurabilityServices {
  saveBundle(appId: string, interaction: BundleSaveInteractionV1): Promise<FileSaveOutcomeV1>;
}

export interface HomeServices {
  create(input: Omit<CreateBundleHomeRequestV1, "kind">): Promise<CreateBundleHomeResponseV1>;
  reveal(homeId: string, passphrase: string): Promise<RevealVaultRecoveryCodeResponseV1>;
}

export function createHomeServices(port: SecurityWorkerPort): HomeServices {
  return {
    create: (input) => port.send({ kind: "createBundleHome", ...input }),
    reveal: (homeId, passphrase) => port.send({ kind: "revealVaultRecoveryCode", homeId, passphrase }),
  };
}
