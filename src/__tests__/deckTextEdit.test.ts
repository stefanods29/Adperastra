import { expect, it } from "vitest";
import { deckTextOperations } from "../office/deck/deckTextEdit";

const target = {
  text: "A🐴B",
  span: {
    anchor: { block_id: "paragraph", offset_utf16: 8 },
    focus: { block_id: "paragraph", offset_utf16: 12 },
    revision: 5,
  },
};

it("replaces only the changed text, using the paragraph ID and UTF-16 offsets", () => {
  expect(deckTextOperations("slide", "shape", target, "A🐎B", 5)).toEqual([
    {
      kind: "delete_text", slide_id: "slide", shape_id: "shape",
      span: {
        anchor: { block_id: "paragraph", offset_utf16: 9 },
        focus: { block_id: "paragraph", offset_utf16: 11 },
        revision: 5,
      },
    },
    {
      kind: "insert_text", slide_id: "slide", shape_id: "shape",
      position: { block_id: "paragraph", offset_utf16: 9 }, text: "🐎",
    },
  ]);
});

it("refuses a draft whose text range belongs to another revision", () => {
  expect(() => deckTextOperations("slide", "shape", target, "Updated", 6))
    .toThrow("office_edit.changed");
});
