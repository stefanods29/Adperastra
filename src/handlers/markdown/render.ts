import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/** Markdown to a complete, safe HTML page for the Markdown viewer's frame
 * (Step 04b). Raw HTML inside the Markdown is shown as text (`html: false`)
 * and the result is cleaned with DOMPurify. The page has no scripts. */

export interface DocColors {
  text: string;
  muted: string;
  background: string;
  border: string;
  link: string;
  codeBackground: string;
  mark: string;
  markCurrent: string;
}

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** Only characters that appear in CSS colors ("#fff", "rgb(1, 2, 3)"). */
function safeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return /^[#a-zA-Z0-9(),.%\s-]+$/.test(trimmed) && trimmed !== "" ? trimmed : fallback;
}

export function renderMarkdownPage(source: string, colors: DocColors, zoom: number, lang: string): string {
  const body = DOMPurify.sanitize(markdown.render(source), { USE_PROFILES: { html: true } });
  const c = {
    text: safeColor(colors.text, "#202020"),
    muted: safeColor(colors.muted, "#616161"),
    background: safeColor(colors.background, "#ffffff"),
    border: safeColor(colors.border, "#e0e0e0"),
    link: safeColor(colors.link, "#0067c0"),
    code: safeColor(colors.codeBackground, "#fafafa"),
    mark: safeColor(colors.mark, "rgba(255, 223, 93, 0.5)"),
    markCurrent: safeColor(colors.markCurrent, "rgba(255, 159, 67, 0.6)"),
  };
  const size = Math.round(15 * Math.min(3, Math.max(0.5, zoom)));
  const css = `
html { background: ${c.background}; }
body { margin: 0; color: ${c.text}; background: ${c.background}; font: ${size}px/1.6 Inter, "Segoe UI", system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 32px 40px 64px; }
h1, h2 { border-bottom: 1px solid ${c.border}; padding-bottom: 0.3em; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.6em; }
a { color: ${c.link}; }
code, pre { font-family: "Cascadia Mono", Consolas, monospace; font-size: 0.9em; background: ${c.code}; border-radius: 4px; }
code { padding: 0.15em 0.35em; }
pre { padding: 12px 16px; overflow: auto; border: 1px solid ${c.border}; }
pre code { padding: 0; background: transparent; }
blockquote { margin: 1em 0; padding: 0 1em; color: ${c.muted}; border-left: 4px solid ${c.border}; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid ${c.border}; padding: 6px 12px; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid ${c.border}; }
::highlight(adp-find) { background-color: ${c.mark}; }
::highlight(adp-find-current) { background-color: ${c.markCurrent}; }
`;
  const language = /^[a-z-]{2,10}$/i.test(lang) ? lang : "en";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>${css}</style></head><body><main>${body}</main></body></html>`;
}

/** Highlight every case-insensitive match of `text` in a page and scroll to
 * match number `current` (wrapping around). Uses the CSS Custom Highlight
 * API, so the page itself is never changed. Returns the number of matches
 * and the index shown. */
export function findInPage(doc: Document, text: string, current: number): { count: number; index: number } {
  const win = doc.defaultView;
  // Older engines may have no `CSS` object at all; then there is no
  // Custom Highlight API and the search shows no matches.
  const highlights = win && win.CSS && "highlights" in win.CSS ? win.CSS.highlights : null;
  if (!win || !highlights) return { count: 0, index: -1 };
  highlights.delete("adp-find");
  highlights.delete("adp-find-current");
  if (text === "") return { count: 0, index: -1 };
  const needle = text.toLowerCase();
  const ranges: Range[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const original = node.nodeValue ?? "";
    const value = original.toLowerCase();
    if (value.length !== original.length) continue;
    let at = value.indexOf(needle);
    while (at !== -1) {
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      at = value.indexOf(needle, at + needle.length);
    }
  }
  if (ranges.length === 0) return { count: 0, index: -1 };
  const index = ((current % ranges.length) + ranges.length) % ranges.length;
  highlights.set("adp-find", new win.Highlight(...ranges));
  highlights.set("adp-find-current", new win.Highlight(ranges[index]));
  ranges[index].startContainer.parentElement?.scrollIntoView({ block: "center" });
  return { count: ranges.length, index };
}
