import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { RELATIONSHIP_DETECTION_SOURCES } from "../../../src/domain/model/schema.js";
import {
  DECISION_KINDS,
  IMPORT_KINDS,
  INERT_ITEM_KINDS,
  INERT_REASON_KEYS,
  SHEET_CLASSIFICATIONS,
} from "../../../src/domain/model/snapshots.js";
import { SHEET_CLASSIFICATIONS as PROJECTION_CLASSIFICATIONS } from "../../../src/persistence/projection/types.js";

/**
 * The closed lists migration 005 also closes must be the same lists, member for
 * member: a value the domain can hold but the projection's CHECK refuses would
 * dispose a projection at open time, long after the import that wrote it.
 */
const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");

/** The quoted members of the `IN (...)` list following `column`. */
const checkList = (column: string): readonly string[] => {
  const at = sql.indexOf(`${column} TEXT NOT NULL CHECK`);
  expect(at, column).toBeGreaterThan(0);
  const list = sql.slice(sql.indexOf("IN (", at), sql.indexOf(")", sql.indexOf("IN (", at)));
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
};

describe("workbook roots vocabularies", () => {
  it("closes decision kinds at migration 005's CHECK list", () => {
    expect([...DECISION_KINDS]).toEqual(checkList("decision_kind"));
  });

  it("closes detection sources at migration 005's CHECK list", () => {
    expect([...RELATIONSHIP_DETECTION_SOURCES]).toEqual(checkList("detection_source"));
  });

  it("closes import kinds at migration 005's CHECK list", () => {
    expect([...IMPORT_KINDS]).toEqual(checkList("import_kind"));
  });

  it("is the one classification list the projection also exports", () => {
    expect(PROJECTION_CLASSIFICATIONS).toBe(SHEET_CLASSIFICATIONS);
    expect([...SHEET_CLASSIFICATIONS]).toEqual([
      "table",
      "lookup",
      "summary",
      "chart",
      "snapshot",
    ]);
  });

  it("keeps D40's sixteen inert kinds and a closed reason list, frozen", () => {
    expect(INERT_ITEM_KINDS).toHaveLength(16);
    expect(INERT_REASON_KEYS).toContain("formula-not-live-yet");
    // CA-33 (F04 S07): F03's durable keys keep decoding beside the two new ones.
    expect(INERT_REASON_KEYS).toEqual(expect.arrayContaining(["chart-not-live-yet", "chart-not-rebuilt", "formula-not-supported"]));
    for (const list of [
      DECISION_KINDS,
      IMPORT_KINDS,
      INERT_ITEM_KINDS,
      INERT_REASON_KEYS,
      SHEET_CLASSIFICATIONS,
      RELATIONSHIP_DETECTION_SOURCES,
    ]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
  });
});
