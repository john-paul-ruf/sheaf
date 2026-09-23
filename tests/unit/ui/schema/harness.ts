import { vi } from "vitest";
import type { SchemaServices } from "../../../../src/application/workflows/schema-services.js";
import type { AppAreaWiring } from "../../../../src/routes/app-area-hooks.js";
import type {
  AppSessionViewV1,
  ApplySchemaChangeResponseV1,
  PreviewSchemaChangeResponseV1,
  SchemaApplyOutcomeV1,
  SchemaPreviewViewV1,
} from "../../../../src/workers/protocol/messages.js";
import { interact, query, queryAll } from "../render.js";
import { APP_ID, identity, nav, structure } from "./fixtures.js";

/**
 * The structure routes over a fake `SchemaServices` (S06 CP2/CP3): each
 * preview and apply answers what the test says, and every request is kept so
 * the test can assert exactly what was sent — the previewed revision included.
 */

export function fakeSchema(input: {
  readonly previews?: readonly SchemaPreviewViewV1[];
  readonly outcomes?: readonly SchemaApplyOutcomeV1[];
} = {}) {
  const previews = [...(input.previews ?? [])];
  const outcomes = [...(input.outcomes ?? [])];
  const services: SchemaServices = {
    getAppStructure: vi.fn(() => Promise.resolve({ kind: "getAppStructure" as const, structure: structure() })),
    previewSchemaChange: vi.fn(() =>
      Promise.resolve<PreviewSchemaChangeResponseV1>({ kind: "previewSchemaChange", preview: previews.shift() ?? null }),
    ),
    applySchemaChange: vi.fn(() =>
      Promise.resolve<ApplySchemaChangeResponseV1>({
        kind: "applySchemaChange",
        outcome: outcomes.shift() ?? { result: "unknown-app" },
      }),
    ),
  };
  return services;
}

export function appliedOutcome(fieldIds: readonly string[] = []): SchemaApplyOutcomeV1 {
  return {
    result: "applied",
    commitId: "commit-1",
    headRevision: 9,
    schemaRevision: 5,
    impact: {
      change: "rename-field",
      total: 5,
      affected: 0,
      unchanged: 5,
      converted: 0,
      keptAndFlagged: 0,
      missingNow: 0,
      onRemovedOptions: 0,
      matchedKeys: 0,
      unmatchedKeys: 0,
      unlinkedReferences: 0,
      failingRule: 0,
      formulaErrors: 0,
    },
    recalculated: { fieldIds },
  };
}

export function session(): AppSessionViewV1 {
  return {
    appId: APP_ID,
    displayName: "Field Log",
    theme: identity.theme,
    schemaRevision: 4,
    createdAtEpochMs: 0,
    lastOpenedAtEpochMs: null,
    isScratch: true,
    deviceOnlyChangeCount: 3,
    tables: [],
  };
}

export function wiring(schema: SchemaServices, overrides: Partial<AppAreaWiring> = {}): AppAreaWiring {
  return {
    identity,
    nav,
    records: {} as AppAreaWiring["records"],
    charts: {} as AppAreaWiring["charts"],
    schema,
    session: session(),
    topBarActions: null,
    announce: vi.fn(),
    refresh: vi.fn(),
    structure: null,
    recalculated: new Set(),
    ...overrides,
  };
}

/** React Aria's Select keeps a hidden native select; this is the one under `label`. */
export async function choose(label: string, value: string): Promise<void> {
  const select = queryAll("label, span")
    .filter((candidate) => candidate.textContent === label)
    .map((candidate) => candidate.parentElement?.querySelector("select") ?? undefined)
    .find((candidate) => candidate !== undefined);
  if (select === undefined) throw new Error(`No select labelled ${label}`);
  await interact(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>("button").find((candidate) => candidate.textContent === name);
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
}

export async function press(name: string): Promise<void> {
  const target = button(name);
  await interact(() => {
    target.focus();
    target.click();
  });
}

export function dialog(): HTMLElement {
  return query('[role="dialog"], [role="alertdialog"]');
}
