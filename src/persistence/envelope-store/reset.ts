/**
 * Reset purge (CAP-07).
 *
 * Deleting the database is the whole erasure: the local root is only ever
 * reachable through the wrappers in the bootstrap row, so removing the store
 * removes every key path to the ciphertext with it.
 *
 * This runs while locked, so it deletes by name rather than through the shared
 * connection: opening a database you are about to destroy would run migration
 * work first and would fail on a store written by a newer build — exactly the
 * situation a user most needs reset to survive. Repeating it is harmless.
 */

import Dexie from "dexie";
import { LOCAL_DATABASE_NAME } from "../../migrations/001_local_store_v1.js";
import { closeLocalDatabase } from "./db.js";

export async function purgeLocalStore(): Promise<void> {
  closeLocalDatabase();
  await Dexie.delete(LOCAL_DATABASE_NAME);
}
