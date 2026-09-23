/**
 * M36's theme edge (CAP-37, D56): the two RPCs go to the worker as they were
 * given, and the page-side logo step refuses what it cannot take — with the
 * reason the editor shows — before anything is sent.
 */

import { describe, expect, it, vi } from "vitest";
import { createThemeServices, type LogoCodecPort } from "../../../src/application/workflows/theme-services.js";
import type { RecordsWorkerPort } from "../../../src/application/workflows/records-services.js";

function port() {
  const send = vi.fn((request: { readonly kind: string }) => Promise.resolve({ kind: request.kind }));
  return { send: send as unknown as RecordsWorkerPort["send"], calls: send };
}

const codec = (result: Awaited<ReturnType<LogoCodecPort["toPng"]>> | Error): LogoCodecPort & { toPng: ReturnType<typeof vi.fn> } => ({
  toPng: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
});

const png = (type = "image/png") => new Blob([new Uint8Array([1, 2, 3])], { type });

describe("the theme RPCs", () => {
  it("send the palettes read and the save as they were given", async () => {
    const worker = port();
    const services = createThemeServices(worker);
    await services.listThemePalettes();
    await services.changeTheme({
      appId: "a",
      themeKey: "indigo",
      mode: "dark",
      density: "compact",
      customAccent: null,
      logo: { kind: "keep" },
    });
    expect(worker.calls.mock.calls.map(([request]) => request)).toEqual([
      { kind: "listThemePalettes" },
      { kind: "changeTheme", appId: "a", themeKey: "indigo", mode: "dark", density: "compact", customAccent: null, logo: { kind: "keep" } },
    ]);
  });
});

describe("preparing a logo on the page (D56)", () => {
  it("re-encodes an accepted image at most 256 px, as base64 PNG", async () => {
    const fake = codec({ bytes: new Uint8Array([137, 80, 78, 71]), width: 256, height: 128 });
    const prepared = await createThemeServices(port(), fake).prepareLogo(png("image/jpeg"));
    expect(fake.toPng).toHaveBeenCalledWith(expect.any(Blob), 256);
    expect(prepared).toEqual({ kind: "ready", logo: { pngBase64: btoa(String.fromCharCode(137, 80, 78, 71)), width: 256, height: 128 } });
  });

  it("refuses a file type theme.html does not accept, without decoding it", async () => {
    const fake = codec({ bytes: new Uint8Array(1), width: 1, height: 1 });
    expect(await createThemeServices(port(), fake).prepareLogo(png("image/svg+xml"))).toEqual({ kind: "refused", reason: "unreadable" });
    expect(fake.toPng).not.toHaveBeenCalled();
  });

  it("refuses an image that cannot be decoded", async () => {
    expect(await createThemeServices(port(), codec(new Error("broken"))).prepareLogo(png())).toEqual({
      kind: "refused",
      reason: "unreadable",
    });
  });

  it("refuses a PNG still over 64 KiB, and takes one exactly at it", async () => {
    const over = codec({ bytes: new Uint8Array(64 * 1024 + 1), width: 256, height: 256 });
    expect(await createThemeServices(port(), over).prepareLogo(png())).toEqual({ kind: "refused", reason: "over-bytes" });
    const at = codec({ bytes: new Uint8Array(64 * 1024), width: 256, height: 256 });
    expect((await createThemeServices(port(), at).prepareLogo(png())).kind).toBe("ready");
  });
});
