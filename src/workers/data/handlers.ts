/**
 * The data worker's command handlers: CAP-01 … CAP-07 (M33).
 *
 * This is the composition of M08 (keys, KDF, envelope AEAD), M09 (canonical
 * CBOR), and M11 (the encrypted store) behind the CA-04 RPC surface. It runs
 * inside the worker — `data.worker.ts` supplies the clock and entropy ports
 * and nothing else — and it is the only place a decrypted catalog exists.
 *
 * Two rules shape every handler:
 *
 * - **The revision is one number.** A frame is sealed at the transaction
 *   revision that will commit it (`expectedRevision + 1`), because that number
 *   is bound into its AAD (D12/AD-6). `frameToRow` refuses anything else, and
 *   a reader rebuilds the AAD from `row.revision` alone.
 * - **Nothing cached authorizes a destructive action.** `resetReadable`
 *   recomputes its inventory from storage inside the same call that issues the
 *   confirm token, and again at confirm time (database.md § `LocalCatalogV1`
 *   check 7 / AD-8). A token that no longer matches, or a session view that
 *   has drifted from what storage says, refuses the purge.
 */

import type { ClockPort } from "../../application/ports/clock.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import {
  asStorageId16,
  decodeStorageId16,
  encodeBase64Url,
  encodeStorageId16,
  type StorageId16,
} from "../../domain/model/bytes.js";
import { decryptEnvelope, encryptEnvelope } from "../../crypto/envelope.js";
import {
  ARGON2ID_FLOOR,
  calibrateKdf,
  createPassphraseKdfDescriptor,
  createRecoveryKdfDescriptor,
  deriveWrappingKeyFromPassphrase,
  deriveWrappingKeyFromRecoveryCode,
  type Argon2idParams,
  type CalibrationOptions,
} from "../../crypto/kdf.js";
import {
  destroySecretKey,
  wrapRoot,
  unwrapRoot,
  generateLocalRoot,
  type LocalRootKeyHandle,
  type SecretKeyHandle,
} from "../../crypto/keys.js";
import {
  RECOVERY_CODE_BYTES,
  formatRecoveryCode,
  parseRecoveryCode,
} from "../../crypto/recovery-code.js";
import { encodeCanonical } from "../../persistence/codecs/canonical-cbor.js";
import {
  parseEnvelopeTransport,
  serializeEnvelopeTransport,
} from "../../persistence/codecs/envelope-frame.js";
import {
  createBootstrap,
  readBootstrap,
  updateForPassphraseChange,
} from "../../persistence/envelope-store/bootstrap.js";
import { commitEnvelopes } from "../../persistence/envelope-store/commit.js";
import { getEnvelope } from "../../persistence/envelope-store/read.js";
import { purgeLocalStore } from "../../persistence/envelope-store/reset.js";
import { closeLocalDatabase } from "../../persistence/envelope-store/db.js";
import type { LocalBootstrapRowV1 } from "../../migrations/001_local_store_v1.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import {
  createImportHandlers,
  type ImportSessionContextV1,
} from "./import-handlers.js";
import {
  isIdleTimeoutMinutesV1,
  type DataWorkerRequestV1,
  type DataWorkerResponseV1,
  type ResetInventoryViewV1,
  type UnlockMethodV1,
  type UnlockedSessionViewV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import {
  buildLocalCatalog,
  decodeLocalCatalog,
  encodeLocalCatalog,
  withIdleTimeout,
  type LocalCatalogV1,
} from "./catalog.js";
import { WorkerSession, type UnlockedState } from "./session.js";

/** The bootstrap's own scope; every other scope comes from a decrypted parent. */
const CATALOG_SCOPE = "local.catalog";
const CATALOG_PAYLOAD_KIND = "local.catalog";
const STORAGE_ID_BYTES = 16;
const DEVICE_ID_BYTES = 16;

export interface DataWorkerDependencies {
  readonly clock: ClockPort;
  readonly entropy: EntropyPort;
  /**
   * Bounds for the setup-time Argon2id calibration. Production passes nothing
   * and calibrates for real; unit runs pin the floor so a suite is not a
   * benchmark.
   */
  readonly calibration?: CalibrationOptions;
}

export interface DataWorkerCommandHandler {
  /**
   * `ports` are the `MessagePort`s the request's transfer list carried. Only
   * `beginImportStage` uses one, and no response ever returns one (D17).
   */
  handle(
    request: DataWorkerRequestV1,
    ports?: readonly MessagePort[],
  ): Promise<DataWorkerResponseV1>;
  /** Zeroizes keys and drops the database handle. */
  dispose(): void;
}

export function createDataWorkerHandler(
  deps: DataWorkerDependencies,
): DataWorkerCommandHandler {
  const session = new WorkerSession();
  const imports = createImportHandlers({
    entropy: deps.entropy,
    getContext: () => importContext(requireUnlocked()),
  });

  const now = (): number => deps.clock.nowEpochMs();

  function freshStorageId(): StorageId16 {
    return asStorageId16(deps.entropy.randomBytes(STORAGE_ID_BYTES));
  }

  function requireUnlocked(): UnlockedState {
    const state = session.state;
    if (state.kind !== "unlocked") {
      throw new DataWorkerCommandError("locked");
    }
    return state;
  }

  async function requireBootstrap(): Promise<LocalBootstrapRowV1> {
    const row = await readBootstrap();
    if (row === undefined) {
      throw new DataWorkerCommandError("not-initialized");
    }
    return row;
  }

  /** CA-05: refuse before doing any work while a delay is outstanding. */
  function assertAttemptAllowed(): void {
    const remainingMs = session.attempts.remainingMs(now());
    if (remainingMs > 0) {
      throw new DataWorkerCommandError("rate-limited", {
        retryAfterMs: remainingMs,
      });
    }
  }

  function refuseAttempt(
    kind: "wrong-passphrase" | "invalid-recovery-code",
  ): never {
    throw new DataWorkerCommandError(kind, {
      retryAfterMs: session.attempts.recordFailure(now()),
    });
  }

  /**
   * Unwraps the local root with a key derived here and destroyed here: the
   * wrapping key exists for exactly one derivation.
   */
  async function unwrapWith(
    derive: () => Promise<SecretKeyHandle>,
    wrapped: LocalBootstrapRowV1["passphraseWrappedRoot"],
  ): Promise<LocalRootKeyHandle | undefined> {
    const wrappingKey = await derive();
    try {
      return await unwrapRoot(wrapped, wrappingKey);
    } catch {
      return undefined;
    } finally {
      destroySecretKey(wrappingKey);
    }
  }

  async function sealCatalog(
    catalog: LocalCatalogV1,
    root: LocalRootKeyHandle,
    logicalRevision: number,
  ): Promise<{ readonly frame: EnvelopeFrameV1; readonly storageId: string }> {
    const storageId = freshStorageId();
    const frame = await encryptEnvelope({
      scope: CATALOG_SCOPE,
      storageId,
      logicalRevision: BigInt(logicalRevision),
      payloadKind: CATALOG_PAYLOAD_KIND,
      payload: encodeLocalCatalog(catalog),
      compression: "deflate-raw-v1",
      key: root,
    });
    return { frame, storageId: encodeStorageId16(storageId) };
  }

  /**
   * Reads and validates the catalog the bootstrap row points at. Everything
   * about the envelope's identity is rebuilt from the stored row, so a catalog
   * that does not authenticate under this root fails closed as integrity.
   */
  async function readCatalog(
    row: LocalBootstrapRowV1,
    root: LocalRootKeyHandle,
  ): Promise<LocalCatalogV1> {
    const frame = await getEnvelope(decodeStorageId16(row.catalogStorageId));
    if (frame === undefined) {
      throw new DataWorkerCommandError("integrity");
    }
    const opened = await decryptEnvelope(
      frame,
      CATALOG_SCOPE,
      root,
      CATALOG_PAYLOAD_KIND,
    );
    return decodeLocalCatalog(opened.payload);
  }

  /**
   * The live session as the import handlers need it. Rebuilt per request, so
   * a stage command can never act on a catalog the session has moved past.
   */
  function importContext(state: UnlockedState): ImportSessionContextV1 {
    return {
      localRoot: state.root,
      catalog: state.catalog,
      catalogStorageId: state.catalogStorageId,
      transactionRevision: state.transactionRevision,
      writerEpoch: state.writerEpoch,
      adopt: (next) => {
        session.update(next);
      },
      sealCatalog: (catalog, logicalRevision) =>
        sealCatalog(catalog, state.root, logicalRevision),
    };
  }

  function view(state: UnlockedState): UnlockedSessionViewV1 {
    return {
      state: "unlocked",
      unlockedVia: state.unlockedVia,
      settings: { idleTimeoutMinutes: state.catalog.settings.idleTimeoutMinutes },
      catalogRevision: state.catalog.catalogRevision,
      transactionRevision: state.transactionRevision,
      appCount: state.catalog.apps.length,
      homeCount: state.catalog.homes.length,
    };
  }

  /** Opens a session from a row plus a proven root, or fails closed. */
  async function openSession(
    row: LocalBootstrapRowV1,
    root: LocalRootKeyHandle,
    unlockedVia: UnlockMethodV1,
  ): Promise<UnlockedState> {
    let catalog: LocalCatalogV1;
    try {
      catalog = await readCatalog(row, root);
    } catch (cause) {
      destroySecretKey(root);
      throw cause;
    }
    session.attempts.recordSuccess();
    const unlocked = session.unlock({
      root,
      unlockedVia,
      catalog,
      catalogStorageId: row.catalogStorageId,
      transactionRevision: row.transactionRevision,
      writerEpoch: row.writerEpoch,
    });

    // M23's unlock-time sweep: a catalog holding a stale workflow reference or
    // an unfinished cleanup ticket resumes **before the library is reported**,
    // so a device that crashed mid-import never shows a half-import it is
    // still carrying. It returns the session as the sweep left it.
    await imports.sweep(importContext(unlocked));
    const swept = session.state;
    return swept.kind === "unlocked" ? swept : unlocked;
  }

  // --- CAP-01 -------------------------------------------------------------

  async function setup(passphrase: string): Promise<DataWorkerResponseV1> {
    if ((await readBootstrap()) !== undefined) {
      throw new DataWorkerCommandError("already-initialized");
    }

    const params: Argon2idParams = await calibrateKdf(
      deps.clock,
      deps.calibration ?? {},
    );
    const passphraseKdf = createPassphraseKdfDescriptor(deps.entropy, params);
    const recoveryKdf = createRecoveryKdfDescriptor(deps.entropy);

    const root = generateLocalRoot(deps.entropy);
    const recoverySecret = deps.entropy.randomBytes(RECOVERY_CODE_BYTES);
    const recoveryCode = await formatRecoveryCode(recoverySecret);

    const passphraseKey = await deriveWrappingKeyFromPassphrase(
      passphrase,
      passphraseKdf,
    );
    const recoveryKey = await deriveWrappingKeyFromRecoveryCode(
      recoverySecret,
      recoveryKdf,
    );
    let passphraseWrappedRoot;
    let recoveryWrappedRoot;
    try {
      passphraseWrappedRoot = await wrapRoot(root, passphraseKey);
      recoveryWrappedRoot = await wrapRoot(root, recoveryKey);
    } finally {
      destroySecretKey(passphraseKey);
      destroySecretKey(recoveryKey);
    }

    // D10: the recovery-code view is its own envelope under the root, carried
    // as opaque bytes inside the catalog payload. Its logical revision belongs
    // to its own AAD and never moves, so later catalog commits copy it
    // verbatim rather than re-sealing it.
    const recoveryView = await encryptEnvelope({
      scope: CATALOG_SCOPE,
      storageId: freshStorageId(),
      logicalRevision: 1n,
      payloadKind: CATALOG_PAYLOAD_KIND,
      payload: recoverySecret,
      compression: "none",
      key: root,
    });

    const catalog = buildLocalCatalog({
      deviceId: encodeBase64Url(deps.entropy.randomBytes(DEVICE_ID_BYTES)),
      recoveryCodeView: serializeEnvelopeTransport(recoveryView),
    });

    const transactionRevision = 1;
    const sealed = await sealCatalog(catalog, root, transactionRevision);
    const row: LocalBootstrapRowV1 = {
      slot: "root",
      databaseFormatVersion: 1,
      minimumReaderVersion: 1,
      codecVersion: 1,
      envelopeFormatVersion: 1,
      cipherSuiteVersion: 1,
      paddingProfileVersion: 1,
      transactionRevision,
      writerEpoch: 0,
      passphraseKdf,
      recoveryKdf,
      passphraseWrappedRoot,
      recoveryWrappedRoot,
      catalogStorageId: sealed.storageId,
      migrationStorageId: null,
    };

    // Bootstrap and catalog land in one transaction: a bootstrap whose catalog
    // pointer resolves to nothing must never exist (CAP-01).
    await createBootstrap(row, [sealed.frame]);

    const unlocked = session.unlock({
      root,
      unlockedVia: "passphrase",
      catalog,
      catalogStorageId: sealed.storageId,
      transactionRevision,
      writerEpoch: 0,
    });

    return { kind: "setup", recoveryCode, session: view(unlocked) };
  }

  // --- CAP-02 / CAP-05 ----------------------------------------------------

  async function unlock(passphrase: string): Promise<DataWorkerResponseV1> {
    assertAttemptAllowed();
    const row = await requireBootstrap();

    const root = await unwrapWith(
      () => deriveWrappingKeyFromPassphrase(passphrase, row.passphraseKdf),
      row.passphraseWrappedRoot,
    );
    if (root === undefined) {
      refuseAttempt("wrong-passphrase");
    }

    return { kind: "unlock", session: view(await openSession(row, root, "passphrase")) };
  }

  async function unlockWithRecoveryCode(
    recoveryCode: string,
  ): Promise<DataWorkerResponseV1> {
    assertAttemptAllowed();
    const row = await requireBootstrap();

    let secret: Uint8Array;
    try {
      secret = await parseRecoveryCode(recoveryCode);
    } catch {
      // A code that fails its checksum never reached the KDF; it is still an
      // attempt, and it counts like any other.
      refuseAttempt("invalid-recovery-code");
    }

    const root = await unwrapWith(
      () => deriveWrappingKeyFromRecoveryCode(secret, row.recoveryKdf),
      row.recoveryWrappedRoot,
    );
    if (root === undefined) {
      refuseAttempt("invalid-recovery-code");
    }

    return {
      kind: "unlockWithRecoveryCode",
      session: view(await openSession(row, root, "recovery-code")),
    };
  }

  // --- CAP-03 -------------------------------------------------------------

  function lock(): DataWorkerResponseV1 {
    session.lock();
    return { kind: "lock", status: { state: "locked" } };
  }

  async function updateSettings(minutes: unknown): Promise<DataWorkerResponseV1> {
    const state = requireUnlocked();
    if (!isIdleTimeoutMinutesV1(minutes)) {
      throw new DataWorkerCommandError("invalid-setting");
    }

    const next = withIdleTimeout(state.catalog, minutes);
    const revision = state.transactionRevision + 1;
    const sealed = await sealCatalog(next, state.root, revision);

    const committed = await commitEnvelopes({
      expectedRevision: state.transactionRevision,
      expectedWriterEpoch: state.writerEpoch,
      addFrames: [sealed.frame],
      // The store owns `transactionRevision`; a patch may only move pointers.
      bootstrapPatch: { catalogStorageId: sealed.storageId },
    });

    const updated = session.update({
      catalog: next,
      catalogStorageId: sealed.storageId,
      transactionRevision: committed,
    });

    return {
      kind: "updateSettings",
      settings: { idleTimeoutMinutes: next.settings.idleTimeoutMinutes },
      session: view(updated),
    };
  }

  // --- CAP-04 -------------------------------------------------------------

  async function changePassphrase(
    request: Extract<DataWorkerRequestV1, { kind: "changePassphrase" }>,
  ): Promise<DataWorkerResponseV1> {
    const state = requireUnlocked();
    const row = await requireBootstrap();
    const authorization = request.authorization;

    if (authorization.via === "current-passphrase") {
      assertAttemptAllowed();
      const proof = await unwrapWith(
        () =>
          deriveWrappingKeyFromPassphrase(
            authorization.currentPassphrase,
            row.passphraseKdf,
          ),
        row.passphraseWrappedRoot,
      );
      if (proof === undefined) {
        refuseAttempt("wrong-passphrase");
      }
      // The session already holds the root; this handle only proved the
      // passphrase and is destroyed immediately.
      destroySecretKey(proof);
      session.attempts.recordSuccess();
    } else if (state.unlockedVia !== "recovery-code") {
      // Only a recovery-unlocked session may install a passphrase without
      // presenting the old one (CAP-05).
      throw new DataWorkerCommandError("malformed-request");
    }

    // Keep this device's calibrated cost; only the salt and wrapper change.
    const params: Argon2idParams = {
      memoryKiB: Math.max(row.passphraseKdf.memoryKiB, ARGON2ID_FLOOR.memoryKiB),
      iterations: Math.max(row.passphraseKdf.iterations, ARGON2ID_FLOOR.iterations),
      lanes: 1,
    };
    const nextKdf = createPassphraseKdfDescriptor(deps.entropy, params);
    const wrappingKey = await deriveWrappingKeyFromPassphrase(
      request.nextPassphrase,
      nextKdf,
    );
    let wrapped;
    try {
      wrapped = await wrapRoot(state.root, wrappingKey);
    } finally {
      destroySecretKey(wrappingKey);
    }

    // Re-wrapping only: no envelope is rewritten, so the catalog pointer and
    // its revision are untouched (CAP-04).
    const revision = await updateForPassphraseChange(
      {
        expectedRevision: state.transactionRevision,
        expectedWriterEpoch: state.writerEpoch,
      },
      nextKdf,
      wrapped,
    );

    return {
      kind: "changePassphrase",
      session: view(session.update({ transactionRevision: revision })),
    };
  }

  // --- CAP-06 -------------------------------------------------------------

  async function revealRecoveryCode(
    currentPassphrase: string,
  ): Promise<DataWorkerResponseV1> {
    const state = requireUnlocked();
    assertAttemptAllowed();
    const row = await requireBootstrap();

    const proof = await unwrapWith(
      () => deriveWrappingKeyFromPassphrase(currentPassphrase, row.passphraseKdf),
      row.passphraseWrappedRoot,
    );
    if (proof === undefined) {
      refuseAttempt("wrong-passphrase");
    }
    destroySecretKey(proof);
    session.attempts.recordSuccess();

    const opened = await decryptEnvelope(
      parseEnvelopeTransport(state.catalog.settings.recoveryCodeView),
      CATALOG_SCOPE,
      state.root,
      CATALOG_PAYLOAD_KIND,
    );
    return {
      kind: "revealRecoveryCode",
      recoveryCode: await formatRecoveryCode(opened.payload),
    };
  }

  // --- CAP-07 -------------------------------------------------------------

  async function resetLocked(): Promise<DataWorkerResponseV1> {
    // Allowed while locked, and it enumerates nothing: a locked worker cannot
    // read the catalog, and pretending otherwise would be the untruthful part.
    session.lock();
    await purgeLocalStore();
    return { kind: "resetLocked", purged: true };
  }

  /**
   * The inventory a readable reset may show, recomputed from storage — never
   * from the session's copy — inside the call that issues the token.
   */
  async function recomputeInventory(
    root: LocalRootKeyHandle,
  ): Promise<{
    readonly inventory: ResetInventoryViewV1;
    readonly token: string;
    readonly catalog: LocalCatalogV1;
    readonly row: LocalBootstrapRowV1;
  }> {
    const row = await requireBootstrap();
    const catalog = await readCatalog(row, root);
    return {
      inventory: inventoryOf(catalog),
      token: inventoryToken(catalog, row.transactionRevision),
      catalog,
      row,
    };
  }

  function inventoryOf(catalog: LocalCatalogV1): ResetInventoryViewV1 {
    return {
      // CA-09/CAP-18: the name is now the app's own, not its opaque id. The
      // device-only change count still needs the decrypted head's frontier,
      // which S05 supplies; until then it is the honest zero of a list with
      // no apps in it, and the surface says "none", never "unknown" (FR-23).
      apps: catalog.apps.map((app) => ({
        appId: app.appId,
        displayName: app.displayName,
        deviceOnlyChangeCount: 0,
      })),
      appCount: catalog.apps.length,
      homeCount: catalog.homes.length,
    };
  }

  /**
   * The confirm token *is* the recomputed inventory, canonically encoded. It
   * is compared against a fresh recomputation at purge time, so a token can
   * only authorize the exact state it was issued for.
   */
  function inventoryToken(
    catalog: LocalCatalogV1,
    transactionRevision: number,
  ): string {
    return encodeBase64Url(
      encodeCanonical([
        "sheaf/local/reset-inventory/v1",
        BigInt(transactionRevision),
        BigInt(catalog.catalogRevision),
        // The name is part of the token because the confirmation shows it: a
        // rename between enumerate and confirm must invalidate the token, not
        // purge under a name the user never read. With `apps: []` — every
        // catalog F01 could write — the encoding is unchanged.
        catalog.apps.map((app) => [
          app.appId,
          app.locality,
          app.homeId ?? "",
          app.displayName,
        ]),
        catalog.homes.map((home) => [home.homeId, home.kind]),
      ]),
    );
  }

  async function resetReadable(
    confirmToken: string | undefined,
  ): Promise<DataWorkerResponseV1> {
    const state = requireUnlocked();
    const recomputed = await recomputeInventory(state.root);

    if (confirmToken === undefined) {
      // Enumerate. The session's view is refreshed from the same read, so a
      // later confirm compares like with like.
      session.update({
        catalog: recomputed.catalog,
        catalogStorageId: recomputed.row.catalogStorageId,
        transactionRevision: recomputed.row.transactionRevision,
      });
      return {
        kind: "resetReadable",
        phase: "inventory",
        inventory: recomputed.inventory,
        confirmToken: recomputed.token,
      };
    }

    // Check 7, both halves: the token must still describe what storage says,
    // and the session's own cached view must not have drifted from it. Either
    // mismatch refuses the purge rather than destroying data against a stale
    // count.
    const cachedToken = inventoryToken(state.catalog, state.transactionRevision);
    if (confirmToken !== recomputed.token || cachedToken !== recomputed.token) {
      throw new DataWorkerCommandError("stale-confirmation");
    }

    session.lock();
    await purgeLocalStore();
    return { kind: "resetReadable", phase: "purged", purged: true };
  }

  // --- status -------------------------------------------------------------

  async function getStatus(): Promise<DataWorkerResponseV1> {
    const state = session.state;
    if (state.kind === "unlocked") {
      return { kind: "getStatus", status: view(state) };
    }

    const initialized = (await readBootstrap()) !== undefined;
    const retryAfterMs = session.attempts.remainingMs(now());
    return {
      kind: "getStatus",
      status: {
        state: initialized ? "locked" : "uninitialized",
        ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
      },
    };
  }

  return {
    async handle(
      request: DataWorkerRequestV1,
      ports: readonly MessagePort[] = [],
    ): Promise<DataWorkerResponseV1> {
      switch (request.kind) {
        case "setup":
          return setup(request.passphrase);
        case "unlock":
          return unlock(request.passphrase);
        case "unlockWithRecoveryCode":
          return unlockWithRecoveryCode(request.recoveryCode);
        case "changePassphrase":
          return changePassphrase(request);
        case "revealRecoveryCode":
          return revealRecoveryCode(request.currentPassphrase);
        case "lock":
          return lock();
        case "updateSettings":
          return updateSettings(request.idleTimeoutMinutes);
        case "resetLocked":
          return resetLocked();
        case "resetReadable":
          return resetReadable(request.confirmToken);
        case "getStatus":
          return getStatus();
        case "beginImportStage":
          return imports.beginImportStage(request, ports);
        case "getImportStage":
          return imports.getImportStage(request);
        case "runInference":
          return imports.runInference(request);
        case "applyReviewEdit":
          return imports.applyReviewEdit(request);
        case "cancelImportStage":
          return imports.cancelImportStage(request);
        default: {
          const unreachable: never = request;
          void unreachable;
          throw new DataWorkerCommandError("unsupported-request");
        }
      }
    },
    dispose(): void {
      imports.dispose();
      session.lock();
      closeLocalDatabase();
    },
  };
}
