/**
 * Local recovery code: 256 random bits, grouped Base32 with a checksum
 * (architecture § Cipher profile).
 *
 * **Exact v1 format.**
 * - The secret is 32 CSPRNG bytes.
 * - Those 256 bits are written most-significant-bit first as 52 Crockford
 *   Base32 characters (`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no I, L, O, U).
 *   52 characters carry 260 bits, so the final 4 bits are padding and must be
 *   zero; a spelling with non-zero padding is rejected.
 * - 4 checksum characters follow, carrying the first 20 bits (most significant
 *   first) of `SHA-256("sheaf/local/recovery-code/v1" || secret)`.
 * - The 56 characters are displayed in 8 groups of 7, separated by `-`:
 *   `XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX`.
 *
 * Parsing accepts any case, any separator run of `-` or whitespace, and the
 * Crockford substitutions `I`/`L` → `1` and `O` → `0`. The checksum is
 * compared in constant time, so a wrong code leaks no position information.
 * `tests/unit/crypto/recovery-code.test.ts` holds the format's known answer.
 */

import { CryptoError } from "../domain/model/errors.js";
import { constantTimeEquals } from "../domain/model/bytes.js";
import type { EntropyPort } from "../application/ports/entropy.js";
import { loadSodium } from "./sodium.js";

export const RECOVERY_CODE_BYTES = 32;
export const RECOVERY_CODE_DATA_CHARS = 52;
export const RECOVERY_CODE_CHECKSUM_CHARS = 4;
export const RECOVERY_CODE_GROUP_SIZE = 7;
const RECOVERY_CODE_CHARS =
  RECOVERY_CODE_DATA_CHARS + RECOVERY_CODE_CHECKSUM_CHARS;
const CHECKSUM_BITS = RECOVERY_CODE_CHECKSUM_CHARS * 5;
const CHECKSUM_DOMAIN = "sheaf/local/recovery-code/v1";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_VALUES = new Map<string, number>([
  ...[...CROCKFORD].map((character, index): [string, number] => [character, index]),
  ["I", 1],
  ["L", 1],
  ["O", 0],
]);

const textEncoder = new TextEncoder();

function encodeBase32(bits: readonly number[]): string {
  let text = "";
  for (let index = 0; index < bits.length; index += 5) {
    let value = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      value = (value << 1) | (bits[index + offset] ?? 0);
    }
    text += CROCKFORD[value];
  }
  return text;
}

function toBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) {
      bits.push((byte >> shift) & 1);
    }
  }
  return bits;
}

async function checksumChars(secret: Uint8Array): Promise<string> {
  const sodium = await loadSodium();
  const domain = textEncoder.encode(CHECKSUM_DOMAIN);
  const input = new Uint8Array(domain.byteLength + secret.byteLength);
  input.set(domain);
  input.set(secret, domain.byteLength);
  const digest = sodium.crypto_hash_sha256(input);
  return encodeBase32(toBits(digest).slice(0, CHECKSUM_BITS));
}

function group(text: string): string {
  const groups: string[] = [];
  for (let index = 0; index < text.length; index += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(text.slice(index, index + RECOVERY_CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/** Formats 32 secret bytes as the displayed recovery code. */
export async function formatRecoveryCode(secret: Uint8Array): Promise<string> {
  if (secret.byteLength !== RECOVERY_CODE_BYTES) {
    throw new CryptoError("recovery code secret must be 32 bytes");
  }
  const data = encodeBase32([...toBits(secret), 0, 0, 0, 0]);
  return group(`${data}${await checksumChars(secret)}`);
}

export async function generateRecoveryCode(entropy: EntropyPort): Promise<string> {
  const secret = entropy.randomBytes(RECOVERY_CODE_BYTES);
  if (secret.byteLength !== RECOVERY_CODE_BYTES) {
    throw new CryptoError("entropy port returned the wrong secret length");
  }
  return formatRecoveryCode(secret);
}

export function normalizeRecoveryCode(text: string): string {
  return [...text.toUpperCase()]
    .filter((character) => !/[-\s]/.test(character))
    .join("");
}

/** Validates the checksum and returns the 32 secret bytes. */
export async function parseRecoveryCode(text: string): Promise<Uint8Array> {
  const normalized = normalizeRecoveryCode(text);
  if (normalized.length !== RECOVERY_CODE_CHARS) {
    throw new CryptoError("recovery code is not 56 characters");
  }

  const bits: number[] = [];
  for (const character of normalized.slice(0, RECOVERY_CODE_DATA_CHARS)) {
    const value = CROCKFORD_VALUES.get(character);
    if (value === undefined) {
      throw new CryptoError("recovery code has a character outside the alphabet");
    }
    for (let shift = 4; shift >= 0; shift -= 1) {
      bits.push((value >> shift) & 1);
    }
  }
  if (bits.slice(RECOVERY_CODE_BYTES * 8).some((bit) => bit !== 0)) {
    throw new CryptoError("recovery code has non-canonical trailing bits");
  }

  const secret = new Uint8Array(RECOVERY_CODE_BYTES);
  for (let index = 0; index < RECOVERY_CODE_BYTES; index += 1) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | (bits[index * 8 + offset] as number);
    }
    secret[index] = byte;
  }

  const supplied = normalized.slice(RECOVERY_CODE_DATA_CHARS);
  for (const character of supplied) {
    if (!CROCKFORD_VALUES.has(character)) {
      throw new CryptoError("recovery code has a character outside the alphabet");
    }
  }
  const expected = await checksumChars(secret);
  if (
    !constantTimeEquals(
      textEncoder.encode(canonicalize(supplied)),
      textEncoder.encode(expected),
    )
  ) {
    throw new CryptoError("recovery code checksum does not match");
  }
  return secret;
}

/** Applies the Crockford substitutions so two spellings compare equal. */
function canonicalize(text: string): string {
  return [...text]
    .map((character) => CROCKFORD[CROCKFORD_VALUES.get(character) ?? -1] ?? character)
    .join("");
}

/** Constant-time comparison of two entered codes, separators ignored. */
export function recoveryCodesEqual(left: string, right: string): boolean {
  return constantTimeEquals(
    textEncoder.encode(canonicalize(normalizeRecoveryCode(left))),
    textEncoder.encode(canonicalize(normalizeRecoveryCode(right))),
  );
}
