import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BusyIndicator } from "../../../src/ui/primitives/busy-indicator.js";
import { Button } from "../../../src/ui/primitives/button.js";
import { ErrorState } from "../../../src/ui/primitives/error-state.js";
import { InlineLink } from "../../../src/ui/primitives/inline-link.js";
import { SelectField } from "../../../src/ui/primitives/select-field.js";
import "../../../src/ui/theme/base.css";
import {
  accessibleName,
  cssRulesFor,
  interact,
  query,
  queryAll,
  render,
  TARGET_MIN,
} from "./render.js";

/*
 * The four primitives added by replan finding F-03. SESSION-07 cannot build
 * screen-local equivalents (architectural invariant 10 + M38 ownership), so
 * each one is gated here.
 */

describe("ErrorState — CTL-087 recoverable (CAP-08)", () => {
  it("names the missing capability inside role=alert", async () => {
    await render(
      <ErrorState
        variant="recoverable"
        heading="This browser cannot store your data safely"
        cause="IndexedDB is unavailable in this browser."
      />,
    );

    const alert = query('[role="alert"]');
    expect(alert.textContent).toContain("IndexedDB is unavailable in this browser.");
    expect(alert.textContent).toContain(
      "This browser cannot store your data safely",
    );
  });

  it("renders a caller-supplied recovery action", async () => {
    const onPress = vi.fn();
    await render(
      <ErrorState
        variant="recoverable"
        heading="Setup cannot continue"
        cause="Dedicated workers are unavailable in this browser."
        action={
          <Button tone="primary" onPress={onPress}>
            Try again
          </Button>
        }
      />,
    );
    await interact(() => {
      query('[role="alert"] button').click();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("carries its state with an icon and text, never colour alone", async () => {
    await render(
      <ErrorState
        variant="recoverable"
        heading="Setup cannot continue"
        cause="WebAssembly is unavailable in this browser."
      />,
    );
    // The glyph is decorative; the whole message survives without it.
    expect(query('[role="alert"] [aria-hidden="true"]')).toBeTruthy();
    expect(query('[role="alert"]').getAttribute("data-variant")).toBe(
      "recoverable",
    );
  });
});

describe("SelectField — CTL-038 (SCR-005 idle timeout)", () => {
  const OPTIONS = [
    { value: "0", label: "Off" },
    { value: "5", label: "5 minutes" },
    { value: "15", label: "15 minutes" },
    { value: "60", label: "1 hour" },
  ] as const;

  const trigger = (): HTMLButtonElement =>
    query<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  const nativeSelect = (): HTMLSelectElement =>
    query<HTMLSelectElement>("select");

  it("renders the four idle-timeout options behind a visible label", async () => {
    await render(
      <SelectField label="Idle timeout" options={OPTIONS} value="0" />,
    );

    expect(document.body.textContent).toContain("Idle timeout");
    expect(accessibleName(trigger())).toContain("Idle timeout");

    const optionLabels = [...nativeSelect().options]
      .map((option) => option.textContent ?? "")
      .filter((text) => text.trim() !== "" && text !== " ");
    expect(optionLabels).toEqual(["Off", "5 minutes", "15 minutes", "1 hour"]);
  });

  it("populated: shows the selected label on the trigger", async () => {
    await render(
      <SelectField label="Idle timeout" options={OPTIONS} value="15" />,
    );
    expect(trigger().textContent).toContain("15 minutes");
  });

  it("empty: shows the placeholder, not a fabricated selection", async () => {
    await render(
      <SelectField
        label="Idle timeout"
        options={OPTIONS}
        value={null}
        placeholder="Not set"
      />,
    );
    expect(trigger().textContent).toContain("Not set");
  });

  it("reports the selected value on change", async () => {
    const onChange = vi.fn();

    function Harness(): React.ReactNode {
      const [value, setValue] = useState<"0" | "5" | "15" | "60">("0");
      return (
        <SelectField
          label="Idle timeout"
          options={OPTIONS}
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }

    await render(<Harness />);
    await interact(() => {
      nativeSelect().value = "15";
      nativeSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("15");
    expect(trigger().textContent).toContain("15 minutes");
  });

  it("open: exposes the listbox and its options", async () => {
    await render(
      <SelectField label="Idle timeout" options={OPTIONS} value="0" />,
    );
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    await interact(() => {
      trigger().click();
    });

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const options = queryAll('[role="option"]');
    expect(options.map((option) => option.textContent)).toEqual([
      "Off",
      "5 minutes",
      "15 minutes",
      "1 hour",
    ]);
  });

  it("invalid option: flags the trigger and states why", async () => {
    await render(
      <SelectField
        label="Idle timeout"
        options={OPTIONS}
        value="0"
        isInvalid
        errorMessage="That timeout is no longer offered."
      />,
    );
    expect(query("[data-invalid]")).toBeTruthy();
    // The reason must reach the trigger's accessible description, not just
    // the page: a red border alone is not a state.
    const describedBy = trigger().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "That timeout is no longer offered.",
    );
  });

  it("offers no free-text entry and meets the minimum hit area", async () => {
    await render(
      <SelectField label="Idle timeout" options={OPTIONS} value="0" />,
    );
    expect(queryAll('input[type="text"]')).toHaveLength(0);
    expect(getComputedStyle(trigger()).minHeight).toBe(TARGET_MIN);
  });
});

describe("InlineLink — CTL-020 (SCR-003 recovery before reset)", () => {
  it("renders an anchor with an accessible name and an href", async () => {
    await render(
      <InlineLink target={{ kind: "internal", href: "#/recover" }}>
        Use local recovery code
      </InlineLink>,
    );
    const link = query<HTMLAnchorElement>("a");
    expect(link.getAttribute("href")).toBe("#/recover");
    expect(accessibleName(link)).toBe("Use local recovery code");
  });

  it("declares a visible focus ring", async () => {
    await render(
      <InlineLink target={{ kind: "internal", href: "#/reset" }}>
        Review reset consequences
      </InlineLink>,
    );
    const link = query<HTMLAnchorElement>("a");
    const focusRules = cssRulesFor(link).filter((rule) =>
      rule.includes("focus-visible"),
    );
    expect(focusRules.length).toBeGreaterThan(0);
    expect(focusRules.join(" ")).toContain("outline: var(--focus-ring)");
  });

  it("stays visited-neutral so an opened route looks unopened", async () => {
    await render(
      <InlineLink target={{ kind: "internal", href: "#/recover" }}>
        Use local recovery code
      </InlineLink>,
    );
    const visited = cssRulesFor(query("a")).filter((rule) =>
      rule.includes(":visited"),
    );
    expect(visited.join(" ")).toContain("var(--color-action)");
  });

  it("preserves the recovery-before-reset order the caller renders", async () => {
    await render(
      <p>
        <InlineLink target={{ kind: "internal", href: "#/recover" }}>
          Use local recovery code
        </InlineLink>
        <InlineLink target={{ kind: "internal", href: "#/reset" }}>
          Review reset consequences
        </InlineLink>
      </p>,
    );
    expect(queryAll("a").map((link) => link.getAttribute("href"))).toEqual([
      "#/recover",
      "#/reset",
    ]);
  });

  it("fails closed on the external-handoff variant", async () => {
    await expect(
      render(
        <InlineLink target={{ kind: "externalHandoff", href: "https://x.test" }}>
          Open in Maps
        </InlineLink>,
      ),
    ).rejects.toThrow(/no approved F01 use/);
  });
});

describe("BusyIndicator — CTL-022 / CTL-088 (Argon2id derive)", () => {
  it("announces its label through a live region and exposes aria-busy", async () => {
    await render(
      <BusyIndicator label="Deriving your key…" cancellation="unavailable" />,
    );

    expect(query('[aria-busy="true"]')).toBeTruthy();
    expect(query('[role="status"]').textContent).toBe("Deriving your key…");
    expect(document.body.textContent).toContain("Deriving your key…");
  });

  it("exposes indeterminate progress, since the KDF cannot report a fraction", async () => {
    await render(
      <BusyIndicator label="Deriving your key…" cancellation="unavailable" />,
    );
    const bar = query('[role="progressbar"]');
    expect(accessibleName(bar)).toBe("Deriving your key…");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("renders no cancel affordance, because cancelling is impossible", async () => {
    await render(
      <BusyIndicator label="Deriving your key…" cancellation="unavailable" />,
    );
    expect(queryAll("button")).toHaveLength(0);
  });

  it("stops its spinner under reduced motion rather than speeding it up", async () => {
    await render(
      <BusyIndicator label="Deriving your key…" cancellation="unavailable" />,
    );
    const spinner = query('[role="progressbar"] > span[aria-hidden="true"]');
    const reduced = cssRulesFor(spinner, { insideMediaQuery: true }).filter(
      (rule) => rule.includes("animation"),
    );
    expect(reduced.join(" ")).toContain("animation: none");
  });
});
