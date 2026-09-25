import type { DurableHomePort, HeadObjectV1, HeadReceiptV1 } from "../../../src/application/ports/durable-home.js";
import { constantTimeEquals, decodeStorageId16 } from "../../../src/domain/model/bytes.js";
import { IntegrityError } from "../../../src/domain/model/errors.js";
import { sha256 } from "../../../src/crypto/hash.js";
import { parseEnvelopeTransport } from "../../../src/persistence/codecs/envelope-frame.js";

/** One instance is one account/location; it never shares mutable storage. */
export class DurableHomeDouble implements DurableHomePort {
  readonly #objects = new Map<string, Uint8Array>();
  #head: HeadObjectV1 | null = null;
  #revision = 0;
  beforeUpload: (() => Promise<void>) | undefined;

  readHead(signal: AbortSignal): Promise<HeadObjectV1 | null> {
    signal.throwIfAborted();
    return Promise.resolve(this.#head === null ? null : { ...this.#head, bytes: this.#head.bytes.slice() });
  }
  readObject(id: string, signal: AbortSignal): Promise<Uint8Array | null> {
    signal.throwIfAborted();
    return Promise.resolve(this.#objects.get(id)?.slice() ?? null);
  }
  async createObject(id: string, ciphertext: Uint8Array, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const bytes = ciphertext.slice();
    const frame = parseEnvelopeTransport(bytes);
    if (!constantTimeEquals(decodeStorageId16(id), frame.storageId)) throw new IntegrityError("object ID mismatch");
    await this.beforeUpload?.();
    signal.throwIfAborted();
    const existing = this.#objects.get(id);
    if (existing !== undefined && !constantTimeEquals(existing, bytes)) throw new IntegrityError("immutable object conflict");
    this.#objects.set(id, bytes);
  }
  async compareAndSwapHead(expectedRevision: string | null, candidate: Uint8Array, signal: AbortSignal): Promise<HeadReceiptV1> {
    const bytes = candidate.slice();
    const candidateSha256 = await sha256(bytes);
    signal.throwIfAborted();
    if ((this.#head?.revision ?? null) !== expectedRevision) throw new IntegrityError("head CAS conflict");
    const revision = `opaque:${++this.#revision}`;
    this.#head = { bytes, revision };
    return { candidateSha256, revision };
  }
}
