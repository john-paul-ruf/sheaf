/**
 * Streams the pinned demo workbook (and the other OOXML fixtures) into
 * `inferWorkbook`, the way the data worker will feed staged batches.
 */

import type { WorkbookFactStreamItemV2 } from "../../../../src/import/facts/index.js";
import { ooxmlAdapter, ooxmlInventoryReader } from "../../../../src/import/formats/ooxml/index.js";
import {
  inferWorkbook,
  type WorkbookInferenceContextV1,
  type WorkbookSheetChoiceV1,
} from "../../../../src/import/inference/workbook.js";
import type { ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { fixtureSource } from "../fixtures.js";

export const DEMO = "ooxml/fieldwork-q3.xlsx";

/** A deterministic stand-in for M08's SHA-256: the hex of a 32-bit FNV-1a. */
export const fakeFingerprint = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const parseWorkbook = async (fixture: string, selection: readonly number[]): Promise<WorkbookFactStreamItemV2[]> => {
  const zip = await openZipContainer(await fixtureSource(fixture));
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, selection, { cancellation: { aborted: false } })) {
    items.push(item);
  }
  return items;
};

/** Every sheet of a workbook, marked selected when its index is in `selection`. */
export const sheetChoices = async (fixture: string, selection: readonly number[]): Promise<WorkbookSheetChoiceV1[]> => {
  const zip = await openZipContainer(await fixtureSource(fixture));
  const outcome = await ooxmlInventoryReader.readInventory({ kind: "zip", zip });
  if (outcome.kind !== "inventory") throw new Error(`${fixture} did not inventory`);
  return outcome.inventory.sheets.map((sheet) => ({
    sheetIndex: sheet.sheetIndex,
    name: sheet.name,
    sheetKind: sheet.kind,
    visibility: sheet.visibility,
    isSelected: selection.includes(sheet.sheetIndex),
  }));
};

export const contextFor = (
  fileName: string,
  sheetSelection: readonly WorkbookSheetChoiceV1[] | null,
  rejectionMemory: ReadonlySet<string> = new Set(),
): WorkbookInferenceContextV1 => ({
  fileName,
  sheetSelection,
  rejectionMemory,
  fingerprintOf: fakeFingerprint,
  existingApp: null,
});

export const proposeFixture = async (
  fixture: string,
  selection: readonly number[],
  rejectionMemory: ReadonlySet<string> = new Set(),
): Promise<ProposedWorkbookV1> => {
  const items = await parseWorkbook(fixture, selection);
  const fileName = fixture.split("/").at(-1) as string;
  return inferWorkbook(items, contextFor(fileName, await sheetChoices(fixture, selection), rejectionMemory));
};
