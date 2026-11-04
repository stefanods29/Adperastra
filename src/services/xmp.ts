/** Shared bounded XMP manipulation (Step 08c E5, privacy-1).
 *
 * This module runs only in the trusted `pdf_write` helper webview. Raw XML
 * never crosses a UI `invoke` call. It matches namespace URI + local name,
 * refuses DTD/ENTITY/processing instructions before DOMParser, and preserves
 * unknown unselected namespaces and attributes.
 */

import type { MetadataCategory } from "../convert/types";
import type { PrivacyField } from "./privacy";

export const MAX_XMP_BYTES = 1024 * 1024;
export const MAX_XMP_NODES = 10_000;
export const MAX_XMP_DEPTH = 32;
export const MAX_XMP_ATTRS = 10_000;
export const MAX_XMP_TEXT = 1024 * 1024;
export const MAX_XMP_FIELDS = 10_000;

export const NS = {
  xmpmeta: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  dc: "http://purl.org/dc/elements/1.1/",
  exif: "http://ns.adobe.com/exif/1.0/",
  tiff: "http://ns.adobe.com/tiff/1.0/",
  xmp: "http://ns.adobe.com/xap/1.0/",
  pdf: "http://ns.adobe.com/pdf/1.3/",
  iptc: "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
  xml: "http://www.w3.org/XML/1998/namespace",
} as const;

export type XmpEdit =
  | { kind: "remove_categories"; categories: MetadataCategory[] }
  | { kind: "set_keywords"; keywords: string[] };

const LOCATION_FIELDS = ["Location", "City", "Country", "ProvinceState", "Sublocation", "WorldRegion"];

const KNOWN = new Set<string>(Object.values(NS));
const PREFIXES = new Map<string, string>(
  Object.entries(NS).map(([prefix, uri]) => [uri, prefix] as const),
);

function idPart(value: string): string {
  return [...value]
    .map((character) => (/[A-Za-z0-9_.-]/.test(character) ? character : "_"))
    .join("")
    .slice(0, 80);
}

function xmpFieldId(kind: "element" | "attr", ns: string | null, local: string): string {
  const prefix = (ns && PREFIXES.get(ns)) || "ext";
  return `xmp.${kind}.${prefix}.${idPart(local)}`.slice(0, 128);
}

function labelKey(category: MetadataCategory): string {
  switch (category) {
    case "exif":
      return "privacy.exif";
    case "gps":
      return "privacy.gps";
    case "camera":
      return "privacy.camera";
    case "date":
      return "privacy.date";
    case "icc":
      return "privacy.icc";
    case "xmp":
      return "privacy.xmp";
    case "iptc":
      return "privacy.iptc";
    case "author":
      return "privacy.author";
    case "comments":
      return "privacy.comments";
    case "attachments":
      return "privacy.attachments";
    case "forms":
      return "privacy.forms";
    case "annotations":
      return "privacy.annotations";
    case "scripts":
      return "privacy.scripts";
    case "timestamps":
      return "privacy.timestamps";
    default:
      return "privacy.xmp";
  }
}

function sanitize(value: string): string {
  return [...value]
    .slice(0, 512)
    .map((character) => (character.charCodeAt(0) < 0x20 ? " " : character))
    .join("");
}

function categoryFor(ns: string | null, local: string): MetadataCategory | null {
  if (ns === NS.exif && local.startsWith("GPS")) return "gps";
  if (
    ns === NS.exif &&
    [
      "DateTime",
      "DateTimeOriginal",
      "DateTimeDigitized",
      "OffsetTime",
      "OffsetTimeOriginal",
      "OffsetTimeDigitized",
      "SubSecTime",
      "SubSecTimeOriginal",
      "SubSecTimeDigitized",
    ].includes(local)
  ) {
    return "date";
  }
  if (
    ns === NS.exif &&
    (local.startsWith("Lens") ||
      ["BodySerialNumber", "CameraOwnerName", "OwnerName"].includes(local))
  ) {
    return "camera";
  }
  if (ns === NS.exif && local === "UserComment") return "comments";
  if (ns === NS.tiff && (local === "Make" || local === "Model")) return "camera";
  if (ns === NS.tiff && (local === "Artist" || local === "Copyright")) return "author";
  if (ns === NS.xmp && ["CreateDate", "ModifyDate", "MetadataDate"].includes(local)) return "date";
  if (ns === NS.pdf && ["Author", "Creator", "Producer"].includes(local)) return "author";
  if (ns === NS.pdf && ["CreationDate", "ModDate"].includes(local)) return "date";
  if (ns === NS.dc && ["creator", "rights"].includes(local)) return "author";
  if (ns === NS.dc && ["description", "subject"].includes(local)) return "comments";
  if (ns === NS.iptc && LOCATION_FIELDS.includes(local)) return "gps";
  if (ns === NS.iptc && ["By-line", "By-lineTitle", "CopyrightNotice"].includes(local)) return "author";
  if (ns === NS.iptc && ["DateCreated", "TimeCreated"].includes(local)) return "date";
  if (ns === NS.iptc && ["Caption", "Headline"].includes(local)) return "comments";
  return null;
}

function wantsRemoval(category: MetadataCategory, ns: string | null, local: string): boolean {
  switch (category) {
    case "gps":
      return (
        (ns === NS.exif && local.startsWith("GPS")) ||
        (ns === NS.iptc && LOCATION_FIELDS.includes(local))
      );
    case "author":
      return (
        (ns === NS.dc && (local === "creator" || local === "rights")) ||
        (ns === NS.pdf && ["Author", "Creator", "Producer"].includes(local)) ||
        (ns === NS.tiff && (local === "Artist" || local === "Copyright")) ||
        (ns === NS.exif && (local === "OwnerName" || local === "CameraOwnerName")) ||
        (ns === NS.iptc && ["By-line", "By-lineTitle", "CopyrightNotice"].includes(local))
      );
    case "date":
      return (
        (ns === NS.xmp && ["CreateDate", "ModifyDate", "MetadataDate"].includes(local)) ||
        (ns === NS.exif &&
          [
            "DateTime",
            "DateTimeOriginal",
            "DateTimeDigitized",
            "OffsetTime",
            "OffsetTimeOriginal",
            "OffsetTimeDigitized",
            "SubSecTime",
            "SubSecTimeOriginal",
            "SubSecTimeDigitized",
          ].includes(local)) ||
        (ns === NS.pdf && ["CreationDate", "ModDate"].includes(local)) ||
        (ns === NS.iptc && ["DateCreated", "TimeCreated"].includes(local))
      );
    case "camera":
      return (
        (ns === NS.tiff && (local === "Make" || local === "Model")) ||
        (ns === NS.exif &&
          (local.startsWith("Lens") ||
            ["BodySerialNumber", "CameraOwnerName", "OwnerName"].includes(local)))
      );
    case "comments":
      return (
        (ns === NS.dc && (local === "description" || local === "subject")) ||
        (ns === NS.exif && local === "UserComment") ||
        (ns === NS.iptc && (local === "Caption" || local === "Headline"))
      );
    case "exif":
      return ns === NS.exif || ns === NS.tiff;
    case "iptc":
      return ns === NS.iptc;
    default:
      return false;
  }
}

/** Remove an enclosing xpacket PI, then refuse every other PI/DTD/entity. */
export function safeXmpText(source: string): string {
  if (new TextEncoder().encode(source).byteLength > MAX_XMP_BYTES) throw new Error("privacy.too_large");
  let text = source.trim();
  if (text.startsWith("<?xpacket")) {
    const end = text.indexOf("?>");
    if (end < 0) throw new Error("privacy.unsupported");
    text = text.slice(end + 2).trimStart();
  }
  const last = text.lastIndexOf("<?xpacket");
  if (last >= 0) {
    const tail = text.slice(last).trimEnd();
    if (tail.endsWith("?>")) text = text.slice(0, last).trimEnd();
  }
  const upper = text.toUpperCase();
  if (text.includes("<?") || upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) {
    throw new Error("privacy.unsupported");
  }
  return text;
}

function parse(xml: string): Document {
  const text = safeXmpText(xml);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) throw new Error("privacy.unsupported");
  let nodes = 0;
  let attrs = 0;
  let characters = 0;
  const walk = (element: Element, depth: number): void => {
    if (depth > MAX_XMP_DEPTH) throw new Error("privacy.too_large");
    nodes += 1;
    attrs += element.attributes.length;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 3) characters += child.textContent?.length ?? 0;
    }
    if (nodes > MAX_XMP_NODES || attrs > MAX_XMP_ATTRS || characters > MAX_XMP_TEXT) {
      throw new Error("privacy.too_large");
    }
    for (const child of Array.from(element.children)) walk(child, depth + 1);
  };
  if (document.documentElement) walk(document.documentElement, 0);
  return document;
}

function hasUnknownNamespace(document: Document): boolean {
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.namespaceURI && !KNOWN.has(element.namespaceURI)) return true;
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.prefix === "xmlns" || attribute.name === "xmlns") continue;
      if (attribute.namespaceURI && !KNOWN.has(attribute.namespaceURI)) return true;
    }
  }
  return false;
}

function selective(categories: MetadataCategory[]): boolean {
  return categories.some((category) =>
    ["gps", "camera", "date", "author", "comments"].includes(category),
  );
}

/** Apply one edit and serialize the disconnected document. */
export function applyXmpEdit(xml: string, edit: XmpEdit): string {
  if (edit.kind === "set_keywords") return setKeywords(xml, edit.keywords);
  const categories = [...new Set(edit.categories)];
  if (categories.length === 0) throw new Error("privacy.bad_request");
  if (categories.includes("xmp")) return "";
  const document = parse(xml);
  if (selective(categories) && hasUnknownNamespace(document)) {
    throw new Error("privacy.unverified");
  }
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (categories.some((category) => wantsRemoval(category, element.namespaceURI, element.localName))) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (
        attribute.namespaceURI &&
        categories.some((category) => wantsRemoval(category, attribute.namespaceURI, attribute.localName))
      ) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  return new XMLSerializer().serializeToString(document);
}

function setKeywords(xml: string, keywords: string[]): string {
  if (keywords.length > 1000) throw new Error("privacy.too_large");
  const unique: string[] = [];
  for (const keyword of keywords) {
    if ([...keyword].length < 1 || [...keyword].length > 60) throw new Error("privacy.bad_request");
    if (!unique.includes(keyword)) unique.push(keyword);
  }
  const document = parse(xml);
  const subject = Array.from(document.getElementsByTagName("*")).find(
    (element) => element.namespaceURI === NS.dc && element.localName === "subject",
  );
  if (!subject) throw new Error("privacy.bad_request");
  while (subject.firstChild) subject.removeChild(subject.firstChild);
  const bag = document.createElementNS(NS.rdf, "rdf:Bag");
  bag.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:rdf", NS.rdf);
  for (const keyword of unique) {
    const item = document.createElementNS(NS.rdf, "rdf:li");
    item.textContent = keyword;
    bag.appendChild(item);
  }
  subject.appendChild(bag);
  return new XMLSerializer().serializeToString(document);
}

function relatedFor(category: MetadataCategory, local: string): MetadataCategory[] {
  return category === "camera" && (local === "OwnerName" || local === "CameraOwnerName")
    ? ["author"]
    : [];
}

/** Inspect one XMP packet in the trusted helper. */
export function inspectXmp(xml: string): PrivacyField[] {
  const document = parse(xml);
  const fields: PrivacyField[] = [
    {
      category: "xmp",
      containers: ["xmp"],
      related_categories: [],
      field_id: "xmp.packet",
      label_key: "privacy.xmp",
      preview: "",
      count: 1,
      content_affecting: false,
      coverage: "complete",
    },
  ];
  const push = (field: PrivacyField): void => {
    const existing = fields.find((item) => item.field_id === field.field_id);
    if (existing) existing.count += 1;
    else if (fields.length >= MAX_XMP_FIELDS) throw new Error("privacy.too_large");
    else fields.push(field);
  };
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    const ns = element.namespaceURI;
    if (ns) {
      const category = categoryFor(ns, element.localName);
      if (category) {
        push({
          category,
          containers: ["xmp"],
          related_categories: relatedFor(category, element.localName),
          field_id: xmpFieldId("element", ns, element.localName),
          label_key: labelKey(category),
          preview: "",
          count: 1,
          content_affecting: false,
          coverage: "complete",
        });
      } else if (!KNOWN.has(ns)) {
        push({
          category: "xmp",
          containers: ["xmp"],
          related_categories: [],
          field_id: xmpFieldId("element", ns, element.localName),
          label_key: "privacy.xmp",
          preview: "",
          count: 1,
          content_affecting: false,
          coverage: "unknown",
        });
      }
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.prefix === "xmlns" || attribute.name === "xmlns") continue;
      if (!attribute.namespaceURI) continue;
      const category = categoryFor(attribute.namespaceURI, attribute.localName);
      if (category) {
        push({
          category,
          containers: ["xmp"],
          related_categories: relatedFor(category, attribute.localName),
          field_id: xmpFieldId("attr", attribute.namespaceURI, attribute.localName),
          label_key: labelKey(category),
          preview: sanitize(attribute.value),
          count: 1,
          content_affecting: false,
          coverage: "complete",
        });
      } else if (!KNOWN.has(attribute.namespaceURI)) {
        push({
          category: "xmp",
          containers: ["xmp"],
          related_categories: [],
          field_id: xmpFieldId("attr", attribute.namespaceURI, attribute.localName),
          label_key: "privacy.xmp",
          preview: "",
          count: 1,
          content_affecting: false,
          coverage: "unknown",
        });
      }
    }
  }
  return fields;
}
