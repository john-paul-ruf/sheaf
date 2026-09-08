/**
 * The event commit and segment wire codec (CA-08).
 *
 * `src/migrations/004_event_format_v1.ts` owns the contract; this module is
 * its canonical representation and its guard, field for field:
 *
 * - **`commitSha256` is SHA-256 of the canonical commit body with the
 *   `commitSha256` field omitted.** {@link encodeCommitBody} produces exactly
 *   those bytes, so the hash is defined by one function rather than by a
 *   convention each caller re-implements.
 * - **The per-device chain is contiguous.** `deviceCommitSequence` increases by
 *   exactly one per device and `previousDeviceCommitSha256` is that
 *   predecessor's hash — null only at sequence 1.
 * - **Frontier entries are sorted by device with no duplicates.** A frontier
 *   naming one device twice has no meaning and is refused on both sides.
 * - **Commits present in canonical order** `(wall time, logical counter,
 *   device ID, device sequence, commit ID)`. That order is for *presentation*:
 *   causality comes from the frontier and the per-device sequence, and nothing
 *   here implements last-write-wins.
 *
 * M09 stays free of third-party imports (D2) and of key material, so SHA-256
 * arrives as an injected {@link Sha256Fn} — M08's `sha256` in production.
 */

import { CodecError, IntegrityError } from "../../domain/model/errors.js";
import { compareDomainIds } from "../../domain/model/ids.js";
import {
  EVENT_KINDS_V1,
  migrateEvent,
  type DomainEventV1,
  type EventClassV1,
  type EventCommitV1,
  type EventKindV1,
  type EventProvenanceV1,
  type EventSegmentV1,
  type EventSubjectV1,
  type FrontierEntryV1,
  type HybridTimeV1,
} from "../../migrations/004_event_format_v1.js";
import { CURRENT_FORMAT_VERSIONS } from "../../migrations/index.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedKey,
  type DecodedValue,
} from "./canonical-cbor.js";

export type Sha256Fn = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** A commit before its own hash is known. */
export type EventCommitBodyV1 = Omit<EventCommitV1, "commitSha256">;

const ID_BYTES = 16;
const SHA256_BYTES = 32;

const EVENT_CLASSES: readonly EventClassV1[] = Object.freeze([
  "authored",
  "import",
  "reconciliation",
  "system",
]);

const PROVENANCE_SOURCES: readonly EventProvenanceV1["source"][] = Object.freeze(
  [
    "user",
    "initial-import",
    "workbook-reupload",
    "remote-device",
    "conflict-resolution",
    "compaction",
  ],
);

/**
 * Which subject members each kind must name (database.md § Event catalog).
 * Replay's "stable subject ownership" guard needs this, and it is structural —
 * it constrains what an event is *about*, never what its payload means.
 */
const REQUIRED_SUBJECT_MEMBERS: Partial<
  Record<EventKindV1, readonly (keyof EventSubjectV1)[]>
> = Object.freeze({
  "table.created": ["tableId"],
  "field.created": ["tableId", "fieldId"],
  "enum.changed": ["fieldId"],
  "record.created": ["tableId", "recordId"],
  "record.patched": ["tableId", "recordId"],
  "record.deleted": ["tableId", "recordId"],
  "record.restored": ["tableId", "recordId"],
});

const OPTIONAL_SUBJECT_MEMBERS = Object.freeze([
  "tableId",
  "recordId",
  "fieldId",
  "objectId",
] as const);

const isKnownKind = (kind: string): kind is EventKindV1 =>
  (EVENT_KINDS_V1 as readonly string[]).includes(kind);

// ---------------------------------------------------------------- encoding --

const bytesOfLength = (
  value: Uint8Array,
  length: number,
  field: string,
): Uint8Array => {
  if (value.byteLength !== length) {
    throw new CodecError(`${field} must be ${length} bytes`);
  }
  return value;
};

const encodeFrontier = (
  frontier: readonly FrontierEntryV1[],
): readonly CborValue[] => {
  assertSortedFrontier(frontier);
  return frontier.map((entry) => {
    if (entry.commitSequence < 1n) {
      throw new CodecError("frontier sequence must be positive");
    }
    return new Map<string, CborValue>([
      ["commitSequence", entry.commitSequence],
      ["deviceId", bytesOfLength(entry.deviceId, ID_BYTES, "deviceId")],
    ]);
  });
};

const encodeSubject = (subject: EventSubjectV1): CborValue => {
  const map = new Map<string, CborValue>([
    ["appId", bytesOfLength(subject.appId, ID_BYTES, "appId")],
  ]);
  for (const member of OPTIONAL_SUBJECT_MEMBERS) {
    const value = subject[member];
    if (value !== undefined) {
      map.set(member, bytesOfLength(value, ID_BYTES, member));
    }
  }
  return map;
};

const encodeProvenance = (provenance: EventProvenanceV1): CborValue => {
  if (!PROVENANCE_SOURCES.includes(provenance.source)) {
    throw new CodecError("provenance source is not in the closed v1 list");
  }
  const map = new Map<string, CborValue>([["source", provenance.source]]);
  if (provenance.sourceId !== undefined) {
    map.set("sourceId", provenance.sourceId);
  }
  if (provenance.sourceTimestampMs !== undefined) {
    map.set("sourceTimestampMs", provenance.sourceTimestampMs);
  }
  if (provenance.evidence !== undefined) {
    map.set("evidence", provenance.evidence as CborValue);
  }
  return map;
};

const encodeEvent = (event: DomainEventV1, appId: Uint8Array): CborValue => {
  if (!isKnownKind(event.kind)) {
    throw new CodecError("event kind is not in the closed v1 catalog");
  }
  if (!Number.isInteger(event.eventIndex) || event.eventIndex < 0) {
    throw new CodecError("event index must be a nonnegative integer");
  }
  if (!equalBytes(event.subject.appId, appId)) {
    throw new CodecError("event subject belongs to another app");
  }
  for (const member of REQUIRED_SUBJECT_MEMBERS[event.kind] ?? []) {
    if (event.subject[member] === undefined) {
      throw new CodecError(`${event.kind} must name a ${member}`);
    }
  }

  return new Map<string, CborValue>([
    ["eventId", bytesOfLength(event.eventId, ID_BYTES, "eventId")],
    ["eventIndex", event.eventIndex],
    ["kind", event.kind],
    ["payload", event.payload as CborValue],
    ["provenance", encodeProvenance(event.provenance)],
    ["subject", encodeSubject(event.subject)],
  ]);
};

const encodeHybridTime = (time: HybridTimeV1): CborValue => {
  if (!Number.isInteger(time.logicalCounter) || time.logicalCounter < 0) {
    throw new CodecError("logical counter must be a nonnegative integer");
  }
  return new Map<string, CborValue>([
    ["logicalCounter", time.logicalCounter],
    ["wallTimeMs", time.wallTimeMs],
  ]);
};

const commitBodyMap = (commit: EventCommitBodyV1): Map<string, CborValue> => {
  if (commit.eventFormatVersion !== CURRENT_FORMAT_VERSIONS.event) {
    throw new CodecError("unsupported event format version");
  }
  if (commit.deviceCommitSequence < 1n) {
    throw new CodecError("device commit sequence starts at one");
  }
  if (
    (commit.previousDeviceCommitSha256 === null) !==
    (commit.deviceCommitSequence === 1n)
  ) {
    throw new CodecError(
      "previousDeviceCommitSha256 is null exactly at sequence one",
    );
  }
  if (commit.events.length === 0) {
    throw new CodecError("a commit carries at least one event");
  }
  commit.events.forEach((event, index) => {
    if (event.eventIndex !== index) {
      throw new CodecError("event indexes are contiguous from zero");
    }
  });
  if (!EVENT_CLASSES.includes(commit.eventClass)) {
    throw new CodecError("event class is not in the closed v1 list");
  }
  if (commit.schemaRevisionBefore < 0n || commit.schemaRevisionAfter < 0n) {
    throw new CodecError("schema revisions are nonnegative");
  }

  const appId = bytesOfLength(commit.appId, ID_BYTES, "appId");

  return new Map<string, CborValue>([
    ["appId", appId],
    ["basisFrontier", encodeFrontier(commit.basisFrontier)],
    ["commitId", bytesOfLength(commit.commitId, ID_BYTES, "commitId")],
    ["deviceCommitSequence", commit.deviceCommitSequence],
    ["deviceId", bytesOfLength(commit.deviceId, ID_BYTES, "deviceId")],
    ["eventClass", commit.eventClass],
    ["eventFormatVersion", commit.eventFormatVersion],
    ["events", commit.events.map((event) => encodeEvent(event, appId))],
    ["hybridTime", encodeHybridTime(commit.hybridTime)],
    [
      "previousDeviceCommitSha256",
      commit.previousDeviceCommitSha256 === null
        ? null
        : bytesOfLength(
            commit.previousDeviceCommitSha256,
            SHA256_BYTES,
            "previousDeviceCommitSha256",
          ),
    ],
    ["schemaRevisionAfter", commit.schemaRevisionAfter],
    ["schemaRevisionBefore", commit.schemaRevisionBefore],
  ]);
};

/** The exact bytes `commitSha256` is computed over: the body, sans the hash. */
export function encodeCommitBody(commit: EventCommitBodyV1): Uint8Array {
  return encodeCanonical(commitBodyMap(commit));
}

export function encodeEventCommit(commit: EventCommitV1): Uint8Array {
  const map = commitBodyMap(commit);
  map.set(
    "commitSha256",
    bytesOfLength(commit.commitSha256, SHA256_BYTES, "commitSha256"),
  );
  return encodeCanonical(map);
}

/** Computes the commit hash and returns the sealed commit. */
export async function sealEventCommit(
  body: EventCommitBodyV1,
  sha256: Sha256Fn,
): Promise<EventCommitV1> {
  const commitSha256 = await sha256(encodeCommitBody(body));
  return { ...body, commitSha256: bytesOfLength(commitSha256, SHA256_BYTES, "commitSha256") };
}

export function encodeEventSegment(segment: EventSegmentV1): Uint8Array {
  if (segment.eventFormatVersion !== CURRENT_FORMAT_VERSIONS.event) {
    throw new CodecError("unsupported event format version");
  }
  if (segment.commits.length === 0) {
    throw new CodecError("a segment carries at least one commit");
  }
  for (const commit of segment.commits) {
    if (!equalBytes(commit.appId, segment.appId)) {
      throw new CodecError("segment commit belongs to another app");
    }
  }

  return encodeCanonical(
    new Map<string, CborValue>([
      ["appId", bytesOfLength(segment.appId, ID_BYTES, "appId")],
      ["commits", segment.commits.map(encodeCommitAsValue)],
      ["eventFormatVersion", segment.eventFormatVersion],
      ["resultingFrontier", encodeFrontier(segment.resultingFrontier)],
      [
        "segmentId",
        bytesOfLength(segment.segmentId, ID_BYTES, "segmentId"),
      ],
      [
        "semanticSha256",
        bytesOfLength(segment.semanticSha256, SHA256_BYTES, "semanticSha256"),
      ],
    ]),
  );
}

const encodeCommitAsValue = (commit: EventCommitV1): CborValue => {
  const map = commitBodyMap(commit);
  map.set(
    "commitSha256",
    bytesOfLength(commit.commitSha256, SHA256_BYTES, "commitSha256"),
  );
  return map;
};

// ---------------------------------------------------------------- decoding --

const asMap = (
  value: DecodedValue,
  what: string,
): ReadonlyMap<DecodedKey, DecodedValue> => {
  if (!(value instanceof Map)) {
    throw new CodecError(`${what} must be a map`);
  }
  return value;
};

const takeKeys = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  required: readonly string[],
  optional: readonly string[],
  what: string,
): void => {
  for (const key of required) {
    if (!map.has(key)) {
      throw new CodecError(`${what} is missing ${key}`);
    }
  }
  const known = new Set<DecodedKey>([...required, ...optional]);
  for (const key of map.keys()) {
    if (!known.has(key)) {
      throw new CodecError(`${what} has an unknown field`);
    }
  }
};

const readBytes = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  key: string,
  length: number,
): Uint8Array => {
  const value = map.get(key);
  if (!(value instanceof Uint8Array)) {
    throw new CodecError(`${key} must be a byte string`);
  }
  return bytesOfLength(value, length, key);
};

const readUint = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  key: string,
): bigint => {
  const value = map.get(key);
  if (typeof value !== "bigint") {
    throw new CodecError(`${key} must be an integer`);
  }
  if (value < 0n) {
    throw new CodecError(`${key} must be nonnegative`);
  }
  return value;
};

const readSafeInteger = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  key: string,
): number => {
  const value = readUint(map, key);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CodecError(`${key} exceeds the safe integer range`);
  }
  return Number(value);
};

const readText = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  key: string,
): string => {
  const value = map.get(key);
  if (typeof value !== "string") {
    throw new CodecError(`${key} must be text`);
  }
  return value;
};

const readArray = (
  map: ReadonlyMap<DecodedKey, DecodedValue>,
  key: string,
): readonly DecodedValue[] => {
  const value = map.get(key);
  if (!Array.isArray(value)) {
    throw new CodecError(`${key} must be an array`);
  }
  return value as readonly DecodedValue[];
};

const decodeFrontier = (
  entries: readonly DecodedValue[],
): readonly FrontierEntryV1[] => {
  const frontier = entries.map((entry) => {
    const map = asMap(entry, "frontier entry");
    takeKeys(map, ["commitSequence", "deviceId"], [], "frontier entry");
    const commitSequence = readUint(map, "commitSequence");
    if (commitSequence < 1n) {
      throw new CodecError("frontier sequence must be positive");
    }
    return { commitSequence, deviceId: readBytes(map, "deviceId", ID_BYTES) };
  });
  assertSortedFrontier(frontier);
  return frontier;
};

const decodeSubject = (value: DecodedValue): EventSubjectV1 => {
  const map = asMap(value, "event subject");
  takeKeys(map, ["appId"], [...OPTIONAL_SUBJECT_MEMBERS], "event subject");

  const subject: {
    -readonly [K in keyof EventSubjectV1]: EventSubjectV1[K];
  } = { appId: readBytes(map, "appId", ID_BYTES) };
  for (const member of OPTIONAL_SUBJECT_MEMBERS) {
    if (map.has(member)) {
      subject[member] = readBytes(map, member, ID_BYTES);
    }
  }
  return subject;
};

const decodeProvenance = (value: DecodedValue): EventProvenanceV1 => {
  const map = asMap(value, "provenance");
  takeKeys(
    map,
    ["source"],
    ["sourceId", "sourceTimestampMs", "evidence"],
    "provenance",
  );

  const source = readText(map, "source");
  if (!(PROVENANCE_SOURCES as readonly string[]).includes(source)) {
    throw new CodecError("provenance source is not in the closed v1 list");
  }

  const provenance: {
    -readonly [K in keyof EventProvenanceV1]: EventProvenanceV1[K];
  } = { source: source as EventProvenanceV1["source"] };
  if (map.has("sourceId")) {
    const sourceId = map.get("sourceId");
    if (!(sourceId instanceof Uint8Array)) {
      throw new CodecError("sourceId must be a byte string");
    }
    provenance.sourceId = sourceId;
  }
  if (map.has("sourceTimestampMs")) {
    const timestamp = map.get("sourceTimestampMs");
    if (typeof timestamp !== "bigint") {
      throw new CodecError("sourceTimestampMs must be an integer");
    }
    provenance.sourceTimestampMs = timestamp;
  }
  if (map.has("evidence")) {
    provenance.evidence = map.get("evidence");
  }
  return provenance;
};

const decodeEvent = (
  value: DecodedValue,
  index: number,
  appId: Uint8Array,
): DomainEventV1 => {
  const map = asMap(value, "event");
  takeKeys(
    map,
    ["eventId", "eventIndex", "kind", "payload", "provenance", "subject"],
    [],
    "event",
  );

  const kind = readText(map, "kind");
  if (!isKnownKind(kind)) {
    throw new CodecError("event kind is not in the closed v1 catalog");
  }
  const eventIndex = readSafeInteger(map, "eventIndex");
  if (eventIndex !== index) {
    throw new CodecError("event indexes are contiguous from zero");
  }

  const subject = decodeSubject(map.get("subject") as DecodedValue);
  if (!equalBytes(subject.appId, appId)) {
    throw new CodecError("event subject belongs to another app");
  }
  for (const member of REQUIRED_SUBJECT_MEMBERS[kind] ?? []) {
    if (subject[member] === undefined) {
      throw new CodecError(`${kind} must name a ${member}`);
    }
  }

  return {
    eventId: readBytes(map, "eventId", ID_BYTES),
    eventIndex,
    kind,
    subject,
    payload: map.get("payload"),
    provenance: decodeProvenance(map.get("provenance") as DecodedValue),
  };
};

const COMMIT_FIELDS = Object.freeze([
  "appId",
  "basisFrontier",
  "commitId",
  "deviceCommitSequence",
  "deviceId",
  "eventClass",
  "eventFormatVersion",
  "events",
  "hybridTime",
  "previousDeviceCommitSha256",
  "schemaRevisionAfter",
  "schemaRevisionBefore",
] as const);

const decodeCommitValue = (value: DecodedValue): EventCommitV1 => {
  const map = asMap(value, "commit");
  takeKeys(map, [...COMMIT_FIELDS, "commitSha256"], [], "commit");

  const eventFormatVersion = readUint(map, "eventFormatVersion");
  if (eventFormatVersion !== BigInt(CURRENT_FORMAT_VERSIONS.event)) {
    throw new CodecError("unsupported event format version");
  }

  const appId = readBytes(map, "appId", ID_BYTES);
  const deviceCommitSequence = readUint(map, "deviceCommitSequence");
  if (deviceCommitSequence < 1n) {
    throw new CodecError("device commit sequence starts at one");
  }

  const previous = map.get("previousDeviceCommitSha256");
  if (previous !== null && !(previous instanceof Uint8Array)) {
    throw new CodecError("previousDeviceCommitSha256 must be bytes or null");
  }
  const previousDeviceCommitSha256 =
    previous === null
      ? null
      : bytesOfLength(previous, SHA256_BYTES, "previousDeviceCommitSha256");
  if ((previousDeviceCommitSha256 === null) !== (deviceCommitSequence === 1n)) {
    throw new CodecError(
      "previousDeviceCommitSha256 is null exactly at sequence one",
    );
  }

  const eventClass = readText(map, "eventClass");
  if (!(EVENT_CLASSES as readonly string[]).includes(eventClass)) {
    throw new CodecError("event class is not in the closed v1 list");
  }

  const events = readArray(map, "events");
  if (events.length === 0) {
    throw new CodecError("a commit carries at least one event");
  }

  const hybridTimeMap = asMap(map.get("hybridTime") as DecodedValue, "hybridTime");
  takeKeys(hybridTimeMap, ["logicalCounter", "wallTimeMs"], [], "hybridTime");
  const wallTimeMs = hybridTimeMap.get("wallTimeMs");
  if (typeof wallTimeMs !== "bigint") {
    throw new CodecError("wallTimeMs must be an integer");
  }

  const commit: EventCommitV1 = {
    eventFormatVersion: 1,
    commitId: readBytes(map, "commitId", ID_BYTES),
    appId,
    deviceId: readBytes(map, "deviceId", ID_BYTES),
    deviceCommitSequence,
    previousDeviceCommitSha256,
    basisFrontier: decodeFrontier(readArray(map, "basisFrontier")),
    hybridTime: {
      wallTimeMs,
      logicalCounter: readSafeInteger(hybridTimeMap, "logicalCounter"),
    },
    eventClass: eventClass as EventClassV1,
    schemaRevisionBefore: readUint(map, "schemaRevisionBefore"),
    schemaRevisionAfter: readUint(map, "schemaRevisionAfter"),
    events: events.map((event, index) => decodeEvent(event, index, appId)),
    commitSha256: readBytes(map, "commitSha256", SHA256_BYTES),
  };

  // The DB-owned version gate runs last, over the fully typed value.
  return migrateEvent(commit);
};

export function decodeEventCommit(bytes: Uint8Array): EventCommitV1 {
  return decodeCommitValue(decodeCanonical(bytes));
}

export function decodeEventSegment(bytes: Uint8Array): EventSegmentV1 {
  const map = asMap(decodeCanonical(bytes), "segment");
  takeKeys(
    map,
    [
      "appId",
      "commits",
      "eventFormatVersion",
      "resultingFrontier",
      "segmentId",
      "semanticSha256",
    ],
    [],
    "segment",
  );

  if (readUint(map, "eventFormatVersion") !== BigInt(CURRENT_FORMAT_VERSIONS.event)) {
    throw new CodecError("unsupported event format version");
  }

  const appId = readBytes(map, "appId", ID_BYTES);
  const commits = readArray(map, "commits").map(decodeCommitValue);
  if (commits.length === 0) {
    throw new CodecError("a segment carries at least one commit");
  }
  for (const commit of commits) {
    if (!equalBytes(commit.appId, appId)) {
      throw new CodecError("segment commit belongs to another app");
    }
  }

  return migrateEvent<EventSegmentV1>({
    eventFormatVersion: 1,
    segmentId: readBytes(map, "segmentId", ID_BYTES),
    appId,
    commits,
    resultingFrontier: decodeFrontier(readArray(map, "resultingFrontier")),
    semanticSha256: readBytes(map, "semanticSha256", SHA256_BYTES),
  });
}

// ------------------------------------------------------------- verification --

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function assertSortedFrontier(frontier: readonly FrontierEntryV1[]): void {
  for (let index = 1; index < frontier.length; index += 1) {
    const order = compareDomainIds(
      (frontier[index - 1] as FrontierEntryV1).deviceId,
      (frontier[index] as FrontierEntryV1).deviceId,
    );
    if (order === 0) {
      throw new CodecError("frontier names one device twice");
    }
    if (order > 0) {
      throw new CodecError("frontier entries are not sorted by device");
    }
  }
}

/** Frontier order: by device ID, bytewise. Duplicate devices are refused. */
export function sortFrontier(
  entries: readonly FrontierEntryV1[],
): readonly FrontierEntryV1[] {
  const sorted = [...entries].sort((left, right) =>
    compareDomainIds(left.deviceId, right.deviceId),
  );
  assertSortedFrontier(sorted);
  return sorted;
}

/**
 * Canonical presentation order: `(wall time, logical counter, device ID,
 * device sequence, commit ID)`. Not a causality claim — see the module note.
 */
export function compareCommits(
  left: EventCommitV1,
  right: EventCommitV1,
): number {
  if (left.hybridTime.wallTimeMs !== right.hybridTime.wallTimeMs) {
    return left.hybridTime.wallTimeMs < right.hybridTime.wallTimeMs ? -1 : 1;
  }
  if (left.hybridTime.logicalCounter !== right.hybridTime.logicalCounter) {
    return left.hybridTime.logicalCounter - right.hybridTime.logicalCounter;
  }
  const byDevice = compareDomainIds(
    left.deviceId,
    right.deviceId,
  );
  if (byDevice !== 0) {
    return byDevice;
  }
  if (left.deviceCommitSequence !== right.deviceCommitSequence) {
    return left.deviceCommitSequence < right.deviceCommitSequence ? -1 : 1;
  }
  return compareDomainIds(left.commitId, right.commitId);
}

export function sortCommitsCanonically(
  commits: readonly EventCommitV1[],
): readonly EventCommitV1[] {
  return [...commits].sort(compareCommits);
}

/**
 * Replay's chain guard: every commit's hash is the hash of its own body, each
 * device's sequence is contiguous from one, and each commit's stated
 * predecessor is the previous commit of that same device.
 *
 * Throws {@link IntegrityError} on the first violation — a bad commit is never
 * skipped so replay can continue (database.md § Replay guards).
 */
export async function verifyCommitChain(
  commits: readonly EventCommitV1[],
  sha256: Sha256Fn,
): Promise<void> {
  const lastByDevice = new Map<
    string,
    { readonly sequence: bigint; readonly sha256: Uint8Array }
  >();

  for (const commit of sortCommitsCanonically(commits)) {
    const computed = await sha256(encodeCommitBody(commit));
    if (!equalBytes(computed, commit.commitSha256)) {
      throw new IntegrityError("commit hash does not match its body");
    }

    const device = [...commit.deviceId].join(",");
    const previous = lastByDevice.get(device);

    // A device's first commit here starts either at sequence one with a null
    // predecessor — `encodeCommitBody` above already refused any other
    // pairing — or at a later sequence whose predecessor is in an earlier
    // segment this call was not given. In that second case the function
    // verifies nothing rather than assuming the chain is intact across a gap
    // it cannot see.
    if (previous !== undefined) {
      if (commit.deviceCommitSequence !== previous.sequence + 1n) {
        throw new IntegrityError("device commit sequence has a gap");
      }
      if (
        commit.previousDeviceCommitSha256 === null ||
        !equalBytes(commit.previousDeviceCommitSha256, previous.sha256)
      ) {
        throw new IntegrityError("device hash chain is broken");
      }
    }

    lastByDevice.set(device, {
      sequence: commit.deviceCommitSequence,
      sha256: commit.commitSha256,
    });
  }
}
