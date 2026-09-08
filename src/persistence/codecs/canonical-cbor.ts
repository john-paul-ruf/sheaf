/**
 * Sheaf-owned canonical CBOR (codec version 1, D2).
 *
 * Every rule below is a durable-format rule from database.md § Canonical
 * values — "definite lengths, shortest integer encoding, sorted map keys, no
 * duplicate keys, bounded depth, and no application object prototypes" — plus
 * § Global Data Conventions for the value domain:
 *
 * - **Definite lengths only.** Indefinite-length items (additional information
 *   31) are rejected on decode and never produced.
 * - **Shortest integer encoding.** An argument is written in the smallest of
 *   the 5 forms; a decoder that meets a longer form than necessary rejects it.
 * - **Sorted map keys.** Keys are ordered by the bytewise lexicographic order
 *   of their encoded form (RFC 8949 § 4.2.1 core deterministic order), so the
 *   same map always encodes to the same bytes regardless of insertion order.
 * - **No duplicate keys.** Equal encoded keys are rejected on both sides.
 * - **Bounded depth, entries, and size.** Decoding is refused before
 *   allocation when a declared length exceeds the caller's budget.
 * - **No floats in v1.** Numbers and currency are canonical decimal strings
 *   (database.md § Canonical values), so major type 7 float headers and
 *   non-integer JavaScript numbers are rejected on both sides.
 * - **No prototypes, tags, or undefined.** Arrays, `Map`s, `Uint8Array`s,
 *   strings, integers, booleans, and null are the whole value domain.
 * - **Text is NFC.** Non-NFC text is rejected rather than silently normalized,
 *   so `encode(decode(bytes))` is byte-identical to `bytes`.
 *
 * Unsigned 64-bit integers are represented as `bigint`; decoding always yields
 * `bigint` for integers so that a decoded value re-encodes byte-exactly.
 */

import { CodecError } from "../../domain/model/errors.js";

export type CborKey = string | bigint | number;

export type CborValue =
  | boolean
  | null
  | bigint
  | number
  | string
  | Uint8Array
  | readonly CborValue[]
  | ReadonlyMap<CborKey, CborValue>;

export type DecodedKey = string | bigint;

export type DecodedValue =
  | boolean
  | null
  | bigint
  | string
  | Uint8Array
  | readonly DecodedValue[]
  | ReadonlyMap<DecodedKey, DecodedValue>;

export interface DecodeBudget {
  /** Maximum nesting depth of arrays and maps. */
  readonly maxDepth: number;
  /** Maximum number of input bytes that may be presented at all. */
  readonly maxBytes: number;
  /** Maximum elements per array and pairs per map. */
  readonly maxEntries: number;
}

/**
 * Depth 32 is far above any durable Sheaf shape (the deepest is a manifest of
 * pages of cells) and far below a stack hazard; `maxBytes` is the
 * architecture's 16 MiB ciphertext ceiling, which no single decoded payload
 * may exceed (database.md § Padding profile v1); `maxEntries` bounds a single
 * collection to 65,536 members so a hostile header cannot request a huge
 * allocation before its bytes are read.
 */
export const DEFAULT_DECODE_BUDGET: DecodeBudget = Object.freeze({
  maxDepth: 32,
  maxBytes: 16_777_216,
  maxEntries: 65_536,
});

const MAJOR_UNSIGNED = 0;
const MAJOR_NEGATIVE = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_TAG = 6;
const MAJOR_SIMPLE = 7;

const SIMPLE_FALSE = 20;
const SIMPLE_TRUE = 21;
const SIMPLE_NULL = 22;

const UINT64_MAX = 0xffff_ffff_ffff_ffffn;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

class ByteSink {
  #buffer = new Uint8Array(128);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  push(byte: number): void {
    this.#reserve(1);
    this.#buffer[this.#length++] = byte;
  }

  extend(bytes: Uint8Array): void {
    this.#reserve(bytes.byteLength);
    this.#buffer.set(bytes, this.#length);
    this.#length += bytes.byteLength;
  }

  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  #reserve(additional: number): void {
    if (this.#length + additional <= this.#buffer.byteLength) {
      return;
    }
    let capacity = this.#buffer.byteLength * 2;
    while (capacity < this.#length + additional) {
      capacity *= 2;
    }
    const grown = new Uint8Array(capacity);
    grown.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = grown;
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function writeHead(sink: ByteSink, major: number, argument: bigint): void {
  if (argument < 0n || argument > UINT64_MAX) {
    throw new CodecError("integer argument is outside the uint64 range");
  }
  const initial = major << 5;
  if (argument < 24n) {
    sink.push(initial | Number(argument));
    return;
  }
  if (argument <= 0xffn) {
    sink.push(initial | 24);
    sink.push(Number(argument));
    return;
  }
  if (argument <= 0xffffn) {
    sink.push(initial | 25);
    sink.push(Number(argument >> 8n));
    sink.push(Number(argument & 0xffn));
    return;
  }
  if (argument <= 0xffff_ffffn) {
    sink.push(initial | 26);
    for (let shift = 24n; shift >= 0n; shift -= 8n) {
      sink.push(Number((argument >> shift) & 0xffn));
    }
    return;
  }
  sink.push(initial | 27);
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    sink.push(Number((argument >> shift) & 0xffn));
  }
}

function writeInteger(sink: ByteSink, value: bigint): void {
  if (value >= 0n) {
    writeHead(sink, MAJOR_UNSIGNED, value);
    return;
  }
  const argument = -1n - value;
  if (argument > UINT64_MAX) {
    throw new CodecError("integer argument is outside the uint64 range");
  }
  writeHead(sink, MAJOR_NEGATIVE, argument);
}

function writeText(sink: ByteSink, value: string): void {
  if (value.normalize("NFC") !== value) {
    throw new CodecError("text value is not NFC");
  }
  const encoded = textEncoder.encode(value);
  writeHead(sink, MAJOR_TEXT, BigInt(encoded.byteLength));
  sink.extend(encoded);
}

function encodeKey(key: CborKey, depth: number): Uint8Array {
  const sink = new ByteSink();
  if (typeof key === "string") {
    writeText(sink, key);
  } else {
    writeValue(sink, key, depth);
  }
  return sink.toBytes();
}

function writeValue(sink: ByteSink, value: CborValue, depth: number): void {
  if (depth > DEFAULT_DECODE_BUDGET.maxDepth) {
    throw new CodecError("value nests deeper than the codec depth bound");
  }

  if (value === null) {
    sink.push((MAJOR_SIMPLE << 5) | SIMPLE_NULL);
    return;
  }
  if (typeof value === "boolean") {
    sink.push((MAJOR_SIMPLE << 5) | (value ? SIMPLE_TRUE : SIMPLE_FALSE));
    return;
  }
  if (typeof value === "bigint") {
    writeInteger(sink, value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CodecError("only safe-integer numbers encode in codec v1");
    }
    writeInteger(sink, BigInt(value));
    return;
  }
  if (typeof value === "string") {
    writeText(sink, value);
    return;
  }
  if (value instanceof Uint8Array) {
    writeHead(sink, MAJOR_BYTES, BigInt(value.byteLength));
    sink.extend(value);
    return;
  }
  if (Array.isArray(value)) {
    const items = value as readonly CborValue[];
    writeHead(sink, MAJOR_ARRAY, BigInt(items.length));
    for (const item of items) {
      writeValue(sink, item, depth + 1);
    }
    return;
  }
  if (value instanceof Map) {
    const entries = [...(value as ReadonlyMap<CborKey, CborValue>)].map(
      ([key, entryValue]) =>
        ({ key: encodeKey(key, depth + 1), value: entryValue }) as const,
    );
    entries.sort((left, right) => compareBytes(left.key, right.key));
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1] as (typeof entries)[number];
      const current = entries[index] as (typeof entries)[number];
      if (compareBytes(previous.key, current.key) === 0) {
        throw new CodecError("map has duplicate keys");
      }
    }
    writeHead(sink, MAJOR_MAP, BigInt(entries.length));
    for (const entry of entries) {
      sink.extend(entry.key);
      writeValue(sink, entry.value, depth + 1);
    }
    return;
  }

  throw new CodecError("value type has no canonical CBOR encoding in v1");
}

export function encodeCanonical(value: CborValue): Uint8Array {
  const sink = new ByteSink();
  writeValue(sink, value, 1);
  return sink.toBytes();
}

class CanonicalReader {
  #offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly budget: DecodeBudget,
  ) {}

  get offset(): number {
    return this.#offset;
  }

  readValue(depth: number): DecodedValue {
    if (depth > this.budget.maxDepth) {
      throw new CodecError("value nests deeper than the decode budget");
    }

    const initial = this.#readByte();
    const major = initial >> 5;
    const additional = initial & 0b11111;

    if (additional === 31) {
      throw new CodecError("indefinite lengths are not canonical");
    }
    if (additional >= 28) {
      throw new CodecError("reserved additional information is not decodable");
    }

    if (major === MAJOR_SIMPLE) {
      switch (additional) {
        case SIMPLE_FALSE:
          return false;
        case SIMPLE_TRUE:
          return true;
        case SIMPLE_NULL:
          return null;
        default:
          throw new CodecError(
            "floats, undefined, and simple values are not in codec v1",
          );
      }
    }

    const argument = this.#readArgument(additional);

    switch (major) {
      case MAJOR_UNSIGNED:
        return argument;
      case MAJOR_NEGATIVE:
        return -1n - argument;
      case MAJOR_BYTES:
        return this.#readBytes(this.#asLength(argument));
      case MAJOR_TEXT:
        return this.#readText(this.#asLength(argument));
      case MAJOR_ARRAY:
        return this.#readArray(this.#asCount(argument), depth);
      case MAJOR_MAP:
        return this.#readMap(this.#asCount(argument), depth);
      case MAJOR_TAG:
        throw new CodecError("tags are not part of codec v1");
      default:
        throw new CodecError("unknown major type");
    }
  }

  #readByte(): number {
    if (this.#offset >= this.bytes.byteLength) {
      throw new CodecError("input ended inside a value");
    }
    return this.bytes[this.#offset++] as number;
  }

  #readArgument(additional: number): bigint {
    if (additional < 24) {
      return BigInt(additional);
    }
    const width = 1 << (additional - 24);
    let argument = 0n;
    for (let index = 0; index < width; index += 1) {
      argument = (argument << 8n) | BigInt(this.#readByte());
    }
    const minimum = additional === 24 ? 24n : 1n << BigInt((width >> 1) * 8);
    if (argument < minimum) {
      throw new CodecError("integer argument is not shortest-form");
    }
    return argument;
  }

  #asLength(argument: bigint): number {
    const remaining = this.bytes.byteLength - this.#offset;
    if (argument > BigInt(remaining)) {
      throw new CodecError("declared length exceeds the remaining input");
    }
    return Number(argument);
  }

  #asCount(argument: bigint): number {
    if (argument > BigInt(this.budget.maxEntries)) {
      throw new CodecError("collection declares more entries than the budget");
    }
    const remaining = this.bytes.byteLength - this.#offset;
    if (argument > BigInt(remaining)) {
      throw new CodecError("declared entry count exceeds the remaining input");
    }
    return Number(argument);
  }

  #readBytes(length: number): Uint8Array {
    const value = this.bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  #readText(length: number): string {
    let text: string;
    try {
      text = textDecoder.decode(
        this.bytes.subarray(this.#offset, this.#offset + length),
      );
    } catch {
      throw new CodecError("text value is not valid UTF-8");
    }
    this.#offset += length;
    if (text.normalize("NFC") !== text) {
      throw new CodecError("text value is not NFC");
    }
    return text;
  }

  #readArray(count: number, depth: number): readonly DecodedValue[] {
    const items: DecodedValue[] = [];
    for (let index = 0; index < count; index += 1) {
      items.push(this.readValue(depth + 1));
    }
    return items;
  }

  #readMap(count: number, depth: number): ReadonlyMap<DecodedKey, DecodedValue> {
    const entries = new Map<DecodedKey, DecodedValue>();
    let previousKeyBytes: Uint8Array | undefined;

    for (let index = 0; index < count; index += 1) {
      const keyStart = this.#offset;
      const key = this.readValue(depth + 1);
      if (typeof key !== "string" && typeof key !== "bigint") {
        throw new CodecError("map keys are text or integers in codec v1");
      }
      const keyBytes = this.bytes.subarray(keyStart, this.#offset);
      if (previousKeyBytes !== undefined) {
        const order = compareBytes(previousKeyBytes, keyBytes);
        if (order === 0) {
          throw new CodecError("map has duplicate keys");
        }
        if (order > 0) {
          throw new CodecError("map keys are not in canonical order");
        }
      }
      previousKeyBytes = keyBytes;
      entries.set(key, this.readValue(depth + 1));
    }
    return entries;
  }
}

export interface DecodedPrefix {
  readonly value: DecodedValue;
  /** Bytes consumed by the decoded value; the rest of the input is untouched. */
  readonly byteLength: number;
}

/**
 * Decodes the value that starts at byte 0 and reports its length. Used where a
 * value is followed by authenticated padding (envelope inner frames); every
 * other caller wants {@link decodeCanonical}, which refuses trailing bytes.
 */
export function decodeCanonicalPrefix(
  bytes: Uint8Array,
  budget: DecodeBudget = DEFAULT_DECODE_BUDGET,
): DecodedPrefix {
  if (bytes.byteLength > budget.maxBytes) {
    throw new CodecError("input is larger than the decode budget");
  }
  const reader = new CanonicalReader(bytes, budget);
  const value = reader.readValue(1);
  return { value, byteLength: reader.offset };
}

export function decodeCanonical(
  bytes: Uint8Array,
  budget: DecodeBudget = DEFAULT_DECODE_BUDGET,
): DecodedValue {
  const { value, byteLength } = decodeCanonicalPrefix(bytes, budget);
  if (byteLength !== bytes.byteLength) {
    throw new CodecError("input has trailing bytes after the encoded value");
  }
  return value;
}
