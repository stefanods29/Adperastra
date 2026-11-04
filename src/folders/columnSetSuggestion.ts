import type { ColumnSet } from "../services/folderCustomization";
import { defaultColumns, defaultColumnWidth, type ColumnId, type ColumnSpec } from "../services/folderPresentation";

type FolderType = NonNullable<ColumnSet["folder_type"]>;
/** Trusted filename-extension vocabulary, not a metadata provider. The guide
 * does not fix its members; coordinator must resolve that before UI wiring. */
export type ColumnSetExtensions = Readonly<Record<Exclude<FolderType, "general">, readonly string[]>>;

export function defaultColumnSetColumns(type: FolderType): ColumnSpec[] {
  if (type === "general") return defaultColumns();
  const ids: Record<Exclude<FolderType, "general">, ColumnId[]> = {
    photos: ["name", "date_taken", "dimensions", "camera_model"],
    music: ["name", "audio_title", "audio_artist", "audio_album", "duration_ms"],
    documents: ["name", "author", "page_count", "modified"],
  };
  return ids[type].map((id) => ({ id, width: defaultColumnWidth(id) }));
}

/** Call only after the user explicitly chooses Suggest. `names` contains files
 * from the current listing, with directories excluded by the caller. Unmatched
 * files still count in the denominator. No filesystem/metadata work occurs. */
export function suggestColumnSet(names: readonly string[], extensions: ColumnSetExtensions): FolderType {
  const counts = { photos: 0, music: 0, documents: 0 };
  const vocabulary = new Map<string, Exclude<FolderType, "general">>();
  for (const type of ["photos", "music", "documents"] as const) {
    for (const extension of extensions[type]) {
      const normalized = extension.toLowerCase();
      if (!/^[a-z0-9]+$/.test(normalized) || vocabulary.has(normalized)) throw new Error("folder_custom.invalid");
      vocabulary.set(normalized, type);
    }
  }
  for (const name of names) {
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) continue;
    const type = vocabulary.get(name.slice(dot + 1).toLowerCase());
    if (type) counts[type] += 1;
  }
  for (const type of ["photos", "music", "documents"] as const) {
    if (counts[type] >= 5 && counts[type] * 100 >= names.length * 60) return type;
  }
  return "general";
}
