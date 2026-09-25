import { useState, type ReactNode } from "react";
import { Button } from "../primitives/button.js";
import { Dialog } from "../primitives/dialog.js";
import { PassphraseField } from "../primitives/passphrase-field.js";
import { TextField } from "../primitives/text-field.js";
import { RecoveryCodeCard } from "../primitives/recovery-code-card.js";
import { StatusBanner } from "../primitives/status-banner.js";
import styles from "../durability/durability.module.css";

export interface VaultDialogProps {
  readonly name: string;
  readonly review: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly codes: { readonly recoveryCode: string; readonly localRecoveryCode: string | null } | null;
  readonly onSubmit: (name: string, passphrase: string, reuse: boolean) => void;
  readonly onClose: () => void;
  readonly onAcknowledged: () => void;
}

export function VaultDialog({ name, review, busy, error, codes, onSubmit, onClose, onAcknowledged }: VaultDialogProps): ReactNode {
  const [choice, setChoice] = useState<"reuse" | "different" | null>(null);
  const [step, setStep] = useState(review ? "secret" : "choice");
  const [vaultName, setName] = useState(name);
  const [secret, setSecret] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const reuse = choice === "reuse";
  const title = codes !== null ? codes.localRecoveryCode === null ? "Keep your vault recovery code" : "Two codes, two jobs"
    : review ? `Re-view ${vaultName} vault code` : step === "choice" ? `Protect ${vaultName} vault`
      : reuse ? "Use this device’s passphrase" : `Create ${vaultName} vault passphrase`;
  return <Dialog isOpen title={title} isDismissable={!busy} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles["actions"]}>
      <Button onPress={onClose}>Close</Button>
      {codes !== null && (review ? <Button tone="primary" onPress={onClose}>Done</Button> :
        saved && (codes.localRecoveryCode === null || localSaved) ? <Button tone="primary" onPress={onAcknowledged}>Continue to bundle</Button>
          : <Button tone="primary" isDisabled disabledReason="Confirm you saved each labelled recovery code.">Continue to bundle</Button>)}
    </div>}>
    {codes !== null ? <>
      {codes.localRecoveryCode !== null && <RecoveryCodeCard code={codes.localRecoveryCode} scope={{ kind: "local-device" }} title="Local recovery code"
        description="Opens this device’s encrypted store. It does not open a durable-home vault."
        confirmLabel="I saved the local code" isConfirmedSaved={localSaved} onConfirmedSavedChange={setLocalSaved} />}
      <RecoveryCodeCard code={codes.recoveryCode} scope={{ kind: "vault", vaultName }} title={`${vaultName} vault recovery code`}
        description="Opens only this home’s encrypted index and apps on any device. It cannot unlock any device’s local store."
        confirmLabel="I saved this code" isConfirmedSaved={saved} onConfirmedSavedChange={setSaved} />
      <StatusBanner tone="warning" title="If both secrets are lost">If you lose both this vault’s passphrase and its recovery code, this home’s apps are unrecoverable by anyone, including Sheaf.</StatusBanner>
    </> : <form className={styles["stack"]} onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      if (step === "choice") { if (choice !== null) setStep("secret"); return; }
      if (!review && !reuse && secret !== confirmation) { setMismatch(true); setSecret(""); setConfirmation(""); return; }
      onSubmit(vaultName, secret, reuse);
      setSecret(""); setConfirmation(""); setMismatch(false);
    }}>
      {error !== null && <StatusBanner tone="danger" title={error} />}
      {mismatch && <StatusBanner tone="danger" title="The vault passphrases do not match. Enter both again." />}
      {step === "choice" ? <>
        <p>Choose the passphrase for this durable home. This device’s local store stays separately protected.</p>
        <TextField label="Vault name" value={vaultName} onChange={setName} />
        <fieldset className={styles["stack"]}><legend>Vault passphrase choice</legend>
          <label className={styles["choice"]}><input type="radio" name="vault-secret" checked={reuse} onChange={() => { setChoice("reuse"); }} />Use this device’s passphrase</label>
          <label className={styles["choice"]}><input type="radio" name="vault-secret" checked={choice === "different"} onChange={() => { setChoice("different"); }} />Create a different passphrase</label>
        </fieldset>
      </> : <>
        <p>{reuse ? "Enter the local unlock passphrase again. Recovery codes remain separate." : "This passphrase protects this vault. It does not change this device’s local unlock passphrase."}</p>
        <PassphraseField label={reuse ? "This device’s local unlock passphrase" : `${vaultName} vault passphrase`} value={secret} onChange={setSecret} autoComplete={review || reuse ? "current-password" : "new-password"} />
        {!review && !reuse && <PassphraseField label={`Confirm ${vaultName} vault passphrase`} value={confirmation} onChange={setConfirmation} autoComplete="new-password" />}
      </>}
      {busy || (step === "choice" ? choice === null || vaultName.trim() === "" : secret === "" || (!review && !reuse && confirmation === ""))
        ? <Button tone="primary" isDisabled disabledReason={busy ? "Checking the vault secret." : "Complete the fields to continue."}>{busy ? "Checking…" : step === "choice" ? "Continue" : review ? "Reveal vault code" : "Create vault"}</Button>
        : <Button tone="primary" type="submit">{step === "choice" ? "Continue" : review ? "Reveal vault code" : "Create vault"}</Button>}
    </form>}
  </Dialog>;
}
