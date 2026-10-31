import { invoke } from "@tauri-apps/api/core";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Built-in templates, the blank Office files and My templates
 * (Step 06c). Mirrors Rust `templates.rs` (snake_case fields). */

export interface BuiltinTemplateFile {
  id: string;
  path: string;
}

export interface BlankTemplateFile {
  ext: string;
  path: string;
}

export interface UserTemplate {
  name: string;
  path: string;
}

export interface TemplateList {
  builtin: BuiltinTemplateFile[];
  blank: BlankTemplateFile[];
  user: UserTemplate[];
  user_folder: string;
  user_folder_missing: boolean;
  user_error?: string | null;
  user_skipped?: number;
}

/** A template copy can be stopped while its bytes are being written. */
export interface TemplateCreateOptions {
  signal?: AbortSignal;
  onProgress?: (progress: OpProgress) => void;
}

/** What the lists are outside the app (browser preview and tests). */
export function emptyTemplateList(): TemplateList {
  return { builtin: [], blank: [], user: [], user_folder: "", user_folder_missing: false, user_error: null, user_skipped: 0 };
}

export async function templatesList(lang: string): Promise<TemplateList> {
  if (!isTauriRuntime()) return emptyTemplateList();
  return (await invoke("templates_list", { lang })) as TemplateList;
}

export async function templateCreate(
  templatePath: string,
  destDir: string,
  name: string,
  options: TemplateCreateOptions = {},
): Promise<string> {
  if (!isTauriRuntime()) throw new Error("templates.other");
  if (options.signal?.aborted) throw new Error("templates.cancelled");
  let job: JobHandle<string> | undefined;
  const cancel = () => { void job?.cancel(); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    job = await runJob<string>(
      "template",
      async (requestId) => {
        await invoke("template_create_start", {
          requestId,
          request: { template_path: templatePath, dest_dir: destDir, name },
        });
      },
      options.onProgress,
    );
    // The dialog may close while the start command is still returning.
    if (options.signal?.aborted) cancel();
    return await job.completion;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}

export async function templatesPickFolder(title: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return (await invoke("templates_pick_folder", { title })) as string | null;
}
