/**
 * The app and records surfaces (M37; SCR-024–029, 032; MOD-009/010;
 * CAP-15–CAP-17).
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
 *    many records matched a search is not a question the projection answers, so
 *    {@link RecordsListVm} has no field for one — `records.length` would be
 *    false the moment `hasMore` is true, and a field invites exactly that.
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
 * No relationships section and no reference input exists here (D25): F02 has no
 * producer for a reference, and truthful absence beats empty scaffolding
 * (STA-025). No time is formatted and no number is localised — a view model
 * holds no clock and no locale.
 */

import type {
  AppFieldViewV1,
  AppSessionViewV1,
  AppTableViewV1,
  AppThemeWireV1,
  CellWireEntryV1,
  CellWireValueV1,
  ChangeHistoryCursorWireV1,
  ChangeHistoryPageViewV1,
  FieldTypeWireV1,
  RecordCommandOutcomeV1,
  RecordDetailViewV1,
  RecordIssueViewV1,
  RecordPageViewV1,
  RecordScopeWireV1,
  RecordSummaryViewV1,
} from "../../workers/protocol/messages.js";

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
  /** F02 has no producer; the member exists because the wire has one (D25). */
  | { readonly kind: "reference"; readonly recordId: string };

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
): RecordValueVm {
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
    default:
      return value;
  }
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
 * SCR-024. There is no metrics field and no chart field on this type: "At a
 * glance" and the pinned chart in app-home.html are computed surfaces F04
 * builds, and a field here could only ever be filled with a fiction (STA-025).
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
  readonly announcement: string;
}

export function selectAppHomeVm(session: AppSessionViewV1): AppHomeVm {
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
    // app-home.html's status line, composed from the two facts F02 holds.
    announcement: session.isScratch
      ? `${session.displayName} is on this device only. ${String(
          session.deviceOnlyChangeCount,
        )} changes have no durable copy.`
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
 * empty table and a search that matched nothing stay visibly different,
 * because clearing the search fixes one and does nothing for the other.
 */
export type RecordsEmptinessV1 = "empty-table" | "no-results";

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
   * Live records in the whole table, exact. A search does not narrow it, and
   * there is deliberately no "how many matched": the projection does not
   * answer that, so nothing here may imply it does (CA-14).
   */
  readonly tableRecordCount: number;
  readonly isTableRecordCountExact: true;
  readonly emptiness: RecordsEmptinessV1 | null;
  readonly announcement: string;
}

function fieldsInOrder(table: AppTableViewV1): readonly AppFieldViewV1[] {
  return [...table.fields]
    .filter((field) => field.isActive)
    .sort((left, right) => left.fieldOrdinal - right.fieldOrdinal);
}

function toFact(
  entry: CellWireEntryV1,
  field: AppFieldViewV1,
): RecordFactVm {
  return {
    fieldId: field.fieldId,
    displayName: field.displayName,
    value: toValue(entry.value, field),
  };
}

/** A value worth leading a card with: one that actually says something. */
function isRenderable(value: RecordValueVm): boolean {
  return value.kind !== "blank" && value.kind !== "missing";
}

function toCard(
  record: RecordSummaryViewV1,
  fields: readonly AppFieldViewV1[],
): RecordCardVm {
  const byField = new Map(record.values.map((entry) => [entry.fieldId, entry]));
  const facts: RecordFactVm[] = [];
  for (const field of fields) {
    const entry = byField.get(field.fieldId);
    if (entry === undefined) {
      continue;
    }
    const fact = toFact(entry, field);
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

export function selectRecordsListVm(
  table: AppTableViewV1,
  page: RecordPageViewV1,
): RecordsListVm {
  const fields = fieldsInOrder(table);
  const cards = page.records.map((record) => toCard(record, fields));
  const searching = page.scope.kind === "search";

  const emptiness: RecordsEmptinessV1 | null =
    cards.length > 0
      ? null
      : page.totalCount === 0
        ? "empty-table"
        : "no-results";

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
    emptiness,
    announcement: announceList(
      table.displayName,
      page.totalCount,
      emptiness,
      searching ? page.scope : null,
    ),
  };
}

function announceList(
  tableName: string,
  tableRecordCount: number,
  emptiness: RecordsEmptinessV1 | null,
  search: Extract<RecordScopeWireV1, { kind: "search" }> | null,
): string {
  if (emptiness === "empty-table") {
    // records-empty.html: "This table contains zero records."
    return `${tableName} contains no records yet.`;
  }
  if (emptiness === "no-results") {
    // records-empty.html keeps the count of the table, not of the search.
    return `No record in ${tableName} matches “${search?.text ?? ""}”. The table contains ${String(
      tableRecordCount,
    )} records.`;
  }
  return search === null
    ? `${tableName} contains ${String(tableRecordCount)} records.`
    : `Showing records in ${tableName} matching “${search.text}”. The table contains ${String(
        tableRecordCount,
      )} records.`;
}

// --- SCR-027 record detail (record-detail.html) -----------------------------

export interface RecordDetailFieldVm extends RecordFactVm {
  readonly type: FieldTypeWireV1;
  /** `tel:`/`mailto:`/`https:` where the scheme is unambiguous (FR-12). */
  readonly handoff: RecordHandoffVm | null;
  /** False when the projection could not index it; it is authored-only. */
  readonly isIndexed: boolean;
  readonly issues: readonly RecordIssueVm[];
}

/**
 * SCR-027. There is no relationships section on this type and no field that
 * could carry one: a value-only app has no references, so an empty "Related
 * records" block would be scaffolding for a promise F03 makes (D25/STA-025).
 */
export interface RecordDetailVm {
  readonly screen: "SCR-027";
  readonly recordId: string;
  readonly tableId: string;
  readonly recordRevision: number;
  readonly label: RecordFactVm | null;
  readonly fields: readonly RecordDetailFieldVm[];
  readonly issues: readonly RecordIssueVm[];
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
  readonly announcement: string;
}

export function selectRecordDetailVm(
  table: AppTableViewV1,
  record: RecordDetailViewV1,
): RecordDetailVm {
  const fields = fieldsInOrder(table);
  const byField = new Map(record.values.map((entry) => [entry.fieldId, entry]));
  const indexed = new Set(record.indexedFieldIds);
  const issues = record.issues.map(toIssueVm);

  const projected = fields.flatMap<RecordDetailFieldVm>((field) => {
    const entry = byField.get(field.fieldId);
    if (entry === undefined) {
      return [];
    }
    const value = toValue(entry.value, field);
    return [
      {
        fieldId: field.fieldId,
        displayName: field.displayName,
        value,
        type: field.type,
        handoff: handoffFor(field.type, value),
        isIndexed: indexed.has(field.fieldId),
        issues: issues.filter((issue) => issue.fieldId === field.fieldId),
      },
    ];
  });

  const label = projected.find((field) => isRenderable(field.value)) ?? null;

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
    issues,
    blockingIssueCount: record.blockingIssueCount,
    warningIssueCount: record.warningIssueCount,
    announcement:
      record.blockingIssueCount + record.warningIssueCount === 0
        ? `One record in ${table.displayName}.`
        : `One record in ${table.displayName}. ${String(
            record.blockingIssueCount + record.warningIssueCount,
          )} values need attention.`,
  };
}

// --- SCR-028 / SCR-029 the record form --------------------------------------

/**
 * FR-12's per-type input mapping, read off the control atlas: the keyboard and
 * the control are decided by the field's type and by nothing else, so a phone
 * field cannot come up with a text keyboard because a screen forgot.
 *
 * `reference` is `unsupported` rather than a picker: `FieldTypeV1` carries the
 * member and F02 has no producer for it (D25), so a form that met one would
 * show it read-only rather than offer an input that cannot resolve anything.
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
  | {
      readonly kind: "unsupported";
      readonly control: "read-only";
      readonly reason: "reference-fields-arrive-in-a-later-release";
    };

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
      return {
        kind: "unsupported",
        control: "read-only",
        reason: "reference-fields-arrive-in-a-later-release",
      };
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
}): RecordFormVm {
  const { table, record } = input;
  const mode = record === undefined ? "create" : "edit";
  const issues = (input.issues ?? record?.issues ?? []).map(toIssueVm);
  const byField = new Map(
    (record?.values ?? []).map((entry) => [entry.fieldId, entry]),
  );

  const fields = fieldsInOrder(table).map<RecordFormFieldVm>((field) => {
    const entry = byField.get(field.fieldId);
    return {
      fieldId: field.fieldId,
      displayName: field.displayName,
      isRequired: field.isRequired,
      input: inputForField(field),
      value: entry === undefined ? null : toValue(entry.value, field),
      issues: issues.filter((issue) => issue.fieldId === field.fieldId),
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
        : `${String(blocking.length)} fields must be corrected before this can be saved.`,
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
): ChangeHistoryVm {
  const entries = page.entries.map((entry) => ({ ...entry }));
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
        : `${String(entries.length)} changes since this app was last checkpointed.`,
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

export interface RestoreRecordDialogVm {
  readonly dialog: "MOD-010";
  readonly recordId: string;
  readonly deletedAtEpochMs: number;
  /** change-history.html: the restore is re-validated before it is written. */
  readonly assurance: string;
  readonly busy: boolean;
}

export function selectRestoreRecordDialogVm(
  entry: ChangeHistoryEntryVm,
  busy = false,
): RestoreRecordDialogVm {
  return {
    dialog: "MOD-010",
    recordId: entry.subjectId,
    deletedAtEpochMs: entry.wallTimeMs,
    assurance:
      "Restore validates against the current schema before writing a new append-only event.",
    busy,
  };
}
