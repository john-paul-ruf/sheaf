import { useLocation } from "react-router";
import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { durabilityMachine } from "../application/workflows/durability.machine.js";
import type { DurabilityServices } from "../application/workflows/durability-services.js";
import { BundleSaveDialog } from "../ui/durability/bundle-save-dialog.js";
import { createHomeServices } from "../application/workflows/durability-services.js";
import type { AppRuntime } from "../bootstrap/app-bootstrap.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { HomeScreen } from "../ui/durability/home-screen.js";
import { VaultDialog } from "../ui/security/vault-dialogs.js";
import { formatInstant } from "../ui/records/values.js";

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
