import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationPhraseField } from "../../../src/ui/primitives/confirmation-phrase-field.js";
import {
  normalizeRecoveryCode,
  RecoveryCodeField,
} from "../../../src/ui/primitives/recovery-code-field.js";
import { TextField } from "../../../src/ui/primitives/text-field.js";
import "../../../src/ui/theme/base.css";
import {
  accessibleName,
  interact,
  query,
  render,
  TARGET_MIN,
  typeInto,
} from "./render.js";

const input = (): HTMLInputElement => query<HTMLInputElement>("input");

const describedText = (element: Element): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("TextField — CTL-023 states", () => {
  it("empty: visible label, no placeholder standing in for it", async () => {
    await render(<TextField label="Workbook name" />);
    expect(accessibleName(input())).toBe("Workbook name");
    expect(input().hasAttribute("placeholder")).toBe(false);
    expect(getComputedStyle(input()).minHeight).toBe(TARGET_MIN);
  });

  it("filled: reports each edit to the caller", async () => {
    const onChange = vi.fn();
    await render(<TextField label="Workbook name" value="" onChange={onChange} />);
    await typeInto(input(), "North Loop canopy");
    expect(onChange).toHaveBeenCalledWith("North Loop canopy");
  });

  it("read-only and disabled are distinguishable states", async () => {
    const { rerender } = await render(
      <TextField label="Workbook name" value="x" isReadOnly />,
    );
    expect(input().readOnly).toBe(true);
    expect(input().disabled).toBe(false);

    await rerender(<TextField label="Workbook name" value="x" isDisabled />);
    expect(input().disabled).toBe(true);
  });

  it("invalid: the message reaches the input's accessible description", async () => {
    await render(
      <TextField
        label="Workbook name"
        value="x"
        isInvalid
        errorMessage="Names cannot be blank."
      />,
    );
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(input())).toContain("Names cannot be blank.");
  });

  it("describes itself without claiming an error", async () => {
    await render(
      <TextField label="Workbook name" description="Shown in your library." />,
    );
    expect(describedText(input())).toContain("Shown in your library.");
    expect(input().getAttribute("aria-invalid")).not.toBe("true");
  });
});

describe("RecoveryCodeField — CTL-028 states", () => {
  const LABEL = "Local recovery code";

  it("grouped entry: renders monospace, uppercase entry with its label", async () => {
    await render(
      <RecoveryCodeField label={LABEL} value="LCL-7G4K-N8RD" onChange={vi.fn()} />,
    );
    expect(accessibleName(input())).toBe(LABEL);
    expect(getComputedStyle(input()).textTransform).toBe("uppercase");
    expect(getComputedStyle(input()).fontFamily).toBe("var(--font-mono)");
  });

  it("pasted: normalises case and whitespace before reporting", async () => {
    const onChange = vi.fn();
    await render(
      <RecoveryCodeField label={LABEL} value="" onChange={onChange} />,
    );
    await typeInto(input(), "  lcl-7g4k n8rd ");
    expect(onChange).toHaveBeenCalledWith("LCL-7G4KN8RD");
  });

  it("accepts a caller-supplied normaliser instead", async () => {
    const onChange = vi.fn();
    await render(
      <RecoveryCodeField
        label={LABEL}
        value=""
        onChange={onChange}
        normalize={(raw) => raw.trim()}
      />,
    );
    await typeInto(input(), "  keep-case  ");
    expect(onChange).toHaveBeenCalledWith("keep-case");
  });

  it("invalid: shows the caller's reason and no acceptance", async () => {
    await render(
      <RecoveryCodeField
        label={LABEL}
        value="LCL-0000"
        onChange={vi.fn()}
        isInvalid
        errorMessage="This code does not open this device."
      />,
    );
    expect(describedText(input())).toContain(
      "This code does not open this device.",
    );
    expect(document.body.textContent).not.toContain("Accepted");
  });

  it("accepted: says so in text, in a live region", async () => {
    await render(
      <RecoveryCodeField
        label={LABEL}
        value="LCL-7G4K-N8RD"
        onChange={vi.fn()}
        isAccepted
      />,
    );
    expect(query('[role="status"]').textContent).toContain("Accepted");
  });

  it("normalizeRecoveryCode is format-agnostic", () => {
    expect(normalizeRecoveryCode(" lcl 7g4k\tn8rd\n")).toBe("LCL7G4KN8RD");
  });
});

describe("ConfirmationPhraseField — CTL-029 states", () => {
  const PHRASE = "DELETE LOCAL";

  it("empty: labels itself with the phrase and flags nothing yet", async () => {
    await render(
      <ConfirmationPhraseField phrase={PHRASE} value="" onChange={vi.fn()} />,
    );
    expect(accessibleName(input())).toBe("Type DELETE LOCAL");
    expect(input().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("mismatch: says it does not match, and does not report a match", async () => {
    const onMatchChange = vi.fn();
    await render(
      <ConfirmationPhraseField
        phrase={PHRASE}
        value="DELETE LOCA"
        onChange={vi.fn()}
        onMatchChange={onMatchChange}
      />,
    );
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(input())).toContain("does not match");
    expect(onMatchChange).not.toHaveBeenCalledWith(true);
  });

  it("match: reports the match so the destructive action can be enabled", async () => {
    const onMatchChange = vi.fn();

    function Harness(): React.ReactNode {
      const [value, setValue] = useState("");
      const [matched, setMatched] = useState(false);
      return (
        <>
          <ConfirmationPhraseField
            phrase={PHRASE}
            value={value}
            onChange={setValue}
            onMatchChange={(next) => {
              setMatched(next);
              onMatchChange(next);
            }}
          />
          <button type="button" disabled={!matched}>
            Reset this device
          </button>
        </>
      );
    }

    await render(<Harness />);
    const confirm = (): HTMLButtonElement =>
      query<HTMLButtonElement>("button:not([aria-pressed])");

    expect(confirm().disabled).toBe(true);

    await typeInto(input(), "DELETE LOCA");
    expect(confirm().disabled).toBe(true);

    await typeInto(input(), PHRASE);
    expect(onMatchChange).toHaveBeenLastCalledWith(true);
    expect(confirm().disabled).toBe(false);
    expect(query('[role="status"]').textContent).toContain("Matched");

    // …and it locks again the moment the phrase stops matching.
    await typeInto(input(), "DELETE LOC");
    expect(confirm().disabled).toBe(true);
  });

  it("tolerates surrounding whitespace but not a different phrase", async () => {
    const onMatchChange = vi.fn();
    const { rerender } = await render(
      <ConfirmationPhraseField
        phrase={PHRASE}
        value="  DELETE LOCAL  "
        onChange={vi.fn()}
        onMatchChange={onMatchChange}
      />,
    );
    expect(onMatchChange).toHaveBeenLastCalledWith(true);

    await rerender(
      <ConfirmationPhraseField
        phrase={PHRASE}
        value="delete local"
        onChange={vi.fn()}
        onMatchChange={onMatchChange}
      />,
    );
    expect(onMatchChange).toHaveBeenLastCalledWith(false);
  });

  it("only announces a match transition once", async () => {
    const onMatchChange = vi.fn();
    await render(
      <ConfirmationPhraseField
        phrase={PHRASE}
        value=""
        onChange={vi.fn()}
        onMatchChange={onMatchChange}
      />,
    );
    await interact(() => {
      /* no state change */
    });
    expect(onMatchChange).toHaveBeenCalledTimes(1);
    expect(onMatchChange).toHaveBeenLastCalledWith(false);
  });
});
