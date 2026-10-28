import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

export interface HelpPageSummary {
  slug: string;
  title?: string;
  language?: string;
}

// Dev-fallback content (plain browser only, for screenshot/dev use). The real
// offline help pages are served by the Tauri backend inside the app; this stub
// is never shown in the packaged app.
const FALLBACK_PAGES: HelpPageSummary[] = [{ slug: "getting-started" }];
const FALLBACK_PAGE_MARKDOWN = "# Adperastra\n\nHelp is available inside the app.";

export async function listHelp(language?: string): Promise<HelpPageSummary[]> {
  if (isTauriRuntime()) {
    return invoke<HelpPageSummary[]>("list_help", { lang: language ?? null });
  }
  return [...FALLBACK_PAGES];
}

export async function getHelpPage(slug: string, language?: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("get_help_page", { slug, lang: language ?? null });
  }
  return FALLBACK_PAGE_MARKDOWN;
}

export async function searchHelp(query: string, language?: string): Promise<HelpPageSummary[]> {
  if (isTauriRuntime()) {
    return invoke<HelpPageSummary[]>("search_help", { query, lang: language ?? null });
  }
  const needle = query.trim().toLowerCase();
  if (!needle) return [...FALLBACK_PAGES];
  return FALLBACK_PAGES.filter((page) => page.slug.includes(needle));
}