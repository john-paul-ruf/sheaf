import { useState, type ReactNode } from "react";
import { Button } from "./button.js";
import { cx } from "./class-names.js";
import styles from "./recovery-code-card.module.css";
import { SecretScopeLabel, type SecretScope } from "./secret-scope-label.js";

/**
 * Masks every group but the first and last, so the code's shape stays legible
 * while its content does not — the hidden state in the control atlas.
 */
export function maskRecoveryCode(code: string): string {
  const groups = code.split("-");
  if (groups.length <= 2) return code;

  return groups
    .map((group, index) =>
      index === 0 || index === groups.length - 1
        ? group
        : "•".repeat(group.length),
    )
    .join("-");
}

/**
 * CTL-096 recovery-code card.
 *
 * States: hidden, revealed, copied, printed, confirmed saved. Reveal, copy and
 * print are local affordances this control owns; "confirmed saved" is a
 * workflow fact, so it is lifted to the caller that gates setup on it.
 *
 * The code itself is plaintext with the narrowest possible lifetime
 * (architectural invariant 3) — it is rendered, never stored here.
 */
export interface RecoveryCodeCardProps {
  readonly code: string;
  readonly scope: SecretScope;
  readonly title: string;
  readonly description?: ReactNode;
  readonly isConfirmedSaved: boolean;
  readonly onConfirmedSavedChange: (isConfirmedSaved: boolean) => void;
  readonly confirmLabel: string;
  readonly confirmDetail?: string;
  /** Defaults to the async clipboard; injectable so tests never touch it. */
  readonly onCopy?: (code: string) => Promise<void>;
  /** Defaults to `window.print`. */
  readonly onPrint?: () => void;
  readonly revealLabel?: string;
  readonly copyLabel?: string;
  readonly printLabel?: string;
}

async function copyToClipboard(code: string): Promise<void> {
  await navigator.clipboard.writeText(code);
}

export function RecoveryCodeCard({
  code,
  scope,
  title,
  description,
  isConfirmedSaved,
  onConfirmedSavedChange,
  confirmLabel,
  confirmDetail,
  onCopy = copyToClipboard,
  onPrint,
  revealLabel = "Reveal",
  copyLabel = "Copy code",
  printLabel = "Print",
}: RecoveryCodeCardProps): ReactNode {
  const [isRevealed, setIsRevealed] = useState(false);
  const [receipt, setReceipt] = useState<string | undefined>(undefined);

  const print = (): void => {
    if (onPrint !== undefined) {
      onPrint();
    } else {
      window.print();
    }
    setReceipt("Printed");
  };

  return (
    <section className={cx(styles["root"])}>
      <div className={cx(styles["header"])}>
        <h2 className={cx(styles["title"])}>{title}</h2>
        <SecretScopeLabel scope={scope} />
      </div>
      {description !== undefined && <div>{description}</div>}

      <output aria-label={title} className={cx(styles["code"])}>
        {isRevealed ? code : maskRecoveryCode(code)}
      </output>

      <div className={cx(styles["actions"])}>
        {!isRevealed && (
          <Button
            onPress={() => {
              setIsRevealed(true);
            }}
          >
            {revealLabel}
          </Button>
        )}
        <Button
          onPress={() => {
            void onCopy(code).then(
              () => {
                setReceipt("Copied");
              },
              () => {
                setReceipt("Copying is unavailable — write the code down.");
              },
            );
          }}
        >
          {copyLabel}
        </Button>
        <Button onPress={print}>{printLabel}</Button>
      </div>

      {receipt !== undefined && (
        <p className={cx(styles["receipt"])} role="status">
          {receipt}
        </p>
      )}

      <label className={cx(styles["confirm"])}>
        <input
          checked={isConfirmedSaved}
          className={cx(styles["checkbox"])}
          onChange={(event) => {
            onConfirmedSavedChange(event.target.checked);
          }}
          type="checkbox"
        />
        <span className={cx(styles["confirmCopy"])}>
          <strong>{confirmLabel}</strong>
          {confirmDetail !== undefined && (
            <span className={cx(styles["confirmDetail"])}>{confirmDetail}</span>
          )}
        </span>
      </label>
    </section>
  );
}
