import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { StructureRoute } from "../../../../src/routes/schema-routes.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render, settle, typeInto } from "../render.js";
import { IDS, preview } from "./fixtures.js";
import { appliedOutcome, button, choose, dialog, fakeSchema, press, wiring } from "./harness.js";

/**
 * SCR-035's editors through the real route, against a fake worker edge
 * (S06 CP2; CA-28 consumer): every editor → preview → MOD-014 with the exact
 * counts → apply naming the previewed revision. A stale preview is counted
 * again and shown, never applied blindly; a change too large for one commit
 * cannot be applied, and says why.
 */

async function open(schema = fakeSchema(), fieldId?: string) {
  const area = wiring(schema);
  await render(<StructureRoute area={area} clearNotice={() => undefined} />);
  await settle();
  if (fieldId !== undefined) {
    await interact(() => {
      query<HTMLButtonElement>(`[data-structure-field="${fieldId}"]`).click();
    });
  }
  return area;
}

function sent(schema: ReturnType<typeof fakeSchema>, method: "previewSchemaChange" | "applySchemaChange"): unknown[] {
  return (schema[method] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0]);
}

describe("a type change (CA-28, D57)", () => {
  it("previews the exact counts, then applies at the previewed revision and says so after", async () => {
    const schema = fakeSchema({
      previews: [preview("change-field-type", { converted: 3, keptAndFlagged: 2, unchanged: 0 })],
      outcomes: [appliedOutcome()],
    });
    const area = await open(schema, IDS.paid);
    await choose("What kind of information?", "text");
    await press("Change type");
    await settle();

    const change = { kind: "change-field-type", fieldId: IDS.paid, type: { kind: "text" } };
    expect(sent(schema, "previewSchemaChange")).toEqual([{ appId: "app-field-log", change }]);
    const mod = query('[data-dialog="MOD-014"]');
    expect(dialog().textContent).toContain("Change Paid to Text");
    expect(mod.textContent).toContain("3 values convert to Text.");
    expect(mod.textContent).toContain("2 values do not fit and are kept as they were, flagged for review.");
    expect(mod.textContent).toContain("Sheaf keeps every existing value. Nothing is discarded.");
    // Nothing is said before the commit.
    expect(area.announce).not.toHaveBeenCalled();

    await press("Apply and flag");
    await settle();
    expect(sent(schema, "applySchemaChange")).toEqual([{ appId: "app-field-log", change, previewedSchemaRevision: 4 }]);
    expect(area.announce).toHaveBeenCalledWith("Saved on this device.", []);
    expect(area.refresh).toHaveBeenCalledTimes(1);
    expect(queryAll('[data-dialog="MOD-014"]')).toHaveLength(0);
  });

  it("re-previews a stale preview and shows the new counts; nothing is applied blindly", async () => {
    const schema = fakeSchema({
      previews: [
        preview("change-field-type", { converted: 3, keptAndFlagged: 2 }),
        preview("change-field-type", { converted: 4, keptAndFlagged: 1 }, { schemaRevision: 6 }),
      ],
      outcomes: [{ result: "stale-preview", schemaRevision: 6 }, appliedOutcome()],
    });
    const area = await open(schema, IDS.paid);
    await choose("What kind of information?", "text");
    await press("Change type");
    await settle();
    await press("Apply and flag");
    await settle();

    expect(sent(schema, "previewSchemaChange")).toHaveLength(2);
    expect(area.announce).not.toHaveBeenCalled();
    const mod = query('[data-dialog="MOD-014"]');
    expect(mod.textContent).toContain("This app changed on this device after the last preview. These are the counts now.");
    expect(mod.textContent).toContain("4 values convert to Text.");
    expect(mod.textContent).toContain("1 value does not fit and is kept as it was, flagged for review.");

    await press("Apply and flag");
    await settle();
    const applies = sent(schema, "applySchemaChange") as { previewedSchemaRevision: number }[];
    expect(applies.map((request) => request.previewedSchemaRevision)).toEqual([4, 6]);
    expect(area.announce).toHaveBeenCalledTimes(1);
  });

  it("disables apply for a change too large for one commit, with the reason", async () => {
    const schema = fakeSchema({ previews: [preview("change-field-type", { converted: 20_000 }, { isTooLarge: true, eventCount: 20_001 })] });
    await open(schema, IDS.paid);
    await choose("What kind of information?", "text");
    await press("Change type");
    await settle();
    const apply = button("Apply");
    expect(apply.disabled).toBe(true);
    expect(dialog().textContent).toContain("This change would write 20001 changes at once, more than one save holds on this device, so it cannot be applied.");
    expect(sent(schema, "applySchemaChange")).toEqual([]);
  });

  it("disables apply for a refused change, with the refusal in words", async () => {
    const schema = fakeSchema({
      previews: [preview("rename-field", {}, { refusal: { kind: "invalid-change", reason: "empty-name" } })],
    });
    await open(schema, IDS.paid);
    await typeInto(query<HTMLInputElement>("#structure-field-name"), "Amount paid");
    await press("Rename field");
    await settle();
    expect(button("Apply").disabled).toBe(true);
    expect(dialog().textContent).toContain("A name cannot be empty.");
  });

  it("says a too-large apply outcome in the dialog, and leaves it open", async () => {
    const schema = fakeSchema({
      previews: [preview("change-field-type", { converted: 3 })],
      outcomes: [{ result: "too-large", eventCount: 12_000, byteLength: 1, maxEvents: 10_000, maxBytes: 1 }],
    });
    const area = await open(schema, IDS.paid);
    await choose("What kind of information?", "text");
    await press("Change type");
    await settle();
    await press("Apply");
    await settle();
    expect(query('[data-dialog="MOD-014"] [role="alert"]').textContent).toBe(
      "This change would write 12000 changes at once, more than the 10000 one save holds on this device, so nothing was applied.",
    );
    expect(area.announce).not.toHaveBeenCalled();
  });
});

describe("MOD-014 as a dialog", () => {
  it("takes focus, gives it back to the control that opened it, and passes axe", async () => {
    const schema = fakeSchema({ previews: [preview("rename-field")] });
    await open(schema, IDS.paid);
    await typeInto(query<HTMLInputElement>("#structure-field-name"), "Amount paid");
    const invoker = button("Rename field");
    await press("Rename field");
    await settle();
    expect(dialog().contains(document.activeElement)).toBe(true);

    const results = await axe.run(dialog(), { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await interact(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(queryAll('[data-dialog="MOD-014"]')).toHaveLength(0);
    expect(document.activeElement).toBe(invoker);
    expect(sent(schema, "applySchemaChange")).toEqual([]);
  });
});

describe("the other field editors", () => {
  it("required: counts the records with no value", async () => {
    const schema = fakeSchema({ previews: [preview("set-required", { missingNow: 2 })] });
    await open(schema, IDS.start);
    await press("Make required");
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      { appId: "app-field-log", change: { kind: "set-required", fieldId: IDS.start, isRequired: true } },
    ]);
    expect(dialog().textContent).toContain("2 records have no Start. They are kept and flagged.");
  });

  it("choices: rename, remove, reorder and add keep option ids, and count records on a removed one", async () => {
    const schema = fakeSchema({ previews: [preview("set-enum-options", { onRemovedOptions: 1 })] });
    await open(schema, IDS.status);
    await typeInto(query<HTMLInputElement>('[data-option="opt-scheduled"] input'), "Booked");
    await press("Remove Complete");
    await press("Move Booked down");
    await typeInto(queryAll<HTMLInputElement>('[data-editor="choices"] input').at(-1) as HTMLInputElement, "On hold");
    await press("Add choice");
    await press("Review choice changes");
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      {
        appId: "app-field-log",
        change: {
          kind: "set-enum-options",
          fieldId: IDS.status,
          options: [
            { optionId: "opt-complete", label: "Complete", isActive: false },
            { optionId: "opt-scheduled", label: "Booked", isActive: true },
            { optionId: "opt-old", label: "Cancelled", isActive: false },
            { optionId: null, label: "On hold", isActive: true },
          ],
        },
      },
    ]);
    expect(dialog().textContent).toContain("1 record holds a removed choice. It is kept and flagged.");
  });

  it("connection: converting a text field counts matched and unmatched keys (D64)", async () => {
    const schema = fakeSchema({ previews: [preview("set-relationship", { matchedKeys: 3, unmatchedKeys: 2 })] });
    await open(schema, IDS.name);
    await press("Review connection");
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      {
        appId: "app-field-log",
        change: { kind: "set-relationship", relationshipId: null, fromFieldId: IDS.name, toTableId: IDS.customers, isActive: true },
      },
    ]);
    expect(dialog().textContent).toContain("Connect Name to Customers");
    expect(dialog().textContent).toContain("3 values match a record and become connections.");
    expect(dialog().textContent).toContain("2 values match no record and are kept as they were, flagged for review.");
  });

  it("connection: removing keeps values and says re-detection stays off (FR-7)", async () => {
    const schema = fakeSchema({ previews: [preview("remove-relationship", { unlinkedReferences: 4 })] });
    await open(schema, IDS.customer);
    await press("Remove connection");
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      { appId: "app-field-log", change: { kind: "remove-relationship", relationshipId: IDS.relationship } },
    ]);
    expect(dialog().textContent).toContain("4 connections stop linking; their values are kept.");
    expect(dialog().textContent).toContain("Sheaf will not suggest this connection again.");
  });

  it("key: a duplicate key value is counted and kept, not refused (decision 10:05)", async () => {
    const schema = fakeSchema({ previews: [preview("set-table-key", { keptAndFlagged: 2 })] });
    await open(schema, IDS.name);
    await press("Use as the key");
    await settle();
    expect(dialog().textContent).toContain("Make Name the key of Jobs");
    expect(dialog().textContent).toContain("2 records share a key value with another record. They are kept as they are.");
    expect(button("Apply").disabled).toBe(false);
  });

  it("table: renames through the same preview", async () => {
    const schema = fakeSchema({ previews: [preview("rename-table")] });
    await open(schema);
    await typeInto(query<HTMLInputElement>("#structure-table-name"), "Work orders");
    await press("Rename table");
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      { appId: "app-field-log", change: { kind: "rename-table", tableId: IDS.jobs, name: "Work orders" } },
    ]);
    expect(dialog().textContent).toContain("Rename Jobs to “Work orders”");
  });
});

describe("SHT-014 — the field actions", () => {
  it("offers rename, type, connection and remove — removal said truthfully", async () => {
    const schema = fakeSchema({ previews: [preview("deactivate-field")] });
    await open(schema, IDS.paid);
    await press("Field actions");
    const sheet = query('[data-sheet="SHT-014"]');
    expect([...sheet.querySelectorAll("strong")].map((label) => label.textContent)).toEqual([
      "Rename",
      "Change type",
      "Connection",
      "Remove field",
      "Rename Jobs",
    ]);
    expect(sheet.textContent).not.toContain("Delete");
    await interact(() => {
      query<HTMLButtonElement>('[data-action="remove"]').click();
    });
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      { appId: "app-field-log", change: { kind: "deactivate-field", fieldId: IDS.paid } },
    ]);
    expect(dialog().textContent).toContain("5 records keep their values for this field; it is no longer shown or asked for.");
  });

  it("offers a computed field's calculation instead of its type, and removes it by removing the formula", async () => {
    const schema = fakeSchema({ previews: [preview("remove-formula")] });
    await open(schema, IDS.balance);
    await press("Field actions");
    const labels = [...query('[data-sheet="SHT-014"]').querySelectorAll("strong")].map((label) => label.textContent);
    expect(labels).toContain("Live calculation");
    expect(labels).not.toContain("Change type");
    await interact(() => {
      query<HTMLButtonElement>('[data-action="remove"]').click();
    });
    await settle();
    expect(sent(schema, "previewSchemaChange")).toEqual([
      { appId: "app-field-log", change: { kind: "remove-formula", formulaId: IDS.balanceFormula } },
    ]);
    expect(dialog().textContent).toContain("The calculation stops. No calculated value is stored in its place.");
  });
});

describe("rules across fields (CA-27, D52)", () => {
  it("builds a structured clause, previews its failing count, and applies", async () => {
    const schema = fakeSchema({ previews: [preview("save-rule", { failingRule: 2 })], outcomes: [appliedOutcome()] });
    await open(schema);
    await press("Add rule");
    const editor = query('[data-editor="rule"]');
    // Structured clauses only: no free-text rule box, by contract.
    expect(editor.querySelectorAll("textarea")).toHaveLength(0);
    await choose("Field to check", IDS.finish);
    await choose("Other field", IDS.start);
    expect(query("[data-rule-sentence]").textContent).toBe("Finish by is on or after Start");
    await press("Preview impact");
    await settle();

    expect(sent(schema, "previewSchemaChange")).toEqual([
      {
        appId: "app-field-log",
        change: {
          kind: "save-rule",
          ruleId: null,
          tableId: IDS.jobs,
          displayName: "Finish by is on or after Start",
          condition: { kind: "compare", left: IDS.finish, op: "ge", right: { field: IDS.start } },
          severity: "blocking",
        },
      },
    ]);
    expect(dialog().textContent).toContain("2 current records fail this rule.");
    await press("Apply");
    await settle();
    expect(sent(schema, "applySchemaChange")).toHaveLength(1);
  });

  it("compares with a typed value, and waits for a value of the field's kind", async () => {
    const schema = fakeSchema({ previews: [preview("save-rule")] });
    await open(schema);
    await press("Add rule");
    await choose("Field to check", IDS.paid);
    await choose("Must be", "le");
    await choose("Compared with", "value");
    await typeInto(query<HTMLInputElement>('[data-editor="rule"] input'), "ten");
    expect(button("Preview impact").disabled).toBe(true);
    expect(dialog().textContent).toContain("Enter a value: A number, written with a point for decimals.");
    await typeInto(query<HTMLInputElement>('[data-editor="rule"] input'), "1500.50");
    expect(query("[data-rule-sentence]").textContent).toBe("Paid is at most 1500.50");
    await press("Preview impact");
    await settle();
    expect((sent(schema, "previewSchemaChange")[0] as { change: { condition: unknown } }).change.condition).toEqual({
      kind: "compare",
      left: IDS.paid,
      op: "le",
      right: { value: { kind: "number", decimal: "1500.50" } },
    });
  });

  it("edits a saved rule from its own clause, and removes one", async () => {
    const schema = fakeSchema({ previews: [preview("save-rule"), preview("remove-rule")] });
    await open(schema);
    await press("Edit rule 1");
    expect(query("[data-rule-sentence]").textContent).toBe("Finish by is on or after Start");
    await choose("When a record breaks it", "warning");
    await press("Preview impact");
    await settle();
    expect(sent(schema, "previewSchemaChange")[0]).toMatchObject({ change: { kind: "save-rule", ruleId: IDS.rule, severity: "warning" } });
    await press("Cancel");
    await settle();
    await press("Remove rule 1");
    await settle();
    expect(sent(schema, "previewSchemaChange")[1]).toEqual({ appId: "app-field-log", change: { kind: "remove-rule", ruleId: IDS.rule } });
    expect(dialog().textContent).toContain("Remove the rule “Finish by is on or after Start”");
  });
});
