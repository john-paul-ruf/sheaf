/**
 * CA-04 redaction: what crosses the boundary is a kind, and only a kind.
 *
 * The negative control is the important half — an error whose message carries
 * the passphrase must produce a wire value that contains no fragment of it.
 */

import { describe, expect, it } from "vitest";
import {
  CodecError,
  CryptoError,
  IntegrityError,
} from "../../../src/domain/model/errors.js";
import {
  BootstrapExistsError,
  EnvelopeExistsError,
  RevisionConflictError,
} from "../../../src/persistence/envelope-store/errors.js";
import {
  DataWorkerCommandError,
  redactError,
} from "../../../src/workers/protocol/redact.js";
import {
  DATA_WORKER_ERROR_KINDS_V1,
  isDataWorkerErrorKindV1,
} from "../../../src/workers/protocol/messages.js";

const SECRET = "correct horse battery staple";

describe("redactError", () => {
  it("keeps a command's own kind and its retryAfterMs", () => {
    expect(
      redactError(
        new DataWorkerCommandError("wrong-passphrase", { retryAfterMs: 2_000 }),
      ),
    ).toEqual({ kind: "wrong-passphrase", retryAfterMs: 2_000 });

    expect(redactError(new DataWorkerCommandError("locked"))).toEqual({
      kind: "locked",
    });
  });

  it("drops a retryAfterMs that is not a whole non-negative count", () => {
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        redactError(
          new DataWorkerCommandError("rate-limited", { retryAfterMs: invalid }),
        ),
      ).toEqual({ kind: "rate-limited" });
    }
  });

  it("maps store and domain errors onto allowlisted kinds", () => {
    expect(redactError(new RevisionConflictError(1, 0, 3, 0))).toEqual({
      kind: "revision-conflict",
    });
    expect(redactError(new BootstrapExistsError())).toEqual({
      kind: "already-initialized",
    });
    expect(redactError(new IntegrityError("envelope failed authentication"))).toEqual(
      { kind: "integrity" },
    );
    expect(redactError(new CodecError("catalog is not canonical"))).toEqual({
      kind: "integrity",
    });
    expect(redactError(new CryptoError("descriptor is not the v1 suite"))).toEqual({
      kind: "internal",
    });
    expect(redactError(new EnvelopeExistsError())).toEqual({ kind: "internal" });
  });

  it("says nothing at all about an unknown failure", () => {
    expect(redactError(new TypeError("x is not a function"))).toEqual({
      kind: "internal",
    });
    expect(redactError("a bare string")).toEqual({ kind: "internal" });
    expect(redactError(undefined)).toEqual({ kind: "internal" });
  });

  it("never carries a secret from the message it was given", () => {
    const leaky = new Error(`unwrap failed for passphrase ${SECRET}`);
    const wire = redactError(leaky);

    expect(JSON.stringify(wire)).not.toContain("correct");
    expect(JSON.stringify(wire)).not.toContain("passphrase");
    expect(Object.keys(wire)).toEqual(["kind"]);
  });

  it("only ever produces an allowlisted kind", () => {
    const produced = [
      redactError(new DataWorkerCommandError("stale-confirmation")),
      redactError(new IntegrityError("x")),
      redactError(new Error("x")),
    ];
    for (const wire of produced) {
      expect(isDataWorkerErrorKindV1(wire.kind)).toBe(true);
      expect(DATA_WORKER_ERROR_KINDS_V1).toContain(wire.kind);
    }
  });
});
