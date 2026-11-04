/** Local profiles and verified portable copies (Step 10c T4-T6,
 * profile-root-1).
 *
 * The catalog lives next to the app data, before settings load. The default
 * profile keeps the legacy data folder; every other profile has its own
 * folder under `profiles/<UUID>`. Shared engine packs stay shared.
 */
import { invoke } from "@tauri-apps/api/core";
import { runJob, type JobHandle } from "./jobs";

export const PROFILE_CATALOG_SCHEMA = 1;
export const MAX_PROFILES = 20;
export const MAX_PROFILE_NAME = 60;
export const DEFAULT_PROFILE_ID = "default";

export interface ProfileDescriptor {
  /** "default" or a canonical UUID. */
  id: string;
  /** 1 to 60 Unicode scalar values, already trimmed. */
  name: string;
  created_unix: number;
  modified_unix: number;
}

export interface ProfileCatalog {
  schema_version: number;
  active_id: string;
  /** Set only while a controlled restart is pending. */
  pending_id?: string | null;
  profiles: ProfileDescriptor[];
  revision: number;
}

export interface ProfileRoot {
  base_dir: string;
  profile_dir: string;
  shared_packs_dir: string;
  profile_id: string;
  portable: boolean;
}

export interface ProfileSwitchPlan {
  plan_id: string;
  target_id: string;
  catalog_revision: number;
  needs_dirty_prompt: boolean;
  active_job_ids: string[];
  expires_unix: number;
}

export interface PortableCopyRequest {
  dest_dir: string;
  include_packs: boolean;
  expected_base: string;
  /** Fixed true: an existing destination is never merged or replaced. */
  nooverwrite: true;
}

export interface PortableCopyReport {
  dest_dir: string;
  files_copied: number;
  bytes_copied: number;
  manifest_sha256: string;
  complete: boolean;
  error_codes: string[];
  source_retained: true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalProfileId(id: string): boolean {
  return id === DEFAULT_PROFILE_ID || UUID_RE.test(id);
}

/** Trimmed, non-empty, at most 60 Unicode scalar values. */
export function normalizeProfileName(name: string): string | null {
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  if (length === 0 || length > MAX_PROFILE_NAME) return null;
  return trimmed;
}

export function profileById(catalog: ProfileCatalog, id: string): ProfileDescriptor | null {
  return catalog.profiles.find((profile) => profile.id === id) ?? null;
}

/** `profiles_list` (native `profiles_list`). */
export async function listProfiles(): Promise<ProfileCatalog> {
  return (await invoke("profiles_list")) as ProfileCatalog;
}

/** Native `profile_create`; a stale revision is profiles.changed. */
export async function createProfile(name: string, expectedRevision: number): Promise<ProfileCatalog> {
  return (await invoke("profile_create", { name, expectedRevision })) as ProfileCatalog;
}

/** `profile_rename` (native `profile_rename`); the id never changes. */
export async function renameProfile(
  id: string,
  name: string,
  expectedRevision: number,
): Promise<ProfileCatalog> {
  return (await invoke("profile_rename", { id, name, expectedRevision })) as ProfileCatalog;
}

/** E5: the resolved root every category service receives. */
export async function getProfileRoot(): Promise<ProfileRoot> {
  return (await invoke("profile_root")) as ProfileRoot;
}

/** E4: ask for a bounded switch plan; the host has already gathered dirty/job state. */
export async function prepareProfileSwitch(targetId: string): Promise<ProfileSwitchPlan> {
  return (await invoke("profile_switch_prepare", { targetId })) as ProfileSwitchPlan;
}

/** E4: make `pending_id` durable. The caller restarts only after this resolves. */
export async function commitProfileSwitch(planId: string): Promise<void> {
  await invoke("profile_switch_commit", { planId });
}

/**
 * E6: verified app-data copy through the shared job table. Cancelling keeps
 * the source and publishes no complete manifest.
 */
export function copyPortableData(
  request: PortableCopyRequest,
  onProgress?: (progress: import("./fileops").OpProgress) => void,
): Promise<JobHandle<PortableCopyReport>> {
  return runJob<PortableCopyReport>(
    "portable",
    (requestId) => invoke("portable_copy_start", { requestId, request }).then(() => undefined),
    onProgress,
  );
}
