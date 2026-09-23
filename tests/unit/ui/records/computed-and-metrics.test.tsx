import { describe, expect, it, vi } from "vitest";
import {
  computedFieldsOf,
  selectAppHomeVm,
  selectChangeHistoryVm,
  selectMetricsVm,
  selectRecordDetailVm,
  selectRecordFormVm,
} from "../../../../src/application/view-models/records.js";
import type {
  AppStructureViewV1,
  AppTableViewV1,
  CellWireEntryV1,
} from "../../../../src/workers/protocol/messages.js";
import { AppHomeScreen } from "../../../../src/ui/records/app-home-screen.js";
import { ChangeHistoryScreen } from "../../../../src/ui/records/change-history-screen.js";
import { RecordDetailScreen } from "../../../../src/ui/records/record-detail-screen.js";
import { RecordFormScreen } from "../../../../src/ui/records/record-form-screen.js";
import type { AppIdentity, AppNavigation } from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import { cssRulesFor, query, queryAll, render } from "../render.js";
import { APP_ID, DEMO_VALUES, TABLE_ID, detail, historyEntry, historyPage, session, table } from "./fixtures.js";

/**
 * CA-26's last column and CAP-29 as rendered (S04 CP3): a computed column is
 * read-only with its expression in the app's names, every state without a
 * result says why (STA-013 included, never a zero), a recalculated value
 * underlines rather than flashes, "At a glance" shows only real metrics, and
 * F04's structure events read as sentences in the change log.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  tables: [{ tableId: TABLE_ID, displayName: "Visits", href: `#/app/${APP_ID}/t/${TABLE_ID}` }],
};
const identity: AppIdentity = { appId: APP_ID, displayName: "Field Log", theme: session().theme };

const BALANCE = "field-balance";
const withBalance: AppTableViewV1 = {
  ...table(),
  fields: [
    ...table().fields,
    { fieldId: BALANCE, displayName: "Balance", fieldOrdinal: 9, type: { kind: "currency", currencyCode: "USD" }, isRequired: false, isActive: true, enumOptions: [] },
  ],
};
const structure: AppStructureViewV1 = {
  appId: APP_ID,
  displayName: "Field Log",
  schemaRevision: 2,
  tables: [],
  relationships: [],
  formulas: [
    {
      formulaId: "fx-balance",
      target: { kind: "computed-column", tableId: TABLE_ID, fieldId: BALANCE },
      displayName: null,
      text: "[Quoted amount] - [Paid]",
      disposition: "live",
      determinism: "deterministic",
      isActive: true,
    },
  ],
};

async function renderDetail(balance: CellWireEntryV1, recalculated: ReadonlySet<string> = new Set()): Promise<void> {
  const vm = selectRecordDetailVm(withBalance, detail({ values: [...DEMO_VALUES, balance] }), {
    computedFields: computedFieldsOf(structure),
  });
  await render(
    <RecordDetailScreen
      app={identity}
      editHref="#/edit"
      nav={nav}
      onOpenActions={vi.fn()}
      recalculatedFieldIds={recalculated}
      recordHref={() => "#/r"}
      recordsHref="#/list"
      vm={vm}
    />,
  );
}

describe("computed values in the record (CA-26; SCR-027/029)", () => {
  it("shows a live result read-only, with the expression in the app's names", async () => {
    await renderDetail({ fieldId: BALANCE, value: { kind: "number", decimal: "925.00" }, computed: { state: "ok" } });
    const cell = query(`[data-field='${BALANCE}'] [data-computed]`);
    expect(cell.dataset["computed"]).toBe("ok");
    expect(cell.textContent).toContain("$925.00");
    expect(cell.textContent).toContain("Read-only · Live");
    expect(cell.textContent).toContain("[Quoted amount] - [Paid]");
    expect(cell.querySelector("input, button")).toBeNull();
  });

  it("keeps an unsupported formula's imported value, and leaves a new row empty and flagged, never zero (STA-013)", async () => {
    await renderDetail({ fieldId: BALANCE, value: { kind: "number", decimal: "1850" }, computed: { state: "unsupported" } });
    const kept = query(`[data-field='${BALANCE}'] [data-computed]`);
    expect(kept.textContent).toContain("$1,850.00");
    expect(kept.textContent).toContain("Read-only · Unsupported formula");
    expect(kept.textContent).toContain("Imported value kept");
  });

  it("says each state without a result in words", async () => {
    await renderDetail({ fieldId: BALANCE, value: { kind: "missing" }, computed: { state: "unsupported-new-row" } });
    const fresh = query(`[data-field='${BALANCE}'] [data-computed]`);
    expect(fresh.textContent).toContain("Left empty and flagged");
    expect(fresh.textContent).not.toMatch(/\$0/u);
  });

  it("names an error by its code and a plain reason", async () => {
    await renderDetail({ fieldId: BALANCE, value: { kind: "missing" }, computed: { state: "error", code: "#DIV/0!" } });
    expect(query(`[data-field='${BALANCE}'] [data-computed]`).textContent).toContain("#DIV/0!: it divides by zero");
  });

  it("underlines a recalculated value, and never animates colour or opacity (design.md § Motion)", async () => {
    await renderDetail({ fieldId: BALANCE, value: { kind: "number", decimal: "925.00" }, computed: { state: "ok" } }, new Set([BALANCE]));
    const cell = query(`[data-field='${BALANCE}'] [data-computed]`);
    expect(cell.dataset["recalculated"]).toBe("true");
    const rules = cssRulesFor(query(`[data-field='${BALANCE}'] [data-computed] > span`)).join("\n");
    expect(rules).toContain("text-decoration: underline");
    // The animation's length is the panel duration token, which reduced motion collapses.
    expect(rules).toContain("var(--duration-panel)");
    expect(rules).not.toMatch(/opacity|background-color/u);
  });

  it("renders a computed column on the form as read-only, and never sends it", async () => {
    const onSave = vi.fn();
    const vm = selectRecordFormVm({ table: withBalance, computedFields: computedFieldsOf(structure) });
    await render(<RecordFormScreen app={identity} cancelHref="#/list" nav={nav} onSave={onSave} vm={vm} />);
    const group = query(`[data-field='${BALANCE}']`);
    expect(group.querySelector("input, button, select, textarea")).toBeNull();
    expect(group.textContent).toContain("Read-only · Live");
    expect(group.textContent).toContain("[Quoted amount] - [Paid]");
  });
});

describe("At a glance (SCR-024; CAP-29)", () => {
  it("shows each metric with its value or the reason there is none", async () => {
    const metrics = selectMetricsVm(
      {
        dashboard: [{ formulaId: "fx-open", displayName: "Open visits", status: "ok", value: { kind: "number", decimal: "18" }, code: null, evaluatedAtEpochMs: 1 }],
        tables: [
          {
            tableId: TABLE_ID,
            metrics: [{ formulaId: "fx-ratio", displayName: "Ratio", status: "cycle", value: null, code: null, evaluatedAtEpochMs: null }],
          },
        ],
      },
      session().tables,
      null,
    );
    await render(<AppHomeScreen nav={nav} newRecordHref={() => "#new"} tableHref={() => "#t"} vm={selectAppHomeVm(session(), metrics)} />);
    const glance = query("[data-section='glance']");
    expect(glance.querySelector("h2")?.textContent).toBe("At a glance");
    expect(queryAll("[data-metric]").map((tile) => tile.textContent)).toEqual([
      "Open visits18Live",
      "Ratio · Visits—This calculation depends on itself",
    ]);
    // With metrics, the "arrives in a later release" statement is not made.
    expect(document.body.textContent).not.toContain("at-a-glance totals are computed surfaces");
  });

  it("draws no section for an app with no metrics", async () => {
    await render(<AppHomeScreen nav={nav} newRecordHref={() => "#new"} tableHref={() => "#t"} vm={selectAppHomeVm(session())} />);
    expect(queryAll("[data-section='glance']")).toHaveLength(0);
  });
});

describe("the change log names F04's structure events (CA-28)", () => {
  it("reads each kind as a sentence, and an unnamed kind truthfully", async () => {
    const kinds = ["field.changed", "formula.changed", "relationship.removed", "rule.changed", "chart.saved"];
    const page = historyPage({
      entries: kinds.map((eventKind, index) =>
        historyEntry({ eventId: `e-${String(index)}`, eventKind, subjectKind: "field", subjectId: `s-${String(index)}`, changedFieldIds: [] }),
      ),
    });
    await render(
      <ChangeHistoryScreen app={identity} fieldNames={new Map()} nav={nav} onRestore={vi.fn()} vm={selectChangeHistoryVm(page)} />,
    );
    const text = document.body.textContent ?? "";
    for (const sentence of ["Field changed", "Calculation changed", "Relationship removed", "Rule changed", "A change was recorded"]) {
      expect(text).toContain(sentence);
    }
  });
});
