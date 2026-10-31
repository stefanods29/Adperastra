import { invoke } from "@tauri-apps/api/core";
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
}

/** What the lists are outside the app (browser preview and tests). */
export function emptyTemplateList(): TemplateList {
  return { builtin: [], blank: [], user: [], user_folder: "", user_folder_missing: false };
}

export async function templatesList(lang: string): Promise<TemplateList> {
  if (!isTauriRuntime()) return emptyTemplateList();
  return (await invoke("templates_list", { lang })) as TemplateList;
}

export async function templateCreate(templatePath: string, destDir: string, name: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("templates.other");
  return (await invoke("template_create", { templatePath, destDir, name })) as string;
}

export async function templatesPickFolder(title: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return (await invoke("templates_pick_folder", { title })) as string | null;
}
