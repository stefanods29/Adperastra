import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import { runJob, type JobHandle } from "./jobs";

export type RenameOperation =
  | { kind: "replace"; find: string; replacement: string; regex: boolean; match_case: boolean }
  | { kind: "prefix" | "suffix"; text: string }
  | { kind: "number"; start: number; step: number; padding: number; position: "prefix" | "suffix"; separator: string }
  | { kind: "case"; mode: "lower" | "upper" | "title" }
  | { kind: "template"; pattern: string }
  | { kind: "remove"; characters: string }
  | { kind: "explicit_names"; names: ExplicitRenameName[] };
export interface ExplicitRenameName { input_index: number; new_name: string }
export interface RenameRequest {
  paths: string[];
  operations: RenameOperation[];
  include_extension: boolean;
  excluded_indices: number[];
  date_zone: "utc" | "local";
  request_revision: number;
}
export interface RenamePreviewRow {
  input_index: number;
  source_path: string;
  source: SourceStamp;
  old_name: string;
  new_name: string;
  status: "unchanged" | "ready" | "excluded" | "invalid" | "conflict";
  reason?: string | null;
}
export interface RenamePlanPage {
  plan_id: string;
  request_revision: number;
  rows: RenamePreviewRow[];
  next_cursor?: string | null;
  total: number;
  ready: number;
  invalid: number;
  conflicts: number;
  expires_unix: number;
  all_rows_valid: boolean;
}
export interface RenameEffect {
  source: SourceStamp;
  original_path: string;
  current_path: string;
  target_path: string;
  status: "renamed" | "rolled_back" | "recovery_required";
  reason?: string | null;
}
export interface RenameReport {
  receipt_id: string;
  effects: RenameEffect[];
  next_cursor?: string | null;
  done: number;
  failed: number;
  excluded: number;
  cancelled: boolean;
  recovery_required: boolean;
  complete: boolean;
}
export interface RenamePreset {
  id: string;
  name: string;
  operations: RenameOperation[];
  include_extension: boolean;
  date_zone: "utc" | "local";
  version: 1;
}
export interface RenamePresetCatalog { schema_version: 1; revision: number; presets: RenamePreset[] }

export function previewRename(request: RenameRequest): Promise<JobHandle<RenamePlanPage>> {
  return runJob("rename", async (requestId) => { await invoke("rename_preview_start", { requestId, request }); });
}
export async function renamePreviewPage(cursor: string): Promise<RenamePlanPage> {
  return await invoke("rename_preview_page", { cursor });
}
export function executeRename(planId: string, requestRevision: number): Promise<JobHandle<RenameReport>> {
  return runJob("rename", async (requestId) => { await invoke("rename_execute_start", { requestId, planId, requestRevision }); });
}
export async function renameReportPage(cursor: string): Promise<RenameReport> {
  return await invoke("rename_report_page", { cursor });
}
export async function releaseRenamePlan(planId: string): Promise<void> {
  await invoke("rename_plan_release", { planId });
}
export async function listRenamePresets(): Promise<RenamePresetCatalog> { return await invoke("rename_presets_list"); }
export async function writeRenamePreset(preset: RenamePreset, expectedRevision: number): Promise<RenamePresetCatalog> {
  return await invoke("rename_preset_write", { preset, expectedRevision });
}
export async function removeRenamePreset(id: string, expectedRevision: number): Promise<RenamePresetCatalog> {
  return await invoke("rename_preset_remove", { id, expectedRevision });
}
