import { expect, it, vi } from "vitest";
import { BundleSaveDialog } from "../../../../src/ui/durability/bundle-save-dialog.js";
import { interact, queryAll, render } from "../render.js";

const props = { appName: "Fieldwork", confirmedAt: "Never confirmed", pendingCount: 7,
  onStart: vi.fn(), onConfirm: vi.fn(), onClose: vi.fn() };
it("offers confirmation only after delivery and retains the prior receipt facts", async () => {
  const screen = await render(<BundleSaveDialog {...props} stage="preparing" />);
  expect(document.body.textContent).not.toContain("I saved this bundle");
  await screen.rerender(<BundleSaveDialog {...props} stage="awaitingConfirmation" />);
  expect(document.body.textContent).toContain("Never confirmed");
  expect(document.body.textContent).toContain("The bundle was delivered");
  const confirm = queryAll<HTMLButtonElement>("button").find((button) => button.textContent === "I saved this bundle")!;
  await interact(() => { confirm.click(); });
  expect(props.onConfirm).toHaveBeenCalledOnce();
});
it("explicit success names the user as confirmation source and preserves newer edits", async () => {
  await render(<BundleSaveDialog {...props} stage="savedUser" pendingCount={1} />);
  expect(document.body.textContent).toContain("You confirmed that you saved this bundle.");
  expect(document.body.textContent).toContain("1 newer change is");
  expect(document.body.textContent).not.toContain("Save confirmed by the platform.");
});
