/**
 * `changeTheme` (M34; CAP-37, CA-32, D56) against in-memory ports: what it
 * judges before anything is built, and what a refusal leaves behind (nothing).
 * The real store, codecs and projection are proven through the worker handler
 * in `tests/unit/workers/theme-handlers.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  changeTheme,
  inspectLogo,
  judgeTheme,
} from "../../../src/application/commands/theme-commands.js";
import type {
  ProjectionAppStateV1,
  ProjectionQueryKindV1,
  ProjectionQueryResultsV1,
  ProjectionQueryV1,
} from "../../../src/application/ports/projection.js";
import type { AppThemeLogoV1, AppThemeV1 } from "../../../src/domain/model/events.js";
import { createDomainId } from "../../../src/domain/model/ids.js";
import type { TableDefV1 } from "../../../src/domain/model/schema.js";
import { BUILT_IN_PALETTES, DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import { FakeClock, FakeEventRepository, FakeProjection, entropy } from "./fakes.js";

const APP_ID = createDomainId("app", entropy);
const TABLE: TableDefV1 = {
  tableId: createDomainId("table", entropy),
  displayName: "Jobs",
  tableOrdinal: 0,
  fields: [],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const [cedar, indigo] = BUILT_IN_PALETTES as readonly [(typeof BUILT_IN_PALETTES)[number], (typeof BUILT_IN_PALETTES)[number]];

/** A PNG header only: signature, IHDR length 13, "IHDR", width, height. */
function pngHeader(width: number, height: number, extra = 8): Uint8Array {
  const bytes = new Uint8Array(24 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const logo = (width: number, height: number, bytes = pngHeader(width, height)): AppThemeLogoV1 => ({
  mediaType: "image/png",
  bytes,
  width,
  height,
});

/** The fake keeps no app state; the theme command reads exactly that. */
class ThemedProjection extends FakeProjection {
  theme: AppThemeV1 = DEFAULT_APP_THEME;

  override execute<K extends ProjectionQueryKindV1>(
    query: Extract<ProjectionQueryV1, { readonly kind: K }>,
  ): ProjectionQueryResultsV1[K] {
    if (query.kind !== "app-state") return super.execute(query);
    const state: ProjectionAppStateV1 = {
      appId: APP_ID,
      displayName: "Fieldwork",
      createdAtMs: 0,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 0,
      theme: this.theme,
      stateRevision: 1n,
    };
    return state as ProjectionQueryResultsV1[K];
  }

  /** Applies a theme commit the way the engine does: the stored theme becomes `after`. */
  override applyEvents(commits: Parameters<FakeProjection["applyEvents"]>[0]): ReturnType<FakeProjection["applyEvents"]> {
    for (const { commit, events } of commits) {
      this.applied.push(commit);
      for (const event of events) {
        if (event.kind !== "theme.changed") throw new Error(`unexpected ${event.kind}`);
        this.theme = event.payload.after;
      }
    }
    return Promise.resolve({ recalculatedFieldIds: [] });
  }
}

function harness() {
  const projection = new ThemedProjection({ table: TABLE, trace: [] });
  const repository = new FakeEventRepository(APP_ID, projection);
  return { projection, repository, deps: { clock: new FakeClock(), entropy, projection, repository } };
}

const indigoDark: AppThemeV1 = { themeKey: "indigo", tokens: indigo.light, mode: "dark", density: "compact" };

describe("judging a theme", () => {
  it("passes every built-in palette in every mode", () => {
    for (const palette of BUILT_IN_PALETTES) {
      for (const mode of ["light", "dark", "system"] as const) {
        expect(judgeTheme({ theme: { themeKey: palette.key, tokens: palette.light, mode }, darkTokens: palette.dark })).toBeNull();
      }
    }
  });

  it("refuses a custom accent that fails, naming each failing pair in each mode", () => {
    const refusal = judgeTheme({
      theme: { themeKey: "cedar", tokens: cedar.light, mode: "system", customAccent: "#1b2822" },
      darkTokens: cedar.dark,
    });
    expect(refusal?.kind).toBe("contrast");
    const failures = refusal?.kind === "contrast" ? refusal.failures : [];
    expect(failures.map((check) => `${check.mode}:${check.pair}`)).toEqual(["dark:accent-canvas", "dark:accent-surface"]);
    expect(failures.every((check) => check.ratio < check.minimum && !check.passes)).toBe(true);
  });

  it("judges only the modes the theme renders: the same accent passes in light alone", () => {
    expect(
      judgeTheme({ theme: { themeKey: "cedar", tokens: cedar.light, mode: "light", customAccent: "#1b2822" }, darkTokens: cedar.dark }),
    ).toBeNull();
  });

  it("refuses an accent that is not #rrggbb, and a dark theme with no dark set", () => {
    expect(judgeTheme({ theme: { ...indigoDark, customAccent: "#ABCDEF" }, darkTokens: indigo.dark })).toEqual({ kind: "invalid-accent" });
    expect(judgeTheme({ theme: { ...DEFAULT_APP_THEME, mode: "dark" }, darkTokens: null })).toEqual({ kind: "unknown-palette" });
    expect(judgeTheme({ theme: DEFAULT_APP_THEME, darkTokens: null })).toBeNull();
  });
});

describe("the logo, judged by its header only (D56)", () => {
  it("accepts a PNG whose IHDR matches its claimed size, up to 256×256", () => {
    expect(inspectLogo(logo(256, 256))).toBeNull();
    expect(inspectLogo(logo(1, 40))).toBeNull();
  });

  it("refuses over 64 KiB, over 256 px, a lying size, and anything that is not a PNG", () => {
    expect(inspectLogo(logo(64, 64, pngHeader(64, 64, 64 * 1024)))).toBe("over-bytes");
    expect(inspectLogo(logo(257, 10))).toBe("over-edge");
    expect(inspectLogo({ ...logo(64, 64), width: 32 })).toBe("unreadable");
    const jpeg = pngHeader(64, 64);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect(inspectLogo(logo(64, 64, jpeg))).toBe("unreadable");
    expect(inspectLogo(logo(64, 64, pngHeader(64, 64).subarray(0, 20)))).toBe("unreadable");
    expect(judgeTheme({ theme: { ...indigoDark, logo: logo(300, 300) }, darkTokens: indigo.dark })).toEqual({
      kind: "logo",
      reason: "over-edge",
    });
  });
});

describe("changeTheme", () => {
  it("commits one theme.changed {before, after} as an authored, app-level event", async () => {
    const { deps, repository } = harness();
    const theme: AppThemeV1 = { ...indigoDark, logo: logo(48, 48) };
    const result = await changeTheme(deps, { theme, darkTokens: indigo.dark });

    expect(result.outcome).toBe("changed");
    expect(repository.appends).toHaveLength(1);
    const plan = repository.appends[0]?.plan;
    expect(plan?.eventClass).toBe("authored");
    expect(plan?.schemaRevisionAfter).toBe(plan?.schemaRevisionBefore);
    expect(plan?.events.map((planned) => planned.event)).toEqual([
      { kind: "theme.changed", payload: { before: DEFAULT_APP_THEME, after: theme } },
    ]);
    expect(plan?.events[0]?.subject).toEqual({ appId: APP_ID });
  });

  it("writes nothing for a refused theme or for the theme already stored", async () => {
    const { deps, repository, projection } = harness();
    const refused = await changeTheme(deps, {
      theme: { ...indigoDark, customAccent: "#1b2130" },
      darkTokens: indigo.dark,
    });
    expect(refused).toMatchObject({ outcome: "refused", refusal: { kind: "contrast" } });

    projection.theme = { ...indigoDark, logo: logo(48, 48) };
    const same = await changeTheme(deps, {
      theme: { ...indigoDark, logo: logo(48, 48, pngHeader(48, 48)) },
      darkTokens: indigo.dark,
    });
    expect(same.outcome).toBe("unchanged");
    expect(repository.appends).toHaveLength(0);

    // A different logo of the same size is a change.
    const other = pngHeader(48, 48);
    other[30] = 7;
    expect((await changeTheme(deps, { theme: { ...indigoDark, logo: logo(48, 48, other) }, darkTokens: indigo.dark })).outcome).toBe(
      "changed",
    );
    expect(repository.appends).toHaveLength(1);
  });
});
