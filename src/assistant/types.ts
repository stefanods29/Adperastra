/**
 * Canonical assistant types (Step 17a, assistant-core-1).
 *
 * These are the single source of truth for the assistant UI, the tool
 * adapters and every later assistant consumer. Native mirrors live in
 * `src-tauri/src/assistant_types.rs`; both sides validate independently.
 * Nothing here may carry a credential, a scope handle or an approval token.
 */

import type { CommandRisk } from "../commands/registry";
import type { ConvertOptions, ConversionInput, ConverterId, FormatId, MetadataCategory } from "../convert/types";
import type { AiCitation, AiInputKind, AiInputRef, AiSourceLocation, AiTaskRequest, AiTaskResult } from "../services/localAiTypes";
import type { GroupColor } from "../services/tabGroups";

export type AssistantBackend = "local" | "api";
export type AssistantProviderId = "meta" | "custom_compatible";
export type AssistantLocalSource = "bundled" | "user_server";
export type AssistantAnswerLength = "short" | "normal" | "detailed";
export type AssistantTone = "friendly" | "neutral";
export type AssistantLanguage = "app" | "input";
export type AssistantMessageRole = "user" | "assistant";
export type AssistantMessageStatus = "pending" | "streaming" | "done" | "stopped" | "failed";

/** Keys of `AssistantSettings.automatic_tools` (all low risk). */
export const ASSISTANT_AUTOMATIC_TOOL_KEYS = [
  "open_tab",
  "switch_tab",
  "search_files",
  "read_file",
  "group_tabs",
] as const;
export type AssistantAutomaticToolKey = (typeof ASSISTANT_AUTOMATIC_TOOL_KEYS)[number];

/** Settings block `assistant` inside the app settings file (schema 44). */
export interface AssistantSettings {
  enabled: boolean;
  backend: AssistantBackend;
  provider_id: AssistantProviderId;
  custom_endpoint_id: string | null;
  api_model_id: string;
  local_source: AssistantLocalSource;
  local_server_port: number;
  local_server_address: "127.0.0.1" | "::1";
  name: string;
  answer_length: AssistantAnswerLength;
  tone: AssistantTone;
  language: AssistantLanguage;
  show_steps: boolean;
  allow_read_contents: boolean;
  automatic_tools: Record<AssistantAutomaticToolKey, boolean>;
  denied_folders: string[];
  keep_history: boolean;
}

export const DEFAULT_API_MODEL_ID = "muse-spark-1.3";
export const MAX_DENIED_FOLDERS = 128;
export const MAX_SCOPE_ROOTS = 32;
export const MAX_SCOPE_FILES = 128;
export const MAX_DRAFT_ROWS = 100;
export const MAX_SOURCE_BYTES_PER_TURN = 128 * 1024;
export const MAX_SOURCE_BYTES_PER_FILE = 64 * 1024;
export const MAX_STREAMING_TEXT = 32_768;
/** Recycle execution stays unavailable until 09f proves object-bound reuse. */
export const ASSISTANT_RECYCLE_SAFE = false;

export function defaultAssistantSettings(): AssistantSettings {
  return {
    enabled: false,
    backend: "local",
    provider_id: "meta",
    custom_endpoint_id: null,
    api_model_id: DEFAULT_API_MODEL_ID,
    local_source: "bundled",
    local_server_port: 11434,
    local_server_address: "127.0.0.1",
    name: "",
    answer_length: "normal",
    tone: "neutral",
    language: "app",
    show_steps: false,
    allow_read_contents: false,
    automatic_tools: {
      open_tab: true,
      switch_tab: true,
      search_files: true,
      read_file: false,
      group_tabs: true,
    },
    denied_folders: [],
    keep_history: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lenient settings normalization for schema 44. Unknown keys are dropped and
 * every bound is clamped; a corrupt block falls back to Local AI, never API.
 */
export function normalizeAssistantSettings(input: unknown): AssistantSettings {
  const defaults = defaultAssistantSettings();
  if (!isRecord(input)) return defaults;
  const text = (value: unknown, max: number, fallback: string): string =>
    typeof value === "string" ? Array.from(value).slice(0, max).join("") : fallback;
  const backend: AssistantBackend = input.backend === "api" ? "api" : "local";
  const provider: AssistantProviderId =
    input.provider_id === "custom_compatible" ? "custom_compatible" : "meta";
  const auto = isRecord(input.automatic_tools) ? input.automatic_tools : {};
  const automatic = { ...defaults.automatic_tools };
  for (const key of ASSISTANT_AUTOMATIC_TOOL_KEYS) {
    if (typeof auto[key] === "boolean") automatic[key] = auto[key] as boolean;
  }
  const denied = Array.isArray(input.denied_folders)
    ? input.denied_folders
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .slice(0, MAX_DENIED_FOLDERS)
    : [];
  const model = text(input.api_model_id, 96, defaults.api_model_id);
  const api_model_id =
    model.length > 0 && /^[\x21-\x7e]+$/.test(model) ? model : defaults.api_model_id;
  const endpointId =
    typeof input.custom_endpoint_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.custom_endpoint_id,
    )
      ? input.custom_endpoint_id
      : null;
  const port =
    typeof input.local_server_port === "number" && Number.isSafeInteger(input.local_server_port)
      ? Math.min(65_535, Math.max(1_024, input.local_server_port))
      : defaults.local_server_port;
  return {
    enabled: input.enabled === true,
    backend,
    provider_id: provider,
    custom_endpoint_id: endpointId,
    api_model_id,
    local_source: input.local_source === "user_server" ? "user_server" : "bundled",
    local_server_port: port,
    local_server_address: input.local_server_address === "::1" ? "::1" : "127.0.0.1",
    name: text(input.name, 40, ""),
    answer_length:
      input.answer_length === "short" || input.answer_length === "detailed"
        ? input.answer_length
        : "normal",
    tone: input.tone === "friendly" ? "friendly" : "neutral",
    language: input.language === "input" ? "input" : "app",
    show_steps: input.show_steps === true,
    allow_read_contents: input.allow_read_contents === true,
    automatic_tools: automatic,
    denied_folders: denied,
    keep_history: input.keep_history === true,
  };
}

/** Native credential status. The secret never crosses this boundary. */
export interface CredentialStatus {
  provider_id: AssistantProviderId;
  has_key: boolean;
  /** At most the last four characters, never the full key. */
  masked_hint: string;
  updated_unix: number | null;
}

export interface AssistantModel {
  id: string;
  display_name: string;
  supports_vision: boolean;
  supports_schema: boolean;
  provider_id: AssistantProviderId;
}

export interface AssistantConnectionResult {
  ok: boolean;
  error_code: string | null;
  model_ids: string[];
}

/** Native-owned custom endpoint identity. No secret and no full URL history. */
export interface AssistantEndpointConfig {
  id: string;
  base_url: string;
  host: string;
  port: 443;
  model_id: string;
  generation: number;
  schema_supported: boolean;
  vision_supported: boolean;
  tested_unix: number | null;
}

export interface AssistantEndpointStatus {
  id: string | null;
  display_origin: string | null;
  model_id: string | null;
  generation: number;
  configured: boolean;
  schema_supported: boolean;
  vision_supported: boolean;
  tested_unix: number | null;
}

export interface AssistantMessage {
  id: string;
  role: AssistantMessageRole;
  plain_text: string;
  citations: AiCitation[];
  status: AssistantMessageStatus;
  error_code: string | null;
  backend: AssistantBackend;
  provider_id: AssistantProviderId | null;
  model_id: string;
}

export interface AssistantConversation {
  id: string;
  backend: AssistantBackend;
  provider_id: AssistantProviderId | null;
  model_id: string;
  locale: "en" | "es";
  revision: number;
  messages: AssistantMessage[];
  created_unix: number;
}

export interface AssistantScopeRoot {
  root_id: string;
  label: string;
  recursive: boolean;
  read_contents: boolean;
}

export interface AssistantScope {
  id: string;
  chat_id: string;
  generation: number;
  files: AiInputRef[];
  roots: AssistantScopeRoot[];
  read_contents: boolean;
  denied_folders: string[];
}

const SCOPE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AI_INPUT_KINDS = ["document", "snapshot", "artifact"] as const;

function scopeUuid(value: unknown): string {
  if (typeof value !== "string" || !SCOPE_UUID.test(value)) {
    throw new Error("assistant.invalid");
  }
  return value;
}

/**
 * Exact native `AssistantScope`/`AiInputRef` shape (E5). The UI never casts
 * an arbitrary response into a scope: stale or invented source references,
 * extra approval fields and over-cap lists are refused.
 */
export function validateAssistantScope(value: unknown): AssistantScope {
  if (!isRecord(value)) throw new Error("assistant.invalid");
  const scopeKeys = [
    "id",
    "chat_id",
    "generation",
    "files",
    "roots",
    "read_contents",
    "denied_folders",
  ];
  if (Object.keys(value).length !== scopeKeys.length || scopeKeys.some((key) => !(key in value))) {
    throw new Error("assistant.invalid");
  }
  if (typeof value.read_contents !== "boolean") throw new Error("assistant.invalid");
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1
  ) {
    throw new Error("assistant.invalid");
  }
  if (!Array.isArray(value.files) || value.files.length > MAX_SCOPE_FILES) {
    throw new Error("assistant.invalid");
  }
  const files: AiInputRef[] = value.files.map((entry) => {
    if (!isRecord(entry)) throw new Error("assistant.invalid");
    const keys = ["kind", "id", "expected_revision"];
    if (Object.keys(entry).length !== keys.length || keys.some((key) => !(key in entry))) {
      throw new Error("assistant.invalid");
    }
    if (!(AI_INPUT_KINDS as readonly string[]).includes(entry.kind as string)) {
      throw new Error("assistant.invalid");
    }
    if (
      typeof entry.expected_revision !== "number" ||
      !Number.isSafeInteger(entry.expected_revision) ||
      entry.expected_revision < 1
    ) {
      throw new Error("assistant.invalid");
    }
    return {
      kind: entry.kind as AiInputKind,
      id: scopeUuid(entry.id),
      expected_revision: entry.expected_revision,
    };
  });
  if (!Array.isArray(value.roots) || value.roots.length > MAX_SCOPE_ROOTS) {
    throw new Error("assistant.invalid");
  }
  const roots: AssistantScopeRoot[] = value.roots.map((entry) => {
    if (!isRecord(entry)) throw new Error("assistant.invalid");
    const keys = ["root_id", "label", "recursive", "read_contents"];
    if (Object.keys(entry).length !== keys.length || keys.some((key) => !(key in entry))) {
      throw new Error("assistant.invalid");
    }
    if (
      typeof entry.label !== "string" ||
      Array.from(entry.label).length > 32_768 ||
      typeof entry.recursive !== "boolean" ||
      typeof entry.read_contents !== "boolean"
    ) {
      throw new Error("assistant.invalid");
    }
    return {
      root_id: scopeUuid(entry.root_id),
      label: entry.label,
      recursive: entry.recursive,
      read_contents: entry.read_contents,
    };
  });
  if (!Array.isArray(value.denied_folders) || value.denied_folders.length > MAX_DENIED_FOLDERS) {
    throw new Error("assistant.invalid");
  }
  const denied = value.denied_folders.map((folder) => {
    if (
      typeof folder !== "string" ||
      folder.length === 0 ||
      Array.from(folder).length > 32_768
    ) {
      throw new Error("assistant.invalid");
    }
    return folder;
  });
  return {
    id: scopeUuid(value.id),
    chat_id: scopeUuid(value.chat_id),
    generation: value.generation,
    files,
    roots,
    read_contents: value.read_contents,
    denied_folders: denied,
  };
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export const ASSISTANT_TOOL_IDS = [
  "open_tab",
  "switch_tab",
  "close_tab",
  "group_tabs",
  "open_saved_group",
  "search_files",
  "read_file",
  "describe_image",
  "create_file",
  "create_folder",
  "create_from_template",
  "rename_items",
  "move_items",
  "copy_items",
  "convert",
  "tag_items",
  "privacy_clean",
  "recycle_items",
] as const;
export type AssistantToolId = (typeof ASSISTANT_TOOL_IDS)[number];

/** Tools that change disk content or metadata; every one needs a preview. */
export const ASSISTANT_CHANGE_TOOL_IDS = [
  "create_file",
  "create_folder",
  "create_from_template",
  "rename_items",
  "move_items",
  "copy_items",
  "convert",
  "tag_items",
  "privacy_clean",
] as const;
export type AssistantChangeToolId = (typeof ASSISTANT_CHANGE_TOOL_IDS)[number];

/** The one recycle tool. There is deliberately no permanent-delete variant. */
export const ASSISTANT_RECYCLE_TOOL_ID = "recycle_items" as const;

export interface AssistantToolSpec {
  tool_id: AssistantToolId;
  command_id: string;
  schema_id: string;
  risk: CommandRisk;
  required_capability: string;
  automatic_allowed: boolean;
  description_key: string;
  help_slug: string;
}

export interface AssistantToolContext {
  chat_id: string;
  scope_id: string;
  active_tab_id: string | null;
  capability_ids: string[];
}

export interface AssistantToolResult {
  call_id: string;
  plain_text: string;
  citations: AiCitation[];
  input_refs: AiInputRef[];
  error_code: string | null;
}

export interface AssistantRenameItem {
  input_id: string;
  new_name: string;
}

export interface AssistantOpenTabArguments {
  tool_id: "open_tab";
  input_id: string;
  background: false;
}

export interface AssistantSwitchTabArguments {
  tool_id: "switch_tab";
  tab_id: string;
}

export interface AssistantCloseTabArguments {
  tool_id: "close_tab";
  tab_id: string;
}

export interface AssistantGroupTabsArguments {
  tool_id: "group_tabs";
  tab_ids: string[];
  name: string;
  color: GroupColor;
}

export interface AssistantOpenSavedGroupArguments {
  tool_id: "open_saved_group";
  group_id: string;
}

export interface AssistantSearchFilesArguments {
  tool_id: "search_files";
  text: string;
  root_ids: string[];
  mode: "filename";
}

export interface AssistantReadFileArguments {
  tool_id: "read_file";
  input_id: string;
  location: AiSourceLocation;
  max_scalars: number;
}

export interface AssistantDescribeImageArguments {
  tool_id: "describe_image";
  input_id: string;
  question: string;
}

export interface AssistantCreateFileArguments {
  tool_id: "create_file";
  parent_root_id: string;
  name: string;
  format: "text" | "markdown" | "csv";
  content: string;
}

export interface AssistantCreateFolderArguments {
  tool_id: "create_folder";
  parent_root_id: string;
  name: string;
}

export interface AssistantCreateFromTemplateArguments {
  tool_id: "create_from_template";
  parent_root_id: string;
  name: string;
  template_id: string;
}

export interface AssistantRenameItemsArguments {
  tool_id: "rename_items";
  items: AssistantRenameItem[];
}

export interface AssistantMoveCopyArguments {
  tool_id: "move_items" | "copy_items";
  input_ids: string[];
  target_root_id: string;
  conflict: "keepBoth" | "skip";
}

export interface AssistantConvertArguments {
  tool_id: "convert";
  input_ids: string[];
  converter_id: ConverterId;
  format: FormatId;
  options: ConvertOptions;
  target_root_id: string;
  accepted_losses: MetadataCategory[];
  accepted_warning_codes: string[];
}

export interface AssistantTagItemsArguments {
  tool_id: "tag_items";
  input_ids: string[];
  add_tag_ids: string[];
  remove_tag_ids: string[];
}

export interface AssistantPrivacyCleanArguments {
  tool_id: "privacy_clean";
  input_ids: string[];
  categories: MetadataCategory[];
  target_root_id: string;
}

export interface AssistantRecycleItemsArguments {
  tool_id: "recycle_items";
  input_ids: string[];
}

/** The full discriminated union; `tool_id` identifies the exact shape. */
export type AssistantToolArguments =
  | AssistantOpenTabArguments
  | AssistantSwitchTabArguments
  | AssistantCloseTabArguments
  | AssistantGroupTabsArguments
  | AssistantOpenSavedGroupArguments
  | AssistantSearchFilesArguments
  | AssistantReadFileArguments
  | AssistantDescribeImageArguments
  | AssistantCreateFileArguments
  | AssistantCreateFolderArguments
  | AssistantCreateFromTemplateArguments
  | AssistantRenameItemsArguments
  | AssistantMoveCopyArguments
  | AssistantConvertArguments
  | AssistantTagItemsArguments
  | AssistantPrivacyCleanArguments
  | AssistantRecycleItemsArguments;

export type AssistantChangeArguments =
  | AssistantCreateFileArguments
  | AssistantCreateFolderArguments
  | AssistantCreateFromTemplateArguments
  | AssistantRenameItemsArguments
  | AssistantMoveCopyArguments
  | AssistantConvertArguments
  | AssistantTagItemsArguments
  | AssistantPrivacyCleanArguments;

export type AssistantOperation = AssistantChangeArguments | AssistantRecycleItemsArguments;

export interface AssistantToolRequest {
  tool_id: AssistantToolId;
  arguments: AssistantToolArguments;
  call_id: string;
  source_message_id: string;
}

export type AssistantReply =
  | { kind: "answer"; text: string; citations: AiCitation[] }
  | { kind: "tool"; request: AssistantToolRequest }
  | { kind: "refusal"; reason_code: string };

export interface AssistantPreviewRow {
  input_id: string | null;
  source_label: string | null;
  destination_label: string | null;
  before_excerpt: string | null;
  after_excerpt: string | null;
  operation_key: string;
}

export interface AssistantDraft {
  id: string;
  chat_id: string;
  revision: number;
  operation: AssistantOperation;
  source_ids: AiInputRef[];
  preview_rows: AssistantPreviewRow[];
  warnings: string[];
  accepted_warning_codes: string[];
  accepted_losses: MetadataCategory[];
  draft_sha256: string;
  expires_unix: number;
  risk: "change" | "recycle";
}

export interface AssistantActionResult {
  draft_id: string;
  state: "completed" | "partial" | "cancelled" | "failed" | "unavailable";
  actual_input_ids: string[];
  output_labels: string[];
  undo_entry_id: string | null;
  error_code: string | null;
}

export interface AssistantTurnRequest {
  chat_id: string;
  expected_revision: number;
  user_text: string;
  scope_id: string;
  request_id: string;
  chat_send_nonce: string;
}

export interface AssistantTurnResult {
  chat_id: string;
  revision: number;
  reply: AssistantReply;
  draft: AssistantDraft | null;
  action: AssistantActionResult | null;
  /** Stable warning codes, e.g. `assistant.injection`; never raw file text. */
  warnings: string[];
  backend: AssistantBackend;
  provider_id: AssistantProviderId | null;
  model_id: string;
}

export interface AssistantOutboundSource {
  input_id: string;
  revision: number;
  label: string;
  location: AiSourceLocation;
  excerpt: string;
  mime: string;
  byte_len: number;
  image_preview_artifact_id: string | null;
}

export interface AssistantOutboundPreview {
  preview_id: string;
  backend: AssistantBackend;
  provider_id: AssistantProviderId | null;
  model_id: string;
  payload_sha256: string | null;
  sources: AssistantOutboundSource[];
  byte_len: number;
  requires_consent: boolean;
  expires_unix: number;
  includes_chat_history: boolean;
  local_server: boolean;
}

/** The adapter contract registered by T1; the model never sees `run`. */
export interface AssistantCommandAdapter {
  spec: AssistantToolSpec;
  validate(args: unknown): AssistantToolArguments;
  preview(args: AssistantToolArguments, scopeId: string): Promise<AssistantDraft>;
  executeRead(args: AssistantToolArguments, scopeId: string): Promise<AssistantToolResult>;
}

/** Inputs the assistant may pass to 14c; files never bypass the runtime. */
export type AssistantTaskRequest = AiTaskRequest;
export type AssistantTaskResult = AiTaskResult;
export type AssistantInputRef = AiInputRef;
export type AssistantSourceCitation = AiCitation;
export type AssistantConversionInput = ConversionInput;

/** Stable error codes returned by native commands (translated in errors.assistant.*). */
export type AssistantErrorCode =
  | "assistant.invalid"
  | "assistant.scope_denied"
  | "assistant.changed"
  | "assistant.confirmation_required"
  | "assistant.recycle_unavailable"
  | "assistant.outbound_required"
  | "assistant.outbound_expired"
  | "assistant.sensitive_api"
  | "assistant.api_auth"
  | "assistant.api_rate_limit"
  | "assistant.api_unavailable"
  | "assistant.api_response"
  | "assistant.endpoint_denied"
  | "assistant.provider_unsupported"
  | "assistant.key_store"
  | "assistant.provider_invalid"
  | "assistant.history_failed"
  | "assistant.failed";

const ASSISTANT_ERROR_SUFFIXES_LIST = [
  "invalid",
  "scope_denied",
  "changed",
  "confirmation_required",
  "recycle_unavailable",
  "outbound_required",
  "outbound_expired",
  "sensitive_api",
  "api_auth",
  "api_rate_limit",
  "api_unavailable",
  "api_response",
  "endpoint_denied",
  "provider_unsupported",
  "key_store",
  "provider_invalid",
  "history_failed",
  "failed",
] as const;

const ASSISTANT_ERROR_SUFFIXES: ReadonlySet<string> = new Set(
  ASSISTANT_ERROR_SUFFIXES_LIST as readonly string[],
);

/**
 * Maps a native/internal error code to an existing translated error key.
 * Internal detail codes never render as a raw i18n key.
 */
export function assistantErrorKey(code: string | null | undefined): string {
  const suffix = code?.split(".").at(-1) ?? "failed";
  return `errors.assistant.${ASSISTANT_ERROR_SUFFIXES.has(suffix) ? suffix : "failed"}`;
}
