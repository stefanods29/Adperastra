import type { SearchMode } from "../services/search";

/** Pure prefix grammar for the search box (Step 11a E7). A prefix selects a
 * mode; it never starts a search or an AI request by itself. */

export type DisabledSearchMode = "ask" | "photo" | "similar";

export interface ParsedSearchInput {
  mode: SearchMode | null;
  text: string;
  disabled_mode: DisabledSearchMode | null;
}

const PREFIXES: ReadonlyArray<{
  prefix: string;
  mode: SearchMode | null;
  disabled: DisabledSearchMode | null;
}> = [
  { prefix: "name:", mode: "name", disabled: null },
  { prefix: "text:", mode: "content", disabled: null },
  { prefix: "re:", mode: "regex", disabled: null },
  { prefix: "ask:", mode: null, disabled: "ask" },
  { prefix: "photo:", mode: null, disabled: "photo" },
  { prefix: "similar:", mode: null, disabled: "similar" },
];

/** Strip one leading prefix. `mode` is null when the user did not type one;
 * the caller keeps its current mode. Unknown text is returned unchanged. */
export function parseSearchInput(raw: string, currentMode: SearchMode): ParsedSearchInput {
  // The current mode is supplied by the box; a prefix overrides it, and no
  // prefix returns `mode: null` so the caller keeps its mode.
  void currentMode;
  const lower = raw.toLowerCase();
  for (const entry of PREFIXES) {
    if (!lower.startsWith(entry.prefix)) continue;
    let text = raw.slice(entry.prefix.length);
    if (text.startsWith(" ")) text = text.slice(1);
    return {
      mode: entry.mode,
      text,
      disabled_mode: entry.disabled,
    };
  }
  return { mode: null, text: raw, disabled_mode: null };
}

/** The four modes a focused search box cycles through with Ctrl+Tab. */
export const SEARCH_MODE_CYCLE: readonly SearchMode[] = ["name", "content", "filters", "regex"];

export function nextSearchMode(current: SearchMode): SearchMode {
  const index = SEARCH_MODE_CYCLE.indexOf(current);
  return SEARCH_MODE_CYCLE[(index + 1) % SEARCH_MODE_CYCLE.length];
}

export function isSearchMode(value: unknown): value is SearchMode {
  return typeof value === "string" && (SEARCH_MODE_CYCLE as readonly string[]).includes(value);
}

/** Label key for the current mode; the caller translates it. */
export function searchModeLabelKey(mode: SearchMode): string {
  return `search.${mode}`;
}

/** Label key for a disabled AI-looking prefix. */
export function disabledModeLabelKey(mode: DisabledSearchMode): string {
  return `search.${mode}`;
}
