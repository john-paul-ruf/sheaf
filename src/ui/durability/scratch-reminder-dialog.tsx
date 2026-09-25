import { useEffect, useRef, type ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../primitives/button.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { cx } from "../primitives/class-names.js";
import modal from "../primitives/dialog.module.css";
import styles from "./durability.module.css";

export function ScratchReminderDialog({ appName, count, dismissalCount, busy, onDismiss, onChooseHome }: {
  readonly appName: string;
  readonly count: number;
  readonly dismissalCount: number;
  readonly busy: boolean;
  readonly onDismiss: () => void;
  readonly onChooseHome: () => void;
}): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <ModalOverlay isOpen isDismissable={false} onOpenChange={(open) => { if (!open && !busy) onDismiss(); }} className={cx(modal["overlay"])}>
    <Modal className={cx(modal["modal"])}><Dialog className={cx(modal["dialog"], styles["reminder"])} data-scratch-reminder>
      <p className={cx(styles["eyebrow"])}>{appName} · Scratch</p>
      <Heading ref={heading} tabIndex={-1} slot="title" className={cx(styles["title"])}>
        {dismissalCount === 0 ? "Your change is saved here. Only here." : `${count} ${count === 1 ? "change still needs" : "changes still need"} a backup.`}
      </Heading>
      <div className={cx(modal["content"])}>
        <p>{dismissalCount === 0 ? "This app is scratch: it has no durable home." : "This app is still scratch. Your work has not been backed up."}</p>
        <StatusBanner tone="warning" title="Scratch · Not backed up">{count} {count === 1 ? "change" : "changes"} only on this device.</StatusBanner>
        <dl className={cx(styles["facts"])}><div><dt>Last confirmed backup</dt><dd>Never confirmed</dd></div></dl>
        <p>If this device’s local data is lost or reset, this scratch app is lost with it.</p>
        <p>Choose a durable home for an encrypted backup. You can dismiss this reminder and keep working.</p>
      </div>
      <div className={cx(styles["actions"])}>
        <Button {...(busy ? { isDisabled: true, disabledReason: "Saving this dismissal." } : {})} onPress={onDismiss}>{busy ? "Saving dismissal…" : "Keep working"}</Button>
        <Button tone="primary" {...(busy ? { isDisabled: true, disabledReason: "Saving this dismissal." } : {})} onPress={onChooseHome}>Choose a durable home</Button>
      </div>
    </Dialog></Modal>
  </ModalOverlay>;
}
