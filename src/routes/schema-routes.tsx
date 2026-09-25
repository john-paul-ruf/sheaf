/**
 * The structure column's routes (M54; CA-07 amendment 4, D63; CAP-35/36).
 *
 * Kept beside the route table, like the chart and snapshot routes. The
 * structure is read from the worker on arrival and again whenever the app
 * re-reads (`session` changes after a confirmed write), so a screen never
 * shows a schema from before the change it just applied.
 *
 * **One path for every change (CA-28).** An editor proposes a D59 change; it
 * is previewed and MOD-014 shows the exact counts; "Apply" names the
 * revision that preview counted at. If the app moved in between, the worker
 * answers `stale-preview` and nothing was committed — so the change is
 * previewed again and the new counts are shown, never applied blindly. Only
 * an `applied` outcome is announced, after the commit (invariant 1).
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import { announceRecalculated } from "../application/view-models/records.js";
import {
  describeApplyFailure,
  describeFormulaError,
  formulaChangeFor,
  ruleFieldChoices,
  ruleSentence,
  selectAppSettingsVm,
  selectImpactVm,
  selectStructureVm,
  selectUnsupportedFormulaVm,
  type StructureCalculationVm,
  type StructureRuleVm,
  type StructureSelection,
} from "../application/view-models/schema.js";
import { describeThemeSummary } from "../application/view-models/theme.js";
import type {
  AppStructureViewV1,
  SchemaChangeWireV1,
  SchemaPreviewViewV1,
  SheetSnapshotViewV1,
} from "../workers/protocol/messages.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { AppSettingsScreen } from "../ui/schema/app-settings-screen.js";
import { StatusBanner } from "../ui/primitives/status-banner.js";
import { FIELD_FOCUS } from "../ui/schema/field-editor.js";
import { FieldActionsSheet, type FieldActionV1 } from "../ui/schema/field-actions-sheet.js";
import { FormulaEditorDialog } from "../ui/schema/formula-editor.js";
import { ImpactDialog } from "../ui/schema/impact-dialog.js";
import { RuleEditorDialog } from "../ui/schema/rule-editor.js";
import { StructureScreen } from "../ui/schema/structure-screen.js";
import { UnsupportedFormulaDialog } from "../ui/schema/unsupported-formula-dialog.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { appPath, appThemePath, hashHref, structurePath } from "./guards.js";
import { glyphOf, usePalettes } from "./theme-routes.js";

type StructureState =
  | { readonly kind: "reading" }
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly structure: AppStructureViewV1 };

/** The app's structure, re-read after every confirmed write. */
function useStructure(area: AppAreaWiring): StructureState {
  const { schema, identity, session } = area;
  const appId = identity.appId;
  const [state, setState] = useState<StructureState>({ kind: "reading" });
  useEffect(() => {
    let live = true;
    void schema.getAppStructure({ appId }).then(
      ({ structure }) => {
        if (live) setState(structure === null ? { kind: "absent" } : { kind: "read", structure });
      },
      () => {
        if (live) setState({ kind: "absent" });
      },
    );
    return () => {
      live = false;
    };
  }, [schema, appId, session]);
  return state;
}

/** A change on its way through MOD-014. */
interface PendingChange {
  readonly change: SchemaChangeWireV1;
  readonly preview: SchemaPreviewViewV1;
  /** The app moved since the last preview; these are the new counts. */
  readonly wasStale: boolean;
  readonly busy: boolean;
  readonly failure: string | null;
}

/**
 * Preview → MOD-014 → apply (CA-28). `onPreviewRefused` lets an editor keep a
 * refusal it can show better itself (the formula editor's error position).
 */
export function useSchemaChange(area: AppAreaWiring): {
  readonly pending: PendingChange | null;
  readonly propose: (change: SchemaChangeWireV1) => Promise<SchemaPreviewViewV1 | null>;
  /** Counts a change without opening MOD-014, for an editor that shows its own refusal. */
  readonly preview: (change: SchemaChangeWireV1) => Promise<SchemaPreviewViewV1 | null>;
  readonly show: (change: SchemaChangeWireV1, preview: SchemaPreviewViewV1) => void;
  readonly apply: () => void;
  readonly cancel: () => void;
  /** Set when a preview could not be read at all. */
  readonly failure: string | null;
} {
  const { schema, identity } = area;
  const appId = identity.appId;
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const readPreview = useCallback(
    async (change: SchemaChangeWireV1): Promise<SchemaPreviewViewV1 | null> => {
      setFailure(null);
      try {
        const { preview } = await schema.previewSchemaChange({ appId, change });
        if (preview === null) setFailure("This app is no longer on this device, so nothing was previewed.");
        return preview;
      } catch {
        setFailure("This change could not be counted on this device, so nothing was changed.");
        return null;
      }
    },
    [schema, appId],
  );

  const show = useCallback((change: SchemaChangeWireV1, preview: SchemaPreviewViewV1) => {
    setPending({ change, preview, wasStale: false, busy: false, failure: null });
  }, []);

  const propose = useCallback(
    async (change: SchemaChangeWireV1) => {
      const preview = await readPreview(change);
      if (preview !== null) show(change, preview);
      return preview;
    },
    [readPreview, show],
  );

  const apply = useCallback(() => {
    if (pending === null) return;
    const { change, preview } = pending;
    setPending({ ...pending, busy: true, failure: null });
    void schema.applySchemaChange({ appId, change, previewedSchemaRevision: preview.schemaRevision }).then(
      async ({ outcome }) => {
        switch (outcome.result) {
          case "applied": {
            setPending(null);
            const recalculated = announceRecalculated(outcome.recalculated.fieldIds, area.session.tables.flatMap((table) => table.fields));
            area.announce(["Saved on this device.", recalculated].filter((part) => part !== "").join(" "), outcome.recalculated.fieldIds);
            area.refresh();
            return;
          }
          case "unchanged":
            setPending(null);
            area.announce("No changes to save.");
            return;
          case "stale-preview": {
            // Nothing was committed. Count again, and show the counts as they are now.
            const next = await readPreview(change);
            setPending(next === null ? null : { change, preview: next, wasStale: true, busy: false, failure: null });
            return;
          }
          default:
            setPending({ ...pending, busy: false, failure: describeApplyFailure(outcome) });
        }
      },
      () => {
        setPending({ ...pending, busy: false, failure: "This change could not be applied on this device, so nothing was changed." });
      },
    );
  }, [pending, schema, appId, area, readPreview]);

  const cancel = useCallback(() => {
    setPending(null);
  }, []);

  return { pending, propose, preview: readPreview, show, apply, cancel, failure };
}

type Overlay =
  | { readonly kind: "none" }
  | { readonly kind: "field-actions" }
  | { readonly kind: "rule"; readonly rule?: StructureRuleVm }
  /** The live-calculation editor; MOD-015 when the calculation is unsupported. */
  | {
      readonly kind: "formula" | "rewrite";
      readonly calculation?: StructureCalculationVm;
      readonly error?: string;
      readonly busy?: boolean;
    };

const FOCUS_FOR: Partial<Record<FieldActionV1, string>> = {
  rename: FIELD_FOCUS.name,
  "change-type": FIELD_FOCUS.type,
  connection: FIELD_FOCUS.connection,
  calculation: FIELD_FOCUS.calculation,
  "rename-table": "structure-table-name",
};

/** SCR-035 at `#/app/{id}/structure`. */
export function StructureRoute({
  area,
  notice,
  clearNotice,
}: {
  readonly area: AppAreaWiring;
  /** A confirmed change's sentence, said once on arrival. */
  readonly notice?: string;
  readonly clearNotice: () => void;
}): ReactNode {
  const { identity, nav, topBarActions } = area;
  const state = useStructure(area);
  const [selection, setSelection] = useState<StructureSelection>({ tableId: null, fieldId: null });
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const changes = useSchemaChange(area);
  // Said once: leaving the structure forgets the sentence.
  useEffect(() => clearNotice, [clearNotice]);

  if (state.kind === "reading") {
    return <BusyIndicator cancellation="unavailable" label="Reading this app's structure on this device." />;
  }
  if (state.kind === "absent") {
    // The app is open and its structure is not readable; its home is what is true.
    return <Navigate replace to={appPath(identity.appId)} />;
  }
  const { structure } = state;
  const vm = selectStructureVm(structure, selection);
  const propose = (change: SchemaChangeWireV1): void => {
    void changes.propose(change);
  };
  /**
   * A calculation is counted with its editor still open: a parse or name
   * error belongs beside the text, at the position S03 reports (D58), and
   * only a translatable calculation goes on to MOD-014.
   */
  const proposeFormula = (change: SchemaChangeWireV1): void => {
    if (overlay.kind !== "formula" && overlay.kind !== "rewrite") return;
    const editing = overlay;
    setOverlay({ ...editing, busy: true });
    void changes.preview(change).then((counted) => {
      if (counted?.refusal?.kind === "formula") {
        setOverlay({ ...editing, busy: false, error: describeFormulaError(counted.refusal) });
        return;
      }
      setOverlay({ kind: "none" });
      if (counted !== null) changes.show(change, counted);
    });
  };
  const editCalculation = (calculation: StructureCalculationVm): void => {
    setOverlay({ kind: calculation.disposition === "unsupported" ? "rewrite" : "formula", calculation });
  };

  return (
    <StructureScreen
      app={identity}
      nav={nav}
      onAddCalculation={() => {
        setOverlay({ kind: "formula" });
      }}
      onAddRule={() => {
        setOverlay({ kind: "rule" });
      }}
      onEditCalculation={editCalculation}
      onEditRule={(rule) => {
        setOverlay({ kind: "rule", rule });
      }}
      onOpenFieldActions={() => {
        setOverlay({ kind: "field-actions" });
      }}
      onPropose={propose}
      onSelectField={(fieldId) => {
        setSelection({ tableId: vm.table?.tableId ?? null, fieldId });
      }}
      onSelectTable={(tableId) => {
        setSelection({ tableId, fieldId: null });
      }}
      overlays={
        <>
          {changes.failure !== null && <StatusBanner title={changes.failure} tone="danger" />}
          {overlay.kind === "field-actions" && vm.field !== null && vm.table !== null && (
            <FieldActionsSheet
              fieldName={vm.field.name}
              isActive={vm.field.isActive}
              isComputed={vm.field.calculation !== null}
              onChoose={(action) => {
                setOverlay({ kind: "none" });
                const field = vm.field;
                if (field === null) return;
                if (action === "remove") {
                  propose(
                    field.calculation === null
                      ? { kind: "deactivate-field", fieldId: field.fieldId }
                      : { kind: "remove-formula", formulaId: field.calculation.formulaId },
                  );
                  return;
                }
                if (action === "restore") {
                  propose({ kind: "reactivate-field", fieldId: field.fieldId });
                  return;
                }
                if (action === "calculation" && field.calculation !== null) {
                  editCalculation(field.calculation);
                  return;
                }
                // The sheet closes first; its editor takes focus on the next frame.
                const target = FOCUS_FOR[action];
                if (target !== undefined) requestAnimationFrame(() => document.getElementById(target)?.focus());
              }}
              onClose={() => {
                setOverlay({ kind: "none" });
              }}
              tableName={vm.table.name}
            />
          )}
          {overlay.kind === "rule" && vm.table !== null && (
            <RuleEditorDialog
              describe={(condition) => ruleSentence(structure, condition)}
              fields={ruleFieldChoices(structure, vm.table.tableId)}
              onCancel={() => {
                setOverlay({ kind: "none" });
              }}
              onPreview={(draft) => {
                const tableId = vm.table?.tableId;
                if (tableId === undefined) return;
                setOverlay({ kind: "none" });
                propose({
                  kind: "save-rule",
                  ruleId: overlay.rule?.ruleId ?? null,
                  tableId,
                  displayName: draft.displayName,
                  condition: draft.condition,
                  severity: draft.severity,
                });
              }}
              tableName={vm.table.name}
              {...(overlay.rule === undefined ? {} : { rule: overlay.rule })}
            />
          )}
          {overlay.kind === "formula" && vm.table !== null && (
            <FormulaEditorDialog
              busy={overlay.busy === true}
              onCancel={() => {
                setOverlay({ kind: "none" });
              }}
              onPreview={(draft) => {
                const tableId = vm.table?.tableId;
                if (tableId === undefined) return;
                proposeFormula(formulaChangeFor({ tableId, calculation: overlay.calculation ?? null, ...draft }));
              }}
              tableName={vm.table.name}
              {...(overlay.calculation === undefined ? {} : { calculation: overlay.calculation })}
              {...(overlay.error === undefined ? {} : { error: overlay.error })}
            />
          )}
          {overlay.kind === "rewrite" && overlay.calculation !== undefined && (
            <UnsupportedFormulaDialog
              busy={overlay.busy === true}
              onCancel={() => {
                setOverlay({ kind: "none" });
              }}
              onPreview={(text) => {
                const calculation = overlay.calculation;
                if (calculation === undefined) return;
                proposeFormula(
                  formulaChangeFor({
                    tableId: calculation.tableId ?? "",
                    calculation,
                    target: calculation.target,
                    name: calculation.name,
                    type: "number",
                    text,
                  }),
                );
              }}
              vm={selectUnsupportedFormulaVm(overlay.calculation)}
              {...(overlay.error === undefined ? {} : { error: overlay.error })}
            />
          )}
          {changes.pending !== null && (
            <ImpactDialog
              busy={changes.pending.busy}
              onApply={changes.apply}
              onCancel={changes.cancel}
              vm={selectImpactVm({
                change: changes.pending.change,
                preview: changes.pending.preview,
                structure,
                wasStale: changes.pending.wasStale,
              })}
              {...(changes.pending.failure === null ? {} : { failure: changes.pending.failure })}
            />
          )}
        </>
      }
      topBarActions={topBarActions}
      vm={vm}
      {...(notice === undefined ? {} : { announcement: notice })}
    />
  );
}

/**
 * SCR-037 at `#/app/{id}/settings`: the facts it states are read, not
 * assumed — the structure's counts from its read, the snapshots' from theirs,
 * durability from the open session — and a row whose fact has not arrived
 * says nothing rather than a guess. Renaming the app is a structure change
 * (`rename-app`), previewed in MOD-014 like every other.
 */
export function AppSettingsRoute({
  area,
  notice,
  clearNotice,
}: {
  readonly area: AppAreaWiring;
  readonly notice?: string;
  readonly clearNotice: () => void;
}): ReactNode {
  const { identity, nav, records, session, theme, topBarActions } = area;
  const appId = identity.appId;
  const state = useStructure(area);
  const palettes = usePalettes(theme);
  const changes = useSchemaChange(area);
  const [sheets, setSheets] = useState<readonly SheetSnapshotViewV1[] | null>(null);
  useEffect(() => clearNotice, [clearNotice]);
  useEffect(() => {
    let live = true;
    void records.listSheetSnapshots({ appId }).then(
      (answered) => {
        if (live) setSheets(answered.sheets);
      },
      () => {
        if (live) setSheets(null);
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId, session]);

  const structure = state.kind === "read" ? state.structure : null;
  const vm = selectAppSettingsVm({
    appId,
    appName: session.displayName,
    isScratch: session.isScratch,
    deviceOnlyChangeCount: session.deviceOnlyChangeCount,
    structure,
    sheets,
  });
  return (
    <AppSettingsScreen
      app={identity}
      appearance={{
        href: hashHref(appThemePath(appId)),
        summary: palettes === null ? null : describeThemeSummary(session.theme, palettes),
        glyph: glyphOf(session),
      }}
      key={session.displayName}
      nav={nav}
      onRename={(name) => {
        void changes.propose({ kind: "rename-app", name });
      }}
      overlays={
        <>
          {changes.failure !== null && <StatusBanner title={changes.failure} tone="danger" />}
          {changes.pending !== null && structure !== null && (
            <ImpactDialog
              busy={changes.pending.busy}
              onApply={changes.apply}
              onCancel={changes.cancel}
              vm={selectImpactVm({
                change: changes.pending.change,
                preview: changes.pending.preview,
                structure,
                wasStale: changes.pending.wasStale,
              })}
              {...(changes.pending.failure === null ? {} : { failure: changes.pending.failure })}
            />
          )}
        </>
      }
      structureHref={hashHref(structurePath(appId))}
      topBarActions={topBarActions}
      vm={vm}
      {...(notice === undefined ? {} : { announcement: notice })}
    />
  );
}
