import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { readOnlyExtensions, runFind } from "../handlers/text/editorSetup";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function makeView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: readOnlyExtensions({ phrases: {} }) }) });
  return view;
}

const selected = (v: EditorView) => [v.state.selection.main.from, v.state.selection.main.to];

describe("find in the text viewer", () => {
  it("selects the first match while typing and moves with next and previous", () => {
    const v = makeView("one two One three one");
    runFind(v, "one", "here");
    expect(selected(v)).toEqual([0, 3]);
    runFind(v, "one", "next");
    expect(selected(v)).toEqual([8, 11]);
    runFind(v, "one", "next");
    expect(selected(v)).toEqual([18, 21]);
    runFind(v, "one", "previous");
    expect(selected(v)).toEqual([8, 11]);
  });

  it("keeps the current match when the search text grows", () => {
    const v = makeView("tea team teams");
    runFind(v, "tea", "here");
    runFind(v, "tea", "next");
    expect(selected(v)).toEqual([4, 7]);
    runFind(v, "team", "here");
    expect(selected(v)).toEqual([4, 8]);
  });

  it("is read-only for the user", () => {
    const v = makeView("abc");
    expect(v.state.readOnly).toBe(true);
    expect(v.contentDOM.getAttribute("aria-readonly")).toBe("true");
  });
});
