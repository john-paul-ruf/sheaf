import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { htmlTableAdapter, readHtmlTableInventory } from "../../../src/import/formats/html-table/index.js";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { BoundExceededError } from "../../../src/import/source/bounds.js";
import { bytesSource } from "../../../src/import/source/source.js";
import { assertConformingStream } from "../../unit/import/facts/conformance.js";

/** Everything the adapter and reader produce, or the bound they stopped at. */
const run = async (bytes: Uint8Array): Promise<{ items: WorkbookFactStreamItemV2[] } | { detail: string }> => {
  const source = bytesSource(bytes);
  try {
    await readHtmlTableInventory.readInventory({ kind: "text", source });
    const items: WorkbookFactStreamItemV2[] = [];
    for await (const item of htmlTableAdapter.parseSheets({ kind: "text", source }, [0, 1, 2], { cancellation: { aborted: false } })) {
      items.push(item);
    }
    return { items };
  } catch (cause) {
    if (cause instanceof BoundExceededError) return { detail: cause.detail };
    throw cause;
  }
};

const SENTINEL = "SENTINEL";

/** Tag soup: the fragments legacy exports and hostile files are made of. */
const fragment = fc.oneof(
  fc.constantFrom(
    "<table>", "</table>", "<tr>", "</tr>", "<td>", "</td>", "<th colspan=2>", "<td rowspan=3>", "<br>",
    "<caption>", "</caption>", "<!--", "-->", "<![CDATA[", "]]>", "<!DOCTYPE html>", "<?xml ?>", "&amp;",
    "&nbsp;", "&#150;", "&bogus;", "<", ">", "\"", "'", "=", "<td x:num=\"12.5\">", "<td x:err>", "<o:p>",
    "<img src=x>", "<a href=\"javascript:x\">", "<td onclick=\"y\">", "</script>", "</style>",
  ),
  fc.string({ maxLength: 8 }),
);

/**
 * A `<script>` or `<style>` block whose body holds the sentinel inside markup.
 * The body never contains `</`, so the block cannot end early: anything of it
 * that reached a fact would be leaked script or style text.
 */
const activeBlock = fc
  .tuple(fc.constantFrom("script", "style", "SCRIPT", "Style"), fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }))
  .map(([name, before, after]) => {
    const clean = (text: string): string => text.replace(/<\//g, "");
    const body = name.toLowerCase() === "style"
      ? `.c{mso-number-format:"<b>${SENTINEL}</b>"} td{content:"<i>${SENTINEL}</i>"}`
      : `document.write("<td>${SENTINEL}</td>")`;
    return `<${name}>${clean(before)}${body.replace(/<\//g, "<\\/")}${clean(after)}</${name}>`;
  });

describe("HTML-table adapter on arbitrary input (property)", () => {
  it("never throws anything but BoundExceededError on arbitrary bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 400 }), async (bytes) => {
        const outcome = await run(bytes);
        if ("items" in outcome) assertConformingStream(outcome.items);
      }),
      { numRuns: 300 },
    );
  });

  it("never throws anything but BoundExceededError on tag soup, and always conforms", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fragment, { maxLength: 60 }), async (fragments) => {
        const outcome = await run(new TextEncoder().encode(fragments.join("")));
        if ("items" in outcome) assertConformingStream(outcome.items);
      }),
      { numRuns: 400 },
    );
  });

  // The blocks sit where a tag can open (after `</td>` or `<td>`); arbitrary
  // soup follows them. Soup *before* a block may legitimately swallow its
  // start tag (`<?<script>` is a bogus comment in HTML too), after which its
  // body is ordinary text, so that is not a leak this property can judge.
  it("never yields a fact holding markup or text from a script or style block", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fragment, { maxLength: 40 }),
        fc.array(activeBlock, { minLength: 1, maxLength: 3 }),
        async (soup, blocks) => {
          const document = `<table class=c><tr><td class=c x:num=1>1</td>${blocks.join("<td>")}${soup.join("")}</table>`;
          const outcome = await run(new TextEncoder().encode(document));
          if ("items" in outcome) {
            expect(JSON.stringify(outcome.items, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value))).not.toContain(SENTINEL);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("detects the sentinel when it is ordinary cell text (negative control)", async () => {
    const outcome = await run(new TextEncoder().encode(`<table><tr><td>${SENTINEL}</td></tr></table>`));
    expect("items" in outcome && JSON.stringify(outcome.items, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value))).toContain(SENTINEL);
  });
});
