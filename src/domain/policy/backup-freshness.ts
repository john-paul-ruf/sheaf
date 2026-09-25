/** Freshness follows acknowledged changes, never the age of a local save. */
export function backupFreshness(facts: {
  readonly homeId: string | null;
  readonly confirmedAtMs: number | null;
  readonly deviceOnlyChangeCount: number;
}): "scratch" | "never-confirmed" | "out-of-date" | "current" {
  if (facts.homeId === null) return "scratch";
  if (facts.confirmedAtMs === null) return "never-confirmed";
  return facts.deviceOnlyChangeCount === 0 ? "current" : "out-of-date";
}
