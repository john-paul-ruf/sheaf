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

import { probeCapabilities, type CapabilityReport } from "../platform/capabilities.js";
import { DataWorkerClient } from "../workers/protocol/client.js";
import type { UnlockedSessionViewV1 } from "../workers/protocol/messages.js";

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
  /** Zeroizes in the worker, then terminates it. Safe to call twice. */
  lockNow(reason: LockReason): Promise<void>;
  onLock(listener: (reason: LockReason) => void): () => void;
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
  const listeners = new Set<(reason: LockReason) => void>();
  let locked = false;

  const app: AppRuntime = {
    client,
    async lockNow(reason: LockReason): Promise<void> {
      if (locked) {
        return;
      }
      locked = true;
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
    dispose(): void {
      listeners.clear();
      client.terminate();
    },
  };

  return { kind: "ready", report, app };
}
