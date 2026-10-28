import { describe, expect, it } from "vitest";
import { classifyClipboardText, pastedStamp } from "../services/paste";

describe("clipboard text classification", () => {
  it("plain sentences stay plain text", () => {
    expect(classifyClipboardText("Hello, this is a note.\nSecond line here.")).toBe("txt");
    expect(classifyClipboardText("one line only")).toBe("txt");
    expect(classifyClipboardText("C# is a language, and F# too")).toBe("txt");
  });

  it("Markdown signals win", () => {
    expect(classifyClipboardText("# Shopping\n\n- milk\n- eggs")).toBe("md");
    expect(classifyClipboardText("Intro\n\n```\ncode();\n```")).toBe("md");
    expect(classifyClipboardText("See [the docs](https://example.com) for details")).toBe("md");
    expect(classifyClipboardText("| A | B |\n|---|---|\n| 1 | 2 |")).toBe("md");
  });

  it("a regular table becomes CSV", () => {
    expect(classifyClipboardText("name,age,city\nAna,31,Lima\nLuis,28,Bogota")).toBe("csv");
    expect(classifyClipboardText("a;b;c\n1;2;3\n4;5;6")).toBe("csv");
    expect(classifyClipboardText("a\tb\tc\n1\t2\t3")).toBe("csv");
  });

  it("ragged or single-column lines are not CSV", () => {
    expect(classifyClipboardText("a,b\n1,2,3,4\nx")).toBe("txt");
    expect(classifyClipboardText("hello\nworld\nagain")).toBe("txt");
  });

  it("formats the pasted-name timestamp like Windows names", () => {
    expect(pastedStamp(new Date(2026, 9, 28, 14, 5))).toBe("2026-10-28 14-05");
    expect(pastedStamp(new Date(2026, 0, 3, 9, 7))).toBe("2026-01-03 09-07");
  });
});
