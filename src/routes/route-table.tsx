import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { useMachine } from "@xstate/react";
import { selectEmptyLibraryVm } from "../application/view-models/library.js";
import {
  selectPassphraseChangeVm,
  selectRecoveryVm,
  selectResetVm,
  selectRevealCodeVm,
  selectSecuritySettingsVm,
  selectSetupVm,
  selectUnlockVm,
  selectWelcomeVm,
} from "../application/view-models/security.js";
import { setupMachine } from "../application/workflows/setup.machine.js";
import { unlockMachine } from "../application/workflows/unlock.machine.js";
import { recoveryMachine } from "../application/workflows/recovery.machine.js";
import { passphraseChangeMachine } from "../application/workflows/passphrase-change.machine.js";
import { revealCodeMachine } from "../application/workflows/reveal-code.machine.js";
import { resetMachine } from "../application/workflows/reset.machine.js";
import { sessionMachine } from "../application/workflows/session.machine.js";
import type { AppRuntime } from "../bootstrap/app-bootstrap.js";
import type { CapabilityReport } from "../platform/capabilities.js";
import type { UnlockedSessionViewV1 } from "../workers/protocol/messages.js";
import { EmptyLibraryScreen } from "../ui/library/empty-library-screen.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { Button } from "../ui/primitives/button.js";
import type { SecurityNavigation } from "../ui/security/frames.js";
import { PassphraseChangeScreen } from "../ui/security/passphrase-change-screen.js";
import {
  RecoveryCodesScreen,
  RevealCodeDialog,
} from "../ui/security/recovery-codes-screen.js";
import { RecoveryScreen } from "../ui/security/recovery-screen.js";
import { ResetLockedScreen } from "../ui/security/reset-locked-screen.js";
import { ResetReadableScreen } from "../ui/security/reset-readable-screen.js";
import { SecuritySettingsScreen } from "../ui/security/security-settings-screen.js";
import { SetupScreen } from "../ui/security/setup-screen.js";
import { UnlockScreen } from "../ui/security/unlock-screen.js";
import { WelcomeScreen } from "../ui/security/welcome-screen.js";
import {
  useSheafRuntime,
  type SecurityWiring,
  type SheafRuntime,
} from "./app-runtime.js";
import {
  ROUTE_HREFS,
  ROUTE_PATHS,
  fallbackRoute,
  guardRoute,
  type SessionPhase,
} from "./guards.js";

/**
 * The F01 route table (M54): hash routes, CA-07's guards, and the composition
 * that turns a machine snapshot into an approved surface.
 *
 * Screens under `src/ui/**` are pure — a view model in, callbacks out. The
 * actors live here for two reasons: a screen may not import a state-machine
 * runtime (the dependency direction `tests/unit/ui/architecture.test.ts`
 * enforces), and the session actor has to outlive navigation between the
 * unlocked screens.
 */

const nav: SecurityNavigation = ROUTE_HREFS;

export function SheafApp(): ReactNode {
  return (
    <HashRouter>
      <SheafRoutes />
    </HashRouter>
  );
}

function SheafRoutes(): ReactNode {
  const runtime = useSheafRuntime();
  const { state } = runtime;

  if (state.kind === "starting") {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Starting Sheaf on this device."
      />
    );
  }

  // CAP-08: the probe refused, so no worker exists and no route is reachable.
  // SCR-001's recoverable variant is the whole application until the runtime
  // provides what it names.
  if (state.kind === "unsupported") {
    return <UnsupportedApp report={state.report} />;
  }

  const { app, phase, report, session, wiring } = state;
  const elsewhere = <Navigate replace to={fallbackRoute(phase)} />;

  // The two halves never coexist: the guard has already refused every path
  // that does not belong to this phase, so the unlocked half can hold the
  // session actor for as long as the session lasts and no longer.
  return (
    <RouteGuard phase={phase}>
      {phase === "unlocked" && session !== undefined ? (
        <UnlockedArea
          app={app}
          elsewhere={elsewhere}
          runtime={runtime}
          session={session}
          wiring={wiring}
        />
      ) : (
        <Routes>
          <Route
            element={<WelcomeRoute report={report} />}
            path={ROUTE_PATHS.welcome}
          />
          <Route
            element={<SetupRoute runtime={runtime} wiring={wiring} />}
            path={ROUTE_PATHS.setup}
          />
          <Route
            element={<UnlockRoute runtime={runtime} wiring={wiring} />}
            path={ROUTE_PATHS.unlock}
          />
          <Route
            element={<RecoveryRoute runtime={runtime} wiring={wiring} />}
            path={ROUTE_PATHS.recover}
          />
          <Route
            element={<ResetLockedRoute runtime={runtime} wiring={wiring} />}
            path={ROUTE_PATHS.resetLocked}
          />
          <Route element={elsewhere} path="*" />
        </Routes>
      )}
    </RouteGuard>
  );
}

function UnsupportedApp({
  report,
}: {
  readonly report: CapabilityReport;
}): ReactNode {
  return (
    <WelcomeScreen
      onProtect={() => {
        // Unreachable: the unsupported variant renders no setup control.
      }}
      vm={selectWelcomeVm(report)}
    />
  );
}

/**
 * CA-07 in one place. The guard sees the phase and the path and nothing else —
 * no provider, no storage fact, no capability — and either renders what was
 * asked for or replaces the entry with the phase's own destination.
 */
function RouteGuard({
  phase,
  children,
}: {
  readonly phase: SessionPhase;
  readonly children: ReactNode;
}): ReactNode {
  const { pathname } = useLocation();
  const verdict = guardRoute(phase, pathname);
  return verdict.kind === "render" ? (
    <>{children}</>
  ) : (
    <Navigate replace to={verdict.to} />
  );
}

function WelcomeRoute({
  report,
}: {
  readonly report: CapabilityReport;
}): ReactNode {
  const navigate = useNavigate();
  return (
    <WelcomeScreen
      onProtect={() => {
        void navigate(ROUTE_PATHS.setup);
      }}
      vm={selectWelcomeVm(report)}
    />
  );
}

function SetupRoute({
  runtime,
  wiring,
}: {
  readonly runtime: SheafRuntime;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const [snapshot, send] = useMachine(setupMachine, {
    input: { services: wiring.services, policy: wiring.policy },
  });
  const { onUnlocked } = runtime;

  // SCR-002 is entered from SCR-001, so its first step is already behind us.
  useEffect(() => {
    if (snapshot.matches("welcome")) {
      send({ type: "BEGIN" });
    }
  }, [snapshot, send]);

  useEffect(() => {
    const session = snapshot.context.session;
    if (snapshot.matches("unlocked") && session !== undefined) {
      onUnlocked(session);
    }
  }, [snapshot, onUnlocked]);

  return (
    <SetupScreen
      onAcknowledgeSaved={(acknowledged) => {
        // One checkbox answers the machine's two questions: the code has been
        // seen, and it has been saved.
        if (snapshot.matches("codeIssued")) {
          send({ type: "CONTINUE" });
        }
        send({ type: "ACKNOWLEDGE_SAVED", acknowledged });
      }}
      onEvaluate={(passphrase, confirmation) => {
        send({ type: "EVALUATE", passphrase, confirmation });
      }}
      onFinish={() => {
        send({ type: "FINISH" });
      }}
      onRetry={() => {
        send({ type: "RETRY" });
      }}
      onSubmit={(passphrase, confirmation) => {
        send({ type: "SUBMIT", passphrase, confirmation });
      }}
      vm={selectSetupVm(snapshot)}
    />
  );
}

function UnlockRoute({
  runtime,
  wiring,
}: {
  readonly runtime: SheafRuntime;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const [snapshot, send] = useMachine(unlockMachine, {
    input: { services: wiring.services, clock: wiring.clock },
  });
  const { onUnlocked } = runtime;

  useEffect(() => {
    const session = snapshot.context.session;
    if (snapshot.matches("unlocked") && session !== undefined) {
      onUnlocked(session);
    }
  }, [snapshot, onUnlocked]);

  return (
    <UnlockScreen
      nav={nav}
      onSubmit={(passphrase) => {
        send({ type: "SUBMIT", passphrase });
      }}
      vm={selectUnlockVm(snapshot)}
    />
  );
}

/**
 * Everything behind the unlock, under one session actor (CAP-03, D13/AD-7).
 *
 * Two countdowns exist and both must agree: this machine's, and the runtime's
 * (M53). Neither is armed from a value the user picked — only from one the
 * worker confirmed it stored — and both end in the same idempotent lock, so a
 * refused settings write can move neither.
 */
function UnlockedArea({
  app,
  elsewhere,
  runtime,
  session,
  wiring,
}: {
  readonly app: AppRuntime;
  /** Where an unlocked path that this build does not serve is sent. */
  readonly elsewhere: ReactNode;
  readonly runtime: SheafRuntime;
  readonly session: UnlockedSessionViewV1;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const [snapshot, send] = useMachine(sessionMachine, {
    input: { services: wiring.services, session },
  });
  const { restart } = runtime;
  const persisted = snapshot.context.idleTimeoutMinutes;

  // Mirror the *adopted* value onto the runtime's timer. `persisted` changes
  // only when the worker answered, so this can never arm optimistically.
  useEffect(() => {
    app.setIdleTimeout(persisted);
  }, [app, persisted]);

  // Whatever locked — this machine, the runtime's idle timer, or pagehide —
  // the page needs a fresh runtime, because a terminated client never returns.
  useEffect(
    () =>
      app.onLock(() => {
        restart();
      }),
    [app, restart],
  );

  useEffect(() => {
    if (snapshot.matches("locked")) {
      void app.lockNow(snapshot.context.lockReason ?? "user");
    }
  }, [snapshot, app]);

  // One handler, both clocks.
  const noteActivity = useCallback(() => {
    send({ type: "ACTIVITY" });
    app.noteActivity();
  }, [app, send]);

  useEffect(() => {
    const onPageHide = (): void => {
      send({ type: "PAGEHIDE" });
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pointerdown", noteActivity);
    window.addEventListener("keydown", noteActivity);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pointerdown", noteActivity);
      window.removeEventListener("keydown", noteActivity);
    };
  }, [send, noteActivity]);

  const lockAction = (
    <Button
      onPress={() => {
        send({ type: "LOCK_NOW" });
      }}
    >
      Lock device
    </Button>
  );

  return (
    <Routes>
      <Route
        element={
          <EmptyLibraryScreen
            nav={nav}
            topBarActions={lockAction}
            vm={selectEmptyLibraryVm()}
          />
        }
        path={ROUTE_PATHS.library}
      />
      <Route
        element={
          <SecuritySettingsScreen
            nav={nav}
            onDismissError={() => {
              send({ type: "DISMISS_SETTINGS_ERROR" });
            }}
            onLockNow={() => {
              send({ type: "LOCK_NOW" });
            }}
            onSetIdleTimeout={(option) => {
              send({ type: "SET_IDLE_TIMEOUT", minutes: option.minutes });
            }}
            topBarActions={lockAction}
            vm={selectSecuritySettingsVm(snapshot)}
          />
        }
        path={ROUTE_PATHS.securitySettings}
      />
      <Route
        element={
          <PassphraseChangeRoute topBarActions={lockAction} wiring={wiring} />
        }
        path={ROUTE_PATHS.passphraseChange}
      />
      <Route
        element={
          <RecoveryCodesRoute topBarActions={lockAction} wiring={wiring} />
        }
        path={ROUTE_PATHS.recoveryCodes}
      />
      <Route
        element={
          <ResetReadableRoute
            runtime={runtime}
            topBarActions={lockAction}
            wiring={wiring}
          />
        }
        path={ROUTE_PATHS.resetReadable}
      />
      <Route element={elsewhere} path="*" />
    </Routes>
  );
}

function RecoveryRoute({
  runtime,
  wiring,
}: {
  readonly runtime: SheafRuntime;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const [snapshot, send] = useMachine(recoveryMachine, {
    input: {
      services: wiring.services,
      policy: wiring.policy,
      codeFormat: wiring.codeFormat,
    },
  });
  const { onUnlocked } = runtime;

  // FR-23: a session opened with the code is not usable until the replacement
  // passphrase is committed, so the unlock is adopted at `done` and not before.
  useEffect(() => {
    const session = snapshot.context.session;
    if (snapshot.matches("done") && session !== undefined) {
      onUnlocked(session);
    }
  }, [snapshot, onUnlocked]);

  return (
    <RecoveryScreen
      nav={nav}
      onSubmitCode={(recoveryCode) => {
        send({ type: "SUBMIT_CODE", recoveryCode });
      }}
      onSubmitPassphrase={(passphrase, confirmation) => {
        send({ type: "SUBMIT_PASSPHRASE", passphrase, confirmation });
      }}
      vm={selectRecoveryVm(snapshot)}
    />
  );
}

function PassphraseChangeRoute({
  topBarActions,
  wiring,
}: {
  readonly topBarActions: ReactNode;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const navigate = useNavigate();
  const [snapshot, send] = useMachine(passphraseChangeMachine, {
    input: { services: wiring.services, policy: wiring.policy },
  });

  useEffect(() => {
    if (snapshot.matches("done")) {
      void navigate(ROUTE_PATHS.securitySettings);
    }
  }, [snapshot, navigate]);

  return (
    <PassphraseChangeScreen
      nav={nav}
      onCancel={() => {
        send({ type: "CANCEL" });
      }}
      onConfirm={() => {
        send({ type: "CONFIRM" });
      }}
      onEvaluate={(nextPassphrase, confirmation) => {
        send({ type: "EVALUATE", nextPassphrase, confirmation });
      }}
      onSubmit={(currentPassphrase, nextPassphrase, confirmation) => {
        send({
          type: "SUBMIT",
          currentPassphrase,
          nextPassphrase,
          confirmation,
        });
      }}
      topBarActions={topBarActions}
      vm={selectPassphraseChangeVm(snapshot)}
    />
  );
}

/**
 * SCR-007's reveal is once per actor: `dismissed` is final, so a second look
 * needs a second machine and therefore a second passphrase entry (MOD-022).
 * The key is what makes that literal — and it sits on the *dialog*, not on the
 * page, so opening a second reveal never replaces the button that opened it.
 */
function RecoveryCodesRoute({
  topBarActions,
  wiring,
}: {
  readonly topBarActions: ReactNode;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const [reveal, setReveal] = useState({ key: 0, isOpen: false });

  return (
    <RecoveryCodesScreen
      // recovery-codes.html, verbatim: what this screen is, in one line.
      announcement="Each code is labelled by what it can recover."
      nav={nav}
      onOpenReveal={() => {
        setReveal((current) => ({ key: current.key + 1, isOpen: true }));
      }}
      revealDialog={
        <RevealSession
          isOpen={reveal.isOpen}
          key={reveal.key}
          onClose={() => {
            setReveal((current) => ({ ...current, isOpen: false }));
          }}
          wiring={wiring}
        />
      }
      topBarActions={topBarActions}
    />
  );
}

function RevealSession({
  isOpen,
  onClose,
  wiring,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const [snapshot, send] = useMachine(revealCodeMachine, {
    input: { services: wiring.services },
  });

  return (
    <RevealCodeDialog
      isOpen={isOpen}
      onClose={() => {
        send({ type: "DISMISS" });
        onClose();
      }}
      onSubmitPassphrase={(currentPassphrase) => {
        send({ type: "SUBMIT", currentPassphrase });
      }}
      vm={selectRevealCodeVm(snapshot)}
    />
  );
}

function ResetLockedRoute({
  runtime,
  wiring,
}: {
  readonly runtime: SheafRuntime;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const navigate = useNavigate();
  const [snapshot, send] = useMachine(resetMachine, {
    input: { services: wiring.services, entry: "locked" },
  });
  const vm = selectResetVm(snapshot);
  const { restart } = runtime;

  useEffect(() => {
    if (snapshot.matches("purged")) {
      // The database is gone; a fresh probe finds no bootstrap row and CA-07's
      // first-run rule lands the user back on SCR-001.
      restart();
    }
  }, [snapshot, restart]);

  if ("purged" in vm || vm.entry !== "locked") {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Destroying this device's encrypted local store."
      />
    );
  }

  return (
    <ResetLockedScreen
      busy={snapshot.matches("purging")}
      nav={nav}
      onAcknowledge={(acknowledged) => {
        send({ type: "ACKNOWLEDGE", acknowledged });
      }}
      onCancel={() => {
        void navigate(ROUTE_PATHS.unlock);
      }}
      onConfirm={() => {
        send({ type: "CONFIRM" });
      }}
      onContinue={() => {
        send({ type: "CONTINUE" });
      }}
      onRetry={() => {
        send({ type: "RETRY" });
      }}
      onTypePhrase={(text) => {
        send({ type: "TYPE_PHRASE", text });
      }}
      vm={vm}
    />
  );
}

function ResetReadableRoute({
  runtime,
  topBarActions,
  wiring,
}: {
  readonly runtime: SheafRuntime;
  readonly topBarActions: ReactNode;
  readonly wiring: SecurityWiring;
}): ReactNode {
  const navigate = useNavigate();
  const [snapshot, send] = useMachine(resetMachine, {
    input: { services: wiring.services, entry: "readable" },
  });
  const vm = selectResetVm(snapshot);
  const { restart } = runtime;

  useEffect(() => {
    if (snapshot.matches("purged")) {
      restart();
    }
  }, [snapshot, restart]);

  if ("purged" in vm || vm.entry !== "readable") {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Destroying this device's encrypted local store."
      />
    );
  }

  return (
    <ResetReadableScreen
      busy={snapshot.matches("purging")}
      nav={nav}
      onAcknowledge={(acknowledged) => {
        send({ type: "ACKNOWLEDGE", acknowledged });
      }}
      onCancel={() => {
        void navigate(ROUTE_PATHS.securitySettings);
      }}
      onConfirm={() => {
        send({ type: "CONFIRM" });
      }}
      onContinue={() => {
        send({ type: "CONTINUE" });
      }}
      onRetry={() => {
        send({ type: "RETRY" });
      }}
      onTypePhrase={(text) => {
        send({ type: "TYPE_PHRASE", text });
      }}
      topBarActions={topBarActions}
      vm={vm}
    />
  );
}
