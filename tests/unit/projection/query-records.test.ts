/**
 * CA-29's producer proof on the real engine: SQLite WASM on node, migration
 * 005, recalculated computed lanes. Every filter type, every sort key, ties,
 * the missing tail in both directions, a computed-field filter and sort, the
 * keyset walk, and the D53 partial page with an injected budget.
 *
 * The fixture's table is in `query-fixture.ts`; results read as `j1`…`j8`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  disposeProjection,
  executeQuery,
  type ProjectionFilterTermV1,
  type ProjectionHandleV1,
  type ProjectionQueryCursorV1,
  type ProjectionRecordQueryResultV1,
  type ProjectionRecordSortV1,
} from "../../../src/persistence/projection/index.js";
import { CUSTOMER, F, JOBS, OPTION, jobName, openQueryProjection } from "./query-fixture.js";

let handle: ProjectionHandleV1;

beforeAll(async () => {
  handle = await openQueryProjection();
});

afterAll(() => {
  disposeProjection(handle);
});

interface Ask {
  readonly filters?: readonly ProjectionFilterTermV1[];
  readonly sort?: ProjectionRecordSortV1 | null;
  readonly search?: string | null;
  readonly after?: ProjectionQueryCursorV1 | null;
  readonly limit?: number;
  readonly budget?: number;
}

const ask = (options: Ask = {}): ProjectionRecordQueryResultV1 =>
  executeQuery(handle, {
    kind: "query-records",
    tableId: JOBS,
    search: options.search ?? null,
    filters: options.filters ?? [],
    sort: options.sort ?? null,
    after: options.after ?? null,
    limit: options.limit ?? 50,
    candidateBudget: options.budget ?? 50_000,
  });

const names = (result: ProjectionRecordQueryResultV1): string[] =>
  result.records.map((record) => jobName(record.recordId));

const matching = (...filters: ProjectionFilterTermV1[]): string[] => names(ask({ filters }));

/** Every page of a query, walked through its cursors. */
function walk(options: Ask, limit: number): string[] {
  const seen: string[] = [];
  let after: ProjectionQueryCursorV1 | null = null;
  for (let pages = 0; pages < 20; pages += 1) {
    const page = ask({ ...options, after, limit });
    seen.push(...names(page));
    if (!page.hasMore) return seen;
    after = page.next;
  }
  throw new Error("a walk did not end");
}

const sortBy = (fieldId: typeof F.name.fieldId, key: ProjectionRecordSortV1["key"], direction: "asc" | "desc" = "asc"): ProjectionRecordSortV1 => ({
  fieldId,
  key,
  direction,
});

describe("filters over the typed lanes", () => {
  it("enum: any of a set of options (SHT-004)", () => {
    expect(matching({ kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.scheduled] })).toEqual(["j1", "j3", "j5", "j6"]);
    expect(matching({ kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.waiting, OPTION.done] })).toEqual(["j2", "j4", "j7", "j8"]);
  });

  it("date: an inclusive epoch-day range, either end open (SHT-005)", () => {
    expect(matching({ kind: "integer-range", fieldId: F.due.fieldId, min: 20_000, max: 20_001 })).toEqual(["j1", "j2", "j3"]);
    expect(matching({ kind: "integer-range", fieldId: F.due.fieldId, min: 20_001, max: null })).toEqual(["j3", "j4"]);
    expect(matching({ kind: "integer-range", fieldId: F.due.fieldId, min: null, max: 19_999 })).toEqual(["j8"]);
  });

  it("number and currency: decimal bounds through the order key, never a float (SHT-006)", () => {
    // 1850.00 and 1850 are one number: the order key normalizes the spelling.
    expect(matching({ kind: "decimal-range", fieldId: F.quoted.fieldId, min: "1850", max: "1850" })).toEqual(["j1", "j8"]);
    expect(matching({ kind: "decimal-range", fieldId: F.quoted.fieldId, min: "2000", max: null })).toEqual(["j2", "j5", "j6", "j7"]);
    expect(matching({ kind: "decimal-range", fieldId: F.quoted.fieldId, min: null, max: "800" })).toEqual(["j3"]);
    expect(matching({ kind: "decimal-range", fieldId: F.paid.fieldId, min: "-1", max: "0" })).toEqual(["j2", "j5", "j7", "j8"]);
  });

  it("boolean: yes or no, and a missing value is neither (SHT-007)", () => {
    expect(matching({ kind: "integer-range", fieldId: F.urgent.fieldId, min: 1, max: 1 })).toEqual(["j1", "j3", "j7", "j8"]);
    expect(matching({ kind: "integer-range", fieldId: F.urgent.fieldId, min: 0, max: 0 })).toEqual(["j2", "j4", "j6"]);
  });

  it("reference: any of a set of records, and broken (SHT-008)", () => {
    expect(matching({ kind: "id-in", fieldId: F.customer.fieldId, ids: [CUSTOMER.c1] })).toEqual(["j1", "j3"]);
    expect(matching({ kind: "id-in", fieldId: F.customer.fieldId, ids: [CUSTOMER.c2, CUSTOMER.c3] })).toEqual(["j2", "j6", "j7", "j8"]);
    // An imported key that matched nothing, and a record that is not there.
    expect(matching({ kind: "reference-broken", fieldId: F.customer.fieldId })).toEqual(["j4", "j5"]);
  });

  it("text: equality and containment, case-insensitive over NFC", () => {
    expect(matching({ kind: "text-equals", fieldId: F.name.fieldId, text: "Patio lighting" })).toEqual(["j1"]);
    expect(matching({ kind: "text-equals", fieldId: F.name.fieldId, text: "PATIO LIGHTING" })).toEqual(["j1"]);
    expect(matching({ kind: "text-equals", fieldId: F.name.fieldId, text: "Patio light" })).toEqual([]);
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "atio" })).toEqual(["j1", "j2", "j8"]);
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "atio l" })).toEqual(["j1", "j8"]);
    // Capitals do not matter: “patio” and “PATIO” both find both patio jobs.
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "patio" })).toEqual(["j1", "j8"]);
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "PATIO" })).toEqual(["j1", "j8"]);
  });

  it("text: non-ASCII letters fold too, composed or not", () => {
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "été" })).toEqual(["j7"]);
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "ÉTÉ" })).toEqual(["j7"]);
    // A decomposed “é” is the same letter as the stored composed “é”.
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "e\u0301te\u0301" })).toEqual(["j7"]);
    expect(matching({ kind: "text-equals", fieldId: F.name.fieldId, text: "rain garden été" })).toEqual(["j7"]);
    // A different letter is not folded into a match.
    expect(matching({ kind: "text-contains", fieldId: F.name.fieldId, text: "ete" })).toEqual([]);
  });

  it("empty is missing or blank; an invalid preserved value is not empty", () => {
    expect(matching({ kind: "is-empty", fieldId: F.due.fieldId, isComputed: false })).toEqual(["j5", "j6"]);
    expect(matching({ kind: "not-empty", fieldId: F.due.fieldId, isComputed: false })).toEqual(["j1", "j2", "j3", "j4", "j7", "j8"]);
    expect(matching({ kind: "is-empty", fieldId: F.urgent.fieldId, isComputed: false })).toEqual(["j5"]);
  });

  it("a computed column filters through its own lane", () => {
    expect(matching({ kind: "decimal-range", fieldId: F.balance.fieldId, min: "1000", max: null })).toEqual(["j2", "j5", "j6", "j7", "j8"]);
    expect(matching({ kind: "decimal-range", fieldId: F.balance.fieldId, min: "0", max: "0" })).toEqual(["j4"]);
    expect(matching({ kind: "not-empty", fieldId: F.balance.fieldId, isComputed: true })).toHaveLength(8);
    expect(matching({ kind: "is-empty", fieldId: F.balance.fieldId, isComputed: true })).toEqual([]);
  });

  it("ANDs every filter with each other and with the search", () => {
    expect(
      matching(
        { kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.scheduled] },
        { kind: "integer-range", fieldId: F.urgent.fieldId, min: 1, max: 1 },
      ),
    ).toEqual(["j1", "j3"]);
    // FTS is word-prefix and case-folded: “patio” finds both patio jobs.
    expect(names(ask({ search: "patio" }))).toEqual(["j1", "j8"]);
    expect(names(ask({ search: "patio", filters: [{ kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.done] }] }))).toEqual(["j8"]);
  });
});

describe("the count is exact, and is the count of matches", () => {
  it("counts every match, not the page", () => {
    const page = ask({ filters: [{ kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.scheduled] }], limit: 1 });
    expect(names(page)).toEqual(["j1"]);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(4);
    expect(page.partial).toBeNull();
  });

  it("answers a filter that matches nothing with zero, not with the table", () => {
    const page = ask({ filters: [{ kind: "text-equals", fieldId: F.name.fieldId, text: "Nothing like this" }] });
    expect(page.records).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it("matches nothing for wordless search text", () => {
    expect(ask({ search: " * " })).toEqual({ records: [], hasMore: false, next: null, total: 0, partial: null });
  });
});

describe("sort on any column (SHT-009)", () => {
  it("dates: ties break on the row key, missing and invalid sort last", () => {
    expect(names(ask({ sort: sortBy(F.due.fieldId, "integer") }))).toEqual(["j8", "j1", "j2", "j3", "j4", "j5", "j6", "j7"]);
  });

  it("keeps the missing tail last when descending, and ties still ascend by row key", () => {
    expect(names(ask({ sort: sortBy(F.due.fieldId, "integer", "desc") }))).toEqual(["j4", "j3", "j1", "j2", "j8", "j5", "j6", "j7"]);
  });

  it("decimals by value, whatever their spelling", () => {
    expect(names(ask({ sort: sortBy(F.quoted.fieldId, "decimal") }))).toEqual(["j3", "j4", "j1", "j8", "j6", "j5", "j2", "j7"]);
  });

  it("enum by the options' order, not by id", () => {
    expect(names(ask({ sort: sortBy(F.status.fieldId, "option-ordinal") }))).toEqual(["j1", "j3", "j5", "j6", "j2", "j7", "j4", "j8"]);
    expect(names(ask({ sort: sortBy(F.status.fieldId, "option-ordinal", "desc") }))).toEqual(["j4", "j8", "j2", "j7", "j1", "j3", "j5", "j6"]);
  });

  it("text by code point", () => {
    expect(names(ask({ sort: sortBy(F.name.fieldId, "text") }))).toEqual(["j4", "j2", "j5", "j6", "j3", "j1", "j7", "j8"]);
  });

  it("a reference by its parent's label; broken references last", () => {
    // Avery Kim, Devon Moss, Priya Ellis; then the two broken ones.
    expect(names(ask({ sort: sortBy(F.customer.fieldId, "reference-label") }))).toEqual(["j7", "j8", "j2", "j6", "j1", "j3", "j4", "j5"]);
  });

  it("booleans no before yes; a missing value last", () => {
    expect(names(ask({ sort: sortBy(F.urgent.fieldId, "integer") }))).toEqual(["j2", "j4", "j6", "j1", "j3", "j7", "j8", "j5"]);
  });

  it("a computed column by its recalculated value", () => {
    expect(names(ask({ sort: sortBy(F.balance.fieldId, "decimal") }))).toEqual(["j4", "j3", "j1", "j6", "j8", "j5", "j2", "j7"]);
  });
});

describe("keyset paging is stable", () => {
  const cases: readonly [string, Ask][] = [
    ["row-key order with a filter", { filters: [{ kind: "not-empty", fieldId: F.name.fieldId, isComputed: false }] }],
    ["dates ascending (ties across a page boundary)", { sort: sortBy(F.due.fieldId, "integer") }],
    ["dates descending (into the missing tail)", { sort: sortBy(F.due.fieldId, "integer", "desc") }],
    ["decimals, with a filter", { sort: sortBy(F.quoted.fieldId, "decimal", "desc"), filters: [{ kind: "decimal-range", fieldId: F.paid.fieldId, min: "0", max: null }] }],
    ["references by label", { sort: sortBy(F.customer.fieldId, "reference-label") }],
  ];

  for (const [label, options] of cases) {
    it(`walks ${label} page by page without skipping or repeating`, () => {
      const whole = names(ask(options));
      for (const limit of [1, 2, 3, 5]) {
        expect(walk(options, limit), `limit ${String(limit)}`).toEqual(whole);
      }
    });
  }

  it("carries the last row's sort value and row key, and none past the end", () => {
    const first = ask({ sort: sortBy(F.due.fieldId, "integer"), limit: 2 });
    expect(names(first)).toEqual(["j8", "j1"]);
    expect(first.next).toEqual({ recordPk: first.records[1]?.recordPk, sortValue: 20_000 });
    const tail = ask({ sort: sortBy(F.due.fieldId, "integer"), limit: 8 });
    expect(tail.hasMore).toBe(false);
    expect(tail.next).toBeNull();
  });
});

describe("the candidate budget (D53)", () => {
  it("examines only the first candidates in row-key order, and says so", () => {
    const page = ask({ filters: [{ kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.scheduled] }], budget: 5 });
    expect(names(page)).toEqual(["j1", "j3", "j5"]);
    // A partial page never reports a total it did not count.
    expect(page.total).toBeNull();
    expect(page.partial).toEqual({ scanned: 5, tableTotal: 8 });
  });

  it("keeps later pages inside the same scope", () => {
    const options: Ask = { sort: sortBy(F.quoted.fieldId, "decimal"), budget: 5 };
    expect(walk(options, 2)).toEqual(["j3", "j4", "j1", "j5", "j2"]);
    expect(ask({ ...options, limit: 2 }).partial).toEqual({ scanned: 5, tableTotal: 8 });
  });

  it("is exact when the budget admits every candidate", () => {
    const page = ask({ filters: [{ kind: "id-in", fieldId: F.status.fieldId, ids: [OPTION.scheduled] }], budget: 8 });
    expect(page.partial).toBeNull();
    expect(page.total).toBe(4);
  });

  it("counts candidates after the search narrows them", () => {
    const page = ask({ search: "patio", filters: [{ kind: "not-empty", fieldId: F.name.fieldId, isComputed: false }], budget: 2 });
    expect(page.partial).toBeNull();
    expect(page.total).toBe(2);
  });

  it("refuses a budget that is not a positive integer", () => {
    expect(() => ask({ budget: 0 })).toThrow(CodecError);
    expect(() => ask({ budget: 1.5 })).toThrow(CodecError);
  });
});

describe("refusals", () => {
  it("refuses an empty value set", () => {
    expect(() => matching({ kind: "id-in", fieldId: F.status.fieldId, ids: [] })).toThrow(CodecError);
  });

  it("refuses a decimal bound that is not canonical", () => {
    expect(() => matching({ kind: "decimal-range", fieldId: F.quoted.fieldId, min: "1e3", max: null })).toThrow(CodecError);
  });
});
