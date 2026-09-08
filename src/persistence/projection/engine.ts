/**
 * The SQLite lifetime: open, migrate, run, dispose.
 *
 * The database is always `:memory:`. It holds the plaintext working set of one
 * unlocked app and it is never written anywhere — locking the app terminates
 * the worker, and terminating the worker is the scrub (invariant 3). Nothing
 * here persists, exports, or copies a byte out of the process.
 *
 * The schema is not this module's to state. Migration 005 is Genesis-owned and
 * arrives as a build asset (`?raw`, CA-06); `migrateProjectionSchema` decides
 * whether to run it and this module only supplies the two operations that
 * decision needs — read `PRAGMA user_version`, execute a script. A projection
 * created by a newer build is rejected there, not reinterpreted here.
 *
 * **Failure disposes everything.** `withTransaction` rolls back and then closes
 * the database: a constraint, trigger, or replay-guard failure must never leave
 * a half-loaded app that looks usable (database.md § Projection load order).
 * Every entry point checks the handle first, so a call after disposal throws
 * instead of silently answering from a dead connection.
 */

import sqlite3InitModule, {
  type Database,
  type PreparedStatement,
  type SqlValue,
} from "@sqlite.org/sqlite-wasm";

import { CodecError, IntegrityError } from "../../domain/model/errors.js";
import projectionSchemaSql from "../../migrations/005_projection_v1.sql?raw";
import {
  CURRENT_FORMAT_VERSIONS,
  migrateProjectionSchema,
  PROJECTION_MIGRATION_ORDER,
  type ProjectionMigrationHost,
  type ProjectionMigrationScripts,
} from "../../migrations/index.js";
import type { EventCommitV1 } from "../../migrations/004_event_format_v1.js";
import type { ProjectionSchemaCacheV1, Sha256Fn } from "./types.js";
import { READ_USER_VERSION } from "./statements.js";

/** Every value the engine binds. Bytes are BLOBs; bigints are narrowed first. */
export type SqlParam = string | number | Uint8Array | null;

export interface OpenProjectionInitV1 {
  /**
   * SHA-256 over exact bytes — M08's `sha256` in production. The replay guards
   * recompute commit hashes with it; the engine holds no other cryptography and
   * no key material of any kind.
   */
  readonly sha256: Sha256Fn;
}

/**
 * An open projection. The fields are engine-internal state shared with the
 * hydrate/replay/query modules; callers hold it as an opaque token.
 */
export interface ProjectionHandleV1 {
  readonly database: Database;
  readonly sha256: Sha256Fn;
  readonly statements: Map<string, PreparedStatement>;
  readonly schema: ProjectionSchemaCacheV1;
  /**
   * Every commit applied so far, in the order applied. The chain guard is fed
   * the accumulated set rather than one segment, because a per-device chain
   * cannot be verified across a gap the verifier was never shown (D27 puts one
   * commit in each segment).
   */
  readonly appliedCommits: EventCommitV1[];
  /** Highest applied commit sequence per device, keyed by device ID text. */
  readonly frontier: Map<string, bigint>;
  hydrated: boolean;
  disposed: boolean;
}

const migrationScripts = (): ProjectionMigrationScripts => {
  if (
    PROJECTION_MIGRATION_ORDER.length !== 1 ||
    PROJECTION_MIGRATION_ORDER[0] !== "005_projection_v1.sql"
  ) {
    throw new CodecError("projection migration order is not the shipped set");
  }
  return { "005_projection_v1.sql": projectionSchemaSql };
};

/**
 * Opens an empty in-memory projection and brings it to the current schema.
 * Nothing is hydrated yet: an app arrives through `hydrateApp`.
 */
export async function openProjection(
  init: OpenProjectionInitV1,
): Promise<ProjectionHandleV1> {
  const sqlite3 = await sqlite3InitModule();
  const database = new sqlite3.oo1.DB(":memory:");

  const handle: ProjectionHandleV1 = {
    database,
    sha256: init.sha256,
    statements: new Map(),
    schema: {
      tables: new Map(),
      fieldsByTable: new Map(),
      fields: new Map(),
      enumOptions: new Map(),
      optionLabels: new Map(),
    },
    appliedCommits: [],
    frontier: new Map(),
    hydrated: false,
    disposed: false,
  };

  try {
    // Referential integrity is on for the whole connection before any row
    // exists; migration 005 sets it too, and neither place assumes the other.
    database.exec("PRAGMA foreign_keys = ON;");
    await migrateProjectionSchema(migrationHost(handle), migrationScripts());
  } catch (cause) {
    disposeProjection(handle);
    throw cause;
  }

  return handle;
}

/** The host `migrateProjectionSchema` drives; it owns the version decision. */
function migrationHost(handle: ProjectionHandleV1): ProjectionMigrationHost {
  return {
    readUserVersion: () =>
      Promise.resolve(
        Number(
          handle.database.selectValue(READ_USER_VERSION) ?? 0,
        ),
      ),
    executeScript: (sql: string) => {
      handle.database.exec(sql);
      return Promise.resolve();
    },
  };
}

/**
 * Closes the database and empties the caches. Safe to call twice, and safe to
 * call from a failure path — this is the only exit a failed load has.
 */
export function disposeProjection(handle: ProjectionHandleV1): void {
  if (handle.disposed) {
    return;
  }
  handle.disposed = true;
  for (const statement of handle.statements.values()) {
    try {
      statement.finalize();
    } catch {
      // The connection is going away; a statement that cannot be finalized
      // cannot leak anything that closing the database does not take with it.
    }
  }
  handle.statements.clear();
  handle.schema.tables.clear();
  handle.schema.fieldsByTable.clear();
  handle.schema.fields.clear();
  handle.schema.enumOptions.clear();
  handle.schema.optionLabels.clear();
  handle.appliedCommits.length = 0;
  handle.frontier.clear();
  handle.database.close();
}

export function assertUsable(handle: ProjectionHandleV1): void {
  if (handle.disposed) {
    throw new IntegrityError("projection has been disposed");
  }
}

const prepared = (
  handle: ProjectionHandleV1,
  sql: string,
): PreparedStatement => {
  const cached = handle.statements.get(sql);
  if (cached !== undefined) {
    return cached;
  }
  const statement = handle.database.prepare(sql);
  handle.statements.set(sql, statement);
  return statement;
};

const release = (statement: PreparedStatement): void => {
  try {
    statement.reset(true);
  } catch {
    // A statement that fails to reset is unusable, and the only path that
    // reaches here is already disposing the projection.
  }
};

/** Runs a statement that returns no rows. */
export function run(
  handle: ProjectionHandleV1,
  sql: string,
  parameters: readonly SqlParam[] = [],
): void {
  assertUsable(handle);
  const statement = prepared(handle, sql);
  try {
    if (parameters.length > 0) {
      statement.bind(parameters as SqlValue[]);
    }
    statement.step();
  } finally {
    release(statement);
  }
}

/** Runs a query and materializes its rows; every page here is bounded. */
export function selectRows(
  handle: ProjectionHandleV1,
  sql: string,
  parameters: readonly SqlParam[] = [],
): readonly (readonly SqlValue[])[] {
  assertUsable(handle);
  const statement = prepared(handle, sql);
  const rows: SqlValue[][] = [];
  try {
    if (parameters.length > 0) {
      statement.bind(parameters as SqlValue[]);
    }
    while (statement.step()) {
      rows.push(statement.get([]));
    }
  } finally {
    release(statement);
  }
  return rows;
}

export function selectRow(
  handle: ProjectionHandleV1,
  sql: string,
  parameters: readonly SqlParam[] = [],
): readonly SqlValue[] | null {
  const rows = selectRows(handle, sql, parameters);
  return rows[0] ?? null;
}

/**
 * One unit of load or replay. A failure inside rolls the work back and disposes
 * the whole projection: a partially loaded app is never marked usable, and the
 * caller sees the original failure rather than a rollback error.
 */
export async function withTransaction<T>(
  handle: ProjectionHandleV1,
  work: () => Promise<T> | T,
): Promise<T> {
  assertUsable(handle);
  handle.database.exec("BEGIN IMMEDIATE;");
  try {
    const result = await work();
    handle.database.exec("COMMIT;");
    return result;
  } catch (cause) {
    try {
      handle.database.exec("ROLLBACK;");
    } catch {
      // Rollback of an already-aborted transaction is not the failure worth
      // reporting; the original cause is.
    }
    disposeProjection(handle);
    throw cause;
  }
}

/** SQLite integers are 64-bit; JavaScript numbers are what we bind. */
export function toSqlInteger(value: bigint | number): number {
  const asNumber = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(asNumber)) {
    throw new CodecError("projection integer is outside the safe range");
  }
  return asNumber;
}

export const PROJECTION_FORMAT_VERSION = CURRENT_FORMAT_VERSIONS.projection;
export const EVENT_FORMAT_VERSION = CURRENT_FORMAT_VERSIONS.event;
