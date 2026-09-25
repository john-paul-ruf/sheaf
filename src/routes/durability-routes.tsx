import { useMachine } from "@xstate/react";
import { useEffect, type ReactNode } from "react";
import { durabilityMachine } from "../application/workflows/durability.machine.js";
import type { DurabilityServices } from "../application/workflows/durability-services.js";
import { BundleSaveDialog } from "../ui/durability/bundle-save-dialog.js";

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
