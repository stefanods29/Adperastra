import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** CodeMirror setup shared by the text and Markdown viewers (Step 04b) and
 * the text editor (Step 06a). Colors come from our tokens. */

export const adpTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--adp-color-text-primary)",
    backgroundColor: "var(--adp-color-surface-window)",
    fontSize: "calc(13px * var(--adp-text-zoom, 1))",
  },
  ".cm-scroller": { fontFamily: '"Cascadia Mono", Consolas, "Courier New", "MS Gothic", NSimSun, GulimChe, monospace', lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--adp-color-text-primary)" },
  ".cm-gutters": {
    backgroundColor: "var(--adp-color-surface-pane)",
    color: "var(--adp-color-text-tertiary)",
    borderRight: "1px solid var(--adp-color-border-panel)",
  },
  ".cm-activeLine": { backgroundColor: "var(--adp-color-surface-pane)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--adp-color-surface-selected)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--adp-color-surface-selected-row)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--adp-syntax-match)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--adp-syntax-match-selected)" },
  // Our own search box drives the search; CodeMirror's panel stays hidden.
  ".cm-panels": { display: "none" },
});

export const adpHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--adp-syntax-keyword)" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--adp-syntax-string)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--adp-syntax-number)" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--adp-syntax-comment)", fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--adp-syntax-function)" },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--adp-syntax-type)" },
    { tag: [tags.tagName, tags.angleBracket], color: "var(--adp-syntax-tag)" },
    { tag: tags.attributeName, color: "var(--adp-syntax-attribute)" },
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--adp-syntax-property)" },
    { tag: tags.heading, color: "var(--adp-syntax-keyword)", fontWeight: "600" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "600" },
    { tag: [tags.link, tags.url], color: "var(--adp-syntax-function)", textDecoration: "underline" },
    { tag: tags.invalid, color: "var(--adp-syntax-invalid)" },
  ]),
);

/** CodeMirror's search, with its panel replaced by an empty one: the file
 * tab's search box (and its translated texts) drives it. */
export const hiddenSearch = search({
  createPanel: () => {
    const dom = document.createElement("div");
    return { dom, top: true };
  },
});

/** Extensions for a read-only view of text. The text cannot change, but
 * the caret, selection, Ctrl+A and Ctrl+C work as usual. */
export function readOnlyExtensions(options: { phrases: Record<string, string> }): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorState.phrases.of(options.phrases),
    keymap.of(defaultKeymap),
    highlightActiveLine(),
    hiddenSearch,
    adpTheme,
    adpHighlight,
  ];
}

/** Extensions for a text the user can change (Step 06a): CodeMirror's own
 * keys plus undo and redo, and IME setup for typing. Tab is not bound, so
 * it leaves the editor. */
export function editableExtensions(options: { phrases: Record<string, string> }): Extension[] {
  return [
    EditorState.phrases.of(options.phrases),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    highlightActiveLine(),
    hiddenSearch,
    adpTheme,
    adpHighlight,
    EditorView.contentAttributes.of({ autocapitalize: "off", autocorrect: "off" }),
  ];
}

/** The webview's own spelling checker (Step 06a), in the app's language. */
export function spellcheckAttributes(on: boolean, lang: string): Extension {
  return EditorView.contentAttributes.of({ spellcheck: on ? "true" : "false", lang });
}

export { lineNumbers };

/** Highlight the matches of `text` and select one: "here" selects the first
 * match at or after the start of the selection (used while typing), "next"
 * and "previous" move from the current match. An empty text clears the
 * search. Plain text; `options` narrows the match. */
export function runFind(
  view: EditorView,
  text: string,
  move: "here" | "next" | "previous",
  options: { caseSensitive: boolean; wholeWord: boolean } = { caseSensitive: false, wholeWord: false },
): void {
  if (text === "") {
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    return;
  }
  if (!searchPanelOpen(view.state)) openSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(queryFor(text, options)) });
  if (move === "here") {
    view.dispatch({ selection: { anchor: view.state.selection.main.from } });
    findNext(view);
  } else if (move === "next") {
    findNext(view);
  } else {
    findPrevious(view);
  }
}

function queryFor(
  search: string,
  options: { caseSensitive: boolean; wholeWord: boolean },
  replace?: string,
): SearchQuery {
  return new SearchQuery({
    search,
    replace,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    literal: true,
  });
}

/** Replace one match (the selected one, or the next) or every match. One
 * undo step for a Replace all. Nothing happens with an empty search. */
export function runReplace(
  view: EditorView,
  search: string,
  replace: string,
  all: boolean,
  options: { caseSensitive: boolean; wholeWord: boolean } = { caseSensitive: false, wholeWord: false },
): void {
  if (search === "") return;
  if (!searchPanelOpen(view.state)) openSearchPanel(view);
  const query = queryFor(search, options, replace);
  view.dispatch({ effects: setSearchQuery.of(query) });
  if (all) {
    replaceAll(view);
    return;
  }
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const same = options.caseSensitive ? selected === search : selected.toLowerCase() === search.toLowerCase();
  if (selection.empty || !same) {
    const first = query.getCursor(view.state, selection.from).next();
    if (first.done) return;
    view.dispatch({ selection: { anchor: first.value.from, head: first.value.to } });
  }
  replaceNext(view);
}
