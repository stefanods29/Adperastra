import { FolderInput, Pencil, Search as SearchIcon, Sparkles } from "lucide-react";
import type { Command } from "./registry";

/** The four AI search modes and the two organizing actions (Step 17c T8). */
export type AiSearchCommandMode = "semantic" | "photos" | "similar" | "natural";

export interface AiSearchCommandActions {
  openSearchMode: (mode: AiSearchCommandMode) => void;
  suggestName: () => void;
  sortSuggestions: () => void;
}

/**
 * The coordinator registers these in the Explorer command registry. None of
 * them changes a file: rename/move still require their ordinary preview and
 * explicit execution.
 */
export function createAiSearchCommands(actions: AiSearchCommandActions): Command[] {
  return [
    {
      id: "search.semantic",
      labelKey: "aiSearch.meaning",
      icon: SearchIcon,
      risk: "read-only",
      helpSlug: "natural-language-search",
      enabledWhen: () => true,
      run: () => actions.openSearchMode("semantic"),
    },
    {
      id: "search.photos",
      labelKey: "aiSearch.photos",
      icon: Sparkles,
      risk: "read-only",
      helpSlug: "searching-photos-by-content",
      enabledWhen: () => true,
      run: () => actions.openSearchMode("photos"),
    },
    {
      id: "search.similar",
      labelKey: "aiSearch.similar",
      icon: FolderInput,
      risk: "read-only",
      helpSlug: "similar-files",
      enabledWhen: (context) => context.selection.count === 1,
      run: () => actions.openSearchMode("similar"),
    },
    {
      id: "search.natural",
      labelKey: "aiSearch.natural",
      icon: Sparkles,
      risk: "read-only",
      helpSlug: "natural-language-search",
      enabledWhen: () => true,
      run: () => actions.openSearchMode("natural"),
    },
    {
      id: "file.suggestName",
      labelKey: "aiSearch.suggestName",
      icon: Pencil,
      risk: "change",
      helpSlug: "rename-suggestions",
      enabledWhen: (context) => context.selection.files > 0 && context.selection.count <= 100,
      run: () => actions.suggestName(),
    },
    {
      id: "folder.sortSuggestions",
      labelKey: "aiSearch.sort",
      icon: FolderInput,
      risk: "change",
      helpSlug: "sort-suggestions",
      enabledWhen: (context) => context.selection.files > 0,
      run: () => actions.sortSuggestions(),
    },
  ];
}
