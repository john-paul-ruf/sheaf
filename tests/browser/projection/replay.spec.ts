import { expect, test, type Page } from "@playwright/test";

/**
 * CA-13(a) and CA-13(e) in a real browser: replaying a tail of commits onto a
 * hydrated projection, and refusing to replay a tail that does not add up.
 *
 * The equivalence claim is exact, not approximate. Hydrating a checkpoint *with*
 * its tail and hydrating it *without* and then applying the tail must leave two
 * databases a query cannot tell apart — same rows, same row keys, same derived
 * issue identities, same search index, same history, same frontier. Anything
 * less would mean a restarted app and a running app disagree about the same
 * facts, which is the failure this contract exists to rule out.
 *
 * Every negative below is a guard database.md § Replay guards names: a commit
 * hash that does not match its body, a device sequence with a gap, a
 * `schemaRevisionBefore` that disagrees with the schema, and an event whose
 * subject belongs to another app. Each must dispose the whole projection —
 * never skip the bad commit, never leave a usable-looking app behind.
 */

type CheckpointV1 =
  import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type ProjectionCommitV1 =
  import("../../../src/persistence/projection/types.js").ProjectionCommitV1;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type FieldTypeV1 = import("../../../src/domain/model/schema.js").FieldTypeV1;
type EnumOptionDefV1 =
  import("../../../src/domain/model/schema.js").EnumOptionDefV1;
type F02DomainEventV1 =
  import("../../../src/domain/model/events.js").F02DomainEventV1;
type AppThemeTokenV1 =
  import("../../../src/domain/model/events.js").AppThemeTokenV1;
type DomainEventV1 =
  import("../../../src/migrations/004_event_format_v1.js").DomainEventV1;
type EventCommitBodyV1 =
  import("../../../src/persistence/codecs/event-commit.js").EventCommitBodyV1;

type Mutation =
  | "none"
  | "broken-hash"
  | "sequence-gap"
  | "wrong-schema-revision"
  | "foreign-subject";

interface Snapshot {
  readonly records: readonly string[];
  readonly cells: readonly string[];
  readonly issues: readonly string[];
  readonly history: readonly string[];
  readonly searchHits: readonly string[];
  readonly staleSearchHits: readonly string[];
  readonly frontier: readonly string[];
  readonly schemaRevision: number;
  readonly options: readonly string[];
}

interface ReplayOutcome {
  readonly withTail: Snapshot | null;
  readonly tailApplied: Snapshot | null;
  readonly failure: string;
  readonly refusedAfterFailure: string;
}

/**
 * Builds one app, one tail of five commits (create, patch, delete, restore,
 * enum rename), and replays it. `mode: "equivalence"` builds two projections
 * and returns both snapshots; every other mode corrupts the tail in exactly one
 * way and reports what the engine did about it.
 */
async function runReplay(input: {
  readonly mutation: Mutation;
}): Promise<ReplayOutcome> {
  const harness = window.__sheafHarness;
  const [projection, engine, cbor, ids, bytesModule, values, events, codec, hash] =
    await Promise.all([
      harness.module<typeof import("../../../src/persistence/projection/index.js")>(
        "/src/persistence/projection/index.ts",
      ),
      harness.module<typeof import("../../../src/persistence/projection/engine.js")>(
        "/src/persistence/projection/engine.ts",
      ),
      harness.module<typeof import("../../../src/persistence/projection/cbor-values.js")>(
        "/src/persistence/projection/cbor-values.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/ids.js")>(
        "/src/domain/model/ids.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/bytes.js")>(
        "/src/domain/model/bytes.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/values.js")>(
        "/src/domain/model/values.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/events.js")>(
        "/src/domain/model/events.ts",
      ),
      harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>(
        "/src/persistence/codecs/event-commit.ts",
      ),
      harness.module<typeof import("../../../src/crypto/hash.js")>(
        "/src/crypto/hash.ts",
      ),
    ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const hex = (value: unknown): string =>
    value instanceof Uint8Array
      ? [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      : String(value === null ? "null" : (value as number | string));

  const appId = ids.asDomainId("app", bytes(1));
  const otherAppId = ids.asDomainId("app", bytes(0xee));
  const tableId = ids.asDomainId("table", bytes(2));
  const deviceId = bytes(3);
  const marieId = ids.asDomainId("record", bytes(4));
  const adaId = ids.asDomainId("record", bytes(5));
  const optionOpen = ids.asDomainId("option", bytes(6));
  const optionOverdue = ids.asDomainId("option", bytes(7));
  const genesisCommit = ids.asDomainId("commit", bytes(8));
  const provenance = { source: "user" } as const;

  const field = (
    fill: number,
    displayName: string,
    fieldOrdinal: number,
    type: FieldTypeV1,
  ): FieldDefV1 => ({
    fieldId: ids.asDomainId("field", bytes(fill)),
    tableId,
    displayName,
    fieldOrdinal,
    type,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  });

  const nameField = field(0x10, "Name", 0, { kind: "text" });
  const amountField = field(0x11, "Amount", 1, { kind: "number" });
  const statusField = field(0x12, "Status", 2, { kind: "enum" });

  const option = (
    optionId: ReturnType<typeof ids.asDomainId<"option">>,
    displayLabel: string,
    optionOrdinal: number,
  ): EnumOptionDefV1 => ({
    optionId,
    fieldId: statusField.fieldId,
    displayLabel,
    optionOrdinal,
    isActive: true,
    schemaRevision: 1n,
  });

  const checkpoint = (): CheckpointV1 => ({
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(9)),
    checkpointSemanticSha256: new Uint8Array(32).fill(0x0a),
    frontier: [{ deviceId, commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId,
      displayName: "Invoices",
      createdAtMs: 1_699_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme: {
        themeKey: "sheaf.built-in.slate",
        tokens: Object.fromEntries(
          events.APP_THEME_TOKENS.map((token) => [token, "#101010"]),
        ) as Record<AppThemeTokenV1, string>,
      },
      stateRevision: 0n,
    },
    sheetSnapshots: [],
    tables: [
      {
        tableId,
        displayName: "Invoices",
        tableOrdinal: 0,
        fields: [nameField, amountField, statusField],
        keyFieldId: null,
        labelFieldId: nameField.fieldId,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    enumOptions: [
      option(optionOpen, "Open", 0),
      option(optionOverdue, "Overdue", 1),
    ],
    validationRules: [],
    recordPages: [
      {
        records: [
          {
            record: {
              recordId: adaId,
              tableId,
              values: new Map([
                [nameField.fieldId, values.textValue("Ada Lovelace")],
                [statusField.fieldId, values.enumValue(optionOverdue)],
              ]),
              provenance: new Map(),
            },
            recordRevision: 0n,
            createdCommitId: genesisCommit,
            updatedCommitId: genesisCommit,
            issues: [],
          },
        ],
      },
    ],
  });

  const marieRecord = (amount: string, name: string) => ({
    recordId: marieId,
    tableId,
    values: new Map([
      [nameField.fieldId, values.textValue(name)],
      [amountField.fieldId, values.decimalValue(amount)],
      [statusField.fieldId, values.enumValue(optionOpen)],
    ]),
    provenance: new Map([
      [nameField.fieldId, provenance],
      [amountField.fieldId, provenance],
      [statusField.fieldId, provenance],
    ]),
  });

  /** The five typed events, in the order the tail commits them. */
  const tailEvents: readonly F02DomainEventV1[] = [
    {
      kind: "record.created",
      payload: { record: marieRecord("3.00", "Marie Curie"), importedInvalid: false },
    },
    {
      kind: "record.patched",
      payload: {
        recordId: marieId,
        tableId,
        recordRevision: 1n,
        changes: [
          {
            fieldId: amountField.fieldId,
            before: values.decimalValue("3.00"),
            after: values.decimalValue("4.00"),
            provenance,
          },
          {
            fieldId: nameField.fieldId,
            before: values.textValue("Marie Curie"),
            after: values.textValue("Marie Sklodowska"),
            provenance,
          },
        ],
        resultingRecordSha256: new Uint8Array(32).fill(0x0b),
      },
    },
    {
      kind: "record.deleted",
      payload: {
        recordId: marieId,
        tableId,
        priorRecordRevision: 1n,
        restoration: marieRecord("4.00", "Marie Sklodowska"),
        source: "user",
      },
    },
    {
      kind: "record.restored",
      payload: {
        deletedEventId: ids.asDomainId("event", bytes(0x22)),
        record: marieRecord("4.00", "Marie Sklodowska"),
      },
    },
    {
      kind: "enum.changed",
      payload: {
        fieldId: statusField.fieldId,
        priorOptionSetSha256: null,
        // The complete resulting set, with "Overdue" renamed to "Late".
        options: [option(optionOpen, "Open", 0), option(optionOverdue, "Late", 1)],
      },
    },
  ];

  const subjectFor = (event: F02DomainEventV1) => {
    const base = { appId };
    switch (event.kind) {
      case "record.created":
        return { ...base, tableId, recordId: marieId };
      case "record.patched":
      case "record.deleted":
      case "record.restored":
        return { ...base, tableId, recordId: marieId };
      case "enum.changed":
        return { ...base, fieldId: statusField.fieldId };
      default:
        return base;
    }
  };

  const buildTail = async (
    mutation: Mutation,
  ): Promise<readonly ProjectionCommitV1[]> => {
    const tail: ProjectionCommitV1[] = [];
    let previousSha: Uint8Array = new Uint8Array(32).fill(0x0c);

    for (const [index, event] of tailEvents.entries()) {
      // The checkpoint covers sequence 1, so the tail starts at 2. The gap
      // mutation skips one, which is exactly what a lost segment looks like.
      const sequence =
        BigInt(index + 2) +
        (mutation === "sequence-gap" && index >= 2 ? 1n : 0n);

      const wire: DomainEventV1 = {
        eventId: bytes(0x20 + index),
        eventIndex: 0,
        kind: event.kind,
        subject: subjectFor(event),
        // M12 never reads the wire payload: the typed event beside it carries
        // the meaning, and the guards prove the two agree kind for kind.
        payload: new Map<string, string>([["kind", event.kind]]),
        provenance: { source: "user" },
      };

      const body: EventCommitBodyV1 = {
        eventFormatVersion: 1,
        commitId: bytes(0x30 + index),
        appId,
        deviceId,
        deviceCommitSequence: sequence,
        previousDeviceCommitSha256: previousSha,
        basisFrontier: [{ deviceId, commitSequence: sequence - 1n }],
        hybridTime: {
          wallTimeMs: 1_700_000_100_000n + BigInt(index) * 1_000n,
          logicalCounter: index,
        },
        eventClass: "authored",
        schemaRevisionBefore:
          mutation === "wrong-schema-revision" && index === 1 ? 7n : 1n,
        schemaRevisionAfter: 1n,
        events: [wire],
      };

      const sealed = await codec.sealEventCommit(body, hash.sha256);
      previousSha = sealed.commitSha256;

      // The foreign subject is planted *after* sealing on purpose: the codec
      // refuses to encode a commit whose event names another app, so the only
      // way this reaches the engine is as a tampered commit — which is exactly
      // the case the replay guard exists for.
      const commit =
        mutation === "foreign-subject" && index === 0
          ? {
              ...sealed,
              events: [{ ...wire, subject: { ...wire.subject, appId: otherAppId } }],
            }
          : mutation === "broken-hash" && index === 1
            ? {
                ...sealed,
                commitSha256: sealed.commitSha256.map((byte, position) =>
                  position === 0 ? byte ^ 0xff : byte,
                ),
              }
            : sealed;

      tail.push({ commit, events: [event] });
    }
    return tail;
  };

  const snapshot = (handle: Parameters<typeof engine.selectRows>[0]): Snapshot => {
    const rows = (sql: string, parameters: readonly (string | Uint8Array)[] = []) =>
      engine.selectRows(handle, sql, parameters);

    return {
      records: rows(
        `SELECT record_pk, record_id, record_revision, created_commit_id,
                updated_commit_id, authored_cbor
           FROM records ORDER BY record_pk`,
      ).map((row) =>
        [
          hex(row[0]),
          hex(row[1]),
          hex(row[2]),
          hex(row[3]),
          hex(row[4]),
          hex(row[5]),
        ].join("|"),
      ),
      cells: rows(
        `SELECT record_pk, field_id, value_kind, text_value, text_sort_key,
                decimal_value, decimal_order_key, integer_value, id_value
           FROM cells ORDER BY record_pk, field_id`,
      ).map((row) => row.map(hex).join("|")),
      issues: rows(
        `SELECT record_pk, issue_id, field_id, issue_kind, severity, message_key
           FROM record_issues ORDER BY record_pk, issue_id`,
      ).map((row) => row.map(hex).join("|")),
      history: rows(
        `SELECT event_kind, subject_kind, subject_id, wall_time_ms,
                logical_counter, commit_id, summary_cbor, restoration_cbor
           FROM change_history
          ORDER BY wall_time_ms DESC, logical_counter DESC, event_id DESC`,
      ).map((row) => row.map(hex).join("|")),
      searchHits: rows(
        `SELECT r.record_id, record_search.rowid
           FROM record_search
           JOIN records AS r ON r.record_pk = record_search.rowid
          WHERE record_search MATCH ?
          ORDER BY r.record_pk`,
        ['"Late" OR "Sklodowska"'],
      ).map((row) => row.map(hex).join("|")),
      staleSearchHits: rows(
        "SELECT rowid FROM record_search WHERE record_search MATCH ?",
        ['"Overdue"*'],
      ).map((row) => row.map(hex).join("|")),
      frontier: cbor
        .decodeFrontier(
          rows("SELECT frontier_cbor FROM projection_meta")[0]![0] as Uint8Array,
        )
        .map((entry) => `${hex(entry.deviceId)}:${entry.commitSequence}`),
      schemaRevision: Number(
        rows("SELECT schema_revision FROM app_state")[0]![0],
      ),
      options: rows(
        "SELECT option_id, display_label, option_ordinal FROM enum_options ORDER BY option_ordinal",
      ).map((row) => row.map(hex).join("|")),
    };
  };

  if (input.mutation === "none") {
    const tail = await buildTail("none");

    // Path A: the checkpoint and its tail in one call.
    const withTailHandle = await projection.openProjection({ sha256: hash.sha256 });
    await projection.hydrateApp(withTailHandle, checkpoint(), tail);
    const withTail = snapshot(withTailHandle);
    projection.disposeProjection(withTailHandle);

    // Path B: the checkpoint alone, then the same tail applied afterwards —
    // and in two batches rather than one, which is how commits actually arrive
    // at a running app. Equality therefore proves more than that one function
    // calls another: it proves the batch boundary changes nothing, including
    // the per-device chain check that spans the two calls.
    const appliedHandle = await projection.openProjection({ sha256: hash.sha256 });
    await projection.hydrateApp(appliedHandle, checkpoint());
    const sameTail = await buildTail("none");
    await projection.applyEvents(appliedHandle, sameTail.slice(0, 2));
    await projection.applyEvents(appliedHandle, sameTail.slice(2));
    const tailApplied = snapshot(appliedHandle);
    projection.disposeProjection(appliedHandle);

    return { withTail, tailApplied, failure: "", refusedAfterFailure: "" };
  }

  const handle = await projection.openProjection({ sha256: hash.sha256 });
  const failure = await projection
    .hydrateApp(handle, checkpoint(), await buildTail(input.mutation))
    .then(
      () => "replay succeeded",
      (cause: unknown) => String(cause),
    );
  const refusedAfterFailure = (() => {
    try {
      engine.selectRows(handle, "SELECT count(*) FROM records");
      return "still answering";
    } catch (cause) {
      return String(cause);
    }
  })();

  return { withTail: null, tailApplied: null, failure, refusedAfterFailure };
}

let page: Page;
let equivalence: ReplayOutcome;

const UNMUTATED: { readonly mutation: Mutation } = { mutation: "none" };

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  equivalence = await page.evaluate(runReplay, UNMUTATED);
});

test.afterAll(async () => {
  await page.close();
});

test("CA-13(a): checkpoint plus tail equals checkpoint then tail", () => {
  const { withTail, tailApplied } = equivalence;

  expect(withTail).not.toBeNull();
  // Every row, every derived key, every index entry — not a summary of them.
  expect(withTail).toEqual(tailApplied);
});

test("replays create, patch, delete, and restore onto one record", () => {
  const { withTail } = equivalence;

  // Two live records: the checkpoint's, and the one the tail created, deleted,
  // and brought back.
  expect(withTail?.records).toHaveLength(2);
  const marie = withTail?.records
    .find((row) => row.split("|")[1] === "04".repeat(16))
    ?.split("|");
  expect(marie).toBeDefined();

  const [, , revision, createdCommit, updatedCommit] = marie as string[];
  // One revision past the delete, and still created by the commit that first
  // created it rather than by the one that brought it back.
  expect(revision).toBe("2");
  expect(createdCommit).toBe("30".repeat(16));
  expect(updatedCommit).toBe("33".repeat(16));

  // The patched values are the ones that survive the round trip.
  expect(withTail?.cells.some((row) => row.includes("|4.00|"))).toBe(true);
  expect(withTail?.cells.some((row) => row.includes("|3.00|"))).toBe(false);
});

test("records every event in change history, in hybrid-time order", () => {
  const kinds = equivalence.withTail?.history.map((row) => row.split("|")[0]);

  // Newest first: five commits, one event each, ordered by hybrid time.
  expect(kinds).toEqual([
    "enum.changed",
    "record.restored",
    "record.deleted",
    "record.patched",
    "record.created",
  ]);

  const deleted = equivalence.withTail?.history.find((row) =>
    row.startsWith("record.deleted"),
  );
  // Only the delete carries a restoration payload — that is what makes it
  // recoverable (FR-12 / CAP-17).
  expect(deleted?.split("|").at(-1)).not.toBe("null");
  expect(
    equivalence.withTail?.history
      .filter((row) => !row.startsWith("record.deleted"))
      .every((row) => row.split("|").at(-1) === "null"),
  ).toBe(true);
});

test("an enum rename re-indexes the records that used the option", () => {
  const { withTail } = equivalence;

  expect(withTail?.options.some((row) => row.includes("|Late|"))).toBe(true);
  expect(withTail?.options.some((row) => row.includes("|Overdue|"))).toBe(false);
  // Ada's status is still the same option ID, and search now finds its new
  // label rather than the one nobody can see any more.
  expect(withTail?.searchHits).toHaveLength(2);
  expect(withTail?.staleSearchHits).toEqual([]);
  expect(withTail?.frontier).toEqual([`${"03".repeat(16)}:6`]);
});

const GUARDS: readonly {
  readonly mutation: Mutation;
  readonly because: string;
  readonly refusal: string;
}[] = [
  {
    mutation: "broken-hash",
    because: "a commit hash does not match its body",
    refusal: "commit hash does not match its body",
  },
  {
    mutation: "sequence-gap",
    because: "a device sequence skips a number",
    refusal: "commit sequence does not continue the frontier",
  },
  {
    mutation: "wrong-schema-revision",
    because: "a commit was authored against another schema",
    refusal: "commit was authored against another schema",
  },
  {
    mutation: "foreign-subject",
    because: "an event names another app",
    refusal: "event subject belongs to another app",
  },
];

for (const guard of GUARDS) {
  test(`CA-13(e): replay stops and disposes when ${guard.because}`, async ({
    browser,
  }) => {
    const guarded = await browser.newPage();
    try {
      await guarded.goto("/harness.html");
      const outcome = await guarded.evaluate(runReplay, {
        mutation: guard.mutation,
      });

      expect(outcome.failure).toContain(guard.refusal);
      // Not "skipped the bad commit and carried on": the whole projection is
      // gone, so nothing can read a partially replayed app.
      expect(outcome.refusedAfterFailure).toContain("disposed");
    } finally {
      await guarded.close();
    }
  });
}
