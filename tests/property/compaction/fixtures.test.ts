import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { generateCompactionCorpus, writeCompactionCorpus } from "../../fixtures/vaults/f05/compaction/generate.js";
import { legacyHeadVersion, legacyRecordVersion } from "../../fixtures/vaults/f05/compaction/legacy-version-gates.js";
import { decodeAppHead, decodeAuditPage, decodeBaselinePage, decodeConflictPage, decodeRecordPage, encodeAppHead, encodeAuditPage,
  encodeBaselinePage, encodeConflictPage, encodeRecordPage } from "../../../src/import/staging/roots.js";

it("regenerates the new codec corpus byte-for-byte and detects an altered known answer", async () => {
  if (process.env["SHEAF_WRITE_F05_COMPACTION"] === "1") await writeCompactionCorpus();
  const generated = generateCompactionCorpus();
  expect(generated.size).toBe(7);
  for (const [name, bytes] of generated) {
    const expected = new Uint8Array(await readFile(new URL(`../../fixtures/vaults/f05/compaction/${name}`, import.meta.url)));
    expect(bytes, name).toEqual(expected);
    const changed = expected.slice(); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    expect(bytes, `${name} negative control`).not.toEqual(changed);
  }
});

it("preserves every new version and logical order while the frozen old gates refuse V2", () => {
  const files = generateCompactionCorpus();
  const head = files.get("head-v2.cbor")!; const records = files.get("records-v2.cbor")!;
  expect(() => legacyHeadVersion(head)).toThrow("unsupported version");
  expect(() => legacyRecordVersion(records)).toThrow("unsupported version");
  expect(encodeAppHead(decodeAppHead(head))).toEqual(head);
  expect(encodeRecordPage(decodeRecordPage(records))).toEqual(records);
  const baseline = files.get("baseline-v2.cbor")!;
  expect(encodeBaselinePage(decodeBaselinePage(baseline))).toEqual(baseline);
  for (const name of ["audit-first.cbor", "audit-second.cbor"]) expect(encodeAuditPage(decodeAuditPage(files.get(name)!))).toEqual(files.get(name));
  for (const name of ["conflict-first.cbor", "conflict-second.cbor"]) expect(encodeConflictPage(decodeConflictPage(files.get(name)!))).toEqual(files.get(name));
  expect(() => legacyRecordVersion(encodeRecordPage({ pageVersion: 1, records: [] }))).not.toThrow();
});
