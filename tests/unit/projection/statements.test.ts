import { describe, expect, it } from "vitest";
import * as statements from "../../../src/persistence/projection/statements.js";

/**
 * The closed-template gate (database.md § SQLite Query Patterns).
 *
 * Every statement the projection can run is a literal with a fixed number of
 * placeholders, and this suite is what keeps that true: a new statement must be
 * declared here with its parameter count, and any statement that grew an
 * interpolated value or a DDL verb fails.
 */

/** Statement name → number of bound parameters it takes. */
const EXPECTED_PARAMETERS: Readonly<Record<string, number>> = {
  READ_USER_VERSION: 0,
  INSERT_PROJECTION_META: 9,
  UPDATE_PROJECTION_FRONTIER: 1,
  INSERT_APP_STATE: 11,
  UPDATE_APP_STATE_THEME: 1,
  UPDATE_APP_STATE_SCHEMA_REVISION: 1,
  INSERT_SHEET_SNAPSHOT: 8,
  INSERT_SCHEMA_TABLE: 6,
  UPDATE_SCHEMA_TABLE_FIELD_REFS: 3,
  INSERT_SCHEMA_FIELD: 9,
  INSERT_ENUM_OPTION: 6,
  DELETE_ENUM_OPTIONS_FOR_FIELD: 1,
  INSERT_VALIDATION_RULE: 8,
  INSERT_RECORD: 6,
  SELECT_LAST_INSERT_ROWID: 0,
  UPDATE_RECORD: 4,
  DELETE_RECORD: 1,
  INSERT_CELL: 10,
  DELETE_CELLS_FOR_RECORD: 1,
  INSERT_RECORD_ISSUE: 8,
  DELETE_ISSUES_FOR_RECORD: 1,
  INSERT_SEARCH_ROW: 2,
  DELETE_SEARCH_ROW: 1,
  INSERT_CHANGE_HISTORY: 12,
  SELECT_PROJECTION_META: 0,
  SELECT_APP_STATE: 0,
  SELECT_ACTIVE_TABLES: 0,
  SELECT_FIELDS_FOR_TABLE: 1,
  SELECT_ENUM_OPTIONS_FOR_FIELD: 1,
  SELECT_RULES_FOR_TABLE: 1,
  COUNT_RECORDS_FOR_TABLE: 1,
  PAGE_RECORDS_FIRST: 2,
  PAGE_RECORDS_AFTER: 3,
  SEARCH_RECORDS_FIRST: 3,
  SEARCH_RECORDS_AFTER: 4,
  SELECT_RECORD_BY_ID: 1,
  SELECT_RECORD_PK_BY_ID: 1,
  SELECT_CELLS_FOR_RECORD: 1,
  SELECT_ISSUES_FOR_RECORD: 1,
  PAGE_CHANGE_HISTORY_FIRST: 1,
  PAGE_CHANGE_HISTORY_AFTER: 4,
  SELECT_HISTORY_FOR_RECORD: 2,
  SELECT_DELETE_EVENT_FOR_RECORD: 1,
  SELECT_SEARCH_ROWIDS: 1,
};

/**
 * The only quoted literals allowed inside a statement: values from migration
 * 005's own closed CHECK sets. Anything else quoted would be a value the engine
 * wrote into SQL instead of binding.
 */
const ALLOWED_LITERALS = new Set([
  "'blocking'",
  "'warning'",
  "'record'",
  "'record.deleted'",
]);

const sqlEntries = Object.entries(statements).filter(
  (entry): entry is [string, string] => typeof entry[1] === "string",
);

describe("projection statements", () => {
  it("declares every statement it ships, with its parameter count", () => {
    expect(sqlEntries.map(([name]) => name).sort()).toEqual(
      Object.keys(EXPECTED_PARAMETERS).sort(),
    );

    for (const [name, sql] of sqlEntries) {
      expect(
        { name, placeholders: sql.split("?").length - 1 },
        `${name} placeholder count`,
      ).toEqual({ name, placeholders: EXPECTED_PARAMETERS[name] });
    }
  });

  it("contains no schema definition — the only DDL is migration 005", () => {
    for (const [name, sql] of sqlEntries) {
      expect(
        /\b(CREATE|ALTER|DROP|ATTACH|VACUUM)\b/i.test(sql),
        `${name} must not define or reshape the schema`,
      ).toBe(false);
    }
  });

  it("binds every value instead of quoting one into the statement", () => {
    for (const [name, sql] of sqlEntries) {
      for (const literal of sql.match(/'[^']*'/g) ?? []) {
        expect(ALLOWED_LITERALS.has(literal), `${name} quotes ${literal}`).toBe(
          true,
        );
      }
    }
  });

  it("pages and searches by record_pk so a boundary stays stable", () => {
    // CA-14's producer half: cursors are row keys, never offsets.
    for (const sql of [
      statements.PAGE_RECORDS_AFTER,
      statements.SEARCH_RECORDS_AFTER,
    ]) {
      expect(sql).toContain("r.record_pk > ?");
      expect(sql).toContain("ORDER BY r.record_pk");
      expect(sql).not.toContain("OFFSET");
    }
    expect(statements.COUNT_RECORDS_FOR_TABLE).toContain("count(*)");
  });
});

describe("search text", () => {
  it("keeps a person's words as words, not as query syntax", () => {
    expect(statements.toFtsMatchQuery("ada")).toBe('"ada"*');
    expect(statements.toFtsMatchQuery("  ada lovelace ")).toBe(
      '"ada" AND "lovelace"*',
    );
    // Operators, wildcards, and column filters are words to match, not syntax
    // to obey — and each quoted term is a single token, never a phrase, which
    // `detail=column` could not answer.
    expect(statements.toFtsMatchQuery('ada OR "x" NEAR* a:b -c')).toBe(
      '"ada" AND "OR" AND "x" AND "NEAR" AND "a" AND "b" AND "c"*',
    );
    expect(statements.toFtsMatchQuery("o'brien")).toBe('"o" AND "brien"*');
  });

  it("answers text with no words with no query, rather than matching everything", () => {
    expect(statements.toFtsMatchQuery("")).toBeNull();
    expect(statements.toFtsMatchQuery("   ")).toBeNull();
    expect(statements.toFtsMatchQuery("* -")).toBeNull();
  });

  it("keeps letters and digits from every script", () => {
    expect(statements.toFtsMatchQuery("naïve 42 東京")).toBe(
      '"naïve" AND "42" AND "東京"*',
    );
  });
});
