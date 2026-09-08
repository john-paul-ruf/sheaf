import { describe, expect, it, vi } from "vitest";
import { PassphraseField } from "../../../src/ui/primitives/passphrase-field.js";
import "../../../src/ui/theme/base.css";
import {
  accessibleName,
  interact,
  query,
  render,
  TARGET_MIN,
  typeInto,
} from "./render.js";

const LABEL = "This device's unlock passphrase";

const toggle = (): HTMLButtonElement => query<HTMLButtonElement>("button");
const input = (): HTMLInputElement => query<HTMLInputElement>("input");

describe("PassphraseField — CTL-026 states", () => {
  it("empty: renders a visible label and masks input", async () => {
    await render(<PassphraseField label={LABEL} value="" />);
    expect(input().type).toBe("password");
    expect(input().value).toBe("");
    expect(accessibleName(input())).toBe(LABEL);
    // The label is real text, not a placeholder (design.md §Accessibility).
    expect(document.body.textContent).toContain(LABEL);
    expect(input().hasAttribute("placeholder")).toBe(false);
  });

  it("hidden → revealed → hidden as the toggle is pressed", async () => {
    await render(<PassphraseField label={LABEL} value="field-notebook" />);
    expect(input().type).toBe("password");

    await interact(() => {
      toggle().click();
    });
    expect(input().type).toBe("text");

    await interact(() => {
      toggle().click();
    });
    expect(input().type).toBe("password");
  });

  it("invalid: exposes the error through the input's description", async () => {
    await render(
      <PassphraseField
        label={LABEL}
        value="wrong"
        isInvalid
        errorMessage="That passphrase did not unlock this device."
      />,
    );
    expect(input().getAttribute("aria-invalid")).toBe("true");
    const describedBy = input().getAttribute("aria-describedby") ?? "";
    const described = describedBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("That passphrase did not unlock this device.");
  });

  it("delayed: disables entry and announces the wait", async () => {
    await render(
      <PassphraseField
        label={LABEL}
        value=""
        delayedMessage="Try again in 2 seconds."
      />,
    );

    expect(input().disabled).toBe(true);
    expect(toggle().hasAttribute("disabled")).toBe(true);

    const status = [...document.body.querySelectorAll('[role="status"]')]
      .map((element) => element.textContent ?? "")
      .join(" ");
    expect(status).toContain("Try again in 2 seconds.");
  });

  it("delayed: the secret cannot be submitted with the form", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => {
      event.preventDefault();
    });
    await render(
      <form onSubmit={onSubmit}>
        <PassphraseField
          label={LABEL}
          value="field-notebook"
          delayedMessage="Try again in 2 seconds."
        />
      </form>,
    );

    // A disabled control is excluded from form submission entirely, so the
    // delayed state cannot leak an attempt.
    const form = query<HTMLFormElement>("form");
    expect([...new FormData(form).keys()]).toHaveLength(0);
    expect(input().disabled).toBe(true);
  });

  it("delayed: never leaves the secret revealed", async () => {
    const { rerender } = await render(
      <PassphraseField label={LABEL} value="field-notebook" />,
    );
    await interact(() => {
      toggle().click();
    });
    expect(input().type).toBe("text");

    await rerender(
      <PassphraseField
        label={LABEL}
        value="field-notebook"
        delayedMessage="Try again in 4 seconds."
      />,
    );
    expect(input().type).toBe("password");
  });

  it("reports typing to the caller", async () => {
    const onChange = vi.fn();
    await render(<PassphraseField label={LABEL} value="" onChange={onChange} />);
    await typeInto(input(), "cedar");
    expect(onChange).toHaveBeenCalledWith("cedar");
  });
});

describe("PassphraseField — CTL-027 show/hide control", () => {
  it("names itself against the exact secret it reveals", async () => {
    await render(<PassphraseField label={LABEL} value="x" />);
    expect(accessibleName(toggle())).toBe(`Show ${LABEL}`);

    await interact(() => {
      toggle().click();
    });
    expect(accessibleName(toggle())).toBe(`Hide ${LABEL}`);
  });

  it("announces the change in visibility through a live region", async () => {
    await render(<PassphraseField label={LABEL} value="x" />);
    const liveRegion = (): string =>
      [...document.body.querySelectorAll('[role="status"]')]
        .map((element) => element.textContent ?? "")
        .join(" ");

    expect(liveRegion()).toContain("Passphrase is hidden");
    await interact(() => {
      toggle().click();
    });
    expect(liveRegion()).toContain("Passphrase is visible");
  });

  it("exposes its pressed state and meets the minimum hit area", async () => {
    await render(<PassphraseField label={LABEL} value="x" />);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(getComputedStyle(toggle()).minHeight).toBe(TARGET_MIN);

    await interact(() => {
      toggle().click();
    });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });
});
