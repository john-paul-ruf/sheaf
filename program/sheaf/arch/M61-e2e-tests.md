# M61 — E2E tests (`tests/e2e/`)

> Fragment created by Roshi at the F02 final pass. Reconciled against the tree
> at `5bc19fb` (F04 final; formulas-queries-charts).

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

## Suites at `5bc19fb` (71 passing, no expected-failures)

| Spec | Proves |
|---|---|
| `first-journey.spec.ts` | F01's setup → lock → unlock → reload journey |
| `route-guards.spec.ts` | CA-07's matrix incl. deep links and all four amendments |
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
| `records-query.spec.ts` (F04) | CAP-31: filters, sort, partial scope, no-results, no SQL surface |
| `charts.spec.ts` (F04) | CAP-32/33: mark → filter, builder, pin, drafts, accessibility view |
| `structure.spec.ts` (F04) | CAP-28/35/36: live computed columns, all 8 schema-edit steps incl. Text → Choice, authored rule refusal |
| `theme.spec.ts` (F04) | CAP-37: palettes, mode, density, logo, contrast, persistence, tile |
| `dark-semantics.spec.ts` (F04) | dark-mode semantic text-ink contrast (OWNER-THEME-DARK-SEMANTICS) |
| `gate-f04-demo.spec.ts` (F04) | the executable twin of the ROADMAP F04 demo script, at 320px with no network |

## Shared fixtures

`tests/e2e/fixtures/` holds `a11y.ts` (`auditable`, `clipped`,
`undersizedTargets`, `overlaps`, `AXE_TAGS`), `app.ts`, `no-network.ts`,
`records.ts`, `workbook.ts` (F03 — S07's workbook steps, moved out of
`workbook-import.spec.ts`, plus `rejectConnection`, `VISITS_TO_JOBS` and
`importDemoWorkbook(page, {allSheets})`), and (F04) `structure.ts` (S06's
schema-editing steps, shared with `gate-f04-demo.spec.ts`).

**A fixture corpus a session does not lease is generated in the spec.** F02's
S07 needed a parse long enough to interrupt and `tests/fixtures/workbooks/**`
was S03's; the large delimited file is generated in-spec from M19's own
`generateLargeDelimited`. Truthful, and a workaround a lease boundary forced —
see PROGRAM-CONFIG's corpus-owner rule. F03 and F04 both avoided the
equivalent seam (see `M58-workbook-fixtures.md`'s corpus-owner note):
`workbook.ts` was S07's own lease to write in F03, moved out of a spec S07
also owned; F04's `structure.ts` was likewise S06's own lease to write,
reused unmodified by S08's `gate-f04-demo.spec.ts` afterward.

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
- 2026-09-23 — F04: `records-query.spec.ts` by SESSION-04 (`f736fa8`..
  `27a2667`); `charts.spec.ts` by SESSION-05 (`6ee204c`..`3dd1d2d`);
  `structure.spec.ts` + `fixtures/structure.ts` by SESSION-06 (`e7e7fe2`..
  `7ec391e`); `theme.spec.ts` and `gate-f04-demo.spec.ts` by SESSION-08
  (`42decba`..`7df22fb`); `dark-semantics.spec.ts` by
  OWNER-THEME-DARK-SEMANTICS (`beb094a`, `c92f393`). Suite size at feature
  close: 71 e2e tests (baseline 57).
- 2026-09-23 — reconciled by Archivist (F04 final pass): five SESSION/owner
  deltas folded into the Suites table (now stating all seventeen specs as one
  list) and the Shared-fixtures section; the corpus-owner cross-reference
  extended with F04's own instance.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M56 / M60 / M61 — proof surfaces

`bundle-backup.spec.ts` uses the real built index, data/IO workers, MessagePorts and IndexedDB, captures actual fallback downloads, and separately doubles only the native destination. It proves edits between capture/confirmation remain pending, same-context page replacement preserves records/receipts, reset remedy refreshes durable facts, and scoped code rejection. The production decoder fixture verifies complete saved authored state in a fresh context. `sync/bundle.spec.ts` exercises complete graph recovery, malformed-output rejection, interrupted pending confirmation, reopen and retry while preserving prior bytes. `recovery-countdown.spec.ts` obtains an actual wrong code from another isolated device context and observes the real worker delay/replacement gate. Evidence records source/config/fixture/build-output hashes and served endpoints. Native OS save/share remains outside the destination double's claim.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.
