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
import type {
  ApplyReviewEditResponseV1,
  ProposedAppWireV1,
  ReviewEditWireV1,
} from "../../../src/workers/protocol/messages.js";
import type { ProposedAppV1 } from "../../../src/import/inference/infer.js";
import type {
  ReviewEditRejectionV1,
  ReviewEditV1,
} from "../../../src/import/inference/review-edits.js";
import { inferProposal } from "../../../src/import/inference/infer.js";
import { applyReviewEdit } from "../../../src/import/inference/review-edits.js";
import { parseDelimited } from "../../../src/import/formats/delimited/parse.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { isDelimitedSniff } from "../../../src/import/preflight/preflight.js";
import type { WorkbookFactStreamItemV1 } from "../../../src/import/formats/delimited/facts.js";
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

describe("the wire proposal", () => {
  it("is the same type as S03's, in both directions", () => {
    // The assertions are the four type aliases above; this case exists so the
    // file has a runtime presence and so the pins cannot be deleted silently.
    const pins: [ProposalPin, EditPin, RejectionPin] = [true, true, true];
    expect(pins).toEqual([true, true, true]);
  });

  it("carries a real inferred proposal without losing a field", async () => {
    const source = await fixtureSource("delimited/field-log-messy.csv");
    const sniff = await sniffContent(source, "field-log-messy.csv");
    if (!isDelimitedSniff(sniff)) {
      throw new Error("fixture is not delimited");
    }

    const items: WorkbookFactStreamItemV1[] = [];
    for await (const item of parseDelimited(source, sniff.format)) {
      items.push(item);
    }
    const proposal = inferProposal(items, { fileName: "field-log-messy.csv" });

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
