/**
 * Branded byte primitives shared by every durable representation.
 *
 * Storage IDs are 16 CSPRNG bytes written as 22-character unpadded base64url
 * in IndexedDB and provider names (database.md § Identifiers). Only the
 * canonical spelling of those bytes is accepted: a decode that would not
 * re-encode to the exact same text is rejected, so two spellings can never
 * name one row.
 *
 * M01 imports nothing outward, so the byte length is stated here rather than
 * imported from `src/migrations/`; `tests/unit/codecs/bytes.test.ts` pins it
 * to migration 003's `STORAGE_ID_BYTES`.
 */

import { CodecError } from "./errors.js";

export const STORAGE_ID_BYTE_LENGTH = 16;
export const STORAGE_ID_TEXT_LENGTH = 22;

declare const storageIdBrand: unique symbol;

/** Exactly {@link STORAGE_ID_BYTE_LENGTH} raw bytes, never a domain ID. */
export type StorageId16 = Uint8Array & { readonly [storageIdBrand]: true };

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const BASE64URL_VALUES = new Map<string, number>(
  [...BASE64URL_ALPHABET].map((character, index) => [character, index]),
);

export function asStorageId16(bytes: Uint8Array): StorageId16 {
  if (bytes.byteLength !== STORAGE_ID_BYTE_LENGTH) {
    throw new CodecError("storage id must be 16 bytes");
  }
  return bytes as StorageId16;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number;
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    text += BASE64URL_ALPHABET[first >> 2];
    text += BASE64URL_ALPHABET[((first & 0b11) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) {
      break;
    }
    text += BASE64URL_ALPHABET[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) {
      break;
    }
    text += BASE64URL_ALPHABET[third & 0b111111];
  }
  return text;
}

/** Rejects padding, non-alphabet characters, and non-zero trailing bits. */
export function decodeBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) {
    throw new CodecError("base64url text has an impossible length");
  }

  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bitBuffer = 0;
  let bitCount = 0;
  let written = 0;

  for (const character of text) {
    const value = BASE64URL_VALUES.get(character);
    if (value === undefined) {
      throw new CodecError("base64url text has a non-alphabet character");
    }
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[written++] = (bitBuffer >> bitCount) & 0xff;
    }
  }

  if ((bitBuffer & ((1 << bitCount) - 1)) !== 0) {
    throw new CodecError("base64url text has non-canonical trailing bits");
  }
  return bytes;
}

export function encodeStorageId16(storageId: StorageId16): string {
  return encodeBase64Url(storageId);
}

export function decodeStorageId16(text: string): StorageId16 {
  if (text.length !== STORAGE_ID_TEXT_LENGTH) {
    throw new CodecError("storage id text must be 22 characters");
  }
  const bytes = decodeBase64Url(text);
  if (encodeBase64Url(bytes) !== text) {
    throw new CodecError("storage id text is not canonical base64url");
  }
  return asStorageId16(bytes);
}

/** Compares in time that depends on length only, never on content. */
export function constantTimeEquals(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}
