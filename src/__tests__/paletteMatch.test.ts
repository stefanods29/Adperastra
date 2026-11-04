import { describe, expect, it } from "vitest";
import "../i18n";
import { matchPalette, paletteLabel } from "../palette/matchPalette";
import { PaletteRegistry, validatePaletteEntry } from "../palette/PaletteRegistry";
import { descriptorPaletteProvider, helpPaletteProvider } from "../palette/paletteEntries";
import type { PaletteEntry } from "../palette/types";
const entry = (id: string, label: string, extra: Partial<PaletteEntry> = {}): PaletteEntry => ({ id: `command:${id}`, kind: "command", english_label: label, keywords: [], enabled: true, target_id: id, ...extra });
describe("palette matching", () => {
  it("café matches cafe", () => expect(matchPalette("cafe", [entry("a", "café")], [], "en")).toHaveLength(1));
  it("exact start outranks subsequence", () => expect(matchPalette("open", [entry("a", "Other personal entry name"), entry("b", "Open folder")], [], "en")[0].entry.id).toBe("command:b"));
  it("all tokens required", () => expect(matchPalette("open missing", [entry("a", "Open folder")], [], "en")).toHaveLength(0));
  it("ties stable ID", () => expect(matchPalette("open", [entry("b", "Open"), entry("a", "Open")], [], "en").map((match) => match.entry.id)).toEqual(["command:a", "command:b"]));
  it("51 results returns 50", () => expect(matchPalette("open", Array.from({ length: 51 }, (_, i) => entry(String(i), "Open")), [], "en")).toHaveLength(50));
  it("English matches Spanish UI", () => expect(matchPalette("Name", [entry("a", "Name", { label_key: "explorer.columnName" })], [], "es")).toHaveLength(1));
  it("Spanish matches Spanish UI", () => expect(matchPalette("Nombre", [entry("a", "Name", { label_key: "explorer.columnName" })], [], "es")).toHaveLength(1));
  it("runtime help titles render and match in the current language", () => {
    const help = entry("help", "File details", { id: "help:file-details", kind: "help", runtime_label: "Detalles de archivos" });
    expect(paletteLabel(help, "es")).toBe("Detalles de archivos");
    expect(matchPalette("Detalles", [help], [], "es")).toHaveLength(1);
    expect(matchPalette("File details", [help], [], "es")).toHaveLength(1);
  });
  it("scalar highlighting preserves astral and accented offsets", () => expect(matchPalette("cafe", [entry("a", "🪐 café")], [], "en")[0].matched_ranges).toEqual([[2, 6]]));
  it("empty query shows 20 MRU then 20 locations", () => {
    const commands = Array.from({ length: 21 }, (_, i) => entry(String(i), "Open"));
    const locations = Array.from({ length: 25 }, (_, i) => entry(String(i), "Folder", { id: `folder:${i}`, kind: "folder" }));
    const found = matchPalette("", [...commands, ...locations], commands.map((item) => item.id), "en");
    expect(found).toHaveLength(40); expect(found[19].entry.kind).toBe("command"); expect(found[20].entry.kind).toBe("folder");
  });
  it("257 scalar query rejected", () => expect(() => matchPalette("🪐".repeat(257), [], [], "en")).toThrow("palette.invalid"));
  it("later word start beats an earlier in-word occurrence", () => expect(matchPalette("open", [entry("a", "reopen open")], [], "en")[0].score).toBe(120));
  it("keyword start is not a label-start bonus", () => expect(matchPalette("open", [entry("a", "Action", { keywords: ["open"] })], [], "en")[0].score).toBe(120));
  it("shortest subsequence span wins", () => expect(matchPalette("ab", [entry("a", "axxxxxayb")], [], "en")[0].score).toBe(39));
  it("duplicate catalog IDs rejected", async () => {
    const registry = new PaletteRegistry();
    registry.registerProvider("a", { snapshot: async () => [entry("a", "Open"), entry("a", "Open")], dispatch: async () => undefined });
    await expect(registry.collect()).rejects.toThrow("palette.invalid");
  });
  it("long location text stays inside palette bounds", async () => {
    const provider = descriptorPaletteProvider("folder", async () => [
      { id: `C:\\${"a".repeat(2000)}`, title: "x".repeat(600), description: "d".repeat(2000) },
    ]);
    const entries = await provider.snapshot();
    expect(entries).toHaveLength(1);
    expect(() => entries.forEach(validatePaletteEntry)).not.toThrow();
    expect([...entries[0].english_label]).toHaveLength(512);
    expect([...entries[0].description!]).toHaveLength(512);
  });
  it("canonical location IDs keep the first descriptor", async () => {
    const provider = descriptorPaletteProvider("folder", async () => [
      { id: "C:\\Folder", title: "First" },
      { id: "c:\\folder\\", title: "Second" },
    ]);
    const entries = await provider.snapshot();
    expect(entries.map((item) => [item.id, item.english_label])).toEqual([["folder:c:\\folder", "First"]]);
  });
  it("help entries accept the registered catalog's optional titles", async () => {
    const provider = helpPaletteProvider(async () => [
      { slug: "folder-columns", title: "Columnas de carpetas", english_title: "Folder columns" },
      { slug: "getting-started" },
    ]);
    const entries = await provider.snapshot();
    expect(entries.map((item) => [item.id, paletteLabel(item, "es"), item.english_label]))
      .toEqual([["help:folder-columns", "Columnas de carpetas", "Folder columns"]]);
  });
  it("no AI entry kind", async () => {
    const registry = new PaletteRegistry();
    registry.registerProvider("a", { snapshot: async () => [entry("a", "Open", { kind: "ai" as PaletteEntry["kind"] })], dispatch: async () => undefined });
    await expect(registry.collect()).rejects.toThrow("palette.invalid");
  });
});
