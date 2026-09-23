/**
 * Sheaf's own bounded, non-executing streaming XML tokenizer (M13;
 * invariant 8).
 *
 * Workbook XML is hostile input, so this reader does strictly less than XML
 * permits and says so:
 *
 * - **No DTD, no entities.** `<!DOCTYPE` or `<!ENTITY` anywhere ends the read
 *   as `entity-declaration`. Only the five predefined references and numeric
 *   character references decode; any other `&name;` is `malformed-structure`.
 *   Nothing is ever fetched or expanded.
 * - **Everything is bounded** by {@link CONTAINER_BOUNDS_V1}: element depth,
 *   name length, attribute-value length, and — with the same byte bound — one
 *   text run and one markup construct, so a tag that never closes cannot grow
 *   the buffer without limit.
 * - **Pull-driven.** Events are produced as the consumer asks for them; a
 *   consumer that stops (a bounded prefix read) stops the byte stream beneath.
 *
 * Namespaces are resolved to URIs, which is what lets one adapter read both
 * OOXML *Strict* and *Transitional* parts. Comments and processing
 * instructions are skipped. A self-closing element yields a `start` then an
 * `end`. Text is delivered whole between two pieces of markup, so the event
 * sequence is independent of how the bytes were chunked.
 */

import {
  BoundExceededError,
  CONTAINER_BOUNDS_V1,
  isBoundExceeded,
  type ContainerBoundsV1,
} from "./bounds.js";

export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

export interface XmlAttributeV1 {
  /** `""` for an unprefixed attribute (attributes take no default namespace). */
  readonly uri: string;
  readonly local: string;
  readonly value: string;
}

export type XmlEventV1 =
  | {
      readonly kind: "start";
      readonly uri: string;
      readonly local: string;
      readonly attributes: readonly XmlAttributeV1[];
    }
  | { readonly kind: "end"; readonly uri: string; readonly local: string }
  | { readonly kind: "text"; readonly value: string };

export type XmlStartEventV1 = Extract<XmlEventV1, { kind: "start" }>;

/** The value of an attribute, or `null` when the element does not carry it. */
export const attributeOf = (
  event: XmlStartEventV1,
  local: string,
  uri = "",
): string | null =>
  event.attributes.find(
    (attribute) => attribute.local === local && attribute.uri === uri,
  )?.value ?? null;

function fail(detail: BoundExceededError["detail"]): never {
  throw new BoundExceededError(detail);
}

const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code < 0xdc00 ? 2 : 3;
  }
  return bytes;
};

const isXmlCharacter = (code: number): boolean =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

const PREDEFINED = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

const decodeReferences = (raw: string): string => {
  let at = raw.indexOf("&");
  if (at === -1) {
    return raw;
  }
  let decoded = raw.slice(0, at);
  while (at !== -1) {
    const semicolon = raw.indexOf(";", at + 1);
    if (semicolon === -1 || semicolon - at > 12) {
      fail("malformed-structure");
    }
    const name = raw.slice(at + 1, semicolon);
    const predefined = PREDEFINED.get(name);
    if (predefined !== undefined) {
      decoded += predefined;
    } else {
      const match = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(name);
      if (match === null) {
        fail("malformed-structure");
      }
      const [, hex, decimal] = match;
      const code = hex === undefined ? Number(decimal) : parseInt(hex, 16);
      if (!isXmlCharacter(code)) {
        fail("malformed-structure");
      }
      decoded += String.fromCodePoint(code);
    }
    const next = raw.indexOf("&", semicolon + 1);
    decoded += raw.slice(semicolon + 1, next === -1 ? raw.length : next);
    at = next;
  }
  return decoded;
};

const WHITESPACE = /\s/;
const NAME_END = /[\s/>=<"']/;

interface Scope {
  readonly qualifiedName: string;
  readonly namespaces: ReadonlyMap<string, string>;
}

interface RawAttribute {
  readonly qualifiedName: string;
  readonly value: string;
}

/**
 * Tokenizes XML arriving as byte chunks. UTF-8 unless a UTF-16 byte-order mark
 * says otherwise; undecodable bytes are `malformed-structure`. The only error
 * this generator throws is a {@link BoundExceededError}.
 */
export async function* tokenizeXml(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  bounds: ContainerBoundsV1 = CONTAINER_BOUNDS_V1,
): AsyncGenerator<XmlEventV1, void, undefined> {
  const markupLimit = bounds.maxXmlAttributeValueBytes;
  const stack: Scope[] = [];
  let namespaces: ReadonlyMap<string, string> = new Map([["xml", XML_NAMESPACE]]);
  let buffer = "";
  let pendingText = "";
  let rootClosed = false;
  let decoder: TextDecoder | null = null;
  let head: Uint8Array = new Uint8Array(0);

  const checkName = (name: string): string => {
    if (name === "" || utf8Length(name) > bounds.maxXmlNameBytes) {
      fail("malformed-structure");
    }
    return name;
  };

  const resolve = (qualifiedName: string, isAttribute: boolean) => {
    const colon = qualifiedName.indexOf(":");
    if (colon === -1) {
      return {
        uri: isAttribute ? "" : (namespaces.get("") ?? ""),
        local: qualifiedName,
      };
    }
    const uri = namespaces.get(qualifiedName.slice(0, colon));
    const local = qualifiedName.slice(colon + 1);
    if (uri === undefined || uri === "" || local === "" || local.includes(":")) {
      fail("malformed-structure");
    }
    return { uri, local };
  };

  const appendText = (text: string): void => {
    pendingText += text;
    if (pendingText.length > markupLimit) {
      fail("malformed-structure");
    }
  };

  const flushText = (events: XmlEventV1[]): void => {
    if (pendingText === "") {
      return;
    }
    if (stack.length === 0) {
      if (!/^\s*$/.test(pendingText)) {
        fail("malformed-structure");
      }
    } else {
      events.push({ kind: "text", value: pendingText });
    }
    pendingText = "";
  };

  const parseAttributes = (body: string): RawAttribute[] => {
    const attributes: RawAttribute[] = [];
    let at = 0;
    for (;;) {
      while (at < body.length && WHITESPACE.test(body[at] as string)) at += 1;
      if (at >= body.length) {
        return attributes;
      }
      let nameEnd = at;
      while (nameEnd < body.length && !NAME_END.test(body[nameEnd] as string)) nameEnd += 1;
      const qualifiedName = checkName(body.slice(at, nameEnd));
      at = nameEnd;
      while (at < body.length && WHITESPACE.test(body[at] as string)) at += 1;
      if (body[at] !== "=") {
        fail("malformed-structure");
      }
      at += 1;
      while (at < body.length && WHITESPACE.test(body[at] as string)) at += 1;
      const quote = body[at];
      if (quote !== '"' && quote !== "'") {
        fail("malformed-structure");
      }
      const close = body.indexOf(quote, at + 1);
      if (close === -1) {
        fail("malformed-structure");
      }
      const raw = body.slice(at + 1, close);
      if (raw.includes("<") || utf8Length(raw) > bounds.maxXmlAttributeValueBytes) {
        fail("malformed-structure");
      }
      attributes.push({
        qualifiedName,
        value: decodeReferences(raw.replace(/[\t\n\r]/g, " ")),
      });
      at = close + 1;
      if (at < body.length && !WHITESPACE.test(body[at] as string)) {
        fail("malformed-structure");
      }
    }
  };

  const startTag = (content: string, events: XmlEventV1[]): void => {
    const selfClosing = content.endsWith("/");
    const body = selfClosing ? content.slice(0, -1) : content;
    let nameEnd = 0;
    while (nameEnd < body.length && !NAME_END.test(body[nameEnd] as string)) nameEnd += 1;
    const qualifiedName = checkName(body.slice(0, nameEnd));
    const raw = parseAttributes(body.slice(nameEnd));
    if (stack.length === 0 && rootClosed) {
      fail("malformed-structure");
    }
    if (stack.length + 1 > bounds.maxXmlDepth) {
      fail("malformed-structure");
    }

    const scope = new Map(namespaces);
    for (const { qualifiedName: name, value } of raw) {
      if (name === "xmlns") {
        scope.set("", value);
      } else if (name.startsWith("xmlns:")) {
        const prefix = name.slice(6);
        if (prefix === "" || prefix === "xml" || prefix === "xmlns" || value === "") {
          fail("malformed-structure");
        }
        scope.set(prefix, value);
      }
    }
    flushText(events);
    stack.push({ qualifiedName, namespaces });
    namespaces = scope;

    const element = resolve(qualifiedName, false);
    const seen = new Set<string>();
    const attributes: XmlAttributeV1[] = [];
    for (const { qualifiedName: name, value } of raw) {
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        continue;
      }
      const { uri, local } = resolve(name, true);
      const key = `${uri}\u0000${local}`;
      if (seen.has(key)) {
        fail("malformed-structure");
      }
      seen.add(key);
      attributes.push({ uri, local, value });
    }
    events.push({ kind: "start", ...element, attributes });
    if (selfClosing) {
      endTag(qualifiedName, events);
    }
  };

  const endTag = (qualifiedName: string, events: XmlEventV1[]): void => {
    const element = resolve(qualifiedName, false);
    flushText(events);
    const open = stack.pop();
    if (open === undefined || open.qualifiedName !== qualifiedName) {
      fail("malformed-structure");
    }
    events.push({ kind: "end", ...element });
    namespaces = open.namespaces;
    if (stack.length === 0) {
      rootClosed = true;
    }
  };

  /** Index just past the `>` that closes a tag, honoring quoted values. */
  const tagEnd = (from: number): number => {
    let quote: string | null = null;
    for (let at = from; at < buffer.length; at += 1) {
      const character = buffer[at];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        return at + 1;
      }
    }
    return -1;
  };

  /** Consumes one markup construct at `at`; -1 when it is not complete yet. */
  const markup = (at: number, isFinal: boolean, events: XmlEventV1[]): number => {
    const until = (terminator: string, from: number): number => {
      const found = buffer.indexOf(terminator, from);
      return found === -1 ? -1 : found + terminator.length;
    };
    if (buffer.startsWith("<!--", at)) {
      return until("-->", at + 4);
    }
    if (buffer.startsWith("<![CDATA[", at)) {
      const end = until("]]>", at + 9);
      if (end !== -1) {
        if (stack.length === 0) {
          fail("malformed-structure");
        }
        appendText(buffer.slice(at + 9, end - 3));
      }
      return end;
    }
    if (buffer.startsWith("<?", at)) {
      return until("?>", at + 2);
    }
    if (buffer.startsWith("<!", at)) {
      if (buffer.length - at < 9 && !isFinal) {
        return -1;
      }
      const declaration = buffer.slice(at + 2, at + 9).toUpperCase();
      return declaration.startsWith("DOCTYPE") || declaration.startsWith("ENTITY")
        ? fail("entity-declaration")
        : fail("malformed-structure");
    }
    const end = tagEnd(at + 1);
    if (end === -1) {
      return -1;
    }
    if (buffer[at + 1] === "/") {
      endTag(buffer.slice(at + 2, end - 1).trimEnd(), events);
    } else {
      startTag(buffer.slice(at + 1, end - 1), events);
    }
    return end;
  };

  const drain = (isFinal: boolean): XmlEventV1[] => {
    const events: XmlEventV1[] = [];
    let at = 0;
    while (at < buffer.length) {
      const lt = buffer.indexOf("<", at);
      if (lt === -1 && !isFinal) {
        break; // a text run is decoded only once it is whole
      }
      if (lt !== at) {
        const end = lt === -1 ? buffer.length : lt;
        appendText(decodeReferences(buffer.slice(at, end)));
        at = end;
        continue;
      }
      const next = markup(at, isFinal, events);
      if (next === -1) {
        break;
      }
      at = next;
    }
    buffer = buffer.slice(at);
    if (buffer.length > markupLimit) {
      fail("malformed-structure");
    }
    if (isFinal) {
      if (buffer !== "") {
        fail("malformed-structure");
      }
      flushText(events);
      if (stack.length > 0 || !rootClosed) {
        fail("malformed-structure");
      }
    }
    return events;
  };

  const decode = (bytes: Uint8Array, isFinal: boolean): string => {
    try {
      if (decoder === null) {
        head = concat(head, bytes);
        if (head.byteLength < 3 && !isFinal) {
          return "";
        }
        const encoding =
          head[0] === 0xff && head[1] === 0xfe
            ? "utf-16le"
            : head[0] === 0xfe && head[1] === 0xff
              ? "utf-16be"
              : "utf-8";
        decoder = new TextDecoder(encoding, { fatal: true });
        bytes = head;
      }
      return decoder.decode(bytes, { stream: !isFinal });
    } catch (cause) {
      if (isBoundExceeded(cause)) throw cause;
      return fail("malformed-structure");
    }
  };

  for await (const chunk of chunks) {
    buffer += decode(chunk, false);
    for (const event of drain(false)) {
      yield event;
    }
  }
  buffer += decode(new Uint8Array(0), true);
  for (const event of drain(true)) {
    yield event;
  }
}

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
};
