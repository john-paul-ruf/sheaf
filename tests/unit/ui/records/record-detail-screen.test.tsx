import { describe, expect, it, vi } from "vitest";
import { selectRecordDetailVm } from "../../../../src/application/view-models/records.js";
import {
  RecordDetailScreen,
  mapsHref,
} from "../../../../src/ui/records/record-detail-screen.js";
import type {
  AppIdentity,
  AppNavigation,
} from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";
import { APP_ID, FIELD_IDS, TABLE_ID, detail, session, table } from "./fixtures.js";

/**
 * SCR-027 as rendered (CAP-16, FR-6, FR-12, D25).
 *
 * The record the fixtures build is the demo file's row 21: the one whose
 * currency cell arrived as "TBD" and was kept rather than coerced.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  tables: [
    {
      tableId: TABLE_ID,
      displayName: "Visits",
      href: `#/app/${APP_ID}/t/${TABLE_ID}`,
    },
  ],
};

const identity: AppIdentity = {
  appId: APP_ID,
  displayName: "Field Log",
  theme: session().theme,
};

function renderDetail(
  vm = selectRecordDetailVm(table(), detail()),
  onOpenActions = vi.fn(),
): Promise<unknown> {
  return render(
    <RecordDetailScreen
      app={identity}
      editHref={`#/app/${APP_ID}/t/${TABLE_ID}/r/record-1/edit`}
      nav={nav}
      onOpenActions={onOpenActions}
      recordsHref={`#/app/${APP_ID}/t/${TABLE_ID}`}
      vm={vm}
    />,
  );
}

describe("SCR-027 — one record, read", () => {
  it("renders every field in schema order with its typed value", async () => {
    await renderDetail();

    const labels = queryAll("dt").map((node) => node.textContent);
    expect(labels).toEqual([
      "Visit ID",
      "Visit date",
      "Site",
      "Status",
      "Quoted amount",
      "Follow up",
      "Contact phone",
      "Contact email",
      "Site page",
    ]);

    const screen = query('[data-screen="SCR-027"]');
    expect(screen.textContent).toContain("Alder Court");
    expect(screen.textContent).toContain("In progress");
    // A boolean reads as a word, not as "false".
    expect(screen.textContent).toContain("No");
  });

  it("keeps the imported value that did not fit, and says why (FR-6)", async () => {
    await renderDetail();

    const amount = query(`[data-field="${FIELD_IDS.amount}"]`);
    expect(amount.textContent).toContain("TBD");
    expect(amount.textContent).toContain(
      "This value came in from the import unchanged and does not fit the field.",
    );
    expect(query('[data-severity="warning"]')).toBeTruthy();
  });

  it("hands a phone, an email and a web address to the device", async () => {
    await renderDetail();

    const hrefs = queryAll("a").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("tel:5550101017");
    expect(hrefs).toContain("mailto:alder-court17@example.org");
    expect(hrefs).toContain("https://example.org/sites/alder-court");
  });

  it("builds the maps handoff from the query the model refused to turn into a URL", () => {
    // M37 gives `{kind:'maps', query}` and no href; record-edit.html's own
    // handoff is what this spells.
    expect(mapsHref("730 N Franklin St, Chicago, IL")).toBe(
      "https://maps.apple.com/?q=730%20N%20Franklin%20St%2C%20Chicago%2C%20IL",
    );
  });

  it("renders no relationships section for a value-only app (D25)", async () => {
    await renderDetail();

    const screen = query('[data-screen="SCR-027"]');
    expect(screen.textContent).not.toContain("Related records");
    expect(screen.textContent).not.toContain("Belongs to");
    expect(screen.textContent).not.toContain("Missing related record");
  });

  it("opens SHT-010 from a control in the thumb zone", async () => {
    const onOpenActions = vi.fn();
    await renderDetail(undefined, onOpenActions);

    const actions = queryAll("button").find(
      (button) => button.textContent === "Record actions…",
    );
    expect(actions).toBeTruthy();
    await interact(() => {
      actions?.click();
    });
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a write only when the route hands it a confirmed sentence", async () => {
    await renderDetail();
    expect(
      queryAll('[data-tone="success"]').map((node) => node.textContent),
    ).toEqual([]);

    await render(
      <RecordDetailScreen
        app={identity}
        editHref="#/edit"
        nav={nav}
        notice="Saved on this device."
        onOpenActions={vi.fn()}
        recordsHref="#/records"
        vm={selectRecordDetailVm(table(), detail())}
      />,
    );
    expect(query('[data-tone="success"]').textContent).toContain(
      "Saved on this device.",
    );
  });
});
