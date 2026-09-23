import { describe, expect, it } from "vitest";
import { selectStructureVm, typeLabel } from "../../../src/application/view-models/schema.js";
import { IDS, structure } from "../ui/schema/fixtures.js";

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
