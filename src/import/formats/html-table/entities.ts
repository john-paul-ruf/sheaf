/**
 * The character references a legacy HTML table export may carry (M20).
 *
 * A fixed table, not the HTML living standard's 2,231 names: it is the set
 * HTML 4.01 defines (W3C REC-html401-19991224, §24.2 "Character entity
 * references for ISO 8859-1 characters", §24.4 "…markup-significant and
 * internationalization characters", and the §24.3 symbols Excel's "Save as
 * Web Page" writes), plus XHTML's `&apos;`. That is every name Excel's export
 * uses. A name outside the table is kept literally — `&foo;` stays `&foo;` —
 * because an unknown reference is text the author wrote, not a character to
 * guess at.
 *
 * Numeric references follow the HTML parsing rules: 0, surrogates and values
 * past U+10FFFF become U+FFFD, and 0x80–0x9F are read as the Windows-1252
 * characters they meant (`&#150;` is an en dash).
 */

/** §24.2: ISO 8859-1, U+00A0 … U+00FF, in code point order. */
const LATIN_1 = (
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
  "deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml " +
  "ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml " +
  "eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
).split(" ");

/** §24.4 (with XHTML `apos`) and the §24.3 symbols Excel writes. */
const NAMED_CODE_POINTS: readonly (readonly [string, number])[] = [
  ["quot", 34],
  ["amp", 38],
  ["apos", 39],
  ["lt", 60],
  ["gt", 62],
  ["OElig", 338],
  ["oelig", 339],
  ["Scaron", 352],
  ["scaron", 353],
  ["Yuml", 376],
  ["fnof", 402],
  ["circ", 710],
  ["tilde", 732],
  ["ensp", 8194],
  ["emsp", 8195],
  ["thinsp", 8201],
  ["zwnj", 8204],
  ["zwj", 8205],
  ["lrm", 8206],
  ["rlm", 8207],
  ["ndash", 8211],
  ["mdash", 8212],
  ["lsquo", 8216],
  ["rsquo", 8217],
  ["sbquo", 8218],
  ["ldquo", 8220],
  ["rdquo", 8221],
  ["bdquo", 8222],
  ["dagger", 8224],
  ["Dagger", 8225],
  ["bull", 8226],
  ["hellip", 8230],
  ["permil", 8240],
  ["prime", 8242],
  ["Prime", 8243],
  ["lsaquo", 8249],
  ["rsaquo", 8250],
  ["oline", 8254],
  ["frasl", 8260],
  ["euro", 8364],
  ["trade", 8482],
  ["larr", 8592],
  ["uarr", 8593],
  ["rarr", 8594],
  ["darr", 8595],
  ["harr", 8596],
  ["minus", 8722],
  ["radic", 8730],
  ["infin", 8734],
  ["ne", 8800],
  ["equiv", 8801],
  ["le", 8804],
  ["ge", 8805],
];

export const NAMED_CHARACTER_REFERENCES: ReadonlyMap<string, string> = new Map([
  ...LATIN_1.map((name, offset): [string, string] => [name, String.fromCodePoint(0xa0 + offset)]),
  ...NAMED_CODE_POINTS.map(([name, codePoint]): [string, string] => [name, String.fromCodePoint(codePoint)]),
]);

/** HTML's numeric-reference override table for 0x80–0x9F (Windows-1252). */
const C1_OVERRIDES: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020],
  [0x87, 0x2021], [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022],
  [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);

const REPLACEMENT = "�";

const numericCharacter = (codePoint: number): string => {
  if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return REPLACEMENT;
  return String.fromCodePoint(C1_OVERRIDES.get(codePoint) ?? codePoint);
};

const REFERENCE = /&(?:#[xX]([0-9A-Fa-f]{1,8});|#([0-9]{1,10});|([A-Za-z][A-Za-z0-9]{1,31});)/g;

/** Decodes the references in `text`; unknown names stay as written. */
export const decodeCharacterReferences = (text: string): string =>
  text.includes("&")
    ? text.replace(REFERENCE, (reference, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
        if (hex !== undefined) return numericCharacter(parseInt(hex, 16));
        if (decimal !== undefined) return numericCharacter(Number(decimal));
        return NAMED_CHARACTER_REFERENCES.get(name as string) ?? reference;
      })
    : text;
