/** Creating new files for the New menu (Step 06c). */
import type { TFunction } from "i18next";
import { createItem } from "../services/fileops";
import { templateCreate, templatesList } from "../services/templates";
import { BLANK_KINDS, type BlankKind } from "./catalog";

/** A new blank file: Markdown and CSV are empty, the Office kinds are
 * copies of the shipped blank files. Returns the new file's path. */
export async function createBlank(kind: BlankKind, destDir: string, t: TFunction, lang: string): Promise<string> {
  const info = BLANK_KINDS.find((entry) => entry.kind === kind);
  if (!info) throw new Error("templates.bad_request");
  if (info.blankFile === null) return createItem(destDir, t(info.nameKey), "file");
  const list = await templatesList(lang);
  const ext = info.ext.replace(/^\./, "");
  const blank = list.blank.find((entry) => entry.ext === ext);
  if (!blank) throw new Error("templates.not_found");
  return templateCreate(blank.path, destDir, t(info.nameKey));
}

/** A copy of a built-in or My templates file under `name`. */
export async function createFromTemplate(templatePath: string, destDir: string, name: string): Promise<string> {
  return templateCreate(templatePath, destDir, name);
}
