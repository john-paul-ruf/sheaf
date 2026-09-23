/** M17's public surface: the BIFF (`.xls`) inventory reader and adapter, and the shared `Ptg` decoder. */

export { readBiffInventory } from "./inventory.js";
export { biffAdapter } from "./parse.js";
export {
  decodePtgFormula,
  ERROR_TEXT,
  FIXED_ARITY,
  FUNCTION_NAMES,
  PTG_UNDECODABLE_REASONS,
  ptgExpOf,
  type PtgCellV1,
  type PtgContextV1,
  type PtgDecodeResultV1,
  type PtgExternSheetV1,
  type PtgFormatV1,
  type PtgSupbookV1,
  type PtgUndecodableReasonV1,
} from "./ptg.js";
