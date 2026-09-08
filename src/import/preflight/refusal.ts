/**
 * Truthful refusal of input Sheaf will not turn into an app (FR-2).
 *
 * A refusal is issued **before** any staging model exists, which is what makes
 * "no refusal leaves a partial app" (FR-2) structural rather than a cleanup
 * step: at this point there is nothing to clean up.
 *
 * Every refusal names the file and carries a remedy id, never an error code
 * alone. The remedy is fixed by the kind — the pairing is held by the type, so
 * a surface cannot render the macro remedy beside the PDF refusal — and the
 * ids address the approved copy in `mocks/import-refused.html` and
 * `mocks/import-large.html`; the wording itself belongs to the view models.
 */

import type { DetectedFormatV1, SniffResultV1 } from "../source/sniff.js";

export const REFUSAL_KINDS = Object.freeze([
  "macro-content",
  "numbers-file",
  "pages-file",
  "pdf-file",
  "workbook-format-later-release",
  "over-import-budget",
  "binary-unreadable",
] as const);

export type RefusalKindV1 = (typeof REFUSAL_KINDS)[number];

export const REFUSAL_REMEDIES = Object.freeze([
  "reupload-macro-free-copy",
  "numbers-export-xlsx",
  "pages-copy-into-spreadsheet",
  "pdf-export-from-source",
  "await-later-release",
  "use-larger-device",
  "choose-another-file",
] as const);

export type RefusalRemedyV1 = (typeof REFUSAL_REMEDIES)[number];

/** The container families F02 can identify but not yet read (D19). */
export type LaterReleaseFormatV1 = "ooxml" | "xlsb" | "ods" | "xls" | "html";

export type RefusalV1 =
  | {
      readonly kind: "macro-content";
      readonly fileName: string;
      readonly remedy: "reupload-macro-free-copy";
    }
  | {
      readonly kind: "numbers-file";
      readonly fileName: string;
      readonly remedy: "numbers-export-xlsx";
    }
  | {
      readonly kind: "pages-file";
      readonly fileName: string;
      readonly remedy: "pages-copy-into-spreadsheet";
    }
  | {
      readonly kind: "pdf-file";
      readonly fileName: string;
      readonly remedy: "pdf-export-from-source";
    }
  | {
      readonly kind: "workbook-format-later-release";
      readonly fileName: string;
      readonly remedy: "await-later-release";
      readonly format: LaterReleaseFormatV1;
    }
  | {
      readonly kind: "over-import-budget";
      readonly fileName: string;
      readonly remedy: "use-larger-device";
      readonly exceeded: "source-bytes" | "estimated-cells";
      readonly sourceByteLength: number;
      readonly maxSourceByteLength: number;
      readonly estimatedCellCount: number;
      readonly maxEstimatedCellCount: number;
    }
  | {
      readonly kind: "binary-unreadable";
      readonly fileName: string;
      readonly remedy: "choose-another-file";
    };

/**
 * iWork stores Numbers and Pages in the same container shape, so the family is
 * decided by content and only the *which of the two* by the declared name. The
 * two refusals differ solely in their instructions, so the worst outcome of a
 * misnamed iWork file is the wrong export recipe, never a wrong parse.
 */
const iworkRefusal = (
  fileName: string,
  declaredExtension: string | null,
): RefusalV1 =>
  declaredExtension === "pages"
    ? { kind: "pages-file", fileName, remedy: "pages-copy-into-spreadsheet" }
    : { kind: "numbers-file", fileName, remedy: "numbers-export-xlsx" };

const laterRelease = (
  fileName: string,
  format: LaterReleaseFormatV1,
): RefusalV1 => ({
  kind: "workbook-format-later-release",
  fileName,
  remedy: "await-later-release",
  format,
});

/**
 * `.xlsb` is an OOXML-shaped zip whose parts are binary records; the container
 * scan cannot tell it from `.xlsx` without reading parts pre-flight is not
 * allowed to read. Both refuse identically in F02, so the extension is used
 * only to name the format in the message.
 */
const ooxmlFormat = (declaredExtension: string | null): LaterReleaseFormatV1 =>
  declaredExtension === "xlsb" ? "xlsb" : "ooxml";

/**
 * Routes a detected format to its refusal, or `null` when the file may proceed
 * to delimited pre-flight. Budget refusals are not decided here — they need
 * sizing, so {@link import("./preflight.js").preflightDelimited} issues them.
 */
export function classifyRefusal(sniff: SniffResultV1): RefusalV1 | null {
  const fileName = sniff.declaredName;
  const format: DetectedFormatV1 = sniff.format;

  switch (format.kind) {
    case "delimited":
      return null;
    case "pdf":
      return { kind: "pdf-file", fileName, remedy: "pdf-export-from-source" };
    case "binary":
      return {
        kind: "binary-unreadable",
        fileName,
        remedy: "choose-another-file",
      };
    case "cfb":
      return laterRelease(fileName, "xls");
    case "html-table":
      return laterRelease(fileName, "html");
    case "zip-container":
      switch (format.container) {
        case "iwork":
          return iworkRefusal(fileName, sniff.declaredExtension);
        case "ods":
          return laterRelease(fileName, "ods");
        case "ooxml":
          return laterRelease(fileName, ooxmlFormat(sniff.declaredExtension));
        case "unknown":
          return {
            kind: "binary-unreadable",
            fileName,
            remedy: "choose-another-file",
          };
        default: {
          const unreachable: never = format.container;
          return unreachable;
        }
      }
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
}
