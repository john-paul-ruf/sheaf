# Planning preflight — F05

Plan HEAD: `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`.

Mechanical lease checks: PASS. Seven sessions; each Files table equals Owns; 28 commit conditions; no protected source or shared state leased; no brace-expansion pathspecs; explicit DAG acyclic.

Concurrent source pairs S04/S05, S04/S06, S05/S06 checked literally, including hypothetical new paths under glob prefixes: no intersection. Build/live test resources still serialize.

S02 owns the home event producer AND record-event-payload encoder/decoder plus tail-kind pin. Projection port and fakes accompany exporter; S06 additionally owns event chain codec and unit/property assertions. Wire consumer inventory from symbol search (not module-edge inference) includes import/reset machines, theme routes, schema test harness, workflow fakes and worker browser specs; they are included in S02/S03/S07 serial leases.

Known unresolved decisions/qualification are in STATE; this check does not clear them or substitute for Orchestrator’s scoped Archivist review. No session implementation was executed.

## Original planning source identity inventory (historical)

Digest records identify the inspected/referenced inputs; they do not imply that every unrelated module or historical review was independently audited. Tracked sources resolve at plan HEAD unless explicitly updated planning metadata; ignored .program inputs are identified by SHA-256.

| Source | SHA-256 |
|---|---|
| `.program/blockers.md` | `51d17b987dae4c06fa2407b079a38231919facd8df460d064ff8c7a88b0142cb` |
| `.program/decisions.md` | `15eeb350b69686159e6dac937f75b246896baf4e9ea84d3a0acdc19e3d9a3a68` |
| `.program/ledger.md` | `d617804060c0214842706fae91b105095992aa2fc14100fd99bc8fc417786ab1` |
| `.program/results/ARCHIVIST-FINAL.result.md` | `a29ded7b60de4652501a35fd19daeacb58ef563181fbcc0f25df183911a68375` |
| `package.json` | `56c4827fe19db45651c92f0a9f3091aa19463ed40155807db5d32155d7abb11d` |
| `playwright.config.ts` | `53d0c3be34ac3df5c92f96972269a2eb8f654aece07e92dbb654b8829b80cb9c` |
| `pnpm-lock.yaml` | `20bd41fc669c606c06734c5e611d7c6a06602b6a9e4d168fb60621c5cbc9f989` |
| `program/sheaf/PROGRAM-CONFIG.md` | `0e5c9f5debc0c0d3a521a353ae77880ee58d1786677be4e0214fa9facc205cf6` |
| `program/sheaf/ROADMAP.md` | `a60c2a5a67b4b30f8f734e3ad643b059d9a93f7b45617c2ace626dc58b398c87` |
| `program/sheaf/ROSHI-LOG.md` | `336a538c892f4bb16a9df83e5c04a98a058ccbfa60798fd258ebd7661f86e7fc` |
| `program/sheaf/prompts/formulas-queries-charts/FINAL-REPORT.md` | `97fe9e78c560909961f7cea9dc4c8ed9f79a5e7406063f7cc25e48bd55553044` |
| `program/sheaf/prompts/formulas-queries-charts/STATE.md` | `f672e267629dc0c78d1e93c7e489dcab13e2f25ca1bffd08bd33e4c3220f747f` |
| `program/sheaf/specs/architecture.md` | `d11d6e447a6d1d80e9179e7db3646387e5b5f7b413a2f02cfafab9dfb074f8d8` |
| `program/sheaf/specs/database.md` | `3fe78703aa080f53e6cf96e894339e11975ca41ce597018399dbd786d7e0acf8` |
| `program/sheaf/specs/design.md` | `35a878687124c011e2711d3116de1a9bd5d5b7ee6b3f62cb5561f003a8231381` |
| `program/sheaf/specs/idea.md` | `73624f0f2f7dbeaecf50bcebf6250db0a142fc97e5b7dea68245ab844752b0a8` |
| `program/sheaf/specs/requirements.md` | `1829d63dfcc4f7147ef70aca58034da4e88f4a6ec51d814cd11809a33ebc2c69` |
| `src/application/ports/envelope-crypto.ts` | `b27de3b87cb7e9f844415ba04726394284c0aeb07152791caceedd94b2b18a98` |
| `src/application/ports/projection.ts` | `0328fc914b00bccdafe66ee073a59856c79f2e260194264f49011de34950bc3a` |
| `src/application/queries/history.ts` | `932431307fb45d3ffd8d1308d189845469cb83f492a4f37b5da11ae41d9ebb26` |
| `src/bootstrap/app-bootstrap.ts` | `c2c9d7a8c74d8cc291d862e8fd525e5c9eb8c5d3509e80ef1810454562959b55` |
| `src/config/public-config.ts` | `7316c68e592fc540f96f3c4b5d1bb6c50e5a67a83caf87588999ef959d15b730` |
| `src/crypto/kdf.ts` | `e722015da07d8ef75c1bd94c0a3aa80df52be136580e7e0eeb1b342fdf19f4b3` |
| `src/crypto/keys.ts` | `5a9ce43c4a38a65564abcbbc68af8844d4da567bb90241662dfe59d281732d8c` |
| `src/harness/main.ts` | `a84dccf879553c6ada7b602855c3b840ab4377769ccf7e471fb4e7ca78271e61` |
| `src/import/staging/roots.ts` | `0a91fa5b6cf9197338ee12f9fcdb0566738771e959af2adbea30d0ee700a2577` |
| `src/migrations/001_local_store_v1.ts` | `2536d3ddd330048b8bb9dc07789464df68ca5957fe55fa53e6e014393db4afca` |
| `src/migrations/002_share_inbox_v1.ts` | `a6eb6d012c0d1550466a5f30359158fd7dc953f479cdb31e60c458f51b4bc785` |
| `src/migrations/003_envelope_format_v1.ts` | `c86e4fac3483eac5c15baf496773c0504a7e934ac2e0a6ce7594dc58167dc4d7` |
| `src/migrations/004_event_format_v1.ts` | `1cc01930698182e37bca7eef7e9e89d306ccbd5dfae220a21b995a912f670b26` |
| `src/migrations/005_projection_v1.sql` | `abde9e4dbb27ce29370d3dfabbfc5ea4b251a8f7e5f26c1d982560f0c2b133a0` |
| `src/migrations/006_vault_format_v1.ts` | `6c0da244ee57860a73e168de55582a2f360148e3a62937881b761a8f95253b6e` |
| `src/migrations/index.ts` | `12417f29d5a0a334be52b84fe0e36980a1b64fef7e6962ce36533a46ef210bf7` |
| `src/persistence/projection/apply-events.ts` | `cfe823da1d598fcdb0b20d416aa3116449ad04bf4630a67c39dbc9eac0a1664f` |
| `src/persistence/projection/engine.ts` | `05471e0bed2949b075f300ead2d30e93acae050500aec6c92869f4f426a2f35e` |
| `src/persistence/projection/types.ts` | `0bd2c270d4279fd7de36f79ea50306e4e9e1397a57e54e408aad25dc9549c771` |
| `src/workers/data/app-session.ts` | `305e748526ac1facda12e5cb0e0894c816d2d67db7e4601f34ce1a1a2a4a82a5` |
| `src/workers/data/catalog.ts` | `1aefd37254274469f654334ccc0a28457c7f1e965bb5f400d916f9d2c58d37f8` |
| `src/workers/data/event-store.ts` | `c0c2c73e6abde97675ef6bf26146d308097be419b3aa42bdae249199b6dd3f1f` |
| `src/workers/data/handlers.ts` | `f81a48e76a7eee0dbec24a80cf84ff5ca47517f523f92444b68b426c33aaf311` |
| `src/workers/data/import-handlers.ts` | `459a41e8f594ca8a0cf28b56780b4fcaf754b4fe28882032c79979147af998bd` |
| `src/workers/data/record-event-payloads.ts` | `127931440cd315ce7676058d026de48aea24c1aa7f410d6b03017428548824d8` |
| `src/workers/data/record-handlers.ts` | `20812f590c580d311d59c29126c2788892a328c11b4f74dc1973beb861afd1c8` |
| `src/workers/protocol/messages.ts` | `da382bb562cde537309e98e4092d39cb409392fd38d1f4e32ce8d97ba289484e` |
| `tests/e2e/fixtures/app.ts` | `2258945670fde616ebf473d420c143c76ca6e5ec31aa82c6ded5d4bf07156d73` |
| `tests/e2e/fixtures/no-network.ts` | `db6e8e3e8535ee962e0f896c9ee10c46662d6fe0cdc5be26cfd14aa753feebff` |
| `tests/e2e/fixtures/workbook.ts` | `aa4d0dd43856f6d39c425bdebcf5992b716bd56e71116d3e3818978277a63cdf` |
| `tests/unit/workers/module-boundaries.test.ts` | `922ef4e5f52791810d260136571ce5e2326f6940950649b521e6ba5f6b07acc1` |
| `tests/unit/workflows/module-boundaries.test.ts` | `c1ff49b96725a8ab6b39235eb5291241919e0e648555a98a722b1d0bc9bfa6fe` |
| `vite.config.ts` | `184da67abeeb85cbeddbd3bc39eb5bfb11dc48f20db8e9ceb92a0953f695fae6` |
| `vitest.config.ts` | `27f7e0cb566a99b4680cab6355088d3989934ff7ce0e25fb99f8cdaae2512407` |

## Unresolved input checklist

DEC-71 cadence; DEC-72 unobservable-save fallback; provider public registrations and actual account/CORS/CAS qualification; scoped Designer fill and Orchestrator planning review. Native-platform evidence and inherited F04 review limitations remain explicit.

## REPLAN-F05-PREFLIGHT — 2026-09-24

Base source HEAD remains `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51`. The twelve authorized plan files were ignored/untracked at intake; the bounded commit force-adds those exact files only (including unchanged SESSION-03 for a complete seven-session plan). Existing PROGRAM-CONFIG/ROADMAP edits and untracked arch seeds are outside this lease and preserved. No code, package, specs, mocks, migration, config or arch edits; no workers spawned.

PC-F05-01–05 accepted and corrected in STATE's disposition table. Required countdown is S02 CP5; optional chart split is intentionally retained. Scope mapping is authenticated parent/AAD plus expected payload kind; revision/paddedBytes are frame values. S02 CP4 and S06 CP2 now implement readers before their own proofs. S06 also owns history VM/screen/tests in CP2. S07 CP1 supplies a local security project/script, named specs and negative controls. These assignments remain planned, not verified behavior.

Actual mechanical validation: inline Python parsed all seven session front matters, Files tables, STATE lease rows and LEASES.json; asserted exact lease equality, module/dependency/concurrency equality, 2–6 numbered commit conditions per session (28 total), DAG acyclicity, protected-path exclusion, mutual concurrency and literal/glob-prefix disjointness for S04/S05, S04/S06 and S05/S06 including hypothetical descendants. Every overlapping pair is transitively serialized. Handoff Notes remains empty and historical inherited rows unchanged. PASS. Shared dist:build/playwright:output reservations still serialize all three wave-4 sessions under current envelopes; source disjointness is not resource isolation.

Source-backed comparison: recoveryMachine currently only preserves retryAfterMs; unlockMachine supplies the existing ClockPort/countdown pattern; all recovery actor constructors are in the leased route/machine-test/security-VM-test paths. ChangeHistoryVm/selectChangeHistoryVm and ChangeHistoryScreen and both paired tests pin since-last-checkpoint. EnvelopeFrameV1 deliberately omits scope; decryptEnvelope takes scope and expectedPayloadKind explicitly. App-session/toSessionView/listLibrary readers lack confirmed receipt facts. Playwright currently discovers browser/e2e, Vitest unit/property; security-f05 is a future S07 output. Source references below identify this inspection, not new test results.

Limitations: no implementation tests, build, browser journey, visual inspection, native-save probe or provider request ran in this bounded correction. VB-01 results remain evidence from the earlier plan/run, not rerun results. DEC-71/72 remain unresolved; DF-F05-1 and provider inputs/qualification remain gated; startup go is no demo verdict. Orchestrator owns final PLAN-REVIEW clearance and ledger refresh.

### Replan checked-source identities

The original table above is retained as historical evidence. This table records the current replan inputs; ignored orchestration records can change after this receive. Tracked production/test files were checked against HEAD. M36 and other historical records are read-only; modified program metadata was not staged.

| Source | SHA-256 |
|---|---|
| `.program/prompts/REPLAN-F05-PREFLIGHT.prompt.md` | `4410090ac47275ccaa60587afd8f5b28cb4ce51b112b0ca76e810fc1d394e3f0` |
| `.program/results/ARCHIVIST-F05-PLANNING.result.md` | `d205011f87b0ef6867e59ae49f1ef320b09eae086398ed2d31cb35cc5d2a1a5b` |
| `.program/ledger.md` | `aadf75b4f5b6515fc09a8206669ebe9fce82cdf65f72f9cdd19a4c0e4d5ec956` |
| `.program/blockers.md` | `bf4fb96500bd6b6adb8ac07b0ac1baf358e3f0731a6efd2856c36d39c900d38a` |
| `program-agents/PLANNER.md` | `c6d339fafa260894bec9c0a58454d3048918285475b24240bfb2bb5cc4ac174a` |
| `program/sheaf/prompts/formulas-queries-charts/STATE.md` | `f672e267629dc0c78d1e93c7e489dcab13e2f25ca1bffd08bd33e4c3220f747f` |
| `program/sheaf/prompts/formulas-queries-charts/FINAL-REPORT.md` | `97fe9e78c560909961f7cea9dc4c8ed9f79a5e7406063f7cc25e48bd55553044` |
| `program/sheaf/arch/M36-workflows.md` | `d57de5d49fbb0d21751f91b01f0569c35582b6893eff89a9d59294b497a4eb71` |
| `src/application/workflows/recovery.machine.ts` | `af24359aecbd76177e06c19f7c62ebed7dfbc64be7b8cbe7ef42e86cbf63dc4e` |
| `tests/unit/workflows/recovery.machine.test.ts` | `ac591981f582c712ef9d948a2c5a29f2f9d438877c39cf4323642a25878b1d9f` |
| `src/application/workflows/unlock.machine.ts` | `5abe0059ffbde6fd2fa9f01411d8a4cf0922f8d162cb063b086f9acd1eed2c8e` |
| `tests/unit/workflows/unlock.machine.test.ts` | `28687819641df5fabad9f64b5340d7f78ee9f4fd2c429644007d9a5c443d5835` |
| `src/application/view-models/security.ts` | `d2cadce555f542aab398d393755156328a8cb77e4a0a5a489a858c7f2d495755` |
| `tests/unit/view-models/security.test.ts` | `c6a5d31816b05f482bfcd0bfa1acf9c6c1a756daebe803784bb383d55877eddb` |
| `src/ui/security/recovery-screen.tsx` | `6989195324a458becae3ee98a511ca5e54195e10709333482d463e9f003793f1` |
| `src/routes/route-table.tsx` | `7a514a09b6514768755a0ca9f018a946f10835f62807507949deed426c9c7fad` |
| `src/routes/app-runtime.tsx` | `b7f6b43a80874abe9d81367b749b0849b0c0435e578f69627df65f6371f6abac` |
| `src/application/view-models/records.ts` | `7e31666b01abfab599d90b5dad823c88db4c3a80f64a0a37818c55adbad4a8bc` |
| `tests/unit/view-models/records.test.ts` | `6bd820eb996de85e5b548ea67310902ca58b4aae58dbf6115316e5d7d874be8f` |
| `src/ui/records/change-history-screen.tsx` | `0a03684eb2969f2c6974e31d535535080bb7c096004cab7b97df3ef68ef7adf5` |
| `tests/unit/ui/records/change-history-screen.test.tsx` | `3c241cf8666d8c938a0631842c4274dd66338ece45f7c09f962cd301237af0d9` |
| `src/migrations/003_envelope_format_v1.ts` | `c86e4fac3483eac5c15baf496773c0504a7e934ac2e0a6ce7594dc58167dc4d7` |
| `src/crypto/envelope.ts` | `d79fcd5d4481cd6bbc3e7aaea18f3862dcef56651a11713bdd7441897ebdbaf4` |
| `tests/unit/crypto/envelope.test.ts` | `1019ff6a0a44ff345e0cd0a492f4bfd4f7a287585550ad4e992fda00bd6a5051` |
| `src/persistence/codecs/envelope-frame.ts` | `87eef120b7b5375020414039fee46913c6b076a8994b3fb86ba19a9380ce3124` |
| `src/workers/data/app-session.ts` | `305e748526ac1facda12e5cb0e0894c816d2d67db7e4601f34ce1a1a2a4a82a5` |
| `src/workers/data/record-handlers.ts` | `20812f590c580d311d59c29126c2788892a328c11b4f74dc1973beb861afd1c8` |
| `src/workers/data/import-handlers.ts` | `459a41e8f594ca8a0cf28b56780b4fcaf754b4fe28882032c79979147af998bd` |
| `src/workers/data/handlers.ts` | `f81a48e76a7eee0dbec24a80cf84ff5ca47517f523f92444b68b426c33aaf311` |
| `tests/unit/workers/handlers.test.ts` | `e7dcaed17e6495e2b1a39787f0c9b87ba6639a18fba3b0c681594245979fd78a` |
| `src/workers/data/event-store.ts` | `c0c2c73e6abde97675ef6bf26146d308097be419b3aa42bdae249199b6dd3f1f` |
| `playwright.config.ts` | `53d0c3be34ac3df5c92f96972269a2eb8f654aece07e92dbb654b8829b80cb9c` |
| `vitest.config.ts` | `27f7e0cb566a99b4680cab6355088d3989934ff7ce0e25fb99f8cdaae2512407` |
| `package.json` | `56c4827fe19db45651c92f0a9f3091aa19463ed40155807db5d32155d7abb11d` |
| `tsconfig.json` | `66d50afbc0369da89e9daa668387154899b750b92709352d890fa09c8eb78fbe` |
| `tests/unit/toolchain.smoke.test.ts` | `3c55b3eaf4303ff97cbb7e4558a0fcb9443aa77f9263c81bb1b2c8512cc98d48` |
| `tests/e2e/fixtures/no-network.ts` | `db6e8e3e8535ee962e0f896c9ee10c46662d6fe0cdc5be26cfd14aa753feebff` |
| `tests/unit/workflows/module-boundaries.test.ts` | `c1ff49b96725a8ab6b39235eb5291241919e0e648555a98a722b1d0bc9bfa6fe` |
| `tests/unit/ui/architecture.test.ts` | `7509852a3edfa2355cbbccfb24ce9ec9f765db15fe48184790ab75419e5c7f28` |
| `program/sheaf/specs/requirements.md` | `1829d63dfcc4f7147ef70aca58034da4e88f4a6ec51d814cd11809a33ebc2c69` |

## REPLAN-F05-GRAPH — bounded correction, 2026-09-24

Base HEAD `309313170b997d2546794c6173ebcabfbd44ac5f`; accepted S02 CP1 `03ee57104dbe10e99351e2e1808a2be5aacf21bd`. This is a six-file plan-only correction. No worker, source/test/package installation, protected Author edit, application test/build or external call. Preserved r4 implementation and its recovery patch/arch remain unaccepted. Source-backed map and protected decision recommendation are in STATE CA-35/41; source hashes below separate committed facts from proposed working APIs.

**Disposition:** current named roots have fixed authenticated scope/kind; unique arbitrary two-field local retained refs do not. Remote migration006 refs already carry scope, and missing same-named local fields alone do not justify a migration. Database retention/branch contents are approved, while concrete nonempty local reference/page/descendant mapping is unresolved. GRAPH-CONTRACT requests scoped human/DB Author completion with exact compatibility consequences, not a Coder guess. S02 CP2 owns complete current-producer graph, covered-chain provenance, cursor coverage and production lifecycle with rejecting compatibility guard. S06 CP1 co-owns first nonempty candidate writers, codecs, graph reader, publication/frontier/backup-port consumers and fixtures; CP2 installs and proves chain/history/restore; CP4 J3 plus J1 regression. S06 remains blocked on accepted Author mapping and predecessor proofs. S02 may resume after Orchestrator recheck without requiring S06's future implementation. No assertion is dropped; unsupported content cannot publish or be cleaned up. CA-35 is unresolved for the nonempty extension; its current mapping is agreed in the expanded map, bounded readiness remains stale, and r4 evidence is inherited only.

**Actual mechanical validation:** inline Python parsed all seven sessions and LEASES.json, compared front matter Modules/Owns/Depends/Concurrent against JSON and STATE, compared every Files row against its exact lease, checked 2–6 numbered checkpoints with commit conditions (28 total), ordered checkpoint 0 plus 1..n, acyclic dependency graph, mutual concurrency and literal/glob-prefix disjointness including hypothetical descendants. Every overlapping source lease is transitively serialized; S04/S05/S06 remain source-disjoint. Protected specs/mocks/migrations and shared planning/arch are absent from Coder leases. Raw STATE Handoff Notes equal the HEAD bytes. PASS. `git diff --check` on plan paths passed. Full-session shared dist/output reservations still serialize wave 4. No application readiness is inferred from these checks.

**Consumer inventory and limits:** symbol search for BackupAppGraphV1/PublicationPortsV1/checkpointChains/readPublicationObject/buildPublicationCandidate/ProjectionAuthoredStatePort found backup/projection ports, worker exporter, publication and publication/graph tests plus f05 generate/publication fixtures. S06 additions cover shared implementation and paired regression paths serially after S02/S03; J1 bundle assertion files are leased to S06 for its reader changes. This is a symbol-consumer inventory, not a module runtime-edge derivation. S02's later IO/bundle consumers do not yet exist at base; Coder/Orchestrator must recheck their landed uses before S06, with Controlled Lease Revision for new mechanical consumers. Known present consumers are already assigned; this does not defer an inspected connection.

**Verification limits:** attempt4's 22 files/178 tests, typecheck/lint and source-inventory digest are historical component evidence only. No rerun here. Current unsupported branches are negative guard evidence, not positive recovery. GRAPH-S02/GRAPH-S06 specify planned exact gates under inspected Vitest/Playwright configuration; fresh browser artifact identity and actual IndexedDB/MessagePort journey remain J1/J3. Ledger's older active-worker/clean-source claim is stale versus ended CaVon and preserved uncommitted files; Orchestrator refreshes it from STATE. No unavailable external review is claimed reconciled; unrelated historical review findings were not re-audited by this graph-only correction.

**Granularity and dispatch:** seven sessions and 28 checkpoints retained. The correction closes a repeated decomposition seam by moving the first nonempty writer, reader and its gate into the same S06 CP1, while keeping S02's coherent current graph/cursor/lifecycle proof. Coder checks its committed CP1 mapping before CP2; Orchestrator is awaiting the session and rechecks canonical agreement on receive, not via a mid-session handshake. No new bookkeeping/verification-only session. DEC-71/72, design/provider inputs and release/demo choices remain open.

### GRAPH checked-source identities

| Source | Identity class at base | SHA-256 |
|---|---|---|
| `.program/prompts/REPLAN-F05-GRAPH.prompt.md` | untracked/ignored evidence or proposed source | `7246a17bc608d26c2638cab39cc5ec7a49924a900a43487e29ccb5d8096a3ce5` |
| `.program/results/F05-SESSION-02.attempt4.result.md` | untracked/ignored evidence or proposed source | `f9f46e9f1f53c6c207a30d1d592f8107982400cc8be46e36932f5ab73dbe15e3` |
| `.program/results/F05-SESSION-02.cp2-unaccepted.arch.md` | untracked/ignored evidence or proposed source | `27f93b0c43a90eaf5a2f1713cbb501974b19cb6ffbc80e14f8a7486f4dbcf5a2` |
| `.program/recovery/F05-S02-r4.patch` | untracked/ignored evidence or proposed source | `e724c8b8bea807f352e6a2985aefcfd81d9fb8fa6e1a98dc0285c0e6b916b5e2` |
| `.program/ledger.md` | untracked/ignored evidence or proposed source | `7f379454c1b0d626ba40d5e0852f271fa74a89ee1593112ef0abe278d56218b2` |
| `.program/blockers.md` | untracked/ignored evidence or proposed source | `ffca546d4f2ae0c92f0f009059e16554e6d3886c8c4e69a8ed05d680ca4f5f31` |
| `program-agents/PLANNER.md` | untracked/ignored evidence or proposed source | `c6d339fafa260894bec9c0a58454d3048918285475b24240bfb2bb5cc4ac174a` |
| `program/sheaf/PROGRAM-CONFIG.md` | working/unaccepted or pre-existing modified metadata | `0e5c9f5debc0c0d3a521a353ae77880ee58d1786677be4e0214fa9facc205cf6` |
| `program/sheaf/specs/database.md` | committed HEAD | `3fe78703aa080f53e6cf96e894339e11975ca41ce597018399dbd786d7e0acf8` |
| `program/sheaf/specs/architecture.md` | committed HEAD | `d11d6e447a6d1d80e9179e7db3646387e5b5f7b413a2f02cfafab9dfb074f8d8` |
| `src/migrations/003_envelope_format_v1.ts` | committed HEAD | `c86e4fac3483eac5c15baf496773c0504a7e934ac2e0a6ce7594dc58167dc4d7` |
| `src/migrations/004_event_format_v1.ts` | committed HEAD | `1cc01930698182e37bca7eef7e9e89d306ccbd5dfae220a21b995a912f670b26` |
| `src/migrations/006_vault_format_v1.ts` | committed HEAD | `6c0da244ee57860a73e168de55582a2f360148e3a62937881b761a8f95253b6e` |
| `src/import/staging/roots.ts` | committed HEAD | `0a91fa5b6cf9197338ee12f9fcdb0566738771e959af2adbea30d0ee700a2577` |
| `src/import/staging/promotion.ts` | committed HEAD | `6fdda1cf9dd056ab52090319d339e0256abbba46d218b724c01a665d62d480cf` |
| `src/import/staging/append.ts` | committed HEAD | `295be8aabc1c76a61ede97298239cb96952d88691aaf2f9a816543f8c54a45a9` |
| `src/workers/data/home-state.ts` | committed HEAD | `201d18cff63581669083af6327d4ef6ff237d506a33b97e6ce461d4e1ab79e64` |
| `src/workers/data/event-store.ts` | committed HEAD | `04c2e962961a4903fa02f4f4d0dd0d51081ed63b1b892a03b9a9c002ca939150` |
| `src/workers/data/backup-handlers.ts` | working/unaccepted or pre-existing modified metadata | `d634cc940d001855a1319e66ac2539900391b292c0ac6f99b01b8364538bc144` |
| `src/workers/data/backup-graph.ts` | untracked/ignored evidence or proposed source | `7fe8b97a9d2ed0820b6fdae58e6f90fd4d7242cacc26107189d6329f57f41fd2` |
| `src/workers/data/handlers.ts` | committed HEAD | `f6f6715921d9835d054ff5451dffa264f9b6f49c5ebd1278786c00af44c9346f` |
| `src/workers/data/app-session.ts` | working/unaccepted or pre-existing modified metadata | `71a13c17b94708b3cf844e4dcf952dd716455d33a844567251885a3d5b8cecb5` |
| `src/application/ports/backup.ts` | working/unaccepted or pre-existing modified metadata | `99b8f4257f1937adbc6c0b80163721507b262412cfa6ced4ee09f0dc03868c84` |
| `src/application/ports/projection.ts` | working/unaccepted or pre-existing modified metadata | `61b1e7cc6a2d653480b95fce5207c98754f1494452e0bee63e313c32d6876dd2` |
| `src/persistence/projection/authored-state.ts` | untracked/ignored evidence or proposed source | `ad1c66d6664e9913a59fa0e7299b46416e782162df56b253e304acc2fad74e14` |
| `src/persistence/projection/hydrate.ts` | working/unaccepted or pre-existing modified metadata | `fbc584fc72d40b0f0e359e94e5a6fa5364610ae502e60afed6ea9737c4c3680e` |
| `src/sync/protocol/references.ts` | committed HEAD | `275dcfadc294084db95319d6e251c11e51471015ea56ecc65c0f38e6358d2e61` |
| `src/sync/protocol/frontier.ts` | working/unaccepted or pre-existing modified metadata | `bdf096c7e17f0ae2cfdde28eefc987cee4ccb8b5120daf03f3a1d8045be54f21` |
| `src/sync/protocol/publication.ts` | working/unaccepted or pre-existing modified metadata | `bc8609c7cbcb83f020146db46c78fe303dacd70d576e19a1de0927f85dd52911` |
| `tests/unit/workers/backup-graph.test.ts` | untracked/ignored evidence or proposed source | `660e4191dd4773e95ab9a4a2f06924b68a26cf3c483bff984c386175756312b0` |
| `tests/unit/workers/backup-handlers.test.ts` | committed HEAD | `0c12988cfa1e5d56992d29cbc865c8b70277fc1e7d49f97936446f38598e2441` |
| `tests/unit/workers/projection-port.test.ts` | committed HEAD | `781df05a8d62c4d5133ae969a6404545c6a801f558d6eab6f6859093b082b5e8` |
| `package.json` | committed HEAD | `56c4827fe19db45651c92f0a9f3091aa19463ed40155807db5d32155d7abb11d` |
| `vitest.config.ts` | committed HEAD | `27f7e0cb566a99b4680cab6355088d3989934ff7ce0e25fb99f8cdaae2512407` |
| `playwright.config.ts` | committed HEAD | `53d0c3be34ac3df5c92f96972269a2eb8f654aece07e92dbb654b8829b80cb9c` |

Final precommit verification: all 31 pre-existing modified/untracked files retained identical SHA-256, including all uncommitted implementation, PROGRAM-CONFIG/ROADMAP edits and arch seeds. Final lease/DAG/checkpoint checks repeated after edits; canonical table shapes and GRAPH blocker placement checked. PASS. Only the six envelope paths are staged/committed; historical Handoff Notes remain identical.
