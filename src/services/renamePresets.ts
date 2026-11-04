import type { RenamePreset, RenamePresetCatalog } from "./bulkRename";
export { listRenamePresets, writeRenamePreset, removeRenamePreset } from "./bulkRename";

/** Explicit projection: selection paths, stamps, excluded indices and request
 * revision can never escape into a persisted catalog through object spread. */
export function presetForStorage(preset: RenamePreset): RenamePreset {
  if (preset.version !== 1 || !preset.name.trim() || Array.from(preset.name).length > 60 || preset.operations.length < 1 || preset.operations.length > 32) {
    throw new Error("rename.bad_request");
  }
  const operations = preset.operations.map(op => {
    switch (op.kind) {
      case "replace": return { kind: op.kind, find: op.find, replacement: op.replacement, regex: op.regex, match_case: op.match_case };
      case "prefix": case "suffix": return { kind: op.kind, text: op.text };
      case "number": return { kind: op.kind, start: op.start, step: op.step, padding: op.padding, position: op.position, separator: op.separator };
      case "case": return { kind: op.kind, mode: op.mode };
      case "template": return { kind: op.kind, pattern: op.pattern };
      case "remove": return { kind: op.kind, characters: op.characters };
      default: throw new Error("rename.bad_request");
    }
  });
  return { id: preset.id, name: preset.name, operations, include_extension: preset.include_extension, date_zone: preset.date_zone, version: 1 };
}
export function catalogForStorage(catalog: RenamePresetCatalog): RenamePresetCatalog {
  if (catalog.schema_version !== 1 || !Number.isSafeInteger(catalog.revision) || catalog.revision < 0 || catalog.presets.length > 100 || new Set(catalog.presets.map(p => p.id)).size !== catalog.presets.length) {
    throw new Error("rename.bad_request");
  }
  const clean = { schema_version: 1 as const, revision: catalog.revision, presets: catalog.presets.map(presetForStorage) };
  if (new TextEncoder().encode(JSON.stringify(clean)).byteLength > 1024 * 1024) throw new Error("rename.too_large");
  return clean;
}
