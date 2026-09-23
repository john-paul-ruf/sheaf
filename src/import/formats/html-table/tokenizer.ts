/**
 * Sheaf's own non-executing tokenizer for legacy HTML table exports (M20;
 * invariant 8). Not M13's XML tokenizer: an Excel "Save as Web Page" file is
 * HTML, not well-formed XML — unclosed `td`/`tr`, uppercase tags, unquoted
 * attributes, `<br>` without a slash.
 *
 * It does strictly less than a browser:
 *
 * - **nothing runs, loads or renders.** `<script>` content is skipped as raw
 *   text up to its end tag and never delivered — not even as text; `<style>`
 *   content is delivered only as a `raw` token (its `mso-number-format` rules
 *   are data); comments, `<!…>`/`<?…>` declarations and CDATA sections are
 *   skipped, except that a conditional comment's body (`<!--[if gte mso 9]>`)
 *   is delivered as a `conditional` token so Excel's `x:Name` sheet names can
 *   be read as text;
 * - **nothing is built.** Tokens are start tags (lowercased name, prefix kept:
 *   `o:p`), end tags, and decoded text. Structure — which tags imply which
 *   closes — is the adapter's, and only for tables;
 * - **everything is bounded** by {@link CONTAINER_BOUNDS_V1}: a tag name by
 *   `maxXmlNameBytes`, one markup construct (a tag, a comment, a style block)
 *   and the unconsumed buffer by `maxXmlAttributeValueBytes`. A long text run
 *   is delivered in pieces rather than refused.
 *
 * Unterminated constructs at the end of input are dropped, never guessed at.
 * The only error this generator throws is a {@link BoundExceededError}.
 */

import { BoundExceededError, CONTAINER_BOUNDS_V1, type ContainerBoundsV1 } from "../../source/bounds.js";
import { decodeCharacterReferences } from "./entities.js";

export interface HtmlAttributeV1 {
  /** Lowercased, prefix kept: `x:num`, `onclick`. */
  readonly name: string;
  /** Character references decoded. */
  readonly value: string;
}

export type HtmlTokenV1 =
  | { readonly kind: "start"; readonly name: string; readonly attributes: readonly HtmlAttributeV1[] }
  | { readonly kind: "end"; readonly name: string }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "raw"; readonly name: "style"; readonly value: string }
  | { readonly kind: "conditional"; readonly value: string };

export type HtmlStartTokenV1 = Extract<HtmlTokenV1, { kind: "start" }>;

/** The attribute's value, or `null` when the tag does not carry it. */
export const htmlAttribute = (token: HtmlStartTokenV1, name: string): string | null =>
  token.attributes.find((attribute) => attribute.name === name)?.value ?? null;

/** A trailing `&…` this long may still be an unfinished reference. */
const MAX_REFERENCE_LENGTH = 34;

const WHITESPACE = /[\t\n\f\r ]/;

const fail = (): never => {
  throw new BoundExceededError("malformed-structure");
};

/** Where a start tag's `>` is, honoring quotes that open an attribute value. */
const tagEnd = (buffer: string, from: number): number => {
  let quote: string | null = null;
  let isAfterEquals = false;
  for (let at = from; at < buffer.length; at += 1) {
    const character = buffer[at] as string;
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === ">") {
      return at;
    } else if (character === "=") {
      isAfterEquals = true;
    } else if (isAfterEquals && (character === '"' || character === "'")) {
      quote = character;
      isAfterEquals = false;
    } else if (!WHITESPACE.test(character)) {
      isAfterEquals = false;
    }
  }
  return -1;
};

const parseAttributes = (body: string, bounds: ContainerBoundsV1): HtmlAttributeV1[] => {
  const attributes: HtmlAttributeV1[] = [];
  const seen = new Set<string>();
  let at = 0;
  while (at < body.length) {
    while (at < body.length && (WHITESPACE.test(body[at] as string) || body[at] === "/")) at += 1;
    if (at >= body.length) break;
    let end = at;
    while (end < body.length && !/[\t\n\f\r />=]/.test(body[end] as string)) end += 1;
    if (end === at) end += 1;
    const name = body.slice(at, end).toLowerCase();
    if (name.length > bounds.maxXmlNameBytes) fail();
    at = end;
    while (at < body.length && WHITESPACE.test(body[at] as string)) at += 1;
    let value = "";
    if (body[at] === "=") {
      at += 1;
      while (at < body.length && WHITESPACE.test(body[at] as string)) at += 1;
      const quote = body[at];
      if (quote === '"' || quote === "'") {
        const close = body.indexOf(quote, at + 1);
        value = body.slice(at + 1, close === -1 ? body.length : close);
        at = close === -1 ? body.length : close + 1;
      } else {
        let valueEnd = at;
        while (valueEnd < body.length && !WHITESPACE.test(body[valueEnd] as string)) valueEnd += 1;
        value = body.slice(at, valueEnd);
        at = valueEnd;
      }
    }
    if (!seen.has(name)) {
      seen.add(name);
      attributes.push({ name, value: decodeCharacterReferences(value) });
    }
  }
  return attributes;
};

/**
 * Tokenizes HTML arriving as decoded text chunks. Pull-driven: a consumer
 * that stops early stops the source beneath.
 */
export async function* tokenizeHtml(
  chunks: AsyncIterable<string> | Iterable<string>,
  bounds: ContainerBoundsV1 = CONTAINER_BOUNDS_V1,
): AsyncGenerator<HtmlTokenV1, void, undefined> {
  const limit = bounds.maxXmlAttributeValueBytes;
  let buffer = "";
  /** Inside `<script>` or `<style>`: the element whose end tag ends raw text. */
  let raw: "script" | "style" | null = null;
  let rawText = "";

  const text = (value: string): HtmlTokenV1 => ({ kind: "text", value: decodeCharacterReferences(value) });

  /** Consumes what the buffer holds; returns tokens, leaving an incomplete tail. */
  const drain = (isFinal: boolean): HtmlTokenV1[] => {
    const tokens: HtmlTokenV1[] = [];
    let at = 0;
    for (;;) {
      if (raw !== null) {
        const close = buffer.slice(at).search(new RegExp(`</${raw}[\\t\\n\\f\\r />]`, "i"));
        if (close === -1) {
          // Keep only a tail that could be the start of the end tag.
          const keepFrom = Math.max(at, buffer.length - (raw.length + 3));
          if (raw === "style") {
            rawText += buffer.slice(at, keepFrom);
            if (rawText.length > limit) fail();
          }
          at = isFinal ? buffer.length : keepFrom;
          break;
        }
        const closeAt = at + close;
        const end = buffer.indexOf(">", closeAt);
        if (end === -1 && !isFinal) {
          if (raw === "style") rawText += buffer.slice(at, closeAt);
          at = closeAt;
          break;
        }
        if (raw === "style") {
          rawText += buffer.slice(at, closeAt);
          if (rawText.length > limit) fail();
          tokens.push({ kind: "raw", name: "style", value: rawText });
        }
        tokens.push({ kind: "end", name: raw });
        raw = null;
        rawText = "";
        at = end === -1 ? buffer.length : end + 1;
        continue;
      }

      const lt = buffer.indexOf("<", at);
      if (lt === -1) {
        let end = buffer.length;
        if (!isFinal) {
          const ampersand = buffer.lastIndexOf("&");
          if (ampersand >= at && buffer.length - ampersand < MAX_REFERENCE_LENGTH && !buffer.includes(";", ampersand)) {
            end = ampersand;
          }
        }
        if (end > at) tokens.push(text(buffer.slice(at, end)));
        at = end;
        break;
      }
      if (lt > at) {
        tokens.push(text(buffer.slice(at, lt)));
        at = lt;
      }
      const next = buffer[at + 1];
      if (next === undefined) {
        if (isFinal) {
          tokens.push(text("<"));
          at += 1;
        }
        break;
      }
      const until = (terminator: string, from: number): number => {
        const found = buffer.indexOf(terminator, from);
        return found === -1 ? -1 : found + terminator.length;
      };
      let end: number;
      if (buffer.startsWith("<!--", at)) {
        end = until("-->", at + 4);
        if (end !== -1) {
          const body = buffer.slice(at + 4, end - 3);
          if (body.startsWith("[if")) tokens.push({ kind: "conditional", value: body });
        }
      } else if (buffer.startsWith("<![CDATA[", at)) {
        end = until("]]>", at + 9);
      } else if (next === "!" || next === "?") {
        end = until(">", at + 2);
      } else if (next === "/") {
        end = until(">", at + 2);
        if (end !== -1) {
          const name = /^[A-Za-z][^\t\n\f\r />]*/.exec(buffer.slice(at + 2, end - 1))?.[0];
          if (name !== undefined) {
            if (name.length > bounds.maxXmlNameBytes) fail();
            tokens.push({ kind: "end", name: name.toLowerCase() });
          }
        }
      } else if (/[A-Za-z]/.test(next)) {
        const close = tagEnd(buffer, at + 1);
        end = close === -1 ? -1 : close + 1;
        if (close !== -1) {
          const content = buffer.slice(at + 1, close);
          const nameLength = /^[^\t\n\f\r />]*/.exec(content)?.[0].length ?? 0;
          const name = content.slice(0, nameLength).toLowerCase();
          if (name.length > bounds.maxXmlNameBytes) fail();
          tokens.push({ kind: "start", name, attributes: parseAttributes(content.slice(nameLength), bounds) });
          if ((name === "script" || name === "style") && !content.trimEnd().endsWith("/")) raw = name;
        }
      } else {
        tokens.push(text("<"));
        at += 1;
        continue;
      }
      if (end === -1) {
        if (isFinal) at = buffer.length;
        break;
      }
      at = end;
    }
    buffer = buffer.slice(at);
    if (buffer.length > limit) fail();
    return tokens;
  };

  for await (const chunk of chunks) {
    buffer += chunk;
    for (const token of drain(false)) yield token;
  }
  for (const token of drain(true)) yield token;
}

/** Excel's default code page for this export when nothing else is declared. */
export const DEFAULT_HTML_ENCODING = "windows-1252";

const CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i;

/**
 * The encoding rule, in order: a byte-order mark; then a `<meta charset=…>` or
 * `<meta http-equiv="Content-Type" content="…; charset=…">` within `prefix`
 * (a label the platform does not know, or a UTF-16 label without a BOM, is
 * ignored as the HTML standard ignores it); else Windows-1252, the code page
 * Excel's "Save as Web Page" writes by default.
 */
export function detectHtmlEncoding(prefix: Uint8Array): { readonly encoding: string; readonly bomByteLength: number } {
  if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) return { encoding: "utf-8", bomByteLength: 3 };
  if (prefix[0] === 0xff && prefix[1] === 0xfe) return { encoding: "utf-16le", bomByteLength: 2 };
  if (prefix[0] === 0xfe && prefix[1] === 0xff) return { encoding: "utf-16be", bomByteLength: 2 };
  const label = CHARSET.exec(new TextDecoder("windows-1252").decode(prefix))?.[1];
  if (label !== undefined) {
    try {
      const encoding = new TextDecoder(label).encoding;
      return { encoding: encoding.startsWith("utf-16") ? "utf-8" : encoding, bomByteLength: 0 };
    } catch {
      // An unknown label is ignored, as the HTML standard ignores it.
    }
  }
  return { encoding: DEFAULT_HTML_ENCODING, bomByteLength: 0 };
}
