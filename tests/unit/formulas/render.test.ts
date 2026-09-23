import { describe, expect, it } from "vitest";
import {
  formulaTableName,
  renderFormula,
  translateAuthored,
  type FormulaIRDocumentV1,
  type NameLookupV1,
} from "../../../src/domain/formulas/index.js";
import { authoredResolver, JOBS, names, QUOTED } from "./fixtures.js";

const translated = (text: string, hasRow = true): FormulaIRDocumentV1 => {
  const result = translateAuthored(text, authoredResolver(hasRow));
  if (result.kind !== "translated") throw new Error(`not translated: ${JSON.stringify(result)}`);
  return result.document;
};

describe("renderFormula", () => {
  it("round-trips the demo expressions through translateAuthored", () => {
    for (const text of [
      "[Quoted]-[Paid]",
      "IF([Quoted]=0,0,([Quoted]-[Paid])/[Quoted])",
      "RELATED([Customer],[Name])",
      'IF([Paid]>=[Quoted],"Paid","Open")',
      "ROUND([Quoted]*1.15,2)",
      "-[Paid]^2%",
      "-5+-[Paid]",
      "2^-1",
      "1-2-(3-4)",
      "1-(2-3)",
      "TODAY()-[Quoted]",
      'CONCAT("a""b",[Job ID])',
      "IF([Paid],,1)",
    ]) {
      const document = translated(text);
      expect(renderFormula(document, names), text).toBe(text);
      expect(translated(renderFormula(document, names)), text).toEqual(document);
    }
    for (const text of ["SUM(Jobs[Quoted])", "[Total quoted]-[Total paid]", "COUNTIF(Jobs[Paid],\">0\")"]) {
      const document = translated(text, false);
      expect(renderFormula(document, names), text).toBe(text);
      expect(translated(renderFormula(document, names), false)).toEqual(document);
    }
  });

  it("prints current names, so a rename changes the text and never the IR", () => {
    const document = translated("[Quoted]-[Paid]");
    const renamed: NameLookupV1 = { ...names, fieldName: (fieldId) => (fieldId === QUOTED ? "Quote total" : names.fieldName(fieldId)) };
    expect(renderFormula(document, renamed)).toBe("[Quote total]-[Paid]");
  });

  it("escapes names the lexer treats specially and spells a table as an identifier", () => {
    const odd: NameLookupV1 = {
      fieldName: () => "Rate [net] #1 @'x'",
      tableName: () => "Job sites 2026",
      formulaName: () => "—",
    };
    expect(
      renderFormula({ irVersion: 1, root: { kind: "column", tableId: JOBS, fieldId: QUOTED } }, odd),
    ).toBe("Job_sites_2026[Rate '[net'] '#1 '@''x'']");
    expect(formulaTableName("2026 Jobs")).toBe("_2026_Jobs");
  });
});
