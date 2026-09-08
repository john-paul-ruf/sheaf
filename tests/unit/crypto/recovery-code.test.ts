import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_BYTES,
  formatRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
  parseRecoveryCode,
  recoveryCodesEqual,
} from "../../../src/crypto/recovery-code.js";
import { CryptoError } from "../../../src/domain/model/errors.js";
import type { EntropyPort } from "../../../src/application/ports/entropy.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const SECRET = hex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);

describe("recovery code format v1", () => {
  it("formats 32 bytes as eight groups of seven Crockford characters", async () => {
    const code = await formatRecoveryCode(SECRET);

    expect(code).toBe("000G40R-40M30E2-09185GR-38E1W81-24GK2GA-HC5RR34-D1P70X3-RFGX89J");
    expect(code.split("-")).toHaveLength(8);
    expect(code.split("-").every((chunk) => chunk.length === 7)).toBe(true);
    expect(normalizeRecoveryCode(code)).toHaveLength(56);
    expect(toHex(await parseRecoveryCode(code))).toBe(toHex(SECRET));
  });

  it("round-trips a generated code", async () => {
    const entropy: EntropyPort = {
      randomBytes: (length) =>
        Uint8Array.from({ length }, (_, index) => (index * 7 + 3) % 256),
    };
    const code = await generateRecoveryCode(entropy);
    expect(await parseRecoveryCode(code)).toHaveLength(RECOVERY_CODE_BYTES);
  });

  it("accepts any case, separator, and Crockford substitution", async () => {
    const code = await formatRecoveryCode(SECRET);
    const messy = ` ${code.toLowerCase().replaceAll("-", " ")} `;
    const substituted = code.replaceAll("0", "O").replaceAll("1", "I");

    expect(toHex(await parseRecoveryCode(messy))).toBe(toHex(SECRET));
    expect(toHex(await parseRecoveryCode(substituted))).toBe(toHex(SECRET));
    expect(recoveryCodesEqual(code, substituted)).toBe(true);
    expect(recoveryCodesEqual(code, messy)).toBe(true);
  });

  it("rejects a single mistyped character", async () => {
    const code = await formatRecoveryCode(SECRET);
    const characters = [...normalizeRecoveryCode(code)];

    for (const index of [0, 13, 26, 51, 52, 55]) {
      const original = characters[index] as string;
      const swapped = [...characters];
      swapped[index] = original === "2" ? "3" : "2";
      await expect(
        parseRecoveryCode(swapped.join("")),
        `position ${index}`,
      ).rejects.toThrow(CryptoError);
    }
  });

  it("rejects wrong lengths, alien characters, and non-canonical padding", async () => {
    const code = normalizeRecoveryCode(await formatRecoveryCode(SECRET));

    await expect(parseRecoveryCode(code.slice(0, 55))).rejects.toThrow(
      /not 56 characters/,
    );
    await expect(parseRecoveryCode(`${code}A`)).rejects.toThrow(
      /not 56 characters/,
    );
    await expect(
      parseRecoveryCode(`U${code.slice(1)}`),
    ).rejects.toThrow(/outside the alphabet/);

    // The 52nd data character carries the four zero padding bits.
    const nonCanonical = [...code];
    nonCanonical[51] = "1";
    await expect(parseRecoveryCode(nonCanonical.join(""))).rejects.toThrow(
      /non-canonical trailing bits/,
    );
  });

  it("refuses to format a secret that is not 32 bytes", async () => {
    await expect(formatRecoveryCode(new Uint8Array(31))).rejects.toThrow(
      /must be 32 bytes/,
    );
  });

  it("compares two entered codes without regard to spelling", async () => {
    const code = await formatRecoveryCode(SECRET);
    const other = await formatRecoveryCode(new Uint8Array(32).fill(9));

    expect(recoveryCodesEqual(code, code)).toBe(true);
    expect(recoveryCodesEqual(code, other)).toBe(false);
    expect(recoveryCodesEqual(code, code.slice(0, 30))).toBe(false);
  });
});
