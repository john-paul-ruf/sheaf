import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../../src/ui/primitives/button.js";
import { Dialog, type DialogKind } from "../../../src/ui/primitives/dialog.js";
import "../../../src/ui/theme/base.css";
import { interact, query, queryAll, render, settle } from "./render.js";

const escape = (): void => {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
  );
};

function Harness({
  kind = "standard",
  isDismissable = true,
  onOpenChange,
}: {
  readonly kind?: DialogKind;
  readonly isDismissable?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}): React.ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button
        onPress={() => {
          setIsOpen(true);
        }}
      >
        Reset this device
      </Button>
      <Dialog
        isDismissable={isDismissable}
        isOpen={isOpen}
        kind={kind}
        onOpenChange={(next) => {
          setIsOpen(next);
          onOpenChange?.(next);
        }}
        title="Reset this device"
        footer={
          <Button
            onPress={() => {
              setIsOpen(false);
            }}
          >
            Cancel
          </Button>
        }
      >
        <p>This erases the encrypted local store.</p>
      </Dialog>
    </>
  );
}

const trigger = (): HTMLButtonElement =>
  queryAll<HTMLButtonElement>("button").find(
    (button) => button.textContent === "Reset this device",
  ) ?? (() => {
    throw new Error("no trigger");
  })();

const open = async (): Promise<void> => {
  // A real user focuses the control they activate; focus restoration has
  // nothing to restore to otherwise.
  await interact(() => {
    trigger().focus();
    trigger().click();
  });
};

describe("Dialog — CTL-109 / CTL-110", () => {
  it("is closed until asked", async () => {
    await render(<Harness />);
    expect(queryAll('[role="dialog"]')).toHaveLength(0);
  });

  it("opens with a title and traps focus inside itself", async () => {
    await render(<Harness />);
    await open();

    const dialog = query('[role="dialog"]');
    expect(dialog.textContent).toContain("Reset this device");
    expect(dialog.textContent).toContain("This erases the encrypted local store.");

    // Focus moved into the dialog, and the rest of the page is hidden from
    // assistive technology while it is open.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(
      queryAll("[aria-hidden='true']").some((element) =>
        element.contains(trigger()),
      ),
    ).toBe(true);
  });

  it("restores focus to the invoking control when it closes", async () => {
    await render(<Harness />);
    await open();
    expect(document.activeElement).not.toBe(trigger());

    await interact(() => {
      query<HTMLButtonElement>('[role="dialog"] button').click();
    });
    await settle();

    expect(queryAll('[role="dialog"]')).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape when cancelling is safe", async () => {
    const onOpenChange = vi.fn();
    await render(<Harness onOpenChange={onOpenChange} />);
    await open();

    await interact(escape);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(queryAll('[role="dialog"]')).toHaveLength(0);
  });

  it("ignores Escape when it is not dismissable", async () => {
    const onOpenChange = vi.fn();
    await render(<Harness isDismissable={false} onOpenChange={onOpenChange} />);
    await open();

    await interact(escape);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(query('[role="dialog"]')).toBeTruthy();
  });

  it("destructive: announces as an alert dialog", async () => {
    await render(<Harness kind="destructive" />);
    await open();

    expect(query('[role="alertdialog"]')).toBeTruthy();
    expect(queryAll('[role="dialog"]')).toHaveLength(0);
  });

  it("destructive: never closes on an outside click", async () => {
    const onOpenChange = vi.fn();
    await render(<Harness kind="destructive" onOpenChange={onOpenChange} />);
    await open();

    const overlay = query('[role="alertdialog"]').closest("div[data-rac]")
      ?.parentElement;
    expect(overlay).toBeTruthy();

    await interact(() => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        overlay?.dispatchEvent(
          new MouseEvent(type, { bubbles: true, button: 0 }),
        );
      }
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(query('[role="alertdialog"]')).toBeTruthy();
  });

  it("standard: an outside click is allowed to dismiss", async () => {
    const onOpenChange = vi.fn();
    await render(<Harness onOpenChange={onOpenChange} />);
    await open();

    const overlay = query('[role="dialog"]').closest("div[data-rac]")
      ?.parentElement;
    await interact(() => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        overlay?.dispatchEvent(
          new MouseEvent(type, { bubbles: true, button: 0 }),
        );
      }
    });

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("leaves no aria-hidden residue on the page after closing", async () => {
    await render(<Harness />);
    await open();
    await interact(escape);

    expect(
      queryAll("[aria-hidden='true']").some((element) =>
        element.contains(trigger()),
      ),
    ).toBe(false);
    expect(document.body.hasAttribute("aria-hidden")).toBe(false);
  });
});
