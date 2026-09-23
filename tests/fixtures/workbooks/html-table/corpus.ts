/**
 * The legacy HTML-table fidelity corpus, by path under
 * `tests/fixtures/workbooks/` (M58; CAP-27).
 *
 * The committed bytes are the test subject; this map is the evidence of how
 * each was made. `tests/unit/import/html-table/corpus.test.ts` asserts every
 * generator reproduces its committed file exactly, and rewrites them when run
 * with `SHEAF_WRITE_FIXTURES=1`.
 */

import { DEMO_PAIR, isoDateOf, type DemoRowCellV1 } from "../ods/demo-pair.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The Windows-1252 bytes the C1 range holds, by character. */
const WINDOWS_1252_C1: ReadonlyMap<string, number> = new Map([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85], ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88],
  ["‰", 0x89], ["Š", 0x8a], ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e], ["‘", 0x91], ["’", 0x92], ["“", 0x93],
  ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97], ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b],
  ["œ", 0x9c], ["ž", 0x9e], ["Ÿ", 0x9f],
]);

/** Encodes text as Windows-1252; every character used must exist there. */
export const windows1252 = (text: string): Uint8Array =>
  Uint8Array.from([...text], (character) => {
    const code = character.codePointAt(0) as number;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
    const byte = WINDOWS_1252_C1.get(character);
    if (byte === undefined) throw new RangeError(`not in Windows-1252: U+${code.toString(16)}`);
    return byte;
  });

/** Two captioned tables, merged headers, entities, and HTML as people type it. */
const mergedHeaders = (): Uint8Array =>
  utf8(`<!DOCTYPE html>
<HTML>
<HEAD><META charset=utf-8><TITLE>Crew &amp; sites</TITLE></HEAD>
<BODY>
<TABLE border=1>
<CAPTION>Crew roster</CAPTION>
<TR><TH rowspan=2>Name<TH colspan=2>Contact
<TR><TH>Phone<TH>Email
<TR><TD>Ada Lovelace<TD>555-0110<TD>ada@example.test
<TR><TD>Grace&nbsp;Hopper<TD>555-0111<TD>grace&#64;example.test</TD></TR>
<TR><TD>Jos&eacute; &amp; Ren&#xE9;e<TD colspan=2>Line one<br>Line   two
<TR><TD>Unknown &bogus; ref<TD>&#150; dash<TD>&nbsp;
</TABLE>
<table>
<caption>Sites</caption>
<tr><td>Ridgeway</td><td>North</td></tr>
<tr><td>Harbor View</td><td>South</td></tr>
</table>
</BODY>
</HTML>
`);

/** Every kind of active content, plus malformed nesting; none of it may run or leak. */
const activeContent = (): Uint8Array =>
  utf8(`<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.example.test/site.css">
<script src="https://cdn.example.test/tracker.js"></script>
<script>document.write("<table><tr><td>INJECTED</td></tr></table>"); if (a < b && c > d) {}</script>
<style>td { color: red } .note::after { content: "<b>STYLED</b>" }</style>
</head>
<body onload="steal()">
<table>
<tr><td onclick="alert(1)">Clickable</td><td><img src="https://tracker.example.test/pixel.gif" alt="pixel">Pictured</td></tr>
<tr><td><a href="javascript:alert(2)">Run me</a></td><td><a href="https://example.test/report">Report</a></td></tr>
<tr><td><a href="#top">Top</a></td><td><input type="text" value="typed"><script>alert(3)</script>After script</td></tr>
<td>No row tag</td></td><td>stray close above
<tr><td>Outer<table><tr><td>inner a</td><td>inner b</td></tr><tr><td>inner c</td></tr></table>tail</td><td><object data="movie.swf"></object>Object</td></tr>
<tr><td><![CDATA[<b>not markup</b>]]>Cdata<!-- a comment <td>hidden</td> --></td></tr>
</table>
<iframe src="https://example.test/frame"></iframe>
</body>
</html>
`);

/** A Windows-1252 export with no charset declaration: the default rule applies. */
const windows1252Export = (): Uint8Array =>
  windows1252(`<html><body><table>
<tr><td>Supplier</td><td>Note</td></tr>
<tr><td>Café Noir</td><td>€ 12 – “net”</td></tr>
<tr><td>Façade Ltd</td><td>Straße ½</td></tr>
</table></body></html>
`);

/** Excel's "Save as Web Page", saved with an `.xls` name: the MOD-004 case. */
const excelExport = (): Uint8Array =>
  windows1252(`<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=windows-1252">
<meta name=ProgId content=Excel.Sheet>
<meta name=Generator content="Microsoft Excel 15">
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";}
.xl65
	{mso-style-parent:style0;
	mso-number-format:"\\0022$\\0022\\#\\,\\#\\#0\\.00";}
.xl66
	{mso-style-parent:style0;
	mso-number-format:"Short Date";}
.xl67
	{mso-style-parent:style0;
	mso-number-format:Percent;}
-->
</style>
<!--[if gte mso 9]><xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>Q3 Invoices</x:Name>
    <x:WorksheetOptions><x:Selected/></x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml><![endif]-->
</head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=320 style='border-collapse:collapse;width:240pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 width=80 style='height:15.0pt;width:60pt'>Invoice<o:p></o:p></td>
  <td width=80 style='width:60pt'>Amount</td>
  <td width=80 style='width:60pt'>Due</td>
  <td width=80 style='width:60pt'>Paid</td>
  <td width=80 style='width:60pt'>Share</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>INV-001</td>
  <td class=xl65 align=right x:num="1234.5">$1,234.50</td>
  <td class=xl66 align=right x:num="45366">3/15/2024</td>
  <td align=center x:bool="TRUE">TRUE</td>
  <td class=xl67 align=right x:num="0.25" x:fmla="=B2/SUM(B2:B3)">25.00%</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>INV-002 – Café</td>
  <td class=xl65 align=right x:num>3703.5</td>
  <td class=xl66 align=right x:num="45380">3/29/2024</td>
  <td align=center x:bool="FALSE">FALSE</td>
  <td class=xl67 align=right x:err="#DIV/0!">#DIV/0!</td>
 </tr>
 <![if supportMisalignedColumns]>
 <tr height=0 style='display:none'><td width=80 style='width:60pt'></td></tr>
 <![endif]>
</table>
</body>
</html>
`);

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const demoCell = ({ cell, formula, isCurrency }: DemoRowCellV1): string => {
  const fmla = formula === "lookup" ? ' x:fmla="=VLOOKUP(B2,Customers!A:B,2,FALSE)"' : formula === "balance" ? ' x:fmla="=E2-F2"' : "";
  switch (cell.kind) {
    case "text":
      return `<td${fmla}>${escapeHtml(cell.text)}</td>`;
    case "boolean":
      return `<td align=center x:bool="${cell.value ? "TRUE" : "FALSE"}"${fmla}>${cell.value ? "TRUE" : "FALSE"}</td>`;
    case "error":
      return `<td${isCurrency ? " class=xl65" : ""} x:err="${cell.text}"${fmla}>${cell.text}</td>`;
    case "number":
      if (cell.format === "currency") return `<td class=xl65 align=right x:num="${cell.value}"${fmla}>$${cell.value.toFixed(2)}</td>`;
      if (cell.format === "date") return `<td class=xl66 align=right x:num="${cell.value}"${fmla}>${isoDateOf(cell.value)}</td>`;
      return `<td align=right x:num${fmla}>${cell.value}</td>`;
  }
};

/**
 * The demo pair as a value-only HTML export: Jobs and Customers, typed by
 * Excel's `x:` attributes, formulas present only as `x:fmla` (never read) — so
 * key matching is the only relationship signal this format can offer.
 */
const demoPair = (): Uint8Array =>
  utf8(
    `<html xmlns:x="urn:schemas-microsoft-com:office:excel">\n<head><meta charset="utf-8">\n<style>\n.xl65 {mso-number-format:"\\0022$\\0022\\#\\,\\#\\#0\\.00";}\n.xl66 {mso-number-format:"yyyy\\-mm\\-dd";}\n</style></head>\n<body>\n` +
      DEMO_PAIR.map(
        (sheet) =>
          `<table>\n<caption>${sheet.name}</caption>\n` +
          sheet.rows.map((cells) => `<tr>${cells.map(demoCell).join("")}</tr>`).join("\n") +
          "\n</table>\n",
      ).join("") +
      "</body>\n</html>\n",
  );

export const HTML_TABLE_CORPUS: ReadonlyMap<string, () => Uint8Array> = new Map([
  ["html-table/merged-headers.html", mergedHeaders],
  ["html-table/active-content.html", activeContent],
  ["html-table/windows-1252.html", windows1252Export],
  ["html-table/excel-export.xls", excelExport],
  ["html-table/fieldwork-jobs-customers.html", demoPair],
]);
