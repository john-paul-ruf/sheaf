/**
 * Stable domain identities (database.md § Identifiers).
 *
 * Every domain ID is 16 CSPRNG bytes, generated before its first committed use
 * and immutable afterwards: renames, re-upload, adoption, compaction, theme
 * edits, and provider changes all preserve it. An ID is never derived from a
 * name, a row position, or a storage ID — the clear storage ID and the
 * encrypted domain ID must not be relatable.
 *
 * The brand is per-kind, so a `TableId` cannot be passed where a `FieldId` is
 * required even though both are 16 bytes at runtime. Nothing outside this
 * module may fabricate a branded value: {@link asDomainId} is the only widening
 * path and it checks the length first.
 *
 * `DOMAIN_ID_BYTE_LENGTH` is stated here rather than imported, because M01
 * imports nothing outward; `tests/unit/domain/ids.test.ts` pins it against
 * migration 005's `length(...) = 16` column checks.
 */

import { CodecError } from "./errors.js";
import {
  constantTimeEquals,
  decodeBase64Url,
  encodeBase64Url,
} from "./bytes.js";

export const DOMAIN_ID_BYTE_LENGTH = 16;
export const DOMAIN_ID_TEXT_LENGTH = 22;

export const DOMAIN_ID_KINDS = Object.freeze([
  "app",
  "table",
  "field",
  "record",
  "event",
  "commit",
  "device",
  "segment",
  "option",
  "rule",
  "lineage",
  "sheet",
] as const);

export type DomainIdKind = (typeof DOMAIN_ID_KINDS)[number];

declare const domainIdBrand: unique symbol;

/** Exactly {@link DOMAIN_ID_BYTE_LENGTH} bytes, tagged with what they name. */
export type DomainId<K extends DomainIdKind> = Uint8Array & {
  readonly [domainIdBrand]: K;
};

export type AppId = DomainId<"app">;
export type TableId = DomainId<"table">;
export type FieldId = DomainId<"field">;
export type RecordId = DomainId<"record">;
export type EventId = DomainId<"event">;
export type CommitId = DomainId<"commit">;
export type DeviceId = DomainId<"device">;
export type SegmentId = DomainId<"segment">;
export type OptionId = DomainId<"option">;
export type RuleId = DomainId<"rule">;
export type LineageId = DomainId<"lineage">;
export type SheetId = DomainId<"sheet">;

export type AnyDomainId = DomainId<DomainIdKind>;

/**
 * The randomness dependency, stated structurally so the pure domain imports
 * nothing outward. M07's `EntropyPort` satisfies it without an adapter.
 */
export interface DomainEntropy {
  randomBytes(byteLength: number): Uint8Array;
}

/** Widens checked bytes to the requested kind; the only branding path. */
export function asDomainId<K extends DomainIdKind>(
  _kind: K,
  bytes: Uint8Array,
): DomainId<K> {
  if (bytes.byteLength !== DOMAIN_ID_BYTE_LENGTH) {
    throw new CodecError("domain id must be 16 bytes");
  }
  return bytes as DomainId<K>;
}

/** Fresh unpredictable bytes — never a hash of a name or a counter. */
export function createDomainId<K extends DomainIdKind>(
  kind: K,
  entropy: DomainEntropy,
): DomainId<K> {
  return asDomainId(kind, entropy.randomBytes(DOMAIN_ID_BYTE_LENGTH));
}

/**
 * A non-durable text spelling for map keys, test names, and redacted logs. The
 * durable representation of a domain ID is always its 16 raw bytes inside an
 * encrypted payload; this string never reaches IndexedDB or a provider name,
 * where only clear storage IDs appear.
 */
export function encodeDomainId(id: AnyDomainId): string {
  return encodeBase64Url(id);
}

export function decodeDomainId<K extends DomainIdKind>(
  kind: K,
  text: string,
): DomainId<K> {
  if (text.length !== DOMAIN_ID_TEXT_LENGTH) {
    throw new CodecError("domain id text must be 22 characters");
  }
  const bytes = decodeBase64Url(text);
  if (encodeBase64Url(bytes) !== text) {
    throw new CodecError("domain id text is not canonical base64url");
  }
  return asDomainId(kind, bytes);
}

/** Identity of two IDs of the same kind; the type stops cross-kind compares. */
export function domainIdsEqual<K extends DomainIdKind>(
  left: DomainId<K>,
  right: DomainId<K>,
): boolean {
  return constantTimeEquals(left, right);
}

/**
 * Bytewise order, which is the canonical sort for every durable ordering that
 * names an ID: frontier entries, record pages, and the commit order tiebreak.
 */
export function compareDomainIds(left: AnyDomainId, right: AnyDomainId): number {
  for (let index = 0; index < DOMAIN_ID_BYTE_LENGTH; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
