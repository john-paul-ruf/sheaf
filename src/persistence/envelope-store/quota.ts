/**
 * Storage usage estimate.
 *
 * `navigator.storage.estimate()` is advisory everywhere and absent in some
 * contexts. When it cannot answer, the answer is `unknown`: a fabricated
 * number here would become a capacity claim in the UI, and a wrong capacity
 * claim is worse than an honest silence (architecture § truthful status).
 */

export type UsageEstimate =
  | {
      readonly kind: "estimated";
      readonly usageBytes: number;
      readonly quotaBytes: number;
    }
  | { readonly kind: "unknown" };

const UNKNOWN: UsageEstimate = { kind: "unknown" };

export async function estimateUsage(): Promise<UsageEstimate> {
  if (typeof navigator === "undefined" || navigator.storage?.estimate === undefined) {
    return UNKNOWN;
  }

  let usage: number | undefined;
  let quota: number | undefined;
  try {
    ({ usage, quota } = await navigator.storage.estimate());
  } catch {
    return UNKNOWN;
  }

  return usage === undefined || quota === undefined
    ? UNKNOWN
    : { kind: "estimated", usageBytes: usage, quotaBytes: quota };
}
