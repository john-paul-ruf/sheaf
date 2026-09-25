import type { VaultSecretsV1 } from "../../application/ports/vault-crypto.js";
import type { WrappedKeyV1 } from "../../migrations/006_vault_format_v1.js";
import { CURRENT_FORMAT_VERSIONS } from "../../migrations/index.js";
import { CodecError, IntegrityError } from "../../domain/model/errors.js";
import { decodeDomainId } from "../../domain/model/ids.js";
import { decodeStorageId16 } from "../../domain/model/bytes.js";
import { asMap, bytesOfLength, count, exactKeys, field, list, nfcText } from "../../import/staging/proposal-codec.js";
import { decodeCanonical, encodeCanonical, type DecodedValue } from "../../persistence/codecs/canonical-cbor.js";
import { vaultValue } from "../../persistence/codecs/vault.js";
import type { LocalCatalogHomeEntryV1 } from "./catalog.js";
import type { AppStoragePortsV1, WorkerSessionContextV1 } from "./event-store.js";

/** A committed retention root. No file handle or claimed save result is stored. */
export interface BackupPinV1 {
  readonly operationId: string;
  readonly appId: string;
  readonly headStorageId: string;
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
  readonly lastSuccessfulBackupMs: null;
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
  const map = exactKeys(asMap(decodeCanonical(payload), "home state"),
    ["homeStateVersion", "homeId", "vaultId", "kind", "displayName", "secrets", "locallyWrappedVaultKey", "appKeys", "pins", "lastSuccessfulBackupMs"], "home state");
  if (count(field(map, "homeStateVersion"), "home version") !== CURRENT_FORMAT_VERSIONS.vault ||
      field(map, "kind") !== "bundle" || field(map, "lastSuccessfulBackupMs") !== null) {
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
  const displayName = nfcText(field(map, "displayName"), "vault name");
  if (displayName.trim().length === 0) throw new CodecError("empty vault name");
  return { homeStateVersion: CURRENT_FORMAT_VERSIONS.vault, homeId, vaultId, kind: "bundle", displayName,
    secrets: secrets(field(map, "secrets")), locallyWrappedVaultKey: wrapped(field(map, "locallyWrappedVaultKey")),
    appKeys, pins, lastSuccessfulBackupMs: null };
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
