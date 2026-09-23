/**
 * CA-29 at the handler (S04 CP2): `queryRecords` with filters and a sort,
 * through the real dispatch, real crypto, the real store (IndexedDB shim, D8)
 * and the real SQLite projection, on the F03 demo app imported the way the
 * import worker imports it.
 *
 * Every expected answer is derived from one unfiltered read of the same
 * table, so the suite states the rule rather than a fixture's numbers: a
 * filtered page is exactly the unfiltered rows the filter admits, its
 * `total` is their count, and a sorted walk visits every row once.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AppStructureViewV1,
  CellWireValueV1,
  FilterWireV1,
  QueryRecordsRequestV1,
  RecordPageViewV1,
  RecordSummaryViewV1,
  SortCursorWireV1,
  StructureFieldViewV1,
  StructureTableViewV1,
} from "../../../src/workers/protocol/messages.js";
import type { DataWorkerCommandHandler } from "../../../src/workers/data/handlers.js";
import { redactError } from "../../../src/workers/protocol/redact.js";
import {
  ask,
  CRYPTO_TIMEOUT_MS,
  createTestHandler,
  importDemoApp,
  resetLocalDatabase,
} from "./data-worker.js";

const PASSPHRASE = "correct horse battery staple";
const SLOW = CRYPTO_TIMEOUT_MS * 4;
const HOSTILE = "x' OR 1=1; DROP TABLE records; --";

let handler: DataWorkerCommandHandler;
let appId: string;
let jobs: StructureTableViewV1;
let otherTableField: StructureFieldViewV1;
let everyJob: readonly RecordSummaryViewV1[];

beforeAll(async () => {
  await resetLocalDatabase();
  handler = createTestHandler().handler;
  await handler.handle({ kind: "setup", passphrase: PASSPHRASE });
  await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });
  appId = await importDemoApp(handler);
  const structure: AppStructureViewV1 | null = (await ask(handler, { kind: "getAppStructure", appId })).structure;
  if (structure === null) throw new Error("no structure");
  const table = structure.tables.find((candidate) => candidate.displayName === "Jobs");
  if (table === undefined) throw new Error("no Jobs table");
  jobs = table;
  const other = structure.tables.find((candidate) => candidate.tableId !== table.tableId)?.fields[0];
  if (other === undefined) throw new Error("no second table");
  otherTableField = other;
  everyJob = (await page({})).records;
}, SLOW);

afterAll(() => {
  handler.dispose();
});

async function page(query: Omit<QueryRecordsRequestV1, "kind" | "appId" | "tableId">): Promise<RecordPageViewV1> {
  const answered = await ask(handler, { kind: "queryRecords", appId, tableId: jobs.tableId, limit: 1000, ...query });
  if (answered.page === null) throw new Error(`no page: ${JSON.stringify(answered.refusal)}`);
  return answered.page;
}

const fieldOfKind = (kind: StructureFieldViewV1["type"]["kind"]): StructureFieldViewV1 => {
  const field = jobs.fields.find((candidate) => candidate.isActive && candidate.type.kind === kind);
  if (field === undefined) throw new Error(`Jobs has no ${kind} field`);
  return field;
};

const valueOf = (record: RecordSummaryViewV1, fieldId: string): CellWireValueV1 | undefined =>
  record.values.find((entry) => entry.fieldId === fieldId)?.value;

const ids = (records: readonly RecordSummaryViewV1[]): string[] => records.map((record) => record.recordId);

describe("F03 callers keep their behaviour", () => {
  it("browses with an exact total and no partial, and answers a plain search uncounted", async () => {
    const browse = await page({});
    expect(browse.total).toBe(browse.totalCount);
    expect(browse.partial).toBeNull();
    expect(browse.records).toHaveLength(browse.totalCount);

    const searched = await page({ search: "patio" });
    expect(searched.scope).toEqual({ kind: "search", text: "patio" });
    expect(searched.total).toBeNull();
  }, SLOW);
});

describe("filters on the wire (CA-29)", () => {
  it("an enum filter answers exactly the rows holding the option, with their exact count", async () => {
    const status = fieldOfKind("enum");
    const option = valueOf(everyJob.find((record) => valueOf(record, status.fieldId)?.kind === "option")!, status.fieldId);
    if (option?.kind !== "option") throw new Error("no option value");
    const expected = everyJob.filter((record) => {
      const value = valueOf(record, status.fieldId);
      return value?.kind === "option" && value.optionId === option.optionId;
    });

    const filtered = await page({ filters: [{ fieldId: status.fieldId, operand: { kind: "enum-in", optionIds: [option.optionId] } }] });
    expect(ids(filtered.records)).toEqual(ids(expected));
    expect(filtered.total).toBe(expected.length);
    expect(filtered.totalCount).toBe(everyJob.length);
    expect(filtered.partial).toBeNull();
  }, SLOW);

  it("a text filter is case-insensitive over the field's own text", async () => {
    const text = fieldOfKind("text");
    const sample = everyJob.map((record) => valueOf(record, text.fieldId)).find((value) => value?.kind === "text" && value.text.length >= 3);
    if (sample?.kind !== "text") throw new Error("no text value");
    const needle = sample.text.slice(0, 3);
    const expected = everyJob.filter((record) => {
      const value = valueOf(record, text.fieldId);
      return value?.kind === "text" && value.text.toUpperCase().includes(needle.toUpperCase());
    });

    for (const variant of [needle.toUpperCase(), needle.toLowerCase()]) {
      const filtered = await page({ filters: [{ fieldId: text.fieldId, operand: { kind: "text-contains", text: variant } }] });
      expect(ids(filtered.records)).toEqual(ids(expected));
      expect(filtered.total).toBe(expected.length);
    }
  }, SLOW);

  it("ANDs filters with the search and with each other", async () => {
    const status = fieldOfKind("enum");
    const withSearch = await page({
      search: "patio",
      filters: [{ fieldId: status.fieldId, operand: { kind: "not-empty" } }],
    });
    const searchOnly = await page({ search: "patio" });
    expect(ids(withSearch.records).every((id) => ids(searchOnly.records).includes(id))).toBe(true);
    expect(withSearch.total).toBe(withSearch.records.length);
  }, SLOW);
});

describe("a sort walks every row once, page by page", () => {
  it("sorts a number column descending, missing last, ties by row key, across sort cursors", async () => {
    const amount = jobs.fields.find((field) => field.isActive && (field.type.kind === "currency" || field.type.kind === "number"));
    if (amount === undefined) throw new Error("Jobs has no amount field");

    const seen: RecordSummaryViewV1[] = [];
    let cursor: number | null = null;
    let sortCursor: SortCursorWireV1 | null = null;
    for (let pages = 0; pages < 100; pages += 1) {
      const next: RecordPageViewV1 = await page({ sort: { fieldId: amount.fieldId, direction: "desc" }, limit: 7, cursor, sortCursor });
      expect(next.total).toBe(everyJob.length);
      seen.push(...next.records);
      if (!next.hasMore) break;
      cursor = next.nextCursor;
      sortCursor = next.nextSortCursor ?? null;
      expect(sortCursor).not.toBeNull();
    }

    expect(new Set(ids(seen)).size).toBe(everyJob.length);
    const amounts = seen.map((record) => {
      const value = valueOf(record, amount.fieldId);
      return value?.kind === "number" ? Number(value.decimal) : null;
    });
    const present = amounts.filter((value): value is number => value !== null);
    expect(present).toEqual([...present].sort((left, right) => right - left));
    // Every row without a number comes after every row with one.
    const firstMissing = amounts.indexOf(null);
    if (firstMissing >= 0) expect(amounts.slice(firstMissing).every((value) => value === null)).toBe(true);
  }, SLOW);
});

describe("refusals are results that name the field, never the value", () => {
  it("refuses an inverted range, a filter that does not fit its field, and an unknown sort field", async () => {
    const due = fieldOfKind("date");
    const text = fieldOfKind("text");
    const cases: readonly [FilterWireV1 | null, string][] = [
      [{ fieldId: due.fieldId, operand: { kind: "date-range", from: 20_010, to: 20_000 } }, "inverted-range"],
      [{ fieldId: text.fieldId, operand: { kind: "boolean-is", value: true } }, "operator-type-mismatch"],
      [{ fieldId: text.fieldId, operand: { kind: "text-equals", text: "" } }, "empty-filter"],
    ];
    for (const [filter, reason] of cases) {
      const answered = await ask(handler, { kind: "queryRecords", appId, tableId: jobs.tableId, filters: filter === null ? [] : [filter] });
      expect(answered.page).toBeNull();
      expect(answered.refusal).toEqual({ reason, fieldId: filter?.fieldId });
    }

    // A field of another table is not a column of this one.
    const foreign = otherTableField.fieldId;
    const unknownSort = await ask(handler, { kind: "queryRecords", appId, tableId: jobs.tableId, sort: { fieldId: foreign, direction: "asc" } });
    expect(unknownSort.page).toBeNull();
    expect(unknownSort.refusal).toEqual({ reason: "unknown-field", fieldId: foreign });
  }, SLOW);

  it("keeps a refused filter's value out of the answer", async () => {
    const status = fieldOfKind("enum");
    const answered = await ask(handler, {
      kind: "queryRecords",
      appId,
      tableId: jobs.tableId,
      filters: [{ fieldId: status.fieldId, operand: { kind: "text-contains", text: HOSTILE } }],
    });
    expect(answered.refusal).toEqual({ reason: "operator-type-mismatch", fieldId: status.fieldId });
    expect(JSON.stringify(answered)).not.toContain("DROP");
  }, SLOW);

  it("redacts a malformed filter to its kind: no id, no text in the error", async () => {
    const status = fieldOfKind("enum");
    const failure = await handler
      .handle({
        kind: "queryRecords",
        appId,
        tableId: jobs.tableId,
        filters: [
          { fieldId: status.fieldId, operand: { kind: "enum-in", optionIds: [HOSTILE] } },
        ],
      })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(failure).not.toBeNull();
    const wire = redactError(failure);
    expect(wire).toEqual({ kind: "malformed-request" });
    expect(JSON.stringify(wire)).not.toContain("DROP");
  }, SLOW);
});
