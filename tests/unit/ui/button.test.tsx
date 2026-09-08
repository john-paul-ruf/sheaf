import { describe, expect, it, vi } from "vitest";
import { Button, type ButtonTone } from "../../../src/ui/primitives/button.js";
import "../../../src/ui/theme/base.css";
import { interact, query, render, TARGET_MIN } from "./render.js";

const TONES: readonly ButtonTone[] = ["primary", "secondary", "destructive"];

describe("Button — CTL-014 / CTL-016 / CTL-018", () => {
  it.each(TONES)("renders the %s tone with its label", async (tone) => {
    await render(<Button tone={tone}>Unlock offline</Button>);
    const button = query("button");
    expect(button.textContent).toBe("Unlock offline");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("meets the minimum hit area declared by --target-min", async () => {
    await render(<Button tone="primary">Unlock offline</Button>);
    expect(TARGET_MIN).toBe("44px");
    expect(getComputedStyle(query("button")).minHeight).toBe(TARGET_MIN);
  });

  it("fires onPress", async () => {
    const onPress = vi.fn();
    await render(<Button onPress={onPress}>Lock</Button>);
    await interact(() => {
      query("button").click();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("carries a text equivalent whenever it is disabled", async () => {
    await render(
      <Button
        tone="primary"
        isDisabled
        disabledReason="Available after the first workbook import."
      >
        Upload workbook
      </Button>,
    );
    const button = query("button");
    expect(button.hasAttribute("disabled")).toBe(true);

    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Available after the first workbook import.",
    );
  });

  it("does not fire onPress while disabled", async () => {
    const onPress = vi.fn();
    await render(
      <Button isDisabled disabledReason="Nothing to lock yet." onPress={onPress}>
        Lock
      </Button>,
    );
    await interact(() => {
      query("button").click();
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it("states the disabled reason in visible text, not by dimming alone", async () => {
    await render(
      <Button isDisabled disabledReason="Enter the phrase to continue.">
        Reset this device
      </Button>,
    );
    expect(document.body.textContent).toContain(
      "Enter the phrase to continue.",
    );
    // Paper 200 fill, per the session's disabled contract — not `opacity`.
    expect(getComputedStyle(query("button")).opacity).not.toBe("0.5");
  });
});
