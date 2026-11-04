import { invoke } from "@tauri-apps/api/core";
import { runJob, type JobHandle } from "./jobs";
import type { PackCatalog, PackId, PackState } from "./packTypes";
import { RESERVED_AI_PACK_IDS, PRODUCTION_PACK_IDS } from "./packTypes";
import { isTauriRuntime } from "./settings";

/** Optional packs (Step 12a E1). Only this service calls the pack commands. */

const KNOWN_IDS: readonly PackId[] = [...PRODUCTION_PACK_IDS, ...RESERVED_AI_PACK_IDS];
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;

function checkId(id: PackId): PackId {
  if (!KNOWN_IDS.includes(id)) throw new Error("packs.bad_request");
  return id;
}

function checkVersion(version: string): string {
  if (!VERSION_RE.test(version)) throw new Error("packs.bad_request");
  return version;
}

/** Every pack row; opening App storage needs no network. */
export async function listPacks(): Promise<PackState[]> {
  if (!isTauriRuntime()) return [];
  return (await invoke("pack_list")) as PackState[];
}

/** Refresh the signed catalog only after the user chooses Refresh catalog. */
export async function refreshPackCatalog(): Promise<JobHandle<PackCatalog>> {
  return runJob<PackCatalog>("packcat", async (requestId) => {
    await invoke("catalog_refresh_start", { requestId });
  });
}

export async function installPack(
  id: PackId,
  version: string,
): Promise<JobHandle<PackState>> {
  checkId(id);
  checkVersion(version);
  return runJob<PackState>("packinst", async (requestId) => {
    await invoke("install_start", { requestId, id, version });
  });
}

export async function pausePackDownload(id: PackId): Promise<void> {
  checkId(id);
  if (!isTauriRuntime()) return;
  await invoke("download_pause", { id });
}

export async function resumePackDownload(id: PackId): Promise<JobHandle<PackState>> {
  checkId(id);
  return runJob<PackState>("packres", async (requestId) => {
    await invoke("download_resume_start", { requestId, id });
  });
}

export async function removePack(id: PackId): Promise<JobHandle<PackState>> {
  checkId(id);
  return runJob<PackState>("packrem", async (requestId) => {
    await invoke("remove_start", { requestId, id });
  });
}
