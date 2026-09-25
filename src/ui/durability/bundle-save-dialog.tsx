import { useEffect, useRef, type ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { cx } from "../primitives/class-names.js";
import { Button } from "../primitives/button.js";
import { StatusBanner } from "../primitives/status-banner.js";
import modal from "../primitives/dialog.module.css";
import styles from "./durability.module.css";

export type BundleSaveStage = "ready" | "preparing" | "delivering" | "awaitingConfirmation" | "confirming"
  | "savedNative" | "savedUser" | "cancelled" | "failed" | "interrupted";
const TITLES: Record<BundleSaveStage, string> = {
  ready: "Save a fresh bundle", preparing: "Preparing encrypted bundle", delivering: "Finish in your save dialog",
  awaitingConfirmation: "Did you save this bundle?", confirming: "Confirming this bundle",
  savedNative: "Bundle saved", savedUser: "Bundle saved", cancelled: "Save cancelled",
  failed: "Bundle could not be saved", interrupted: "Save interrupted",
};

/** MOD-025: delivery offers confirmation, and dismissal never implies success. */
export function BundleSaveDialog({ stage, appName, confirmedAt, pendingCount, onStart, onConfirm, onClose }: {
  readonly stage: BundleSaveStage;
  readonly appName: string;
  readonly confirmedAt: string;
  readonly pendingCount: number;
  readonly onStart: () => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [stage]);
  const busy = ["preparing", "delivering", "confirming"].includes(stage);
  const saved = stage === "savedNative" || stage === "savedUser";
  const failed = stage === "failed" || stage === "interrupted";
  return <ModalOverlay isOpen isDismissable={false} isKeyboardDismissDisabled={false}
    onOpenChange={(open) => { if (!open) onClose(); }} className={cx(modal["overlay"])}>
    <Modal className={cx(modal["modal"])}><Dialog className={cx(modal["dialog"])}>
      <p className={cx(styles["eyebrow"])}>{appName} · Encrypted bundle</p>
      <Heading ref={heading} tabIndex={-1} slot="title" className={cx(styles["title"])}>{TITLES[stage]}</Heading>
      <div className={cx(modal["content"])}>
        {stage === "ready" && <><p>Save an encrypted copy wherever you choose.</p><p>This bundle needs this vault’s passphrase or vault recovery code to open. Save manually after changes. On another device, open the bundle by hand; it cannot be found automatically.</p></>}
        {busy && <StatusBanner tone="info" title={stage === "preparing" ? "Preparing and verifying…" : stage === "confirming" ? "Recording confirmation…" : "Waiting for the platform…"}>Starting a save does not confirm a backup.</StatusBanner>}
        {stage === "awaitingConfirmation" && <><p>The bundle was delivered, but this platform cannot tell Sheaf whether you saved it.</p><StatusBanner tone="warning" title="Save not confirmed">Check that the encrypted file is saved where you intended. A download or share action alone is not confirmation.</StatusBanner><p>Confirm only after saving this delivered bundle. Otherwise, your last confirmed backup stays unchanged.</p></>}
        {saved && <StatusBanner tone="success" title="Backup confirmed">{stage === "savedNative" ? "Save confirmed by the platform." : "You confirmed that you saved this bundle."}</StatusBanner>}
        {(failed || stage === "cancelled") && <StatusBanner tone={failed ? "danger" : "warning"} title="Last confirmation unchanged">{stage === "cancelled" ? "No new backup was confirmed. Your local work is unchanged." : "The save did not finish. Check the destination and try saving a fresh bundle again."}</StatusBanner>}
        <dl className={cx(styles["facts"])}><div><dt>Last confirmed backup</dt><dd>{confirmedAt}</dd></div><div><dt>Changes only on this device</dt><dd>{pendingCount}</dd></div></dl>
        {saved && pendingCount > 0 && <StatusBanner tone="warning" title="Bundle out of date">{pendingCount} newer {pendingCount === 1 ? "change is" : "changes are"} not in this bundle. Save a fresh bundle to include them.</StatusBanner>}
      </div>
      <div className={cx(styles["actions"])}>
        <Button onPress={onClose}>{busy ? "Cancel" : saved ? "Done" : failed || stage === "cancelled" ? "Keep working" : "Not now"}</Button>
        {stage === "awaitingConfirmation" ? <Button tone="primary" onPress={onConfirm}>I saved this bundle</Button>
          : busy ? <Button tone="primary" isDisabled disabledReason="This save is still in progress.">Saving…</Button>
          : !saved || pendingCount > 0 ? <Button tone="primary" onPress={onStart}>{stage === "ready" ? "Choose destination" : saved ? "Save a fresh bundle" : "Try again"}</Button> : null}
      </div>
    </Dialog></Modal>
  </ModalOverlay>;
}
