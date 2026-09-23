import type { ReactNode } from "react";
import type {
  StructureCalculationVm,
  StructureFieldVm,
  StructureTableVm,
  StructureVm,
} from "../../application/view-models/schema.js";
import { cx } from "../primitives/class-names.js";
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
 */

export interface StructureScreenProps {
  readonly vm: StructureVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly onSelectTable: (tableId: string) => void;
  readonly onSelectField: (fieldId: string) => void;
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
            {field !== null && <FieldDetail field={field} />}
            {table !== null && <RulesSection table={table} />}
            {table !== null && <CalculationsSection calculations={[...table.metrics]} title="Table metrics" />}
            {vm.dashboardValues.length > 0 && (
              <CalculationsSection calculations={[...vm.dashboardValues]} title="Dashboard values" />
            )}
          </div>
        </div>
      </div>
      {overlays}
    </AppFrame>
  );
}

function FieldDetail({ field }: { readonly field: StructureFieldVm }): ReactNode {
  return (
    <section aria-labelledby="field-title" className={cx(styles["panel"])} data-structure-detail={field.fieldId}>
      <div className={cx(styles["head"])}>
        <div className={cx(styles["headText"])}>
          <span className={cx(styles["eyebrow"])}>{field.position}</span>
          <h2 className={cx(styles["sectionTitle"])} id="field-title">
            {field.name}
          </h2>
        </div>
        {field.calculation !== null && <span className={cx(styles["badge"])}>{field.calculation.badge}</span>}
      </div>
      <dl className={cx(styles["facts"])}>
        <dt>What kind of information?</dt>
        <dd>{field.typeLabel}</dd>
        <dt>Required</dt>
        <dd>{field.isRequired ? "Every record needs a value" : "A record may leave it empty"}</dd>
        {(field.isKey || field.isLabel) && (
          <>
            <dt>Role in the table</dt>
            <dd>
              {[field.isKey ? "Key: what other tables connect to" : null, field.isLabel ? "Label: what a record is called" : null]
                .filter((part) => part !== null)
                .join(" · ")}
            </dd>
          </>
        )}
        {field.connection !== null && (
          <>
            <dt>Connects to</dt>
            <dd>{field.connection.isActive ? field.connection.toTableName : `${field.connection.toTableName} (turned off)`}</dd>
          </>
        )}
        {!field.isActive && (
          <>
            <dt>Removed</dt>
            <dd>Records keep this field&apos;s values; it is no longer shown or asked for.</dd>
          </>
        )}
      </dl>
      {field.options.length > 0 && (
        <div className={cx(styles["stack"])}>
          <span className={cx(styles["listTitle"])}>Choices</span>
          <ol className={cx(styles["rows"])}>
            {field.options.map((option, index) => (
              <li className={cx(styles["row"])} data-option={option.optionId} key={option.optionId}>
                <span aria-hidden="true" className={cx(styles["leading"])}>
                  {index + 1}
                </span>
                <span className={cx(styles["rowCopy"])}>
                  <strong>{option.label}</strong>
                  {!option.isActive && <span className={cx(styles["hint"])}>Removed · records that hold it are flagged</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {field.calculation !== null && <Calculation calculation={field.calculation} />}
      {field.connection?.evidence != null && (
        <div className={cx(styles["notice"])}>
          <strong>Why Sheaf chose this</strong>
          <span>{field.connection.evidence}</span>
        </div>
      )}
    </section>
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

function RulesSection({ table }: { readonly table: StructureTableVm }): ReactNode {
  return (
    <section aria-labelledby="rules-title" className={cx(styles["card"])} data-section="rules">
      <div className={cx(styles["headText"])}>
        <span className={cx(styles["eyebrow"])}>Rules across fields</span>
        <h2 className={cx(styles["sectionTitle"])} id="rules-title">
          {`A valid ${table.name}`}
        </h2>
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
            </li>
          ))}
        </ol>
      )}
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
