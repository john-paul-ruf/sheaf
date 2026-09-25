import type { AppDurabilityViewV1 } from "../../workers/protocol/messages.js";
import { backupFreshness } from "../../domain/policy/backup-freshness.js";

/** Authenticated receipt facts; formatting belongs to the surface. */
export type AppDurabilityVm = AppDurabilityViewV1;

export function selectBackupStatus(facts: AppDurabilityVm) {
  const freshness = backupFreshness(facts);
  return {
    freshness,
    title: freshness === "scratch" ? "On this device only · not backed up"
      : freshness === "never-confirmed" ? "Backup not confirmed"
        : freshness === "out-of-date" ? "Bundle out of date" : "Backup confirmed",
    tone: freshness === "current" ? "success" as const : "warning" as const,
    remedy: freshness === "scratch" ? "Back up now" : "Save a fresh bundle",
  };
}
