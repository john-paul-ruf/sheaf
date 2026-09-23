import type { ReactNode } from "react";
import {
  CHART_TYPE_CHOICES,
  type ChartBuilderVm,
  type ChartDetailVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { Checkbox } from "../primitives/checkbox.js";
import { cx } from "../primitives/class-names.js";
import { SelectField } from "../primitives/select-field.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { TextField } from "../primitives/text-field.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import { formatCount } from "../records/values.js";
import { ChartFigure, ChartScope } from "./chart-figure.js";
import styles from "./charts.module.css";

/**
 * SCR-034 — the chart builder (chart-builder.html; CAP-33, FR-16).
 *
 * "Build a chart by asking a question": a type, a table to start with, what
 * to group by and what to measure — never a query or a join. The groupings
 * include a related table's fields only when the person asks for them, and
 * say which connection Sheaf found to reach them (D54). The preview is the
 * worker's dataset for the definition as it stands (CA-30), with its budget
 * state; nothing here computes a value. Saving asks MOD-013 for the name and
 * the pin decision; leaving an unsaved chart asks MOD-012.
 */

export interface ChartBuilderScreenProps {
  readonly vm: ChartBuilderVm;
  /** The live preview; null until read, or when the choices cannot be drawn. */
  readonly preview: ChartDetailVm | null;
  readonly previewRefused: boolean;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly onChange: (definition: ChartDefinitionWireV1) => void;
  readonly onToggleRelationship: (relationshipId: string, isIncluded: boolean) => void;
  /** Opens MOD-013. */
  readonly onSave: () => void;
  /** Cancel: MOD-012 first, when there is something to lose. */
  readonly onCancel: () => void;
  readonly fullDataHref: string;
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
}

type ChartDefinitionWireV1 = ChartBuilderVm["definition"];
type Grouped = Extract<ChartDefinitionWireV1, { readonly groupBy: unknown }>;

/** The definition as another type: every choice that still fits is kept. */
function withType(vm: ChartBuilderVm, type: ChartDefinitionWireV1["type"]): ChartDefinitionWireV1 {
  const current = vm.definition;
  const common = { name: current.name, tableId: current.tableId, filters: current.filters, pinned: current.pinned };
  if (type === "scatter") {
    const first = vm.numbers[0]?.value ?? "";
    return { ...common, type, x: first, y: vm.numbers[1]?.value ?? first };
  }
  const grouped: Grouped | null = current.type === "scatter" ? null : current;
  const groupBy = grouped?.groupBy ?? vm.groupings[0]?.value;
  if (groupBy === undefined) return current;
  const series =
    type === "stacked" ? (grouped?.seriesBy ?? vm.groupings.find((choice) => choice.key !== vm.selected.groupBy)?.value ?? null) : null;
  return {
    ...common,
    type,
    groupBy,
    seriesBy: series,
    measure: grouped?.measure ?? { kind: "count" },
    sort: grouped?.sort ?? "category",
  };
}

export function ChartBuilderScreen({
  vm,
  preview,
  previewRefused,
  app,
  nav,
  onChange,
  onToggleRelationship,
  onSave,
  onCancel,
  fullDataHref,
  overlays,
  topBarActions,
}: ChartBuilderScreenProps): ReactNode {
  const definition = vm.definition;
  const grouped = definition.type === "scatter" ? null : definition;
  const tableName = vm.tables.find((table) => table.key === definition.tableId)?.label ?? "";

  return (
    <AppFrame app={app} area="charts" nav={nav} title="Chart builder" {...(topBarActions === undefined ? {} : { topBarActions })}>
      <div className={cx(styles["page"])} data-screen="SCR-034">
        <section aria-labelledby="chart-builder-title" className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>{`${app.displayName} · Charts`}</span>
          <h1 className={cx(styles["title"])} id="chart-builder-title">
            Build a chart by asking a question.
          </h1>
          <p className={cx(styles["lede"])}>No queries or joins to write. Choose what to group and what to measure.</p>
          <div className={cx(styles["actions"])}>
            <Button onPress={onCancel}>Cancel</Button>
            {vm.saveBlocker === null ? (
              <Button onPress={onSave} tone="primary">
                {definition.pinned ? "Save & pin" : "Save chart"}
              </Button>
            ) : (
              <Button disabledReason={vm.saveBlocker} isDisabled tone="primary">
                {definition.pinned ? "Save & pin" : "Save chart"}
              </Button>
            )}
          </div>
        </section>

        <div className={cx(styles["builder"])}>
          <section aria-label="Chart settings" className={cx(styles["builderColumn"])}>
            <div className={cx(styles["card"])}>
              <span className={cx(styles["eyebrow"])}>1 · Chart type</span>
              <h2 className={cx(styles["sectionTitle"])}>How should it read?</h2>
              <div className={cx(styles["typeGrid"])}>
                {CHART_TYPE_CHOICES.filter((choice) => choice.hint !== null).map((choice) => {
                  const isBlocked = choice.type === "scatter" && vm.scatterBlocker !== null;
                  return (
                    <button
                      aria-pressed={definition.type === choice.type}
                      className={cx(styles["typeCard"])}
                      data-chart-type={choice.type}
                      disabled={isBlocked}
                      key={choice.type}
                      onClick={() => {
                        onChange(withType(vm, choice.type));
                      }}
                      type="button"
                    >
                      <strong>{choice.label}</strong>
                      <span className={cx(styles["hint"])}>{isBlocked ? vm.scatterBlocker : choice.hint}</span>
                    </button>
                  );
                })}
              </div>
              <button
                aria-pressed={definition.type === "stacked"}
                className={cx(styles["pill"])}
                data-chart-type="stacked"
                onClick={() => {
                  onChange(withType(vm, "stacked"));
                }}
                type="button"
              >
                ＋ Stacked bar
              </button>
            </div>

            <div className={cx(styles["card"])}>
              <span className={cx(styles["eyebrow"])}>2 · Data</span>
              <h2 className={cx(styles["sectionTitle"])}>What do you want to know?</h2>
              <SelectField
                label="Start with"
                onChange={(tableId) => {
                  onChange({ ...definition, tableId });
                }}
                options={vm.tables.map((table) => ({ value: table.key, label: table.label }))}
                value={definition.tableId}
              />
              {grouped === null ? (
                <>
                  <SelectField
                    label="Horizontal axis"
                    onChange={(x) => {
                      onChange({ ...definition, x } as ChartDefinitionWireV1);
                    }}
                    options={vm.numbers.map((choice) => ({ value: choice.key, label: choice.label }))}
                    value={vm.selected.x}
                  />
                  <SelectField
                    label="Vertical axis"
                    onChange={(y) => {
                      onChange({ ...definition, y } as ChartDefinitionWireV1);
                    }}
                    options={vm.numbers.map((choice) => ({ value: choice.key, label: choice.label }))}
                    value={vm.selected.y}
                  />
                </>
              ) : (
                <>
                  <SelectField
                    label="Group by"
                    onChange={(key) => {
                      const choice = vm.groupings.find((candidate) => candidate.key === key);
                      if (choice !== undefined) onChange({ ...grouped, groupBy: choice.value });
                    }}
                    options={vm.groupings.map((choice) => ({ value: choice.key, label: choice.label }))}
                    value={vm.selected.groupBy}
                  />
                  {grouped.type === "stacked" && (
                    <SelectField
                      label="Series"
                      onChange={(key) => {
                        const choice = vm.groupings.find((candidate) => candidate.key === key);
                        if (choice !== undefined) onChange({ ...grouped, seriesBy: choice.value });
                      }}
                      options={vm.groupings.map((choice) => ({ value: choice.key, label: choice.label }))}
                      value={vm.selected.seriesBy}
                    />
                  )}
                  <SelectField
                    label="Measure"
                    onChange={(key) => {
                      const choice = vm.measures.find((candidate) => candidate.key === key);
                      if (choice !== undefined) onChange({ ...grouped, measure: choice.value });
                    }}
                    options={vm.measures.map((choice) => ({ value: choice.key, label: choice.label }))}
                    value={vm.selected.measure}
                  />
                </>
              )}
              {vm.relationships.map((relationship) => (
                <Checkbox
                  isSelected={relationship.isIncluded}
                  key={relationship.relationshipId}
                  onChange={(isIncluded) => {
                    onToggleRelationship(relationship.relationshipId, isIncluded);
                  }}
                >
                  <strong>{`Include related ${relationship.parentName} fields`}</strong>
                  <span className={cx(styles["hint"])}>{relationship.sentence}</span>
                </Checkbox>
              ))}
            </div>
          </section>

          <section aria-label="Chart preview" className={cx(styles["builderColumn"])}>
            <div className={cx(styles["panel"])} data-preview="true">
              <div className={cx(styles["panelHead"])}>
                <div>
                  <span className={cx(styles["eyebrow"])}>Live preview</span>
                  <h2 className={cx(styles["sectionTitle"])}>{definition.name.trim() === "" ? tableName : definition.name}</h2>
                  {preview !== null && preview.scope.kind === "all" && (
                    <p className={cx(styles["lede"])}>{`${formatCount(preview.scope.rows)} local rows · all included`}</p>
                  )}
                </div>
                {preview !== null &&
                  (preview.scope.isPartial ? (
                    <ChartScope fullDataHref={fullDataHref} vm={preview} />
                  ) : (
                    <span className={cx(styles["goodBadge"])}>Within chart budget</span>
                  ))}
              </div>
              {previewRefused ? (
                <StatusBanner title="This chart cannot be drawn from these choices" tone="warning">
                  Choose another grouping or measure.
                </StatusBanner>
              ) : (
                preview !== null && <ChartFigure onSelectMark={() => undefined} selectedMark={null} showMarks={false} vm={preview} />
              )}
            </div>
            <div className={cx(styles["card"])}>
              <TextField
                label="Chart name"
                onChange={(name) => {
                  onChange({ ...definition, name });
                }}
                value={definition.name}
              />
            </div>
            <div className={cx(styles["card"])}>
              <Checkbox
                isSelected={definition.pinned}
                onChange={(pinned) => {
                  onChange({ ...definition, pinned });
                }}
              >
                <strong>Pin to app home</strong>
                <span className={cx(styles["hint"])}>Saving a chart is a user change and will appear in backup status.</span>
              </Checkbox>
            </div>
          </section>
        </div>
      </div>
      {overlays}
    </AppFrame>
  );
}
