import type { ReactNode } from "react";
import type {
  PassphraseMatchVm,
  PassphraseStrengthVm,
} from "../../application/view-models/security.js";
import { StrengthMeter } from "../primitives/strength-meter.js";

/**
 * CTL-098 as SCR-002, SCR-004 and SCR-006 all show it.
 *
 * The verdict is the machine's; this only names it. setup.html reads
 * "✓ Strong and matched" when both hold, so `sufficient` is "Strong" and the
 * weak label restates the guidance rather than scolding — design.md §Content
 * Patterns: facts, then remedy, never blame.
 *
 * Renders nothing until there is a verdict to render: an untouched field has
 * no strength, and a meter at zero would claim otherwise.
 */
export interface PassphraseVerdictProps {
  readonly strength: PassphraseStrengthVm;
  readonly match: PassphraseMatchVm;
}

export function PassphraseVerdict({
  strength,
  match,
}: PassphraseVerdictProps): ReactNode {
  if (strength === undefined) {
    return null;
  }

  return (
    <StrengthMeter
      strength={strength}
      strengthLabel={
        strength === "sufficient" ? "Strong" : "Use four or more words"
      }
      fillPercent={strength === "sufficient" ? 100 : 33}
      {...(match === undefined
        ? {}
        : {
            match,
            matchLabel: match === "matched" ? "Matched" : "Not matched yet",
          })}
    />
  );
}
