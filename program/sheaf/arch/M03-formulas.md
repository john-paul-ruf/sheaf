# M03 — Formulas (`src/domain/formulas/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Module Contracts / Formulas and § Formula IR. **F03 builds only the parser
> and reference-extraction subset** (D34); the IR, function catalog,
> dependency graph and evaluator are F04's (`formulas-queries-charts`).
> Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns (whole module):** Parser, stable-reference IR, function catalog,
  dependency graph, evaluator. No `eval`, no dynamic `Function`.
- **F03 subset exports:** `parseFormula(text)` → `FormulaParseResultV1`
  (`parsed{ast} | unparsed{reason}`, total — never throws), `FormulaAstV1`,
  `extractReferences(ast)` (cell, range, whole-column, whole-row,
  sheet-qualified, structured-table and defined-name references), and
  `findLookups(ast)` → the lookup calls (`VLOOKUP`, `HLOOKUP`, `XLOOKUP`,
  `LOOKUP`, `INDEX`+`MATCH`) with their key argument and lookup-range
  references — the facts FR-7's primary relationship signal needs.
- **Depends on:** M01 only. Today M03 imports nothing at all.
- **Contract:** Bounded by construction: formula text ≤ 8,192 characters (the
  Excel limit), nesting depth ≤ 64 — beyond either the result is
  `unparsed{reason}`, never a partial tree. Parsing is syntax only; nothing is
  evaluated and no reference is resolved against data here. F04 builds its IR
  from this AST rather than replacing the parser.

## Landed surface (SESSION-02)

Files: `ast.ts`, `lexer.ts`, `parser.ts`, `references.ts`, `lookups.ts`,
`index.ts` (barrel).

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
  `unsupported-token` rather than resolving the workbook alias — owner: F04's
  formula work.

## Dependency must-nots (ship as tests)

- Imports only `src/domain/model/`. No other `src/` module, no third-party
  package. Owned by `tests/unit/formulas/module-boundaries.test.ts`
  (negative controls for `eval`/`Function` too).

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-02 (`43ba6a1`..`3e99aa1`); consumed by M16/M17
  (BIFF/XLSB decompile to formula text, parsed by this same parser, D34) and
  M21 (`findLookups` as the primary relationship signal, FR-7).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-02 delta
  folded into "Landed surface"; no contradiction found. IR/catalog/graph/
  evaluator remain F04's, as planned.

<!-- formulas-queries-charts SESSION-01 -->
### F04 delta — SESSION-01 (M03 — Formulas (`arch/M03-formulas.md`))

M03 is now the full engine (D34 superseded by landing). Still imports only `src/domain/model/`; still no `eval`/`Function`
(`tests/unit/formulas/module-boundaries.test.ts`, MINIMUM_SOURCES raised 6 → 17). New files: `ir.ts`, `catalog.ts`,
`translate.ts`, `render.ts`, `decimal.ts`, `calendar.ts`, `scalars.ts`, `builtins.ts`, `evaluate.ts`, `graph.ts`,
`disposition.ts` (all re-exported from `index.ts` except the internals `decimal`/`calendar`/`scalars`/`builtins`).

- **IR (`ir.ts`, CA-25):** `FormulaIRDocumentV1 {irVersion: 1, root}`; `FormulaIRV1` = `literal{value: text|decimal|boolean}` ·
  `error{code: FormulaErrorLiteralV1}` · `field{fieldId}` (this row) · `column{tableId, fieldId}` · `related{relationshipId,
  referenceFieldId, fieldId}` · `formula{formulaId}` · `unary{+|-|%}` · `binary{IrBinaryOperatorV1}` · `call{name, version, args}`.
  Stable IDs only. `related` carries `referenceFieldId` (beyond the suggested shape) so dependencies derive from the IR alone.
  Constants pinned to migration 005: `FORMULA_TARGET_KINDS`, `FORMULA_DISPOSITIONS`, `FORMULA_DETERMINISMS`,
  `FORMULA_DEPENDENCY_KINDS`. `FormulaTargetV1`, `FormulaDependencyV1`, `FormulaDefinitionV1` (target, displayName,
  originalText, document|null, disposition, determinism, dependencies — never a value), `FORMULA_ERROR_CODES` (Excel's seven +
  `#BUDGET`), `dependenciesOf(document)`, `irNodesOf(root)`.
- **Catalog (`catalog.ts`, D49):** `CATALOG_FUNCTION_NAMES` (exactly D49, 68 names), `FUNCTION_CATALOG_V1` entries
  `{name, version: 1, minArgs, maxArgs, coercion, determinism: deterministic|clock-volatile|nondeterministic, cost:
  scalar|aggregate|lookup}`, `CATALOG_VERSION = 1`, `catalogEntryOf(name)`.
- **Translate (`translate.ts`):** `translateImported(ast, ImportResolverV1) → TranslationV1` (`translated{document,
  dependencies}` | `unsupported{reason: ImportUnsupportedReasonV1, detail}`; 15 closed reasons incl. `external-source`);
  `translateImportedText(text, resolver)` (parses; `[1]!Name` → `external-source`); `translateAuthored(text,
  AuthoredResolverV1) → AuthoredTranslationV1` (`translated` | `unknown-name{name}` | `refused{reason, detail}`);
  `relativeShapeKey(ast, anchorRow, anchorColumn)`. Lookups become `related` only through an accepted relationship whose
  target key column is the lookup key column (VLOOKUP exact, XLOOKUP 3-arg, INDEX/MATCH 0); a negated number literal folds.
- **Render (`render.ts`, D58):** `renderFormula(document, NameLookupV1)`, `formulaTableName(displayName)` (the identifier
  spelling an authored resolver matches `Table[…]` against). Round-trip with `translateAuthored` is tested.
- **Evaluator (`evaluate.ts`, CA-26):** `evaluateRow(doc, RowAccessV1, EvaluationEnvV1)`, `evaluateAggregate(doc, env)`,
  `evaluateScalar(doc, env)`, `evaluateNondeterministicOnce(doc, DomainEntropy, env, row?)`. `EvaluationResultV1` = `ok{value:
  FormulaResultValueV1}` | `empty` | `error{code}` | `cycle` | `unsupported`; `EVALUATION_RESULT_KINDS` pinned to
  `scalar_formula_results.status`. `EvaluationEnvV1 {clock, columns: ColumnAccessV1, formulaResults, relatedRow,
  optionLabel, budget?}`; `FieldReadV1 = CellValueV1 | {kind:"error", code}`. Budget `DEFAULT_EVALUATION_BUDGET = 10_000`
  node visits, `MAX_EVALUATION_DEPTH = 256` → `#BUDGET`. Exact bigint decimals (34 digits, half-even), epoch-day dates,
  case-insensitive NFC text compare, `TODAY/NOW` from `env.clock` only, `RAND*` only inside `evaluateNondeterministicOnce`.
- **Graph (`graph.ts`, D60):** `buildDependencyGraph(FormulaNodeV1[]) → DependencyGraphV1 {order, cycles, readersOfField,
  readersOfFormula}` (Kahn by layers, bytewise ID order); `downstreamOf(graph, changedFieldIds, changedFormulaIds?)`;
  `isCycleMember(graph, id)`.
- **Disposition (`disposition.ts`):** `classifyFormula(document|null) → FormulaClassificationV1`,
  `UNSUPPORTED_CLASSIFICATION`, `isAllowedClassification(disposition, determinism)` (migration 005's pairs).
