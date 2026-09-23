/**
 * CAP-37 / CA-32 at the handler (S08 CP1): `changeTheme` through the real
 * dispatch, real crypto, real codecs, the real store (over the IndexedDB shim)
 * and the real SQLite projection, on the F03 demo app.
 *
 * A write is judged by its durable effect — the history row, the library
 * tile the catalog now carries — and each refusal by the absence of one: the
 * envelope store is exactly as it was. A fresh worker then replays the
 * `theme.changed` tail from the durable bytes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DataWorkerCommandHandler } from "../../../src/workers/data/handlers.js";
import type { ChangeThemeRequestV1 } from "../../../src/workers/protocol/messages.js";
import { BUILT_IN_PALETTES, DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import { CodecError } from "../../../src/domain/model/errors.js";
import type { AppThemeV1 } from "../../../src/domain/model/events.js";
import { decodeTailEventPayload, encodeRecordEventPayload } from "../../../src/workers/data/record-event-payloads.js";
import { decodeCanonical, encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import {
  ask,
  countEnvelopeRows,
  CRYPTO_TIMEOUT_MS,
  createTestHandler,
  importDemoApp,
  resetLocalDatabase,
} from "./data-worker.js";

const PASSPHRASE = "correct horse battery staple";
const SLOW = CRYPTO_TIMEOUT_MS * 4;

const indigo = BUILT_IN_PALETTES.find((palette) => palette.key === "indigo")!;

/** A PNG header (signature + IHDR) and a few body bytes, as base64 text. */
function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[30] = 42;
  return btoa(String.fromCharCode(...bytes));
}

let handler: DataWorkerCommandHandler;
let appId: string;

const request = (overrides: Partial<Omit<ChangeThemeRequestV1, "kind" | "appId">> = {}): ChangeThemeRequestV1 => ({
  kind: "changeTheme",
  appId,
  themeKey: "indigo",
  mode: "dark",
  density: "compact",
  customAccent: null,
  logo: { kind: "set", pngBase64: pngBase64(48, 32), width: 48, height: 32 },
  ...overrides,
});

async function libraryTile() {
  const { apps } = await ask(handler, { kind: "listLibrary" });
  return apps.find((app) => app.appId === appId);
}

beforeAll(async () => {
  await resetLocalDatabase();
  handler = createTestHandler().handler;
  await handler.handle({ kind: "setup", passphrase: PASSPHRASE });
  await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });
  appId = await importDemoApp(handler);
}, SLOW);

afterAll(() => {
  handler.dispose();
});

describe("the theme.changed payload (CA-32)", () => {
  it("reads back exactly what a command writes, v2 fields and a null before included", () => {
    const after: AppThemeV1 = {
      themeKey: "indigo",
      tokens: indigo.light,
      mode: "system",
      density: "compact",
      customAccent: "#b5642a",
      logo: { mediaType: "image/png", bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47), width: 2, height: 3 },
    };
    for (const before of [null, DEFAULT_APP_THEME]) {
      const event = { kind: "theme.changed", payload: { before, after } } as const;
      const bytes = encodeCanonical(encodeRecordEventPayload(event));
      expect(decodeTailEventPayload("theme.changed", decodeCanonical(bytes))).toEqual(event);
    }
  });

  it("refuses a theme whose tokens are not six colours", () => {
    const after = { ...DEFAULT_APP_THEME, tokens: { ...DEFAULT_APP_THEME.tokens, "app-accent": "var(--color-danger)" } };
    expect(() => encodeRecordEventPayload({ kind: "theme.changed", payload: { before: null, after } })).toThrow(CodecError);
  });
});

describe("the theme RPCs (CA-32)", () => {
  it("offer the four built-in palettes, both sets each", async () => {
    const { palettes } = await ask(handler, { kind: "listThemePalettes" });
    expect(palettes.map((palette) => palette.key)).toEqual(["cedar", "indigo", "clay", "graphite"]);
    expect(palettes[1]).toEqual({ key: "indigo", name: "Indigo", light: indigo.light, dark: indigo.dark });
  });

  it(
    "open an F03-era app with its theme unchanged, and its tile identity (the F02 carry)",
    async () => {
      const { session } = await ask(handler, { kind: "openApp", appId });
      expect(session?.theme).toEqual(DEFAULT_APP_THEME);
      expect(session?.glyph).toBe("FQ");
      expect(typeof session?.accentId).toBe("string");
      expect((await libraryTile())?.themeTile).toBeUndefined();
    },
    SLOW,
  );

  it(
    "refuse a failing accent, an unknown palette and an unreadable or oversize logo, writing nothing",
    async () => {
      const rows = await countEnvelopeRows();
      const failing = await ask(handler, request({ customAccent: "#1B2130" }));
      expect(failing.outcome).toMatchObject({ result: "refused", refusal: { kind: "contrast" } });
      const failures = failing.outcome.result === "refused" && failing.outcome.refusal.kind === "contrast" ? failing.outcome.refusal.failures : [];
      expect(failures.map((check) => `${check.mode}:${check.pair}`)).toEqual(["dark:accent-canvas", "dark:accent-surface"]);

      expect((await ask(handler, request({ themeKey: "sheaf.built-in.v1" }))).outcome).toEqual({
        result: "refused",
        refusal: { kind: "unknown-palette" },
      });
      expect((await ask(handler, request({ logo: { kind: "set", pngBase64: "not base64!", width: 1, height: 1 } }))).outcome).toEqual({
        result: "refused",
        refusal: { kind: "logo", reason: "unreadable" },
      });
      expect(
        (await ask(handler, request({ logo: { kind: "set", pngBase64: pngBase64(300, 20), width: 300, height: 20 } }))).outcome,
      ).toEqual({ result: "refused", refusal: { kind: "logo", reason: "over-edge" } });
      expect(await countEnvelopeRows()).toBe(rows);
    },
    SLOW,
  );

  it(
    "commit a palette, mode, density and logo as one authored theme.changed, and give the tile its identity",
    async () => {
      const { outcome } = await ask(handler, request());
      expect(outcome).toEqual({
        result: "changed",
        theme: {
          themeKey: "indigo",
          tokens: indigo.light,
          mode: "dark",
          density: "compact",
          darkTokens: indigo.dark,
          logo: { pngBase64: pngBase64(48, 32), width: 48, height: 32 },
        },
      });
      const history = (await ask(handler, { kind: "getChangeHistory", appId, limit: 5 })).page?.entries ?? [];
      expect(history[0]).toMatchObject({ eventKind: "theme.changed", subjectKind: "app" });
      expect((await libraryTile())?.themeTile).toEqual({
        primary: indigo.light["app-primary"],
        label: indigo.light["app-surface"],
        logo: { pngBase64: pngBase64(48, 32), width: 48, height: 32 },
      });
    },
    SLOW,
  );

  it(
    "write nothing for the theme already stored",
    async () => {
      const rows = await countEnvelopeRows();
      const { outcome } = await ask(handler, request({ logo: { kind: "keep" } }));
      expect(outcome.result).toBe("unchanged");
      expect(await countEnvelopeRows()).toBe(rows);
    },
    SLOW,
  );
});

describe("a fresh worker replays the theme", () => {
  it(
    "reads the palette, mode, density, logo and tile back from the durable bytes",
    async () => {
      await handler.handle({ kind: "lock" });
      handler.dispose();
      handler = createTestHandler().handler;
      await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });

      const { session } = await ask(handler, { kind: "openApp", appId });
      expect(session?.theme.themeKey).toBe("indigo");
      expect(session?.theme.tokens).toEqual(indigo.light);
      expect(session?.theme.darkTokens).toEqual(indigo.dark);
      expect(session?.theme.mode).toBe("dark");
      expect(session?.theme.density).toBe("compact");
      expect(session?.theme.logo).toEqual({ pngBase64: pngBase64(48, 32), width: 48, height: 32 });
      expect((await libraryTile())?.themeTile?.logo).toEqual({ pngBase64: pngBase64(48, 32), width: 48, height: 32 });
      const history = (await ask(handler, { kind: "getChangeHistory", appId, limit: 5 })).page?.entries ?? [];
      expect(history.filter((entry) => entry.eventKind === "theme.changed")).toHaveLength(1);
    },
    SLOW,
  );
});
