# M03 — Formulas (`src/domain/formulas/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Module Contracts / Formulas and § Formula IR. **F03 builds only the parser
> and reference-extraction subset** (D34); the IR, function catalog,
> dependency graph and evaluator are F04's (`formulas-queries-charts`).

## Contract

- **Owns (whole module):** Parser, stable-reference IR, function catalog,
  dependency graph, evaluator. No `eval`, no dynamic `Function`.
- **F03 subset exports (planned, F03 S02):** `parseFormula(text)` →
  `FormulaParseResultV1` (`parsed{ast} | unparsed{reason}`, total — never
  throws), `FormulaAstV1`, `extractReferences(ast)` (cell, range, whole-column,
  whole-row, sheet-qualified, structured-table and defined-name references), and
  `findLookups(ast)` → the lookup calls (`VLOOKUP`, `HLOOKUP`, `XLOOKUP`,
  `LOOKUP`, `INDEX`+`MATCH`) with their key argument and lookup-range
  references — the facts FR-7's primary relationship signal needs.
- **Depends on:** M01 only.
- **Contract:** Bounded by construction: formula text ≤ 8,192 characters (the
  Excel limit), nesting depth ≤ 64 — beyond either the result is
  `unparsed{reason}`, never a partial tree. Parsing is syntax only; nothing is
  evaluated and no reference is resolved against data here. F04 builds its IR
  from this AST rather than replacing the parser.

## Dependency must-nots (ship as tests)

- Imports only `src/domain/model/`. No other `src/` module, no third-party
  package. Owned by `tests/unit/formulas/module-boundaries.test.ts` (S02).

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).

<!-- workbook-fidelity SESSION-02 -->
### workbook-fidelity SESSION-02 (2026-09-22, commits 43ba6a1..3e99aa1)

**M03 — Formulas (`src/domain/formulas/`) — created (D34 subset)**

Files: `ast.ts`, `lexer.ts`, `parser.ts`, `references.ts`, `lookups.ts`, `index.ts` (barrel).

- `parseFormula(text) → FormulaParseResultV1` — total: `parsed{ast}` | `unparsed{reason: "too-long"|"too-deep"|"syntax"|"unsupported-token"}`; never throws, never a partial tree. Leading `=` optional. `FORMULA_MAX_LENGTH = 8192` (text), `FORMULA_MAX_DEPTH = 64` (groups, calls, arrays, unary chains).
- `FormulaAstV1`: `number{text}` (as authored, never a float) · `string` · `boolean` · `error{code}` · `array{rows}` · `reference{reference}` · `unary{+|-}` · `percent` · `binary{operator}` (`BINARY_OPERATORS`: `:` ` ` `,` `^` `*` `/` `+` `-` `&` `=` `<>` `<` `<=` `>` `>=`) · `group` (parentheses kept) · `call{name (upper-cased, prefix stripped), prefix ("_xlfn." etc. or null), args (null = omitted)}`.
- `FormulaReferenceV1`: `cell` · `area` · `columns` (A:B) · `rows` (1:3) · `structured{table|null, specifiers, firstColumn, lastColumn, isThisRow}` · `name{scope, name}`; `SheetScopeV1{workbook (external token or null), firstSheet, lastSheet (3-D) }`.
- Precedence (low→high): union `,` (only inside parentheses — parsed lowest, a deliberate deviation from Excel's table that no in-paren formula can observe), comparisons, `&`, `+ -`, `* /`, `^`, `%`, unary, space intersection, `:`. Left-associative.
- `extractReferences(ast)` (reading order), `findLookups(ast) → LookupV1{functionName: VLOOKUP|HLOOKUP|XLOOKUP|LOOKUP|INDEX-MATCH, keyReferences, lookupRange: LookupRangeV1 (columns | table-columns | name | other), returnIndex}`; `INDEX(r, MATCH(k, kr, 0))` only with a literal 0. `lookupRangeOf(ast)`, `columnLettersOf`, `columnNumberOf`.
- Must-not sweep: `tests/unit/formulas/module-boundaries.test.ts` — imports only own dir + `src/domain/model/`, no third-party, no `eval`/`Function` (negative controls for each). Today M03 imports nothing at all.
- IR, catalog, graph, evaluator remain F04's.
