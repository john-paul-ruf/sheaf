/**
 * ODF styles, reduced to what the fact stream states (M18): each cell style's
 * data style — restated as an Excel-style format code with its class — whether
 * it carries visual styling, and which table styles hide their sheet.
 *
 * ODF has no format-code string: a data style is an element tree
 * (`number:currency-style` › `number:currency-symbol`, `number:number`). The
 * code here is its Excel spelling (`"$"#,##0.00`, `yyyy-mm-dd`, `0.00%`), so
 * the `cell-format` facts of an ODS column and of an XLSX column read alike.
 * Visual styling itself is never reproduced — a sheet that uses any becomes
 * one `cell-styling` preserved part (D40).
 *
 * Styles arrive from two parts — `styles.xml` (common styles) and the
 * `office:automatic-styles` at the head of `content.xml` — so the collector
 * takes events rather than a part name.
 */

import type { FormatClassV1 } from "../../facts/index.js";
import type { XmlEventV1, XmlStartEventV1 } from "../../source/xml.js";
import { attr, FO_NS, NUMBER_NS, STYLE_NS, TABLE_NS } from "./vocabulary.js";

export type DataStyleKindV1 = "number" | "currency" | "percentage" | "date" | "time" | "boolean" | "text";

export interface DataStyleV1 {
  readonly kind: DataStyleKindV1;
  readonly code: string;
  readonly currencySymbol: string | null;
  readonly hasDate: boolean;
  readonly hasTime: boolean;
}

interface CellStyleEntry {
  readonly parent: string | null;
  readonly dataStyleName: string | null;
  readonly isVisual: boolean;
}

export interface OdsStyleSheetV1 {
  readonly dataStyles: ReadonlyMap<string, DataStyleV1>;
  readonly cellStyles: ReadonlyMap<string, CellStyleEntry>;
  readonly hiddenTableStyles: ReadonlySet<string>;
}

export interface CellFormatV1 {
  readonly numberFormat: string;
  readonly formatClass: FormatClassV1;
  readonly currencySymbol: string | null;
}

const DATA_STYLE_KINDS: ReadonlyMap<string, DataStyleKindV1> = new Map([
  ["number-style", "number"],
  ["currency-style", "currency"],
  ["percentage-style", "percentage"],
  ["date-style", "date"],
  ["time-style", "time"],
  ["boolean-style", "boolean"],
  ["text-style", "text"],
]);

/** Properties whose non-default value is visible styling. */
const VISUAL_PROPERTIES: ReadonlyMap<string, (value: string) => boolean> = new Map([
  ["background-color", (value: string) => value !== "transparent"],
  ["border", (value: string) => value !== "none"],
  ["border-top", (value: string) => value !== "none"],
  ["border-bottom", (value: string) => value !== "none"],
  ["border-left", (value: string) => value !== "none"],
  ["border-right", (value: string) => value !== "none"],
  ["color", () => true],
  ["font-weight", (value: string) => value !== "normal"],
  ["font-style", (value: string) => value !== "normal"],
]);

const isVisualProperties = (event: XmlStartEventV1): boolean =>
  event.attributes.some(({ uri, local, value }) => uri === FO_NS && (VISUAL_PROPERTIES.get(local)?.(value) ?? false)) ||
  (attr(event, STYLE_NS, "text-underline-style") ?? "none") !== "none";

const DATE_SEPARATORS = /^[-/.:, ()]*$/;

interface DataStyleDraft {
  name: string;
  kind: DataStyleKindV1;
  code: string;
  currencySymbol: string | null;
  isGeneral: boolean;
  hasDate: boolean;
  hasTime: boolean;
  wrapsHours: boolean;
  text: string | null;
}

const isLong = (event: XmlStartEventV1): boolean => attr(event, NUMBER_NS, "style") === "long";

const numberCode = (event: XmlStartEventV1, draft: DataStyleDraft): string => {
  const places = attr(event, NUMBER_NS, "decimal-places");
  const integerDigits = Math.min(Number(attr(event, NUMBER_NS, "min-integer-digits") ?? "1") || 0, 30);
  const isGrouped = attr(event, NUMBER_NS, "grouping") === "true";
  if (draft.kind === "number" && places === null && !isGrouped && draft.code === "") {
    draft.isGeneral = true;
  }
  const decimals = Math.min(Number(places ?? "0") || 0, 30);
  const integer = "0".repeat(Math.max(1, integerDigits));
  return `${isGrouped ? `#,##${integer}` : integer}${decimals > 0 ? `.${"0".repeat(decimals)}` : ""}`;
};

/** One data-style child element, spelled as Excel spells it. */
const childCode = (event: XmlStartEventV1, draft: DataStyleDraft): string => {
  switch (event.local) {
    case "number":
      return numberCode(event, draft);
    case "scientific-number": {
      const decimals = Math.min(Number(attr(event, NUMBER_NS, "decimal-places") ?? "2") || 0, 30);
      return `0${decimals > 0 ? `.${"0".repeat(decimals)}` : ""}E+00`;
    }
    case "fraction":
      return "# ?/?";
    case "day":
      draft.hasDate = true;
      return isLong(event) ? "dd" : "d";
    case "month":
      draft.hasDate = true;
      return attr(event, NUMBER_NS, "textual") === "true" ? (isLong(event) ? "mmmm" : "mmm") : isLong(event) ? "mm" : "m";
    case "year":
      draft.hasDate = true;
      return isLong(event) ? "yyyy" : "yy";
    case "day-of-week":
      draft.hasDate = true;
      return isLong(event) ? "dddd" : "ddd";
    case "hours":
      draft.hasTime = true;
      return isLong(event) ? "hh" : "h";
    case "minutes":
      draft.hasTime = true;
      return isLong(event) ? "mm" : "m";
    case "seconds": {
      draft.hasTime = true;
      const decimals = Math.min(Number(attr(event, NUMBER_NS, "decimal-places") ?? "0") || 0, 9);
      return `${isLong(event) ? "ss" : "s"}${decimals > 0 ? `.${"0".repeat(decimals)}` : ""}`;
    }
    case "am-pm":
      draft.hasTime = true;
      return "AM/PM";
    case "boolean":
      return "BOOLEAN";
    case "text-content":
      return "@";
    default:
      return "";
  }
};

const literalCode = (text: string, draft: DataStyleDraft): string => {
  if (text === "") return "";
  if (draft.kind === "percentage" && text.trim() === "%") return text;
  if ((draft.hasDate || draft.hasTime || draft.kind === "date" || draft.kind === "time") && DATE_SEPARATORS.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
};

/** Collects styles from any number of style parts' events. */
export function createStyleCollector(): {
  readonly accept: (event: XmlEventV1) => void;
  readonly sheet: () => OdsStyleSheetV1;
} {
  const dataStyles = new Map<string, DataStyleV1>();
  const cellStyles = new Map<string, CellStyleEntry>();
  const hiddenTableStyles = new Set<string>();
  let draft: DataStyleDraft | null = null;
  let draftDepth = 0;
  let cell: { name: string; parent: string | null; dataStyleName: string | null; isVisual: boolean } | null = null;
  let table: string | null = null;

  const accept = (event: XmlEventV1): void => {
    if (draft !== null) {
      if (event.kind === "start") {
        draftDepth += 1;
        if (draftDepth === 1 && event.uri === NUMBER_NS) {
          if (event.local === "currency-symbol" || event.local === "text") {
            draft.text = "";
          } else {
            draft.code += childCode(event, draft);
            if (event.local === "hours" && attr(event, NUMBER_NS, "truncate-on-overflow") === "false") {
              draft.wrapsHours = true;
            }
          }
        }
      } else if (event.kind === "text") {
        if (draftDepth === 1 && draft.text !== null) draft.text += event.value;
      } else {
        if (draftDepth === 1 && event.uri === NUMBER_NS && draft.text !== null) {
          const text = draft.text.normalize("NFC");
          if (event.local === "currency-symbol") {
            draft.currencySymbol = text;
            draft.code += `"${text.replace(/"/g, '\\"')}"`;
          } else {
            draft.code += literalCode(text, draft);
          }
          draft.text = null;
        }
        draftDepth -= 1;
        if (draftDepth < 0) {
          const code =
            draft.isGeneral && draft.code === "0" ? "General" : draft.wrapsHours ? draft.code.replace(/^h+/, "[h]") : draft.code;
          dataStyles.set(draft.name, {
            kind: draft.kind,
            code,
            currencySymbol: draft.currencySymbol === "" ? null : draft.currencySymbol,
            hasDate: draft.hasDate,
            hasTime: draft.hasTime,
          });
          draft = null;
        }
      }
      return;
    }

    if (event.kind === "start") {
      const kind = event.uri === NUMBER_NS ? DATA_STYLE_KINDS.get(event.local) : undefined;
      const styleName = attr(event, STYLE_NS, "name");
      if (kind !== undefined && styleName !== null) {
        draft = {
          name: styleName,
          kind,
          code: "",
          currencySymbol: null,
          isGeneral: false,
          hasDate: false,
          hasTime: false,
          wrapsHours: false,
          text: null,
        };
        draftDepth = 0;
      } else if (event.uri === STYLE_NS && event.local === "style" && styleName !== null) {
        const family = attr(event, STYLE_NS, "family");
        if (family === "table-cell") {
          cell = {
            name: styleName,
            parent: attr(event, STYLE_NS, "parent-style-name"),
            dataStyleName: attr(event, STYLE_NS, "data-style-name"),
            isVisual: false,
          };
        } else if (family === "table") {
          table = styleName;
        }
      } else if (
        cell !== null &&
        event.uri === STYLE_NS &&
        (event.local === "table-cell-properties" || event.local === "text-properties")
      ) {
        cell.isVisual ||= isVisualProperties(event);
      } else if (table !== null && event.uri === STYLE_NS && event.local === "table-properties") {
        if (attr(event, TABLE_NS, "display") === "false") hiddenTableStyles.add(table);
      }
    } else if (event.kind === "end" && event.uri === STYLE_NS && event.local === "style") {
      if (cell !== null) {
        cellStyles.set(cell.name, { parent: cell.parent, dataStyleName: cell.dataStyleName, isVisual: cell.isVisual });
      }
      cell = null;
      table = null;
    }
  };

  return { accept, sheet: () => ({ dataStyles, cellStyles, hiddenTableStyles }) };
}

/** Parent chains longer than this are cut; a loop cannot hang the resolver. */
const MAX_STYLE_DEPTH = 16;

/** A cell style's data style (inherited through parents) and visual styling. */
export function resolveCellStyle(
  styles: OdsStyleSheetV1,
  styleName: string | null,
): { readonly dataStyle: DataStyleV1 | null; readonly isVisual: boolean } {
  let dataStyle: DataStyleV1 | null = null;
  let isVisual = false;
  let name = styleName;
  for (let depth = 0; name !== null && depth < MAX_STYLE_DEPTH; depth += 1) {
    const entry = styles.cellStyles.get(name);
    if (entry === undefined) break;
    isVisual ||= entry.isVisual;
    if (dataStyle === null && entry.dataStyleName !== null) {
      dataStyle = styles.dataStyles.get(entry.dataStyleName) ?? null;
    }
    name = entry.parent;
  }
  return { dataStyle, isVisual };
}

const GENERAL: CellFormatV1 = Object.freeze({ numberFormat: "General", formatClass: "general", currencySymbol: null });

const DEFAULT_CODES: Readonly<Record<string, string>> = {
  percentage: "0%",
  currency: "#,##0.00",
  date: "yyyy-mm-dd",
  time: "hh:mm:ss",
  boolean: "BOOLEAN",
};

const CLASS_OF_DATA_STYLE: Readonly<Record<DataStyleKindV1, FormatClassV1>> = {
  number: "number",
  currency: "currency",
  percentage: "percent",
  date: "date",
  time: "time",
  boolean: "other",
  text: "text",
};

/**
 * The format class comes from the cell's declared value type first — ODS
 * states `currency`, `percentage`, `date` outright — and from its data style
 * second; the code is the data style's Excel spelling.
 */
export function cellFormatOf(
  valueType: string,
  dataStyle: DataStyleV1 | null,
  declaredCurrency: string | null,
): CellFormatV1 {
  const code = dataStyle?.code ?? DEFAULT_CODES[valueType] ?? "General";
  let formatClass: FormatClassV1;
  switch (valueType) {
    case "percentage":
      formatClass = "percent";
      break;
    case "currency":
      formatClass = "currency";
      break;
    case "date":
      formatClass = dataStyle?.hasTime === true ? "datetime" : "date";
      break;
    case "time":
      formatClass = "time";
      break;
    case "boolean":
      formatClass = "other";
      break;
    default:
      if (dataStyle === null || code === "General") return GENERAL;
      formatClass =
        dataStyle.kind === "date" && dataStyle.hasTime ? "datetime" : CLASS_OF_DATA_STYLE[dataStyle.kind];
  }
  return {
    numberFormat: code,
    formatClass,
    currencySymbol: formatClass === "currency" ? (dataStyle?.currencySymbol ?? declaredCurrency) : null,
  };
}
