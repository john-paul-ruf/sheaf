/**
 * The composed records query holds `statements.ts`'s rule by construction
 * (CA-29, "prepared SQL only"): every fragment is a literal, every value a
 * bound parameter. This suite compiles every term and sort with hostile
 * values and reads the statement text back.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foldText } from "../../../src/domain/formulas/scalars.js";
import {
  candidateBoundaryStatement,
  candidateCountStatement,
  matchCountStatement,
  pageStatement,
  type ComposedStatementV1,
  type QueryScopeV1,
} from "../../../src/persistence/projection/filter-sql.js";
import {
  disposeProjection,
  type ProjectionFilterTermV1,
  type ProjectionHandleV1,
  type ProjectionRecordSortV1,
} from "../../../src/persistence/projection/index.js";
import { CUSTOMER, F, JOBS, OPTION, openQueryProjection } from "./query-fixture.js";

let handle: ProjectionHandleV1;

beforeAll(async () => {
  handle = await openQueryProjection();
});

afterAll(() => {
  disposeProjection(handle);
});

const HOSTILE = "x' OR 1=1; DROP TABLE records; --";

/** One of every term, carrying the most hostile value each can hold. */
const TERMS: readonly ProjectionFilterTermV1[] = [
  { kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.scheduled, OPTION.done] },
  { kind: "id-in", fieldId: F.customer.fieldId, ids: [CUSTOMER.c1] },
  { kind: "integer-range", fieldId: F.due.fieldId, min: 20_000, max: null },
  { kind: "decimal-range", fieldId: F.quoted.fieldId, min: "-12.5", max: "99999" },
  { kind: "text-equals", fieldId: F.name.fieldId, text: HOSTILE },
  { kind: "text-contains", fieldId: F.name.fieldId, text: HOSTILE },
  { kind: "reference-broken", fieldId: F.customer.fieldId },
  { kind: "is-empty", fieldId: F.due.fieldId, isComputed: false },
  { kind: "not-empty", fieldId: F.balance.fieldId, isComputed: true },
];

const SORTS: readonly ProjectionRecordSortV1[] = [
  { fieldId: F.name.fieldId, direction: "asc", key: "text" },
  { fieldId: F.quoted.fieldId, direction: "desc", key: "decimal" },
  { fieldId: F.due.fieldId, direction: "asc", key: "integer" },
  { fieldId: F.status.fieldId, direction: "desc", key: "option-ordinal" },
  { fieldId: F.customer.fieldId, direction: "asc", key: "reference-label" },
];

const scope: QueryScopeV1 = { tableId: JOBS, match: `"${HOSTILE}"*`, boundaryPk: 5 };

/**
 * The only quoted literals a composed statement may hold: lane kinds and
 * authored value kinds, all closed sets (migration 005 and M01).
 */
const ALLOWED_LITERALS = new Set([
  "'id'",
  "'integer'",
  "'decimal'",
  "'text'",
  "'missing'",
  "'blank'",
  "'invalid-preserved'",
  "'blocking'",
  "'warning'",
]);

function everyStatement(): readonly ComposedStatementV1[] {
  return [
    candidateCountStatement(scope, 51),
    candidateBoundaryStatement(scope, 50),
    matchCountStatement(handle, scope, TERMS),
    pageStatement(handle, scope, TERMS, null, null, 51),
    pageStatement(handle, scope, TERMS, null, { recordPk: 3, sortValue: null }, 51),
    ...SORTS.flatMap((sort) => [
      pageStatement(handle, scope, TERMS, sort, null, 51),
      pageStatement(handle, scope, TERMS, sort, { recordPk: 3, sortValue: 7 }, 51),
      pageStatement(handle, scope, TERMS, sort, { recordPk: 3, sortValue: null }, 51),
    ]),
  ];
}

describe("the composed records query", () => {
  it("never writes a value into its text", () => {
    for (const statement of everyStatement()) {
      expect(statement.sql).not.toContain("DROP");
      expect(statement.sql).not.toContain("1=1");
      expect(statement.sql).not.toContain("99999");
      expect(statement.sql).not.toContain("20000");
    }
  });

  it("binds exactly one value per placeholder", () => {
    for (const statement of everyStatement()) {
      expect(statement.sql.split("?").length - 1).toBe(statement.parameters.length);
    }
  });

  it("carries the hostile text as a bound value", () => {
    const page = pageStatement(handle, scope, TERMS, null, null, 51);
    // Text filters bind the case-folded operand (case-insensitive NFC).
    expect(page.parameters).toContain(foldText(HOSTILE));
    expect(page.parameters).toContain(`"${HOSTILE}"*`);
  });

  it("quotes nothing but closed lane and value kinds", () => {
    for (const statement of everyStatement()) {
      for (const literal of statement.sql.match(/'[^']*'/g) ?? []) {
        expect(ALLOWED_LITERALS.has(literal), `quotes ${literal}`).toBe(true);
      }
    }
  });

  it("defines, alters and drops nothing", () => {
    for (const statement of everyStatement()) {
      expect(/\b(CREATE|ALTER|DROP|ATTACH|VACUUM|INSERT|UPDATE|DELETE)\b/i.test(statement.sql)).toBe(false);
    }
  });

  it("detects a value written into the text (negative control)", () => {
    const leaked = { sql: `SELECT 1 WHERE x = '${HOSTILE}'`, parameters: [] };
    expect(leaked.sql.split("?").length - 1).toBe(0);
    expect((leaked.sql.match(/'[^']*'/g) ?? []).every((literal) => ALLOWED_LITERALS.has(literal))).toBe(false);
  });
});
