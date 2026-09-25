import { assign, fromCallback, fromPromise, sendTo, setup } from "xstate";
import type { DurabilityServices } from "./durability-services.js";
import type { ReminderServices } from "./durability-services.js";
import type { ScratchReminderViewV1 } from "../../workers/protocol/messages.js";

interface ReminderInput { readonly appId: string; readonly services: ReminderServices }
interface ReminderContext extends ReminderInput { readonly reminder: ScratchReminderViewV1 | null; readonly queryCount: number }

export const scratchReminderMachine = setup({
  types: { input: {} as ReminderInput, context: {} as ReminderContext,
    events: {} as { readonly type: "REFRESH" | "DISMISS" } },
  actors: {
    query: fromPromise(async ({ input }: { input: ReminderInput }) => {
      const { reminder } = await input.services.query(input.appId);
      if (reminder !== null && reminder.appId !== input.appId) throw new Error("reminder app changed");
      return reminder;
    }),
    dismiss: fromPromise(async ({ input }: { input: ReminderContext }) => {
      const reminder = input.reminder;
      if (reminder?.triggeringCommitId == null) throw new Error("missing reminder identity");
      const result = await input.services.dismiss({ appId: input.appId, homeId: reminder.homeId,
        triggeringCommitId: reminder.triggeringCommitId, dismissalCount: reminder.dismissalCount });
      if ((result.reminder !== null && result.reminder.appId !== input.appId) || (result.outcome === "dismissed" &&
        (result.reminder === null || result.reminder.homeId !== reminder.homeId || result.reminder.triggeringCommitId !== reminder.triggeringCommitId))) {
        throw new Error("reminder dismissal identity changed");
      }
      return result;
    }),
  },
}).createMachine({
  id: "scratch-reminder",
  context: ({ input }) => ({ ...input, reminder: null, queryCount: 0 }),
  initial: "checking",
  on: { REFRESH: { target: ".checking", reenter: true } },
  states: {
    checking: { invoke: { src: "query", input: ({ context }) => context,
      onDone: { target: "ready", actions: assign({ reminder: ({ event }) => event.output,
        queryCount: ({ context }) => context.queryCount + 1 }) }, onError: "failed" } },
    ready: { on: { DISMISS: { target: "dismissing", guard: ({ context }) => context.reminder?.eligible === true } } },
    dismissing: { on: { REFRESH: {} }, invoke: { src: "dismiss", input: ({ context }) => context,
      onDone: { target: "ready", actions: assign({ reminder: ({ event }) => event.output.reminder }) }, onError: "failed" } },
    failed: {},
  },
});

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
