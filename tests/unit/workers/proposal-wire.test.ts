/**
 * The wire proposal and S03's proposal are the same shape (CA-12/CA-16).
 *
 * `messages.ts` imports nothing at all — that is the property that lets the
 * whole wire contract be read without following a reference, and
 * `module-boundaries.test.ts` pins it. The price is a second declaration of
 * S03's proposal, and the price of *that* is drift.
 *
 * So the two are asserted assignable **in both directions**, at compile time,
 * the way `tests/unit/domain/provenance.test.ts` pins M01 against migration
 * 004. A field added, removed, renamed, or retyped on either side stops this
 * file compiling — which is a failure in the right place, long before a
 * review screen reads a field the worker never sent.
 *
 * The runtime case underneath proves the same thing on real values: a
 * proposal inferred from a real fixture passes through the wire type and comes
 * back deep-equal.
 */

import { describe, expect, it } from "vitest";
import { f02ProposalOf, testFormulaIdentities } from "../import/delimited-proposal.js";
import type {
  ApplyReviewEditResponseV1,
  ProposedAppWireV1,
  ProposedRecordRuleWireV1,
  ProposedWorkbookWireV1,
  ReviewEditWireV1,
  RuleValueWireV1,
  WorkbookReviewEditWireV1,
} from "../../../src/workers/protocol/messages.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import type {
  ProposedRecordRuleV1,
  ProposedWorkbookV1,
} from "../../../src/import/inference/workbook-proposal.js";
import type {
  WorkbookReviewEditRejectionV1,
  WorkbookReviewEditV1,
} from "../../../src/import/inference/review-edits.js";
import { inferWorkbook } from "../../../src/import/inference/workbook.js";
import { proposalWire, rejectedPromotionResponse } from "../../../src/workers/data/import-handlers.js";
import { rejectedPromotion } from "../../../src/import/staging/promotion.js";
import { encodeDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import { streamWorkbookFixture } from "../staging/workbook-streams.js";
import type { ProposedAppV1 } from "../../../src/import/inference/infer.js";
import type {
  ReviewEditRejectionV1,
  ReviewEditV1,
} from "../../../src/import/inference/review-edits.js";
import { applyReviewEdit } from "../../../src/import/inference/review-edits.js";
import { parseDelimited } from "../../../src/import/formats/delimited/parse.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { isDelimitedSniff } from "../../../src/import/preflight/preflight.js";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { fixtureSource } from "../import/fixtures.js";

/**
 * Compile-time only: `true` when each type is assignable to the other, and
 * `never` otherwise — and a `never` cannot be used where the pin is consumed
 * below, so a divergence stops this file compiling.
 */
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

type ProposalPin = MutuallyAssignable<ProposedAppV1, ProposedAppWireV1>;
type EditPin = MutuallyAssignable<ReviewEditV1, ReviewEditWireV1>;

/** A rejection reason is a closed set on S03's side; the wire relays it. */
type RejectionPin = ReviewEditRejectionV1 extends
  Extract<ApplyReviewEditResponseV1, { outcome: "rejected" }>["reason"]
  ? true
  : never;

// CA-19: S02's workbook proposal and its wire, everything but the rule values
// the byte-free wire restates, in both directions.
type WorkbookPin = MutuallyAssignable<
  Omit<ProposedWorkbookV1, "recordRules">,
  Omit<ProposedWorkbookWireV1, "recordRules">
>;
type RulePin = MutuallyAssignable<Omit<ProposedRecordRuleV1, "condition">, Omit<ProposedRecordRuleWireV1, "condition">>;
/** A rule's value on the wire is exactly a cell value without an identity. */
type RuleValuePin = MutuallyAssignable<Exclude<CellValueV1, { kind: "enum" | "reference" }>, RuleValueWireV1>;
type WorkbookEditPin = MutuallyAssignable<WorkbookReviewEditV1, WorkbookReviewEditWireV1>;
type WorkbookRejectionPin = WorkbookReviewEditRejectionV1 extends
  Extract<ApplyReviewEditResponseV1, { outcome: "rejected" }>["reason"]
  ? true
  : never;

describe("the wire proposal", () => {
  it("is the same type as S03's, in both directions", () => {
    // The assertions are the four type aliases above; this case exists so the
    // file has a runtime presence and so the pins cannot be deleted silently.
    const pins: [ProposalPin, EditPin, RejectionPin] = [true, true, true];
    expect(pins).toEqual([true, true, true]);
  });

  it("is S02's workbook proposal and edit, in both directions (CA-19)", () => {
    const pins: [WorkbookPin, RulePin, RuleValuePin, WorkbookEditPin, WorkbookRejectionPin] = [
      true,
      true,
      true,
      true,
      true,
    ];
    expect(pins).toEqual([true, true, true, true, true]);
  });

  it("carries the demo workbook's real proposal unchanged", async () => {
    const stream = await streamWorkbookFixture("ooxml/fieldwork-q3.xlsx");
    if (stream === null) throw new Error("the demo workbook did not size");
    const proposal = inferWorkbook(stream.items, {
      fileName: "fieldwork-q3.xlsx",
      sheetSelection: null,
      rejectionMemory: new Set(),
      fingerprintOf: (input) => input,
      formulaIdentities: testFormulaIdentities(),
      existingApp: null,
    });
    // Through the wire and back through structured clone: no field lost.
    expect(structuredClone(proposalWire(proposal))).toEqual(proposal);
  });

  it("carries a real inferred proposal without losing a field", async () => {
    const source = await fixtureSource("delimited/field-log-messy.csv");
    const sniff = await sniffContent(source, "field-log-messy.csv");
    if (!isDelimitedSniff(sniff)) {
      throw new Error("fixture is not delimited");
    }

    const items: WorkbookFactStreamItemV2[] = [];
    for await (const item of parseDelimited(source, sniff.format)) {
      items.push(item);
    }
    const proposal = f02ProposalOf(items, "field-log-messy.csv");

    // Through the wire type and back: no widening, no dropped field.
    const onTheWire: ProposedAppWireV1 = proposal;
    const returned: ProposedAppV1 = onTheWire;
    expect(returned).toEqual(proposal);

    // S03's pinned demo expectations, so a change to either side shows up here
    // as well as in S03's own suite.
    expect(proposal.appName).toBe("Field Log Messy");
    expect(proposal.headerRowIndex).toBe(3);
    expect(proposal.rowCount).toBe(40);
    expect(proposal.isRowCountExact).toBe(true);
    expect(proposal.table.fields).toHaveLength(9);
    expect(proposal.statements).toHaveLength(24);
  });

  it("relays an S03 rejection reason unchanged", () => {
    const rejected = applyReviewEdit(
      {
        fileName: "x.csv",
        appName: "X",
        table: { tableName: "X", fields: [] },
        headerRowIndex: null,
        leadingRows: [],
        discardedRows: [],
        discardedRowCount: 0,
        rowCount: 0,
        isRowCountExact: true,
        statements: [],
        diagnostics: [],
      },
      { kind: "rename-field", columnIndex: 3, fieldName: "Anything" },
    );

    if (rejected.kind !== "rejected") {
      throw new Error("expected a rejection");
    }
    // The stage relays; it never coerces a rejection into an applied edit.
    const relayed: ApplyReviewEditResponseV1 = {
      kind: "applyReviewEdit",
      outcome: "rejected",
      reason: rejected.reason,
    };
    expect(relayed.outcome === "rejected" && relayed.reason).toBe(
      "unknown-column",
    );
  });
});

describe("a refused promotion on the wire", () => {
  it("names each field issue's reviewed column, and a record-level issue none", () => {
    const named = new Uint8Array(16).fill(1) as FieldId;
    const unknown = new Uint8Array(16).fill(2) as FieldId;
    const issue = { ruleId: null, kind: "type", severity: "blocking", messageKey: "validation.type", messageParameters: {} } as const;
    const response = rejectedPromotionResponse({
      ...rejectedPromotion("record-invalid", {
        isValid: false,
        issues: [
          { ...issue, fieldId: named },
          { ...issue, fieldId: unknown },
          { ...issue, fieldId: null },
        ],
      }),
      columnKeys: new Map([[encodeDomainId(named), "s0.t0.c2"]]),
    });

    expect(response).toEqual({
      kind: "promoteImport",
      outcome: "rejected",
      reason: "record-invalid",
      issues: [
        { fieldId: encodeDomainId(named), columnKey: "s0.t0.c2", kind: "type", severity: "blocking", messageKey: "validation.type" },
        { fieldId: encodeDomainId(unknown), columnKey: null, kind: "type", severity: "blocking", messageKey: "validation.type" },
        { fieldId: null, columnKey: null, kind: "type", severity: "blocking", messageKey: "validation.type" },
      ],
    });
    // No report, no issues: an append too large for one segment names nothing.
    expect(rejectedPromotionResponse(rejectedPromotion("append-too-large"))).toEqual({
      kind: "promoteImport",
      outcome: "rejected",
      reason: "append-too-large",
      issues: [],
    });
  });
});
