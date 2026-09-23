# M61 — E2E tests (`tests/e2e/`)

> Fragment created by Roshi at the F02 final pass. The facts below landed during
> F01 and F02 and had been recorded inside other modules' fragments and in
> session returns. Reconciled against the tree at `5ab3b07`.

## Contract

- **Owns:** Approved flows, responsive + accessibility assertions.
- **Runs through the real `index.html` entry, never the harness.**
  `harness.html` exists for browser-tier module and worker reach (M55/M60); an
  e2e suite that used it would prove nothing about the shipped page.
- **Served-artifact identity is asserted:** `window.__sheafBuildId` ≡
  `git rev-parse HEAD`, over a webServer that is `pnpm build && pnpm preview
  --port $SHEAF_PW_PORT --strictPort` with `reuseExistingServer: false`. A
  preview server can otherwise serve stale output.
- **Ports come from the Orchestration Envelope** (`SHEAF_PW_PORT`, slot 0/1/2 →
  8080/8081/8082); no server is left listening at return.
- **Playwright runs `fullyParallel: false`**, and per-file `beforeAll` fixture
  builds exist — new specs must stay safe under that setting.
- **The filter form takes no bare `--`.** `pnpm test:e2e <filter>` filters;
  `pnpm test:e2e -- <filter>` silently runs the whole suite and passes
  vacuously.

## Suites at `5ab3b07` (36 passing, no expected-failures)

| Spec | Proves |
|---|---|
| `first-journey.spec.ts` | F01's setup → lock → unlock → reload journey |
| `route-guards.spec.ts` | CA-07's matrix incl. deep links and both amendments |
| `capability-gate.spec.ts` | CAP-08 with stubbed capability ids |
| `accessibility.spec.ts` | axe + 320px/44px/200% over the approved surfaces |
| `offline-guard.spec.ts` | deny-by-default network, extended across import + CRUD |
| `import-flow.spec.ts` | CAP-09–12/14: journey, two refusal legs, cancel leg |
| `records-crud.spec.ts` | CAP-15/16/17 through the real entry |
| `gate-f02-demo.spec.ts` | the executable twin of the ROADMAP F02 demo script |

## Shared fixtures

`tests/e2e/fixtures/` holds `a11y.ts` (`auditable`, `clipped`,
`undersizedTargets`, `overlaps`, `AXE_TAGS`), `app.ts`, `no-network.ts`,
`records.ts`. The a11y helpers were moved **out** of `accessibility.spec.ts` so
every suite asserts the same three claims — a second copy is how two suites end
up disagreeing about what passing means.

**A fixture corpus a session does not lease is generated in the spec.** S07's
cancel leg needs a parse long enough to interrupt, and
`tests/fixtures/workbooks/**` is S03's; the large delimited file is therefore
generated in-spec from M19's own `generateLargeDelimited` and handed to the file
input in memory, using the corpus's own committed generator
(`tests/fixtures/workbooks/delimited/generate-large.js`) so the bytes still come
from one place. Truthful, and a workaround a lease boundary forced — see
FORGE-CONFIG's corpus-owner rule.

## Change History

- 2026-09-08 — F01 suites landed by SESSION-07 (`9174b6d`).
- 2026-09-08 — F02: two stale first-journey assertions repaired at `1b04b87`;
  `import-flow.spec.ts` + shared a11y fixtures at `8a665c1`, its MOD-007
  cleanup-receipt case turning from a `test.fail()` marker into a genuine pass
  at `5867b02`; `records-crud.spec.ts` and `gate-f02-demo.spec.ts` at
  `c46d3cb`/`4c7e1b0`.
- 2026-09-08 — fragment created by Roshi (F02 final pass), collecting the e2e
  contract that had been stapled into `M51-platform.md` and carried only in
  session returns and STATE's Verification Baseline.

<!-- workbook-fidelity SESSION-07 -->
### workbook-fidelity SESSION-07 (2026-09-23, commits 2185774..e062f41)

**M61 E2E**
- New `workbook-import.spec.ts` (demo journey + reload, handoff + clipboard, subset, macro + unsafe refusals, workbook cancel, streamed failure naming stage + raw diagnostic, XLSB/XLS/ODS/HTML-as-XLS smokes, axe + 320px) and `append-import.spec.ts` (TSV into the demo app → lands on the new table → reload; over-segment file refused at pre-flight; axe + 320px). All run under `fixtures/no-network.ts`.
- `import-flow.spec.ts` and `gate-f02-demo.spec.ts`: the `.xlsx` refusal legs now use `unsafe/payroll.xlsm` (headers state it); SCR-016 later-release and SCR-017 D18 copy assertions follow D19/D38.
