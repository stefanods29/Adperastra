import { describe, expect, it, vi } from "vitest";
import { FolderDecorationResolver } from "../folders/FolderDecorationResolver";
import type { FolderDecoration } from "../services/folderCustomization";

const plain = (): FolderDecoration => ({ icon: { kind: "default" }, warning_codes: [] });
const key = { volume_id: "12345678", file_id: "0000000000000001", path_key: "c:\\a", stable: true };

describe("FolderDecorationResolver", () => {
  it("stalegenerationignored", async () => {
    let finish!: (value: FolderDecoration[]) => void;
    const read = vi.fn(() => new Promise<FolderDecoration[]>((resolve) => { finish = resolve; }));
    const resolver = new FolderDecorationResolver(read);
    const pending = resolver.resolve(["C:\\a"]);
    const assertion = expect(pending).rejects.toThrow("folder_custom.changed");
    resolver.invalidate([key]);
    finish([{ ...plain(), color: "#FF0000" }]);
    await assertion;
    read.mockResolvedValue([plain()]);
    expect(await resolver.resolve(["C:\\a"])).toEqual([plain()]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("preserves native exact override and inherited boundary decisions", async () => {
    const exact = { ...plain(), color: "#123456" };
    const inherited = { ...plain(), inherited_from: "C:\\parent" };
    const read = vi.fn(async () => [exact, inherited, plain()]);
    const resolver = new FolderDecorationResolver(read);
    expect(await resolver.resolve(["C:\\exact", "C:\\parent\\child", "C:\\junction\\child"]))
      .toEqual([exact, inherited, plain()]);
    // No JS path walk can cross the native reparse boundary.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("caches normalized paths while preserving order and duplicates", async () => {
    const first = { ...plain(), color: "#112233" };
    const read = vi.fn(async () => [first, plain()]);
    const resolver = new FolderDecorationResolver(read);
    await resolver.resolve(["C:\\A", "C:\\B"]);
    const result = await resolver.resolve(["c:\\b\\", "c:\\a", "C:\\A"]);
    expect(result).toEqual([plain(), first, first]);
    expect(read).toHaveBeenCalledTimes(1);
    result[1].color = "#FFFFFF";
    expect((await resolver.resolve(["C:\\A"]))[0].color).toBe("#112233");
  });

  it("expires after five minutes and releases cache on dispose", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => [plain()]);
      const resolver = new FolderDecorationResolver(read);
      await resolver.resolve(["C:\\a"]);
      vi.advanceTimersByTime(300_000);
      await resolver.resolve(["C:\\a"]);
      expect(read).toHaveBeenCalledTimes(2);
      resolver.dispose();
      await expect(resolver.resolve(["C:\\a"])).rejects.toThrow("folder_custom.changed");
    } finally { vi.useRealTimers(); }
  });

  it("bounds cache at 1000 entries", async () => {
    const read = vi.fn(async (paths: readonly string[]) => paths.map(plain));
    const resolver = new FolderDecorationResolver(read);
    for (let offset = 0; offset < 1000; offset += 250) {
      await resolver.resolve(Array.from({ length: 250 }, (_, index) => `C:\\${offset + index}`));
    }
    await resolver.resolve(["C:\\new"]);
    await resolver.resolve(["C:\\0"]);
    expect(read).toHaveBeenCalledTimes(6);
  });

  it("refuses mismatched response lengths instead of caching incomplete data", async () => {
    const resolver = new FolderDecorationResolver(async () => []);
    await expect(resolver.resolve(["C:\\a"])).rejects.toThrow("folder_custom.invalid");
  });
});
