/**
 * CA-03: the catalog's canonical encoding and its six constraints.
 *
 * database.md § `LocalCatalogV1` lists seven numbered rules. Six are
 * predicates over the catalog and are asserted here — including on the empty
 * F01 catalog, where they hold trivially and must still run. The seventh is
 * the reset path's obligation and is asserted in `handlers.test.ts`, because
 * nothing in `catalog.ts` can observe it.
 */

import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
} from "../../../src/persistence/codecs/canonical-cbor.js";
import {
  buildLocalCatalog,
  decodeLocalCatalog,
  encodeLocalCatalog,
  validateLocalCatalog,
  withIdleTimeout,
  type LocalCatalogAppEntryV1,
  type LocalCatalogHomeEntryV1,
  type LocalCatalogV1,
} from "../../../src/workers/data/catalog.js";

const RECOVERY_VIEW = Uint8Array.from({ length: 48 }, (_, index) => index);

function empty(): LocalCatalogV1 {
  return buildLocalCatalog({
    deviceId: "kZ8n0Qc1TfKq2mHrb3VtZw",
    recoveryCodeView: RECOVERY_VIEW,
  });
}

function app(overrides: Partial<LocalCatalogAppEntryV1> = {}): LocalCatalogAppEntryV1 {
  return {
    appId: "app-1",
    locality: "listed-only",
    wrappedAppKey: null,
    appHeadStorageId: null,
    homeId: "home-1",
    scratchReminder: null,
    displayName: "Field Log Messy",
    identity: { accentId: "leaf", glyph: "FL" },
    createdAtEpochMs: 1_757_000_000_000,
    lastOpenedAtEpochMs: null,
    rowCountCache: 40,
    tableCount: 1,
    ...overrides,
  };
}

function home(overrides: Partial<LocalCatalogHomeEntryV1> = {}): LocalCatalogHomeEntryV1 {
  return {
    homeId: "home-1",
    kind: "dropbox",
    vaultId: "vault-1",
    homeStateStorageId: "home-state-1",
    providerAccountId: "account-1",
    vaultLocation: "/apps/sheaf",
    ...overrides,
  };
}

function withEntries(
  apps: readonly LocalCatalogAppEntryV1[],
  homes: readonly LocalCatalogHomeEntryV1[],
): LocalCatalogV1 {
  return { ...empty(), apps, homes };
}

describe("the empty F01 catalog", () => {
  it("is empty but present, with the timeout off by default", () => {
    const catalog = empty();

    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.catalogRevision).toBe(1);
    expect(catalog.apps).toEqual([]);
    expect(catalog.homes).toEqual([]);
    expect(catalog.settings.idleTimeoutMinutes).toBe(0);
    expect(catalog.settings.recoveryCodeView).toEqual(RECOVERY_VIEW);
  });

  it("round-trips byte-identically through canonical CBOR", () => {
    const catalog = empty();
    const encoded = encodeLocalCatalog(catalog);

    expect(decodeLocalCatalog(encoded)).toEqual(catalog);
    expect(encodeLocalCatalog(decodeLocalCatalog(encoded))).toEqual(encoded);
    // Encoding is deterministic: two encodes of the same catalog agree.
    expect(encodeLocalCatalog(catalog)).toEqual(encoded);
  });

  it("encodes as a canonical map that holds the recovery view as bytes (D10)", () => {
    const decoded = decodeCanonical(encodeLocalCatalog(empty()));
    expect(decoded).toBeInstanceOf(Map);

    const map = decoded as ReadonlyMap<string, unknown>;
    const settings = map.get("settings") as ReadonlyMap<string, unknown>;
    expect(settings.get("recoveryCodeView")).toBeInstanceOf(Uint8Array);
    expect(settings.get("idleTimeoutMinutes")).toBe(0n);
  });

  it("runs all six predicates even though every collection is empty", () => {
    expect(validateLocalCatalog(empty())).toBeDefined();
  });
});

describe("checks 1–6", () => {
  it("1: refuses duplicate app ids, home ids, or storage references", () => {
    expect(() =>
      validateLocalCatalog(withEntries([app(), app()], [home()])),
    ).toThrow(/duplicate app id/);

    expect(() =>
      validateLocalCatalog(
        withEntries([], [home(), home({ vaultId: "vault-2" })]),
      ),
    ).toThrow(/duplicate home id/);

    expect(() =>
      validateLocalCatalog({
        ...withEntries([], [home()]),
        cleanupTicketStorageIds: ["home-state-1"],
      }),
    ).toThrow(/duplicate referenced storage id/);
  });

  it("2: a local app entry must have both a wrapped key and a head", () => {
    expect(() =>
      validateLocalCatalog(
        withEntries([app({ locality: "present" })], [home()]),
      ),
    ).toThrow(/missing its key or head/);

    expect(() =>
      validateLocalCatalog(
        withEntries(
          [
            app({
              locality: "oversized-local",
              wrappedAppKey: new Uint8Array([1]),
              appHeadStorageId: null,
            }),
          ],
          [home()],
        ),
      ),
    ).toThrow(/missing its key or head/);

    expect(() =>
      validateLocalCatalog(
        withEntries(
          [
            app({
              locality: "present",
              wrappedAppKey: new Uint8Array([1]),
              appHeadStorageId: "head-1",
            }),
          ],
          [home()],
        ),
      ),
    ).not.toThrow();
  });

  it("3: a listed-only entry may carry no local material", () => {
    expect(() =>
      validateLocalCatalog(
        withEntries([app({ wrappedAppKey: new Uint8Array([1]) })], [home()]),
      ),
    ).toThrow(/carries local material/);
    expect(() =>
      validateLocalCatalog(
        withEntries([app({ appHeadStorageId: "head-1" })], [home()]),
      ),
    ).toThrow(/carries local material/);
  });

  it("4: a non-scratch entry must reference an existing home", () => {
    expect(() =>
      validateLocalCatalog(withEntries([app({ homeId: "missing" })], [home()])),
    ).toThrow(/home that does not exist/);
    // A scratch entry has no home at all, which is allowed.
    expect(() =>
      validateLocalCatalog(withEntries([app({ homeId: null })], [])),
    ).not.toThrow();
  });

  it("5: scratch reminder state disappears once a home is assigned", () => {
    const reminder = {
      triggeringCommitId: "commit-1",
      dismissalCount: 2,
      dismissedAtEpochMs: 1_700_000_000_000,
      nextEligibleAtEpochMs: null,
    };

    expect(() =>
      validateLocalCatalog(
        withEntries([app({ scratchReminder: reminder })], [home()]),
      ),
    ).toThrow(/still carries scratch state/);
    expect(() =>
      validateLocalCatalog(
        withEntries([app({ homeId: null, scratchReminder: reminder })], []),
      ),
    ).not.toThrow();
  });

  it("6: vault ids are unique, and one cloud folder cannot be two homes", () => {
    expect(() =>
      validateLocalCatalog(
        withEntries([], [home(), home({ homeId: "home-2", homeStateStorageId: "s2" })]),
      ),
    ).toThrow(/duplicate vault id/);

    expect(() =>
      validateLocalCatalog(
        withEntries(
          [],
          [
            home(),
            home({ homeId: "home-2", vaultId: "vault-2", homeStateStorageId: "s2" }),
          ],
        ),
      ),
    ).toThrow(/duplicate cloud home account location/);

    // Two bundle homes are not a provider-account collision.
    expect(() =>
      validateLocalCatalog(
        withEntries(
          [],
          [
            home({ kind: "bundle", providerAccountId: null, vaultLocation: null }),
            home({
              homeId: "home-2",
              kind: "bundle",
              vaultId: "vault-2",
              homeStateStorageId: "s2",
              providerAccountId: null,
              vaultLocation: null,
            }),
          ],
        ),
      ),
    ).not.toThrow();
  });
});

describe("CA-09 app display metadata", () => {
  /**
   * There is no legacy-entry decode path and there must not be one. `apps` was
   * `[]` in every catalog F01 could write — `buildLocalCatalog` starts it
   * empty and F01 shipped no writer that added an entry — so a stored entry
   * without these fields cannot exist. A tolerant decoder here would be
   * accepting a shape with no producer, and would hide a real corruption.
   */
  it("round-trips a full entry byte-identically", () => {
    const catalog = withEntries(
      [app({ locality: "present", wrappedAppKey: Uint8Array.of(1, 2, 3), appHeadStorageId: "head-1", homeId: null })],
      [],
    );
    const encoded = encodeLocalCatalog(catalog);

    expect(decodeLocalCatalog(encoded)).toEqual(catalog);
    expect(encodeLocalCatalog(decodeLocalCatalog(encoded))).toEqual(encoded);
  });

  it("refuses an entry with no display name", () => {
    expect(() =>
      validateLocalCatalog(withEntries([app({ displayName: "" })], [home()])),
    ).toThrow(/no display name/);
  });

  it("refuses an accent that is not one M40 declares", () => {
    expect(() =>
      validateLocalCatalog(
        withEntries(
          [app({ identity: { accentId: "chartreuse" as "leaf", glyph: "FL" } })],
          [home()],
        ),
      ),
    ).toThrow(/unknown accent/);
  });

  it("refuses a glyph that is empty or longer than a monogram", () => {
    for (const glyph of ["", "FLM"]) {
      expect(() =>
        validateLocalCatalog(
          withEntries([app({ identity: { accentId: "leaf", glyph } })], [home()]),
        ),
      ).toThrow(/glyph is empty or too long/);
    }
  });

  it("refuses counts and times that are not nonnegative whole numbers", () => {
    const rejects: Partial<LocalCatalogAppEntryV1>[] = [
      { createdAtEpochMs: -1 },
      { createdAtEpochMs: 1.5 },
      { lastOpenedAtEpochMs: -1 },
      { rowCountCache: -1 },
      { tableCount: -1 },
      { tableCount: Number.NaN },
    ];
    for (const overrides of rejects) {
      expect(() =>
        validateLocalCatalog(withEntries([app(overrides)], [home()])),
      ).toThrow(CodecError);
    }
  });

  it("accepts the absent states: never opened, nothing counted yet", () => {
    const catalog = withEntries(
      [app({ lastOpenedAtEpochMs: null, rowCountCache: null, tableCount: 0 })],
      [home()],
    );
    expect(decodeLocalCatalog(encodeLocalCatalog(catalog))).toEqual(catalog);
  });

  it("refuses a stored entry whose accent is not approved", () => {
    const catalog = withEntries([app()], [home()]);
    const decoded = decodeCanonical(encodeLocalCatalog(catalog)) as Map<
      string,
      CborValue
    >;
    const entry = (decoded.get("apps") as CborValue[])[0] as Map<
      string,
      CborValue
    >;
    (entry.get("identity") as Map<string, CborValue>).set("accentId", "gold");

    expect(() => decodeLocalCatalog(encodeCanonical(decoded))).toThrow(
      /accent is not an approved value/,
    );
  });
});

describe("withIdleTimeout", () => {
  it("sets the approved value and advances the catalog revision", () => {
    const next = withIdleTimeout(empty(), 15);

    expect(next.settings.idleTimeoutMinutes).toBe(15);
    expect(next.catalogRevision).toBe(2);
    expect(next.settings.recoveryCodeView).toEqual(RECOVERY_VIEW);
    expect(withIdleTimeout(next, 0).catalogRevision).toBe(3);
  });

  it("refuses any value outside {0, 5, 15, 60}", () => {
    for (const rejected of [30, -1, 1.5, 3_600, Number.NaN]) {
      expect(() =>
        withIdleTimeout(empty(), rejected as 0 | 5 | 15 | 60),
      ).toThrow(CodecError);
    }
  });
});

describe("decodeLocalCatalog", () => {
  it("refuses trailing bytes, unknown fields, and missing fields", () => {
    const encoded = encodeLocalCatalog(empty());

    const extended = new Uint8Array(encoded.byteLength + 1);
    extended.set(encoded);
    expect(() => decodeLocalCatalog(extended)).toThrow(CodecError);

    expect(() => decodeLocalCatalog(new Uint8Array([0xa0]))).toThrow(CodecError);
    expect(() => decodeLocalCatalog(new Uint8Array(0))).toThrow(CodecError);
  });

  it("refuses a catalog whose stored idle timeout is not approved", () => {
    // A 30-minute timeout is a value this program never writes; a reader that
    // accepted one would let a tampered or future catalog drive the timer.
    const catalog = empty();
    const forged = encodeCanonical(
      new Map<string, CborValue>([
        ["catalogVersion", 1],
        ["catalogRevision", catalog.catalogRevision],
        ["deviceId", catalog.deviceId],
        [
          "settings",
          new Map<string, CborValue>([
            ["idleTimeoutMinutes", 30],
            ["recoveryCodeView", catalog.settings.recoveryCodeView],
          ]),
        ],
        ["apps", []],
        ["homes", []],
        ["activeWorkflowStorageIds", []],
        ["cleanupTicketStorageIds", []],
        ["migrationStorageId", null],
      ]),
    );

    expect(() => decodeLocalCatalog(forged)).toThrow(/not an approved value/);
  });
});
