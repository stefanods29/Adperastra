import type { SortDirection } from "../../services/explorer";
import type { FolderSizeValue } from "../../services/folderSizes";

/** Size-column comparison for optional background folder sizes (Step 11c
 * E5). A folder uses its numeric size only when the value is `ready`.
 * Pending, running, partial and unavailable folders are unknown and always
 * sort last in both directions; `partial` is "at least", never a complete
 * number. The direction is applied only to the numeric part. */

export interface SizeComparable {
  path: string;
  file_bytes: number;
  is_folder: boolean;
  folder_size: FolderSizeValue | null;
}

export function knownSortBytes(value: SizeComparable): number | null {
  if (!value.is_folder) {
    return Number.isFinite(value.file_bytes) && value.file_bytes >= 0
      ? value.file_bytes
      : 0;
  }
  if (value.folder_size?.state !== "ready") return null;
  const bytes = value.folder_size.logical_bytes;
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

function nameCompare(left: SizeComparable, right: SizeComparable): number {
  const a = left.path.toLowerCase();
  const b = right.path.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareSizeValues(
  a: SizeComparable,
  b: SizeComparable,
  direction: SortDirection,
): number {
  const left = knownSortBytes(a);
  const right = knownSortBytes(b);
  // Unknown folders always come after known values, ascending or
  // descending; when both are unknown the existing name order decides.
  if (left === null && right === null) return nameCompare(a, b);
  if (left === null) return 1;
  if (right === null) return -1;
  const numeric =
    direction === "ascending" ? left - right : right - left;
  return numeric !== 0 ? numeric : nameCompare(a, b);
}

/** While an inline rename is open, an asynchronous size update must not
 * re-sort the list. The host calls this before applying a new order. */
export function resortAllowed(renamingPath: string | null): boolean {
  return renamingPath === null;
}
