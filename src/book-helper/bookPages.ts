import DOMPurify from "dompurify";

/** Deterministic book pagination (Step 07f D3): at most 4,000 Unicode
 * scalars or 24 block elements per page. An oversized paragraph splits at the
 * last whitespace before 4,000 (or at the exact scalar boundary when there is
 * no whitespace), and images stand alone. */
export const MAX_PAGE_SCALARS = 4_000;
export const MAX_PAGE_BLOCKS = 24;
export const MAX_PAGE_HTML = 256 * 1024;

export interface BookPageOptions {
  maxScalars?: number;
  maxBlocks?: number;
  direction?: "ltr" | "rtl";
}

export interface BookPageChunk {
  page: number;
  pageCount: number;
  html: string;
}

const ALLOWED_TAGS = [
  "p", "div", "span", "br", "hr", "pre", "code", "em", "strong", "b", "i", "u", "s",
  "sub", "sup", "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "img", "h1", "h2", "h3", "h4", "h5", "h6", "dl", "dt",
  "dd",
];

const DROP_TAGS = [
  "script", "style", "iframe", "object", "embed", "form", "input", "button", "link",
  "meta", "base", "video", "audio", "source", "svg", "math", "template", "noscript",
  "textarea", "select", "option",
];

/** Clean one section fragment before it is split. The page is cleaned again
 * by SafeMarkupFrame inside the empty-sandbox iframe. */
export function sanitizeBookFragment(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["src", "alt", "title", "colspan", "rowspan"],
    FORBID_TAGS: DROP_TAGS,
    FORBID_CONTENTS: DROP_TAGS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
    ALLOWED_URI_REGEXP: /^book-resource:/i,
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  for (const image of [...doc.body.querySelectorAll("img")]) {
    const source = image.getAttribute("src") ?? "";
    if (!source.startsWith("book-resource:") || source.length > 256) {
      image.removeAttribute("src");
    }
    image.removeAttribute("srcset");
    image.removeAttribute("style");
  }
  for (const node of [...doc.body.querySelectorAll("[href],[style],[srcset],[onerror],[onclick]")]) {
    node.removeAttribute("href");
    node.removeAttribute("style");
    node.removeAttribute("srcset");
    node.removeAttribute("onerror");
    node.removeAttribute("onclick");
  }
  return doc.body.innerHTML;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scalars(text: string): string[] {
  return Array.from(text);
}

/** Split one long paragraph at the last whitespace before `max`, otherwise
 * at exactly `max` scalars. Whitespace at the cut is not duplicated. */
export function splitOversizedText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = scalars(text);
  while (rest.length > 0) {
    if (rest.length <= max) {
      chunks.push(rest.join(""));
      break;
    }
    let cut = -1;
    for (let index = max - 1; index >= 0; index -= 1) {
      if (/\s/.test(rest[index])) {
        cut = index;
        break;
      }
    }
    if (cut <= 0) {
      chunks.push(rest.slice(0, max).join(""));
      rest = rest.slice(max);
    } else {
      chunks.push(rest.slice(0, cut).join(""));
      rest = rest.slice(cut + 1);
    }
  }
  return chunks.length > 0 ? chunks : [""];
}

function isBlockTag(tag: string): boolean {
  return /^(p|div|h[1-6]|li|blockquote|pre|table|figure|section|article|header|footer|img|hr)$/.test(
    tag,
  );
}

interface PageBuffer {
  blocks: string[];
  blockCount: number;
  scalarCount: number;
}

function emptyPage(): PageBuffer {
  return { blocks: [], blockCount: 0, scalarCount: 0 };
}

function flush(pages: PageBuffer[], page: PageBuffer): PageBuffer {
  if (page.blockCount > 0) pages.push(page);
  return emptyPage();
}

/** Split one section document into deterministic pages. The returned HTML is
 * already inert; callers still mount it in `sandbox=""`. */
export function paginateSection(
  sectionHtml: string,
  options: BookPageOptions = {},
): BookPageChunk[] {
  const maxScalars = Math.max(1, options.maxScalars ?? MAX_PAGE_SCALARS);
  const maxBlocks = Math.max(1, options.maxBlocks ?? MAX_PAGE_BLOCKS);
  const safe = sanitizeBookFragment(sectionHtml);
  const doc = new DOMParser().parseFromString(safe, "text/html");
  const pages: PageBuffer[] = [];
  let page = emptyPage();
  const addBlock = (html: string, textScalars: number) => {
    if (
      page.blockCount > 0 &&
      (page.blockCount >= maxBlocks || page.scalarCount + textScalars > maxScalars)
    ) {
      page = flush(pages, page);
    }
    page.blocks.push(html);
    page.blockCount += 1;
    page.scalarCount += textScalars;
  };
  const bodyChildren = [...doc.body.children];
  if (bodyChildren.length === 0) {
    const text = doc.body.textContent ?? "";
    for (const chunk of splitOversizedText(text, maxScalars)) {
      addBlock(`<p>${escapeHtml(chunk)}</p>`, scalars(chunk).length);
      page = flush(pages, page);
    }
  } else {
    for (const element of bodyChildren) {
      const tag = element.tagName.toLowerCase();
      if (DROP_TAGS.includes(tag)) continue;
      if (tag === "img") {
        page = flush(pages, page);
        addBlock(element.outerHTML, 0);
        page = flush(pages, page);
        continue;
      }
      if (tag === "table") {
        const html = element.outerHTML;
        if (html.length > MAX_PAGE_HTML) continue;
        page = flush(pages, page);
        addBlock(html, 0);
        page = flush(pages, page);
        continue;
      }
      if (!isBlockTag(tag)) {
        // Inline-only top-level content is still one paragraph.
        const text = element.textContent ?? "";
        const chunks = splitOversizedText(text, maxScalars);
        for (const chunk of chunks) {
          addBlock(`<p>${escapeHtml(chunk)}</p>`, scalars(chunk).length);
          page = flush(pages, page);
        }
        continue;
      }
      const text = element.textContent ?? "";
      const length = scalars(text).length;
      if (length <= maxScalars) {
        addBlock(element.outerHTML, length);
        if (page.scalarCount >= maxScalars || page.blockCount >= maxBlocks) {
          page = flush(pages, page);
        }
      } else {
        page = flush(pages, page);
        for (const chunk of splitOversizedText(text, maxScalars)) {
          addBlock(`<p>${escapeHtml(chunk)}</p>`, scalars(chunk).length);
          page = flush(pages, page);
        }
      }
    }
  }
  if (page.blockCount > 0) pages.push(page);
  const pageCount = Math.max(1, pages.length);
  const direction = options.direction ?? "ltr";
  return (pages.length > 0 ? pages : [emptyPage()]).map((value, index) => ({
    page: index,
    pageCount,
    html: `<article class="adp-book-page" dir="${direction}">${value.blocks.join("")}</article>`,
  }));
}

/** Bounded plain text for find. No regex, no whole-file read. */
export function pageText(html: string, maxChars = 65_536): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").slice(0, maxChars);
}
