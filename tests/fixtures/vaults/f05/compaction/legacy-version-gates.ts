import { CodecError } from "../../../../../src/domain/model/errors.js";
import { decodeCanonical } from "../../../../../src/persistence/codecs/canonical-cbor.js";
import { asMap, count, exactKeys, field } from "../../../../../src/import/staging/proposal-codec.js";

// Frozen entry gates from roots.ts at 9f0ef04c2b47a57b7b65988e1079c921e2a31ecf.
// These are the old reader's refusal boundary, not a substitute V1 row parser.
const VERSION = 1;
export function legacyRecordVersion(payload: Uint8Array): void {
  const map = exactKeys(asMap(decodeCanonical(payload), "a record page"), ["pageVersion", "records"], "a record page");
  if (count(field(map, "pageVersion"), "a page version") !== VERSION) throw new CodecError("record page declares an unsupported version");
}
export function legacyHeadVersion(payload: Uint8Array): void {
  const map = exactKeys(asMap(decodeCanonical(payload), "an app head"), ["headVersion", "appId", "headRevision", "schemaRevision", "checkpoint", "frontier",
    "eventSegments", "baselinePages", "conflictPages", "auditPages", "sourceManifests", "snapshotManifests", "retainedRoots", "semanticSha256"], "an app head");
  if (count(field(map, "headVersion"), "a head version") !== VERSION) throw new CodecError("app head declares an unsupported version");
}
