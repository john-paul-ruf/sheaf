/**
 * What an import left beside the tables — its sheets, their inert content, and
 * the review decisions — as bounded reads (M35; CAP-25, CAP-26, CA-22).
 *
 * The rows themselves come from the projection. Snapshot *cells* do not: they
 * stay encrypted in their chunks until a page is asked for, and the data
 * worker decrypts only the chunks that page covers. This module therefore
 * answers which sheets exist and what they hold, never their contents.
 */

import { compareDomainIds, encodeDomainId } from "../../domain/model/ids.js";
import type { SheetId } from "../../domain/model/ids.js";
import type { DecisionKindV1 } from "../../domain/model/snapshots.js";
import type {
  ProjectionEnginePort,
  ProjectionInertItemV1,
  ProjectionInferenceDecisionV1,
  ProjectionSheetListingV1,
} from "../ports/projection.js";

/** Every imported sheet in workbook order, with its inert counts per kind. */
export function planSheetSnapshots(
  projection: ProjectionEnginePort,
): readonly ProjectionSheetListingV1[] {
  return projection.execute({ kind: "list-sheet-snapshots" });
}

/** One sheet's listing; null when the app holds no such sheet. */
export function planSnapshotSheet(
  projection: ProjectionEnginePort,
  sheetId: SheetId,
): ProjectionSheetListingV1 | null {
  return (
    planSheetSnapshots(projection).find(
      (listing) => compareDomainIds(listing.sheet.sheetId, sheetId) === 0,
    ) ?? null
  );
}

export interface InertItemListingV1 {
  readonly item: ProjectionInertItemV1;
  /** The owning sheet's label, so a list can say where each item is. */
  readonly sheetName: string;
}

/**
 * The inert inventory, for one sheet or the whole app. Null when a sheet was
 * named that the app does not hold — "no such sheet" and "a sheet with nothing
 * inert" are different answers.
 */
export function planInertItems(
  projection: ProjectionEnginePort,
  sheetId: SheetId | null,
): readonly InertItemListingV1[] | null {
  const sheets = planSheetSnapshots(projection);
  if (
    sheetId !== null &&
    !sheets.some((listing) => compareDomainIds(listing.sheet.sheetId, sheetId) === 0)
  ) {
    return null;
  }
  const names = new Map(
    sheets.map((listing) => [encodeDomainId(listing.sheet.sheetId), listing.sheet.displayName]),
  );
  return projection.execute({ kind: "list-inert-items", sheetId }).map((item) => ({
    item,
    sheetName: names.get(encodeDomainId(item.sheetId)) ?? "",
  }));
}

/**
 * The app's projectable review decisions of one kind, or all of them. The
 * rejected ones are D44's rejection memory: the append path hands them to
 * inference so a statement the user rejected is not silently proposed again.
 */
export function planInferenceDecisions(
  projection: ProjectionEnginePort,
  decisionKind: DecisionKindV1 | null,
): readonly ProjectionInferenceDecisionV1[] {
  return projection.execute({ kind: "list-inference-decisions", decisionKind });
}
