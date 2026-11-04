import { describe, expect, it } from "vitest";
import { sheetRibbon } from "../office/sheet/sheetRibbon";
describe("sheet ribbon", () => {
  it("9 tabs order", () => {
    expect(sheetRibbon().tabs.map((tab) => tab.id)).toEqual([
      "sheet.file", "sheet.home", "sheet.insert", "sheet.pageLayout", "sheet.formulas", "sheet.data", "sheet.review", "sheet.view", "sheet.help",
    ]);
    expect(sheetRibbon().tabs.map((tab) => tab.keyTip)).toEqual(["F", "H", "I", "P", "M", "D", "R", "V", "Y"]);
  });
  it("review AI group exposes the five sheet AI commands", () => {
    const review = sheetRibbon().tabs.find((tab) => tab.id === "sheet.review");
    const ai = review?.groups.find((group) => group.labelKey === "sheetAi.title");
    expect(ai?.controls.map((control) => control.type === "custom" ? "" : control.command)).toEqual([
      "sheet.aiFormula", "sheet.aiExplain", "sheet.aiClean", "sheet.aiChart", "sheet.aiDescribe",
    ]);
  });
  it("only canonical sheet commands and translated captions", () => {
    for (const tab of sheetRibbon().tabs) {
      expect(tab.labelKey).toMatch(/^officeSheet\.tab\./);
      for (const group of tab.groups) {
        expect(group.labelKey).toMatch(/^(officeSheet\.group\.|sheetAi\.title$)/);
        for (const control of group.controls) {
          expect(control.type).not.toBe("custom");
          if (control.type !== "custom") expect(control.command).toMatch(/^sheet\.[A-Za-z]+$/);
        }
      }
    }
  });
});
