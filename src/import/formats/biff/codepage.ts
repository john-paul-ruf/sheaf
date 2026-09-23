/**
 * BIFF5 byte strings through the workbook's code page (M17).
 *
 * BIFF8 stores text as UTF-16 (or its compressed Latin-1 form), but BIFF5
 * stores every string as bytes in the code page its `CODEPAGE` record names.
 * The map below is bounded to the code pages the platform's `TextDecoder`
 * can read (WHATWG Encoding labels). Any other code page decodes ASCII as
 * itself and every other byte as U+FFFD, and says so: the caller raises the
 * `replacement-character` diagnostic rather than guessing a character set.
 */

/** Windows code page → WHATWG encoding label. */
export const CODE_PAGE_LABELS: ReadonlyMap<number, string> = new Map([
  [367, "windows-1252"],
  [866, "ibm866"],
  [874, "windows-874"],
  [932, "shift_jis"],
  [936, "gbk"],
  [949, "euc-kr"],
  [950, "big5"],
  [1200, "utf-16le"],
  [1250, "windows-1250"],
  [1251, "windows-1251"],
  [1252, "windows-1252"],
  [1253, "windows-1253"],
  [1254, "windows-1254"],
  [1255, "windows-1255"],
  [1256, "windows-1256"],
  [1257, "windows-1257"],
  [1258, "windows-1258"],
  [10000, "macintosh"],
  [10007, "x-mac-cyrillic"],
  [20866, "koi8-r"],
  [21866, "koi8-u"],
  [28592, "iso-8859-2"],
  [28595, "iso-8859-5"],
  [28597, "iso-8859-7"],
  [32768, "macintosh"],
  [32769, "windows-1252"],
  [54936, "gb18030"],
  [65001, "utf-8"],
]);

/** A BIFF5 workbook with no `CODEPAGE` record is Windows-1252. */
export const DEFAULT_CODE_PAGE = 1252;

export interface DecodedTextV1 {
  readonly text: string;
  /** True when a byte could not be read and U+FFFD stands in for it. */
  readonly isLossy: boolean;
}

export interface CodePageDecoderV1 {
  readonly isKnown: boolean;
  decode(bytes: Uint8Array): DecodedTextV1;
}

export function codePageDecoder(codePage: number | null): CodePageDecoderV1 {
  const label = CODE_PAGE_LABELS.get(codePage ?? DEFAULT_CODE_PAGE);
  if (label === undefined) {
    return {
      isKnown: false,
      decode(bytes) {
        let isLossy = false;
        const text = Array.from(bytes, (byte) => {
          if (byte < 0x80) return String.fromCharCode(byte);
          isLossy = true;
          return "�";
        }).join("");
        return { text, isLossy };
      },
    };
  }
  const strict = new TextDecoder(label, { fatal: true });
  const lenient = new TextDecoder(label);
  return {
    isKnown: true,
    decode(bytes) {
      try {
        return { text: strict.decode(bytes), isLossy: false };
      } catch {
        return { text: lenient.decode(bytes), isLossy: true };
      }
    },
  };
}
