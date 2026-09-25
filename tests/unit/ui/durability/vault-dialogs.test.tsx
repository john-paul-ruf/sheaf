import { expect, it, vi } from "vitest";
import { VaultDialog } from "../../../../src/ui/security/vault-dialogs.js";
import { interact, queryAll, render, typeInto } from "../render.js";

const props = { name: "Fieldwork", review: false, busy: false, error: null, codes: null,
  onSubmit: vi.fn(), onClose: vi.fn(), onAcknowledged: vi.fn() };
const button = (name: string) => queryAll<HTMLButtonElement>("button").find((item) => item.textContent === name)!;

it("requires an explicit choice, checks matching secrets, and consumes the drafts", async () => {
  await render(<VaultDialog {...props} />);
  expect(queryAll<HTMLInputElement>('input[type="radio"]').every((input) => !input.checked)).toBe(true);
  expect(button("Continue").disabled).toBe(true);
  await interact(() => { queryAll<HTMLInputElement>('input[type="radio"]')[1]!.click(); });
  await interact(() => { button("Continue").click(); });
  let secrets = queryAll<HTMLInputElement>('input[type="password"]');
  await typeInto(secrets[0]!, "new vault secret"); await typeInto(secrets[1]!, "different");
  await interact(() => { button("Create vault").click(); });
  expect(document.body.textContent).toContain("do not match");
  expect(props.onSubmit).not.toHaveBeenCalled();
  secrets = queryAll<HTMLInputElement>('input[type="password"]');
  expect(secrets.map((input) => input.value)).toEqual(["", ""]);
  await typeInto(secrets[0]!, "new vault secret"); await typeInto(secrets[1]!, "new vault secret");
  await interact(() => { button("Create vault").click(); });
  expect(props.onSubmit).toHaveBeenCalledWith("Fieldwork", "new vault secret", false);
  expect(secrets.map((input) => input.value)).toEqual(["", ""]);
});

it("requires both scoped acknowledgments when the local passphrase is reused", async () => {
  await render(<VaultDialog {...props} codes={{ recoveryCode: "AAA-BBB-CCC", localRecoveryCode: "DDD-EEE-FFF" }} />);
  expect(document.body.textContent).toContain("Two codes, two jobs");
  expect(document.body.textContent).toContain("Local recovery code");
  expect(document.body.textContent).toContain("Fieldwork vault recovery code");
  expect(button("Continue to bundle").disabled).toBe(true);
  const checks = queryAll<HTMLInputElement>('input[type="checkbox"]');
  await interact(() => { checks[0]!.click(); });
  expect(button("Continue to bundle").disabled).toBe(true);
  await interact(() => { checks[1]!.click(); });
  expect(button("Continue to bundle").disabled).toBe(false);
});
