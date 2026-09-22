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
