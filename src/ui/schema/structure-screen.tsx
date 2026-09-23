import { useState, type ReactNode } from "react";
import type {
  SchemaChangeVm,
  StructureCalculationVm,
  StructureRuleVm,
  StructureTableVm,
  StructureVm,
} from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { TextField } from "../primitives/text-field.js";
import { FieldEditor } from "./field-editor.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import styles from "./schema.module.css";

/**
 * SCR-035 — the app structure editor (schema.html; CAP-35).
 *
 * The tables and the fields of the chosen table on one side, the chosen
 * field's detail beside them from tablet landscape up; below it, the table's
 * rules across fields and its live calculations. What is shown is what the
 * structure read holds and nothing more: a field's type in a person's words,
 * a rule as its sentence, a calculation in the app's own names (D58).
 *
 * Every editor proposes one change and the route previews it (MOD-014): the
 * screen never applies anything, and says nothing is saved until the worker
 * has confirmed the commit (invariant 1).
 */

export interface StructureScreenProps {
  readonly vm: StructureVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly onSelectTable: (tableId: string) => void;
  readonly onSelectField: (fieldId: string) => void;
  /** One D59 change, to be previewed with its counts before anything is applied. */
  readonly onPropose: (change: SchemaChangeVm) => void;
  /** SHT-014 for the chosen field. */
  readonly onOpenFieldActions: () => void;
  readonly onAddRule: () => void;
  readonly onEditRule: (rule: StructureRuleVm) => void;
  /** The live-calculation editor on a computed field's calculation. */
  readonly onEditCalculation?: (calculation: StructureCalculationVm) => void;
  /** A confirmed change's sentence (said after the commit, never before). */
  readonly announcement?: string;
  readonly topBarActions?: ReactNode;
  /** MOD-014 and any sheet the route composed. */
  readonly overlays?: ReactNode;
}

export function StructureScreen({
  vm,
  app,
  nav,
  onSelectTable,
  onSelectField,
  onPropose,
  onOpenFieldActions,
  onAddRule,
  onEditRule,
  onEditCalculation,
  announcement,
  topBarActions,
  overlays,
}: StructureScreenProps): ReactNode {
  const { table, field } = vm;
  return (
    <AppFrame
      app={app}
      area="structure"
      nav={nav}
      title="App structure"
      {...(announcement === undefined ? {} : { announcement })}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["page"])} data-screen="SCR-035">
        <section aria-labelledby="structure-title" className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>{`${vm.appName} · App structure`}</span>
          <h1 className={cx(styles["title"])} id="structure-title">
            Change what the app understands.
          </h1>
          <p className={cx(styles["lede"])}>
            Every import decision remains editable. Existing values are preserved and counted before a risky change.
          </p>
        </section>

        <div className={cx(styles["split"])}>
          <aside aria-label="Tables and fields" className={cx(styles["card"])}>
            <h2 className={cx(styles["listTitle"])} id="structure-tables">
              Tables
            </h2>
            <ul aria-labelledby="structure-tables" className={cx(styles["anchorList"])}>
              {vm.tables.map((row) => (
                <li key={row.tableId}>
                  <button
                    aria-current={row.isSelected}
                    className={cx(styles["anchor"])}
                    data-structure-table={row.tableId}
                    onClick={() => {
                      onSelectTable(row.tableId);
                    }}
                    type="button"
                  >
                    <span className={cx(styles["anchorName"])}>{row.name}</span>
                    <span className={cx(styles["tag"])}>{row.fieldCountLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
            {table !== null && (
              <>
                <hr className={cx(styles["rule"])} />
                <h2 className={cx(styles["listTitle"])} id="structure-fields">
                  {`Fields in ${table.name}`}
                </h2>
                <ul aria-labelledby="structure-fields" className={cx(styles["anchorList"])}>
                  {table.fields.map((row) => (
                    <li key={row.fieldId}>
                      <button
                        aria-current={row.isSelected}
                        className={cx(styles["anchor"])}
                        data-structure-field={row.fieldId}
                        onClick={() => {
                          onSelectField(row.fieldId);
                        }}
                        type="button"
                      >
                        <span className={cx(styles["anchorName"])}>{row.name}</span>
                        <span className={cx(styles["tag"])}>{row.isActive ? row.tag : "Removed"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>

          <div className={cx(styles["stack"])}>
            {field !== null && (
              <FieldEditor
                field={field}
                key={`${field.fieldId}:${String(vm.schemaRevision)}`}
                onOpenActions={onOpenFieldActions}
                onPropose={onPropose}
                tables={vm.tables}
                {...(field.calculation === null || onEditCalculation === undefined
                  ? {}
                  : { onEditCalculation: () => { if (field.calculation !== null) onEditCalculation(field.calculation); } })}
              />
            )}
            {table !== null && (
              <RulesSection onAddRule={onAddRule} onEditRule={onEditRule} onPropose={onPropose} table={table} />
            )}
            {table !== null && <CalculationsSection calculations={[...table.metrics]} title="Table metrics" />}
            {vm.dashboardValues.length > 0 && (
              <CalculationsSection calculations={[...vm.dashboardValues]} title="Dashboard values" />
            )}
            {table !== null && (
              <TableSection key={`${table.tableId}:${String(vm.schemaRevision)}`} onPropose={onPropose} table={table} />
            )}
          </div>
        </div>
      </div>
      {overlays}
    </AppFrame>
  );
}

function Calculation({ calculation }: { readonly calculation: StructureCalculationVm }): ReactNode {
  return (
    <div className={cx(styles["stack"])} data-calculation={calculation.formulaId}>
      <span className={cx(styles["listTitle"])}>In plain language</span>
      <code className={cx(styles["expression"])}>{calculation.text}</code>
    </div>
  );
}

function RulesSection({
  table,
  onAddRule,
  onEditRule,
  onPropose,
}: {
  readonly table: StructureTableVm;
  readonly onAddRule: () => void;
  readonly onEditRule: (rule: StructureRuleVm) => void;
  readonly onPropose: (change: SchemaChangeVm) => void;
}): ReactNode {
  return (
    <section aria-labelledby="rules-title" className={cx(styles["card"])} data-section="rules">
      <div className={cx(styles["head"])}>
        <div className={cx(styles["headText"])}>
          <span className={cx(styles["eyebrow"])}>Rules across fields</span>
          <h2 className={cx(styles["sectionTitle"])} id="rules-title">
            {`A valid ${table.name}`}
          </h2>
        </div>
        <Button onPress={onAddRule}>Add rule</Button>
      </div>
      {table.rules.length === 0 ? (
        <p className={cx(styles["lede"])}>{`No rule compares fields of ${table.name} yet.`}</p>
      ) : (
        <ol className={cx(styles["rows"])}>
          {table.rules.map((rule, index) => (
            <li className={cx(styles["row"])} data-rule={rule.ruleId} key={rule.ruleId}>
              <span aria-hidden="true" className={cx(styles["leading"])}>
                {index + 1}
              </span>
              <span className={cx(styles["rowCopy"])}>
                <strong>{rule.sentence}</strong>
                <span className={cx(styles["hint"])}>{rule.severityNote}</span>
              </span>
              <div className={cx(styles["rowActions"])}>
                {rule.isEditable ? (
                  <Button onPress={() => { onEditRule(rule); }}>{`Edit rule ${String(index + 1)}`}</Button>
                ) : (
                  <Button disabledReason="This rule came from the workbook in a shape this editor does not build; it can be removed." isDisabled>
                    {`Edit rule ${String(index + 1)}`}
                  </Button>
                )}
                <Button onPress={() => { onPropose({ kind: "remove-rule", ruleId: rule.ruleId }); }}>
                  {`Remove rule ${String(index + 1)}`}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The table itself: its name (rename-table). Its key and label are chosen on a field. */
function TableSection({
  table,
  onPropose,
}: {
  readonly table: StructureTableVm;
  readonly onPropose: (change: SchemaChangeVm) => void;
}): ReactNode {
  const [name, setName] = useState(table.name);
  const trimmed = name.normalize("NFC").trim();
  return (
    <section aria-labelledby="table-title" className={cx(styles["card"])} data-section="table">
      <div className={cx(styles["headText"])}>
        <span className={cx(styles["eyebrow"])}>Table</span>
        <h2 className={cx(styles["sectionTitle"])} id="table-title">
          {table.name}
        </h2>
      </div>
      <div className={cx(styles["inlineForm"])}>
        <TextField inputId="structure-table-name" label="Table name" onChange={setName} value={name} />
        {trimmed === "" || trimmed === table.name ? (
          <Button disabledReason={trimmed === "" ? "A name cannot be empty." : "Type a new name first."} isDisabled>
            Rename table
          </Button>
        ) : (
          <Button onPress={() => { onPropose({ kind: "rename-table", tableId: table.tableId, name: trimmed }); }}>
            Rename table
          </Button>
        )}
      </div>
    </section>
  );
}

function CalculationsSection({
  title,
  calculations,
}: {
  readonly title: string;
  readonly calculations: readonly StructureCalculationVm[];
}): ReactNode {
  if (calculations.length === 0) return null;
  return (
    <section aria-label={title} className={cx(styles["card"])}>
      <span className={cx(styles["eyebrow"])}>Live calculation</span>
      <ul className={cx(styles["rows"])}>
        {calculations.map((calculation) => (
          <li className={cx(styles["stack"])} key={calculation.formulaId}>
            <div className={cx(styles["head"])}>
              <h2 className={cx(styles["sectionTitle"])}>{calculation.name}</h2>
              <span className={cx(styles["badge"])}>{calculation.badge}</span>
            </div>
            <Calculation calculation={calculation} />
          </li>
        ))}
      </ul>
    </section>
  );
}
