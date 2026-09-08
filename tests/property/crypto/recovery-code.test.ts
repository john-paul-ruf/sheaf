import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  parseRecoveryCode,
} from "../../../src/crypto/recovery-code.js";
import { CryptoError } from "../../../src/domain/model/errors.js";

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const secret = fc.uint8Array({ minLength: 32, maxLength: 32 });
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("recovery code properties", () => {
  it("round-trips every 256-bit secret", async () => {
    await fc.assert(
      fc.asyncProperty(secret, async (bytes) => {
        const code = await formatRecoveryCode(bytes);
        expect(code).toHaveLength(63);
        expect(toHex(await parseRecoveryCode(code))).toBe(toHex(bytes));
      }),
      { numRuns: 50 },
    );
  });

  it("rejects every single-character substitution", async () => {
    await fc.assert(
      fc.asyncProperty(
        secret,
        fc.nat({ max: 55 }),
        fc.constantFrom(...CROCKFORD),
        async (bytes, position, replacement) => {
          const characters = [...normalizeRecoveryCode(await formatRecoveryCode(bytes))];
          fc.pre(characters[position] !== replacement);
          characters[position] = replacement;

          await expect(parseRecoveryCode(characters.join(""))).rejects.toThrow(
            CryptoError,
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});
