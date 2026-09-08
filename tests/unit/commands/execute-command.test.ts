/**
 * `executeCommand` — the gate every authored write goes through (M34;
 * CAP-16/CAP-17, invariants 1 and 5).
 *
 * These run against in-memory ports. What they establish is the *decision*
 * order: what is validated before anything is built, what is written before
 * anything is acknowledged, and what a rejection leaves behind. The real
 * engine, the real store, and the real crypto are proven in
 * `tests/browser/worker/usage-journey.spec.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  executeCommand,
  rekeyByFields,
  type CommandResultV1,
} from "../../../src/application/commands/execute-command.js";
import {
  asDomainId,
  createDomainId,
  encodeDomainId,
  type FieldId,
  type RecordId,
} from "../../../src/domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../../src/domain/model/events.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  TableDefV1,
} from "../../../src/domain/model/schema.js";
import {
  BLANK_VALUE,
  MISSING_VALUE,
  cellValuesEqual,
  type CellValueV1,
} from "../../../src/domain/model/values.js";
import {
  FakeClock,
  FakeEventRepository,
  FakeProjection,
  entropy,
  fakeRecordDigest,
} from "./fakes.js";

const APP_ID = createDomainId("app", entropy);
const TABLE_ID = createDomainId("table", entropy);

const NAME = createDomainId("field", entropy);
const AMOUNT = createDomainId("field", entropy);
const STATUS = createDomainId("field", entropy);

const OPEN_OPTION = createDomainId("option", entropy);
const CLOSED_OPTION = createDomainId("option", entropy);

const field = (
  fieldId: FieldId,
  displayName: string,
  type: FieldDefV1["type"],
  isRequired = false,
): FieldDefV1 => ({
  fieldId,
  tableId: TABLE_ID,
  displayName,
  fieldOrdinal: 0,
  type,
  isRequired,
  isActive: true,
  schemaRevision: 1n,
});

const TABLE: TableDefV1 = {
  tableId: TABLE_ID,
  displayName: "Site visits",
  tableOrdinal: 0,
  fields: [
    field(NAME, "Site", { kind: "text" }, true),
    field(AMOUNT, "Amount", { kind: "number" }),
    field(STATUS, "Status", { kind: "enum" }),
  ],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const ENUM_OPTIONS: readonly EnumOptionDefV1[] = [
  {
    optionId: OPEN_OPTION,
    fieldId: STATUS,
    displayLabel: "Open",
    optionOrdinal: 0,
    isActive: true,
    schemaRevision: 1n,
  },
  {
    optionId: CLOSED_OPTION,
    fieldId: STATUS,
    displayLabel: "Closed",
    optionOrdinal: 1,
    isActive: true,
    schemaRevision: 1n,
  },
];

const seededRecord = (recordId: RecordId, site: string): AuthoredRecordV1 => ({
  recordId,
  tableId: TABLE_ID,
  values: new Map<FieldId, CellValueV1>([
    [NAME, { kind: "text", text: site }],
    [AMOUNT, { kind: "decimal", decimal: "12.50" }],
    [STATUS, { kind: "enum", optionId: OPEN_OPTION }],
  ]),
  provenance: new Map([[NAME, { source: "initial-import" as const }]]),
});

function harness(records: readonly AuthoredRecordV1[] = []) {
  const projection = new FakeProjection({
    table: TABLE,
    enumOptions: ENUM_OPTIONS,
    records,
    trace: [],
  });
  const repository = new FakeEventRepository(APP_ID, projection);
  return {
    projection,
    repository,
    deps: {
      clock: new FakeClock(),
      entropy,
      projection,
      repository,
      recordDigest: fakeRecordDigest,
    },
  };
}

/**
 * Reads a value out of an authored map by *identity of the bytes*. The map a
 * command built is keyed by the field instances the schema query handed it,
 * which are deliberately not these module constants — the durable form is the
 * bytes, and this is how a reader that did not build the map finds a value.
 */
const valueOf = <T>(
  values: ReadonlyMap<FieldId, T>,
  fieldId: FieldId,
): T | undefined =>
  [...values].find(
    ([candidate]) => encodeDomainId(candidate) === encodeDomainId(fieldId),
  )?.[1];

const accepted = (result: CommandResultV1) => {
  if (result.outcome !== "accepted") {
    throw new Error(`expected acceptance, got ${result.outcome}`);
  }
  return result;
};

describe("create", () => {
  it("validates before it builds: a blocking issue writes no event at all", async () => {
    const { deps, repository, projection } = harness();

    const result = await executeCommand(deps, {
      kind: "create-record",
      tableId: TABLE_ID,
      // `Site` is required and a decimal is not text: two blocking issues.
      values: new Map<FieldId, CellValueV1>([
        [AMOUNT, { kind: "text", text: "twelve" }],
      ]),
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") {
      return;
    }
    expect(result.report.isValid).toBe(false);
    expect(result.report.issues.map((issue) => issue.messageKey).sort()).toEqual([
      "validation.required",
      "validation.wrong-type",
    ]);
    // Nothing was built, nothing was written, nothing was applied.
    expect(repository.appends).toHaveLength(0);
    expect(projection.applied).toHaveLength(0);
    expect(projection.trace).toEqual([]);
  });

  it("commits durably before it applies, and only then acknowledges", async () => {
    const { deps, repository, projection } = harness();

    const result = accepted(
      await executeCommand(deps, {
        kind: "create-record",
        tableId: TABLE_ID,
        values: new Map<FieldId, CellValueV1>([
          [NAME, { kind: "text", text: "North yard" }],
        ]),
      }),
    );

    expect(projection.trace).toEqual(["append", "apply"]);
    expect(result.recordRevision).toBe(0n);
    expect(projection.liveRecordIds()).toEqual([
      encodeDomainId(result.recordId),
    ]);

    const [request] = repository.appends;
    const planned = request?.plan.events[0];
    expect(request?.plan.eventClass).toBe("authored");
    expect(request?.plan.deviceCommitSequence).toBe(1n);
    expect(request?.plan.previousDeviceCommitSha256).toBeNull();
    // CRUD never moves the schema.
    expect(request?.plan.schemaRevisionBefore).toBe(
      request?.plan.schemaRevisionAfter,
    );
    expect(planned?.event.kind).toBe("record.created");
    expect(planned?.provenance).toEqual({ source: "user" });
    expect(request?.rowCountAfter).toBe(1);
  });

  it("names every active field, so an unset value is `missing` and not absent", async () => {
    const { deps, repository } = harness();

    await executeCommand(deps, {
      kind: "create-record",
      tableId: TABLE_ID,
      values: new Map<FieldId, CellValueV1>([
        [NAME, { kind: "text", text: "North yard" }],
      ]),
    });

    const event = repository.appends[0]?.plan.events[0]?.event;
    if (event?.kind !== "record.created") {
      throw new Error("expected a record.created event");
    }
    expect([...event.payload.record.values.keys()]).toHaveLength(3);
    expect(
      cellValuesEqual(
        valueOf(event.payload.record.values, AMOUNT) as CellValueV1,
        MISSING_VALUE,
      ),
    ).toBe(true);
    // An authored write can never claim this; the validator passed first.
    expect(event.payload.importedInvalid).toBe(false);
  });

  it("carries the validator's warnings to the projection as issues", async () => {
    const { deps, repository } = harness();

    await executeCommand(deps, {
      kind: "create-record",
      tableId: TABLE_ID,
      values: new Map<FieldId, CellValueV1>([
        [NAME, { kind: "text", text: "North yard" }],
        // Preserved rather than coerced: a warning, never a refusal (FR-4).
        [AMOUNT, { kind: "invalid-preserved", sourceText: "about twelve" }],
      ]),
    });

    const issues = repository.appends[0]?.issuesByEventIndex?.get(0);
    expect(issues?.map((issue) => issue.messageKey)).toEqual([
      "validation.preserved-invalid",
    ]);
    expect(issues?.[0]?.severity).toBe("warning");
    expect(issues?.[0]?.messageParameters["fieldLabel"]).toBe("Amount");
  });

  it("refuses an unknown table as a result, not an error", async () => {
    const { deps } = harness();
    const result = await executeCommand(deps, {
      kind: "create-record",
      tableId: createDomainId("table", entropy),
      values: new Map(),
    });
    expect(result).toEqual({ outcome: "unknown-subject", subject: "table" });
  });
});

describe("patch", () => {
  it("states both ends of every change and the resulting revision", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository } = harness([seededRecord(recordId, "North yard")]);

    const result = accepted(
      await executeCommand(deps, {
        kind: "patch-record",
        recordId,
        changes: new Map<FieldId, CellValueV1>([
          [NAME, { kind: "text", text: "North yard (rear)" }],
        ]),
      }),
    );

    expect(result.recordRevision).toBe(1n);
    const event = repository.appends[0]?.plan.events[0]?.event;
    if (event?.kind !== "record.patched") {
      throw new Error("expected a record.patched event");
    }
    // The payload names the revision the patch *results in* (S02 guards +1).
    expect(event.payload.recordRevision).toBe(1n);
    expect(event.payload.changes).toHaveLength(1);
    expect(event.payload.changes[0]?.before).toEqual({
      kind: "text",
      text: "North yard",
    });
    expect(event.payload.changes[0]?.after).toEqual({
      kind: "text",
      text: "North yard (rear)",
    });
    expect(event.payload.resultingRecordSha256).toHaveLength(32);
  });

  it("reads the record's current values across the identity boundary", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository } = harness([seededRecord(recordId, "North yard")]);

    // Only `Status` is touched. If the command failed to re-key the record's
    // existing values onto the schema's field instances, `Site` would read as
    // `missing` — a required field — and this would be rejected instead.
    const result = await executeCommand(deps, {
      kind: "patch-record",
      recordId,
      changes: new Map<FieldId, CellValueV1>([
        [asDomainId("field", Uint8Array.from(STATUS)), { kind: "enum", optionId: CLOSED_OPTION }],
      ]),
    });

    expect(result.outcome).toBe("accepted");
    const event = repository.appends[0]?.plan.events[0]?.event;
    if (event?.kind !== "record.patched") {
      throw new Error("expected a record.patched event");
    }
    expect(event.payload.changes).toHaveLength(1);
    expect(encodeDomainId(event.payload.changes[0]?.fieldId as FieldId)).toBe(
      encodeDomainId(STATUS),
    );
  });

  it("writes nothing when nothing moved", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository, projection } = harness([
      seededRecord(recordId, "North yard"),
    ]);

    const result = accepted(
      await executeCommand(deps, {
        kind: "patch-record",
        recordId,
        changes: new Map<FieldId, CellValueV1>([
          [NAME, { kind: "text", text: "North yard" }],
        ]),
      }),
    );

    expect(result.commit).toBeNull();
    expect(result.recordRevision).toBe(0n);
    expect(repository.appends).toHaveLength(0);
    expect(projection.trace).toEqual([]);
  });

  it("rejects an invalid patch without touching the record", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository, projection } = harness([
      seededRecord(recordId, "North yard"),
    ]);

    const result = await executeCommand(deps, {
      kind: "patch-record",
      recordId,
      // Clearing a required field is blocking; an unknown option is too.
      changes: new Map<FieldId, CellValueV1>([
        [NAME, BLANK_VALUE],
        [STATUS, { kind: "enum", optionId: createDomainId("option", entropy) }],
      ]),
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") {
      return;
    }
    expect(result.report.issues.map((issue) => issue.messageKey).sort()).toEqual([
      "validation.required",
      "validation.unknown-option",
    ]);
    expect(repository.appends).toHaveLength(0);

    const unchanged = projection.execute({ kind: "record-by-id", recordId });
    expect(unchanged?.recordRevision).toBe(0n);
    expect(unchanged?.authoredValues.get(NAME)).toEqual({
      kind: "text",
      text: "North yard",
    });
  });

  it("answers an unknown record as a result", async () => {
    const { deps } = harness();
    const result = await executeCommand(deps, {
      kind: "patch-record",
      recordId: createDomainId("record", entropy),
      changes: new Map(),
    });
    expect(result).toEqual({ outcome: "unknown-subject", subject: "record" });
  });
});

describe("delete and restore", () => {
  it("carries the complete restoration payload, which is what makes it recoverable", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository, projection } = harness([
      seededRecord(recordId, "North yard"),
    ]);

    await executeCommand(deps, { kind: "delete-record", recordId });

    const event = repository.appends[0]?.plan.events[0]?.event;
    if (event?.kind !== "record.deleted") {
      throw new Error("expected a record.deleted event");
    }
    expect(event.payload.priorRecordRevision).toBe(0n);
    expect(event.payload.source).toBe("user");
    expect([...event.payload.restoration.values.keys()]).toHaveLength(3);
    expect(event.payload.restoration.values.get(NAME)).toEqual({
      kind: "text",
      text: "North yard",
    });
    expect(repository.appends[0]?.rowCountAfter).toBe(0);

    expect(projection.liveRecordIds()).toEqual([]);
    // Gone from the table, still in the log.
    expect(
      projection
        .execute({ kind: "record-change-history", recordId, limit: 10 })
        .map((entry) => entry.eventKind),
    ).toContain("record.deleted");
  });

  it("restores the record, validated first, one revision past its delete", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository, projection } = harness([
      seededRecord(recordId, "North yard"),
    ]);

    await executeCommand(deps, { kind: "delete-record", recordId });
    const result = accepted(
      await executeCommand(deps, { kind: "restore-record", recordId }),
    );

    expect(result.recordRevision).toBe(1n);
    expect(projection.liveRecordIds()).toEqual([encodeDomainId(recordId)]);

    const event = repository.appends[1]?.plan.events[0]?.event;
    if (event?.kind !== "record.restored") {
      throw new Error("expected a record.restored event");
    }
    expect(valueOf(event.payload.record.values, NAME)).toEqual({
      kind: "text",
      text: "North yard",
    });
    const back = projection.execute({ kind: "record-by-id", recordId });
    expect(back?.recordRevision).toBe(1n);
  });

  it("restoring a record that is already present writes nothing", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository } = harness([seededRecord(recordId, "North yard")]);

    const result = accepted(
      await executeCommand(deps, { kind: "restore-record", recordId }),
    );
    expect(result.commit).toBeNull();
    expect(repository.appends).toHaveLength(0);
  });

  it("answers a record that was never deleted as a result", async () => {
    const { deps } = harness();
    const result = await executeCommand(deps, {
      kind: "restore-record",
      recordId: createDomainId("record", entropy),
    });
    expect(result).toEqual({
      outcome: "unknown-subject",
      subject: "deleted-record",
    });
  });
});

describe("the chain", () => {
  it("continues the device's sequence and names its predecessor", async () => {
    const recordId = createDomainId("record", entropy);
    const { deps, repository } = harness([seededRecord(recordId, "North yard")]);

    await executeCommand(deps, {
      kind: "patch-record",
      recordId,
      changes: new Map<FieldId, CellValueV1>([[NAME, { kind: "text", text: "A" }]]),
    });
    await executeCommand(deps, {
      kind: "patch-record",
      recordId,
      changes: new Map<FieldId, CellValueV1>([[NAME, { kind: "text", text: "B" }]]),
    });

    const [first, second] = repository.appends;
    expect(first?.plan.deviceCommitSequence).toBe(1n);
    expect(second?.plan.deviceCommitSequence).toBe(2n);
    expect(second?.plan.previousDeviceCommitSha256).not.toBeNull();
    // The basis frontier is what this device has applied, never a claim past it.
    expect(second?.plan.basisFrontier).toEqual([
      { deviceId: repository.chainState().deviceId, commitSequence: 1n },
    ]);
    // A stopped clock still yields a strictly increasing canonical order.
    expect(second?.plan.hybridTime.wallTimeMs).toBe(
      first?.plan.hybridTime.wallTimeMs,
    );
    expect(second?.plan.hybridTime.logicalCounter).toBe(
      (first?.plan.hybridTime.logicalCounter ?? 0) + 1,
    );
  });
});

describe("rekeyByFields", () => {
  it("adopts the schema's instances and leaves an unknown id alone", () => {
    const stranger = createDomainId("field", entropy);
    const rekeyed = rekeyByFields(
      TABLE.fields,
      new Map<FieldId, string>([
        [asDomainId("field", Uint8Array.from(NAME)), "known"],
        [stranger, "unknown"],
      ]),
    );

    // The known id now *is* the schema's instance, so a Map lookup finds it.
    expect(rekeyed.get(NAME)).toBe("known");
    // The stranger is kept as it arrived, so the validator still flags it.
    expect(rekeyed.get(stranger)).toBe("unknown");
  });
});
