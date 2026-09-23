import { describe, expect, it } from "vitest";
import { StructureRoute } from "../../../../src/routes/schema-routes.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render, settle, typeInto } from "../render.js";
import { IDS, preview, structure } from "./fixtures.js";
import { button, choose, dialog, fakeSchema, press, wiring } from "./harness.js";

/**
 * The live-calculation editor and MOD-015 (S06 CP3; D58, CAP-28/29/30): a
 * calculation is written in the app's own names and counted by the worker; a
 * parse or name error stays beside the text at its position, and only a
 * translatable calculation reaches MOD-014.
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

function previews(schema: ReturnType<typeof fakeSchema>): unknown[] {
  return (schema.previewSchemaChange as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => (call[0] as { change: unknown }).change);
}

function input(label: string): HTMLInputElement {
  const found = queryAll("label, span")
    .filter((candidate) => candidate.textContent === label)
    .map((candidate) => candidate.parentElement?.querySelector("input") ?? null)
    .find((candidate) => candidate !== null);
  if (found === undefined || found === null) throw new Error(`No input labelled ${label}`);
  return found;
}

describe("the live-calculation editor", () => {
  it("adds a computed column in the app's own names, and counts it in MOD-014", async () => {
    const schema = fakeSchema({ previews: [preview("save-formula")] });
    await open(schema);
    await press("Add a live calculation");
    await typeInto(input("Column name"), "Balance due");
    await typeInto(input("Calculation"), "[Quoted]-[Paid]");
    await press("Preview impact");
    await settle();
    expect(previews(schema)).toEqual([
      {
        kind: "save-formula",
        formulaId: null,
        target: { kind: "computed-column", tableId: IDS.jobs, fieldId: null, newField: { displayName: "Balance due", type: { kind: "number" } } },
        displayName: null,
        text: "[Quoted]-[Paid]",
      },
    ]);
    expect(queryAll('[data-editor="formula"]')).toHaveLength(0);
    expect(query('[data-dialog="MOD-014"]').textContent).toContain("Every record gets a result from this calculation.");
  });

  it("keeps a name or syntax error beside the text, at its position, and opens no MOD-014", async () => {
    const schema = fakeSchema({
      previews: [preview("save-formula", {}, { refusal: { kind: "formula", reason: "unknown-name", detail: "Qoted", position: 1 } })],
    });
    await open(schema);
    await press("Add a live calculation");
    await typeInto(input("Column name"), "Balance due");
    await typeInto(input("Calculation"), "[Qoted]-[Paid]");
    await press("Preview impact");
    await settle();
    expect(query('[data-editor="formula"]').textContent).toContain(
      "Sheaf does not know the name “Qoted” in this app. Look near character 2.",
    );
    expect(queryAll('[data-dialog="MOD-014"]')).toHaveLength(0);
    // The text the person wrote is still there to correct.
    expect(input("Calculation").value).toBe("[Qoted]-[Paid]");
  });

  it("adds a table metric with its own name", async () => {
    const schema = fakeSchema({ previews: [preview("save-formula")] });
    await open(schema);
    await press("Add a live calculation");
    await choose("What to calculate", "table-metric");
    await typeInto(input("Name"), "Total paid");
    await typeInto(input("Calculation"), "SUM(Jobs[Paid])");
    await press("Preview impact");
    await settle();
    expect(previews(schema)).toEqual([
      { kind: "save-formula", formulaId: null, target: { kind: "table-metric", tableId: IDS.jobs }, displayName: "Total paid", text: "SUM(Jobs[Paid])" },
    ]);
  });

  it("edits a computed column's calculation from its field, starting from the rendered text", async () => {
    const schema = fakeSchema({ previews: [preview("save-formula", { formulaErrors: 1 })] });
    await open(schema, IDS.balance);
    await press("Edit calculation");
    expect(input("Calculation").value).toBe("[Quoted]-[Paid]");
    await typeInto(input("Calculation"), "[Quoted]-[Paid]-10");
    await press("Preview impact");
    await settle();
    expect(previews(schema)).toEqual([
      {
        kind: "save-formula",
        formulaId: IDS.balanceFormula,
        target: { kind: "computed-column", tableId: IDS.jobs, fieldId: IDS.balance, newField: null },
        displayName: null,
        text: "[Quoted]-[Paid]-10",
      },
    ]);
    expect(dialog().textContent).toContain("1 record gets an error from this calculation.");
  });

  it("removes a calculation through the same preview", async () => {
    const schema = fakeSchema({ previews: [preview("remove-formula")] });
    await open(schema);
    await press("Remove Total quoted");
    await settle();
    expect(previews(schema)).toEqual([{ kind: "remove-formula", formulaId: IDS.metricFormula }]);
  });
});

describe("MOD-015 — rewriting an unsupported formula", () => {
  const unsupported = structure({
    formulas: structure().formulas.map((formula) =>
      formula.formulaId === IDS.balanceFormula
        ? { ...formula, text: "=CUBEVALUE(\"Sales\",[Quoted])", disposition: "unsupported" as const, determinism: "unsupported" as const }
        : formula,
    ),
  });

  it("says the original text, the kept values and the empty new rows before the rewrite", async () => {
    await open(fakeSchema({ structure: unsupported }));
    await press("Rewrite Balance");
    const mod = query('[data-dialog="MOD-015"]');
    expect(dialog().textContent).toContain("Rewrite Balance");
    expect(mod.querySelector("code")?.textContent).toBe("=CUBEVALUE(\"Sales\",[Quoted])");
    expect(mod.textContent).toContain("Each imported record keeps the value the workbook held. Nothing is recalculated over it.");
    expect(mod.textContent).toContain("A record added here stays empty and flagged, because Sheaf cannot calculate this formula.");
    expect(button("Preview impact").disabled).toBe(true);
  });

  it("previews a rewrite in the supported syntax, then MOD-014 counts it", async () => {
    const schema = fakeSchema({ structure: unsupported, previews: [preview("save-formula")] });
    await open(schema);
    await press("Rewrite Balance");
    await typeInto(input("Rewrite in Sheaf's syntax"), "[Quoted]-[Paid]");
    await press("Preview impact");
    await settle();
    expect(previews(schema)).toEqual([
      {
        kind: "save-formula",
        formulaId: IDS.balanceFormula,
        target: { kind: "computed-column", tableId: IDS.jobs, fieldId: IDS.balance, newField: null },
        displayName: null,
        text: "[Quoted]-[Paid]",
      },
    ]);
    expect(queryAll('[data-dialog="MOD-015"]')).toHaveLength(0);
    expect(queryAll('[data-dialog="MOD-014"]')).toHaveLength(1);
  });
});
