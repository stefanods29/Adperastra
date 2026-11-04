import type { RibbonControl, RibbonDef, RibbonGroup, RibbonTab } from "../../ribbon/types";

/** The PowerPoint-style ribbon is data, like every other ribbon in the app.
 * Ten tabs are fixed by Step 22a: File, Home, Insert, Design, Transitions,
 * Animations, Slide Show, Review, View, Help. Key tips stay F/H/I/D/T/A/S/R/V/Y.
 * A control is disabled by its command's capability/selection rules; this
 * module never decides whether an engine can perform an action. */

const TOGGLES = new Set([
  "bold", "italic", "underline", "advanceClick", "snap", "slidesPane", "notes",
]);

function group(id: string, suffix: string, commands: string[]): RibbonGroup {
  return {
    id: `deck.${suffix}`,
    labelKey: `officeDeck.group.${id}`,
    controls: commands.map((command): RibbonControl => ({
      type: TOGGLES.has(command) ? "toggle" : "button",
      command: `deck.${command}`,
      showLabel: true,
    })),
  };
}

function tab(suffix: string, keyTip: string, groups: RibbonGroup[]): RibbonTab {
  return { id: `deck.${suffix}`, labelKey: `officeDeck.tab.${suffix}`, keyTip, groups };
}

export function deckRibbon(): RibbonDef {
  return {
    tabs: [
      tab("file", "F", [
        group("fileActions", "fileActions", [
          "new", "open", "save", "saveCopy", "exportPdf", "exportImages", "print", "properties", "close",
        ]),
      ]),
      tab("home", "H", [
        group("clipboard", "clipboard", ["paste", "cut", "copy"]),
        group("slides", "slides", ["newSlide", "duplicateSlide", "deleteSlide", "layout", "resetLayout"]),
        group("font", "font", ["font", "size", "bold", "italic", "underline", "textColor"]),
        group("paragraph", "paragraph", ["alignLeft", "alignCenter", "alignRight", "bullets", "numbering"]),
        group("drawing", "drawing", ["arrange", "group", "ungroup", "bringFront", "sendBack"]),
      ]),
      tab("insert", "I", [
        group("text", "text", ["textBox"]),
        group("illustrations", "illustrations", ["picture", "shape"]),
        group("data", "data", ["table", "chart"]),
      ]),
      tab("design", "D", [
        group("themes", "themes", ["theme", "master", "styleLibrary"]),
        group("pageSetup", "pageSetup", ["slideSize"]),
      ]),
      tab("transitions", "T", [
        group("transition", "transition", ["transition"]),
        group("timing", "timing", ["transitionDuration", "advanceClick", "advanceAfter", "applyTransitionAll"]),
      ]),
      tab("animations", "A", [
        group("animation", "animation", ["animation", "animationPane"]),
        group("animationTiming", "animationTiming", [
          "animationStart", "animationDuration", "animationDelay", "removeAnimation",
        ]),
      ]),
      tab("slideShow", "S", [
        group("start", "start", ["fromBeginning", "fromCurrent", "presenterView"]),
        group("monitors", "monitors", ["chooseDisplay", "hideSlide"]),
      ]),
      tab("review", "R", [
        group("comments", "comments", ["comment", "reply", "resolve", "deleteComment"]),
        group("compatibility", "compatibility", ["compatibility"]),
      ]),
      tab("view", "V", [
        group("presentationViews", "presentationViews", ["normal", "slideSorter", "notes", "masterView"]),
        group("show", "show", ["slidesPane", "snap"]),
        group("zoom", "zoom", ["zoom", "fit"]),
      ]),
      tab("help", "Y", [
        group("help", "help", ["help", "limits", "shortcuts"]),
      ]),
    ],
  };
}
