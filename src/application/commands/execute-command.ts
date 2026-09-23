/**
 * The only user-authored mutation entrance (M34; CAP-16/CAP-17, invariants 1
 * and 5).
 *
 * One function decides every F02 write, and the order inside it is the
 * contract:
 *
 * 1. **Resolve the real current state** from the hydrated projection — the
 *    schema the record is validated against and, for a patch or a delete, the
 *    record as it actually is. Nothing is taken from the caller's word.
 * 2. **Validate with the one shared validator.** `validateRecord` is the same
 *    call promotion makes (invariant 5). A blocking issue ends the command
 *    here: **no event is built**, nothing is encoded, nothing is written, and
 *    the refusal comes back as a typed *result* carrying the whole report
 *    (D23) rather than as a transport error.
 * 3. **Commit durably**, through the repository port. It resolves only once the
 *    transaction has completed.
 * 4. **Then** bring the projection forward, and only then acknowledge
 *    (invariant 1). A caller that has an `accepted` result has a durable fact.
 *
 * **Two joins are by identity, so both are rebuilt here.** `validateRecord`
 * reads a value with `record.values.get(field.fieldId)` and an option set with
 * `context.enumOptions.get(field.fieldId)` — `Map` lookups, which match on
 * object identity. A decoded ID is a fresh array every time, so values that
 * came back from one query would silently miss fields that came back from
 * another. {@link rekeyByFields} puts every map on the *same* field instances
 * the validation context holds, and an id the schema does not know is
 * deliberately left as it arrived so the validator's own unknown-field check
 * still fires.
 */

import {
  cellValuesEqual,
  MISSING_VALUE,
  type CellValueV1,
} from "../../domain/model/values.js";
import {
  createDomainId,
  encodeDomainId,
  type DomainEntropy,
  type FieldId,
  type RecordId,
  type TableId,
} from "../../domain/model/ids.js";
import type {
  AuthoredRecordV1,
  FieldChangeV1,
} from "../../domain/model/events.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import {
  isComputedField,
  type EnumOptionDefV1,
  type FieldDefV1,
  type TableDefV1,
} from "../../domain/model/schema.js";
import type { EvaluationClockReadingV1 } from "../../domain/formulas/index.js";
import type { ValidationReport } from "../../domain/validation/rules.js";
import {
  validateRecord,
  type ReferenceResolver,
  type ValidationContext,
} from "../../domain/validation/validate-record.js";
import type { ClockPort } from "../ports/clock.js";
import type {
  CommitReceiptV1,
  LocalEventRepository,
} from "../ports/event-repository.js";
import type {
  ProjectionEnginePort,
  ProjectionIssueInputV1,
  ProjectionRecordDetailV1,
} from "../ports/projection.js";
import {
  buildAuthoredCommit,
  type AuthoredEventDraftV1,
} from "./build-commit.js";
import { frozenLiteral, ProjectionRows, projectionFormulaEnv } from "./formula-env.js";

/** How far back a restore looks for the delete it undoes. */
const RESTORE_HISTORY_LIMIT = 256;

const AUTHORED: ValueProvenanceV1 = Object.freeze({ source: "user" });

export type CommandV1 =
  | {
      readonly kind: "create-record";
      readonly tableId: TableId;
      readonly values: ReadonlyMap<FieldId, CellValueV1>;
    }
  | {
      readonly kind: "patch-record";
      readonly recordId: RecordId;
      readonly changes: ReadonlyMap<FieldId, CellValueV1>;
    }
  | { readonly kind: "delete-record"; readonly recordId: RecordId }
  | { readonly kind: "restore-record"; readonly recordId: RecordId };

export type CommandKindV1 = CommandV1["kind"];

/**
 * What a command leaves behind. `commit` is null when the command was a
 * truthful no-op — a patch that moved nothing, a restore of a record that is
 * already present — because writing an event for it would put a change into
 * the history that never happened. The receipt is still `accepted`: the
 * caller asked for a state and that state holds.
 */
export interface CommandAcceptedV1 {
  readonly outcome: "accepted";
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly recordRevision: bigint;
  readonly commit: CommitReceiptV1 | null;
  /**
   * The computed columns the commit re-derived (D60's `recalculated`
   * notice): field IDs only, never their values. Empty for a no-op.
   */
  readonly recalculatedFieldIds: readonly FieldId[];
}

/**
 * The subject the command named does not exist. It is a result, not an error:
 * a stale link and a record someone else deleted are the same ordinary
 * situation, and the surface needs to say so rather than show a failure.
 */
export interface CommandUnknownSubjectV1 {
  readonly outcome: "unknown-subject";
  readonly subject: "table" | "record" | "deleted-record";
}

export interface CommandRejectedV1 {
  readonly outcome: "rejected";
  /** The whole report, so every field at fault can be named (D23). */
  readonly report: ValidationReport;
}

export type CommandResultV1 =
  | CommandAcceptedV1
  | CommandRejectedV1
  | CommandUnknownSubjectV1;

export interface CommandDependenciesV1 {
  readonly clock: ClockPort;
  readonly entropy: DomainEntropy;
  readonly projection: ProjectionEnginePort;
  readonly repository: LocalEventRepository;
  /** SHA-256 over the record's canonical form; M09 + M08 supply it. */
  readonly recordDigest: (record: AuthoredRecordV1) => Promise<Uint8Array>;
  /**
   * The clock a frozen formula's one evaluation reads: `TODAY()` in local
   * time, which the data worker derives from its `ClockPort`. Absent, the
   * UTC day of `clock` stands in.
   */
  readonly formulaClock?: () => EvaluationClockReadingV1;
}

const MS_PER_DAY = 86_400_000;

/** The formula clock a command evaluates with. */
export function formulaClockOf(
  deps: Pick<CommandDependenciesV1, "clock" | "formulaClock">,
): () => EvaluationClockReadingV1 {
  return (
    deps.formulaClock ??
    (() => {
      const epochMs = deps.clock.nowEpochMs();
      return { epochMs, epochDay: Math.floor(epochMs / MS_PER_DAY) };
    })
  );
}

export async function executeCommand(
  deps: CommandDependenciesV1,
  command: CommandV1,
): Promise<CommandResultV1> {
  switch (command.kind) {
    case "create-record":
      return createRecord(deps, command);
    case "patch-record":
      return patchRecord(deps, command);
    case "delete-record":
      return deleteRecord(deps, command);
    case "restore-record":
      return restoreRecord(deps, command);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

// ------------------------------------------------------------------ create --

async function createRecord(
  deps: CommandDependenciesV1,
  command: Extract<CommandV1, { kind: "create-record" }>,
): Promise<CommandResultV1> {
  const context = buildValidationContext(deps.projection, command.tableId);
  if (context === null) {
    return { outcome: "unknown-subject", subject: "table" };
  }

  const recordId = createDomainId("record", deps.entropy);
  const authored = completeValues(context.table.fields, command.values);
  const frozen = frozenLiterals(deps, context.table, recordId, authored);
  const values = new Map([...authored, ...frozen.values]);
  const provenance = new Map([...provenanceFor(authored), ...frozen.provenance]);
  const report = validateRecord(context, {
    recordId,
    tableId: context.table.tableId,
    values,
    provenance,
  });
  if (!report.isValid) {
    return { outcome: "rejected", report };
  }

  const record: AuthoredRecordV1 = {
    recordId,
    tableId: context.table.tableId,
    values,
    provenance,
  };

  const committed = await commitEvents(
    deps,
    [
      {
        subject: { tableId: context.table.tableId, recordId },
        event: {
          kind: "record.created",
          // An authored write can never assert this: the validator passed.
          payload: { record, importedInvalid: false },
        },
      },
    ],
    { issues: issuesOf(report), rowCountAfter: liveRecordCount(deps.projection) + 1 },
  );

  return {
    outcome: "accepted",
    recordId,
    tableId: context.table.tableId,
    recordRevision: 0n,
    ...committed,
  };
}

// ------------------------------------------------------------------- patch --

async function patchRecord(
  deps: CommandDependenciesV1,
  command: Extract<CommandV1, { kind: "patch-record" }>,
): Promise<CommandResultV1> {
  const current = deps.projection.execute({
    kind: "record-by-id",
    recordId: command.recordId,
  });
  if (current === null) {
    return { outcome: "unknown-subject", subject: "record" };
  }

  const context = buildValidationContext(deps.projection, current.tableId);
  if (context === null) {
    return { outcome: "unknown-subject", subject: "table" };
  }

  const before = completeValues(context.table.fields, current.authoredValues);
  const requested = rekeyByFields(context.table.fields, command.changes);
  const after = new Map(before);
  for (const [fieldId, value] of requested) {
    after.set(fieldId, value);
  }

  const changes: readonly FieldChangeV1[] = [...requested]
    .filter(([fieldId, value]) => {
      const previous = before.get(fieldId) ?? MISSING_VALUE;
      return !cellValuesEqual(previous, value);
    })
    .map(([fieldId, value]) => ({
      fieldId,
      before: before.get(fieldId) ?? MISSING_VALUE,
      after: value,
      provenance: AUTHORED,
    }));

  // Only the values that move are authored by this patch; a reference carried
  // over unchanged is judged as the earlier write left it (D36).
  const report = validateRecord(context, {
    recordId: current.recordId,
    tableId: context.table.tableId,
    values: after,
    provenance: changeProvenance(changes),
  });
  if (!report.isValid) {
    return { outcome: "rejected", report };
  }

  if (changes.length === 0) {
    // Nothing moved. An event here would record a change the data does not
    // show, so the record is reported exactly as it stands.
    return {
      outcome: "accepted",
      recordId: current.recordId,
      tableId: current.tableId,
      recordRevision: current.recordRevision,
      commit: null,
      recalculatedFieldIds: [],
    };
  }

  const recordRevision = current.recordRevision + 1n;
  const resulting: AuthoredRecordV1 = {
    recordId: current.recordId,
    tableId: context.table.tableId,
    values: after,
    provenance: patchedProvenance(context.table.fields, current, changes),
  };

  const committed = await commitEvents(
    deps,
    [
      {
        subject: {
          tableId: context.table.tableId,
          recordId: current.recordId,
        },
        event: {
          kind: "record.patched",
          payload: {
            recordId: current.recordId,
            tableId: context.table.tableId,
            // The revision this patch *results in*; S02 guards current + 1.
            recordRevision,
            changes,
            resultingRecordSha256: await deps.recordDigest(resulting),
          },
        },
      },
    ],
    { issues: issuesOf(report), rowCountAfter: liveRecordCount(deps.projection) },
  );

  return {
    outcome: "accepted",
    recordId: current.recordId,
    tableId: context.table.tableId,
    recordRevision,
    ...committed,
  };
}

// ------------------------------------------------------------------ delete --

async function deleteRecord(
  deps: CommandDependenciesV1,
  command: Extract<CommandV1, { kind: "delete-record" }>,
): Promise<CommandResultV1> {
  const current = deps.projection.execute({
    kind: "record-by-id",
    recordId: command.recordId,
  });
  if (current === null) {
    return { outcome: "unknown-subject", subject: "record" };
  }

  const restoration: AuthoredRecordV1 = {
    recordId: current.recordId,
    tableId: current.tableId,
    values: new Map(current.authoredValues),
    provenance: new Map(current.provenance),
  };

  const committed = await commitEvents(
    deps,
    [
      {
        subject: { tableId: current.tableId, recordId: current.recordId },
        event: {
          kind: "record.deleted",
          payload: {
            recordId: current.recordId,
            tableId: current.tableId,
            priorRecordRevision: current.recordRevision,
            // The complete payload is what makes the delete recoverable
            // (FR-12); a delete naming only the record could not be undone.
            restoration,
            source: "user",
          },
        },
      },
    ],
    { rowCountAfter: Math.max(0, liveRecordCount(deps.projection) - 1) },
  );

  return {
    outcome: "accepted",
    recordId: current.recordId,
    tableId: current.tableId,
    recordRevision: current.recordRevision,
    ...committed,
  };
}

// ----------------------------------------------------------------- restore --

async function restoreRecord(
  deps: CommandDependenciesV1,
  command: Extract<CommandV1, { kind: "restore-record" }>,
): Promise<CommandResultV1> {
  const live = deps.projection.execute({
    kind: "record-by-id",
    recordId: command.recordId,
  });
  if (live !== null) {
    // Already back. Restoring twice is the same request answered twice.
    return {
      outcome: "accepted",
      recordId: live.recordId,
      tableId: live.tableId,
      recordRevision: live.recordRevision,
      commit: null,
      recalculatedFieldIds: [],
    };
  }

  const history = deps.projection.execute({
    kind: "record-change-history",
    recordId: command.recordId,
    limit: RESTORE_HISTORY_LIMIT,
  });
  // History is newest first, so the first delete is the one being undone.
  const deleted = history.find(
    (entry) => entry.eventKind === "record.deleted" && entry.restoration !== null,
  );
  if (deleted === undefined || deleted.restoration === null) {
    return { outcome: "unknown-subject", subject: "deleted-record" };
  }
  const restoration = deleted.restoration;

  const context = buildValidationContext(deps.projection, restoration.tableId);
  if (context === null) {
    return { outcome: "unknown-subject", subject: "table" };
  }

  // FR-12: a restore is validated before it commits, against the schema as it
  // stands now — not as it stood when the record was deleted.
  const values = completeValues(context.table.fields, restoration.values);
  const provenance = rekeyByFields(context.table.fields, restoration.provenance);
  const report = validateRecord(context, {
    recordId: restoration.recordId,
    tableId: context.table.tableId,
    values,
    provenance,
  });
  if (!report.isValid) {
    return { outcome: "rejected", report };
  }

  const record: AuthoredRecordV1 = {
    recordId: restoration.recordId,
    tableId: context.table.tableId,
    values,
    provenance,
  };

  const committed = await commitEvents(
    deps,
    [
      {
        subject: {
          tableId: context.table.tableId,
          recordId: restoration.recordId,
        },
        event: {
          kind: "record.restored",
          payload: { deletedEventId: deleted.eventId, record },
        },
      },
    ],
    { issues: issuesOf(report), rowCountAfter: liveRecordCount(deps.projection) + 1 },
  );

  return {
    outcome: "accepted",
    recordId: restoration.recordId,
    tableId: context.table.tableId,
    // The projection puts a restored record one revision past its delete.
    recordRevision: (deleted.summary.recordRevision ?? 0n) + 1n,
    ...committed,
  };
}

// ------------------------------------------------------------------ shared --

export interface CommitOptionsV1 {
  /** The validator's verdict for the record the first event leaves behind. */
  readonly issues?: readonly ProjectionIssueInputV1[];
  readonly rowCountAfter: number;
  /**
   * A schema commit: the schema revision advances by one, and every record
   * of a table it re-shapes is re-judged through the shared validator once
   * its events land (invariant 5).
   */
  readonly isSchemaChange?: boolean;
}

export interface CommittedV1 {
  readonly commit: CommitReceiptV1;
  readonly recalculatedFieldIds: readonly FieldId[];
}

/**
 * Durable first, projection second, acknowledgement last (invariant 1). The
 * projection is brought forward with the commit as it was *written*, so its
 * hash and chain guards check the durable bytes, and it recalculates in the
 * same transaction (D60).
 */
export async function commitEvents(
  deps: Pick<CommandDependenciesV1, "clock" | "entropy" | "projection" | "repository">,
  drafts: readonly AuthoredEventDraftV1[],
  options: CommitOptionsV1,
): Promise<CommittedV1> {
  const plan = buildAuthoredCommit(
    { clock: deps.clock, entropy: deps.entropy },
    deps.repository.chainState(),
    drafts,
    options.isSchemaChange === true,
  );

  const issuesByEventIndex =
    options.issues === undefined || options.issues.length === 0
      ? undefined
      : new Map([[0, options.issues]]);

  const commit = await deps.repository.append({
    plan,
    ...(issuesByEventIndex === undefined ? {} : { issuesByEventIndex }),
    rowCountAfter: options.rowCountAfter,
  });

  const applied = await deps.projection.applyEvents([
    {
      commit: commit.commit,
      events: plan.events.map((planned) => planned.event),
      ...(issuesByEventIndex === undefined ? {} : { issuesByEventIndex }),
      ...(options.isSchemaChange === true ? { revalidate: projectionRevalidator(deps.projection) } : {}),
    },
  ]);

  return { commit, recalculatedFieldIds: applied.recalculatedFieldIds };
}

/**
 * The validator a re-shaped table's records are re-judged through, against
 * the projection as the commit left it. A re-judgement authors nothing, so
 * it claims no provenance — exactly as a command sees a record it did not
 * touch (D36).
 */
export function projectionRevalidator(
  projection: ProjectionEnginePort,
): (record: AuthoredRecordV1) => readonly ProjectionIssueInputV1[] {
  return (record) =>
    validateAgainstProjection(projection, {
      recordId: record.recordId,
      tableId: record.tableId,
      values: record.values,
      provenance: new Map(),
    })?.issues.map(toIssueInput) ?? [];
}

/**
 * The literal each frozen column of a new record holds (D51): its formula
 * evaluated exactly once, seeded by `EntropyPort`, with provenance
 * `evidence.frozen` — the one user write to a computed field the validator
 * accepts. An unsupported column gets nothing and is flagged by
 * recalculation; a live column is never authored.
 */
function frozenLiterals(
  deps: CommandDependenciesV1,
  table: TableDefV1,
  recordId: RecordId,
  values: ReadonlyMap<FieldId, CellValueV1>,
): {
  readonly values: ReadonlyMap<FieldId, CellValueV1>;
  readonly provenance: ReadonlyMap<FieldId, ValueProvenanceV1>;
} {
  const formulas = deps.projection
    .execute({ kind: "list-formulas", tableId: table.tableId })
    .filter((entry) => entry.isActive && entry.formula.disposition === "frozen");
  const literals = new Map<FieldId, CellValueV1>();
  const provenance = new Map<FieldId, ValueProvenanceV1>();
  if (formulas.length === 0) {
    return { values: literals, provenance };
  }
  const rows = new ProjectionRows(deps.projection);
  const env = projectionFormulaEnv(deps.projection, rows, formulaClockOf(deps));
  const row = {
    recordId,
    values: new Map([...values].map(([fieldId, value]) => [encodeDomainId(fieldId), value])),
    computed: new Map(),
  };
  for (const { formula } of formulas) {
    if (formula.target.kind !== "computed-column") continue;
    const field = canonicalField(table.fields, formula.target.fieldId);
    const literal = field?.isActive === true ? frozenLiteral(formula, row, deps.entropy, env) : null;
    if (field === undefined || literal === null) continue;
    literals.set(field.fieldId, literal);
    provenance.set(field.fieldId, { source: "user", evidence: { frozen: formula.originalText } });
  }
  return { values: literals, provenance };
}

const canonicalField = (
  fields: readonly FieldDefV1[],
  fieldId: FieldId,
): FieldDefV1 | undefined =>
  fields.find((field) => encodeDomainId(field.fieldId) === encodeDomainId(fieldId));

/**
 * The table, its fields, its option sets, and its rules — every input
 * `validateRecord` takes, keyed by one set of field instances. Returns null
 * when the projection holds no such table.
 */
export function buildValidationContext(
  projection: ProjectionEnginePort,
  tableId: TableId,
): (ValidationContext & { readonly table: TableDefV1 }) | null {
  const summary = projection
    .execute({ kind: "list-tables" })
    .find((table) => encodeDomainId(table.tableId) === encodeDomainId(tableId));
  if (summary === undefined) {
    return null;
  }

  const fields = projection.execute({ kind: "list-fields", tableId: summary.tableId });
  const enumOptions = new Map<FieldId, readonly EnumOptionDefV1[]>();
  for (const field of fields) {
    if (field.type.kind === "enum") {
      enumOptions.set(
        field.fieldId,
        projection.execute({
          kind: "list-enum-options",
          fieldId: field.fieldId,
        }),
      );
    }
  }

  return {
    table: { ...summary, fields },
    enumOptions,
    // Roshi Seam A: F02 authors no rule events, so this list is truthfully
    // empty rather than missing a producer.
    rules: projection
      .execute({ kind: "list-validation-rules", tableId: summary.tableId })
      .map((rule) => rule.rule),
    referenceExists: projectionReferenceResolver(projection),
    referenceTargets: projection
      .execute({ kind: "list-relationships", tableId: summary.tableId })
      .filter(
        ({ relationship }) =>
          relationship.isActive &&
          encodeDomainId(relationship.fromTableId) === encodeDomainId(summary.tableId),
      )
      .map(({ relationship, toTableName }) => ({
        fieldId: canonicalFieldId(fields, relationship.fromFieldId),
        tableId: relationship.toTableId,
        tableLabel: toTableName,
      })),
  };
}

/**
 * The one reference resolver over a hydrated app: a record id resolves when a
 * record with that id is live in exactly the named table — deleted, absent,
 * and "live in another table" all fail. Commands and tail replay use this;
 * promotion answers the same {@link ReferenceResolver} type from its own key
 * map.
 */
export function projectionReferenceResolver(
  projection: ProjectionEnginePort,
): ReferenceResolver {
  return (tableId, recordId) =>
    projection.execute({ kind: "record-is-live", tableId, recordId });
}

/**
 * Validates a record exactly as a command would against the projection as it
 * stands now — the tail-replay half of invariant 5. Null when the projection
 * holds no such table.
 */
export function validateAgainstProjection(
  projection: ProjectionEnginePort,
  record: {
    readonly recordId: RecordId;
    readonly tableId: TableId;
    readonly values: ReadonlyMap<FieldId, CellValueV1>;
    readonly provenance: ReadonlyMap<FieldId, ValueProvenanceV1>;
  },
): ValidationReport | null {
  const context = buildValidationContext(projection, record.tableId);
  if (context === null) {
    return null;
  }
  return validateRecord(context, {
    recordId: record.recordId,
    tableId: context.table.tableId,
    values: completeValues(context.table.fields, record.values),
    provenance: rekeyByFields(context.table.fields, record.provenance),
  });
}

const canonicalFieldId = (
  fields: readonly FieldDefV1[],
  fieldId: FieldId,
): FieldId =>
  fields.find((field) => encodeDomainId(field.fieldId) === encodeDomainId(fieldId))
    ?.fieldId ?? fieldId;

/** The provenance a patch asserts: exactly the fields it moves. */
export const changeProvenance = (
  changes: readonly FieldChangeV1[],
): ReadonlyMap<FieldId, ValueProvenanceV1> =>
  new Map(changes.map((change) => [change.fieldId, change.provenance]));

/**
 * Re-keys a map onto `fields`' own `FieldId` instances. An id no field
 * matches is kept exactly as it arrived, so `validateRecord`'s unknown-field
 * check still sees it.
 */
export function rekeyByFields<T>(
  fields: readonly FieldDefV1[],
  values: ReadonlyMap<FieldId, T>,
): Map<FieldId, T> {
  const canonical = new Map(
    fields.map((field) => [encodeDomainId(field.fieldId), field.fieldId]),
  );
  return new Map(
    [...values].map(([fieldId, value]) => [
      canonical.get(encodeDomainId(fieldId)) ?? fieldId,
      value,
    ]),
  );
}

/**
 * Every active authored field named, so an absent value is `missing` and says
 * so. A computed field is not completed: its value is not the author's to
 * give (D51), and naming it here would read as authoring it.
 */
function completeValues(
  fields: readonly FieldDefV1[],
  values: ReadonlyMap<FieldId, CellValueV1>,
): Map<FieldId, CellValueV1> {
  const rekeyed = rekeyByFields(fields, values);
  for (const field of fields) {
    if (field.isActive && !isComputedField(field) && !rekeyed.has(field.fieldId)) {
      rekeyed.set(field.fieldId, MISSING_VALUE);
    }
  }
  return rekeyed;
}

const provenanceFor = (
  values: ReadonlyMap<FieldId, CellValueV1>,
): ReadonlyMap<FieldId, ValueProvenanceV1> =>
  new Map([...values.keys()].map((fieldId) => [fieldId, AUTHORED]));

/** The prior provenance, with the patched fields now attributed to the user. */
function patchedProvenance(
  fields: readonly FieldDefV1[],
  current: ProjectionRecordDetailV1,
  changes: readonly FieldChangeV1[],
): ReadonlyMap<FieldId, ValueProvenanceV1> {
  const provenance = rekeyByFields(fields, current.provenance);
  for (const change of changes) {
    provenance.set(change.fieldId, change.provenance);
  }
  return provenance;
}

/** One validator issue in the shape the projection stores it. */
const toIssueInput = (issue: ValidationReport["issues"][number]): ProjectionIssueInputV1 => ({
  fieldId: issue.fieldId,
  ruleId: issue.ruleId,
  kind: issue.kind,
  severity: issue.severity,
  messageKey: issue.messageKey,
  messageParameters: issue.messageParameters,
});

/** The validator's issues in the shape the projection stores them. */
export const issuesOf = (report: ValidationReport): readonly ProjectionIssueInputV1[] =>
  report.issues.map(toIssueInput);

/** The app's live record count, summed over its active tables (CA-14). */
export function liveRecordCount(projection: ProjectionEnginePort): number {
  return projection
    .execute({ kind: "list-tables" })
    .reduce(
      (total, table) =>
        total + projection.execute({ kind: "count-records", tableId: table.tableId }),
      0,
    );
}
