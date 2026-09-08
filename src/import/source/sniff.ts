/**
 * Content-determined format detection (FR-1: "format is determined by file
 * content, never by file extension").
 *
 * The extension is still read, but only as a **claim**: when it disagrees with
 * the bytes, the bytes win and the disagreement is reported as a fact the
 * review surface states to the user (MOD-004). Nothing here refuses anything —
 * routing a detected format to a refusal is pre-flight's job (M14) — and
 * nothing here reads more than {@link SNIFF_SAMPLE_BYTES} leading bytes.
 *
 * Detection never throws on hostile input. Arbitrary bytes always land
 * somewhere in {@link DetectedFormatV1}; the worst answer is `binary`.
 */

import type { RandomAccessSource } from "./source.js";

/** The bounded leading window every detection decision is made from. */
export const SNIFF_SAMPLE_BYTES = 8192;

export const DELIMITERS = Object.freeze([",", "\t", ";", "|"] as const);

export type DelimiterV1 = (typeof DELIMITERS)[number];

export const TEXT_ENCODINGS = Object.freeze([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
] as const);

/**
 * `windows-1252` is the latin-1 fallback: it is what a byte sequence that is
 * not valid UTF-8 but is also not binary almost always is, and it decodes
 * every byte, so the fallback can never itself fail.
 */
export type TextEncodingV1 = (typeof TEXT_ENCODINGS)[number];

export const NEWLINE_CONVENTIONS = Object.freeze(["lf", "crlf", "cr"] as const);

export type NewlineConventionV1 = (typeof NEWLINE_CONVENTIONS)[number];

/**
 * Which zip-hosted document family the container is. F02 refuses all of them
 * (D19/D20); F03's adapters route on this value instead of on the extension.
 */
export type ZipContainerV1 = "ooxml" | "ods" | "iwork" | "unknown";

export type DetectedFormatV1 =
  | {
      readonly kind: "delimited";
      readonly delimiter: DelimiterV1;
      readonly encoding: TextEncodingV1;
      /** Bytes of byte-order mark to skip before decoding; 0, 2, or 3. */
      readonly bomByteLength: number;
      readonly newline: NewlineConventionV1;
    }
  | { readonly kind: "zip-container"; readonly container: ZipContainerV1 }
  | { readonly kind: "cfb" }
  | { readonly kind: "pdf" }
  | { readonly kind: "html-table" }
  | { readonly kind: "binary" };

export type DetectedFormatKindV1 = DetectedFormatV1["kind"];

/** The one detected format F02 goes on to parse. */
export type DelimitedFormatV1 = Extract<DetectedFormatV1, { kind: "delimited" }>;

export interface ExtensionContradictionV1 {
  /** Lowercased, without the dot. */
  readonly declaredExtension: string;
  readonly expectedKind: DetectedFormatKindV1;
  readonly detectedKind: DetectedFormatKindV1;
}

export interface SniffResultV1 {
  readonly format: DetectedFormatV1;
  readonly declaredName: string;
  readonly declaredExtension: string | null;
  /** Non-null when the extension claimed a different format than the bytes. */
  readonly contradiction: ExtensionContradictionV1 | null;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06];

const matchesAt = (
  bytes: Uint8Array,
  offset: number,
  magic: readonly number[],
): boolean =>
  offset + magic.length <= bytes.byteLength &&
  magic.every((byte, index) => bytes[offset + index] === byte);

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  matchesAt(bytes, 0, magic);

const ascii = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

/**
 * Names of the local file headers visible in the sample. Central-directory
 * chains are deliberately not walked: scanning for the fixed signature is
 * bounded by the sample, cannot loop, and is enough to classify the family.
 */
const zipEntryNames = (bytes: Uint8Array): string[] => {
  const names: string[] = [];
  for (let index = 0; index + 30 <= bytes.byteLength; index += 1) {
    if (!matchesAt(bytes, index, ZIP_LOCAL_HEADER)) {
      continue;
    }
    const nameLength =
      (bytes[index + 26] as number) | ((bytes[index + 27] as number) << 8);
    const nameStart = index + 30;
    if (nameLength === 0 || nameStart + nameLength > bytes.byteLength) {
      continue;
    }
    names.push(ascii(bytes.subarray(nameStart, nameStart + nameLength)));
  }
  return names;
};

const classifyZip = (bytes: Uint8Array): ZipContainerV1 => {
  const names = zipEntryNames(bytes);
  if (names.includes("[Content_Types].xml")) {
    return "ooxml";
  }
  if (
    names.some((name) => name.startsWith("Index/") || name.endsWith(".iwa"))
  ) {
    return "iwork";
  }
  if (
    names.includes("mimetype") &&
    ascii(bytes).includes("application/vnd.oasis.opendocument")
  ) {
    return "ods";
  }
  return "unknown";
};

const bomEncoding = (
  bytes: Uint8Array,
): { encoding: TextEncodingV1; bomByteLength: number } | null => {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return { encoding: "utf-8", bomByteLength: 3 };
  }
  if (startsWith(bytes, [0xff, 0xfe])) {
    return { encoding: "utf-16le", bomByteLength: 2 };
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return { encoding: "utf-16be", bomByteLength: 2 };
  }
  return null;
};

/**
 * Decodes the sample for inspection only. The trailing bytes of a bounded
 * window usually cut a character in half, so the decoder is non-fatal here and
 * the parser — which sees whole chunks in order — is the one that decodes for
 * real.
 */
const decodeSample = (bytes: Uint8Array, encoding: TextEncodingV1): string =>
  new TextDecoder(encoding).decode(bytes);

const isValidUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/**
 * A sample that cuts a multi-byte character in half is still text. Trimming
 * the last few bytes before the strict probe keeps a truncated tail from being
 * mistaken for binary; 3 is the longest UTF-8 continuation run that can be
 * left dangling by a cut inside a 4-byte sequence.
 */
const looksLikeUtf8 = (bytes: Uint8Array, isWholeFile: boolean): boolean =>
  isValidUtf8(bytes) ||
  (!isWholeFile &&
    bytes.byteLength > 3 &&
    isValidUtf8(bytes.subarray(0, bytes.byteLength - 3)));

const HTML_ROOT = /^\s*(?:<!doctype\s+html|<html[\s>]|<table[\s>]|<meta[\s>])/i;
const HTML_TABLE = /<table[\s>]/i;

const isHtmlTable = (text: string): boolean =>
  HTML_ROOT.test(text) && HTML_TABLE.test(text);

const detectNewline = (text: string): NewlineConventionV1 => {
  const carriageReturn = text.indexOf("\r");
  if (carriageReturn === -1) {
    return "lf";
  }
  const lineFeed = text.indexOf("\n");
  if (lineFeed === carriageReturn + 1) {
    return "crlf";
  }
  return lineFeed === -1 || lineFeed > carriageReturn ? "cr" : "lf";
};

const mode = (values: readonly number[]): number => {
  const tally = new Map<number, number>();
  for (const value of values) {
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  let best = values[0] as number;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Counts each candidate outside quoted spans on every complete line of the
 * sample, then keeps the candidate whose per-line count is both non-zero and
 * most consistent. Consistency beats raw frequency: prose commas appear
 * erratically, a real delimiter appears the same number of times on every row.
 * Ties resolve by {@link DELIMITERS} order so detection is deterministic.
 */
const detectDelimiter = (text: string): DelimiterV1 => {
  const lines = text.split(/\r\n|\n|\r/).slice(0, 64);
  const complete = lines.length > 1 ? lines.slice(0, -1) : lines;
  const counts = new Map<DelimiterV1, number[]>(
    DELIMITERS.map((delimiter) => [delimiter, []]),
  );

  let inQuotes = false;
  for (const line of complete) {
    const perLine = new Map<DelimiterV1, number>(
      DELIMITERS.map((delimiter) => [delimiter, 0]),
    );
    for (const character of line) {
      if (character === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (inQuotes) {
        continue;
      }
      const delimiter = DELIMITERS.find((candidate) => candidate === character);
      if (delimiter !== undefined) {
        perLine.set(delimiter, (perLine.get(delimiter) ?? 0) + 1);
      }
    }
    for (const delimiter of DELIMITERS) {
      counts.get(delimiter)?.push(perLine.get(delimiter) ?? 0);
    }
  }

  let best: DelimiterV1 = ",";
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const perLine = counts.get(delimiter) ?? [];
    const populated = perLine.filter((count) => count > 0);
    if (populated.length === 0) {
      continue;
    }
    const modal = mode(populated);
    const agreeing = perLine.filter((count) => count === modal).length;
    const score = agreeing * modal;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
};

const EXPECTED_BY_EXTENSION = new Map<string, DetectedFormatKindV1>([
  ["csv", "delimited"],
  ["tsv", "delimited"],
  ["txt", "delimited"],
  ["xlsx", "zip-container"],
  ["xlsm", "zip-container"],
  ["xlsb", "zip-container"],
  ["ods", "zip-container"],
  ["numbers", "zip-container"],
  ["pages", "zip-container"],
  ["xls", "cfb"],
  ["pdf", "pdf"],
  ["html", "html-table"],
  ["htm", "html-table"],
]);

const extensionOf = (declaredName: string): string | null => {
  const dot = declaredName.lastIndexOf(".");
  if (dot <= 0 || dot === declaredName.length - 1) {
    return null;
  }
  return declaredName.slice(dot + 1).toLowerCase();
};

const detectFormat = (
  bytes: Uint8Array,
  isWholeFile: boolean,
): DetectedFormatV1 => {
  if (startsWith(bytes, PDF_MAGIC)) {
    return { kind: "pdf" };
  }
  if (startsWith(bytes, CFB_MAGIC)) {
    return { kind: "cfb" };
  }
  if (
    startsWith(bytes, ZIP_LOCAL_HEADER) ||
    startsWith(bytes, ZIP_EMPTY_ARCHIVE)
  ) {
    return { kind: "zip-container", container: classifyZip(bytes) };
  }

  const bom = bomEncoding(bytes);
  const body = bom === null ? bytes : bytes.subarray(bom.bomByteLength);

  let encoding: TextEncodingV1;
  if (bom !== null) {
    encoding = bom.encoding;
  } else if (body.includes(0)) {
    return { kind: "binary" };
  } else if (looksLikeUtf8(body, isWholeFile)) {
    encoding = "utf-8";
  } else {
    encoding = "windows-1252";
  }

  const text = decodeSample(body, encoding);
  if (isHtmlTable(text)) {
    return { kind: "html-table" };
  }
  return {
    kind: "delimited",
    delimiter: detectDelimiter(text),
    encoding,
    bomByteLength: bom?.bomByteLength ?? 0,
    newline: detectNewline(text),
  };
};

const contradictionOf = (
  declaredExtension: string | null,
  detected: DetectedFormatKindV1,
): ExtensionContradictionV1 | null => {
  if (declaredExtension === null) {
    return null;
  }
  const expectedKind = EXPECTED_BY_EXTENSION.get(declaredExtension);
  if (expectedKind === undefined || expectedKind === detected) {
    return null;
  }
  return { declaredExtension, expectedKind, detectedKind: detected };
};

/**
 * Reads at most {@link SNIFF_SAMPLE_BYTES} leading bytes and answers what the
 * file actually is. `declaredName` supplies only the extension claim.
 */
export async function sniffContent(
  source: RandomAccessSource,
  declaredName: string,
): Promise<SniffResultV1> {
  const sample = await source.slice(0, SNIFF_SAMPLE_BYTES);
  const format = detectFormat(
    sample,
    sample.byteLength === source.byteLength,
  );
  const declaredExtension = extensionOf(declaredName);
  return {
    format,
    declaredName,
    declaredExtension,
    contradiction: contradictionOf(declaredExtension, format.kind),
  };
}
