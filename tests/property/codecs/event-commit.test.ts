import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import katFixture from "../../fixtures/vaults/local-v1/event-commit-kat.json" with { type: "json" };
import type { EventCommitV1 } from "../../../src/migrations/004_event_format_v1.js";
import {
  decodeEventCommit,
  encodeCommitBody,
  encodeEventCommit,
  sealEventCommit,
  sortCommitsCanonically,
} from "../../../src/persistence/codecs/event-commit.js";

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const bytes = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));

/**
 * A synchronous SHA-256 keeps the properties cheap. M08's production digest is
 * proven against the published vectors in `tests/unit/crypto/hash.test.ts` and
 * is what re-derives the KAT bytes in `tests/unit/codecs/event-commit.test.ts`.
 */
const sha256 = (input: Uint8Array): Uint8Array =>
  new Uint8Array(createHash("sha256").update(input).digest());

const vectors: readonly EventCommitV1[] = katFixture.cases.map((vector) =>
  decodeEventCommit(bytes(vector.commitHex)),
);

const commitArbitrary = fc.constantFrom(...vectors);

/** True when a commit's stored hash is the hash of its own encoded body. */
const verifies = (commit: EventCommitV1): boolean =>
  hex(sha256(encodeCommitBody(commit))) === hex(commit.commitSha256);

describe("event commit codec properties", () => {
  it("round-trips every commit through decode∘encode unchanged", () => {
    fc.assert(
      fc.property(commitArbitrary, (commit) => {
        const encoded = encodeEventCommit(commit);
        const decoded = decodeEventCommit(encoded);

        expect(hex(encodeEventCommit(decoded))).toBe(hex(encoded));
        expect(hex(encodeCommitBody(decoded))).toBe(
          hex(encodeCommitBody(commit)),
        );
        expect(hex(decoded.commitSha256)).toBe(hex(commit.commitSha256));
        expect(verifies(decoded)).toBe(true);
      }),
    );
  });

  it("lets no single-byte mutation decode into a commit that still verifies", () => {
    let decodedCount = 0;

    fc.assert(
      fc.property(
        commitArbitrary,
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (commit, offsetSeed, delta) => {
          const original = encodeEventCommit(commit);
          const offset = offsetSeed % original.byteLength;
          const mutated = Uint8Array.from(original, (byte, index) =>
            index === offset ? (byte + delta) % 256 : byte,
          );
          expect(hex(mutated)).not.toBe(hex(original));

          let decoded: EventCommitV1;
          try {
            decoded = decodeEventCommit(mutated);
          } catch {
            // Refused outright: the mutation never became a commit at all.
            return;
          }

          // It decoded, so it must no longer be self-consistent: either its
          // body moved under its hash, or its hash moved off its body.
          decodedCount += 1;
          expect(verifies(decoded)).toBe(false);
        },
      ),
    );

    // Guards the assertion above against becoming vacuous: some mutations do
    // decode, so the hash check is genuinely exercised.
    expect(decodedCount).toBeGreaterThan(0);
  });

  it("seals a body to exactly the hash of its own encoding", async () => {
    for (const commit of vectors) {
      // The body encoder ignores `commitSha256` by construction, so sealing an
      // already-sealed commit must reproduce the identical hash.
      const sealed = await sealEventCommit(commit, sha256);

      expect(hex(sealed.commitSha256)).toBe(
        hex(sha256(encodeCommitBody(commit))),
      );
      expect(hex(sealed.commitSha256)).toBe(hex(commit.commitSha256));
    }
  });

  it("orders any permutation of a commit set identically", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...vectors], { minLength: 2 }),
        (subset) => {
          const once = sortCommitsCanonically(subset).map((commit) =>
            hex(commit.commitId),
          );
          const twice = sortCommitsCanonically([...subset].reverse()).map(
            (commit) => hex(commit.commitId),
          );

          expect(twice).toEqual(once);
        },
      ),
    );
  });
});
