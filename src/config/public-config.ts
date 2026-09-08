/**
 * The single intake for public build configuration (M50).
 *
 * Everything here ships inside a static bundle any visitor can read, so the
 * validator's job is not to protect the values — it is to make sure a secret
 * is never put here by accident. A name shaped like a secret or a value shaped
 * like a credential fails the build rather than shipping.
 *
 * F01 has no provider and no allowed origin: Dropbox and OneDrive arrive in
 * F05 with their own registrations. Format versions are passed through from
 * `src/migrations/index.ts` and are never redeclared (CA-06).
 */

import { CURRENT_FORMAT_VERSIONS } from "../migrations/index.js";

export interface PublicConfig {
  readonly formatVersions: typeof CURRENT_FORMAT_VERSIONS;
  /** Provider client IDs by provider id. Empty until F05. */
  readonly providerClientIds: Readonly<Record<string, string>>;
  /** Origins the network guard may contact. Empty: F01 makes no request. */
  readonly allowedOrigins: readonly string[];
}

export const PUBLIC_CONFIG: PublicConfig = Object.freeze({
  formatVersions: CURRENT_FORMAT_VERSIONS,
  providerClientIds: Object.freeze({}),
  allowedOrigins: Object.freeze([]),
});

export class PublicConfigError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PublicConfigError";
  }
}

/**
 * Property names that must never appear in public configuration. A client
 * *secret*, a *private* key, a bearer *token*, and anything ending in *key*
 * are the four shapes a build has any plausible reason to reach for.
 * `providerClientIds` and `formatVersions` deliberately do not match.
 */
const SECRET_SHAPED_NAME = /secret|private|token|key$/i;

/**
 * Value shapes that are credentials wherever they appear: PEM private key
 * blocks, `Authorization: Bearer` strings, and the vendor-prefixed API keys
 * that leak most often in public bundles.
 */
const SECRET_SHAPED_VALUE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|^Bearer\s|^(?:sk|rk|pk)_(?:live|test)_|^gh[pousr]_|^AIza[0-9A-Za-z_-]{10,}/;

function walk(value: unknown, path: string, depth: number): void {
  if (depth > 8) {
    throw new PublicConfigError(`public config nests too deeply at ${path}`);
  }
  if (typeof value === "string") {
    if (SECRET_SHAPED_VALUE.test(value)) {
      throw new PublicConfigError(
        `public config value at ${path} is shaped like a credential`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => walk(element, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [name, nested] of Object.entries(value)) {
      if (SECRET_SHAPED_NAME.test(name)) {
        throw new PublicConfigError(
          `public config name ${path}.${name} is shaped like a secret`,
        );
      }
      walk(nested, `${path}.${name}`, depth + 1);
    }
  }
}

function assertVersionsMatchMigrations(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new PublicConfigError("public config has no format versions");
  }
  const declared = value as Record<string, unknown>;
  for (const [name, version] of Object.entries(CURRENT_FORMAT_VERSIONS)) {
    if (declared[name] !== version) {
      throw new PublicConfigError(
        `public config format version ${name} disagrees with src/migrations`,
      );
    }
  }
}

/**
 * Returns the config it was given, or throws. Callers use the return value so
 * that an unvalidated object cannot be used by simply forgetting the call.
 */
export function validatePublicConfig(config: unknown): PublicConfig {
  if (typeof config !== "object" || config === null) {
    throw new PublicConfigError("public config must be an object");
  }
  const candidate = config as Record<string, unknown>;

  assertVersionsMatchMigrations(candidate["formatVersions"]);

  const providerClientIds: unknown = candidate["providerClientIds"];
  if (typeof providerClientIds !== "object" || providerClientIds === null) {
    throw new PublicConfigError("public config must declare providerClientIds");
  }
  for (const [provider, clientId] of Object.entries(providerClientIds)) {
    if (typeof clientId !== "string" || clientId.length === 0) {
      throw new PublicConfigError(
        `provider client id for ${provider} must be a non-empty string`,
      );
    }
  }

  const allowedOrigins: unknown = candidate["allowedOrigins"];
  if (!Array.isArray(allowedOrigins)) {
    throw new PublicConfigError("public config must declare allowedOrigins");
  }
  for (const origin of allowedOrigins) {
    if (typeof origin !== "string" || !origin.startsWith("https://")) {
      throw new PublicConfigError("every allowed origin must be an https origin");
    }
  }

  walk(candidate, "config", 1);
  return candidate as unknown as PublicConfig;
}
