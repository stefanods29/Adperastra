import { invoke } from "@tauri-apps/api/core";
import { runJob, type JobHandle } from "./jobs";
import { displayPath } from "./explorer";
import type { FileIdentityKey } from "./fileIdentity";
import type { SourceStamp } from "./cache";
import type { OpReport } from "./fileops";
import {
  isStorageCategory,
  MAX_SAFE_INTEGER,
  STORAGE_CATEGORIES,
  type ClearStorageResult,
  type StorageCategory,
  type StorageReport,
} from "./packTypes";
import { isTauriRuntime } from "./settings";

/** Storage view, duplicate review and cleanup (Step 11c, `storage-scan-1`
 * and `duplicate-review-1`). Only this service calls the native commands.
 * Fields stay snake_case because they mirror the Rust DTOs exactly. */

export type StorageNodeKind = "file" | "folder";
export type Coverage = "complete" | "partial";

export interface StorageScanRequest {
  /** Absolute folder or drive root. */
  root: string;
  allow_network: boolean;
  include_hidden: boolean;
  /** Fixed at 1,000,000. */
  max_entries: number;
}

export interface StorageNode {
  id: string;
  parent_id?: string | null;
  key: FileIdentityKey;
  path: string;
  name: string;
  kind: StorageNodeKind;
  logical_bytes: number;
  allocated_bytes?: number | null;
  item_count: number;
  online_only: boolean;
  coverage: Coverage;
  children_count: number;
}

export interface StorageSummary {
  scan_id: string;
  root: string;
  logical_bytes: number;
  allocated_unique_bytes?: number | null;
  unknown_allocated_count: number;
  files_count: number;
  folders_count: number;
  link_count: number;
  skipped_count: number;
  coverage: Coverage;
  cancelled: boolean;
  stale: boolean;
  generation: number;
  calculated_unix: number;
  reason_codes: string[];
}

export interface TypeBreakdown {
  kind: string;
  count: number;
  logical_bytes: number;
}

export interface StoragePage {
  summary: StorageSummary;
  nodes: StorageNode[];
  next_cursor?: string | null;
  complete: boolean;
  typed_breakdown: TypeBreakdown[];
}

export interface DuplicateRequest {
  roots: string[];
  include_hidden: boolean;
  allow_network: boolean;
  minimum_bytes: number;
}

export interface DuplicateMember {
  key: FileIdentityKey;
  source: SourceStamp;
  /** Hard-link aliases of the same physical file. */
  paths: string[];
  full_hash: string;
  logical_bytes: number;
  allocated_bytes?: number | null;
  modified_unix: number;
  verified: boolean;
}

export interface DuplicateGroup {
  id: string;
  members: DuplicateMember[];
  member_count: number;
  members_page_complete: boolean;
  verified: boolean;
  reclaimable_bytes?: number | null;
}

export interface DuplicatePage {
  scan_id: string;
  groups: DuplicateGroup[];
  next_cursor?: string | null;
  complete: boolean;
  skipped_count: number;
  coverage: Coverage;
  cleanup_available: boolean;
}

export interface DuplicateCleanupPlan {
  plan_id: string;
  scan_id: string;
  generation: number;
  selected: FileIdentityKey[];
  keepers: FileIdentityKey[];
  expires_unix: number;
}

export const MAX_RETAINED_SCANS = 4;

const retainedScans: string[] = [];

function requireRuntime(): void {
  if (!isTauriRuntime()) throw new Error("storage.unavailable");
}

/* App storage (Step 12a E4). The UI sends a category id, never a path. */

function checkCategory(category: StorageCategory): StorageCategory {
  if (!isStorageCategory(category)) throw new Error("storage.bad_request");
  return category;
}

/** Every registered store, in Settings order. */
export async function storageReport(): Promise<StorageReport[]> {
  if (!isTauriRuntime()) return [];
  const reports = (await invoke("storage_report")) as StorageReport[];
  return orderStorageReports(reports);
}

/** Clear one category as a shared job; a path cannot be supplied. */
export async function clearStorage(
  category: StorageCategory,
): Promise<JobHandle<ClearStorageResult>> {
  checkCategory(category);
  return runJob<ClearStorageResult>("storage", async (requestId) => {
    await invoke("storage_clear_start", { requestId, category });
  });
}

export async function setStorageLimit(
  category: StorageCategory,
  bytes: number,
): Promise<void> {
  checkCategory(category);
  if (!Number.isInteger(bytes) || bytes < 0 || bytes > MAX_SAFE_INTEGER) {
    throw new Error("storage.bad_request");
  }
  if (!isTauriRuntime()) return;
  await invoke("storage_set_limit", { category, bytes });
}

/** Sort rows in the fixed category order and drop duplicates/unknown ids. */
export function orderStorageReports(reports: readonly StorageReport[]): StorageReport[] {
  const seen = new Set<StorageCategory>();
  const valid = reports.filter((report) => {
    if (!isStorageCategory(report.category) || seen.has(report.category)) return false;
    seen.add(report.category);
    return true;
  });
  return valid.sort(
    (left, right) =>
      STORAGE_CATEGORIES.indexOf(left.category) - STORAGE_CATEGORIES.indexOf(right.category),
  );
}

/** Categories with no registered provider, for a completeness check. */
export function missingReportCategories(
  reports: readonly StorageReport[],
): StorageCategory[] {
  const present = new Set(reports.map((report) => report.category));
  return STORAGE_CATEGORIES.filter((category) => !present.has(category));
}

/** Remember at most four open scan results; the oldest is released first. */
async function rememberScan(scanId: string): Promise<void> {
  if (retainedScans.includes(scanId)) return;
  retainedScans.push(scanId);
  while (retainedScans.length > MAX_RETAINED_SCANS) {
    const oldest = retainedScans.shift();
    if (oldest) {
      try {
        await invoke("storage_release", { scanId: oldest });
      } catch {
        // The oldest scan may already be gone; retention is best effort.
      }
    }
  }
}

export function retainedScanCount(): number {
  return retainedScans.length;
}

/** For tests: clear the client retention list without native calls. */
export function resetRetainedScans(): void {
  retainedScans.length = 0;
}

/** The scan id is an additive acknowledgement; the returned object remains a
 * `JobHandle<StoragePage>` and can request a cached page while the job runs. */
export interface StorageScanHandle extends JobHandle<StoragePage> {
  scanId: string;
}

/** E1: start a bounded storage scan. The job result is its first page. */
export async function startStorageScan(
  request: StorageScanRequest,
): Promise<StorageScanHandle> {
  requireRuntime();
  let scanId = "";
  const handle = await runJob<StoragePage>("storage", async (requestId) => {
    scanId = (await invoke("storage_scan_start", { requestId, request })) as string;
  });
  return Object.assign(handle, { scanId });
}

/** E1: one bounded page; `parentId` null reads the root's children. */
export async function storagePage(
  scanId: string,
  parentId: string | null,
  cursor: string | null,
): Promise<StoragePage> {
  requireRuntime();
  const page = (await invoke("storage_page", {
    scanId,
    parentId,
    cursor,
  })) as StoragePage;
  await rememberScan(scanId);
  return page;
}

/** E1: release one retained scan. Cached rows stay until LRU/age cleanup. */
export async function releaseStorageScan(scanId: string): Promise<void> {
  requireRuntime();
  const index = retainedScans.indexOf(scanId);
  if (index >= 0) retainedScans.splice(index, 1);
  await invoke("storage_release", { scanId });
}

/** E2: find duplicate groups. The job result is the first page. */
export async function findDuplicates(
  request: DuplicateRequest,
): Promise<JobHandle<DuplicatePage>> {
  requireRuntime();
  return runJob<DuplicatePage>("dupes", async (requestId) => {
    await invoke("duplicates_start", { requestId, request });
  });
}

/** E2: one bounded page of duplicate groups. */
export async function duplicatePage(
  scanId: string,
  cursor?: string | null,
): Promise<DuplicatePage> {
  requireRuntime();
  return (await invoke("duplicates_page", { scanId, cursor: cursor ?? null })) as DuplicatePage;
}

/** E2: release one duplicate scan. */
export async function releaseDuplicateScan(scanId: string): Promise<void> {
  requireRuntime();
  await invoke("duplicates_release", { scanId });
}

/** E3: bind an explicit review to exact member identities. */
export async function prepareDuplicateCleanup(
  scanId: string,
  selected: readonly FileIdentityKey[],
  keepers: readonly FileIdentityKey[],
): Promise<DuplicateCleanupPlan> {
  requireRuntime();
  return (await invoke("duplicates_cleanup_prepare", {
    scanId,
    selected: [...selected],
    keepers: [...keepers],
  })) as DuplicateCleanupPlan;
}

/** E3: execute a prepared plan. Capability false rejects with
 * `storage.cleanup_unavailable` before any file write. */
export async function executeDuplicateCleanup(
  planId: string,
): Promise<JobHandle<OpReport>> {
  requireRuntime();
  return runJob<OpReport>("cleanup", async (requestId) => {
    await invoke("duplicates_cleanup_start", { requestId, planId });
  });
}

/** Display helper shared by both views. */
export function storageDisplayPath(path: string): string {
  return displayPath(path);
}

export function identityKeyText(key: FileIdentityKey): string {
  return `${key.volume_id}:${key.file_id}:${key.path_key}`;
}

export function isKnownSize(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
