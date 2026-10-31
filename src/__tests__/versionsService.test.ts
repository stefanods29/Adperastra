import { describe, expect, it } from "vitest";
import { versionsList, versionsSaveCopy, versionsStoreSize } from "../services/versions";

describe("versions service outside the app", () => {
  it("outside the app the history is empty", async () => {
    await expect(versionsList("C:\\notes\\a.txt")).resolves.toEqual({ versions: [], too_large: false });
    await expect(versionsStoreSize()).resolves.toBe(0);
    await expect(versionsSaveCopy(1, "Save a copy", "a.txt", "All files")).resolves.toBeNull();
  });
});
