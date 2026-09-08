import type { ReactNode } from "react";
import { cx } from "../primitives/class-names.js";
import styles from "./import.module.css";

/**
 * The three named stages import.html and review.html both draw: Size, Import,
 * Review.
 *
 * design.md §Import and review: "Sizing is visually a distinct stage before
 * parsing", which is only legible if the stages are named in the same order on
 * every screen that has them. One list, three consumers — SCR-018/019,
 * SCR-020, SCR-023.
 *
 * It is a list of *facts about where you are*, not a wizard: nothing here is a
 * control, so a later stage cannot be skipped into by clicking it.
 */

export const IMPORT_STAGES = Object.freeze([
  { id: "size", label: "Size" },
  { id: "import", label: "Import" },
  { id: "review", label: "Review" },
] as const);

export type ImportStageIdV1 = (typeof IMPORT_STAGES)[number]["id"];

export interface ImportStagesProps {
  readonly current: ImportStageIdV1;
}

export function ImportStages({ current }: ImportStagesProps): ReactNode {
  const currentIndex = IMPORT_STAGES.findIndex((stage) => stage.id === current);

  return (
    <ol aria-label="Import stages" className={cx(styles["stages"])}>
      {IMPORT_STAGES.map((stage, index) => {
        const state =
          index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <li className={cx(styles["stage"])} data-state={state} key={stage.id}>
            <span aria-hidden="true" className={cx(styles["stageMark"])}>
              {state === "done" ? "✓" : String(index + 1)}
            </span>
            <span>{stage.label}</span>
            {state === "current" && (
              <span className={cx(styles["badge"])}>Now</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
