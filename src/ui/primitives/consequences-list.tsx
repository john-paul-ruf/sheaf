import type { ReactNode } from "react";
import { cx } from "./class-names.js";
import styles from "./consequences-list.module.css";

/** One of CTL-100's three sections. */
export interface ConsequenceSection {
  readonly heading: string;
  readonly items: readonly string[];
}

/**
 * CTL-100 destructive consequences list.
 *
 * Sections: known inventory, encrypted unknowns, survivor facts —
 * design.md §Destructive actions: "show what is known, say what cannot be
 * known, offer backup/bundle/export where possible, then ask".
 *
 * A locked reset supplies `unknownWhileLocked` and omits `known`, because a
 * locked store cannot enumerate its apps and must say so as encryption working
 * as intended. Every string is the caller's; this control never counts
 * anything itself.
 */
export interface ConsequencesListProps {
  /** What this device can actually enumerate right now. */
  readonly known?: ConsequenceSection;
  /** What outlives the action — provider ciphertext, other devices. */
  readonly survives?: ConsequenceSection;
  /** What encryption prevents Sheaf from listing. */
  readonly unknownWhileLocked?: ConsequenceSection;
  readonly className?: string;
}

const KINDS = ["known", "survives", "unknown"] as const;

export function ConsequencesList({
  known,
  survives,
  unknownWhileLocked,
  className,
}: ConsequencesListProps): ReactNode {
  const sections = [known, survives, unknownWhileLocked];

  return (
    <div className={cx(styles["root"], className)}>
      {sections.map((section, index) =>
        section === undefined ? null : (
          <section
            className={cx(styles["section"])}
            data-kind={KINDS[index]}
            key={KINDS[index]}
          >
            <h3 className={cx(styles["heading"])}>{section.heading}</h3>
            <ul className={cx(styles["items"])}>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
