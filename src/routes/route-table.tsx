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
  useParams,
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
import {
  announceRecordCommand,
  selectAppHomeVm,
  selectChangeHistoryVm,
  selectDeleteRecordDialogVm,
  selectRecordDetailVm,
  selectRecordFormVm,
  selectRecordsListVm,
  selectRestoreRecordDialogVm,
  toCommandOutcomeVm,
  type ChangeHistoryEntryVm,
} from "../application/view-models/records.js";
import type {
  AppSessionViewV1,
  AppTableViewV1,
  ChangeHistoryPageViewV1,
  LibraryAppV1,
  RecordDetailViewV1,
  RecordIssueViewV1,
  RecordPageViewV1,
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
import { AppHomeScreen } from "../ui/records/app-home-screen.js";
import { RecordsScreen } from "../ui/records/records-screen.js";
import { RecordDetailScreen } from "../ui/records/record-detail-screen.js";
import {
  RecordFormScreen,
  type AuthoredEntryIntentV1,
} from "../ui/records/record-form-screen.js";
import { RecordActionsSheet } from "../ui/records/record-actions-sheet.js";
import { DeleteRecordDialog } from "../ui/records/delete-record-dialog.js";
import { ChangeHistoryScreen } from "../ui/records/change-history-screen.js";
import { RestoreRecordDialog } from "../ui/records/restore-record-dialog.js";
import {
  AppFrame,
  type AppIdentity,
  type AppNavigation,
} from "../ui/records/app-frame.js";
import type { FieldTypeVm } from "../ui/records/values.js";
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
  appHistoryPath,
  appHref,
  appPath,
  editRecordPath,
  fallbackRoute,
  guardRoute,
  hashHref,
  isAppAreaPath,
  newRecordPath,
  recordPath,
  tablePath,
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
      <AppArea records={wiring.records} topBarActions={lockAction}>
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
      </AppArea>
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
  const atLanding = vm.screen === "SCR-016";
  const stagePath = atLanding ? ROUTE_PATHS.upload : ROUTE_PATHS.importFlow;
  const onImportPath =
    pathname === ROUTE_PATHS.upload || pathname === ROUTE_PATHS.importFlow;

  /**
   * The run stopped: it refused the file, refused its size, ended, or created
   * the app. Every one of those states still accepts another file — except
   * `done`, which is a top-level final state and accepts nothing — so the
   * actor is replaced once the user has *left* the import area.
   *
   * Leaving is the trigger, not the state, and that ordering is load-bearing:
   * a refusal arriving while the user is still on `#/upload` would otherwise
   * replace the actor that had just produced it, and the refusal would never
   * be seen.
   */
  const runIsOver =
    vm.screen === "SCR-019" ||
    vm.screen === "SCR-021" ||
    (vm.screen === "SCR-022" && !vm.busy) ||
    (vm.screen === "SCR-023" && vm.step === "done");

  useEffect(() => {
    if (runIsOver && !onImportPath) onRunEnded();
  }, [runIsOver, onImportPath, onRunEnded]);

  // The app exists. S08 serves `#/app/:appId`; until it does, CA-07's
  // unknown-route rule lands this on the library, where the new tile is.
  const doneAppId =
    vm.screen === "SCR-023" && vm.step === "done" ? vm.appId : undefined;
  useEffect(() => {
    if (doneAppId === undefined) return;
    void navigate(appPath(doneAppId));
  }, [doneAppId, navigate]);

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

  const goToLibrary = useCallback(() => {
    void navigate(ROUTE_PATHS.library);
  }, [navigate]);

  if (!onImportPath) {
    return children;
  }

  // A deep link lands on the stage the run is actually in, rather than on a
  // screen with nothing behind it: `#/import` with no run in flight is the
  // landing, and `#/upload` during a run is the run.
  if (pathname !== stagePath) {
    return <Navigate replace to={stagePath} />;
  }

  return (
    <ImportStageScreens
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
  onReturnToLibrary,
  onSelectFiles,
  picked,
  send,
  topBarActions,
  vm,
}: {
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
          acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
          onSelectFiles={onSelectFiles}
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
          acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
          onSelectFiles={onSelectFiles}
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
          acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
          onSelectFiles={onSelectFiles}
          onReturnToLibrary={onReturnToLibrary}
          topBarActions={topBarActions}
          vm={vm}
        />
      );
    case "SCR-022":
      return (
        <ImportFailedScreen
          nav={nav}
          acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
          onSelectFiles={onSelectFiles}
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
 * The app area — one opened app, for as long as the user is inside it
 * (CAP-15–CAP-17; CA-07 amendment 2).
 *
 * **The session sits above the router, for the same reason the import actor
 * does.** `#/app/{id}`, its tables, its records and its history are many paths
 * over one opened app: opening is a hydration, and re-hydrating on every
 * navigation between two of those paths would throw away the projection the
 * next screen is about to read. So the app is opened when the area is entered
 * and closed when it is left, and the rest of the unlocked area renders as
 * `children` while no app path is current.
 *
 * **An unknown app id is answered, not hidden.** `openApp` returns
 * `session: null` for an id no catalog entry carries — removed, purged, or
 * never — and that is a *fact to state*, so the area renders the library
 * destination with the truthful notice and the way back. The guard could not
 * do this: CA-07 lets it know the phase and the path and nothing else, so it
 * cannot tell an unknown app from an unknown route.
 */
function AppArea({
  records,
  topBarActions,
  children,
}: {
  readonly records: RecordsServices;
  readonly topBarActions: ReactNode;
  /** The rest of the unlocked area, rendered when no app path is current. */
  readonly children: ReactNode;
}): ReactNode {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/u, "");

  if (!isAppAreaPath(path)) {
    return children;
  }

  const appId = decodeURIComponent(path.split("/")[2] ?? "");
  return (
    <OpenedApp
      appId={appId}
      key={appId}
      records={records}
      topBarActions={topBarActions}
    />
  );
}

type OpenedAppState =
  | { readonly kind: "opening" }
  | { readonly kind: "open"; readonly session: AppSessionViewV1 }
  /** No catalog entry carries this id (CA-12's idempotent read). */
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly error: ErrorVm };

function OpenedApp({
  appId,
  records,
  topBarActions,
}: {
  readonly appId: string;
  readonly records: RecordsServices;
  readonly topBarActions: ReactNode;
}): ReactNode {
  const [state, setState] = useState<OpenedAppState>({ kind: "opening" });
  /**
   * A confirmed write's own sentence, held for the screen the person lands on
   * (M37's `announceRecordCommand`). It is set *after* the worker confirmed a
   * durable commit and never before: invariant 1 is that acknowledgement
   * follows the commit, so an optimistic banner is not a thing this area can
   * render.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped by a write, so counts and rows are re-read rather than guessed. */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    void records.openApp({ appId }).then(
      ({ session }) => {
        if (!live) return;
        setState(
          session === null ? { kind: "absent" } : { kind: "open", session },
        );
      },
      (cause: unknown) => {
        if (live)
          setState({ kind: "failed", error: toErrorVm(toSecurityError(cause)) });
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId, generation]);

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  // An operational write, once per visit: it caches when the app was opened
  // and authors no event (database.md § Events that do not exist).
  useEffect(() => {
    void records.noteAppOpened({ appId });
  }, [records, appId]);

  // Leaving the app frees its projection. Closing an app that is not open is
  // the same request already answered, so this is safe to run unconditionally.
  useEffect(
    () => () => {
      void records.closeApp({ appId });
    },
    [records, appId],
  );

  if (state.kind === "opening") {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Opening this app on this device."
      />
    );
  }

  if (state.kind !== "open") {
    return (
      <AppUnavailable
        {...(state.kind === "failed" ? { error: state.error } : {})}
        topBarActions={topBarActions}
      />
    );
  }

  const { session } = state;
  const identity: AppIdentity = {
    appId,
    displayName: session.displayName,
    theme: session.theme,
  };
  const nav: AppNavigation = {
    library: ROUTE_HREFS.library,
    appHome: appHref(appId),
    appHistory: hashHref(appHistoryPath(appId)),
    tables: session.tables.map((table) => ({
      tableId: table.tableId,
      displayName: table.displayName,
      href: hashHref(tablePath(appId, table.tableId)),
    })),
  };

  const area: AppAreaWiring = {
    identity,
    nav,
    records,
    session,
    topBarActions,
    announce: setNotice,
    refresh,
  };

  return (
    <Routes>
      <Route
        element={
          <AppHomeScreen
            nav={nav}
            newRecordHref={(tableId) => hashHref(newRecordPath(appId, tableId))}
            tableHref={(tableId) => hashHref(tablePath(appId, tableId))}
            topBarActions={topBarActions}
            vm={selectAppHomeVm(session)}
          />
        }
        path="/app/:appId"
      />
      <Route element={<RecordsRoute area={area} />} path="/app/:appId/t/:tableId" />
      <Route
        element={<RecordFormRoute area={area} mode="create" />}
        path="/app/:appId/t/:tableId/new"
      />
      <Route
        element={
          <RecordDetailRoute
            area={area}
            clearNotice={clearNotice}
            {...(notice === null ? {} : { notice })}
          />
        }
        path="/app/:appId/t/:tableId/r/:recordId"
      />
      <Route
        element={<RecordFormRoute area={area} mode="edit" />}
        path="/app/:appId/t/:tableId/r/:recordId/edit"
      />
      <Route
        element={
          <ChangeHistoryRoute
            area={area}
            clearNotice={clearNotice}
            {...(notice === null ? {} : { notice })}
          />
        }
        path="/app/:appId/history"
      />
      <Route element={<Navigate replace to={appPath(appId)} />} path="*" />
    </Routes>
  );
}

/**
 * What every app-area route is given: the open app, where its surfaces live,
 * the worker edge, and the two things a write needs — a way to say what
 * happened once it is durable, and a way to have the app re-read.
 */
interface AppAreaWiring {
  readonly identity: AppIdentity;
  readonly nav: AppNavigation;
  readonly records: RecordsServices;
  readonly session: AppSessionViewV1;
  readonly topBarActions: ReactNode;
  readonly announce: (sentence: string) => void;
  readonly refresh: () => void;
}

/**
 * CA-07 amendment 2's truthful notice: the library destination, saying what
 * happened, with the way back. Nothing here guesses *why* the app is not
 * there — removed, purged, or a link from somewhere else — because the read
 * that answered `null` does not know either.
 */
function AppUnavailable({
  error,
  topBarActions,
}: {
  readonly error?: ErrorVm;
  readonly topBarActions: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  return (
    <UnlockedFrame
      announcement={
        error === undefined
          ? "That app is not on this device."
          : announceRefusal(error)
      }
      area="library"
      nav={nav}
      title="All apps"
      topBarActions={topBarActions}
    >
      <ErrorState
        action={
          <Button
            onPress={() => {
              void navigate(ROUTE_PATHS.library);
            }}
            tone="primary"
          >
            See all apps
          </Button>
        }
        cause={
          error === undefined
            ? "No app on this device carries that address. It may have been removed, or the link may be from another device."
            : announceRefusal(error)
        }
        heading="That app is not on this device."
        variant="recoverable"
      />
    </UnlockedFrame>
  );
}

/** SCR-025/SCR-026 — one table, paged, searched in the projection. */
function RecordsRoute({ area }: { readonly area: AppAreaWiring }): ReactNode {
  const { identity, nav, records, session, topBarActions } = area;
  const { tableId = "" } = useParams();
  const table = session.tables.find(
    (candidate) => candidate.tableId === tableId,
  );

  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<readonly RecordPageViewV1[] | null>(null);
  const [busy, setBusy] = useState(true);

  const appId = identity.appId;

  useEffect(() => {
    if (table === undefined) return undefined;
    let live = true;
    setBusy(true);
    void records
      .queryRecords({
        appId,
        tableId,
        search: search === "" ? null : search,
      })
      .then(
        ({ page }) => {
          if (!live) return;
          setPages(page === null ? [emptyPage(tableId)] : [page]);
          setBusy(false);
        },
        () => {
          // A read that could not be answered is an empty list, not a lie
          // about the count: `emptyPage` states zero for a table it could not
          // read, and the screen offers the first record rather than claiming
          // a search matched nothing.
          if (!live) return;
          setPages([emptyPage(tableId)]);
          setBusy(false);
        },
      );
    return () => {
      live = false;
    };
  }, [records, appId, tableId, search, table]);

  const showMore = useCallback(() => {
    const last = pages?.at(-1);
    if (last === undefined || last.nextCursor === null) return;
    setBusy(true);
    void records
      .queryRecords({
        appId,
        tableId,
        cursor: last.nextCursor,
        search: search === "" ? null : search,
      })
      .then(({ page }) => {
        setBusy(false);
        if (page === null) return;
        setPages((current) => [...(current ?? []), page]);
      });
  }, [records, appId, tableId, search, pages]);

  if (table === undefined) {
    // The app is open and this table is not in it; its home is what is true.
    return <Navigate replace to={appPath(appId)} />;
  }

  const merged = mergePages(pages);
  if (merged === null) {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label={`Reading ${table.displayName} on this device.`}
      />
    );
  }

  return (
    <RecordsScreen
      app={identity}
      busy={busy}
      fieldTypes={fieldTypes(table)}
      nav={nav}
      newRecordHref={hashHref(newRecordPath(appId, tableId))}
      onSearch={setSearch}
      onShowMore={showMore}
      recordHref={(recordId) =>
        hashHref(recordPath(appId, tableId, recordId))
      }
      topBarActions={topBarActions}
      vm={selectRecordsListVm(table, merged)}
    />
  );
}

/**
 * SCR-027 — one record, with SHT-010 and MOD-009 over it.
 *
 * The delete is confirmed, then performed, then *acknowledged from the
 * receipt*: `announceRecordCommand` is M37's sentence for the outcome the
 * worker actually returned, so a rejected or already-deleted record says so
 * rather than pretending (invariant 1, CA-12).
 */
function RecordDetailRoute({
  area,
  notice,
  clearNotice,
}: {
  readonly area: AppAreaWiring;
  readonly notice?: string;
  readonly clearNotice: () => void;
}): ReactNode {
  const { identity, nav, records, session, topBarActions } = area;
  const { tableId = "", recordId = "" } = useParams();
  const navigate = useNavigate();
  const appId = identity.appId;

  const [record, setRecord] = useState<RecordDetailViewV1 | null | undefined>(
    undefined,
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void records.getRecord({ appId, recordId }).then(
      ({ record: found }) => {
        if (live) setRecord(found);
      },
      () => {
        if (live) setRecord(null);
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId, recordId]);

  // The acknowledgement belongs to the arrival, not to the address: leaving
  // this screen is what ends it.
  useEffect(
    () => () => {
      clearNotice();
    },
    [clearNotice],
  );

  const table = session.tables.find(
    (candidate) => candidate.tableId === tableId,
  );
  if (table === undefined) return <Navigate replace to={appPath(appId)} />;

  if (record === undefined) {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Reading this record on this device."
      />
    );
  }

  if (record === null) {
    return (
      <RecordAbsent area={area} tableId={tableId} />
    );
  }

  const vm = selectRecordDetailVm(table, record);
  const deleteVm = selectDeleteRecordDialogVm(vm, busy);

  const confirmDelete = (): void => {
    setBusy(true);
    void records.deleteRecord({ appId, recordId }).then(
      (response) => {
        const outcome = toCommandOutcomeVm(response);
        setBusy(false);
        setDeleting(false);
        area.announce(announceRecordCommand(outcome, "deleted"));
        if (outcome.kind === "rejected") return;
        area.refresh();
        void navigate(tablePath(appId, tableId));
      },
      () => {
        setBusy(false);
        setDeleting(false);
      },
    );
  };

  return (
    <RecordDetailScreen
      app={identity}
      editHref={hashHref(editRecordPath(appId, tableId, recordId))}
      nav={nav}
      onOpenActions={() => {
        setActionsOpen(true);
      }}
      overlays={
        <>
          <RecordActionsSheet
            editHref={hashHref(editRecordPath(appId, tableId, recordId))}
            historyHref={hashHref(appHistoryPath(appId))}
            isOpen={actionsOpen}
            onClose={() => {
              setActionsOpen(false);
            }}
            onDelete={() => {
              setActionsOpen(false);
              setDeleting(true);
            }}
            recordLabel={
              vm.label === null ? "This record" : vm.label.displayName
            }
          />
          <DeleteRecordDialog
            isOpen={deleting}
            onCancel={() => {
              setDeleting(false);
            }}
            onConfirm={confirmDelete}
            vm={deleteVm}
          />
        </>
      }
      recordsHref={hashHref(tablePath(appId, tableId))}
      topBarActions={topBarActions}
      vm={vm}
      {...(notice === undefined ? {} : { notice })}
    />
  );
}

/** A record id this table does not hold — deleted, or never. */
function RecordAbsent({
  area,
  tableId,
}: {
  readonly area: AppAreaWiring;
  readonly tableId: string;
}): ReactNode {
  const navigate = useNavigate();
  return (
    <AppFrame
      announcement="That record is not in this table."
      app={area.identity}
      area="records"
      currentTableId={tableId}
      nav={area.nav}
      title="Record"
      topBarActions={area.topBarActions}
    >
      <ErrorState
        action={
          <Button
            onPress={() => {
              void navigate(tablePath(area.identity.appId, tableId));
            }}
            tone="primary"
          >
            Back to the list
          </Button>
        }
        cause="It may have been deleted. A deleted record stays in this app's change history, where it can be restored."
        heading="That record is not in this table."
        variant="recoverable"
      />
    </AppFrame>
  );
}

/**
 * SCR-028 and SCR-029 — the one form, in its two modes (CAP-16, D23).
 *
 * A refusal is a **result**, so it is caught here as a value: the report's
 * issues go back into the view model, the screen renders them at field level
 * in user language, and nothing was written. Only an `accepted` outcome moves
 * the person, and only after the worker confirmed the commit (invariant 1).
 */
function RecordFormRoute({
  area,
  mode,
}: {
  readonly area: AppAreaWiring;
  readonly mode: "create" | "edit";
}): ReactNode {
  const { identity, nav, records, session, topBarActions } = area;
  const { tableId = "", recordId = "" } = useParams();
  const navigate = useNavigate();
  const appId = identity.appId;

  const [record, setRecord] = useState<RecordDetailViewV1 | null | undefined>(
    mode === "create" ? null : undefined,
  );
  const [issues, setIssues] = useState<readonly RecordIssueViewV1[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "create") return undefined;
    let live = true;
    void records.getRecord({ appId, recordId }).then(
      ({ record: found }) => {
        if (live) setRecord(found);
      },
      () => {
        if (live) setRecord(null);
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId, recordId, mode]);

  const table = session.tables.find(
    (candidate) => candidate.tableId === tableId,
  );
  if (table === undefined) return <Navigate replace to={appPath(appId)} />;

  if (record === undefined) {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Reading this record on this device."
      />
    );
  }

  if (mode === "edit" && record === null) {
    return (
      <RecordAbsent area={area} tableId={tableId} />
    );
  }

  const vm = selectRecordFormVm({
    table,
    busy,
    ...(record === null ? {} : { record }),
    ...(issues === null ? {} : { issues }),
  });

  const save = (entries: readonly AuthoredEntryIntentV1[]): void => {
    setBusy(true);
    const written =
      mode === "create"
        ? records.createRecord({ appId, tableId, values: entries })
        : records.patchRecord({ appId, recordId, changes: entries });

    void written.then(
      (response) => {
        setBusy(false);
        const action = mode === "create" ? "created" : "saved";
        const said = announceRecordCommand(toCommandOutcomeVm(response), action);

        if (response.outcome === "rejected") {
          // D23: the whole report, at field level, and nothing was written.
          setIssues(response.report.issues);
          area.announce(said);
          return;
        }
        if (response.outcome === "unknown-subject") {
          area.announce(said);
          void navigate(tablePath(appId, tableId));
          return;
        }

        // Accepted: the commit is durable, so this is where it is said.
        setIssues(null);
        area.announce(said);
        area.refresh();
        void navigate(
          recordPath(appId, tableId, response.receipt.recordId),
        );
      },
      () => {
        setBusy(false);
      },
    );
  };

  return (
    <RecordFormScreen
      app={identity}
      cancelHref={
        mode === "create"
          ? hashHref(tablePath(appId, tableId))
          : hashHref(recordPath(appId, tableId, recordId))
      }
      nav={nav}
      onSave={save}
      topBarActions={topBarActions}
      vm={vm}
    />
  );
}

/**
 * SCR-032 and MOD-010 — the log, and the restore that makes MOD-009's
 * "recoverable" true (CAP-17, D22).
 */
function ChangeHistoryRoute({
  area,
  notice,
  clearNotice,
}: {
  readonly area: AppAreaWiring;
  readonly notice?: string;
  readonly clearNotice: () => void;
}): ReactNode {
  const { identity, nav, records, session, topBarActions } = area;
  const appId = identity.appId;

  const [pages, setPages] = useState<
    readonly ChangeHistoryPageViewV1[] | null
  >(null);
  const [restoring, setRestoring] = useState<ChangeHistoryEntryVm | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    void records.getChangeHistory({ appId }).then(
      ({ page }) => {
        if (live) setPages(page === null ? [EMPTY_HISTORY] : [page]);
      },
      () => {
        if (live) setPages([EMPTY_HISTORY]);
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId, generation]);

  useEffect(
    () => () => {
      clearNotice();
    },
    [clearNotice],
  );

  const showMore = useCallback(() => {
    const last = pages?.at(-1);
    if (last?.nextCursor == null) return;
    setBusy(true);
    void records
      .getChangeHistory({ appId, cursor: last.nextCursor })
      .then(({ page }) => {
        setBusy(false);
        if (page === null) return;
        setPages((current) => [...(current ?? []), page]);
      });
  }, [records, appId, pages]);

  if (pages === null) {
    return (
      <BusyIndicator
        cancellation="unavailable"
        label="Reading this app's change history."
      />
    );
  }

  const merged = mergeHistory(pages);
  const vm = selectChangeHistoryVm(merged);

  // An app with one table is the F02 shape, and then a record's address is
  // knowable from its id alone. With two, the log does not say which table the
  // record is in, so it does not pretend to.
  const onlyTable = session.tables.length === 1 ? session.tables[0] : undefined;
  const recordHref = (recordId: string): string | null =>
    onlyTable === undefined
      ? null
      : hashHref(recordPath(appId, onlyTable.tableId, recordId));

  const confirmRestore = (): void => {
    if (restoring === null) return;
    setBusy(true);
    void records.restoreRecord({ appId, recordId: restoring.subjectId }).then(
      (response) => {
        setBusy(false);
        setRestoring(null);
        area.announce(
          announceRecordCommand(toCommandOutcomeVm(response), "restored"),
        );
        if (response.outcome === "rejected") return;
        area.refresh();
        setGeneration((current) => current + 1);
      },
      () => {
        setBusy(false);
        setRestoring(null);
      },
    );
  };

  return (
    <ChangeHistoryScreen
      app={identity}
      busy={busy}
      fieldNames={fieldNames(session)}
      nav={nav}
      onRestore={setRestoring}
      onShowMore={showMore}
      overlays={
        restoring === null ? null : (
          <RestoreRecordDialog
            isOpen
            onCancel={() => {
              setRestoring(null);
            }}
            onConfirm={confirmRestore}
            vm={selectRestoreRecordDialogVm(restoring, busy)}
          />
        )
      }
      recordHref={recordHref}
      topBarActions={topBarActions}
      vm={vm}
      {...(notice === undefined ? {} : { notice })}
    />
  );
}

/** A history read that answered nothing: no entries, and no more to come. */
const EMPTY_HISTORY: ChangeHistoryPageViewV1 = Object.freeze({
  entries: [],
  hasMore: false,
  nextCursor: null,
});

function mergeHistory(
  pages: readonly ChangeHistoryPageViewV1[],
): ChangeHistoryPageViewV1 {
  const last = pages.at(-1) ?? EMPTY_HISTORY;
  return { ...last, entries: pages.flatMap((page) => page.entries) };
}

/** Every field in the app, by id, so a log line can name what moved. */
function fieldNames(session: AppSessionViewV1): ReadonlyMap<string, string> {
  return new Map(
    session.tables.flatMap((table) =>
      table.fields.map((field) => [field.fieldId, field.displayName] as const),
    ),
  );
}

/**
 * Pages accumulate; the counts come from the newest one.
 *
 * `totalCount` is the table's, not the page's, so taking the last page's copy
 * is taking the freshest reading of the same number — nothing here adds
 * anything up (CA-14).
 */
function mergePages(
  pages: readonly RecordPageViewV1[] | null,
): RecordPageViewV1 | null {
  if (pages === null) return null;
  const last = pages.at(-1);
  if (last === undefined) return null;
  return { ...last, records: pages.flatMap((page) => page.records) };
}

/** A page for a table whose read answered nothing at all. */
function emptyPage(tableId: string): RecordPageViewV1 {
  return {
    tableId,
    scope: { kind: "table" },
    records: [],
    hasMore: false,
    nextCursor: null,
    totalCount: 0,
    isTotalExact: true,
  };
}

function fieldTypes(table: AppTableViewV1): ReadonlyMap<string, FieldTypeVm> {
  return new Map(table.fields.map((field) => [field.fieldId, field.type]));
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
