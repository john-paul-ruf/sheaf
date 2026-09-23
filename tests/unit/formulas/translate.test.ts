import { describe, expect, it } from "vitest";
import {
  IMPORT_UNSUPPORTED_REASONS,
  parseFormula,
  relativeShapeKey,
  translateAuthored,
  translateImported,
  translateImportedText,
  type FormulaAstV1,
  type TranslationV1,
} from "../../../src/domain/formulas/index.js";
import {
  authoredResolver,
  CUSTOMER,
  CUSTOMER_NAME,
  CUSTOMERS,
  importResolver,
  JOBS,
  JOBS_TO_CUSTOMERS,
  PAID,
  QUOTED,
  TOTAL_PAID,
  TOTAL_QUOTED,
} from "./fixtures.js";

const ast = (text: string): FormulaAstV1 => {
  const parsed = parseFormula(text);
  if (parsed.kind !== "parsed") throw new Error(`fixture did not parse: ${text}`);
  return parsed.ast;
};

const imported = (text: string, overrides: Parameters<typeof importResolver>[0] = {}): TranslationV1 =>
  translateImported(ast(text), importResolver(overrides));

const rootOf = (translation: TranslationV1 | ReturnType<typeof translateAuthored>) => {
  if (translation.kind !== "translated") throw new Error(`not translated: ${JSON.stringify(translation)}`);
  return translation.document.root;
};

const decimal = (text: string) => ({ kind: "literal", value: { kind: "decimal", decimal: text } });

describe("translateImported", () => {
  it("turns E2-F2 on row 2 of the Jobs region into Quoted minus Paid on this row", () => {
    const translation = imported("=E2-F2");
    expect(rootOf(translation)).toEqual({
      kind: "binary",
      operator: "-",
      left: { kind: "field", fieldId: QUOTED },
      right: { kind: "field", fieldId: PAID },
    });
    expect(translation.kind === "translated" && translation.dependencies).toEqual([
      { kind: "field", fieldId: QUOTED },
      { kind: "field", fieldId: PAID },
    ]);
  });

  it("names no address, sheet or user name anywhere in the IR", () => {
    const text = JSON.stringify(rootOf(imported("=IF(E2>0,(E2-F2)/E2,0)")), (_, value: unknown) =>
      value instanceof Uint8Array ? "<id>" : value,
    );
    expect(text).not.toMatch(/Jobs|E2|F2|Quoted|Paid/);
  });

  it("turns the demo VLOOKUP into a related field only through an accepted relationship", () => {
    expect(rootOf(imported("=VLOOKUP(B2,Customers!A:B,2,FALSE)"))).toEqual({
      kind: "related",
      relationshipId: JOBS_TO_CUSTOMERS,
      referenceFieldId: CUSTOMER,
      fieldId: CUSTOMER_NAME,
    });
    expect(imported("=VLOOKUP(B2,Customers!A:B,2,FALSE)", { relationshipFrom: () => null })).toEqual({
      kind: "unsupported",
      reason: "unsupported-lookup",
      detail: null,
    });
  });

  it("accepts XLOOKUP and INDEX/MATCH through the relationship and refuses approximate lookups", () => {
    const related = { kind: "related", relationshipId: JOBS_TO_CUSTOMERS, referenceFieldId: CUSTOMER, fieldId: CUSTOMER_NAME };
    expect(rootOf(imported("=XLOOKUP(B2,Customers!A2:A40,Customers!B2:B40)"))).toEqual(related);
    expect(rootOf(imported("=INDEX(Customers[Name],MATCH([@Customer],Customers[ID],0))"))).toEqual(related);
    for (const text of [
      "=VLOOKUP(B2,Customers!A:B,2)",
      "=VLOOKUP(B2,Customers!A:B,2,TRUE)",
      "=VLOOKUP(B2,Customers!B:C,1,FALSE)",
      "=VLOOKUP(E2,Customers!A:B,2,FALSE)",
      "=HLOOKUP(B2,Customers!A1:B2,2,FALSE)",
      "=MATCH(B2,Customers!A:A,0)",
    ]) {
      expect(imported(text), text).toMatchObject({ kind: "unsupported", reason: "unsupported-lookup" });
    }
  });

  it("keeps an external workbook, including [1]!Name, unsupported and unfetched", () => {
    expect(translateImportedText("=[1]!Name", importResolver())).toEqual({
      kind: "unsupported",
      reason: "external-source",
      detail: null,
    });
    expect(translateImportedText("=[1]!Rate*E2", importResolver())).toMatchObject({ reason: "external-source" });
    expect(imported("=[1]Rates!B2*E2")).toMatchObject({ kind: "unsupported", reason: "external-source" });
    expect(translateImportedText('="[1]!x"&(', importResolver())).toMatchObject({ reason: "unparsed" });
  });

  it("turns a column range into a column, and a footer formula cell into a formula node", () => {
    const footer = { row: 61, column: 4, tableId: null };
    expect(rootOf(imported("=SUM(E2:E61)", footer))).toEqual({
      kind: "call",
      name: "SUM",
      version: 1,
      args: [{ kind: "column", tableId: JOBS, fieldId: QUOTED }],
    });
    expect(rootOf(imported("=SUM(E1:E61)", footer))).toMatchObject({ args: [{ kind: "column" }] });
    expect(rootOf(imported("=SUM(E:E)", footer))).toMatchObject({ args: [{ kind: "column" }] });
    expect(rootOf(imported("=SUM(Jobs[Quoted])", footer))).toMatchObject({ args: [{ kind: "column", fieldId: QUOTED }] });
    expect(rootOf(imported("=Summary!B2-Summary!B3", { sheet: "Summary", row: 3, column: 1, tableId: null }))).toEqual({
      kind: "binary",
      operator: "-",
      left: { kind: "formula", formulaId: TOTAL_QUOTED },
      right: { kind: "formula", formulaId: TOTAL_PAID },
    });
  });

  it("refuses every reference that is not stable imported structure, each with its reason", () => {
    const cases: readonly (readonly [string, (typeof IMPORT_UNSUPPORTED_REASONS)[number]])[] = [
      ["=E3-F2", "row-specific-reference"],
      ["=SUM(E5:E9)", "row-specific-reference"],
      ["=SUM(E2:F61)", "multi-column-range"],
      ["=SUM(2:3)", "whole-row-reference"],
      ["=Jobs:Archive!E2", "three-d-reference"],
      ["=Z2", "outside-imported-structure"],
      ["=Rate*E2", "unresolved-name"],
      ["=Jobs[[#Totals],[Quoted]]", "outside-imported-structure"],
      ["=SUM({1,2})", "array-constant"],
      ["=FORECAST(E2,E2:E61,F2:F61)", "unsupported-function"],
      ["=ROUND(E2)", "arity"],
      ["=SUM(E2 F2)", "unsupported-operator"],
      ["=#SPILL!", "unsupported-error-literal"],
      ["=1E40", "number-out-of-range"],
    ];
    for (const [text, reason] of cases) {
      expect(imported(text), text).toMatchObject({ kind: "unsupported", reason });
    }
    expect(imported("=FORECAST(E2,E2:E61,F2:F61)")).toMatchObject({ detail: "FORECAST" });
  });

  it("resolves a defined name through its definition", () => {
    const rate = ast("=Jobs!$E$2:$E$61");
    expect(rootOf(imported("=SUM(Rate)", { tableId: null, definedName: (name) => (name === "Rate" ? rate : null) }))).toMatchObject({
      args: [{ kind: "column", fieldId: QUOTED }],
    });
  });

  it("folds a negated number into one literal and keeps text NFC", () => {
    expect(rootOf(imported("=-5+E2"))).toMatchObject({ left: decimal("-5") });
    expect(rootOf(imported("=-(5)"))).toEqual(decimal("-5"));
    expect(rootOf(imported("=-0"))).toEqual(decimal("0"));
    expect(rootOf(imported("=1E3"))).toEqual(decimal("1000"));
    expect(rootOf(imported('="Café"'))).toEqual({ kind: "literal", value: { kind: "text", text: "Café" } });
  });
});

describe("translateAuthored", () => {
  it("reads D58: this row, a table column, and a field across a relationship", () => {
    expect(rootOf(translateAuthored("[Quoted]-[Paid]", authoredResolver()))).toEqual({
      kind: "binary",
      operator: "-",
      left: { kind: "field", fieldId: QUOTED },
      right: { kind: "field", fieldId: PAID },
    });
    expect(rootOf(translateAuthored("=SUM(Jobs[Quoted])", authoredResolver(false)))).toEqual({
      kind: "call",
      name: "SUM",
      version: 1,
      args: [{ kind: "column", tableId: JOBS, fieldId: QUOTED }],
    });
    expect(rootOf(translateAuthored("RELATED([Customer],[Name])", authoredResolver()))).toEqual({
      kind: "related",
      relationshipId: JOBS_TO_CUSTOMERS,
      referenceFieldId: CUSTOMER,
      fieldId: CUSTOMER_NAME,
    });
    expect(rootOf(translateAuthored("[Total quoted]-[Total paid]", authoredResolver(false)))).toEqual({
      kind: "binary",
      operator: "-",
      left: { kind: "formula", formulaId: TOTAL_QUOTED },
      right: { kind: "formula", formulaId: TOTAL_PAID },
    });
  });

  it("reports an unknown name by name, for the editor", () => {
    expect(translateAuthored("[Quoted]-[Deposit]", authoredResolver())).toEqual({ kind: "unknown-name", name: "Deposit" });
    expect(translateAuthored("SUM(Visits[Hours])", authoredResolver())).toEqual({ kind: "unknown-name", name: "Visits[Hours]" });
    expect(translateAuthored("RELATED([Customer],[Phone])", authoredResolver())).toEqual({
      kind: "unknown-name",
      name: "RELATED([Customer],[Phone])",
    });
    expect(translateAuthored("[Quoted]", authoredResolver(false))).toEqual({ kind: "unknown-name", name: "Quoted" });
  });

  it("refuses addresses, lookups, unknown functions and bad syntax with typed reasons", () => {
    expect(translateAuthored("E2-F2", authoredResolver())).toMatchObject({ kind: "refused", reason: "cell-reference" });
    expect(translateAuthored("Rate*2", authoredResolver())).toMatchObject({ kind: "refused", reason: "cell-reference" });
    expect(translateAuthored("VLOOKUP([Customer],Customers[ID],2,FALSE)", authoredResolver())).toEqual({
      kind: "refused",
      reason: "lookup-function",
      detail: "VLOOKUP",
    });
    expect(translateAuthored("FORECAST([Quoted])", authoredResolver())).toEqual({
      kind: "refused",
      reason: "unsupported-function",
      detail: "FORECAST",
    });
    expect(translateAuthored("[Quoted]-", authoredResolver())).toMatchObject({ kind: "refused", reason: "syntax" });
  });

  it("never translates a relationship's reference as anything but its own field names", () => {
    expect(rootOf(translateAuthored("IF([Customer]=\"\",0,[Quoted])", authoredResolver()))).toMatchObject({
      name: "IF",
      args: [{ left: { kind: "field", fieldId: CUSTOMER } }, decimal("0"), { kind: "field", fieldId: QUOTED }],
    });
    expect(CUSTOMERS).toBeDefined();
  });
});

describe("relativeShapeKey", () => {
  it("gives every row of a filled-down column one shape", () => {
    const keys = [2, 3, 60].map((row) => relativeShapeKey(ast(`=E${row}-F${row}+$H$1`), row - 1, 6));
    expect(new Set(keys).size).toBe(1);
  });

  it("tells a different relative shape and a moved anchor apart", () => {
    const base = relativeShapeKey(ast("=E2-F2"), 1, 6);
    expect(relativeShapeKey(ast("=E2-F3"), 1, 6)).not.toBe(base);
    expect(relativeShapeKey(ast("=E2-F2"), 2, 6)).not.toBe(base);
    expect(relativeShapeKey(ast("=$E$2-F3"), 2, 6)).toBe(relativeShapeKey(ast("=$E$2-F4"), 3, 6));
  });
});
