import type { TFunction } from "i18next";
import type { ArchiveItem } from "../../services/archive";
import type { ExplorerItem } from "../../services/explorer";

/** Items inside an archive, drawn by the Explorer's own Details list
 * (Step 06d D3). Their `path` is the path inside the archive, never a path
 * on disk: these items never reach code that reads files. */

export function toExplorerItem(item: ArchiveItem): ExplorerItem {
  return {
    path: item.path,
    name: item.name,
    kind: item.kind === "folder" ? "folder" : "file",
    size: item.size,
    modified_unix: item.modified_unix,
    hidden: false,
    system: false,
    is_link: item.kind === "link",
    online_only: false,
    file_id: null,
    file_id_stable: false,
  };
}

/** The Type column: Folder, Link, or the file's extension. */
export function archiveTypeLabel(
  t: TFunction,
  item: { name: string; kind: string; is_link?: boolean },
): string {
  if (item.kind === "link" || item.is_link) return t("archive.linkType");
  if (item.kind === "folder") return t("explorer.folderType");
  const dot = item.name.lastIndexOf(".");
  if (dot <= 0 || dot === item.name.length - 1) return t("explorer.genericFile");
  return t("explorer.fileType", { ext: item.name.slice(dot + 1).toUpperCase() });
}

/** The path bar inside an archive: the archive itself, then one segment per
 * folder below it. */
export function breadcrumbSegments(
  archiveName: string,
  folder: string,
): { id: string; label: string }[] {
  const segments = [{ id: "", label: archiveName }];
  let current = "";
  for (const part of folder.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    segments.push({ id: current, label: part });
  }
  return segments;
}

/** The folder above this one inside the archive; "" stays at the root. */
export function parentFolder(folder: string): string {
  const parts = folder.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
