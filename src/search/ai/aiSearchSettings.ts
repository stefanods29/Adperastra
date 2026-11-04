/**
 * Settings helper for the five independent AI-search opt-ins (Step 17c D1).
 *
 * The settings schema, Rust mirror and `AppSettings` field belong to the
 * coordinator. This module keeps the pure normalization, the consent checks
 * and the UI reasons testable without touching the shared settings codec.
 */

import type { IndexRoot } from "../../services/search";
import type { AiDestination, AiSearchMode, AiSearchSettings, AiSemanticRoot } from "../../services/aiSearchTypes";
import {
  eligibleSemanticRoots,
  isCanonicalUuid,
  isOrdinaryAbsolutePath,
  normalizeAiSearchSettings,
  normalizeDisabledSortExtensions,
} from "../../services/aiSearchTypes";

export const AI_SEARCH_SETTINGS_FIELD = "ai_search";

/** The five independent switches, in Settings order. */
export const AI_SEARCH_OPT_INS = [
  "semantic_text",
  "photo_index",
  "natural_query",
  "rename",
  "sort",
] as const;

export type AiSearchOptIn = (typeof AI_SEARCH_OPT_INS)[number];

/**
 * Add or replace the `ai_search` block and leave every other settings field,
 * including unknown future ones, exactly as it was. Schema 45 -> 46.
 */
export function withAiSearchSettings(
  rawSettings: unknown,
  aiSearch: unknown,
  fromSchemaVersion: number,
): Record<string, unknown> {
  const base =
    typeof rawSettings === "object" && rawSettings !== null && !Array.isArray(rawSettings)
      ? { ...(rawSettings as Record<string, unknown>) }
      : {};
  const normalized =
    fromSchemaVersion < 46 ? normalizeAiSearchSettings(undefined) : normalizeAiSearchSettings(aiSearch);
  return { ...base, schema_version: 46, ai_search: normalized };
}

export function aiSearchSettingsFor(
  rawSettings: Record<string, unknown> | null | undefined,
  schemaVersion: number,
): AiSearchSettings {
  if (!rawSettings || schemaVersion < 46) return normalizeAiSearchSettings(undefined);
  return normalizeAiSearchSettings(rawSettings[AI_SEARCH_SETTINGS_FIELD]);
}

export function setOptIn(settings: AiSearchSettings, key: AiSearchOptIn, enabled: boolean): AiSearchSettings {
  return { ...settings, [key]: enabled };
}

/** Toggle one root; a root with neither mode is removed, never left empty. */
export function setSemanticRoot(
  settings: AiSearchSettings,
  rootId: string,
  mode: "text" | "photos",
  enabled: boolean,
): AiSearchSettings {
  if (!isCanonicalUuid(rootId)) return settings;
  const existing = settings.roots.find((root) => root.root_id === rootId);
  const next: AiSemanticRoot = {
    root_id: rootId,
    text: existing?.text ?? false,
    photos: existing?.photos ?? false,
    [mode]: enabled,
  } as AiSemanticRoot;
  const roots = settings.roots.filter((root) => root.root_id !== rootId);
  if (next.text || next.photos) roots.push(next);
  return { ...settings, roots };
}

export function addDestination(
  settings: AiSearchSettings,
  destination: AiDestination,
): AiSearchSettings {
  if (!isCanonicalUuid(destination.id) || !isOrdinaryAbsolutePath(destination.path)) return settings;
  const name = destination.name.trim();
  if (name.length === 0 || Array.from(name).length > 60) return settings;
  const key = destination.path.toLowerCase().replace(/\//g, "\\").replace(/\\$/, "");
  if (settings.destinations.some((entry) => entry.id === destination.id)) return settings;
  if (settings.destinations.some((entry) => entry.path.toLowerCase().replace(/\//g, "\\") === key)) {
    return settings;
  }
  if (settings.destinations.length >= 32) return settings;
  return { ...settings, destinations: [...settings.destinations, { ...destination, name }] };
}

export function removeDestination(settings: AiSearchSettings, id: string): AiSearchSettings {
  return { ...settings, destinations: settings.destinations.filter((entry) => entry.id !== id) };
}

export function setSortKindDisabled(
  settings: AiSearchSettings,
  extension: string,
  disabled: boolean,
): AiSearchSettings {
  const [canonical] = normalizeDisabledSortExtensions([extension]);
  if (!canonical) return settings;
  const current = new Set(settings.disabled_sort_extensions);
  if (disabled) current.add(canonical);
  else current.delete(canonical);
  return { ...settings, disabled_sort_extensions: [...current].slice(0, 100) };
}

/**
 * Consent is per action. An 11a content root, an OPAC root or a sensitive
 * virtual root never becomes AI consent by existing.
 */
export function validateAiSearchSettings(
  settings: AiSearchSettings,
  indexRoots: readonly IndexRoot[],
  sensitiveRootIds: readonly string[],
): string | null {
  if (settings.roots.length > 32 || settings.destinations.length > 32) return "ai_search.too_large";
  const enabled = new Set(indexRoots.filter((root) => root.enabled).map((root) => root.id));
  const sensitive = new Set(sensitiveRootIds);
  const seen = new Set<string>();
  for (const root of settings.roots) {
    if (!isCanonicalUuid(root.root_id) || seen.has(root.root_id)) return "ai_search.invalid";
    if (!root.text && !root.photos) return "ai_search.invalid";
    if (sensitive.has(root.root_id)) return "ai_search.sensitive";
    if (!enabled.has(root.root_id)) return "ai_search.denied";
    seen.add(root.root_id);
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const destination of settings.destinations) {
    if (!isCanonicalUuid(destination.id) || ids.has(destination.id)) return "ai_search.invalid";
    if (!isOrdinaryAbsolutePath(destination.path)) return "ai_search.invalid";
    const key = destination.path.toLowerCase().replace(/\//g, "\\").replace(/\\$/, "");
    if (paths.has(key)) return "ai_search.invalid";
    const name = destination.name.trim();
    if (name.length === 0 || Array.from(name).length > 60) return "ai_search.invalid";
    ids.add(destination.id);
    paths.add(key);
  }
  if (normalizeDisabledSortExtensions(settings.disabled_sort_extensions).length !== settings.disabled_sort_extensions.length) {
    return "ai_search.invalid";
  }
  return null;
}

/** A translated key explaining why a mode is unavailable, or null. */
export function aiModeDisabledReason(
  settings: AiSearchSettings,
  mode: AiSearchMode,
  indexRoots: readonly IndexRoot[],
  sensitiveRootIds: readonly string[],
  selectedKind: "text" | "image" | null = null,
  providerAvailable = true,
): string | null {
  // No local pack means no AI control is usable; keep every mode disabled
  // instead of letting a model-free path pretend the provider is ready.
  if (!providerAvailable) return "errors.ai_search.unavailable";
  if (mode === "natural") return settings.natural_query ? null : "errors.ai_search.unavailable";
  if (mode === "meaning" && !settings.semantic_text) return "aiSearch.textOptIn";
  if (mode === "photos" && !settings.photo_index) return "aiSearch.photoOptIn";
  const similarText = mode === "similar" && selectedKind === "text";
  if (mode === "similar" && !(settings.photo_index || settings.semantic_text)) {
    return similarText ? "aiSearch.textOptIn" : "aiSearch.photoOptIn";
  }
  const roots = eligibleSemanticRoots(
    settings,
    indexRoots,
    sensitiveRootIds,
    mode === "meaning" || similarText ? "text" : "photos",
  );
  return roots.length === 0 ? "aiSearch.empty" : null;
}

export function sortKindDisabled(settings: AiSearchSettings, extension: string): boolean {
  const [canonical] = normalizeDisabledSortExtensions([extension]);
  return canonical ? settings.disabled_sort_extensions.includes(canonical) : true;
}
