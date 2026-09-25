# Current module registry

Reconciled 2026-09-25 at production `47a633b` plus S06 compaction through `2d8ff2d` (this continuation's final report `53f7c73`, STATE receive `9d72cf7`). PROGRAM-CONFIG's historical/planned registry remains externally owned and unchanged. Presence is not readiness: S01/S02/S03/S06 are accepted 3/6/4/4 checkpoints, while S04/S05/S07 (provider connection, egress, cloud composition) remain blocked on human provider registrations. M05 and M47 now have source; use their tracked `*-f05-delta.md` current contracts, not the preserved external planning seeds. M25/M26/M29/M30/M64 remain unimplemented. See [F05 boundaries](F05-boundaries.md).

Runtime edges derive from TypeScript AST traversal of **every non-test JS/TS file in every registered module**, excluding test/spec/declaration files. `import type`, fully type-only named clauses and type-only exports are stripped. Value re-exports, side-effect imports and literal dynamic imports count. Relative `.js` resolves to `.ts`/`.tsx`; CSS imports count toward their owner. Same-module and package imports do not create module edges. Worker URL construction is listed separately. No symbol grep establishes a module edge. Test-module rows enumerate helper/fixture source, excluding cases themselves.

| ID | Module | Paths | Non-test source files | Present | Runtime module imports |
| --- | --- | --- | ---: | --- | --- |
| M01 | Domain model | `src/domain/model/` | 10 | yes | — |
| M02 | Validation | `src/domain/validation/` | 4 | yes | M01 |
| M03 | Formulas | `src/domain/formulas/` | 17 | yes | M01 |
| M04 | Capacity | `src/domain/capacity/` | 0 | no — planned | — |
| M05 | Policy | `src/domain/policy/` | 2 | yes | — |
| M06 | Reconciliation | `src/domain/reconciliation/` | 0 | no — planned | — |
| M07 | Application ports | `src/application/ports/` | 11 | yes | — |
| M08 | Crypto | `src/crypto/` | 8 | yes | M01, M09, M10 |
| M09 | Codecs | `src/persistence/codecs/` | 5 | yes | M01, M10 |
| M10 | Migrations | `src/migrations/` | 6 | yes | — |
| M11 | Envelope store | `src/persistence/envelope-store/` | 9 | yes | M01, M10 |
| M12 | Projection | `src/persistence/projection/` | 19 | yes | M01, M02, M03, M09, M10 |
| M13 | Import source | `src/import/source/` | 7 | yes | — |
| M14 | Pre-flight | `src/import/preflight/` | 4 | yes | M13, M19, M65 |
| M15 | OOXML adapter | `src/import/formats/ooxml/` | 10 | yes | M01, M13, M65 |
| M16 | XLSB adapter | `src/import/formats/xlsb/` | 7 | yes | M01, M13, M17, M65 |
| M17 | BIFF adapter | `src/import/formats/biff/` | 8 | yes | M01, M13, M65 |
| M18 | ODS adapter | `src/import/formats/ods/` | 7 | yes | M01, M13, M65 |
| M19 | Delimited adapter | `src/import/formats/delimited/` | 1 | yes | M01, M13 |
| M20 | HTML-table adapter | `src/import/formats/html-table/` | 6 | yes | M01, M13, M65 |
| M21 | Inference | `src/import/inference/` | 15 | yes | M01, M03, M65 |
| M22 | Snapshots | `src/import/snapshots/` | 4 | yes | M01, M09, M23 |
| M23 | Staging | `src/import/staging/` | 15 | yes | M01, M02, M03, M09, M13, M21, M22, M65 |
| M65 | Workbook facts | `src/import/facts/` | 4 | yes | M01 |
| M24 | Sync protocol | `src/sync/protocol/` | 3 | yes | M01, M09, M10 |
| M25 | Dropbox adapter | `src/sync/providers/dropbox/` | 0 | no — planned | — |
| M26 | OneDrive adapter | `src/sync/providers/onedrive/` | 0 | no — planned | — |
| M27 | Bundle adapter | `src/sync/providers/bundle/` | 2 | yes | M01, M08, M09, M10, M24 |
| M28 | Adoption | `src/sync/adoption/` | 0 | no — planned | — |
| M29 | Sync scheduler | `src/sync/scheduler/` | 0 | no — planned | — |
| M30 | Sync coordinator | `src/sync/coordinator/` | 0 | empty directory only — planned | — |
| M31 | Export | `src/export/` | 0 | no — planned | — |
| M32 | Worker protocol | `src/workers/protocol/` | 9 | yes | M01, M11 |
| M33 | Worker entries | `src/workers/data.worker.ts`, `src/workers/data/`, `src/workers/import.worker.ts`, `src/workers/import/`, `src/workers/io.worker.ts`, `src/workers/io/`, `src/workers/export.worker.ts`, `src/workers/export/` | 23 | yes | M01, M02, M05, M08, M09, M10, M11, M12, M13, M14, M15, M16, M17, M18, M19, M20, M21, M22, M23, M24, M27, M32, M34, M35 |
| M34 | Commands | `src/application/commands/` | 7 | yes | M01, M02, M03 |
| M35 | Queries | `src/application/queries/` | 8 | yes | M01, M03 |
| M36 | Workflows | `src/application/workflows/` | 15 | yes | M01, M32 |
| M37 | View models | `src/application/view-models/` | 7 | yes | M01, M05, M36 |
| M38 | UI primitives | `src/ui/primitives/` | 18 | yes | — |
| M39 | UI layout | `src/ui/layout/` | 2 | yes | M38 |
| M40 | UI theme | `src/ui/theme/` | 2 | yes | — |
| M41 | UI security | `src/ui/security/` | 12 | yes | M37, M38, M39, M44, M47 |
| M42 | UI library | `src/ui/library/` | 3 | yes | M37, M38, M40, M41 |
| M43 | UI import | `src/ui/import/` | 11 | yes | M38, M41 |
| M44 | UI records | `src/ui/records/` | 21 | yes | M37, M38, M39, M40, M45 |
| M45 | UI charts | `src/ui/charts/` | 10 | yes | M37, M38, M44 |
| M46 | UI schema | `src/ui/schema/` | 11 | yes | M37, M38, M40, M44 |
| M47 | UI durability | `src/ui/durability/` | 3 | yes | M37, M38, M44 |
| M48 | UI reconciliation | `src/ui/reconciliation/` | 0 | no — planned | — |
| M49 | UI ownership | `src/ui/ownership/` | 0 | no — planned | — |
| M50 | Config | `src/config/` | 1 | yes | M10 |
| M51 | Platform | `src/platform/` | 4 | yes | — |
| M52 | PWA | `src/pwa/` | 0 | no — planned | — |
| M53 | Bootstrap | `src/bootstrap/` | 3 | yes | M32, M51 |
| M54 | Routes | `src/routes/` | 10 | yes | M08, M36, M37, M38, M41, M42, M43, M44, M45, M46, M47, M51, M53 |
| M55 | Entry | `src/main.tsx` | 1 | yes | M40, M54 |
| M56 | Unit tests | `tests/unit/` | 23 | yes | M01, M08, M09, M10, M11, M12, M13, M14, M15, M19, M21, M23, M32, M33, M36, M37, M58, M65 |
| M57 | Property tests | `tests/property/` | 1 | yes | M03 |
| M58 | Workbook fixtures | `tests/fixtures/workbooks/` | 21 | yes | M17 |
| M59 | Vault fixtures | `tests/fixtures/vaults/` | 3 | yes | M01, M08, M09, M23, M24 |
| M60 | Browser tests | `tests/browser/` | 16 | yes | M01, M08, M09, M12, M27, M33, M40, M47 |
| M61 | E2E tests | `tests/e2e/` | 7 | yes | — |
| M62 | Provider contract | `tests/provider-contract/` | 1 | yes | M01, M08, M09 |
| M63 | Performance | `tests/performance/` | 0 | no — planned | — |
| M64 | Security tests | `tests/security/` | 0 | no — planned | — |

## Edge witnesses

One witness per mechanically discovered edge; the scan covered all files, not only these witnesses.

### M02

- M01: `src/domain/validation/schema-checks.ts → ../model/ids.js`

### M03

- M01: `src/domain/formulas/decimal.ts → ../model/values.js`

### M08

- M01: `src/crypto/envelope.ts → ../domain/model/errors.js`
- M09: `src/crypto/envelope.ts → ../persistence/codecs/envelope-frame.js`
- M10: `src/crypto/envelope.ts → ../migrations/003_envelope_format_v1.js`

### M09

- M01: `src/persistence/codecs/canonical-cbor.ts → ../../domain/model/errors.js`
- M10: `src/persistence/codecs/envelope-frame.ts → ../../migrations/003_envelope_format_v1.js`

### M11

- M01: `src/persistence/envelope-store/commit.ts → ../../domain/model/bytes.js`
- M10: `src/persistence/envelope-store/bootstrap.ts → ../../migrations/001_local_store_v1.js`

### M12

- M01: `src/persistence/projection/apply-events.ts → ../../domain/model/errors.js`
- M02: `src/persistence/projection/cbor-values.ts → ../../domain/validation/rules.js`
- M03: `src/persistence/projection/authored-functions.ts → ../../domain/formulas/scalars.js`
- M09: `src/persistence/projection/apply-events.ts → ../codecs/event-commit.js`
- M10: `src/persistence/projection/engine.ts → ../../migrations/005_projection_v1.sql?raw`

### M14

- M13: `src/import/preflight/preflight.ts → ../source/source.js`
- M19: `src/import/preflight/preflight.ts → ../formats/delimited/parse.js`
- M65: `src/import/preflight/workbook.ts → ../facts/index.js`

### M15

- M01: `src/import/formats/ooxml/sheet.ts → ../../../domain/model/values.js`
- M13: `src/import/formats/ooxml/charts.ts → ../../source/bounds.js`
- M65: `src/import/formats/ooxml/charts.ts → ../../facts/index.js`

### M16

- M01: `src/import/formats/xlsb/sheet.ts → ../../../domain/model/values.js`
- M13: `src/import/formats/xlsb/inventory.ts → ../../source/bounds.js`
- M17: `src/import/formats/xlsb/sheet.ts → ../biff/ptg.js`
- M65: `src/import/formats/xlsb/inventory.ts → ../../facts/index.js`

### M17

- M01: `src/import/formats/biff/sheet.ts → ../../../domain/model/values.js`
- M13: `src/import/formats/biff/globals.ts → ../../source/bounds.js`
- M65: `src/import/formats/biff/inventory.ts → ../../facts/index.js`

### M18

- M01: `src/import/formats/ods/parse.ts → ../../../domain/model/values.js`
- M13: `src/import/formats/ods/declarations.ts → ../../source/bounds.js`
- M65: `src/import/formats/ods/inventory.ts → ../../facts/index.js`

### M19

- M01: `src/import/formats/delimited/parse.ts → ../../../domain/model/values.js`
- M13: `src/import/formats/delimited/parse.ts → ../../source/source.js`

### M20

- M01: `src/import/formats/html-table/parse.ts → ../../../domain/model/values.js`
- M13: `src/import/formats/html-table/inventory.ts → ../../source/bounds.js`
- M65: `src/import/formats/html-table/inventory.ts → ../../facts/index.js`

### M21

- M01: `src/import/inference/review-edits.ts → ../../domain/model/values.js`
- M03: `src/import/inference/charts.ts → ../../domain/formulas/index.js`
- M65: `src/import/inference/charts.ts → ../facts/index.js`

### M22

- M01: `src/import/snapshots/delimited-snapshot.ts → ../../domain/model/errors.js`
- M09: `src/import/snapshots/delimited-snapshot.ts → ../../persistence/codecs/canonical-cbor.js`
- M23: `src/import/snapshots/delimited-snapshot.ts → ../staging/proposal-codec.js`

### M23

- M01: `src/import/staging/append.ts → ../../domain/model/bytes.js`
- M02: `src/import/staging/append.ts → ../../domain/validation/schema-checks.js`
- M03: `src/import/staging/live-structure.ts → ../../domain/formulas/index.js`
- M09: `src/import/staging/append.ts → ../../persistence/codecs/envelope-frame.js`
- M13: `src/import/staging/stage.ts → ../source/sniff.js`
- M21: `src/import/staging/lifecycle.ts → ../inference/review-edits.js`
- M22: `src/import/staging/append.ts → ../snapshots/source-chunks.js`
- M65: `src/import/staging/fact-codec.ts → ../facts/index.js`

### M65

- M01: `src/import/facts/numbers.ts → ../../domain/model/values.js`

### M24

- M01: `src/sync/protocol/frontier.ts → ../../domain/model/bytes.js`
- M09: `src/sync/protocol/frontier.ts → ../../persistence/codecs/event-commit.js`
- M10: `src/sync/protocol/publication.ts → ../../migrations/index.js`

### M27

- M01: `src/sync/providers/bundle/format.ts → ../../../domain/model/bytes.js`
- M08: `src/sync/providers/bundle/format.ts → ../../../crypto/hash.js`
- M09: `src/sync/providers/bundle/format.ts → ../../../persistence/codecs/canonical-cbor.js`
- M10: `src/sync/providers/bundle/format.ts → ../../../migrations/index.js`
- M24: `src/sync/providers/bundle/reader.ts → ../../protocol/references.js`

### M32

- M01: `src/workers/protocol/redact.ts → ../../domain/model/errors.js`
- M11: `src/workers/protocol/redact.ts → ../../persistence/envelope-store/errors.js`

### M33

- M01: `src/workers/data/app-session.ts → ../../domain/model/bytes.js`
- M02: `src/workers/data/app-session.ts → ../../domain/validation/validate-record.js`
- M05: `src/workers/data/handlers.ts → ../../domain/policy/scratch-reminder.js`
- M08: `src/workers/data.worker.ts → ../crypto/sodium.js`
- M09: `src/workers/data/backup-graph.ts → ../../persistence/codecs/canonical-cbor.js`
- M10: `src/workers/data/backup-handlers.ts → ../../migrations/index.js`
- M11: `src/workers/data/handlers.ts → ../../persistence/envelope-store/bootstrap.js`
- M12: `src/workers/data/app-session.ts → ../../persistence/projection/index.js`
- M13: `src/workers/import/parse-session.ts → ../../import/source/bounds.js`
- M14: `src/workers/data/import-handlers.ts → ../../import/preflight/budgets.js`
- M15: `src/workers/import/adapters.ts → ../../import/formats/ooxml/index.js`
- M16: `src/workers/import/adapters.ts → ../../import/formats/xlsb/index.js`
- M17: `src/workers/import/adapters.ts → ../../import/formats/biff/index.js`
- M18: `src/workers/import/adapters.ts → ../../import/formats/ods/index.js`
- M19: `src/workers/import/parse-session.ts → ../../import/formats/delimited/parse.js`
- M20: `src/workers/import/adapters.ts → ../../import/formats/html-table/index.js`
- M21: `src/workers/data/import-handlers.ts → ../../import/inference/infer.js`
- M22: `src/workers/data/backup-graph.ts → ../../import/snapshots/source-chunks.js`
- M23: `src/workers/data/app-session.ts → ../../import/staging/roots.js`
- M24: `src/workers/data/backup-graph.ts → ../../sync/protocol/references.js`
- M27: `src/workers/data/backup-handlers.ts → ../../sync/providers/bundle/format.js`
- M32: `src/workers/data.worker.ts → ./protocol/io-messages.js`
- M34: `src/workers/data/app-session.ts → ../../application/commands/execute-command.js`
- M35: `src/workers/data/chart-handlers.ts → ../../application/queries/charts.js`

### M34

- M01: `src/application/commands/build-commit.ts → ../../domain/model/ids.js`
- M02: `src/application/commands/execute-command.ts → ../../domain/validation/validate-record.js`
- M03: `src/application/commands/formula-env.ts → ../../domain/formulas/index.js`

### M35

- M01: `src/application/queries/charts.ts → ../../domain/model/charts.js`
- M03: `src/application/queries/charts.ts → ../../domain/formulas/decimal.js`

### M36

- M01: `src/application/workflows/theme-services.ts → ../../domain/model/events.js`
- M32: `src/application/workflows/import-services.ts → ../../workers/protocol/import-client.js`

### M37

- M01: `src/application/view-models/theme.ts → ../../domain/model/events.js`
- M05: `src/application/view-models/durability.ts → ../../domain/policy/backup-freshness.js`
- M36: `src/application/view-models/import.ts → ../workflows/import.machine.js`

### M39

- M38: `src/ui/layout/app-shell.tsx → ../primitives/class-names.js`

### M41

- M37: `src/ui/security/passphrase-change-screen.tsx → ../../application/view-models/security.js`
- M38: `src/ui/security/frames.tsx → ../primitives/class-names.js`
- M39: `src/ui/security/frames.tsx → ../layout/app-shell.js`
- M44: `src/ui/security/reset-readable-screen.tsx → ../records/values.js`
- M47: `src/ui/security/vault-dialogs.tsx → ../durability/durability.module.css`

### M42

- M37: `src/ui/library/library-screen.tsx → ../../application/view-models/durability.js`
- M38: `src/ui/library/empty-library-screen.tsx → ../primitives/button.js`
- M40: `src/ui/library/library-screen.tsx → ../theme/app-theme.js`
- M41: `src/ui/library/empty-library-screen.tsx → ../security/frames.js`

### M43

- M38: `src/ui/import/delimited-target-screen.tsx → ../primitives/button.js`
- M41: `src/ui/import/delimited-target-screen.tsx → ../security/frames.js`

### M44

- M37: `src/ui/records/app-frame.tsx → ../../application/view-models/durability.js`
- M38: `src/ui/records/app-frame.tsx → ../primitives/class-names.js`
- M39: `src/ui/records/app-frame.tsx → ../layout/app-shell.js`
- M40: `src/ui/records/app-frame.tsx → ../theme/app-theme.js`
- M45: `src/ui/records/app-home-screen.tsx → ../charts/chart-figure.js`

### M45

- M37: `src/ui/charts/chart-builder-screen.tsx → ../../application/view-models/records.js`
- M38: `src/ui/charts/accessibility-view-sheet.tsx → ../primitives/button.js`
- M44: `src/ui/charts/accessibility-view-sheet.tsx → ../records/values.js`

### M46

- M37: `src/ui/schema/app-settings-screen.tsx → ../../application/view-models/schema.js`
- M38: `src/ui/schema/app-settings-screen.tsx → ../primitives/button.js`
- M40: `src/ui/schema/app-settings-screen.tsx → ../theme/app-theme.js`
- M44: `src/ui/schema/app-settings-screen.tsx → ../records/app-frame.js`

### M47

- M37: `src/ui/durability/home-screen.tsx → ../../application/view-models/durability.js`
- M38: `src/ui/durability/bundle-save-dialog.tsx → ../primitives/class-names.js`
- M44: `src/ui/durability/home-screen.tsx → ../records/app-frame.js`

### M50

- M10: `src/config/public-config.ts → ../migrations/index.js`

### M53

- M32: `src/bootstrap/app-bootstrap.ts → ../workers/protocol/io-client.js`
- M51: `src/bootstrap/app-bootstrap.ts → ../platform/file-save.js`
- Worker URL construction (not an import), M33: `src/bootstrap/app-bootstrap.ts → ../workers/data.worker.ts`

### M54

- M08: `src/routes/app-runtime.tsx → ../crypto/recovery-code.js`
- M36: `src/routes/app-runtime.tsx → ../application/workflows/services.js`
- M37: `src/routes/app-area-hooks.tsx → ../application/view-models/records.js`
- M38: `src/routes/chart-routes.tsx → ../ui/primitives/busy-indicator.js`
- M41: `src/routes/durability-routes.tsx → ../ui/security/vault-dialogs.js`
- M42: `src/routes/route-table.tsx → ../ui/library/empty-library-screen.js`
- M43: `src/routes/route-table.tsx → ../ui/import/delimited-target-screen.js`
- M44: `src/routes/app-area-hooks.tsx → ../ui/records/table-switcher-sheet.js`
- M45: `src/routes/chart-routes.tsx → ../ui/charts/chart-builder-screen.js`
- M46: `src/routes/schema-routes.tsx → ../ui/schema/app-settings-screen.js`
- M47: `src/routes/durability-routes.tsx → ../ui/durability/bundle-save-dialog.js`
- M51: `src/routes/route-table.tsx → ../platform/clipboard.js`
- M53: `src/routes/app-runtime.tsx → ../bootstrap/app-bootstrap.js`

### M55

- M40: `src/main.tsx → ./ui/theme/base.css`
- M54: `src/main.tsx → ./routes/route-table.js`

### M56

- M01: `tests/unit/commands/fakes.ts → ../../../src/domain/model/ids.js`
- M08: `tests/unit/projection/query-fixture.ts → ../../../src/crypto/hash.js`
- M09: `tests/unit/staging/fakes.ts → ../../../src/persistence/codecs/envelope-frame.js`
- M10: `tests/unit/envelope-store/local-store.ts → ../../../src/migrations/001_local_store_v1.js`
- M11: `tests/unit/envelope-store/local-store.ts → ../../../src/persistence/envelope-store/db.js`
- M12: `tests/unit/projection/query-fixture.ts → ../../../src/persistence/projection/index.js`
- M13: `tests/unit/import/biff/spy.ts → ../../../../src/import/source/cfb.js`
- M14: `tests/unit/staging/workbook-streams.ts → ../../../src/import/preflight/workbook.js`
- M15: `tests/unit/import/inference/demo-harness.ts → ../../../../src/import/formats/ooxml/index.js`
- M19: `tests/unit/import/parse-harness.ts → ../../../src/import/formats/delimited/parse.js`
- M21: `tests/unit/import/delimited-proposal.ts → ../../../src/import/inference/infer.js`
- M23: `tests/unit/import/delimited-proposal.ts → ../../../src/import/staging/formula-identities.js`
- M32: `tests/unit/workers/data-worker.ts → ../../../src/workers/protocol/stage-channel.js`
- M33: `tests/unit/staging/workbook-streams.ts → ../../../src/workers/import/adapters.js`
- M36: `tests/unit/ui/import/demo-review.ts → ../../../../src/application/workflows/import.machine.js`
- M37: `tests/unit/ui/import/demo-review.ts → ../../../../src/application/view-models/import.js`
- M58: `tests/unit/import/biff/ptg-cases.ts → ../../../fixtures/workbooks/biff/ptg-writer.js`
- M65: `tests/unit/import/delimited-proposal.ts → ../../../src/import/facts/index.js`

### M57

- M03: `tests/property/formulas/printer.ts → ../../../src/domain/formulas/index.js`

### M58

- M17: `tests/fixtures/workbooks/xlsb/build-fidelity.ts → ../../../../src/import/formats/biff/ptg.js`

### M59

- M01: `tests/fixtures/vaults/f05/helpers.ts → ../../../../src/domain/model/bytes.js`
- M08: `tests/fixtures/vaults/f05/helpers.ts → ../../../../src/crypto/envelope.js`
- M09: `tests/fixtures/vaults/f05/helpers.ts → ../../../../src/persistence/codecs/envelope-frame.js`
- M23: `tests/fixtures/vaults/f05/publication.ts → ../../../../src/import/staging/roots.js`
- M24: `tests/fixtures/vaults/f05/generate.ts → ../../../../src/sync/protocol/publication.js`

### M60

- M01: `tests/browser/projection/fixtures/projection.worker.ts → ../../../../src/domain/model/ids.js`
- M08: `tests/browser/projection/fixtures/projection.worker.ts → ../../../../src/crypto/hash.js`
- M09: `tests/browser/sync/fixtures/bundle-reader.worker.ts → ../../../../src/persistence/codecs/canonical-cbor.js`
- M12: `tests/browser/projection/fixtures/projection.worker.ts → ../../../../src/persistence/projection/index.js`
- M27: `tests/browser/sync/fixtures/bundle-reader.worker.ts → ../../../../src/sync/providers/bundle/reader.js`
- M33: `tests/browser/sync/fixtures/bundle-reader.worker.ts → ../../../../src/workers/data/import-handlers.js`
- M40: `tests/browser/sync/fixtures/save-dialog.entry.tsx → ../../../../src/ui/theme/tokens.css`
- M47: `tests/browser/sync/fixtures/save-dialog.entry.tsx → ../../../../src/ui/durability/bundle-save-dialog.js`

### M62

- M01: `tests/provider-contract/shared/double.ts → ../../../src/domain/model/bytes.js`
- M08: `tests/provider-contract/shared/double.ts → ../../../src/crypto/hash.js`
- M09: `tests/provider-contract/shared/double.ts → ../../../src/persistence/codecs/envelope-frame.js`

## Scope and continuation changes

New runtime edges include M27→M24 (artifact authentication), M33→M05 (reminder policy), M37→M05 (freshness), M42→M37 (status selector), M47→M37/M38/M44 (durability surfaces), M54→M47 (mounted routes), and M60's production decoder/UI fixture dependencies. M05 itself has no runtime imports. Edges describe actual coupling, not architectural permission or live provider qualification.

**S06 compaction (`084ecf9`→`2d8ff2d`, CAP-44):** three new M12 internal files
(`checkpoint-export.ts`, `evidence-events.ts`, `checkpoint-history.ts`; count
16 → 19) and one new M33 internal file (`data/compaction.ts`; count 22 → 23).
Both AST-scanned: every value import in the four new files resolves to a
module already in that module's existing edge set (M01/M08/M09/M10/M12/M23
for M33's `compaction.ts`; M01/M02/M03/M09/M10 for M12's three files) — **no
new module-level edge was created**, only new files inside already-declared
edges. Re-scanned against the same methodology as the rest of this table, not
inferred from the delta prose alone.

Root manifests, `src/harness/**`, generated `dist/` and public assets remain owner-seam paths from PROGRAM-CONFIG, without new module IDs. An empty directory does not establish a producer.
