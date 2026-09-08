/**
 * The one persistent local database connection (`sheaf-local`).
 *
 * The schema is DB-phase-owned: this file registers migration 001's
 * declaration and never writes a version or store string of its own (CA-06).
 * Table accessors are getters rather than declared fields so class-field
 * semantics can never shadow the tables Dexie installs on the instance.
 */

import Dexie, { type Table } from "dexie";
import {
  LOCAL_BOOTSTRAP_SLOT,
  LOCAL_DATABASE_NAME,
  registerLocalStoreV1,
  type LocalBootstrapRowV1,
  type LocalEnvelopeRowV1,
} from "../../migrations/001_local_store_v1.js";

export class SheafLocalDatabase extends Dexie {
  constructor(name: string = LOCAL_DATABASE_NAME) {
    super(name);
    registerLocalStoreV1(this);
  }

  get bootstrap(): Table<LocalBootstrapRowV1, typeof LOCAL_BOOTSTRAP_SLOT> {
    return this.table("bootstrap");
  }

  get envelopes(): Table<LocalEnvelopeRowV1, string> {
    return this.table("envelopes");
  }
}

let connection: SheafLocalDatabase | undefined;

/** Opens the shared connection, or returns the already-open one. */
export async function openLocalDatabase(): Promise<SheafLocalDatabase> {
  const database = (connection ??= new SheafLocalDatabase());
  if (!database.isOpen()) {
    await database.open();
  }
  return database;
}

/**
 * Drops the shared connection. A closed handle is not reused: a later
 * {@link openLocalDatabase} builds a fresh one, so a database deleted while
 * locked cannot be resurrected through a stale auto-opening handle.
 */
export function closeLocalDatabase(): void {
  connection?.close({ disableAutoOpen: true });
  connection = undefined;
}
