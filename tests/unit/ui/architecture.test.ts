import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The architecture compliance checks SESSION-03's Verification section calls
 * for, run as tests rather than as greps someone has to remember.
 */

const UI_ROOT = resolve(process.cwd(), "src/ui") + sep;

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

function sources(): readonly SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push({
          path: path.slice(UI_ROOT.length),
          text: readFileSync(path, "utf8"),
        });
      }
    }
  };
  walk(UI_ROOT);
  return found;
}

const FILES = sources();

/** Layers `src/ui/**` may never reach into (architecture §Dependency Flow). */
const FORBIDDEN_LAYERS = [
  "src/persistence",
  "src/crypto",
  "src/workers",
  "src/sync",
  "src/import",
  "src/export",
  "src/migrations",
] as const;

describe("src/ui dependency direction", () => {
  it("has files to check at all", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_LAYERS)("never imports from %s", (layer) => {
    const offenders = FILES.filter(({ text }) =>
      new RegExp(
        String.raw`from\s+["'][^"']*(?:^|/)${layer.replace("src/", "")}/`,
      ).test(text),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("imports only React, React Aria and its own siblings", () => {
    const packages = new Set<string>();
    for (const { text } of FILES) {
      for (const [, specifier = ""] of text.matchAll(
        /from\s+["']([^"']+)["']/g,
      )) {
        if (!specifier.startsWith(".")) packages.add(specifier);
      }
    }
    expect([...packages].sort()).toEqual(["react", "react-aria-components"]);
  });
});

describe("src/ui forbidden syntax", () => {
  it("never sets HTML from a value", () => {
    const offenders = FILES.filter(({ text }) =>
      text.includes("dangerouslySetInnerHTML"),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("never evaluates authored or imported behaviour", () => {
    const offenders = FILES.filter(({ text }) =>
      /\beval\s*\(|new\s+Function\s*\(/.test(text),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("src/ui styling discipline", () => {
  it("declares no z-index outside the token sheet", () => {
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith(".css")) {
          const relative = path.slice(UI_ROOT.length);
          if (relative === "theme/tokens.css") continue;
          if (/z-index:(?!\s*var\()/.test(readFileSync(path, "utf8"))) {
            offenders.push(relative);
          }
        }
      }
    };
    walk(UI_ROOT);
    expect(offenders).toEqual([]);
  });

  it("keeps cascade layers in the theme, so component modules win by order", () => {
    const layered: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith(".module.css")) {
          if (readFileSync(path, "utf8").includes("@layer")) {
            layered.push(path.slice(UI_ROOT.length));
          }
        }
      }
    };
    walk(UI_ROOT);
    expect(layered).toEqual([]);
  });
});
