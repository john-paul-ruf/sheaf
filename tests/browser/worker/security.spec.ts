/**
 * CAP-04/05/06/07 and CA-05 in a real browser.
 *
 * The delay case is the one that has to be real: the schedule is asserted with
 * a fake clock in `tests/unit/workers/session.test.ts`, and here the sixth
 * consecutive wrong passphrase must actually make the caller wait about two
 * seconds of wall-clock time before the correct one is accepted.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  PASSPHRASE,
  RECOVERY_CODE_PATTERN,
  command,
  readStore,
  start,
  teardown,
} from "./runtime.js";

const NEXT_PASSPHRASE = "a different passphrase entirely";

/** Every case needs a real setup: calibration plus at least one derivation. */
test.setTimeout(180_000);

async function setup(page: Page): Promise<string> {
  await start(page);
  const created = await command(page, { kind: "setup", passphrase: PASSPHRASE });
  if (!created.ok || created.response.kind !== "setup") {
    throw new Error("setup did not answer");
  }
  return created.response.recoveryCode;
}

/** Locks (terminating the worker) and starts a fresh client, as a relaunch does. */
async function relaunch(page: Page): Promise<void> {
  await page.evaluate(() => window.__sheafApp?.lockNow("user"));
  await start(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

test("CA-05: the sixth wrong passphrase makes the next attempt really wait", async ({
  page,
}) => {
  await setup(page);
  await relaunch(page);

  const delays: (number | undefined)[] = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const refused = await command(page, { kind: "unlock", passphrase: "not it" });
    if (refused.ok) {
      throw new Error("a wrong passphrase unlocked the store");
    }
    expect(refused.error.kind).toBe("wrong-passphrase");
    delays.push(refused.error.retryAfterMs);
  }

  // Five free failures; the delay appears at the sixth, not the fifth (AD-5).
  expect(delays).toEqual([0, 0, 0, 0, 0, 2_000]);

  // The correct passphrase is refused while the delay stands — and the refusal
  // costs no derivation, so this is the wait, not the work.
  const tooSoon = await command(page, { kind: "unlock", passphrase: PASSPHRASE });
  if (tooSoon.ok) {
    throw new Error("the delay was not enforced");
  }
  expect(tooSoon.error.kind).toBe("rate-limited");
  expect(tooSoon.error.retryAfterMs ?? 0).toBeGreaterThan(0);
  expect(tooSoon.error.retryAfterMs ?? 0).toBeLessThanOrEqual(2_000);

  // Retry until the gate opens, measuring the wall clock in the page.
  const observed = await page.evaluate(async (passphrase) => {
    const app = window.__sheafApp;
    if (app === undefined) {
      throw new Error("startApp() has not run");
    }
    const started = performance.now();
    let refusals = 0;
    for (;;) {
      try {
        await app.client.send({ kind: "unlock", passphrase });
        return { elapsedMs: performance.now() - started, refusals };
      } catch (cause) {
        const kind = (cause as { error?: { kind?: string } }).error?.kind;
        if (kind !== "rate-limited") {
          throw new Error(`unexpected refusal: ${kind ?? "unknown"}`);
        }
        refusals += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }, PASSPHRASE);

  expect(observed.refusals).toBeGreaterThan(0);
  // A real ~2s wait was served. Timers may fire a hair early; nothing here is
  // allowed to pass with no wait at all.
  expect(observed.elapsedMs).toBeGreaterThan(1_800);

  // A successful unlock resets the schedule: the next failure is free again.
  const afterSuccess = await command(page, { kind: "unlock", passphrase: "not it" });
  if (afterSuccess.ok) {
    throw new Error("a wrong passphrase unlocked the store");
  }
  expect(afterSuccess.error).toEqual({ kind: "wrong-passphrase", retryAfterMs: 0 });
});

test("CAP-05: the recovery code unlocks, and then installs a new passphrase", async ({
  page,
}) => {
  const recoveryCode = await setup(page);
  expect(recoveryCode).toMatch(RECOVERY_CODE_PATTERN);
  await relaunch(page);

  const wrong = await command(page, {
    kind: "unlockWithRecoveryCode",
    recoveryCode: "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA",
  });
  expect(wrong).toMatchObject({
    ok: false,
    error: { kind: "invalid-recovery-code" },
  });

  const recovered = await command(page, {
    kind: "unlockWithRecoveryCode",
    recoveryCode,
  });
  if (!recovered.ok || recovered.response.kind !== "unlockWithRecoveryCode") {
    throw new Error("recovery unlock did not answer");
  }
  expect(recovered.response.session).toMatchObject({
    state: "unlocked",
    unlockedVia: "recovery-code",
    appCount: 0,
  });

  // A recovery-unlocked session may install a passphrase without the old one.
  const installed = await command(page, {
    kind: "changePassphrase",
    authorization: { via: "recovery" },
    nextPassphrase: NEXT_PASSPHRASE,
  });
  expect(installed.ok).toBe(true);

  await relaunch(page);
  expect(
    await command(page, { kind: "unlock", passphrase: PASSPHRASE }),
  ).toMatchObject({ ok: false, error: { kind: "wrong-passphrase" } });
  expect(
    await command(page, { kind: "unlock", passphrase: NEXT_PASSPHRASE }),
  ).toMatchObject({ ok: true, response: { kind: "unlock" } });
});

test("CAP-04: a passphrase change re-wraps and rewrites no envelope", async ({
  page,
}) => {
  await setup(page);
  const before = await readStore(page);

  const changed = await command(page, {
    kind: "changePassphrase",
    authorization: { via: "current-passphrase", currentPassphrase: PASSPHRASE },
    nextPassphrase: NEXT_PASSPHRASE,
  });
  expect(changed.ok).toBe(true);

  const after = await readStore(page);
  // Only the wrapper moved: the catalog pointer and every ciphertext byte are
  // exactly what they were.
  expect(after.catalogStorageId).toBe(before.catalogStorageId);
  expect(after.envelopes).toEqual(before.envelopes);
  expect(after.transactionRevision).toBe((before.transactionRevision ?? 0) + 1);
  expect(after.passphraseSaltSha256).not.toBe(before.passphraseSaltSha256);
  expect(after.passphraseWrapId).not.toBe(before.passphraseWrapId);

  // A wrong current passphrase changes nothing.
  const refused = await command(page, {
    kind: "changePassphrase",
    authorization: { via: "current-passphrase", currentPassphrase: "not it" },
    nextPassphrase: "another",
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: "wrong-passphrase" } });
  expect((await readStore(page)).passphraseWrapId).toBe(after.passphraseWrapId);

  await relaunch(page);
  expect(
    await command(page, { kind: "unlock", passphrase: NEXT_PASSPHRASE }),
  ).toMatchObject({ ok: true });
});

test("CAP-06: the code can be viewed again, passphrase-gated", async ({ page }) => {
  const issued = await setup(page);

  const refused = await command(page, {
    kind: "revealRecoveryCode",
    currentPassphrase: "not it",
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: "wrong-passphrase" } });

  const revealed = await command(page, {
    kind: "revealRecoveryCode",
    currentPassphrase: PASSPHRASE,
  });
  if (!revealed.ok || revealed.response.kind !== "revealRecoveryCode") {
    throw new Error("reveal did not answer");
  }
  // The same code the user was given at setup, read back out of the catalog's
  // own wrapped view field (D10).
  expect(revealed.response.recoveryCode).toBe(issued);
});

test("CAP-07: a locked reset purges the database", async ({ page }) => {
  await setup(page);
  expect((await readStore(page)).exists).toBe(true);
  await relaunch(page);

  const purged = await command(page, { kind: "resetLocked" });
  expect(purged).toEqual({
    ok: true,
    response: { kind: "resetLocked", purged: true },
  });

  expect((await readStore(page)).exists).toBe(false);
  expect(await command(page, { kind: "getStatus" })).toMatchObject({
    ok: true,
    response: { status: { state: "uninitialized" } },
  });
});

test("CA-01: envelope bytes are identical across a reopen", async ({ page }) => {
  await setup(page);
  const before = await readStore(page);
  expect(before.envelopes).toHaveLength(1);

  await page.reload();
  await start(page);

  const after = await readStore(page);
  expect(after.envelopes).toEqual(before.envelopes);

  // And they still decrypt: identity is not merely byte equality of junk.
  expect(
    await command(page, { kind: "unlock", passphrase: PASSPHRASE }),
  ).toMatchObject({ ok: true, response: { kind: "unlock" } });
});
