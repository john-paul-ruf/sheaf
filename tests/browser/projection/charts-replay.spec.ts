import { expect, test, type Page } from "@playwright/test";

/**
 * CA-30 replay in a real browser (S05 CP1): a checkpoint's `charts` root
 * hydrates into `charts` rows, and `chart.saved` / `chart.deleted` land on
 * them through real SQLite WASM, filed in history under subject `chart`.
 *
 * Two refusals are the migration's and the replay guard's, not this spec's:
 * a new chart at an ordinal another chart holds is refused by `UNIQUE
 * (chart_ordinal)`, and a save that skips the chart's revision is refused as
 * a commit this app did not author. Each must dispose the projection rather
 * than skip the event.
 */

type CheckpointV1 = import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type ProjectionCommitV1 = import("../../../src/persistence/projection/types.js").ProjectionCommitV1;
type DomainEventV1 = import("../../../src/application/ports/event-repository.js").DomainEventV1;
type ChartDefinitionV1 = import("../../../src/domain/model/charts.js").ChartDefinitionV1;
type EventCommitBodyV1 = import("../../../src/persistence/codecs/event-commit.js").EventCommitBodyV1;

interface ChartsReport {
  readonly hydrated: readonly string[];
  readonly listed: readonly string[];
  readonly rows: readonly string[];
  readonly history: readonly string[];
  readonly schemaRevision: number;
  readonly takenOrdinal: string;
  readonly takenOrdinalAfter: string;
  readonly skippedRevision: string;
}

async function replayCharts(): Promise<ChartsReport> {
  const harness = window.__sheafHarness;
  const [projection, engine, ids, bytesModule, codec, hash] = await Promise.all([
    harness.module<typeof import("../../../src/persistence/projection/index.js")>("/src/persistence/projection/index.ts"),
    harness.module<typeof import("../../../src/persistence/projection/engine.js")>("/src/persistence/projection/engine.ts"),
    harness.module<typeof import("../../../src/domain/model/ids.js")>("/src/domain/model/ids.ts"),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts"),
    harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>("/src/persistence/codecs/event-commit.ts"),
    harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
  ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const hex = (value: unknown): string =>
    value instanceof Uint8Array ? [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("") : String(value);

  const appId = ids.asDomainId("app", bytes(1));
  const jobsId = ids.asDomainId("table", bytes(2));
  const deviceId = bytes(4);
  const genesis = ids.asDomainId("commit", bytes(5));
  const status = ids.asDomainId("field", bytes(0x10));
  const imported = ids.asDomainId("chart", bytes(0x30));
  const made = ids.asDomainId("chart", bytes(0x31));

  const definition = (chartId: typeof imported, name: string, pinned: boolean): ChartDefinitionV1 => ({
    chartVersion: 1,
    chartId,
    name,
    tableId: jobsId,
    filters: [],
    pinned,
    type: "bar",
    groupBy: { kind: "field", fieldId: status },
    seriesBy: null,
    measure: { kind: "count" },
    sort: "category",
  });

  const checkpoint = (): CheckpointV1 => ({
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(0x0b)),
    checkpointSemanticSha256: new Uint8Array(32).fill(0x0d),
    frontier: [{ deviceId, commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId,
      displayName: "Fieldwork",
      createdAtMs: 1_700_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme: {
        themeKey: "sheaf.built-in.v1",
        tokens: {
          "app-ink": "#17231e",
          "app-canvas": "#f5f1e7",
          "app-surface": "#fffdf8",
          "app-primary": "#315c49",
          "app-accent": "#c66948",
          "app-muted": "#e2ded2",
        },
      },
      stateRevision: 1n,
    },
    sheetSnapshots: [],
    tables: [
      {
        tableId: jobsId,
        displayName: "Jobs",
        tableOrdinal: 0,
        fields: [
          {
            fieldId: status,
            tableId: jobsId,
            displayName: "Status",
            fieldOrdinal: 0,
            type: { kind: "text" },
            isRequired: false,
            isActive: true,
            schemaRevision: 1n,
          },
        ],
        keyFieldId: null,
        labelFieldId: null,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    enumOptions: [],
    relationships: [],
    validationRules: [],
    formulas: [],
    charts: [
      {
        definition: definition(imported, "Quoted by status", true),
        displayName: "Quoted by status",
        pinned: true,
        ordinal: 0,
        provenance: "imported",
        chartRevision: 2n,
      },
    ],
    inertItems: [],
    importLineages: [],
    inferenceDecisions: [],
    recordPages: [
      {
        records: [
          {
            record: { recordId: ids.asDomainId("record", bytes(0x20)), tableId: jobsId, values: new Map(), provenance: new Map() },
            recordRevision: 0n,
            createdCommitId: genesis,
            updatedCommitId: genesis,
            issues: [],
          },
        ],
      },
    ],
  });

  const state = (chartId: typeof imported, name: string, pinned: boolean, ordinal: number, chartRevision: bigint) => ({
    definition: definition(chartId, name, pinned),
    displayName: name,
    pinned,
    ordinal,
    provenance: "user" as const,
    chartRevision,
  });
  const saved = (chartId: typeof imported, name: string, pinned: boolean, ordinal: number, chartRevision: bigint): DomainEventV1 => ({
    kind: "chart.saved",
    payload: { chartId, ...state(chartId, name, pinned, ordinal, chartRevision), priorSha256: null },
  });

  const seal = async (event: DomainEventV1, chartId: Uint8Array, index: number, previous: Uint8Array): Promise<ProjectionCommitV1> => {
    const body: EventCommitBodyV1 = {
      eventFormatVersion: 1,
      commitId: bytes(0x40 + index),
      appId,
      deviceId,
      deviceCommitSequence: BigInt(index + 2),
      previousDeviceCommitSha256: previous,
      basisFrontier: [{ deviceId, commitSequence: BigInt(index + 1) }],
      hybridTime: { wallTimeMs: 1_700_000_100_000n + BigInt(index) * 1_000n, logicalCounter: 0 },
      eventClass: "authored",
      // A chart is not schema: the revision does not move.
      schemaRevisionBefore: 1n,
      schemaRevisionAfter: 1n,
      events: [
        {
          eventId: Uint8Array.from({ length: 16 }, (_unused, position) => (position === 0 ? 0x60 + index : 0)),
          eventIndex: 0,
          kind: event.kind,
          subject: { appId, tableId: jobsId, objectId: chartId },
          payload: new Map([["kind", event.kind]]),
          provenance: { source: "user" },
        },
      ],
    };
    return { commit: await codec.sealEventCommit(body, hash.sha256), events: [event] };
  };

  const open = async () => {
    const handle = await projection.openProjection({ sha256: hash.sha256, clock: () => ({ epochDay: 20_000, epochMs: 1_728_000_000_000 }) });
    await projection.hydrateApp(handle, checkpoint());
    return handle;
  };
  /** Replays one event per commit; the refusal's text, or "replayed". */
  const replay = async (handle: Awaited<ReturnType<typeof open>>, events: readonly (readonly [DomainEventV1, Uint8Array])[]) => {
    let previous: Uint8Array = new Uint8Array(32).fill(0x0c);
    for (const [index, [event, chartId]] of events.entries()) {
      const commit = await seal(event, chartId, index, previous);
      previous = commit.commit.commitSha256;
      const outcome = await projection.applyEvents(handle, [commit]).then(
        () => "replayed",
        (cause: unknown) => String(cause),
      );
      if (outcome !== "replayed") return outcome;
    }
    return "replayed";
  };
  const listed = (handle: Awaited<ReturnType<typeof open>>) =>
    projection
      .executeQuery(handle, { kind: "list-charts" })
      .map((chart) => [chart.definition.name, chart.pinned, chart.ordinal, chart.provenance, chart.chartRevision].join("|"));

  const handle = await open();
  const hydrated = listed(handle);
  await replay(handle, [
    [saved(made, "Jobs by status", false, 1, 0n), made],
    [{ kind: "chart.saved", payload: { chartId: imported, ...state(imported, "Quoted by status", false, 0, 3n), provenance: "imported", priorSha256: new Uint8Array(32).fill(9) } }, imported],
    [{ kind: "chart.deleted", payload: { chartId: made, prior: state(made, "Jobs by status", false, 1, 0n) } }, made],
  ]);
  const rows = (sql: string) => engine.selectRows(handle, sql).map((row) => row.map(hex).join("|"));
  const report = {
    hydrated,
    listed: listed(handle),
    rows: rows("SELECT display_name, chart_type, is_pinned, chart_ordinal, provenance, chart_revision, length(definition_cbor) > 0 FROM charts ORDER BY chart_ordinal"),
    history: rows("SELECT event_kind, subject_kind, subject_id FROM change_history ORDER BY wall_time_ms"),
    schemaRevision: Number(engine.selectRows(handle, "SELECT schema_revision FROM app_state")[0]![0]),
  };
  projection.disposeProjection(handle);

  // A second chart at the imported chart's ordinal.
  const taken = await open();
  const takenOrdinal = await replay(taken, [[saved(made, "Collides", false, 0, 0n), made]]);
  const takenOrdinalAfter = (() => {
    try {
      engine.selectRows(taken, "SELECT count(*) FROM charts");
      return "still answering";
    } catch (cause) {
      return String(cause);
    }
  })();

  // An edit that skips from revision 2 to 4.
  const skipped = await open();
  const skippedRevision = await replay(skipped, [
    [{ kind: "chart.saved", payload: { chartId: imported, ...state(imported, "Skipped", true, 0, 4n), priorSha256: null } }, imported],
  ]);

  return { ...report, takenOrdinal, takenOrdinalAfter, skippedRevision };
}

let page: Page;
let report: ChartsReport;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  report = await page.evaluate(replayCharts);
});

test.afterAll(async () => {
  await page.close();
});

test("hydrates the checkpoint's charts root into rows (CA-30)", () => {
  expect(report.hydrated).toEqual(["Quoted by status|true|0|imported|2"]);
});

test("replays a new chart, an edit and a delete onto the rows, in ordinal order", () => {
  expect(report.listed).toEqual(["Quoted by status|false|0|imported|3"]);
  expect(report.rows).toEqual(["Quoted by status|bar|0|0|imported|3|1"]);
  // Charts are not schema: the app's schema revision is where hydration left it.
  expect(report.schemaRevision).toBe(1);
});

test("files every chart event under subject `chart`, keyed by the chart", () => {
  const made = "31".repeat(16);
  const imported = "30".repeat(16);
  expect(report.history).toEqual([`chart.saved|chart|${made}`, `chart.saved|chart|${imported}`, `chart.deleted|chart|${made}`]);
});

test("disposes the projection when a new chart takes an ordinal already held (UNIQUE chart_ordinal)", () => {
  expect(report.takenOrdinal).toMatch(/UNIQUE|constraint/i);
  expect(report.takenOrdinalAfter).toContain("disposed");
});

test("refuses a save that skips the chart's revision", () => {
  expect(report.skippedRevision).toContain("does not follow the chart's revision");
});
