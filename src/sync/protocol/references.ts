import type { EnvelopeKeyRefV1, EnvelopeCryptoPort } from "../../application/ports/envelope-crypto.js";
import { constantTimeEquals, decodeStorageId16 } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import type { EnvelopePayloadKindV1, EnvelopeReferenceV1, EnvelopeScopeV1 } from "../../migrations/003_envelope_format_v1.js";
import { parseEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";

/** Authenticating parent context supplies scope and kind; SHF1 supplies dimensions. */
export async function referenceFromLocal(input: {
  readonly local: { readonly storageId: string; readonly semanticSha256: Uint8Array };
  readonly bytes: Uint8Array;
  readonly scope: EnvelopeScopeV1;
  readonly payloadKind: EnvelopePayloadKindV1;
  readonly key: EnvelopeKeyRefV1;
  readonly crypto: EnvelopeCryptoPort;
}): Promise<EnvelopeReferenceV1> {
  const frame = parseEnvelopeTransport(input.bytes);
  if (!constantTimeEquals(frame.storageId, decodeStorageId16(input.local.storageId))) throw new IntegrityError("local storage identity mismatch");
  const opened = await input.crypto.open(frame, input.scope, input.key, input.payloadKind);
  if (!constantTimeEquals(await input.crypto.sha256(opened.payload), input.local.semanticSha256)) throw new IntegrityError("local plaintext digest mismatch");
  return { storageId: frame.storageId, scope: input.scope, logicalRevision: frame.logicalRevision,
    envelopeFormatVersion: frame.envelopeFormatVersion, codecVersion: frame.codecVersion,
    cipherSuiteVersion: frame.cipherSuiteVersion, paddedBytes: frame.paddedBytes,
    ciphertextSha256: await input.crypto.sha256(frame.ciphertext) };
}

export async function authenticateReference(bytes: Uint8Array, reference: EnvelopeReferenceV1,
  kind: EnvelopePayloadKindV1, key: EnvelopeKeyRefV1, crypto: EnvelopeCryptoPort): Promise<Uint8Array> {
  const frame = parseEnvelopeTransport(bytes);
  if (!constantTimeEquals(frame.storageId, reference.storageId) || frame.logicalRevision !== reference.logicalRevision ||
      frame.paddedBytes !== reference.paddedBytes || frame.codecVersion !== reference.codecVersion ||
      frame.cipherSuiteVersion !== reference.cipherSuiteVersion || frame.envelopeFormatVersion !== reference.envelopeFormatVersion ||
      !constantTimeEquals(await crypto.sha256(frame.ciphertext), reference.ciphertextSha256)) throw new IntegrityError("envelope reference mismatch");
  return (await crypto.open(frame, reference.scope, key, kind)).payload;
}
