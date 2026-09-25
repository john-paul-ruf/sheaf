import { createActor, waitFor } from "xstate";
import { expect, it, vi } from "vitest";
import { durabilityMachine } from "../../../src/application/workflows/durability.machine.js";
import type { BundleSaveInteractionV1 } from "../../../src/application/ports/file-save.js";

it("only accepts confirmation after delivery, exactly once, for the live actor", async () => {
  let interaction!: BundleSaveInteractionV1;
  let deliver!: () => void;
  const saved = vi.fn();
  const actor = createActor(durabilityMachine, { input: { appId: "app", services: {
    async saveBundle(_app, next) {
      interaction = next;
      await new Promise<void>((resolve) => { deliver = resolve; });
      next.delivering();
      if (await next.confirmDelivery(next.signal)) { saved(); return "saved"; }
      return "cancelled";
    },
  } } }).start();
  try {
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "START" });
    actor.send({ type: "CONFIRM" });
    expect(saved).not.toHaveBeenCalled();
    deliver();
    await waitFor(actor, (state) => state.matches({ saving: "awaitingConfirmation" }));
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "CONFIRM" });
    await waitFor(actor, (state) => state.matches("savedUser"));
    expect(saved).toHaveBeenCalledOnce();
    expect(interaction.signal.aborted).toBe(true);
  } finally { actor.stop(); }
});

it.each(["cancel", "stop"] as const)("%s invalidates a delivered confirmation without saving", async (action) => {
  let confirmed = true;
  const actor = createActor(durabilityMachine, { input: { appId: "app", services: {
    async saveBundle(_app, next) {
      confirmed = await next.confirmDelivery(next.signal);
      return confirmed ? "saved" : "cancelled";
    },
  } } }).start();
  actor.send({ type: "START" });
  await waitFor(actor, (state) => state.matches({ saving: "awaitingConfirmation" }));
  if (action === "cancel") actor.send({ type: "CANCEL" });
  else actor.stop();
  await vi.waitFor(() => { expect(confirmed).toBe(false); });
  actor.send({ type: "CONFIRM" });
  expect(confirmed).toBe(false);
  actor.stop();
});

it("keeps native saved separate from user-confirmed saved", async () => {
  const actor = createActor(durabilityMachine, { input: { appId: "app", services: {
    saveBundle: () => Promise.resolve("saved"),
  } } }).start();
  try { actor.send({ type: "START" }); await waitFor(actor, (state) => state.matches("savedNative")); }
  finally { actor.stop(); }
});
