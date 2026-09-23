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
    expect(packageViolations(FILES)).toEqual([]);
  });

  it("fails when Chart.js is imported anywhere but the one canvas file", () => {
    // Negative controls: the rule fires on the shapes it exists for.
    const elsewhere = { path: "records/app-home-screen.tsx", text: 'import { Chart } from "chart.js";' };
    const subpath = { path: "charts/chart-detail-screen.tsx", text: 'import { BarController } from "chart.js/auto";' };
    const stray = { path: CHART_CANVAS, text: 'import { format } from "date-fns";' };
    expect(packageViolations([...FILES, elsewhere])).toEqual(["records/app-home-screen.tsx imports chart.js"]);
    expect(packageViolations([subpath])).toEqual(["charts/chart-detail-screen.tsx imports chart.js/auto"]);
    expect(packageViolations([stray])).toEqual([`${CHART_CANVAS} imports date-fns`]);
    // The canvas itself may, and nothing else changes for it.
    expect(packageViolations([{ path: CHART_CANVAS, text: 'import { Chart } from "chart.js";' }])).toEqual([]);
  });
});

/**
 * M45's boundary: Chart.js owns drawing and hit-testing only, and exactly one
 * file may reach it (architecture § Charts). Every other UI file imports
 * React, React Aria and its siblings, and nothing else.
 */
const CHART_CANVAS = "charts/chart-canvas.tsx";
const UI_PACKAGES: readonly string[] = ["react", "react-aria-components"];

function packageViolations(files: readonly SourceFile[]): readonly string[] {
  const violations: string[] = [];
  for (const { path, text } of files) {
    const allowed = path === CHART_CANVAS ? [...UI_PACKAGES, "chart.js"] : UI_PACKAGES;
    for (const [, specifier = ""] of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (!specifier.startsWith(".") && !allowed.includes(specifier)) {
        violations.push(`${path} imports ${specifier}`);
      }
    }
  }
  return violations;
}

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
