import { describe, expect, it } from "vitest";
import {
  BoundExceededError,
  CONTAINER_BOUNDS_V1,
  type UnreadableDetailV1,
} from "../../../../src/import/source/bounds.js";
import { tokenizeXml, type XmlEventV1 } from "../../../../src/import/source/xml.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { fixtureSource } from "../fixtures.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const events = async (
  input: string | Uint8Array,
  bounds = CONTAINER_BOUNDS_V1,
): Promise<XmlEventV1[]> => {
  const out: XmlEventV1[] = [];
  for await (const event of tokenizeXml([typeof input === "string" ? encode(input) : input], bounds)) {
    out.push(event);
  }
  return out;
};

const detailOf = async (input: string | Uint8Array): Promise<UnreadableDetailV1 | "none"> => {
  try {
    await events(input);
    return "none";
  } catch (cause) {
    if (cause instanceof BoundExceededError) {
      return cause.detail;
    }
    throw cause;
  }
};

const workbookXml = async (path: string): Promise<Uint8Array> => {
  const zip = await openZipContainer(await fixtureSource(path));
  return zip.readEntry("xl/workbook.xml", { maxBytes: 1_048_576 });
};

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const STRICT = "http://purl.oclc.org/ooxml/spreadsheetml/main";

describe("xml tokenizer", () => {
  it("yields start, text and end events with namespaces resolved", async () => {
    expect(
      await events(
        `<?xml version="1.0"?><!-- note --><x:a xmlns:x="${MAIN}" xmlns:r="urn:r" id="1" r:id="rId2"><b>t &amp; &#x41;&#66;</b><c/></x:a>`,
      ),
    ).toEqual([
      {
        kind: "start",
        uri: MAIN,
        local: "a",
        attributes: [
          { uri: "", local: "id", value: "1" },
          { uri: "urn:r", local: "id", value: "rId2" },
        ],
      },
      { kind: "start", uri: "", local: "b", attributes: [] },
      { kind: "text", value: "t & AB" },
      { kind: "end", uri: "", local: "b" },
      { kind: "start", uri: "", local: "c", attributes: [] },
      { kind: "end", uri: "", local: "c" },
      { kind: "end", uri: MAIN, local: "a" },
    ]);
  });

  it("resolves the Strict and Transitional default namespaces alike", async () => {
    for (const uri of [MAIN, STRICT]) {
      const [first] = await events(`<workbook xmlns="${uri}"><sheets/></workbook>`);
      expect(first).toMatchObject({ kind: "start", uri, local: "workbook" });
    }
  });

  it("keeps CDATA literally and normalizes attribute whitespace", async () => {
    expect(await events('<a v="x\ty\nz"><![CDATA[<&amp;>]]></a>')).toEqual([
      { kind: "start", uri: "", local: "a", attributes: [{ uri: "", local: "v", value: "x y z" }] },
      { kind: "text", value: "<&amp;>" },
      { kind: "end", uri: "", local: "a" },
    ]);
  });

  it("honors a UTF-16 byte-order mark", async () => {
    const text = "<a>é</a>";
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let index = 0; index < text.length; index += 1) {
      utf16[2 + index * 2] = text.charCodeAt(index);
    }
    expect(await events(utf16)).toContainEqual({ kind: "text", value: "é" });
  });

  it("can stop early without reading the rest", async () => {
    let pulled = 0;
    const chunks = function* () {
      for (let index = 0; index < 1000; index += 1) {
        pulled += 1;
        yield encode(index === 0 ? "<root><head/>" : "<row/>".repeat(100));
      }
    };
    for await (const event of tokenizeXml(chunks())) {
      if (event.kind === "end" && event.local === "head") break;
    }
    expect(pulled).toBe(1);
  });

  it("refuses a DTD and any entity declaration as entity-declaration", async () => {
    expect(await detailOf(await workbookXml("unsafe/doctype.xlsx"))).toBe("entity-declaration");
    expect(await detailOf("<a><!ENTITY x 'y'></a>")).toBe("entity-declaration");
    expect(await detailOf('<!doctype a SYSTEM "http://example.test/x.dtd"><a/>')).toBe(
      "entity-declaration",
    );
  });

  it("refuses unknown references, bad structure and every bound as malformed-structure", async () => {
    expect(await detailOf(await workbookXml("unsafe/entity-reference.xlsx"))).toBe(
      "malformed-structure",
    );
    expect(await detailOf(await workbookXml("unsafe/deep-nesting.xlsx"))).toBe("malformed-structure");
    for (const input of [
      "<a>&#0;</a>",
      "<a>&amp</a>",
      "<a></b>",
      "<a>",
      "<a/><b/>",
      "text<a/>",
      "<p:a/>",
      '<a x="1" x="2"/>',
      `<a v="${"x".repeat(CONTAINER_BOUNDS_V1.maxXmlAttributeValueBytes + 1)}"/>`,
      `<${"n".repeat(CONTAINER_BOUNDS_V1.maxXmlNameBytes + 1)}/>`,
      Uint8Array.of(0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e),
    ]) {
      expect(await detailOf(input), String(input).slice(0, 40)).toBe("malformed-structure");
    }
  });
});
