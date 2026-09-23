import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { AppAreaWiring } from "../../../../src/routes/app-area-hooks.js";
import { ThemeRoute } from "../../../../src/routes/theme-routes.js";
import { BUILT_IN_PALETTES } from "../../../../src/import/staging/theme.js";
import type { AppThemeWireV1 } from "../../../../src/workers/protocol/messages.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render, settle, typeInto } from "../render.js";
import { identity } from "./fixtures.js";
import { button, fakeSchema, fakeTheme, press, session, wiring } from "./harness.js";

/**
 * SCR-036 as rendered through its route (S08 CP3; theme.html; CAP-37, CA-32):
 * the live verdict names what fails and holds the save, a refused logo says
 * why and leaves the initials, and a save is sent once and acknowledged only
 * by the worker's answer.
 */

const indigo = BUILT_IN_PALETTES.find((palette) => palette.key === "indigo")!;
const indigoTheme: AppThemeWireV1 = { themeKey: "indigo", tokens: indigo.light, darkTokens: indigo.dark };

async function open(input: { readonly stored?: AppThemeWireV1; readonly theme?: ReturnType<typeof fakeTheme> } = {}) {
  const stored = input.stored ?? indigoTheme;
  const area: AppAreaWiring = wiring(fakeSchema(), {
    identity: { ...identity, theme: stored },
    session: { ...session(), theme: stored, glyph: "FL" },
    theme: input.theme ?? fakeTheme(),
  });
  await render(
    <MemoryRouter initialEntries={["/app/app-1/theme"]}>
      <ThemeRoute area={area} />
    </MemoryRouter>,
  );
  await settle();
  return area;
}

const save = (): HTMLButtonElement => button("Save theme locally");

async function choose(label: string): Promise<void> {
  const radio = queryAll<HTMLLabelElement>("label")
    .find((candidate) => candidate.textContent?.replace("✓ ", "") === label)
    ?.querySelector("input");
  if (radio === null || radio === undefined) throw new Error(`No choice labelled ${label}`);
  await interact(() => {
    radio.click();
  });
}

describe("SCR-036 — the theme editor (CAP-37)", () => {
  it("names every palette, and holds a save until something changes", async () => {
    await open();
    expect(query('[data-screen="SCR-036"] h1').textContent).toBe("Theme Field Log.");
    for (const name of ["Cedar", "Indigo", "Clay", "Graphite"]) {
      expect(queryAll("label").some((label) => label.textContent?.includes(name)), name).toBe(true);
    }
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain("Change the theme first.");
    expect(document.body.textContent).toContain("Contrast passes");
  });

  it("disables save and names the failing pair when a custom accent fails contrast", async () => {
    await open();
    await choose("Dark");
    await typeInto(query<HTMLInputElement>('input[type="color"]'), "#1b2130");

    expect(save().disabled).toBe(true);
    const failing = "Contrast fails: Accent / canvas (dark), Accent / surface (dark)";
    expect(query('[role="alert"]').textContent).toContain(failing);
    // The reason is the save's own, not only the banner's.
    expect(save().closest("div")?.parentElement?.textContent).toContain(failing);
  });

  it("says why a logo was refused, and keeps the initials", async () => {
    await open({ theme: fakeTheme({ logos: [{ kind: "refused", reason: "over-bytes" }] }) });
    const input = query<HTMLInputElement>('input[type="file"]');
    expect(input.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
    await interact(() => {
      Object.defineProperty(input, "files", { value: [new File(["x"], "logo.png", { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(document.body.textContent).toContain("This image is over 64 KiB even at 256 × 256 pixels, so the initials remain.");
    expect(query('[data-theme-preview] [aria-hidden="true"]').textContent).toBe("FL");
    expect(queryAll("[data-theme-preview] img")).toHaveLength(0);
  });

  it("previews a prepared logo in place of the initials, and can remove it", async () => {
    const logo = { pngBase64: "iVBORw0KGgo=", width: 40, height: 20 };
    await open({ theme: fakeTheme({ logos: [{ kind: "ready", logo }] }) });
    const input = query<HTMLInputElement>('input[type="file"]');
    await interact(() => {
      Object.defineProperty(input, "files", { value: [new File(["x"], "logo.png", { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(query<HTMLImageElement>("[data-theme-preview] img").getAttribute("src")).toBe(`data:image/png;base64,${logo.pngBase64}`);
    expect(save().disabled).toBe(false);

    await press("Remove logo");
    expect(queryAll("[data-theme-preview] img")).toHaveLength(0);
  });

  it("saves the draft once, and says so only after the worker answers", async () => {
    let answer: (value: Awaited<ReturnType<ReturnType<typeof fakeTheme>["changeTheme"]>>) => void = () => undefined;
    const theme = {
      ...fakeTheme(),
      changeTheme: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<ReturnType<typeof fakeTheme>["changeTheme"]>>>((resolve) => {
            answer = resolve;
          }),
      ),
    };
    const area = await open({ theme });
    await choose("Graphite");
    await choose("Follow device");
    await choose("Compact");
    await press("Save theme locally");

    expect(theme.changeTheme).toHaveBeenCalledTimes(1);
    expect(theme.changeTheme).toHaveBeenCalledWith({
      appId: identity.appId,
      themeKey: "graphite",
      mode: "system",
      density: "compact",
      customAccent: null,
      logo: { kind: "keep" },
    });
    expect(area.announce).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Saving on this device.");

    await interact(() => {
      answer({ kind: "changeTheme", outcome: { result: "changed", theme: indigoTheme } });
    });
    await settle();
    expect(area.announce).toHaveBeenCalledWith("Saved on this device.");
    expect(area.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal and announces nothing", async () => {
    const theme = fakeTheme({
      outcomes: [{ result: "refused", refusal: { kind: "contrast", failures: [{ mode: "dark", pair: "accent-canvas", ratio: 1.1, minimum: 3 }] } }],
    });
    const area = await open({ theme });
    await choose("Clay");
    await press("Save theme locally");
    await settle();
    expect(query('[role="alert"]').textContent).toContain("Contrast fails: Accent / canvas (dark)");
    expect(area.announce).not.toHaveBeenCalled();
    expect(area.refresh).not.toHaveBeenCalled();
  });

  it("asks an app on the F02 theme to choose a palette first", async () => {
    await open({ stored: identity.theme });
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose a palette first.");
    await choose("Cedar");
    expect(save().disabled).toBe(false);
  });
});
