# Cleanup ledger

Reconciled 2026-09-24 at `d75830d` / receive `95a539d`. Migrated the standing CL-01–06 evidence from `ROSHI-LOG.md` (F01–F04; latest committed `60a6a81`) without changing that historical log. No cleanup implementation was performed.

| ID | Candidate / cluster | Evidence and confidence | Blast radius / proposed check | Status |
| --- | --- | --- | --- | --- |
| CL-01 | Inert libsodium types pin / dependencies | High: current package.json has no `@types/libsodium-wrappers-sumo`; F03 removal remains effective. | No further removal; retain runtime libsodium. | retired |
| CL-02 | Smoke CSS location / test ownership | Medium: `tests/unit/toolchain.smoke.test.ts:55` dynamically imports `tests/browser/fixtures/smoke.module.css`. This is a real consumer, not an unused asset. Original placement followed a narrow F01 lease. | Optional fixture relocation requires producer/import/include review and unit smoke proof; no runtime effect. No separate campaign threshold. | tracking |
| CL-03 | F01 exports with no outside-file reference / API classification | Low removal confidence; fresh whole-word scan confirms 22 of 23 explicitly reconstructed F01 names have no reference outside the defining file. This is not an exact comparison with the old approximate 17/22 counts. See named subset below. | Some are used inside their defining file, public contracts or future APIs. Classify export visibility, never delete bodies from this evidence alone. | briefed |
| CL-04 | Source/snapshot decoders lacked callers / recoverability | High: `backup-graph.ts` now calls source/snapshot manifest decoders; `sheet-snapshot.ts` calls snapshot manifest/chunk decoders. F03 resolution remains true, F05 adds production use. | Preserve decode/recovery coverage; no cleanup. | retired |
| CL-05 | Broad exported value surface / API classification | Low removal confidence: fresh AST enumeration plus whole-word search found **211** named exported const/function/class declarations under src with no textual reference outside their file across src/tests JS/TS/HTML/CSS. See method and witnesses below. | Cross-module/API compatibility, dynamic harness access, test convention and future producers require classification before narrowing exports. | briefed |
| CL-06 | Chart.js unused-scale bundle contribution / bundle size | Medium inherited observation from F04 S05 and M45; this pass did not measure retained bytes or prove tree-shaking failure. Package availability alone is not bundle retention evidence. | Measure a fresh production build and compare actual bytes before any exclusion; preserve charts, axes, formatting and browser proof. | tracking |

CL-03/05 were labelled tracking in prior tables while the same entries explicitly said the F02 classification brief remained open and unaccepted. Status is reconciled to **briefed**, not newly accepted. No approved cleanup program was found in the reviewed F05 MASTER/sessions or inherited dispositions. This does not assert an exhaustive search of unrelated programs.

## Fresh symbol-consumer scan

Method: recursively read source/test JS/TS/HTML/CSS; TypeScript AST identifies top-level named exported variables, functions and classes under src (excluding declaration files); whole-word search excludes the defining file. This deliberately differs from the module-edge AST in `arch/MODULE-REGISTRY.md`. Textual absence is a triage measurement, not proof of dead behavior; internal references, string-based access, framework entry conventions and external consumers are not resolved by it. Historical scans used approximate text export patterns, so 92→211 is not a precise like-for-like growth rate.

F01 named subset still without outside-file references: `CURRENT_LOCAL_PASSPHRASE_SCOPE`, `NEW_LOCAL_PASSPHRASE_SCOPE`, `LOCAL_RECOVERY_CODE_REACH`, `PASSPHRASE_MINIMUM_WORDS`, `COUNTDOWN_TICK_MS`, `KDF_SALT_BYTES`, `ARGON2ID_MEMORY_CEILING_KIB`, `ARGON2ID_ITERATION_CEILING`, `hkdfExtract`, `hkdfExpand`, `SECRET_KEY_BYTES`, `RECOVERY_CODE_DATA_CHARS`, `RECOVERY_CODE_CHECKSUM_CHARS`, `RECOVERY_CODE_GROUP_SIZE`, `isDomainError`, `isEnvelopePayloadKindV1`, `REVISION_PAGE_SIZE`, `REVISION_CHANNEL_NAME`, `isConfirmationPhraseMatched`, `SHELL_COLOR_SCHEMES`, `DEFAULT_REQUEST_TIMEOUT_MS`, `IDLE_TIMEOUT_MINUTES_V1`. `isEnvelopeScopeV1` no longer qualifies. In particular, `COUNTDOWN_TICK_MS`, `REVISION_PAGE_SIZE` and `IDLE_TIMEOUT_MINUTES_V1` are used internally: removal of their behavior is not warranted.

Current witnesses:

| Symbol | Definition |
| --- | --- |
| `readChartSchema` | `src/application/commands/chart-commands.ts` |
| `buildValidationContext` | `src/application/commands/execute-command.ts` |
| `issuesOf` | `src/application/commands/execute-command.ts` |
| `readComputed` | `src/application/commands/formula-env.ts` |
| `rowAccessOf` | `src/application/commands/formula-env.ts` |
| `SCHEMA_INVALID_CHANGE_REASONS` | `src/application/commands/schema-commands.ts` |
| `SEGMENT_LIMITS` | `src/application/commands/schema-commands.ts` |
| `LOGO_REFUSAL_REASONS` | `src/application/commands/theme-commands.ts` |
| `CHART_TABLE_PAGE_SIZE` | `src/application/queries/charts.ts` |
| `DEFAULT_CHART_BUDGETS` | `src/application/queries/charts.ts` |
| `MAX_HISTORY_PAGE_SIZE` | `src/application/queries/history.ts` |
| `DEFAULT_HISTORY_PAGE_SIZE` | `src/application/queries/history.ts` |
| `RELATED_CHILDREN_PREVIEW` | `src/application/queries/relationships.ts` |
| `DEFAULT_RELATED_PAGE_SIZE` | `src/application/queries/relationships.ts` |
| `MAX_RELATED_PAGE_SIZE` | `src/application/queries/relationships.ts` |
| `DEFAULT_CANDIDATE_LIMIT` | `src/application/queries/relationships.ts` |
| `MAX_CANDIDATE_LIMIT` | `src/application/queries/relationships.ts` |
| `handoffInstructions` | `src/application/view-models/import.ts` |
| `toReferenceCell` | `src/application/view-models/records.ts` |
| `filterSheetFor` | `src/application/view-models/records.ts` |

## Cleanup brief for Planner — Prove or name every unconsumed export

- **Target area:** CL-03/05, exported value surfaces under `src/**`, initially workflow/crypto/store constants and application helpers.
- **Reason / threshold:** the same classification pattern has stood since F01 and was briefed in F02, carried through F03/F04, and freshly measured in F05. The **repeated standing-ledger pattern** threshold applies; no claim of three high-confidence deletions is made.
- **Confidence:** low that any particular implementation is removable; high that the listed export declarations lack outside-file textual references under the stated scan.
- **Proposed Planner task:** build a bounded classification program. For each selected symbol, establish actual callers or a named supported external/future contract; otherwise propose narrowing export visibility with its owning source/test lease. Actual removals require their own evidence and approved scope.
- **Automated strategy:** rerun AST export inventory and identifier-reference scan; resolve re-exports/dynamic harness access; group by module; compare public API/typecheck and test discovery before/after a proposed change.
- **Required checks:** preserve all current module-boundary assertions, KATs, worker and recovery contracts; run appropriate focused tests plus `pnpm verify` for approved implementation changes, and browser/e2e assertions where entry points or UI are affected. Fail a disappearance of required discovery or an unowned consumer.
- **Risks:** a name can be used through dynamic access, external APIs, generated tooling or future leased work. Migrations, compatibility decoders and framework entry points are retention candidates until disproved. Broad deletion is not authorized by this brief.
