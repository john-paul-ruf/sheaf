import { fromCallback, sendTo, setup } from "xstate";
import type { DurabilityServices } from "./durability-services.js";

export interface DurabilityInput {
  readonly appId: string;
  readonly services: DurabilityServices;
}
export type DurabilityEvent =
  | { readonly type: "START" }
  | { readonly type: "DELIVERING" }
  | { readonly type: "DELIVERED" }
  | { readonly type: "CONFIRM" }
  | { readonly type: "CANCEL" }
  | { readonly type: "SAVED_NATIVE" | "SAVED_USER" | "FAILED" | "INTERRUPTED" | "CANCELLED" };

/** Confirmation exists only in the callback actor for this delivered operation. */
export const durabilityMachine = setup({
  types: { context: {} as DurabilityInput, input: {} as DurabilityInput, events: {} as DurabilityEvent },
  actors: {
    save: fromCallback<DurabilityEvent, DurabilityInput>(({ input, receive, sendBack }) => {
      const controller = new AbortController();
      let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
      let userConfirmed = false;
      let dismissed = false;
      let interrupted = false;
      let live = true;
      receive((event) => {
        if (event.type === "CONFIRM" && resolveConfirmation !== undefined && !controller.signal.aborted) {
          const accept = resolveConfirmation;
          resolveConfirmation = undefined;
          userConfirmed = true;
          accept(true);
        } else if (event.type === "CANCEL") {
          dismissed = true;
          controller.abort();
          resolveConfirmation?.(false);
          resolveConfirmation = undefined;
        }
      });
      // Invoke synchronously: opening the picker must retain user activation.
      void input.services.saveBundle(input.appId, {
        signal: controller.signal,
        delivering: () => { if (live) sendBack({ type: "DELIVERING" }); },
        confirmDelivery: (signal) => new Promise<boolean>((resolve) => {
          if (signal.aborted || controller.signal.aborted || !live) { resolve(false); return; }
          const abort = () => { interrupted = !dismissed; resolveConfirmation = undefined; resolve(false); };
          signal.addEventListener("abort", abort, { once: true });
          resolveConfirmation = (confirmed) => { signal.removeEventListener("abort", abort); resolve(confirmed); };
          sendBack({ type: "DELIVERED" });
        }),
      }).then((outcome) => {
        if (!live) return;
        sendBack({ type: outcome === "saved" ? userConfirmed ? "SAVED_USER" : "SAVED_NATIVE"
          : outcome === "cancelled" ? interrupted ? "INTERRUPTED" : "CANCELLED" : "FAILED" });
      }, () => { if (live) sendBack({ type: "FAILED" }); });
      return () => { live = false; controller.abort(); resolveConfirmation?.(false); resolveConfirmation = undefined; };
    }),
  },
}).createMachine({
  id: "bundle-save",
  context: ({ input }) => input,
  initial: "ready",
  states: {
    ready: { on: { START: "saving" } },
    saving: {
      invoke: { id: "save", src: "save", input: ({ context }) => context },
      initial: "preparing",
      on: {
        CANCEL: { actions: sendTo("save", { type: "CANCEL" }) },
        SAVED_NATIVE: "savedNative", SAVED_USER: "savedUser", FAILED: "failed",
        INTERRUPTED: "interrupted", CANCELLED: "cancelled",
      },
      states: {
        preparing: { on: { DELIVERING: "delivering", DELIVERED: "awaitingConfirmation" } },
        delivering: { on: { DELIVERED: "awaitingConfirmation" } },
        awaitingConfirmation: { on: { CONFIRM: { target: "confirming", actions: sendTo("save", { type: "CONFIRM" }) } } },
        confirming: {},
      },
    },
    savedNative: { on: { START: "saving" } },
    savedUser: { on: { START: "saving" } },
    failed: { on: { START: "saving" } },
    interrupted: { on: { START: "saving" } },
    cancelled: { on: { START: "saving" } },
  },
});
