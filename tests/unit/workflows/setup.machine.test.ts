/**
 * CAP-01. The two things worth breaking a build over: the recovery code cannot
 * be skipped, and no snapshot keeps a secret after the transition that used it.
 */

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { setupMachine } from "../../../src/application/workflows/setup.machine.js";
import {
  wordCountPassphrasePolicy,
  type PassphrasePolicyPort,
} from "../../../src/application/workflows/services.js";
import {
  SETUP_RECOVERY_CODE,
  fakeServices,
  rejects,
  resolves,
  unlockedSession,
  workerError,
} from "./fakes.js";

const STRONG = "harbour lantern gravel thicket";
const WEAK = "harbour";

const alwaysSufficient: PassphrasePolicyPort = { evaluate: () => "sufficient" };

function start(options: {
  services: ReturnType<typeof fakeServices>;
  policy?: PassphrasePolicyPort;
}) {
  const actor = createActor(setupMachine, {
    input: {
      services: options.services.services,
      policy: options.policy ?? wordCountPassphrasePolicy,
    },
  });
  actor.start();
  return actor;
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("setupMachine", () => {
  it("walks welcome → definePassphrase → deriving → codeIssued → codeConfirm → unlocked", async () => {
    const fake = fakeServices({
      setup: resolves({
        kind: "setup" as const,
        recoveryCode: SETUP_RECOVERY_CODE,
        session: unlockedSession(),
      }),
    });
    const actor = start({ services: fake });

    expect(actor.getSnapshot().value).toBe("welcome");
    actor.send({ type: "BEGIN" });
    expect(actor.getSnapshot().value).toBe("definePassphrase");

    actor.send({ type: "SUBMIT", passphrase: STRONG, confirmation: STRONG });
    expect(actor.getSnapshot().value).toBe("deriving");
    await settled();

    expect(actor.getSnapshot().value).toBe("codeIssued");
    expect(actor.getSnapshot().context.recoveryCode).toBe(SETUP_RECOVERY_CODE);
    expect(fake.calls).toEqual([
      { name: "setup", input: { passphrase: STRONG } },
    ]);

    actor.send({ type: "CONTINUE" });
    actor.send({ type: "ACKNOWLEDGE_SAVED", acknowledged: true });
    actor.send({ type: "FINISH" });

    expect(actor.getSnapshot().value).toBe("unlocked");
    expect(actor.getSnapshot().context.session).toEqual(unlockedSession());
  });

  it("refuses to finish until the user says they saved the code", async () => {
    const fake = fakeServices({
      setup: resolves({
        kind: "setup" as const,
        recoveryCode: SETUP_RECOVERY_CODE,
        session: unlockedSession(),
      }),
    });
    const actor = start({ services: fake });
    actor.send({ type: "BEGIN" });
    actor.send({ type: "SUBMIT", passphrase: STRONG, confirmation: STRONG });
    await settled();
    actor.send({ type: "CONTINUE" });

    actor.send({ type: "FINISH" });
    expect(actor.getSnapshot().value).toBe("codeConfirm");

    actor.send({ type: "ACKNOWLEDGE_SAVED", acknowledged: false });
    actor.send({ type: "FINISH" });
    expect(actor.getSnapshot().value).toBe("codeConfirm");

    actor.send({ type: "ACKNOWLEDGE_SAVED", acknowledged: true });
    actor.send({ type: "FINISH" });
    expect(actor.getSnapshot().value).toBe("unlocked");
  });

  it("keeps a weak or mismatched entry out of the worker and reports both verdicts", () => {
    const fake = fakeServices();
    const actor = start({ services: fake });
    actor.send({ type: "BEGIN" });

    actor.send({ type: "SUBMIT", passphrase: WEAK, confirmation: WEAK });
    expect(actor.getSnapshot().value).toBe("definePassphrase");
    expect(actor.getSnapshot().context.strength).toBe("weak");
    expect(actor.getSnapshot().context.match).toBe("matched");

    actor.send({ type: "SUBMIT", passphrase: STRONG, confirmation: "other" });
    expect(actor.getSnapshot().value).toBe("definePassphrase");
    expect(actor.getSnapshot().context.strength).toBe("sufficient");
    expect(actor.getSnapshot().context.match).toBe("mismatch");

    expect(fake.calls).toEqual([]);
  });

  it("reports verdicts while typing without retaining the entry", () => {
    const fake = fakeServices();
    const actor = start({ services: fake, policy: alwaysSufficient });
    actor.send({ type: "BEGIN" });

    actor.send({
      type: "EVALUATE",
      passphrase: STRONG,
      confirmation: "not yet",
    });

    const { context } = actor.getSnapshot();
    expect(context.strength).toBe("sufficient");
    expect(context.match).toBe("mismatch");
    expect(context.draft).toBeUndefined();
    expect(JSON.stringify(context)).not.toContain(STRONG);
  });

  it("surfaces a refused setup as a typed error and retries cleanly", async () => {
    const fake = fakeServices({
      setup: rejects(workerError("already-initialized")),
    });
    const actor = start({ services: fake });
    actor.send({ type: "BEGIN" });
    actor.send({ type: "SUBMIT", passphrase: STRONG, confirmation: STRONG });
    await settled();

    expect(actor.getSnapshot().value).toBe("failed");
    expect(actor.getSnapshot().context.error).toEqual({
      kind: "already-initialized",
    });

    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("definePassphrase");
    expect(actor.getSnapshot().context.error).toBeUndefined();
  });

  it("holds no secret in any snapshot once the transition that used it is over", async () => {
    const fake = fakeServices({
      setup: resolves({
        kind: "setup" as const,
        recoveryCode: SETUP_RECOVERY_CODE,
        session: unlockedSession(),
      }),
    });
    const actor = start({ services: fake });
    actor.send({ type: "BEGIN" });
    actor.send({ type: "SUBMIT", passphrase: STRONG, confirmation: STRONG });

    // In flight the entry is held, because the derive is consuming it.
    expect(actor.getSnapshot().context.draft).toEqual({ passphrase: STRONG });
    await settled();

    // The derive settled: the entry is gone, the issued code is displayable.
    expect(actor.getSnapshot().context.draft).toBeUndefined();
    expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(STRONG);

    actor.send({ type: "CONTINUE" });
    actor.send({ type: "ACKNOWLEDGE_SAVED", acknowledged: true });
    actor.send({ type: "FINISH" });

    const final = JSON.stringify(actor.getSnapshot().context);
    expect(final).not.toContain(STRONG);
    expect(final).not.toContain(SETUP_RECOVERY_CODE);
    expect(actor.getSnapshot().context.recoveryCode).toBeUndefined();
  });

  it("has no compensating writer: abandoning before the derive calls nothing", () => {
    const fake = fakeServices();
    const actor = start({ services: fake });
    actor.send({ type: "BEGIN" });
    actor.stop();

    expect(fake.calls).toEqual([]);
  });
});

describe("wordCountPassphrasePolicy", () => {
  it("accepts four or more words, as setup.html asks for", () => {
    expect(wordCountPassphrasePolicy.evaluate(STRONG)).toBe("sufficient");
    expect(wordCountPassphrasePolicy.evaluate("harbour lantern gravel")).toBe(
      "weak",
    );
    expect(wordCountPassphrasePolicy.evaluate("   ")).toBe("weak");
  });
});
