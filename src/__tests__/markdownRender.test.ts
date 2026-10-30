import { describe, expect, it } from "vitest";
import { findInPage, renderMarkdownPage, type DocColors } from "../handlers/markdown/render";

const colors: DocColors = {
  text: "#202020",
  muted: "#616161",
  background: "#ffffff",
  border: "#e0e0e0",
  link: "#0067c0",
  codeBackground: "#fafafa",
  mark: "rgba(255, 223, 93, 0.5)",
  markCurrent: "rgba(255, 159, 67, 0.6)",
};

describe("Markdown rendering", () => {
  it("renders headings, lists, code and tables", () => {
    const page = renderMarkdownPage("# Title\n\n- one\n- two\n\n`code`\n\n| a | b |\n|---|---|\n| 1 | 2 |", colors, 1, "en");
    expect(page).toContain("<h1>Title</h1>");
    expect(page).toContain("<li>one</li>");
    expect(page).toContain("<code>code</code>");
    expect(page).toContain("<table>");
  });

  it("never lets HTML or scripts from the file through", () => {
    const page = renderMarkdownPage('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))', colors, 1, "en");
    // The HTML is shown as text, never as tags.
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;");
    expect(page).not.toMatch(/<img[^>]*onerror/);
    expect(page).not.toContain('href="javascript:');
  });

  it("refuses colors that could break out of the style sheet", () => {
    const page = renderMarkdownPage("x", { ...colors, text: "red;}</style><script>bad()</script>" }, 1, "en");
    expect(page).not.toContain("<script>bad()");
    expect(page).toContain("color: #202020");
  });

  it("scales the font with the zoom", () => {
    expect(renderMarkdownPage("x", colors, 2, "es")).toContain("font: 30px/1.6");
  });

  it("finds nothing when the engine has no Custom Highlight API", () => {
    const host = document.createElement("div");
    host.textContent = "hello";
    document.body.appendChild(host);
    expect(findInPage(document, "hello", 0)).toEqual({ count: 0, index: -1 });
    host.remove();
  });
});
