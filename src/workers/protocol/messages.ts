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

/** The workbook formats a stage can hold (M65's `WORKBOOK_FORMATS`, restated). */
export type WorkbookFormatWireV1 = "xlsx" | "xlsb" | "xls" | "ods" | "html-table";

/** A workbook, by the container format pre-flight identified from content. */
export interface DetectedWorkbookV1 {
  readonly kind: "workbook";
  readonly format: WorkbookFormatWireV1;
}

/** One inventoried sheet, as the `workbook-preflight` report sized it (CA-18). */
export interface WorkbookSheetSummaryWireV1 {
  readonly sheetIndex: number;
  readonly name: string;
  readonly sheetKind: "worksheet" | "chartsheet" | "dialogsheet";
  readonly visibility: "visible" | "hidden" | "very-hidden";
  /** `null` when nothing declared it — never 0 standing in for unknown. */
  readonly estimatedRowCount: number | null;
  readonly estimatedCellCount: number | null;
}

/**
 * A workbook stage's pre-flight facts: every inventoried sheet (review lists
 * the unselected ones as excluded, D39) and the selection the page will send
 * with `proceed` (D47). Estimates only (D24).
 */
export interface WorkbookStageFactsV1 {
  readonly kind: "workbook";
  readonly sheets: readonly WorkbookSheetSummaryWireV1[];
  readonly selectedSheets: readonly number[];
  readonly sourceByteLength: number;
  readonly isEstimate: true;
}

/**
 * Where an import lands. `existing-app` adds a delimited file to an app as a
 * new table (D38); a workbook always becomes a new app (FR-1's value-only
 * append). The app id is the catalog's text id.
 */
export type ImportDestinationWireV1 =
  | { readonly kind: "new-app" }
  | { readonly kind: "existing-app"; readonly appId: string };

export interface BeginImportStageRequestV1 {
  readonly kind: "beginImportStage";
  readonly fileName: string;
  /** `delimited` pairs with F02's sample facts; `workbook` with its inventory. */
  readonly detected: DetectedDelimitedV1 | DetectedWorkbookV1;
  readonly preflight: ImportPreflightFactsV1 | WorkbookStageFactsV1;
  /** Absent means a new app — every F02 request. */
  readonly destination?: ImportDestinationWireV1;
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
  /** S02's workbook edit (CA-19); a delimited proposal takes the same keyed forms. */
  readonly edit: WorkbookReviewEditWireV1;
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
 * | `{kind:"reference", recordId}`  | `reference` (F03)            |
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
 * **`invalid` is read-only by type.** {@link AuthoredCellWireValueV1} excludes
 * it, and every write request is typed by that union — so a client cannot
 * author a preserved-invalid value, which only an import can produce. A
 * `reference` became authorable in F03 (SHT-002, CA-21): the data worker
 * resolves it against the field's relationship, and an authored reference to
 * a record that is not live there is refused as a typed result.
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
  { readonly kind: "invalid" }
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

/**
 * A record's relationships, both directions, in one bounded answer (CA-21):
 * its reference fields resolved or broken, and per relationship pointing at
 * its table an exact child count plus the first few children.
 */
export interface GetRelatedRecordsRequestV1 {
  readonly kind: "getRelatedRecords";
  readonly appId: string;
  readonly recordId: string;
}

/** The next page of one parent's children, continuing from `after`. */
export interface GetRelatedChildrenRequestV1 {
  readonly kind: "getRelatedChildren";
  readonly appId: string;
  readonly relationshipId: string;
  readonly parentRecordId: string;
  /** The previous page's `nextCursor`; absent starts at the beginning. */
  readonly after?: number | null;
  readonly limit?: number;
}

/** Records a reference field may point at (SHT-002); blank text browses. */
export interface SearchReferenceCandidatesRequestV1 {
  readonly kind: "searchReferenceCandidates";
  readonly appId: string;
  readonly fieldId: string;
  readonly text: string;
  readonly limit?: number;
}

/** A deleted record's original values (MOD-010); null while it is live. */
export interface GetDeletedRecordRequestV1 {
  readonly kind: "getDeletedRecord";
  readonly appId: string;
  readonly recordId: string;
}

/** The open app's tables with exact row counts (SHT-003), freshly read. */
export interface ListTablesRequestV1 {
  readonly kind: "listTables";
  readonly appId: string;
}

/** Every imported sheet of the app, with its roles and inert counts (SCR-030). */
export interface ListSheetSnapshotsRequestV1 {
  readonly kind: "listSheetSnapshots";
  readonly appId: string;
}

/**
 * One page of a sheet's read-only snapshot (SCR-031). The worker decrypts only
 * the chunks the page covers; at most 1,000 rows per page.
 */
export interface GetSnapshotPageRequestV1 {
  readonly kind: "getSnapshotPage";
  readonly appId: string;
  readonly sheetId: string;
  readonly firstRow: number;
  readonly rowCount: number;
}

/** The next cell after `afterRow` containing `text`; a bounded chunk scan. */
export interface FindInSnapshotRequestV1 {
  readonly kind: "findInSnapshot";
  readonly appId: string;
  readonly sheetId: string;
  readonly text: string;
  /** Null searches from the top. */
  readonly afterRow: number | null;
}

/** The inert inventory for one sheet, or the whole app when null (STA-012). */
export interface ListInertItemsRequestV1 {
  readonly kind: "listInertItems";
  readonly appId: string;
  readonly sheetId: string | null;
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
  | GetChangeHistoryRequestV1
  | GetRelatedRecordsRequestV1
  | GetRelatedChildrenRequestV1
  | SearchReferenceCandidatesRequestV1
  | GetDeletedRecordRequestV1
  | ListTablesRequestV1
  | ListSheetSnapshotsRequestV1
  | GetSnapshotPageRequestV1
  | FindInSnapshotRequestV1
  | ListInertItemsRequestV1;

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
 * S02's workbook proposal (`ProposedWorkbookV1`), restated structurally — the
 * CA-19 wire (CA-16's rule: projected, never reshaped). A delimited file is its
 * one-sheet, one-table case. `tests/unit/workers/proposal-wire.test.ts` pins
 * it against S02's type in both directions.
 *
 * The one projection: a record rule's comparison value is a
 * {@link RuleValueWireV1}, the cell values a validation rule can state.
 * `CellValueV1`'s enum and reference members carry byte ids, which this file
 * cannot name, and no rule ever holds one; the worker refuses to send a rule
 * that did (`import-handlers.ts`).
 */
export type WorkbookSourceValueFormatWireV1 =
  | SourceValueFormatWireV1
  | { readonly kind: "serial-date"; readonly system: "1900" | "1904" };

export interface RangeWireV1 {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

export type PreservedPartKindWireV1 =
  | "formula"
  | "chart"
  | "pivot-table"
  | "drawing"
  | "image"
  | "comment"
  | "external-link"
  | "hyperlink"
  | "embedded-object"
  | "form-control"
  | "data-connection"
  | "conditional-formatting"
  | "cell-styling"
  | "sparkline"
  | "script"
  | "unsupported-validation";

export type PreservedReasonKeyWireV1 =
  | "formula-not-live-yet"
  | "chart-not-live-yet"
  | "pivot-not-live-yet"
  | "visual-only"
  | "note-kept-as-text"
  | "link-not-followed"
  | "external-source-not-fetched"
  | "object-not-opened"
  | "control-not-run"
  | "connection-not-refreshed"
  | "formatting-not-reproduced"
  | "script-not-run"
  | "validation-not-expressible";

export type WorkbookInferenceSubjectWireV1 =
  | InferenceSubjectWireV1
  | "table-split"
  | "table-merge"
  | "relationship"
  | "formula"
  | "sheet-classification"
  | "record-rule"
  | "table-key"
  | "table-label";

export type WorkbookReviewEditKindWireV1 =
  | ReviewEditKindWireV1
  | "reject-relationship"
  | "restore-relationship"
  | "retarget-relationship"
  | "reject-statement"
  | "restore-statement"
  | "set-key"
  | "set-label";

export type ImportDiagnosticCodeWireV2 = ImportDiagnosticCodeWireV1 | "error-value" | "malformed-value";

export interface ImportDiagnosticWireV2 {
  readonly code: ImportDiagnosticCodeWireV2;
  readonly severity: "info" | "warning";
  readonly firstRowIndex: number | null;
  readonly firstColumnIndex: number | null;
  readonly occurrences: number;
}

type ValidationRuleWireV1 = "list" | "whole" | "decimal" | "date" | "time" | "text-length" | "custom";
type ValidationOperatorWireV1 =
  | "between"
  | "not-between"
  | "equal"
  | "not-equal"
  | "less-than"
  | "less-than-or-equal"
  | "greater-than"
  | "greater-than-or-equal";
type ListSourceWireV1 =
  | { readonly kind: "inline"; readonly values: readonly string[] }
  | { readonly kind: "range"; readonly ref: string };

export type WorkbookEvidenceWireV1 =
  | EvidenceWireV1
  | {
      readonly kind: "declared-table";
      readonly name: string;
      readonly range: RangeWireV1;
      readonly headerRowCount: number;
      readonly totalsRowCount: number;
    }
  | {
      readonly kind: "number-format";
      readonly numberFormat: string;
      readonly formatClass: "general" | "number" | "currency" | "percent" | "date" | "time" | "datetime" | "text" | "other";
      readonly currencySymbol: string | null;
      readonly matched: number;
      readonly sampled: number;
    }
  | {
      readonly kind: "validation-rule";
      readonly rule: ValidationRuleWireV1;
      readonly operator: ValidationOperatorWireV1 | null;
      readonly listSource: ListSourceWireV1 | null;
      readonly formula1: string | null;
      readonly formula2: string | null;
      readonly listOptions: readonly string[] | null;
    }
  | {
      readonly kind: "lookup-formula";
      readonly functionName: string;
      readonly formulaText: string;
      readonly parentSheetName: string;
      readonly parentTableName: string;
      readonly parentColumnName: string;
      readonly outcome: "relationship" | "parent-key-differs";
    }
  | {
      readonly kind: "key-match";
      readonly parentTableName: string;
      readonly parentColumnName: string;
      readonly matched: number;
      readonly measured: number;
      readonly isSampled: boolean;
    }
  | { readonly kind: "matching-headings"; readonly headings: readonly string[]; readonly rowIndex: number }
  | { readonly kind: "blank-row-gap"; readonly afterRowIndex: number; readonly beforeRowIndex: number }
  | { readonly kind: "column-gap"; readonly afterColumnIndex: number; readonly beforeColumnIndex: number }
  | {
      readonly kind: "formula-text";
      readonly text: string | null;
      readonly isArray: boolean;
      readonly isExternal: boolean;
      readonly formulaCount: number;
    }
  | {
      readonly kind: "sheet-shape";
      readonly sheetName: string;
      readonly sheetKind: "worksheet" | "chartsheet" | "dialogsheet";
      readonly usedCellCount: number;
      readonly formulaCellCount: number;
      readonly tableCount: number;
    }
  | { readonly kind: "preserved-part"; readonly partKind: PreservedPartKindWireV1; readonly count: number }
  | { readonly kind: "previously-rejected" };

export interface WorkbookStatementWireV1 {
  readonly statementId: string;
  readonly subject: WorkbookInferenceSubjectWireV1;
  readonly editKind: WorkbookReviewEditKindWireV1 | null;
  readonly targetKey: string | null;
  readonly columnIndex: number | null;
  readonly evidence: readonly WorkbookEvidenceWireV1[];
  readonly evidenceFingerprint: string;
  readonly disposition: "accepted" | "rejected" | "edited";
}

export interface ProposedSheetWireV1 {
  readonly sheetKey: string;
  readonly sheetIndex: number;
  readonly name: string;
  readonly sheetKind: "worksheet" | "chartsheet" | "dialogsheet";
  readonly visibility: "visible" | "hidden" | "very-hidden";
  readonly isSelected: boolean;
  readonly classification: readonly ("table" | "lookup" | "summary" | "chart" | "snapshot" | "excluded")[];
  readonly declaredRange: RangeWireV1 | null;
  readonly dateSystem: "1900" | "1904" | null;
  readonly rowCount: number | null;
  readonly usedCellCount: number | null;
  readonly formulaCellCount: number | null;
  readonly omittedRegionCount: number;
}

export interface ProposedWorkbookFieldWireV1 {
  readonly columnKey: string;
  readonly columnIndex: number;
  readonly fieldName: string;
  readonly isNameGenerated: boolean;
  readonly type: FieldTypeWireV1;
  readonly valueType: ProposedFieldTypeWireV1;
  readonly sourceFormat: WorkbookSourceValueFormatWireV1;
  readonly enumOptions: readonly { readonly label: string; readonly occurrences: number }[];
  readonly violations: {
    readonly count: number;
    readonly examples: readonly { readonly rowIndex: number; readonly sourceText: string }[];
  } | null;
  readonly formulaText: string | null;
}

export interface ProposedTableWireV2 {
  readonly tableKey: string;
  readonly sheetKey: string;
  readonly tableName: string;
  readonly source:
    | {
        readonly kind: "declared-table";
        readonly name: string;
        readonly range: RangeWireV1;
        readonly headerRowCount: number;
        readonly totalsRowCount: number;
      }
    | { readonly kind: "region" };
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly headerRowIndex: number | null;
  readonly leadingRows: readonly { readonly rowIndex: number; readonly cells: readonly string[] }[];
  readonly discardedRows: readonly {
    readonly rowIndex: number;
    readonly reason: "above-header" | "empty-row" | "totals-row";
    readonly cells: readonly string[];
  }[];
  readonly discardedRowCount: number;
  readonly rowCount: number;
  readonly joinedToTableKey: string | null;
  readonly fields: readonly ProposedWorkbookFieldWireV1[];
  readonly keyColumnKey: string | null;
  readonly labelColumnKey: string | null;
}

export interface ProposedRelationshipWireV1 {
  readonly relationshipKey: string;
  readonly fromTableKey: string;
  readonly fromColumnKey: string;
  readonly toTableKey: string;
  readonly toColumnKey: string;
  readonly detectionSource: "lookup-formula" | "key-match" | "user";
  readonly isApplied: boolean;
  readonly brokenReferenceCount: number;
  readonly isSampled: boolean;
  readonly candidates: readonly {
    readonly toTableKey: string;
    readonly toColumnKey: string;
    readonly basis: "lookup-formula" | "heading" | "containment" | "heading-and-containment";
    readonly brokenReferenceCount: number;
  }[];
}

/** The cell values a record rule can compare against: never an id-bearing value. */
export type RuleValueWireV1 =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "decimal"; readonly decimal: string }
  | { readonly kind: "date"; readonly epochDay: number }
  | { readonly kind: "boolean"; readonly boolean: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "blank" }
  | { readonly kind: "invalid-preserved"; readonly sourceText: string };

export type ProposedRuleConditionWireV1 =
  | { readonly kind: "field-equals"; readonly columnKey: string; readonly value: RuleValueWireV1 }
  | { readonly kind: "not"; readonly condition: ProposedRuleConditionWireV1 };

export interface ProposedRecordRuleWireV1 {
  readonly ruleKey: string;
  readonly tableKey: string;
  readonly columnKey: string;
  readonly condition: ProposedRuleConditionWireV1;
  readonly isActive: boolean;
}

export interface ProposedInertItemWireV1 {
  readonly kind: PreservedPartKindWireV1;
  readonly sheetKey: string;
  readonly location: string;
  readonly reasonKey: PreservedReasonKeyWireV1;
  readonly anchor: RangeWireV1 | null;
}

export interface ProposedWorkbookWireV1 {
  readonly fileName: string;
  readonly isDelimited: boolean;
  readonly appName: string;
  readonly sheets: readonly ProposedSheetWireV1[];
  readonly tables: readonly ProposedTableWireV2[];
  readonly relationships: readonly ProposedRelationshipWireV1[];
  readonly recordRules: readonly ProposedRecordRuleWireV1[];
  readonly inertItems: readonly ProposedInertItemWireV1[];
  readonly inertCounts: Readonly<Record<PreservedPartKindWireV1, number>>;
  readonly statements: readonly WorkbookStatementWireV1[];
  readonly diagnostics: readonly ImportDiagnosticWireV2[];
  /** Always `true`: a proposal comes from a completed stream (D24). */
  readonly isRowCountExact: true;
}

/** S02's `WorkbookReviewEditV1`: every target is a stable key, never a name. */
export type WorkbookReviewEditWireV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableKey: string; readonly tableName: string }
  | { readonly kind: "rename-field"; readonly tableKey: string; readonly columnKey: string; readonly fieldName: string }
  | {
      readonly kind: "override-type";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly type: ProposedFieldTypeWireV1;
    }
  | { readonly kind: "set-header-row"; readonly regionKey: string; readonly rowIndex: number | null }
  | {
      readonly kind: "edit-enum-options";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly options: readonly string[];
    }
  | { readonly kind: "reject-relationship"; readonly relationshipKey: string }
  | { readonly kind: "restore-relationship"; readonly relationshipKey: string }
  | { readonly kind: "retarget-relationship"; readonly relationshipKey: string; readonly toTableKey: string }
  | { readonly kind: "reject-statement"; readonly statementId: string }
  | { readonly kind: "restore-statement"; readonly statementId: string }
  | { readonly kind: "set-key"; readonly tableKey: string; readonly columnKey: string | null }
  | { readonly kind: "set-label"; readonly tableKey: string; readonly columnKey: string };

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
  readonly proposal: ProposedWorkbookWireV1;
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
      readonly proposal: ProposedWorkbookWireV1;
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
        /**
         * The reviewed column (`ProposedWorkbookFieldWireV1.columnKey`) the
         * field was allocated for, so the review can name it: the refused
         * promotion wrote nothing, and its `fieldId` names no durable field.
         * `null` for a record-level issue; absent from an F02-era producer.
         */
        readonly columnKey?: string | null;
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

/**
 * The field types a schema may declare. A delimited import never proposes
 * `reference` (D25); a workbook import does, with its relationship (F03).
 */
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

/** A record as navigation shows it: its id and its label, nothing more. */
export interface RelatedRecordViewV1 {
  readonly recordId: string;
  readonly label: string;
}

/**
 * One of a record's reference fields and where it points. `resolved` names
 * the live parent by id and label (label field, else key). `broken` carries
 * the original key when one is knowable — the imported text that matched no
 * parent, or a deleted parent's key — else null (D36, STA-011).
 */
export type RecordReferenceViewV1 =
  | {
      readonly fieldId: string;
      readonly relationshipId: string;
      readonly status: "resolved";
      readonly recordId: string;
      readonly tableId: string;
      readonly label: string;
    }
  | {
      readonly fieldId: string;
      readonly relationshipId: string;
      readonly status: "broken";
      readonly originalKey: string | null;
    };

export interface RecordDetailViewV1 extends RecordSummaryViewV1 {
  readonly createdCommitId: string;
  readonly updatedCommitId: string;
  readonly issues: readonly RecordIssueViewV1[];
  /** The fields the projection could index; the rest are authored-only. */
  readonly indexedFieldIds: readonly string[];
  /**
   * Every reference field holding a reference, resolved or broken (F03). The
   * data worker always sends it; optional only so F02-era readers still type.
   */
  readonly references?: readonly RecordReferenceViewV1[];
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
  /**
   * The table the change happened in; null for app-level events (F03). The
   * data worker always sends it; optional only so F02-era readers still type.
   */
  readonly tableId?: string | null;
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

/** One relationship pointing at the record's table, seen from the parent. */
export interface RelatedChildrenViewV1 {
  readonly relationshipId: string;
  /** The child table. */
  readonly tableId: string;
  readonly tableName: string;
  /** Exact: `count(*)` over the children (CA-14). */
  readonly count: number;
  /** The first few children; page the rest with `getRelatedChildren`. */
  readonly first: readonly RelatedRecordViewV1[];
}

export interface RelatedRecordsViewV1 {
  readonly parents: readonly RecordReferenceViewV1[];
  readonly children: readonly RelatedChildrenViewV1[];
}

export interface GetRelatedRecordsResponseV1 {
  readonly kind: "getRelatedRecords";
  /** Null when the app or a live record with this id is not there. */
  readonly related: RelatedRecordsViewV1 | null;
}

export interface RelatedChildrenPageViewV1 {
  readonly children: readonly (RelatedRecordViewV1 & {
    /** Pass back as `after`; a row key, never an offset. */
    readonly cursor: number;
  })[];
  readonly hasMore: boolean;
  readonly nextCursor: number | null;
}

export interface GetRelatedChildrenResponseV1 {
  readonly kind: "getRelatedChildren";
  /** Null when the app or the relationship is not there. */
  readonly page: RelatedChildrenPageViewV1 | null;
}

export interface SearchReferenceCandidatesResponseV1 {
  readonly kind: "searchReferenceCandidates";
  /** Null when the field is not the source of an active relationship. */
  readonly candidates: readonly RelatedRecordViewV1[] | null;
}

/** A deleted record exactly as its latest delete preserved it (MOD-010). */
export interface DeletedRecordViewV1 {
  readonly recordId: string;
  readonly tableId: string;
  /** The complete authored state the delete carried. */
  readonly values: readonly CellWireEntryV1[];
  readonly deletedEventId: string;
  readonly deletedAtEpochMs: number;
  /** Its key value when its table has a key — a broken reference's original key. */
  readonly keyValue: CellWireValueV1 | null;
}

export interface GetDeletedRecordResponseV1 {
  readonly kind: "getDeletedRecord";
  /** Null while the record is live, or when no delete of it is recorded. */
  readonly deleted: DeletedRecordViewV1 | null;
}

export interface ListTablesResponseV1 {
  readonly kind: "listTables";
  /** Null when no app carries this id. */
  readonly tables: readonly AppTableViewV1[] | null;
}

/** M01's closed lists, restated so this file imports nothing (pinned in protocol.test.ts). */
export type SheetClassificationWireV1 = "table" | "lookup" | "summary" | "chart" | "snapshot";

export type InertItemKindWireV1 =
  | "formula"
  | "chart"
  | "pivot-table"
  | "drawing"
  | "image"
  | "comment"
  | "external-link"
  | "hyperlink"
  | "embedded-object"
  | "form-control"
  | "data-connection"
  | "conditional-formatting"
  | "cell-styling"
  | "sparkline"
  | "script"
  | "unsupported-validation";

export type InertReasonKeyWireV1 =
  | "formula-not-live-yet"
  | "chart-not-live-yet"
  | "object-not-rendered"
  | "link-not-followed"
  | "script-never-runs"
  | "formatting-not-reproduced"
  | "validation-not-expressible"
  | "kept-in-source";

/** Zero-based and inclusive on both corners. */
export interface CellRangeWireV1 {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

export interface SheetSnapshotViewV1 {
  readonly sheetId: string;
  readonly displayName: string;
  readonly sheetOrdinal: number;
  readonly classification: readonly SheetClassificationWireV1[];
  /** Null when the source never declared it — never shown as zero. */
  readonly declaredRowCount: number | null;
  readonly declaredColumnCount: number | null;
  readonly snapshotRevision: number;
  /** Exact counts per kind; kinds with none are absent. */
  readonly inertCounts: readonly {
    readonly kind: InertItemKindWireV1;
    readonly count: number;
  }[];
}

export interface ListSheetSnapshotsResponseV1 {
  readonly kind: "listSheetSnapshots";
  /** Null when no app carries this id. */
  readonly sheets: readonly SheetSnapshotViewV1[] | null;
}

export type SnapshotCellKindWireV1 =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "error"
  | "formula-result";

/**
 * One page of a sheet's normalized text grid. Cells are rendered text with a
 * closed kind — never markup. A delimited (F02) snapshot carries no discard
 * markers: its discarded rows are here as rows, unmarked.
 */
export interface SnapshotPageViewV1 {
  readonly sheetId: string;
  readonly format: "sheet-v2" | "delimited-v1";
  readonly displayName: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly firstRow: number;
  /** Sparse: rows and cells with nothing in them are absent. */
  readonly rows: readonly {
    readonly rowIndex: number;
    readonly cells: readonly {
      readonly columnIndex: number;
      readonly text: string;
      readonly kind: SnapshotCellKindWireV1;
    }[];
  }[];
  /** Merged regions and inert anchors that intersect the page. */
  readonly merges: readonly CellRangeWireV1[];
  readonly inertAnchors: readonly {
    readonly inertItemId: string;
    readonly range: CellRangeWireV1;
  }[];
  readonly discardedRows: readonly {
    readonly rowIndex: number;
    readonly reason: "above-header" | "empty-row";
  }[];
}

export interface GetSnapshotPageResponseV1 {
  readonly kind: "getSnapshotPage";
  /** Null when the app or the sheet is not there. */
  readonly page: SnapshotPageViewV1 | null;
}

export type SnapshotFindResultV1 =
  | {
      readonly outcome: "found";
      readonly rowIndex: number;
      readonly columnIndex: number;
    }
  | { readonly outcome: "not-found" };

export interface FindInSnapshotResponseV1 {
  readonly kind: "findInSnapshot";
  /** Null when the app or the sheet is not there. */
  readonly result: SnapshotFindResultV1 | null;
}

export interface InertItemViewV1 {
  readonly inertItemId: string;
  readonly sheetId: string;
  readonly sheetName: string;
  readonly kind: InertItemKindWireV1;
  /** A user-understandable location, e.g. `Overview!B2:F9`. */
  readonly location: string;
  readonly reasonKey: InertReasonKeyWireV1;
  /** Where it sits in the snapshot, when it has a cell range. */
  readonly anchor: CellRangeWireV1 | null;
}

export interface ListInertItemsResponseV1 {
  readonly kind: "listInertItems";
  /** Null when the app, or the named sheet, is not there. */
  readonly items: readonly InertItemViewV1[] | null;
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
  | GetChangeHistoryResponseV1
  | GetRelatedRecordsResponseV1
  | GetRelatedChildrenResponseV1
  | SearchReferenceCandidatesResponseV1
  | GetDeletedRecordResponseV1
  | ListTablesResponseV1
  | ListSheetSnapshotsResponseV1
  | GetSnapshotPageResponseV1
  | FindInSnapshotResponseV1
  | ListInertItemsResponseV1;

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
