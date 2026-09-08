import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  VALIDATION_ISSUE_KINDS,
  VALIDATION_SEVERITIES,
  buildReport,
  type ValidationIssueV1,
} from "../../../src/domain/validation/rules.js";

const issue = (
  severity: ValidationIssueV1["severity"],
): ValidationIssueV1 => ({
  fieldId: null,
  ruleId: null,
  kind: "type",
  severity,
  messageKey: "validation.wrong-type",
  messageParameters: {},
});

describe("validation vocabulary", () => {
  it("matches migration 005's record_issues closed sets", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");

    for (const kind of VALIDATION_ISSUE_KINDS) {
      expect(sql, kind).toContain(`'${kind}'`);
    }
    expect([...VALIDATION_ISSUE_KINDS]).toEqual([
      "type",
      "required",
      "enum",
      "broken-reference",
      "record-rule",
      "formula",
      "schema",
      "conflict",
      "unsupported",
    ]);
    expect([...VALIDATION_SEVERITIES]).toEqual(["warning", "blocking"]);
    expect(sql).toContain("severity IN ('warning', 'blocking')");
  });

  it("keeps the vocabularies frozen", () => {
    expect(Object.isFrozen(VALIDATION_ISSUE_KINDS)).toBe(true);
    expect(Object.isFrozen(VALIDATION_SEVERITIES)).toBe(true);
  });

  it("treats only blocking issues as invalidating", () => {
    expect(buildReport([]).isValid).toBe(true);
    expect(buildReport([issue("warning")]).isValid).toBe(true);
    expect(buildReport([issue("warning"), issue("blocking")]).isValid).toBe(
      false,
    );
    expect(buildReport([issue("blocking")]).issues).toHaveLength(1);
  });
});
