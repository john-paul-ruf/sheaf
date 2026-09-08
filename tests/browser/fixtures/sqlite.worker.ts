/**
 * Test-only probe worker for the sqlite-wasm seam (D16).
 *
 * It exercises exactly what M12 will depend on and nothing more: the WASM
 * module initializes inside a real dedicated module worker, an in-memory
 * database opens, a trivial query answers, an `fts5` virtual table can be
 * created and matched, and `PRAGMA user_version` round-trips — the mechanism
 * `migrateProjectionSchema` uses to decide whether a projection needs building.
 *
 * It lives under `tests/browser/fixtures/` rather than `src/`: the projection
 * is S02's module, and the product tree gains no file for a toolchain proof.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

export interface SqliteProbeResultV1 {
  readonly libVersion: string;
  readonly selectOne: number;
  readonly hasFts5: boolean;
  readonly ftsMatchedRowId: number;
  readonly userVersionAfterSet: number;
  readonly memoryOnly: boolean;
}

const probe = async (): Promise<SqliteProbeResultV1> => {
  const sqlite3 = await sqlite3InitModule();
  const { SQLITE_INTEGER, SQLITE_TEXT } = sqlite3.capi;
  const db = new sqlite3.oo1.DB(":memory:");

  const requireText = (sql: string): string => {
    const value = db.selectValue(sql, undefined, SQLITE_TEXT);
    if (value === undefined) {
      throw new Error(`sqlite returned no row for: ${sql}`);
    }
    return value;
  };

  const requireInteger = (sql: string): number => {
    const value = db.selectValue(sql, undefined, SQLITE_INTEGER);
    if (value === undefined) {
      throw new Error(`sqlite returned no row for: ${sql}`);
    }
    return value;
  };

  try {
    const hasFts5 =
      requireInteger("SELECT sqlite_compileoption_used('ENABLE_FTS5')") === 1;

    db.exec(
      "CREATE VIRTUAL TABLE probe_search USING fts5(body, tokenize='unicode61');",
    );
    db.exec({
      sql: "INSERT INTO probe_search(rowid, body) VALUES (?, ?);",
      bind: [7, "sheaf projection smoke"],
    });

    db.exec("PRAGMA user_version = 1;");

    return {
      libVersion: requireText("SELECT sqlite_version()"),
      selectOne: requireInteger("SELECT 1"),
      hasFts5,
      ftsMatchedRowId: requireInteger(
        "SELECT rowid FROM probe_search WHERE probe_search MATCH 'projection';",
      ),
      userVersionAfterSet: requireInteger("PRAGMA user_version"),
      // A `:memory:` database has no file, so its filename is the empty string.
      memoryOnly: requireText("SELECT file FROM pragma_database_list()") === "",
    };
  } finally {
    db.close();
  }
};

void probe().then(
  (result) => {
    self.postMessage({ ok: true, result });
  },
  (cause: unknown) => {
    self.postMessage({ ok: false, reason: String(cause) });
  },
);
