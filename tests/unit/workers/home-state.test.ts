import { expect, it } from "vitest";
import { encodeBase64Url } from "../../../src/domain/model/bytes.js";
import { asDomainId, encodeDomainId } from "../../../src/domain/model/ids.js";
import { encodeHomeState, decodeHomeState, pendingChangeCount, type HomeStateV1, type BundleReceiptV1 } from "../../../src/workers/data/home-state.js";
import { header, id, wrapped } from "../../fixtures/vaults/f05/helpers.js";

const appId = encodeDomainId(asDomainId("app", id(1)));
const bootstrap = header();
const state: HomeStateV1 = { homeStateVersion: 1, homeId: encodeDomainId(asDomainId("home", id(2))),
  vaultId: encodeDomainId(asDomainId("vault", id(3))), kind: "bundle", displayName: "Vault",
  secrets: { recoveryCode: "recovery fixture", passphraseKdf: bootstrap.passphraseKdf, recoveryKdf: bootstrap.recoveryKdf,
    passphraseWrappedVaultKey: wrapped, recoveryWrappedVaultKey: wrapped },
  locallyWrappedVaultKey: wrapped, appKeys: [{ appId, wrappedAppKey: wrapped }], pins: [], lastSuccessfulBackupMs: null };
const receipt: BundleReceiptV1 = { appId, operationId: encodeBase64Url(id(4)), artifactSha256: encodeBase64Url(new Uint8Array(32)),
  candidateSha256: new Uint8Array(32), generation: 1n, confirmedFrontier: [{ deviceId: id(5), commitSequence: 2n }], confirmedAtMs: 1000 };

it("decodes pre-receipt homes unchanged and round-trips confirmed identity/frontier/time", () => {
  expect(decodeHomeState(encodeHomeState(state))).toEqual(state);
  const confirmed = { ...state, lastSuccessfulBackupMs: 1000, receipts: [receipt] };
  expect(decodeHomeState(encodeHomeState(confirmed))).toEqual(confirmed);
});
it("rejects inconsistent and substituted receipt facts (codec negative controls)", () => {
  const changes: Partial<BundleReceiptV1>[] = [
    { appId: encodeDomainId(asDomainId("app", id(8))) }, { operationId: "wrong" },
    { artifactSha256: "x".repeat(43) }, { candidateSha256: new Uint8Array(16) },
    { generation: 0n }, { confirmedAtMs: -1 },
    { confirmedFrontier: [{ deviceId: id(5), commitSequence: 2n }, { deviceId: id(5), commitSequence: 2n }] },
  ];
  for (const change of changes) expect(() => encodeHomeState({ ...state, lastSuccessfulBackupMs: 1000, receipts: [{ ...receipt, ...change }] })).toThrow();
  expect(() => encodeHomeState({ ...state, receipts: [receipt] })).toThrow();
  expect(() => encodeHomeState({ ...state, lastSuccessfulBackupMs: 999, receipts: [receipt] })).toThrow();
  expect(() => encodeHomeState({ ...state, lastSuccessfulBackupMs: 1000, receipts: [receipt, receipt] })).toThrow();
});

it("counts local changes relative to only this device's confirmed frontier and rejects regression", () => {
  const local = { deviceId: id(5), commitSequence: 12n };
  const other = { deviceId: id(6), commitSequence: 99n };
  expect(pendingChangeCount([local, other], encodeBase64Url(id(5)), [{ ...local, commitSequence: 11n }, other])).toBe(1);
  expect(pendingChangeCount([local], encodeBase64Url(id(5)), [local])).toBe(0);
  expect(pendingChangeCount([local], encodeBase64Url(id(5)))).toBe(12);
  expect(() => pendingChangeCount([local], encodeBase64Url(id(5)), [{ ...local, commitSequence: 13n }])).toThrow("invalid pending frontier");
});
