import { describe, expect, it } from "vitest";
import { asDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  FieldTypeV1,
  TableDefV1,
} from "../../../src/domain/model/schema.js";
import {
  BLANK_VALUE,
  MISSING_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../../src/domain/model/values.js";
import type { ValidationRuleIR } from "../../../src/domain/validation/rules.js";
import {
  validateRecord,
  type ValidationContext,
} from "../../../src/domain/validation/validate-record.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const recordId = asDomainId("record", new Uint8Array(16).fill(2));
const ruleId = asDomainId("rule", new Uint8Array(16).fill(3));

const fieldId = (n: number): FieldId =>
  asDomainId("field", new Uint8Array(16).fill(n));

const NAME = fieldId(10);
const PRICE = fieldId(11);
const DUE = fieldId(12);
const STATUS = fieldId(13);
const FLAG = fieldId(14);
const PARENT = fieldId(15);

const field = (
  id: FieldId,
  type: FieldTypeV1,
  overrides: Partial<FieldDefV1> = {},
): FieldDefV1 => ({
  fieldId: id,
  tableId,
  displayName: `field ${id[0] ?? 0}`,
  fieldOrdinal: id[0] ?? 0,
  type,
  isRequired: false,
  isActive: true,
  schemaRevision: 1n,
  ...overrides,
});

const OPTION_OPEN = asDomainId("option", new Uint8Array(16).fill(20));
const OPTION_RETIRED = asDomainId("option", new Uint8Array(16).fill(21));

const options: readonly EnumOptionDefV1[] = [
  {
    optionId: OPTION_OPEN,
    fieldId: STATUS,
    displayLabel: "Open",
    optionOrdinal: 0,
    isActive: true,
    schemaRevision: 1n,
  },
  {
    optionId: OPTION_RETIRED,
    fieldId: STATUS,
    displayLabel: "Retired",
    optionOrdinal: 1,
    isActive: false,
    schemaRevision: 1n,
  },
];

const table: TableDefV1 = {
  tableId,
  displayName: "Stock",
  tableOrdinal: 0,
  fields: [
    field(NAME, { kind: "text" }, { isRequired: true }),
    field(PRICE, { kind: "currency", currencyCode: "USD" }),
    field(DUE, { kind: "date" }),
    field(STATUS, { kind: "enum" }),
    field(FLAG, { kind: "boolean" }),
    field(PARENT, { kind: "reference" }),
  ],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const SUPPLIERS = asDomainId("table", new Uint8Array(16).fill(30));
const PARENT_TARGET = {
  fieldId: PARENT,
  tableId: SUPPLIERS,
  tableLabel: "Suppliers",
};

/** F02's resolver: this app has no relationships, so nothing resolves (D25). */
const noReferences = (): boolean => false;

const context = (
  overrides: Partial<ValidationContext> = {},
): ValidationContext => ({
  table,
  enumOptions: new Map([[STATUS, options]]),
  rules: [],
  referenceExists: noReferences,
  ...overrides,
});

const record = (values: readonly (readonly [FieldId, CellValueV1])[]) => ({
  recordId,
  tableId,
  values: new Map(values),
});

const kinds = (report: { issues: readonly { kind: string }[] }): string[] =>
  report.issues.map((issue) => issue.kind);

describe("validateRecord", () => {
  it("accepts a well-typed record", () => {
    const report = validateRecord(
      context(),
      record([
        [NAME, textValue("Cedar plank")],
        [PRICE, decimalValue("18.50")],
        [DUE, dateValue(20_000)],
        [STATUS, enumValue(OPTION_OPEN)],
        [FLAG, booleanValue(true)],
      ]),
    );

    expect(report).toEqual({ isValid: true, issues: [] });
  });

  it("reports a type mismatch per field type, blocking", () => {
    const wrong: readonly (readonly [FieldId, CellValueV1])[] = [
      [PRICE, textValue("eighteen fifty")],
      [DUE, decimalValue("1")],
      [FLAG, textValue("yes")],
      [STATUS, textValue("Open")],
    ];

    for (const [id, value] of wrong) {
      const report = validateRecord(
        context(),
        record([[NAME, textValue("x")], [id, value]]),
      );
      const issue = report.issues.find((candidate) => candidate.fieldId === id);

      expect(report.isValid, String(id[0])).toBe(false);
      expect(issue?.kind).toBe("type");
      expect(issue?.severity).toBe("blocking");
      expect(issue?.messageKey).toBe("validation.wrong-type");
    }
  });

  it("blocks a missing or blank required value but not an optional one", () => {
    expect(kinds(validateRecord(context(), record([])))).toEqual(["required"]);
    expect(
      kinds(validateRecord(context(), record([[NAME, BLANK_VALUE]]))),
    ).toEqual(["required"]);
    expect(
      kinds(validateRecord(context(), record([[NAME, MISSING_VALUE]]))),
    ).toEqual(["required"]);
    expect(
      validateRecord(context(), record([[NAME, textValue("present")]])).isValid,
    ).toBe(true);
  });

  it("flags an invalid preserved value without coercing or blocking it", () => {
    const preserved = invalidPreservedValue("not a price");
    const report = validateRecord(
      context(),
      record([
        [NAME, textValue("Cedar plank")],
        [PRICE, preserved],
      ]),
    );

    // Warning, not blocking: the record still commits and the value survives.
    expect(report.isValid).toBe(true);
    expect(report.issues).toEqual([
      {
        fieldId: PRICE,
        ruleId: null,
        kind: "type",
        severity: "warning",
        messageKey: "validation.preserved-invalid",
        messageParameters: {
          fieldLabel: "field 11",
          expectedType: "currency",
        },
      },
    ]);
    // The value the caller handed in is untouched.
    expect(preserved).toEqual({
      kind: "invalid-preserved",
      sourceText: "not a price",
    });
  });

  it("checks enum membership by OptionId, not by label", () => {
    const unknown = asDomainId("option", new Uint8Array(16).fill(99));

    const rejected = validateRecord(
      context(),
      record([[NAME, textValue("x")], [STATUS, enumValue(unknown)]]),
    );
    expect(rejected.isValid).toBe(false);
    expect(rejected.issues[0]?.kind).toBe("enum");
    expect(rejected.issues[0]?.messageKey).toBe("validation.unknown-option");
    expect(rejected.issues[0]?.messageParameters["optionCount"]).toBe(2);

    // A retired option still interprets; it warns rather than erasing history.
    const retired = validateRecord(
      context(),
      record([[NAME, textValue("x")], [STATUS, enumValue(OPTION_RETIRED)]]),
    );
    expect(retired.isValid).toBe(true);
    expect(retired.issues[0]?.severity).toBe("warning");
  });

  it("preserves and flags a reference no resolver can find", () => {
    const report = validateRecord(
      context({ referenceTargets: [PARENT_TARGET] }),
      record([
        [NAME, textValue("x")],
        [PARENT, referenceValue(asDomainId("record", new Uint8Array(16).fill(8)))],
      ]),
    );

    expect(report.isValid).toBe(true);
    expect(kinds(report)).toEqual(["broken-reference"]);

    // The same value passes once a resolver can see the target.
    expect(
      validateRecord(
        context({ referenceExists: () => true, referenceTargets: [PARENT_TARGET] }),
        record([
          [NAME, textValue("x")],
          [
            PARENT,
            referenceValue(asDomainId("record", new Uint8Array(16).fill(8))),
          ],
        ]),
      ).issues,
    ).toEqual([]);
  });

  describe("broken references (D36)", () => {
    const PARENT_RECORD = asDomainId("record", new Uint8Array(16).fill(8));
    const expectedIssue = (severity: "warning" | "blocking") => ({
      fieldId: PARENT,
      ruleId: null,
      kind: "broken-reference",
      severity,
      messageKey: "validation.broken-reference",
      messageParameters: { fieldLabel: "field 15", targetTable: "Suppliers" },
    });

    it("flags an imported unmatched key as a broken reference, never its text", () => {
      const report = validateRecord(
        context({ referenceTargets: [PARENT_TARGET] }),
        record([
          [NAME, textValue("x")],
          [PARENT, invalidPreservedValue("SUP-404")],
        ]),
      );

      expect(report.isValid).toBe(true);
      expect(report.issues).toEqual([expectedIssue("warning")]);
      expect(JSON.stringify(report.issues)).not.toContain("SUP-404");
    });

    it("asks the resolver about the target table, not the field's own table", () => {
      const asked: string[] = [];
      validateRecord(
        context({
          referenceTargets: [PARENT_TARGET],
          referenceExists: (target) => {
            asked.push(String(target[0]));
            return true;
          },
        }),
        record([
          [NAME, textValue("x")],
          [PARENT, referenceValue(PARENT_RECORD)],
        ]),
      );

      expect(asked).toEqual([String(SUPPLIERS[0])]);
    });

    it("blocks an authored reference to a record that is not there", () => {
      const report = validateRecord(context({ referenceTargets: [PARENT_TARGET] }), {
        ...record([
          [NAME, textValue("x")],
          [PARENT, referenceValue(PARENT_RECORD)],
        ]),
        provenance: new Map([[PARENT, { source: "user" }]]),
      });

      expect(report.isValid).toBe(false);
      expect(report.issues).toEqual([expectedIssue("blocking")]);
    });

    it("warns for an imported or carried-over reference that no longer resolves", () => {
      for (const provenance of [
        undefined,
        new Map([[PARENT, { source: "initial-import" as const }]]),
        // Authored now, but another field: the reference is carried over.
        new Map([[NAME, { source: "user" as const }]]),
      ]) {
        const report = validateRecord(context({ referenceTargets: [PARENT_TARGET] }), {
          ...record([
            [NAME, textValue("x")],
            [PARENT, referenceValue(PARENT_RECORD)],
          ]),
          ...(provenance === undefined ? {} : { provenance }),
        });
        expect(report.issues).toEqual([expectedIssue("warning")]);
      }
    });

    it("treats a reference field with no relationship as pointing nowhere", () => {
      const report = validateRecord(
        context({ referenceExists: () => true }),
        record([
          [NAME, textValue("x")],
          [PARENT, referenceValue(PARENT_RECORD)],
        ]),
      );

      expect(kinds(report)).toEqual(["broken-reference"]);
      expect(report.issues[0]?.messageParameters["targetTable"]).toBe("");
    });

    it("keeps an invalid value in a non-reference field a type warning", () => {
      const report = validateRecord(
        context({ referenceTargets: [PARENT_TARGET] }),
        record([
          [NAME, textValue("x")],
          [PRICE, invalidPreservedValue("n/a")],
        ]),
      );
      expect(kinds(report)).toEqual(["type"]);
    });
  });

  it("evaluates a hand-built record-level rule IR", () => {
    // "A dated row must name a status" — nothing in a CSV declares this, so
    // F02 emits no such rule; the engine still runs it.
    const rule: ValidationRuleIR = {
      irVersion: 1,
      ruleId,
      condition: {
        kind: "any",
        conditions: [
          { kind: "field-absent", fieldId: DUE },
          { kind: "field-present", fieldId: STATUS },
        ],
      },
      severity: "blocking",
      messageKey: "rule.due-needs-status",
      messageParameters: { ruleLabel: "Dated rows need a status" },
    };
    const withRule = context({ rules: [rule] });

    const failing = validateRecord(
      withRule,
      record([[NAME, textValue("x")], [DUE, dateValue(1)]]),
    );
    expect(failing.isValid).toBe(false);
    expect(failing.issues).toEqual([
      {
        fieldId: null,
        ruleId,
        kind: "record-rule",
        severity: "blocking",
        messageKey: "rule.due-needs-status",
        messageParameters: { ruleLabel: "Dated rows need a status" },
      },
    ]);

    expect(
      validateRecord(
        withRule,
        record([
          [NAME, textValue("x")],
          [DUE, dateValue(1)],
          [STATUS, enumValue(OPTION_OPEN)],
        ]),
      ).isValid,
    ).toBe(true);
    expect(
      validateRecord(withRule, record([[NAME, textValue("x")]])).isValid,
    ).toBe(true);
  });

  it("evaluates all, not, and field-equals conditions", () => {
    const rule: ValidationRuleIR = {
      irVersion: 1,
      ruleId,
      condition: {
        kind: "not",
        condition: {
          kind: "all",
          conditions: [
            { kind: "field-equals", fieldId: FLAG, value: booleanValue(true) },
            { kind: "field-absent", fieldId: PRICE },
          ],
        },
      },
      severity: "warning",
      messageKey: "rule.flagged-needs-price",
      messageParameters: {},
    };
    const withRule = context({ rules: [rule] });

    const flagged = validateRecord(
      withRule,
      record([[NAME, textValue("x")], [FLAG, booleanValue(true)]]),
    );
    expect(kinds(flagged)).toEqual(["record-rule"]);
    // A warning-severity rule does not refuse the write.
    expect(flagged.isValid).toBe(true);

    expect(
      validateRecord(
        withRule,
        record([
          [NAME, textValue("x")],
          [FLAG, booleanValue(true)],
          [PRICE, decimalValue("1.00")],
        ]),
      ).issues,
    ).toEqual([]);
  });

  it("rejects values for fields the table does not define", () => {
    const report = validateRecord(
      context(),
      record([[NAME, textValue("x")], [fieldId(77), textValue("stray")]]),
    );

    expect(report.isValid).toBe(false);
    expect(report.issues[0]?.kind).toBe("schema");
    expect(report.issues[0]?.messageKey).toBe("validation.unknown-field");
  });

  it("rejects a record addressed to another table", () => {
    const report = validateRecord(context(), {
      recordId,
      tableId: asDomainId("table", new Uint8Array(16).fill(9)),
      values: new Map(),
    });

    expect(report.isValid).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.messageKey).toBe("validation.wrong-table");
  });

  it("does not re-validate a retired field's value", () => {
    const retiredTable: TableDefV1 = {
      ...table,
      fields: table.fields.map((candidate) =>
        candidate.fieldId === PRICE
          ? { ...candidate, isActive: false, isRequired: true }
          : candidate,
      ),
    };

    expect(
      validateRecord(context({ table: retiredTable }), record([[NAME, textValue("x")]]))
        .issues,
    ).toEqual([]);
  });

  it("offers no way to skip referential or cross-field checks", () => {
    // Invariant 5 held by the signature: two parameters, no options object.
    expect(validateRecord.length).toBe(2);
  });

  it("carries structured reasons, never prose", () => {
    const report = validateRecord(context(), record([]));

    for (const issue of report.issues) {
      expect(typeof issue.messageKey).toBe("string");
      expect(issue.messageKey).toMatch(/^[a-z-]+\.[a-z-]+$/);
      for (const value of Object.values(issue.messageParameters)) {
        expect(["string", "number", "bigint", "boolean"]).toContain(
          typeof value,
        );
      }
    }
  });
});

describe("validateRecord — computed fields (D51)", () => {
  const FORMULA = asDomainId("formula", new Uint8Array(16).fill(40));
  const BALANCE = fieldId(16);
  const computed = context({
    table: {
      ...table,
      fields: [...table.fields, field(BALANCE, { kind: "currency", currencyCode: "USD" }, { isRequired: true, formulaId: FORMULA })],
    },
  });
  const base = [[NAME, textValue("Cedar plank")]] as const;

  it("skips the required and type checks for a computed field", () => {
    expect(validateRecord(computed, record(base))).toEqual({ isValid: true, issues: [] });
    expect(validateRecord(computed, record([...base, [BALANCE, textValue("n/a")]]))).toEqual({ isValid: true, issues: [] });
  });

  it("refuses a value the user authors for a computed field", () => {
    const report = validateRecord(computed, {
      ...record([...base, [BALANCE, decimalValue("5")]]),
      provenance: new Map([[BALANCE, { source: "user" }]]),
    });
    expect(report.isValid).toBe(false);
    expect(report.issues).toEqual([
      {
        fieldId: BALANCE,
        ruleId: null,
        kind: "formula",
        severity: "blocking",
        messageKey: "computed-not-authored",
        messageParameters: { fieldLabel: "field 16" },
      },
    ]);
  });

  it("accepts an imported literal and the frozen literal a command evaluated once", () => {
    for (const provenance of [{ source: "initial-import" as const }, { source: "user" as const, evidence: { frozen: "=RAND()" } }]) {
      const report = validateRecord(computed, {
        ...record([...base, [BALANCE, decimalValue("0.42")]]),
        provenance: new Map([[BALANCE, provenance]]),
      });
      expect(report, provenance.source).toEqual({ isValid: true, issues: [] });
    }
  });
});
