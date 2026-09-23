# M03 — Formulas (`src/domain/formulas/`)

> Seeded by Planner for F03 (workbook-fidelity) as a parser/reference-extraction
> subset only (D34); grown to the full engine by F04 (formulas-queries-charts).
> Reconciled against the tree at `5bc19fb` (F04 final).

## Contract

- **Owns (whole module, landed F04):** Parser, stable-reference IR, function
  catalog, dependency graph, evaluator, renderer. No `eval`, no dynamic
  `Function`.
- **Depends on:** M01 only. M03 imports nothing else in the repository and no
  third-party package.
- **Contract:** Bounded by construction: formula text ≤ 8,192 characters (the
  Excel limit), nesting depth ≤ 64 at parse time — beyond either the result is
  `unparsed{reason}`, never a partial tree. Evaluation is bounded by
  `DEFAULT_EVALUATION_BUDGET` node visits and `MAX_EVALUATION_DEPTH`, past
  which the result is `#BUDGET`, never a partial value. Parsing performs no
  evaluation and resolves no reference against data; the IR is a stable-ID
  document, and rendering it back with current field names is exact.

## Landed surface

Files: `ast.ts`, `lexer.ts`, `parser.ts`, `references.ts`, `lookups.ts`, `ir.ts`,
`catalog.ts`, `translate.ts`, `render.ts`, `decimal.ts`, `calendar.ts`,
`scalars.ts`, `builtins.ts`, `evaluate.ts`, `graph.ts`, `disposition.ts`,
`index.ts` (barrel; `decimal`/`calendar`/`scalars`/`builtins` stay internal).

### Parser (F03, unchanged in shape by F04)

- `parseFormula(text) → FormulaParseResultV1` — total: `parsed{ast}` |
  `unparsed{reason: "too-long"|"too-deep"|"syntax"|"unsupported-token"}`;
  never throws, never a partial tree. Leading `=` optional.
  `FORMULA_MAX_LENGTH = 8192` (text), `FORMULA_MAX_DEPTH = 64` (groups, calls,
  arrays, unary chains).
- `FormulaAstV1`: `number{text}` (as authored, never a float) · `string` ·
  `boolean` · `error{code}` · `array{rows}` · `reference{reference}` ·
  `unary{+|-}` · `percent` · `binary{operator}` (`BINARY_OPERATORS`: `:` ` `
  `,` `^` `*` `/` `+` `-` `&` `=` `<>` `<` `<=` `>` `>=`) · `group` (parens
  kept) · `call{name (upper-cased, prefix stripped), prefix ("_xlfn." etc. or
  null), args (null = omitted)}`.
- `FormulaReferenceV1`: `cell` · `area` · `columns` (A:B) · `rows` (1:3) ·
  `structured{table|null, specifiers, firstColumn, lastColumn, isThisRow}` ·
  `name{scope, name}`; `SheetScopeV1{workbook (external token or null),
  firstSheet, lastSheet (3-D)}`.
- Precedence (low→high): union `,` (only inside parentheses — a deliberate
  deviation from Excel's table that no in-paren formula can observe),
  comparisons, `&`, `+ -`, `* /`, `^`, `%`, unary, space intersection, `:`.
  Left-associative.
- `extractReferences(ast)` (reading order), `findLookups(ast) →
  LookupV1{functionName: VLOOKUP|HLOOKUP|XLOOKUP|LOOKUP|INDEX-MATCH,
  keyReferences, lookupRange: LookupRangeV1 (columns | table-columns | name |
  other), returnIndex}`; `INDEX(r, MATCH(k, kr, 0))` only with a literal 0.
  `lookupRangeOf(ast)`, `columnLettersOf`, `columnNumberOf`.
- **Known limit:** M03 refuses `[1]!Name` (external-workbook defined names) as
  `unsupported-token` at parse time; F04's translator (below) also refuses it
  as `external-source` after translation, so an external reference is never
  resolved or fetched at either stage (invariant 12).

### IR, catalog, translation, evaluation (F04, SESSION-01)

- **IR (`ir.ts`, CA-25):** `FormulaIRDocumentV1 {irVersion: 1, root}`;
  `FormulaIRV1` = `literal{value: text|decimal|boolean}` · `error{code:
  FormulaErrorLiteralV1}` · `field{fieldId}` (this row) · `column{tableId,
  fieldId}` · `related{relationshipId, referenceFieldId, fieldId}` ·
  `formula{formulaId}` · `unary{+|-|%}` · `binary{IrBinaryOperatorV1}` ·
  `call{name, version, args}`. Stable IDs only. `related` carries
  `referenceFieldId` (beyond the originally suggested shape) so dependencies
  derive from the IR alone. Constants pinned to migration 005:
  `FORMULA_TARGET_KINDS`, `FORMULA_DISPOSITIONS`, `FORMULA_DETERMINISMS`,
  `FORMULA_DEPENDENCY_KINDS`. `FormulaTargetV1`, `FormulaDependencyV1`,
  `FormulaDefinitionV1` (target, displayName, originalText, document|null,
  disposition, determinism, dependencies — never a value),
  `FORMULA_ERROR_CODES` (Excel's seven + `#BUDGET`), `dependenciesOf(document)`,
  `irNodesOf(root)`.
- **Catalog (`catalog.ts`, D49, closed and versioned):** `CATALOG_FUNCTION_NAMES`
  (exactly 68 names — `+ - * / ^ & = <> < <= > >=` plus `SUM AVERAGE MIN MAX
  COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS SUMIF SUMIFS AVERAGEIF IF IFS
  IFERROR IFNA AND OR NOT XOR ROUND ROUNDUP ROUNDDOWN ABS INT MOD POWER SQRT
  CEILING FLOOR TODAY NOW DATE YEAR MONTH DAY WEEKDAY EDATE EOMONTH DATEDIF
  DAYS LEN LEFT RIGHT MID UPPER LOWER PROPER TRIM CONCAT CONCATENATE TEXTJOIN
  SUBSTITUTE FIND SEARCH VALUE TEXT ISBLANK ISNUMBER ISTEXT ISERROR RAND
  RANDBETWEEN VLOOKUP HLOOKUP XLOOKUP INDEX MATCH`), `FUNCTION_CATALOG_V1`
  entries `{name, version: 1, minArgs, maxArgs, coercion, determinism:
  deterministic|clock-volatile|nondeterministic, cost: scalar|aggregate|
  lookup}`, `CATALOG_VERSION = 1`, `catalogEntryOf(name)`. Anything outside the
  catalog is `unsupported`.
- **Translate (`translate.ts`):** `translateImported(ast, ImportResolverV1) →
  TranslationV1` (`translated{document, dependencies}` | `unsupported{reason:
  ImportUnsupportedReasonV1, detail}`; 15 closed reasons including
  `external-source` for `[1]!Name`); `translateImportedText(text, resolver)`
  (parses first); `translateAuthored(text, AuthoredResolverV1) →
  AuthoredTranslationV1` (`translated` | `unknown-name{name}` |
  `refused{reason, detail}`); `relativeShapeKey(ast, anchorRow,
  anchorColumn)` (detects filled-down formulas). Lookups (`VLOOKUP`/
  `HLOOKUP`/`XLOOKUP`/`INDEX(MATCH)`) translate to a `related` IR node **only**
  through an accepted relationship whose target key column is the lookup key
  column (VLOOKUP exact, XLOOKUP 3-arg, INDEX/MATCH literal-0); anything else
  is `unsupported`. A negated number literal folds.
- **Render (`render.ts`, D58, user syntax):** `renderFormula(document,
  NameLookupV1)`, `formulaTableName(displayName)` (the identifier spelling an
  authored resolver matches `Table[…]` against). `[Quoted]-[Paid]` (this row),
  `SUM(Jobs[Quoted])` (table aggregate), `RELATED([Customer],[Name])` (across a
  relationship) all round-trip through `translateAuthored` → `renderFormula`
  using *current* field names, so a rename never breaks a formula. Nothing is
  `eval`'d.
- **Evaluator (`evaluate.ts`, CA-26):** `evaluateRow(doc, RowAccessV1,
  EvaluationEnvV1)`, `evaluateAggregate(doc, env)`, `evaluateScalar(doc, env)`,
  `evaluateNondeterministicOnce(doc, DomainEntropy, env, row?)`.
  `EvaluationResultV1` = `ok{value: FormulaResultValueV1}` | `empty` |
  `error{code}` | `cycle` | `unsupported`; `EVALUATION_RESULT_KINDS` pinned to
  `scalar_formula_results.status`. `EvaluationEnvV1 {clock, columns:
  ColumnAccessV1, formulaResults, relatedRow, optionLabel, budget?}`;
  `FieldReadV1 = CellValueV1 | {kind:"error", code}`. Budget
  `DEFAULT_EVALUATION_BUDGET = 10_000` node visits, `MAX_EVALUATION_DEPTH =
  256` → `#BUDGET`. Exact bigint decimals (34 digits, half-even), epoch-day
  dates, case-insensitive NFC text compare, `TODAY`/`NOW` from `env.clock`
  only (never persisted, invariant 7), `RAND*` only inside
  `evaluateNondeterministicOnce` (frozen once at import or on a new row).
- **Graph (`graph.ts`, D60):** `buildDependencyGraph(FormulaNodeV1[]) →
  DependencyGraphV1 {order, cycles, readersOfField, readersOfFormula}` (Kahn
  by layers, bytewise ID order); `downstreamOf(graph, changedFieldIds,
  changedFormulaIds?)` (stays inside the graph, in order, includes every
  reader); `isCycleMember(graph, id)` — anything in or downstream of a cycle
  is never evaluated.
- **Disposition (`disposition.ts`):** `classifyFormula(document|null) →
  FormulaClassificationV1`, `UNSUPPORTED_CLASSIFICATION`,
  `isAllowedClassification(disposition, determinism)` (migration 005's exact
  pairs).

**Deviations from Excel, never approximated (recorded, not fixed):**
`^`/`POWER` with a fractional exponent other than 0.5 evaluates to
`unsupported`; `TEXT` outside the bounded D41 format codes evaluates to
`unsupported`; a date used as a number is its epoch day, not Excel's serial
number; `NOW()` returns a decimal count of epoch days; joining a date into
text gives ISO `YYYY-MM-DD`; `DATEDIF "MD"` uses the standard definition;
lookup calls never evaluate outside a relationship match. Carried to the
GATE-F04 reviewer alongside the F03 BIFF12 unverified-layout item.

## Dependency must-nots (ship as tests)

- Imports only `src/domain/model/`. No other `src/` module, no third-party
  package. Owned by `tests/unit/formulas/module-boundaries.test.ts`
  (`MINIMUM_SOURCES` raised 6 → 17 at F04; negative controls for
  `eval`/`Function` too).

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-02 (`43ba6a1`..`3e99aa1`); consumed by M16/M17
  (BIFF/XLSB decompile to formula text, parsed by this same parser, D34) and
  M21 (`findLookups` as the primary relationship signal, FR-7).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-02 delta
  folded into "Landed surface"; no contradiction found. IR/catalog/graph/
  evaluator remain F04's, as planned.
- 2026-09-23 — F04: the full engine (IR, catalog, translate, render, evaluate,
  graph, disposition) landed by SESSION-01 (`50d1c51`..`488f49e`), superseding
  D34's "parser subset only" scope. Consumed by S03 (recalculation), S06
  (authored formulas), S07 (import translation).
- 2026-09-23 — reconciled by Archivist (F04 final pass): the module's contract
  section rewritten from "F03 builds only the parser subset" to the landed
  full-engine contract (Principle 2 — the delta superseded the seeded head, so
  it is folded in rather than left as a trailing note); the SESSION-01 delta's
  file-by-file description folded under "IR, catalog, translation, evaluation";
  the parser's external-reference limit reconciled with the translator's own
  `external-source` refusal so the two no longer read as two different rules.
