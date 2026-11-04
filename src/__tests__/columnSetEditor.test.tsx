import "../i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ColumnSetEditor } from "../folders/ColumnSetEditor";
import type { ColumnSet } from "../services/folderCustomization";
import { defaultColumnSetColumns } from "../folders/columnSetSuggestion";

const value: ColumnSet = {
  id: "12345678-1234-4234-8234-123456789abc", name: "Photos", version: 1,
  columns: [{ id: "name", width: 320 }, { id: "modified", width: 180 }],
};
describe("ColumnSetEditor", () => {
  it("Namecannotremove", async () => {
    const node = document.createElement("div");
    const root = createRoot(node);
    const onChange = vi.fn();
    try {
      await act(async () => root.render(<ColumnSetEditor value={value} onChange={onChange} />));
      const first = node.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(first.checked).toBe(true);
      expect(first.disabled).toBe(true);
      await act(async () => first.click());
      expect(onChange).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
  it("provides exact manual presets using canonical column IDs and widths", () => {
    expect(defaultColumnSetColumns("photos").map((column) => column.id)).toEqual(["name", "date_taken", "dimensions", "camera_model"]);
    expect(defaultColumnSetColumns("music").map((column) => column.id)).toEqual(["name", "audio_title", "audio_artist", "audio_album", "duration_ms"]);
    expect(defaultColumnSetColumns("documents").map((column) => column.id)).toEqual(["name", "author", "page_count", "modified"]);
    expect(defaultColumnSetColumns("music").slice(1).every((column) => column.width === 140)).toBe(true);
  });
});
