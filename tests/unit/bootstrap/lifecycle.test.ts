/**
 * CAP-03, page side: the relock hooks and the idle timer.
 *
 * FR-22 is specific about the shape of this: unlock persists for the session,
 * termination always re-locks, and the idle timeout is off by default so that
 * field use is not interrupted. All three are asserted here, in jsdom, where
 * `pagehide` and `visibilitychange` can actually be dispatched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp, type AppRuntime } from "../../../src/bootstrap/app-bootstrap.js";

class FakeWorker {
  terminated = 0;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  postMessage(message: unknown): void {
    // Answer every request as an ack, so `lockNow` does not wait for a timeout.
    const id = (message as { id: number }).id;
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          protocolVersion: 1,
          id,
          result: {
            ok: true,
            response: { kind: "lock", status: { state: "locked" } },
          },
        },
      } as MessageEvent<unknown>);
    });
  }

  terminate(): void {
    this.terminated += 1;
  }
}

function supportedRuntime(): void {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("crypto", { subtle: {}, getRandomValues: (a: Uint8Array) => a });
  vi.stubGlobal("WebAssembly", { instantiate: () => undefined });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { serviceWorker: {}, storage: {} });
  vi.stubGlobal(
    "Blob",
    class {
      slice(): unknown {
        return this;
      }
      stream(): unknown {
        return this;
      }
    },
  );
  vi.stubGlobal("BroadcastChannel", class {});
  vi.stubGlobal("CompressionStream", class {});
  vi.stubGlobal("DecompressionStream", class {});
  vi.stubGlobal(
    "structuredClone",
    (value: unknown, options?: { transfer?: readonly ArrayBuffer[] }) => {
      for (const buffer of options?.transfer ?? []) {
        (buffer as ArrayBuffer & { transfer: () => ArrayBuffer }).transfer();
      }
      return value;
    },
  );
}

let runtime: AppRuntime;
let worker: FakeWorker;

function ready(): AppRuntime {
  const result = startApp({
    spawnWorker: () => {
      worker = new FakeWorker();
      return worker as unknown as Worker;
    },
  });
  if (result.kind !== "ready") {
    throw new Error(`unsupported: ${result.missing.join(", ")}`);
  }
  return result.app;
}

beforeEach(() => {
  supportedRuntime();
  vi.useFakeTimers();
  runtime = ready();
});

afterEach(() => {
  runtime.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("relock hooks", () => {
  it("re-locks on pagehide, because that is where termination happens", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));

    window.dispatchEvent(new Event("pagehide"));
    await vi.runAllTimersAsync();

    expect(reasons).toEqual(["pagehide"]);
    expect(runtime.client.isRunning).toBe(false);
  });

  it("does not lock merely because the tab was hidden", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(reasons).toEqual([]);
  });

  it("stops listening once disposed", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));

    runtime.dispose();
    window.dispatchEvent(new Event("pagehide"));
    await vi.runAllTimersAsync();

    expect(reasons).toEqual([]);
  });
});

describe("the idle timer", () => {
  it("is off by default: an hour of nothing does not lock", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(reasons).toEqual([]);
  });

  it("locks once the chosen timeout elapses", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));
    runtime.setIdleTimeout(5);

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(reasons).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(reasons).toEqual(["idle-timeout"]);
    expect(runtime.client.isRunning).toBe(false);
  });

  it("restarts on activity, so a used app is never idle", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));
    runtime.setIdleTimeout(5);

    for (let minute = 0; minute < 10; minute += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      runtime.noteActivity();
    }

    expect(reasons).toEqual([]);
  });

  it("disarms when the setting goes back to off", async () => {
    const reasons: string[] = [];
    runtime.onLock((reason) => reasons.push(reason));

    runtime.setIdleTimeout(5);
    await vi.advanceTimersByTimeAsync(60_000);
    runtime.setIdleTimeout(0);
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(reasons).toEqual([]);
  });
});
