/**
 * CAP-08: the capability gate, one required capability removed at a time.
 *
 * Runs in the jsdom project (S01's `vitest.config.ts` mapping). jsdom does not
 * implement most of the baseline, so the supported runtime is assembled from
 * stubs and then broken deliberately — which is the only way to prove the gate
 * names the missing capability rather than failing later and vaguely.
 *
 * The real browser answers for real: S07 owns `tests/e2e/capability-gate.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp } from "../../../src/bootstrap/app-bootstrap.js";
import {
  CAPABILITY_IDS,
  probeCapabilities,
} from "../../../src/platform/capabilities.js";

class FakeWorker {
  terminate(): void {
    // never spawned in these tests
  }
}

const spawnWorker = (): Worker => new FakeWorker() as unknown as Worker;

/** A `structuredClone` that really detaches, so the transfer probe can pass. */
function stubStructuredClone(): void {
  vi.stubGlobal(
    "structuredClone",
    (value: unknown, options?: { transfer?: readonly ArrayBuffer[] }) => {
      for (const buffer of options?.transfer ?? []) {
        // `ArrayBuffer.prototype.transfer` is ES2024; the pinned lib is ES2022.
        (buffer as ArrayBuffer & { transfer: () => ArrayBuffer }).transfer();
      }
      return value;
    },
  );
}

function installSupportedRuntime(): void {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("crypto", {
    subtle: {},
    getRandomValues: (array: Uint8Array) => array,
  });
  vi.stubGlobal("WebAssembly", { instantiate: () => undefined });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", {
    serviceWorker: {},
    storage: { estimate: () => undefined, persist: () => undefined },
  });
  // jsdom's Blob has `slice` but no `stream`.
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
  stubStructuredClone();
}

interface Removal {
  readonly id: string;
  readonly remove: () => void;
  /** Ids the report must then list; usually just the removed one. */
  readonly expected: readonly string[];
}

const REMOVALS: readonly Removal[] = [
  {
    id: "secure-context",
    remove: () => vi.stubGlobal("isSecureContext", false),
    expected: ["secure-context"],
  },
  {
    id: "indexeddb",
    remove: () => vi.stubGlobal("indexedDB", undefined),
    expected: ["indexeddb"],
  },
  {
    id: "web-crypto",
    remove: () => vi.stubGlobal("crypto", { getRandomValues: () => undefined }),
    expected: ["web-crypto"],
  },
  {
    id: "webassembly",
    remove: () => vi.stubGlobal("WebAssembly", undefined),
    expected: ["webassembly"],
  },
  {
    id: "dedicated-worker",
    remove: () => vi.stubGlobal("Worker", undefined),
    expected: ["dedicated-worker"],
  },
  {
    id: "service-worker",
    remove: () => vi.stubGlobal("navigator", { storage: {} }),
    expected: ["service-worker"],
  },
  {
    id: "transferable-array-buffer",
    // Present as an API, but it does not move ownership: the probe checks the
    // effect, so a non-detaching implementation is still a missing capability.
    remove: () => vi.stubGlobal("structuredClone", (value: unknown) => value),
    expected: ["transferable-array-buffer"],
  },
  {
    id: "blob-slice-stream",
    remove: () => vi.stubGlobal("Blob", class {}),
    expected: ["blob-slice-stream"],
  },
  {
    id: "platform-file-input",
    remove: () => vi.stubGlobal("File", undefined),
    expected: ["platform-file-input"],
  },
  {
    id: "structured-clone",
    // Removing it entirely also removes the transfer that depends on it; both
    // are reported, and the honest report is both.
    remove: () => vi.stubGlobal("structuredClone", undefined),
    expected: ["transferable-array-buffer", "structured-clone"],
  },
  {
    id: "broadcast-channel",
    remove: () => vi.stubGlobal("BroadcastChannel", undefined),
    expected: ["broadcast-channel"],
  },
  {
    id: "compression-streams",
    remove: () => vi.stubGlobal("CompressionStream", undefined),
    expected: ["compression-streams"],
  },
];

beforeEach(() => {
  installSupportedRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeCapabilities", () => {
  it("reports every probed id once, with a classification and a reason", () => {
    const report = probeCapabilities();

    expect(report.entries.map((entry) => entry.id)).toEqual([...CAPABILITY_IDS]);
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
    for (const entry of report.entries) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect([
        "baseline-required",
        "required-by-implementation",
        "advisory",
      ]).toContain(entry.classification);
    }
  });

  it("classifies the spec baseline, the three implementation needs, and the advisory one", () => {
    const byClassification = (classification: string): string[] =>
      probeCapabilities()
        .entries.filter((entry) => entry.classification === classification)
        .map((entry) => entry.id);

    expect(byClassification("baseline-required")).toEqual([
      "secure-context",
      "indexeddb",
      "web-crypto",
      "webassembly",
      "dedicated-worker",
      "service-worker",
      "transferable-array-buffer",
      "blob-slice-stream",
      "platform-file-input",
    ]);
    expect(byClassification("required-by-implementation")).toEqual([
      "structured-clone",
      "broadcast-channel",
      "compression-streams",
    ]);
    expect(byClassification("advisory")).toEqual(["storage-persistence"]);
  });

  it("says why each implementation-required capability is needed, by file", () => {
    const reasonOf = (id: string): string =>
      probeCapabilities().entries.find((entry) => entry.id === id)?.reason ?? "";

    expect(reasonOf("structured-clone")).toContain("client.ts");
    expect(reasonOf("broadcast-channel")).toContain("revision-signal.ts");
    expect(reasonOf("compression-streams")).toContain("compression.ts");
    // F01 registers no service worker; the entry must not imply otherwise.
    expect(reasonOf("service-worker")).toContain("F01 registers none");
  });
});

describe("startApp", () => {
  it("is ready on a supported runtime and does not spawn the worker yet", () => {
    let spawns = 0;
    const result = startApp({
      spawnWorker: () => {
        spawns += 1;
        return spawnWorker();
      },
    });

    expect(result.kind).toBe("ready");
    expect(result.report.missing).toEqual([]);
    expect(result.report.supported).toBe(true);
    expect(spawns).toBe(0);
    if (result.kind === "ready") {
      expect(result.app.client.isRunning).toBe(false);
    }
  });

  it.each(REMOVALS)(
    "refuses to start and names $id as missing",
    ({ expected, remove }) => {
      remove();
      const result = startApp({ spawnWorker });

      expect(result.kind).toBe("unsupported");
      if (result.kind !== "unsupported") {
        return;
      }
      expect([...result.missing].sort()).toEqual([...expected].sort());
      expect(result.report.supported).toBe(false);
    },
  );

  it("starts without the advisory capability and reports its absence", () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    const result = startApp({ spawnWorker });

    expect(result.kind).toBe("ready");
    expect(result.report.missing).toEqual([]);
    expect(
      result.report.entries.find((entry) => entry.id === "storage-persistence"),
    ).toMatchObject({ classification: "advisory", detected: false });
  });

  it("locks by terminating the worker and telling its listeners once", async () => {
    const result = startApp({ spawnWorker });
    if (result.kind !== "ready") {
      throw new Error("expected a ready runtime");
    }

    const reasons: string[] = [];
    const unsubscribe = result.app.onLock((reason) => reasons.push(reason));

    await result.app.lockNow("user");
    await result.app.lockNow("pagehide");

    expect(reasons).toEqual(["user"]);
    expect(result.app.client.isRunning).toBe(false);
    unsubscribe();
  });
});
