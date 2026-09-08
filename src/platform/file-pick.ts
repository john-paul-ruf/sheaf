/**
 * Acquiring a workbook from the platform (M51; SCR-016, FR-1).
 *
 * **The accept list is wide on purpose.** FR-1 decides format from file
 * *content*, never from the name, and SCR-021's whole reason for existing is
 * to refuse a Numbers, Pages or PDF file truthfully by name and remedy. A
 * picker that hid those extensions would make the approved refusal
 * unreachable, so every format the refusal inventory can name is offered and
 * the answer comes from the bytes.
 *
 * `.xlsx`, `.xlsb`, `.xls` and `.ods` are offered for the same reason: this
 * release identifies them and refuses them with the later-release card (D19).
 * Offering them and explaining is truthful; hiding them and leaving the user
 * to guess why their file is missing from the picker is not.
 *
 * The picked file never reaches the data worker: it rides the import
 * protocol's `startImport` to the parser and nowhere else (D17).
 */

/** In upload.html's order: the value-only group, then workbook structure. */
export const WORKBOOK_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  ".csv",
  ".tsv",
  ".xlsx",
  ".xlsb",
  ".xls",
  ".ods",
  ".numbers",
  ".pages",
  ".pdf",
  ".htm",
  ".html",
]);

/** What the file input was given, kept together so a caller cannot split them. */
export interface PickedWorkbookV1 {
  /** The source bytes. A `File` is a `Blob`; nothing here needs more. */
  readonly file: Blob;
  /** The declared name. Evidence for a contradiction, never a format decision. */
  readonly fileName: string;
}

/**
 * The first file a platform picker handed back, or `null` when the picker was
 * dismissed. Taking the `FileList` as an argument is what makes this testable
 * without a picker and what keeps the DOM event in the surface that owns it.
 */
export function pickWorkbookFile(
  files: FileList | null,
): PickedWorkbookV1 | null {
  const file = files?.item(0) ?? null;
  return file === null ? null : { file, fileName: file.name };
}
