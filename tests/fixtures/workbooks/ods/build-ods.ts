/**
 * A deterministic ODS package builder for the ODS corpus (M58).
 *
 * The fixtures are written as the OpenDocument parts a producer writes —
 * `mimetype` first and stored, a manifest, `content.xml`, `styles.xml`,
 * `meta.xml`, `settings.xml` — through S01's fixed deflate encoder, so the
 * committed bytes are a pure function of the spec below.
 */

import { writeZip, type ZipEntrySpec } from "../build/zip-writer.js";

export const ODS_NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"',
  'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"',
  'xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0"',
  'xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"',
].join(" ");

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

export const SPREADSHEET_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";

/** Escapes text and attribute values. */
export const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attributes = (attrs: Readonly<Record<string, string | number>> = {}): string =>
  Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${esc(String(value))}"`)
    .join("");

/** A paragraph list: each string is one `text:p`. */
export const paragraphs = (...lines: string[]): string => lines.map((line) => `<text:p>${esc(line)}</text:p>`).join("");

export type OdsCell =
  | string
  | number
  | boolean
  | null
  | { readonly attrs?: Readonly<Record<string, string | number>>; readonly inner?: string; readonly covered?: boolean };

/** One `table:table-cell` in the shape LibreOffice writes for each value type. */
export const cellXml = (cell: OdsCell): string => {
  if (cell === null) return "<table:table-cell/>";
  if (typeof cell === "string") {
    return `<table:table-cell office:value-type="string" calcext:value-type="string">${paragraphs(cell)}</table:table-cell>`;
  }
  if (typeof cell === "number") {
    return `<table:table-cell office:value-type="float" office:value="${cell}" calcext:value-type="float">${paragraphs(String(cell))}</table:table-cell>`;
  }
  if (typeof cell === "boolean") {
    return `<table:table-cell office:value-type="boolean" office:boolean-value="${cell}" calcext:value-type="boolean">${paragraphs(cell ? "TRUE" : "FALSE")}</table:table-cell>`;
  }
  const element = cell.covered === true ? "table:covered-table-cell" : "table:table-cell";
  return cell.inner === undefined || cell.inner === ""
    ? `<${element}${attributes(cell.attrs)}/>`
    : `<${element}${attributes(cell.attrs)}>${cell.inner}</${element}>`;
};

export const rowXml = (cells: readonly OdsCell[], attrs?: Readonly<Record<string, string | number>>): string =>
  `<table:table-row${attributes(attrs)}>${cells.map(cellXml).join("")}</table:table-row>`;

export interface OdsTableSpec {
  readonly name: string;
  readonly styleName?: string;
  /** Raw XML placed before the columns: `table:shapes`. */
  readonly prelude?: string;
  /** Raw XML placed after the rows: conditional formats, named expressions. */
  readonly trailer?: string;
  readonly columns?: string;
  readonly rows: readonly string[];
}

export const tableXml = (table: OdsTableSpec): string =>
  `<table:table${attributes({ "table:name": table.name, ...(table.styleName === undefined ? {} : { "table:style-name": table.styleName }) })}>` +
  (table.prelude ?? "") +
  (table.columns ?? '<table:table-column table:number-columns-repeated="16"/>') +
  table.rows.join("") +
  (table.trailer ?? "") +
  "</table:table>";

export interface OdsContentSpec {
  readonly automaticStyles?: string;
  /** `table:content-validations` children. */
  readonly validations?: string;
  readonly tables: readonly OdsTableSpec[];
  /** After the tables: named expressions, database ranges, DDE links. */
  readonly trailer?: string;
  /** Before `office:body`: `office:scripts`, event listeners. */
  readonly scripts?: string;
}

export const contentXml = (spec: OdsContentSpec): string =>
  `${HEADER}<office:document-content ${ODS_NAMESPACES} office:version="1.2">` +
  (spec.scripts ?? "<office:scripts/>") +
  `<office:automatic-styles>${spec.automaticStyles ?? ""}</office:automatic-styles>` +
  "<office:body><office:spreadsheet>" +
  (spec.validations === undefined ? "" : `<table:content-validations>${spec.validations}</table:content-validations>`) +
  spec.tables.map(tableXml).join("") +
  (spec.trailer ?? "") +
  "</office:spreadsheet></office:body></office:document-content>";

export const stylesXml = (styles = ""): string =>
  `${HEADER}<office:document-styles ${ODS_NAMESPACES} office:version="1.2"><office:styles>` +
  '<style:style style:name="Default" style:family="table-cell"/>' +
  styles +
  "</office:styles></office:document-styles>";

export const metaXml = (statistics: { tableCount: number; cellCount?: number }): string =>
  `${HEADER}<office:document-meta ${ODS_NAMESPACES} office:version="1.2"><office:meta>` +
  "<meta:generator>Sheaf fixture builder</meta:generator>" +
  `<meta:document-statistic meta:table-count="${statistics.tableCount}"${statistics.cellCount === undefined ? "" : ` meta:cell-count="${statistics.cellCount}"`}/>` +
  "</office:meta></office:document-meta>";

/** The view settings LibreOffice writes; the `Tables` map names each sheet. */
export const settingsXml = (sheetNames: readonly string[]): string =>
  `${HEADER}<office:document-settings ${ODS_NAMESPACES} office:version="1.2"><office:settings>` +
  '<config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>' +
  '<config:config-item config:name="ViewId" config:type="string">view1</config:config-item>' +
  '<config:config-item-map-named config:name="Tables">' +
  sheetNames
    .map(
      (name) =>
        `<config:config-item-map-entry config:name="${esc(name)}">` +
        '<config:config-item config:name="CursorPositionX" config:type="int">0</config:config-item>' +
        '<config:config-item config:name="CursorPositionY" config:type="int">0</config:config-item>' +
        "</config:config-item-map-entry>",
    )
    .join("") +
  "</config:config-item-map-named>" +
  '<config:config-item config:name="ActiveTable" config:type="string">' +
  esc(sheetNames[0] ?? "") +
  "</config:config-item>" +
  "</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set>" +
  "</office:settings></office:document-settings>";

export interface OdsPackageSpec {
  readonly content: OdsContentSpec;
  readonly styles?: string;
  /** `null` omits `meta.xml`; default states the true table count. */
  readonly meta?: { tableCount: number; cellCount?: number } | null;
  /** `null` omits `settings.xml`; default names every table. */
  readonly settings?: readonly string[] | null;
  readonly mimetype?: string;
  readonly extraEntries?: readonly (ZipEntrySpec & { readonly mediaType: string })[];
  /** Manifest-only entries: sub-document directories such as `Object 1/`. */
  readonly manifestEntries?: readonly { readonly path: string; readonly mediaType: string }[];
  /** Manifest entries that carry `manifest:encryption-data`. */
  readonly encrypted?: readonly string[];
}

const manifestXml = (entries: readonly { path: string; mediaType: string }[], encrypted: readonly string[], mimetype: string): string =>
  `${HEADER}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
  `<manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/>` +
  entries
    .map(({ path, mediaType }) =>
      encrypted.includes(path)
        ? `<manifest:file-entry manifest:full-path="${esc(path)}" manifest:media-type="${esc(mediaType)}">` +
          '<manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="AAAA">' +
          '<manifest:algorithm manifest:algorithm-name="Blowfish CFB" manifest:initialisation-vector="AAAA"/>' +
          '<manifest:key-derivation manifest:key-derivation-name="PBKDF2" manifest:iteration-count="1024" manifest:salt="AAAA"/>' +
          "</manifest:encryption-data></manifest:file-entry>"
        : `<manifest:file-entry manifest:full-path="${esc(path)}" manifest:media-type="${esc(mediaType)}"/>`,
    )
    .join("") +
  "</manifest:manifest>";

/** The package's ZIP entries, in the order LibreOffice writes them. */
export const odsEntries = (spec: OdsPackageSpec): ZipEntrySpec[] => {
  const mimetype = spec.mimetype ?? SPREADSHEET_MIMETYPE;
  const tableNames = spec.content.tables.map((table) => table.name);
  const parts: { path: string; mediaType: string; data: ZipEntrySpec["data"] }[] = [
    { path: "content.xml", mediaType: "text/xml", data: contentXml(spec.content) },
    { path: "styles.xml", mediaType: "text/xml", data: stylesXml(spec.styles) },
  ];
  const meta = spec.meta === undefined ? { tableCount: tableNames.length } : spec.meta;
  if (meta !== null) parts.push({ path: "meta.xml", mediaType: "text/xml", data: metaXml(meta) });
  const settings = spec.settings === undefined ? tableNames : spec.settings;
  if (settings !== null) parts.push({ path: "settings.xml", mediaType: "text/xml", data: settingsXml(settings) });
  for (const extra of spec.extraEntries ?? []) {
    parts.push({ path: extra.name, mediaType: extra.mediaType, data: extra.data });
  }
  return [
    { name: "mimetype", data: mimetype, method: "stored" },
    ...parts.map(({ path, data }) => ({ name: path, data })),
    {
      name: "META-INF/manifest.xml",
      data: manifestXml(
        [...parts.map(({ path, mediaType }) => ({ path, mediaType })), ...(spec.manifestEntries ?? [])],
        spec.encrypted ?? [],
        mimetype,
      ),
    },
  ];
};

export const buildOds = (spec: OdsPackageSpec): Uint8Array => writeZip(odsEntries(spec));
