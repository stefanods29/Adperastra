/**
 * Canonical AI-search wire types (Step 17c, revision `ai-search-1`).
 *
 * Mirrors `src-tauri/src/ai_search_types.rs`. Fields keep snake_case names on
 * both sides. SearchQuery/SearchFilter/SearchResult are imported from Step
 * 11a, FileIdentityKey from 07a and AiInputRef/AiCitation from 14c; none of
 * them is copied here.
 */

import type { SearchFilter, SearchQuery, SearchResult } from "./search";
import type { FileIdentityKey } from "./fileIdentity";
import type { SourceStamp } from "./cache";
import type { AiCitation, AiInputRef } from "./localAiTypes";
import type { AssistantOutboundPreview } from "../assistant/types";

/** Settings schema 45 -> 46 adds the `ai_search` block. */
export const AI_SEARCH_SETTINGS_SCHEMA = 46;

export const MAX_AI_SEARCH_ROOTS = 32;
export const MAX_AI_DESTINATIONS = 32;
export const MAX_DISABLED_SORT_EXTENSIONS = 100;
export const MAX_AI_NAME_INPUTS = 100;
export const MAX_AI_NAME_STEM_SCALARS = 180;
export const MAX_SEMANTIC_TEXT_SCALARS = 1024;
export const MAX_SEMANTIC_ROOTS = 32;
export const MAX_SEMANTIC_RESULTS = 100;
export const DEFAULT_SEMANTIC_LIMIT = 50;
export const TEXT_EMBEDDING_DIMENSIONS = 384;
export const IMAGE_EMBEDDING_DIMENSIONS = 768;
export const MAX_TEXT_CHUNKS_PER_FILE = 64;
export const TEXT_CHUNK_SCALARS = 384;
export const TEXT_CHUNK_OVERLAP = 64;
export const MAX_INDEXED_FILE_SCALARS = 24_000;
export const MAX_INDEXED_TEXT_CHUNKS = 50_000;
export const MAX_INDEXED_IMAGES = 25_000;
export const MAX_EMBEDDING_BYTES = 512 * 1024 * 1024;
export const MAX_SEMANTIC_WORKING_BYTES = 64 * 1024 * 1024;
export const PREVIEW_TTL_SECONDS = 300;
export const MAX_NATURAL_QUERY_SCALARS = 1024;
export const MAX_NATURAL_EXPLANATION_SCALARS = 1024;
export const MAX_UNSUPPORTED_TERMS = 16;
export const MAX_SORT_HISTORY_ROWS = 100;
export const MAX_SORT_COUNTS = 3200;
export const MAX_SORT_HISTORY_BYTES = 256 * 1024;

/** The five independent opt-ins (D1). None of them defaults to on. */
export interface AiSearchSettings {
  semantic_text: boolean;
  photo_index: boolean;
  natural_query: boolean;
  rename: boolean;
  sort: boolean;
  roots: AiSemanticRoot[];
  destinations: AiDestination[];
  /** Canonical lower-case extensions without a leading dot. */
  disabled_sort_extensions: string[];
}

/** One explicitly opted-in 11a root. No path is copied into settings. */
export interface AiSemanticRoot {
  root_id: string;
  text: boolean;
  photos: boolean;
}

/** One explicitly approved real destination folder. */
export interface AiDestination {
  id: string;
  path: string;
  name: string;
}

export type SemanticVectorKind = "text" | "image";
export type SemanticQueryKind = "text" | "photo" | "similar_text" | "similar_image";
export type SemanticCoverage = "pending" | "partial" | "complete";

/** Native-only vector row. The UI never receives raw vectors. */
export interface SemanticVectorRecord {
  identity: FileIdentityKey;
  source: SourceStamp;
  root_ids: string[];
  model_id: string;
  model_revision: string;
  extractor_revision: number;
  kind: SemanticVectorKind;
  chunk_index: number;
  /** Unicode-scalar offsets, end exclusive; text only. */
  start: number | null;
  end: number | null;
  dimensions: number;
  vector: number[];
  partial: boolean;
}

export interface SemanticQuery {
  kind: SemanticQueryKind;
  text: string | null;
  input: AiInputRef | null;
  root_ids: string[];
  limit: number;
  request_revision: number;
  sensitive_consent_id: string | null;
}

export interface SemanticHit {
  item: SearchResult;
  /** Cosine similarity after L2 normalization. Never a probability. */
  score: number;
  chunk_index: number;
  source_revision: number;
  model_id: string;
  model_revision: string;
  snippet: string | null;
  partial: boolean;
}

export interface SemanticPage {
  hits: SemanticHit[];
  request_revision: number;
  index_generation: number;
  scanned: number;
  eligible: number;
  skipped: number;
  complete: boolean;
  coverage: SemanticCoverage;
}

export interface SemanticStatus {
  generation: number;
  text_chunks: number;
  images: number;
  bytes: number;
  pending: number;
  skipped: number;
  paused: boolean;
  reason_code: string | null;
}

export interface NaturalQueryRequest {
  text: string;
  root_ids: string[];
  now_unix: number;
  timezone: string;
  locale: "en" | "es";
  request_revision: number;
}

export interface NaturalQueryPreview {
  id: string;
  request_revision: number;
  status: "ready" | "clarify";
  query: SearchQuery | null;
  explanation: string;
  unsupported: string[];
  captured_now_unix: number;
  expires_unix: number;
}

export interface AiNameSuggestion {
  source: AiInputRef;
  source_stamp: SourceStamp;
  proposed_stem: string;
  reason: string;
  confidence: number;
  citations: AiCitation[];
}

/** Tokens exactly date/topic/company/type/month. */
export interface AiNamingPattern {
  pattern: string;
  tokens: Array<"date" | "topic" | "company" | "type" | "month">;
  locale: "en" | "es";
  date: string;
  month: string;
}

export interface AiSortSuggestion {
  id: string;
  identity: FileIdentityKey;
  source_stamp: SourceStamp;
  destination_id: string;
  score: number;
  basis: "history" | "content";
  reason: string;
  extension: string;
  expires_unix: number;
}

export interface SortCount {
  extension: string;
  destination_id: string;
  count: number;
}

export interface SortHistory {
  schema_version: 1;
  revision: number;
  counts: SortCount[];
  disabled: string[];
}

export type AiSearchInferenceRequest =
  | { kind: "query"; request: NaturalQueryRequest }
  | { kind: "names"; inputs: AiInputRef[]; pattern: AiNamingPattern }
  | { kind: "destination"; input: AiInputRef };

export interface AiSearchPreparedRequest {
  id: string;
  request: AiSearchInferenceRequest;
  outbound_preview: AssistantOutboundPreview;
  expires_unix: number;
}

export type AiSearchMode = "meaning" | "photos" | "similar" | "natural";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSION_RE = /^[a-z0-9_+-]{1,32}$/;
const DRIVE_PATH_RE = /^[A-Za-z]:\\/;
const UNC_PATH_RE = /^\\\\[^\\]+\\[^\\]+/;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isSafeU64(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

export function isSafeU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

/** A drive or UNC path without parent traversal, NULs or a trailing dot. */
export function isOrdinaryAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > 32_768 || value.includes("\0")) return false;
  if (!DRIVE_PATH_RE.test(value) && !UNC_PATH_RE.test(value)) return false;
  return !value.split(/[\\/]/).some((part) => part === "..");
}

export function defaultAiSearchSettings(): AiSearchSettings {
  return {
    semantic_text: false,
    photo_index: false,
    natural_query: false,
    rename: false,
    sort: false,
    roots: [],
    destinations: [],
    disabled_sort_extensions: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Schema 45 files gain the block switched off; future fields are kept. */
export function upgradeAiSearchSettings(value: unknown, fromSchemaVersion: number): AiSearchSettings {
  if (fromSchemaVersion < AI_SEARCH_SETTINGS_SCHEMA) return defaultAiSearchSettings();
  return normalizeAiSearchSettings(value);
}

export function normalizeDisabledSortExtensions(value: unknown): string[] {
  const result: string[] = [];
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    if (result.length >= MAX_DISABLED_SORT_EXTENSIONS) break;
    if (typeof entry !== "string") continue;
    const canonical = entry.trim().toLowerCase().replace(/^\./, "");
    if (!EXTENSION_RE.test(canonical) || result.includes(canonical)) continue;
    result.push(canonical);
  }
  return result;
}

export function normalizeAiSearchSettings(value: unknown): AiSearchSettings {
  const defaults = defaultAiSearchSettings();
  if (!isRecord(value)) return defaults;
  const roots: AiSemanticRoot[] = [];
  const seenRoots = new Set<string>();
  if (Array.isArray(value.roots)) {
    for (const entry of value.roots) {
      if (roots.length >= MAX_AI_SEARCH_ROOTS) break;
      if (!isRecord(entry) || !isCanonicalUuid(entry.root_id)) continue;
      const text = entry.text === true;
      const photos = entry.photos === true;
      if ((!text && !photos) || seenRoots.has(entry.root_id)) continue;
      seenRoots.add(entry.root_id);
      roots.push({ root_id: entry.root_id, text, photos });
    }
  }
  const destinations: AiDestination[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  if (Array.isArray(value.destinations)) {
    for (const entry of value.destinations) {
      if (destinations.length >= MAX_AI_DESTINATIONS) break;
      if (!isRecord(entry) || !isCanonicalUuid(entry.id)) continue;
      if (!isOrdinaryAbsolutePath(entry.path)) continue;
      if (typeof entry.name !== "string") continue;
      const name = entry.name.trim();
      if (name.length === 0 || Array.from(name).length > 60) continue;
      const key = entry.path.toLowerCase().replace(/\//g, "\\").replace(/\\$/, "");
      if (seenIds.has(entry.id) || seenPaths.has(key)) continue;
      seenIds.add(entry.id);
      seenPaths.add(key);
      destinations.push({ id: entry.id, path: entry.path, name });
    }
  }
  return {
    ...(value as Partial<AiSearchSettings>),
    semantic_text: value.semantic_text === true,
    photo_index: value.photo_index === true,
    natural_query: value.natural_query === true,
    rename: value.rename === true,
    sort: value.sort === true,
    roots,
    destinations,
    disabled_sort_extensions: normalizeDisabledSortExtensions(value.disabled_sort_extensions),
  };
}

/**
 * A root existing for ordinary content search is not AI consent. This keeps
 * only roots that are enabled in 11a, opted in for this mode and not marked
 * sensitive by the 09k provider.
 */
export function eligibleSemanticRoots(
  settings: AiSearchSettings,
  indexRoots: ReadonlyArray<{ id: string; enabled: boolean }>,
  sensitiveRootIds: readonly string[],
  mode: "text" | "photos",
): AiSemanticRoot[] {
  const enabled = new Set(indexRoots.filter((root) => root.enabled).map((root) => root.id));
  const sensitive = new Set(sensitiveRootIds);
  return settings.roots.filter((root) => {
    if (!enabled.has(root.root_id) || sensitive.has(root.root_id)) return false;
    return mode === "text" ? root.text : root.photos;
  });
}

export function aiModeEnabled(settings: AiSearchSettings, mode: AiSearchMode): boolean {
  if (mode === "meaning") return settings.semantic_text;
  if (mode === "photos" || mode === "similar") return settings.photo_index || settings.semantic_text;
  return settings.natural_query;
}

/** True only when an included index has exactly one explicit-name row. */
export function explicitRenameNamesValid(
  names: ReadonlyArray<{ input_index: number; new_name: string }>,
  includedIndices: readonly number[],
): boolean {
  if (names.length !== includedIndices.length || names.length === 0 || names.length > 1000) return false;
  const expected = new Set(includedIndices);
  if (expected.size !== includedIndices.length) return false;
  const seen = new Set<number>();
  for (const name of names) {
    if (!Number.isInteger(name.input_index) || name.input_index < 0) return false;
    if (!expected.has(name.input_index) || seen.has(name.input_index)) return false;
    seen.add(name.input_index);
    if (typeof name.new_name !== "string" || name.new_name.length === 0) return false;
    if (name.new_name.length > 255 || name.new_name.includes("\0")) return false;
    if (name.new_name === "." || name.new_name === "..") return false;
    if (/[\\/]/.test(name.new_name)) return false;
  }
  return seen.size === expected.size;
}

function recordKeysAre(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Canonical lower-case extension without a leading dot, or null. */
export function canonicalExtension(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const canonical = value.trim().toLowerCase().replace(/^\./, "");
  return EXTENSION_RE.test(canonical) ? canonical : null;
}

/** Validate the 11a filter AST, including unknown fields and operators. */
export function validateSearchFilter(filter: SearchFilter): boolean {
  let clauses = 0;
  const walk = (node: SearchFilter, depth: number): boolean => {
    if (depth > 4) return false;
    clauses += 1;
    if (clauses > 32 || !isRecord(node)) return false;
    if (node.kind === "all" || node.kind === "any") {
      return (
        recordKeysAre(node, ["kind", "clauses"]) &&
        Array.isArray(node.clauses) &&
        node.clauses.every((child) => walk(child, depth + 1))
      );
    }
    if (node.kind === "not") {
      return recordKeysAre(node, ["kind", "clause"]) && walk(node.clause, depth + 1);
    }
    if (node.kind === "string") {
      return (
        recordKeysAre(node, ["kind", "field", "op", "value"]) &&
        ["kind", "ext", "author"].includes(node.field) &&
        ["eq", "contains"].includes(node.op) &&
        typeof node.value === "string" &&
        Array.from(node.value).length <= 256
      );
    }
    if (node.kind === "number") {
      return (
        recordKeysAre(node, ["kind", "field", "op", "value"]) &&
        ["size", "width", "height", "duration_ms", "pages"].includes(node.field) &&
        ["eq", "gte", "lte"].includes(node.op) &&
        typeof node.value === "number" &&
        Number.isFinite(node.value) &&
        node.value >= 0
      );
    }
    if (node.kind === "date") {
      if (!recordKeysAre(node, ["kind", "field", "from_unix", "to_unix"])) return false;
      if (!["modified", "created", "date_taken"].includes(node.field)) return false;
      const from = node.from_unix;
      const to = node.to_unix;
      if (from !== undefined && !isSafeU64(from)) return false;
      if (to !== undefined && !isSafeU64(to)) return false;
      if (from !== undefined && to !== undefined && from > to) return false;
      return true;
    }
    if (node.kind === "ext_list") {
      return (
        recordKeysAre(node, ["kind", "values", "exclude"]) &&
        Array.isArray(node.values) &&
        node.values.length <= 256 &&
        node.values.every((value) => /^[a-z0-9_-]{1,32}$/.test(value)) &&
        new Set(node.values).size === node.values.length &&
        typeof node.exclude === "boolean"
      );
    }
    if (node.kind === "missing_date") {
      return (
        recordKeysAre(node, ["kind", "field"]) &&
        ["modified", "created", "date_taken"].includes(node.field as string)
      );
    }
    if (node.kind === "tags") {
      return (
        recordKeysAre(node, ["kind", "tag_ids", "match"]) &&
        Array.isArray(node.tag_ids) &&
        node.tag_ids.length <= 100 &&
        node.tag_ids.every(isCanonicalUuid) &&
        new Set(node.tag_ids).size === node.tag_ids.length &&
        (node.match === "all" || node.match === "any")
      );
    }
    return false;
  };
  return walk(filter, 1);
}

/** The interpreted query is always an ordinary 11a SearchQuery. */
export function validateAiSearchQuery(query: SearchQuery): boolean {
  if (!isRecord(query)) return false;
  if (query.mode !== "filters") return false;
  if (typeof query.text !== "string" || new TextEncoder().encode(query.text).length > 1024) return false;
  if (!Array.isArray(query.roots) || query.roots.length > MAX_SEMANTIC_ROOTS) return false;
  if (!query.roots.every(isCanonicalUuid) || new Set(query.roots).size !== query.roots.length) return false;
  if (query.filter !== null && query.filter !== undefined && !validateSearchFilter(query.filter)) return false;
  if (query.regex_scope !== undefined && query.regex_scope !== "name") return false;
  if (query.match_case !== undefined && query.match_case !== false) return false;
  const sort = query.sort;
  if (sort !== undefined && sort !== null) {
    if (!["name", "modified", "size", "kind"].includes(sort.key)) return false;
    if (sort.direction !== "ascending" && sort.direction !== "descending") return false;
  }
  return true;
}

export function validateSemanticQuery(query: SemanticQuery): boolean {
  if (!isRecord(query)) return false;
  if (!["text", "photo", "similar_text", "similar_image"].includes(query.kind)) return false;
  const wantsText = query.kind === "text" || query.kind === "photo";
  if (wantsText) {
    if (typeof query.text !== "string" || query.text.trim().length === 0) return false;
    if (Array.from(query.text).length > MAX_SEMANTIC_TEXT_SCALARS) return false;
    if (query.input !== null) return false;
  } else {
    if (query.text !== null) return false;
    if (query.input === null || !isRecord(query.input)) return false;
    if (!["document", "snapshot", "artifact"].includes(query.input.kind as string)) return false;
    if (!isCanonicalUuid(query.input.id) || !isSafeU64(query.input.expected_revision)) return false;
    if (query.input.expected_revision === 0) return false;
  }
  if (!Array.isArray(query.root_ids) || query.root_ids.length === 0) return false;
  if (query.root_ids.length > MAX_SEMANTIC_ROOTS) return false;
  if (!query.root_ids.every(isCanonicalUuid) || new Set(query.root_ids).size !== query.root_ids.length) {
    return false;
  }
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_SEMANTIC_RESULTS) return false;
  if (!isSafeU32(query.request_revision) || query.request_revision === 0) return false;
  if (query.sensitive_consent_id !== null && !isCanonicalUuid(query.sensitive_consent_id)) return false;
  return true;
}

/** 768 KiB is the largest JSON response of this feature. */
export function responseWithinBudget(json: string): boolean {
  return new TextEncoder().encode(json).length <= 768 * 1024;
}
