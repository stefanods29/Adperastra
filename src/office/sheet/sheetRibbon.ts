import type { RibbonDef, RibbonGroup } from "../../ribbon/types";

function group(id: string, commands: string[], labelKey = `officeSheet.group.${id}`): RibbonGroup {
  const toggles = new Set(["bold", "italic", "underline", "wrap", "formulaBar", "gridlines", "headings"]);
  return { id: `sheet.${id}`, labelKey, controls: commands.map((suffix) => ({
    type: toggles.has(suffix) ? "toggle" : "button", command: `sheet.${suffix}`, showLabel: true,
  })) };
}

/** Draw through the existing Ribbon + ViewerFrame/ToolbarDock, never a fixed top bar. */
export function sheetRibbon(): RibbonDef {
  return { tabs: [
    { id: "sheet.file", labelKey: "officeSheet.tab.file", keyTip: "F", groups: [group("backstage", ["new", "open", "save", "saveCopy", "exportPdf", "print", "properties", "close"])] },
    { id: "sheet.home", labelKey: "officeSheet.tab.home", keyTip: "H", groups: [
      group("clipboard", ["paste", "cut", "copy"]), group("font", ["font", "size", "bold", "italic", "underline", "fill", "textColor", "borders"]),
      group("alignment", ["alignLeft", "alignCenter", "alignRight", "wrap", "merge"]), group("number", ["numberFormat", "moreDecimals", "fewerDecimals"]),
      group("styles", ["conditional", "tableStyle", "cellStyle"]), group("cells", ["insertRows", "deleteRows", "insertColumns", "deleteColumns", "clear"]),
      group("editing", ["autoSum", "sort", "filter", "find", "replace"]),
    ] },
    { id: "sheet.insert", labelKey: "officeSheet.tab.insert", keyTip: "I", groups: [group("tables", ["pivot"]), group("charts", ["chart", "picture"])] },
    { id: "sheet.pageLayout", labelKey: "officeSheet.tab.pageLayout", keyTip: "P", groups: [group("pageSetup", ["printArea", "orientation", "pageSize", "margins", "scale"])] },
    { id: "sheet.formulas", labelKey: "officeSheet.tab.formulas", keyTip: "M", groups: [group("functions", ["insertFunction", "autoSum"]), group("names", ["nameRange", "manageNames"]), group("calculation", ["calculate", "calculationMode"])] },
    { id: "sheet.data", labelKey: "officeSheet.tab.data", keyTip: "D", groups: [group("sortFilter", ["sort", "filter", "clearFilter"]), group("validation", ["validation", "refreshPivot"])] },
    { id: "sheet.review", labelKey: "officeSheet.tab.review", keyTip: "R", groups: [
      group("ai", ["aiFormula", "aiExplain", "aiClean", "aiChart", "aiDescribe"], "sheetAi.title"),
      group("protection", ["protection", "compatibility"]), group("comments", ["comments"]),
    ] },
    { id: "sheet.view", labelKey: "officeSheet.tab.view", keyTip: "V", groups: [group("show", ["formulaBar", "gridlines", "headings"]), group("window", ["freeze", "unfreeze", "mode"]), group("zoom", ["zoom"])] },
    { id: "sheet.help", labelKey: "officeSheet.tab.help", keyTip: "Y", groups: [group("help", ["help", "formulaHelp", "limits"])] },
  ] };
}
