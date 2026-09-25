import type { BundleSaveInteractionV1, FileSaveOutcomeV1 } from "../ports/file-save.js";
import type { SecurityWorkerPort } from "./services.js";
import type { CreateBundleHomeRequestV1, CreateBundleHomeResponseV1, RevealVaultRecoveryCodeResponseV1 } from "../../workers/protocol/messages.js";
import type { DataWorkerRequestV1, ResponseForV1 } from "../../workers/protocol/messages.js";

export interface ReminderServices {
  query(appId: string): Promise<ResponseForV1<"getScratchReminder">>;
  dismiss(input: Omit<Extract<DataWorkerRequestV1, { kind: "dismissScratchReminder" }>, "kind">): Promise<ResponseForV1<"dismissScratchReminder">>;
}

export function createReminderServices(port: SecurityWorkerPort): ReminderServices {
  return {
    query: (appId) => port.send({ kind: "getScratchReminder", appId }),
    dismiss: (input) => port.send({ kind: "dismissScratchReminder", ...input }),
  };
}

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
