import { expect, it } from "vitest";
import { paperTargets } from "../office/paper/paperTargets";
import type { OfficeLayoutRun } from "../services/officeViewTypes";
const run = (text: string, order = 0, x = 20): OfficeLayoutRun => ({
  text, order, x, y: 30, width: 60, height: 12, font_size: 12, direction: "ltr",
});
const item = (text: string, id = "one") => ({ id, section_id: "section", text, address: null });

it("places an editable run on the actual page and combines split PDF runs", () => {
  const targets = paperTargets([{ page: 2, runs: [run("Hello ", 0), run("world", 1, 80)] }], [item("Hello world")]);
  expect(targets).toMatchObject([{ page: 2, x: 20, y: 30, width: 120, height: 12, fontSize: 12 }]);
});

it("refuses duplicate text on another page or in another source target", () => {
  const pages = [{ page: 1, runs: [run("Same")] }, { page: 2, runs: [run("Same")] }];
  expect(paperTargets(pages, [item("Same")])).toEqual([]);
  expect(paperTargets(pages.slice(0, 1), [item("Same"), item("Same", "two")])).toEqual([]);
});

it("matches a run wrapped onto the following rendered line", () => {
  const targets = paperTargets([{ page: 1, runs: [run("Hello"), { ...run("world", 1), y: 44 }] }], [item("Hello world")]);
  expect(targets[0]).toMatchObject({ page: 1, y: 30, height: 26 });
});

it("keeps source spaces and entities in the edit target while matching PDF text", () => {
  const source = item("  A & B  ");
  const targets = paperTargets([{ page: 1, runs: [run("A & B")] }], [source]);
  expect(targets[0].item).toBe(source);
  expect(targets[0].item.text).toBe("  A & B  ");
});

it("refuses a partial or unmatched run and mixed-font guessing", () => {
  expect(paperTargets([{ page: 1, runs: [run("Long sentence")] }], [item("sentence")])).toEqual([]);
  expect(paperTargets([{ page: 1, runs: [run("Hello "), { ...run("world", 1), font_size: 24 }] }], [item("Hello world")])).toEqual([]);
});
