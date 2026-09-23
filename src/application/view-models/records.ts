/**
 * The app and records surfaces (M37; SCR-024–032; MOD-009/010/011;
 * SHT-002/003/016; STA-011/012; CAP-15–CAP-17, CAP-24, CAP-25).
 *
 * Sources: `mocks/app-home.html` (SCR-024), `mocks/records.html` (SCR-025),
 * `mocks/records-empty.html` (SCR-026), `mocks/record-detail.html` (SCR-027),
 * `mocks/record-create.html` (SCR-028), `mocks/record-edit.html` (SCR-029),
 * `mocks/change-history.html` (SCR-032).
 *
 * Four truths the *types* hold:
 *
 * 1. **A page is not a count.** `RecordPageViewV1.totalCount` is the count of
 *    live records in the *table*, exact, and a search does not narrow it. How
 *    many records matched is `matchCount`, and it is present only when the
 *    worker counted it (CA-29): a plain search and a partial page answer none,
 *    and `records.length` is never offered in its place.
 * 2. **The change log begins at the last checkpoint.** It is not "the app's
 *    history": a freshly imported app's log is truthfully empty because its
 *    rows arrived in the checkpoint, not as authored events. {@link ChangeHistoryVm}
 *    states that scope so no surface can imply completeness.
 * 3. **A receipt with no commit is a no-op, not a failure.** `commitId: null`
 *    means the command was already true and wrote nothing;
 *    {@link RecordCommandOutcomeVm} gives it its own member so it can never be
 *    rendered as an error.
 * 4. **The three absent states stay three.** `missing`, `blank` and
 *    `invalid-preserved` are distinct members, because collapsing any two loses
 *    what the person fixing the record has to see (FR-4/FR-6).
 *
 * F03 adds what a workbook app needs (CAP-24, CA-21): reference cells that
 * read as their parent's human label or as a broken reference with its
 * original key (D36, STA-011), the detail's "Belongs to" / "Has many" /
 * "Missing related record" sections, the reference picker (SHT-002), the
 * table switcher (SHT-003), history entries that name their table, and
 * MOD-010's original values. Two more truths are held by type:
 *
 * 5. **A broken reference carries its original key.** `ReferenceCellVm`'s
 *    `broken` member has `originalKey: string`; the one case where the worker
 *    knows no key is its own member, so no surface can print a broken
 *    reference with the key silently missing.
 * 6. **A related record's label is never blank.** {@link RecordLabelV1} is
 *    only made by {@link toRecordLabel}, which states the absence in words.
 *
 * No time is formatted and no number is localised — a view model holds no
 * clock and no locale.
 */

import type {
  AppFieldViewV1,
  AppMetricsViewV1,
  ChartDatasetViewV1,
  ChartDefinitionWireV1,
  ChartGroupingWireV1,
  ChartKeyWireV1,
  ChartMarkWireV1,
  ChartMeasureWireV1,
  StructureRelationshipViewV1,
  AppSessionViewV1,
  AppStructureViewV1,
  AppTableViewV1,
  AppThemeWireV1,
  CellRangeWireV1,
  CellWireEntryV1,
  CellWireValueV1,
  ChangeHistoryCursorWireV1,
  ComputedCellWireV1,
  ChangeHistoryPageViewV1,
  DeletedRecordViewV1,
  FieldTypeWireV1,
  FilterRefusalWireV1,
  FilterWireV1,
  InertItemKindWireV1,
  InertItemViewV1,
  InertReasonKeyWireV1,
  MetricViewV1,
  RecordCommandOutcomeV1,
  RecordDetailViewV1,
  RecordIssueViewV1,
  RecordPageViewV1,
  RecordReferenceViewV1,
  RecordScopeWireV1,
  RecordSummaryViewV1,
  RelatedChildrenPageViewV1,
  RelatedChildrenViewV1,
  RelatedRecordViewV1,
  RelatedRecordsViewV1,
  SheetClassificationWireV1,
  SheetSnapshotViewV1,
  SnapshotCellKindWireV1,
  SnapshotFindResultV1,
  SnapshotPageViewV1,
  SortWireV1,
} from "../../workers/protocol/messages.js";

// --- labels and references -------------------------------------------------

declare const RECORD_LABEL: unique symbol;

/**
 * A related record's human label (label field, else key — CA-21). Branded so
 * that only {@link toRecordLabel} can make one: a label that came back empty
 * is stated in words, never rendered as a blank.
 */
export type RecordLabelV1 = string & { readonly [RECORD_LABEL]: true };

/** The words a record with nothing to lead with is called by (SCR-025 precedent). */
export const UNLABELLED_RECORD = "A record with no value to lead with";

export function toRecordLabel(text: string): RecordLabelV1 {
  return (text.trim() === "" ? UNLABELLED_RECORD : text) as RecordLabelV1;
}

/**
 * Where one reference field points (CTL-070/071, STA-011).
 *
 * - `resolved` — a live record, by id and human label.
 * - `broken` — nothing live answers the reference; the original key is the
 *   imported text that matched no parent, or the deleted parent's key, read
 *   from the authored value or the deleted record (D36) — never from an issue.
 * - `broken-unkeyed` — broken, and no key was ever recorded for it. Its own
 *   member so that `broken` can require its key.
 * - `pending` — a reference whose label has not been read yet (CTL-070's
 *   "loading local value"); it is said, not left blank.
 *
 * `relationName` is the reference field's name: STA-011's "named missing
 * relation".
 */
export type ReferenceCellVm =
  | {
      readonly kind: "resolved";
      readonly recordId: string;
      readonly tableId: string;
      readonly label: RecordLabelV1;
    }
  | {
      readonly kind: "broken";
      readonly originalKey: string;
      readonly relationName: string;
    }
  | { readonly kind: "broken-unkeyed"; readonly relationName: string }
  | { readonly kind: "pending"; readonly recordId: string };

/** One wire reference as a cell. `sourceText` is the authored value's own text. */
export function toReferenceCell(
  reference: RecordReferenceViewV1,
  relationName: string,
  sourceText: string | null = null,
): ReferenceCellVm {
  if (reference.status === "resolved") {
    return {
      kind: "resolved",
      recordId: reference.recordId,
      tableId: reference.tableId,
      label: toRecordLabel(reference.label),
    };
  }
  const originalKey = reference.originalKey ?? sourceText;
  return originalKey === null
    ? { kind: "broken-unkeyed", relationName }
    : { kind: "broken", originalKey, relationName };
}

// --- values ------------------------------------------------------------------

/**
 * One cell as a surface may show it. The nine members mirror the wire's nine
 * exactly: a projection that merged any of them would be reshaping the
 * contract, and the distinctions are the point.
 */
export type RecordValueVm =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly decimal: string }
  | { readonly kind: "boolean"; readonly boolean: boolean }
  | {
      readonly kind: "option";
      readonly optionId: string;
      /** The option's label, or `null` when the schema no longer carries it. */
      readonly label: string | null;
      readonly isActive: boolean;
    }
  | { readonly kind: "date"; readonly epochDay: number }
  /** Deliberately cleared. */
  | { readonly kind: "blank" }
  /** Never given a value. */
  | { readonly kind: "missing" }
  /** Kept exactly as imported, and flagged (FR-4/FR-6). */
  | { readonly kind: "invalid-preserved"; readonly sourceText: string }
  /**
   * A reference field's value: resolved to a label, or broken with its
   * original key. An imported key that matched no parent arrives on the wire
   * as a preserved-invalid value in a reference field (D36) and is shown here
   * as the broken reference it is.
   */
  | { readonly kind: "reference"; readonly reference: ReferenceCellVm };

/**
 * A device handoff a value offers. `dial`, `email` and `open-url` carry a
 * complete href because `tel:`, `mailto:` and `http(s)` are unambiguous
 * schemes. `maps` carries only the query: there is no registered URI scheme
 * for a textual address, so choosing one is a platform decision (M51), not a
 * URL this module is entitled to invent.
 */
export type RecordHandoffVm =
  | { readonly kind: "dial"; readonly href: string }
  | { readonly kind: "email"; readonly href: string }
  | { readonly kind: "open-url"; readonly href: string }
  | { readonly kind: "maps"; readonly query: string };

/** Only these two schemes may become an href; anything else offers nothing. */
const SAFE_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

function safeUrlHandoff(text: string): RecordHandoffVm | null {
  try {
    const url = new URL(text);
    return SAFE_URL_SCHEMES.has(url.protocol)
      ? { kind: "open-url", href: url.toString() }
      : null;
  } catch {
    return null;
  }
}

/** Everything a `tel:` may contain; anything else is not a dialable number. */
const NOT_DIALABLE = /[^0-9+*#,;()\-. ]/u;

export function handoffFor(
  type: FieldTypeWireV1,
  value: RecordValueVm,
): RecordHandoffVm | null {
  if (value.kind !== "text") {
    return null;
  }
  const text = value.text.trim();
  if (text.length === 0) {
    return null;
  }
  switch (type.kind) {
    case "phone":
      return NOT_DIALABLE.test(text)
        ? null
        : { kind: "dial", href: `tel:${text.replace(/[ ().-]/gu, "")}` };
    case "email":
      return text.includes("@")
        ? { kind: "email", href: `mailto:${text}` }
        : null;
    case "url":
      return safeUrlHandoff(text);
    case "address":
      return { kind: "maps", query: text };
    default:
      return null;
  }
}

function toValue(
  value: CellWireValueV1,
  field: AppFieldViewV1 | undefined,
  references?: ReadonlyMap<string, RecordReferenceViewV1>,
): RecordValueVm {
  if (
    field?.type.kind === "reference" &&
    (value.kind === "reference" || value.kind === "invalid")
  ) {
    const sourceText = value.kind === "invalid" ? value.sourceText : null;
    const wire = references?.get(field.fieldId);
    if (wire !== undefined) {
      return {
        kind: "reference",
        reference: toReferenceCell(wire, field.displayName, sourceText),
      };
    }
    return {
      kind: "reference",
      reference:
        value.kind === "reference"
          ? { kind: "pending", recordId: value.recordId }
          : {
              kind: "broken",
              originalKey: value.sourceText,
              relationName: field.displayName,
            },
    };
  }
  switch (value.kind) {
    case "invalid":
      return { kind: "invalid-preserved", sourceText: value.sourceText };
    case "option": {
      const option = field?.enumOptions.find(
        (candidate) => candidate.optionId === value.optionId,
      );
      return {
        kind: "option",
        optionId: value.optionId,
        label: option?.label ?? null,
        isActive: option?.isActive ?? false,
      };
    }
    case "reference":
      // A reference in a field that is not a reference field: nothing names
      // what it points at, so it is not shown as a label it does not have.
      return { kind: "reference", reference: { kind: "pending", recordId: value.recordId } };
    default:
      return value;
  }
}

/** A record's wire references, by the field that holds them. */
function referencesByField(
  references: readonly RecordReferenceViewV1[] | undefined,
): ReadonlyMap<string, RecordReferenceViewV1> {
  return new Map((references ?? []).map((reference) => [reference.fieldId, reference]));
}

/** "1 change" / "2 changes": the live region reads the number it states. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

// --- computed values (CA-26; D51) -------------------------------------------

const CYCLE_SENTENCE = "This calculation depends on itself";

/** Each error code's plain reason, beside the code itself. */
const ERROR_REASON: Readonly<Record<string, string>> = Object.freeze({
  "#NULL!": "two ranges do not meet",
  "#DIV/0!": "it divides by zero",
  "#VALUE!": "a value is the wrong kind for the calculation",
  "#REF!": "it refers to something that is not there",
  "#NAME?": "it uses a name Sheaf does not know",
  "#NUM!": "a number is out of range",
  "#N/A": "a value it looks for is not available",
  "#BUDGET": "it needed more work than one calculation may do",
});

function errorSentence(code: string | null | undefined): string {
  if (code === null || code === undefined) return "The calculation could not produce a value";
  const reason = ERROR_REASON[code];
  return reason === undefined
    ? `${code}: the calculation could not produce a value`
    : `${code}: ${reason}`;
}

/** "Calculation result is not a {type}" — the type as a person names it. */
const TYPE_NOUN: Readonly<Record<FieldTypeWireV1["kind"], string>> = Object.freeze({
  text: "text value",
  number: "number",
  currency: "currency amount",
  date: "date",
  boolean: "yes-or-no value",
  enum: "choice",
  phone: "phone number",
  email: "email address",
  url: "web address",
  address: "address",
  reference: "related record",
});

/** What the app's structure says about one computed column. */
export interface ComputedFieldVm {
  readonly fieldId: string;
  /** The expression in the app's current names (D58); null when unknown. */
  readonly expression: string | null;
  readonly disposition: "live" | "frozen" | "unsupported";
}

/** The app's computed columns, by field id. Absent structure knows none. */
export function computedFieldsOf(
  structure: AppStructureViewV1 | null | undefined,
): ReadonlyMap<string, ComputedFieldVm> {
  const computed = new Map<string, ComputedFieldVm>();
  for (const formula of structure?.formulas ?? []) {
    if (formula.isActive && formula.target.kind === "computed-column") {
      computed.set(formula.target.fieldId, {
        fieldId: formula.target.fieldId,
        expression: formula.text,
        disposition: formula.disposition,
      });
    }
  }
  return computed;
}

/**
 * A computed cell as a surface shows it (CA-26's last column). It is never an
 * input: `badge` says what kind of value it is, `note` the plain reason when
 * there is no result. `state` is null only where no value exists yet — a
 * record being created.
 */
export interface ComputedCellVm {
  readonly state: ComputedCellWireV1["state"] | null;
  readonly badge: "Live" | "Frozen at import" | "Unsupported formula";
  readonly note: string | null;
  readonly expression: string | null;
}

function badgeFor(
  state: ComputedCellWireV1["state"] | null,
  disposition: ComputedFieldVm["disposition"] | undefined,
): ComputedCellVm["badge"] {
  if (state === "frozen" || (state === null && disposition === "frozen")) return "Frozen at import";
  if (state === "unsupported" || state === "unsupported-new-row" || (state === null && disposition === "unsupported")) {
    return "Unsupported formula";
  }
  return "Live";
}

function computedNote(
  computed: ComputedCellWireV1 | undefined,
  type: FieldTypeWireV1,
): string | null {
  if (computed === undefined) return null;
  switch (computed.state) {
    case "ok":
    case "empty":
    case "frozen":
      return null;
    case "type":
      return `Calculation result is not a ${TYPE_NOUN[type.kind]}`;
    case "error":
      return errorSentence(computed.code);
    case "cycle":
      return CYCLE_SENTENCE;
    case "unsupported":
      // STA-013: the value shown is the one the workbook held.
      return "Imported value kept · Sheaf cannot recalculate this formula";
    case "unsupported-new-row":
      // STA-013: never zero — a row the workbook never calculated stays empty.
      return "Left empty and flagged · Sheaf cannot calculate this formula for a new row";
    default: {
      const unreachable: never = computed.state;
      return unreachable;
    }
  }
}

/** Null for an authored field: no wire marker and no computed column known. */
function toComputedCell(
  field: AppFieldViewV1,
  entry: CellWireEntryV1 | undefined,
  computedFields: ReadonlyMap<string, ComputedFieldVm>,
): ComputedCellVm | null {
  const known = computedFields.get(field.fieldId);
  const marker = entry?.computed;
  if (known === undefined && marker === undefined) return null;
  const state = marker?.state ?? null;
  return {
    state,
    badge: badgeFor(state, known?.disposition),
    note: computedNote(marker, field.type),
    expression: known?.expression ?? null,
  };
}

/**
 * D60's announcement: which computed columns moved, by name, never their
 * values — "Balance recalculated." Empty when nothing moved, so a live region
 * says nothing rather than something vague.
 */
export function announceRecalculated(
  fieldIds: readonly string[],
  fields: readonly AppFieldViewV1[],
): string {
  const names = new Map(fields.map((field) => [field.fieldId, field.displayName]));
  const named = fieldIds.flatMap((fieldId) => {
    const name = names.get(fieldId);
    return name === undefined ? [] : [name];
  });
  if (named.length === 0) {
    return fieldIds.length === 0 ? "" : `${plural(fieldIds.length, "calculated value", "calculated values")} recalculated.`;
  }
  const last = named.at(-1) as string;
  return named.length === 1
    ? `${last} recalculated.`
    : `${named.slice(0, -1).join(", ")} and ${last} recalculated.`;
}

// --- SCR-024 app home (app-home.html) ---------------------------------------

export interface AppHomeTableVm {
  readonly tableId: string;
  readonly displayName: string;
  readonly recordCount: number;
  /** Always `true`: `count(*)` over the hydrated table (CA-14). */
  readonly isRecordCountExact: true;
  readonly fieldCount: number;
}

/**
 * One "At a glance" value (SCR-024; CA-26): a table metric or a dashboard
 * value, with its status in words. `value` is present for `ok` only; every
 * other status says what happened instead of showing a number.
 */
export interface MetricVm {
  readonly formulaId: string;
  readonly label: string;
  /** The table a metric summarises; null for a dashboard value. */
  readonly tableName: string | null;
  readonly status: MetricViewV1["status"];
  readonly value: RecordValueVm | null;
  /** "Live" for a result; otherwise the plain reason there is none. */
  readonly note: string;
  /** The expression in the app's current names, when the structure is known. */
  readonly expression: string | null;
}

/**
 * SCR-024. `metrics` holds only the metrics and dashboard values this app
 * actually has — none is an empty list, and the surface draws no "At a
 * glance" section for it. There is no chart field: the pinned chart is
 * S05's, and a field here could only ever be filled with a fiction (STA-025).
 */
export interface AppHomeVm {
  readonly screen: "SCR-024";
  readonly appId: string;
  readonly displayName: string;
  readonly theme: AppThemeWireV1;
  /** The persistent scratch fact: no durable home exists (D26). */
  readonly isScratch: boolean;
  readonly deviceOnlyChangeCount: number;
  readonly tables: readonly AppHomeTableVm[];
  readonly createdAtEpochMs: number;
  readonly lastOpenedAtEpochMs: number | null;
  readonly metrics: readonly MetricVm[];
  /** SCR-024's pinned charts, in display order; none until they are read. */
  readonly pinnedCharts: readonly ChartDetailVm[];
  readonly announcement: string;
}

/** A metric with no result, in words (CA-26's last column). */
function metricNote(metric: MetricViewV1): string {
  switch (metric.status) {
    case "ok":
    case "empty":
      return "Live";
    case "unsupported":
      return "Unsupported formula";
    case "cycle":
      return CYCLE_SENTENCE;
    case "error":
      return errorSentence(metric.code);
    default: {
      const unreachable: never = metric.status;
      return unreachable;
    }
  }
}

/**
 * Dashboard values first, then each table's metrics in table order — the
 * app-home.html tiles. `structure` names each expression; absent, none is shown.
 */
export function selectMetricsVm(
  metrics: AppMetricsViewV1 | null,
  tables: readonly AppTableViewV1[],
  structure: AppStructureViewV1 | null = null,
): readonly MetricVm[] {
  if (metrics === null) return [];
  const tableNames = new Map(tables.map((table) => [table.tableId, table.displayName]));
  const expressions = new Map((structure?.formulas ?? []).map((formula) => [formula.formulaId, formula.text]));
  const toMetric = (metric: MetricViewV1, tableName: string | null): MetricVm => ({
    formulaId: metric.formulaId,
    label: metric.displayName,
    tableName,
    status: metric.status,
    value: metric.status === "ok" && metric.value !== null ? toValue(metric.value, undefined) : null,
    note: metricNote(metric),
    expression: expressions.get(metric.formulaId) ?? null,
  });
  return [
    ...metrics.dashboard.map((metric) => toMetric(metric, null)),
    ...metrics.tables.flatMap((group) =>
      group.metrics.map((metric) => toMetric(metric, tableNames.get(group.tableId) ?? null)),
    ),
  ];
}

export function selectAppHomeVm(
  session: AppSessionViewV1,
  metrics: readonly MetricVm[] = [],
  pinnedCharts: readonly ChartDetailVm[] = [],
): AppHomeVm {
  return {
    screen: "SCR-024",
    appId: session.appId,
    displayName: session.displayName,
    theme: session.theme,
    isScratch: session.isScratch,
    deviceOnlyChangeCount: session.deviceOnlyChangeCount,
    tables: session.tables.map((table) => ({
      tableId: table.tableId,
      displayName: table.displayName,
      recordCount: table.recordCount,
      isRecordCountExact: true,
      fieldCount: table.fields.length,
    })),
    createdAtEpochMs: session.createdAtEpochMs,
    lastOpenedAtEpochMs: session.lastOpenedAtEpochMs,
    metrics,
    pinnedCharts,
    // app-home.html's status line, composed from the two facts F02 holds.
    announcement: session.isScratch
      ? `${session.displayName} is on this device only. ${
          session.deviceOnlyChangeCount === 1
            ? "1 change has"
            : `${String(session.deviceOnlyChangeCount)} changes have`
        } no durable copy.`
      : `${session.displayName} is open.`,
  };
}

// --- SCR-025 / SCR-026 the record list --------------------------------------

export interface RecordFactVm {
  readonly fieldId: string;
  readonly displayName: string;
  readonly value: RecordValueVm;
}

/** records.html: one label, then at most three supporting facts. */
export const MAX_SUPPORTING_FACTS = 3;

export interface RecordCardVm {
  readonly recordId: string;
  readonly recordRevision: number;
  /** Pass back as `cursor`; a row key, never an offset. */
  readonly cursor: number;
  /** `null` when no field carried text to lead with; the surface says so. */
  readonly label: RecordFactVm | null;
  readonly facts: readonly RecordFactVm[];
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
}

/**
 * Why the list is showing nothing. records-empty.html states the rule: an
 * empty table and a query that matched nothing stay visibly different,
 * because clearing the search or the filters fixes one and does nothing for
 * the other. `no-results` is SCR-026's filtered no-result state (STA-026).
 */
export type RecordsEmptinessV1 = "empty-table" | "no-results";

/** A records filter and a sort as the route holds and sends them (CA-29). */
export type RecordsFilterV1 = FilterWireV1;
export type RecordsSortV1 = SortWireV1;

/** The sheet a field's filter chip opens (sheet-atlas.html). */
export type FilterSheetIdV1 = "SHT-004" | "SHT-005" | "SHT-006" | "SHT-007" | "SHT-008";

/**
 * Only the types the design gives a filter sheet get a chip. Text fields are
 * found through the search; a text filter that arrives as an intent (S05) is
 * still shown, and still clearable, as a chip without a sheet.
 */
export function filterSheetFor(type: FieldTypeWireV1): FilterSheetIdV1 | null {
  switch (type.kind) {
    case "enum":
      return "SHT-004";
    case "date":
      return "SHT-005";
    case "number":
    case "currency":
      return "SHT-006";
    case "boolean":
      return "SHT-007";
    case "reference":
      return "SHT-008";
    default:
      return null;
  }
}

/**
 * What an active filter says, typed so the surface formats dates and amounts
 * in the reader's locale (a view model holds none).
 */
export type FilterChipValueVm =
  | { readonly kind: "options"; readonly labels: readonly string[] }
  | { readonly kind: "date-range"; readonly from: number | null; readonly to: number | null }
  | { readonly kind: "number-range"; readonly min: string | null; readonly max: string | null }
  | { readonly kind: "boolean"; readonly value: boolean }
  /** `labels` are those known; `count` is how many records the filter names. */
  | { readonly kind: "records"; readonly labels: readonly RecordLabelV1[]; readonly count: number }
  | { readonly kind: "broken-reference" }
  | { readonly kind: "text"; readonly match: "contains" | "equals"; readonly text: string }
  | { readonly kind: "empty" }
  | { readonly kind: "not-empty" };

/** One active filter: visible, and clearable on its own (STA-026). */
export interface FilterChipVm {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly sheet: FilterSheetIdV1 | null;
  readonly value: FilterChipValueVm;
  /** What the route sends; clearing the chip removes exactly this. */
  readonly filter: FilterWireV1;
}

/** A field a filter can be added on (records.html's inactive chips). */
export interface FilterableFieldVm {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly sheet: FilterSheetIdV1;
  readonly type: FieldTypeWireV1;
  readonly isFiltered: boolean;
  /**
   * Every option an enum field has had, retired ones included: filtering by a
   * retired option still finds the records that hold it. Empty otherwise.
   */
  readonly enumOptions: readonly { readonly optionId: string; readonly label: string; readonly isActive: boolean }[];
}

/** SHT-009: one column and one direction; missing values sort last either way. */
export interface SortVm {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly direction: "asc" | "desc";
}

/**
 * STA-014 (D53, D62): the query examined exactly `scanned` of the table's
 * `tableTotal` rows and stopped. The surface composes "Searched the first
 * {n} of {total} rows" from these two facts and offers the remedy.
 */
export interface RecordsPartialVm {
  readonly scanned: number;
  readonly tableTotal: number;
  readonly remedy: "narrow-filters";
}

export interface RecordsListVm {
  readonly screen: "SCR-025" | "SCR-026";
  readonly tableId: string;
  readonly tableName: string;
  /** What was actually looked at — the sentence an empty state needs. */
  readonly scope: RecordScopeWireV1;
  readonly cards: readonly RecordCardVm[];
  readonly hasMore: boolean;
  readonly nextCursor: number | null;
  /**
   * Live records in the whole table, exact. A search or a filter does not
   * narrow it (CA-14).
   */
  readonly tableRecordCount: number;
  readonly isTableRecordCountExact: true;
  /**
   * How many records match the search and filters, exactly — or null when
   * nothing counted them: a plain search, or a partial page, which never
   * reports a total it did not count (CA-29).
   */
  readonly matchCount: number | null;
  readonly partial: RecordsPartialVm | null;
  readonly filters: readonly FilterChipVm[];
  readonly filterableFields: readonly FilterableFieldVm[];
  readonly sort: SortVm | null;
  /** SHT-009 lists every column. */
  readonly sortableFields: readonly { readonly fieldId: string; readonly fieldName: string }[];
  readonly emptiness: RecordsEmptinessV1 | null;
  /**
   * The chart whose tapped mark set these filters (D63), named in the list
   * heading and its announcement; null for filters chosen here.
   */
  readonly chartOrigin: string | null;
  readonly announcement: string;
}

/** The records query a list shows: the search, every filter, one sort. */
export interface RecordsQueryVmInput {
  readonly filters: readonly FilterWireV1[];
  readonly sort: SortWireV1 | null;
  /** Labels of records a reference filter names, as the picker showed them. */
  readonly recordLabels?: ReadonlyMap<string, string>;
  /** The chart a mark's filter came from, while any filter is applied. */
  readonly chartOrigin?: string | null;
}

function fieldsInOrder(table: AppTableViewV1): readonly AppFieldViewV1[] {
  return [...table.fields]
    .filter((field) => field.isActive)
    .sort((left, right) => left.fieldOrdinal - right.fieldOrdinal);
}

function toFact(
  entry: CellWireEntryV1,
  field: AppFieldViewV1,
  references?: ReadonlyMap<string, RecordReferenceViewV1>,
): RecordFactVm {
  return {
    fieldId: field.fieldId,
    displayName: field.displayName,
    value: toValue(entry.value, field, references),
  };
}

/** A value worth leading a card with: one that actually says something. */
function isRenderable(value: RecordValueVm): boolean {
  return value.kind !== "blank" && value.kind !== "missing";
}

function toCard(
  record: RecordSummaryViewV1,
  fields: readonly AppFieldViewV1[],
  references?: readonly RecordReferenceViewV1[],
): RecordCardVm {
  const byField = new Map(record.values.map((entry) => [entry.fieldId, entry]));
  const byReference = referencesByField(references);
  const facts: RecordFactVm[] = [];
  for (const field of fields) {
    const entry = byField.get(field.fieldId);
    if (entry === undefined) {
      continue;
    }
    const fact = toFact(entry, field, byReference);
    if (isRenderable(fact.value)) {
      facts.push(fact);
    }
  }

  return {
    recordId: record.recordId,
    recordRevision: record.recordRevision,
    cursor: record.cursor,
    label: facts[0] ?? null,
    facts: facts.slice(1, 1 + MAX_SUPPORTING_FACTS),
    blockingIssueCount: record.blockingIssueCount,
    warningIssueCount: record.warningIssueCount,
  };
}

function chipValue(
  filter: FilterWireV1,
  field: AppFieldViewV1 | undefined,
  recordLabels: ReadonlyMap<string, string>,
): FilterChipValueVm {
  const operand = filter.operand;
  switch (operand.kind) {
    case "enum-in":
      return {
        kind: "options",
        labels: operand.optionIds.map(
          (optionId) =>
            field?.enumOptions.find((option) => option.optionId === optionId)?.label ??
            "A choice that is no longer in this field's list",
        ),
      };
    case "date-range":
      return { kind: "date-range", from: operand.from, to: operand.to };
    case "number-range":
      return { kind: "number-range", min: operand.min, max: operand.max };
    case "boolean-is":
      return { kind: "boolean", value: operand.value };
    case "reference-in":
      return {
        kind: "records",
        count: operand.recordIds.length,
        labels: operand.recordIds.flatMap((recordId) => {
          const label = recordLabels.get(recordId);
          return label === undefined ? [] : [toRecordLabel(label)];
        }),
      };
    case "reference-broken":
      return { kind: "broken-reference" };
    case "text-contains":
      return { kind: "text", match: "contains", text: operand.text };
    case "text-equals":
      return { kind: "text", match: "equals", text: operand.text };
    case "is-empty":
      return { kind: "empty" };
    case "not-empty":
      return { kind: "not-empty" };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

/** A filter on a field this table no longer shows is still named, and clearable. */
const UNKNOWN_FIELD_NAME = "A field that is no longer in this table";

/**
 * `references` are each record's reference fields as `getRelatedRecords`
 * answered them, by record id; a record absent from the map shows its
 * references as `pending` rather than as a blank.
 */
export function selectRecordsListVm(
  table: AppTableViewV1,
  page: RecordPageViewV1,
  references?: ReadonlyMap<string, readonly RecordReferenceViewV1[]>,
  query: RecordsQueryVmInput = { filters: [], sort: null },
): RecordsListVm {
  const fields = fieldsInOrder(table);
  const fieldById = new Map(table.fields.map((field) => [field.fieldId, field]));
  const cards = page.records.map((record) =>
    toCard(record, fields, references?.get(record.recordId)),
  );
  const recordLabels = query.recordLabels ?? new Map<string, string>();
  const filters = query.filters.map<FilterChipVm>((filter) => {
    const field = fieldById.get(filter.fieldId);
    return {
      fieldId: filter.fieldId,
      fieldName: field?.displayName ?? UNKNOWN_FIELD_NAME,
      sheet: field === undefined ? null : filterSheetFor(field.type),
      value: chipValue(filter, field, recordLabels),
      filter,
    };
  });
  const filtered = new Set(query.filters.map((filter) => filter.fieldId));
  const sortField = query.sort === null ? undefined : fieldById.get(query.sort.fieldId);

  const emptiness: RecordsEmptinessV1 | null =
    cards.length > 0
      ? null
      : page.totalCount === 0
        ? "empty-table"
        : "no-results";
  const partial: RecordsPartialVm | null =
    page.partial === undefined || page.partial === null
      ? null
      : { scanned: page.partial.scanned, tableTotal: page.partial.tableTotal, remedy: page.partial.remedy };
  const matchCount = partial === null ? (page.total ?? null) : null;

  return {
    screen: emptiness === null ? "SCR-025" : "SCR-026",
    tableId: page.tableId,
    tableName: table.displayName,
    scope: page.scope,
    cards,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    tableRecordCount: page.totalCount,
    isTableRecordCountExact: true,
    matchCount,
    partial,
    filters,
    filterableFields: fields.flatMap((field) => {
      const sheet = filterSheetFor(field.type);
      return sheet === null
        ? []
        : [
            {
              fieldId: field.fieldId,
              fieldName: field.displayName,
              sheet,
              type: field.type,
              isFiltered: filtered.has(field.fieldId),
              enumOptions: field.enumOptions.map((option) => ({
                optionId: option.optionId,
                label: option.label,
                isActive: option.isActive,
              })),
            },
          ];
    }),
    sort:
      query.sort === null
        ? null
        : {
            fieldId: query.sort.fieldId,
            fieldName: sortField?.displayName ?? UNKNOWN_FIELD_NAME,
            direction: query.sort.direction,
          },
    sortableFields: fields.map((field) => ({ fieldId: field.fieldId, fieldName: field.displayName })),
    emptiness,
    chartOrigin: filters.length === 0 ? null : (query.chartOrigin ?? null),
    announcement: announceList({
      chartOrigin: filters.length === 0 ? null : (query.chartOrigin ?? null),
      tableName: table.displayName,
      tableRecordCount: page.totalCount,
      emptiness,
      search: page.scope.kind === "search" ? page.scope : null,
      filterCount: filters.length,
      matchCount,
      partial,
    }),
  };
}

/**
 * Why the worker refused a filter or the sort (CA-29), naming the column and
 * never the value. The refused query ran nothing; its chips stay, so the
 * filter at fault can be cleared.
 */
export function describeFilterRefusal(refusal: FilterRefusalWireV1, table: AppTableViewV1): string {
  const name = table.fields.find((field) => field.fieldId === refusal.fieldId)?.displayName ?? UNKNOWN_FIELD_NAME;
  switch (refusal.reason) {
    case "unknown-field":
      return `${name} is not a column of ${table.displayName} any more, so nothing was searched. Clear its filter or sort.`;
    case "operator-type-mismatch":
      return `That filter does not fit ${name}, so nothing was searched. Clear it and choose again.`;
    case "unknown-option":
      return `A chosen ${name} option is no longer in its list, so nothing was searched. Clear it and choose again.`;
    case "inverted-range":
      return `The ${name} range starts after it ends, so nothing was searched.`;
    case "empty-filter":
      return `The ${name} filter chooses nothing, so nothing was searched.`;
    case "invalid-value":
      return `A ${name} filter value is not one Sheaf can compare, so nothing was searched.`;
    default: {
      const unreachable: never = refusal.reason;
      return unreachable;
    }
  }
}

/** "1 active filter excludes" / "2 active filters exclude" (records-empty.html). */
export function describeActiveFilters(count: number): string {
  return count === 1 ? "1 active filter excludes" : `${String(count)} active filters exclude`;
}

function announceList(input: {
  readonly chartOrigin: string | null;
  readonly tableName: string;
  readonly tableRecordCount: number;
  readonly emptiness: RecordsEmptinessV1 | null;
  readonly search: Extract<RecordScopeWireV1, { kind: "search" }> | null;
  readonly filterCount: number;
  readonly matchCount: number | null;
  readonly partial: RecordsPartialVm | null;
}): string {
  const { chartOrigin, tableName, tableRecordCount, emptiness, search, filterCount, matchCount, partial } = input;
  // design.md: selecting a mark announces the filter and updates the heading.
  const origin = chartOrigin === null ? "" : `Selected mark · ${chartOrigin}. `;
  const table = `The table contains ${String(tableRecordCount)} records.`;
  if (emptiness === "empty-table") {
    // records-empty.html: "This table contains zero records."
    return `${tableName} contains no records yet.`;
  }
  const partialLine =
    partial === null
      ? ""
      : ` Searched the first ${String(partial.scanned)} of ${String(partial.tableTotal)} rows.`;
  if (emptiness === "no-results") {
    if (filterCount === 0) {
      // records-empty.html keeps the count of the table, not of the search.
      return `No record in ${tableName} matches “${search?.text ?? ""}”. ${table}${partialLine}`;
    }
    return `${origin}No record in ${tableName} matches ${search === null ? "these filters" : `“${search.text}” with these filters`}. ${table} ${describeActiveFilters(
      filterCount,
    )} all of them.${partialLine}`;
  }
  if (search === null && filterCount === 0) {
    return `${tableName} contains ${String(tableRecordCount)} records.`;
  }
  const matched = matchCount === null ? "" : ` ${String(matchCount)} match.`;
  const what =
    search === null
      ? `Showing records in ${tableName} that match the filters.`
      : `Showing records in ${tableName} matching “${search.text}”${filterCount === 0 ? "" : " and the filters"}.`;
  return `${origin}${what}${matched} ${table}${partialLine}`;
}

// --- SHT-003 the table switcher (CTL-059) ----------------------------------

export interface TableSwitcherEntryVm {
  readonly tableId: string;
  readonly displayName: string;
  /** Exact: `count(*)` over the hydrated table (CA-14). */
  readonly recordCount: number;
  readonly isCurrent: boolean;
}

/** SHT-003: "tables, row counts, current table" — the atlas's three, nothing else. */
export interface TableSwitcherVm {
  readonly sheet: "SHT-003";
  readonly tables: readonly TableSwitcherEntryVm[];
  /** Null on a surface that is not one table's (the app home). */
  readonly current: TableSwitcherEntryVm | null;
}

export function selectTableSwitcherVm(
  tables: readonly AppTableViewV1[],
  currentTableId: string | null,
): TableSwitcherVm {
  const entries = [...tables]
    .sort((left, right) => left.tableOrdinal - right.tableOrdinal)
    .map((table) => ({
      tableId: table.tableId,
      displayName: table.displayName,
      recordCount: table.recordCount,
      isCurrent: table.tableId === currentTableId,
    }));
  return {
    sheet: "SHT-003",
    tables: entries,
    current: entries.find((entry) => entry.isCurrent) ?? null,
  };
}

// --- SCR-027 record detail (record-detail.html) -----------------------------

export interface RecordDetailFieldVm extends RecordFactVm {
  readonly type: FieldTypeWireV1;
  /** `tel:`/`mailto:`/`https:` where the scheme is unambiguous (FR-12). */
  readonly handoff: RecordHandoffVm | null;
  /** False when the projection could not index it; it is authored-only. */
  readonly isIndexed: boolean;
  readonly issues: readonly RecordIssueVm[];
  /** Present for a computed column: read-only, with its state (CA-26). */
  readonly computed: ComputedCellVm | null;
}

/** "Belongs to" (record-detail.html): one resolved parent, by human label. */
export interface BelongsToVm {
  readonly fieldId: string;
  /** The reference field that holds it. */
  readonly fieldName: string;
  readonly relationshipId: string;
  readonly recordId: string;
  readonly tableId: string;
  /** Null when the parent's table is not in this app's session any more. */
  readonly tableName: string | null;
  readonly label: RecordLabelV1;
}

/** "Missing related record" (STA-011): a broken reference, named, with its key. */
export type MissingReferenceVm = {
  readonly fieldId: string;
  readonly relationshipId: string;
} & Extract<ReferenceCellVm, { readonly kind: "broken" | "broken-unkeyed" }>;

export interface RelatedRecordVm {
  readonly recordId: string;
  readonly label: RecordLabelV1;
}

/**
 * "Has many": one relationship pointing at this record's table, seen from the
 * parent. `count` is exact; `shown` is the preview until "show all" pages
 * through `getRelatedChildren`, after which it is every page read so far.
 */
export interface HasManyVm {
  readonly relationshipId: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly count: number;
  readonly shown: readonly RelatedRecordVm[];
  /** True once "show all" has started paging. */
  readonly isExpanded: boolean;
  readonly hasMore: boolean;
  /** Pass as `after`; null starts from the first child. */
  readonly nextCursor: number | null;
}

export function selectHasManyVm(
  group: RelatedChildrenViewV1,
  pages: readonly RelatedChildrenPageViewV1[] = [],
): HasManyVm {
  const last = pages.at(-1);
  const toRelated = (child: RelatedRecordViewV1): RelatedRecordVm => ({
    recordId: child.recordId,
    label: toRecordLabel(child.label),
  });
  return last === undefined
    ? {
        relationshipId: group.relationshipId,
        tableId: group.tableId,
        tableName: group.tableName,
        count: group.count,
        shown: group.first.map(toRelated),
        isExpanded: false,
        hasMore: group.count > group.first.length,
        nextCursor: null,
      }
    : {
        relationshipId: group.relationshipId,
        tableId: group.tableId,
        tableName: group.tableName,
        count: group.count,
        shown: pages.flatMap((page) => page.children.map(toRelated)),
        isExpanded: true,
        hasMore: last.hasMore,
        nextCursor: last.nextCursor,
      };
}

/**
 * SCR-027. The relationship sections are record-detail.html's three: parents
 * this record belongs to, children per relationship, and broken references.
 * They are empty lists for a value-only table — the surface draws nothing for
 * an empty list, so no "Related records" scaffolding appears (STA-025).
 */
export interface RecordDetailVm {
  readonly screen: "SCR-027";
  readonly recordId: string;
  readonly tableId: string;
  readonly recordRevision: number;
  readonly label: RecordFactVm | null;
  readonly fields: readonly RecordDetailFieldVm[];
  readonly belongsTo: readonly BelongsToVm[];
  readonly hasMany: readonly HasManyVm[];
  readonly missing: readonly MissingReferenceVm[];
  readonly issues: readonly RecordIssueVm[];
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
  readonly announcement: string;
}

export interface RecordDetailContext {
  /** `getRelatedRecords`' answer; absent before it arrives. */
  readonly related?: RelatedRecordsViewV1 | null;
  /** Pages read by "show all", per relationship id. */
  readonly childPages?: ReadonlyMap<string, readonly RelatedChildrenPageViewV1[]>;
  /** Every table of the app, so a parent's table can be named. */
  readonly tables?: readonly AppTableViewV1[];
  /** `computedFieldsOf(structure)`: each computed column's expression. */
  readonly computedFields?: ReadonlyMap<string, ComputedFieldVm>;
}

export function selectRecordDetailVm(
  table: AppTableViewV1,
  record: RecordDetailViewV1,
  context: RecordDetailContext = {},
): RecordDetailVm {
  const fields = fieldsInOrder(table);
  const byField = new Map(record.values.map((entry) => [entry.fieldId, entry]));
  const indexed = new Set(record.indexedFieldIds);
  const issues = record.issues.map(toIssueVm);
  const parents = context.related?.parents ?? record.references ?? [];
  const byReference = referencesByField(parents);
  const fieldById = new Map(table.fields.map((field) => [field.fieldId, field]));
  const tableNames = new Map(
    (context.tables ?? [table]).map((candidate) => [candidate.tableId, candidate.displayName]),
  );

  const projected = fields.flatMap<RecordDetailFieldVm>((field) => {
    const entry = byField.get(field.fieldId);
    if (entry === undefined) {
      return [];
    }
    const value = toValue(entry.value, field, byReference);
    return [
      {
        fieldId: field.fieldId,
        displayName: field.displayName,
        value,
        type: field.type,
        handoff: handoffFor(field.type, value),
        isIndexed: indexed.has(field.fieldId),
        issues: issues.filter((issue) => issue.fieldId === field.fieldId),
        computed: toComputedCell(field, entry, context.computedFields ?? new Map()),
      },
    ];
  });

  const label = projected.find((field) => isRenderable(field.value)) ?? null;

  const belongsTo: BelongsToVm[] = [];
  const missing: MissingReferenceVm[] = [];
  for (const parent of parents) {
    const relationName = fieldById.get(parent.fieldId)?.displayName ?? "A reference";
    const entry = byField.get(parent.fieldId);
    const cell = toReferenceCell(
      parent,
      relationName,
      entry?.value.kind === "invalid" ? entry.value.sourceText : null,
    );
    if (cell.kind === "resolved") {
      belongsTo.push({
        fieldId: parent.fieldId,
        fieldName: relationName,
        relationshipId: parent.relationshipId,
        recordId: cell.recordId,
        tableId: cell.tableId,
        tableName: tableNames.get(cell.tableId) ?? null,
        label: cell.label,
      });
    } else if (cell.kind !== "pending") {
      missing.push({ ...cell, fieldId: parent.fieldId, relationshipId: parent.relationshipId });
    }
  }

  const attention = record.blockingIssueCount + record.warningIssueCount;

  return {
    screen: "SCR-027",
    recordId: record.recordId,
    tableId: record.tableId,
    recordRevision: record.recordRevision,
    label:
      label === null
        ? null
        : {
            fieldId: label.fieldId,
            displayName: label.displayName,
            value: label.value,
          },
    fields: projected,
    belongsTo,
    hasMany: (context.related?.children ?? []).map((group) =>
      selectHasManyVm(group, context.childPages?.get(group.relationshipId)),
    ),
    missing,
    issues,
    blockingIssueCount: record.blockingIssueCount,
    warningIssueCount: record.warningIssueCount,
    announcement:
      attention === 0
        ? `One record in ${table.displayName}.`
        : `One record in ${table.displayName}. ${plural(
            attention,
            "value needs",
            "values need",
          )} attention.`,
  };
}

// --- SCR-028 / SCR-029 the record form --------------------------------------

/**
 * FR-12's per-type input mapping, read off the control atlas: the keyboard and
 * the control are decided by the field's type and by nothing else, so a phone
 * field cannot come up with a text keyboard because a screen forgot.
 *
 * `reference` is SHT-002's picker (CTL-039): the person searches the related
 * table by label and the chosen record id is authored through the ordinary
 * command, which resolves it against the field's relationship (CA-21).
 */
export type FieldInputVm =
  | { readonly kind: "text"; readonly control: "text"; readonly keyboard: "text" }
  | {
      readonly kind: "number";
      readonly control: "number";
      readonly keyboard: "decimal";
    }
  | {
      readonly kind: "currency";
      readonly control: "currency";
      readonly keyboard: "decimal";
      readonly currencyCode: string;
    }
  | { readonly kind: "date"; readonly control: "native-date-picker" }
  | { readonly kind: "boolean"; readonly control: "switch" }
  | {
      readonly kind: "enum";
      readonly control: "option-sheet";
      readonly options: readonly {
        readonly optionId: string;
        readonly label: string;
      }[];
    }
  | {
      readonly kind: "email";
      readonly control: "text";
      readonly keyboard: "email";
    }
  | { readonly kind: "url"; readonly control: "text"; readonly keyboard: "url" }
  | {
      readonly kind: "phone";
      readonly control: "text";
      readonly keyboard: "tel";
    }
  | {
      readonly kind: "address";
      readonly control: "text";
      readonly keyboard: "text";
      readonly handoff: "maps";
    }
  | { readonly kind: "reference"; readonly control: "reference-picker" };

export function inputForField(field: AppFieldViewV1): FieldInputVm {
  const type = field.type;
  switch (type.kind) {
    case "text":
      return { kind: "text", control: "text", keyboard: "text" };
    case "number":
      return { kind: "number", control: "number", keyboard: "decimal" };
    case "currency":
      return {
        kind: "currency",
        control: "currency",
        keyboard: "decimal",
        currencyCode: type.currencyCode,
      };
    case "date":
      return { kind: "date", control: "native-date-picker" };
    case "boolean":
      return { kind: "boolean", control: "switch" };
    case "enum":
      return {
        kind: "enum",
        control: "option-sheet",
        options: field.enumOptions
          .filter((option) => option.isActive)
          .map((option) => ({
            optionId: option.optionId,
            label: option.label,
          })),
      };
    case "email":
      return { kind: "email", control: "text", keyboard: "email" };
    case "url":
      return { kind: "url", control: "text", keyboard: "url" };
    case "phone":
      return { kind: "phone", control: "text", keyboard: "tel" };
    case "address":
      return {
        kind: "address",
        control: "text",
        keyboard: "text",
        handoff: "maps",
      };
    case "reference":
      return { kind: "reference", control: "reference-picker" };
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export interface RecordFormFieldVm {
  readonly fieldId: string;
  readonly displayName: string;
  readonly isRequired: boolean;
  readonly input: FieldInputVm;
  /** Absent on a create form; the current value on an edit form. */
  readonly value: RecordValueVm | null;
  readonly issues: readonly RecordIssueVm[];
  /**
   * Present for a computed column, which is never an input (CA-26): the form
   * shows it read-only and sends no value for it.
   */
  readonly computed: ComputedCellVm | null;
}

export interface RecordFormVm {
  readonly screen: "SCR-028" | "SCR-029";
  readonly mode: "create" | "edit";
  readonly tableId: string;
  readonly tableName: string;
  readonly recordId: string | null;
  readonly fields: readonly RecordFormFieldVm[];
  /** Whole-record issues: a rule that spans two fields names neither alone. */
  readonly recordIssues: readonly RecordIssueVm[];
  readonly canSave: boolean;
  readonly busy: boolean;
  readonly announcement: string;
}

export function selectRecordFormVm(input: {
  readonly table: AppTableViewV1;
  readonly record?: RecordDetailViewV1;
  readonly issues?: readonly RecordIssueViewV1[];
  readonly busy?: boolean;
  /** `computedFieldsOf(structure)`; without it a create form knows none. */
  readonly computedFields?: ReadonlyMap<string, ComputedFieldVm>;
}): RecordFormVm {
  const { table, record } = input;
  const mode = record === undefined ? "create" : "edit";
  const issues = (input.issues ?? record?.issues ?? []).map(toIssueVm);
  const byField = new Map(
    (record?.values ?? []).map((entry) => [entry.fieldId, entry]),
  );
  const byReference = referencesByField(record?.references);

  const fields = fieldsInOrder(table).map<RecordFormFieldVm>((field) => {
    const entry = byField.get(field.fieldId);
    return {
      fieldId: field.fieldId,
      displayName: field.displayName,
      isRequired: field.isRequired,
      input: inputForField(field),
      value: entry === undefined ? null : toValue(entry.value, field, byReference),
      issues: issues.filter((issue) => issue.fieldId === field.fieldId),
      computed: toComputedCell(field, entry, input.computedFields ?? new Map()),
    };
  });

  const blocking = issues.filter((issue) => issue.severity === "blocking");

  return {
    screen: mode === "create" ? "SCR-028" : "SCR-029",
    mode,
    tableId: table.tableId,
    tableName: table.displayName,
    recordId: record?.recordId ?? null,
    fields,
    recordIssues: issues.filter((issue) => issue.fieldId === null),
    canSave: blocking.length === 0 && input.busy !== true,
    busy: input.busy === true,
    announcement:
      blocking.length === 0
        ? // record-create.html: "Save locally"; record-edit.html: "Ready to
          // save locally. Backup runs separately and never blocks this edit."
          "Ready to save on this device."
        : `${plural(blocking.length, "field", "fields")} must be corrected before this can be saved.`,
  };
}

// --- SHT-002 the reference picker (sheet-atlas.html) -------------------------

export interface ReferenceCandidateVm {
  readonly recordId: string;
  readonly label: RecordLabelV1;
  readonly isCurrent: boolean;
}

/**
 * SHT-002: "search related records, human label". The candidates are the
 * worker's answer for the text as typed (blank browses). Three empties stay
 * distinct: nothing to choose at all, nothing matching the search, and a
 * field that is not the source of an active relationship (the worker answers
 * `null`), which no search can fix.
 */
export interface ReferencePickerVm {
  readonly sheet: "SHT-002";
  readonly fieldName: string;
  readonly query: string;
  /** The record the field holds now, as a cell (resolved or broken). */
  readonly current: ReferenceCellVm | null;
  readonly candidates: readonly ReferenceCandidateVm[];
  readonly emptiness: "no-candidates" | "no-results" | "not-a-relationship" | null;
}

export function selectReferencePickerVm(input: {
  readonly fieldName: string;
  readonly query: string;
  readonly current: ReferenceCellVm | null;
  readonly candidates: readonly RelatedRecordViewV1[] | null;
}): ReferencePickerVm {
  const currentId =
    input.current?.kind === "resolved" || input.current?.kind === "pending"
      ? input.current.recordId
      : null;
  const candidates = (input.candidates ?? []).map((candidate) => ({
    recordId: candidate.recordId,
    label: toRecordLabel(candidate.label),
    isCurrent: candidate.recordId === currentId,
  }));
  return {
    sheet: "SHT-002",
    fieldName: input.fieldName,
    query: input.query,
    current: input.current,
    candidates,
    emptiness:
      input.candidates === null
        ? "not-a-relationship"
        : candidates.length > 0
          ? null
          : input.query.trim() === ""
            ? "no-candidates"
            : "no-results",
  };
}

// --- issues ------------------------------------------------------------------

/**
 * The closed set of reasons the validator emits. `unrecognised` is the
 * fail-closed member for a record rule's own key: a rule may carry any key,
 * and a sentence invented for an unknown one would be a guess.
 */
export type RecordIssueTokenV1 =
  | "wrong-type"
  | "required"
  | "unknown-option"
  | "inactive-option"
  | "broken-reference"
  | "preserved-invalid"
  | "unknown-field"
  | "wrong-table"
  | "unrecognised";

const ISSUE_TOKENS: Readonly<Record<string, RecordIssueTokenV1>> =
  Object.freeze({
    "validation.wrong-type": "wrong-type",
    "validation.required": "required",
    "validation.unknown-option": "unknown-option",
    "validation.inactive-option": "inactive-option",
    "validation.broken-reference": "broken-reference",
    "validation.preserved-invalid": "preserved-invalid",
    "validation.unknown-field": "unknown-field",
    "validation.wrong-table": "wrong-table",
  });

/** One sentence per reason, in the Content Patterns style: no blame, no value. */
const ISSUE_SENTENCE: Readonly<Record<RecordIssueTokenV1, string>> =
  Object.freeze({
    "wrong-type": "This value is not the kind this field holds.",
    required: "This field needs a value before the record can be saved.",
    "unknown-option": "This choice is not one of the field's options.",
    "inactive-option": "This choice is no longer offered for this field.",
    "broken-reference": "The record this points at is not on this device.",
    "preserved-invalid":
      "This value came in from the import unchanged and does not fit the field.",
    "unknown-field": "This field is not part of the table.",
    "wrong-table": "This record does not belong to this table.",
    unrecognised: "This value did not pass one of the table's own rules.",
  });

export interface RecordIssueVm {
  /** Null for a whole-record issue. */
  readonly fieldId: string | null;
  readonly kind: string;
  readonly severity: "warning" | "blocking";
  readonly token: RecordIssueTokenV1;
  /** Labels, types and counts — never a cell value (CA-04). */
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly sentence: string;
}

export function toIssueVm(issue: RecordIssueViewV1): RecordIssueVm {
  const token = ISSUE_TOKENS[issue.messageKey] ?? "unrecognised";
  return {
    fieldId: issue.fieldId,
    kind: issue.kind,
    severity: issue.severity,
    token,
    parameters: issue.messageParameters,
    sentence: ISSUE_SENTENCE[token],
  };
}

// --- command outcomes --------------------------------------------------------

/**
 * What a write actually did.
 *
 * `no-op` is its own member because `commitId: null` is a *truthful* answer:
 * the command asked for a state the record was already in, so nothing was
 * written and nothing failed. Folding it into either `saved` or `rejected`
 * would make one of those two a lie.
 */
export type RecordCommandOutcomeVm =
  | {
      readonly kind: "saved";
      readonly recordId: string;
      readonly recordRevision: number;
      readonly commitId: string;
    }
  | {
      readonly kind: "no-op";
      readonly recordId: string;
      readonly recordRevision: number;
    }
  | { readonly kind: "rejected"; readonly issues: readonly RecordIssueVm[] }
  | {
      readonly kind: "unknown-subject";
      readonly subject: "app" | "table" | "record" | "deleted-record";
    };

export function toCommandOutcomeVm(
  outcome: RecordCommandOutcomeV1,
): RecordCommandOutcomeVm {
  switch (outcome.outcome) {
    case "accepted":
      return outcome.receipt.commitId === null
        ? {
            kind: "no-op",
            recordId: outcome.receipt.recordId,
            recordRevision: outcome.receipt.recordRevision,
          }
        : {
            kind: "saved",
            recordId: outcome.receipt.recordId,
            recordRevision: outcome.receipt.recordRevision,
            commitId: outcome.receipt.commitId,
          };
    case "rejected":
      return {
        kind: "rejected",
        issues: outcome.report.issues.map(toIssueVm),
      };
    default:
      return { kind: "unknown-subject", subject: outcome.subject };
  }
}

/**
 * The `aria-live` line for a write. Announcements live beside the outcome they
 * describe rather than in a file of their own: there is exactly one thing that
 * can be said about each member, and separating them would put the sentence
 * one indirection away from the fact it depends on.
 *
 * "Saved on this device" is design.md's **Local success** pattern read
 * literally — it never says "synced", because no provider has confirmed
 * anything (and in F02 none exists).
 */
export function announceRecordCommand(
  outcome: RecordCommandOutcomeVm,
  action: "created" | "saved" | "deleted" | "restored" = "saved",
): string {
  switch (outcome.kind) {
    case "saved":
      return action === "created"
        ? "Created on this device."
        : action === "deleted"
          ? "Deleted on this device. This is recoverable from the change history."
          : action === "restored"
            ? "Restored on this device."
            : // record-create.html: "Save locally".
              "Saved on this device.";
    case "no-op":
      // A truthful no-op: the record already said this, so nothing was written.
      return "No change was needed; this record already held those values.";
    case "rejected": {
      const blocking = outcome.issues.filter(
        (issue) => issue.severity === "blocking",
      );
      return blocking.length === 1
        ? `This could not be saved. ${blocking[0]?.sentence ?? ""}`
        : `This could not be saved. ${String(blocking.length)} fields need correcting.`;
    }
    default:
      return outcome.subject === "deleted-record"
        ? "That record has already been deleted."
        : "That is no longer on this device.";
  }
}

// --- SCR-032 change history (change-history.html) ---------------------------

/** Every event kind, in the words a person uses for it. */
const EVENT_SENTENCE: Readonly<Record<string, string>> = Object.freeze({
  "record.created": "Record created",
  "record.patched": "Record changed",
  "record.deleted": "Record deleted",
  "record.restored": "Record restored",
  "app.created": "App created",
  "table.created": "Table created",
  "field.created": "Field created",
  "enum.changed": "Choices changed",
  "theme.changed": "Appearance changed",
  "inference-decision.recorded": "Import decision recorded",
  "import.accepted": "Import accepted",
  // F04's structure changes (CA-28).
  "app.renamed": "App renamed",
  "table.changed": "Table changed",
  "field.changed": "Field changed",
  "relationship.changed": "Relationship changed",
  "relationship.removed": "Relationship removed",
  "rule.changed": "Rule changed",
  "rule.removed": "Rule removed",
  "formula.changed": "Calculation changed",
  "formula.removed": "Calculation removed",
  // F04's charts (CA-30).
  "chart.saved": "Chart saved",
  "chart.deleted": "Chart deleted",
});

/**
 * A kind this release does not name yet (S05's and S08's arrive before their
 * owners refine them) is still a change that happened, and is said truthfully.
 */
export function describeEvent(eventKind: string): string {
  return EVENT_SENTENCE[eventKind] ?? "A change was recorded";
}

export interface ChangeHistoryEntryVm {
  readonly eventId: string;
  readonly commitId: string;
  readonly eventKind: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly recordRevision: number | null;
  /** Which fields moved. The values stay out of a log listing. */
  readonly changedFieldIds: readonly string[];
  /** The delete still carries its payload, so a restore has something to write. */
  readonly isRestorable: boolean;
  /** The table the change happened in; null for an app-level event (CA-21). */
  readonly tableId: string | null;
  /** Null when the event names no table, or one this app no longer has. */
  readonly tableName: string | null;
}

/**
 * SCR-032. `scope` is load-bearing: the log holds what was authored *since the
 * last checkpoint*, so an app that was just imported has an empty one and that
 * emptiness is correct. "Every change since this app existed" is a sentence
 * this data cannot support, and the type says so rather than letting a surface
 * write it.
 */
export interface ChangeHistoryVm {
  readonly screen: "SCR-032";
  readonly scope: "since-last-checkpoint";
  readonly entries: readonly ChangeHistoryEntryVm[];
  readonly hasMore: boolean;
  readonly nextCursor: ChangeHistoryCursorWireV1 | null;
  readonly emptiness: "no-changes-since-checkpoint" | null;
  readonly announcement: string;
}

export function selectChangeHistoryVm(
  page: ChangeHistoryPageViewV1,
  tables: readonly AppTableViewV1[] = [],
): ChangeHistoryVm {
  const tableNames = new Map(tables.map((table) => [table.tableId, table.displayName]));
  const entries = page.entries.map((entry) => {
    const tableId = entry.tableId ?? null;
    return {
      ...entry,
      tableId,
      tableName: tableId === null ? null : (tableNames.get(tableId) ?? null),
    };
  });
  return {
    screen: "SCR-032",
    scope: "since-last-checkpoint",
    entries,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    emptiness: entries.length === 0 ? "no-changes-since-checkpoint" : null,
    announcement:
      entries.length === 0
        ? "No changes have been made since this app was last checkpointed."
        : `${plural(entries.length, "change", "changes")} since this app was last checkpointed.`,
  };
}

// --- MOD-009 / MOD-010 delete and restore -----------------------------------

export interface DeleteRecordDialogVm {
  readonly dialog: "MOD-009";
  readonly recordId: string;
  readonly label: RecordFactVm | null;
  /** D22: change history and restore ship in F02, so this is a fact. */
  readonly recoverable: true;
  /** record-edit.html, verbatim. */
  readonly assurance: string;
  readonly busy: boolean;
}

export function selectDeleteRecordDialogVm(
  detail: RecordDetailVm,
  busy = false,
): DeleteRecordDialogVm {
  return {
    dialog: "MOD-009",
    recordId: detail.recordId,
    label: detail.label,
    recoverable: true,
    assurance: "Deletes remain recoverable in change history.",
    busy,
  };
}

/**
 * MOD-010's decision contract: *original record/time and validation before
 * restore*.
 *
 * - **Original record** — the values the delete preserved, read through
 *   `getDeletedRecord` and shown in the table's field order. `null` while that
 *   read is outstanding or when it answered nothing; the surface says which.
 * - **Time** — the delete's own time when the read answered, else the log
 *   entry's.
 * - **Validation** — the one validator runs when the restore is written
 *   (invariant 5); there is no dry run to consult, so before the attempt this
 *   is the assurance, and after a refusal it is the refusal's own issues.
 */
export interface RestoreRecordDialogVm {
  readonly dialog: "MOD-010";
  readonly recordId: string;
  readonly deletedAtEpochMs: number;
  readonly tableName: string | null;
  readonly original:
    | { readonly kind: "reading" }
    | { readonly kind: "unavailable" }
    | { readonly kind: "values"; readonly facts: readonly RecordFactVm[] };
  readonly validation:
    | { readonly kind: "checked-on-restore" }
    | { readonly kind: "rejected"; readonly issues: readonly RecordIssueVm[] };
  /** change-history.html: the restore is re-validated before it is written. */
  readonly assurance: string;
  readonly busy: boolean;
}

export function selectRestoreRecordDialogVm(
  entry: ChangeHistoryEntryVm,
  options: {
    /** `undefined` while `getDeletedRecord` is outstanding. */
    readonly deleted?: DeletedRecordViewV1 | null;
    /** The deleted record's table, for field names and order. */
    readonly table?: AppTableViewV1;
    /** The refusal a restore attempt came back with. */
    readonly rejection?: readonly RecordIssueViewV1[];
    readonly busy?: boolean;
  } = {},
): RestoreRecordDialogVm {
  const { deleted, table } = options;
  const fields = table === undefined ? [] : fieldsInOrder(table);
  const byField = new Map((deleted?.values ?? []).map((entry) => [entry.fieldId, entry]));
  const facts =
    deleted === undefined || deleted === null
      ? []
      : fields.flatMap((field) => {
          const entry = byField.get(field.fieldId);
          return entry === undefined ? [] : [toFact(entry, field)];
        });

  return {
    dialog: "MOD-010",
    recordId: entry.subjectId,
    deletedAtEpochMs: deleted?.deletedAtEpochMs ?? entry.wallTimeMs,
    tableName: table?.displayName ?? entry.tableName,
    original:
      deleted === undefined
        ? { kind: "reading" }
        : deleted === null
          ? { kind: "unavailable" }
          : { kind: "values", facts },
    validation:
      options.rejection === undefined
        ? { kind: "checked-on-restore" }
        : { kind: "rejected", issues: options.rejection.map(toIssueVm) },
    assurance:
      "Restore validates against the current schema before writing a new append-only event.",
    busy: options.busy === true,
  };
}

// === Sheet snapshots and the inert inventory (SCR-030, SCR-031, SHT-016,
// STA-012; CAP-25, CA-22) ======================================================
//
// Sources: `mocks/snapshots.html`, `mocks/snapshot-detail.html`,
// `mocks/sheet-atlas.html#sht-016`, `mocks/state-atlas.html#sta-012`,
// `mocks/control-atlas.html#ctl-067/078/079`. Truths the types hold: a
// snapshot cell is text with a closed kind, never markup (D41); a size the
// source never declared is not zero; a discarded row stays in the grid,
// marked (FR-4); export is present, disabled, with its reason (F07).

// --- snapshot vocabulary -------------------------------------------------------

/** snapshots.html's three tags, derived from a sheet's classification. */
export type SheetUseTagV1 = "interactive-table" | "read-only-snapshot" | "mixed-use";

export const SHEET_USE_LABEL: Readonly<Record<SheetUseTagV1, string>> = Object.freeze({
  "interactive-table": "Interactive table",
  "read-only-snapshot": "Read-only snapshot",
  "mixed-use": "Mixed use",
});

const INTERACTIVE: ReadonlySet<SheetClassificationWireV1> = new Set(["table", "lookup"]);

export function sheetUseTag(classification: readonly SheetClassificationWireV1[]): SheetUseTagV1 {
  const interactive = classification.some((role) => INTERACTIVE.has(role));
  const readOnly = classification.some((role) => !INTERACTIVE.has(role));
  if (interactive && readOnly) return "mixed-use";
  return interactive ? "interactive-table" : "read-only-snapshot";
}

/** One and many, per inert kind (the review's vocabulary, D40). */
const INERT_KIND_LABEL: Readonly<Record<InertItemKindWireV1, readonly [string, string]>> =
  Object.freeze({
    formula: ["formula", "formulas"],
    chart: ["chart", "charts"],
    "pivot-table": ["pivot table", "pivot tables"],
    drawing: ["drawing object", "drawing objects"],
    image: ["image", "images"],
    comment: ["comment", "comments"],
    "external-link": ["external link", "external links"],
    hyperlink: ["hyperlink", "hyperlinks"],
    "embedded-object": ["embedded object", "embedded objects"],
    "form-control": ["form control", "form controls"],
    "data-connection": ["data connection", "data connections"],
    "conditional-formatting": ["conditional formatting rule set", "conditional formatting rule sets"],
    "cell-styling": ["cell styling", "cell styling"],
    sparkline: ["sparkline", "sparklines"],
    script: ["script", "scripts"],
    "unsupported-validation": [
      "validation rule Sheaf cannot express",
      "validation rules Sheaf cannot express",
    ],
  });

/** The marker's type, capitalised: "Chart", "Drawing object" (CTL-079). */
export function inertKindName(kind: InertItemKindWireV1): string {
  const [one] = INERT_KIND_LABEL[kind];
  return one.charAt(0).toUpperCase() + one.slice(1);
}

export function describeInertCount(kind: InertItemKindWireV1, count: number): string {
  const [one, many] = INERT_KIND_LABEL[kind];
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

/**
 * Why each inert item stays inert (STA-012's "reason"), in the voice the
 * review already uses for the same reasons (S07's `INERT_REASON`). Nothing is
 * said to keep working, and nothing live is promised beyond "a later release".
 */
export const INERT_REASON_SENTENCE: Readonly<Record<InertReasonKeyWireV1, string>> =
  Object.freeze({
    "formula-not-live-yet":
      "Imported results are kept as values. The formula is preserved and is not recalculated yet.",
    "chart-not-live-yet": "Kept as a snapshot; rebuilt as a live chart in a later release.",
    "object-not-rendered": "Preserved in the snapshot; Sheaf cannot make it interactive.",
    "link-not-followed": "Kept as text; Sheaf never follows it.",
    "script-never-runs": "Kept in the source workbook; Sheaf never runs it.",
    "formatting-not-reproduced": "The values are kept; the formatting is not reproduced.",
    "validation-not-expressible": "The values are kept; Sheaf cannot enforce this rule.",
    "kept-in-source": "Kept in the source workbook; Sheaf never opens it.",
  });

/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetters(columnIndex: number): string {
  let letters = "";
  let remaining = columnIndex + 1;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** "1 chart, 2 drawing objects and 3 formulas". */
function joinCounts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

// --- SCR-030 the snapshot list (snapshots.html) -------------------------------

export interface InertCountVm {
  readonly kind: InertItemKindWireV1;
  readonly count: number;
  /** "1 chart", "2 drawing objects". */
  readonly text: string;
}

export interface SheetSnapshotRowVm {
  readonly sheetId: string;
  readonly displayName: string;
  readonly tag: SheetUseTagV1;
  readonly tagLabel: string;
  /** What the source declared about its size, or that it declared nothing. */
  readonly sizeLine: string;
  readonly inertCounts: readonly InertCountVm[];
  readonly inertTotal: number;
  /** CTL-078's inert-content count, or null when the sheet has none. */
  readonly inertLine: string | null;
}

export interface SnapshotsListVm {
  readonly screen: "SCR-030";
  readonly sheets: readonly SheetSnapshotRowVm[];
  /** An app made before snapshots were listed (or with none) says so. */
  readonly emptiness: "no-sheets" | null;
  readonly announcement: string;
}

function sizeLine(sheet: SheetSnapshotViewV1): string {
  if (sheet.declaredRowCount === null || sheet.declaredColumnCount === null) {
    return "Size not declared in the source";
  }
  return `${plural(sheet.declaredRowCount, "row", "rows")} · ${plural(
    sheet.declaredColumnCount,
    "column",
    "columns",
  )} in the source`;
}

export function selectSnapshotsListVm(
  sheets: readonly SheetSnapshotViewV1[],
): SnapshotsListVm {
  const rows = [...sheets]
    .sort((left, right) => left.sheetOrdinal - right.sheetOrdinal)
    .map((sheet): SheetSnapshotRowVm => {
      const tag = sheetUseTag(sheet.classification);
      const inertCounts = sheet.inertCounts
        .filter((entry) => entry.count > 0)
        .map((entry) => ({ ...entry, text: describeInertCount(entry.kind, entry.count) }));
      const inertTotal = inertCounts.reduce((sum, entry) => sum + entry.count, 0);
      return {
        sheetId: sheet.sheetId,
        displayName: sheet.displayName,
        tag,
        tagLabel: SHEET_USE_LABEL[tag],
        sizeLine: sizeLine(sheet),
        inertCounts,
        inertTotal,
        inertLine:
          inertTotal === 0
            ? null
            : `${joinCounts(inertCounts.map((entry) => entry.text))} preserved, not interactive.`,
      };
    });

  return {
    screen: "SCR-030",
    sheets: rows,
    emptiness: rows.length === 0 ? "no-sheets" : null,
    announcement:
      rows.length === 0
        ? "This app has no sheet snapshots."
        : `${plural(rows.length, "sheet snapshot", "sheet snapshots")} kept with this app.`,
  };
}

// --- STA-012 inert items ------------------------------------------------------

export interface InertItemVm {
  readonly inertItemId: string;
  readonly sheetId: string;
  readonly sheetName: string;
  readonly kind: InertItemKindWireV1;
  /** "Chart", "Drawing object". */
  readonly kindName: string;
  /** A user-understandable location, e.g. `Overview!D2:K18`. */
  readonly location: string;
  readonly reason: string;
  /** The snapshot row to show it at, when it has a cell range. */
  readonly anchorRow: number | null;
}

export function toInertItemVm(item: InertItemViewV1): InertItemVm {
  return {
    inertItemId: item.inertItemId,
    sheetId: item.sheetId,
    sheetName: item.sheetName,
    kind: item.kind,
    kindName: inertKindName(item.kind),
    location: item.location,
    reason: INERT_REASON_SENTENCE[item.reasonKey],
    anchorRow: item.anchor?.firstRow ?? null,
  };
}

// --- SCR-031 the snapshot viewer (snapshot-detail.html) -----------------------

/** Rows per page: the record list's page, and well inside CA-22's 1,000. */
export const SNAPSHOT_PAGE_ROWS = 50;

export interface SnapshotSlotVm {
  readonly columnIndex: number;
  readonly text: string;
  readonly kind: SnapshotCellKindWireV1 | "empty";
  /** > 1 where a merged region starts here (clipped to the page). */
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly isMerged: boolean;
  readonly isMatch: boolean;
  /** Inert items anchored at this cell (CTL-079). */
  readonly markers: readonly InertItemVm[];
}

export interface SnapshotRowVm {
  readonly rowIndex: number;
  /** 1-based, as the source's row headers read. */
  readonly rowNumber: number;
  /** FR-4: a row inference set aside, still here and marked. */
  readonly discarded: string | null;
  readonly slots: readonly SnapshotSlotVm[];
}

export type SnapshotFindVm =
  | { readonly state: "idle" }
  | {
      readonly state: "found";
      readonly text: string;
      readonly rowIndex: number;
      readonly columnIndex: number;
      readonly sentence: string;
    }
  | {
      readonly state: "not-found";
      readonly text: string;
      readonly afterRow: number | null;
      readonly sentence: string;
    };

export function toSnapshotFindVm(
  text: string,
  afterRow: number | null,
  result: SnapshotFindResultV1,
): SnapshotFindVm {
  if (result.outcome === "found") {
    return {
      state: "found",
      text,
      rowIndex: result.rowIndex,
      columnIndex: result.columnIndex,
      sentence: `Found “${text}” in ${columnLetters(result.columnIndex)}${String(
        result.rowIndex + 1,
      )}.`,
    };
  }
  return {
    state: "not-found",
    text,
    afterRow,
    sentence:
      afterRow === null
        ? `No cell in this snapshot contains “${text}”.`
        : `No more cells contain “${text}” after row ${String(afterRow + 1)}.`,
  };
}

const DISCARD_REASON: Readonly<
  Record<SnapshotPageViewV1["discardedRows"][number]["reason"], string>
> = Object.freeze({
  "above-header": "Not imported · above the header row",
  "empty-row": "Not imported · empty row",
});

export interface SnapshotViewerVm {
  readonly screen: "SCR-031";
  readonly sheetId: string;
  readonly displayName: string;
  /** `delimited-v1`: an F02 snapshot, whose discarded rows are here unmarked. */
  readonly format: SnapshotPageViewV1["format"];
  /**
   * Rows the sheet spans: its data rows, or further where an inert item is
   * anchored below the last of them (a drawing under a summary, say).
   */
  readonly rowCount: number;
  readonly columns: readonly { readonly columnIndex: number; readonly letters: string }[];
  readonly rows: readonly SnapshotRowVm[];
  readonly firstRow: number;
  /** Exclusive. */
  readonly endRow: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** Where the neighbouring pages start; null where there is none. */
  readonly previousFirstRow: number | null;
  readonly nextFirstRow: number | null;
  readonly inertItems: readonly InertItemVm[];
  /** snapshot-detail.html's callout, or null when the sheet has no inert item. */
  readonly inertHeadline: string | null;
  readonly find: SnapshotFindVm;
  readonly announcement: string;
}

function intersects(range: CellRangeWireV1, firstRow: number, endRow: number): boolean {
  return range.lastRow >= firstRow && range.firstRow < endRow;
}

/**
 * The page as a grid. Rows with nothing in them are left out (the source's
 * row numbers stay on the rows that remain, as snapshot-detail.html does),
 * except where something must be seen: a discarded row, an inert anchor, and
 * every row a merged region spans, so its span stays true.
 */
export function selectSnapshotViewerVm(input: {
  readonly page: SnapshotPageViewV1;
  readonly inertItems: readonly InertItemViewV1[];
  readonly find?: SnapshotFindVm;
  readonly pageRows?: number;
}): SnapshotViewerVm {
  const { page } = input;
  const pageRows = input.pageRows ?? SNAPSHOT_PAGE_ROWS;
  const rowCount = Math.max(
    page.rowCount,
    ...page.inertAnchors.map((anchor) => anchor.range.firstRow + 1),
    ...input.inertItems.flatMap((item) => (item.anchor === null ? [] : [item.anchor.firstRow + 1])),
  );
  const endRow = Math.min(rowCount, page.firstRow + pageRows);
  const find = input.find ?? { state: "idle" };
  const items = input.inertItems.map(toInertItemVm);
  const itemById = new Map(items.map((item) => [item.inertItemId, item]));

  const anchors = page.inertAnchors.filter((anchor) =>
    intersects(anchor.range, page.firstRow, endRow),
  );
  const merges = page.merges.filter((merge) => intersects(merge, page.firstRow, endRow));

  const columnCount = Math.max(
    page.columnCount,
    ...anchors.map((anchor) => anchor.range.firstColumn + 1),
    ...merges.map((merge) => merge.lastColumn + 1),
  );

  const cells = new Map<string, { readonly text: string; readonly kind: SnapshotCellKindWireV1 }>();
  const shown = new Set<number>();
  for (const row of page.rows) {
    if (row.rowIndex < page.firstRow || row.rowIndex >= endRow) continue;
    if (row.cells.length > 0) shown.add(row.rowIndex);
    for (const cell of row.cells) {
      cells.set(`${String(row.rowIndex)}:${String(cell.columnIndex)}`, cell);
    }
  }
  const discarded = new Map<number, string>();
  for (const row of page.discardedRows) {
    if (row.rowIndex < page.firstRow || row.rowIndex >= endRow) continue;
    discarded.set(row.rowIndex, DISCARD_REASON[row.reason]);
    shown.add(row.rowIndex);
  }
  for (const merge of merges) {
    for (let row = Math.max(merge.firstRow, page.firstRow); row <= Math.min(merge.lastRow, endRow - 1); row += 1) {
      shown.add(row);
    }
  }

  /** Where each covered position's merge starts, so markers land on it. */
  const origin = new Map<string, string>();
  const spans = new Map<string, { readonly colSpan: number; readonly rowSpan: number }>();
  for (const merge of merges) {
    const top = Math.max(merge.firstRow, page.firstRow);
    const bottom = Math.min(merge.lastRow, endRow - 1);
    const key = `${String(top)}:${String(merge.firstColumn)}`;
    spans.set(key, {
      colSpan: merge.lastColumn - merge.firstColumn + 1,
      rowSpan: bottom - top + 1,
    });
    for (let row = top; row <= bottom; row += 1) {
      for (let column = merge.firstColumn; column <= merge.lastColumn; column += 1) {
        const position = `${String(row)}:${String(column)}`;
        if (position !== key) origin.set(position, key);
      }
    }
  }

  const markers = new Map<string, InertItemVm[]>();
  for (const anchor of anchors) {
    const item = itemById.get(anchor.inertItemId);
    if (item === undefined) continue;
    const row = Math.max(anchor.range.firstRow, page.firstRow);
    const position = `${String(row)}:${String(anchor.range.firstColumn)}`;
    const key = origin.get(position) ?? position;
    shown.add(Number(key.split(":")[0]));
    markers.set(key, [...(markers.get(key) ?? []), item]);
  }

  const rows = [...shown]
    .sort((left, right) => left - right)
    .map((rowIndex): SnapshotRowVm => {
      const slots: SnapshotSlotVm[] = [];
      for (let column = 0; column < columnCount; column += 1) {
        const key = `${String(rowIndex)}:${String(column)}`;
        if (origin.has(key)) continue;
        const cell = cells.get(key);
        const span = spans.get(key);
        slots.push({
          columnIndex: column,
          text: cell?.text ?? "",
          kind: cell?.kind ?? "empty",
          colSpan: span?.colSpan ?? 1,
          rowSpan: span?.rowSpan ?? 1,
          isMerged: span !== undefined,
          isMatch:
            find.state === "found" && find.rowIndex === rowIndex && find.columnIndex === column,
          markers: markers.get(key) ?? [],
        });
      }
      return {
        rowIndex,
        rowNumber: rowIndex + 1,
        discarded: discarded.get(rowIndex) ?? null,
        slots,
      };
    });

  return {
    screen: "SCR-031",
    sheetId: page.sheetId,
    displayName: page.displayName,
    format: page.format,
    rowCount,
    columns: Array.from({ length: columnCount }, (_, columnIndex) => ({
      columnIndex,
      letters: columnLetters(columnIndex),
    })),
    rows,
    firstRow: page.firstRow,
    endRow,
    hasPrevious: page.firstRow > 0,
    hasNext: endRow < rowCount,
    previousFirstRow: page.firstRow > 0 ? Math.max(0, page.firstRow - pageRows) : null,
    nextFirstRow: endRow < rowCount ? endRow : null,
    inertItems: items,
    inertHeadline:
      items.length === 0
        ? null
        : `${plural(items.length, "inert item", "inert items")} on this sheet`,
    find,
    announcement:
      find.state === "idle"
        ? `${page.displayName}, rows ${String(page.firstRow + 1)} to ${String(endRow)} of ${String(
            rowCount,
          )}. Read only.`
        : find.sentence,
  };
}

/** The first row of the page that shows `rowIndex`. */
export function pageStartFor(rowIndex: number, pageRows = SNAPSHOT_PAGE_ROWS): number {
  return Math.floor(rowIndex / pageRows) * pageRows;
}

// --- SHT-016 snapshot options -------------------------------------------------

/**
 * The live table a sheet became, found by name.
 *
 * The wire links a table to its source sheet only inside the `table.created`
 * payload, which no read exposes; the promoted table takes the sheet's name
 * unless the person renamed it in review. So this is a match, not a fact: a
 * sheet with no same-named table offers the app home instead of guessing.
 */
export function liveTableForSheet(
  sheetName: string,
  tables: readonly AppTableViewV1[],
): AppTableViewV1 | null {
  return tables.find((table) => table.displayName === sheetName) ?? null;
}

export type SnapshotOptionVm =
  | { readonly id: "find"; readonly label: string; readonly isEnabled: true }
  | { readonly id: "inert-items"; readonly label: string; readonly isEnabled: true }
  | {
      readonly id: "return";
      readonly label: string;
      readonly isEnabled: true;
      /** Null returns to the app home. */
      readonly tableId: string | null;
    }
  | {
      readonly id: "export";
      readonly label: string;
      readonly isEnabled: false;
      readonly disabledReason: string;
    };

/** SHT-016: find, export sheet, inert items, return to live table. */
export interface SnapshotOptionsVm {
  readonly sheet: "SHT-016";
  readonly options: readonly SnapshotOptionVm[];
}

/** Export belongs to F07; the action is shown, disabled, with its reason. */
export const EXPORT_SHEET_LATER = "Export arrives in a later release.";

export function selectSnapshotOptionsVm(input: {
  readonly inertCount: number;
  readonly liveTable: Pick<AppTableViewV1, "tableId" | "displayName"> | null;
}): SnapshotOptionsVm {
  return {
    sheet: "SHT-016",
    options: [
      { id: "find", label: "Find in sheet", isEnabled: true },
      {
        id: "inert-items",
        label: `Inert items (${String(input.inertCount)})`,
        isEnabled: true,
      },
      input.liveTable === null
        ? { id: "return", label: "Return to app home", isEnabled: true, tableId: null }
        : {
            id: "return",
            label: `Return to live ${input.liveTable.displayName}`,
            isEnabled: true,
            tableId: input.liveTable.tableId,
          },
      {
        id: "export",
        label: "Export sheet",
        isEnabled: false,
        disabledReason: EXPORT_SHEET_LATER,
      },
    ],
  };
}

// --- SCR-033 / SHT-012 / SHT-017 / SCR-024 pinned charts (CA-30) -------------

/**
 * The charts column's view models (M37; SCR-033, SHT-012, SHT-017, STA-015,
 * SCR-024's pinned charts; CA-30).
 *
 * A dataset arrives as facts; this section turns them into what a surface
 * shows, and nothing more:
 *
 * - **Every category is named in words.** An option by its label, a
 *   referenced record by its label (design.md's "Missing related record" when
 *   it has none), a date bucket by its day, month or year, and the two
 *   absent buckets by the records surface's own words: "Not given" for no
 *   value, "Needs attention" for a value imported exactly as written.
 * - **Scope is a fact, never a guess (STA-015, D53).** `scope` says whether
 *   every matching row was read or the newest were sampled, and how many
 *   categories or points were left undrawn; the data table still lists every
 *   category the dataset aggregated.
 * - **A mark carries its own filter.** The intent the worker computed is
 *   handed on verbatim (D63, CA-29); a mark whose rows no filter can name
 *   says so, and its detail offers nothing to apply.
 *
 * Numbers stay canonical decimal text and dates stay epoch days: a view model
 * holds no locale, so the surface formats them.
 */

/** A field's type as a chart surface formats its numbers. */
export type ChartFieldTypeVm = FieldTypeWireV1;

/** A category or series, ready for words. */
export type ChartCategoryVm =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "date"; readonly epochDay: number; readonly unit: "day" | "month" | "year" }
  /** No value (for a relationship grouping: none on the related record either). */
  | { readonly kind: "absent" }
  /** A value imported exactly as written, which no filter can name. */
  | { readonly kind: "unreadable" };

export type ChartMarkVm =
  | {
      readonly kind: "group";
      /** Position in `marks`; the canvas reports a tapped mark by it. */
      readonly index: number;
      readonly category: ChartCategoryVm;
      readonly series: ChartCategoryVm | null;
      /** Canonical decimal; null when no counted record carried the measured field. */
      readonly value: string | null;
      readonly records: number;
      /** Hand to the records route verbatim (D63); null when no filter names the rows. */
      readonly filterIntent: readonly FilterWireV1[] | null;
      /** Labels for a reference filter's records, so its chip reads as a name. */
      readonly recordLabels: ReadonlyMap<string, string>;
    }
  | { readonly kind: "point"; readonly index: number; readonly recordId: string; readonly x: string; readonly y: string };

export type ChartMeasureVm =
  | { readonly kind: "count" }
  | { readonly kind: "sum" | "average" | "min" | "max"; readonly fieldName: string; readonly fieldType: FieldTypeWireV1 | null };

/** STA-015: exactly what the chart read and drew. */
export interface ChartScopeVm {
  /** `all`: every matching row. `sample`: the newest `rows` of `total` (D53). */
  readonly kind: "all" | "sample";
  readonly rows: number;
  readonly total: number;
  /** Categories (or points) the dataset holds, and how many of them are drawn. */
  readonly categories: number;
  readonly drawn: number;
  /** Scatter: rows read that lack one of the axes. */
  readonly unplotted: number;
  readonly isPartial: boolean;
}

export interface ChartSummaryVm {
  readonly highest: ChartMarkVm | null;
  readonly lowest: ChartMarkVm | null;
  readonly total: string | null;
  readonly count: number;
}

export interface ChartDetailVm {
  readonly screen: "SCR-033";
  /** Null for a builder's draft. */
  readonly chartId: string | null;
  readonly chartRevision: number | null;
  readonly name: string;
  readonly type: ChartDefinitionWireV1["type"];
  readonly pinned: boolean;
  readonly provenance: "imported" | "user" | null;
  readonly tableId: string;
  readonly tableName: string;
  /** The grouping's field name (the data table's first column); null for scatter. */
  readonly groupName: string | null;
  readonly seriesName: string | null;
  readonly measure: ChartMeasureVm;
  /** Scatter's axes. */
  readonly axes: { readonly x: string; readonly xType: FieldTypeWireV1 | null; readonly y: string; readonly yType: FieldTypeWireV1 | null } | null;
  readonly scope: ChartScopeVm;
  /** The drawn marks, in the chart's order. */
  readonly marks: readonly ChartMarkVm[];
  readonly summary: ChartSummaryVm;
  /** SHT-017's table: one page of every category (or point). */
  readonly table: {
    readonly rows: readonly ChartMarkVm[];
    readonly offset: number;
    readonly total: number;
    readonly hasMore: boolean;
  };
}

const MISSING_OPTION = "A choice that is no longer in this field's list";
const MISSING_RECORD = "Missing related record";

function fieldNamed(tables: readonly AppTableViewV1[], fieldId: string): AppFieldViewV1 | undefined {
  for (const table of tables) {
    const field = table.fields.find((candidate) => candidate.fieldId === fieldId);
    if (field !== undefined) return field;
  }
  return undefined;
}

const UNKNOWN_FIELD = "A column that is no longer in this app";

function valueCategory(value: CellWireValueV1, label: string | null, unit: "day" | "month" | "year" | null): ChartCategoryVm {
  switch (value.kind) {
    case "option":
      return { kind: "text", text: label ?? MISSING_OPTION };
    case "reference":
      return { kind: "text", text: label ?? MISSING_RECORD };
    case "text":
      return { kind: "text", text: value.text };
    case "boolean":
      return { kind: "boolean", value: value.boolean };
    case "date":
      return { kind: "date", epochDay: value.epochDay, unit: unit ?? "day" };
    case "number":
      return { kind: "text", text: value.decimal };
    case "invalid":
      return { kind: "unreadable" };
    case "blank":
    case "missing":
      return { kind: "absent" };
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

function categoryOf(key: ChartKeyWireV1, grouping: ChartGroupingWireV1 | null): ChartCategoryVm {
  switch (key.kind) {
    case "empty":
    case "empty-parent":
      return { kind: "absent" };
    case "unreadable":
      return { kind: "unreadable" };
    case "value":
      return valueCategory(key.value, key.label, grouping?.kind === "date" ? grouping.unit : null);
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function toMarkVm(mark: ChartMarkWireV1, index: number, definition: ChartDefinitionWireV1): ChartMarkVm {
  if (mark.kind === "point") return { ...mark, index };
  const groupBy = definition.type === "scatter" ? null : definition.groupBy;
  const seriesBy = definition.type === "scatter" ? null : definition.seriesBy;
  // A reference grouping's intent names one record; its chip reads as the category's label.
  const recordLabels = new Map<string, string>();
  if (mark.category.kind === "value" && mark.category.value.kind === "reference" && mark.category.label !== null) {
    recordLabels.set(mark.category.value.recordId, mark.category.label);
  }
  return {
    kind: "group",
    index,
    category: categoryOf(mark.category, groupBy),
    series: mark.series === null ? null : categoryOf(mark.series, seriesBy),
    value: mark.value,
    records: mark.records,
    filterIntent: mark.filterIntent,
    recordLabels,
  };
}

function groupingName(grouping: ChartGroupingWireV1, tables: readonly AppTableViewV1[]): string {
  return fieldNamed(tables, grouping.fieldId)?.displayName ?? UNKNOWN_FIELD;
}

/**
 * SCR-033 (and a pinned chart, and the builder's preview): the dataset in
 * words. `tables` are the open app's, so a related grouping's parent field is
 * named too.
 */
export function selectChartDetailVm(dataset: ChartDatasetViewV1, tables: readonly AppTableViewV1[]): ChartDetailVm {
  const { definition } = dataset;
  const table = tables.find((candidate) => candidate.tableId === definition.tableId);
  const field = (fieldId: string) => fieldNamed(tables, fieldId);
  const marks = dataset.marks.map((mark, index) => toMarkVm(mark, index, definition));
  const rows = dataset.tablePage.rows.map((mark, index) => toMarkVm(mark, dataset.tablePage.offset + index, definition));
  const at = (mark: ChartMarkWireV1 | null): ChartMarkVm | null => (mark === null ? null : toMarkVm(mark, -1, definition));
  const isScatter = definition.type === "scatter";
  return {
    screen: "SCR-033",
    chartId: dataset.chart?.chartId ?? null,
    chartRevision: dataset.chart?.chartRevision ?? null,
    name: definition.name,
    type: definition.type,
    pinned: definition.pinned,
    provenance: dataset.chart?.provenance ?? null,
    tableId: definition.tableId,
    tableName: table?.displayName ?? UNKNOWN_FIELD,
    groupName: isScatter ? null : groupingName(definition.groupBy, tables),
    seriesName: isScatter || definition.seriesBy === null ? null : groupingName(definition.seriesBy, tables),
    measure:
      isScatter || definition.measure.kind === "count"
        ? { kind: "count" }
        : {
            kind: definition.measure.kind,
            fieldName: field(definition.measure.fieldId)?.displayName ?? UNKNOWN_FIELD,
            fieldType: field(definition.measure.fieldId)?.type ?? null,
          },
    axes: isScatter
      ? {
          x: field(definition.x)?.displayName ?? UNKNOWN_FIELD,
          xType: field(definition.x)?.type ?? null,
          y: field(definition.y)?.displayName ?? UNKNOWN_FIELD,
          yType: field(definition.y)?.type ?? null,
        }
      : null,
    scope: {
      kind: dataset.sample === null ? "all" : "sample",
      rows: dataset.sourceRowsConsidered,
      total: dataset.matchingRows,
      categories: dataset.tablePage.total,
      drawn: dataset.marks.length,
      unplotted: dataset.unplottedRows,
      isPartial: dataset.sample !== null || dataset.omittedCategories > 0 || dataset.unplottedRows > 0,
    },
    marks,
    summary: {
      highest: at(dataset.summary.highest),
      lowest: at(dataset.summary.lowest),
      total: dataset.summary.total,
      count: dataset.summary.count,
    },
    table: {
      rows,
      offset: dataset.tablePage.offset,
      total: dataset.tablePage.total,
      hasMore: dataset.tablePage.offset + dataset.tablePage.rows.length < dataset.tablePage.total,
    },
  };
}

/** The next table page appended to the one a sheet already shows (SHT-017's paging). */
export function appendTablePage(current: ChartDetailVm, next: ChartDetailVm): ChartDetailVm {
  return {
    ...current,
    table: {
      rows: [...current.table.rows, ...next.table.rows],
      offset: current.table.offset,
      total: next.table.total,
      hasMore: next.table.hasMore,
    },
  };
}

// --- SCR-034 the chart builder (chart-builder.html; CAP-33) -------------------

/** chart-builder.html's four type cards, and its "Stacked bar" pill. */
export const CHART_TYPE_CHOICES = Object.freeze([
  { type: "bar", label: "Bar", hint: "Compare categories" },
  { type: "line", label: "Line", hint: "Change over time" },
  { type: "pie", label: "Pie", hint: "Parts of a whole" },
  { type: "scatter", label: "Scatter", hint: "Compare two numbers" },
  { type: "stacked", label: "Stacked bar", hint: null },
] as const);

/** One choice in a builder list: the key a select holds, and what it says. */
export interface ChartChoiceVm<Value> {
  readonly key: string;
  readonly label: string;
  readonly value: Value;
}

/** A relationship whose parent fields the grouping may use ("Include related …"). */
export interface ChartRelationshipChoiceVm {
  readonly relationshipId: string;
  readonly parentName: string;
  /** chart-builder.html, verbatim with the app's own names. */
  readonly sentence: string;
  readonly isIncluded: boolean;
}

export interface ChartBuilderVm {
  readonly screen: "SCR-034";
  readonly definition: ChartDefinitionWireV1;
  readonly tables: readonly ChartChoiceVm<string>[];
  readonly relationships: readonly ChartRelationshipChoiceVm[];
  /** Fields of the table, related parents' fields when included, dates by day, month and year. */
  readonly groupings: readonly ChartChoiceVm<ChartGroupingWireV1>[];
  readonly measures: readonly ChartChoiceVm<ChartMeasureWireV1>[];
  /** Number and currency fields: a scatter's axes. */
  readonly numbers: readonly ChartChoiceVm<string>[];
  /** The key of each current choice, as the selects hold them. */
  readonly selected: {
    readonly groupBy: string | null;
    readonly seriesBy: string | null;
    readonly measure: string | null;
    readonly x: string | null;
    readonly y: string | null;
  };
  /** Why the chart cannot be saved yet; null when it can. */
  readonly saveBlocker: string | null;
  /** Why a scatter cannot be chosen for this table; null when it can. */
  readonly scatterBlocker: string | null;
}

const CATEGORY_KINDS: ReadonlySet<FieldTypeWireV1["kind"]> = new Set(["enum", "reference", "boolean", "text", "phone", "email", "url", "address"]);
const NUMBER_KINDS: ReadonlySet<FieldTypeWireV1["kind"]> = new Set(["number", "currency"]);

export const groupingKey = (group: ChartGroupingWireV1): string =>
  group.kind === "field"
    ? `field:${group.fieldId}`
    : group.kind === "date"
      ? `date:${group.fieldId}:${group.unit}`
      : `related:${group.relationshipId}:${group.referenceFieldId}:${group.fieldId}`;

export const measureKey = (measure: ChartMeasureWireV1): string =>
  measure.kind === "count" ? "count" : `${measure.kind}:${measure.fieldId}`;

const activeFields = (table: AppTableViewV1): readonly AppFieldViewV1[] =>
  [...table.fields].filter((field) => field.isActive).sort((left, right) => left.fieldOrdinal - right.fieldOrdinal);

/**
 * SCR-034's choices for a definition in progress. `included` names the
 * relationships whose parent fields the person asked to group by; the
 * builder never offers a join of its own (FR-13, D54).
 */
export function selectChartBuilderVm(input: {
  readonly tables: readonly AppTableViewV1[];
  readonly relationships: readonly StructureRelationshipViewV1[];
  readonly definition: ChartDefinitionWireV1;
  readonly included: ReadonlySet<string>;
}): ChartBuilderVm {
  const { tables, definition, included } = input;
  const table = tables.find((candidate) => candidate.tableId === definition.tableId);
  const fields = table === undefined ? [] : activeFields(table);
  const outgoing = input.relationships.filter((relationship) => relationship.isActive && relationship.fromTableId === definition.tableId);

  const groupings: ChartChoiceVm<ChartGroupingWireV1>[] = fields.flatMap<ChartChoiceVm<ChartGroupingWireV1>>((field) => {
    if (field.type.kind === "date") {
      return (["day", "month", "year"] as const).map((unit) => {
        const value: ChartGroupingWireV1 = { kind: "date", fieldId: field.fieldId, unit };
        return { key: groupingKey(value), label: `${field.displayName} (${unit})`, value };
      });
    }
    if (!CATEGORY_KINDS.has(field.type.kind)) return [];
    const value: ChartGroupingWireV1 = { kind: "field", fieldId: field.fieldId };
    return [{ key: groupingKey(value), label: field.displayName, value }];
  });
  for (const relationship of outgoing) {
    if (!included.has(relationship.relationshipId)) continue;
    const parent = tables.find((candidate) => candidate.tableId === relationship.toTableId);
    for (const field of parent === undefined ? [] : activeFields(parent)) {
      if (!CATEGORY_KINDS.has(field.type.kind)) continue;
      const value: ChartGroupingWireV1 = {
        kind: "related-field",
        relationshipId: relationship.relationshipId,
        referenceFieldId: relationship.fromFieldId,
        fieldId: field.fieldId,
      };
      groupings.push({ key: groupingKey(value), label: `${relationship.toTableName} → ${field.displayName}`, value });
    }
  }

  const numbers = fields.filter((field) => NUMBER_KINDS.has(field.type.kind));
  const tableName = table?.displayName ?? UNKNOWN_FIELD;
  const measures: ChartChoiceVm<ChartMeasureWireV1>[] = [
    { key: "count", label: `Count of ${tableName.toLowerCase()}`, value: { kind: "count" } },
    ...numbers.flatMap((field) =>
      (
        [
          ["sum", `Sum of ${field.displayName.toLowerCase()}`],
          ["average", `Average ${field.displayName.toLowerCase()}`],
          ["min", `Lowest ${field.displayName.toLowerCase()}`],
          ["max", `Highest ${field.displayName.toLowerCase()}`],
        ] as const
      ).map(([kind, label]) => {
        const value = { kind, fieldId: field.fieldId };
        return { key: measureKey(value), label, value };
      }),
    ),
  ];

  const isScatter = definition.type === "scatter";
  return {
    screen: "SCR-034",
    definition,
    tables: [...tables]
      .sort((left, right) => left.tableOrdinal - right.tableOrdinal)
      .map((candidate) => ({ key: candidate.tableId, label: candidate.displayName, value: candidate.tableId })),
    relationships: outgoing.map((relationship) => ({
      relationshipId: relationship.relationshipId,
      parentName: relationship.toTableName,
      sentence: `Uses the connection Sheaf found from ${relationship.fromTableName} to ${relationship.toTableName}.`,
      isIncluded: included.has(relationship.relationshipId),
    })),
    groupings,
    measures,
    numbers: numbers.map((field) => ({ key: field.fieldId, label: field.displayName, value: field.fieldId })),
    selected: {
      groupBy: isScatter ? null : groupingKey(definition.groupBy),
      seriesBy: isScatter || definition.seriesBy === null ? null : groupingKey(definition.seriesBy),
      measure: isScatter ? null : measureKey(definition.measure),
      x: isScatter ? definition.x : null,
      y: isScatter ? definition.y : null,
    },
    saveBlocker: definition.name.trim() === "" ? "Name the chart to save it." : null,
    scatterBlocker: numbers.length === 0 ? `${tableName} has no number column to plot.` : null,
  };
}

/**
 * A new chart's first definition (chart-builder.html's defaults): a bar of
 * the table's first groupable field, counting records, pinned to app home.
 * Null when the table has nothing a chart can group by.
 */
export function defaultChartDefinition(table: AppTableViewV1): ChartDefinitionWireV1 | null {
  const fields = activeFields(table);
  const first = fields.find((field) => CATEGORY_KINDS.has(field.type.kind) || field.type.kind === "date");
  if (first === undefined) return null;
  return {
    name: "",
    tableId: table.tableId,
    filters: [],
    pinned: true,
    type: "bar",
    groupBy: first.type.kind === "date" ? { kind: "date", fieldId: first.fieldId, unit: "month" } : { kind: "field", fieldId: first.fieldId },
    seriesBy: null,
    measure: { kind: "count" },
    sort: "category",
  };
}
