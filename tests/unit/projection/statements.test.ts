import { describe, expect, it } from "vitest";
import * as statements from "../../../src/persistence/projection/statements.js";
import { FORMULA_ISSUE_MESSAGE_KEYS } from "../../../src/domain/validation/rules.js";

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
  INSERT_SCHEMA_FIELD: 11,
  UPDATE_SCHEMA_FIELD: 10,
  UPDATE_SCHEMA_FIELD_ORDINAL: 2,
  UPDATE_SCHEMA_TABLE: 7,
  UPDATE_APP_STATE_NAME: 1,
  INSERT_ENUM_OPTION: 6,
  DELETE_ENUM_OPTIONS_FOR_FIELD: 1,
  INSERT_VALIDATION_RULE: 8,
  UPSERT_VALIDATION_RULE: 7,
  DEACTIVATE_VALIDATION_RULE: 2,
  UPSERT_FORMULA: 12,
  DEACTIVATE_FORMULA: 2,
  DELETE_FORMULA_DEPENDENCIES: 1,
  INSERT_FORMULA_DEPENDENCY: 3,
  INSERT_RELATIONSHIP: 8,
  UPDATE_RELATIONSHIP: 8,
  DELETE_RELATIONSHIP: 1,
  INSERT_INERT_CONTENT: 7,
  INSERT_IMPORT_LINEAGE: 8,
  INSERT_INFERENCE_DECISION: 7,
  INSERT_RECORD: 6,
  SELECT_LAST_INSERT_ROWID: 0,
  UPDATE_RECORD: 4,
  DELETE_RECORD: 1,
  INSERT_CELL: 10,
  DELETE_AUTHORED_CELLS_FOR_RECORD: 1,
  INSERT_RECORD_ISSUE: 8,
  DELETE_VALIDATOR_ISSUES_FOR_RECORD: 1,
  DELETE_RECALCULATED_ISSUES_FOR_CELL: 2,
  DELETE_RECALCULATED_ISSUES_FOR_FIELD: 1,
  SELECT_RECALCULATED_ISSUES_FOR_RECORD: 1,
  DELETE_COMPUTED_CELL: 2,
  DELETE_COMPUTED_CELLS_FOR_FIELD: 1,
  SELECT_COMPUTED_CELLS_FOR_RECORD: 1,
  UPSERT_SCALAR_RESULT: 4,
  DELETE_SCALAR_RESULT: 1,
  SELECT_SCALAR_RESULTS: 0,
  SELECT_SCALAR_RESULT: 1,
  SELECT_RECORD_ROWS_FOR_TABLE: 1,
  INSERT_SEARCH_ROW: 2,
  DELETE_SEARCH_ROW: 1,
  INSERT_CHANGE_HISTORY: 12,
  SELECT_PROJECTION_META: 0,
  SELECT_APP_STATE: 0,
  SELECT_ACTIVE_TABLES: 0,
  SELECT_FIELDS_FOR_TABLE: 1,
  SELECT_ENUM_OPTIONS_FOR_FIELD: 1,
  SELECT_RULES_FOR_TABLE: 1,
  SELECT_ALL_RELATIONSHIPS: 0,
  SELECT_RELATIONSHIPS_FOR_TABLE: 2,
  SELECT_RECORD_IS_LIVE: 2,
  SELECT_RELATIONSHIP_BY_ID: 1,
  PAGE_CHILDREN_FIRST: 3,
  PAGE_CHILDREN_AFTER: 4,
  COUNT_CHILDREN: 2,
  SELECT_LATEST_DELETE_FOR_RECORD: 1,
  SELECT_SHEET_SNAPSHOTS: 0,
  COUNT_INERT_BY_SHEET_AND_KIND: 0,
  SELECT_ALL_INERT_ITEMS: 0,
  SELECT_INERT_ITEMS_FOR_SHEET: 1,
  SELECT_ALL_INFERENCE_DECISIONS: 0,
  SELECT_INFERENCE_DECISIONS_OF_KIND: 1,
  COUNT_RECORDS_FOR_TABLE: 1,
  // A fragment, not a statement: the records query composes it (filter-sql.ts).
  RECORD_SUMMARY_COLUMNS: 0,
  PAGE_RECORDS_FIRST: 2,
  PAGE_RECORDS_AFTER: 3,
  SEARCH_RECORDS_FIRST: 3,
  SEARCH_RECORDS_AFTER: 4,
  SELECT_RECORD_BY_ID: 1,
  SELECT_RECORD_STATE_BY_ID: 1,
  SELECT_RECORDS_FOR_TABLE: 1,
  SELECT_SCHEMA_REVISION: 0,
  SELECT_PROJECTION_APP_ID: 0,
  SELECT_CELLS_FOR_RECORD: 1,
  SELECT_ISSUES_FOR_RECORD: 1,
  PAGE_CHANGE_HISTORY_FIRST: 1,
  PAGE_CHANGE_HISTORY_AFTER: 4,
  SELECT_HISTORY_FOR_RECORD: 2,
  SELECT_DELETE_EVENT_FOR_RECORD: 1,
  SELECT_SEARCH_ROWIDS: 1,
};

/**
 * The five message keys recalculation owns (CA-26): M02's formula keys minus
 * the validator's own refusal of a user write.
 */
const RECALCULATED_KEYS = FORMULA_ISSUE_MESSAGE_KEYS.filter(
  (key) => key !== "computed-not-authored",
);

/**
 * The only quoted literals allowed inside a statement: values from migration
 * 005's own closed CHECK sets, and M02's closed formula issue keys. Anything
 * else quoted would be a value the engine wrote into SQL instead of binding.
 */
const ALLOWED_LITERALS = new Set([
  "'blocking'",
  "'warning'",
  "'record'",
  "'record.deleted'",
  "'id'",
  "'authored'",
  "'computed'",
  "'formula'",
  ...RECALCULATED_KEYS.map((key) => `'${key}'`),
]);

const sqlEntries = Object.entries(
  statements as Record<string, unknown>,
).filter((entry): entry is [string, string] => typeof entry[1] === "string");

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

  it("leaves recalculation's issues and lanes alone on a record write, naming exactly its keys", () => {
    for (const sql of [
      statements.DELETE_VALIDATOR_ISSUES_FOR_RECORD,
      statements.DELETE_RECALCULATED_ISSUES_FOR_CELL,
      statements.DELETE_RECALCULATED_ISSUES_FOR_FIELD,
      statements.SELECT_RECALCULATED_ISSUES_FOR_RECORD,
    ]) {
      const named = (sql.match(/'[a-z-]+'/g) ?? []).filter((literal) => literal !== "'formula'");
      expect(named.sort()).toEqual(RECALCULATED_KEYS.map((key) => `'${key}'`).sort());
    }
    expect(RECALCULATED_KEYS).toHaveLength(5);
    expect(statements.DELETE_AUTHORED_CELLS_FOR_RECORD).toContain("origin = 'authored'");
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
