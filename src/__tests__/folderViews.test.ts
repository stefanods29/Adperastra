import { describe, expect, it } from "vitest";
import {
  FOLDER_VIEWS_CLEARED_EVENT,
  clearFolderViews,
  folderViewKey,
  folderViewMap,
} from "../services/folderViews";

describe("folder views", () => {
  it("folderViewKey ignores case, the long-path prefix and a trailing backslash", () => {
    expect(folderViewKey("\\\\?\\C:\\Photos\\")).toBe("c:\\photos");
    expect(folderViewKey("C:\\Photos")).toBe("c:\\photos");
    expect(folderViewKey("C:\\")).toBe("c:");
  });

  it("folderViewMap keeps the first entry per folder and known views only", () => {
    const map = folderViewMap([
      { path: "C:\\A", mode: "tiles", used_unix: 9 },
      { path: "c:\\a\\", mode: "list", used_unix: 5 },
      { path: "C:\\B", mode: "giant", used_unix: 1 },
    ]);
    expect([...map.entries()]).toEqual([["c:\\a", "tiles"]]);
  });

  it("clearFolderViews tells open Explorers to forget", async () => {
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    window.addEventListener(FOLDER_VIEWS_CLEARED_EVENT, listener);
    await clearFolderViews();
    expect(calls).toBe(1);
    window.removeEventListener(FOLDER_VIEWS_CLEARED_EVENT, listener);
  });
});
