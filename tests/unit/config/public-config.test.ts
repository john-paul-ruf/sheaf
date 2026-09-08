/**
 * M50: the config that ships in the bundle, and the validator that keeps a
 * secret out of it.
 */

import { describe, expect, it } from "vitest";
import { CURRENT_FORMAT_VERSIONS } from "../../../src/migrations/index.js";
import {
  PUBLIC_CONFIG,
  PublicConfigError,
  validatePublicConfig,
} from "../../../src/config/public-config.js";

const base = {
  formatVersions: CURRENT_FORMAT_VERSIONS,
  providerClientIds: {},
  allowedOrigins: [],
};

describe("PUBLIC_CONFIG", () => {
  it("passes through the migration format versions and redeclares none", () => {
    expect(validatePublicConfig(PUBLIC_CONFIG)).toBe(PUBLIC_CONFIG);
    expect(PUBLIC_CONFIG.formatVersions).toBe(CURRENT_FORMAT_VERSIONS);
    expect(PUBLIC_CONFIG.formatVersions.envelope).toBe(
      CURRENT_FORMAT_VERSIONS.envelope,
    );
  });

  it("declares no provider and no allowed origin in F01", () => {
    expect(Object.keys(PUBLIC_CONFIG.providerClientIds)).toEqual([]);
    expect(PUBLIC_CONFIG.allowedOrigins).toEqual([]);
  });
});

describe("validatePublicConfig", () => {
  it("rejects a version that disagrees with src/migrations", () => {
    expect(() =>
      validatePublicConfig({
        ...base,
        formatVersions: { ...CURRENT_FORMAT_VERSIONS, envelope: 2 },
      }),
    ).toThrow(PublicConfigError);
  });

  it("rejects a secret-shaped name wherever it appears", () => {
    for (const name of [
      "dropboxClientSecret",
      "privateKeyPath",
      "accessToken",
      "apiKey",
      "key",
    ]) {
      expect(() => validatePublicConfig({ ...base, [name]: "value" })).toThrow(
        /shaped like a secret/,
      );
    }

    expect(() =>
      validatePublicConfig({
        ...base,
        providers: { dropbox: { clientId: "abc", refreshToken: "xyz" } },
      }),
    ).toThrow(/shaped like a secret/);
  });

  it("rejects a credential-shaped value under an innocent name", () => {
    for (const value of [
      "Bearer eyJhbGciOiJIUzI1NiJ9",
      "-----BEGIN RSA PRIVATE KEY-----",
      "sk_live_0123456789abcdef",
      "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    ]) {
      expect(() => validatePublicConfig({ ...base, label: value })).toThrow(
        /shaped like a credential/,
      );
    }
  });

  it("accepts an ordinary provider client id and https origin", () => {
    expect(() =>
      validatePublicConfig({
        ...base,
        providerClientIds: { dropbox: "a1b2c3d4e5" },
        allowedOrigins: ["https://api.dropboxapi.com"],
      }),
    ).not.toThrow();
  });

  it("rejects a malformed shape rather than shipping it", () => {
    expect(() => validatePublicConfig(null)).toThrow(PublicConfigError);
    expect(() => validatePublicConfig({ formatVersions: CURRENT_FORMAT_VERSIONS })).toThrow(
      /providerClientIds/,
    );
    expect(() =>
      validatePublicConfig({ ...base, allowedOrigins: ["http://example.test"] }),
    ).toThrow(/https/);
    expect(() =>
      validatePublicConfig({ ...base, providerClientIds: { dropbox: "" } }),
    ).toThrow(/non-empty/);
  });
});
