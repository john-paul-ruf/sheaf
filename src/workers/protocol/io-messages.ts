/** Dedicated channels only. Page/data RPC remains byte-free. */
export interface BundleIdentityV1 {
  readonly operationId: string;
  readonly appId: string;
  readonly homeId: string;
  readonly artifactSha256: string;
}
export function isBundleIdentity(value: unknown): value is BundleIdentityV1 {
  if (typeof value !== "object" || value === null) return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().join() === "appId,artifactSha256,homeId,operationId" &&
    ["appId", "homeId", "operationId", "artifactSha256"].every((key) => typeof object[key] === "string" && object[key].length > 0);
}
export function sameBundleIdentity(a: BundleIdentityV1, b: BundleIdentityV1): boolean {
  return a.operationId === b.operationId && a.appId === b.appId && a.homeId === b.homeId && a.artifactSha256 === b.artifactSha256;
}
export function isPrepareBundle(value: unknown): value is { kind: "prepareBundle"; ioVersion: 1; appId: string } {
  if (typeof value !== "object" || value === null) return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().join() === "appId,ioVersion,kind" && object["kind"] === "prepareBundle" && object["ioVersion"] === 1 && typeof object["appId"] === "string";
}
export function ioRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("invalid IO message");
  return value as Record<string, unknown>;
}
