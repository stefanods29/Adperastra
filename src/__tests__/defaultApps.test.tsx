import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { createHandlerRegistry } from "../handlers";
import { planOpen } from "../handlers/openPipeline";
import { fileDetect, type FileTypeInfo } from "../services/files";
import { defaultSettings, type OpenSettings } from "../services/settings";
import OpeningFilesSettings, { defaultAppGroups, withChoice } from "../views/settings/OpeningFilesSettings";

vi.mock("../services/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/files")>()),
  fileDetect: vi.fn(),
}));

const txt: FileTypeInfo = {
  path: "C:\\notes.txt",
  name: "notes.txt",
  ext: "txt",
  mime: "text/plain",
  size: 10,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("default apps", () => {
  it("lists every viewer's file types once, Markdown before text, without the hex viewer", () => {
    const groups = defaultAppGroups();
    const all = groups.flatMap((group) => group.extensions);
    expect(new Set(all).size).toBe(all.length);
    expect(groups.map((group) => group.id)).toEqual([
      "image",
      "media",
      "font",
      "markdown",
      "table",
      "json",
      "text",
      "archive",
    ]);
    expect(groups.find((group) => group.id === "markdown")?.extensions).toContain("md");
    expect(groups.find((group) => group.id === "text")?.extensions).not.toContain("md");
  });

  it("stores only Windows choices", () => {
    expect(withChoice({ txt: "windows" }, ["txt", "log"], "builtin")).toEqual({});
    expect(withChoice({}, ["mp3", "wav"], "windows")).toEqual({ mp3: "windows", wav: "windows" });
  });

  it("opens a type in its Windows app when the user chose that", async () => {
    vi.mocked(fileDetect).mockResolvedValue(txt);
    const registry = createHandlerRegistry();
    expect((await planOpen("C:\\notes.txt", registry)).kind).toBe("tab");
    expect((await planOpen("C:\\notes.txt", registry, { txt: "windows" })).kind).toBe("windows");
    expect((await planOpen("C:\\notes.txt", registry, { md: "windows" })).kind).toBe("tab");
  });

  it("changes a whole group and filters by extension", async () => {
    const onChange = vi.fn();
    const open: OpenSettings = defaultSettings().open;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<OpeningFilesSettings open={open} onChange={onChange} onOpenHelp={() => undefined} />));
    const groupSelects = container.querySelectorAll<HTMLSelectElement>(".adp-defaultapps-head select");
    expect(groupSelects).toHaveLength(8);
    await act(async () => {
      groupSelects[1].value = "windows";
      groupSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    const next = onChange.mock.calls[0][0] as OpenSettings;
    expect(next.open_with.mp4).toBe("windows");
    expect(next.open_with.mp3).toBe("windows");
    expect(next.protected_view).toBe(true);
    const input = container.querySelector<HTMLInputElement>(".adp-defaultapps-search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, ".txt");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const items = [...container.querySelectorAll(".adp-defaultapps-ext")].map((element) => element.textContent);
    expect(items).toContain(".txt");
    expect(items.every((item) => item?.includes("txt"))).toBe(true);
  });
});
