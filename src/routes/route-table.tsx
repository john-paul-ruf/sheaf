import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { useMachine } from "@xstate/react";
import {
  selectImportVm,
  type ImportVm,
} from "../application/view-models/import.js";
import { selectLibraryVm } from "../application/view-models/library.js";
import {
  announceRefusal,
  toErrorVm,
  selectPassphraseChangeVm,
  selectRecoveryVm,
  selectResetVm,
  selectRevealCodeVm,
  selectSecuritySettingsVm,
  selectSetupVm,
  selectUnlockVm,
  selectWelcomeVm,
  type ErrorVm,
} from "../application/view-models/security.js";
import { setupMachine } from "../application/workflows/setup.machine.js";
import { unlockMachine } from "../application/workflows/unlock.machine.js";
import { recoveryMachine } from "../application/workflows/recovery.machine.js";
import { passphraseChangeMachine } from "../application/workflows/passphrase-change.machine.js";
import { revealCodeMachine } from "../application/workflows/reveal-code.machine.js";
import { resetMachine } from "../application/workflows/reset.machine.js";
import { sessionMachine } from "../application/workflows/session.machine.js";
import {
  importMachine,
  type ImportEvent,
} from "../application/workflows/import.machine.js";
import { createImportServices } from "../application/workflows/import-services.js";
import type { AppRuntime } from "../bootstrap/app-bootstrap.js";
import { spawnImportWorker } from "../bootstrap/import-worker.js";
import type { CapabilityReport } from "../platform/capabilities.js";
import {
  WORKBOOK_FILE_EXTENSIONS,
  pickWorkbookFile,
  type PickedWorkbookV1,
} from "../platform/file-pick.js";
import type {
  LibraryAppV1,
  UnlockedSessionViewV1,
} from "../workers/protocol/messages.js";
import type { RecordsServices } from "../application/workflows/records-services.js";
import { toSecurityError } from "../application/workflows/services.js";
import { DelimitedTargetScreen } from "../ui/import/delimited-target-screen.js";
import { ImportFailedScreen } from "../ui/import/import-failed-screen.js";
import { ImportProgressScreen } from "../ui/import/import-progress-screen.js";
import { ImportRefusedScreen } from "../ui/import/import-refused-screen.js";
import {
  PreflightFitsScreen,
  PreflightOverBudgetScreen,
} from "../ui/import/preflight-screens.js";
import { ReviewScreen } from "../ui/import/review-screen.js";
import { UploadScreen } from "../ui/import/upload-screen.js";
import { EmptyLibraryScreen } from "../ui/library/empty-library-screen.js";
import { LibraryScreen } from "../ui/library/library-screen.js";
import { LibrarySearchScreen } from "../ui/library/library-search-screen.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { Button } from "../ui/primitives/button.js";
import { ErrorState } from "../ui/primitives/error-state.js";
import { UnlockedFrame, type SecurityNavigation } from "../ui/security/frames.js";
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
  appHref,
  appPath,
  fallbackRoute,
  guardRoute,
  type RoutePath,
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
  // `done` is a top-level final state, so one actor imports one file. A second
  // import in the same session is a second actor, which this key mounts.
  const [importRun, setImportRun] = useState(0);

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
    <ImportArea
      app={app}
      key={importRun}
      onRunEnded={() => {
        setImportRun((current) => current + 1);
      }}
      topBarActions={lockAction}
    >
      <Routes>
        <Route
          element={
            <LibraryRoute records={wiring.records} topBarActions={lockAction} />
          }
          path={ROUTE_PATHS.library}
        />
        <Route
          element={
            <LibrarySearchRoute
              records={wiring.records}
              topBarActions={lockAction}
            />
          }
          path={ROUTE_PATHS.librarySearch}
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
    </ImportArea>
  );
}

/**
 * The import column, composed (D17, PC-12; CAP-09–CAP-12).
 *
 * This is the composition point the feature plan names: it imports
 * `spawnImportWorker` from `src/bootstrap/` — which application code may not —
 * and injects it into S06's services, exactly as `startApp` injects the data
 * worker's constructor. The `MessageChannel` between the two workers is
 * created inside those services, on the page, because neither worker can hand
 * a port back (a response never carries one).
 *
 * **The actor sits above the router, not inside a route.** `#/upload` and
 * `#/import` are two paths over one run, and a run must survive moving between
 * them; the rest of the unlocked area renders as `children` when neither path
 * is current, so `<Routes>` remounts — and the library refetches its catalog —
 * the moment an import ends.
 *
 * **A lock ends the parser.** Locking unmounts this component (the unlocked
 * area goes with the session), so the cleanup terminates the import worker
 * here rather than leaving it parsing into a channel whose other end is gone.
 * Staged bytes are not this component's to remove: S04's unlock sweep owns
 * that, and nothing here blocks or delays the lock (FR-22).
 */
function ImportArea({
  app,
  children,
  onRunEnded,
  topBarActions,
}: {
  readonly app: AppRuntime;
  /** The rest of the unlocked area, rendered when no import path is current. */
  readonly children: ReactNode;
  readonly onRunEnded: () => void;
  readonly topBarActions: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const services = useMemo(
    () => createImportServices({ dataWorker: app.client, spawnImportWorker }),
    [app],
  );
  useEffect(
    () => () => {
      services.terminate();
    },
    [services],
  );

  const [snapshot, send] = useMachine(importMachine, { input: { services } });
  /** The machine keeps no file (a snapshot must hold no cell content), so
   * "Retry same file" needs the handle the picker gave this page. */
  const picked = useRef<PickedWorkbookV1 | null>(null);

  const vm = selectImportVm(snapshot);
  const stagePath: RoutePath =
    vm.screen === "SCR-016" ? ROUTE_PATHS.upload : ROUTE_PATHS.importFlow;
  const onImportPath =
    pathname === ROUTE_PATHS.upload || pathname === ROUTE_PATHS.importFlow;

  // The app exists. S08 serves `#/app/:appId`; until it does, CA-07's
  // unknown-route rule lands this on the library, where the new tile is.
  const done = vm.screen === "SCR-023" && vm.step === "done" ? vm : null;
  const doneAppId = done?.appId;
  useEffect(() => {
    if (doneAppId === undefined) return;
    void navigate(appPath(doneAppId));
    onRunEnded();
  }, [doneAppId, navigate, onRunEnded]);

  const chooseFile = useCallback(
    (files: FileList | null) => {
      const workbook = pickWorkbookFile(files);
      if (workbook === null) return;
      picked.current = workbook;
      send({
        type: "CHOOSE_FILE",
        file: workbook.file,
        fileName: workbook.fileName,
      });
    },
    [send],
  );

  const goToUpload = useCallback(() => {
    void navigate(ROUTE_PATHS.upload);
  }, [navigate]);

  const goToLibrary = useCallback(() => {
    void navigate(ROUTE_PATHS.library);
  }, [navigate]);

  if (!onImportPath) {
    return children;
  }

  // A deep link into the wrong half of the flow lands on the stage the run is
  // actually in, rather than on a screen with nothing behind it.
  if (pathname !== stagePath) {
    return <Navigate replace to={stagePath} />;
  }

  return (
    <ImportStageScreens
      onChooseAnotherFile={goToUpload}
      onReturnToLibrary={goToLibrary}
      onSelectFiles={chooseFile}
      picked={picked.current}
      send={send}
      topBarActions={topBarActions}
      vm={vm}
    />
  );
}

/**
 * One view model in, one approved surface out.
 *
 * The union is exhaustive by construction: `ImportVm`'s members each name
 * their `screen`, so a variant added upstream fails to compile here rather
 * than falling through to a blank page.
 */
function ImportStageScreens({
  onChooseAnotherFile,
  onReturnToLibrary,
  onSelectFiles,
  picked,
  send,
  topBarActions,
  vm,
}: {
  readonly onChooseAnotherFile: () => void;
  readonly onReturnToLibrary: () => void;
  readonly onSelectFiles: (files: FileList | null) => void;
  readonly picked: PickedWorkbookV1 | null;
  readonly send: (event: ImportEvent) => void;
  readonly topBarActions: ReactNode;
  readonly vm: ImportVm;
}): ReactNode {
  switch (vm.screen) {
    case "SCR-016":
      return (
        <UploadScreen
          acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
          nav={nav}
          onSelectFiles={onSelectFiles}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-017":
      return (
        <DelimitedTargetScreen
          nav={nav}
          onChooseAnotherFile={onChooseAnotherFile}
          onContinue={() => {
            send({ type: "CONTINUE" });
          }}
          onSetAppName={(text) => {
            send({ type: "SET_APP_NAME", text });
          }}
          onSetTableName={(text) => {
            send({ type: "SET_TABLE_NAME", text });
          }}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-018":
      return (
        <PreflightFitsScreen
          nav={nav}
          onBack={() => {
            send({ type: "BACK" });
          }}
          onStart={() => {
            send({ type: "START" });
          }}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-019":
      return (
        <PreflightOverBudgetScreen
          nav={nav}
          onChooseAnotherFile={onChooseAnotherFile}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-020":
      return (
        <ImportProgressScreen
          nav={nav}
          onCancel={() => {
            send({ type: "CANCEL" });
          }}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-021":
      return (
        <ImportRefusedScreen
          nav={nav}
          onChooseAnotherFile={onChooseAnotherFile}
          onReturnToLibrary={onReturnToLibrary}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-022":
      return (
        <ImportFailedScreen
          nav={nav}
          onChooseAnotherFile={onChooseAnotherFile}
          onReturnToLibrary={onReturnToLibrary}
          topBarActions={topBarActions}
          vm={vm}
          {...(picked === null
            ? {}
            : {
                onRetrySameFile: () => {
                  send({
                    type: "CHOOSE_FILE",
                    file: picked.file,
                    fileName: picked.fileName,
                  });
                },
              })}
        />
      );
    case "SCR-023":
      // `done` navigates away in `ImportArea`; until that effect runs the
      // model's own announcement is what there is to say.
      return vm.step === "done" ? (
        <BusyIndicator cancellation="unavailable" label={vm.announcement} />
      ) : (
        <ReviewScreen
          nav={nav}
          onApplyEdit={(edit) => {
            send({ type: "APPLY_EDIT", edit });
          }}
          onCancel={() => {
            send({ type: "CANCEL" });
          }}
          onCreateApp={() => {
            send({ type: "CREATE_APP" });
          }}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
  }
}

/**
 * The catalog, read once per mount (CA-09/CAP-14).
 *
 * A rejection is *not* folded into an empty list: "no apps yet" and "the
 * catalog could not be read" are different facts with different next actions,
 * and rendering STA-025's invitation over a failed read would be the one lie
 * this surface must never tell.
 */
type LibraryApps =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly apps: readonly LibraryAppV1[] }
  | { readonly kind: "failed"; readonly error: ErrorVm };

function useLibraryApps(records: RecordsServices): {
  readonly state: LibraryApps;
  readonly reload: () => void;
} {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<LibraryApps>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    void records.listLibrary().then(
      ({ apps }) => {
        if (live) setState({ kind: "ready", apps });
      },
      (cause: unknown) => {
        if (live)
          setState({
            kind: "failed",
            error: toErrorVm(toSecurityError(cause)),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [records, generation]);

  const reload = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  return { state, reload };
}

function LibraryUnavailable({
  error,
  onRetry,
  topBarActions,
}: {
  readonly error: ErrorVm;
  readonly onRetry: () => void;
  readonly topBarActions: ReactNode;
}): ReactNode {
  return (
    <UnlockedFrame
      announcement={announceRefusal(error)}
      area="library"
      nav={nav}
      title="All apps"
      topBarActions={topBarActions}
    >
      <ErrorState
        cause={announceRefusal(error)}
        heading="Sheaf could not list the apps on this device."
        variant="recoverable"
        // Offered only where the worker said retrying can help (CA-04).
        {...(error.retryable
          ? { action: <Button onPress={onRetry}>Try again</Button> }
          : {})}
      />
    </UnlockedFrame>
  );
}

/** SCR-010 when this device holds apps, SCR-011 when it truthfully holds none. */
function LibraryRoute({
  records,
  topBarActions,
}: {
  readonly records: RecordsServices;
  readonly topBarActions: ReactNode;
}): ReactNode {
  const { state, reload } = useLibraryApps(records);

  if (state.kind === "loading") {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Reading the apps on this device."
      />
    );
  }

  if (state.kind === "failed") {
    return (
      <LibraryUnavailable
        error={state.error}
        onRetry={reload}
        topBarActions={topBarActions}
      />
    );
  }

  const vm = selectLibraryVm(state.apps);
  if (vm.kind === "empty") {
    return (
      <EmptyLibraryScreen
        nav={nav}
        topBarActions={topBarActions}
        vm={vm}
      />
    );
  }

  return (
    <LibraryScreen
      appHref={appHref}
      nav={nav}
      searchHref={ROUTE_HREFS.librarySearch}
      topBarActions={topBarActions}
      vm={vm}
    />
  );
}

/**
 * SCR-012. The query is ephemeral view state — it filters a list this device
 * already holds, so it is React state rather than a machine or a URL parameter.
 */
function LibrarySearchRoute({
  records,
  topBarActions,
}: {
  readonly records: RecordsServices;
  readonly topBarActions: ReactNode;
}): ReactNode {
  const [query, setQuery] = useState("");
  const { state, reload } = useLibraryApps(records);

  if (state.kind === "loading") {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Reading the apps on this device."
      />
    );
  }

  if (state.kind === "failed") {
    return (
      <LibraryUnavailable
        error={state.error}
        onRetry={reload}
        topBarActions={topBarActions}
      />
    );
  }

  const vm = selectLibraryVm(state.apps, query);
  // There is nothing to search: STA-025's invitation, not STA-026's no-result.
  if (vm.kind === "empty") {
    return (
      <EmptyLibraryScreen
        nav={nav}
        topBarActions={topBarActions}
        vm={vm}
      />
    );
  }

  return (
    <LibrarySearchScreen
      appHref={appHref}
      nav={nav}
      onSearch={setQuery}
      topBarActions={topBarActions}
      vm={vm}
    />
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
