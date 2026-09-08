import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT_VERSIONS,
  planMigrations,
  type ObservedFormatVersions,
} from "../../src/migrations/index.js";

const DOMAINS = Object.keys(
  CURRENT_FORMAT_VERSIONS,
) as (keyof ObservedFormatVersions)[];

/** The jsdom project runs this file a second time; node has no `document`. */
const hasDom = typeof document !== "undefined";

describe("format versions (CA-06)", () => {
  it("exposes one source of truth, all at version 1", () => {
    expect(DOMAINS).toHaveLength(9);
    for (const domain of DOMAINS) {
      expect(CURRENT_FORMAT_VERSIONS[domain]).toBe(1);
    }
  });

  it("plans a migration for exactly the domains that are behind", () => {
    fc.assert(
      fc.property(fc.subarray(DOMAINS), (behind) => {
        const observed = Object.fromEntries(
          DOMAINS.map((domain) => [
            domain,
            behind.includes(domain) ? 0 : CURRENT_FORMAT_VERSIONS[domain],
          ]),
        ) as unknown as ObservedFormatVersions;

        const planned = planMigrations(observed)
          .steps.map((step) => step.domain)
          .sort();

        expect(planned).toEqual([...behind].sort());
      }),
    );
  });
});

describe("runner environments", () => {
  it.runIf(!hasDom)("runs tests/unit/** on the node environment", () => {
    expect(typeof document).toBe("undefined");
    expect(process.versions.node.split(".")[0]).toBe("24");
  });

  it.runIf(hasDom)(
    "runs the jsdom project with CSS Modules resolved",
    async () => {
      expect(document.createElement("div").tagName).toBe("DIV");

      const styles = (await import("../browser/fixtures/smoke.module.css"))
        .default;
      expect(styles["hitTarget"]).toBeTypeOf("string");
      expect(styles["hitTarget"]).not.toBe("");
    },
  );
});
