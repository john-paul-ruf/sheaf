import type { VaultSecretsV1 } from "../../application/ports/vault-crypto.js";
import type { WrappedKeyV1 } from "../../migrations/006_vault_format_v1.js";
import { CURRENT_FORMAT_VERSIONS } from "../../migrations/index.js";
import { CodecError, IntegrityError } from "../../domain/model/errors.js";
import { decodeDomainId, encodeDomainId } from "../../domain/model/ids.js";
import { decodeStorageId16, decodeBase64Url, encodeBase64Url } from "../../domain/model/bytes.js";
import { asMap, bytesOfLength, count, exactKeys, field, list, nfcText } from "../../import/staging/proposal-codec.js";
import { decodeCanonical, encodeCanonical, type DecodedValue } from "../../persistence/codecs/canonical-cbor.js";
import { readFrontier, vaultValue } from "../../persistence/codecs/vault.js";
import type { LocalCatalogAppEntryV1, LocalCatalogHomeEntryV1 } from "./catalog.js";
import { openAppKey, readAppHead } from "./event-store.js";
import { parseEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";
import type { AppDurabilityViewV1 } from "../protocol/messages.js";
import type { AppStoragePortsV1, WorkerSessionContextV1 } from "./event-store.js";

/** A committed retention root. No file handle or claimed save result is stored. */
export interface BackupPinV1 {
  readonly operationId: string;
  readonly appId: string;
  readonly headStorageId: string;
}

export interface BundleReceiptV1 {
  readonly appId: string;
  readonly operationId: string;
  readonly artifactSha256: string;
  readonly candidateSha256: Uint8Array;
  readonly generation: bigint;
  readonly confirmedFrontier: readonly import("../../migrations/004_event_format_v1.js").FrontierEntryV1[];
  readonly confirmedAtMs: number;
}

/** Local encrypted bootstrap for a bundle vault before its first publication. */
export interface HomeStateV1 {
  readonly homeStateVersion: 1;
  readonly homeId: string;
  readonly vaultId: string;
  readonly kind: "bundle";
  readonly displayName: string;
  readonly secrets: Omit<VaultSecretsV1, "key">;
  readonly locallyWrappedVaultKey: WrappedKeyV1;
  readonly appKeys: readonly { readonly appId: string; readonly wrappedAppKey: WrappedKeyV1 }[];
  readonly pins: readonly BackupPinV1[];
  readonly lastSuccessfulBackupMs: number | null;
  readonly receipts?: readonly BundleReceiptV1[];
}

function wrapped(value: DecodedValue): WrappedKeyV1 {
  const map = exactKeys(asMap(value, "a wrapped key"), ["wrapId", "nonce", "ciphertext"], "a wrapped key");
  return {
    wrapId: bytesOfLength(field(map, "wrapId"), 16, "a wrap id"),
    nonce: bytesOfLength(field(map, "nonce"), 24, "a wrap nonce"),
    ciphertext: bytesOfLength(field(map, "ciphertext"), 48, "a wrapped key"),
  };
}

function secrets(value: DecodedValue): HomeStateV1["secrets"] {
  const map = exactKeys(asMap(value, "vault bootstrap"),
    ["recoveryCode", "passphraseKdf", "recoveryKdf", "passphraseWrappedVaultKey", "recoveryWrappedVaultKey"], "vault bootstrap");
  const pass = exactKeys(asMap(field(map, "passphraseKdf"), "vault passphrase KDF"),
    ["algorithm", "algorithmVersion", "salt", "memoryKiB", "iterations", "lanes", "outputBytes", "context"], "vault passphrase KDF");
  const recovery = exactKeys(asMap(field(map, "recoveryKdf"), "vault recovery KDF"),
    ["algorithm", "salt", "outputBytes", "context"], "vault recovery KDF");
  const memoryKiB = count(field(pass, "memoryKiB"), "KDF memory");
  const iterations = count(field(pass, "iterations"), "KDF iterations");
  if (field(pass, "algorithm") !== "argon2id" || field(pass, "context") !== "sheaf/vault/passphrase/v1" ||
      count(field(pass, "algorithmVersion"), "Argon version") !== 0x13 ||
      count(field(pass, "lanes"), "KDF lanes") !== 1 || count(field(pass, "outputBytes"), "KDF size") !== 32 ||
      memoryKiB < 65536 || iterations < 3 || field(recovery, "algorithm") !== "hkdf-sha-256" ||
      field(recovery, "context") !== "sheaf/vault/recovery/v1" || count(field(recovery, "outputBytes"), "KDF size") !== 32) {
    throw new CodecError("invalid vault bootstrap KDF");
  }
  return {
    recoveryCode: nfcText(field(map, "recoveryCode"), "vault recovery code"),
    passphraseKdf: { algorithm: "argon2id", algorithmVersion: 0x13,
      salt: bytesOfLength(field(pass, "salt"), 16, "KDF salt"), memoryKiB, iterations, lanes: 1,
      outputBytes: 32, context: "sheaf/vault/passphrase/v1" },
    recoveryKdf: { algorithm: "hkdf-sha-256", salt: bytesOfLength(field(recovery, "salt"), 16, "KDF salt"),
      outputBytes: 32, context: "sheaf/vault/recovery/v1" },
    passphraseWrappedVaultKey: wrapped(field(map, "passphraseWrappedVaultKey")),
    recoveryWrappedVaultKey: wrapped(field(map, "recoveryWrappedVaultKey")),
  };
}

/** Rejects malformed local home payloads before either writing or using them. */
export function decodeHomeState(payload: Uint8Array): HomeStateV1 {
  const decoded = asMap(decodeCanonical(payload), "home state");
  const map = exactKeys(decoded,
    ["homeStateVersion", "homeId", "vaultId", "kind", "displayName", "secrets", "locallyWrappedVaultKey", "appKeys", "pins", "lastSuccessfulBackupMs", ...(decoded.has("receipts") ? ["receipts"] : [])], "home state");
  if (count(field(map, "homeStateVersion"), "home version") !== CURRENT_FORMAT_VERSIONS.vault ||
      field(map, "kind") !== "bundle") {
    throw new CodecError("unsupported home state");
  }
  const homeId = nfcText(field(map, "homeId"), "home id");
  const vaultId = nfcText(field(map, "vaultId"), "vault id");
  decodeDomainId("home", homeId);
  decodeDomainId("vault", vaultId);
  const appKeys = list(field(map, "appKeys"), "app keys").map((value) => {
    const entry = exactKeys(asMap(value, "app wrap"), ["appId", "wrappedAppKey"], "app wrap");
    const appId = nfcText(field(entry, "appId"), "app id");
    decodeDomainId("app", appId);
    return { appId, wrappedAppKey: wrapped(field(entry, "wrappedAppKey")) };
  });
  const pins = list(field(map, "pins"), "backup pins").map((value) => {
    const entry = exactKeys(asMap(value, "backup pin"), ["operationId", "appId", "headStorageId"], "backup pin");
    const operationId = nfcText(field(entry, "operationId"), "operation id");
    const appId = nfcText(field(entry, "appId"), "app id");
    const headStorageId = nfcText(field(entry, "headStorageId"), "head id");
    decodeStorageId16(operationId);
    decodeStorageId16(headStorageId);
    if (!appKeys.some((app) => app.appId === appId)) throw new CodecError("pin belongs to another app");
    return { operationId, appId, headStorageId };
  });
  if (new Set(appKeys.map((app) => app.appId)).size !== appKeys.length ||
      new Set(pins.map((pin) => pin.operationId)).size !== pins.length) throw new CodecError("duplicate home identity");
  const receipts = map.has("receipts") ? list(field(map, "receipts"), "bundle receipts").map((value): BundleReceiptV1 => {
    const receipt = exactKeys(asMap(value, "bundle receipt"),
      ["appId", "operationId", "artifactSha256", "candidateSha256", "generation", "confirmedFrontier", "confirmedAtMs"], "bundle receipt");
    const appId = nfcText(field(receipt, "appId"), "app id");
    const operationId = nfcText(field(receipt, "operationId"), "operation id");
    decodeStorageId16(operationId);
    const artifactSha256 = nfcText(field(receipt, "artifactSha256"), "artifact hash");
    if (decodeBase64Url(artifactSha256).length !== 32 || encodeBase64Url(decodeBase64Url(artifactSha256)) !== artifactSha256 || !appKeys.some((entry) => entry.appId === appId)) throw new CodecError("invalid receipt identity");
    const generation = field(receipt, "generation");
    if (typeof generation !== "bigint" || generation < 1n || generation > 0xffff_ffff_ffff_ffffn) throw new CodecError("invalid bundle generation");
    return { appId, operationId, artifactSha256, generation,
      candidateSha256: bytesOfLength(field(receipt, "candidateSha256"), 32, "candidate hash"),
      confirmedFrontier: readFrontier(field(receipt, "confirmedFrontier")),
      confirmedAtMs: count(field(receipt, "confirmedAtMs"), "confirmed time") };
  }) : undefined;
  const lastSuccessfulBackupMs = field(map, "lastSuccessfulBackupMs") === null ? null : count(field(map, "lastSuccessfulBackupMs"), "backup time");
  if (new Set(receipts?.map((receipt) => receipt.appId)).size !== (receipts?.length ?? 0) ||
      ((receipts?.length ?? 0) > 0 && lastSuccessfulBackupMs === null) ||
      (lastSuccessfulBackupMs !== null && !receipts?.some((receipt) => receipt.confirmedAtMs === lastSuccessfulBackupMs))) throw new CodecError("invalid receipt time");
  const displayName = nfcText(field(map, "displayName"), "vault name");
  if (displayName.trim().length === 0) throw new CodecError("empty vault name");
  return { homeStateVersion: CURRENT_FORMAT_VERSIONS.vault, homeId, vaultId, kind: "bundle", displayName,
    secrets: secrets(field(map, "secrets")), locallyWrappedVaultKey: wrapped(field(map, "locallyWrappedVaultKey")),
    appKeys, pins, lastSuccessfulBackupMs, ...(receipts === undefined ? {} : { receipts }) };
}

/** Home secrets and retention roots exist only inside the local.home envelope. */
export function encodeHomeState(state: HomeStateV1): Uint8Array {
  const payload = encodeCanonical(vaultValue(state));
  decodeHomeState(payload);
  return payload;
}

/** Authenticates the catalog's home identity as well as its encrypted payload. */
export async function readHomeState(ports: AppStoragePortsV1, context: WorkerSessionContextV1,
  entry: LocalCatalogHomeEntryV1): Promise<HomeStateV1> {
  const frame = await ports.store.getEnvelope(decodeStorageId16(entry.homeStateStorageId));
  if (frame === undefined) throw new IntegrityError("home state is missing");
  const state = decodeHomeState((await ports.crypto.open(frame, "local.home", context.localRoot, "local.home-state")).payload);
  if (state.homeId !== entry.homeId || state.vaultId !== entry.vaultId || state.kind !== entry.kind) {
    throw new IntegrityError("home state belongs to another home");
  }
  return state;
}

/** Both app-head writers consult the same durable retention roots. */
export async function isBackupHeadPinned(ports: AppStoragePortsV1, context: WorkerSessionContextV1,
  headStorageId: string): Promise<boolean> {
  for (const entry of context.catalog.homes) {
    if ((await readHomeState(ports, context, entry)).pins.some((pin) => pin.headStorageId === headStorageId)) return true;
  }
  return false;
}

export function pendingChangeCount(frontier: BundleReceiptV1["confirmedFrontier"],
  deviceId: string, confirmed: BundleReceiptV1["confirmedFrontier"] = []): number {
  const local = frontier.find((item) => encodeBase64Url(item.deviceId) === deviceId)?.commitSequence ?? 0n;
  const saved = confirmed.find((item) => encodeBase64Url(item.deviceId) === deviceId)?.commitSequence ?? 0n;
  const count = local - saved;
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) throw new IntegrityError("invalid pending frontier");
  return Number(count);
}

/** Both closed and open app readers use the current durable head and app-scoped receipt. */
export async function readAppDurability(ports: AppStoragePortsV1, context: WorkerSessionContextV1,
  app: LocalCatalogAppEntryV1): Promise<AppDurabilityViewV1> {
  let home: HomeStateV1 | undefined;
  if (app.homeId !== null) {
    const entry = context.catalog.homes.find((candidate) => candidate.homeId === app.homeId);
    if (entry === undefined) throw new IntegrityError("app home is missing");
    home = await readHomeState(ports, context, entry);
    if (!home.appKeys.some((entry) => entry.appId === app.appId)) throw new IntegrityError("home does not contain app");
  }
  const receipt = home?.receipts?.find((entry) => entry.appId === app.appId);
  if (app.appHeadStorageId === null) throw new IntegrityError("local app head is missing");
  const key = await openAppKey(ports, context.localRoot, app, parseEnvelopeTransport);
  try {
    const head = await readAppHead(ports, key, app.appHeadStorageId);
    if (encodeDomainId(head.appId) !== app.appId) throw new IntegrityError("backup status head belongs to another app");
    return { homeId: home?.homeId ?? null, homeName: home?.displayName ?? null,
      confirmedAtMs: receipt?.confirmedAtMs ?? null,
      deviceOnlyChangeCount: pendingChangeCount(head.frontier, context.catalog.deviceId, receipt?.confirmedFrontier) };
  } finally { ports.crypto.destroyKey(key); }
}
