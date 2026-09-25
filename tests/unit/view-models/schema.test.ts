import { describe, expect, it } from "vitest";
import {
  describeSchemaRefusal,
  formulaChangeFor,
  selectAppSettingsVm,
  selectUnsupportedFormulaVm,
  ruleValueFrom,
  selectImpactVm,
  selectStructureVm,
  typeChoicesFor,
  typeLabel,
} from "../../../src/application/view-models/schema.js";
import { IDS, preview, structure } from "../ui/schema/fixtures.js";

/**
 * SCR-035's view model (S06 CP1): tables and fields in order, types in a
 * person's words, computed fields as "Computed · not typed" with their
 * rendered expression, rules as sentences, and nothing the read does not hold.
 */

describe("selectStructureVm", () => {
  it("lists tables in order with their active field counts, and opens the first", () => {
    const vm = selectStructureVm(structure(), { tableId: null, fieldId: null });
    expect(vm.tables.map((table) => [table.name, table.fieldCountLabel, table.isSelected])).toEqual([
      ["Jobs", "8 fields", true],
      ["Customers", "1 field", false],
    ]);
    expect(vm.table?.name).toBe("Jobs");
    expect(vm.field?.name).toBe("Name");
    expect(vm.field?.position).toBe("Jobs · Field 1 of 8");
  });

  it("orders fields by ordinal and tags them in user words, removed ones said so", () => {
    const vm = selectStructureVm(structure(), { tableId: IDS.jobs, fieldId: null });
    expect(vm.table?.fields.map((field) => [field.name, field.tag, field.isActive])).toEqual([
      ["Name", "Text", true],
      ["Start", "Date", true],
      ["Finish by", "Date", true],
      ["Quoted", "Money", true],
      ["Paid", "Number", true],
      ["Status", "Choice", true],
      ["Customer", "Connection", true],
      ["Balance", "Live", true],
      ["Notes", "Text", false],
    ]);
  });

  it("names every type the way schema.html does", () => {
    expect(typeLabel({ kind: "enum" })).toBe("Choice list");
    expect(typeLabel({ kind: "reference" })).toBe("Connection to another table");
    expect(typeLabel({ kind: "currency", currencyCode: "EUR" })).toBe("Money (EUR)");
    expect(typeLabel({ kind: "boolean" })).toBe("Yes or no");
  });

  it("shows a computed field as computed, with its expression in current names", () => {
    const vm = selectStructureVm(structure(), { tableId: IDS.jobs, fieldId: IDS.balance });
    expect(vm.field?.calculation).toMatchObject({
      formulaId: IDS.balanceFormula,
      text: "[Quoted]-[Paid]",
      badge: "Computed · not typed",
      disposition: "live",
    });
    expect(vm.table?.metrics.map((metric) => [metric.name, metric.text])).toEqual([["Total quoted", "SUM(Jobs[Quoted])"]]);
  });

  it("keeps choices in their order, the removed one included, and names no counts", () => {
    const vm = selectStructureVm(structure(), { tableId: IDS.jobs, fieldId: IDS.status });
    expect(vm.field?.options).toEqual([
      { optionId: "opt-scheduled", label: "Scheduled", isActive: true },
      { optionId: "opt-complete", label: "Complete", isActive: true },
      { optionId: "opt-old", label: "Cancelled", isActive: false },
    ]);
  });

  it("says why Sheaf chose a detected connection, and nothing for one the person made", () => {
    const detected = selectStructureVm(structure(), { tableId: IDS.jobs, fieldId: IDS.customer });
    expect(detected.field?.connection).toMatchObject({
      toTableName: "Customers",
      evidence: "This field's values match the key of Customers.",
    });
    const made = structure({
      relationships: structure().relationships.map((relationship) => ({ ...relationship, detectionSource: "user" as const })),
    });
    expect(selectStructureVm(made, { tableId: IDS.jobs, fieldId: IDS.customer }).field?.connection?.evidence).toBeNull();
  });

  it("says a rule as its sentence in the app's current names", () => {
    const vm = selectStructureVm(structure(), { tableId: IDS.jobs, fieldId: null });
    expect(vm.table?.rules).toEqual([
      expect.objectContaining({
        sentence: "Finish by is on or after Start",
        severityNote: "A save that breaks this rule is refused.",
        isEditable: true,
      }),
    ]);
  });

  it("falls back to the first table when the chosen one is gone", () => {
    const vm = selectStructureVm(structure(), { tableId: "table-renamed-away", fieldId: "gone" });
    expect(vm.table?.tableId).toBe(IDS.jobs);
    expect(vm.field?.fieldId).toBe(IDS.name);
  });
});

describe("selectImpactVm (MOD-014, CA-28)", () => {
  it("states an unchanged preview without claiming an effect", () => {
    const vm = selectImpactVm({ change: { kind: "set-required", fieldId: IDS.paid, isRequired: false },
      preview: preview("set-required", {}, { eventCount: 0 }), structure: structure(), wasStale: false });
    expect(vm.counts).toEqual(["No changes to save."]);
    expect(vm.blocker).toBeNull();
  });
  it("says the counts that matter for the change, in exact numbers", () => {
    const vm = selectImpactVm({
      change: { kind: "change-field-type", fieldId: IDS.paid, type: { kind: "text" } },
      preview: preview("change-field-type", { converted: 1, keptAndFlagged: 1, unchanged: 3 }),
      structure: structure(),
      wasStale: false,
    });
    expect(vm).toEqual({
      title: "Change Paid to Text",
      counts: [
        "1 value converts to Text.",
        "1 value does not fit and is kept as it was, flagged for review.",
        "3 records need no change.",
      ],
      preservation: "Sheaf keeps every existing value. Nothing is discarded.",
      applyLabel: "Apply and flag",
      blocker: null,
      staleNote: null,
    });
  });

  it("blocks apply for a refusal or a too-large change, and marks a re-counted preview", () => {
    const change = { kind: "rename-field", fieldId: IDS.paid, name: "" } as const;
    const refused = selectImpactVm({
      change,
      preview: preview("rename-field", {}, { refusal: { kind: "formula", reason: "unknown-name", detail: "Qoted", position: 1 } }),
      structure: structure(),
      wasStale: true,
    });
    expect(refused.blocker).toBe("Sheaf does not know the name “Qoted” in this app.");
    // A refused change was not counted, so no count is shown.
    expect(refused.counts).toEqual([]);
    expect(refused.staleNote).toBe("This app changed on this device after the last preview. These are the counts now.");
    const large = selectImpactVm({ change, preview: preview("rename-field", {}, { isTooLarge: true, eventCount: 10_001 }), structure: structure(), wasStale: false });
    expect(large.blocker).toContain("10001 changes at once");
  });

  it("names every refusal in plain words", () => {
    expect(describeSchemaRefusal({ kind: "unknown-subject", subject: "relationship" })).toBe("That connection is no longer in this app.");
    expect(describeSchemaRefusal({ kind: "invalid-change", reason: "target-has-no-key" })).toContain("has no key");
    expect(describeSchemaRefusal({ kind: "validation", recordCount: 3 })).toBe("After this change 3 records would fail the app's rules, so it cannot be applied.");
    expect(describeSchemaRefusal({ kind: "formula", reason: "cell-reference", detail: "A1", position: 0 })).toContain("square brackets");
    // S03 refuses Text → Choice list with no choices named: said, not "inconsistent".
    expect(
      describeSchemaRefusal({ kind: "transition", refusals: [{ kind: "schema-invalid", fieldId: null, messageKey: "schema.enum-field-without-options" }] }),
    ).toBe("A choice list needs its choices, and this change names none. This change cannot be applied.");
    expect(describeSchemaRefusal({ kind: "transition", refusals: [{ kind: "x", fieldId: null, messageKey: null }] })).toContain("inconsistent (1 problem)");
  });
});

describe("the editors' choices", () => {
  it("offers the kinds a field can change to, keeping a money field's own currency", () => {
    expect(typeChoicesFor({ kind: "text" }).map((choice) => choice.value)).not.toContain("reference");
    expect(typeChoicesFor({ kind: "currency", currencyCode: "USD" })[0]).toEqual({ value: "currency", label: "Money (USD)" });
  });

  it("types a rule's value by the compared field, refusing what does not fit", () => {
    expect(ruleValueFrom("2026-09-23", { kind: "date" })).toEqual({ kind: "date", epochDay: 20719 });
    expect(ruleValueFrom("2026-02-30", { kind: "date" })).toBeNull();
    expect(ruleValueFrom("12.50", { kind: "number" })).toEqual({ kind: "number", decimal: "12.50" });
    expect(ruleValueFrom("1e3", { kind: "currency", currencyCode: "USD" })).toBeNull();
    expect(ruleValueFrom("  open ", { kind: "text" })).toEqual({ kind: "text", text: "open" });
  });
});

describe("CP3: calculations and settings", () => {
  it("names each save-formula target exactly (CA-25)", () => {
    const base = { tableId: IDS.jobs, calculation: null, name: "Due", type: "date" as const, text: "[Start]+30" };
    expect(formulaChangeFor({ ...base, target: "computed-column" })).toEqual({
      kind: "save-formula",
      formulaId: null,
      target: { kind: "computed-column", tableId: IDS.jobs, fieldId: null, newField: { displayName: "Due", type: { kind: "date" } } },
      displayName: null,
      text: "[Start]+30",
    });
    expect(formulaChangeFor({ ...base, target: "dashboard-value" })).toMatchObject({ target: { kind: "dashboard-value", tableId: null }, displayName: "Due" });
  });

  it("says MOD-015's three facts for an unsupported column", () => {
    const [balance] = selectStructureVm(structure(), { tableId: IDS.jobs, fieldId: null }).table?.calculations ?? [];
    expect(balance?.name).toBe("Balance");
    const vm = selectUnsupportedFormulaVm({ ...balance!, disposition: "unsupported" });
    expect(vm.newRowSentence).toBe("A record added here stays empty and flagged, because Sheaf cannot calculate this formula.");
  });

  it("states settings facts only once read, and durability from the session", () => {
    const unread = selectAppSettingsVm({ appId: "a", appName: "Field Log", isScratch: true, deviceOnlyChangeCount: 1, structure: null, sheets: null });
    expect(unread.structureSummary).toBeNull();
    expect(unread.snapshotsSummary).toBeNull();
    expect(unread.durabilityDetail).toBe(
      "Field Log has no durable home. 1 change only on this device.",
    );
    const read = selectAppSettingsVm({ appId: "a", appName: "Field Log", isScratch: false, deviceOnlyChangeCount: 0, structure: structure(), sheets: [] });
    expect(read.structureSummary).toBe("2 tables · 9 fields · 1 relationship");
    expect(read.snapshotsSummary).toBe("0 sheets · 0 inert items");
    expect(read.durabilityTitle).toBe("0 changes only on this device.");
  });
});
