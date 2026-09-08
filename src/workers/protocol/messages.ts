/**
 * The versioned data-worker RPC contract (CA-04).
 *
 * Everything on this wire is text, numbers, booleans, or a union of them: no
 * key handle, no passphrase, no raw payload and no repository object appears
 * in a response type, and a locked response carries no decrypted value at all.
 * That is a type-level guarantee, not a review note —
 * `tests/unit/workers/module-boundaries.test.ts` fails if this file ever names
 * a byte array or a key type.
 *
 * Errors cross as {@link DataWorkerErrorV1}: a closed kind plus, where the
 * caller must render a wait, `retryAfterMs`. Consumers render that number;
 * they never recompute the schedule (CA-05).
 */

export const PROTOCOL_VERSION = 1;

/**
 * The approved idle-timeout choices (FR-22, SCR-005's select). `0` is off and
 * is the product default; a free-form number is never accepted.
 */
export const IDLE_TIMEOUT_MINUTES_V1 = Object.freeze([0, 5, 15, 60] as const);

export type IdleTimeoutMinutesV1 = (typeof IDLE_TIMEOUT_MINUTES_V1)[number];

export function isIdleTimeoutMinutesV1(
  value: unknown,
): value is IdleTimeoutMinutesV1 {
  return (IDLE_TIMEOUT_MINUTES_V1 as readonly unknown[]).includes(value);
}

// --- requests ---------------------------------------------------------------

export interface SetupRequestV1 {
  readonly kind: "setup";
  readonly passphrase: string;
}

export interface UnlockRequestV1 {
  readonly kind: "unlock";
  readonly passphrase: string;
}

export interface UnlockWithRecoveryCodeRequestV1 {
  readonly kind: "unlockWithRecoveryCode";
  readonly recoveryCode: string;
}

/**
 * A passphrase change is authorized either by the current passphrase (SCR-006)
 * or by a session that was unlocked with the recovery code, which must install
 * a new passphrase before it can be used for anything else (CAP-05).
 */
export type PassphraseChangeAuthorizationV1 =
  | { readonly via: "current-passphrase"; readonly currentPassphrase: string }
  | { readonly via: "recovery" };

export interface ChangePassphraseRequestV1 {
  readonly kind: "changePassphrase";
  readonly authorization: PassphraseChangeAuthorizationV1;
  readonly nextPassphrase: string;
}

export interface RevealRecoveryCodeRequestV1 {
  readonly kind: "revealRecoveryCode";
  readonly currentPassphrase: string;
}

export interface LockRequestV1 {
  readonly kind: "lock";
}

export interface UpdateSettingsRequestV1 {
  readonly kind: "updateSettings";
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
}

export interface ResetLockedRequestV1 {
  readonly kind: "resetLocked";
}

/**
 * Two phases, one command. Without a token the worker recomputes the inventory
 * and issues a token bound to it; with a token it recomputes again and purges
 * only if both the token and the session's own view still match what storage
 * says (database.md § `LocalCatalogV1` check 7).
 */
export interface ResetReadableRequestV1 {
  readonly kind: "resetReadable";
  readonly confirmToken?: string;
}

export interface GetStatusRequestV1 {
  readonly kind: "getStatus";
}

/**
 * The import flow's facts, as the page already knows them (CA-12). Everything
 * here is text and numbers: the file's **bytes never cross this boundary** —
 * they ride the `MessageChannel` the page creates, straight from the import
 * worker to the data worker (D17).
 *
 * The channel's `port2` travels in this request's **transfer list**, not in
 * its body. A port is transferable, not a byte type, and naming one here would
 * put `MessagePort` into a union that must stay describable in text — so the
 * wire type says nothing about it and `client.send(request, [port2])` carries
 * it. No response ever returns a port.
 *
 * A file **name** is page-known and is allowed in import-flow messages only;
 * no other request or response may name one, and none may name a cell value.
 */
export interface DetectedDelimitedV1 {
  readonly kind: "delimited";
  readonly delimiter: string;
  readonly encoding: string;
  readonly bomByteLength: number;
  readonly newline: string;
}

export interface ImportPreflightFactsV1 {
  readonly columnCount: number;
  readonly estimatedRowCount: number;
  readonly estimatedCellCount: number;
  /** Always `true`: a bounded sample cannot know a count exactly (D24). */
  readonly isEstimate: true;
  readonly sampleRows: readonly (readonly string[])[];
  readonly bytesSampled: number;
  readonly sourceByteLength: number;
}

export interface BeginImportStageRequestV1 {
  readonly kind: "beginImportStage";
  readonly fileName: string;
  readonly detected: DetectedDelimitedV1;
  readonly preflight: ImportPreflightFactsV1;
}

export interface GetImportStageRequestV1 {
  readonly kind: "getImportStage";
  readonly stageId: string;
}

export interface PromoteImportRequestV1 {
  readonly kind: "promoteImport";
  readonly stageId: string;
  readonly acceptedName: string;
}

export interface ListLibraryRequestV1 {
  readonly kind: "listLibrary";
}

export interface CancelImportStageRequestV1 {
  readonly kind: "cancelImportStage";
  readonly stageId: string;
}

export interface RunInferenceRequestV1 {
  readonly kind: "runInference";
  readonly stageId: string;
}

/**
 * One review edit, mirroring S03's `ReviewEditV1`. The union is closed and
 * every member is text or a number, so a malformed edit is a shape the wire
 * cannot express rather than a value a handler must defend against.
 */
export type ReviewEditWireV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableName: string }
  | {
      readonly kind: "rename-field";
      readonly columnIndex: number;
      readonly fieldName: string;
    }
  | {
      readonly kind: "override-type";
      readonly columnIndex: number;
      readonly type: ProposedFieldTypeWireV1;
    }
  | { readonly kind: "set-header-row"; readonly rowIndex: number | null }
  | {
      readonly kind: "edit-enum-options";
      readonly columnIndex: number;
      readonly options: readonly string[];
    };

export interface ApplyReviewEditRequestV1 {
  readonly kind: "applyReviewEdit";
  readonly stageId: string;
  readonly edit: ReviewEditWireV1;
}

/**
 * One cell value on the wire (CA-12, D28).
 *
 * The mapping to the domain is pinned here and implemented once, in the data
 * worker's wire→domain boundary:
 *
 * | wire                            | domain                       |
 * |---------------------------------|------------------------------|
 * | `{kind:"text", text}`           | `text`, NFC-normalized here  |
 * | `{kind:"number", decimal}`      | `decimal` (canonical string) |
 * | `{kind:"boolean", boolean}`     | `boolean`                    |
 * | `{kind:"option", optionId}`     | `enum`                       |
 * | `{kind:"date", epochDay}`       | `date` (signed epoch day)    |
 * | `{kind:"blank"}`                | `blank`                      |
 * | `{kind:"missing"}`              | `missing`                    |
 * | `{kind:"invalid", sourceText}`  | `invalid-preserved` (read)   |
 * | `{kind:"reference", recordId}`  | `reference` (read; F03)      |
 *
 * **A number is a string.** There are no floats anywhere in Sheaf's value
 * domain, so a decimal crosses as the exact text that was authored; a JSON
 * number would round `10.50` into a different value on the way past.
 *
 * **The three absent states stay three.** `missing` (never given a value),
 * `blank` (deliberately cleared), and `invalid` (an imported value preserved
 * verbatim and flagged) are distinct kinds, because collapsing any two of them
 * would lose what a person needs to see (FR-4).
 *
 * **`invalid` and `reference` are read-only by type.** {@link AuthoredCellWireValueV1}
 * excludes them, and every write request is typed by that union — so a client
 * cannot author a preserved-invalid value, which only an import can produce,
 * and cannot author a reference F02 has no producer for (D25).
 */
export type CellWireValueV1 =
  | { readonly kind: "text"; readonly text: string }
  /** Canonical decimal text: no exponent, no float, exact as authored. */
  | { readonly kind: "number"; readonly decimal: string }
  | { readonly kind: "boolean"; readonly boolean: boolean }
  | { readonly kind: "option"; readonly optionId: string }
  | { readonly kind: "date"; readonly epochDay: number }
  | { readonly kind: "blank" }
  | { readonly kind: "missing" }
  /** The source text an import kept rather than coerced (FR-4/FR-6). */
  | { readonly kind: "invalid"; readonly sourceText: string }
  | { readonly kind: "reference"; readonly recordId: string };

export type AuthoredCellWireValueV1 = Exclude<
  CellWireValueV1,
  { readonly kind: "invalid" } | { readonly kind: "reference" }
>;

export interface CellWireEntryV1 {
  readonly fieldId: string;
  readonly value: CellWireValueV1;
}

export interface AuthoredCellWireEntryV1 {
  readonly fieldId: string;
  readonly value: AuthoredCellWireValueV1;
}

export interface OpenAppRequestV1 {
  readonly kind: "openApp";
  readonly appId: string;
}

export interface CloseAppRequestV1 {
  readonly kind: "closeApp";
  readonly appId: string;
}

/**
 * Records the moment an app was opened. It updates a cache in the catalog and
 * authors **no event**: database.md § Events that do not exist rules out a
 * last-opened event, so this is an operational write and nothing more.
 */
export interface NoteAppOpenedRequestV1 {
  readonly kind: "noteAppOpened";
  readonly appId: string;
}

export interface QueryRecordsRequestV1 {
  readonly kind: "queryRecords";
  readonly appId: string;
  readonly tableId: string;
  /** The previous page's `nextCursor`; absent starts at the beginning. */
  readonly cursor?: number | null;
  readonly limit?: number;
  /** Absent or blank browses the table; text searches within it. */
  readonly search?: string | null;
}

export interface GetRecordRequestV1 {
  readonly kind: "getRecord";
  readonly appId: string;
  readonly recordId: string;
}

export interface CreateRecordRequestV1 {
  readonly kind: "createRecord";
  readonly appId: string;
  readonly tableId: string;
  readonly values: readonly AuthoredCellWireEntryV1[];
}

export interface PatchRecordRequestV1 {
  readonly kind: "patchRecord";
  readonly appId: string;
  readonly recordId: string;
  readonly changes: readonly AuthoredCellWireEntryV1[];
}

export interface DeleteRecordRequestV1 {
  readonly kind: "deleteRecord";
  readonly appId: string;
  readonly recordId: string;
}

export interface RestoreRecordRequestV1 {
  readonly kind: "restoreRecord";
  readonly appId: string;
  readonly recordId: string;
}

export interface ChangeHistoryCursorWireV1 {
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly eventId: string;
}

export interface GetChangeHistoryRequestV1 {
  readonly kind: "getChangeHistory";
  readonly appId: string;
  readonly cursor?: ChangeHistoryCursorWireV1 | null;
  readonly limit?: number;
}

export type DataWorkerRequestV1 =
  | SetupRequestV1
  | UnlockRequestV1
  | UnlockWithRecoveryCodeRequestV1
  | ChangePassphraseRequestV1
  | RevealRecoveryCodeRequestV1
  | LockRequestV1
  | UpdateSettingsRequestV1
  | ResetLockedRequestV1
  | ResetReadableRequestV1
  | GetStatusRequestV1
  | BeginImportStageRequestV1
  | GetImportStageRequestV1
  | RunInferenceRequestV1
  | ApplyReviewEditRequestV1
  | PromoteImportRequestV1
  | ListLibraryRequestV1
  | CancelImportStageRequestV1
  | OpenAppRequestV1
  | CloseAppRequestV1
  | NoteAppOpenedRequestV1
  | QueryRecordsRequestV1
  | GetRecordRequestV1
  | CreateRecordRequestV1
  | PatchRecordRequestV1
  | DeleteRecordRequestV1
  | RestoreRecordRequestV1
  | GetChangeHistoryRequestV1;

export type DataWorkerRequestKindV1 = DataWorkerRequestV1["kind"];

// --- views ------------------------------------------------------------------

export type UnlockMethodV1 = "passphrase" | "recovery-code";

export interface LocalSettingsViewV1 {
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
}

/**
 * What the page may know while unlocked: counts, revisions, and the settings
 * the user chose. No app content exists in F01, and none of these fields can
 * hold one when it does.
 */
export interface UnlockedSessionViewV1 {
  readonly state: "unlocked";
  readonly unlockedVia: UnlockMethodV1;
  readonly settings: LocalSettingsViewV1;
  readonly catalogRevision: number;
  readonly transactionRevision: number;
  readonly appCount: number;
  readonly homeCount: number;
}

/**
 * The locked view is deliberately almost empty: `uninitialized` means no
 * bootstrap row exists, and `retryAfterMs` is present only while an unlock
 * attempt would be refused (CA-05).
 */
export interface LockedSessionViewV1 {
  readonly state: "locked" | "uninitialized";
  readonly retryAfterMs?: number;
}

export type SessionStatusViewV1 = LockedSessionViewV1 | UnlockedSessionViewV1;

/**
 * One app as a readable reset would list it. F01 has no producer for this
 * shape — the list is always empty — and the confirmation must say so rather
 * than implying an unknown number (FR-23).
 */
export interface ResetInventoryAppV1 {
  readonly appId: string;
  readonly displayName: string;
  readonly deviceOnlyChangeCount: number;
}

export interface ResetInventoryViewV1 {
  readonly apps: readonly ResetInventoryAppV1[];
  readonly appCount: number;
  readonly homeCount: number;
}

// --- responses --------------------------------------------------------------

export interface SetupResponseV1 {
  readonly kind: "setup";
  /** Shown once, at setup. It is never returned again except by CAP-06. */
  readonly recoveryCode: string;
  readonly session: UnlockedSessionViewV1;
}

export interface UnlockResponseV1 {
  readonly kind: "unlock";
  readonly session: UnlockedSessionViewV1;
}

export interface UnlockWithRecoveryCodeResponseV1 {
  readonly kind: "unlockWithRecoveryCode";
  readonly session: UnlockedSessionViewV1;
}

export interface ChangePassphraseResponseV1 {
  readonly kind: "changePassphrase";
  readonly session: UnlockedSessionViewV1;
}

export interface RevealRecoveryCodeResponseV1 {
  readonly kind: "revealRecoveryCode";
  readonly recoveryCode: string;
}

export interface LockResponseV1 {
  readonly kind: "lock";
  /** The ack the page waits for before it terminates the worker (CAP-03). */
  readonly status: LockedSessionViewV1;
}

export interface UpdateSettingsResponseV1 {
  readonly kind: "updateSettings";
  readonly settings: LocalSettingsViewV1;
  readonly session: UnlockedSessionViewV1;
}

export interface ResetLockedResponseV1 {
  readonly kind: "resetLocked";
  readonly purged: true;
}

export type ResetReadableResponseV1 =
  | {
      readonly kind: "resetReadable";
      readonly phase: "inventory";
      readonly inventory: ResetInventoryViewV1;
      readonly confirmToken: string;
    }
  | {
      readonly kind: "resetReadable";
      readonly phase: "purged";
      readonly purged: true;
    };

export interface GetStatusResponseV1 {
  readonly kind: "getStatus";
  readonly status: SessionStatusViewV1;
}

/**
 * Beginning a stage answers with its id and **nothing else** (D17). The page
 * already holds the port it created; a response that carried one back would
 * make the channel's direction a runtime detail instead of a fixed fact.
 */
export interface BeginImportStageResponseV1 {
  readonly kind: "beginImportStage";
  readonly stageId: string;
}

/**
 * The "nothing was left behind" fact the cancel surface renders (CAP-11).
 * `completed` is the literal `true`: this response is only produced after
 * every ticketed row is absent, so a partial cleanup is not expressible.
 */
export interface ImportCleanupReceiptViewV1 {
  readonly reason: string;
  readonly deletedCount: number;
  readonly completed: true;
}

/**
 * S03's proposal, restated structurally (CA-16 shapes, verbatim).
 *
 * It is restated rather than imported because `messages.ts` imports **nothing
 * at all** — a property `tests/unit/workers/module-boundaries.test.ts` pins,
 * and the reason the wire contract can be read without following a single
 * reference. The cost of a second copy is drift, so
 * `tests/unit/workers/proposal-wire.test.ts` asserts the two are assignable in
 * both directions: a divergence is a compile error there, not a wire mismatch
 * at review.
 *
 * Nothing here is a byte type, a key, or a cell value: a proposal describes
 * *columns*, and the only user data in it is the leading rows the review
 * screen already shows and the handful of examples its evidence names.
 */
export type ProposedFieldTypeWireV1 =
  | { readonly kind: "date" }
  | { readonly kind: "currency"; readonly currencyCode: string }
  | { readonly kind: "number" }
  | { readonly kind: "phone" }
  | { readonly kind: "email" }
  | { readonly kind: "url" }
  | { readonly kind: "address" }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum" }
  | { readonly kind: "text" };

export type SourceValueFormatWireV1 =
  | { readonly kind: "text" }
  | { readonly kind: "iso-date" }
  | { readonly kind: "slash-date"; readonly order: "dmy" | "mdy" }
  | { readonly kind: "decimal"; readonly currencySymbol: string | null }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum" };

/** S03's closed sets, restated as literal unions — never widened to `string`. */
export type InferenceSubjectWireV1 =
  | "app-name"
  | "table-name"
  | "header-row"
  | "discarded-rows"
  | "field-name"
  | "field-type"
  | "enum-options";

export type ReviewEditKindWireV1 =
  | "rename-app"
  | "rename-table"
  | "rename-field"
  | "override-type"
  | "set-header-row"
  | "edit-enum-options";

export type ValuePatternWireV1 =
  | "iso-date"
  | "slash-date"
  | "currency-amount"
  | "decimal-number"
  | "boolean-word"
  | "email-address"
  | "web-url"
  | "telephone-number";

export type ImportDiagnosticCodeWireV1 =
  | "text-normalized-nfc"
  | "unterminated-quote"
  | "quote-inside-unquoted-field"
  | "ragged-row"
  | "replacement-character"
  | "row-length-bound-reached";

export type EvidenceWireV1 =
  | {
      readonly kind: "value-pattern";
      readonly pattern: ValuePatternWireV1;
      readonly detail: string | null;
      readonly matched: number;
      readonly sampled: number;
      readonly examples: readonly string[];
    }
  | {
      readonly kind: "distinct-values";
      readonly distinct: number;
      readonly sampled: number;
      readonly options: readonly string[];
    }
  | {
      readonly kind: "header-text";
      readonly rowIndex: number;
      readonly text: string;
    }
  | { readonly kind: "file-name"; readonly fileName: string }
  | {
      readonly kind: "row-shape";
      readonly rowIndex: number;
      readonly cellCount: number;
      readonly valueCount: number;
    }
  | {
      readonly kind: "value-conflict";
      readonly count: number;
      readonly examples: readonly {
        readonly rowIndex: number;
        readonly sourceText: string;
      }[];
    };

export interface InferenceStatementWireV1 {
  readonly statementId: string;
  readonly subject: InferenceSubjectWireV1;
  readonly editKind: ReviewEditKindWireV1 | null;
  readonly columnIndex: number | null;
  readonly evidence: readonly EvidenceWireV1[];
  readonly evidenceFingerprint: string;
  readonly disposition: "accepted" | "rejected" | "edited";
}

export interface ImportDiagnosticWireV1 {
  readonly code: ImportDiagnosticCodeWireV1;
  readonly severity: "info" | "warning";
  readonly firstRowIndex: number | null;
  readonly firstColumnIndex: number | null;
  readonly occurrences: number;
}

export interface ProposedFieldWireV1 {
  readonly columnIndex: number;
  readonly fieldName: string;
  readonly isNameGenerated: boolean;
  readonly type: ProposedFieldTypeWireV1;
  readonly sourceFormat: SourceValueFormatWireV1;
  readonly enumOptions: readonly {
    readonly label: string;
    readonly occurrences: number;
  }[];
  /** Null means "not measured yet", never "none" (S03). */
  readonly violations: {
    readonly count: number;
    readonly examples: readonly {
      readonly rowIndex: number;
      readonly sourceText: string;
    }[];
  } | null;
}

export interface ProposedAppWireV1 {
  readonly fileName: string;
  readonly appName: string;
  readonly table: {
    readonly tableName: string;
    readonly fields: readonly ProposedFieldWireV1[];
  };
  readonly headerRowIndex: number | null;
  readonly leadingRows: readonly {
    readonly rowIndex: number;
    readonly cells: readonly string[];
  }[];
  readonly discardedRows: readonly {
    readonly rowIndex: number;
    readonly reason: "above-header" | "empty-row";
    readonly cells: readonly string[];
  }[];
  readonly discardedRowCount: number;
  readonly rowCount: number;
  /** Always `true`: a proposal comes from a completed stream (D24). */
  readonly isRowCountExact: true;
  readonly statements: readonly InferenceStatementWireV1[];
  readonly diagnostics: readonly ImportDiagnosticWireV1[];
}

/**
 * A stage's progress and terminal status. Counts only — no cell value, and no
 * file content: the name is the one page-known fact the import flow may echo.
 */
export interface ImportStageViewV1 {
  readonly stageId: string;
  readonly fileName: string;
  readonly status: string;
  readonly phase: string;
  readonly rowsSoFar: number;
  /** Batches that are durable, which is the same as batches that were acked. */
  readonly batchesCommitted: number;
  readonly ackedBatchSeq: number | null;
  readonly factChunkCount: number;
  readonly hasProposal: boolean;
}

export interface GetImportStageResponseV1 {
  readonly kind: "getImportStage";
  /** Null when no live stage carries this id — swept, cancelled, or never. */
  readonly stage: ImportStageViewV1 | null;
}

export interface RunInferenceResponseV1 {
  readonly kind: "runInference";
  readonly proposal: ProposedAppWireV1;
}

/**
 * An edit that could not land comes back as a **result**, not an error (D23):
 * the stage relays S03's rejection reason and never coerces it into something
 * that applied (CA-16).
 */
export type ApplyReviewEditResponseV1 =
  | {
      readonly kind: "applyReviewEdit";
      readonly outcome: "applied";
      readonly proposal: ProposedAppWireV1;
    }
  | {
      readonly kind: "applyReviewEdit";
      readonly outcome: "rejected";
      readonly reason: string;
    };

/**
 * A library tile's facts (CA-09/CAP-14). Counts are the catalog's cache and
 * are rendered, never trusted for a destructive action: removal and reset
 * recompute from the decrypted head (check 7).
 */
export interface LibraryAppV1 {
  readonly appId: string;
  readonly displayName: string;
  readonly accentId: string;
  readonly glyph: string;
  readonly createdAtEpochMs: number;
  readonly lastOpenedAtEpochMs: number | null;
  readonly rowCountCache: number | null;
  readonly tableCount: number;
  /** `true` while the app has no durable home — the persistent scratch fact. */
  readonly isScratch: boolean;
}

export interface ListLibraryResponseV1 {
  readonly kind: "listLibrary";
  readonly apps: readonly LibraryAppV1[];
}

/**
 * Promotion answers with the new app, or with a typed refusal the review
 * screen can act on (D23). A refusal wrote nothing: there is no half-app to
 * withdraw, which is the "no partial app" guarantee stated as a return type.
 */
export type PromoteImportResponseV1 =
  | {
      readonly kind: "promoteImport";
      readonly outcome: "promoted";
      readonly appId: string;
      readonly rowCount: number;
      readonly tableCount: number;
      /** Rows kept and flagged rather than refused (FR-4/FR-6). */
      readonly flaggedRecordCount: number;
    }
  | {
      readonly kind: "promoteImport";
      readonly outcome: "rejected";
      readonly reason: string;
      /** The whole report, so the surface can name every field at fault. */
      readonly issues: readonly {
        readonly fieldId: string | null;
        readonly kind: string;
        readonly severity: "warning" | "blocking";
        readonly messageKey: string;
      }[];
    };

export interface CancelImportStageResponseV1 {
  readonly kind: "cancelImportStage";
  readonly receipt: ImportCleanupReceiptViewV1;
}

// --- the open app -----------------------------------------------------------

/** The field types a schema may declare; `reference` has no F02 producer (D25). */
export type FieldTypeWireV1 =
  | ProposedFieldTypeWireV1
  | { readonly kind: "reference" };

/**
 * The six semantic theme tokens (design.md § Per-app theming contract). Safety
 * colours — danger, warning, success, focus — are system-owned and are absent
 * here on purpose: a per-app theme cannot make them ambiguous.
 */
export type AppThemeTokenWireV1 =
  | "app-ink"
  | "app-canvas"
  | "app-surface"
  | "app-primary"
  | "app-accent"
  | "app-muted";

export interface AppThemeWireV1 {
  readonly themeKey: string;
  readonly tokens: Readonly<Record<AppThemeTokenWireV1, string>>;
}

export interface AppEnumOptionViewV1 {
  readonly optionId: string;
  readonly label: string;
  readonly optionOrdinal: number;
  readonly isActive: boolean;
}

export interface AppFieldViewV1 {
  readonly fieldId: string;
  readonly displayName: string;
  readonly fieldOrdinal: number;
  readonly type: FieldTypeWireV1;
  readonly isRequired: boolean;
  readonly isActive: boolean;
  /** Empty for every field that is not an enum. */
  readonly enumOptions: readonly AppEnumOptionViewV1[];
}

export interface AppTableViewV1 {
  readonly tableId: string;
  readonly displayName: string;
  readonly tableOrdinal: number;
  readonly recordCount: number;
  /** Always `true`: this count is `count(*)` over the hydrated table (CA-14). */
  readonly isRecordCountExact: true;
  readonly fields: readonly AppFieldViewV1[];
}

/**
 * One opened app, as the page may know it: schema, table list, and counts.
 * There is no record content here — records arrive through `queryRecords`, a
 * page at a time, so opening an app never puts a whole table in the page.
 */
export interface AppSessionViewV1 {
  readonly appId: string;
  readonly displayName: string;
  readonly theme: AppThemeWireV1;
  readonly schemaRevision: number;
  readonly createdAtEpochMs: number;
  readonly lastOpenedAtEpochMs: number | null;
  /** True while the app has no durable home — the persistent scratch fact. */
  readonly isScratch: boolean;
  /** Commits this device holds that no durable home has (CA-09). */
  readonly deviceOnlyChangeCount: number;
  readonly tables: readonly AppTableViewV1[];
}

export interface OpenAppResponseV1 {
  readonly kind: "openApp";
  /** Null when no app carries this id — removed, purged, or never (CA-12). */
  readonly session: AppSessionViewV1 | null;
}

export interface CloseAppResponseV1 {
  readonly kind: "closeApp";
  /** Closing an app that is not open is the same request already answered. */
  readonly closed: true;
}

export interface NoteAppOpenedResponseV1 {
  readonly kind: "noteAppOpened";
  /** Null when no app carries this id; nothing was written. */
  readonly lastOpenedAtEpochMs: number | null;
}

export interface RecordIssueViewV1 {
  /** Null for a whole-record issue. */
  readonly fieldId: string | null;
  readonly kind: string;
  readonly severity: "warning" | "blocking";
  /** Structured; the user-language sentence is a view model's (M37). */
  readonly messageKey: string;
  readonly messageParameters: Readonly<
    Record<string, string | number | boolean>
  >;
}

export interface RecordSummaryViewV1 {
  readonly recordId: string;
  readonly tableId: string;
  readonly recordRevision: number;
  /** Pass back as `cursor`; a row key, never an offset. */
  readonly cursor: number;
  /**
   * The complete authored state, including the values with no typed lane —
   * which is what makes a preserved invalid value visible to the person who
   * has to fix it (FR-6).
   */
  readonly values: readonly CellWireEntryV1[];
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
}

export interface RecordDetailViewV1 extends RecordSummaryViewV1 {
  readonly createdCommitId: string;
  readonly updatedCommitId: string;
  readonly issues: readonly RecordIssueViewV1[];
  /** The fields the projection could index; the rest are authored-only. */
  readonly indexedFieldIds: readonly string[];
}

export type RecordScopeWireV1 =
  | { readonly kind: "table" }
  | { readonly kind: "search"; readonly text: string };

export interface RecordPageViewV1 {
  readonly tableId: string;
  /** What was actually looked at — the sentence an empty state needs. */
  readonly scope: RecordScopeWireV1;
  readonly records: readonly RecordSummaryViewV1[];
  readonly hasMore: boolean;
  readonly nextCursor: number | null;
  /** Live records in the whole table, exact. A search does not narrow it. */
  readonly totalCount: number;
  readonly isTotalExact: true;
}

export interface QueryRecordsResponseV1 {
  readonly kind: "queryRecords";
  /** Null when the app or the table is not there (CA-12 idempotent read). */
  readonly page: RecordPageViewV1 | null;
}

export interface GetRecordResponseV1 {
  readonly kind: "getRecord";
  /** Null when no record carries this id — deleted, or never. */
  readonly record: RecordDetailViewV1 | null;
}

export interface CommandReceiptViewV1 {
  readonly recordId: string;
  readonly tableId: string;
  readonly recordRevision: number;
  /** Null when the command was a truthful no-op and wrote nothing. */
  readonly commitId: string | null;
  readonly headRevision: number | null;
}

/** The whole report, so a surface can name every field at fault (D23). */
export interface ValidationReportViewV1 {
  readonly isValid: false;
  readonly issues: readonly RecordIssueViewV1[];
}

/**
 * A write's outcome. A refusal is a **result**, never a `DataWorkerErrorV1`:
 * the error kinds stay closed and mechanical, and a person who typed something
 * the schema will not take needs the fields named, not a category (D23/CA-04).
 */
export type RecordCommandOutcomeV1 =
  | { readonly outcome: "accepted"; readonly receipt: CommandReceiptViewV1 }
  | { readonly outcome: "rejected"; readonly report: ValidationReportViewV1 }
  | {
      readonly outcome: "unknown-subject";
      readonly subject: "app" | "table" | "record" | "deleted-record";
    };

export type CreateRecordResponseV1 = { readonly kind: "createRecord" } & RecordCommandOutcomeV1;
export type PatchRecordResponseV1 = { readonly kind: "patchRecord" } & RecordCommandOutcomeV1;
export type DeleteRecordResponseV1 = { readonly kind: "deleteRecord" } & RecordCommandOutcomeV1;
export type RestoreRecordResponseV1 = { readonly kind: "restoreRecord" } & RecordCommandOutcomeV1;

export interface ChangeHistoryEntryViewV1 {
  readonly eventId: string;
  readonly commitId: string;
  readonly eventKind: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly recordRevision: number | null;
  /** Which fields moved. The values themselves stay out of a log listing. */
  readonly changedFieldIds: readonly string[];
  /** True when this entry records a delete that still carries its payload. */
  readonly isRestorable: boolean;
}

export interface ChangeHistoryPageViewV1 {
  readonly entries: readonly ChangeHistoryEntryViewV1[];
  readonly hasMore: boolean;
  readonly nextCursor: ChangeHistoryCursorWireV1 | null;
}

export interface GetChangeHistoryResponseV1 {
  readonly kind: "getChangeHistory";
  readonly page: ChangeHistoryPageViewV1 | null;
}

export type DataWorkerResponseV1 =
  | SetupResponseV1
  | UnlockResponseV1
  | UnlockWithRecoveryCodeResponseV1
  | ChangePassphraseResponseV1
  | RevealRecoveryCodeResponseV1
  | LockResponseV1
  | UpdateSettingsResponseV1
  | ResetLockedResponseV1
  | ResetReadableResponseV1
  | GetStatusResponseV1
  | BeginImportStageResponseV1
  | GetImportStageResponseV1
  | RunInferenceResponseV1
  | ApplyReviewEditResponseV1
  | PromoteImportResponseV1
  | ListLibraryResponseV1
  | CancelImportStageResponseV1
  | OpenAppResponseV1
  | CloseAppResponseV1
  | NoteAppOpenedResponseV1
  | QueryRecordsResponseV1
  | GetRecordResponseV1
  | CreateRecordResponseV1
  | PatchRecordResponseV1
  | DeleteRecordResponseV1
  | RestoreRecordResponseV1
  | GetChangeHistoryResponseV1;

/** The response a given request kind produces; the client is typed by it. */
export type ResponseForV1<K extends DataWorkerRequestKindV1> = Extract<
  DataWorkerResponseV1,
  { readonly kind: K }
>;

// --- errors -----------------------------------------------------------------

/**
 * The closed set of facts an error may carry across the boundary. Each kind is
 * a category the UI can render; none of them can name a cell value, a key, a
 * file name, or a passphrase (CA-04).
 */
export const DATA_WORKER_ERROR_KINDS_V1 = Object.freeze([
  "protocol-version-mismatch",
  "unsupported-request",
  "malformed-request",
  "already-initialized",
  "not-initialized",
  "wrong-passphrase",
  "invalid-recovery-code",
  "rate-limited",
  "locked",
  "invalid-setting",
  "revision-conflict",
  "stale-confirmation",
  "integrity",
  "worker-terminated",
  "timeout",
  "internal",
] as const);

export type DataWorkerErrorKindV1 =
  (typeof DATA_WORKER_ERROR_KINDS_V1)[number];

export function isDataWorkerErrorKindV1(
  value: unknown,
): value is DataWorkerErrorKindV1 {
  return (DATA_WORKER_ERROR_KINDS_V1 as readonly unknown[]).includes(value);
}

export interface DataWorkerErrorV1 {
  readonly kind: DataWorkerErrorKindV1;
  /** Milliseconds the caller must wait before retrying; render, never derive. */
  readonly retryAfterMs?: number;
}

// --- envelopes --------------------------------------------------------------

export interface DataWorkerRequestMessageV1 {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: number;
  readonly request: DataWorkerRequestV1;
}

export type DataWorkerResultV1 =
  | { readonly ok: true; readonly response: DataWorkerResponseV1 }
  | { readonly ok: false; readonly error: DataWorkerErrorV1 };

export interface DataWorkerResponseMessageV1 {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: number;
  readonly result: DataWorkerResultV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasEnvelopeShape(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value["protocolVersion"] === PROTOCOL_VERSION &&
    Number.isSafeInteger(value["id"])
  );
}

/**
 * Structured clone delivers `unknown`, so both ends parse rather than trust.
 * The guards check the envelope and the discriminant only: a request whose
 * kind is known but whose payload is wrong is rejected by its handler with a
 * typed `malformed-request`, where the reason is known precisely.
 */
export function isDataWorkerRequestMessageV1(
  value: unknown,
): value is DataWorkerRequestMessageV1 {
  if (!hasEnvelopeShape(value)) {
    return false;
  }
  const request: unknown = value["request"];
  return isRecord(request) && typeof request["kind"] === "string";
}

export function isDataWorkerResponseMessageV1(
  value: unknown,
): value is DataWorkerResponseMessageV1 {
  if (!hasEnvelopeShape(value)) {
    return false;
  }
  const result: unknown = value["result"];
  if (!isRecord(result)) {
    return false;
  }
  if (result["ok"] === true) {
    const response: unknown = result["response"];
    return isRecord(response) && typeof response["kind"] === "string";
  }
  if (result["ok"] === false) {
    const error: unknown = result["error"];
    return isRecord(error) && isDataWorkerErrorKindV1(error["kind"]);
  }
  return false;
}
