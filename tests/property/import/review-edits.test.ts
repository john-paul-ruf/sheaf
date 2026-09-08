import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ENUM_OPTION_LIMIT,
  inferProposal,
  type ProposedAppV1,
} from "../../../src/import/inference/infer.js";
import {
  applyReviewEdit,
  REVIEW_EDIT_REJECTIONS,
  type ReviewEditV1,
} from "../../../src/import/inference/review-edits.js";
import { REVIEW_EDIT_KINDS } from "../../../src/import/inference/statements.js";
import type { ProposedFieldTypeV1 } from "../../../src/import/inference/values.js";
import { parseFixture } from "../../unit/import/parse-harness.js";

const TYPES: readonly ProposedFieldTypeV1[] = [
  { kind: "text" },
  { kind: "number" },
  { kind: "date" },
  { kind: "boolean" },
  { kind: "enum" },
  { kind: "phone" },
  { kind: "email" },
  { kind: "url" },
  { kind: "address" },
  { kind: "currency", currencyCode: "USD" },
];

const name = fc.oneof(
  fc.constantFrom("Site", "Location", "", "   ", "José", "Crew A"),
  fc.string({ maxLength: 8 }),
);

const anyEdit: fc.Arbitrary<ReviewEditV1> = fc.oneof(
  name.map((appName) => ({ kind: "rename-app" as const, appName })),
  name.map((tableName) => ({ kind: "rename-table" as const, tableName })),
  fc
    .tuple(fc.integer({ min: -3, max: 12 }), name)
    .map(([columnIndex, fieldName]) => ({
      kind: "rename-field" as const,
      columnIndex,
      fieldName,
    })),
  fc
    .tuple(fc.integer({ min: -3, max: 12 }), fc.constantFrom(...TYPES))
    .map(([columnIndex, type]) => ({
      kind: "override-type" as const,
      columnIndex,
      type,
    })),
  fc
    .option(fc.integer({ min: -3, max: 60 }), { nil: null })
    .map((rowIndex) => ({ kind: "set-header-row" as const, rowIndex })),
  fc
    .tuple(
      fc.integer({ min: -3, max: 12 }),
      fc.array(name, { maxLength: ENUM_OPTION_LIMIT + 2 }),
    )
    .map(([columnIndex, options]) => ({
      kind: "edit-enum-options" as const,
      columnIndex,
      options,
    })),
);

let base: ProposedAppV1;

beforeAll(async () => {
  const { items } = await parseFixture(
    "delimited/field-log-messy.csv",
    "field-log-messy.csv",
  );
  base = inferProposal(items, { fileName: "field-log-messy.csv" });
});

describe("applyReviewEdit properties", () => {
  it("is total: every edit is either applied or refused, and never throws", () => {
    fc.assert(
      fc.property(anyEdit, (edit) => {
        const result = applyReviewEdit(base, edit);

        if (result.kind === "rejected") {
          expect(REVIEW_EDIT_REJECTIONS).toContain(result.reason);
          return;
        }
        // An applied edit always leaves a proposal a review screen can render.
        expect(result.proposal.rowCount).toBeGreaterThanOrEqual(0);
        expect(result.proposal.table.fields).toHaveLength(
          base.table.fields.length,
        );
        expect(result.proposal.statements).toHaveLength(
          base.statements.length,
        );
      }),
      { numRuns: 600 },
    );
  });

  it("is idempotent: applying the same edit twice says the same thing", () => {
    fc.assert(
      fc.property(anyEdit, (edit) => {
        const once = applyReviewEdit(base, edit);
        if (once.kind !== "applied") {
          return;
        }
        expect(applyReviewEdit(once.proposal, edit)).toEqual(once);
      }),
      { numRuns: 600 },
    );
  });

  it("never mutates the proposal it was given", () => {
    const before = structuredClone(base);

    fc.assert(
      fc.property(anyEdit, (edit) => {
        applyReviewEdit(base, edit);
      }),
      { numRuns: 400 },
    );

    expect(base).toEqual(before);
  });

  it("marks exactly the touched statement edited and leaves the rest alone", () => {
    fc.assert(
      fc.property(anyEdit, (edit) => {
        const result = applyReviewEdit(base, edit);
        if (result.kind !== "applied") {
          return;
        }
        const changed = result.proposal.statements.filter(
          (statement, index) =>
            statement.disposition !== base.statements[index]?.disposition,
        );
        expect(changed.length).toBeLessThanOrEqual(1);
        for (const statement of changed) {
          expect(statement.disposition).toBe("edited");
          expect(statement.editKind).toBe(edit.kind);
        }
      }),
      { numRuns: 600 },
    );
  });

  it("covers every edit kind the statements advertise", () => {
    const advertised = new Set(
      base.statements
        .map((statement) => statement.editKind)
        .filter((kind) => kind !== null),
    );

    expect([...advertised].sort()).toEqual([...REVIEW_EDIT_KINDS].sort());
  });
});
