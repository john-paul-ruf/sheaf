/**
 * The runtime capability gate (M51 subset, CAP-08, decision D14/AD-9).
 *
 * Support is **feature-gated, not user-agent guessed** (architecture
 * § Supported Runtime Baseline): every entry below is decided by touching the
 * feature, and nothing is reported that was not actually tested. A probe that
 * cannot run its check reports `detected: false` rather than assuming.
 *
 * The required list is the spec's baseline, not this module's opinion. Three
 * extra entries are required because F01 code genuinely uses them; each one
 * carries the reason in its `reason` field, because an unexplained probe is a
 * defect. Storage persistence is advisory: architecture forbids equating a
 * granted browser hint with durability, so its absence never blocks startup.
 *
 * **Service workers are probed but not used.** F01 registers none — the
 * service worker, precache, and share-target receiver are F08. The probe is a
 * baseline gate for the platform Sheaf will need, not a claim that Sheaf
 * installs one today.
 */

export type CapabilityClassificationV1 =
  /** architecture § Supported Runtime Baseline, "Required capabilities". */
  | "baseline-required"
  /** Not in the spec's list, but F01 code calls it; reason is mandatory. */
  | "required-by-implementation"
  /** Reported so a surface can be honest about it; never fatal. */
  | "advisory";

export interface CapabilityEntry {
  readonly id: string;
  readonly classification: CapabilityClassificationV1;
  readonly detected: boolean;
  /** Why Sheaf needs this, in one line. SCR-001 may show it. */
  readonly reason: string;
}

export interface CapabilityReport {
  readonly entries: readonly CapabilityEntry[];
  /** Ids of required entries that are absent; empty means startup may run. */
  readonly missing: readonly string[];
  readonly supported: boolean;
}

interface CapabilityProbe {
  readonly id: string;
  readonly classification: CapabilityClassificationV1;
  readonly reason: string;
  readonly detect: () => boolean;
}

function isFunction(value: unknown): boolean {
  return typeof value === "function";
}

/**
 * Actually transfers a buffer and checks that it detached. Reading a property
 * would only prove the API exists; this proves the engine performs the move
 * the RPC boundary depends on.
 */
function detectsTransferableArrayBuffer(): boolean {
  if (!isFunction(globalThis.structuredClone)) {
    return false;
  }
  try {
    const buffer = new ArrayBuffer(8);
    structuredClone(buffer, { transfer: [buffer] });
    return buffer.byteLength === 0;
  } catch {
    return false;
  }
}

/** A real `<input type="file">` that kept the type and exposes `files`. */
function detectsPlatformFileInput(): boolean {
  if (typeof document === "undefined" || !isFunction(globalThis.File)) {
    return false;
  }
  try {
    const input = document.createElement("input");
    input.type = "file";
    return input.type === "file" && "files" in input;
  } catch {
    return false;
  }
}

const PROBES: readonly CapabilityProbe[] = Object.freeze([
  {
    id: "secure-context",
    classification: "baseline-required",
    reason:
      "Crypto, workers and storage are only trustworthy in a secure context.",
    detect: () => globalThis.isSecureContext === true,
  },
  {
    id: "indexeddb",
    classification: "baseline-required",
    reason: "The encrypted local store is the only durable home in F01.",
    detect: () => globalThis.indexedDB !== undefined,
  },
  {
    id: "web-crypto",
    classification: "baseline-required",
    reason:
      "The sodium WASM bootstrap needs crypto.subtle and getRandomValues.",
    detect: () =>
      globalThis.crypto !== undefined &&
      typeof globalThis.crypto.subtle === "object" &&
      globalThis.crypto.subtle !== null &&
      typeof globalThis.crypto.getRandomValues === "function",
  },
  {
    id: "webassembly",
    classification: "baseline-required",
    reason: "libsodium runs as WebAssembly; there is no JavaScript fallback.",
    detect: () =>
      typeof globalThis.WebAssembly === "object" &&
      globalThis.WebAssembly !== null &&
      isFunction(globalThis.WebAssembly.instantiate),
  },
  {
    id: "dedicated-worker",
    classification: "baseline-required",
    reason: "Keys and the database live only in the data worker.",
    detect: () => isFunction(globalThis.Worker),
  },
  {
    id: "service-worker",
    classification: "baseline-required",
    reason:
      "Baseline gate for offline install and inbound share (F08). F01 registers none.",
    detect: () =>
      typeof navigator !== "undefined" && "serviceWorker" in navigator,
  },
  {
    id: "transferable-array-buffer",
    classification: "baseline-required",
    reason: "Large payloads move to a worker by transfer, not by copy.",
    detect: detectsTransferableArrayBuffer,
  },
  {
    id: "blob-slice-stream",
    classification: "baseline-required",
    reason: "Import reads user files in bounded slices and streams.",
    detect: () =>
      isFunction(globalThis.Blob) &&
      typeof Blob.prototype.slice === "function" &&
      typeof Blob.prototype.stream === "function",
  },
  {
    id: "platform-file-input",
    classification: "baseline-required",
    reason: "A workbook enters Sheaf through the platform file picker.",
    detect: detectsPlatformFileInput,
  },
  {
    id: "structured-clone",
    classification: "required-by-implementation",
    reason:
      "The RPC boundary transfers typed arrays through structured clone (src/workers/protocol/client.ts).",
    detect: () => isFunction(globalThis.structuredClone),
  },
  {
    id: "broadcast-channel",
    classification: "required-by-implementation",
    reason:
      "Cross-tab revision notice (src/persistence/envelope-store/revision-signal.ts).",
    detect: () => isFunction(globalThis.BroadcastChannel),
  },
  {
    id: "compression-streams",
    classification: "required-by-implementation",
    reason:
      "The deflate-raw-v1 envelope compression path (src/persistence/codecs/compression.ts).",
    detect: () =>
      isFunction(globalThis.CompressionStream) &&
      isFunction(globalThis.DecompressionStream),
  },
  {
    id: "storage-persistence",
    classification: "advisory",
    reason:
      "Reduces eviction risk. A granted hint is never a durability claim, so its absence never blocks.",
    detect: () =>
      typeof navigator !== "undefined" &&
      navigator.storage !== undefined &&
      typeof navigator.storage.estimate === "function" &&
      typeof navigator.storage.persist === "function",
  },
]);

/** Every capability id this build probes, in report order. */
export const CAPABILITY_IDS: readonly string[] = Object.freeze(
  PROBES.map((probe) => probe.id),
);

function isRequired(classification: CapabilityClassificationV1): boolean {
  return classification !== "advisory";
}

/** A probe that throws has not demonstrated its capability; that is a `false`. */
function detect(probe: CapabilityProbe): boolean {
  try {
    return probe.detect();
  } catch {
    return false;
  }
}

export function probeCapabilities(): CapabilityReport {
  const entries = PROBES.map((probe) => ({
    id: probe.id,
    classification: probe.classification,
    reason: probe.reason,
    detected: detect(probe),
  }));
  const missing = entries
    .filter((entry) => isRequired(entry.classification) && !entry.detected)
    .map((entry) => entry.id);

  return Object.freeze({
    entries: Object.freeze(entries),
    missing: Object.freeze(missing),
    supported: missing.length === 0,
  });
}
