/**
 * The projection engine inside a real dedicated module worker — the context it
 * actually runs in (M12: "Runs only in `src/workers/data.worker.ts`").
 *
 * S05 composes M12 into the data worker; until that worker exists, this fixture
 * is the proof that the module graph, the WASM instantiation, and the migration
 * asset all resolve inside a worker rather than only on the main thread. It is
 * built through the production `vite.config.ts` (see the spec), so the worker
 * pipeline under test is the shipped one.
 *
 * It lives under `tests/` rather than `src/`: the product tree gains no file
 * for a toolchain proof, and M12 must never ship a worker entry of its own.
 */

import { sha256 } from "../../../../src/crypto/hash.js";
import { asDomainId } from "../../../../src/domain/model/ids.js";
import { asStorageId16 } from "../../../../src/domain/model/bytes.js";
import { APP_THEME_TOKENS } from "../../../../src/domain/model/events.js";
import type { AppThemeTokenV1 } from "../../../../src/domain/model/events.js";
import { decimalValue, textValue } from "../../../../src/domain/model/values.js";
import {
  disposeProjection,
  hydrateApp,
  openProjection,
} from "../../../../src/persistence/projection/index.js";
import type { ProjectionCheckpointV1 } from "../../../../src/persistence/projection/index.js";
import { selectRows } from "../../../../src/persistence/projection/engine.js";

export interface ProjectionWorkerResultV1 {
  readonly userVersion: number;
  readonly recordCount: number;
  readonly decimalKeyBytes: number;
  readonly searchHit: number;
  readonly memoryOnly: boolean;
  readonly disposedAfterClose: boolean;
}

const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);

const buildCheckpoint = (): ProjectionCheckpointV1 => {
  const appId = asDomainId("app", bytes(1));
  const tableId = asDomainId("table", bytes(2));
  const nameField = {
    fieldId: asDomainId("field", bytes(3)),
    tableId,
    displayName: "Name",
    fieldOrdinal: 0,
    type: { kind: "text" } as const,
    isRequired: true,
    isActive: true,
    schemaRevision: 1n,
  };
  const amountField = {
    fieldId: asDomainId("field", bytes(4)),
    tableId,
    displayName: "Amount",
    fieldOrdinal: 1,
    type: { kind: "number" } as const,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  };
  const commitId = asDomainId("commit", bytes(5));

  return {
    appId,
    checkpointStorageId: asStorageId16(bytes(6)),
    checkpointSemanticSha256: new Uint8Array(32).fill(7),
    frontier: [{ deviceId: bytes(8), commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId,
      displayName: "Worker app",
      createdAtMs: 1_699_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 0,
      theme: {
        themeKey: "sheaf.built-in.slate",
        tokens: Object.fromEntries(
          APP_THEME_TOKENS.map((token) => [token, "#101010"]),
        ) as Record<AppThemeTokenV1, string>,
      },
      stateRevision: 0n,
    },
    sheetSnapshots: [],
    tables: [
      {
        tableId,
        displayName: "Rows",
        tableOrdinal: 0,
        fields: [nameField, amountField],
        keyFieldId: null,
        labelFieldId: nameField.fieldId,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    enumOptions: [],
    validationRules: [],
    recordPages: [
      {
        records: [9, 10].map((fill) => ({
          record: {
            recordId: asDomainId("record", bytes(fill)),
            tableId,
            values: new Map([
              [nameField.fieldId, textValue(`Row ${fill}`)],
              [amountField.fieldId, decimalValue(`${fill}.25`)],
            ]),
            provenance: new Map(),
          },
          recordRevision: 0n,
          createdCommitId: commitId,
          updatedCommitId: commitId,
          issues: [],
        })),
      },
    ],
  };
};

const probe = async (): Promise<ProjectionWorkerResultV1> => {
  const handle = await openProjection({ sha256 });
  await hydrateApp(handle, buildCheckpoint());

  const value = (sql: string): number =>
    Number(selectRows(handle, sql)[0]?.[0] ?? -1);

  const decimalKeyBytes = value(
    "SELECT length(decimal_order_key) FROM cells WHERE value_kind = 'decimal' LIMIT 1",
  );
  const searchHit = value(
    `SELECT count(*) FROM record_search
       JOIN records AS r ON r.record_pk = record_search.rowid
      WHERE record_search MATCH '"Row"*'`,
  );
  const result = {
    userVersion: value("PRAGMA user_version"),
    recordCount: value("SELECT count(*) FROM records"),
    decimalKeyBytes,
    searchHit,
    // A `:memory:` database has no file, so its filename is the empty string.
    memoryOnly:
      selectRows(handle, "SELECT file FROM pragma_database_list()")[0]?.[0] === "",
    disposedAfterClose: false,
  };

  disposeProjection(handle);
  let disposedAfterClose = false;
  try {
    selectRows(handle, "SELECT count(*) FROM records");
  } catch (cause) {
    disposedAfterClose = String(cause).includes("disposed");
  }

  return { ...result, disposedAfterClose };
};

void probe().then(
  (result) => {
    self.postMessage({ ok: true, result });
  },
  (cause: unknown) => {
    self.postMessage({ ok: false, reason: String(cause) });
  },
);
