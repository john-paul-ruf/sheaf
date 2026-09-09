import { describe, expect, it, vi } from "vitest";
import {
  selectChangeHistoryVm,
  selectRestoreRecordDialogVm,
} from "../../../../src/application/view-models/records.js";
import { ChangeHistoryScreen } from "../../../../src/ui/records/change-history-screen.js";
import { RestoreRecordDialog } from "../../../../src/ui/records/restore-record-dialog.js";
import type {
  AppIdentity,
  AppNavigation,
} from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";
import {
  APP_ID,
  FIELD_IDS,
  TABLE_ID,
  historyEntry,
  historyPage,
  session,
  table,
} from "./fixtures.js";

/**
 * SCR-032 and MOD-010 as rendered (CAP-17, D22).
 *
 * The claim that matters most is a *copy* claim: the log is what happened
 * since the last checkpoint, so a freshly imported app's empty log is correct
 * and nothing may call this "the app's history".
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

const fieldNames = new Map(
  table().fields.map((field) => [field.fieldId, field.displayName]),
);

function renderHistory(
  page = historyPage(),
  onRestore: (entry: { readonly eventId: string }) => void = vi.fn(),
): Promise<unknown> {
  return render(
    <ChangeHistoryScreen
      app={identity}
      fieldNames={fieldNames}
      nav={nav}
      onRestore={onRestore}
      recordHref={(recordId) =>
        `#/app/${APP_ID}/t/${TABLE_ID}/r/${recordId}`
      }
      vm={selectChangeHistoryVm(page)}
    />,
  );
}

describe("SCR-032 — the log says what it is the log of", () => {
  it("states the checkpoint scope, and never claims to be the whole history", async () => {
    await renderHistory();

    const screen = query('[data-screen="SCR-032"]');
    expect(screen.textContent).toContain(
      "since this app was last checkpointed",
    );
    expect(screen.textContent).not.toContain("the app's history");
    expect(screen.textContent).not.toContain("Every change since");
  });

  it("says an imported app's empty log is correct, not broken", async () => {
    await renderHistory(historyPage({ entries: [] }));

    const empty = query('[data-empty="no-changes"]');
    expect(empty.textContent).toContain(
      "No changes since this app was last checkpointed.",
    );
    expect(empty.textContent).toContain(
      "The rows this app was imported with are not changes",
    );
  });

  it("names the event, when it happened, and which fields moved", async () => {
    await renderHistory();

    const entry = query("[data-event]");
    expect(entry.textContent).toContain("Record changed");
    expect(entry.textContent).toContain("Status");
    expect(entry.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(1_757_000_100_000).toISOString(),
    );
    // A log listing names fields, never values.
    expect(entry.textContent).not.toContain("In progress");
  });

  it("offers a restore exactly where one is possible", async () => {
    const onRestore = vi.fn();
    await renderHistory(
      historyPage({
        entries: [
          historyEntry(),
          historyEntry({
            eventId: "event-2",
            eventKind: "record.deleted",
            isRestorable: true,
            changedFieldIds: [],
          }),
        ],
      }),
      onRestore,
    );

    const restores = queryAll("button").filter(
      (button) => button.textContent === "Restore record…",
    );
    expect(restores).toHaveLength(1);

    // The deleted record has no current value, so the only way back to it is
    // the restore — not a link to a record that is not there.
    const openLinks = queryAll("a").filter(
      (link) => link.textContent === "Open this record",
    );
    expect(openLinks).toHaveLength(1);

    await interact(() => {
      restores[0]?.click();
    });
    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-2" }),
    );
  });

  it("pages, and only offers to when there is more", async () => {
    const showMore = vi.fn();
    await render(
      <ChangeHistoryScreen
        app={identity}
        fieldNames={fieldNames}
        nav={nav}
        onRestore={vi.fn()}
        onShowMore={showMore}
        vm={selectChangeHistoryVm(
          historyPage({
            hasMore: true,
            nextCursor: {
              wallTimeMs: 1_757_000_100_000,
              logicalCounter: 2,
              eventId: "event-1",
            },
          }),
        )}
      />,
    );

    const older = queryAll("button").find(
      (button) => button.textContent === "Show older changes",
    );
    expect(older).toBeTruthy();
    older?.click();
    expect(showMore).toHaveBeenCalledTimes(1);
  });

  it("names an unknown field id rather than dropping the line", async () => {
    await renderHistory(
      historyPage({
        entries: [historyEntry({ changedFieldIds: ["field-gone"] })],
      }),
    );
    expect(query("[data-event]").textContent).toContain(
      "a field this app no longer has",
    );
  });
});

describe("MOD-010 — restore, with what is actually known", () => {
  it("shows when it was deleted and what will be checked", async () => {
    const vm = selectRestoreRecordDialogVm(
      {
        ...historyEntry({
          eventKind: "record.deleted",
          isRestorable: true,
        }),
        changedFieldIds: [FIELD_IDS.status],
      },
      false,
    );
    await render(
      <RestoreRecordDialog
        isOpen
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        vm={vm}
      />,
    );

    const dialog = query("[role='alertdialog']");
    expect(dialog.textContent).toContain("Restore this record?");
    expect(dialog.textContent).toContain("Deleted ");
    expect(dialog.textContent).toContain(
      "Restore validates against the current schema before writing a new append-only event.",
    );
  });

  it("cannot be confirmed twice while it is being written", async () => {
    const onConfirm = vi.fn();
    await render(
      <RestoreRecordDialog
        isOpen
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        vm={selectRestoreRecordDialogVm(historyEntry(), true)}
      />,
    );

    const confirm = queryAll("button").find(
      (button) => button.textContent === "Restore record",
    );
    expect(confirm?.hasAttribute("disabled")).toBe(true);
    expect(query("[role='alertdialog']").textContent).toContain(
      "This restore is being written to this device.",
    );
  });
});
