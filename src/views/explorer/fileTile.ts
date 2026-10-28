import {
  Archive,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image,
  Music,
  type LucideIcon,
} from "lucide-react";
import type { ItemKind } from "../../services/explorer";

/** Figma file-type tiles (design-spec section 6). Real Windows shell
 * icons for .exe/.lnk/unknown types arrive in Step 07a (ADR 0005). */
export type TileTone =
  | "folder"
  | "sheet"
  | "doc"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "text"
  | "generic";

export interface FileTile {
  icon: LucideIcon;
  tone: TileTone;
}

const BY_EXTENSION: Record<string, FileTile> = {};
function map(extensions: string[], icon: LucideIcon, tone: TileTone) {
  for (const ext of extensions) BY_EXTENSION[ext] = { icon, tone };
}
map(["xlsx", "xls", "xlsm", "csv", "tsv", "ods"], FileSpreadsheet, "sheet");
map(["docx", "doc", "odt", "rtf"], FileText, "doc");
map(["pdf"], FileText, "pdf");
map(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"], Image, "image");
map(["mp4", "mkv", "mov", "avi", "webm", "wmv"], Film, "video");
map(["mp3", "wav", "flac", "ogg", "m4a", "aac"], Music, "audio");
map(["zip", "7z", "rar", "tar", "gz"], Archive, "archive");
map(["ts", "tsx", "js", "jsx", "rs", "py", "json", "html", "css", "md", "xml", "yml", "yaml", "toml"], FileCode2, "code");
map(["txt", "log"], FileText, "text");

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function fileTile(name: string, kind: ItemKind): FileTile {
  if (kind === "folder") return { icon: Folder, tone: "folder" };
  return BY_EXTENSION[fileExtension(name)] ?? { icon: File, tone: "generic" };
}