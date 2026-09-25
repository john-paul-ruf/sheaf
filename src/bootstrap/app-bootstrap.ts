/**
 * Page-side composition and lock lifetime (M53).
 *
 * The order is the contract: probe the runtime first, and only then let a
 * worker exist. A browser missing a required capability gets
 * `{kind:'unsupported', missing}` — the data the SCR-001 recoverable error
 * needs to name what is absent — and no worker is started, because starting
 * one would fail later and less clearly.
 *
 * No key ever reaches this side of the boundary. Locking here means: ask the
 * worker to zeroize, wait for its ack, then terminate it. Termination is what
 * makes the lock real, so a worker that does not answer is terminated anyway.
 */

import type { FileSaveOutcomeV1, FileSavePort } from "../application/ports/file-save.js";
import { createFileSavePort } from "../platform/file-save.js";
import { prepareBundle } from "../workers/protocol/io-client.js";
import { spawnIoWorker } from "./io-worker.js";

import { probeCapabilities, type CapabilityReport } from "../platform/capabilities.js";
import { DataWorkerClient } from "../workers/protocol/client.js";
import type {
  IdleTimeoutMinutesV1,
  UnlockedSessionViewV1,
} from "../workers/protocol/messages.js";

export type { CapabilityReport };

/** What an unlocked page may know about the session (CA-04). */
export type UnlockedSession = UnlockedSessionViewV1;

export type LockReason =
  /** The user asked, through SCR-005's lock control. */
  | "user"
  /** The page is going away; termination re-locks (FR-22). */
  | "pagehide"
  /** The configured idle timeout elapsed; off by default. */
  | "idle-timeout";

export interface AppRuntime {
  /** The worker itself spawns on the first request, not here. */
  readonly client: DataWorkerClient;
  saveBundle(appId: string): Promise<FileSaveOutcomeV1>;
  /** Zeroizes in the worker, then terminates it. Safe to call twice. */
  lockNow(reason: LockReason): Promise<void>;
  onLock(listener: (reason: LockReason) => void): () => void;
  /**
   * Arms the idle re-lock. `0` disarms it, which is the product default
   * (FR-22): the timer exists only when the user has chosen a timeout.
   */
  setIdleTimeout(minutes: IdleTimeoutMinutesV1): void;
  /** Restarts the idle countdown. The surface calls this on real use. */
  noteActivity(): void;
  dispose(): void;
}

export type StartAppResult =
  | {
      readonly kind: "unsupported";
      readonly missing: readonly string[];
      readonly report: CapabilityReport;
    }
  | {
      readonly kind: "ready";
      readonly report: CapabilityReport;
      readonly app: AppRuntime;
    };

export interface StartAppOptions {
  /**
   * Overrides how the data worker is constructed. The default is the built
   * module URL; browser suites and later composition roots need no other.
   */
  readonly spawnWorker?: () => Worker;
  readonly spawnIoWorker?: () => Worker;
  readonly fileSave?: FileSavePort;
}

function spawnDataWorker(): Worker {
  return new Worker(new URL("../workers/data.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function startApp(options: StartAppOptions = {}): StartAppResult {
  const report = probeCapabilities();
  if (!report.supported) {
    return { kind: "unsupported", missing: report.missing, report };
  }

  const client = new DataWorkerClient({
    spawn: options.spawnWorker ?? spawnDataWorker,
  });
  const saves = new Set<AbortController>();
  const fileSave = options.fileSave ?? createFileSavePort();
  const listeners = new Set<(reason: LockReason) => void>();
  const teardown: (() => void)[] = [];
  let locked = false;
  let idleTimeoutMs = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function restartIdleTimer(): void {
    clearIdleTimer();
    if (idleTimeoutMs > 0 && !locked) {
      idleTimer = setTimeout(() => {
        void app.lockNow("idle-timeout");
      }, idleTimeoutMs);
    }
  }

  const app: AppRuntime = {
    client,
    async saveBundle(appId) {
      if (locked) return "cancelled";
      const controller = new AbortController();
      saves.add(controller);
      let transfer: ReturnType<typeof prepareBundle> | undefined;
      try {
        // Start the native picker before an asynchronous preparation can consume activation.
        let supply: (blob: Blob) => void;
        let refuse: (error: unknown) => void;
        const blob = new Promise<Blob>((resolve, reject) => { supply = resolve; refuse = reject; });
        const result = fileSave.save(blob, controller.signal);
        try {
          transfer = prepareBundle(client, (options.spawnIoWorker ?? spawnIoWorker)(), appId, controller.signal);
          void transfer.ready.then((prepared) => { supply(prepared.blob); }, (error: unknown) => { refuse(error); });
        } catch (error) { refuse!(error); }
        const outcome = await result;
        if (outcome === "saved") {
          if (transfer === undefined) return "failed";
          await (await transfer.ready).complete(outcome);
        }
        return outcome;
      } catch { return controller.signal.aborted ? "cancelled" : "failed"; }
      finally {
        controller.abort();
        transfer?.dispose();
        saves.delete(controller);
      }
    },
    async lockNow(reason: LockReason): Promise<void> {
      if (locked) {
        return;
      }
      locked = true;
      for (const controller of saves) controller.abort();
      clearIdleTimer();
      if (client.isRunning) {
        try {
          await client.send({ kind: "lock" });
        } catch {
          // The worker is being terminated either way: an unanswered lock is
          // still a lock, and its failure carries nothing worth reporting.
        }
      }
      client.terminate();
      for (const listener of listeners) {
        listener(reason);
      }
    },
    onLock(listener: (reason: LockReason) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setIdleTimeout(minutes: IdleTimeoutMinutesV1): void {
      idleTimeoutMs = minutes * 60_000;
      restartIdleTimer();
    },
    noteActivity(): void {
      restartIdleTimer();
    },
    dispose(): void {
      locked = true;
      for (const controller of saves) controller.abort();
      clearIdleTimer();
      for (const remove of teardown.splice(0)) {
        remove();
      }
      listeners.clear();
      client.terminate();
    },
  };

  installLifecycleHooks(app, teardown, restartIdleTimer);
  return { kind: "ready", report, app };
}

/**
 * The relock hooks (CAP-03). `pagehide` is the one that matters: it is the
 * last event a page reliably gets on navigation, tab close, and mobile app
 * switching, so it is where "termination re-locks" actually happens.
 * `visibilitychange` only restarts the idle countdown — hiding a tab is not
 * itself a lock, because the idle timeout is off by default and a user who
 * chose "off" must not be logged out for switching tabs.
 */
function installLifecycleHooks(
  app: AppRuntime,
  teardown: (() => void)[],
  restartIdleTimer: () => void,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const onPageHide = (): void => {
    void app.lockNow("pagehide");
  };
  const onVisibilityChange = (): void => {
    restartIdleTimer();
  };

  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  teardown.push(() => {
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });
}
