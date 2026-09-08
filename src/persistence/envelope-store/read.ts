/**
 * Envelope reads (database.md § IndexedDB Query Patterns).
 *
 * Exactly two patterns exist: resolve one authenticated pointer by primary
 * key, and page the rows one transaction introduced through the
 * `[revision+storageId]` compound index. There is deliberately no semantic
 * cursor — nothing here can guess what a row contains, and scope is never
 * returned because it is never stored.
 */

import Dexie from "dexie";
import { CodecError } from "../../domain/model/errors.js";
import {
  decodeStorageId16,
  encodeStorageId16,
  type StorageId16,
} from "../../domain/model/bytes.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import { openLocalDatabase } from "./db.js";
import { rowToFrame } from "./frame-row.js";

export const REVISION_PAGE_SIZE = 256;

/** Resume point: the last `(revision, storageId)` a caller already handled. */
export interface RevisionCursor {
  readonly afterStorageId?: StorageId16;
  readonly limit?: number;
}

export interface RevisionPage {
  readonly frames: readonly EnvelopeFrameV1[];
  /** Present only when more rows of this revision may remain. */
  readonly nextCursor: RevisionCursor | undefined;
}

export async function getEnvelope(
  storageId: StorageId16,
): Promise<EnvelopeFrameV1 | undefined> {
  const database = await openLocalDatabase();
  const row = await database.envelopes.get(encodeStorageId16(storageId));
  return row === undefined ? undefined : rowToFrame(row);
}

export async function getEnvelopesByRevision(
  revision: number,
  cursor: RevisionCursor = {},
): Promise<RevisionPage> {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new CodecError("revision must be a safe integer of at least 1");
  }
  const limit = cursor.limit ?? REVISION_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new CodecError("page limit must be a positive safe integer");
  }

  const database = await openLocalDatabase();
  const after = cursor.afterStorageId;
  const rows = await database.envelopes
    .where("[revision+storageId]")
    .between(
      [revision, after === undefined ? "" : encodeStorageId16(after)],
      [revision, Dexie.maxKey],
      after === undefined,
      true,
    )
    .limit(limit)
    .toArray();

  const last = rows.at(-1);
  return {
    frames: rows.map(rowToFrame),
    nextCursor:
      rows.length === limit && last !== undefined
        ? { afterStorageId: decodeStorageId16(last.storageId), limit }
        : undefined,
  };
}
