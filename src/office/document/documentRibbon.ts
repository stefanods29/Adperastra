import { createContext, createElement, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RibbonControl, RibbonDef, RibbonGroup, RibbonTab } from "../../ribbon/types";

export type DocumentControlId = "document.font" | "document.size" | "document.style" |
  "document.paragraph" | "document.page" | "document.zoom";

/** The editor supplies controlled controls from its live formatting query. */
export const DocumentRibbonControls = createContext<Partial<Record<DocumentControlId, ReactNode>>>({});

function Slot({ id }: { id: DocumentControlId }) {
  const controls = useContext(DocumentRibbonControls);
  const { t } = useTranslation();
  return controls[id] ?? createElement("span", { "aria-disabled": true }, t("office.unsupported"));
}
const custom = (id: DocumentControlId): RibbonControl => ({ type: "custom", id, render: () => createElement(Slot, { id }) });
const toggleIds = new Set(["bold", "italic", "underline", "strike", "subscript", "superscript", "bullets", "numbering",
  "trackChanges", "navigation", "ruler", "comments"]);
function group(id: string, commands: string[], controls: RibbonControl[] = []): RibbonGroup {
  return {
    id, labelKey: `officeDoc.group.${id}`,
    controls: [...commands.map((suffix): RibbonControl => ({
      type: toggleIds.has(suffix) ? "toggle" : "button", command: `doc.${suffix}`, showLabel: true,
    })), ...controls],
  };
}
function tab(suffix: string, keyTip: string, groups: RibbonGroup[]): RibbonTab {
  return { id: `doc.${suffix}`, labelKey: `officeDoc.tab.${suffix}`, keyTip, groups };
}

/** Data only. Unregistered actions are not executable; integration must register the full matrix. */
export function documentRibbon(): RibbonDef {
  return { tabs: [
    tab("file", "F", [group("backstage", ["new", "open", "save", "saveCopy", "exportPdf", "print", "properties", "close"])]),
    tab("home", "H", [
      group("clipboard", ["paste", "cut", "copy"]),
      group("font", ["font", "fontSize", "bold", "italic", "underline", "strike", "subscript", "superscript", "textColor", "highlight"],
        [custom("document.font"), custom("document.size")]),
      group("paragraph", ["alignLeft", "alignCenter", "alignRight", "justify", "bullets", "numbering", "indent", "outdent", "spacing"],
        [custom("document.paragraph")]),
      group("styles", ["style", "createStyle"], [custom("document.style")]),
      group("editing", ["find", "replace", "selectAll"]),
      { id: "voice", labelKey: "officeDoc.group.voice", controls: [
        { type: "button", command: "document.dictation", showLabel: true },
        { type: "button", command: "document.stopDictation", showLabel: true },
      ] },
    ]),
    tab("insert", "I", [group("pages", ["pageBreak"]), group("tables", ["table"]),
      group("illustrations", ["image", "link"]), group("fields", ["pageNumber", "pageCount", "date"])]),
    tab("design", "D", [group("documentStyle", ["styles", "pageColor", "compatibility"])]),
    tab("layout", "L", [group("pageSetup", ["pageSetup", "margins", "orientation", "columns"], [custom("document.page")]),
      group("paragraphLayout", ["paragraph"])]),
    tab("references", "R", [group("contents", ["tableOfContents", "updateContents"]),
      group("notes", ["footnote"]), group("citations", ["citation", "bibliography"])]),
    tab("review", "V", [group("spelling", ["spelling"]), group("comments", ["addComment", "reply", "resolve", "deleteComment"]),
      group("changes", ["trackChanges", "acceptChange", "rejectChange", "acceptAll", "rejectAll"]),
      {
        id: "doc.ai", labelKey: "documentAi.title", controls: [
          { type: "button", command: "doc.aiRewrite", showLabel: true },
          { type: "button", command: "doc.aiShorten", showLabel: true },
          { type: "button", command: "doc.aiExpand", showLabel: true },
          { type: "button", command: "doc.aiSimplify", showLabel: true },
          { type: "button", command: "doc.aiGrammar", showLabel: true },
          { type: "button", command: "doc.aiTone", showLabel: true },
          { type: "button", command: "doc.aiTranslate", showLabel: true },
          { type: "button", command: "doc.aiAltText", showLabel: true },
          { type: "button", command: "doc.aiDraft", showLabel: true },
          { type: "button", command: "doc.aiContinue", showLabel: true },
        ],
      }]),
    tab("view", "W", [group("show", ["navigation", "ruler", "comments"]),
      group("zoom", ["zoom", "fitPage", "fitWidth"], [custom("document.zoom")]), group("mode", ["editingMode"])]),
    tab("help", "Y", [group("help", ["help", "limits", "shortcuts"])]),
  ] };
}
