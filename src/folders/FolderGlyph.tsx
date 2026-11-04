import { Folder, FolderHeart, FolderLock, FolderOpen, Star, type LucideIcon } from "lucide-react";
import type { FolderDecoration, FolderIcon } from "../services/folderCustomization";
import { validFolderIcon } from "../services/folderCustomization";

const LUCIDE: Record<string, LucideIcon> = {
  folder: Folder,
  folderOpen: FolderOpen,
  folderHeart: FolderHeart,
  folderStar: Star,
  folderLock: FolderLock,
};

/** Folder icon and color for any decorated entry point. A catalog image icon
 * and a raw emoji survive only as validated data: images have no acquisition
 * adapter yet, so they fall back to the ordinary folder instead of reading a
 * source path. */
export function FolderGlyph({ decoration, size }: { decoration?: FolderDecoration; size: number }) {
  const icon = decoration?.icon;
  const color = decoration?.color ?? undefined;
  const safe: FolderIcon | undefined = icon && validFolderIcon(icon) ? icon : undefined;
  if (safe?.kind === "emoji" && safe.value) {
    return <span className="adp-folder-glyph-emoji" aria-hidden="true" style={{ fontSize: size }}>{safe.value}</span>;
  }
  if (safe?.kind === "lucide" && safe.value && LUCIDE[safe.value]) {
    const Icon = LUCIDE[safe.value];
    return <Icon size={size} aria-hidden="true" style={color ? { color } : undefined} />;
  }
  return <Folder size={size} aria-hidden="true" style={color ? { color } : undefined} />;
}
