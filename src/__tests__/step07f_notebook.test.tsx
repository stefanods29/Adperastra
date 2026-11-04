import { describe, expect, it } from "vitest";
import { notebookPageIsInert } from "../handlers/notebook/NotebookView";
import type { ExtraViewPage } from "../services/extraViews";

describe("notebook display", () => {
  it("notebook code is inert data, not a callback or kernel", () => {
    const page: ExtraViewPage = {
      session_id: "6f2e6a8e-4a4e-4f56-8f0b-2f3f6f4f7a10",
      kind: "notebook",
      payload: {
        kind: "notebook",
        cells: [
          {
            index: 0,
            kind: "code",
            source: "print('hi')",
            language: "python",
            outputs: [],
            next_source_offset: null,
          },
        ],
      },
      next_cursor: null,
      complete: true,
      partial: false,
    };
    expect(notebookPageIsInert(page)).toBe(true);
    expect(typeof page.payload).toBe("object");
    expect("run" in page.payload).toBe(false);
  });
});
