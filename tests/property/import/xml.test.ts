import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BoundExceededError } from "../../../src/import/source/bounds.js";
import { tokenizeXml, type XmlEventV1 } from "../../../src/import/source/xml.js";

type Outcome = { readonly events: readonly XmlEventV1[] } | { readonly detail: string };

const tokenize = async (chunks: readonly Uint8Array[]): Promise<Outcome> => {
  const events: XmlEventV1[] = [];
  try {
    for await (const event of tokenizeXml(chunks)) {
      events.push(event);
    }
    return { events };
  } catch (cause) {
    if (cause instanceof BoundExceededError) {
      return { detail: cause.detail };
    }
    throw cause;
  }
};

/** Splits `bytes` at the given (sorted, deduplicated) cut points. */
const chunked = (bytes: Uint8Array, cuts: readonly number[]): Uint8Array[] => {
  const points = [...new Set(cuts.map((cut) => cut % (bytes.length + 1)))].sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const point of points) {
    chunks.push(bytes.subarray(start, point));
    start = point;
  }
  chunks.push(bytes.subarray(start));
  return chunks;
};

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const xmlText = fc
  .string({ unit: "grapheme", maxLength: 12 })
  .map((text) => [...text].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x9 || code === 0xa || code >= 0x20;
  }).join(""));

const name = fc.constantFrom("row", "c", "v", "x:sheet", "t", "is");

const { element } = fc.letrec<{ element: string }>((tie) => ({
  element: fc
    .tuple(
      name,
      fc.array(fc.tuple(fc.constantFrom("r", "s", "t", "x:id"), xmlText), { maxLength: 3 }),
      fc.array(fc.oneof(xmlText.map(escape), tie("element")), { maxLength: 4 }),
    )
    .map(([tag, attributes, children]) => {
      const unique = new Map(attributes);
      const attributeText = [...unique].map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
      return children.length === 0
        ? `<${tag}${attributeText}/>`
        : `<${tag}${attributeText}>${children.join("")}</${tag}>`;
    }),
}));

const document = element.map(
  (body) => `<?xml version="1.0"?><root xmlns:x="urn:x">${body}<!-- tail --></root>`,
);

const xmlish = fc
  .array(
    fc.oneof(
      fc.constantFrom("<", ">", "/", "<a>", "</a>", "<b/>", "&amp;", "&#65;", "&x;", "<!--", "-->", "<![CDATA[", "]]>", "<?", "?>", "<!DOCTYPE", '"', "=", " "),
      fc.string({ maxLength: 4 }),
    ),
    { maxLength: 30 },
  )
  .map((parts) => new TextEncoder().encode(parts.join("")));

describe("xml tokenizer on hostile input", () => {
  it("throws nothing but BoundExceededError on arbitrary bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.uint8Array({ maxLength: 512 }), xmlish), async (bytes) => {
        await tokenize([bytes]);
      }),
      { numRuns: 1000 },
    );
  });

  it("yields the same events however a document is chunked", async () => {
    await fc.assert(
      fc.asyncProperty(document, fc.array(fc.nat(), { maxLength: 12 }), async (text, cuts) => {
        const bytes = new TextEncoder().encode(text);
        const whole = await tokenize([bytes]);
        expect(whole).toHaveProperty("events");
        expect(await tokenize(chunked(bytes, cuts))).toEqual(whole);
      }),
      { numRuns: 400 },
    );
  });

  it("reaches the same verdict however hostile input is chunked", async () => {
    await fc.assert(
      fc.asyncProperty(xmlish, fc.array(fc.nat(), { maxLength: 8 }), async (bytes, cuts) => {
        const whole = await tokenize([bytes]);
        const split = await tokenize(chunked(bytes, cuts));
        expect("detail" in split ? split.detail : "ok").toBe("detail" in whole ? whole.detail : "ok");
      }),
      { numRuns: 600 },
    );
  });
});
