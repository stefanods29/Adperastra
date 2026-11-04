import DOMPurify from "dompurify";
import { useMemo } from "react";
import type { CacheLease } from "../services/cache";
import { fileUrl } from "../services/files";

/** The only place untrusted saved markup is displayed (Step 07f, R-SEC-4).
 * It is cleaned with DOMPurify, every remote or unknown URL is removed, only
 * a current cache lease may become an image source, and the result lives in
 * an iframe with an empty sandbox: no scripts, no same origin, no links. */
export interface SafeMarkupFrameProps {
  html: string;
  resources: readonly CacheLease[];
  title: string;
  className?: string;
  /** Reading settings for book pages; optional for all other viewers. */
  fontPx?: number;
  readingTheme?: "app" | "light" | "dark";
  direction?: "ltr" | "rtl";
}

const ALLOWED_TAGS = [
  "p", "div", "span", "br", "hr", "pre", "code", "em", "strong", "b", "i", "u", "s",
  "sub", "sup", "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "img", "h1", "h2", "h3", "h4", "h5", "h6", "dl", "dt",
  "dd",
];

const FORBIDDEN_TAGS = [
  "script", "style", "iframe", "object", "embed", "form", "input", "button", "link",
  "meta", "base", "video", "audio", "source", "svg", "math", "template", "noscript",
  "textarea", "select", "option", "a",
];

/** Elements whose whole text must disappear; `a` is not here because its
 * label is useful text and the tag itself is already removed. */
const FORBIDDEN_CONTENTS = [
  "script", "style", "iframe", "object", "embed", "form", "video", "audio", "source",
  "svg", "math", "template", "noscript", "textarea", "select", "option",
];

interface Colors {
  text: string;
  muted: string;
  background: string;
  border: string;
  code: string;
  link: string;
}

function readTokens(element: Element): Colors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    text: read("--adp-color-text-primary", "CanvasText"),
    muted: read("--adp-color-text-secondary", "GrayText"),
    background: read("--adp-color-surface-window", "Canvas"),
    border: read("--adp-color-border-subtle", "ButtonBorder"),
    code: read("--adp-color-surface-pane", "Canvas"),
    link: read("--adp-accent-explorer", "LinkText"),
  };
}

function themeColors(theme: "app" | "light" | "dark"): Colors {
  if (theme === "app") return readTokens(document.documentElement);
  const probe = document.createElement("div");
  probe.setAttribute("data-theme-preview", theme);
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  try {
    return readTokens(probe);
  } finally {
    probe.remove();
  }
}

function buildDocument(
  sanitized: string,
  title: string,
  colors: Colors,
  fontPx: number,
  direction: "ltr" | "rtl",
): string {
  const safeTitle = title.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html dir="${direction}">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: ${colors.background}; color: ${colors.text}; }
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: ${fontPx}px; line-height: 1.6; }
  .adp-safe-page { padding: 16px; max-width: 100%; overflow-wrap: anywhere; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.3; margin: 0.8em 0 0.4em; }
  p { margin: 0 0 0.8em; }
  pre, code { background: ${colors.code}; font-family: "Cascadia Mono", Consolas, monospace; font-size: 0.9em; }
  pre { padding: 8px; overflow: auto; white-space: pre-wrap; }
  table { border-collapse: collapse; max-width: 100%; }
  th, td { border: 1px solid ${colors.border}; padding: 4px 6px; text-align: start; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  blockquote { margin: 0 0 0.8em; padding-inline-start: 12px; border-inline-start: 3px solid ${colors.border}; color: ${colors.muted}; }
  a { color: ${colors.link}; }
</style>
</head>
<body><div class="adp-safe-page">${sanitized}</div></body>
</html>`;
}

/** Clean one fragment and replace only exact current lease URLs. */
export function sanitizeMarkup(
  html: string,
  resources: readonly CacheLease[],
): string {
  const allowed = new Map<string, string>();
  for (const lease of resources) {
    allowed.set(lease.name, fileUrl(lease.token, lease.name));
  }
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["src", "alt", "title", "colspan", "rowspan"],
    FORBID_TAGS: FORBIDDEN_TAGS,
    // Script/style/form text must not become visible content either.
    FORBID_CONTENTS: FORBIDDEN_CONTENTS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
    // Only the inert book token or a local leased protocol URL survives.
    ALLOWED_URI_REGEXP:
      /^(?:(?:book-resource:)|(?:http:\/\/adpfile\.localhost\/)|(?:data:image\/(?:png|jpeg|gif|webp);base64,))/i,
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  for (const image of [...doc.body.querySelectorAll("img")]) {
    const source = image.getAttribute("src") ?? "";
    if (source.startsWith("book-resource:")) {
      const id = source.slice("book-resource:".length);
      const url = allowed.get(id);
      if (url) image.setAttribute("src", url);
      else image.removeAttribute("src");
    } else if (![...allowed.values()].includes(source)) {
      image.removeAttribute("src");
    }
    image.removeAttribute("srcset");
    image.removeAttribute("style");
  }
  for (const node of [...doc.body.querySelectorAll("[href],[style],[srcset]")]) {
    node.removeAttribute("href");
    node.removeAttribute("style");
    node.removeAttribute("srcset");
  }
  return doc.body.innerHTML;
}

export default function SafeMarkupFrame({
  html,
  resources,
  title,
  className,
  fontPx = 18,
  readingTheme = "app",
  direction = "ltr",
}: SafeMarkupFrameProps) {
  const clean = useMemo(() => sanitizeMarkup(html, resources), [html, resources]);
  const page = useMemo(() => {
    const size = Math.min(32, Math.max(12, Math.round(fontPx)));
    return buildDocument(clean, title, themeColors(readingTheme), size, direction);
  }, [clean, title, fontPx, readingTheme, direction]);
  return (
    <iframe
      className={className ?? "adp-safe-markup"}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={page}
      title={title}
    />
  );
}
