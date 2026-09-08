/** Ordered migration registry. This directory remains DB-owned permanently. */

import {
  LOCAL_DATABASE_VERSION,
  migrateLocalStore,
  type DexieDatabaseLike,
} from "./001_local_store_v1.js";
import {
  SHARE_DATABASE_VERSION,
  registerShareInboxV1,
} from "./002_share_inbox_v1.js";
import {
  CIPHER_SUITE_VERSION,
  CODEC_VERSION,
  ENVELOPE_FORMAT_VERSION,
  PADDING_PROFILE_VERSION,
  migrateEnvelope,
} from "./003_envelope_format_v1.js";
import { EVENT_FORMAT_VERSION, migrateEvent } from "./004_event_format_v1.js";
import {
  VAULT_FORMAT_VERSION,
  migrateAppManifest,
  migrateVaultIndex,
} from "./006_vault_format_v1.js";

export const CURRENT_FORMAT_VERSIONS = Object.freeze({
  localDatabase: LOCAL_DATABASE_VERSION,
  shareDatabase: SHARE_DATABASE_VERSION,
  codec: CODEC_VERSION,
  cipherSuite: CIPHER_SUITE_VERSION,
  envelope: ENVELOPE_FORMAT_VERSION,
  event: EVENT_FORMAT_VERSION,
  projection: 1,
  vault: VAULT_FORMAT_VERSION,
  paddingProfile: PADDING_PROFILE_VERSION,
});

export const PROJECTION_MIGRATION_ORDER = Object.freeze([
  "005_projection_v1.sql",
] as const);

export type ProjectionMigrationName =
  (typeof PROJECTION_MIGRATION_ORDER)[number];

export interface ProjectionMigrationHost {
  readUserVersion(): Promise<number>;
  executeScript(sql: string): Promise<void>;
}

export type ProjectionMigrationScripts = Readonly<
  Record<ProjectionMigrationName, string>
>;

/**
 * The projection is memory-only, so unsupported/newer schemas are discarded
 * and rebuilt rather than rewritten. V1 creation is atomic inside its SQL.
 */
export async function migrateProjectionSchema(
  host: ProjectionMigrationHost,
  scripts: ProjectionMigrationScripts,
): Promise<void> {
  const observedVersion = await host.readUserVersion();
  if (observedVersion > CURRENT_FORMAT_VERSIONS.projection) {
    throw new Error("Projection was created by a newer Sheaf build");
  }
  if (observedVersion === CURRENT_FORMAT_VERSIONS.projection) {
    return;
  }
  if (observedVersion !== 0) {
    throw new Error("No forward projection migration path is registered");
  }

  await host.executeScript(scripts["005_projection_v1.sql"]);
  if ((await host.readUserVersion()) !== CURRENT_FORMAT_VERSIONS.projection) {
    throw new Error("Projection migration did not reach the expected version");
  }
}

export interface ObservedFormatVersions {
  readonly localDatabase: number;
  readonly shareDatabase: number;
  readonly codec: number;
  readonly cipherSuite: number;
  readonly envelope: number;
  readonly event: number;
  readonly projection: number;
  readonly vault: number;
  readonly paddingProfile: number;
}

export interface MigrationPlan {
  readonly requiresUnlock: boolean;
  readonly rebuildProjection: true;
  readonly steps: readonly {
    readonly domain: keyof ObservedFormatVersions;
    readonly fromVersion: number;
    readonly toVersion: number;
  }[];
}

/** V1 only accepts a new store (0) or the exact current durable formats. */
export function planMigrations(observed: ObservedFormatVersions): MigrationPlan {
  const steps = (Object.keys(observed) as (keyof ObservedFormatVersions)[])
    .filter((domain) => observed[domain] !== CURRENT_FORMAT_VERSIONS[domain])
    .map((domain) => ({
      domain,
      fromVersion: observed[domain],
      toVersion: CURRENT_FORMAT_VERSIONS[domain],
    }));

  for (const step of steps) {
    if (step.fromVersion !== 0 || step.toVersion !== 1) {
      throw new Error(`No forward migration registered for ${step.domain}`);
    }
  }

  return {
    requiresUnlock: steps.some(
      (step) =>
        step.fromVersion > 0 &&
        [
          "codec",
          "cipherSuite",
          "envelope",
          "event",
          "vault",
          "paddingProfile",
        ].includes(step.domain),
    ),
    rebuildProjection: true,
    steps,
  };
}

export {
  migrateAppManifest,
  migrateEnvelope,
  migrateEvent,
  migrateLocalStore,
  migrateVaultIndex,
  registerShareInboxV1,
};

export type { DexieDatabaseLike };
