import { expect, it, vi } from "vitest";
import { RecoveryScreen } from "../../../src/ui/security/recovery-screen.js";
import type { RecoveryVm } from "../../../src/application/view-models/security.js";
import { interact, query, render, typeInto } from "./render.js";
import type { SecurityNavigation } from "../../../src/ui/security/frames.js";

const nav: SecurityNavigation = { library: "#/library", unlock: "#/unlock", welcome: "#/", setup: "#/setup", recover: "#/recover", resetLocked: "#/reset", securitySettings: "#/settings/security", passphraseChange: "#/settings/passphrase", recoveryCodes: "#/settings/recovery-codes", resetReadable: "#/settings/reset" };
const vm: Extract<RecoveryVm, { step: "enterCode" }> = { screen: "SCR-004", step: "enterCode", codeScope: "Local recovery code", codeReach: "This device only", losslessFact: "Reset is not involved.", codeMisspelled: false, error: { kind: "invalid-recovery-code", retryable: false }, announcement: "Wait before trying again.", remainingMs: 4000, remainingSeconds: 4, canSubmit: false };

it("renders the decreasing wait, refuses early submit, then consumes the code on retry", async () => {
  const submit = vi.fn();
  const props = { nav, onSubmitCode: submit, onSubmitPassphrase: vi.fn() };
  const mounted = await render(<RecoveryScreen {...props} vm={vm} />);
  expect(query("[data-recovery-wait]").textContent).toContain("4 seconds");
  const form = query<HTMLFormElement>("form");
  await interact(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(submit).not.toHaveBeenCalled();
  await mounted.rerender(<RecoveryScreen {...props} vm={{ ...vm, remainingMs: 3000, remainingSeconds: 3 }} />);
  expect(query("[data-recovery-wait]").textContent).toContain("3 seconds");
  await mounted.rerender(<RecoveryScreen {...props} vm={{ ...vm, remainingMs: 0, remainingSeconds: 0, canSubmit: true }} />);
  const input = query<HTMLInputElement>("input");
  await typeInto(input, "local-code");
  await interact(() => { query<HTMLButtonElement>('button[type="submit"]').click(); });
  expect(submit).toHaveBeenCalledWith("LOCAL-CODE");
  expect(input.value).toBe("");
});
