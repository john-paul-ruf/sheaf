/**
 * `LocalCatalogV1` — build, encode, decode, validate (CA-03).
 *
 * The catalog is the only semantic root the bootstrap can reach
 * (database.md § `LocalCatalogV1`). It is a canonical CBOR map, encrypted as
 * one envelope under the local root, and every constraint below is checked
 * before encryption and again after decryption — including in F01, where
 * `apps` and `homes` are empty but present, so the predicates run trivially
 * rather than not at all.
 *
 * **Checks 1–6 are the validator's predicates.** {@link validateLocalCatalog}
 * implements exactly those six. **Check 7 is not a catalog predicate**: "cached
 * counts and times never authorize a destructive action; removal and reset
 * recompute from the decrypted head/frontier before confirmation" is a
 * property of the *reset path*, and nothing in this file can assert it. Its
 * assertion owner is the `resetReadable`/confirm handler in
 * `../data/handlers.ts` (decision AD-8, replan finding F-10); S07's e2e reset
 * leg owns the surface half.
 *
 * **The recovery-code view (D10/AD-8)** is a wrapped bytes field inside this
 * payload: the code is sealed as its own envelope under the local root and
 * carried here as opaque transport bytes. Decoding the catalog therefore never
 * yields the code — CAP-06 must decrypt it deliberately — and the field
 * touches no migration, no cleartext column, and no index.
 *
 * **App display metadata (CA-09, F02).** An app entry carries the encrypted
 * display metadata database.md § `LocalCatalogV1` always required of it:
 * `displayName`, an `identity` (accent token id plus glyph initials),
 * created/last-opened times, a row-count cache and a table count. It is what
 * lets the library render a tile and the readable reset name real apps — and
 * it is *cache*, never authority: check 7 still recomputes from the decrypted
 * head before any destructive action.
 *
 * There is deliberately **no legacy-entry decode path**. `apps` was `[]` in
 * every catalog F01 could write, so no stored entry without these fields can
 * exist; a decoder that tolerated one would be tolerating a shape that has no
 * producer. `tests/unit/workers/catalog.test.ts` records that assumption.
 */

import { CodecError } from "../../domain/model/errors.js";
import { APP_LOGO_MAX_BYTES, APP_LOGO_MAX_EDGE, isThemeColor } from "../../domain/model/events.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborKey,
  type CborValue,
  type DecodedKey,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import {
  isIdleTimeoutMinutesV1,
  type IdleTimeoutMinutesV1,
} from "../protocol/messages.js";

export const CATALOG_VERSION = 1;

/** Where an app's data currently is (database.md § `LocalCatalogV1`). */
export type AppLocalityV1 = "present" | "oversized-local" | "listed-only";

/**
 * A "scratch" app is one with no home: the catalog says so by leaving
 * `homeId` null, which is why check 4 and check 5 are homeId predicates.
 */
export interface ScratchReminderStateV1 {
  readonly triggeringCommitId: string;
  readonly dismissalCount: number;
  readonly dismissedAtEpochMs: number | null;
  readonly nextEligibleAtEpochMs: number | null;
}

/**
 * The accent a generated app is identified by. Every id names a colour that
 * already exists in M40's palette (`src/ui/theme/tokens.css`, from design.md
 * § Color palette) — the catalog stores the *token id*, never a colour value,
 * so a theme change can never leave an app entry holding a stale literal.
 */
export const APP_ACCENT_IDS = Object.freeze([
  "leaf",
  "clay",
  "marigold",
  "river",
  "violet",
] as const);

export type AppAccentIdV1 = (typeof APP_ACCENT_IDS)[number];

export function isAppAccentIdV1(value: string): value is AppAccentIdV1 {
  return (APP_ACCENT_IDS as readonly string[]).includes(value);
}

/** The longest monogram a tile renders (design.md's `.tile-monogram`). */
export const APP_GLYPH_MAX_LENGTH = 2;

/**
 * What a library tile shows before any app data is read: a swatch and a
 * monogram. Both are values — renaming an app changes them and rewrites
 * nothing else.
 */
export interface AppIdentityV1 {
  readonly accentId: AppAccentIdV1;
  /** One or two characters; the tile's monogram. */
  readonly glyph: string;
}

/**
 * The tile identity an app's own theme gives it (CAP-37): the palette's light
 * primary, the label colour that reads on it, and the logo. A cache of the
 * theme like every other display field here — the `theme.changed` commit is the
 * fact, and the handler that writes it refreshes this in the same request.
 * Absent while the app keeps the theme it was created with.
 */
export interface AppThemeTileV1 {
  readonly primary: string;
  readonly label: string;
  readonly logo: { readonly bytes: Uint8Array; readonly width: number; readonly height: number } | null;
}

export interface LocalCatalogAppEntryV1 {
  readonly appId: string;
  readonly locality: AppLocalityV1;
  /** Present exactly when the app's data is local (check 2 / check 3). */
  readonly wrappedAppKey: Uint8Array | null;
  readonly appHeadStorageId: string | null;
  readonly homeId: string | null;
  readonly scratchReminder: ScratchReminderStateV1 | null;
  /** CA-09 display metadata. Encrypted like everything else in this payload. */
  readonly displayName: string;
  readonly identity: AppIdentityV1;
  readonly createdAtEpochMs: number;
  /**
   * Null until the app has been opened once. Local operational state, not
   * history: database.md § Events that do not exist rules out a last-opened
   * event, so this field is the only place the fact lives.
   */
  readonly lastOpenedAtEpochMs: number | null;
  /** A cache the library may render; null when nothing has counted yet. */
  readonly rowCountCache: number | null;
  readonly tableCount: number;
  /**
   * D61: the app's one chart draft — encrypted operational state, never an
   * event. Opaque canonical bytes the chart handlers own; absent means none,
   * and a catalog written before charts carries no key for it.
   */
  readonly chartDraft?: Uint8Array;
  /** CAP-37: absent means the tile is `identity`'s accent and monogram. */
  readonly themeTile?: AppThemeTileV1;
}

export type HomeKindV1 = "dropbox" | "onedrive" | "bundle";

export interface LocalCatalogHomeEntryV1 {
  readonly homeId: string;
  readonly kind: HomeKindV1;
  readonly vaultId: string;
  readonly homeStateStorageId: string;
  /** Cloud homes only; a bundle home has no provider account (check 6). */
  readonly providerAccountId: string | null;
  readonly vaultLocation: string | null;
}

export interface LocalCatalogSettingsV1 {
  /** FR-22: user-configurable, `0` is off and is the product default. */
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
  /** The D10 wrapped bytes field: a sealed envelope, never cleartext. */
  readonly recoveryCodeView: Uint8Array;
}

export interface LocalCatalogV1 {
  readonly catalogVersion: typeof CATALOG_VERSION;
  readonly catalogRevision: number;
  readonly deviceId: string;
  readonly settings: LocalCatalogSettingsV1;
  readonly apps: readonly LocalCatalogAppEntryV1[];
  readonly homes: readonly LocalCatalogHomeEntryV1[];
  readonly activeWorkflowStorageIds: readonly string[];
  readonly cleanupTicketStorageIds: readonly string[];
  readonly migrationStorageId: string | null;
}

const APP_LOCALITIES: readonly AppLocalityV1[] = [
  "present",
  "oversized-local",
  "listed-only",
];

const HOME_KINDS: readonly HomeKindV1[] = ["dropbox", "onedrive", "bundle"];

// --- validation (database.md § `LocalCatalogV1`, checks 1–6) -----------------

function assertUnique(values: readonly string[], what: string): void {
  if (new Set(values).size !== values.length) {
    throw new CodecError(`catalog has a duplicate ${what}`);
  }
}

const assertCount = (value: number, what: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CodecError(`catalog ${what} must be a nonnegative safe integer`);
  }
};

/**
 * CA-09's constraints on the display metadata. They are validator predicates
 * like checks 1–6 — an entry that could not be rendered truthfully must not
 * become durable — but they are not part of database.md's numbered list, so
 * they live in their own function where that distinction stays visible.
 */
function assertAppDisplayMetadata(app: LocalCatalogAppEntryV1): void {
  if (app.displayName.length === 0) {
    throw new CodecError("an app entry has no display name");
  }
  if (!isAppAccentIdV1(app.identity.accentId)) {
    throw new CodecError("an app entry names an unknown accent");
  }
  if (
    app.identity.glyph.length === 0 ||
    app.identity.glyph.length > APP_GLYPH_MAX_LENGTH
  ) {
    throw new CodecError("an app entry's glyph is empty or too long");
  }
  assertCount(app.createdAtEpochMs, "app creation time");
  if (app.lastOpenedAtEpochMs !== null) {
    assertCount(app.lastOpenedAtEpochMs, "app last-opened time");
  }
  if (app.rowCountCache !== null) {
    assertCount(app.rowCountCache, "app row count cache");
  }
  assertCount(app.tableCount, "app table count");
  if (app.themeTile !== undefined) {
    assertThemeTile(app.themeTile);
  }
}

function assertThemeTile(tile: AppThemeTileV1): void {
  if (!isThemeColor(tile.primary) || !isThemeColor(tile.label)) {
    throw new CodecError("an app tile colour is not #rrggbb");
  }
  const logo = tile.logo;
  if (
    logo !== null &&
    (logo.bytes.byteLength === 0 ||
      logo.bytes.byteLength > APP_LOGO_MAX_BYTES ||
      ![logo.width, logo.height].every((edge) => Number.isInteger(edge) && edge >= 1 && edge <= APP_LOGO_MAX_EDGE))
  ) {
    throw new CodecError("an app tile logo is outside its bounds");
  }
}

/** Checks 1–6, plus CA-09's field constraints. Check 7 is the reset path's. */
export function validateLocalCatalog(catalog: LocalCatalogV1): LocalCatalogV1 {
  if (catalog.catalogVersion !== CATALOG_VERSION) {
    throw new CodecError("catalog declares an unsupported version");
  }
  if (!Number.isSafeInteger(catalog.catalogRevision) || catalog.catalogRevision < 1) {
    throw new CodecError("catalog revision must be a safe integer of at least 1");
  }
  if (catalog.deviceId.length === 0) {
    throw new CodecError("catalog has no device id");
  }
  if (!isIdleTimeoutMinutesV1(catalog.settings.idleTimeoutMinutes)) {
    throw new CodecError("catalog idle timeout is not an approved value");
  }

  // 1. AppId, HomeId, and referenced storage IDs are unique.
  assertUnique(
    catalog.apps.map((app) => app.appId),
    "app id",
  );
  assertUnique(
    catalog.homes.map((home) => home.homeId),
    "home id",
  );
  assertUnique(
    [
      ...catalog.apps.flatMap((app) =>
        app.appHeadStorageId === null ? [] : [app.appHeadStorageId],
      ),
      ...catalog.homes.map((home) => home.homeStateStorageId),
      ...catalog.activeWorkflowStorageIds,
      ...catalog.cleanupTicketStorageIds,
      ...(catalog.migrationStorageId === null ? [] : [catalog.migrationStorageId]),
    ],
    "referenced storage id",
  );

  const homeIds = new Set(catalog.homes.map((home) => home.homeId));

  for (const app of catalog.apps) {
    assertAppDisplayMetadata(app);
    const isLocal = app.locality === "present" || app.locality === "oversized-local";

    // 2. `present` and `oversized-local` entries have a wrapped app key and head.
    if (isLocal && (app.wrappedAppKey === null || app.appHeadStorageId === null)) {
      throw new CodecError("a local app entry is missing its key or head");
    }
    // 3. `listed-only` entries have neither a local app key nor a local head.
    if (
      app.locality === "listed-only" &&
      (app.wrappedAppKey !== null || app.appHeadStorageId !== null)
    ) {
      throw new CodecError("a listed-only app entry carries local material");
    }
    // 4. Scratch entries (no home) have no home; every other entry references
    //    exactly one existing home. A bundle home is never *enumerable* — that
    //    clause governs adoption, which F01 does not have, so it has no
    //    structural predicate here.
    if (app.homeId !== null && !homeIds.has(app.homeId)) {
      throw new CodecError("an app entry references a home that does not exist");
    }
    // 5. Scratch reminder state is absent once a home is assigned.
    if (app.homeId !== null && app.scratchReminder !== null) {
      throw new CodecError("an app entry with a home still carries scratch state");
    }
  }

  // 6. VaultId is unique among homes; for cloud homes, so is
  //    (providerKind, stableProviderAccountId, vaultLocation).
  assertUnique(
    catalog.homes.map((home) => home.vaultId),
    "vault id",
  );
  assertUnique(
    catalog.homes
      .filter((home) => home.kind !== "bundle")
      .map((home) => `${home.kind} ${home.providerAccountId ?? ""} ${home.vaultLocation ?? ""}`),
    "cloud home account location",
  );

  return catalog;
}

// --- construction -----------------------------------------------------------

export interface BuildLocalCatalogInput {
  readonly deviceId: string;
  readonly recoveryCodeView: Uint8Array;
}

/** The first-run catalog: idle timeout off, nothing owned yet (CAP-01). */
export function buildLocalCatalog(input: BuildLocalCatalogInput): LocalCatalogV1 {
  return validateLocalCatalog({
    catalogVersion: CATALOG_VERSION,
    catalogRevision: 1,
    deviceId: input.deviceId,
    settings: { idleTimeoutMinutes: 0, recoveryCodeView: input.recoveryCodeView },
    apps: [],
    homes: [],
    activeWorkflowStorageIds: [],
    cleanupTicketStorageIds: [],
    migrationStorageId: null,
  });
}

/**
 * The settings writer behind `updateSettings` (D13/AD-7). It advances
 * `catalogRevision`, because the result is a new catalog that will be
 * committed as a new envelope.
 */
export function withIdleTimeout(
  catalog: LocalCatalogV1,
  idleTimeoutMinutes: IdleTimeoutMinutesV1,
): LocalCatalogV1 {
  if (!isIdleTimeoutMinutesV1(idleTimeoutMinutes)) {
    throw new CodecError("idle timeout is not an approved value");
  }
  return validateLocalCatalog({
    ...catalog,
    catalogRevision: catalog.catalogRevision + 1,
    settings: { ...catalog.settings, idleTimeoutMinutes },
  });
}

export function idleTimeoutMinutes(catalog: LocalCatalogV1): IdleTimeoutMinutesV1 {
  return catalog.settings.idleTimeoutMinutes;
}

// --- encoding ---------------------------------------------------------------

function cborMap(
  entries: readonly (readonly [string, CborValue])[],
): ReadonlyMap<CborKey, CborValue> {
  return new Map<CborKey, CborValue>(entries);
}

function encodeApp(app: LocalCatalogAppEntryV1): CborValue {
  return cborMap([
    ["appId", app.appId],
    ["locality", app.locality],
    ["wrappedAppKey", app.wrappedAppKey],
    ["appHeadStorageId", app.appHeadStorageId],
    ["homeId", app.homeId],
    [
      "scratchReminder",
      app.scratchReminder === null
        ? null
        : cborMap([
            ["triggeringCommitId", app.scratchReminder.triggeringCommitId],
            ["dismissalCount", app.scratchReminder.dismissalCount],
            ["dismissedAtEpochMs", app.scratchReminder.dismissedAtEpochMs],
            ["nextEligibleAtEpochMs", app.scratchReminder.nextEligibleAtEpochMs],
          ]),
    ],
    ["displayName", app.displayName],
    [
      "identity",
      cborMap([
        ["accentId", app.identity.accentId],
        ["glyph", app.identity.glyph],
      ]),
    ],
    ["createdAtEpochMs", app.createdAtEpochMs],
    ["lastOpenedAtEpochMs", app.lastOpenedAtEpochMs],
    ["rowCountCache", app.rowCountCache],
    ["tableCount", app.tableCount],
    ...(app.chartDraft === undefined ? [] : [["chartDraft", app.chartDraft] as const]),
    ...(app.themeTile === undefined ? [] : [["themeTile", encodeThemeTile(app.themeTile)] as const]),
  ]);
}

function encodeThemeTile(tile: AppThemeTileV1): CborValue {
  return cborMap([
    ["primary", tile.primary],
    ["label", tile.label],
    [
      "logo",
      tile.logo === null
        ? null
        : cborMap([
            ["bytes", tile.logo.bytes],
            ["width", tile.logo.width],
            ["height", tile.logo.height],
          ]),
    ],
  ]);
}

function encodeHome(home: LocalCatalogHomeEntryV1): CborValue {
  return cborMap([
    ["homeId", home.homeId],
    ["kind", home.kind],
    ["vaultId", home.vaultId],
    ["homeStateStorageId", home.homeStateStorageId],
    ["providerAccountId", home.providerAccountId],
    ["vaultLocation", home.vaultLocation],
  ]);
}

export function encodeLocalCatalog(catalog: LocalCatalogV1): Uint8Array {
  validateLocalCatalog(catalog);
  return encodeCanonical(
    cborMap([
      ["catalogVersion", catalog.catalogVersion],
      ["catalogRevision", catalog.catalogRevision],
      ["deviceId", catalog.deviceId],
      [
        "settings",
        cborMap([
          ["idleTimeoutMinutes", catalog.settings.idleTimeoutMinutes],
          ["recoveryCodeView", catalog.settings.recoveryCodeView],
        ]),
      ],
      ["apps", catalog.apps.map(encodeApp)],
      ["homes", catalog.homes.map(encodeHome)],
      ["activeWorkflowStorageIds", [...catalog.activeWorkflowStorageIds]],
      ["cleanupTicketStorageIds", [...catalog.cleanupTicketStorageIds]],
      ["migrationStorageId", catalog.migrationStorageId],
    ]),
  );
}

// --- decoding ---------------------------------------------------------------

function asMap(
  value: DecodedValue,
  what: string,
): ReadonlyMap<DecodedKey, DecodedValue> {
  if (!(value instanceof Map)) {
    throw new CodecError(`catalog ${what} is not a map`);
  }
  return value;
}

function field(
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  name: string,
): DecodedValue {
  const value = map.get(name);
  if (value === undefined) {
    throw new CodecError(`catalog is missing ${name}`);
  }
  return value;
}

function assertExactKeys(
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  names: readonly string[],
  what: string,
): void {
  if (map.size !== names.length) {
    throw new CodecError(`catalog ${what} has unexpected fields`);
  }
  for (const name of names) {
    if (!map.has(name)) {
      throw new CodecError(`catalog ${what} is missing ${name}`);
    }
  }
}

function text(value: DecodedValue, name: string): string {
  if (typeof value !== "string") {
    throw new CodecError(`catalog ${name} is not text`);
  }
  return value;
}

function optionalText(value: DecodedValue, name: string): string | null {
  return value === null ? null : text(value, name);
}

/** Integers decode as `bigint` so a decoded value re-encodes byte-exactly. */
function integer(value: DecodedValue, name: string): number {
  if (typeof value !== "bigint") {
    throw new CodecError(`catalog ${name} is not an integer`);
  }
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new CodecError(`catalog ${name} is outside the safe-integer range`);
  }
  return asNumber;
}

function optionalInteger(value: DecodedValue, name: string): number | null {
  return value === null ? null : integer(value, name);
}

function bytes(value: DecodedValue, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new CodecError(`catalog ${name} is not bytes`);
  }
  return value;
}

function optionalBytes(value: DecodedValue, name: string): Uint8Array | null {
  return value === null ? null : bytes(value, name);
}

function list(value: DecodedValue, name: string): readonly DecodedValue[] {
  if (!Array.isArray(value)) {
    throw new CodecError(`catalog ${name} is not a list`);
  }
  // `Array.isArray` narrows to `any[]`; the decoder only ever produces
  // `DecodedValue` members.
  return value as readonly DecodedValue[];
}

function oneOf<T extends string>(
  value: DecodedValue,
  allowed: readonly T[],
  name: string,
): T {
  const candidate = text(value, name);
  const found = allowed.find((option) => option === candidate);
  if (found === undefined) {
    throw new CodecError(`catalog ${name} is not an approved value`);
  }
  return found;
}

const APP_ENTRY_KEYS = Object.freeze([
  "appId",
  "locality",
  "wrappedAppKey",
  "appHeadStorageId",
  "homeId",
  "scratchReminder",
  "displayName",
  "identity",
  "createdAtEpochMs",
  "lastOpenedAtEpochMs",
  "rowCountCache",
  "tableCount",
] as const);

function decodeApp(value: DecodedValue): LocalCatalogAppEntryV1 {
  const map = asMap(value, "app entry");
  const hasDraft = map.has("chartDraft");
  const hasTile = map.has("themeTile");
  assertExactKeys(
    map,
    [...APP_ENTRY_KEYS, ...(hasDraft ? ["chartDraft"] : []), ...(hasTile ? ["themeTile"] : [])],
    "app entry",
  );

  const reminder = field(map, "scratchReminder");
  return {
    appId: text(field(map, "appId"), "app id"),
    locality: oneOf(field(map, "locality"), APP_LOCALITIES, "app locality"),
    wrappedAppKey: optionalBytes(field(map, "wrappedAppKey"), "wrapped app key"),
    appHeadStorageId: optionalText(
      field(map, "appHeadStorageId"),
      "app head storage id",
    ),
    homeId: optionalText(field(map, "homeId"), "app home id"),
    scratchReminder: reminder === null ? null : decodeScratchReminder(reminder),
    displayName: text(field(map, "displayName"), "app display name"),
    identity: decodeIdentity(field(map, "identity")),
    createdAtEpochMs: integer(field(map, "createdAtEpochMs"), "app creation time"),
    lastOpenedAtEpochMs: optionalInteger(
      field(map, "lastOpenedAtEpochMs"),
      "app last-opened time",
    ),
    rowCountCache: optionalInteger(
      field(map, "rowCountCache"),
      "app row count cache",
    ),
    tableCount: integer(field(map, "tableCount"), "app table count"),
    ...(hasDraft ? { chartDraft: bytes(field(map, "chartDraft"), "app chart draft") } : {}),
    ...(hasTile ? { themeTile: decodeThemeTile(field(map, "themeTile")) } : {}),
  };
}

function decodeThemeTile(value: DecodedValue): AppThemeTileV1 {
  const map = asMap(value, "app theme tile");
  assertExactKeys(map, ["primary", "label", "logo"], "app theme tile");
  const logo = field(map, "logo");
  let decodedLogo: AppThemeTileV1["logo"] = null;
  if (logo !== null) {
    const logoMap = asMap(logo, "app tile logo");
    assertExactKeys(logoMap, ["bytes", "width", "height"], "app tile logo");
    decodedLogo = {
      bytes: bytes(field(logoMap, "bytes"), "app tile logo bytes"),
      width: integer(field(logoMap, "width"), "app tile logo width"),
      height: integer(field(logoMap, "height"), "app tile logo height"),
    };
  }
  const tile = {
    primary: text(field(map, "primary"), "app tile primary"),
    label: text(field(map, "label"), "app tile label"),
    logo: decodedLogo,
  };
  assertThemeTile(tile);
  return tile;
}

function decodeIdentity(value: DecodedValue): AppIdentityV1 {
  const map = asMap(value, "app identity");
  assertExactKeys(map, ["accentId", "glyph"], "app identity");

  const accentId = text(field(map, "accentId"), "app accent");
  if (!isAppAccentIdV1(accentId)) {
    throw new CodecError("catalog app accent is not an approved value");
  }
  return { accentId, glyph: text(field(map, "glyph"), "app glyph") };
}

function decodeScratchReminder(value: DecodedValue): ScratchReminderStateV1 {
  const map = asMap(value, "scratch reminder");
  assertExactKeys(
    map,
    [
      "triggeringCommitId",
      "dismissalCount",
      "dismissedAtEpochMs",
      "nextEligibleAtEpochMs",
    ],
    "scratch reminder",
  );
  return {
    triggeringCommitId: text(
      field(map, "triggeringCommitId"),
      "triggering commit id",
    ),
    dismissalCount: integer(field(map, "dismissalCount"), "dismissal count"),
    dismissedAtEpochMs: optionalInteger(
      field(map, "dismissedAtEpochMs"),
      "dismissed time",
    ),
    nextEligibleAtEpochMs: optionalInteger(
      field(map, "nextEligibleAtEpochMs"),
      "next reminder time",
    ),
  };
}

function decodeHome(value: DecodedValue): LocalCatalogHomeEntryV1 {
  const map = asMap(value, "home entry");
  assertExactKeys(
    map,
    [
      "homeId",
      "kind",
      "vaultId",
      "homeStateStorageId",
      "providerAccountId",
      "vaultLocation",
    ],
    "home entry",
  );
  return {
    homeId: text(field(map, "homeId"), "home id"),
    kind: oneOf(field(map, "kind"), HOME_KINDS, "home kind"),
    vaultId: text(field(map, "vaultId"), "vault id"),
    homeStateStorageId: text(
      field(map, "homeStateStorageId"),
      "home state storage id",
    ),
    providerAccountId: optionalText(
      field(map, "providerAccountId"),
      "provider account id",
    ),
    vaultLocation: optionalText(field(map, "vaultLocation"), "vault location"),
  };
}

function decodeSettings(value: DecodedValue): LocalCatalogSettingsV1 {
  const map = asMap(value, "settings");
  assertExactKeys(map, ["idleTimeoutMinutes", "recoveryCodeView"], "settings");

  const minutes = integer(field(map, "idleTimeoutMinutes"), "idle timeout");
  if (!isIdleTimeoutMinutesV1(minutes)) {
    throw new CodecError("catalog idle timeout is not an approved value");
  }
  return {
    idleTimeoutMinutes: minutes,
    recoveryCodeView: bytes(
      field(map, "recoveryCodeView"),
      "recovery code view",
    ),
  };
}

/** Decodes and validates; a catalog that fails a constraint never returns. */
export function decodeLocalCatalog(payload: Uint8Array): LocalCatalogV1 {
  const map = asMap(decodeCanonical(payload), "payload");
  assertExactKeys(
    map,
    [
      "catalogVersion",
      "catalogRevision",
      "deviceId",
      "settings",
      "apps",
      "homes",
      "activeWorkflowStorageIds",
      "cleanupTicketStorageIds",
      "migrationStorageId",
    ],
    "payload",
  );

  const version = integer(field(map, "catalogVersion"), "catalog version");
  if (version !== CATALOG_VERSION) {
    throw new CodecError("catalog declares an unsupported version");
  }

  return validateLocalCatalog({
    catalogVersion: CATALOG_VERSION,
    catalogRevision: integer(field(map, "catalogRevision"), "catalog revision"),
    deviceId: text(field(map, "deviceId"), "device id"),
    settings: decodeSettings(field(map, "settings")),
    apps: list(field(map, "apps"), "apps").map(decodeApp),
    homes: list(field(map, "homes"), "homes").map(decodeHome),
    activeWorkflowStorageIds: list(
      field(map, "activeWorkflowStorageIds"),
      "workflow references",
    ).map((value) => text(value, "workflow reference")),
    cleanupTicketStorageIds: list(
      field(map, "cleanupTicketStorageIds"),
      "cleanup references",
    ).map((value) => text(value, "cleanup reference")),
    migrationStorageId: optionalText(
      field(map, "migrationStorageId"),
      "migration storage id",
    ),
  });
}
