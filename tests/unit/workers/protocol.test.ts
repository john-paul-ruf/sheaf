/**
 * CA-04, page side: correlation, transfer, timeout, and termination.
 *
 * The worker is a stub here — what is under test is the client's bookkeeping,
 * not a command. The real worker answers in `tests/browser/worker/`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataWorkerClient,
  DataWorkerRequestError,
} from "../../../src/workers/protocol/client.js";
import {
  PROTOCOL_VERSION,
  isDataWorkerRequestMessageV1,
  isDataWorkerResponseMessageV1,
  isIdleTimeoutMinutesV1,
  type DataWorkerRequestMessageV1,
  type DataWorkerResponseMessageV1,
  type DataWorkerResultV1,
} from "../../../src/workers/protocol/messages.js";

interface SentMessage {
  readonly message: DataWorkerRequestMessageV1;
  readonly transfer: readonly Transferable[];
}

/** The narrow slice of `Worker` the client actually uses. */
class StubWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: SentMessage[] = [];
  terminated = 0;

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.sent.push({
      message: message as DataWorkerRequestMessageV1,
      transfer: [...transfer],
    });
  }

  terminate(): void {
    this.terminated += 1;
  }

  answer(id: number, result: DataWorkerResultV1): void {
    const data: DataWorkerResponseMessageV1 = {
      protocolVersion: PROTOCOL_VERSION,
      id,
      result,
    };
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function client(stub: StubWorker, requestTimeoutMs = 60_000): DataWorkerClient {
  return new DataWorkerClient({
    spawn: () => stub as unknown as Worker,
    requestTimeoutMs,
  });
}

const unlockedSession = {
  state: "unlocked",
  unlockedVia: "passphrase",
  settings: { idleTimeoutMinutes: 0 },
  catalogRevision: 1,
  transactionRevision: 1,
  appCount: 0,
  homeCount: 0,
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("DataWorkerClient", () => {
  it("spawns the worker on the first request, not at construction", async () => {
    const stub = new StubWorker();
    let spawns = 0;
    const lazy = new DataWorkerClient({
      spawn: () => {
        spawns += 1;
        return stub as unknown as Worker;
      },
    });

    expect(spawns).toBe(0);
    expect(lazy.isRunning).toBe(false);

    const pending = lazy.send({ kind: "getStatus" });
    expect(spawns).toBe(1);
    expect(lazy.isRunning).toBe(true);

    stub.answer(1, {
      ok: true,
      response: { kind: "getStatus", status: { state: "locked" } },
    });
    await expect(pending).resolves.toEqual({
      kind: "getStatus",
      status: { state: "locked" },
    });

    // A second request reuses the worker it already has.
    const second = lazy.send({ kind: "getStatus" });
    expect(spawns).toBe(1);
    const settled = expect(second).rejects.toMatchObject({
      error: { kind: "worker-terminated" },
    });
    lazy.terminate();
    await settled;
  });

  it("resolves each request with its own response, answered out of order", async () => {
    const stub = new StubWorker();
    const worker = client(stub);

    const first = worker.send({ kind: "getStatus" });
    const second = worker.send({ kind: "unlock", passphrase: "correct horse" });

    expect(stub.sent.map((entry) => entry.message.id)).toEqual([1, 2]);
    expect(stub.sent[0]?.message.protocolVersion).toBe(PROTOCOL_VERSION);

    stub.answer(2, {
      ok: true,
      response: { kind: "unlock", session: unlockedSession },
    });
    stub.answer(1, {
      ok: true,
      response: { kind: "getStatus", status: unlockedSession },
    });

    await expect(second).resolves.toEqual({
      kind: "unlock",
      session: unlockedSession,
    });
    await expect(first).resolves.toMatchObject({ kind: "getStatus" });
  });

  it("rejects with the typed error the worker sent, retryAfterMs included", async () => {
    const stub = new StubWorker();
    const worker = client(stub);
    const pending = worker.send({ kind: "unlock", passphrase: "wrong" });
    const settled = Promise.all([
      expect(pending).rejects.toBeInstanceOf(DataWorkerRequestError),
      expect(pending).rejects.toMatchObject({
        error: { kind: "wrong-passphrase", retryAfterMs: 2_000 },
      }),
    ]);

    stub.answer(1, {
      ok: false,
      error: { kind: "wrong-passphrase", retryAfterMs: 2_000 },
    });

    await settled;
  });

  it("ignores an unknown id and a malformed message instead of settling", async () => {
    const stub = new StubWorker();
    const worker = client(stub);
    const pending = worker.send({ kind: "getStatus" });
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );

    stub.answer(99, { ok: true, response: { kind: "getStatus", status: { state: "locked" } } });
    stub.onmessage?.({ data: { nonsense: true } } as MessageEvent<unknown>);
    await Promise.resolve();
    expect(settled).toBe(false);

    stub.answer(1, {
      ok: true,
      response: { kind: "getStatus", status: { state: "locked" } },
    });
    await expect(pending).resolves.toMatchObject({ kind: "getStatus" });
  });

  it("refuses a response whose kind is not the one requested", async () => {
    const stub = new StubWorker();
    const worker = client(stub);
    const pending = worker.send({ kind: "getStatus" });

    const settled = expect(pending).rejects.toMatchObject({
      error: { kind: "internal" },
    });

    stub.answer(1, {
      ok: true,
      response: { kind: "unlock", session: unlockedSession },
    });

    await settled;
  });

  it("passes transferables through to postMessage", async () => {
    const stub = new StubWorker();
    const worker = client(stub);
    const buffer = new ArrayBuffer(8);

    const pending = worker.send({ kind: "getStatus" }, [buffer]);
    expect(stub.sent[0]?.transfer).toEqual([buffer]);

    stub.answer(1, {
      ok: true,
      response: { kind: "getStatus", status: { state: "locked" } },
    });
    await pending;
  });

  it("times out a request the worker never answers", async () => {
    vi.useFakeTimers();
    const stub = new StubWorker();
    const worker = client(stub, 1_000);
    const pending = worker.send({ kind: "getStatus" });
    const settled = expect(pending).rejects.toMatchObject({
      error: { kind: "timeout" },
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await settled;
  });

  it("terminating fails everything in flight and refuses further requests", async () => {
    const stub = new StubWorker();
    const worker = client(stub);
    const pending = worker.send({ kind: "getStatus" });
    const settled = expect(pending).rejects.toMatchObject({
      error: { kind: "worker-terminated" },
    });

    worker.terminate();

    expect(stub.terminated).toBe(1);
    expect(worker.isRunning).toBe(false);
    await settled;
    await expect(worker.send({ kind: "getStatus" })).rejects.toMatchObject({
      error: { kind: "worker-terminated" },
    });
  });

  it("fails everything in flight when the worker itself errors", async () => {
    const stub = new StubWorker();
    const worker = client(stub);
    const pending = worker.send({ kind: "getStatus" });
    const settled = expect(pending).rejects.toMatchObject({
      error: { kind: "internal" },
    });

    stub.onerror?.(new Error("worker died"));

    await settled;
  });
});

describe("protocol guards", () => {
  it("accepts well-formed envelopes and rejects everything else", () => {
    expect(
      isDataWorkerRequestMessageV1({
        protocolVersion: 1,
        id: 1,
        request: { kind: "getStatus" },
      }),
    ).toBe(true);
    expect(
      isDataWorkerRequestMessageV1({
        protocolVersion: 2,
        id: 1,
        request: { kind: "getStatus" },
      }),
    ).toBe(false);
    expect(isDataWorkerRequestMessageV1({ protocolVersion: 1, id: 1 })).toBe(false);
    expect(isDataWorkerRequestMessageV1(null)).toBe(false);

    expect(
      isDataWorkerResponseMessageV1({
        protocolVersion: 1,
        id: 1,
        result: { ok: false, error: { kind: "locked" } },
      }),
    ).toBe(true);
    expect(
      isDataWorkerResponseMessageV1({
        protocolVersion: 1,
        id: 1,
        result: { ok: false, error: { kind: "not-a-kind" } },
      }),
    ).toBe(false);
  });

  it("accepts only the four approved idle-timeout values", () => {
    for (const minutes of [0, 5, 15, 60]) {
      expect(isIdleTimeoutMinutesV1(minutes)).toBe(true);
    }
    for (const rejected of [30, -1, 1.5, null, "15", undefined, 3_600]) {
      expect(isIdleTimeoutMinutesV1(rejected)).toBe(false);
    }
  });
});
