# M61 — E2E tests (`tests/e2e/`)

> Fragment created by Roshi at the F02 final pass. Reconciled against the tree
> at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Approved flows, responsive + accessibility assertions.
- **Runs through the real `index.html` entry, never the harness.**
- **Served-artifact identity is asserted:** `window.__sheafBuildId` ≡
  `git rev-parse HEAD`, over a webServer that is `pnpm build && pnpm preview
  --port $SHEAF_PW_PORT --strictPort` with `reuseExistingServer: false`.
- **Ports come from the Orchestration Envelope** (`SHEAF_PW_PORT`); no server
  is left listening at return.
- **Playwright runs `fullyParallel: false`**, and per-file `beforeAll` fixture
  builds exist.
- **The filter form takes no bare `--`.**

## Suites at `30396a9` (57 passing, no expected-failures)

| Spec | Proves |
|---|---|
| `first-journey.spec.ts` | F01's setup → lock → unlock → reload journey |
| `route-guards.spec.ts` | CA-07's matrix incl. deep links and all three amendments |
| `capability-gate.spec.ts` | CAP-08 with stubbed capability ids |
| `accessibility.spec.ts` | axe + 320px/44px/200% over the approved surfaces |
| `offline-guard.spec.ts` | deny-by-default network, extended across import + CRUD |
| `import-flow.spec.ts` | CAP-09–12/14: journey, refusal legs, cancel leg (delimited) |
| `records-crud.spec.ts` | CAP-15/16/17 through the real entry |
| `gate-f02-demo.spec.ts` | the executable twin of the ROADMAP F02 demo script |
| `workbook-import.spec.ts` (F03) | demo journey + reload, handoff + clipboard, subset, macro + unsafe refusals, workbook cancel, streamed failure naming stage + raw diagnostic, XLSB/XLS/ODS/HTML-as-XLS smokes, axe + 320px |
| `append-import.spec.ts` (F03) | TSV into the demo app → lands on the new table → reload; over-segment file refused at pre-flight; axe + 320px |
| `relationships.spec.ts` (F03) | CAP-24: labels, belongs-to/has-many both directions, broken-reference original key, repair, reference picker, table switcher, reload + unlock |
| `snapshots.spec.ts` (F03) | CAP-25 + CAP-23's full 7-sheet selection with a reload; SCR-030/031, SHT-016, F02 CSV snapshot, unknown-sheet notice |
| `gate-f03-demo.spec.ts` (F03) | the executable twin of the ROADMAP F03 demo script, at 320 px with no network |

## Shared fixtures

`tests/e2e/fixtures/` holds `a11y.ts` (`auditable`, `clipped`,
`undersizedTargets`, `overlaps`, `AXE_TAGS`), `app.ts`, `no-network.ts`,
`records.ts`, and (F03) `workbook.ts` — S07's workbook steps, moved out of
`workbook-import.spec.ts`, plus `rejectConnection`, `VISITS_TO_JOBS` and
`importDemoWorkbook(page, {allSheets})`.

**A fixture corpus a session does not lease is generated in the spec.** F02's
S07 needed a parse long enough to interrupt and `tests/fixtures/workbooks/**`
was S03's; the large delimited file is generated in-spec from M19's own
`generateLargeDelimited`. Truthful, and a workaround a lease boundary forced —
see PROGRAM-CONFIG's corpus-owner rule. F03 avoided the equivalent seam (see
`M58-workbook-fixtures.md`'s corpus-owner note): `workbook.ts` was S07's own
lease to write, moved out of a spec S07 also owned, and S08 leased
`tests/e2e/**` serially afterward.

## Change History

- 2026-09-08 — F01 suites landed by SESSION-07 (`9174b6d`).
- 2026-09-08 — F02: two stale first-journey assertions repaired at `1b04b87`;
  `import-flow.spec.ts` + shared a11y fixtures at `8a665c1`; `records-crud.spec.ts`
  and `gate-f02-demo.spec.ts` at `c46d3cb`/`4c7e1b0`.
- 2026-09-08 — fragment created by Roshi (F02 final pass), collecting the e2e
  contract that had been stapled into `M51-platform.md`.
- 2026-09-23 — F03: `workbook-import.spec.ts` + `append-import.spec.ts` by
  SESSION-07 (`2185774`..`e062f41`); `fixtures/workbook.ts`,
  `relationships.spec.ts`, `snapshots.spec.ts`, `gate-f03-demo.spec.ts`, and
  the amendment-3 `route-guards.spec.ts` rows by SESSION-08 (`eba5790`..
  `30396a9`). Suite size at wave close: 57 e2e tests (baseline 36).
- 2026-09-23 — reconciled by Archivist (F03 final pass): two SESSION staples
  folded into the Suites table and Shared-fixtures section.

<!-- formulas-queries-charts SESSION-08 -->
### F04 delta — SESSION-08 (M61 e2e (CP4, `7df22fb`))

- `tests/e2e/theme.spec.ts`: CAP-37 real-entry proof (320px offline and desktop; axe light and dark on SCR-036/037/024; dark-chrome focus ring; reload and unlock persistence; tile; failing accent refused).
- `tests/e2e/gate-f04-demo.spec.ts`: the GATE-F04 journey and MOD-015 through the real entry.
