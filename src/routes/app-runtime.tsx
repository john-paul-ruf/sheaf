/**
 * The page's composition seam (M54): one live {@link AppRuntime}, the machine
 * services built on it, and the phase the guards read.
 *
 * Why this exists as its own module rather than inside the route table: a lock
 * is a *termination*. `AppRuntime.lockNow` zeroizes in the worker and then
 * kills it, and a terminated `DataWorkerClient` never spawns another — so
 * unlocking again needs a whole new runtime, not a new request. Every relock,
 * every purge, and every "start over" is therefore the same operation: throw
 * the runtime away and start one.
 *
 * The phase is probed, never assumed: `getStatus` reports whether a bootstrap
 * row exists, which is the one fact CA-07's first-run rule turns on.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CapabilityReport } from "../platform/capabilities.js";
import { startApp, type AppRuntime } from "../bootstrap/app-bootstrap.js";
import type { UnlockedSessionViewV1 } from "../workers/protocol/messages.js";
import type { ClockPort } from "../application/ports/clock.js";
import {
  createSecurityServices,
  wordCountPassphrasePolicy,
  type PassphrasePolicyPort,
  type RecoveryCodeFormatPort,
  type SecurityServices,
} from "../application/workflows/services.js";
import {
  createRecordsServices,
  type RecordsServices,
} from "../application/workflows/records-services.js";
import type { SessionPhase } from "./guards.js";

const clock: ClockPort = { nowEpochMs: () => Date.now() };

/**
 * M08's parser behind M36's port (S06's wiring note). Workflows may not import
 * crypto, so the edge is here; the import is dynamic so a page that never
 * reaches SCR-004 never pays for the libsodium WASM bootstrap.
 *
 * A refusal is a *spelling* verdict, not an unlock attempt: catching the throw
 * is the point, because it keeps a mistyped code from costing an attempt-delay
 * step (CA-05).
 */
const recoveryCodeFormat: RecoveryCodeFormatPort = {
  async isWellFormed(recoveryCode: string): Promise<boolean> {
    try {
      const crypto = await import("../crypto/recovery-code.js");
      await crypto.parseRecoveryCode(recoveryCode);
      return true;
    } catch {
      return false;
    }
  },
};

const passphrasePolicy: PassphrasePolicyPort = wordCountPassphrasePolicy;

/**
 * Everything the machines and unlocked routes need, assembled once per runtime.
 *
 * The import services are **not** here: they own a second worker and the
 * channel between it and the data worker, so they are built where that worker
 * may exist — inside the unlocked area of the route table, which is also the
 * only place `spawnImportWorker` may be injected from (D17, M36 must-not).
 */
export interface SecurityWiring {
  readonly services: SecurityServices;
  /** Library, app and record reads. No lifecycle: request in, response out. */
  readonly records: RecordsServices;
  readonly policy: PassphrasePolicyPort;
  readonly codeFormat: RecoveryCodeFormatPort;
  readonly clock: ClockPort;
}

export type RuntimeState =
  /** `startApp()` has not answered yet, or the status probe is in flight. */
  | { readonly kind: "starting" }
  /** CAP-08: a required capability is absent, so no worker was started. */
  | { readonly kind: "unsupported"; readonly report: CapabilityReport }
  | {
      readonly kind: "running";
      readonly report: CapabilityReport;
      readonly app: AppRuntime;
      readonly wiring: SecurityWiring;
      readonly phase: SessionPhase;
      readonly session: UnlockedSessionViewV1 | undefined;
    };

export interface SheafRuntime {
  readonly state: RuntimeState;
  /** A command answered with an open session: adopt it and go unlocked. */
  onUnlocked: (session: UnlockedSessionViewV1) => void;
  /** Terminate this runtime and probe again — the only way back to locked. */
  restart: () => void;
}

export function useSheafRuntime(): SheafRuntime {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<RuntimeState>({ kind: "starting" });

  useEffect(() => {
    let live = true;
    setState({ kind: "starting" });

    const started = startApp();
    if (started.kind === "unsupported") {
      setState({ kind: "unsupported", report: started.report });
      return undefined;
    }

    const { app, report } = started;
    const wiring: SecurityWiring = {
      services: createSecurityServices(app.client),
      records: createRecordsServices(app.client),
      policy: passphrasePolicy,
      codeFormat: recoveryCodeFormat,
      clock,
    };

    void wiring.services.getStatus().then(
      ({ status }) => {
        if (!live) {
          return;
        }
        setState({
          kind: "running",
          report,
          app,
          wiring,
          phase: status.state === "uninitialized" ? "first-run" : "locked",
          session: undefined,
        });
      },
      () => {
        // A worker that cannot answer its own status cannot be trusted to say
        // "no bootstrap row"; the locked screen is the honest default.
        if (!live) {
          return;
        }
        setState({
          kind: "running",
          report,
          app,
          wiring,
          phase: "locked",
          session: undefined,
        });
      },
    );

    return () => {
      live = false;
      app.dispose();
    };
  }, [generation]);

  const onUnlocked = useCallback((session: UnlockedSessionViewV1) => {
    setState((current) =>
      current.kind === "running"
        ? { ...current, phase: "unlocked", session }
        : current,
    );
  }, []);

  const restart = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  return useMemo(
    () => ({ state, onUnlocked, restart }),
    [state, onUnlocked, restart],
  );
}
