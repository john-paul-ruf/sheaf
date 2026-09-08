/**
 * Record pages and history pages: truthful, bounded, and scoped (M35; CA-14).
 *
 * The claims worth testing here are the ones a surface cannot check for
 * itself — that a page states what it looked at, that a count is the table's
 * `count(*)` and says it is exact, and that a cursor is only offered when
 * there is genuinely another page behind it.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECORD_PAGE_SIZE,
  MAX_RECORD_PAGE_SIZE,
  planRecordPage,
  recordQuery,
} from "../../../src/application/queries/records.js";
import {
  isRestorable,
  planHistoryPage,
} from "../../../src/application/queries/history.js";
import {
  createDomainId,
  encodeDomainId,
  type FieldId,
} from "../../../src/domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../../src/domain/model/events.js";
import type { FieldDefV1, TableDefV1 } from "../../../src/domain/model/schema.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import {
  FakeClock,
  FakeEventRepository,
  FakeProjection,
  entropy,
  fakeRecordDigest,
} from "../commands/fakes.js";
import { executeCommand } from "../../../src/application/commands/execute-command.js";

const TABLE_ID = createDomainId("table", entropy);
const SITE = createDomainId("field", entropy);

const SITE_FIELD: FieldDefV1 = {
  fieldId: SITE,
  tableId: TABLE_ID,
  displayName: "Site",
  fieldOrdinal: 0,
  type: { kind: "text" },
  isRequired: false,
  isActive: true,
  schemaRevision: 1n,
};

const TABLE: TableDefV1 = {
  tableId: TABLE_ID,
  displayName: "Site visits",
  tableOrdinal: 0,
  fields: [SITE_FIELD],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const row = (site: string): AuthoredRecordV1 => ({
  recordId: createDomainId("record", entropy),
  tableId: TABLE_ID,
  values: new Map<FieldId, CellValueV1>([[SITE, { kind: "text", text: site }]]),
  provenance: new Map(),
});

const projectionOf = (sites: readonly string[]): FakeProjection =>
  new FakeProjection({ table: TABLE, records: sites.map(row), trace: [] });

describe("recordQuery", () => {
  it("browses when the search text holds no words", () => {
    expect(recordQuery({ tableId: TABLE_ID, search: "   " }).search).toBeNull();
    expect(recordQuery({ tableId: TABLE_ID }).search).toBeNull();
    expect(recordQuery({ tableId: TABLE_ID }).limit).toBe(
      DEFAULT_RECORD_PAGE_SIZE,
    );
  });

  it("refuses a page size outside the bounded range rather than clamping it", () => {
    expect(() => recordQuery({ tableId: TABLE_ID, limit: 0 })).toThrow(RangeError);
    expect(() =>
      recordQuery({ tableId: TABLE_ID, limit: MAX_RECORD_PAGE_SIZE + 1 }),
    ).toThrow(RangeError);
    expect(() => recordQuery({ tableId: TABLE_ID, cursor: 0 })).toThrow(RangeError);
  });
});

describe("planRecordPage", () => {
  it("states the scope it browsed and an exact total", () => {
    const projection = projectionOf(["North", "South", "East"]);
    const page = planRecordPage(
      projection,
      recordQuery({ tableId: TABLE_ID, limit: 2 }),
    );

    expect(page.scope).toEqual({ kind: "table" });
    expect(page.records).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    expect(page.totalCount).toBe(3);
    expect(page.isTotalExact).toBe(true);
  });

  it("offers no cursor at the end of the table", () => {
    const projection = projectionOf(["North", "South"]);
    const page = planRecordPage(
      projection,
      recordQuery({ tableId: TABLE_ID, limit: 10 }),
    );
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("continues from a cursor without repeating or skipping a record", () => {
    const projection = projectionOf(["North", "South", "East", "West"]);
    const first = planRecordPage(
      projection,
      recordQuery({ tableId: TABLE_ID, limit: 2 }),
    );
    const second = planRecordPage(
      projection,
      recordQuery({ tableId: TABLE_ID, limit: 2, cursor: first.nextCursor }),
    );

    const seen = [...first.records, ...second.records].map((record) =>
      encodeDomainId(record.recordId),
    );
    expect(new Set(seen).size).toBe(4);
    expect(second.hasMore).toBe(false);
  });

  it("names the search it ran, and reports the table's total beside it", () => {
    const projection = projectionOf(["North yard", "South yard", "East gate"]);
    const page = planRecordPage(
      projection,
      recordQuery({ tableId: TABLE_ID, search: "yard" }),
    );

    expect(page.scope).toEqual({ kind: "search", text: "yard" });
    expect(page.records).toHaveLength(2);
    // The total belongs to the table, and the scope says so: a count of
    // matches is not something the closed query surface can answer exactly.
    expect(page.totalCount).toBe(3);
  });

  it("says truthfully that a search found nothing, in a table that has rows", () => {
    const projection = projectionOf(["North yard", "South yard"]);
    const page = planRecordPage(
      projection,
      recordQuery({ tableId: TABLE_ID, search: "quarry" }),
    );

    expect(page.records).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.scope).toEqual({ kind: "search", text: "quarry" });
    expect(page.totalCount).toBe(2);
  });
});

describe("planHistoryPage", () => {
  it("pages newest first and marks a delete as restorable", async () => {
    const projection = projectionOf(["North yard"]);
    const repository = new FakeEventRepository(
      createDomainId("app", entropy),
      projection,
    );
    const deps = {
      clock: new FakeClock(),
      entropy,
      projection,
      repository,
      recordDigest: fakeRecordDigest,
    };
    const recordId = projection.execute({
      kind: "page-records",
      tableId: TABLE_ID,
      afterRecordPk: null,
      limit: 1,
    }).records[0]?.recordId;
    if (recordId === undefined) {
      throw new Error("expected a seeded record");
    }

    await executeCommand(deps, {
      kind: "patch-record",
      recordId,
      changes: new Map<FieldId, CellValueV1>([
        [SITE, { kind: "text", text: "North yard (rear)" }],
      ]),
    });
    await executeCommand(deps, { kind: "delete-record", recordId });

    const page = planHistoryPage(projection, { limit: 10 });
    expect(page.entries.map((entry) => entry.eventKind)).toEqual([
      "record.deleted",
      "record.patched",
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.entries.filter(isRestorable)).toHaveLength(1);
  });

  it("refuses a page size outside the bounded range", () => {
    const projection = projectionOf([]);
    expect(() => planHistoryPage(projection, { limit: 0 })).toThrow(RangeError);
    expect(() => planHistoryPage(projection, { limit: 100_000 })).toThrow(
      RangeError,
    );
  });
});
