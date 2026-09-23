/**
 * Open Packaging Conventions over the bounded ZIP reader (M13).
 *
 * XLSX and XLSB are both OPC packages: a content-type map and relationship
 * parts that say which part is what. Both adapters, and pre-flight's format
 * identification, read them through here — package metadata is container
 * knowledge, not either format's.
 *
 * Relationship targets are resolved to part names and refused when they would
 * leave the package; external targets are recorded as text and never
 * resolved, fetched, or opened (invariant 12).
 */

import { BoundExceededError } from "./bounds.js";
import { attributeOf, tokenizeXml, type XmlEventV1 } from "./xml.js";
import type { ZipContainerHandleV1 } from "./zip.js";

/** The most any single metadata part (workbook, rels, styles …) may expand to. */
export const OPC_PART_MAX_BYTES = 16_777_216;

export const CONTENT_TYPES_PART = "[Content_Types].xml";

export interface OpcContentTypesV1 {
  /** The part's content type by override, then by extension default. */
  typeOf(partName: string): string | null;
  /** Every declaration: `target` is a part name, or `*.ext` for a default. */
  readonly declared: readonly { readonly target: string; readonly contentType: string }[];
}

export interface OpcRelationshipV1 {
  readonly id: string;
  /** The relationship type URI as written. */
  readonly type: string;
  /** A part name when internal; the target text, unresolved, when external. */
  readonly target: string;
  readonly isExternal: boolean;
}

/** The last path segment of a relationship type, lowercased: `worksheet`. */
export const relationshipKind = (type: string): string =>
  (type.split("/").at(-1) ?? "").toLowerCase();

const asciiLower = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** A small part's XML events; the whole part is capped at `maxBytes`. */
export async function* partEvents(
  zip: ZipContainerHandleV1,
  partName: string,
  maxBytes = OPC_PART_MAX_BYTES,
): AsyncGenerator<XmlEventV1, void, undefined> {
  yield* tokenizeXml([await zip.readEntry(partName, { maxBytes })]);
}

/**
 * Resolves a relationship target against the part that declared it (`null`
 * for the package root). A target that climbs above the package is refused.
 */
export function resolvePartName(sourcePart: string | null, target: string): string {
  let path: string;
  try {
    path = decodeURIComponent(target.split("#")[0] ?? "");
  } catch {
    throw new BoundExceededError("malformed-structure");
  }
  const base = path.startsWith("/")
    ? []
    : (sourcePart ?? "").split("/").slice(0, -1);
  const segments = [...base];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) {
        throw new BoundExceededError("malformed-structure");
      }
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new BoundExceededError("malformed-structure");
  }
  return segments.join("/");
}

export async function readContentTypes(zip: ZipContainerHandleV1): Promise<OpcContentTypesV1> {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for await (const event of partEvents(zip, CONTENT_TYPES_PART)) {
    if (event.kind !== "start") continue;
    const contentType = attributeOf(event, "ContentType");
    if (contentType === null) continue;
    if (event.local === "Default") {
      const extension = attributeOf(event, "Extension");
      if (extension !== null) defaults.set(asciiLower(extension), contentType);
    } else if (event.local === "Override") {
      const partName = attributeOf(event, "PartName");
      if (partName !== null) overrides.set(asciiLower(partName.replace(/^\//, "")), contentType);
    }
  }
  return {
    typeOf(partName) {
      const key = asciiLower(partName);
      const override = overrides.get(key);
      if (override !== undefined) return override;
      const dot = key.lastIndexOf(".");
      return dot === -1 ? null : (defaults.get(key.slice(dot + 1)) ?? null);
    },
    declared: [
      ...[...defaults].map(([extension, contentType]) => ({ target: `*.${extension}`, contentType })),
      ...[...overrides].map(([target, contentType]) => ({ target, contentType })),
    ],
  };
}

/** The `_rels` part that belongs to `sourcePart` (`null` = the package). */
export const relationshipsPartOf = (sourcePart: string | null): string => {
  if (sourcePart === null) return "_rels/.rels";
  const slash = sourcePart.lastIndexOf("/");
  return `${sourcePart.slice(0, slash + 1)}_rels/${sourcePart.slice(slash + 1)}.rels`;
};

/** A part's relationships; a part with no `_rels` part has none. */
export async function readRelationships(
  zip: ZipContainerHandleV1,
  sourcePart: string | null,
): Promise<readonly OpcRelationshipV1[]> {
  const relsPart = relationshipsPartOf(sourcePart);
  if (!zip.has(relsPart)) return [];
  const relationships: OpcRelationshipV1[] = [];
  for await (const event of partEvents(zip, relsPart)) {
    if (event.kind !== "start" || event.local !== "Relationship") continue;
    const id = attributeOf(event, "Id");
    const type = attributeOf(event, "Type");
    const target = attributeOf(event, "Target");
    if (id === null || type === null || target === null) {
      throw new BoundExceededError("malformed-structure");
    }
    const isExternal = attributeOf(event, "TargetMode") === "External";
    relationships.push({
      id,
      type,
      target: isExternal ? target : resolvePartName(sourcePart, target),
      isExternal,
    });
  }
  return relationships;
}
