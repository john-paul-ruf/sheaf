import { constantTimeEquals } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import type { AuthoredRecordV1 } from "../../domain/model/events.js";
import { compareDomainIds } from "../../domain/model/ids.js";
import { decodeCanonical, encodeCanonical, type CborValue, type DecodedValue } from "../codecs/canonical-cbor.js";
import { encodeEventProvenance } from "../codecs/event-commit.js";
import { decodeAuthoredRecord, decodeCellValue, encodeCellValue, encodeFrontier } from "./cbor-values.js";
import { run, selectRow, toSqlInteger, type ProjectionHandleV1 } from "./engine.js";
import { authoredRecords } from "./authored-state.js";
import { F04_SCHEMA_EVENT_KINDS } from "../../domain/model/events.js";
import { idKey } from "./record-rows.js";
import type { ProjectionCommitV1, ProjectionEvidenceBaselineV1, ProjectionEvidenceEventV1, ProjectionEvidenceReportV1,
  ProjectionEvidenceStateV1, ProjectionReplayEventV1, ValidationIssueV1Input } from "./types.js";

export const isProjectionEvidence = (event: ProjectionReplayEventV1): event is ProjectionEvidenceEventV1 =>
  event.kind === "conflict.detected" || event.kind === "conflict.resolved" || event.kind === "merge.applied";

const same = (left: Uint8Array | null | undefined, right: Uint8Array | null | undefined) =>
  left == null || right == null ? left === right : constantTimeEquals(left, right);
const fail = (message: string): never => { throw new IntegrityError(message); };
const map = (value: DecodedValue): ReadonlyMap<string, DecodedValue> => {
  if (!(value instanceof Map)) return fail("invalid stored original evidence");
  return value as ReadonlyMap<string, DecodedValue>;
};
const bytes = (value: DecodedValue | undefined): Uint8Array => value instanceof Uint8Array ? value : fail("missing original evidence identity");
const encode = (value: unknown): Uint8Array => encodeCanonical(value as CborValue);

export function evidenceRecordBytes(record: AuthoredRecordV1): Uint8Array {
  return encode(new Map<string, CborValue>([
    ["recordId", record.recordId], ["tableId", record.tableId],
    ["values", [...record.values].sort(([a], [b]) => compareDomainIds(a, b)).map(([fieldId, value]) => new Map<string, CborValue>([["fieldId", fieldId], ["value", encodeCellValue(value)]]))],
    ["provenance", [...record.provenance].sort(([a], [b]) => compareDomainIds(a, b)).map(([fieldId, value]) => new Map<string, CborValue>([["fieldId", fieldId], ["value", encodeEventProvenance(value)]]))],
  ]));
}

export function currentEvidenceState(handle: ProjectionHandleV1, recordId: Uint8Array): Uint8Array {
  const row = selectRow(handle, "SELECT authored_cbor FROM records WHERE record_id = ?", [recordId]);
  if (row !== null) return encode(new Map<string, CborValue>([["state", "present"], ["value", decodeCanonical(evidenceRecordBytes(decodeAuthoredRecord(row[0] as Uint8Array)))]]));
  const deleted = selectRow(handle, "SELECT event_kind FROM change_history WHERE subject_kind = 'record' AND subject_id = ? AND event_kind IN ('record.created', 'record.restored', 'record.deleted') ORDER BY wall_time_ms DESC, logical_counter DESC, device_id DESC, commit_id DESC, event_index DESC LIMIT 1", [recordId]);
  return encode(new Map<string, CborValue>([["state", deleted?.[0] === "record.deleted" ? "deleted" : "absent"], ["value", null]]));
}

function baselineValues(bytes: Uint8Array | null): Uint8Array | null {
  if (bytes === null) return null;
  const entries = decodeCanonical(bytes);
  if (!Array.isArray(entries)) return fail("invalid stored baseline values");
  return encode([...(entries as readonly DecodedValue[])].sort((a, b) => compareDomainIds(
    map(a).get("fieldId") as Uint8Array, map(b).get("fieldId") as Uint8Array)));
}
function requireBaseline(handle: ProjectionHandleV1, baseline: ProjectionEvidenceBaselineV1, tableId: Uint8Array, recordId: Uint8Array): void {
  const row = selectRow(handle, "SELECT baseline_state, value_cbor, absent_reason, source_frontier_cbor FROM baseline_records WHERE baseline_scope_id = ? AND table_id = ? AND record_id = ?", [baseline.scopeId, tableId, recordId]);
  if (row === null || row[0] !== baseline.state || !same(baselineValues(row[1] as Uint8Array | null), baselineValues(baseline.values)) || row[2] !== baseline.absentReason || !same(row[3] as Uint8Array, encodeFrontier(baseline.frontier))) {
    fail("original evidence disagrees with independently authenticated baseline");
  }
}

function issueBytes(issue: ValidationIssueV1Input): Uint8Array {
  return encode(new Map<string, CborValue>([["fieldId", issue.fieldId], ["ruleId", issue.ruleId], ["kind", issue.kind],
    ["severity", issue.severity], ["messageKey", issue.messageKey], ["messageParameters", new Map(Object.entries(issue.messageParameters))]]));
}
function requireReport(entry: ProjectionCommitV1, report: ProjectionEvidenceReportV1, record: AuthoredRecordV1 | readonly AuthoredRecordV1[]): void {
  if (entry.revalidate === undefined) fail("original evidence requires the shared validator");
  const actual = Array.isArray(record) ? (record as readonly AuthoredRecordV1[]).flatMap(entry.revalidate!) : entry.revalidate!(record as AuthoredRecordV1);
  const key = (value: Uint8Array) => [...value].join(",");
  const expectedIssues = report.issues.map((issue) => key(issueBytes(issue))).sort();
  const actualIssues = actual.map((issue) => key(issueBytes(issue))).sort();
  if (report.isValid !== !actual.some((issue) => issue.severity === "blocking") || expectedIssues.length !== actualIssues.length || expectedIssues.some((issue, index) => issue !== actualIssues[index])) {
    fail("original evidence report disagrees with shared validation");
  }
}
function requireRecordSubject(record: AuthoredRecordV1 | null, tableId: Uint8Array, recordId: Uint8Array): void {
  if (record !== null && (!same(record.tableId, tableId) || !same(record.recordId, recordId))) fail("original evidence names another record");
}
function requireResult(handle: ProjectionHandleV1, entry: ProjectionCommitV1, state: ProjectionEvidenceStateV1, report: ProjectionEvidenceReportV1, tableId: Uint8Array, recordId: Uint8Array): void {
  if (state.state === "absent") fail("a resolved record cannot be absent");
  requireRecordSubject(state.record, tableId, recordId);
  if (!same(currentEvidenceState(handle, recordId), state.canonical)) fail("original effects do not produce the declared result");
  if (state.record !== null) requireReport(entry, report, state.record);
  else if (!report.isValid || report.issues.length !== 0) fail("deleted result carries a validation report for another state");
}
function requireEffects(entry: ProjectionCommitV1, index: number, ids: readonly Uint8Array[], tableId: Uint8Array, recordId: Uint8Array,
  result: Uint8Array, local: Uint8Array, before: Uint8Array | undefined, claimed: Set<string>): void {
  const expected = entry.commit.events.slice(0, index).filter((wire) => wire.kind.startsWith("record.") && same(wire.subject.recordId, recordId));
  if (expected.length !== ids.length || expected.some((wire, i) => !same(wire.eventId, ids[i]) || !same(wire.subject.tableId, tableId) || claimed.has(idKey(wire.eventId)))) {
    fail("original evidence does not name its exact same-commit record effects");
  }
  if (before === undefined || !same(before, local)) fail("original local alternative differs from the pre-effect record");
  if (ids.length === 0 && !same(result, local)) fail("changed original result lacks mutation effects");
  ids.forEach((id) => claimed.add(idKey(id)));
}

function requireMerge(handle: ProjectionHandleV1, event: Extract<ProjectionEvidenceEventV1, { kind: "merge.applied" }>): void {
  const p = event.payload;
  if (p.baseline.state !== "present" || p.baseline.values === null || p.local.state.record === null || p.incoming.state.record === null) fail("automatic merge lacks present inputs");
  const baselineEntries = decodeCanonical(p.baseline.values!) as readonly DecodedValue[];
  const baseline = new Map(baselineEntries.map((entry) => { const value = map(entry); return [idKey(bytes(value.get("fieldId"))), decodeCellValue(value.get("value")!)]; }));
  const values = (record: AuthoredRecordV1) => new Map([...record.values].map(([id, value]) => [idKey(id), { id, value }]));
  const local = values(p.local.state.record!); const incoming = values(p.incoming.state.record!); const result = values(p.result);
  if (local.size !== baseline.size || incoming.size !== baseline.size || result.size !== baseline.size) fail("merge changes record identity or field coverage");
  const localChanged: Uint8Array[] = []; const incomingChanged: Uint8Array[] = [];
  const table = handle.schema.tables.get(idKey(p.tableId));
  if (table === undefined) fail("merge table is absent");
  for (const [key, base] of baseline) {
    const a = local.get(key); const b = incoming.get(key); const r = result.get(key);
    if (a === undefined || b === undefined || r === undefined) fail("merge omits a baseline field");
    const equalValue = (x: typeof base, y: typeof base) => same(encode(encodeCellValue(x)), encode(encodeCellValue(y)));
    const leftChanged = !equalValue(a!.value, base); const rightChanged = !equalValue(b!.value, base);
    if (leftChanged) localChanged.push(a!.id);
    if (rightChanged) incomingChanged.push(b!.id);
    if (leftChanged && rightChanged && !equalValue(a!.value, b!.value)) fail("automatic merge has conflicting same-field values");
    const field = handle.schema.fields.get(key);
    if ((leftChanged || rightChanged) && (same(table!.keyFieldId, a!.id) || field?.type.kind === "reference")) fail("automatic merge changes a key or reference");
    if (!equalValue(r!.value, rightChanged ? b!.value : a!.value)) fail("automatic merge result violates three-way values");
  }
  const equalIds = (actual: Uint8Array[], declared: readonly Uint8Array[]) => actual.sort(compareDomainIds).length === declared.length && actual.every((id, index) => same(id, declared[index]));
  if (!equalIds(localChanged, p.localChangedFields) || !equalIds(incomingChanged, p.incomingChangedFields)) fail("merge changed-field evidence disagrees with source values");
}


function requireIdentity(handle: ProjectionHandleV1, state: ProjectionEvidenceStateV1, tableId: Uint8Array): void {
  const identity = state.identity;
  if (state.state !== "present" || identity === undefined) fail("identity evidence requires complete candidates");
  if (identity!.matchFieldId !== null && !same(handle.schema.fields.get(idKey(identity!.matchFieldId))?.tableId, tableId)) fail("identity match field belongs to another table");
  for (const record of identity!.candidates) {
    if (!same(record.tableId, tableId) || !same(encode(map(decodeCanonical(currentEvidenceState(handle, record.recordId))).get("value")), evidenceRecordBytes(record))) fail("identity candidate disagrees with the original record");
  }
}
function requireObjectEffects(entry: ProjectionCommitV1, index: number, ids: readonly Uint8Array[], tableId: Uint8Array, schema: boolean, claimed: Set<string>): void {
  const kinds = new Set<string>(["table.created", "field.created", "enum.changed", ...F04_SCHEMA_EVENT_KINDS]);
  const expected = entry.commit.events.slice(0, index).filter((wire) => same(wire.subject.tableId, tableId) && (schema ? kinds.has(wire.kind) : wire.kind.startsWith("record.")));
  if (expected.length !== ids.length || expected.some((wire, i) => !same(wire.eventId, ids[i]) || claimed.has(idKey(wire.eventId)))) fail("object evidence lacks its exact same-commit effects");
  ids.forEach((id) => claimed.add(idKey(id)));
}

/** Writes only evidence indexes; ordinary events own every authored mutation. */
export function applyEvidenceEvent(handle: ProjectionHandleV1, entry: ProjectionCommitV1, index: number, event: ProjectionEvidenceEventV1,
  before: ReadonlyMap<string, Uint8Array>, claimed: Set<string>): Uint8Array {
  const wire = entry.commit.events[index]!;
  const p = event.payload;
  if (!same(event.canonical, encode(wire.payload))) fail("typed original evidence differs from its authenticated payload");
  toSqlInteger(p.schemaRevision);
  if (p.schemaRevision !== entry.commit.schemaRevisionAfter || wire.subject.fieldId !== undefined) fail("original evidence schema or subject disagrees");
  if (event.kind === "conflict.detected") {
    const p = event.payload;
    if (!same(wire.subject.objectId, p.conflictId) || !same(wire.subject.tableId, p.tableId) ||
        (p.targetKind === "record" ? !same(wire.subject.recordId, p.targetId) : wire.subject.recordId !== undefined)) fail("conflict detection names another subject");
    if (!handle.schema.tables.has(idKey(p.tableId))) fail("conflict table is absent");
    for (const id of p.conflictingFields) if (!same(handle.schema.fields.get(idKey(id))?.tableId, p.tableId)) fail("conflict field belongs to another table");
    if (p.baseline !== null) requireBaseline(handle, p.baseline, p.tableId, p.targetId);
    if (p.targetKind === "record") {
      if (p.baseline === null) fail("record conflict lacks baseline");
      requireRecordSubject(p.local.state.record, p.tableId, p.targetId);
      requireRecordSubject(p.incoming.state.record, p.tableId, p.targetId);
      if (!same(currentEvidenceState(handle, p.targetId), p.local.state.canonical)) fail("conflict detection changes or misstates local data");
      if (p.validationReport !== null) {
        if (p.incoming.state.record === null) fail("conflict report lacks a record");
        requireReport(entry, p.validationReport, p.incoming.state.record!);
      }
    } else if (p.targetKind === "schema") {
      if (entry.schemaEvidence === undefined || !same(entry.schemaEvidence(), p.local.state.canonical)) fail("conflict misstates original local schema");
      if (!same(p.targetId, p.tableId) && !same(handle.schema.fields.get(idKey(p.targetId))?.tableId, p.tableId)) fail("schema conflict target is absent");
    } else requireIdentity(handle, p.local.state, p.tableId);
    run(handle, "INSERT INTO pending_conflicts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)",
      [p.conflictId, p.tableId, p.targetId, p.baseline?.scopeId ?? null, p.conflictKind, p.baseline?.canonical ?? null, p.local.canonical, p.incoming.canonical,
        encode(p.conflictingFields), p.validationReport?.canonical ?? null, p.local.source, p.incoming.source, p.local.timestampMs, p.incoming.timestampMs,
        toSqlInteger(entry.commit.hybridTime.wallTimeMs), wire.eventId]);
    return p.tableId;
  }
  if (event.kind === "conflict.resolved") {
    const p = event.payload;
    const row = selectRow(handle, "SELECT table_id, record_id, conflict_kind, local_version_cbor, incoming_version_cbor, detected_event_id, status FROM pending_conflicts WHERE conflict_id = ?", [p.conflictId]);
    if (row === null || row[6] !== "pending" || !same(row[5] as Uint8Array, p.detectedEventId) || wire.provenance.source !== "conflict-resolution" ||
      !same(wire.subject.objectId, p.conflictId) || !same(wire.subject.tableId, row[0] as Uint8Array) ||
      (row[2] === "schema" || row[2] === "identity" ? wire.subject.recordId !== undefined : !same(wire.subject.recordId, row[1] as Uint8Array))) fail("resolution lacks its pending original subject");
    const tableId = row![0] as Uint8Array; const recordId = row![1] as Uint8Array;

    const local = encode(map(decodeCanonical(row![3] as Uint8Array)).get("state"));
    const incoming = encode(map(decodeCanonical(row![4] as Uint8Array)).get("state"));
    if ((p.decision === "keep-local" && !same(p.result.canonical, local)) || (p.decision === "use-incoming" && !same(p.result.canonical, incoming))) fail("resolution contradicts its chosen alternative");
    if (row![2] === "schema") {
      if (entry.schemaEvidence === undefined || !same(entry.schemaEvidence(), p.result.canonical) || !same(before.get("schema"), local)) fail("schema effects differ from the original alternatives");
      requireObjectEffects(entry, index, p.effectEventIds, tableId, true, claimed);
      if (p.effectEventIds.length === 0 && !same(local, p.result.canonical)) fail("changed schema lacks effects");
      requireReport(entry, p.validationReport, [...authoredRecords(handle, new AbortController().signal)].map((row) => row.record));
    } else if (row![2] === "identity") {
      requireIdentity(handle, p.result, tableId);
      requireObjectEffects(entry, index, p.effectEventIds, tableId, false, claimed);
      if (p.result.identity === undefined) fail("identity result lacks candidates");
      requireReport(entry, p.validationReport, p.result.identity!.candidates);
      const localCandidates = map(map(decodeCanonical(local)).get("value")!).get("candidates");
      if (!Array.isArray(localCandidates)) fail("local identity lacks candidates");
      for (const candidate of localCandidates as readonly DecodedValue[]) {
        const recordId = bytes(map(candidate).get("recordId"));
        const prior = before.get(idKey(recordId));
        if (prior === undefined || !same(encode(map(decodeCanonical(prior)).get("value")), encode(candidate))) fail("identity local candidate differs before effects");
      }
      const localIds = new Set((localCandidates as readonly DecodedValue[]).map((candidate) => idKey(bytes(map(candidate).get("recordId")))));
      const resultIds = new Set(p.result.identity!.candidates.map((record) => idKey(record.recordId)));
      const effects = entry.commit.events.slice(0, index).filter((effect) => p.effectEventIds.some((id) => same(id, effect.eventId)));
      for (const effect of effects) {
        if (effect.subject.recordId === undefined || (!localIds.has(idKey(effect.subject.recordId)) && !resultIds.has(idKey(effect.subject.recordId)))) {
          fail("identity effects name a record outside the declared candidates");
        }
      }
      for (const candidate of localCandidates as readonly DecodedValue[]) {
        const recordId = bytes(map(candidate).get("recordId"));
        if (!resultIds.has(idKey(recordId)) && map(decodeCanonical(currentEvidenceState(handle, recordId))).get("state") !== "deleted") {
          fail("identity result omits a surviving local candidate");
        }
      }
      if (p.effectEventIds.length === 0 && !same(local, p.result.canonical)) fail("changed identity lacks effects");
    } else {
      requireResult(handle, entry, p.result, p.validationReport, tableId, recordId);
      requireEffects(entry, index, p.effectEventIds, tableId, recordId, p.result.canonical, local, before.get(idKey(recordId)), claimed);
    }
    run(handle, "UPDATE pending_conflicts SET status = 'resolved', resolved_event_id = ? WHERE conflict_id = ?", [wire.eventId, p.conflictId]);
    return tableId;
  }
  const m = event.payload;
  if (!same(wire.subject.objectId, m.mergeId) || !same(wire.subject.tableId, m.tableId) || !same(wire.subject.recordId, m.recordId) ||
      !same(m.resultCommitId, entry.commit.commitId) || entry.commit.eventClass !== "reconciliation") fail("merge names another subject or result commit");
  requireBaseline(handle, m.baseline, m.tableId, m.recordId);
  requireRecordSubject(m.local.state.record, m.tableId, m.recordId); requireRecordSubject(m.incoming.state.record, m.tableId, m.recordId);
  requireMerge(handle, event);
  const result = encode(new Map<string, CborValue>([["state", "present"], ["value", decodeCanonical(evidenceRecordBytes(m.result))]]));
  requireResult(handle, entry, { state: "present", record: m.result, canonical: result }, m.validationReport, m.tableId, m.recordId);
  requireEffects(entry, index, m.effectEventIds, m.tableId, m.recordId, result, m.local.state.canonical, before.get(idKey(m.recordId)), claimed);
  run(handle, "INSERT INTO applied_merges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [m.mergeId, m.tableId, m.recordId, m.baseline.scopeId,
    m.local.commitId, m.incoming.commitId, m.resultCommitId, m.validationReport.canonical, m.explanation, toSqlInteger(entry.commit.hybridTime.wallTimeMs)]);
  return m.tableId;
}
