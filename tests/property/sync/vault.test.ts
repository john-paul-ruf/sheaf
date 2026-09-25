import { expect, it } from "vitest";
import fc from "fast-check";
import { encodeVaultIndex, decodeVaultIndex, encodeAppManifest, decodeAppManifest } from "../../../src/persistence/codecs/vault.js";
import { index, manifest, id } from "../../fixtures/vaults/f05/helpers.js";
it("keeps canonical graph bytes exact across uint64 frontiers", () => {
  fc.assert(fc.property(fc.bigInt({ min: 1n, max: 0xffff_ffff_ffff_ffffn }), (sequence) => {
    const value = { ...manifest(), confirmedFrontier: [{ deviceId: id(8), commitSequence: sequence }] };
    const encoded = encodeAppManifest(value);
    expect(encodeAppManifest(decodeAppManifest(encoded))).toEqual(encoded);
    expect(encodeVaultIndex(decodeVaultIndex(encodeVaultIndex(index())))).toEqual(encodeVaultIndex(index()));
  }), { numRuns: 100 });
});
