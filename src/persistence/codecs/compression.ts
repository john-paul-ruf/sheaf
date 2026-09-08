/**
 * Bounded payload compression (`deflate-raw-v1` and `none`).
 *
 * Compression happens before encryption with the pinned v1 codec, and the
 * inner frame carries both the stored and the expected decompressed length
 * (database.md § Envelope plaintext and AAD). Decompression here is therefore
 * never open-ended: the declared decoded length is the allocation bound, and a
 * stream that produces more bytes than declared is refused mid-flight rather
 * than after it has been buffered.
 */

import { CodecError } from "../../domain/model/errors.js";
import type { CompressionCodecV1 } from "../../migrations/003_envelope_format_v1.js";

const DEFLATE_RAW = "deflate-raw";

function requireStreams(): void {
  if (
    typeof CompressionStream !== "function" ||
    typeof DecompressionStream !== "function"
  ) {
    throw new CodecError("deflate-raw-v1 needs CompressionStream support");
  }
}

async function runStream(
  input: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A malformed stream surfaces on the readable side; the writable side only
  // repeats it, and an unobserved rejection there would escape the caller.
  const written = writer
    // Copied so the stream owns a plain, non-shared buffer.
    .write(new Uint8Array(input))
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxOutputBytes) {
        await reader.cancel();
        throw new CodecError("stream produced more bytes than declared");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  await written;

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** `none` passes the input through unchanged; the caller keeps ownership. */
export async function compressBounded(
  input: Uint8Array,
  codec: CompressionCodecV1,
  maxOutputBytes: number = Number.MAX_SAFE_INTEGER,
): Promise<Uint8Array> {
  if (codec === "none") {
    return input;
  }
  requireStreams();
  return runStream(input, new CompressionStream(DEFLATE_RAW), maxOutputBytes);
}

/**
 * Produces exactly `decodedByteLength` bytes or throws: a short stream is as
 * much a format violation as an over-long one.
 */
export async function decompressBounded(
  input: Uint8Array,
  codec: CompressionCodecV1,
  decodedByteLength: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(decodedByteLength) || decodedByteLength < 0) {
    throw new CodecError("declared decoded length is not a safe length");
  }

  if (codec === "none") {
    if (input.byteLength !== decodedByteLength) {
      throw new CodecError("stored payload length differs from the declared length");
    }
    return input;
  }

  requireStreams();
  const output = await runStream(
    input,
    new DecompressionStream(DEFLATE_RAW),
    decodedByteLength,
  );
  if (output.byteLength !== decodedByteLength) {
    throw new CodecError("stream produced fewer bytes than declared");
  }
  return output;
}
