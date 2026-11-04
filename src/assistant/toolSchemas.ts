/**
 * Exact typed argument validation for the assistant tools (Step 17a T1).
 *
 * Every schema is closed (`additionalProperties: false`), uses the guide's
 * field names and caps, and never executes anything. The model's JSON is
 * untrusted; a mismatch throws `assistant.invalid_arguments` and the turn
 * fails without a tool call.
 */

import type { MetadataCategory } from "../convert/types";
import type { GroupColor } from "../services/tabGroups";
import type {
  AssistantConvertArguments,
  AssistantCreateFileArguments,
  AssistantCreateFolderArguments,
  AssistantCreateFromTemplateArguments,
  AssistantGroupTabsArguments,
  AssistantMoveCopyArguments,
  AssistantPrivacyCleanArguments,
  AssistantReadFileArguments,
  AssistantRenameItemsArguments,
  AssistantRecycleItemsArguments,
  AssistantSearchFilesArguments,
  AssistantTagItemsArguments,
  AssistantToolArguments,
  AssistantToolId,
} from "./types";
import { ASSISTANT_TOOL_IDS } from "./types";

export const INVALID_ARGUMENTS = "assistant.invalid_arguments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GROUP_COLORS: readonly GroupColor[] = ["purple", "blue", "green", "teal", "orange", "red"];
const METADATA_CATEGORIES: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "icc",
  "xmp",
  "iptc",
  "author",
  "comments",
  "attachments",
  "forms",
  "annotations",
  "scripts",
  "timestamps",
];
const CONVERTER_KINDS = ["image", "pdf", "document", "table", "archive", "media", "office"] as const;
const CREATE_FORMATS = ["text", "markdown", "csv"] as const;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

function fail(): never {
  throw new Error(INVALID_ARGUMENTS);
}

function scalars(value: string): number {
  return Array.from(value).length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Closed object: exactly the required keys, plus explicit nulls if allowed. */
export function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isObject(value)) fail();
  const keys = Object.keys(value);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) fail();
  if (required.some((key) => !(key in value))) fail();
  return value;
}

export function requiredString(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") fail();
  const length = scalars(value);
  if (length < min || length > max) fail();
  return value;
}

export function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail();
  return value;
}

export function requiredInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}

/** Canonical 14c sheet/slide ids are capped in UTF-8 bytes, not scalars. */
function requiredUtf8String(value: unknown, min: number, maxBytes: number): string {
  const text = requiredString(value, min, Number.MAX_SAFE_INTEGER);
  if (new TextEncoder().encode(text).length > maxBytes) fail();
  return text;
}

export function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail();
  return value;
}

export function uuidArray(value: unknown, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail();
  return value.map(requiredUuid);
}

export function stringArray(value: unknown, min: number, max: number, itemMax: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail();
  return value.map((entry) => requiredString(entry, 1, itemMax));
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function uniqueArray(values: readonly string[]): string[] {
  if (!uniqueStrings(values)) fail();
  return [...values];
}

/** A Windows basename the native `validate_new_name` will check again. */
export function requiredBasename(value: unknown): string {
  const name = requiredString(value, 1, 255);
  if (INVALID_NAME_CHARS.test(name) || /[. ]$/.test(name)) fail();
  if (RESERVED_NAMES.test(name)) fail();
  return name;
}

function requiredCategory(value: unknown): MetadataCategory {
  if (typeof value !== "string" || !METADATA_CATEGORIES.includes(value as MetadataCategory)) fail();
  return value as MetadataCategory;
}

function categoryArray(value: unknown, min: number, max: number): MetadataCategory[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail();
  const categories = value.map(requiredCategory);
  if (new Set(categories).size !== categories.length) fail();
  return categories;
}

/**
 * One `AiSourceLocation` variant, exactly as 14c defines it: internally
 * tagged with `kind` and flat fields (`{ kind: "page", page: 2 }`).
 */
export function validateSourceLocation(value: unknown): AssistantReadFileArguments["location"] {
  if (!isObject(value) || typeof value.kind !== "string") fail();
  if (value.kind === "text") {
    const inner = exactObject(value, ["kind", "start", "end"]);
    const start = requiredInteger(inner.start, 0, Number.MAX_SAFE_INTEGER);
    const end = requiredInteger(inner.end, 0, Number.MAX_SAFE_INTEGER);
    if (end <= start) fail();
    return { kind: "text", start, end };
  }
  if (value.kind === "page") {
    const inner = exactObject(value, ["kind", "page"]);
    return { kind: "page", page: requiredInteger(inner.page, 1, 10_000) };
  }
  if (value.kind === "time") {
    const inner = exactObject(value, ["kind", "start_us", "end_us"]);
    const start = requiredInteger(inner.start_us, 0, Number.MAX_SAFE_INTEGER);
    const end = requiredInteger(inner.end_us, 0, Number.MAX_SAFE_INTEGER);
    if (end <= start) fail();
    return { kind: "time", start_us: start, end_us: end };
  }
  if (value.kind === "sheet") {
    const inner = exactObject(value, ["kind", "sheet_id", "range"]);
    return {
      kind: "sheet",
      sheet_id: requiredUtf8String(inner.sheet_id, 1, 128),
      range: requiredUtf8String(inner.range, 1, 64),
    };
  }
  if (value.kind === "slide") {
    const inner = exactObject(value, ["kind", "slide_id"]);
    return { kind: "slide", slide_id: requiredUtf8String(inner.slide_id, 1, 128) };
  }
  if (value.kind === "image") {
    const inner = exactObject(value, ["kind", "region"]);
    if (inner.region === null) return { kind: "image", region: null };
    const region = exactObject(inner.region, ["x", "y", "width", "height"]);
    const x = requiredInteger(region.x, 0, Number.MAX_SAFE_INTEGER);
    const y = requiredInteger(region.y, 0, Number.MAX_SAFE_INTEGER);
    const width = requiredInteger(region.width, 1, Number.MAX_SAFE_INTEGER);
    const height = requiredInteger(region.height, 1, Number.MAX_SAFE_INTEGER);
    if (x + width > 0xffff_ffff || y + height > 0xffff_ffff) fail();
    return { kind: "image", region: { x, y, width, height } };
  }
  return fail();
}

function validateGroupTabs(value: unknown): AssistantGroupTabsArguments {
  const row = exactObject(value, ["tool_id", "tab_ids", "name", "color"]);
  if (row.tool_id !== "group_tabs") fail();
  if (typeof row.color !== "string" || !GROUP_COLORS.includes(row.color as GroupColor)) fail();
  return {
    tool_id: "group_tabs",
    tab_ids: stringArray(row.tab_ids, 1, 100, 128),
    name: requiredString(row.name, 1, 60),
    color: row.color as GroupColor,
  };
}

function validateCreateFile(value: unknown): AssistantCreateFileArguments {
  const row = exactObject(value, ["tool_id", "parent_root_id", "name", "format", "content"]);
  if (row.tool_id !== "create_file") fail();
  if (typeof row.format !== "string" || !CREATE_FORMATS.includes(row.format as "text")) fail();
  return {
    tool_id: "create_file",
    parent_root_id: requiredUuid(row.parent_root_id),
    name: requiredBasename(row.name),
    format: row.format as AssistantCreateFileArguments["format"],
    content: requiredString(row.content, 0, 65_536),
  };
}

function validateCreateFolder(value: unknown): AssistantCreateFolderArguments {
  const row = exactObject(value, ["tool_id", "parent_root_id", "name"]);
  if (row.tool_id !== "create_folder") fail();
  return {
    tool_id: "create_folder",
    parent_root_id: requiredUuid(row.parent_root_id),
    name: requiredBasename(row.name),
  };
}

function validateTemplate(value: unknown): AssistantCreateFromTemplateArguments {
  const row = exactObject(value, ["tool_id", "parent_root_id", "name", "template_id"]);
  if (row.tool_id !== "create_from_template") fail();
  return {
    tool_id: "create_from_template",
    parent_root_id: requiredUuid(row.parent_root_id),
    name: requiredBasename(row.name),
    template_id: requiredUuid(row.template_id),
  };
}

function validateRenameItems(value: unknown): AssistantRenameItemsArguments {
  const row = exactObject(value, ["tool_id", "items"]);
  if (row.tool_id !== "rename_items") fail();
  if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > 100) fail();
  const seen = new Set<string>();
  const items = row.items.map((entry) => {
    const item = exactObject(entry, ["input_id", "new_name"]);
    const inputId = requiredUuid(item.input_id);
    if (seen.has(inputId)) fail();
    seen.add(inputId);
    return { input_id: inputId, new_name: requiredBasename(item.new_name) };
  });
  return { tool_id: "rename_items", items };
}

function validateMoveCopy(value: unknown): AssistantMoveCopyArguments {
  const row = exactObject(value, ["tool_id", "input_ids", "target_root_id", "conflict"]);
  if (row.tool_id !== "move_items" && row.tool_id !== "copy_items") fail();
  if (row.conflict !== "keepBoth" && row.conflict !== "skip") fail();
  return {
    tool_id: row.tool_id,
    input_ids: uniqueArray(uuidArray(row.input_ids, 1, 100)),
    target_root_id: requiredUuid(row.target_root_id),
    conflict: row.conflict,
  };
}

function validateConvert(value: unknown): AssistantConvertArguments {
  const row = exactObject(value, [
    "tool_id",
    "input_ids",
    "converter_id",
    "format",
    "options",
    "target_root_id",
    "accepted_losses",
    "accepted_warning_codes",
  ]);
  if (row.tool_id !== "convert") fail();
  if (!isObject(row.options)) fail();
  if (
    typeof row.options.kind !== "string" ||
    !(CONVERTER_KINDS as readonly string[]).includes(row.options.kind)
  ) {
    fail();
  }
  const warnings = stringArray(row.accepted_warning_codes, 0, 64, 64);
  if (!uniqueStrings(warnings)) fail();
  return {
    tool_id: "convert",
    input_ids: uniqueArray(uuidArray(row.input_ids, 1, 100)),
    converter_id: requiredString(row.converter_id, 1, 64) as AssistantConvertArguments["converter_id"],
    format: requiredString(row.format, 1, 32) as AssistantConvertArguments["format"],
    options: row.options as AssistantConvertArguments["options"],
    target_root_id: requiredUuid(row.target_root_id),
    accepted_losses: categoryArray(row.accepted_losses, 0, 64),
    accepted_warning_codes: warnings,
  };
}

function validateTags(value: unknown): AssistantTagItemsArguments {
  const row = exactObject(value, ["tool_id", "input_ids", "add_tag_ids", "remove_tag_ids"]);
  if (row.tool_id !== "tag_items") fail();
  const add = uniqueArray(uuidArray(row.add_tag_ids, 0, 32));
  const remove = uniqueArray(uuidArray(row.remove_tag_ids, 0, 32));
  if (add.some((id) => remove.includes(id))) fail();
  return {
    tool_id: "tag_items",
    input_ids: uniqueArray(uuidArray(row.input_ids, 1, 100)),
    add_tag_ids: add,
    remove_tag_ids: remove,
  };
}

function validatePrivacy(value: unknown): AssistantPrivacyCleanArguments {
  const row = exactObject(value, ["tool_id", "input_ids", "categories", "target_root_id"]);
  if (row.tool_id !== "privacy_clean") fail();
  return {
    tool_id: "privacy_clean",
    input_ids: uniqueArray(uuidArray(row.input_ids, 1, 100)),
    categories: categoryArray(row.categories, 1, 32),
    target_root_id: requiredUuid(row.target_root_id),
  };
}

/**
 * Parse one raw tool argument object. Unknown tools, unknown keys, missing
 * keys, out-of-range values and a permanent-delete-like tool all fail.
 */
export function parseAssistantToolArguments(toolId: string, raw: unknown): AssistantToolArguments {
  if (!ASSISTANT_TOOL_IDS.includes(toolId as AssistantToolId)) fail();
  const id = toolId as AssistantToolId;
  if (id === "open_tab") {
    const row = exactObject(raw, ["tool_id", "input_id", "background"]);
    if (row.tool_id !== id || row.background !== false) fail();
    return { tool_id: id, input_id: requiredUuid(row.input_id), background: false };
  }
  if (id === "switch_tab" || id === "close_tab") {
    const row = exactObject(raw, ["tool_id", "tab_id"]);
    if (row.tool_id !== id) fail();
    return { tool_id: id, tab_id: requiredString(row.tab_id, 1, 128) };
  }
  if (id === "group_tabs") return validateGroupTabs(raw);
  if (id === "open_saved_group") {
    const row = exactObject(raw, ["tool_id", "group_id"]);
    if (row.tool_id !== id) fail();
    return { tool_id: id, group_id: requiredUuid(row.group_id) };
  }
  if (id === "search_files") {
    const row = exactObject(raw, ["tool_id", "text", "root_ids", "mode"]);
    if (row.tool_id !== id || row.mode !== "filename") fail();
    return {
      tool_id: id,
      text: requiredString(row.text, 1, 512),
      root_ids: uniqueArray(uuidArray(row.root_ids, 1, 32)),
      mode: "filename",
    };
  }
  if (id === "read_file") {
    const row = exactObject(raw, ["tool_id", "input_id", "location", "max_scalars"]);
    if (row.tool_id !== id) fail();
    return {
      tool_id: id,
      input_id: requiredUuid(row.input_id),
      location: validateSourceLocation(row.location),
      max_scalars: requiredInteger(row.max_scalars, 1, 65_536),
    };
  }
  if (id === "describe_image") {
    const row = exactObject(raw, ["tool_id", "input_id", "question"]);
    if (row.tool_id !== id) fail();
    return {
      tool_id: id,
      input_id: requiredUuid(row.input_id),
      question: requiredString(row.question, 1, 4_096),
    };
  }
  if (id === "create_file") return validateCreateFile(raw);
  if (id === "create_folder") return validateCreateFolder(raw);
  if (id === "create_from_template") return validateTemplate(raw);
  if (id === "rename_items") return validateRenameItems(raw);
  if (id === "move_items" || id === "copy_items") return validateMoveCopy(raw);
  if (id === "convert") return validateConvert(raw);
  if (id === "tag_items") return validateTags(raw);
  if (id === "privacy_clean") return validatePrivacy(raw);
  if (id === "recycle_items") {
    const row = exactObject(raw, ["tool_id", "input_ids"]);
    if (row.tool_id !== id) fail();
    return { tool_id: id, input_ids: uniqueArray(uuidArray(row.input_ids, 1, 100)) };
  }
  return fail();
}
