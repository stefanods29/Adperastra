import type { BasicOfficeItem } from "../../services/officeBasic";
import type { OfficeLayoutRun } from "../../services/officeViewTypes";

export interface PaperTarget {
  item: BasicOfficeItem;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PaperTextPage {
  page: number;
  runs: OfficeLayoutRun[];
}

const normalized = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Associate only unique complete rendered run sequences with an edit target.
 * Duplicate source or rendered text stays visible without a guessed binding. */
export function paperTargets(pages: PaperTextPage[], items: BasicOfficeItem[]): PaperTarget[] {
  const prepared = pages.map(page => {
    const runs = [...page.runs].sort((a, b) => a.order - b.order);
    const starts = new Map<string, number[]>();
    runs.forEach((run, index) => {
      const first = normalized(run.text)[0];
      if (first) starts.set(first, [...(starts.get(first) ?? []), index]);
    });
    return { page: page.page, runs, starts };
  });
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = normalized(item.text);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const result: PaperTarget[] = [];
  for (const item of items) {
    const wanted = normalized(item.text);
    if (!wanted || counts.get(wanted) !== 1) continue;
    const candidates: PaperTarget[] = [];
    for (const page of prepared) {
      const { runs } = page;
      for (const start of page.starts.get(wanted[0]) ?? []) {
        let combined = "";
        const group: OfficeLayoutRun[] = [];
        for (let index = start; index < Math.min(start + 32, runs.length); index++) {
          const run = runs[index];
          if (group.length && (Math.abs(run.font_size - group[0].font_size) > 1
              || run.direction !== group[0].direction)) break;
          const previous = group.at(-1);
          if (previous && Math.abs(previous.y - run.y) > previous.height / 2
              && !/\s$/u.test(combined) && !/^\s/u.test(run.text)) combined += " ";
          combined += run.text;
          group.push(run);
          const text = normalized(combined);
          if (text === wanted) {
            const x = Math.min(...group.map(r => r.x));
            const y = Math.min(...group.map(r => r.y));
            candidates.push({
              item, page: page.page, x, y,
              width: Math.max(...group.map(r => r.x + r.width)) - x,
              height: Math.max(...group.map(r => r.y + r.height)) - y,
              fontSize: group[0].font_size,
            });
            break;
          }
          if (text.length > wanted.length || !wanted.startsWith(text)) break;
        }
      }
    }
    if (candidates.length === 1) result.push(candidates[0]);
  }
  return result;
}
