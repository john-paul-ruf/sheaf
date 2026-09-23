import { describe, expect, it } from "vitest";
import {
  evaluateNondeterministicOnce,
  evaluateRow,
  evaluateScalar,
  translateAuthored,
  type EvaluationEnvV1,
  type EvaluationResultV1,
  type FieldReadV1,
  type FormulaIRDocumentV1,
  type RowAccessV1,
} from "../../../src/domain/formulas/index.js";
import { asDomainId, domainIdsEqual, type FieldId, type OptionId } from "../../../src/domain/model/ids.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import {
  authoredResolver,
  BALANCE,
  CUSTOMER,
  CUSTOMER_NAME,
  JOB_ID,
  PAID,
  QUOTED,
  TOTAL_PAID,
  TOTAL_QUOTED,
} from "./fixtures.js";

const PAID_OPTION: OptionId = asDomainId("option", new Uint8Array(16).fill(50));
const RECORD = asDomainId("record", new Uint8Array(16).fill(60));
const PARENT = asDomainId("record", new Uint8Array(16).fill(61));

const decimal = (text: string): CellValueV1 => ({ kind: "decimal", decimal: text });
const textValue = (text: string): CellValueV1 => ({ kind: "text", text });
const date = (epochDay: number): CellValueV1 => ({ kind: "date", epochDay });

const document = (text: string, hasRow = true): FormulaIRDocumentV1 => {
  const result = translateAuthored(text, authoredResolver(hasRow));
  if (result.kind !== "translated") throw new Error(`not translated: ${JSON.stringify(result)}`);
  return result.document;
};

const rowOf = (values: ReadonlyMap<FieldId, FieldReadV1>): RowAccessV1 => ({
  recordId: RECORD,
  valueOf: (fieldId) => [...values].find(([id]) => domainIdsEqual(id, fieldId))?.[1] ?? { kind: "missing" },
});

interface Setup {
  readonly row?: ReadonlyMap<FieldId, FieldReadV1>;
  readonly columns?: ReadonlyMap<FieldId, readonly FieldReadV1[]>;
  readonly epochDay?: number;
  readonly epochMs?: number;
  readonly formulas?: ReadonlyMap<string, EvaluationResultV1>;
  readonly parent?: ReadonlyMap<FieldId, FieldReadV1> | null;
  readonly budget?: number;
}

const envOf = (setup: Setup): EvaluationEnvV1 => ({
  clock: () => ({ epochDay: setup.epochDay ?? 20_000, epochMs: setup.epochMs ?? 20_000 * 86_400_000 }),
  columns: {
    valuesOf: (_, fieldId) => [...(setup.columns ?? [])].find(([id]) => domainIdsEqual(id, fieldId))?.[1] ?? [],
  },
  formulaResults: (formulaId) => setup.formulas?.get(formulaId.join()) ?? { kind: "empty" },
  relatedRow: (_, recordId) =>
    setup.parent === null || setup.parent === undefined || !domainIdsEqual(recordId, RECORD)
      ? null
      : { ...rowOf(setup.parent), recordId: PARENT },
  optionLabel: (optionId) => (domainIdsEqual(optionId, PAID_OPTION) ? "Paid" : null),
  ...(setup.budget === undefined ? {} : { budget: setup.budget }),
});

const row = (text: string, setup: Setup = {}): EvaluationResultV1 =>
  evaluateRow(document(text), rowOf(setup.row ?? new Map()), envOf(setup));

const scalar = (text: string, setup: Setup = {}): EvaluationResultV1 => evaluateScalar(document(text, false), envOf(setup));

const okDecimal = (text: string) => ({ kind: "ok", value: decimal(text) });
const okText = (text: string) => ({ kind: "ok", value: textValue(text) });
const okBoolean = (boolean: boolean) => ({ kind: "ok", value: { kind: "boolean", boolean } });
const error = (code: string) => ({ kind: "error", code });

const JOB = new Map<FieldId, FieldReadV1>([
  [QUOTED, decimal("1200.00")],
  [PAID, decimal("200.00")],
  [JOB_ID, textValue("J-0042")],
]);

describe("evaluateRow", () => {
  it("computes Quoted minus Paid exactly, keeping currency scale", () => {
    expect(row("[Quoted]-[Paid]", { row: JOB })).toEqual(okDecimal("1000.00"));
    expect(row("0.1+0.2", { row: JOB })).toEqual(okDecimal("0.3"));
    expect(row("[Quoted]-[Paid]", { row: new Map([[QUOTED, decimal("5")]]) })).toEqual(okDecimal("5"));
  });

  it("keeps result states distinct: empty, error, and a preserved import read as its text", () => {
    expect(row("[Paid]", { row: new Map() })).toEqual({ kind: "empty" });
    expect(row("[Quoted]/[Paid]", { row: new Map([[QUOTED, decimal("1")], [PAID, decimal("0")]]) })).toEqual(error("#DIV/0!"));
    expect(row("[Quoted]*2", { row: new Map([[QUOTED, { kind: "invalid-preserved", sourceText: "TBD" }]]) })).toEqual(error("#VALUE!"));
    expect(row("[Quoted]*2", { row: new Map([[QUOTED, { kind: "invalid-preserved", sourceText: "21" }]]) })).toEqual(okDecimal("42"));
    expect(row("[Quoted]+1", { row: new Map([[QUOTED, { kind: "error", code: "#N/A" }]]) })).toEqual(error("#N/A"));
    expect(row("1/3")).toEqual(okDecimal("0.3333333333333333333333333333333333"));
  });

  it("reads a parent field through the relationship, and #N/A when there is no parent", () => {
    expect(row("RELATED([Customer],[Name])", { parent: new Map([[CUSTOMER_NAME, textValue("Harbor Co")]]) })).toEqual(
      okText("Harbor Co"),
    );
    expect(row("RELATED([Customer],[Name])", { parent: null })).toEqual(error("#N/A"));
    expect(CUSTOMER).toBeDefined();
  });

  it("compares an enum by its current label and text case-insensitively", () => {
    const paid = new Map<FieldId, FieldReadV1>([[BALANCE, { kind: "enum", optionId: PAID_OPTION }]]);
    expect(row('IF([Balance]="paid","done","open")', { row: paid })).toEqual(okText("done"));
    expect(row('"abc"<"ABD"')).toEqual(okBoolean(true));
    expect(row('1<"1"')).toEqual(okBoolean(true));
    expect(row('"1"<TRUE')).toEqual(okBoolean(true));
  });

  it("does date arithmetic on epoch days", () => {
    const due = new Map<FieldId, FieldReadV1>([[QUOTED, date(20_454)], [PAID, date(20_440)]]);
    expect(row("[Quoted]-[Paid]", { row: due })).toEqual(okDecimal("14"));
    expect(row("[Quoted]+30", { row: due })).toEqual({ kind: "ok", value: date(20_484) });
    expect(row("DATE(2026,2,30)")).toEqual({ kind: "ok", value: date(20_514) });
    expect(row("EDATE(DATE(2026,1,31),1)")).toEqual({ kind: "ok", value: date(20_512) });
    expect(row("EOMONTH(DATE(2024,1,15),1)")).toEqual({ kind: "ok", value: date(19_782) });
    expect(row("YEAR(DATE(1999,12,31))+MONTH(DATE(1999,12,31))+DAY(DATE(1999,12,31))")).toEqual(okDecimal("2042"));
    expect(row("WEEKDAY(DATE(1970,1,1))")).toEqual(okDecimal("5"));
    expect(row("WEEKDAY(DATE(1970,1,1),2)")).toEqual(okDecimal("4"));
    expect(row('DATEDIF(DATE(2020,1,15),DATE(2026,3,10),"Y")')).toEqual(okDecimal("6"));
    expect(row('DATEDIF(DATE(2020,1,15),DATE(2026,3,10),"YM")')).toEqual(okDecimal("1"));
    expect(row('DATEDIF(DATE(2026,3,10),DATE(2020,1,15),"D")')).toEqual(error("#NUM!"));
    expect(row("DAYS(DATE(2026,3,1),DATE(2026,2,1))")).toEqual(okDecimal("28"));
  });

  it("rounds, floors and powers exactly as the catalog states", () => {
    expect(row("ROUND(2.5,0)")).toEqual(okDecimal("3"));
    expect(row("ROUND(-2.5,0)")).toEqual(okDecimal("-3"));
    expect(row("ROUND(1234.5678,-2)")).toEqual(okDecimal("1200"));
    expect(row("ROUNDUP(1.21,1)")).toEqual(okDecimal("1.3"));
    expect(row("ROUNDDOWN(-1.29,1)")).toEqual(okDecimal("-1.2"));
    expect(row("INT(-2.5)")).toEqual(okDecimal("-3"));
    expect(row("MOD(-3,2)")).toEqual(okDecimal("1"));
    expect(row("MOD(3,-2)")).toEqual(okDecimal("-1"));
    expect(row("CEILING(-2.5,-2)")).toEqual(okDecimal("-4"));
    expect(row("FLOOR(-2.5,1)")).toEqual(okDecimal("-3"));
    expect(row("CEILING(2.5,-1)")).toEqual(error("#NUM!"));
    expect(row("POWER(2,10)")).toEqual(okDecimal("1024"));
    expect(row("2^-2")).toEqual(okDecimal("0.25"));
    expect(row("-2^2")).toEqual(okDecimal("4"));
    expect(row("SQRT(16)")).toEqual(okDecimal("4"));
    expect(row("POWER(2,0.5)")).toEqual(okDecimal("1.414213562373095048801688724209698"));
    expect(row("POWER(2,0.3)")).toEqual({ kind: "unsupported" });
    expect(row("SQRT(-1)")).toEqual(error("#NUM!"));
    expect(row("10^40")).toEqual(error("#NUM!"));
    expect(row("50%")).toEqual(okDecimal("0.5"));
  });

  it("runs the logical and text functions", () => {
    expect(row("IFS(1>2,1,2>1,2)")).toEqual(okDecimal("2"));
    expect(row("IFS(1>2,1)")).toEqual(error("#N/A"));
    expect(row('IFERROR(1/0,"none")')).toEqual(okText("none"));
    expect(row('IFNA(1/0,"none")')).toEqual(error("#DIV/0!"));
    expect(row("AND(TRUE,1)")).toEqual(okBoolean(true));
    expect(row("XOR(TRUE,TRUE,TRUE)")).toEqual(okBoolean(true));
    expect(row("NOT(0)")).toEqual(okBoolean(true));
    expect(row('CONCAT([Job ID]," — ",[Quoted])', { row: JOB })).toEqual(okText("J-0042 — 1200"));
    expect(row('LEFT("Harbor",3)&MID("Harbor",4,2)&RIGHT("Harbor")')).toEqual(okText("Harbor"));
    expect(row('PROPER("hARBOR co-op")')).toEqual(okText("Harbor Co-Op"));
    expect(row('TRIM("  a   b ")')).toEqual(okText("a b"));
    expect(row('SUBSTITUTE("a-b-c","-","+",2)')).toEqual(okText("a-b+c"));
    expect(row('FIND("B","abcB")')).toEqual(okDecimal("4"));
    expect(row('SEARCH("b?d","ABCBED")')).toEqual(okDecimal("4"));
    expect(row('SEARCH("~*","a*b")')).toEqual(okDecimal("2"));
    expect(row('FIND("z","abc")')).toEqual(error("#VALUE!"));
    expect(row('LEN("é")')).toEqual(okDecimal("1"));
    expect(row('VALUE("$1,234.50")+VALUE("10%")')).toEqual(okDecimal("1234.6"));
    expect(row('TEXT(1234.5,"#,##0.00")')).toEqual(okText("1,234.50"));
    expect(row('TEXT(-0.125,"0.0%")')).toEqual(okText("-12.5%"));
    expect(row('TEXT(DATE(2026,3,9),"dddd d mmm yyyy")')).toEqual(okText("Monday 9 Mar 2026"));
    expect(row('TEXT(1,"[Red]0")')).toEqual({ kind: "unsupported" });
    expect(row('ISBLANK([Paid])&ISNUMBER(DATE(2026,1,1))&ISTEXT("x")&ISERROR(1/0)')).toEqual(okText("TRUETRUETRUETRUE"));
  });

  it("reads TODAY() and NOW() from the injected clock only", () => {
    expect(row("TODAY()", { epochDay: 20_000 })).toEqual({ kind: "ok", value: date(20_000) });
    expect(row("NOW()", { epochDay: 20_000, epochMs: 20_000 * 86_400_000 + 43_200_000 })).toEqual(okDecimal("20000.5"));
  });

  it("changes TODAY() when only the injected clock changes, and nothing else does", () => {
    const setup = { row: JOB };
    const monday = row("TODAY()-[Quoted]", { ...setup, epochDay: 20_523 });
    expect(row("TODAY()-[Quoted]", { ...setup, epochDay: 20_523 })).toEqual(monday);
    expect(row("TODAY()-[Quoted]", { ...setup, epochDay: 20_524 })).not.toEqual(monday);
    expect(row("[Quoted]-[Paid]", { ...setup, epochDay: 20_524 })).toEqual(row("[Quoted]-[Paid]", { ...setup, epochDay: 20_523 }));
  });

  it("refuses to evaluate RAND outside its one frozen evaluation", () => {
    expect(row("RAND()")).toEqual({ kind: "unsupported" });
    const entropy = { randomBytes: (length: number) => new Uint8Array(length).fill(7) };
    const once = evaluateNondeterministicOnce(document("RAND()"), entropy, envOf({}), rowOf(new Map()));
    expect(once).toMatchObject({ kind: "ok", value: { kind: "decimal" } });
    expect(evaluateNondeterministicOnce(document("RAND()"), entropy, envOf({}))).toEqual(once);
    const between = evaluateNondeterministicOnce(document("RANDBETWEEN(1,6)"), entropy, envOf({}));
    expect(between.kind === "ok" && between.value.kind === "decimal" && Number(between.value.decimal)).toBeGreaterThanOrEqual(1);
  });

  it("stops at the step budget with #BUDGET and treats a lookup call as unsupported", () => {
    expect(row("1+1+1+1+1", { budget: 5 })).toEqual(error("#BUDGET"));
    expect(row("1+1+1+1+1", { budget: 9 })).toEqual(okDecimal("5"));
    const lookup: FormulaIRDocumentV1 = { irVersion: 1, root: { kind: "call", name: "VLOOKUP", version: 1, args: [] } };
    expect(evaluateRow(lookup, rowOf(new Map()), envOf({}))).toEqual({ kind: "unsupported" });
    const unknownVersion: FormulaIRDocumentV1 = { irVersion: 1, root: { kind: "call", name: "SUM", version: 2, args: [] } };
    expect(evaluateRow(unknownVersion, rowOf(new Map()), envOf({}))).toEqual({ kind: "unsupported" });
  });
});

describe("evaluateScalar", () => {
  const columns = new Map<FieldId, readonly FieldReadV1[]>([
    [QUOTED, [decimal("1200.00"), decimal("300.50"), { kind: "missing" }, textValue("n/a")]],
    [PAID, [decimal("200"), decimal("0"), decimal("50"), decimal("10")]],
  ]);

  it("aggregates whole columns exactly, skipping text in a reference", () => {
    expect(scalar("SUM(Jobs[Quoted])", { columns })).toEqual(okDecimal("1500.50"));
    expect(scalar("AVERAGE(Jobs[Quoted])", { columns })).toEqual(okDecimal("750.25"));
    expect(scalar("COUNT(Jobs[Quoted])", { columns })).toEqual(okDecimal("2"));
    expect(scalar("COUNTA(Jobs[Quoted])", { columns })).toEqual(okDecimal("3"));
    expect(scalar("COUNTBLANK(Jobs[Quoted])", { columns })).toEqual(okDecimal("1"));
    expect(scalar("MAX(Jobs[Paid])-MIN(Jobs[Paid])", { columns })).toEqual(okDecimal("200"));
    expect(scalar('COUNTIF(Jobs[Paid],">0")', { columns })).toEqual(okDecimal("3"));
    expect(scalar('SUMIF(Jobs[Paid],">=50",Jobs[Quoted])', { columns })).toEqual(okDecimal("1200.00"));
    expect(scalar('SUMIFS(Jobs[Paid],Jobs[Quoted],">1000",Jobs[Paid],">0")', { columns })).toEqual(okDecimal("200"));
    expect(scalar('COUNTIF(Jobs[Quoted],"n*")', { columns })).toEqual(okDecimal("1"));
    expect(scalar('AVERAGEIF(Jobs[Paid],">1000")', { columns })).toEqual(error("#DIV/0!"));
    expect(scalar('SUM("5",1)', { columns })).toEqual(okDecimal("6"));
    expect(scalar("SUM(Jobs[Quoted])", { columns: new Map([[QUOTED, [decimal("1"), { kind: "error", code: "#N/A" }]]]) })).toEqual(
      error("#N/A"),
    );
  });

  it("reads other formulas' results and never evaluates past a cycle or an unsupported one", () => {
    const formulas = new Map<string, EvaluationResultV1>([
      [TOTAL_QUOTED.join(), okDecimal("1500.50") as EvaluationResultV1],
      [TOTAL_PAID.join(), okDecimal("260") as EvaluationResultV1],
    ]);
    expect(scalar("[Total quoted]-[Total paid]", { formulas })).toEqual(okDecimal("1240.50"));
    expect(scalar("[Total quoted]+1", { formulas: new Map([[TOTAL_QUOTED.join(), { kind: "cycle" }]]) })).toEqual({ kind: "cycle" });
    expect(scalar("[Total quoted]+1", { formulas: new Map([[TOTAL_QUOTED.join(), { kind: "unsupported" }]]) })).toEqual({
      kind: "unsupported",
    });
  });

  it("reads no row: a this-row field in a metric is #REF!", () => {
    const withField = document("[Quoted]*2");
    expect(evaluateScalar(withField, envOf({}))).toEqual(error("#REF!"));
  });
});
