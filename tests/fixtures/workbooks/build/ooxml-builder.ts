/**
 * Writes OOXML (`.xlsx`) workbooks from a typed description (M58).
 *
 * The description covers the declared structure the adapter must read —
 * sheets and their visibility, shared/inline/rich strings, numbers, booleans,
 * errors, formulas (plain, shared, array), number formats and cell styles,
 * declared tables, data validations, merges, drawings (shapes, pictures,
 * charts), comments, hyperlinks, pivot tables, conditional formatting,
 * sparklines, embedded objects, form controls, external links and data
 * connections — in either the Transitional or the Strict namespace set.
 * {@link ooxmlEntries} returns the parts before zipping so a fixture can
 * tamper with them (a DTD, a macro part, a renamed content type).
 */

import { writeZip, type ZipEntrySpec } from "./zip-writer.js";

export type CellInput =
  | string
  | number
  | boolean
  | null
  | { readonly error: string }
  | { readonly inline: string }
  | { readonly rich: readonly string[] }
  /** Written verbatim as `<v>` with the given `t` — for malformed values. */
  | { readonly raw: string; readonly type?: "n" | "s" | "str" | "b" | "e" | "d" };

export type FormulaSpec =
  | { readonly text: string }
  | { readonly shared: { readonly si: number; readonly ref?: string; readonly text?: string } }
  | { readonly array: { readonly ref: string; readonly text: string } };

export interface CellSpec {
  readonly value?: CellInput;
  readonly style?: number;
  readonly formula?: FormulaSpec;
}

export type RowSpec = readonly (CellSpec | CellInput | undefined)[];

export interface AnchorSpec {
  /** `B2:H18` — the cells the object covers. */
  readonly range: string;
}

/** One `c:ser`; every reference is written as `c:f` formula text. */
export interface ChartSeriesSpec {
  /** A literal series name (`c:tx/c:v`). */
  readonly name?: string;
  /** A series name taken from a cell (`c:tx/c:strRef`). */
  readonly nameRef?: string;
  readonly cat?: string;
  readonly val?: string;
  /** Scatter `c:xVal` / `c:yVal`. */
  readonly x?: string;
  readonly y?: string;
}

export interface ChartSpec extends AnchorSpec {
  /** The plot element (`barChart`, `scatterChart` …); omitted, the part is F03's empty `c:chart`. */
  readonly type?: string;
  readonly barDir?: "bar" | "col";
  readonly grouping?: string;
  readonly title?: string;
  readonly series?: readonly ChartSeriesSpec[];
}

const PIE_PLOTS = new Set(["pieChart", "pie3DChart", "doughnutChart", "ofPieChart"]);

/** A chart part's body as ECMA-376 §21.2 lays it out, from a spec with a plot type. */
const chartBody = (chart: ChartSpec & { readonly type: string }): string => {
  const reference = (tag: string, kind: "strRef" | "numRef", formula: string | undefined) =>
    formula === undefined ? "" : `<c:${tag}><c:${kind}><c:f>${escapeXml(formula)}</c:f></c:${kind}></c:${tag}>`;
  const series = (chart.series ?? []).map((each, index) => {
    const name = each.nameRef !== undefined
      ? reference("tx", "strRef", each.nameRef)
      : each.name === undefined ? "" : `<c:tx><c:v>${escapeXml(each.name)}</c:v></c:tx>`;
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${name}${reference("cat", "strRef", each.cat)}${reference("val", "numRef", each.val)}${reference("xVal", "numRef", each.x)}${reference("yVal", "numRef", each.y)}</c:ser>`;
  });
  const isScatter = chart.type === "scatterChart";
  const hasAxes = !PIE_PLOTS.has(chart.type);
  const head =
    (isScatter ? '<c:scatterStyle val="lineMarker"/>' : "") +
    (chart.barDir === undefined ? "" : `<c:barDir val="${chart.barDir}"/>`) +
    (chart.grouping === undefined ? "" : `<c:grouping val="${chart.grouping}"/>`) +
    '<c:varyColors val="0"/>';
  const axis = (tag: string, id: number, cross: number, position: string) =>
    `<c:${tag}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${position}"/><c:crossAx val="${cross}"/></c:${tag}>`;
  const axes = hasAxes ? axis(isScatter ? "valAx" : "catAx", 100, 200, "b") + axis("valAx", 200, 100, "l") : "";
  const title = chart.title === undefined
    ? '<c:autoTitleDeleted val="1"/>'
    : `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escapeXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
  return `${title}<c:plotArea><c:layout/><c:${chart.type}>${head}${series.join("")}${hasAxes ? '<c:axId val="100"/><c:axId val="200"/>' : ""}</c:${chart.type}>${axes}</c:plotArea><c:plotVisOnly val="1"/>`;
};

export interface ValidationSpec {
  readonly sqref: string;
  readonly type: "list" | "whole" | "decimal" | "date" | "time" | "textLength" | "custom";
  readonly operator?: string;
  readonly formula1?: string;
  readonly formula2?: string;
  /** Written in the Excel 2010 `x14` extension, as cross-sheet lists often are. */
  readonly extension?: boolean;
}

export interface TableSpec {
  readonly name: string;
  readonly ref: string;
  readonly columns: readonly string[];
  readonly headerRowCount?: number;
  readonly totalsRowCount?: number;
}

export interface PivotSpec {
  readonly name: string;
  /** Where the pivot sits (`location@ref`). */
  readonly ref: string;
  /** A real definition over a worksheet cache; omitted, the parts stay F03's bare shells. */
  readonly cache?: {
    /** `cacheField@name`, in cache order. */
    readonly fields: readonly string[];
    /** `worksheetSource@ref,@sheet`, or `@name` (a table or defined name). */
    readonly source: { readonly sheet: string; readonly ref: string } | { readonly name: string };
    /** `rowFields/field@x`; `-2` is the "Values" field. */
    readonly rowFields?: readonly number[];
    readonly colFields?: readonly number[];
    /** `dataFields/dataField`; no `subtotal` writes none (the default, sum). */
    readonly dataFields?: readonly { readonly name: string; readonly fld: number; readonly subtotal?: string }[];
  };
}

export interface SheetSpec {
  readonly name: string;
  readonly kind?: "worksheet" | "chartsheet" | "dialogsheet" | "macrosheet";
  readonly state?: "visible" | "hidden" | "veryHidden";
  /** Defaults to the populated extent; `null` omits `<dimension>`. */
  readonly dimension?: string | null;
  readonly rows?: readonly (RowSpec | undefined)[];
  readonly merges?: readonly string[];
  readonly validations?: readonly ValidationSpec[];
  readonly tables?: readonly TableSpec[];
  readonly shapes?: readonly AnchorSpec[];
  readonly pictures?: readonly AnchorSpec[];
  readonly charts?: readonly ChartSpec[];
  readonly comments?: readonly { readonly ref: string; readonly text: string }[];
  readonly hyperlinks?: readonly { readonly ref: string; readonly target: string }[];
  readonly conditionalFormatting?: readonly string[];
  readonly pivotTables?: readonly PivotSpec[];
  readonly sparklines?: boolean;
  readonly oleObjects?: number;
  readonly formControls?: number;
}

export interface StylesSpec {
  readonly numFmts?: readonly { readonly id: number; readonly code: string }[];
  /** `cellXfs` in order; index 0 is the default style. */
  readonly cellXfs?: readonly { readonly numFmtId: number; readonly fontId?: number; readonly fillId?: number }[];
}

export interface WorkbookSpec {
  readonly strict?: boolean;
  readonly date1904?: boolean;
  readonly sheets: readonly SheetSpec[];
  readonly definedNames?: readonly {
    readonly name: string;
    readonly ref: string;
    readonly localSheetId?: number;
    readonly hidden?: boolean;
  }[];
  readonly styles?: StylesSpec;
  readonly externalLinks?: number;
  readonly connections?: boolean;
  readonly vbaProject?: boolean;
  /** The workbook part's content type, when it must lie or differ. */
  readonly workbookContentType?: string;
  readonly method?: "stored" | "deflate";
}

const TRANSITIONAL = {
  main: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel: (type: string) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}`,
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
};

const STRICT = {
  main: "http://purl.oclc.org/ooxml/spreadsheetml/main",
  r: "http://purl.oclc.org/ooxml/officeDocument/relationships",
  rel: (type: string) => `http://purl.oclc.org/ooxml/officeDocument/relationships/${type}`,
  drawing: "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing",
  a: "http://purl.oclc.org/ooxml/drawingml/main",
  chart: "http://purl.oclc.org/ooxml/drawingml/chart",
};

const MS_REL = (type: string) => `http://schemas.microsoft.com/office/2006/relationships/${type}`;
const PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const SML = "application/vnd.openxmlformats-officedocument.spreadsheetml";

export const CONTENT_TYPES = Object.freeze({
  workbook: `${SML}.sheet.main+xml`,
  macroWorkbook: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  worksheet: `${SML}.worksheet+xml`,
  chartsheet: `${SML}.chartsheet+xml`,
  dialogsheet: `${SML}.dialogsheet+xml`,
  macrosheet: "application/vnd.ms-excel.macrosheet+xml",
  sharedStrings: `${SML}.sharedStrings+xml`,
  styles: `${SML}.styles+xml`,
  table: `${SML}.table+xml`,
  comments: `${SML}.comments+xml`,
  pivotTable: `${SML}.pivotTable+xml`,
  pivotCache: `${SML}.pivotCacheDefinition+xml`,
  externalLink: `${SML}.externalLink+xml`,
  connections: `${SML}.connections+xml`,
  drawing: "application/vnd.openxmlformats-officedocument.drawing+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  vbaProject: "application/vnd.ms-office.vbaProject",
  ctrlProp: "application/vnd.ms-excel.controlproperties+xml",
  oleObject: "application/vnd.openxmlformats-officedocument.oleObject",
});

export const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const columnName = (index: number): string => {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
};

export const cellRef = (row: number, column: number): string => `${columnName(column)}${row + 1}`;

const parseRef = (ref: string): { row: number; column: number } => {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  if (match === null) throw new Error(`bad ref ${ref}`);
  let column = 0;
  for (const letter of match[1] as string) column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
};

const isCellSpec = (cell: CellSpec | CellInput): cell is CellSpec =>
  typeof cell === "object" && cell !== null && ("value" in cell || "formula" in cell || "style" in cell);

class Relationships {
  private readonly items: string[] = [];

  add(type: string, target: string, external = false): string {
    const id = `rId${this.items.length + 1}`;
    this.items.push(
      `<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ""}/>`,
    );
    return id;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PACKAGE_RELS}">${this.items.join("")}</Relationships>`;
  }
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Every part of the workbook, in a fixed order, before it is zipped. */
export const ooxmlEntries = (spec: WorkbookSpec): ZipEntrySpec[] => {
  const ns = spec.strict === true ? STRICT : TRANSITIONAL;
  const method = spec.method ?? "deflate";
  const parts: { name: string; data: string | Uint8Array; contentType?: string }[] = [];
  const sharedStrings: string[] = [];
  const sharedIndex = new Map<string, number>();
  let sharedCount = 0;
  const share = (xml: string): number => {
    sharedCount += 1;
    const existing = sharedIndex.get(xml);
    if (existing !== undefined) return existing;
    sharedIndex.set(xml, sharedStrings.length);
    sharedStrings.push(xml);
    return sharedStrings.length - 1;
  };
  const tText = (text: string) =>
    `<t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""}>${escapeXml(text)}</t>`;

  const workbookRels = new Relationships();
  let tableCount = 0;
  let drawingCount = 0;
  let chartCount = 0;
  let imageCount = 0;
  let commentCount = 0;
  let pivotCount = 0;
  let embedCount = 0;
  let controlCount = 0;
  const pivotCaches: string[] = [];
  const sheetEntries: string[] = [];

  for (const [sheetIndex, sheet] of spec.sheets.entries()) {
    const kind = sheet.kind ?? "worksheet";
    const folder = { worksheet: "worksheets", chartsheet: "chartsheets", dialogsheet: "dialogsheets", macrosheet: "macrosheets" }[kind];
    const partName = `xl/${folder}/sheet${sheetIndex + 1}.xml`;
    const relType = kind === "macrosheet" ? MS_REL("xlMacrosheet") : ns.rel(kind);
    const relId = workbookRels.add(relType, `${folder}/sheet${sheetIndex + 1}.xml`);
    const state = sheet.state === undefined || sheet.state === "visible" ? "" : ` state="${sheet.state}"`;
    sheetEntries.push(`<sheet name="${escapeXml(sheet.name)}" sheetId="${sheetIndex + 1}"${state} r:id="${relId}"/>`);
    const sheetRels = new Relationships();

    let drawingRel: string | null = null;
    const anchors = [
      ...(sheet.shapes ?? []).map((anchor) => ({ ...anchor, type: "shape" as const })),
      ...(sheet.pictures ?? []).map((anchor) => ({ ...anchor, type: "picture" as const })),
      ...(sheet.charts ?? []).map((chart) => ({ range: chart.range, type: "chart" as const, chart })),
    ];
    if (anchors.length > 0) {
      drawingCount += 1;
      const drawingName = `xl/drawings/drawing${drawingCount}.xml`;
      drawingRel = sheetRels.add(ns.rel("drawing"), `../drawings/drawing${drawingCount}.xml`);
      const drawingRels = new Relationships();
      const body = anchors
        .map((anchor, index) => {
          const [from, to] = anchor.range.split(":").map(parseRef) as [ReturnType<typeof parseRef>, ReturnType<typeof parseRef>];
          const marker = (tag: string, at: { row: number; column: number }) =>
            `<xdr:${tag}><xdr:col>${at.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
          let element: string;
          if (anchor.type === "shape") {
            element = `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${index + 2}" name="Shape ${index + 1}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp>`;
          } else if (anchor.type === "picture") {
            imageCount += 1;
            const imageRel = drawingRels.add(ns.rel("image"), `../media/image${imageCount}.png`);
            parts.push({ name: `xl/media/image${imageCount}.png`, data: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) });
            element = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="Picture ${index + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${imageRel}"/></xdr:blipFill><xdr:spPr/></xdr:pic>`;
          } else {
            chartCount += 1;
            const chartRel = drawingRels.add(ns.rel("chart"), `../charts/chart${chartCount}.xml`);
            const type = anchor.chart.type;
            parts.push({
              name: `xl/charts/chart${chartCount}.xml`,
              data: type === undefined
                ? `${XML_DECLARATION}<c:chartSpace xmlns:c="${ns.chart}"><c:chart/></c:chartSpace>`
                : `${XML_DECLARATION}<c:chartSpace xmlns:c="${ns.chart}" xmlns:a="${ns.a}" xmlns:r="${ns.r}"><c:chart>${chartBody({ ...anchor.chart, type })}</c:chart></c:chartSpace>`,
              contentType: CONTENT_TYPES.chart,
            });
            element = `<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="${ns.chart}"><c:chart xmlns:c="${ns.chart}" r:id="${chartRel}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
          }
          return `<xdr:twoCellAnchor>${marker("from", from)}${marker("to", to)}${element}<xdr:clientData/></xdr:twoCellAnchor>`;
        })
        .join("");
      parts.push({
        name: drawingName,
        data: `${XML_DECLARATION}<xdr:wsDr xmlns:xdr="${ns.drawing}" xmlns:a="${ns.a}" xmlns:r="${ns.r}">${body}</xdr:wsDr>`,
        contentType: CONTENT_TYPES.drawing,
      });
      if (!drawingRels.isEmpty) {
        parts.push({ name: `xl/drawings/_rels/drawing${drawingCount}.xml.rels`, data: drawingRels.xml() });
      }
    }

    if (kind === "chartsheet") {
      parts.push({
        name: partName,
        data: `${XML_DECLARATION}<chartsheet xmlns="${ns.main}" xmlns:r="${ns.r}"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${drawingRel === null ? "" : `<drawing r:id="${drawingRel}"/>`}</chartsheet>`,
        contentType: CONTENT_TYPES.chartsheet,
      });
      if (!sheetRels.isEmpty) parts.push({ name: `xl/${folder}/_rels/sheet${sheetIndex + 1}.xml.rels`, data: sheetRels.xml() });
      continue;
    }

    const rows = sheet.rows ?? [];
    let maxRow = -1;
    let maxColumn = -1;
    const rowXml: string[] = [];
    for (const [rowIndex, row] of rows.entries()) {
      if (row === undefined) continue;
      const cells: string[] = [];
      for (const [columnIndex, raw] of row.entries()) {
        if (raw === undefined) continue;
        const cell: CellSpec = isCellSpec(raw) ? raw : { value: raw };
        const ref = cellRef(rowIndex, columnIndex);
        const style = cell.style === undefined ? "" : ` s="${cell.style}"`;
        let formula = "";
        if (cell.formula !== undefined) {
          const f = cell.formula;
          if ("text" in f) formula = `<f>${escapeXml(f.text)}</f>`;
          else if ("shared" in f) {
            const range = f.shared.ref === undefined ? "" : ` ref="${f.shared.ref}"`;
            formula = f.shared.text === undefined
              ? `<f t="shared" si="${f.shared.si}"/>`
              : `<f t="shared"${range} si="${f.shared.si}">${escapeXml(f.shared.text)}</f>`;
          } else formula = `<f t="array" ref="${f.array.ref}">${escapeXml(f.array.text)}</f>`;
        }
        const value = cell.value;
        let body: string;
        let type = "";
        if (value === undefined || value === null) body = "";
        else if (typeof value === "number") body = `<v>${value}</v>`;
        else if (typeof value === "boolean") {
          type = ' t="b"';
          body = `<v>${value ? 1 : 0}</v>`;
        } else if (typeof value === "string") {
          if (cell.formula === undefined) {
            type = ' t="s"';
            body = `<v>${share(tText(value))}</v>`;
          } else {
            type = ' t="str"';
            body = `<v>${escapeXml(value)}</v>`;
          }
        } else if ("error" in value) {
          type = ' t="e"';
          body = `<v>${escapeXml(value.error)}</v>`;
        } else if ("inline" in value) {
          type = ' t="inlineStr"';
          body = `<is>${tText(value.inline)}</is>`;
        } else if ("rich" in value) {
          type = ' t="s"';
          body = `<v>${share(value.rich.map((run, index) => `<r>${index % 2 === 1 ? "<rPr><b/></rPr>" : ""}${tText(run)}</r>`).join(""))}</v>`;
        } else {
          type = value.type === undefined ? "" : ` t="${value.type}"`;
          body = `<v>${escapeXml(value.raw)}</v>`;
        }
        cells.push(`<c r="${ref}"${style}${type}>${formula}${body}</c>`);
        maxRow = Math.max(maxRow, rowIndex);
        maxColumn = Math.max(maxColumn, columnIndex);
      }
      rowXml.push(`<row r="${rowIndex + 1}">${cells.join("")}</row>`);
    }
    const dimensionRef =
      sheet.dimension === undefined
        ? maxRow === -1 ? "A1" : `A1:${cellRef(maxRow, maxColumn)}`
        : sheet.dimension;

    const after: string[] = [];
    if (sheet.merges !== undefined && sheet.merges.length > 0) {
      after.push(`<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`);
    }
    for (const range of sheet.conditionalFormatting ?? []) {
      after.push(`<conditionalFormatting sqref="${range}"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>`);
    }
    const validationXml = (validation: ValidationSpec, isExtension: boolean) => {
      const operator = validation.operator === undefined ? "" : ` operator="${validation.operator}"`;
      const formula = (tag: string, text: string | undefined) =>
        text === undefined ? "" : isExtension ? `<x14:${tag}><xm:f>${escapeXml(text)}</xm:f></x14:${tag}>` : `<${tag}>${escapeXml(text)}</${tag}>`;
      return isExtension
        ? `<x14:dataValidation type="${validation.type}"${operator} allowBlank="1">${formula("formula1", validation.formula1)}${formula("formula2", validation.formula2)}<xm:sqref>${validation.sqref}</xm:sqref></x14:dataValidation>`
        : `<dataValidation type="${validation.type}"${operator} allowBlank="1" sqref="${validation.sqref}">${formula("formula1", validation.formula1)}${formula("formula2", validation.formula2)}</dataValidation>`;
    };
    const plainValidations = (sheet.validations ?? []).filter((validation) => validation.extension !== true);
    const extensionValidations = (sheet.validations ?? []).filter((validation) => validation.extension === true);
    if (plainValidations.length > 0) {
      after.push(`<dataValidations count="${plainValidations.length}">${plainValidations.map((validation) => validationXml(validation, false)).join("")}</dataValidations>`);
    }
    const hyperlinks = sheet.hyperlinks ?? [];
    if (hyperlinks.length > 0) {
      after.push(`<hyperlinks>${hyperlinks.map((link) => `<hyperlink ref="${link.ref}" r:id="${sheetRels.add(ns.rel("hyperlink"), link.target, true)}"/>`).join("")}</hyperlinks>`);
    }
    if (drawingRel !== null) after.push(`<drawing r:id="${drawingRel}"/>`);
    if ((sheet.comments ?? []).length > 0) {
      commentCount += 1;
      sheetRels.add(ns.rel("comments"), `../comments${commentCount}.xml`);
      parts.push({
        name: `xl/comments${commentCount}.xml`,
        data: `${XML_DECLARATION}<comments xmlns="${ns.main}"><authors><author>Author</author></authors><commentList>${(sheet.comments ?? []).map((comment) => `<comment ref="${comment.ref}" authorId="0"><text><r>${tText(comment.text)}</r></text></comment>`).join("")}</commentList></comments>`,
        contentType: CONTENT_TYPES.comments,
      });
    }
    const objects: string[] = [];
    for (let index = 0; index < (sheet.oleObjects ?? 0); index += 1) {
      embedCount += 1;
      const rel = sheetRels.add(ns.rel("oleObject"), `../embeddings/oleObject${embedCount}.bin`);
      parts.push({ name: `xl/embeddings/oleObject${embedCount}.bin`, data: Uint8Array.of(0, 1, 2, 3), contentType: CONTENT_TYPES.oleObject });
      objects.push(`<oleObject progId="Package" shapeId="${1024 + embedCount}" r:id="${rel}"/>`);
    }
    if (objects.length > 0) after.push(`<oleObjects>${objects.join("")}</oleObjects>`);
    const controls: string[] = [];
    for (let index = 0; index < (sheet.formControls ?? 0); index += 1) {
      controlCount += 1;
      const rel = sheetRels.add(ns.rel("ctrlProp"), `../ctrlProps/ctrlProp${controlCount}.xml`);
      parts.push({ name: `xl/ctrlProps/ctrlProp${controlCount}.xml`, data: `${XML_DECLARATION}<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" objectType="Button"/>`, contentType: CONTENT_TYPES.ctrlProp });
      controls.push(`<control shapeId="${2048 + controlCount}" r:id="${rel}" name="Button ${controlCount}"/>`);
    }
    if (controls.length > 0) after.push(`<controls>${controls.join("")}</controls>`);
    const tables = sheet.tables ?? [];
    if (tables.length > 0) {
      const tableParts = tables.map((table) => {
        tableCount += 1;
        const rel = sheetRels.add(ns.rel("table"), `../tables/table${tableCount}.xml`);
        const header = table.headerRowCount === undefined ? "" : ` headerRowCount="${table.headerRowCount}"`;
        const totals = table.totalsRowCount === undefined ? "" : ` totalsRowCount="${table.totalsRowCount}"`;
        parts.push({
          name: `xl/tables/table${tableCount}.xml`,
          data: `${XML_DECLARATION}<table xmlns="${ns.main}" id="${tableCount}" name="${escapeXml(table.name)}" displayName="${escapeXml(table.name)}" ref="${table.ref}"${header}${totals}><tableColumns count="${table.columns.length}">${table.columns.map((column, index) => `<tableColumn id="${index + 1}" name="${escapeXml(column)}"/>`).join("")}</tableColumns><tableStyleInfo name="TableStyleMedium2" showRowStripes="1"/></table>`,
          contentType: CONTENT_TYPES.table,
        });
        return `<tablePart r:id="${rel}"/>`;
      });
      after.push(`<tableParts count="${tables.length}">${tableParts.join("")}</tableParts>`);
    }
    for (const pivot of sheet.pivotTables ?? []) {
      pivotCount += 1;
      sheetRels.add(ns.rel("pivotTable"), `../pivotTables/pivotTable${pivotCount}.xml`);
      const cache = pivot.cache;
      const fieldList = (tag: string, indexes: readonly number[] | undefined) =>
        indexes === undefined ? "" : `<${tag} count="${indexes.length}">${indexes.map((x) => `<field x="${x}"/>`).join("")}</${tag}>`;
      const body = cache === undefined
        ? ""
        : `<pivotFields count="${cache.fields.length}">${cache.fields.map((_, index) => `<pivotField${cache.rowFields?.includes(index) === true ? ' axis="axisRow"' : ""}${cache.dataFields?.some((field) => field.fld === index) === true ? ' dataField="1"' : ""} showAll="0"/>`).join("")}</pivotFields>` +
          fieldList("rowFields", cache.rowFields) +
          fieldList("colFields", cache.colFields) +
          (cache.dataFields === undefined ? "" : `<dataFields count="${cache.dataFields.length}">${cache.dataFields.map((field) => `<dataField name="${escapeXml(field.name)}" fld="${field.fld}"${field.subtotal === undefined ? "" : ` subtotal="${field.subtotal}"`} baseField="0" baseItem="0"/>`).join("")}</dataFields>`);
      parts.push({
        name: `xl/pivotTables/pivotTable${pivotCount}.xml`,
        data: `${XML_DECLARATION}<pivotTableDefinition xmlns="${ns.main}" name="${escapeXml(pivot.name)}" cacheId="${pivotCount}" dataCaption="Values"><location ref="${pivot.ref}" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/>${body}</pivotTableDefinition>`,
        contentType: CONTENT_TYPES.pivotTable,
      });
      if (cache !== undefined) {
        const pivotRels = new Relationships();
        pivotRels.add(ns.rel("pivotCacheDefinition"), `../pivotCache/pivotCacheDefinition${pivotCount}.xml`);
        parts.push({ name: `xl/pivotTables/_rels/pivotTable${pivotCount}.xml.rels`, data: pivotRels.xml() });
      }
      const cacheRel = workbookRels.add(ns.rel("pivotCacheDefinition"), `pivotCache/pivotCacheDefinition${pivotCount}.xml`);
      const source = cache === undefined
        ? ""
        : "name" in cache.source
          ? `name="${escapeXml(cache.source.name)}"`
          : `ref="${cache.source.ref}" sheet="${escapeXml(cache.source.sheet)}"`;
      parts.push({
        name: `xl/pivotCache/pivotCacheDefinition${pivotCount}.xml`,
        data: cache === undefined
          ? `${XML_DECLARATION}<pivotCacheDefinition xmlns="${ns.main}" recordCount="0"/>`
          : `${XML_DECLARATION}<pivotCacheDefinition xmlns="${ns.main}" xmlns:r="${ns.r}" recordCount="0"><cacheSource type="worksheet"><worksheetSource ${source}/></cacheSource><cacheFields count="${cache.fields.length}">${cache.fields.map((field) => `<cacheField name="${escapeXml(field)}" numFmtId="0"><sharedItems/></cacheField>`).join("")}</cacheFields></pivotCacheDefinition>`,
        contentType: CONTENT_TYPES.pivotCache,
      });
      pivotCaches.push(`<pivotCache cacheId="${pivotCount}" r:id="${cacheRel}"/>`);
    }
    const extensions: string[] = [];
    if (extensionValidations.length > 0) {
      extensions.push(`<ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="${extensionValidations.length}">${extensionValidations.map((validation) => validationXml(validation, true)).join("")}</x14:dataValidations></ext>`);
    }
    if (sheet.sparklines === true) {
      extensions.push(`<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:sparklineGroup><x14:sparklines><x14:sparkline><xm:f>${escapeXml(sheet.name)}!A1:A2</xm:f><xm:sqref>B1</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup></x14:sparklineGroups></ext>`);
    }
    if (extensions.length > 0) after.push(`<extLst>${extensions.join("")}</extLst>`);

    const root = kind === "worksheet" ? "worksheet" : kind === "dialogsheet" ? "dialogsheet" : "xm:macrosheet";
    const rootNs = kind === "macrosheet" ? ` xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" xmlns="${ns.main}"` : ` xmlns="${ns.main}"`;
    parts.push({
      name: partName,
      data: `${XML_DECLARATION}<${root}${rootNs} xmlns:r="${ns.r}">${dimensionRef === null ? "" : `<dimension ref="${dimensionRef}"/>`}<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${rowXml.join("")}</sheetData>${after.join("")}</${root}>`,
      contentType: CONTENT_TYPES[kind],
    });
    if (!sheetRels.isEmpty) parts.push({ name: `xl/${folder}/_rels/sheet${sheetIndex + 1}.xml.rels`, data: sheetRels.xml() });
  }

  for (let index = 1; index <= (spec.externalLinks ?? 0); index += 1) {
    workbookRels.add(ns.rel("externalLink"), `externalLinks/externalLink${index}.xml`);
    const linkRels = new Relationships();
    const target = linkRels.add(ns.rel("externalLinkPath"), `file:///C:/Budgets/Source${index}.xlsx`, true);
    parts.push({
      name: `xl/externalLinks/externalLink${index}.xml`,
      data: `${XML_DECLARATION}<externalLink xmlns="${ns.main}" xmlns:r="${ns.r}"><externalBook r:id="${target}"><sheetNames><sheetName val="Sheet1"/></sheetNames></externalBook></externalLink>`,
      contentType: CONTENT_TYPES.externalLink,
    });
    parts.push({ name: `xl/externalLinks/_rels/externalLink${index}.xml.rels`, data: linkRels.xml() });
  }
  if (spec.connections === true) {
    workbookRels.add(ns.rel("connections"), "connections.xml");
    parts.push({
      name: "xl/connections.xml",
      data: `${XML_DECLARATION}<connections xmlns="${ns.main}"><connection id="1" name="Orders feed" type="5" refreshedVersion="6"><dbPr connection="Provider=SQLOLEDB" command="orders"/></connection></connections>`,
      contentType: CONTENT_TYPES.connections,
    });
  }
  if (spec.vbaProject === true) {
    workbookRels.add(MS_REL("vbaProject"), "vbaProject.bin");
    parts.push({ name: "xl/vbaProject.bin", data: Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0), contentType: CONTENT_TYPES.vbaProject });
  }

  const styles = spec.styles ?? {};
  const numFmts = styles.numFmts ?? [];
  const cellXfs = styles.cellXfs ?? [{ numFmtId: 0 }];
  workbookRels.add(ns.rel("styles"), "styles.xml");
  parts.push({
    name: "xl/styles.xml",
    data: `${XML_DECLARATION}<styleSheet xmlns="${ns.main}">${numFmts.length === 0 ? "" : `<numFmts count="${numFmts.length}">${numFmts.map((format) => `<numFmt numFmtId="${format.id}" formatCode="${escapeXml(format.code)}"/>`).join("")}</numFmts>`}<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${cellXfs.length}">${cellXfs.map((xf) => `<xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId ?? 0}" fillId="${xf.fillId ?? 0}" borderId="0" xfId="0"${xf.numFmtId === 0 ? "" : ' applyNumberFormat="1"'}/>`).join("")}</cellXfs></styleSheet>`,
    contentType: CONTENT_TYPES.styles,
  });
  if (sharedStrings.length > 0) {
    workbookRels.add(ns.rel("sharedStrings"), "sharedStrings.xml");
    parts.push({
      name: "xl/sharedStrings.xml",
      data: `${XML_DECLARATION}<sst xmlns="${ns.main}" count="${sharedCount}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((body) => `<si>${body}</si>`).join("")}</sst>`,
      contentType: CONTENT_TYPES.sharedStrings,
    });
  }

  const definedNames = spec.definedNames ?? [];
  const workbookXml = `${XML_DECLARATION}<workbook xmlns="${ns.main}" xmlns:r="${ns.r}">${spec.date1904 === true ? '<workbookPr date1904="1"/>' : "<workbookPr/>"}<bookViews><workbookView/></bookViews><sheets>${sheetEntries.join("")}</sheets>${definedNames.length === 0 ? "" : `<definedNames>${definedNames.map((name) => `<definedName name="${escapeXml(name.name)}"${name.localSheetId === undefined ? "" : ` localSheetId="${name.localSheetId}"`}${name.hidden === true ? ' hidden="1"' : ""}>${escapeXml(name.ref)}</definedName>`).join("")}</definedNames>`}${pivotCaches.length === 0 ? "" : `<pivotCaches>${pivotCaches.join("")}</pivotCaches>`}</workbook>`;

  const officeDocument = spec.strict === true
    ? "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"
    : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
  const packageRels = new Relationships();
  packageRels.add(officeDocument, "xl/workbook.xml");

  const workbookType = spec.workbookContentType ?? (spec.vbaProject === true ? CONTENT_TYPES.macroWorkbook : CONTENT_TYPES.workbook);
  const overrides = [
    { name: "xl/workbook.xml", contentType: workbookType },
    ...parts.filter((part) => part.contentType !== undefined),
  ];
  const contentTypes = `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.map((part) => `<Override PartName="/${part.name}" ContentType="${part.contentType}"/>`).join("")}</Types>`;

  return [
    { name: "[Content_Types].xml", data: contentTypes, method },
    { name: "_rels/.rels", data: packageRels.xml(), method },
    { name: "xl/workbook.xml", data: workbookXml, method },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels.xml(), method },
    ...parts.map((part) => ({ name: part.name, data: part.data, method })),
  ];
};

export const buildOoxml = (spec: WorkbookSpec): Uint8Array => writeZip(ooxmlEntries(spec));
