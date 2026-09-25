import { CodecError } from "../../domain/model/errors.js";
import { constantTimeEquals } from "../../domain/model/bytes.js";
import { CURRENT_FORMAT_VERSIONS as versions } from "../../migrations/index.js";
import { BUNDLE_MAGIC, BUNDLE_FOOTER_MAGIC, VAULT_HEADER_MAGIC,
  type VaultHeaderV1, type VaultIndexV1, type AppManifestV1, type BundleFooterV1,
  type VaultAppEntryV1, type WrappedKeyV1, type VaultArgon2idDescriptorV1,
  type VaultRecoveryKdfDescriptorV1 } from "../../migrations/006_vault_format_v1.js";
import type { EnvelopeReferenceV1, EnvelopeScopeV1 } from "../../migrations/003_envelope_format_v1.js";
import type { FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import { isEnvelopeScopeV1, isPaddedBucket } from "./envelope-frame.js";
import { decodeCanonical, encodeCanonical, type CborValue } from "./canonical-cbor.js";

const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
type Reader<T> = (value: unknown) => T;
function fail(message: string): never { throw new CodecError(message); }
function map(value: unknown, required: readonly string[], optional: readonly string[] = []): ReadonlyMap<string, unknown> {
  if (!(value instanceof Map)) return fail("vault value must be a map");
  const fields = value as Map<unknown, unknown>;
  for (const name of required) if (!fields.has(name)) fail(`missing vault field: ${name}`);
  for (const name of fields.keys()) {
    if (typeof name !== "string" || (!required.includes(name) && !optional.includes(name))) fail("unknown vault field");
  }
  return fields as ReadonlyMap<string, unknown>;
}
function uint(value: unknown, minimum = 0n): bigint {
  if (typeof value !== "bigint" || value < minimum || value > UINT64_MAX) return fail("invalid uint64");
  return value;
}
function number(value: unknown): number {
  const result = Number(uint(value));
  if (!Number.isSafeInteger(result)) return fail("unsafe dimension");
  return result;
}
function literal<T extends string | number | boolean>(value: unknown, expected: T): T {
  if (value !== (typeof expected === "number" ? BigInt(expected) : expected)) fail("unsupported version or literal");
  return expected;
}
function bytes(value: unknown, size: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== size) return fail(`expected ${size} bytes`);
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return fail("expected nonempty text");
  return value;
}
function list<T>(value: unknown, read: Reader<T>): T[] {
  if (!Array.isArray(value)) return fail("expected array");
  return (value as unknown[]).map(read);
}
function nullableHash(value: unknown): Uint8Array | null { return value === null ? null : bytes(value, 32); }
export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i]! - right[i]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
function sorted<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  for (let i = 1; i < items.length; i++) if (compare(items[i - 1]!, items[i]!) >= 0) fail("duplicate or unsorted entries");
  return items;
}
function byId<T>(items: T[], id: (item: T) => Uint8Array): T[] {
  return sorted(items, (a, b) => compareBytes(id(a), id(b)));
}
function predecessor(generation: bigint, hash: Uint8Array | null): void {
  if ((generation === 1n) !== (hash === null)) fail("invalid generation predecessor");
}
export function readFrontier(value: unknown): FrontierEntryV1[] {
  return byId(list(value, (entry) => {
    const m = map(entry, ["deviceId", "commitSequence"]);
    return { deviceId: bytes(m.get("deviceId"), 16), commitSequence: uint(m.get("commitSequence"), 1n) };
  }), (entry) => entry.deviceId);
}
export function readEnvelopeReference(value: unknown): EnvelopeReferenceV1 {
  const m = map(value, ["storageId", "scope", "logicalRevision", "envelopeFormatVersion", "codecVersion", "cipherSuiteVersion", "paddedBytes", "ciphertextSha256"]);
  const scope = text(m.get("scope"));
  if (!isEnvelopeScopeV1(scope)) fail("unknown reference scope");
  const paddedBytes = number(m.get("paddedBytes"));
  if (!isPaddedBucket(paddedBytes)) fail("invalid padding dimension");
  return { storageId: bytes(m.get("storageId"), 16), scope, logicalRevision: uint(m.get("logicalRevision"), 1n),
    envelopeFormatVersion: literal(m.get("envelopeFormatVersion"), versions.envelope),
    codecVersion: literal(m.get("codecVersion"), versions.codec),
    cipherSuiteVersion: literal(m.get("cipherSuiteVersion"), versions.cipherSuite),
    paddedBytes, ciphertextSha256: bytes(m.get("ciphertextSha256"), 32) };
}
function scoped(value: unknown, scope: EnvelopeScopeV1): EnvelopeReferenceV1 {
  const ref = readEnvelopeReference(value);
  if (ref.scope !== scope) fail("reference scope does not match graph role");
  return ref;
}
function refs(value: unknown, scope?: EnvelopeScopeV1, logicalOrder = false): EnvelopeReferenceV1[] {
  const result = list(value, (item) => scope === undefined ? readEnvelopeReference(item) : scoped(item, scope));
  const ids = new Set(result.map((ref) => [...ref.storageId].join(",")));
  if (ids.size !== result.length) fail("duplicate reference");
  // Evidence order is authenticated by the payload reader, not physical storage metadata.
  if (logicalOrder) return result;
  return sorted(result, (a, b) => a.logicalRevision < b.logicalRevision ? -1 : a.logicalRevision > b.logicalRevision ? 1 : compareBytes(a.storageId, b.storageId));
}
function wrapped(value: unknown): WrappedKeyV1 {
  const m = map(value, ["wrapId", "nonce", "ciphertext"]);
  return { wrapId: bytes(m.get("wrapId"), 16), nonce: bytes(m.get("nonce"), 24), ciphertext: bytes(m.get("ciphertext"), 48) };
}
function salt(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length < 16 || value.length > 1024) return fail("invalid KDF salt");
  return value;
}
function passphraseKdf(value: unknown): VaultArgon2idDescriptorV1 {
  const m = map(value, ["algorithm", "algorithmVersion", "salt", "memoryKiB", "iterations", "lanes", "outputBytes", "context"]);
  const memoryKiB = number(m.get("memoryKiB"));
  const iterations = number(m.get("iterations"));
  if (memoryKiB < 65536 || iterations < 3) fail("KDF below floor");
  return { algorithm: literal(m.get("algorithm"), "argon2id"), algorithmVersion: literal(m.get("algorithmVersion"), 0x13),
    salt: salt(m.get("salt")), memoryKiB, iterations, lanes: literal(m.get("lanes"), 1),
    outputBytes: literal(m.get("outputBytes"), 32), context: literal(m.get("context"), "sheaf/vault/passphrase/v1") };
}
function recoveryKdf(value: unknown): VaultRecoveryKdfDescriptorV1 {
  const m = map(value, ["algorithm", "salt", "outputBytes", "context"]);
  return { algorithm: literal(m.get("algorithm"), "hkdf-sha-256"), salt: salt(m.get("salt")),
    outputBytes: literal(m.get("outputBytes"), 32), context: literal(m.get("context"), "sheaf/vault/recovery/v1") };
}
function readHeader(value: unknown): VaultHeaderV1 {
  const m = map(value, ["magic", "vaultFormatVersion", "minimumReaderVersion", "codecVersion", "envelopeFormatVersion", "cipherSuiteVersion", "paddingProfileVersion", "vaultId", "passphraseKdf", "recoveryKdf", "passphraseWrappedVaultKey", "recoveryWrappedVaultKey", "generation", "currentIndex", "previousHeadSha256"]);
  const generation = uint(m.get("generation"), 1n);
  const currentIndex = scoped(m.get("currentIndex"), "vault.index");
  const previousHeadSha256 = nullableHash(m.get("previousHeadSha256"));
  predecessor(generation, previousHeadSha256);
  if (currentIndex.logicalRevision !== generation) fail("index generation mismatch");
  const passphrase = passphraseKdf(m.get("passphraseKdf"));
  const recovery = recoveryKdf(m.get("recoveryKdf"));
  if (constantTimeEquals(passphrase.salt, recovery.salt)) fail("vault salts must be independent");
  return { magic: literal(m.get("magic"), VAULT_HEADER_MAGIC), vaultFormatVersion: literal(m.get("vaultFormatVersion"), versions.vault),
    minimumReaderVersion: literal(m.get("minimumReaderVersion"), versions.vault), codecVersion: literal(m.get("codecVersion"), versions.codec),
    envelopeFormatVersion: literal(m.get("envelopeFormatVersion"), versions.envelope), cipherSuiteVersion: literal(m.get("cipherSuiteVersion"), versions.cipherSuite),
    paddingProfileVersion: literal(m.get("paddingProfileVersion"), versions.paddingProfile), vaultId: bytes(m.get("vaultId"), 16),
    passphraseKdf: passphrase, recoveryKdf: recovery, passphraseWrappedVaultKey: wrapped(m.get("passphraseWrappedVaultKey")),
    recoveryWrappedVaultKey: wrapped(m.get("recoveryWrappedVaultKey")), generation, currentIndex, previousHeadSha256 };
}
function appEntry(value: unknown): VaultAppEntryV1 {
  const m = map(value, ["appId", "displayName", "wrappedAppKey", "manifest", "lastSuccessfulBackupMs", "totalPaddedBytes", "appSchemaRevision", "confirmedFrontier"], ["recordCount", "lastOpenedAtMs"]);
  return { appId: bytes(m.get("appId"), 16), displayName: text(m.get("displayName")), wrappedAppKey: wrapped(m.get("wrappedAppKey")),
    manifest: scoped(m.get("manifest"), "vault.app-manifest"), lastSuccessfulBackupMs: uint(m.get("lastSuccessfulBackupMs")),
    totalPaddedBytes: uint(m.get("totalPaddedBytes")), appSchemaRevision: uint(m.get("appSchemaRevision")), confirmedFrontier: readFrontier(m.get("confirmedFrontier")),
    ...(m.has("recordCount") ? { recordCount: uint(m.get("recordCount")) } : {}),
    ...(m.has("lastOpenedAtMs") ? { lastOpenedAtMs: uint(m.get("lastOpenedAtMs")) } : {}) };
}
function readIndex(value: unknown): VaultIndexV1 {
  const m = map(value, ["vaultFormatVersion", "vaultId", "generation", "previousIndexSha256", "recoveryCodeForReview", "apps", "deletionMarkers", "deviceReceipts", "retainedGenerationRoots", "createdAtMs", "committedAtMs"]);
  const generation = uint(m.get("generation"), 1n);
  const previousIndexSha256 = nullableHash(m.get("previousIndexSha256"));
  predecessor(generation, previousIndexSha256);
  const apps = byId(list(m.get("apps"), appEntry), (app) => app.appId);
  const deletionMarkers = sorted(list(m.get("deletionMarkers"), (value) => {
    const d = map(value, ["markerId", "appId", "deletedAtMs", "deletingDeviceId", "deletionGeneration", "finalManifestSha256", "finalFrontier", "retention"]);
    return { markerId: bytes(d.get("markerId"), 16), appId: bytes(d.get("appId"), 16), deletedAtMs: uint(d.get("deletedAtMs")),
      deletingDeviceId: bytes(d.get("deletingDeviceId"), 16), deletionGeneration: uint(d.get("deletionGeneration"), 1n),
      finalManifestSha256: bytes(d.get("finalManifestSha256"), 32), finalFrontier: readFrontier(d.get("finalFrontier")), retention: literal(d.get("retention"), "permanent") };
  }), (a, b) => compareBytes(a.appId, b.appId) || compareBytes(a.markerId, b.markerId));
  for (const marker of deletionMarkers) {
    if (marker.deletionGeneration > generation || apps.some((app) => constantTimeEquals(app.appId, marker.appId))) fail("deletion marker resurrection or future generation");
  }
  const deviceReceipts = byId(list(m.get("deviceReceipts"), (value) => {
    const d = map(value, ["deviceId", "lastObservedGeneration", "observedAtMs", "appFrontiers"]);
    return { deviceId: bytes(d.get("deviceId"), 16), lastObservedGeneration: uint(d.get("lastObservedGeneration"), 1n),
      observedAtMs: uint(d.get("observedAtMs")), appFrontiers: byId(list(d.get("appFrontiers"), (value) => {
        const f = map(value, ["appId", "frontier"]);
        return { appId: bytes(f.get("appId"), 16), frontier: readFrontier(f.get("frontier")) };
      }), (f) => f.appId) };
  }), (receipt) => receipt.deviceId);
  const retainedGenerationRoots = sorted(list(m.get("retainedGenerationRoots"), (value) => {
    const r = map(value, ["generation", "index", "headSha256"]);
    const retained = uint(r.get("generation"), 1n);
    const index = scoped(r.get("index"), "vault.index");
    if (retained >= generation || index.logicalRevision !== retained) fail("retained generation mismatch");
    return { generation: retained, index, headSha256: bytes(r.get("headSha256"), 32) };
  }), (a, b) => a.generation < b.generation ? -1 : a.generation > b.generation ? 1 : 0);
  if (apps.some((app) => app.manifest.logicalRevision > generation) || deviceReceipts.some((r) => r.lastObservedGeneration > generation)) fail("future generation");
  const createdAtMs = uint(m.get("createdAtMs"));
  const committedAtMs = uint(m.get("committedAtMs"));
  if (committedAtMs < createdAtMs) fail("commit time precedes creation");
  return { vaultFormatVersion: literal(m.get("vaultFormatVersion"), versions.vault), vaultId: bytes(m.get("vaultId"), 16),
    generation, previousIndexSha256, recoveryCodeForReview: text(m.get("recoveryCodeForReview")), apps, deletionMarkers,
    deviceReceipts, retainedGenerationRoots, createdAtMs, committedAtMs };
}
function readManifest(value: unknown): AppManifestV1 {
  const m = map(value, ["vaultFormatVersion", "appId", "generation", "previousManifestSha256", "checkpoint", "eventSegments", "baselinePages", "conflictPages", "auditPages", "sourceManifests", "snapshotManifests", "retainedRoots", "confirmedFrontier", "semanticSha256", "totalPaddedBytes"]);
  return { vaultFormatVersion: literal(m.get("vaultFormatVersion"), versions.vault), appId: bytes(m.get("appId"), 16),
    generation: uint(m.get("generation"), 1n), previousManifestSha256: nullableHash(m.get("previousManifestSha256")),
    checkpoint: scoped(m.get("checkpoint"), "app.checkpoint"), eventSegments: refs(m.get("eventSegments"), "app.events"),
    baselinePages: refs(m.get("baselinePages"), "app.baselines", true), conflictPages: refs(m.get("conflictPages"), "app.conflicts", true),
    auditPages: refs(m.get("auditPages"), "app.audit", true), sourceManifests: refs(m.get("sourceManifests"), "app.source-manifest"),
    snapshotManifests: refs(m.get("snapshotManifests"), "app.snapshot-manifest"), retainedRoots: refs(m.get("retainedRoots")),
    confirmedFrontier: readFrontier(m.get("confirmedFrontier")), semanticSha256: bytes(m.get("semanticSha256"), 32), totalPaddedBytes: uint(m.get("totalPaddedBytes")) };
}
function readFooter(value: unknown): BundleFooterV1 {
  const m = map(value, ["vaultFormatVersion", "directory", "directorySha256", "complete"]);
  return { vaultFormatVersion: literal(m.get("vaultFormatVersion"), versions.vault), complete: literal(m.get("complete"), true),
    directorySha256: bytes(m.get("directorySha256"), 32), directory: byId(list(m.get("directory"), (value) => {
      const d = map(value, ["storageId", "byteOffset", "byteLength", "ciphertextSha256"]);
      return { storageId: bytes(d.get("storageId"), 16), byteOffset: uint(d.get("byteOffset")), byteLength: uint(d.get("byteLength"), 1n), ciphertextSha256: bytes(d.get("ciphertextSha256"), 32) };
    }), (entry) => entry.storageId) };
}

/** Wire structs become canonical maps; decoding validates both writer and reader. */
export function vaultValue(value: unknown): CborValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "number" || value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return (value as unknown[]).map(vaultValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail("invalid vault structure");
  return new Map(Object.entries(value).map(([key, item]) => [key, vaultValue(item)]));
}
function encode<T>(value: T, read: Reader<T>): Uint8Array {
  const encoded = encodeCanonical(vaultValue(value));
  read(decodeCanonical(encoded));
  return encoded;
}
export const encodeVaultHeader = (value: VaultHeaderV1): Uint8Array => encode(value, readHeader);
export const decodeVaultHeader = (value: Uint8Array): VaultHeaderV1 => readHeader(decodeCanonical(value));
export const encodeVaultIndex = (value: VaultIndexV1): Uint8Array => encode(value, readIndex);
export const decodeVaultIndex = (value: Uint8Array): VaultIndexV1 => readIndex(decodeCanonical(value));
export const encodeAppManifest = (value: AppManifestV1): Uint8Array => encode(value, readManifest);
export const decodeAppManifest = (value: Uint8Array): AppManifestV1 => readManifest(decodeCanonical(value));
export const encodeBundleFooter = (value: BundleFooterV1): Uint8Array => encode(value, readFooter);
export const decodeBundleFooter = (value: Uint8Array): BundleFooterV1 => readFooter(decodeCanonical(value));

export function assertIndexMatchesHeader(header: VaultHeaderV1, index: VaultIndexV1): void {
  if (!constantTimeEquals(header.vaultId, index.vaultId) || header.generation !== index.generation) fail("vault/index identity mismatch");
}
export function assertManifestMatchesEntry(entry: VaultAppEntryV1, manifest: AppManifestV1): void {
  if (!constantTimeEquals(entry.appId, manifest.appId) || entry.manifest.logicalRevision !== manifest.generation ||
      entry.totalPaddedBytes !== manifest.totalPaddedBytes ||
      !constantTimeEquals(encodeCanonical(vaultValue(entry.confirmedFrontier)), encodeCanonical(vaultValue(manifest.confirmedFrontier)))) fail("app/manifest identity mismatch");
}

// Fixed big-endian framing: magic + uint16 version + uint32 header length;
// trailer: uint64 footer length + terminal magic. Offsets count from byte zero.
export const BUNDLE_PREAMBLE_BYTES = BUNDLE_MAGIC.length + 6;
export const BUNDLE_TRAILER_BYTES = 8 + BUNDLE_FOOTER_MAGIC.length;
export function encodeBundlePreamble(headerByteLength: number): Uint8Array {
  if (!Number.isSafeInteger(headerByteLength) || headerByteLength < 1 || headerByteLength > 16_777_216) fail("invalid header length");
  const result = new Uint8Array(BUNDLE_PREAMBLE_BYTES);
  result.set(new TextEncoder().encode(BUNDLE_MAGIC));
  const view = new DataView(result.buffer);
  view.setUint16(BUNDLE_MAGIC.length, versions.vault);
  view.setUint32(BUNDLE_MAGIC.length + 2, headerByteLength);
  return result;
}
export function decodeBundlePreamble(input: Uint8Array): number {
  if (input.length !== BUNDLE_PREAMBLE_BYTES) fail("invalid preamble length");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const length = view.getUint32(BUNDLE_MAGIC.length + 2);
  if (!constantTimeEquals(input, encodeBundlePreamble(length))) fail("invalid bundle preamble");
  return length;
}
export function encodeBundleTrailer(footerByteLength: bigint): Uint8Array {
  if (footerByteLength < 1n || footerByteLength > 16_777_216n) fail("invalid footer length");
  const result = new Uint8Array(BUNDLE_TRAILER_BYTES);
  new DataView(result.buffer).setBigUint64(0, footerByteLength);
  result.set(new TextEncoder().encode(BUNDLE_FOOTER_MAGIC), 8);
  return result;
}
export function decodeBundleTrailer(input: Uint8Array): bigint {
  if (input.length !== BUNDLE_TRAILER_BYTES) fail("invalid trailer length");
  const length = new DataView(input.buffer, input.byteOffset, input.byteLength).getBigUint64(0);
  if (!constantTimeEquals(input, encodeBundleTrailer(length))) fail("invalid terminal trailer");
  return length;
}
export function assertBundleDirectoryBounds(footer: BundleFooterV1, objectsStart: bigint, footerStart: bigint): void {
  let offset = objectsStart;
  for (const entry of footer.directory) {
    if (entry.byteOffset !== offset || entry.byteLength < 62n || entry.byteOffset + entry.byteLength > footerStart) fail("overlapping, missing or out-of-range bundle bytes");
    offset += entry.byteLength;
  }
  if (offset !== footerStart) fail("trailing or missing bundle objects");
}
