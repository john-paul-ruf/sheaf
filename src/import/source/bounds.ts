/**
 * The fixed bounds every container and markup reader enforces (invariant 8,
 * FR-3; D31's container caps).
 *
 * A bound is a promise about the reader, not about the file: whatever a file
 * declares, no reader allocates, expands, nests, or walks beyond these
 * numbers. Crossing one ends the read with a {@link BoundExceededError} whose
 * `detail` is a closed token, so the refusal a user sees names the class of
 * problem and never echoes a byte of the file.
 */

export const CONTAINER_BOUNDS_V1 = Object.freeze({
  maxZipEntries: 10_000,
  maxEntryPathBytes: 1_024,
  /** Measured actual decompressed / compressed bytes, per entry. */
  maxExpansionRatio: 100,
  /**
   * The ratio is enforced once an entry has produced this many bytes. A tiny
   * part (a 300-byte styles sheet that compresses 120:1) is not a bomb, and
   * judging it by ratio alone would refuse ordinary workbooks; every byte past
   * the grace is still held to the ratio. Precedent: Apache POI's
   * `ZipSecureFile` grace size.
   */
  expansionRatioGraceBytes: 102_400,
  /** 512 MiB decompressed across one import (one opened container). */
  maxTotalExpandedBytes: 536_870_912,
  maxXmlDepth: 256,
  maxXmlNameBytes: 1_024,
  /** Also bounds one text run and one markup construct (tag, comment, PI). */
  maxXmlAttributeValueBytes: 1_048_576,
  maxCfbDirectoryEntries: 10_000,
  maxCfbSectorChain: 1 << 22,
  /** Excel's grid; a declared cell beyond it is an impossible dimension. */
  maxRow: 1_048_576,
  maxColumn: 16_384,
} as const);

export type ContainerBoundsV1 = {
  readonly [K in keyof typeof CONTAINER_BOUNDS_V1]: number;
};

export const UNREADABLE_DETAILS = Object.freeze([
  "truncated-container",
  "expansion-limit",
  "directory-loop",
  "impossible-dimension",
  "entity-declaration",
  "encrypted-workbook",
  "malformed-structure",
  "unrecognized-content",
] as const);

export type UnreadableDetailV1 = (typeof UNREADABLE_DETAILS)[number];

/**
 * The only error a container or markup reader throws on hostile input. The
 * message is the detail token itself — never file content — so it is safe to
 * log and safe to cross a worker boundary.
 */
export class BoundExceededError extends Error {
  constructor(readonly detail: UnreadableDetailV1) {
    super(detail);
    this.name = "BoundExceededError";
  }
}

export const isBoundExceeded = (cause: unknown): cause is BoundExceededError =>
  cause instanceof BoundExceededError;
