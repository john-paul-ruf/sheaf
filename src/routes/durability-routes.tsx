import { useLocation, useNavigate } from "react-router";
import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { durabilityMachine, scratchReminderMachine } from "../application/workflows/durability.machine.js";
import type { DurabilityServices } from "../application/workflows/durability-services.js";
import { BundleSaveDialog } from "../ui/durability/bundle-save-dialog.js";
import { createHomeServices, createReminderServices } from "../application/workflows/durability-services.js";
import type { AppRuntime } from "../bootstrap/app-bootstrap.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { HomeScreen } from "../ui/durability/home-screen.js";
import { VaultDialog } from "../ui/security/vault-dialogs.js";
import { formatInstant } from "../ui/records/values.js";
import { ScratchReminderDialog } from "../ui/durability/scratch-reminder-dialog.js";

export function ScratchReminderRoute({ app, appId, appName, generation }: {
  readonly app: AppRuntime; readonly appId: string; readonly appName: string; readonly generation: number;
}): ReactNode {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const services = useMemo(() => createReminderServices(app.client), [app]);
  const [state, send] = useMachine(scratchReminderMachine, { input: { appId, services } });
  useEffect(() => { send({ type: "REFRESH" }); }, [send, pathname, generation]);
  const reminder = state.context.reminder;
  const visible = (state.matches("ready") || state.matches("dismissing")) && reminder?.eligible === true &&
    reminder.appId === appId && reminder.homeId === null && !pathname.endsWith("/backup");
  const wasVisible = useRef(false);
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement === null) {
        const heading = document.querySelector<HTMLElement>("main h1");
        if (heading !== null) { heading.tabIndex = -1; heading.focus(); }
      }
    });
    return () => { cancelAnimationFrame(frame); };
  }, [visible]);
  return <>
    <span hidden data-reminder-state={String(state.value)} data-reminder-query={state.context.queryCount} data-reminder-trigger={reminder?.triggeringCommitId ?? ""}
      data-reminder-dismissals={reminder?.dismissalCount ?? 0} data-reminder-count={reminder?.deviceOnlyChangeCount ?? 0}
      data-reminder-deadline={reminder?.nextEligibleAtEpochMs ?? ""} />
    {state.matches("failed") && <p role="alert">The backup reminder could not be updated. Your saved work is unchanged.</p>}
    {visible && <ScratchReminderDialog appName={appName} count={reminder.deviceOnlyChangeCount} dismissalCount={reminder.dismissalCount}
      busy={state.matches("dismissing")} onDismiss={() => { send({ type: "DISMISS" }); }}
      onChooseHome={() => { void navigate(`/app/${encodeURIComponent(appId)}/backup`); }} />}
  </>;
}

export function HomeDurabilityRoute({ area, app }: { readonly area: AppAreaWiring; readonly app: AppRuntime }): ReactNode {
  const location = useLocation();
  const homes = useMemo(() => createHomeServices(app.client), [app]);
  const [dialog, setDialog] = useState<"create" | "review" | "save" | null>(location.search === "?review=code" ? "review" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<{ recoveryCode: string; localRecoveryCode: string | null } | null>(null);
  const facts = area.session.durability;
  if (facts === undefined) return <p role="alert">Backup status could not be read. Reopen this app to try again.</p>;
  const close = () => { if (busy) return; setDialog(null); setCodes(null); setError(null); };
  return <HomeScreen app={area.identity} nav={area.nav} facts={facts} topBarActions={area.topBarActions}
    onCreate={() => { setDialog("create"); }} onSave={() => { setDialog("save"); }} onReveal={() => { setDialog("review"); }}>
    {(dialog === "create" || dialog === "review") && <VaultDialog name={facts.homeName ?? `${area.identity.displayName} bundle`} review={dialog === "review"}
      busy={busy} error={error} codes={codes} onClose={close} onAcknowledged={() => { setCodes(null); setDialog("save"); }}
      onSubmit={(displayName, passphrase, reuseLocalPassphrase) => {
        setBusy(true); setError(null);
        const operation = dialog === "review" && facts.homeId !== null
          ? homes.reveal(facts.homeId, passphrase).then((result) => ({ ...result, localRecoveryCode: null }))
          : homes.create({ appId: area.identity.appId, displayName, passphrase, reuseLocalPassphrase });
        void operation.then((result) => { setBusy(false); setCodes(result); area.refresh(); },
          () => { setBusy(false); setError("Could not open or create this vault. Check the named passphrase and try again."); });
      }} />}
    {dialog === "save" && <BundleSaveRoute appId={area.identity.appId} appName={area.identity.displayName}
      confirmedAt={facts.confirmedAtMs === null ? "Never confirmed" : formatInstant(facts.confirmedAtMs)} pendingCount={facts.deviceOnlyChangeCount}
      services={app} onClose={close} onSaved={area.refresh} />}
  </HomeScreen>;
}

/** The route owns the live actor; leaving the sheet cancels its save operation. */
export function BundleSaveRoute({ appId, appName, confirmedAt, pendingCount, services, onClose, onSaved }: {
  readonly appId: string;
  readonly appName: string;
  readonly confirmedAt: string;
  readonly pendingCount: number;
  readonly services: DurabilityServices;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): ReactNode {
  const [state, send] = useMachine(durabilityMachine, { input: { appId, services } });
  const stage = typeof state.value === "string" ? state.value : state.value.saving;
  useEffect(() => { if (stage === "savedNative" || stage === "savedUser") onSaved(); }, [stage, onSaved]);
  return <BundleSaveDialog stage={stage} appName={appName} confirmedAt={confirmedAt} pendingCount={pendingCount}
    onStart={() => { send({ type: "START" }); }} onConfirm={() => { send({ type: "CONFIRM" }); }}
    onClose={() => { send({ type: "CANCEL" }); onClose(); }} />;
}
