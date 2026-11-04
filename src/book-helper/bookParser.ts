import { EPUB } from "foliate-js/epub.js";
import { MOBI } from "foliate-js/mobi.js";
import type { BookContentsItem } from "../services/extraViews";
import type { HelperGrantDTO } from "../services/helperBridge";
import { boundedUnzlib, type BookDecodeBudget } from "./boundedUnzlib";
import { paginateSection } from "./bookPages";
import {
  createEpubLoader,
  createGrantRangeReader,
  makeMobiFileLike,
  normalizeEntryName,
  resolveBookResource,
  type BookEntryGrant,
} from "./bookResources";
import type {
  BookContentsReply,
  BookOpenReply,
  BookOpenRequest,
  BookPageReply,
} from "./types";

/** The parser-only book adapter. It never imports `view.js`, a renderer or a
 * paginator: pages are built by `bookPages.ts` and displayed only inside the
 * app's empty-sandbox iframe. */
export const MAX_TOC_ITEMS = 5_000;
export const MAX_TOC_DEPTH = 32;
export const MAX_SECTIONS = 5_000;
export const MAX_PAGE_HTML = 256 * 1024;

interface SectionRef {
  id: string;
  label: string;
  href: string;
}

interface BookEngine {
  title: string;
  author: string;
  language: string;
  direction: "ltr" | "rtl";
  sections: SectionRef[];
  toc: BookContentsItem[];
  partial: boolean;
  setEntries(entries: readonly BookEntryGrant[]): void;
  sectionHtml(index: number): Promise<string>;
}

export class BookParser {
  readonly openReply: BookOpenReply;
  private readonly engine: BookEngine;
  private readonly contentsCursors = new Map<string, number>();

  constructor(engine: BookEngine) {
    this.engine = engine;
    this.openReply = {
      title: engine.title,
      author: engine.author,
      language: engine.language,
      direction: engine.direction,
      section_count: engine.sections.length,
      partial: engine.partial,
    };
  }

  async page(
    section: number,
    page: number,
    entries: readonly BookEntryGrant[],
  ): Promise<BookPageReply> {
    if (
      !Number.isInteger(section) ||
      !Number.isInteger(page) ||
      section < 0 ||
      page < 0 ||
      section >= this.engine.sections.length
    ) {
      throw new Error("extra_view.bad_request");
    }
    this.engine.setEntries(entries);
    const entryNames = entries.map((entry) => entry.entry);
    const raw = await this.engine.sectionHtml(section);
    const prepared = rewriteImages(raw, this.engine.sections[section].href, entryNames);
    const pages = paginateSection(prepared, { direction: this.engine.direction });
    const chosen = pages[Math.min(page, pages.length - 1)];
    const html = chosen.html.slice(0, MAX_PAGE_HTML);
    return {
      section,
      page: chosen.page,
      page_count: pages.length,
      html,
      resource_ids: usedResources(html, entryNames),
      direction: this.engine.direction,
    };
  }

  contents(cursor: string | null, limit: number): BookContentsReply {
    const offset = cursor ? this.contentsCursors.get(cursor) : 0;
    if (offset === undefined) throw new Error("extra_view.bad_request");
    const count = Math.max(1, Math.min(256, limit));
    const flat = flatten(this.engine.toc);
    const slice = flat.slice(offset, offset + count);
    let next: string | null = null;
    if (offset + slice.length < flat.length) {
      next = crypto.randomUUID();
      this.contentsCursors.set(next, offset + slice.length);
    }
    return {
      items: slice,
      next_cursor: next,
      complete: next === null,
    };
  }
}

function flatten(items: readonly BookContentsItem[], depth = 0): BookContentsItem[] {
  if (depth > MAX_TOC_DEPTH) return [];
  const output: BookContentsItem[] = [];
  for (const item of items) {
    if (output.length >= MAX_TOC_ITEMS) break;
    output.push({ ...item, children: [] });
    if (item.children.length > 0) {
      output.push(...flatten(item.children, depth + 1).slice(0, MAX_TOC_ITEMS - output.length));
    }
  }
  return output;
}

function rewriteImages(
  html: string,
  sectionHref: string,
  resourceIds: readonly string[],
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(resourceIds.map((id) => normalizeSafely(id)).filter(Boolean));
  for (const image of [...doc.body.querySelectorAll("img")]) {
    const source = image.getAttribute("src");
    if (!source) continue;
    try {
      const resolved = resolveBookResource(sectionHref, source);
      if (allowed.has(resolved)) {
        image.setAttribute("src", `book-resource:${resolved}`);
      } else {
        image.removeAttribute("src");
      }
    } catch {
      image.removeAttribute("src");
    }
  }
  return doc.body.innerHTML;
}

function normalizeSafely(value: string): string | null {
  try {
    return normalizeEntryName(value);
  } catch {
    return null;
  }
}

function usedResources(html: string, resourceIds: readonly string[]): string[] {
  const used = new Set<string>();
  for (const id of resourceIds) {
    const normalized = normalizeSafely(id);
    if (normalized && html.includes(`book-resource:${normalized}`)) used.add(normalized);
  }
  return [...used];
}

export interface OpenBookInputs {
  grants: readonly HelperGrantDTO[];
  decodedBudget: BookDecodeBudget;
}

/** Open one parser-only book. EPUB entries come from the native archive
 * loader as individual grants; MOBI reads bounded ranges from its one
 * source grant. */
export async function openBook(
  request: BookOpenRequest,
  inputs: OpenBookInputs,
): Promise<BookParser> {
  if (request.format === "epub") {
    return openEpub(request, inputs.grants, request.entries);
  }
  if (request.format === "mobi" || request.format === "azw3") {
    return openMobi(request, inputs);
  }
  throw new Error("extra_view.unsupported");
}

async function openEpub(
  request: BookOpenRequest,
  grants: readonly HelperGrantDTO[],
  entries: readonly BookEntryGrant[],
): Promise<BookParser> {
  const loader = createEpubLoader(grants, entries);
  const book = new EPUB(loader);
  await book.open(request.entry_name);
  await book.init();
  const metadata = book.metadata ?? {};
  const rawSections = (Array.isArray(book.sections) ? book.sections : []).slice(0, MAX_SECTIONS);
  if (rawSections.length === 0) throw new Error("extra_view.corrupt");
  const sections: SectionRef[] = rawSections.map((section, index) => ({
    id: typeof section.id === "string" ? section.id : `section-${index}`,
    label: plainText(typeof section.label === "string" ? section.label : `Section ${index + 1}`),
    href:
      typeof section.href === "string"
        ? section.href
        : (() => {
            throw new Error("extra_view.corrupt");
          })(),
  }));
  const engine: BookEngine = {
    title: plainText(textValue(metadata.title) || "Book"),
    author: plainText(textValue(metadata.author)),
    language: textValue(metadata.language),
    direction: metadata.direction === "rtl" ? "rtl" : "ltr",
    sections,
    toc: normalizeToc(book.toc, sections),
    partial: false,
    setEntries(next) {
      loader.setEntries(next);
    },
    async sectionHtml(index) {
      const section = sections[index];
      const entry = request.opf_path
        ? resolveBookResource(request.opf_path, section.href)
        : normalizeEntryName(section.href);
      return loader.loadText(entry);
    },
  };
  return new BookParser(engine);
}

async function openMobi(
  request: BookOpenRequest,
  inputs: OpenBookInputs,
): Promise<BookParser> {
  const grant = inputs.grants[0];
  if (!grant) throw new Error("extra_view.corrupt");
  const reader = createGrantRangeReader(grant.token_url, grant.byte_len);
  const file = makeMobiFileLike(grant.name, grant.byte_len, reader);
  const book = new MOBI({
    unzlib: (data) => boundedUnzlib(data, inputs.decodedBudget),
  });
  await book.open(file);
  await book.init();
  const metadata = book.metadata ?? {};
  const rawSections = (Array.isArray(book.sections) ? book.sections : []).slice(0, MAX_SECTIONS);
  if (rawSections.length === 0) throw new Error("extra_view.corrupt");
  const sections: SectionRef[] = rawSections.map((section, index) => ({
    id: typeof section.id === "string" ? section.id : `section-${index}`,
    label: plainText(typeof section.label === "string" ? section.label : `Section ${index + 1}`),
    href: typeof section.href === "string" ? section.href : "",
  }));
  const engine: BookEngine = {
    title: plainText(textValue(metadata.title) || request.entry_name || "Book"),
    author: plainText(textValue(metadata.author)),
    language: textValue(metadata.language),
    direction: metadata.direction === "rtl" ? "rtl" : "ltr",
    sections,
    toc: normalizeToc(book.toc, sections),
    partial: false,
    setEntries() {
      // MOBI reads bounded ranges from its one source grant.
    },
    async sectionHtml(index) {
      const section = rawSections[index];
      if (!section || typeof section.load !== "function") {
        throw new Error("extra_view.unsupported");
      }
      const value = await section.load();
      if (typeof value === "string") return value;
      if (value instanceof Blob) return value.text();
      if (value instanceof ArrayBuffer) {
        return new TextDecoder("utf-8", { fatal: false }).decode(value);
      }
      if (ArrayBuffer.isView(value)) {
        return new TextDecoder("utf-8", { fatal: false }).decode(value);
      }
      throw new Error("extra_view.corrupt");
    },
  };
  return new BookParser(engine);
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  }
  return "";
}

function plainText(value: string): string {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 512);
}

function normalizeToc(raw: unknown, sections: readonly SectionRef[]): BookContentsItem[] {
  let total = 0;
  const visit = (value: unknown, depth: number, path: string): BookContentsItem[] => {
    if (depth > MAX_TOC_DEPTH || !Array.isArray(value)) return [];
    const items: BookContentsItem[] = [];
    for (const entry of value) {
      if (total >= MAX_TOC_ITEMS) break;
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const label = plainText(textValue(record.label) || textValue(record.title));
      if (label === "") continue;
      const href =
        textValue(record.href) ||
        (record.content && typeof record.content === "object"
          ? textValue((record.content as Record<string, unknown>).src)
          : "");
      let section = 0;
      if (href !== "") {
        const normalized = safeNormalize(href.split("#")[0]);
        const found = sections.findIndex((candidate) => {
          const candidateHref = safeNormalize(candidate.href.split("#")[0]);
          return normalized !== null && candidateHref === normalized;
        });
        section = found >= 0 ? found : 0;
      }
      total += 1;
      const itemPath = `${path}/${total}`;
      const childrenRaw = record.children ?? record.subitems;
      const children = visit(childrenRaw, depth + 1, itemPath);
      items.push({
        id: itemPath,
        label,
        section,
        children,
      });
      if (total >= MAX_TOC_ITEMS) break;
    }
    return items;
  };
  return visit(raw, 0, "toc");
}

function safeNormalize(value: string): string | null {
  try {
    return normalizeEntryName(value);
  } catch {
    return null;
  }
}
