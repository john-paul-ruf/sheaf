import { describe, expect, it } from "vitest";
import { SecretScopeLabel } from "../../../src/ui/primitives/secret-scope-label.js";
import {
  StrengthMeter,
  type PassphraseMatch,
  type PassphraseStrength,
} from "../../../src/ui/primitives/strength-meter.js";
import "../../../src/ui/theme/base.css";
import { query, render } from "./render.js";

describe("StrengthMeter — CTL-098 states", () => {
  const STRENGTHS: ReadonlyArray<readonly [PassphraseStrength, string]> = [
    ["weak", "Too easy to guess"],
    ["sufficient", "Strong"],
  ];

  it.each(STRENGTHS)("%s: states the verdict in words", async (strength, label) => {
    await render(
      <StrengthMeter
        strength={strength}
        strengthLabel={label}
        fillPercent={strength === "weak" ? 20 : 84}
      />,
    );
    expect(document.body.textContent).toContain(label);
  });

  const MATCHES: ReadonlyArray<readonly [PassphraseMatch, string]> = [
    ["mismatch", "Does not match"],
    ["matched", "Matched"],
  ];

  it.each(MATCHES)("%s: states the comparison in words", async (match, label) => {
    await render(
      <StrengthMeter
        strength="sufficient"
        strengthLabel="Strong"
        fillPercent={84}
        match={match}
        matchLabel={label}
      />,
    );
    expect(document.body.textContent).toContain(label);
  });

  it("keeps the bar decorative so no state rides on colour alone", async () => {
    await render(
      <StrengthMeter strength="weak" strengthLabel="Too easy to guess" fillPercent={20} />,
    );
    const bar = query('[aria-hidden="true"]');
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    // Removing every colour still leaves the verdict readable.
    expect(document.body.textContent).toContain("Too easy to guess");
  });

  it("clamps a caller's out-of-range percentage", async () => {
    const { rerender, container } = await render(
      <StrengthMeter strength="weak" strengthLabel="Weak" fillPercent={-40} />,
    );
    const fill = (): HTMLElement =>
      container.querySelector<HTMLElement>("[data-strength]") ??
      (() => {
        throw new Error("no fill");
      })();
    expect(fill().style.width).toBe("0%");

    await rerender(
      <StrengthMeter strength="sufficient" strengthLabel="Strong" fillPercent={180} />,
    );
    expect(fill().style.width).toBe("100%");
  });

  it("omits the match badge until the caller has a comparison", async () => {
    await render(
      <StrengthMeter strength="weak" strengthLabel="Weak" fillPercent={10} />,
    );
    expect(document.body.textContent).not.toContain("Matched");
  });
});

describe("SecretScopeLabel — CTL-097 states", () => {
  it("local device: names the scope in text", async () => {
    await render(<SecretScopeLabel scope={{ kind: "local-device" }} />);
    expect(document.body.textContent).toContain("Local · this device");
  });

  it("named vault: carries the vault's own name", async () => {
    await render(
      <SecretScopeLabel
        scope={{ kind: "vault", vaultName: "Dropbox Fieldwork" }}
      />,
    );
    expect(document.body.textContent).toContain("Vault · Dropbox Fieldwork");
  });

  it("hides its glyph from assistive technology, keeping the copy", async () => {
    await render(<SecretScopeLabel scope={{ kind: "local-device" }} />);
    expect(query('[aria-hidden="true"]').textContent).toBe("⌁");
    expect(query("span[data-scope]").textContent).toContain("this device");
  });

  it("distinguishes the two scopes by more than hue", async () => {
    const { rerender } = await render(
      <SecretScopeLabel scope={{ kind: "local-device" }} />,
    );
    const localText = query("span[data-scope]").textContent;

    await rerender(
      <SecretScopeLabel scope={{ kind: "vault", vaultName: "Fieldwork" }} />,
    );
    expect(query("span[data-scope]").textContent).not.toBe(localText);
  });
});
