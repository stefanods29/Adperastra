/** Safe HTML/Markdown to block conversion (Step 08b D4, E6/E7).
 *
 * This module runs inside the trusted document/PDF-write helper. It never
 * executes a script, never loads a remote resource and never returns raw
 * markup: only the bounded `HtmlBlock` model leaves it. A remote image is
 * dropped and counted; an image is kept only when the caller's resolver
 * authorizes its local source.
 *
 * `markdown-it` is created with `html: false`; DOMPurify removes scripts,
 * event attributes and unknown markup. The resulting DOM is walked with an
 * allowlist, never serialized back into the application's own document. */

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import {
  MAX_TABLE_CELLS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  blockPlainText,
  escapeHtmlText,
  type DocumentBlockAnalysis,
  type DocumentSourceKind,
  type HtmlBlock,
  type HtmlBlockImage,
} from "../convert/documentTypes";

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});
// D4 supports basic tables; markdown-it ships the rule but leaves it off in
// the default preset. Raw HTML stays disabled.
markdown.enable("table");

const ALLOWED_HTML = {
  ALLOWED_TAGS: [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
    "br",
    "blockquote",
    "div",
    "section",
    "span",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "a",
  ],
  ALLOWED_ATTR: ["src", "alt", "title", "href"],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "svg", "video", "audio"],
  FORBID_ATTR: ["style", "onerror", "onload", "onclick", "srcdoc"],
};

/** A resolver for one local image. Return null to drop and count it. */
export type ImageResolver = (src: string, alt: string) => HtmlBlockImage | null;

/** Parse one document into blocks. Pure except for the DOM APIs the helper
 * already owns; it performs no network fetch. */
export function parseDocumentBlocks(
  source: { kind: DocumentSourceKind; text: string },
  resolveImage: ImageResolver = () => null,
): DocumentBlockAnalysis {
  let html: string;
  if (source.kind === "markdown") {
    html = markdown.render(source.text);
  } else if (source.kind === "html") {
    html = source.text;
  } else {
    throw new Error("convert.bad_request");
  }
  const clean = DOMPurify.sanitize(html, ALLOWED_HTML);
  const document = new DOMParser().parseFromString(clean, "text/html");
  const analysis: DocumentBlockAnalysis = {
    blocks: [],
    layout_loss: false,
    removed_images: 0,
    removed_elements: 0,
    unmappable_text: false,
  };
  walkContainer(document.body, 0, analysis, resolveImage);
  return analysis;
}

function walkContainer(
  container: ParentNode,
  listLevel: number,
  analysis: DocumentBlockAnalysis,
  resolveImage: ImageResolver,
): void {
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapse(node.textContent ?? "");
      if (text !== "") analysis.blocks.push({ kind: "paragraph", text });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    switch (tag) {
      case "p":
        pushText("paragraph", element, analysis, resolveImage);
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        pushHeading(Number(tag.slice(1)), element, analysis);
        break;
      case "ul":
      case "ol":
        walkList(element, listLevel, tag === "ol", analysis, resolveImage);
        break;
      case "pre":
        analysis.blocks.push({ kind: "code", text: element.textContent ?? "" });
        break;
      case "table":
        pushTable(element, analysis);
        break;
      case "img":
        pushImage(element, analysis, resolveImage);
        break;
      case "blockquote":
        walkContainer(element, listLevel + 1, analysis, resolveImage);
        analysis.layout_loss = true;
        break;
      case "div":
      case "section":
        walkContainer(element, listLevel, analysis, resolveImage);
        break;
      case "br":
        break;
      case "script":
      case "style":
      case "iframe":
      case "object":
      case "embed":
      case "form":
      case "input":
      case "button":
      case "link":
      case "meta":
      case "svg":
      case "video":
      case "audio":
        analysis.removed_elements += 1;
        analysis.layout_loss = true;
        break;
      default: {
        // Inline formatting inside a paragraph is flattened; a block-level
        // element with no block representation is removed and disclosed.
        const text = collapse(element.textContent ?? "");
        if (text !== "") {
          analysis.blocks.push({ kind: "paragraph", text });
          analysis.layout_loss = true;
        } else {
          analysis.removed_elements += 1;
        }
      }
    }
  }
}

function walkList(
  list: Element,
  level: number,
  ordered: boolean,
  analysis: DocumentBlockAnalysis,
  resolveImage: ImageResolver,
): void {
  for (const child of Array.from(list.children)) {
    if (child.tagName.toLowerCase() !== "li") {
      analysis.removed_elements += 1;
      analysis.layout_loss = true;
      continue;
    }
    const clone = child.cloneNode(true) as Element;
    for (const nested of Array.from(clone.querySelectorAll("ul,ol"))) nested.remove();
    const text = collapse(clone.textContent ?? "");
    if (text !== "") analysis.blocks.push({ kind: "list_item", ordered, level, text });
    for (const nested of Array.from(child.children)) {
      const tag = nested.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        walkList(nested, Math.min(8, level + 1), tag === "ol", analysis, resolveImage);
      }
    }
  }
}

function pushText(
  kind: "paragraph",
  element: Element,
  analysis: DocumentBlockAnalysis,
  resolveImage: ImageResolver,
): void {
  const text = collapse(element.textContent ?? "");
  if (text !== "") analysis.blocks.push({ kind, text });
  for (const image of Array.from(element.querySelectorAll("img"))) {
    pushImage(image, analysis, resolveImage);
  }
}

function pushHeading(level: number, element: Element, analysis: DocumentBlockAnalysis): void {
  const text = collapse(element.textContent ?? "");
  if (text !== "") {
    analysis.blocks.push({
      kind: "heading",
      level: Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6,
      text,
    });
  }
}

function pushTable(table: Element, analysis: DocumentBlockAnalysis): void {
  const rows: Element[] = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0 || rows.length > MAX_TABLE_ROWS) {
    analysis.layout_loss = true;
    return;
  }
  const cells: string[][] = [];
  let cellCount = 0;
  for (const row of rows) {
    const rowCells = Array.from(row.querySelectorAll("th,td"));
    if (rowCells.length > MAX_TABLE_COLUMNS) {
      analysis.layout_loss = true;
      return;
    }
    const values = rowCells.map((cell) => collapse(cell.textContent ?? ""));
    cellCount += values.length;
    if (cellCount > MAX_TABLE_CELLS) {
      analysis.layout_loss = true;
      return;
    }
    cells.push(values);
  }
  const header = rows[0]?.querySelector("th") !== null && rows[0]?.querySelector("th") !== undefined;
  analysis.blocks.push({ kind: "table", cells, header });
  if (!header) analysis.layout_loss = true;
}

function pushImage(element: Element, analysis: DocumentBlockAnalysis, resolveImage: ImageResolver): void {
  const src = element.getAttribute("src") ?? "";
  const alt = collapse(element.getAttribute("alt") ?? "");
  const image = isSafeLocalSource(src) ? resolveImage(src, alt) : null;
  if (image) {
    analysis.blocks.push({ kind: "image", image });
  } else {
    analysis.removed_images += 1;
    analysis.layout_loss = true;
  }
}

/** Only a relative/local path or a data URL may be resolved. `http:`,
 * `https:`, protocol-relative and `file:` URLs never reach a resolver. */
export function isSafeLocalSource(src: string): boolean {
  const value = src.trim().toLowerCase();
  if (value === "" || value.startsWith("http:") || value.startsWith("https:") || value.startsWith("//")) return false;
  if (value.startsWith("file:") || value.startsWith("javascript:") || value.startsWith("vbscript:")) return false;
  return true;
}

/** Render blocks as an app-owned standalone HTML document (D4).
 *
 * No remote URLs, scripts or event attributes can appear: every text is
 * escaped and every image must be a data URL or a same-document reference
 * that the caller already authorized. `fontCss` is included only when the
 * caller explicitly passes the licensed local font face. */
export function renderDocumentHtml(
  blocks: readonly HtmlBlock[],
  options: { title?: string; fontCss?: string } = {},
): string {
  const title = escapeHtmlText(options.title ?? "Document");
  const body = blocks.map(blockHtml).join("\n");
  const font = options.fontCss ? `<style>${options.fontCss}</style>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${font}
</head>
<body>
${body}
</body>
</html>`;
}

function blockHtml(block: HtmlBlock): string {
  switch (block.kind) {
    case "paragraph":
      return `<p>${escapeHtmlText(block.text)}</p>`;
    case "heading":
      return `<h${block.level}>${escapeHtmlText(block.text)}</h${block.level}>`;
    case "list_item": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}><li>${escapeHtmlText(block.text)}</li></${tag}>`;
    }
    case "code":
      return `<pre><code>${escapeHtmlText(block.text)}</code></pre>`;
    case "table": {
      const rows = block.cells
        .map((row, rowIndex) => {
          const tag = block.header && rowIndex === 0 ? "th" : "td";
          return `<tr>${row.map((cell) => `<${tag}>${escapeHtmlText(cell)}</${tag}>`).join("")}</tr>`;
        })
        .join("");
      return `<table>${rows}</table>`;
    }
    case "image": {
      const src = imageSrc(block.image);
      return src ? `<img src="${escapeHtmlText(src)}" alt="${escapeHtmlText(block.image.alt)}">` : "";
    }
  }
}

function imageSrc(image: HtmlBlockImage): string | null {
  // A helper grant is not a URL and must never be turned into one. The HTML
  // export therefore leaves helper-granted images out; the PDF writer draws
  // them from their authorized bytes instead. No path or remote URL is
  // accepted here.
  void image;
  return null;
}

/** Plain text of all blocks, for search or a text export. */
export function documentPlainText(blocks: readonly HtmlBlock[]): string {
  return blocks.map(blockPlainText).join("\n");
}

function collapse(text: string): string {
  return text.replace(/[\t\r\n ]+/g, " ").trim();
}
