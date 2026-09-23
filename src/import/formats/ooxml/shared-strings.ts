/**
 * The shared-string table, read once per parse into a compact index (M15).
 *
 * Only the parser reads this part — never pre-flight. It is streamed through
 * the tokenizer, so the part itself is never held as bytes; what is held is
 * the decoded strings, and that is bounded: at most
 * {@link SHARED_STRINGS_MAX_COUNT} strings and
 * {@link SHARED_STRINGS_MAX_CHARACTERS} UTF-16 units in total (64 MiB of string
 * data — far above what a workbook inside the 250,000-cell import budget can
 * reference, and far below what the device can hold). Past either bound the
 * read ends as `expansion-limit`.
 *
 * A rich-text entry's runs are concatenated; phonetic guides (`rPh`) are not
 * part of the cell's text and are skipped.
 */

import { BoundExceededError } from "../../source/bounds.js";
import { tokenizeXml } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { isSheetElement } from "./parts.js";

export const SHARED_STRINGS_MAX_COUNT = 1_048_576;
export const SHARED_STRINGS_MAX_CHARACTERS = 33_554_432;

export async function readSharedStrings(
  zip: ZipContainerHandleV1,
  partName: string | null,
): Promise<readonly string[]> {
  if (partName === null || !zip.has(partName)) {
    return [];
  }
  const strings: string[] = [];
  let characters = 0;
  let current: string | null = null;
  let inText = false;
  let phoneticDepth = 0;

  for await (const event of tokenizeXml(zip.streamEntry(partName))) {
    if (event.kind === "start" && isSheetElement(event.uri)) {
      if (event.local === "si") current = "";
      else if (event.local === "rPh") phoneticDepth += 1;
      else if (event.local === "t" && phoneticDepth === 0) inText = true;
    } else if (event.kind === "text" && inText && current !== null) {
      current += event.value;
      characters += event.value.length;
      if (characters > SHARED_STRINGS_MAX_CHARACTERS) {
        throw new BoundExceededError("expansion-limit");
      }
    } else if (event.kind === "end" && isSheetElement(event.uri)) {
      if (event.local === "t") inText = false;
      else if (event.local === "rPh") phoneticDepth -= 1;
      else if (event.local === "si" && current !== null) {
        if (strings.length >= SHARED_STRINGS_MAX_COUNT) {
          throw new BoundExceededError("expansion-limit");
        }
        strings.push(current);
        current = null;
      }
    }
  }
  return strings;
}
