import type { ReactNode } from "react";
import styles from "./strength-meter.module.css";

/** Whether the passphrase clears the caller's injected policy threshold. */
export type PassphraseStrength = "weak" | "sufficient";

/** Whether the confirmation entry equals the passphrase entry. */
export type PassphraseMatch = "mismatch" | "matched";

/**
 * CTL-098 passphrase strength / match.
 *
 * States: weak, sufficient, mismatch, matched. Thresholds are injected — this
 * control renders a verdict, it never computes one. The bar is decorative and
 * `aria-hidden`; the verdict lives in the text labels, so no state is carried
 * by colour alone (design.md §Color palette).
 */
export interface StrengthMeterProps {
  readonly strength: PassphraseStrength;
  /** Caller copy for the verdict, e.g. "Strong". */
  readonly strengthLabel: string;
  /** 0–100, derived by the caller from its policy. */
  readonly fillPercent: number;
  readonly match?: PassphraseMatch;
  readonly matchLabel?: string;
}

export function StrengthMeter({
  strength,
  strengthLabel,
  fillPercent,
  match,
  matchLabel,
}: StrengthMeterProps): ReactNode {
  const width = Math.min(100, Math.max(0, fillPercent));

  return (
    <div className={styles["root"]}>
      <div aria-hidden="true" className={styles["track"]}>
        <div
          className={styles["fill"]}
          data-strength={strength}
          style={{ width: `${String(width)}%` }}
        />
      </div>
      <div className={styles["labels"]}>
        <span className={styles["badge"]} data-state={strength}>
          <span aria-hidden="true">{strength === "sufficient" ? "✓" : "!"}</span>
          {strengthLabel}
        </span>
        {match !== undefined && matchLabel !== undefined && (
          <span className={styles["badge"]} data-state={match}>
            <span aria-hidden="true">{match === "matched" ? "✓" : "!"}</span>
            {matchLabel}
          </span>
        )}
      </div>
    </div>
  );
}
