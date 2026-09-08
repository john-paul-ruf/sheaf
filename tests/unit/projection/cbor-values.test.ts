import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import { APP_THEME_TOKENS } from "../../../src/domain/model/events.js";
import type { AuthoredRecordV1 } from "../../../src/domain/model/events.js";
import { asDomainId, encodeDomainId } from "../../../src/domain/model/ids.js";
import type { AnyDomainId, FieldId } from "../../../src/domain/model/ids.js";
import type { ValueProvenanceV1 } from "../../../src/domain/model/provenance.js";
import {
  BLANK_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  MISSING_VALUE,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../../src/domain/model/values.js";
import type { ValidationRuleIR } from "../../../src/domain/validation/rules.js";
import {
  decodeAppTheme,
  decodeAuthoredRecord,
  decodeChangeSummary,
  decodeMessageParameters,
  decodeRuleIR,
  encodeAppTheme,
  encodeAuthoredRecord,
  encodeChangeSummary,
  encodeMessageParameters,
  encodeRuleIR,
} from "../../../src/persistence/projection/cbor-values.js";

const fieldA = asDomainId("field", new Uint8Array(16).fill(1));
const fieldB = asDomainId("field", new Uint8Array(16).fill(2));
const fieldC = asDomainId("field", new Uint8Array(16).fill(3));
const optionId = asDomainId("option", new Uint8Array(16).fill(4));
const recordId = asDomainId("record", new Uint8Array(16).fill(5));
const tableId = asDomainId("table", new Uint8Array(16).fill(6));
const otherRecordId = asDomainId("record", new Uint8Array(16).fill(7));
const ruleId = asDomainId("rule", new Uint8Array(16).fill(8));
const commitId = asDomainId("commit", new Uint8Array(16).fill(9));

const importProvenance: ValueProvenanceV1 = {
  source: "initial-import",
  sourceTimestampMs: 1_700_000_000_000n,
};

/** One value of every kind, so nothing in the union goes unexercised. */
const everyKind: readonly [FieldId, CellValueV1][] = [
  [fieldA, textValue("Ada")],
  [fieldB, decimalValue("10.50")],
  [fieldC, dateValue(-19_000)],
  [asDomainId("field", new Uint8Array(16).fill(10)), booleanValue(true)],
  [asDomainId("field", new Uint8Array(16).fill(11)), enumValue(optionId)],
  [
    asDomainId("field", new Uint8Array(16).fill(12)),
    referenceValue(otherRecordId),
  ],
  [asDomainId("field", new Uint8Array(16).fill(13)), MISSING_VALUE],
  [asDomainId("field", new Uint8Array(16).fill(14)), BLANK_VALUE],
  [
    asDomainId("field", new Uint8Array(16).fill(15)),
    invalidPreservedValue("twelve dollars"),
  ],
];

const authoredRecord = (): AuthoredRecordV1 => ({
  recordId,
  tableId,
  values: new Map(everyKind),
  provenance: new Map(everyKind.map(([fieldId]) => [fieldId, importProvenance])),
});

/**
 * A decoded map is keyed by fresh `Uint8Array` instances, and a `Map` keyed by
 * bytes matches on object identity — so a decoded map is compared and read by
 * ID text, never by handing it an ID object from somewhere else. The engine
 * follows the same rule internally, and `query-exec` re-keys what it returns to
 * the schema's own field instances so a consumer's `get(field.fieldId)` works.
 */
const byIdText = <T>(entries: ReadonlyMap<{ readonly length: number }, T>) =>
  new Map(
    [...entries].map(([id, value]) => [
      encodeDomainId(id as unknown as AnyDomainId),
      value,
    ]),
  );

describe("authored record payload", () => {
  it("round-trips every value kind, keeping the three absences distinct", () => {
    const decoded = decodeAuthoredRecord(encodeAuthoredRecord(authoredRecord()));

    expect(decoded.recordId).toEqual(recordId);
    expect(decoded.tableId).toEqual(tableId);
    expect(byIdText(decoded.values)).toEqual(byIdText(new Map(everyKind)));
    expect(byIdText(decoded.provenance).get(encodeDomainId(fieldA))).toEqual(
      importProvenance,
    );
  });

  it("encodes the same state to the same bytes whatever order it was built in", () => {
    const forwards = authoredRecord();
    const backwards: AuthoredRecordV1 = {
      recordId,
      tableId,
      values: new Map([...everyKind].reverse()),
      provenance: new Map(
        [...everyKind].reverse().map(([fieldId]) => [fieldId, importProvenance]),
      ),
    };

    expect(encodeAuthoredRecord(backwards)).toEqual(
      encodeAuthoredRecord(forwards),
    );
  });

  it("refuses a decimal that is not canonical", () => {
    const record: AuthoredRecordV1 = {
      recordId,
      tableId,
      values: new Map([[fieldA, { kind: "decimal", decimal: "1e5" }]]),
      provenance: new Map(),
    };

    expect(() => decodeAuthoredRecord(encodeAuthoredRecord(record))).toThrow(
      CodecError,
    );
  });
});

describe("app theme payload", () => {
  const theme = {
    themeKey: "sheaf.default",
    tokens: Object.fromEntries(
      APP_THEME_TOKENS.map((token, index) => [token, `#00000${index}`]),
    ) as Record<(typeof APP_THEME_TOKENS)[number], string>,
  };

  it("round-trips the semantic theme", () => {
    expect(decodeAppTheme(encodeAppTheme(theme))).toEqual(theme);
  });

  it("refuses a theme missing a token rather than inventing one", () => {
    const partial = {
      themeKey: "sheaf.default",
      tokens: { ...theme.tokens, "app-accent": "" },
    };

    expect(() => encodeAppTheme(partial)).toThrow(CodecError);
  });
});

describe("rule IR payload", () => {
  const rule: ValidationRuleIR = {
    irVersion: 1,
    ruleId,
    severity: "blocking",
    messageKey: "rule.needs-contact",
    messageParameters: { fieldLabel: "Email", optionCount: 3 },
    condition: {
      kind: "any",
      conditions: [
        { kind: "field-present", fieldId: fieldA },
        {
          kind: "not",
          condition: { kind: "field-equals", fieldId: fieldB, value: BLANK_VALUE },
        },
        { kind: "all", conditions: [{ kind: "field-absent", fieldId: fieldC }] },
      ],
    },
  };

  it("round-trips the closed condition IR", () => {
    const parameters = decodeMessageParameters(
      encodeMessageParameters(rule.messageParameters),
    );

    expect(decodeRuleIR(encodeRuleIR(rule), parameters)).toEqual({
      ...rule,
      // Integers decode as bigint so decode∘encode stays byte identical.
      messageParameters: { fieldLabel: "Email", optionCount: 3n },
    });
  });
});

describe("change summary payload", () => {
  it("round-trips a patch summary with both ends of every change", () => {
    const summary = {
      fieldChanges: [
        {
          fieldId: fieldA,
          before: textValue("Ada"),
          after: textValue("Ada L"),
          provenance: { source: "user" } as ValueProvenanceV1,
        },
      ],
      recordRevision: 4n,
      createdCommitId: commitId,
    };

    expect(decodeChangeSummary(encodeChangeSummary(summary))).toEqual(summary);
  });

  it("round-trips a summary that names no record", () => {
    const summary = {
      fieldChanges: [],
      recordRevision: null,
      createdCommitId: null,
    };

    expect(decodeChangeSummary(encodeChangeSummary(summary))).toEqual(summary);
  });
});

describe("message parameters", () => {
  it("refuses a parameter that is not a safe scalar", () => {
    const bytes = encodeMessageParameters({ fieldLabel: "Email" });

    expect(decodeMessageParameters(bytes)).toEqual({ fieldLabel: "Email" });
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("encodes an empty parameter set as a nonempty blob", () => {
    // `message_parameters_cbor` is NOT NULL with a `length(...) > 0` check.
    expect(encodeMessageParameters({}).byteLength).toBeGreaterThan(0);
  });
});
